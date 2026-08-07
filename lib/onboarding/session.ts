/**
 * Onboarding session handler — the conversation orchestration layer.
 *
 * Drives the state machine (idle → collecting → confirming → complete) over
 * the onboarding_sessions table, accumulating validated obligations across
 * turns and committing to the obligations table only on explicit confirmation.
 *
 * The 'risk' state is reserved for the later risk-appetite pass and is not
 * entered by this handler yet.
 *
 * See SPEC-telegram-addendum.md §11.4.
 */
import { createClient } from "@supabase/supabase-js";
import { extractObligations, type ValidatedObligation } from "./extract";
import { generateCaution } from "./risk-caution";
import { tierProfile, type RiskTier } from "./risk-template";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY) as string
);

type SessionState = "idle" | "collecting" | "confirming" | "risk" | "complete";

interface RiskProgress {
  queue: string[];              // obligation ids still to ask about
  currentId: string | null;     // bucket currently being asked
  currentName: string | null;
  pendingTier: RiskTier | null; // tier awaiting a yes/no consent
  pendingCaution: string | null;// exact caution shown (logged verbatim on yes)
}

interface Session {
  id: string;
  telegram_user_id: number;
  state: SessionState;
  partial_obligations: ValidatedObligation[];
  last_update_id: number | null;
  risk_progress: RiskProgress | null;
}

// A bucket is risk-eligible if it accumulates and holds value — savings-like.
// Everything else (tax escrow, tithe, fixed bills, operating remainder) stays
// conservative by design; this also enforces the tax-escrow liquidity rule at
// the conversation layer, since escrow is never offered a riskier lane.
function isRiskEligible(name: string): boolean {
  return /sav|nest ?egg|invest|growth|rainy ?day|emergency/i.test(name);
}

// Intent keywords (kept deterministic; not LLM-judged).
const DONE_WORDS = /^\s*(done|finish|finished|that'?s all|that is all|complete|no more|nothing else)\s*$/i;
const YES_WORDS = /^\s*(yes|yep|yeah|yup|correct|confirm|confirmed|looks good|save|do it|ok|okay)\s*$/i;
const NO_WORDS = /^\s*(no|nope|wait|change|edit|not quite|incorrect)\s*$/i;
const RESET_WORDS = /^\s*(start over|restart|reset|scratch that|never mind|nevermind)\s*$/i;
const GREETING_WORDS = /^\s*(\/start|hi|hii|hey|hello|hiya|yo|how does this work|how do i (start|begin)|what is this|get started|start)\s*[!.?]*\s*$/i;

/** Load the user's active session, or create a fresh idle one. */
async function getOrCreateSession(userId: number): Promise<Session> {
  const { data } = await supabase
    .from("onboarding_sessions")
    .select("*")
    .eq("telegram_user_id", userId)
    .neq("state", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) {
    return {
      id: data.id,
      telegram_user_id: data.telegram_user_id,
      state: data.state,
      partial_obligations: (data.partial_obligations as ValidatedObligation[]) ?? [],
      last_update_id: data.last_update_id,
      risk_progress: (data.risk_progress as RiskProgress | null) ?? null,
    };
  }

  const { data: created, error } = await supabase
    .from("onboarding_sessions")
    .insert({ telegram_user_id: userId, state: "idle", partial_obligations: [] })
    .select("*")
    .single();

  if (error || !created) throw new Error(`could not create session: ${error?.message}`);
  return {
    id: created.id,
    telegram_user_id: created.telegram_user_id,
    state: created.state,
    partial_obligations: [],
    last_update_id: null,
    risk_progress: null,
  };
}

async function saveSession(
  id: string,
  patch: Partial<{ state: SessionState; partial_obligations: ValidatedObligation[]; last_update_id: number; completed_at: string; risk_progress: RiskProgress | null }>
): Promise<void> {
  await supabase
    .from("onboarding_sessions")
    .update({ ...patch, last_message_at: new Date().toISOString() })
    .eq("id", id);
}

function formatObligation(o: ValidatedObligation): string {
  const amt =
    o.amount === null
      ? "the remainder"
      : o.type === "percentage"
        ? `${Math.round(o.amount * 100)}%`
        : `$${o.amount.toFixed(2)}`;
  const when = o.due_date ? ` (due day ${o.due_date})` : "";
  return `${o.name} — ${amt}${when}`;
}

function reviewSummary(obligations: ValidatedObligation[]): string {
  const lines = obligations.map((o, i) => `${i + 1}. ${formatObligation(o)}`);
  return (
    "Here's what I have so far:\n\n" +
    lines.join("\n") +
    "\n\nShould I save these? (yes / no / start over)"
  );
}

// Convert a day-of-month (1-31) to the next occurrence as a YYYY-MM-DD date.
// The obligations.due_date column is a DATE, but onboarding captures a
// day-of-month; convert at the DB boundary. Clamps to the month's last day.
function dayOfMonthToDate(day: number | null): string | null {
  if (day === null || day === undefined) return null;
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed
  const daysInMonth = (yy: number, mm: number) => new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  // This month first; if that day already passed, roll to next month.
  let ty = y, tm = m;
  const clampThis = Math.min(day, daysInMonth(ty, tm));
  const candidate = new Date(Date.UTC(ty, tm, clampThis));
  if (candidate < new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))) {
    tm = m + 1;
    if (tm > 11) { tm = 0; ty = y + 1; }
  }
  const clamped = Math.min(day, daysInMonth(ty, tm));
  const mm = String(tm + 1).padStart(2, "0");
  const dd = String(clamped).padStart(2, "0");
  return `${ty}-${mm}-${dd}`;
}

