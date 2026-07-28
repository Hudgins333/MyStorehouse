/**
 * Send USDC out of ANY Storehouse wallet to an arbitrary address.
 *
 * Testing utility: recycle funds from any bucket (or main) through the payer
 * wallet to exercise the pipeline, without unwinding by hand. Accepts a bucket
 * name (tithe/tax-escrow/savings/operating/main) or a raw Circle wallet id.
 *
 * Run: npx tsx scripts/send-from-wallet.ts <bucket|walletId> <destination> <amount>
 *   e.g. npx tsx scripts/send-from-wallet.ts operating 0xabc...def 300
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

// Friendly bucket names -> Arc Circle wallet ids.
const WALLETS: Record<string, string> = {
  main:         "1514012f-cb4a-5381-8af7-0c53850452eb",
  tithe:        "bb0ff0b2-d046-5bb2-9b43-d675c8de6113",
  "tax-escrow": "7978d5fd-eef6-59a7-84c4-9380cc8aff50",
  savings:      "75a3921b-621a-5b89-a2ab-9e5dd9960a54",
  operating:    "94a97f7e-9e76-5a8c-a07d-22c5267856a8",
};

const [who, dest, amount] = process.argv.slice(2);
if (!who || !dest || !amount) {
  console.error("usage: npx tsx scripts/send-from-wallet.ts <bucket|walletId> <destination> <amount>");
  console.error("buckets:", Object.keys(WALLETS).join(", "));
  process.exit(1);
}
if (!/^0x[a-fA-F0-9]{40}$/.test(dest)) { console.error(`invalid destination: ${dest}`); process.exit(1); }
if (!(parseFloat(amount) > 0)) { console.error(`invalid amount: ${amount}`); process.exit(1); }

const walletId = WALLETS[who] ?? who; // bucket name or raw id
const tokenId = process.env.CIRCLE_USDC_TOKEN_ID;
if (!tokenId) { console.error("missing CIRCLE_USDC_TOKEN_ID"); process.exit(1); }

const circle = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY ?? "",
  entitySecret: process.env.CIRCLE_ENTITY_SECRET ?? "",
});

async function main() {
  console.log(`sending ${amount} USDC  ${who} (${walletId.slice(0,8)}...) -> ${dest}`);
  const response = await circle.createTransaction({
    walletId,
    tokenId,
    destinationAddress: dest,
    amount: [amount],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } as any);
  const id = response?.data?.id;
  if (!id) { console.error("no tx id:", JSON.stringify(response?.data ?? response)); process.exit(1); }
  console.log(`✓ submitted — circle tx ${id}`);

  // Poll to confirmation so you know it landed before the next step.
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const { data } = await circle.getTransaction({ id } as any);
    const s = data?.transaction?.state ?? data?.state;
    console.log(`  [${i}] ${s}`);
    if (s === "CONFIRMED" || s === "COMPLETE") { console.log("✓ confirmed"); return; }
    if (["FAILED","CANCELLED","DENIED"].includes(s)) { console.error(`✗ ${s}`); process.exit(1); }
  }
  console.log("(still pending — check Circle Console)");
}
main().catch((e) => { console.error("send failed:", e instanceof Error ? e.message : String(e)); process.exit(1); });
