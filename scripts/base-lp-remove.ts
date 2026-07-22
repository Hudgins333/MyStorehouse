/**
 * Close a Uniswap V3 position on Base Sepolia: decreaseLiquidity -> collect -> burn.
 *
 * Run: npx tsx scripts/base-lp-remove.ts <tokenId>
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createWalletClient, createPublicClient, http, formatUnits, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const RPC  = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const WETH = "0x4200000000000000000000000000000000000006";
const NPM  = "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2";
const MAX_U128 = (1n << 128n) - 1n;

const erc20 = [
  { type:"function", name:"balanceOf", stateMutability:"view", inputs:[{type:"address"}], outputs:[{type:"uint256"}] },
] as const;

const npmAbi = [
  { type:"function", name:"positions", stateMutability:"view", inputs:[{type:"uint256"}], outputs:[
    {name:"nonce",type:"uint96"},{name:"operator",type:"address"},
    {name:"token0",type:"address"},{name:"token1",type:"address"},{name:"fee",type:"uint24"},
    {name:"tickLower",type:"int24"},{name:"tickUpper",type:"int24"},{name:"liquidity",type:"uint128"},
    {name:"feeGrowthInside0LastX128",type:"uint256"},{name:"feeGrowthInside1LastX128",type:"uint256"},
    {name:"tokensOwed0",type:"uint128"},{name:"tokensOwed1",type:"uint128"}] },
  { type:"function", name:"decreaseLiquidity", stateMutability:"payable",
    inputs:[{type:"tuple",components:[
      {name:"tokenId",type:"uint256"},{name:"liquidity",type:"uint128"},
      {name:"amount0Min",type:"uint256"},{name:"amount1Min",type:"uint256"},
      {name:"deadline",type:"uint256"}]}],
    outputs:[{name:"amount0",type:"uint256"},{name:"amount1",type:"uint256"}] },
  { type:"function", name:"collect", stateMutability:"payable",
    inputs:[{type:"tuple",components:[
      {name:"tokenId",type:"uint256"},{name:"recipient",type:"address"},
      {name:"amount0Max",type:"uint128"},{name:"amount1Max",type:"uint128"}]}],
    outputs:[{name:"amount0",type:"uint256"},{name:"amount1",type:"uint256"}] },
  { type:"function", name:"burn", stateMutability:"payable", inputs:[{type:"uint256"}], outputs:[] },
] as const;

async function main() {
  const idArg = process.argv[2];
  if (!idArg) { console.error("usage: npx tsx scripts/base-lp-remove.ts <tokenId>"); process.exit(1); }
  const tokenId = BigInt(idArg);

  const account = privateKeyToAccount(process.env.BASE_TEST_PRIVATE_KEY as `0x${string}`);
  const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });

  console.log(`closing position ${tokenId}  (wallet ${account.address})\n`);

  const pos = await pub.readContract({
    address: NPM as `0x${string}`, abi: npmAbi, functionName: "positions", args: [tokenId],
  }) as any;

  const liquidity = pos[7] as bigint;
  console.log(`token0: ${pos[2]}\ntoken1: ${pos[3]}\nticks : [${pos[5]}, ${pos[6]}]`);
  console.log(`liquidity: ${liquidity}`);
  console.log(`owed: ${pos[10]} / ${pos[11]}\n`);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

  // 1. decreaseLiquidity — pull everything back into the position's owed balances
  if (liquidity > 0n) {
    console.log("decreaseLiquidity...");
    const h = await wallet.writeContract({
      address: NPM as `0x${string}`, abi: npmAbi, functionName: "decreaseLiquidity",
      args: [{ tokenId, liquidity, amount0Min: 0n, amount1Min: 0n, deadline }],
    });
    const r = await pub.waitForTransactionReceipt({ hash: h });
    console.log(`  ${r.status} | gas ${r.gasUsed}`);
  } else {
    console.log("liquidity already zero — skipping decrease");
  }

  // 2. collect — sweep owed tokens (principal + any fees) to the wallet
  console.log("collect...");
  const ch = await wallet.writeContract({
    address: NPM as `0x${string}`, abi: npmAbi, functionName: "collect",
    args: [{ tokenId, recipient: account.address, amount0Max: MAX_U128, amount1Max: MAX_U128 }],
  });
  const cr = await pub.waitForTransactionReceipt({ hash: ch });
  console.log(`  ${cr.status} | gas ${cr.gasUsed}`);

  // 3. burn — destroy the now-empty position NFT
  console.log("burn...");
  const bh = await wallet.writeContract({
    address: NPM as `0x${string}`, abi: npmAbi, functionName: "burn", args: [tokenId],
  });
  const br = await pub.waitForTransactionReceipt({ hash: bh });
  console.log(`  ${br.status} | gas ${br.gasUsed}`);

  const [u, w, e] = await Promise.all([
    pub.readContract({ address: USDC as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [account.address] }),
    pub.readContract({ address: WETH as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [account.address] }),
    pub.getBalance({ address: account.address }),
  ]);
  console.log(`\n=== POSITION CLOSED ===`);
  console.log(`USDC: ${formatUnits(u as bigint, 6)}  WETH: ${formatEther(w as bigint)}  ETH: ${formatEther(e)}`);
  console.log("(re-run base-wallet-balance.ts if these look stale)");
}

main().catch((e) => { console.error("failed:", e instanceof Error ? e.message : String(e)); process.exit(1); });
