import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const circle = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY!,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
});

async function transfer() {
  const fromWalletId = process.env.STOREHOUSE_TITHE_WALLET_ID!;
  const toAddress = process.env.STOREHOUSE_MAIN_WALLET_ADDRESS!;
  const usdcTokenId = "15dc2b5d-0994-58b0-bf8c-3a0501148ee8";

  console.log("Sending 1 USDC: storehouse-tithe → storehouse-main...");

  const response = await circle.createTransaction({
    walletId: fromWalletId,
    tokenId: usdcTokenId,
    destinationAddress: toAddress,
    amount: ["1"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  console.log("Transfer initiated:", response.data?.id);
  console.log("State:", response.data?.state);
}

transfer().catch(console.error);
