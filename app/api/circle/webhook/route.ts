/**
 * Storehouse — Circle webhook handler
 *
 * Receives Circle transaction notifications and creates income_events rows
 * for inbound USDC transfers to storehouse-main. The webhook handler is a
 * receiver only — it captures events and returns 200 immediately. Agent
 * classification and routing happen asynchronously.
 *
 * Circle webhook flow:
 *   1. Circle POSTs a signed notification to this endpoint
 *   2. We verify the signature against Circle's public key
 *   3. If it's an inbound USDC transfer to storehouse-main → create income_event
 *   4. Return 200 immediately (Circle retries on non-200)
 *
 * Supported notification types:
 *   - transactions.inbound   → creates income_event with status 'pending'
 *   - transactions.outbound  → ignored (handled by executor polling)
 *   - webhooks.test          → acknowledged, no DB write
 *
 * See docs-planning/SPEC.md Section 6 for the income_events schema.
 */

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdminClient } from "@/lib/supabase/admin-client";

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
 * Creates an income_event row with status 'pending' for the routing agent
 * to pick up and classify.
 *
 * Returns early (no DB write) if:
 *   - The transfer is not to storehouse-main
 *   - The amounts array is empty or zero
 *   - We've already processed this tx_hash (dedupe)
 */
async function handleInboundTransfer(
  notification: CircleNotification
): Promise<void> {
  const mainWalletId = process.env.STOREHOUSE_MAIN_WALLET_ID;
  const mainWalletAddress = process.env.STOREHOUSE_MAIN_WALLET_ADDRESS;

  if (!mainWalletId || !mainWalletAddress) {
    console.error(
      "STOREHOUSE_MAIN_WALLET_ID or STOREHOUSE_MAIN_WALLET_ADDRESS not set in env"
    );
    return;
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
    return;
  }

  // Extract amount from Circle's amounts array (index 0 is the transfer amount)
  const rawAmount = notification.amounts?.[0];
  if (!rawAmount) {
    console.warn("Webhook: inbound transfer has no amounts, ignoring");
    return;
  }

  // Circle amounts are in the token's smallest unit (USDC = 6 decimals)
  // Convert to human-readable USDC amount
  const amountUsdc = (parseFloat(rawAmount) / 1_000_000).toString();

  if (parseFloat(amountUsdc) <= 0) {
    console.warn(`Webhook: zero-amount transfer, ignoring`);
    return;
  }

  const txHash = notification.txHash;
  if (!txHash) {
    console.warn("Webhook: inbound transfer has no txHash, ignoring");
    return;
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
    return;
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
    return;
  }

  console.log(
    `✓ income_event created: id=${incomeEvent.id} amount=${amountUsdc} USDC chain=${sourceChain} cctp=${cctpRequired}`
  );
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get("x-circle-signature");
    const keyId = req.headers.get("x-circle-key-id");

    if (!signature || !keyId) {
      return NextResponse.json(
        { error: "Missing signature or keyId in headers" },
        { status: 400 }
      );
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

    // Handle inbound transfers — these become income_events
    if (
      notificationType === "transactions.inbound" ||
      (notificationType === "transactions" && notification.state === "COMPLETE")
    ) {
      await handleInboundTransfer(notification);
    }

    // Outbound transfers (routing agent's transfers firing) — no action needed
    // here; the executor polls Circle directly for status updates.
    if (notificationType === "transactions.outbound") {
      console.log(
        `Outbound transfer notification: id=${notification.id} state=${notification.state} — handled by executor`
      );
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
// HEAD handler — Circle pings this to verify endpoint liveness
// ---------------------------------------------------------------------------

export async function HEAD() {
  return NextResponse.json({}, { status: 200 });
}
