/**
 * Re-run the executor over an already-executed routing decision.
 *
 * One-off repair: the fiat_offramp leg failed to insert because the transfers
 * status check constraint did not permit 'pending_offramp'. With the constraint
 * fixed, re-running writes the missing leg. Transfers that already reached a
 * terminal status are skipped by the executor's own guard, so confirmed legs
 * are not resubmitted.
 *
 * Run: npx tsx scripts/reexecute-decision.ts <routing_decision_id>
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const id = process.argv[2];
if (!id) {
  console.error("usage: npx tsx scripts/reexecute-decision.ts <routing_decision_id>");
  process.exit(1);
}

async function main() {
  // Imported after dotenv has run — these modules read env at module load.
  const { supabaseAdminClient } = await import("../lib/supabase/admin-client");
  const { executeRoutingDecision } = await import("../lib/agents/executor");

  const { data: before, error: loadErr } = await supabaseAdminClient
    .from("routing_decisions")
    .select("*")
    .eq("id", id)
    .single();

  if (loadErr || !before) {
    console.error("could not load routing decision:", loadErr?.message);
    process.exit(1);
  }

  console.log(`decision ${id.slice(0, 8)}... executed_at=${before.executed_at}`);
  console.log(`allocations: ${before.plan.allocations.length}`);

  // Clear executed_at so the executor will process it again.
  const { error: clearErr } = await supabaseAdminClient
    .from("routing_decisions")
    .update({ executed_at: null })
    .eq("id", id);

  if (clearErr) {
    console.error("could not clear executed_at:", clearErr.message);
    process.exit(1);
  }

  const result = await executeRoutingDecision({ ...before, executed_at: null } as any);

  console.log("\nresult:", JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error("failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
