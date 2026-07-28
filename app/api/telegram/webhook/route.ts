/**
 * Telegram onboarding webhook.
 *
 * Security boundary for the onboarding bot. This handler ONLY:
 *   - answers Telegram's liveness probe (GET)
 *   - verifies the secret token Telegram echoes in a header
 *   - gates every update to the single authorized Telegram user
 *   - dedups redelivered updates by update_id
 *
 * Conversation logic lives in the bot handler (added next). Everything here is
 * the gate. We always return 200 so Telegram does not retry-storm; rejection is
 * expressed by silently not acting, plus (for the authorized user) a reply.
 *
 * See SPEC-telegram-addendum.md §11.5–11.7.
 */
import { NextRequest, NextResponse } from "next/server";
import { handleOnboardingMessage } from "@/lib/onboarding/session";

export const dynamic = "force-dynamic";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const AUTHORIZED_USER_ID = process.env.TELEGRAM_AUTHORIZED_USER_ID;

// Minimal Telegram send helper (no SDK; one fetch).
async function sendMessage(chatId: number, text: string): Promise<void> {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) {
    console.error("Telegram sendMessage failed:", e instanceof Error ? e.message : String(e));
  }
}

// GET — liveness. Next derives HEAD from GET.
export async function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}

export async function POST(req: NextRequest) {
  // 1. Verify the secret token Telegram echoes back on every call.
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    console.warn("Telegram webhook: bad or missing secret token — ignoring");
    // Do not reveal anything; just acknowledge so Telegram stops.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const message = update?.message ?? update?.edited_message;
  const fromId = message?.from?.id;
  const chatId = message?.chat?.id;
  const text = message?.text ?? "";
  const updateId = update?.update_id;

  // 2. Authorized-user gate.
  if (!fromId || String(fromId) !== String(AUTHORIZED_USER_ID)) {
    if (chatId) await sendMessage(chatId, "This bot is in private preview.");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // 3. Hand off to the onboarding conversation handler. It manages session
  //    state, dedups by update_id, and returns the reply text (or "" to send
  //    nothing, e.g. a duplicate redelivery).
  console.log(`Telegram: authorized update ${updateId} from ${fromId}: ${text.slice(0, 80)}`);

  try {
    const reply = await handleOnboardingMessage(Number(fromId), text, Number(updateId));
    if (reply) await sendMessage(chatId, reply);
  } catch (e) {
    console.error("onboarding handler error:", e instanceof Error ? e.message : String(e));
    await sendMessage(chatId, "Something went wrong on my end. Please try that again.");
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
