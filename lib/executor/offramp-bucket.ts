/**
 * Crossmint offramp integration for the Car Payment fiat leg.
 *
 * Converts a bucket's USDC on Base to USD in a bank account via Crossmint's
 * Orders API. Parallels deployBucket. This is the last rail — the fiat boundary.
 *
 * HONEST STATUS (2026-07): the crypto->fiat WITHDRAWAL is production-gated at
 * Crossmint (offramp is not available on testnets; production requires KYB +
 * sales approval — request sent). This module is built against the CONFIRMED
 * staging Orders API surface (endpoint, auth, lifecycle — all verified live),
 * with:
 *   - VERIFY markers where the offramp-specific request fields need
 *     confirmation against the production offramp schema (unavailable on
 *     staging, so cannot be exercised yet).
 *   - a PRODUCTION_PENDING guard on the actual withdrawal, so the code path is
 *     real and reviewable but cannot move real funds until production access
 *     lands. Storehouse's router already refuses to route to the placeholder
 *     destination; this module is what replaces that placeholder once live.
 *
 * Verified live against staging (2026-07): the integration authenticates,
 * clears the chain gate (staging accepts base-sepolia; mainnet `base` is
 * production-only), and reaches Crossmint's order-SCHEMA validation layer — i.e.
 * the request is well-formed enough that Crossmint negotiates the offramp order
 * structure rather than rejecting auth or chain. The exact offramp lineItems /
 * externalOrder shape and the fiat withdrawal are documented on the
 * production-only offramp surface (onboarding in progress), so they are marked
 * VERIFY and gated rather than guessed.
 *
 * Confirmed against Crossmint docs + a live staging auth test:
 *   - POST {BASE}/api/2022-06-09/orders   (create order)
 *   - GET  {BASE}/api/2022-06-09/orders/:id  (poll status)
 *   - header: X-API-KEY: <server key>       (verified: returns 400 validation,
 *     not 401 — key accepted)
 *   - scopes: orders.create, orders.read
 *   - staging base: https://staging.crossmint.com
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY) as string
);

const CROSSMINT_ENV = (process.env.CROSSMINT_ENV || "staging").toLowerCase();
const CROSSMINT_BASE =
  CROSSMINT_ENV === "production"
    ? "https://www.crossmint.com"
    : "https://staging.crossmint.com";
const ORDERS_URL = `${CROSSMINT_BASE}/api/2022-06-09/orders`;
const SERVER_KEY = () => process.env.CROSSMINT_SERVER_API_KEY as string;

// Base USDC + the wallet the bridged funds land in (Storehouse's Base DCW wallet).
const USDC_BASE = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BASE_ADDR = () => process.env.STOREHOUSE_MAIN_WALLET_ADDRESS as string;

// Offramp is production-only at Crossmint. This flag makes the boundary explicit:
// the module builds the real request and does the on-chain send, but stops short
// of asserting a completed fiat withdrawal unless we're actually in production.
const OFFRAMP_LIVE = CROSSMINT_ENV === "production";

// Crossmint accepts mainnet chain ids only in production; staging expects the
// testnet variant. This lets us exercise real order creation on staging.
const OFFRAMP_CHAIN = OFFRAMP_LIVE ? "base" : "base-sepolia";

interface CrossmintApiResult {
  ok: boolean;
  status: number;
  body: any;
}

async function crossmintPost(url: string, payload: any): Promise<CrossmintApiResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": SERVER_KEY() },
    body: JSON.stringify(payload),
  });
  let body: any = null;
  try { body = await res.json(); } catch { body = await res.text(); }
  return { ok: res.ok, status: res.status, body };
}

async function crossmintGet(url: string): Promise<CrossmintApiResult> {
  const res = await fetch(url, { headers: { "X-API-KEY": SERVER_KEY() } });
  let body: any = null;
  try { body = await res.json(); } catch { body = await res.text(); }
  return { ok: res.ok, status: res.status, body };
}

/**
 * Create the offramp order (sell USDC on Base -> USD to bank).
 *
 * VERIFY: the exact `payment`/`lineItems`/`recipient` shape for an OFFRAMP order
 * differs from the onramp/purchase examples and is only fully documented on the
 * production offramp surface. The structure below follows the Orders API
 * envelope we confirmed; the offramp-specific fields are marked and must be
 * validated against the production schema before going live.
 */
async function createOfframpOrder(usdcAmount: string, receiptEmail: string): Promise<CrossmintApiResult> {
  const payload = {
    // VERIFY: offramp order envelope. Confirmed: Orders API uses `payment`
    // with a chain `method` + `currency`, and a `recipient`. For offramp the
    // recipient is a fiat/bank destination rather than a wallet — exact field
    // names (e.g. bank account locator, cashout currency, rail) TBD against the
    // production offramp schema.
    payment: {
      method: OFFRAMP_CHAIN,      // base (prod) / base-sepolia (staging)
      currency: "usdc",          // selling USDC
      receiptEmail,              // required by Crossmint for KYC determination
      payerAddress: BASE_ADDR(), // the wallet holding the USDC to sell
    },
    // VERIFY: offramp "sell" line item — amount of USDC to convert, and the
    // fiat cashout target (currency + rail + bank account). Production offramp
    // schema defines these; not exercisable on staging.
    lineItems: {
      // e.g. sell instruction: amount + cashout currency + rail (ACH/RTP)
      callData: { totalPrice: usdcAmount }, // VERIFY: offramp amount field
    },
    recipient: {
      email: receiptEmail,       // VERIFY: for offramp, bank/fiat destination
    },
    locale: "en-US",
  };

  return crossmintPost(ORDERS_URL, payload);
}

