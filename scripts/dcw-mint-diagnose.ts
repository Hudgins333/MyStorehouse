import { config } from "dotenv";
config({ path: ".env.local" });
const USDC="0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const WETH="0x4200000000000000000000000000000000000006";
const NPM="0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2";
const FEE=3000;
const ADDR=process.env.STOREHOUSE_MAIN_WALLET_ADDRESS as string;

async function main(){
  const walletId=process.env.STOREHOUSE_MAIN_BASE_WALLET_ID!;
  const {initiateDeveloperControlledWalletsClient}=await import("@circle-fin/developer-controlled-wallets");
  const circle=initiateDeveloperControlledWalletsClient({
    apiKey:process.env.CIRCLE_API_KEY as string,
    entitySecret:process.env.CIRCLE_ENTITY_SECRET as string,
  });
  const sig="mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))";
  const deadline=(Math.floor(Date.now()/1000)+1800).toString();

  // Full-range ticks for spacing 60: nearest usable to MIN/MAX.
  // MIN_TICK=-887272, MAX_TICK=887272; rounded to spacing 60.
  const tests = [
    { label: "tight around current (193680..199740)", lo: 193680, hi: 199740, u:"3000000", w:"1040000000000000" },
    { label: "full-range (-887220..887220)",          lo: -887220, hi: 887220, u:"3000000", w:"1040000000000000" },
  ];

  for (const t of tests) {
    const params=[USDC,WETH,FEE,t.lo,t.hi,t.u,t.w,"0","0",ADDR,deadline];
    console.log(`\n=== ${t.label} ===`);
    try {
      const est=await circle.estimateContractExecutionFee({
        walletId,contractAddress:NPM,abiFunctionSignature:sig,abiParameters:[params],
        fee:{type:"level",config:{feeLevel:"MEDIUM"}},
      } as any);
      console.log("  ✓ estimate OK:",JSON.stringify(est?.data?.medium??est?.data,(_k,v)=>typeof v==="bigint"?v.toString():v));
    } catch(e:any){
      console.log("  ✗ reverted:",e instanceof Error?e.message:String(e));
      if(e?.response?.data) console.log("   detail:",JSON.stringify(e.response.data));
    }
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
