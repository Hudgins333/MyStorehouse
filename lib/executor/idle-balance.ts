/**
 * Idle-balance computation for aggressive buckets.
 *
 * idle = on-chain Arc USDC in the bucket wallet − USDC already live in active
 * lane deployments. The auto-deploy trigger deploys idle when it crosses the
 * threshold. On-chain balance is truth (we bridge real USDC); active
 * deployments come from lane_deployments so we never count deployed funds as
 * available.
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY) as string
);

export const LANE_MIN_USDC = 100;

// A small reserve left in the bucket for Arc gas (Arc uses USDC as gas).
const ARC_GAS_RESERVE_USDC = 1;

/** On-chain USDC balance of an Arc bucket wallet, via Circle (human units). */
async function arcUsdcBalance(walletAddress: string): Promise<number> {
  const key = process.env.CIRCLE_API_KEY as string;
  // Resolve the wallet id from the address.
  const wr = await fetch("https://api.circle.com/v1/w3s/wallets?pageSize=30", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const wj = await wr.json();
  const w = (wj?.data?.wallets ?? []).find(
    (x: any) => x.blockchain === "ARC-TESTNET" && x.address.toLowerCase() === walletAddress.toLowerCase()
  );
  if (!w) throw new Error(`no Arc wallet for ${walletAddress}`);

  const br = await fetch(`https://api.circle.com/v1/w3s/wallets/${w.id}/balances`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const bj = await br.json();
  // Prefer the 6-decimal ERC20 USDC representation (matches Base/CCTP units).
  const balances = bj?.data?.tokenBalances ?? [];
  const usdc = balances.find(
    (b: any) => b.token?.symbol === "USDC" && b.token?.decimals === 6
  ) ?? balances.find((b: any) => b.token?.symbol === "USDC");
  return usdc ? parseFloat(usdc.amount) : 0;
}

/** USDC currently live in active deployments for an obligation. */
async function deployedUsdc(obligationId: string): Promise<number> {
  const { data } = await supabase
    .from("lane_deployments")
    .select("amount_usdc")
    .eq("obligation_id", obligationId)
    .in("status", ["pending", "active"]); // pending counts too — in flight
  return (data ?? []).reduce((s, r: any) => s + Number(r.amount_usdc), 0);
}

export interface IdleBalance {
  obligationId: string;
  name: string;
  onChainUsdc: number;
  deployedUsdc: number;
  idleUsdc: number;
  deployable: boolean;         // idle ≥ threshold
  deployAmount: number;        // what we'd actually deploy (idle − gas reserve)
}

/** Compute idle balance for one obligation row. */
export async function computeIdleBalance(ob: {
  id: string; name: string; destination_address: string;
}): Promise<IdleBalance> {
  const onChain = await arcUsdcBalance(ob.destination_address);
  const deployed = await deployedUsdc(ob.id);
  const idle = Math.max(0, onChain - deployed);
  const deployAmount = Math.max(0, idle - ARC_GAS_RESERVE_USDC);
  return {
    obligationId: ob.id,
    name: ob.name,
    onChainUsdc: onChain,
    deployedUsdc: deployed,
    idleUsdc: idle,
    deployable: idle >= LANE_MIN_USDC,
    deployAmount,
  };
}