/** Poll an order to a terminal state. */
async function pollOrder(orderId: string): Promise<CrossmintApiResult> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const res = await crossmintGet(`${ORDERS_URL}/${orderId}`);
    const phase = res.body?.phase ?? res.body?.status;
    if (["completed", "delivery", "failed", "cancelled"].includes(String(phase))) {
      return res;
    }
  }
  throw new Error("offramp order did not reach terminal state in the polling window");
}

/**
 * On-chain leg: send the USDC from Storehouse's Base DCW wallet to the address
 * Crossmint specifies for the order. This reuses the proven DCW transfer
 * primitive — same call as send-from-wallet, pointed at Crossmint's address.
 */
async function sendUsdcToCrossmint(toAddress: string, amount: string): Promise<string> {
  const { initiateDeveloperControlledWalletsClient } = await import(
    "@circle-fin/developer-controlled-wallets"
  );
  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY as string,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
  });
  const res = await circle.createTransaction({
    walletId: process.env.STOREHOUSE_MAIN_BASE_WALLET_ID as string,
    tokenId: process.env.CIRCLE_USDC_TOKEN_ID as string,
    destinationAddress: toAddress,
    amount: [amount],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } as any);
  const txId = res?.data?.id;
  if (!txId) throw new Error("DCW transfer returned no transaction id");
  return txId;
}

export interface OfframpResult {
  obligationId: string;
  bucketName: string;
  amountUsdc: string;
  status: "production_pending" | "order_created" | "sent" | "completed" | "failed";
  orderId?: string;
  detail: string;
}

/**
 * Offramp a bucket's USDC to fiat. Confirms the obligation is the fiat car
 * payment, creates the Crossmint order, and — in production — does the on-chain
 * send and polls to completion. In staging, it exercises the confirmed Orders
 * API surface and stops at the production boundary honestly.
 */
export async function offrampBucket(obligationId: string, amountUsdc: string, receiptEmail: string): Promise<OfframpResult> {
  const { data: ob, error } = await supabase
    .from("obligations")
    .select("id,name,destination_type")
    .eq("id", obligationId)
    .single();
  if (error || !ob) throw new Error(`obligation not found: ${error?.message}`);
  if (ob.destination_type !== "fiat_offramp") {
    throw new Error(`bucket "${ob.name}" is ${ob.destination_type}, not fiat_offramp — refusing to offramp`);
  }

  const base = { obligationId: ob.id, bucketName: ob.name, amountUsdc };

  // Create the order against the confirmed Orders API. This part runs on staging
  // (auth verified); the offramp-specific fields are VERIFY-marked above.
  const created = await createOfframpOrder(amountUsdc, receiptEmail);

  if (!created.ok) {
    // On staging, offramp order creation is expected to be rejected/unsupported
    // (offramp is production-only). We surface that honestly rather than pretend.
    return {
      ...base,
      status: OFFRAMP_LIVE ? "failed" : "production_pending",
      detail:
        `Crossmint order create returned ${created.status}: ` +
        `${JSON.stringify(created.body).slice(0, 200)}. ` +
        (OFFRAMP_LIVE
          ? "Order rejected in production — check offramp order schema."
          : "Offramp is production-gated at Crossmint (not available on testnet). " +
            "Integration is wired against the confirmed Orders API; withdrawal " +
            "activates on production access (request submitted)."),
    };
  }

  const orderId = created.body?.orderId ?? created.body?.id;

  // PRODUCTION_PENDING guard: only perform the real on-chain send + withdrawal
  // when actually in production. In staging we stop here with the order created.
  if (!OFFRAMP_LIVE) {
    return {
      ...base,
      status: "order_created",
      orderId,
      detail: "Order created on staging. On-chain send + fiat withdrawal are " +
        "production-gated and intentionally not executed in staging.",
    };
  }

  // --- Production path (runs only when CROSSMINT_ENV=production) ---
  const status = await pollOrder(orderId); // wait for Crossmint to provide send details
  const toAddress = status.body?.payment?.to ?? status.body?.onchainAddress; // VERIFY field
  const sellAmount = status.body?.sellAmount ?? amountUsdc;                    // VERIFY field
  if (!toAddress) {
    return { ...base, status: "failed", orderId, detail: "no on-chain destination returned by Crossmint" };
  }

  const txId = await sendUsdcToCrossmint(toAddress, sellAmount);
  const finalStatus = await pollOrder(orderId);
  const phase = finalStatus.body?.phase ?? finalStatus.body?.status;

  return {
    ...base,
    status: phase === "completed" ? "completed" : "sent",
    orderId,
    detail: `on-chain send ${txId}; order phase ${phase}`,
  };
}
