/**
 * Bridge USDC from Arc Testnet to Base Sepolia via CCTP (Bridge Kit).
 *
 * Source: storehouse-main (Circle DCW, developer-controlled).
 * Destination: the Base Sepolia test EOA (user-controlled; resolves its own
 * address, so none is passed).
 *
 * Subscribes to every action so the approve -> burn -> attestation -> mint
 * sequence is visible as it happens.
 *
 * Run: npx tsx scripts/bridge-arc-to-base.ts [amount]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const amount = process.argv[2] || "1";

  const { BridgeKit, ArcTestnet, BaseSepolia } = (await import("@circle-fin/bridge-kit")) as any;
  const { createCircleWalletsAdapter } = await import("@circle-fin/adapter-circle-wallets");
  const { createViemAdapterFromPrivateKey } = await import("@circle-fin/adapter-viem-v2");
  const { privateKeyToAccount } = await import("viem/accounts");

  const pk = process.env.BASE_TEST_PRIVATE_KEY as `0x${string}`;
  const account = privateKeyToAccount(pk);
  const mainAddress = process.env.STOREHOUSE_MAIN_WALLET_ADDRESS as string;

  const sourceAdapter = createCircleWalletsAdapter({
    apiKey: process.env.CIRCLE_API_KEY as string,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
  });
  const destAdapter = createViemAdapterFromPrivateKey({ privateKey: pk });

  console.log(`bridging ${amount} USDC   Arc Testnet -> Base Sepolia`);
  console.log(`  from ${mainAddress}`);
  console.log(`  to   ${account.address}\n`);

  const kit = new BridgeKit();

  kit.on("*", (payload: any) => {
    const v = payload?.values ?? {};
    const detail = v.txHash ?? v.status ?? v.message ?? "";
    console.log(`  [${payload?.method ?? "event"}] ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  });

  const started = Date.now();

  const result = await kit.bridge({
    from: { adapter: sourceAdapter, address: mainAddress, chain: ArcTestnet },
    to: { adapter: destAdapter, chain: BaseSepolia },
    amount,
    token: "USDC",
    config: {},
  });

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n=== BRIDGE COMPLETE in ${secs}s ===`);
  console.log(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

main().catch((e) => {
  console.error("\n✗ bridge failed:", e instanceof Error ? e.message : String(e));
  console.error("\nstack:\n", e instanceof Error ? e.stack : "(no stack)");
  process.exit(1);
});
