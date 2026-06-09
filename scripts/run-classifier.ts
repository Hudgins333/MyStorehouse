/**
 * Storehouse — Classifier CLI runner
 *
 * Manually invokes the Income Classification Agent on all pending events.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/run-classifier.ts
 *
 * Or to classify a specific event by ID:
 *   npx tsx --env-file=.env.local scripts/run-classifier.ts <income_event_id>
 *
 * This is a dev tool, not part of the running app. Once we trust the
 * classifier, we'll wire it into a background job or run it directly
 * from the webhook handler.
 */

import { classifyAllPending, classifyIncomeEvent } from "../lib/agents/classifier";
import { supabaseAdminClient } from "../lib/supabase/admin-client";
import { IncomeEventRow } from "../lib/agents/types";

async function main() {
  const targetId = process.argv[2];

  if (targetId) {
    // Classify a single event by ID
    console.log(`Looking up income_event ${targetId}...`);

    const { data, error } = await supabaseAdminClient
      .from("income_events")
      .select("*")
      .eq("id", targetId)
      .single();

    if (error || !data) {
      console.error(
        `Failed to find income_event ${targetId}: ${error?.message ?? "not found"}`
      );
      process.exit(1);
    }

    try {
      await classifyIncomeEvent(data as IncomeEventRow);
      console.log("\nDone.");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`\nClassification failed: ${message}`);
      process.exit(1);
    }
  } else {
    // Classify all pending events
    const result = await classifyAllPending();
    console.log(
      `\nDone. Classified ${result.classified}, failed ${result.failed}.`
    );
  }
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
