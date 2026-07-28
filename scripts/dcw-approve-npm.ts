import { config } from "dotenv";
config({ path: ".env.local" });
const NPM="0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2";
const TOKENS=[
  ["USDC","0x036CbD53842c5426634e7929541eC2318f3dCF7e","1000000000"],   // 1000 USDC
  ["WETH","0x4200000000000000000000000000000000000006","1000000000000000000"], // 1 WETH
];
async function poll(circle:any,id:string,label:string){
  for(let i=0;i<20;i++){
    await new Promise(r=>setTimeout(r,4000));
    const {data}=await circle.getTransaction({id});
    const s=data?.transaction?.state??data?.state;
    console.log(`  [${label} ${i}] ${s}`);
    if(s==="CONFIRMED"||s==="COMPLETE")return;
    if(["FAILED","CANCELLED","DENIED"].includes(s))throw new Error(`${label} ${s}`);
  }
}
async function main(){
  const walletId=process.env.STOREHOUSE_MAIN_BASE_WALLET_ID!;
  const {initiateDeveloperControlledWalletsClient}=await import("@circle-fin/developer-controlled-wallets");
  const circle=initiateDeveloperControlledWalletsClient({
    apiKey:process.env.CIRCLE_API_KEY as string,
    entitySecret:process.env.CIRCLE_ENTITY_SECRET as string,
  });
  for(const [name,tok,amt] of TOKENS){
    console.log(`approving ${name} to NPM (${amt})...`);
    const res=await circle.createContractExecutionTransaction({
      walletId,contractAddress:tok,
      abiFunctionSignature:"approve(address,uint256)",
      abiParameters:[NPM,amt],
      fee:{type:"level",config:{feeLevel:"MEDIUM"}},
    } as any);
    await poll(circle,res?.data?.id,name);
  }
  console.log("✓ both approved generously to NPM");
}
main().catch(e=>{console.error(e.message);process.exit(1);});
