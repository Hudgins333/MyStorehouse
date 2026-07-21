/**
 * PROBE — cbBTC availability + Moonwell on Base Sepolia.
 * Reads ground truth from chain. Trusts no docs.
 *
 *  1. Does cbBTC (or any wrapped BTC) exist on Base Sepolia at known candidates?
 *  2. Is Moonwell's Comptroller live on Base Sepolia? (getAllMarkets)
 *  3. If live, what underlying assets do its mToken markets wrap? (find cbBTC/USDC)
 *
 * Run: npx tsx scripts/cbbtc-probe.ts
 *   (Override RPC: BASE_SEPOLIA_RPC=https://... )
 */
import { createPublicClient, http, getContract } from "viem";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";

// cbBTC on Base MAINNET is 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf.
// Testnet may differ or not exist — we CHECK, not assume.
const CBBTC_CANDIDATES = [
  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // Base mainnet cbBTC (test if same on Sepolia)
];

// Moonwell Comptroller (Unitroller) candidates. Mainnet is
// 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C — testnet unknown, we probe.
const MOONWELL_COMPTROLLER_CANDIDATES = [
  "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C", // Base mainnet (test if exists on Sepolia)
];

const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const comptrollerAbi = [
  { type: "function", name: "getAllMarkets", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
] as const;

const mTokenAbi = [
  { type: "function", name: "underlying", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

async function codeExists(client: any, addr: string): Promise<boolean> {
  const code = await client.getBytecode({ address: addr as `0x${string}` });
  return !!code && code !== "0x";
}

async function main() {
  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  console.log("--- cbBTC + Moonwell Base Sepolia probe ---");
  console.log("RPC:", RPC, "\n");

  // 1. cbBTC token existence
  console.log("=== cbBTC token check ===");
  for (const addr of CBBTC_CANDIDATES) {
    const exists = await codeExists(client, addr);
    if (!exists) { console.log(`  ✗ no contract at ${addr}`); continue; }
    try {
      const t = getContract({ address: addr as `0x${string}`, abi: erc20Abi, client });
      const sym = await t.read.symbol();
      const dec = await t.read.decimals();
      console.log(`  ✓ contract at ${addr} — symbol=${sym} decimals=${dec}`);
    } catch {
      console.log(`  ? contract at ${addr} but not ERC20-readable`);
    }
  }

  // 2 + 3. Moonwell comptroller + its markets
  console.log("\n=== Moonwell check ===");
  for (const comp of MOONWELL_COMPTROLLER_CANDIDATES) {
    const exists = await codeExists(client, comp);
    if (!exists) { console.log(`  ✗ no Moonwell Comptroller at ${comp} on Base Sepolia`); continue; }
    console.log(`  ✓ contract exists at ${comp} — reading markets...`);
    try {
      const c = getContract({ address: comp as `0x${string}`, abi: comptrollerAbi, client });
      const markets = await c.read.getAllMarkets();
      console.log(`  Moonwell has ${markets.length} markets:`);
      for (const m of markets) {
        try {
          const mt = getContract({ address: m, abi: mTokenAbi, client });
          const mSym = await mt.read.symbol();
          let underSym = "?";
          try {
            const under = await mt.read.underlying();
            const u = getContract({ address: under, abi: erc20Abi, client });
            underSym = await u.read.symbol();
          } catch { underSym = "(native/none)"; }
          const flag = /BTC|USDC/i.test(underSym) ? "★" : " ";
          console.log(`    ${flag} ${mSym} -> underlying ${underSym} (${m})`);
        } catch {
          console.log(`      (unreadable market ${m})`);
        }
      }
    } catch (e) {
      console.log(`  contract exists but getAllMarkets failed — may not be a Moonwell Comptroller:`, e instanceof Error ? e.message : String(e));
    }
  }

  console.log("\n=== VERDICT ===");
  console.log("If cbBTC has no contract and Moonwell Comptroller is absent on Base Sepolia,");
  console.log("the savings->cbBTC->Moonwell leg is NOT viable on this testnet as-is.");
  console.log("(It IS live on Base MAINNET — so it's a mainnet-roadmap path, not a testnet-demo path.)");
}

main().catch((e) => { console.error("Unhandled:", e); process.exit(1); });
