/**
 * Create a Base Sepolia wallet in the existing Storehouse wallet set.
 *
 * Circle scopes a wallet record to one blockchain, so the Arc Testnet wallets
 * cannot receive bridged USDC on Base. These are EOA wallets, so the same key
 * should derive the same address on every EVM chain — this verifies that.
 *
 * Run: npx tsx scripts/create-base-wallet.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const WALLET_SET_ID = "6b55676f-9359-5f49-bf4a-59ce8438f926";

async function main() {
  const { initiateDeveloperControlledWalletsClient } = await import(
    "@circle-fin/developer-controlled-wallets"
  );

  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY as string,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
  });

  console.log("creating 1 BASE-SEPOLIA wallet in set", WALLET_SET_ID, "\n");

  const res = await circle.createWallets({
    walletSetId: WALLET_SET_ID,
    blockchains: ["BASE-SEPOLIA"] as any,
    accountType: "EOA",
    count: 1,
    metadata: [{ name: "storehouse-main-base" }],
  } as any);

  const wallets = res?.data?.wallets ?? [];
  for (const w of wallets) {
    console.log(`id      : ${w.id}`);
    console.log(`chain   : ${w.blockchain}`);
    console.log(`address : ${w.address}`);
    console.log(`type    : ${w.accountType}   state: ${w.state}`);
  }

  const ARC_MAIN = (process.env.STOREHOUSE_MAIN_WALLET_ADDRESS || "").toLowerCase();
  const created = (wallets[0]?.address || "").toLowerCase();
  console.log("\narc  main:", ARC_MAIN);
  console.log("base new :", created);
  console.log(
    created && created === ARC_MAIN
      ? "\n✓ SAME ADDRESS — unified EVM address holds across chains."
      : "\n⚠ DIFFERENT ADDRESS — each wallet record has its own key; Base needs its own funding and bookkeeping."
  );
}

main().catch((e) => {
  console.error("failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
