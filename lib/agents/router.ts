/**
 * Storehouse — Routing Agent
 *
 * Takes a classified income_event and produces an allocation plan across
 * the user's active obligations. The LLM proposes; the validator enforces;
 * invalid plans get re-prompted with the validation error so the LLM can
 * self-correct.
 *
 * Pipeline position:
 *   Classifier  → income_events (classification set)
 *               → [THIS AGENT] writes routing_decisions row (validated or not)
 *               → Executor reads validated decisions and sends transfers
 *
 * Critical design rule: the Router does NOT execute. It only decides. The
 * Executor (next agent) calls Circle SDK to actually move USDC. This makes
 * the Router testable in isolation and means the entire reasoning trail is
 * persisted before any money moves.
 */

import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdminClient } from "@/lib/supabase/admin-client";
import {
  AllocationItem,
  CLAUDE_HAIKU_MODEL,
  IncomeEventRow,
  RoutingPlan,
} from "./types";
import { ObligationContext, validateRoutingPlan } from "./validator";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Obligation context loaded from DB
// ---------------------------------------------------------------------------

interface ObligationForPrompt {
  id: string;
  name: string;
  type: "percentage" | "fixed" | "goal";
  amount: string | null;
  destination_address: string;
  destination_label: string | null;
  destination_type: "onchain" | "fiat_offramp";
  due_date: string | null;
  due_recurrence: "monthly" | "quarterly" | "annually" | null;
  priority: number;
  current_period_target: string | null;
  current_period_filled: string;
  current_balance: string; // joined from buckets
}

async function loadActiveObligations(): Promise<ObligationForPrompt[]> {
  const { data, error } = await supabaseAdminClient
      .from("obligations")
      .select(`
      id,
      name,
      type,
      amount,
      destination_address,
      destination_label,
      destination_type,
      due_date,
      due_recurrence,
      priority,
      current_period_target,
      current_period_filled,
      buckets ( current_balance )
    `)
      .eq("active", true)
      .order("priority", { ascending: true });

  if (error) {
    throw new Error(`Failed to load obligations: ${error.message}`);
  }

  if (!data) return [];

  return data.map((row: any) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    amount: row.amount,
    destination_address: row.destination_address,
    destination_label: row.destination_label,
    destination_type: row.destination_type,
    due_date: row.due_date,
    due_recurrence: row.due_recurrence,
    priority: row.priority,
    current_period_target: row.current_period_target,
    current_period_filled: row.current_period_filled,
    current_balance: row.buckets?.[0]?.current_balance ?? "0",
  }));
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Storehouse's Routing Agent.

You receive an inbound USDC transfer that has just arrived in the user's main wallet. Your job is to decide how to split that amount across the user's registered obligations, in order to honor their stewardship priorities.

You will be given:
  - The inbound transfer (amount, classification, source context)
  - The user's active obligations (with priority, type, due dates, current state)
  - Today's date

Obligation types:
  - percentage: take this fraction of the inbound (e.g. 0.10 = 10%)
  - fixed: a flat dollar amount due by a specific date (e.g. car payment $450 by the 15th)
  - goal: a savings target with progress tracking (current_period_target vs current_period_filled)

Output a JSON object with this exact shape:
{
  "allocations": [
    {
      "obligation_id": "<uuid>",
      "obligation_name": "<readable name>",
      "destination_address": "<address from the obligation>",
      "amount": "<decimal string, e.g. '450.00'>"
    },
    ...
  ],
  "reasoning": "<2-4 sentence plain-English explanation of the plan>"
}

Rules:
  - Respond with ONLY the JSON object. No prose before or after.
  - Allocations must sum to exactly the inbound amount. Every cent must land somewhere.
  - Higher-priority obligations (lower priority number) are generally honored first.
  - Percentage obligations take their fraction off the top (10% of inbound, etc.).
  - Fixed obligations with imminent due dates should be funded urgently. An obligation due in 3 days is urgent; one due in 25 days is not.
  - Goal obligations only need funding if current_period_filled < current_period_target.
  - There is always exactly one "Operating" or remainder obligation. It receives whatever is left after higher-priority allocations.
  - Use the obligation's destination_address verbatim. Do not invent addresses.
  - Reasoning should explain the why, not just restate the numbers. Speak to priority and timing.

