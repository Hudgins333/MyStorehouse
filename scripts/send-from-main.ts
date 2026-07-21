/**
 * Send USDC out of storehouse-main to an arbitrary address.
 *
 * Used to fund the external "payer" wallet, which then sends paychecks back
 * into main to exercise the routing pipeline with realistic sender history.
 *
 * Run: npx tsx scripts/send-from-main.ts <destination> <amount>
 *   e.g. npx tsx scripts/send-from-main.ts 0xabc...def 500
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const [dest, amount] = process.argv.slice(2);

if (!dest || !amount) {
  console.error("usage: npx tsx scripts/send-from-main.ts <destination> <amount>");
  process.exit(1);
}
if (!/^0x[a-fA-F0-9]{40}$/.test(dest)) {
  console.error(`invalid destination address: ${dest}`);
  process.exit(1);
}
if (!(parseFloat(amount) > 0)) {
  console.error(`invalid amount: ${amount}`);
  process.exit(1);
}

const walletId = process.env.STOREHOUSE_MAIN_WALLET_ID;
const tokenId = process.env.CIRCLE_USDC_TOKEN_ID;

if (!walletId || !tokenId) {
  console.error("missing STOREHOUSE_MAIN_WALLET_ID or CIRCLE_USDC_TOKEN_ID in env");
  process.exit(1);
}

const circle = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY ?? "",
  entitySecret: process.env.CIRCLE_ENTITY_SECRET ?? "",
});

async function main() {
  console.log(`sending ${amount} USDC  main -> ${dest}`);

  const response = await circle.createTransaction({
    walletId,
    tokenId,
    destinationAddress: dest,
    amount: [amount],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } as any);

  const id = response?.data?.id;
  if (!id) {
    console.error("no transaction id returned:", JSON.stringify(response?.data ?? response));
    process.exit(1);
  }
  console.log(`✓ submitted — circle tx ${id}`);
  console.log("  watch state in Circle Console, or wait for the outbound webhook");
}

main().catch((e) => {
  console.error("send failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
