/**
 * Storehouse — Routing Plan Validator
 *
 * Deterministic, side-effect-free validation of an LLM-proposed allocation
 * plan. The Router asks Claude for a plan; this validator says yes/no with
 * specific errors. Failed plans get re-prompted with the error so the LLM
 * can fix its proposal.
 *
 * The validator is the safety net. The LLM brings reasoning; this code
 * brings correctness. The AI cannot cause financial damage by hallucinating
 * math because the validator catches it before execution.
 *
 * Rules enforced:
 *   1. Plan must allocate exactly the inbound amount (no remainder, no overflow)
 *   2. No allocation can be negative
 *   3. No allocation can be zero (would write a useless row)
 *   4. Every allocated obligation_id must exist in the provided allowlist
 *   5. Every allocated destination_address must match the obligation's address
 *   6. (Bucket-level state checks are deferred to the Executor — the Validator
 *      doesn't know current balances)
 */

import { AllocationItem, RoutingPlan, ValidationResult } from "./types";

export interface ObligationContext {
  id: string;
  name: string;
  destination_address: string;
}

/**
 * Validates a routing plan against a known set of obligations and a target
 * total. Returns { valid: true, errors: [] } on success, or
 * { valid: false, errors: [...] } with specific issues to feed back to the LLM.
 *
 * Money is compared in cents (multiplied by 100, rounded) to avoid float
 * imprecision. USDC has 6 decimals on-chain, but the LLM emits human strings,
 * so we round to cents for comparison — close enough for routing decisions.
 */
export function validateRoutingPlan(
  plan: RoutingPlan,
  totalInboundUsdc: string,
  knownObligations: ObligationContext[]
): ValidationResult {
  const errors: string[] = [];

  // Build a lookup so we can verify each allocation's obligation_id and address
  const obligationsById = new Map<string, ObligationContext>();
  for (const o of knownObligations) {
    obligationsById.set(o.id, o);
  }

  // Rule 1: allocations array must exist and be non-empty
  if (!Array.isArray(plan.allocations) || plan.allocations.length === 0) {
    errors.push("Plan has no allocations");
    return { valid: false, errors };
  }

  // Rule 2: reasoning must be non-empty
  if (typeof plan.reasoning !== "string" || plan.reasoning.trim().length === 0) {
    errors.push("Plan reasoning is empty");
  }

  // Walk allocations and check each
  let totalAllocatedCents = 0;
  const seenObligations = new Set<string>();

  for (let i = 0; i < plan.allocations.length; i += 1) {
    const a = plan.allocations[i];
    const prefix = `Allocation ${i}`;

    // obligation_id is a valid known obligation
    const obligation = obligationsById.get(a.obligation_id);
    if (!obligation) {
      errors.push(
        `${prefix}: obligation_id ${a.obligation_id} is not in the allowlist`
      );
      continue;
    }

    // destination_address matches the obligation's address exactly
    if (
      a.destination_address.toLowerCase() !==
      obligation.destination_address.toLowerCase()
    ) {
      errors.push(
        `${prefix}: destination_address ${a.destination_address} does not match obligation ${obligation.name} (${obligation.destination_address})`
      );
    }

    // No duplicate obligations in one plan
    if (seenObligations.has(a.obligation_id)) {
      errors.push(`${prefix}: obligation ${obligation.name} appears multiple times`);
    }
    seenObligations.add(a.obligation_id);

    // Amount validation
    const amountNum = parseFloat(a.amount);
    if (Number.isNaN(amountNum)) {
      errors.push(`${prefix}: amount "${a.amount}" is not a valid number`);
      continue;
    }
    if (amountNum < 0) {
      errors.push(`${prefix}: amount ${a.amount} is negative`);
      continue;
    }
    if (amountNum === 0) {
      errors.push(`${prefix}: amount is zero (allocate at least 0.01 or omit)`);
      continue;
    }

    totalAllocatedCents += Math.round(amountNum * 100);
  }

  // Rule: total must equal inbound exactly (in cents)
  const inboundCents = Math.round(parseFloat(totalInboundUsdc) * 100);
  if (totalAllocatedCents !== inboundCents) {
    const allocatedUsdc = (totalAllocatedCents / 100).toFixed(2);
    errors.push(
      `Total allocated ${allocatedUsdc} USDC does not equal inbound ${totalInboundUsdc} USDC (diff ${((totalAllocatedCents - inboundCents) / 100).toFixed(2)})`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
