/**
 * PROBE — will Bridge Kit quote a CCTP transfer Arc Testnet -> Base Sepolia?
 *
 * Estimate only. Moves no funds. Same discipline as the swap probe: get a
 * quote back before committing build time or capital to the rail.
 *
 * Run: npx tsx scripts/bridge-estimate-probe.ts [amount]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const amount = process.argv[2] || "1";

  const bridgeMod = await import("@circle-fin/bridge-kit");
  const { BridgeKit, ArcTestnet, BaseSepolia } = bridgeMod as any;

  const { createCircleWalletsAdapter } = await import("@circle-fin/adapter-circle-wallets");

  // Destination adapter: the funded Base Sepolia EOA.
  const { createViemAdapterFromPrivateKey } = await import("@circle-fin/adapter-viem-v2");
  const { privateKeyToAccount } = await import("viem/accounts");

  const pk = process.env.BASE_TEST_PRIVATE_KEY as `0x${string}`;
  const account = privateKeyToAccount(pk);
  const destAdapter = createViemAdapterFromPrivateKey({ privateKey: pk });

  const sourceAdapter = createCircleWalletsAdapter({
    apiKey: process.env.CIRCLE_API_KEY as string,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
  });

  const mainAddress = process.env.STOREHOUSE_MAIN_WALLET_ADDRESS as string;

  console.log("--- Bridge Kit estimate probe ---");
  console.log(`  ${amount} USDC   Arc Testnet -> Base Sepolia`);
  console.log(`  from: ${mainAddress}`);
  console.log(`  to:   ${account.address}\n`);

  const kit = new BridgeKit();

  console.log("supported chains:",
    kit.getSupportedChains().map((c: any) => c.name ?? c.id).join(", "), "\n");

  const estimate = await kit.estimate({
    // NOTE: the shipped runtime reads params.from / params.to, while the
    // bundled .d.ts documents source / destination. Runtime wins.
    from: { adapter: sourceAdapter, address: mainAddress, chain: ArcTestnet },
    // User-controlled adapters resolve their own address — passing one errors.
    to: { adapter: destAdapter, chain: BaseSepolia },
    amount,
    token: "USDC",
    config: {},
  });

  console.log("=== ESTIMATE ===");
  console.log(JSON.stringify(estimate, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

main().catch((e) => {
  console.error("\n✗ estimate failed:", e instanceof Error ? e.message : String(e));
  if (e?.cause) console.error("cause:", e.cause);
  console.error("\nstack:\n", e instanceof Error ? e.stack : "(no stack)");
  process.exit(1);
});
