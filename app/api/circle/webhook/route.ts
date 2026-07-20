/**
 * Storehouse — Circle webhook handler
 *
 * Receives Circle transaction notifications. Inbound transfers to
 * storehouse-main become income_events and auto-trigger the pipeline
 * (classify -> route -> execute); outbound transfer confirmations drive the
 * bucket-credit loop via confirm_transfer(). The handler returns 200
 * immediately and runs the pipeline detached.
 *
 * Circle webhook flow:
 *   1. Circle POSTs a signed notification to this endpoint
 *   2. We verify the signature against Circle's public key
 *   3. inbound to storehouse-main  → create income_event, fire pipeline
 *      outbound COMPLETE           → confirm_transfer (mark confirmed, credit bucket)
 *   4. Return 200 immediately (Circle retries on non-200)
 *
 * Supported notification types:
 *   - transactions.inbound   → creates income_event, auto-runs pipeline
 *   - transactions.outbound  → on COMPLETE, confirms transfer + credits bucket
 *   - webhooks.test          → acknowledged, no DB write
 *
 * See docs-planning/SPEC.md Section 6 for the income_events / transfers schema.
 */

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdminClient } from "@/lib/supabase/admin-client";
import { runPipeline } from "@/lib/agents/pipeline";
import { swapSavingsHalf } from "@/lib/agents/swapper";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CircleNotification = {
  id?: string;
  state?: string;
  walletId?: string;
  blockchain?: string;
  amounts?: string[];
  txHash?: string;
  tokenId?: string;
  sourceAddress?: string;
  destinationAddress?: string;
  networkFee?: string;
  [k: string]: unknown;
};

