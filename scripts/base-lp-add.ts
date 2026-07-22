/**
 * Add liquidity to the Uniswap V3 USDC/WETH pool on Base Sepolia.
 *
 * Mints a concentrated-liquidity position via NonfungiblePositionManager and
 * prints the resulting tokenId — the NFT that represents the position and is
 * required to exit it. Pair with scripts/base-lp-remove.ts.
 *
 * Position manager address verified on-chain: factory() returns the Base
 * Sepolia UniswapV3Factory, WETH9() returns canonical WETH.
 *
 * Run: npx tsx scripts/base-lp-add.ts <usdcAmount> <wethAmount>
 *   e.g. npx tsx scripts/base-lp-add.ts 5 0.002
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import {
  createWalletClient, createPublicClient, http,
  parseUnits, parseEther, formatUnits, formatEther, maxUint256,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const RPC  = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const WETH = "0x4200000000000000000000000000000000000006";
const NPM  = "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2";
const POOL = "0x46880b404CD35c165EDdefF7421019F8dD25F4Ad"; // 0.30% USDC/WETH
const FEE  = 3000;

// USDC (0x03..) sorts below WETH (0x42..), so token0 = USDC, token1 = WETH
const erc20 = [
  { type:"function", name:"balanceOf", stateMutability:"view", inputs:[{type:"address"}], outputs:[{type:"uint256"}] },
  { type:"function", name:"allowance", stateMutability:"view", inputs:[{type:"address"},{type:"address"}], outputs:[{type:"uint256"}] },
  { type:"function", name:"approve", stateMutability:"nonpayable", inputs:[{type:"address"},{type:"uint256"}], outputs:[{type:"bool"}] },
] as const;

const poolAbi = [
  { type:"function", name:"slot0", stateMutability:"view", inputs:[], outputs:[
    {name:"sqrtPriceX96",type:"uint160"},{name:"tick",type:"int24"},
    {name:"observationIndex",type:"uint16"},{name:"observationCardinality",type:"uint16"},
    {name:"observationCardinalityNext",type:"uint16"},{name:"feeProtocol",type:"uint8"},
    {name:"unlocked",type:"bool"}] },
  { type:"function", name:"tickSpacing", stateMutability:"view", inputs:[], outputs:[{type:"int24"}] },
  { type:"function", name:"liquidity", stateMutability:"view", inputs:[], outputs:[{type:"uint128"}] },
] as const;

const npmAbi = [
  { type:"function", name:"mint", stateMutability:"payable",
    inputs:[{type:"tuple",components:[
      {name:"token0",type:"address"},{name:"token1",type:"address"},{name:"fee",type:"uint24"},
      {name:"tickLower",type:"int24"},{name:"tickUpper",type:"int24"},
      {name:"amount0Desired",type:"uint256"},{name:"amount1Desired",type:"uint256"},
      {name:"amount0Min",type:"uint256"},{name:"amount1Min",type:"uint256"},
      {name:"recipient",type:"address"},{name:"deadline",type:"uint256"}]}],
    outputs:[{name:"tokenId",type:"uint256"},{name:"liquidity",type:"uint128"},
             {name:"amount0",type:"uint256"},{name:"amount1",type:"uint256"}] },
] as const;

async function main() {
  const [usdcStr, wethStr] = process.argv.slice(2);
  if (!usdcStr || !wethStr) {
    console.error("usage: npx tsx scripts/base-lp-add.ts <usdcAmount> <wethAmount>");
    process.exit(1);
  }

  const account = privateKeyToAccount(process.env.BASE_TEST_PRIVATE_KEY as `0x${string}`);
  const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });

  const amount0 = parseUnits(usdcStr, 6);   // USDC
  const amount1 = parseEther(wethStr);      // WETH

  console.log(`LP add: ${usdcStr} USDC + ${wethStr} WETH  (wallet ${account.address})\n`);

  // 1. Pool state -> pick a tick range around the current price
  const slot0 = await pub.readContract({ address: POOL as `0x${string}`, abi: poolAbi, functionName: "slot0" });
  const spacing = await pub.readContract({ address: POOL as `0x${string}`, abi: poolAbi, functionName: "tickSpacing" });
  const curTick = Number((slot0 as any)[1]);
  const s = Number(spacing);

  // Wide range (±50 spacings) so both tokens are used and the position stays in range
  const width = s * 50;
  const tickLower = Math.floor((curTick - width) / s) * s;
  const tickUpper = Math.ceil((curTick + width) / s) * s;

  console.log(`pool tick: ${curTick}  spacing: ${s}`);
  console.log(`range    : [${tickLower}, ${tickUpper}]\n`);

  // 2. Approvals
  for (const [label, token, amt] of [["USDC", USDC, amount0], ["WETH", WETH, amount1]] as const) {
    const allowance = await pub.readContract({
      address: token as `0x${string}`, abi: erc20, functionName: "allowance",
      args: [account.address, NPM as `0x${string}`],
    }) as bigint;
    if (allowance < amt) {
      console.log(`approving ${label} to position manager...`);
      const h = await wallet.writeContract({
        address: token as `0x${string}`, abi: erc20, functionName: "approve",
        args: [NPM as `0x${string}`, maxUint256],
      });
      const r = await pub.waitForTransactionReceipt({ hash: h });
      console.log(`  ${label} approve: ${r.status}`);
    } else {
      console.log(`${label} allowance already sufficient`);
    }
  }

  // 3. Mint the position
  console.log("\nminting position...");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

  const hash = await wallet.writeContract({
    address: NPM as `0x${string}`, abi: npmAbi, functionName: "mint",
    args: [{
      token0: USDC as `0x${string}`, token1: WETH as `0x${string}`, fee: FEE,
      tickLower, tickUpper,
      amount0Desired: amount0, amount1Desired: amount1,
      amount0Min: 0n, amount1Min: 0n,       // testnet: accept whatever ratio the pool takes
      recipient: account.address, deadline,
    }],
  });
  console.log("tx:", hash, "\nwaiting...");

  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log("status:", receipt.status, "| gas used:", receipt.gasUsed.toString());

  if (receipt.status !== "success") {
    console.error("mint reverted");
    process.exit(1);
  }

  // 4. Recover the tokenId from the Transfer event (ERC-721 mint to us)
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const mintLog = receipt.logs.find(
    (l) => l.address.toLowerCase() === NPM.toLowerCase() && l.topics[0] === transferTopic
  );
  const tokenId = mintLog?.topics[3] ? BigInt(mintLog.topics[3]) : null;

  console.log("\n=== POSITION OPENED ===");
  console.log("tokenId:", tokenId?.toString() ?? "(could not parse — check the tx on BaseScan)");
  console.log("\nSAVE THIS tokenId — it is required to close the position:");
  console.log(`  npx tsx scripts/base-lp-remove.ts ${tokenId?.toString() ?? "<tokenId>"}`);

  const [u, w, e] = await Promise.all([
    pub.readContract({ address: USDC as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [account.address] }),
    pub.readContract({ address: WETH as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [account.address] }),
    pub.getBalance({ address: account.address }),
  ]);
  console.log(`\nremaining — USDC: ${formatUnits(u as bigint, 6)}  WETH: ${formatEther(w as bigint)}  ETH: ${formatEther(e)}`);
  console.log("(public RPC can lag a block — re-run base-wallet-balance.ts if these look stale)");
}

main().catch((e) => { console.error("failed:", e instanceof Error ? e.message : String(e)); process.exit(1); });
