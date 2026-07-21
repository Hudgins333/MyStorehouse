/**
 * PROBE — read the WETH (and USDC) reserve state on Aave V3 Base Sepolia.
 * Confirms each reserve is live and reads its supply APY, straight from chain.
 *
 * Run: npx tsx scripts/aave-weth-probe.ts
 *   (Override RPC: BASE_SEPOLIA_RPC=https://... )
 */
import { createPublicClient, http, getContract } from "viem";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const POOL_ADDRESSES_PROVIDER = "0xd449FeD49d9C443688d6816fE6872F21402e41de";

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
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

function rayToPct(ray: bigint): string {
  return (Number(ray) / 1e27 * 100).toFixed(4);
}

async function main() {
  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  console.log("--- Aave V3 Base Sepolia: all reserves state ---\nRPC:", RPC);

  const provider = getContract({ address: POOL_ADDRESSES_PROVIDER as `0x${string}`, abi: providerAbi, client });
  const poolAddr = await provider.read.getPool();
  const pool = getContract({ address: poolAddr as `0x${string}`, abi: poolAbi, client });
  console.log("Pool:", poolAddr, "\n");

  const reserves = await pool.read.getReservesList();
  for (const token of reserves) {
    const erc20 = getContract({ address: token, abi: erc20Abi, client });
    let sym = "?", dec = 0;
    try { sym = await erc20.read.symbol(); dec = await erc20.read.decimals(); } catch {}
    const d = await pool.read.getReserveData([token]);
    const live = Number(d.lastUpdateTimestamp) > 0;
    console.log(`=== ${sym} (${token}) decimals=${dec} ===`);
    console.log(`  supply APY (approx): ${rayToPct(d.currentLiquidityRate)}%`);
    console.log(`  aToken            : ${d.aTokenAddress}`);
    console.log(`  status            : ${live ? "✓ LIVE (initialized)" : "✗ not initialized"}`);
    console.log("");
  }

  console.log("=== READ FOR ETH LEG ===");
  console.log("If WETH shows LIVE with an aToken, the savings->WETH->Aave yield leg's");
  console.log("DESTINATION is confirmed callable on Base Sepolia. Remaining unknown:");
  console.log("the USDC->WETH swap ROUTE on Base Sepolia (probe next).");
}

main().catch((e) => { console.error("Unhandled:", e); process.exit(1); });
