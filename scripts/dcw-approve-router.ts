import { config } from "dotenv";
config({ path: ".env.local" });
const USDC   = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
async function main() {
  const walletId = process.env.STOREHOUSE_MAIN_BASE_WALLET_ID!;
  const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY as string,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
  });
  console.log("approving USDC to router via DCW...");
  const res = await circle.createContractExecutionTransaction({
    walletId, contractAddress: USDC,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [ROUTER, "1000000000"], // 1000 USDC allowance
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } as any);
  const id = res?.data?.id;
  console.log("id:", id, "state:", res?.data?.state);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const { data } = await circle.getTransaction({ id } as any);
    const s = data?.transaction?.state ?? data?.state;
    console.log(`  [${i}] ${s}`);
    if (s === "CONFIRMED" || s === "COMPLETE") { console.log("✓ router approved"); return; }
    if (["FAILED","CANCELLED","DENIED"].includes(s)) { console.error("✗",s); process.exit(1); }
  }
}
main().catch(e=>{console.error(e.message); process.exit(1);});
