import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  if (!apiKey || !entitySecret) {
    console.error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET");
    process.exit(1);
  }

  const client = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
  });

  // Step 1: Create a wallet set named for Storehouse
  console.log("Creating wallet set...");
  const walletSetResponse = await client.createWalletSet({
    name: "Storehouse v1 — Testnet",
  });

  const walletSet = walletSetResponse.data?.walletSet;
  if (!walletSet?.id) {
    throw new Error("Wallet set creation failed: no ID returned");
  }
  console.log(`✅ Wallet Set ID: ${walletSet.id}\n`);

  // Step 2: Create 5 wallets within the set on Arc Testnet
  console.log("Creating 5 wallets on Arc Testnet...");
  const walletResponse = await client.createWallets({
    walletSetId: walletSet.id,
    blockchains: ["ARC-TESTNET"],
    count: 5,
    accountType: "EOA",
  });

  const wallets = walletResponse.data?.wallets || [];
  console.log(`✅ Created ${wallets.length} wallets\n`);

  // Step 3: Print everything so we can save it
  const labels = [
    "storehouse-main",
    "storehouse-tithe",
    "storehouse-tax-escrow",
    "storehouse-savings",
    "storehouse-operating",
  ];

  console.log("=".repeat(60));
  console.log("STOREHOUSE WALLETS (save these somewhere)");
  console.log("=".repeat(60));
  console.log(`Wallet Set ID: ${walletSet.id}\n`);

  wallets.forEach((wallet, i) => {
    console.log(`${labels[i] || `wallet-${i}`}`);
    console.log(`  ID:      ${wallet.id}`);
    console.log(`  Address: ${wallet.address}`);
    console.log(`  Chain:   ${wallet.blockchain}`);
    console.log("");
  });
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message || err);
  if (err.response?.data) {
    console.error("Response:", JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
