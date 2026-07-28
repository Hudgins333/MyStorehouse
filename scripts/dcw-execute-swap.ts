/**
 * DCW swap execution — USDC -> WETH on Base Sepolia via Uniswap SwapRouter02,
 * signed through the Circle developer-controlled wallet (no local key).
 *
 * exactInputSingle takes a struct; Circle's abiParameters passes it as a nested
 * array of the struct's fields in order. We ESTIMATE first (catches encoding
 * errors without spending), then execute and poll to CONFIRMED.
 *
 * Run: npx tsx scripts/dcw-execute-swap.ts <usdcAmount>
 *   e.g. npx tsx scripts/dcw-execute-swap.ts 3
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const USDC   = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const WETH   = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"; // SwapRouter02
const FEE    = 3000; // 0.30% tier — the deepest in our earlier probing
const WALLET_ADDR = process.env.STOREHOUSE_MAIN_WALLET_ADDRESS as string;

async function main() {
  const amtStr = process.argv[2] || "3";
  const walletId = process.env.STOREHOUSE_MAIN_BASE_WALLET_ID;
  if (!walletId) { console.error("STOREHOUSE_MAIN_BASE_WALLET_ID not set"); process.exit(1); }

  const amountIn = BigInt(Math.round(parseFloat(amtStr) * 1e6)).toString(); // USDC 6dp

  const { initiateDeveloperControlledWalletsClient } = await import(
    "@circle-fin/developer-controlled-wallets"
  );
  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY as string,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
  });

  // exactInputSingle struct fields, in ABI order. amountOutMinimum 0 for
  // testnet (thin pools); production would set a slippage floor.
  const params = [
    USDC,           // tokenIn
    WETH,           // tokenOut
    FEE,            // fee
    WALLET_ADDR,    // recipient
    amountIn,       // amountIn
    "0",            // amountOutMinimum
    "0",            // sqrtPriceLimitX96
  ];

  const sig = "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))";

  console.log(`DCW swap: ${amtStr} USDC -> WETH via SwapRouter02`);
  console.log("wallet:", walletId, "\n");

  // 1. Estimate first — catches struct-encoding errors before spending.
  console.log("estimating (validates encoding)...");
  try {
    const est = await circle.estimateContractExecutionFee({
      walletId,
      contractAddress: ROUTER,
      abiFunctionSignature: sig,
      abiParameters: [params],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    } as any);
    console.log("  estimate ok:", JSON.stringify(est?.data?.medium ?? est?.data, (_k,v)=>typeof v==="bigint"?v.toString():v));
  } catch (e: any) {
    console.error("  ✗ estimate failed — encoding or route issue:");
    console.error("   ", e instanceof Error ? e.message : String(e));
    if (e?.response?.data) console.error("   ", JSON.stringify(e.response.data));
    process.exit(1);
  }

  // 2. Execute.
  console.log("\nexecuting swap...");
  const res = await circle.createContractExecutionTransaction({
    walletId,
    contractAddress: ROUTER,
    abiFunctionSignature: sig,
    abiParameters: [params],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } as any);

  const id = res?.data?.id;
  console.log("submitted — id:", id, "| state:", res?.data?.state);
  if (!id) { console.error("no tx id:", JSON.stringify(res?.data ?? res, null, 2)); process.exit(1); }

  console.log("\npolling...");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const { data } = await circle.getTransaction({ id } as any);
    const s = data?.transaction?.state ?? data?.state;
    const hash = data?.transaction?.txHash ?? data?.txHash;
    console.log(`  [${i}] ${s}${hash ? ` | tx ${hash}` : ""}`);
    if (s === "CONFIRMED" || s === "COMPLETE") {
      console.log("\n✓ SWAP CONFIRMED via DCW. tx:", hash);
      return;
    }
    if (s === "FAILED" || s === "CANCELLED" || s === "DENIED") {
      console.error(`\n✗ ${s}`); console.error(JSON.stringify(data, null, 2)); process.exit(1);
    }
  }
  console.log("\n(still pending — check Circle console)");
}

main().catch((e) => {
  console.error("\n✗ failed:", e instanceof Error ? e.message : String(e));
  if (e?.response?.data) console.error("detail:", JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
