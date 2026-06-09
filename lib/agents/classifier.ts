/**
 * Storehouse — Income Classification Agent
 *
 * Reads income_events rows that have arrived on Arc but are not yet classified,
 * sends context to Claude Haiku, and writes the structured classification back
 * to the row.
 *
 * Pipeline position:
 *   webhook → income_events (arrived_on_arc, classification=null)
 *          → [THIS AGENT] sets classification + reasoning
 *          → Routing Agent reads classified rows and produces allocation plan
 *
 * The classifier does NOT change income_event.status. The Router does that
 * when transfers actually execute. Classification just enriches the row.
 *
 * Safety pattern: LLM proposes a classification; deterministic code validates
 * the response is well-formed JSON and matches our enum before writing.
 */

import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdminClient } from "@/lib/supabase/admin-client";
import {
  CLAUDE_HAIKU_MODEL,
  ClassificationResult,
  IncomeEventRow,
  IncomeType,
} from "./types";

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Storehouse's Income Classification Agent.

Your job is to look at an inbound USDC transfer and classify it as one of:
  - paycheck:  recurring income from an employer or known payer
  - gift:      one-time transfer, often round amounts, from family/friends
  - refund:    return of a previously paid amount
  - transfer:  user moving their own funds between their wallets
  - unknown:   you cannot confidently determine the type

You will be given:
  - The amount of the transfer (in USDC)
  - The source address that sent it
  - The source chain (which network it came from)
  - The user's history of inbound transfers from this source address, if any

Output a JSON object with this exact shape:
{
  "type": "paycheck" | "gift" | "refund" | "transfer" | "unknown",
  "confidence": <number between 0 and 1>,
  "reasoning": "<one sentence explaining your classification>"
}

Rules:
  - Respond with ONLY the JSON object. No prose before or after.
  - If you have no signal (first time seeing this sender, no other context),
    classify as "unknown" with low confidence.
  - Round amounts like 100, 500, 1000 are weak signals toward "gift".
  - Recurring exact amounts from the same source are strong signals toward "paycheck".
  - The user transferring between their own wallets is "transfer".
  - Be conservative. It is better to mark as "unknown" with 0.3 confidence than
    to confidently misclassify.`;

function buildUserPrompt(
  event: IncomeEventRow,
  senderHistory: { amount: string; received_at: string }[]
): string {
  const historyText =
    senderHistory.length === 0
      ? "No prior inbound transfers from this sender."
      : `Prior inbound transfers from this sender (${senderHistory.length} total):\n` +
        senderHistory
          .map(
            (h) =>
              `  - ${h.amount} USDC on ${new Date(h.received_at).toISOString().slice(0, 10)}`
          )
          .join("\n");

  return `Classify this inbound USDC transfer:

Amount:        ${event.amount} USDC
Source address: ${event.source_address}
Source chain:  ${event.source_chain}
Received at:   ${event.received_at}

${historyText}

Respond with the JSON object only.`;
}

// ---------------------------------------------------------------------------
// JSON parsing with strict validation
// ---------------------------------------------------------------------------

const VALID_TYPES: IncomeType[] = [
  "paycheck",
  "gift",
  "refund",
  "transfer",
  "unknown",
];

function parseAndValidate(rawResponse: string): ClassificationResult {
  // Strip code fences if the model wrapped the JSON
  const cleaned = rawResponse
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Classifier returned non-JSON: ${cleaned.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Classifier response is not an object");
  }

  const obj = parsed as Record<string, unknown>;
  const type = obj.type;
  const confidence = obj.confidence;
  const reasoning = obj.reasoning;

  if (typeof type !== "string" || !VALID_TYPES.includes(type as IncomeType)) {
    throw new Error(`Invalid type from classifier: ${String(type)}`);
  }

  if (
    typeof confidence !== "number" ||
    confidence < 0 ||
    confidence > 1 ||
    Number.isNaN(confidence)
  ) {
    throw new Error(`Invalid confidence from classifier: ${String(confidence)}`);
  }

  if (typeof reasoning !== "string" || reasoning.length === 0) {
    throw new Error("Classifier response missing or empty reasoning");
  }

  return {
    type: type as IncomeType,
    confidence,
    reasoning,
  };
}

// ---------------------------------------------------------------------------
// Sender history lookup
// ---------------------------------------------------------------------------

async function getSenderHistory(
  sourceAddress: string,
  excludeId: string
): Promise<{ amount: string; received_at: string }[]> {
  const { data, error } = await supabaseAdminClient
    .from("income_events")
    .select("amount, received_at")
    .eq("source_address", sourceAddress)
    .neq("id", excludeId)
    .order("received_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error(
      `Failed to fetch sender history for ${sourceAddress}: ${error.message}`
    );
    return [];
  }

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Main classifier function
// ---------------------------------------------------------------------------

/**
 * Classifies a single income_event row.
 *
 * Returns the ClassificationResult on success; throws on unrecoverable error.
 * Writes the classification back to the row in the same call.
 */
export async function classifyIncomeEvent(
  event: IncomeEventRow
): Promise<ClassificationResult> {
  if (event.classification !== null) {
    throw new Error(
      `income_event ${event.id} already classified as ${event.classification}`
    );
  }

  if (event.status !== "arrived_on_arc") {
    throw new Error(
      `income_event ${event.id} is in status ${event.status}, not arrived_on_arc`
    );
  }

  const history = await getSenderHistory(event.source_address, event.id);

  console.log(
    `Classifying income_event ${event.id.slice(0, 8)}... (${event.amount} USDC from ${event.source_address.slice(0, 10)}...)`
  );

  const response = await anthropic.messages.create({
    model: CLAUDE_HAIKU_MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildUserPrompt(event, history),
      },
    ],
  });

  const firstBlock = response.content[0];
  if (firstBlock.type !== "text") {
    throw new Error(
      `Unexpected response block type from Claude: ${firstBlock.type}`
    );
  }

  const result = parseAndValidate(firstBlock.text);

  // Write back to the database
  const { error } = await supabaseAdminClient
    .from("income_events")
    .update({
      classification: result.type,
      classification_confidence: result.confidence,
      classification_reasoning: result.reasoning,
    })
    .eq("id", event.id);

  if (error) {
    throw new Error(
      `Failed to write classification to income_event ${event.id}: ${error.message}`
    );
  }

  console.log(
    `✓ Classified as ${result.type} (confidence ${result.confidence.toFixed(2)}): ${result.reasoning}`
  );

  return result;
}

/**
 * Convenience: classify all unclassified arrived_on_arc events.
 * Processes serially to keep things simple; we can parallelize later if needed.
 */
export async function classifyAllPending(): Promise<{
  classified: number;
  failed: number;
}> {
  const { data: events, error } = await supabaseAdminClient
    .from("income_events")
    .select("*")
    .eq("status", "arrived_on_arc")
    .is("classification", null)
    .order("received_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch pending income_events: ${error.message}`);
  }

  if (!events || events.length === 0) {
    console.log("No pending income_events to classify.");
    return { classified: 0, failed: 0 };
  }

  console.log(`Found ${events.length} income_event(s) to classify.`);

  let classified = 0;
  let failed = 0;

  for (const event of events as IncomeEventRow[]) {
    try {
      await classifyIncomeEvent(event);
      classified += 1;
    } catch (e) {
      failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`✗ Failed to classify ${event.id}: ${message}`);
    }
  }

  return { classified, failed };
}