If a validation error is included in the user message, you previously proposed an invalid plan. Read the error, fix it, and try again.`;

function buildUserPrompt(
    event: IncomeEventRow,
    obligations: ObligationForPrompt[],
    todayIso: string,
    previousError?: string
): string {
  const obligationsText = obligations
      .map((o) => {
        const lines = [
          `- ${o.name} (id: ${o.id}, priority ${o.priority}, type ${o.type})`,
          `    destination: ${o.destination_address} [${o.destination_type}]`,
        ];
        if (o.type === "percentage" && o.amount) {
          lines.push(`    fraction: ${o.amount}`);
        }
        if (o.type === "fixed" && o.amount) {
          lines.push(`    amount due: ${o.amount} USDC`);
        }
        if (o.due_date) {
          lines.push(`    due_date: ${o.due_date} (${o.due_recurrence ?? "one-time"})`);
        }
        if (o.current_period_target) {
          lines.push(
              `    progress: ${o.current_period_filled} / ${o.current_period_target} this period`
          );
        }
        lines.push(`    bucket balance: ${o.current_balance} USDC`);
        return lines.join("\n");
      })
      .join("\n\n");

  const errorBlock = previousError
      ? `\n\nPREVIOUS ATTEMPT FAILED VALIDATION:\n${previousError}\n\nFix the issue and respond with a corrected plan.\n`
      : "";

  return `Today's date: ${todayIso}

Inbound transfer:
  amount:        ${event.amount} USDC
  classification: ${event.classification ?? "unclassified"} (confidence ${event.classification_confidence ?? "n/a"})
  classification reasoning: ${event.classification_reasoning ?? "n/a"}
  source address: ${event.source_address}
  source chain:  ${event.source_chain}

Active obligations (in priority order):

