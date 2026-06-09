/**
 * Storehouse — Router CLI runner
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/run-router.ts
 *   npx tsx --env-file=.env.local scripts/run-router.ts <income_event_id>
 */

import { routeAllPending, routeIncomeEvent } from "../lib/agents/router";
import { supabaseAdminClient } from "../lib/supabase/admin-client";
import { IncomeEventRow } from "../lib/agents/types";

async function main() {
  const targetId = process.argv[2];

  if (targetId) {
    console.log(`Looking up income_event ${targetId}...`);
    const { data, error } = await supabaseAdminClient
      .from("income_events")
      .select("*")
      .eq("id", targetId)
      .single();

    if (error || !data) {
      console.error(`Could not find income_event: ${error?.message ?? "not found"}`);
      process.exit(1);
    }

    const result = await routeIncomeEvent(data as IncomeEventRow);
    console.log("\n--- Result ---");
    console.log(`routing_decision_id: ${result.routing_decision_id}`);
    console.log(`validated: ${result.validated}`);
    console.log(`attempts: ${result.attempts}`);
    if (!result.validated) {
      console.log(`errors: ${result.validation_errors.join("; ")}`);
    }
  } else {
    const result = await routeAllPending();
    console.log(`\nDone. Routed ${result.routed}, failed ${result.failed}.`);
  }
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
