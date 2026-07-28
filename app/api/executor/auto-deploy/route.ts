/**
 * Auto-deploy trigger endpoint. Hit on a schedule (or manually) to run the
 * autonomous aggressive-lane deployer. Protected by a shared secret so only
 * the scheduler can invoke it.
 */
import { NextRequest, NextResponse } from "next/server";
import { autoDeployAggressiveBuckets } from "@/lib/executor/auto-deploy";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // background work; allow time for bridge+deploy

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-auto-deploy-secret");
  if (!process.env.AUTO_DEPLOY_SECRET || secret !== process.env.AUTO_DEPLOY_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const report = await autoDeployAggressiveBuckets();
    return NextResponse.json({ ok: true, report }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

// GET for liveness / manual inspection (no secret = no run, just status).
export async function GET() {
  return NextResponse.json({ status: "ok", note: "POST with x-auto-deploy-secret to run" }, { status: 200 });
}
