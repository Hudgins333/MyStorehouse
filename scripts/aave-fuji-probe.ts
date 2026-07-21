/**
 * PROBE — Aave V3 on Avalanche Fuji: is it live, does it have a USDC reserve,
 * and does that USDC match Circle's Fuji USDC (what CCTP/Gateway deliver)?
 * Reads ground truth from chain. Trusts no docs.
 *
 * Run: npx tsx scripts/aave-fuji-probe.ts
 *   (Override RPC: FUJI_RPC=https://... )
 */
import { createPublicClient, http, getContract } from "viem";
import { avalancheFuji } from "viem/chains";

const RPC = process.env.FUJI_RPC || "https://api.avax-test.network/ext/bc/C/rpc";

// Circle's native USDC on Avalanche Fuji (what CCTP/Gateway mint there).
const CIRCLE_USDC_FUJI = "0x5425890298aed601595a70AB815c96711a31Bc65";

// Aave V3 PoolAddressesProvider candidate for Fuji (from Aave testnet list).
const POOL_ADDRESSES_PROVIDER = "0xc4dCB5126a3AfEd129BC3668Ea19285A9f56D15D";

const providerAbi = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const poolAbi = [
  { type: "function", name: "getReservesList", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  {
    type: "function", name: "getReserveData", stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "configuration", type: "uint256" },
        { name: "liquidityIndex", type: "uint128" },
        { name: "currentLiquidityRate", type: "uint128" },
        { name: "variableBorrowIndex", type: "uint128" },
        { name: "currentVariableBorrowRate", type: "uint128" },
        { name: "currentStableBorrowRate", type: "uint128" },
        { name: "lastUpdateTimestamp", type: "uint40" },
        { name: "id", type: "uint16" },
        { name: "aTokenAddress", type: "address" },
        { name: "stableDebtTokenAddress", type: "address" },
        { name: "variableDebtTokenAddress", type: "address" },
        { name: "interestRateStrategyAddress", type: "address" },
        { name: "accruedToTreasury", type: "uint128" },
        { name: "unbacked", type: "uint128" },
        { name: "isolationModeTotalDebt", type: "uint128" },
      ],
    }],
  },
] as const;

const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

const rayToPct = (r: bigint) => (Number(r) / 1e27 * 100).toFixed(4);

async function main() {
  const client = createPublicClient({ chain: avalancheFuji, transport: http(RPC) });
  console.log("--- Aave V3 Avalanche Fuji probe ---\nRPC:", RPC);

  const provider = getContract({ address: POOL_ADDRESSES_PROVIDER as `0x${string}`, abi: providerAbi, client });
  let poolAddr: string;
  try {
    poolAddr = await provider.read.getPool();
    console.log("Resolved Aave Pool:", poolAddr);
  } catch (e) {
    console.log("\n✗ Could not resolve Pool from provider — address wrong for Fuji, or Aave not deployed here.");
    console.log("  Error:", e instanceof Error ? e.message : String(e));
    return;
  }

  const pool = getContract({ address: poolAddr as `0x${string}`, abi: poolAbi, client });
  const reserves = await pool.read.getReservesList();
  console.log(`\nAave Fuji has ${reserves.length} reserves:`);

  let aaveUsdc: string | null = null;
  for (const token of reserves) {
    let sym = "?";
    try { sym = await getContract({ address: token, abi: erc20Abi, client }).read.symbol(); } catch {}
    const isUsdc = sym.toUpperCase().includes("USDC");
    console.log(`  ${isUsdc ? "★" : " "} ${sym.padEnd(8)} ${token}`);
    if (isUsdc && !aaveUsdc) aaveUsdc = token;
  }

  console.log("\n=== VERDICT ===");
  if (!aaveUsdc) { console.log("✗ No USDC reserve on Aave Fuji."); return; }
  const match = aaveUsdc.toLowerCase() === CIRCLE_USDC_FUJI.toLowerCase();
  console.log("Aave Fuji USDC :", aaveUsdc);
  console.log("Circle Fuji USDC:", CIRCLE_USDC_FUJI);
  console.log(match
    ? "✓✓ MATCH — Aave Fuji accepts the SAME USDC that CCTP/Gateway deliver. Clean path."
    : "⚠ MISMATCH — Aave Fuji uses a different USDC than CCTP delivers (swap or note testnet quirk).");

  const d = await pool.read.getReserveData([aaveUsdc as `0x${string}`]);
  console.log("\n=== MARKET STATE ===");
  console.log("aToken            :", d.aTokenAddress);
  console.log("supply APY (approx):", rayToPct(d.currentLiquidityRate) + "%");
  console.log(Number(d.lastUpdateTimestamp) > 0 ? "✓ Reserve live." : "✗ Not initialized.");
}

main().catch((e) => { console.error("Unhandled:", e); process.exit(1); });