/**
 * Commit staged obligations to the obligations table, appending by priority.
 * Skips any whose name already exists (the table has a unique name constraint);
 * returns how many were inserted and which names were skipped.
 */
async function commitObligations(
  obligations: ValidatedObligation[]
): Promise<{ inserted: number; skipped: string[] }> {
  if (obligations.length === 0) return { inserted: 0, skipped: [] };

  // Filter out names that already exist — the table enforces unique names.
  const { data: existing } = await supabase.from("obligations").select("name");
  const existingNames = new Set((existing ?? []).map((r: any) => String(r.name).toLowerCase()));

  const toInsert = obligations.filter((o) => !existingNames.has(o.name.toLowerCase()));
  const skipped = obligations
    .filter((o) => existingNames.has(o.name.toLowerCase()))
    .map((o) => o.name);

  if (toInsert.length === 0) return { inserted: 0, skipped };

  const { data: maxRow } = await supabase
    .from("obligations")
    .select("priority")
    .order("priority", { ascending: false })
    .limit(1)
    .maybeSingle();

  let priority = (maxRow?.priority ?? 0) + 1;

  const rows = toInsert.map((o) => ({
    name: o.name,
    type: o.type,
    amount: o.amount,
    destination_address: o.destination_address,
    destination_label: o.name,
    destination_type: o.destination_type,
    due_date: dayOfMonthToDate(o.due_date),
    due_recurrence: o.due_recurrence === "none" ? null : o.due_recurrence,
    priority: priority++,
    active: true,
    current_period_filled: 0,
  }));

  // Insert obligations and get their generated ids back so we can create
  // a matching bucket for each. Every obligation needs a bucket — the routing
  // executor credits buckets on confirmation, and confirm_transfer raises if
  // an obligation has none. Creating the bucket here, at obligation creation,
  // is the correct home for it (previously buckets were seeded out-of-band,
  // which meant a fresh onboard produced obligations that could never be
  // credited).
  const { data: insertedRows, error } = await supabase
    .from("obligations")
    .insert(rows)
    .select("id, name, destination_address");
  if (error) throw new Error(`commit failed: ${error.message}`);

  // Create one bucket per newly-inserted obligation. Idempotent-ish: skip any
  // obligation that somehow already has a bucket (unique constraint on
  // obligation_id would reject a duplicate anyway).
  if (insertedRows && insertedRows.length > 0) {
    const { data: existingBuckets } = await supabase
      .from("buckets")
      .select("obligation_id")
      .in("obligation_id", insertedRows.map((r: any) => r.id));
    const haveBucket = new Set((existingBuckets ?? []).map((b: any) => b.obligation_id));
    const bucketRows = insertedRows
      .filter((r: any) => !haveBucket.has(r.id))
      .map((r: any) => ({
        name: r.name,
        obligation_id: r.id,
        wallet_address: r.destination_address,
        current_balance: 0,
      }));
    if (bucketRows.length > 0) {
      const { error: bucketErr } = await supabase.from("buckets").insert(bucketRows);
      if (bucketErr) throw new Error(`bucket creation failed: ${bucketErr.message}`);
    }
  }

  return { inserted: rows.length, skipped };
}

