/**
 * Storehouse — Savings swap step
 *
 * After a savings-obligation transfer confirms, converts HALF of that deposit
 * from USDC to EURC via Arc App Kit Swap, signing through the Circle
 * developer-controlled savings wallet. The other half stays liquid as USDC.
 *
 * Safety model: this runs ONLY after the savings transfer is confirmed and the
 * bucket credited — the principal is already safe. A failed swap leaves the
 * full amount as USDC (status='failed', logged); there is no rollback because
 * nothing was ever at risk. Never throws (runs fire-and-forget from the
 * webhook confirmation handler).
 *
 * Target asset is cirBTC per the product thesis, but USDC<->cirBTC has no route
 * on Arc Testnet yet (331001). EURC is the v1 routable target; swapping to
 * cirBTC later is a one-line tokenOut change once Circle enables the route.
 */

import { AppKit } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { supabaseAdminClient } from "../supabase/admin-client";

// The savings obligation — only this obligation's confirmed transfers swap.
const SAVINGS_OBLIGATION_ID = "de1c6c24-3e66-4738-a7d7-4cc6e7d4e3d4";
const SAVINGS_ADDRESS = "0x93f1e2d244b2005354674949e7c56bd2606fe6d3";

const TOKEN_IN = "USDC";
const TOKEN_OUT = "EURC"; // cirBTC once routable on Arc Testnet

interface TransferRow {
  id: string;
  obligation_id: string;
  amount: number | string;
  circle_transaction_id?: string;
}

/**
 * Swaps half of a confirmed savings transfer from USDC to EURC.
 * No-ops for non-savings transfers. Never throws.
 */
export async function swapSavingsHalf(transfer: TransferRow): Promise<void> {
  const tag = `[swap ${transfer.id.slice(0, 8)}]`;

  // Guard: only the savings obligation swaps.
  if (transfer.obligation_id !== SAVINGS_OBLIGATION_ID) {
    return;
  }

  // Half the deposit, floored to 6 decimals (USDC precision).
  const full = parseFloat(String(transfer.amount));
  if (!Number.isFinite(full) || full <= 0) {
    console.warn(`${tag} invalid transfer amount ${transfer.amount}, skipping swap`);
    return;
  }
  const amountIn = (Math.floor((full / 2) * 1e6) / 1e6).toFixed(6);

  if (parseFloat(amountIn) <= 0) {
    console.log(`${tag} half of ${full} rounds to 0, skipping swap`);
    return;
  }

  // Log the attempt up front (pending).
  const { data: swapRow, error: insertErr } = await supabaseAdminClient
    .from("swaps")
    .insert({
      transfer_id: transfer.id,
      obligation_id: transfer.obligation_id,
      token_in: TOKEN_IN,
      token_out: TOKEN_OUT,
      amount_in: amountIn,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertErr || !swapRow) {
    console.error(`${tag} failed to insert swap row:`, insertErr?.message);
    return;
  }
  const swapId = swapRow.id;

  console.log(`${tag} swapping ${amountIn} ${TOKEN_IN} -> ${TOKEN_OUT} (savings)`);

  try {
    const adapter = createCircleWalletsAdapter({
      apiKey: process.env.CIRCLE_API_KEY as string,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
    });
    const kit = new AppKit();

    const result = await kit.swap({
      from: { adapter, chain: "Arc_Testnet", address: SAVINGS_ADDRESS },
      tokenIn: TOKEN_IN,
      tokenOut: TOKEN_OUT,
      amountIn,
      config: { kitKey: process.env.KIT_KEY as string },
    });

    await supabaseAdminClient
      .from("swaps")
      .update({
        status: "executed",
        amount_out: result.amountOut ?? null,
        tx_hash: result.txHash ?? null,
        executed_at: new Date().toISOString(),
      })
      .eq("id", swapId);

    console.log(
      `${tag} ✓ swapped ${amountIn} ${TOKEN_IN} -> ${result.amountOut ?? "?"} ${TOKEN_OUT} (tx ${(result.txHash ?? "").slice(0, 10)}...)`
    );
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await supabaseAdminClient
      .from("swaps")
      .update({ status: "failed", error_reason: reason })
      .eq("id", swapId);
    // Funds remain as USDC in the savings wallet — safe, liquid, logged.
    console.warn(`${tag} ✗ swap failed (funds stay USDC): ${reason}`);
  }
}
