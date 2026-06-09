/**
 * Storehouse — Execution Agent
 *
 * Takes validated routing_decisions and actually moves USDC. For each
 * allocation in the plan:
 *   - onchain destinations: call Circle SDK to transfer USDC from
 *     storehouse-main to the bucket wallet
 *   - fiat_offramp destinations: write a transfers row with status
 *     'pending_offramp' and stop (offramp adapter call deferred to v1.1)
 *
 * Pipeline position:
 *   Router → routing_decisions (validated=true, executed_at=NULL)
 *          → [THIS AGENT] writes transfers rows, calls Circle SDK,
 *            updates routing_decisions.executed_at, income_events.status,
 *            buckets.current_balance
 *
 * Idempotency: relies on the unique constraint
 *   transfers_unique_per_allocation (routing_decision_id, obligation_id).
 * If the Executor crashes and restarts:
 *   - Re-inserting an existing (routing_decision_id, obligation_id) row
 *     fails with Postgres error code 23505 (unique violation)
 *   - Executor catches that, looks up the existing transfer, and resumes
 *     based on its current status
 *
 * Status state machine for transfers rows:
 *   pending          - row inserted, Circle SDK call not yet made
 *   submitted        - Circle SDK accepted the transfer, has transactionId
 *   confirmed        - webhook confirmed on-chain (set by webhook handler)
 *   failed           - Circle SDK rejected or threw
 *   pending_offramp  - fiat_offramp leg, awaiting offramp adapter (v1.1)
 *
 * The Executor only moves transfers from 'pending' to 'submitted' or 'failed'.
 * Webhook handlers update to 'confirmed'.
 */

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { supabaseAdminClient } from "@/lib/supabase/admin-client";
import { AllocationItem, RoutingPlan } from "./types";

// ---------------------------------------------------------------------------
// Circle SDK client
// ---------------------------------------------------------------------------

const circle = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY ?? "",
    entitySecret: process.env.CIRCLE_ENTITY_SECRET ?? "",
});

