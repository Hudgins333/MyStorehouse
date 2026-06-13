/**
 * SPIKE — throwaway probe: is USDC -> cirBTC actually swappable on Arc Testnet
 * via App Kit, signing through our Circle developer-controlled wallet?
 *
 * Calls estimateSwap only (no funds move). A returned quote = green light.
 * An "unsupported token / no route" error = cirBTC stays a roadmap note.
 *
 * Run: npx tsx --env-file=.env.local scripts/spike-cirbtc.ts
 */
import { AppKit } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { inspect } from "util";

async function main() {
  const adapter = createCircleWalletsAdapter({
    apiKey: process.env.CIRCLE_API_KEY as string,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
  });

  const kit = new AppKit();
  const savingsWalletId = process.env.STOREHOUSE_SAVINGS_WALLET_ID as string;

  console.log("--- cirBTC swap spike: estimateSwap USDC -> cirBTC on Arc_Testnet ---");
  console.log("savings walletId:", savingsWalletId);

  try {
    const estimate = await kit.estimateSwap({
      from: {
        adapter,
        chain: "Arc_Testnet",
        address: "0x93f1e2d244b2005354674949e7c56bd2606fe6d3", // savings on-chain address
      },
      tokenIn: "USDC",
      tokenOut: "EURC",
      amountIn: "0.10",
      config: {
        kitKey: process.env.KIT_KEY as string,
      },
    });
    console.log("\n✓ ESTIMATE RETURNED — cirBTC IS routable:");
    console.log(inspect(estimate, false, null, true));
  } catch (err) {
    console.log("\n✗ estimateSwap failed:");
    console.log(inspect(err, false, null, true));
  }
}

main().catch((e) => {
  console.error("Unhandled:", e);
  process.exit(1);
});