// Set a bucket's risk tier, and (for consent tiers) log the exact caution shown.
async function applyTier(
  obligationId: string,
  tier: RiskTier,
  cautionText: string | null,
  userId: number
): Promise<void> {
  await supabase.from("obligations").update({ risk_tier: tier }).eq("id", obligationId);
  if (tier !== "conservative" && cautionText) {
    await supabase.from("risk_consents").insert({
      obligation_id: obligationId,
      telegram_user_id: userId,
      risk_tier: tier,
      caution_text: cautionText,
    });
  }
}

// Prompt text offering the three blended choices for a bucket.
function riskChoicePrompt(bucketName: string): string {
  const safe = tierProfile("conservative");
  const mod = tierProfile("moderate");
  const agg = tierProfile("aggressive");
  return (
    `Now, how should Storehouse handle your "${bucketName}"?\n\n` +
    `1. ${safe.label} — ${safe.oneLine}\n` +
    `2. ${mod.label} — ${mod.oneLine}\n` +
    `3. ${agg.label} — ${agg.oneLine}\n\n` +
    `Reply 1, 2, or 3.`
  );
}

// Build the risk queue from just-saved obligations; returns the first prompt
// or null if no bucket is risk-eligible.
async function beginRiskPhase(sessionId: string, updateId: number): Promise<string | null> {
  const { data: obs } = await supabase
    .from("obligations")
    .select("id,name")
    .order("priority");
  const eligible = (obs ?? []).filter((o: any) => isRiskEligible(o.name));
  if (eligible.length === 0) return null;

  const queue = eligible.map((o: any) => o.id);
  const first = eligible[0];
  const progress: RiskProgress = {
    queue: queue.slice(1),
    currentId: first.id,
    currentName: first.name,
    pendingTier: null,
    pendingCaution: null,
  };
  await saveSession(sessionId, { state: "risk", risk_progress: progress, last_update_id: updateId });
  return riskChoicePrompt(first.name);
}

// Advance to the next bucket in the queue, or finish.
async function nextRiskBucket(
  sessionId: string,
  progress: RiskProgress,
  updateId: number,
  preamble: string
): Promise<string> {
  if (progress.queue.length === 0) {
    await saveSession(sessionId, {
      state: "complete",
      risk_progress: null,
      last_update_id: updateId,
      completed_at: new Date().toISOString(),
    });
    return preamble + depositAddressLine();
  }
  const { data: next } = await supabase
    .from("obligations")
    .select("id,name")
    .eq("id", progress.queue[0])
    .single();
  const newProgress: RiskProgress = {
    queue: progress.queue.slice(1),
    currentId: next!.id,
    currentName: next!.name,
    pendingTier: null,
    pendingCaution: null,
  };
  await saveSession(sessionId, { risk_progress: newProgress, last_update_id: updateId });
  return preamble + riskChoicePrompt(next!.name);
}

