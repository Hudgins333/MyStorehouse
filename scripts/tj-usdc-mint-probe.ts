/**
 * PROBE — how do we obtain Trader Joe test USDC on Fuji, and does a route exist
 * between Circle-USDC and TJ-USDC? Read-only reconnaissance.
 *
 *  1. Inspect TJ-USDC bytecode for common testnet mint/faucet function selectors
 *  2. Read basic token info (name/symbol/decimals/totalSupply)
 *  3. Check whether a Circle-USDC/TJ-USDC LB pair exists via the LBFactory
 *
 * Run: npx tsx scripts/tj-usdc-mint-probe.ts
 */
import { createPublicClient, http, getContract, toFunctionSelector, formatUnits } from "viem";
import { avalancheFuji } from "viem/chains";

const RPC = process.env.FUJI_RPC || "https://api.avax-test.network/ext/bc/C/rpc";

const TJ_USDC = "0xB6076C93701D6a07266c31066B298AeC6dd65c2d";
const CIRCLE_USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";
const LB_FACTORY_V22 = "0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c";

const infoAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

// Common testnet mint/faucet function signatures to look for in bytecode
const CANDIDATE_FNS = [
  "mint(address,uint256)",
  "mint(uint256)",
  "mint(address,uint256,uint256)",
  "faucet()",
  "faucet(uint256)",
  "drip()",
  "claim()",
  "requestTokens()",
  "requestTokens(uint256)",
  "gimme()",
  "mintTo(address,uint256)",
];

// LBFactory: check if a pair exists for two tokens (any bin step)
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

async function main() {
  const client = createPublicClient({ chain: avalancheFuji, transport: http(RPC) });
  console.log("--- TJ-USDC acquisition + Circle<->TJ route probe (Fuji) ---\nRPC:", RPC, "\n");

  // 1. Token info
  const t = getContract({ address: TJ_USDC as `0x${string}`, abi: infoAbi, client });
  console.log("=== TJ-USDC token ===");
  for (const fn of ["name","symbol","decimals","totalSupply","owner"] as const) {
    try {
      const v = await (t.read as any)[fn]();
      console.log(`  ${fn}: ${fn === "totalSupply" ? formatUnits(v, 6) : v}`);
    } catch { console.log(`  ${fn}: (not present)`); }
  }

  // 2. Bytecode scan for mint/faucet selectors
  console.log("\n=== mint/faucet function scan (selector in bytecode) ===");
  const code = (await client.getBytecode({ address: TJ_USDC as `0x${string}` })) || "0x";
  let foundAny = false;
  for (const sig of CANDIDATE_FNS) {
    const sel = toFunctionSelector(sig).slice(2); // 4-byte hex, no 0x
    const present = code.toLowerCase().includes(sel.toLowerCase());
    if (present) { console.log(`  ✓ likely present: ${sig}  (selector 0x${sel})`); foundAny = true; }
  }
  if (!foundAny) console.log("  ✗ none of the common mint/faucet selectors found in bytecode.");
  console.log("  (Selector-in-bytecode is a strong hint, not a guarantee — confirm by calling.)");

  // 3. Circle-USDC <-> TJ-USDC LB pair?
  console.log("\n=== Circle-USDC <-> TJ-USDC route (LB pair) ===");
  try {
    const f = getContract({ address: LB_FACTORY_V22 as `0x${string}`, abi: factoryAbi, client });
    const pairs = await f.read.getAllLBPairs([CIRCLE_USDC as `0x${string}`, TJ_USDC as `0x${string}`]);
    if (pairs.length === 0) {
      console.log("  ✗ No LB pair between Circle-USDC and TJ-USDC. No direct TJ swap route to align them.");
    } else {
      console.log(`  ✓ ${pairs.length} LB pair(s) between Circle-USDC and TJ-USDC:`);
      for (const p of pairs) console.log(`    binStep=${p.binStep} pair=${p.LBPair}`);
    }
  } catch (e) {
    console.log("  factory query failed:", e instanceof Error ? e.message : String(e));
  }

  console.log("\n=== READ ===");
  console.log("If TJ-USDC has a public mint/faucet -> we can obtain it directly for the demo.");
  console.log("If no Circle<->TJ pair exists -> alignment on testnet is via minting TJ-USDC");
  console.log("   (demo scaffolding), with mainnet's single canonical USDC noted as the real fix.");
}

main().catch((e) => { console.error("Unhandled:", e); process.exit(1); });
