/**
 * Onboarding extraction + validation core.
 *
 * LLM proposes, code validates — same safety model as the routing brain.
 * Sonnet reads the user's natural-language description and proposes structured
 * obligations; this module validates each proposal against the obligations
 * schema and either accepts it or returns specific, re-promptable errors.
 *
 * The LLM never writes to the database. It only proposes. Everything that
 * reaches the obligations table has passed deterministic validation here.
 *
 * See SPEC-telegram-addendum.md §11.4–11.5.
 */
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_SONNET_MODEL } from "../agents/types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// New obligations default here; real destinations are assigned in the dashboard.
const DEFAULT_ONCHAIN_DESTINATION = "0xa54dad10836b82667d2e357b01df5944ebe0d624";

export type ObligationType = "percentage" | "fixed";
export type Cadence = "monthly" | "biweekly" | "weekly" | "per_paycheck" | "none";

// What Sonnet is asked to produce, per obligation.
export interface ProposedObligation {
  name: string;
  type: ObligationType;
  // For percentage: the human number the user said (10 for "10%").
  // For fixed: the dollar amount (450 for "$450").
  amount: number | null;
  cadence: Cadence;
  due_day: number | null; // day of month 1–31, or null
}

// A validated, insert-ready obligation row (destinations defaulted).
export interface ValidatedObligation {
  name: string;
  type: ObligationType;
  amount: number | null;      // percentage stored as DECIMAL (0.1), fixed as-is
  destination_type: "onchain";
  destination_address: string;
  due_recurrence: Cadence;
  due_date: number | null;
}

export interface ExtractionResult {
  ok: boolean;
  obligations: ValidatedObligation[];
  errors: string[];          // human-readable, for re-prompting
  clarification?: string;    // a question to ask if the input was ambiguous
}

const ALLOWED_CADENCES: Cadence[] = ["monthly", "biweekly", "weekly", "per_paycheck", "none"];

const SYSTEM_PROMPT = `You extract household financial OBLIGATIONS from a user's message for a stewardship agent called Storehouse.

An obligation is something income should be allocated to: a tithe, taxes, savings, a bill, a debt payment, an operating/spending bucket, etc.

For EACH obligation the user describes, output:
- name: short label (e.g. "Tithe", "Rent", "Car Payment")
- type: "percentage" if they express it as a percent of income, "fixed" if a set dollar amount
- amount: the NUMBER they said — for percentage give the percent as a plain number (10 for "10%"); for fixed give the dollars (450 for "$450"). If they describe a remainder/"whatever's left"/"everything else", use type "percentage" and amount null.
- cadence: one of "monthly", "biweekly", "weekly", "per_paycheck", "none"
- due_day: day of the month it's due (1-31) if they mention one, else null

Respond with ONLY a JSON object, no prose, no markdown fences:
{"obligations":[...], "clarification": null}

If the message is too vague to extract anything, return an empty obligations array and put a single specific question in "clarification".`;

/**
 * Ask Sonnet to propose obligations, then validate deterministically.
 */
export async function extractObligations(userMessage: string): Promise<ExtractionResult> {
  let proposed: ProposedObligation[] = [];
  let clarification: string | null = null;

  try {
    const res = await anthropic.messages.create({
      model: CLAUDE_SONNET_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    // Strip accidental fences, then parse.
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    proposed = Array.isArray(parsed.obligations) ? parsed.obligations : [];
    clarification = parsed.clarification ?? null;
  } catch (e) {
    return {
      ok: false,
      obligations: [],
      errors: [`Could not understand that. ${e instanceof Error ? e.message : ""}`.trim()],
    };
  }

  if (proposed.length === 0) {
    return {
      ok: false,
      obligations: [],
      errors: [],
      clarification: clarification ?? "Could you tell me one obligation at a time — for example, \"tithe 10%\" or \"car payment $450 on the 5th\"?",
    };
  }

  // ---- Deterministic validation. The LLM's numbers are proposals only. ----
  const validated: ValidatedObligation[] = [];
  const errors: string[] = [];
  const seenNames = new Set<string>();

  for (const p of proposed) {
    const label = (p.name ?? "").trim();
    if (!label) {
      errors.push("An obligation was missing a name.");
      continue;
    }
    if (seenNames.has(label.toLowerCase())) {
      errors.push(`"${label}" was mentioned more than once.`);
      continue;
    }

    if (p.type !== "percentage" && p.type !== "fixed") {
      errors.push(`"${label}": couldn't tell if that's a percentage or a fixed amount.`);
      continue;
    }

    const cadence: Cadence = ALLOWED_CADENCES.includes(p.cadence) ? p.cadence : "none";

    // due_day sanity
    let dueDay: number | null = null;
    if (p.due_day !== null && p.due_day !== undefined) {
      const d = Number(p.due_day);
      if (!Number.isInteger(d) || d < 1 || d > 31) {
        errors.push(`"${label}": "${p.due_day}" isn't a valid day of the month.`);
        continue;
      }
      dueDay = d;
    }

    // Amount handling — three shapes: percentage (→decimal), fixed (→dollars), remainder (→null)
    let amount: number | null;
    if (p.amount === null || p.amount === undefined) {
      // Only valid as a percentage remainder (like Operating).
      if (p.type !== "percentage") {
        errors.push(`"${label}": a fixed obligation needs an amount.`);
        continue;
      }
      amount = null;
    } else {
      const n = Number(p.amount);
      if (!Number.isFinite(n) || n <= 0) {
        errors.push(`"${label}": "${p.amount}" isn't a valid amount.`);
        continue;
      }
      if (p.type === "percentage") {
        if (n > 100) {
          errors.push(`"${label}": ${n}% is over 100%.`);
          continue;
        }
        amount = n / 100; // STORE AS DECIMAL: 10 -> 0.1, matches schema
      } else {
        amount = n; // fixed dollars, as-is
      }
    }

    seenNames.add(label.toLowerCase());
    validated.push({
      name: label,
      type: p.type,
      amount,
      destination_type: "onchain",
      destination_address: DEFAULT_ONCHAIN_DESTINATION,
      due_recurrence: cadence,
      due_date: dueDay,
    });
  }

  // Guard: total fixed percentages shouldn't exceed 100%.
  const pctTotal = validated
    .filter((o) => o.type === "percentage" && o.amount !== null)
    .reduce((s, o) => s + (o.amount as number), 0);
  if (pctTotal > 1.0001) {
    errors.push(`Those percentages add up to ${Math.round(pctTotal * 100)}%, which is over 100%.`);
    return { ok: false, obligations: [], errors };
  }

  return {
    ok: validated.length > 0 && errors.length === 0,
    obligations: validated,
    errors,
  };
}
