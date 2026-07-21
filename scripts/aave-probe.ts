/**
 * PROBE — is Aave V3 live & callable on Base Sepolia with a USDC market,
 * and does it accept the SAME USDC that CCTP/Gateway delivers (Circle USDC)?
 *
 * Reads ground truth directly from on-chain contracts. Trusts no docs/forums.
 *   1. Resolve the Aave Pool from the on-chain PoolAddressesProvider
 *   2. getReservesList() -> exact tokens Aave accepts
 *   3. Read each reserve's symbol -> find USDC
 *   4. Compare Aave's USDC address to Circle's Base Sepolia USDC
 *   5. getReserveData(usdc) -> confirm active + read live supply APY
 *
 * Run: npx tsx scripts/aave-probe.ts
 * (Override RPC with:  BASE_SEPOLIA_RPC=https://... npx tsx scripts/aave-probe.ts )
 */
import { createPublicClient, http, getContract, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";

// Circle's native USDC on Base Sepolia (from Circle App Kit chain data).
// This is the USDC that CCTP / Gateway mint on Base Sepolia.
const CIRCLE_USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// Aave V3 PoolAddressesProvider on Base Sepolia (Aave's canonical registry
// contract; we resolve the Pool FROM it rather than trusting a pasted address).
// If this is wrong, the probe will tell us loudly and we correct it.
const POOL_ADDRESSES_PROVIDER = "0xd449FeD49d9C443688d6816fE6872F21402e41de";

const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";

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
        { name: "currentLiquidityRate", type: "uint128" },   // supply APY (ray)
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
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

// Aave rates are "ray" (1e27). APY% ~= rate / 1e27 * 100 (linear approx of APR).
function rayToPct(ray: bigint): string {
  return (Number(ray) / 1e27 * 100).toFixed(4);
}

async function main() {
  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  console.log("--- Aave V3 Base Sepolia probe ---");
  console.log("RPC:", RPC);

  // 1. Resolve the Pool from the provider (ground truth)
  const provider = getContract({ address: POOL_ADDRESSES_PROVIDER as `0x${string}`, abi: providerAbi, client });
  let poolAddr: string;
  try {
    poolAddr = await provider.read.getPool();
    console.log("Resolved Aave Pool:", poolAddr);
  } catch (e) {
    console.log("\n✗ Could not resolve Pool from PoolAddressesProvider.");
    console.log("  Either the provider address is wrong for Base Sepolia, or Aave isn't deployed here.");
    console.log("  Error:", e instanceof Error ? e.message : String(e));
    return;
  }

  const pool = getContract({ address: poolAddr as `0x${string}`, abi: poolAbi, client });

  // 2. List reserves
  const reserves = await pool.read.getReservesList();
  console.log(`\nAave accepts ${reserves.length} reserves on Base Sepolia.`);

  // 3. Find USDC among them by symbol
  let aaveUsdc: string | null = null;
  for (const token of reserves) {
    try {
      const erc20 = getContract({ address: token, abi: erc20Abi, client });
      const symbol = await erc20.read.symbol();
      const isUsdc = symbol.toUpperCase().includes("USDC");
      console.log(`  ${isUsdc ? "★" : " "} ${symbol.padEnd(8)} ${token}`);
      if (isUsdc && !aaveUsdc) aaveUsdc = token;
    } catch {
      console.log(`    (symbol unreadable) ${token}`);
    }
  }

  // 4. Compare to Circle USDC
  console.log("\n=== VERDICT ===");
  if (!aaveUsdc) {
    console.log("✗ No USDC reserve found in Aave Base Sepolia. Yield-on-Base via Aave is NOT viable as-is.");
    return;
  }
  const match = aaveUsdc.toLowerCase() === CIRCLE_USDC_BASE_SEPOLIA.toLowerCase();
  console.log("Aave's USDC reserve :", aaveUsdc);
  console.log("Circle/CCTP USDC    :", CIRCLE_USDC_BASE_SEPOLIA);
  console.log(match
    ? "✓✓ MATCH — Aave accepts the SAME USDC that CCTP/Gateway deliver. Clean end-to-end path."
    : "⚠ MISMATCH — Aave uses a DIFFERENT USDC than CCTP delivers. Would need a swap on Base, a different testnet, or note as testnet-only quirk (mainnet unifies).");

  // 5. Live reserve state + APY (on Aave's own USDC, which is what matters for the market being live)
  const data = await pool.read.getReserveData([aaveUsdc as `0x${string}`]);
  const supplyApy = rayToPct(data.currentLiquidityRate);
  console.log("\n=== MARKET STATE (Aave's USDC reserve) ===");
  console.log("aToken address     :", data.aTokenAddress);
  console.log("supply APY (approx):", supplyApy + "%");
  console.log("last update ts     :", data.lastUpdateTimestamp);
  console.log(Number(data.lastUpdateTimestamp) > 0
    ? "✓ Reserve is initialized and live."
    : "✗ Reserve looks uninitialized.");
}

main().catch((e) => { console.error("Unhandled:", e); process.exit(1); });