// ---------------------------------------------------------------------------
// Env validation (fail fast if misconfigured)
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required env var: ${name}`);
    }
    return value;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoutingDecisionRow {
    id: string;
    income_event_id: string;
    plan: RoutingPlan;
    validated: boolean;
    executed_at: string | null;
}

interface TransferRow {
    id: string;
    routing_decision_id: string;
    obligation_id: string;
    destination_address: string;
    amount: string;
    circle_transaction_id: string | null;
    tx_hash: string | null;
    status: string;
}

interface ObligationRow {
    id: string;
    destination_type: "onchain" | "fiat_offramp";
}

export interface ExecutionResult {
    routing_decision_id: string;
    submitted: number;
    pending_offramp: number;
    failed: number;
    skipped_already_done: number;
    errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Looks up an obligation's destination_type. Cached per call via Map.
 */
async function getObligationsByIds(
    ids: string[]
): Promise<Map<string, ObligationRow>> {
    const { data, error } = await supabaseAdminClient
        .from("obligations")
        .select("id, destination_type")
        .in("id", ids);

    if (error) {
        throw new Error(`Failed to load obligations: ${error.message}`);
    }

    const map = new Map<string, ObligationRow>();
    for (const row of (data ?? []) as ObligationRow[]) {
        map.set(row.id, row);
    }
    return map;
}

/**
 * Inserts a transfers row for an allocation. On unique constraint violation
 * (the transfer already exists from a prior run), returns the existing row
 * instead. This is the idempotency seam.
 */
async function insertOrGetTransfer(
    routingDecisionId: string,
    allocation: AllocationItem,
    initialStatus: "pending" | "pending_offramp"
): Promise<{ row: TransferRow; alreadyExisted: boolean }> {
    const { data: inserted, error: insertError } = await supabaseAdminClient
        .from("transfers")
        .insert({
            routing_decision_id: routingDecisionId,
            obligation_id: allocation.obligation_id,
            destination_address: allocation.destination_address,
            amount: allocation.amount,
            status: initialStatus,
        })
        .select("*")
        .single();

    if (!insertError && inserted) {
        return { row: inserted as TransferRow, alreadyExisted: false };
    }

    // Postgres unique violation = 23505. Look up existing row and return it.
    if (insertError && (insertError as any).code === "23505") {
        const { data: existing, error: fetchError } = await supabaseAdminClient
            .from("transfers")
            .select("*")
            .eq("routing_decision_id", routingDecisionId)
            .eq("obligation_id", allocation.obligation_id)
            .single();

        if (fetchError || !existing) {
            throw new Error(
                `Unique violation but could not fetch existing transfer: ${fetchError?.message ?? "not found"}`
            );
        }
        return { row: existing as TransferRow, alreadyExisted: true };
    }

    throw new Error(`Failed to insert transfer: ${insertError?.message}`);
}

/**
 * Marks the source income_event and routing_decision as routed after all
 * onchain transfers have been submitted successfully.
 */
async function finalizeRoutingDecision(
    routingDecisionId: string,
    incomeEventId: string
): Promise<void> {
    const nowIso = new Date().toISOString();

    const { error: rdError } = await supabaseAdminClient
        .from("routing_decisions")
        .update({ executed_at: nowIso })
        .eq("id", routingDecisionId);

    if (rdError) {
        throw new Error(
            `Failed to mark routing_decision executed: ${rdError.message}`
        );
    }

    const { error: ieError } = await supabaseAdminClient
        .from("income_events")
        .update({ status: "routed" })
        .eq("id", incomeEventId);

    if (ieError) {
        throw new Error(
            `Failed to mark income_event routed: ${ieError.message}`
        );
    }
}

// ---------------------------------------------------------------------------
// Main executor function
// ---------------------------------------------------------------------------

/**
 * Executes a single validated routing_decision.
 * Returns an ExecutionResult summarizing what happened per allocation.
 *
 * Does NOT throw on per-allocation failures — those are recorded in the
 * transfers table with status='failed' and continued past. Throws only on
 * unrecoverable system errors (DB unavailable, env missing, etc.).
 */
export async function executeRoutingDecision(
    decision: RoutingDecisionRow
): Promise<ExecutionResult> {
    if (!decision.validated) {
        throw new Error(
            `routing_decision ${decision.id} is not validated; refusing to execute`
        );
    }

    if (decision.executed_at !== null) {
        console.log(
            `routing_decision ${decision.id.slice(0, 8)}... already executed at ${decision.executed_at}, skipping`
        );
        return {
            routing_decision_id: decision.id,
            submitted: 0,
            pending_offramp: 0,
            failed: 0,
            skipped_already_done: decision.plan.allocations.length,
            errors: [],
        };
    }

    const mainWalletId = requireEnv("STOREHOUSE_MAIN_WALLET_ID");
    const usdcTokenId = requireEnv("CIRCLE_USDC_TOKEN_ID");

    console.log(
        `Executing routing_decision ${decision.id.slice(0, 8)}... (${decision.plan.allocations.length} allocations)`
    );

    // Load obligation destination types up front
    const obligationIds = decision.plan.allocations.map((a) => a.obligation_id);
    const obligationsById = await getObligationsByIds(obligationIds);

    const result: ExecutionResult = {
        routing_decision_id: decision.id,
        submitted: 0,
        pending_offramp: 0,
        failed: 0,
        skipped_already_done: 0,
        errors: [],
    };

    for (const allocation of decision.plan.allocations) {
        const obligation = obligationsById.get(allocation.obligation_id);
        if (!obligation) {
            const msg = `Allocation references unknown obligation ${allocation.obligation_id}`;
            console.error(`  ✗ ${msg}`);
            result.errors.push(msg);
            result.failed += 1;
            continue;
        }

        const isOnchain = obligation.destination_type === "onchain";

        // Step 1: Insert (or fetch existing) transfer row
        let transferRow: TransferRow;
        let alreadyExisted: boolean;

        try {
            const initialStatus = isOnchain ? "pending" : "pending_offramp";
            const inserted = await insertOrGetTransfer(
                decision.id,
                allocation,
                initialStatus
            );
            transferRow = inserted.row;
            alreadyExisted = inserted.alreadyExisted;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`  ✗ ${allocation.obligation_name}: ${msg}`);
            result.errors.push(`${allocation.obligation_name}: ${msg}`);
            result.failed += 1;
            continue;
        }

        // If this transfer already existed and has a terminal status, skip it.
        if (
            alreadyExisted &&
            (transferRow.status === "submitted" ||
                transferRow.status === "confirmed" ||
                transferRow.status === "pending_offramp")
        ) {
            console.log(
                `  • ${allocation.obligation_name}: already ${transferRow.status} (transfer ${transferRow.id.slice(0, 8)}...), skipping`
            );
            result.skipped_already_done += 1;
            continue;
        }

        // Step 2: For fiat_offramp legs, we already wrote pending_offramp and stop.
        // Executor does not call the offramp adapter in v1.0.
        if (!isOnchain) {
            console.log(
                `  • ${allocation.obligation_name}: ${allocation.amount} USDC → fiat_offramp (deferred, status=pending_offramp)`
            );
            result.pending_offramp += 1;
            continue;
        }

        // Step 3: Submit the Circle transfer
        try {
            console.log(
                `  → ${allocation.obligation_name}: submitting ${allocation.amount} USDC → ${allocation.destination_address.slice(0, 10)}...`
            );

            const response = await circle.createTransaction({
                walletId: mainWalletId,
                tokenId: usdcTokenId,
                destinationAddress: allocation.destination_address,
                amount: [allocation.amount],
                fee: {
                    type: "level",
                    config: {
                        feeLevel: "MEDIUM",
                    },
                },
            } as any);

            const transactionId = response?.data?.id;
            if (!transactionId) {
                throw new Error(
                    `Circle SDK returned no transaction id (response: ${JSON.stringify(response?.data ?? response)})`
                );
            }

            // Step 4: Update the transfer row with the Circle transaction id and submitted status
            const { error: updateError } = await supabaseAdminClient
                .from("transfers")
                .update({
                    circle_transaction_id: transactionId,
                    status: "submitted",
                })
                .eq("id", transferRow.id);

            if (updateError) {
                throw new Error(
                    `Circle accepted transfer ${transactionId} but DB update failed: ${updateError.message}`
                );
            }

            console.log(
                `  ✓ ${allocation.obligation_name}: submitted (circle tx ${transactionId.slice(0, 8)}...)`
            );
            result.submitted += 1;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`  ✗ ${allocation.obligation_name}: ${msg}`);

            // Mark the transfer row as failed so we have an audit trail
            await supabaseAdminClient
                .from("transfers")
                .update({ status: "failed" })
                .eq("id", transferRow.id);

            result.errors.push(`${allocation.obligation_name}: ${msg}`);
            result.failed += 1;
        }
    }

    // Step 5: If at least one onchain leg was submitted and no failures occurred,
    // mark the routing_decision and income_event as routed. If some legs failed,
    // do NOT mark the decision executed — partial execution must be visible.
    const allOnchainResolved =
        result.failed === 0 && (result.submitted > 0 || result.skipped_already_done > 0);

    if (allOnchainResolved) {
        try {
            await finalizeRoutingDecision(decision.id, decision.income_event_id);
            console.log(
                `  ✓ routing_decision ${decision.id.slice(0, 8)}... finalized: income_event routed, executed_at set`
            );
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`  ✗ Finalization failed: ${msg}`);
            result.errors.push(`finalization: ${msg}`);
        }
    } else if (result.failed > 0) {
        console.warn(
            `  ⚠ routing_decision ${decision.id.slice(0, 8)}... NOT finalized (${result.failed} leg(s) failed). Re-run executor after addressing failures.`
        );
    }

    return result;
}

/**
 * Executes all validated, not-yet-executed routing_decisions.
 */
export async function executeAllPending(): Promise<{
    executed: number;
    failed: number;
}> {
    const { data: decisions, error } = await supabaseAdminClient
        .from("routing_decisions")
        .select("id, income_event_id, plan, validated, executed_at")
        .eq("validated", true)
        .is("executed_at", null)
        .order("created_at", { ascending: true });

    if (error) {
        throw new Error(`Failed to fetch pending routing_decisions: ${error.message}`);
    }

    if (!decisions || decisions.length === 0) {
        console.log("No validated routing_decisions awaiting execution.");
        return { executed: 0, failed: 0 };
    }

    console.log(`Found ${decisions.length} routing_decision(s) to execute.`);

    let executed = 0;
    let failed = 0;

    for (const decision of decisions as RoutingDecisionRow[]) {
        try {
            const result = await executeRoutingDecision(decision);
            if (result.failed === 0) {
                executed += 1;
            } else {
                failed += 1;
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`✗ Unrecoverable error executing ${decision.id}: ${msg}`);
            failed += 1;
        }
    }

    return { executed, failed };
}