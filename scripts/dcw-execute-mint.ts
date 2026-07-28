/**
 * DCW mint — open a Uniswap V3 USDC/WETH LP position on Base Sepolia,
 * signed through the Circle developer-controlled wallet (no local key).
 *
 * Final execution primitive of the aggressive lane. Reads the pool tick live,
 * builds a ±50-spacing range (proven in base-lp-add.ts), approves WETH to the
 * position manager, then executes mint(). Estimates before executing.
 *
 * Run: npx tsx scripts/dcw-execute-mint.ts <usdcAmount> <wethAmount>
 *   e.g. npx tsx scripts/dcw-execute-mint.ts 3 0.001
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createPublicClient, http, parseUnits, parseEther } from "viem";
import { baseSepolia } from "viem/chains";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const WETH = "0x4200000000000000000000000000000000000006";
const NPM  = "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2";
const POOL = "0x46880b404CD35c165EDdefF7421019F8dD25F4Ad";
const FEE  = 3000;
const WALLET_ADDR = process.env.STOREHOUSE_MAIN_WALLET_ADDRESS as string;
const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";

const poolAbi = [
  { type:"function", name:"slot0", stateMutability:"view", inputs:[], outputs:[
    {name:"sqrtPriceX96",type:"uint160"},{name:"tick",type:"int24"},
    {name:"observationIndex",type:"uint16"},{name:"observationCardinality",type:"uint16"},
    {name:"observationCardinalityNext",type:"uint16"},{name:"feeProtocol",type:"uint8"},{name:"unlocked",type:"bool"}] },
  { type:"function", name:"tickSpacing", stateMutability:"view", inputs:[], outputs:[{type:"int24"}] },
] as const;

async function pollTx(circle: any, id: string, label: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const { data } = await circle.getTransaction({ id });
    const s = data?.transaction?.state ?? data?.state;
    const hash = data?.transaction?.txHash ?? data?.txHash;
    console.log(`  [${label} ${i}] ${s}${hash ? ` | ${hash.slice(0,14)}...` : ""}`);
    if (s === "CONFIRMED" || s === "COMPLETE") return hash;
    if (["FAILED","CANCELLED","DENIED"].includes(s)) throw new Error(`${label} ${s}: ${JSON.stringify(data)}`);
  }
  throw new Error(`${label} still pending after polling window`);
}

async function main() {
  const [usdcStr, wethStr] = process.argv.slice(2);
  if (!usdcStr || !wethStr) { console.error("usage: dcw-execute-mint.ts <usdc> <weth>"); process.exit(1); }
  const walletId = process.env.STOREHOUSE_MAIN_BASE_WALLET_ID!;

  const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY as string,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
  });

  // Live pool tick -> range
  const slot0 = await pub.readContract({ address: POOL as `0x${string}`, abi: poolAbi, functionName: "slot0" });
  const spacing = await pub.readContract({ address: POOL as `0x${string}`, abi: poolAbi, functionName: "tickSpacing" });
  const cur = Number((slot0 as any)[1]);
  const s = Number(spacing);
  const width = s * 50;
  const tickLower = Math.floor((cur - width) / s) * s;
  const tickUpper = Math.ceil((cur + width) / s) * s;
  console.log(`pool tick ${cur}, spacing ${s} -> range [${tickLower}, ${tickUpper}]`);

  const amount0 = parseUnits(usdcStr, 6).toString();   // USDC token0
  const amount1 = parseEther(wethStr).toString();      // WETH token1
  const deadline = (Math.floor(Date.now() / 1000) + 1800).toString();

  // 1. Approve WETH to the position manager (USDC already approved earlier).
  console.log("\napproving WETH to position manager...");
  const wethApprove = await circle.createContractExecutionTransaction({
    walletId, contractAddress: WETH,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [NPM, amount1],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } as any);
  await pollTx(circle, wethApprove?.data?.id, "weth-approve");

  // 2. Mint. Struct fields in ABI order.
  const mintParams = [
    USDC, WETH, FEE,
    tickLower, tickUpper,
    amount0, amount1,
    "0", "0",              // amount0Min, amount1Min — testnet
    WALLET_ADDR, deadline,
  ];
  const sig = "mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))";

  console.log("\nestimating mint...");
  try {
    const est = await circle.estimateContractExecutionFee({
      walletId, contractAddress: NPM, abiFunctionSignature: sig, abiParameters: [mintParams],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    } as any);
    console.log("  estimate ok:", JSON.stringify(est?.data?.medium ?? est?.data, (_k,v)=>typeof v==="bigint"?v.toString():v));
  } catch (e: any) {
    console.error("  ✗ mint estimate reverted:", e instanceof Error ? e.message : String(e));
    if (e?.response?.data) console.error("   ", JSON.stringify(e.response.data));
    process.exit(1);
  }

  console.log("\nexecuting mint...");
  const res = await circle.createContractExecutionTransaction({
    walletId, contractAddress: NPM, abiFunctionSignature: sig, abiParameters: [mintParams],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } as any);
  const hash = await pollTx(circle, res?.data?.id, "mint");
  console.log("\n✓ LP POSITION MINTED via DCW. tx:", hash);
  console.log("The full aggressive lane now runs through Circle-signed wallets, no local key.");
}

main().catch((e) => {
  console.error("\n✗ failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
