/**
 * DCW exit — close a Uniswap V3 position on Base Sepolia through the Circle
 * developer-controlled wallet: decreaseLiquidity -> collect -> burn. No local key.
 *
 * Completes the round-trip: proves the aggressive lane can be EXITED through
 * Circle-signed wallets, not just opened. Reads liquidity live so it always
 * decreases the full amount.
 *
 * Run: npx tsx scripts/dcw-execute-exit.ts <tokenId>
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const NPM = "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2";
const ADDR = process.env.STOREHOUSE_MAIN_WALLET_ADDRESS as string;
const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const MAX_U128 = ((1n << 128n) - 1n).toString();

const posAbi = [
  { type:"function", name:"positions", stateMutability:"view", inputs:[{type:"uint256"}], outputs:[
    {name:"nonce",type:"uint96"},{name:"operator",type:"address"},{name:"token0",type:"address"},
    {name:"token1",type:"address"},{name:"fee",type:"uint24"},{name:"tickLower",type:"int24"},
    {name:"tickUpper",type:"int24"},{name:"liquidity",type:"uint128"},{name:"fg0",type:"uint256"},
    {name:"fg1",type:"uint256"},{name:"owed0",type:"uint128"},{name:"owed1",type:"uint128"}]},
] as const;

async function poll(circle:any,id:string,label:string):Promise<string>{
  for(let i=0;i<30;i++){
    await new Promise(r=>setTimeout(r,4000));
    const {data}=await circle.getTransaction({id});
    const s=data?.transaction?.state??data?.state;
    const hash=data?.transaction?.txHash??data?.txHash;
    console.log(`  [${label} ${i}] ${s}${hash?` | ${hash.slice(0,14)}...`:""}`);
    if(s==="CONFIRMED"||s==="COMPLETE")return hash;
    if(["FAILED","CANCELLED","DENIED"].includes(s))throw new Error(`${label} ${s}: ${JSON.stringify(data)}`);
  }
  throw new Error(`${label} pending past window`);
}

async function main(){
  const tokenId=process.argv[2];
  if(!tokenId){console.error("usage: dcw-execute-exit.ts <tokenId>");process.exit(1);}
  const walletId=process.env.STOREHOUSE_MAIN_BASE_WALLET_ID!;

  const pub=createPublicClient({chain:baseSepolia,transport:http(RPC)});
  const {initiateDeveloperControlledWalletsClient}=await import("@circle-fin/developer-controlled-wallets");
  const circle=initiateDeveloperControlledWalletsClient({
    apiKey:process.env.CIRCLE_API_KEY as string,
    entitySecret:process.env.CIRCLE_ENTITY_SECRET as string,
  });

  const pos=await pub.readContract({address:NPM as `0x${string}`,abi:posAbi,functionName:"positions",args:[BigInt(tokenId)]}) as any;
  const liquidity=(pos[7] as bigint).toString();
  console.log(`position ${tokenId} | liquidity ${liquidity}`);
  const deadline=(Math.floor(Date.now()/1000)+1800).toString();

  // 1. decreaseLiquidity — struct (uint256 tokenId, uint128 liquidity, uint256 a0min, uint256 a1min, uint256 deadline)
  if(liquidity!=="0"){
    console.log("\ndecreaseLiquidity...");
    const dec=await circle.createContractExecutionTransaction({
      walletId,contractAddress:NPM,
      abiFunctionSignature:"decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))",
      abiParameters:[[tokenId,liquidity,"0","0",deadline]],
      fee:{type:"level",config:{feeLevel:"MEDIUM"}},
    } as any);
    await poll(circle,dec?.data?.id,"decrease");
  } else console.log("liquidity already 0, skipping decrease");

  // 2. collect — struct (uint256 tokenId, address recipient, uint128 a0max, uint128 a1max)
  console.log("\ncollect...");
  const col=await circle.createContractExecutionTransaction({
    walletId,contractAddress:NPM,
    abiFunctionSignature:"collect((uint256,address,uint128,uint128))",
    abiParameters:[[tokenId,ADDR,MAX_U128,MAX_U128]],
    fee:{type:"level",config:{feeLevel:"MEDIUM"}},
  } as any);
  await poll(circle,col?.data?.id,"collect");

  // 3. burn — uint256 tokenId
  console.log("\nburn...");
  const brn=await circle.createContractExecutionTransaction({
    walletId,contractAddress:NPM,
    abiFunctionSignature:"burn(uint256)",
    abiParameters:[tokenId],
    fee:{type:"level",config:{feeLevel:"MEDIUM"}},
  } as any);
  await poll(circle,brn?.data?.id,"burn");

  console.log("\n✓ POSITION CLOSED via DCW. Full open+close round-trip proven through Circle-signed wallets.");
}

main().catch(e=>{console.error("\n✗ failed:",e instanceof Error?e.message:String(e));process.exit(1);});
