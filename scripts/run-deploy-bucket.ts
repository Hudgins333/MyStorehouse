/**
 * Manual trigger: deploy an aggressive bucket's funds into its lane,
 * bridging Arc->Base first.
 *   npx tsx scripts/run-deploy-bucket.ts <obligationId> <usdcAmount>
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const [obligationId, amount] = process.argv.slice(2);
  if (!obligationId || !amount) {
    console.error("usage: run-deploy-bucket.ts <obligationId> <usdcAmount>");
    process.exit(1);
  }
  const { deployBucket } = await import("../lib/executor/deploy-bucket");
  const r = await deployBucket(obligationId, amount);
  console.log("\n✓ BUCKET DEPLOYED");
  console.log("  bucket:", r.bucketName, "| bridged:", r.bridgedUsdc, "USDC");
  console.log("  tokenId:", r.deploy.tokenId);
  console.log("  txs:", JSON.stringify(r.deploy.txHashes, null, 2));
  console.log(`\n  exit with: npx tsx scripts/run-aggressive-lane.ts exit ${r.deploy.tokenId}`);
}
main().catch((e) => { console.error("\n✗", e instanceof Error ? e.message : String(e)); process.exit(1); });
