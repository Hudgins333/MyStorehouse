/**
 * Storehouse — Executor CLI runner
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/run-executor.ts
 *   npx tsx --env-file=.env.local scripts/run-executor.ts <routing_decision_id>
 */

import {
    executeAllPending,
    executeRoutingDecision,
} from "../lib/agents/executor";
import { supabaseAdminClient } from "../lib/supabase/admin-client";

async function main() {
    const targetId = process.argv[2];

    if (targetId) {
        console.log(`Looking up routing_decision ${targetId}...`);
        const { data, error } = await supabaseAdminClient
            .from("routing_decisions")
            .select("id, income_event_id, plan, validated, executed_at")
            .eq("id", targetId)
            .single();

        if (error || !data) {
            console.error(
                `Could not find routing_decision: ${error?.message ?? "not found"}`
            );
            process.exit(1);
        }

        const result = await executeRoutingDecision(data as any);
        console.log("\n--- Result ---");
        console.log(`submitted:           ${result.submitted}`);
        console.log(`pending_offramp:     ${result.pending_offramp}`);
        console.log(`failed:              ${result.failed}`);
        console.log(`skipped_already_done: ${result.skipped_already_done}`);
        if (result.errors.length > 0) {
            console.log(`errors:`);
            for (const err of result.errors) {
                console.log(`  - ${err}`);
            }
        }
    } else {
        const result = await executeAllPending();
        console.log(`\nDone. Executed ${result.executed}, failed ${result.failed}.`);
    }
}

main().catch((e) => {
    console.error("Unhandled error:", e);
    process.exit(1);
});
