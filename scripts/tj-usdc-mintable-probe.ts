/**
 * PROBE — can WE mint Trader Joe test USDC on Fuji, or is mint() owner-only?
 * Uses simulateContract (read-only, no gas, no state change) to see whether a
 * mint call from a non-owner address would succeed or revert.
 *
 * Run: npx tsx scripts/tj-usdc-mintable-probe.ts
 *   Optionally test from YOUR wallet:  MY_ADDR=0xYourFujiAddress npx tsx scripts/tj-usdc-mintable-probe.ts
 */
import { createPublicClient, http, parseUnits } from "viem";
import { avalancheFuji } from "viem/chains";

const RPC = process.env.FUJI_RPC || "https://api.avax-test.network/ext/bc/C/rpc";
const TJ_USDC = "0xB6076C93701D6a07266c31066B298AeC6dd65c2d";
const OWNER = "0xFFC08538077a0455E0F4077823b1A0E3e18Faf0b";

// A random non-owner address to test "can anyone mint?"
const RANDOM = "0x1111111111111111111111111111111111111111";
const MY_ADDR = process.env.MY_ADDR; // optional: your actual Fuji wallet

const mintAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
] as const;

async function trySimulate(client: any, caller: string, label: string) {
  const amount = parseUnits("1000", 6); // try to mint 1000 test USDC
  try {
    await client.simulateContract({
      address: TJ_USDC as `0x${string}`,
      abi: mintAbi,
      functionName: "mint",
      args: [caller as `0x${string}`, amount],
      account: caller as `0x${string}`,
    });
    console.log(`  ✓ mint() WOULD SUCCEED from ${label} (${caller})`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const short = msg.split("\n")[0];
    console.log(`  ✗ mint() would REVERT from ${label} (${caller})`);
    console.log(`     reason: ${short}`);
    return false;
  }
}

async function main() {
  const client = createPublicClient({ chain: avalancheFuji, transport: http(RPC) });
  console.log("--- Can we mint TJ-USDC? (simulate mint) ---\nRPC:", RPC, "\n");

  console.log("=== simulate mint(address,uint256) ===");
  const randomOk = await trySimulate(client, RANDOM, "random non-owner");
  const ownerOk = await trySimulate(client, OWNER, "the owner");
  if (MY_ADDR) {
    console.log("");
    await trySimulate(client, MY_ADDR, "YOUR wallet");
  }

  console.log("\n=== VERDICT ===");
  if (randomOk) {
    console.log("✓✓ PUBLIC MINT — anyone can mint TJ-USDC. You can fund a wallet freely,");
    console.log("   then test the AVAX/USDC LP add+remove round-trip. Aggressive lane unblocked.");
  } else if (ownerOk) {
    console.log("⚠ OWNER-ONLY MINT — only", OWNER, "can mint TJ-USDC.");
    console.log("   You can't freely mint it. Options: (a) find a public faucet UI for TJ testnet,");
    console.log("   (b) acquire TJ-USDC by swapping in an existing TJ pool (e.g. sell WAVAX for it),");
    console.log("   (c) seed your own pool for the demo. Real testnet blocker identified.");
  } else {
    console.log("? mint reverted for both — may need different args or the fn differs. Inspect reasons above.");
  }
  console.log("\nNote: if MY_ADDR wasn't set, re-run with MY_ADDR=0xYourFujiWallet to test your own address.");
}

main().catch((e) => { console.error("Unhandled:", e); process.exit(1); });
