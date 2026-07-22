/**
 * Swap USDC -> WETH on Base Sepolia via Uniswap V3 SwapRouter02.
 * Quotes all fee tiers first, routes through the best, applies slippage floor.
 * Preserves ETH for gas by converting the abundant USDC into the WETH leg.
 *
 * Run: npx tsx scripts/base-swap-usdc-weth.ts <usdcAmount>
 *   e.g. npx tsx scripts/base-swap-usdc-weth.ts 5
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import {
  createWalletClient, createPublicClient, http,
  parseUnits, formatUnits, formatEther, getContract, maxUint256,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const USDC   = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const WETH   = "0x4200000000000000000000000000000000000006";
const QUOTER = "0xC5290058841028F1614F3A6F0F5816cAd0df5E27";
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"; // SwapRouter02
const FEES = [100, 500, 3000, 10000];

const erc20 = [
  { type:"function", name:"balanceOf", stateMutability:"view", inputs:[{type:"address"}], outputs:[{type:"uint256"}] },
  { type:"function", name:"allowance", stateMutability:"view", inputs:[{type:"address"},{type:"address"}], outputs:[{type:"uint256"}] },
  { type:"function", name:"approve", stateMutability:"nonpayable", inputs:[{type:"address"},{type:"uint256"}], outputs:[{type:"bool"}] },
] as const;

const quoterAbi = [
  { type:"function", name:"quoteExactInputSingle", stateMutability:"nonpayable",
    inputs:[{type:"tuple",components:[
      {name:"tokenIn",type:"address"},{name:"tokenOut",type:"address"},
      {name:"amountIn",type:"uint256"},{name:"fee",type:"uint24"},
      {name:"sqrtPriceLimitX96",type:"uint160"}]}],
    outputs:[{name:"amountOut",type:"uint256"},{name:"a",type:"uint160"},{name:"b",type:"uint32"},{name:"c",type:"uint256"}] },
] as const;

// SwapRouter02 exactInputSingle (no deadline in this variant)
const routerAbi = [
  { type:"function", name:"exactInputSingle", stateMutability:"payable",
    inputs:[{type:"tuple",components:[
      {name:"tokenIn",type:"address"},{name:"tokenOut",type:"address"},{name:"fee",type:"uint24"},
      {name:"recipient",type:"address"},{name:"amountIn",type:"uint256"},
      {name:"amountOutMinimum",type:"uint256"},{name:"sqrtPriceLimitX96",type:"uint160"}]}],
    outputs:[{name:"amountOut",type:"uint256"}] },
] as const;

async function main() {
  const amtStr = process.argv[2];
  if (!amtStr || !(parseFloat(amtStr) > 0)) {
    console.error("usage: npx tsx scripts/base-swap-usdc-weth.ts <usdcAmount>");
    process.exit(1);
  }

  const account = privateKeyToAccount(process.env.BASE_TEST_PRIVATE_KEY as `0x${string}`);
  const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
  const amountIn = parseUnits(amtStr, 6);

  console.log(`swap ${amtStr} USDC -> WETH  (wallet ${account.address})\n`);

  // 1. Quote every tier, pick the best output
  let best = { fee: 0, out: 0n };
  for (const fee of FEES) {
    try {
      const { result } = await pub.simulateContract({
        address: QUOTER as `0x${string}`, abi: quoterAbi, functionName: "quoteExactInputSingle",
        args: [{ tokenIn: USDC as `0x${string}`, tokenOut: WETH as `0x${string}`, amountIn, fee, sqrtPriceLimitX96: 0n }],
      });
      const out = result[0] as bigint;
      console.log(`  fee ${(fee/10000).toFixed(2)}% -> ${formatEther(out)} WETH`);
      if (out > best.out) best = { fee, out };
    } catch { console.log(`  fee ${(fee/10000).toFixed(2)}% -> no quote`); }
  }
  if (best.out === 0n) { console.error("no route with liquidity"); process.exit(1); }
  console.log(`\nrouting through ${(best.fee/10000).toFixed(2)}% tier, expecting ${formatEther(best.out)} WETH`);

  // 2. Slippage floor 5% (testnet pools are thin; generous floor)
  const minOut = (best.out * 95n) / 100n;

  // 3. Approve USDC to the router if needed
  const usdc = getContract({ address: USDC as `0x${string}`, abi: erc20, client: { public: pub, wallet } });
  const allowance = await usdc.read.allowance([account.address, ROUTER as `0x${string}`]);
  if (allowance < amountIn) {
    console.log("approving USDC to router...");
    const ah = await usdc.write.approve([ROUTER as `0x${string}`, maxUint256]);
    await pub.waitForTransactionReceipt({ hash: ah });
    console.log("  approved");
  } else {
    console.log("USDC allowance already sufficient");
  }

  // 4. Execute the swap
  console.log("executing swap...");
  const hash = await wallet.writeContract({
    address: ROUTER as `0x${string}`, abi: routerAbi, functionName: "exactInputSingle",
    args: [{
      tokenIn: USDC as `0x${string}`, tokenOut: WETH as `0x${string}`, fee: best.fee,
      recipient: account.address, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n,
    }],
  });
  console.log("tx:", hash, "\nwaiting...");
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log("status:", receipt.status, "| gas used:", receipt.gasUsed.toString());

  const [usdcBal, wethBal, eth] = await Promise.all([
    usdc.read.balanceOf([account.address]),
    pub.readContract({ address: WETH as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [account.address] }),
    pub.getBalance({ address: account.address }),
  ]);
  console.log(`\nUSDC: ${formatUnits(usdcBal, 6)}  WETH: ${formatEther(wethBal as bigint)}  ETH: ${formatEther(eth)}`);
}

main().catch((e) => { console.error("failed:", e instanceof Error ? e.message : String(e)); process.exit(1); });