${obligationsText}
${errorBlock}
Produce the allocation plan as JSON.`;
}

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

function parsePlan(rawResponse: string): RoutingPlan {
  const cleaned = rawResponse
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Router returned non-JSON: ${cleaned.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Router response is not an object");
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.allocations)) {
    throw new Error("Router response has no allocations array");
  }
  if (typeof obj.reasoning !== "string") {
    throw new Error("Router response has no reasoning string");
  }

  const allocations: AllocationItem[] = obj.allocations.map(
      (a: unknown, i: number) => {
        if (typeof a !== "object" || a === null) {
          throw new Error(`Allocation ${i} is not an object`);
        }
        const ao = a as Record<string, unknown>;
        if (typeof ao.obligation_id !== "string") {
          throw new Error(`Allocation ${i} missing obligation_id`);
        }
        if (typeof ao.obligation_name !== "string") {
          throw new Error(`Allocation ${i} missing obligation_name`);
        }
        if (typeof ao.destination_address !== "string") {
          throw new Error(`Allocation ${i} missing destination_address`);
        }
        if (typeof ao.amount !== "string") {
          throw new Error(`Allocation ${i} missing amount (must be a string)`);
        }
        return {
          obligation_id: ao.obligation_id,
          obligation_name: ao.obligation_name,
          destination_address: ao.destination_address,
          amount: ao.amount,
        };
      }
  );

  return {
    allocations,
    reasoning: obj.reasoning,
  };
}

// ---------------------------------------------------------------------------
// Main router function
// ---------------------------------------------------------------------------

export interface RoutingResult {
  routing_decision_id: string;
  plan: RoutingPlan;
  validated: boolean;
  validation_errors: string[];
  attempts: number;
}

/**
 * Routes a single classified income_event.
 * Loads obligations, calls Claude, validates, retries on failure up to 3x.
 * Writes the resulting routing_decision row (validated or not) for audit trail.
 */
export async function routeIncomeEvent(
    event: IncomeEventRow
): Promise<RoutingResult> {
  if (event.classification === null) {
    throw new Error(`income_event ${event.id} has no classification yet`);
  }
  if (event.status !== "arrived_on_arc") {
    throw new Error(
        `income_event ${event.id} is in status ${event.status}, expected arrived_on_arc`
    );
  }

  const obligations = await loadActiveObligations();
  if (obligations.length === 0) {
    throw new Error("No active obligations found — cannot route");
  }

  const obligationContext: ObligationContext[] = obligations.map((o) => ({
    id: o.id,
    name: o.name,
    destination_address: o.destination_address,
    destination_type: o.destination_type,
  }));

  const todayIso = new Date().toISOString().slice(0, 10);

  let lastPlan: RoutingPlan | null = null;
  let lastErrors: string[] = [];
  let lastAttempts = 0;
  let previousError: string | undefined;

  console.log(
      `Routing income_event ${event.id.slice(0, 8)}... (${event.amount} USDC, classified as ${event.classification})`
  );

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    lastAttempts = attempt;

    const response = await anthropic.messages.create({
      model: CLAUDE_HAIKU_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildUserPrompt(event, obligations, todayIso, previousError),
        },
      ],
    });

    const firstBlock = response.content[0];
    if (firstBlock.type !== "text") {
      throw new Error(`Unexpected Claude block type: ${firstBlock.type}`);
    }

    let plan: RoutingPlan;
    try {
      plan = parsePlan(firstBlock.text);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`  attempt ${attempt}: parse failure — ${message}`);
      previousError = message;
      lastErrors = [message];
      continue;
    }

    const validation = validateRoutingPlan(plan, event.amount, obligationContext);
    lastPlan = plan;
    lastErrors = validation.errors;

    if (validation.valid) {
      console.log(`  attempt ${attempt}: ✓ valid plan`);
      break;
    }

    console.warn(
        `  attempt ${attempt}: validation failed — ${validation.errors.join("; ")}`
    );
    previousError = validation.errors.join("\n");
  }

  // Whether valid or not, persist the decision for audit
  const validated = lastErrors.length === 0 && lastPlan !== null;

  const planJson = lastPlan
      ? lastPlan
      : { allocations: [], reasoning: "(no valid plan after retries)" };

  const reasoning = lastPlan?.reasoning ?? "(no valid plan after retries)";

  const { data: decisionRow, error: insertError } = await supabaseAdminClient
      .from("routing_decisions")
      .insert({
        income_event_id: event.id,
        plan: planJson as any,
        llm_reasoning: reasoning,
        llm_model: CLAUDE_HAIKU_MODEL,
        validated,
        validation_errors: lastErrors.length > 0 ? lastErrors : null,
      })
      .select("id")
      .single();

  if (insertError || !decisionRow) {
    throw new Error(
        `Failed to persist routing_decision: ${insertError?.message ?? "no row returned"}`
    );
  }

  if (validated) {
    console.log(
        `  ✓ routing_decision ${decisionRow.id.slice(0, 8)}... persisted (validated)`
    );
  } else {
    console.warn(
        `  ✗ routing_decision ${decisionRow.id.slice(0, 8)}... persisted with ${lastErrors.length} validation error(s)`
    );
  }

  return {
    routing_decision_id: decisionRow.id,
    plan: planJson,
    validated,
    validation_errors: lastErrors,
    attempts: lastAttempts,
  };
}

/**
 * Routes all income_events that:
 *   - have status = arrived_on_arc
 *   - have a classification set
 *   - do not yet have a validated routing_decision
 */
export async function routeAllPending(): Promise<{
  routed: number;
  failed: number;
}> {
  const { data: candidates, error: fetchError } = await supabaseAdminClient
      .from("income_events")
      .select("*")
      .eq("status", "arrived_on_arc")
      .not("classification", "is", null);

  if (fetchError) {
    throw new Error(`Failed to fetch routable events: ${fetchError.message}`);
  }

  if (!candidates || candidates.length === 0) {
    console.log("No income_events ready for routing.");
    return { routed: 0, failed: 0 };
  }

  // Filter out events that already have a validated routing_decision
  const { data: existingDecisions } = await supabaseAdminClient
      .from("routing_decisions")
      .select("income_event_id")
      .in(
          "income_event_id",
          candidates.map((c: any) => c.id)
      )
      .eq("validated", true);

  const alreadyRouted = new Set(
      (existingDecisions ?? []).map((d: any) => d.income_event_id)
  );

  const toRoute = (candidates as IncomeEventRow[]).filter(
      (c) => !alreadyRouted.has(c.id)
  );

  if (toRoute.length === 0) {
    console.log("All classified events already have validated routing decisions.");
    return { routed: 0, failed: 0 };
  }

  console.log(`Found ${toRoute.length} event(s) to route.`);

  let routed = 0;
  let failed = 0;

  for (const event of toRoute) {
    try {
      const result = await routeIncomeEvent(event);
      if (result.validated) {
        routed += 1;
      } else {
        failed += 1;
      }
    } catch (e) {
      failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`✗ Routing failed for ${event.id}: ${message}`);
    }
  }

  return { routed, failed };
}
