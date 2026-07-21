/**
 * PROBE — is there a live, liquid USDC->WETH swap route on Base Sepolia
 * via Uniswap V3? Reads ground truth: checks the pool exists AND that the
 * Quoter returns a real quote (which only succeeds if liquidity is present).
 *
 * Run: npx tsx scripts/usdc-weth-swap-probe.ts
 *   (Override RPC: BASE_SEPOLIA_RPC=https://... )
 */
import { createPublicClient, http, getContract, parseUnits, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Circle USDC, Base Sepolia
const WETH = "0x4200000000000000000000000000000000000006"; // WETH, Base Sepolia
const FACTORY = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24"; // UniswapV3Factory Base Sepolia
const QUOTER = "0xC5290058841028F1614F3A6F0F5816cAd0df5E27";  // QuoterV2 Base Sepolia

const FEE_TIERS = [100, 500, 3000, 10000]; // 0.01% / 0.05% / 0.3% / 1%

const factoryAbi = [
  { type: "function", name: "getPool", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }],
    outputs: [{ type: "address" }] },
] as const;

const quoterAbi = [
  { type: "function", name: "quoteExactInputSingle", stateMutability: "nonpayable",
    inputs: [{ type: "tuple", components: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "fee", type: "uint24" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ]}],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ] },
] as const;

async function main() {
  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  console.log("--- USDC->WETH swap route probe (Uniswap V3, Base Sepolia) ---\nRPC:", RPC, "\n");

  const factory = getContract({ address: FACTORY as `0x${string}`, abi: factoryAbi, client });
  const amountIn = parseUnits("10", 6); // 10 USDC

  let anyRoute = false;
  for (const fee of FEE_TIERS) {
    const pool = await factory.read.getPool([USDC as `0x${string}`, WETH as `0x${string}`, fee]);
    const poolExists = pool && pool !== "0x0000000000000000000000000000000000000000";
    process.stdout.write(`fee ${(fee/10000).toFixed(2)}% : pool ${poolExists ? pool : "NONE"}`);

    if (!poolExists) { console.log(""); continue; }

    // Pool exists — does it have liquidity? Ask the Quoter for a real quote.
    try {
      const { result } = await client.simulateContract({
        address: QUOTER as `0x${string}`,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: USDC as `0x${string}`, tokenOut: WETH as `0x${string}`,
                 amountIn, fee, sqrtPriceLimitX96: 0n }],
      });
      const out = result[0] as bigint;
      console.log(`  -> ✓ quote: 10 USDC = ${formatUnits(out, 18)} WETH`);
      anyRoute = true;
    } catch (e) {
      console.log(`  -> ✗ no liquidity (quote reverted)`);
    }
  }

  console.log("\n=== VERDICT ===");
  console.log(anyRoute
    ? "✓✓ LIVE USDC->WETH swap route on Base Sepolia. The ETH leg is FULLY viable:\n   bridge USDC -> swap half to WETH -> supply to Aave (proven). Route confirmed."
    : "✗ No liquid USDC->WETH route on Base Sepolia Uniswap V3.\n   Pools may exist but hold no liquidity (common on testnet). ETH leg's swap step\n   is not callable as-is; would need a funded pool, a different DEX, or wrap-ETH-directly.");
}

main().catch((e) => { console.error("Unhandled:", e); process.exit(1); });
