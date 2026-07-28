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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY) as string
);

type SessionState = "idle" | "collecting" | "confirming" | "risk" | "complete";

interface Session {
  id: string;
  telegram_user_id: number;
  state: SessionState;
  partial_obligations: ValidatedObligation[];
  last_update_id: number | null;
}

// Intent keywords (kept deterministic; not LLM-judged).
const DONE_WORDS = /^\s*(done|finish|finished|that'?s all|that is all|complete|no more|nothing else)\s*$/i;
const YES_WORDS = /^\s*(yes|yep|yeah|yup|correct|confirm|confirmed|looks good|save|do it|ok|okay)\s*$/i;
const NO_WORDS = /^\s*(no|nope|wait|change|edit|not quite|incorrect)\s*$/i;
const RESET_WORDS = /^\s*(start over|restart|reset|scratch that|never mind|nevermind)\s*$/i;

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
  };
}

async function saveSession(
  id: string,
  patch: Partial<{ state: SessionState; partial_obligations: ValidatedObligation[]; last_update_id: number; completed_at: string }>
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

/** Commit staged obligations to the obligations table, appending by priority. */
async function commitObligations(obligations: ValidatedObligation[]): Promise<number> {
  if (obligations.length === 0) return 0;

  const { data: maxRow } = await supabase
    .from("obligations")
    .select("priority")
    .order("priority", { ascending: false })
    .limit(1)
    .maybeSingle();

  let priority = (maxRow?.priority ?? 0) + 1;

  const rows = obligations.map((o) => ({
    name: o.name,
    type: o.type,
    amount: o.amount,
    destination_address: o.destination_address,
    destination_label: o.name,
    destination_type: o.destination_type,
    due_date: o.due_date,
    due_recurrence: o.due_recurrence === "none" ? null : o.due_recurrence,
    priority: priority++,
    active: true,
    current_period_filled: 0,
  }));

  const { error } = await supabase.from("obligations").insert(rows);
  if (error) throw new Error(`commit failed: ${error.message}`);
  return rows.length;
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

  // Global: start over from any state.
  if (RESET_WORDS.test(trimmed)) {
    await saveSession(session.id, { state: "collecting", partial_obligations: [], last_update_id: updateId });
    return "Okay, cleared. Tell me your first obligation — for example, \"tithe 10%\" or \"rent $1200 on the 1st.\"";
  }

  // ---- CONFIRMING: waiting for yes/no on the review ----
  if (session.state === "confirming") {
    if (YES_WORDS.test(trimmed)) {
      try {
        const n = await commitObligations(staged);
        await saveSession(session.id, { state: "complete", last_update_id: updateId, completed_at: new Date().toISOString() });
        return `Saved ${n} obligation${n === 1 ? "" : "s"}. Storehouse will use these to route your income. To Christ be the Glory.`;
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
