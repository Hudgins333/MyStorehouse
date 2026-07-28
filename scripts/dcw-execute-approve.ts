/**
 * FIRST REAL DCW CONTRACT EXECUTION on Base Sepolia.
 *
 * Everything Base-side so far used a local throwaway EOA. This executes a real
 * contract call — USDC.approve(positionManager) — through the Circle
 * developer-controlled wallet via createContractExecutionTransaction. No local
 * key. This is the primitive the whole aggressive lane is built on; proving it
 * lands converts "estimated" to "executed".
 *
 * Run: npx tsx scripts/dcw-execute-approve.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const NPM  = "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2";

async function main() {
  const walletId = process.env.STOREHOUSE_MAIN_BASE_WALLET_ID;
  if (!walletId) { console.error("STOREHOUSE_MAIN_BASE_WALLET_ID not set"); process.exit(1); }

  const { initiateDeveloperControlledWalletsClient } = await import(
    "@circle-fin/developer-controlled-wallets"
  );
  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY as string,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
  });

  console.log("executing USDC.approve(positionManager, 1 USDC) via DCW");
  console.log("wallet:", walletId, "\n");

  const res = await circle.createContractExecutionTransaction({
    walletId,
    contractAddress: USDC,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [NPM, "1000000"], // 1 USDC (6 decimals)
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } as any);

  const id = res?.data?.id;
  const state = res?.data?.state;
  console.log("submitted — transaction id:", id, "| initial state:", state);

  if (!id) {
    console.error("no transaction id returned:", JSON.stringify(res?.data ?? res, null, 2));
    process.exit(1);
  }

  // Poll for terminal state.
  console.log("\npolling for confirmation...");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const { data } = await circle.getTransaction({ id } as any);
    const s = data?.transaction?.state ?? data?.state;
    const hash = data?.transaction?.txHash ?? data?.txHash;
    console.log(`  [${i}] state: ${s}${hash ? ` | tx ${hash}` : ""}`);
    if (s === "CONFIRMED" || s === "COMPLETE") {
      console.log("\n✓ DCW CONTRACT EXECUTION CONFIRMED. The primitive works.");
      console.log("tx hash:", hash);
      return;
    }
    if (s === "FAILED" || s === "CANCELLED" || s === "DENIED") {
      console.error(`\n✗ transaction ${s}`);
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }
  }
  console.log("\n(still pending after polling window — check Circle console for final state)");
}

main().catch((e) => {
  console.error("\n✗ failed:", e instanceof Error ? e.message : String(e));
  if (e?.response?.data) console.error("detail:", JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