// Closing line: tell the user where to send income. Address from env so it's
// always correct. This closes the onboarding loop — setup -> deposit address.
function depositAddressLine(): string {
  const addr = process.env.STOREHOUSE_MAIN_WALLET_ADDRESS || "";
  if (!addr) return "You're all set. Storehouse will steward your income across these obligations.";
  return (
    "You're all set. \u{2705}\n\n" +
    "Here's your Storehouse address \u2014 send your USDC here and I'll steward it across your obligations automatically:\n\n" +
    "`" + addr + "`"
  );
}

/**
 * Main entry: given a user id, their message, and the Telegram update id,
 * advance the conversation and return the bot's reply text.
 */
export async function handleOnboardingMessage(
  userId: number,
  text: string,
  updateId: number
): Promise<string> {
  const session = await getOrCreateSession(userId);

  // Dedup: Telegram redelivers on non-200. Ignore updates we've processed.
  if (session.last_update_id !== null && updateId <= session.last_update_id) {
    return ""; // already handled; empty reply = no re-send
  }

  const staged = session.partial_obligations;
  const trimmed = text.trim();

  // Greeting / first contact — welcome the user before any onboarding.
  // Only greet when nothing is staged yet, so a mid-flow "hi" doesn't reset.
  if (GREETING_WORDS.test(trimmed) && staged.length === 0) {
    await saveSession(session.id, { state: "collecting", last_update_id: updateId });
    return (
      "Welcome to Storehouse. \u{1F3DB}\uFE0F\n\n" +
      "I help you steward your income \u2014 setting apart what matters before it can be spent.\n\n" +
      "Just tell me your obligations, one at a time. For example:\n" +
      "\u2022 \"rent $1,200 on the 1st\"\n" +
      "\u2022 \"set aside 20% for taxes\"\n" +
      "\u2022 \"emergency fund 5%\"\n\n" +
      "When you're done, say \"done\" and I'll show you the plan. Let's begin \u2014 what's your first?"
    );
  }

  // Global: start over from any state.
  if (RESET_WORDS.test(trimmed)) {
    await saveSession(session.id, { state: "collecting", partial_obligations: [], last_update_id: updateId });
    return "Okay, cleared. Tell me your first obligation — for example, \"tithe 10%\" or \"rent $1200 on the 1st.\"";
  }

  // ---- RISK: per-bucket tier selection + consent ----
  if (session.state === "risk" && session.risk_progress) {
    const rp = session.risk_progress;

    // (a) A consent caution is pending — expect yes / no.
    if (rp.pendingTier && rp.pendingCaution) {
      if (YES_WORDS.test(trimmed)) {
        await applyTier(rp.currentId!, rp.pendingTier, rp.pendingCaution, userId);
        const label = tierProfile(rp.pendingTier).label;
        return await nextRiskBucket(session.id, rp, updateId, `Set "${rp.currentName}" to ${label}. `);
      }
      if (NO_WORDS.test(trimmed)) {
        // Back out to the choice for the same bucket.
        const cleared: typeof rp = { ...rp, pendingTier: null, pendingCaution: null };
        await saveSession(session.id, { risk_progress: cleared, last_update_id: updateId });
        return "No problem. " + riskChoicePrompt(rp.currentName!);
      }
      return `Just to confirm "${rp.currentName}" as ${tierProfile(rp.pendingTier).label} — reply "yes" to proceed, or "no" to pick differently.`;
    }

    // (b) Expecting a tier choice: 1, 2, or 3.
    const choice = trimmed.match(/^\s*([123])/)?.[1];
    if (!choice) {
      return "Please reply 1, 2, or 3.\n\n" + riskChoicePrompt(rp.currentName!);
    }
    const tier: RiskTier = choice === "1" ? "conservative" : choice === "2" ? "moderate" : "aggressive";

    if (tier === "conservative") {
      await applyTier(rp.currentId!, "conservative", null, userId);
      return await nextRiskBucket(session.id, rp, updateId, `Set "${rp.currentName}" to Keep it safe. `);
    }

    // Consent tier: generate + show the validated caution, wait for yes.
    const caution = await generateCaution(tier, rp.currentName!);
    const pending: typeof rp = { ...rp, pendingTier: tier, pendingCaution: caution };
    await saveSession(session.id, { risk_progress: pending, last_update_id: updateId });
    return caution;
  }

  // ---- CONFIRMING: waiting for yes/no on the review ----
  if (session.state === "confirming") {
    if (YES_WORDS.test(trimmed)) {
      try {
        const { inserted, skipped } = await commitObligations(staged);
        let msg = inserted > 0
          ? `Saved ${inserted} obligation${inserted === 1 ? "" : "s"}. `
          : "Nothing new to save. ";
        if (skipped.length) {
          msg += `${inserted > 0 ? "Skipped" : "You already have"} ${skipped.join(", ")} (already set up). `;
        }
        // Move into the risk phase if any saved bucket is risk-eligible.
        const riskPrompt = await beginRiskPhase(session.id, updateId);
        if (riskPrompt) {
          return msg + "\n\n" + riskPrompt;
        }
        // Nothing risk-eligible — complete now.
        await saveSession(session.id, { state: "complete", last_update_id: updateId, completed_at: new Date().toISOString() });
        return msg + "\n\n" + depositAddressLine();
      } catch (e) {
        await saveSession(session.id, { last_update_id: updateId });
        return `Something went wrong saving those: ${e instanceof Error ? e.message : "unknown error"}. Your list is still here — say "yes" to try again.`;
      }
    }
    if (NO_WORDS.test(trimmed)) {
      await saveSession(session.id, { state: "collecting", last_update_id: updateId });
      return "No problem — tell me what to change or add, or say \"start over.\"";
    }
    // Not a clear yes/no — treat as more input to add, then re-confirm.
    // fall through to collecting logic below by not returning here.
  }

  // ---- "done" during collecting → show review ----
  if (DONE_WORDS.test(trimmed)) {
    if (staged.length === 0) {
      await saveSession(session.id, { state: "collecting", last_update_id: updateId });
      return "You haven't added any obligations yet. Tell me one — like \"save 10%\" — or what you'd like Storehouse to manage.";
    }
    await saveSession(session.id, { state: "confirming", last_update_id: updateId });
    return reviewSummary(staged);
  }

  // ---- Otherwise: extract obligations from the message ----
  const result = await extractObligations(trimmed);

  if (!result.ok) {
    await saveSession(session.id, { state: "collecting", last_update_id: updateId });
    if (result.clarification) return result.clarification;
    if (result.errors.length) {
      return "I had trouble with that:\n" + result.errors.map((e) => `• ${e}`).join("\n") + "\n\nWant to try again?";
    }
    return "I didn't catch an obligation there. Try something like \"tithe 10%\" or \"car payment $450 on the 5th.\"";
  }

  // Merge new obligations, skipping duplicates by name (case-insensitive).
  const existingNames = new Set(staged.map((o) => o.name.toLowerCase()));
  const additions = result.obligations.filter((o) => !existingNames.has(o.name.toLowerCase()));
  const skipped = result.obligations.length - additions.length;
  const merged = [...staged, ...additions];

  await saveSession(session.id, {
    state: "collecting",
    partial_obligations: merged,
    last_update_id: updateId,
  });

  const added = additions.map((o) => `• ${formatObligation(o)}`).join("\n");
  let reply = additions.length
    ? `Got it:\n${added}`
    : "";
  if (skipped > 0) reply += `\n(Skipped ${skipped} you'd already mentioned.)`;
  reply += additions.length
    ? `\n\nAnything else? Add another, or say "done" to review.`
    : `You'd already added those. Add another, or say "done" to review.`;

  return reply.trim();
}
