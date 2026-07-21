import { createPublicClient, http, getContract } from "viem";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const POOL_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";
const CIRCLE_USDC  = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const WETH         = "0x4200000000000000000000000000000000000006";
const AERO         = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";

// Disambiguate the overloaded getPool by pinning the (address,address,bool) signature only
const factoryAbi = [
  { type: "function", name: "getPool", stateMutability: "view",
    inputs: [{name:"tokenA",type:"address"},{name:"tokenB",type:"address"},{name:"stable",type:"bool"}],
    outputs: [{ type: "address" }] },
  { type: "function", name: "allPoolsLength", stateMutability: "view", inputs: [], outputs: [{type:"uint256"}] },
  { type: "function", name: "allPools", stateMutability: "view", inputs: [{type:"uint256"}], outputs: [{type:"address"}] },
] as const;

const poolAbi = [
  { type: "function", name: "metadata", stateMutability: "view", inputs: [],
    outputs: [{name:"dec0",type:"uint256"},{name:"dec1",type:"uint256"},{name:"r0",type:"uint256"},{name:"r1",type:"uint256"},{name:"st",type:"bool"},{name:"t0",type:"address"},{name:"t1",type:"address"}] },
] as const;
const erc20Abi = [{ type:"function", name:"symbol", stateMutability:"view", inputs:[], outputs:[{type:"string"}] }] as const;

async function sym(c:any,a:string){try{return await getContract({address:a as `0x${string}`,abi:erc20Abi,client:c}).read.symbol();}catch{return a.slice(0,10);}}

async function main() {
  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  console.log("--- Aerodrome LP probe ---\nRPC:", RPC, "\nFactory:", POOL_FACTORY, "\n");
  const factory = getContract({ address: POOL_FACTORY as `0x${string}`, abi: factoryAbi, client });

  // First: how many pools total? (proves factory is readable at all)
  try {
    const n = await factory.read.allPoolsLength();
    console.log("allPoolsLength:", n.toString());
    // Enumerate first N pools and look for USDC pairs
    const total = Number(n);
    console.log(`\n=== scanning all ${total} pools for USDC ===`);
    for (let i = 0; i < total; i++) {
      try {
        const poolAddr = await factory.read.allPools([BigInt(i)]);
        const p = getContract({ address: poolAddr, abi: poolAbi, client });
        const m = await p.read.metadata();
        const s0 = await sym(client, m.t0), s1 = await sym(client, m.t1);
        const hasUsdc = [m.t0.toLowerCase(), m.t1.toLowerCase()].includes(CIRCLE_USDC.toLowerCase());
        const liquid = m.r0 > 0n || m.r1 > 0n;
        if (hasUsdc || /USDC/i.test(s0+s1)) {
          console.log(`  #${i} ${poolAddr}: ${s0}/${s1} ${m.st?"stable":"vol"} reserves=[${m.r0},${m.r1}] ${liquid?"✓LIQUID":"empty"} ${hasUsdc?"[CIRCLE-USDC]":""}`);
        }
      } catch {}
    }
  } catch (e) {
    console.log("allPoolsLength failed — RPC or ABI issue:", e instanceof Error?e.message.split("\n")[0]:e);
    console.log("=> Use the BaseScan browser check instead (readContract on the factory).");
  }
}
main().catch(e => { console.error(e); process.exit(1); });
