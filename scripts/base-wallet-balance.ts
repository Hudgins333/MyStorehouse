/**
 * Check the Base Sepolia test wallet's holdings: ETH (gas), Circle USDC,
 * and WETH. Run repeatedly while faucets land.
 *
 * Run: npx tsx scripts/base-wallet-balance.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createPublicClient, http, formatUnits, formatEther, getContract } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const WETH = "0x4200000000000000000000000000000000000006";

const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

async function main() {
  const pk = process.env.BASE_TEST_PRIVATE_KEY as `0x${string}`;
  if (!pk) { console.error("BASE_TEST_PRIVATE_KEY not set in .env.local"); process.exit(1); }
  const addr = privateKeyToAccount(pk).address;

  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  console.log("wallet:", addr, "\nRPC:", RPC, "\n");

  const eth = await client.getBalance({ address: addr });
  console.log(`ETH  (gas) : ${formatEther(eth)}`);

  for (const [label, token] of [["USDC", USDC], ["WETH", WETH]] as const) {
    const c = getContract({ address: token as `0x${string}`, abi: erc20, client });
    const [bal, dec] = await Promise.all([c.read.balanceOf([addr]), c.read.decimals()]);
    console.log(`${label.padEnd(10)} : ${formatUnits(bal, dec)}`);
  }

  console.log("\nReady to LP when: ETH > 0 (gas), USDC > 0, and WETH > 0.");
  console.log("WETH can be minted from ETH via wrap — no faucet needed for it.");
}

main().catch((e) => { console.error(e); process.exit(1); });
