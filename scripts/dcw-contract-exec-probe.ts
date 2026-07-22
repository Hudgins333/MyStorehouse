/**
 * PROBE — will Circle DCW encode and sign an arbitrary contract call on Base?
 *
 * Estimate only. Moves nothing. If DCW can quote a Uniswap-bound call from the
 * Base Sepolia wallet, the aggressive lane can run entirely through
 * Circle-signed wallets instead of a local private key.
 *
 * Run: npx tsx scripts/dcw-contract-exec-probe.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const NPM  = "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2"; // position manager, verified on-chain

async function main() {
  const walletId = process.env.STOREHOUSE_MAIN_BASE_WALLET_ID;
  if (!walletId) {
    console.error("STOREHOUSE_MAIN_BASE_WALLET_ID not set in .env.local");
    process.exit(1);
  }

  const { initiateDeveloperControlledWalletsClient } = await import(
    "@circle-fin/developer-controlled-wallets"
  );
  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY as string,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
  });

  console.log("--- DCW contract-execution probe (Base Sepolia) ---");
  console.log("wallet:", walletId);
  console.log("call  : USDC.approve(positionManager, 1000000)\n");

  const res = await circle.estimateContractExecutionFee({
    walletId,
    contractAddress: USDC,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [NPM, "1000000"],
  } as any);

  console.log("=== ESTIMATE ===");
  console.log(JSON.stringify(res?.data ?? res, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log("\n✓ DCW can encode and price arbitrary contract calls on Base Sepolia.");
}

main().catch((e) => {
  console.error("\n✗ failed:", e instanceof Error ? e.message : String(e));
  if (e?.response?.data) console.error("detail:", JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
