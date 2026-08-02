/**
 * Exercise the Crossmint offramp integration against the current env
 * (staging by default). On staging this proves the Orders API surface is
 * reached and authenticated; the withdrawal is production-gated.
 *
 *   npx tsx scripts/run-offramp-bucket.ts <obligationId> <usdcAmount> <email>
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const [obligationId, amount, email] = process.argv.slice(2);
  if (!obligationId || !amount || !email) {
    console.error("usage: run-offramp-bucket.ts <obligationId> <usdcAmount> <email>");
    process.exit(1);
  }
  const { offrampBucket } = await import("../lib/executor/offramp-bucket");
  console.log(`env: ${process.env.CROSSMINT_ENV} — exercising Crossmint offramp integration\n`);
  const r = await offrampBucket(obligationId, amount, email);
  console.log(JSON.stringify(r, null, 2));
}
main().catch((e) => { console.error("\n✗", e instanceof Error ? e.message : String(e)); process.exit(1); });
