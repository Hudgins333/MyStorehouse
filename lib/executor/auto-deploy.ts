/**
 * Autonomous aggressive-lane deployer.
 *
 * The background process that makes deployment auto: finds aggressive buckets
 * with idle balance ≥ threshold and deploys them, with no human trigger. Meant
 * to be called on a schedule (or hit via endpoint).
 *
 * Idempotency is the core safety property. Before any bridging, a 'pending'
 * lane_deployment row is inserted. A concurrent or subsequent run computes idle
 * balance counting pending+active deployments, so it will not double-deploy
 * funds already in flight. On success the row flips to 'active' with the
 * tokenId; on failure it flips to 'failed' with the error, and the funds are
 * NOT re-counted as deployed (so a later run can retry).
 */
import { createClient } from "@supabase/supabase-js";
import { computeIdleBalance, LANE_MIN_USDC } from "./idle-balance";
import { deployBucket } from "./deploy-bucket";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY) as string
);

export interface AutoDeployReport {
  checked: number;
  deployed: { name: string; amount: number; tokenId: string }[];
  skipped: { name: string; reason: string }[];
  failed: { name: string; error: string }[];
}

export async function autoDeployAggressiveBuckets(): Promise<AutoDeployReport> {
  const report: AutoDeployReport = { checked: 0, deployed: [], skipped: [], failed: [] };

  const { data: buckets, error } = await supabase
    .from("obligations")
    .select("id,name,destination_address,risk_tier")
    .eq("risk_tier", "aggressive");
  if (error) throw new Error(`could not load aggressive buckets: ${error.message}`);

  for (const ob of buckets ?? []) {
    report.checked++;

    // Guard: if a deployment is already pending for this bucket, skip — a run
    // is in flight. (computeIdleBalance also counts pending, but this is an
    // explicit early skip so we don't even do the balance RPCs.)
    const { data: inFlight } = await supabase
      .from("lane_deployments")
      .select("id")
      .eq("obligation_id", ob.id)
      .eq("status", "pending")
      .limit(1);
    if (inFlight && inFlight.length > 0) {
      report.skipped.push({ name: ob.name, reason: "deployment already pending" });
      continue;
    }

    const idle = await computeIdleBalance(ob);
    if (!idle.deployable) {
      report.skipped.push({ name: ob.name, reason: `idle ${idle.idleUsdc.toFixed(2)} < ${LANE_MIN_USDC}` });
      continue;
    }

    const amount = idle.deployAmount.toFixed(6);

    // 1. Insert the pending guard row BEFORE any funds move.
    const { data: pending, error: insErr } = await supabase
      .from("lane_deployments")
      .insert({ obligation_id: ob.id, tier: "aggressive", amount_usdc: amount, status: "pending" })
      .select("id")
      .single();
    if (insErr || !pending) {
      report.failed.push({ name: ob.name, error: `could not create pending row: ${insErr?.message}` });
      continue;
    }

    // 2. Deploy (bridge Arc→Base, then run the lane).
    try {
      const result = await deployBucket(ob.id, amount);
      await supabase
        .from("lane_deployments")
        .update({
          status: "active",
          token_id: result.deploy.tokenId,
          tx_hashes: result.deploy.txHashes,
          activated_at: new Date().toISOString(),
        })
        .eq("id", pending.id);
      report.deployed.push({ name: ob.name, amount: Number(amount), tokenId: result.deploy.tokenId });
    } catch (e) {
      // Mark failed — funds are NOT counted as deployed, so a later run retries.
      await supabase
        .from("lane_deployments")
        .update({ status: "failed", error: e instanceof Error ? e.message : String(e) })
        .eq("id", pending.id);
      report.failed.push({ name: ob.name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return report;
}