interface CircleWebhookPayload {
  subscriptionId: string;
  notificationId: string;
  notificationType: string;
  notification: CircleNotification;
  timestamp: string;
  version: number;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Chain identifier helpers
// ---------------------------------------------------------------------------

/**
 * Maps Circle's blockchain string (e.g. "ARC-TESTNET") to our source_chain
 * format used in income_events (e.g. "arc-testnet").
 */
function normalizeChain(circleBlockchain: string | undefined): string {
  if (!circleBlockchain) return "unknown";
  return circleBlockchain.toLowerCase().replace(/_/g, "-");
}

/**
 * Returns true if the source chain requires CCTP bridging to Arc.
 * Inbound from ETH-SEPOLIA or BASE-SEPOLIA needs bridging;
 * inbound directly on ARC-TESTNET does not.
 */
function requiresCctp(circleBlockchain: string | undefined): boolean {
  if (!circleBlockchain) return false;
  const chain = circleBlockchain.toUpperCase();
  return chain === "ETH-SEPOLIA" || chain === "BASE-SEPOLIA" || chain === "ETH_SEPOLIA" || chain === "BASE_SEPOLIA";
}

// ---------------------------------------------------------------------------
// Signature verification (kept verbatim from arc-commerce — do not modify)
// ---------------------------------------------------------------------------

async function verifyCircleSignature(
    bodyString: string,
    signature: string,
    keyId: string
): Promise<boolean> {
  try {
    const publicKey = await getCirclePublicKey(keyId);
    const verifier = crypto.createVerify("SHA256");
    verifier.update(bodyString);
    verifier.end();
    const signatureUint8Array = Uint8Array.from(
        Buffer.from(signature, "base64")
    );
    return verifier.verify(publicKey, signatureUint8Array);
  } catch (e) {
    console.error("Signature verification failure:", e);
    return false;
  }
}

async function getCirclePublicKey(keyId: string) {
  if (!process.env.CIRCLE_API_KEY) {
    throw new Error("Circle API key is not set");
  }
  const response = await fetch(
      `https://api.circle.com/v2/notifications/publicKey/${keyId}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${process.env.CIRCLE_API_KEY}`,
        },
      }
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch public key: ${response.statusText}`);
  }
  const data = await response.json();
  const rawPublicKey = data?.data?.publicKey;
  if (typeof rawPublicKey !== "string") {
    throw new Error("Invalid public key format");
  }
  return [
    "-----BEGIN PUBLIC KEY-----",
    ...(rawPublicKey.match(/.{1,64}/g) ?? []),
    "-----END PUBLIC KEY-----",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Income event creation
// ---------------------------------------------------------------------------

/**
 * Handles an inbound USDC transfer notification.
 * Creates an income_event row (status from the cctp flag) for the pipeline
 * to pick up and classify.
 *
 * Returns the new income_event id when the event is ready to route (arrived
 * on Arc, not bridging); returns null when no event was created or when the
 * event still needs CCTP bridging (so the caller does not auto-run the
 * pipeline prematurely).
 */
async function handleInboundTransfer(
    notification: CircleNotification
): Promise<string | null> {
  const mainWalletId = process.env.STOREHOUSE_MAIN_WALLET_ID;
  const mainWalletAddress = process.env.STOREHOUSE_MAIN_WALLET_ADDRESS;

  if (!mainWalletId || !mainWalletAddress) {
    console.error(
        "STOREHOUSE_MAIN_WALLET_ID or STOREHOUSE_MAIN_WALLET_ADDRESS not set in env"
    );
    return null;
  }

  // Filter: only process transfers TO storehouse-main
  const isToMainWallet =
      notification.walletId === mainWalletId ||
      notification.destinationAddress?.toLowerCase() ===
      mainWalletAddress.toLowerCase();

  if (!isToMainWallet) {
    console.log(
        `Webhook: transfer to ${notification.walletId ?? notification.destinationAddress} — not storehouse-main, ignoring`
    );
    return null;
  }

  // Extract amount from Circle's amounts array (index 0 is the transfer amount)
  const rawAmount = notification.amounts?.[0];
  if (!rawAmount) {
    console.warn("Webhook: inbound transfer has no amounts, ignoring");
    return null;
  }

  // Circle amounts are in the token's smallest unit (USDC = 6 decimals)
  // Convert to human-readable USDC amount
  const amountUsdc = parseFloat(rawAmount).toString();

  if (parseFloat(amountUsdc) <= 0) {
    console.warn(`Webhook: zero-amount transfer, ignoring`);
    return null;
  }

  const txHash = notification.txHash;
  if (!txHash) {
    console.warn("Webhook: inbound transfer has no txHash, ignoring");
    return null;
  }

  const sourceChain = normalizeChain(notification.blockchain);
  const cctpRequired = requiresCctp(notification.blockchain);

  // Dedupe: check if we've already created an income_event for this tx
  const { data: existing } = await supabaseAdminClient
      .from("income_events")
      .select("id")
      .eq("source_tx_hash", txHash)
      .maybeSingle();

  if (existing) {
    console.log(
        `Webhook: income_event already exists for tx ${txHash.slice(0, 10)}... — skipping`
    );
    return null;
  }

  // Create the income_event row
  const { data: incomeEvent, error } = await supabaseAdminClient
      .from("income_events")
      .insert({
        source_tx_hash: txHash,
        source_address: notification.sourceAddress ?? "unknown",
        source_chain: sourceChain,
        amount: amountUsdc,
        cctp_required: cctpRequired,
        received_at: new Date().toISOString(),
        status: cctpRequired ? "bridging" : "arrived_on_arc",
      })
      .select("id")
      .single();

  if (error) {
    console.error("Failed to create income_event:", error.message);
    return null;
  }

  console.log(
      `✓ income_event created: id=${incomeEvent.id} amount=${amountUsdc} USDC chain=${sourceChain} cctp=${cctpRequired}`
  );

  // Only auto-run the pipeline for events already on Arc (not awaiting CCTP).
  return cctpRequired ? null : incomeEvent.id;
}

// ---------------------------------------------------------------------------
// Outbound confirmation → bucket credit
// ---------------------------------------------------------------------------

/**
 * Handles an outbound transfer confirmation.
 *
 * notification.id corresponds to transfers.circle_transaction_id (verified
 * against live Circle payloads). On state=COMPLETE, calls confirm_transfer(),
 * which idempotently marks the matching transfers row 'confirmed' and credits
 * its obligation's bucket in a single transaction. Circle re-deliveries are
 * no-ops (the function returns false and moves nothing).
 *
 * On a terminal failure state, marks the transfer 'failed' (never un-crediting
 * an already-confirmed transfer).
 */
async function handleOutboundConfirmation(
    notification: CircleNotification
): Promise<void> {
  const circleTxId = notification.id;
  const state = notification.state;

  if (!circleTxId) {
    console.warn("Webhook: outbound notification has no id, ignoring");
    return;
  }

  // Terminal failure — mark the transfer failed, do not credit.
  if (state === "FAILED" || state === "CANCELLED") {
    const { error } = await supabaseAdminClient
        .from("transfers")
        .update({ status: "failed" })
        .eq("circle_transaction_id", circleTxId)
        .neq("status", "confirmed");
    if (error) {
      console.error(
          `Webhook: failed to mark transfer failed (${circleTxId.slice(0, 8)}...):`,
          error.message
      );
    } else {
      console.log(
          `Webhook: outbound ${circleTxId.slice(0, 8)}... marked failed (state=${state})`
      );
    }
    return;
  }

  // Only confirm on a terminal success state.
  if (state !== "COMPLETE") {
    console.log(
        `Webhook: outbound ${circleTxId.slice(0, 8)}... state=${state}, no action`
    );
    return;
  }

  const txHash = notification.txHash ?? null;

  const { data, error } = await supabaseAdminClient.rpc("confirm_transfer", {
    p_circle_transaction_id: circleTxId,
    p_tx_hash: txHash,
  });

  if (error) {
    console.error(
        `Webhook: confirm_transfer failed for ${circleTxId.slice(0, 8)}...:`,
        error.message
    );
    return;
  }

  if (data === true) {
    console.log(
        `✓ Webhook: transfer ${circleTxId.slice(0, 8)}... confirmed, bucket credited`
    );

    // If this was the savings transfer, swap half USDC -> EURC.
    // Load the transfer row to get its amount + obligation, then fire the
    // swap detached (never blocks the webhook; never throws).
    const { data: transferRow } = await supabaseAdminClient
        .from("transfers")
        .select("id, obligation_id, amount, circle_transaction_id")
        .eq("circle_transaction_id", circleTxId)
        .single();

    if (transferRow) {
      swapSavingsHalf(transferRow).catch((e) => {
        console.error(
            `Savings swap crashed for ${circleTxId.slice(0, 8)}...:`,
            e instanceof Error ? e.message : String(e)
        );
      });
    }
  } else {
    console.log(
        `Webhook: transfer ${circleTxId.slice(0, 8)}... already confirmed (no-op)`
    );
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get("x-circle-signature");
    const keyId = req.headers.get("x-circle-key-id");

    // Connection/liveness probes arrive unsigned. Acknowledge them so the
    // subscription can activate, but do not parse or process the body —
    // nothing unsigned ever reaches the pipeline.
    if (!signature || !keyId) {
      console.log("Circle webhook: unsigned probe acknowledged (not processed)");
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const rawBody = await req.text();
    let body: CircleWebhookPayload;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Verify Circle's signature — reject anything that doesn't verify
    const isVerified = await verifyCircleSignature(rawBody, signature, keyId);
    if (!isVerified) {
      console.warn("Circle webhook: signature verification failed");
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    if (!body.subscriptionId || !body.notificationId || !body.notificationType) {
      return NextResponse.json(
          { error: "Malformed webhook payload — missing required fields" },
          { status: 422 }
      );
    }

    const { notificationType, notification } = body;

    console.log(`Circle webhook: ${notificationType} | notificationId=${body.notificationId}`);

    // Test webhook — Circle sends this when you register a new subscription
    if (notificationType === "webhooks.test") {
      console.log("Received test webhook — endpoint verified successfully");
      return NextResponse.json({ received: true }, { status: 200 });
    }

    if (!notification) {
      return NextResponse.json(
          { error: "Malformed notification payload" },
          { status: 422 }
      );
    }

    // Handle inbound transfers — create income_event and auto-run the pipeline
    if (
        notificationType === "transactions.inbound" ||
        (notificationType === "transactions" && notification.state === "COMPLETE")
    ) {
      const newEventId = await handleInboundTransfer(notification);

      // Fire-and-forget: kick off classify -> route -> execute without blocking
      // the 200. Circle needs a fast ack; the pipeline runs detached and never
      // throws. We intentionally do NOT await this.
      if (newEventId) {
        runPipeline(newEventId).catch((e) => {
          console.error(
              `Pipeline crashed for ${newEventId}:`,
              e instanceof Error ? e.message : String(e)
          );
        });
      }
    }

    // Handle outbound confirmations — mark transfer confirmed + credit bucket
    if (notificationType === "transactions.outbound") {
      await handleOutboundConfirmation(notification);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error("Failed to process Circle webhook:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
        { error: `Failed to process notification: ${message}` },
        { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// GET — liveness probe. Next.js derives HEAD from GET, so this covers both.
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}