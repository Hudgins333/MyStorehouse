/**
 * PROBE — is Circle/CCTP USDC swappable for AVAX/WAVAX anywhere reachable on Fuji?
 * Checks Trader Joe LBFactory for Circle-USDC <-> WAVAX pairs, and whether they
 * hold liquidity. If a liquid pair exists, the route "bridge Circle-USDC -> swap
 * to AVAX" is viable, and from AVAX we can reach both LP legs.
 *
 * Run: npx tsx scripts/circle-usdc-avax-route-probe.ts
 */
import { createPublicClient, http, getContract, formatUnits } from "viem";
import { avalancheFuji } from "viem/chains";

const RPC = process.env.FUJI_RPC || "https://api.avax-test.network/ext/bc/C/rpc";

const CIRCLE_USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";
const TJ_USDC     = "0xB6076C93701D6a07266c31066B298AeC6dd65c2d";
const WAVAX       = "0xd00ae08403B9bbb9124bB305C09058E32C39A48c";

// All Trader Joe LBFactories on Fuji (V2.2, V2.1, V2.0) — check each
const FACTORIES = [
  { v: "V2.2", addr: "0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c" },
  { v: "V2.1", addr: "0x8e42f2F4101563bF679975178e880FD87d3eFd4e" },
  { v: "V2.0", addr: "0x6B8E020098cd1B3Ec9f811024bc24e51C660F768" },
];

const factoryAbi = [
  { type: "function", name: "getAllLBPairs", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "tuple[]", components: [
      { name: "binStep", type: "uint16" },
      { name: "LBPair", type: "address" },
      { name: "createdByOwner", type: "bool" },
      { name: "ignoredForRouting", type: "bool" },
    ]}] },
] as const;

const pairAbi = [
  { type: "function", name: "getTokenX", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getTokenY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "rX", type: "uint128" }, { name: "rY", type: "uint128" }] },
] as const;

async function checkPairsFor(client: any, tokenA: string, tokenB: string, labelA: string, labelB: string) {
  console.log(`\n=== ${labelA} <-> ${labelB} pairs ===`);
  let anyLiquid = false;
  for (const f of FACTORIES) {
    try {
      const factory = getContract({ address: f.addr as `0x${string}`, abi: factoryAbi, client });
      const pairs = await factory.read.getAllLBPairs([tokenA as `0x${string}`, tokenB as `0x${string}`]);
      if (pairs.length === 0) { console.log(`  ${f.v}: none`); continue; }
      for (const p of pairs) {
        const pc = getContract({ address: p.LBPair, abi: pairAbi, client });
        const [rX, rY] = await pc.read.getReserves();
        const liquid = rX > 0n || rY > 0n;
        if (liquid) anyLiquid = true;
        console.log(`  ${f.v}: pair ${p.LBPair} binStep=${p.binStep} reserves=[${rX},${rY}] ${liquid ? "✓ LIQUID" : "✗ empty"}`);
      }
    } catch (e) {
      console.log(`  ${f.v}: query error (${e instanceof Error ? e.message.split("\n")[0] : e})`);
    }
  }
  return anyLiquid;
}

async function main() {
  const client = createPublicClient({ chain: avalancheFuji, transport: http(RPC) });
  console.log("--- Circle-USDC -> AVAX route probe (Fuji, Trader Joe) ---\nRPC:", RPC);

  const circleAvax = await checkPairsFor(client, CIRCLE_USDC, WAVAX, "Circle-USDC", "WAVAX");
  // For contrast, confirm TJ-USDC<->WAVAX is the liquid one (we know it is)
  const tjAvax = await checkPairsFor(client, TJ_USDC, WAVAX, "TJ-USDC", "WAVAX");

  console.log("\n=== VERDICT ===");
  if (circleAvax) {
    console.log("✓✓ Circle-USDC <-> WAVAX has a LIQUID Trader Joe pair. Route works:");
    console.log("   bridge Circle-USDC -> swap to AVAX -> (wrap WAVAX + swap half to TJ-USDC) -> LP.");
  } else {
    console.log("✗ No LIQUID Circle-USDC <-> WAVAX pair on Trader Joe Fuji.");
    console.log("   Circle-USDC appears stranded on TJ (ecosystem standardized on TJ-USDC).");
    console.log("   Next: check other Fuji DEXes, or reconsider — maybe bridge to AVAX a different way,");
    console.log("   or the Avax-LP lane uses TJ-USDC end-to-end (demo scaffolding, mainnet unifies).");
  }
  if (tjAvax) console.log("   (Confirmed: TJ-USDC<->WAVAX IS liquid — that's the pool we found earlier.)");
}

main().catch((e) => { console.error("Unhandled:", e); process.exit(1); });
