/**
 * Manual trigger for the aggressive-lane executor (v1). Deploy or exit.
 *   npx tsx scripts/run-aggressive-lane.ts deploy <usdcAmount>
 *   npx tsx scripts/run-aggressive-lane.ts exit <tokenId>
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const [action, arg] = process.argv.slice(2);
  const { deployToAggressiveLane, exitAggressiveLane } = await import("../lib/executor/aggressive-lane");

  if (action === "deploy") {
    if (!arg) { console.error("usage: run-aggressive-lane.ts deploy <usdcAmount>"); process.exit(1); }
    console.log(`deploying ${arg} USDC into the aggressive lane...\n`);
    const r = await deployToAggressiveLane(arg);
    console.log("\n✓ DEPLOYED");
    console.log("  tokenId:", r.tokenId, "| USDC in:", r.usdcIn, "| WETH in:", r.wethIn);
    console.log("  txs:", JSON.stringify(r.txHashes, null, 2));
    console.log(`\n  exit with: npx tsx scripts/run-aggressive-lane.ts exit ${r.tokenId}`);
  } else if (action === "exit") {
    if (!arg) { console.error("usage: run-aggressive-lane.ts exit <tokenId>"); process.exit(1); }
    console.log(`exiting position ${arg}...\n`);
    const r = await exitAggressiveLane(arg);
    console.log("\n✓ EXITED");
    console.log("  txs:", JSON.stringify(r.txHashes, null, 2));
  } else {
    console.error("usage: run-aggressive-lane.ts <deploy|exit> <arg>");
    process.exit(1);
  }
}
main().catch((e) => { console.error("\n✗", e instanceof Error ? e.message : String(e)); process.exit(1); });
