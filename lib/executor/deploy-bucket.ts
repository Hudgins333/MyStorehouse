/**
 * Connective tissue: deploy a risk-tiered bucket's funds into its lane.
 *
 * Closes the loop from onboarding (which sets risk_tier) to the executor
 * (which runs the lane). For an aggressive bucket: reads the obligation,
 * confirms the tier, bridges USDC from its Arc bucket wallet to the Base DCW
 * wallet via CCTP, waits for arrival, then deploys to the aggressive lane.
 *
 * v1: explicit amount, manual trigger. No "deploy everything" — the caller
 * says how much. Autonomous thresholding is a later layer on top of this.
 *
 * The bridge (Arc->Base) and the lane execution (deploy) were each proven
 * separately; this is the first time they're chained.
 */
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { deployToAggressiveLane, type DeployResult } from "./aggressive-lane";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY) as string
);

const USDC_BASE = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BASE_ADDR = () => process.env.STOREHOUSE_MAIN_WALLET_ADDRESS as string;
const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";

// Map an Arc bucket wallet address to its Circle wallet id (bridge source).
async function walletIdForAddress(address: string): Promise<string> {
  const key = process.env.CIRCLE_API_KEY as string;
  const r = await fetch("https://api.circle.com/v1/w3s/wallets?pageSize=30", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const j = await r.json();
  const w = (j?.data?.wallets ?? []).find(
    (w: any) => w.blockchain === "ARC-TESTNET" && w.address.toLowerCase() === address.toLowerCase()
  );
  if (!w) throw new Error(`no Arc wallet found for ${address}`);
  return w.id;
}

async function baseUsdcBalance(): Promise<bigint> {
  const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  return (await pub.readContract({
    address: USDC_BASE as `0x${string}`,
    abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: [BASE_ADDR() as `0x${string}`],
  })) as bigint;
}

/** Bridge USDC Arc->Base from a specific bucket wallet, into the Base DCW wallet. */
async function bridgeArcToBase(sourceWalletId: string, sourceAddress: string, amount: string): Promise<void> {
  const { BridgeKit, ArcTestnet, BaseSepolia } = (await import("@circle-fin/bridge-kit")) as any;
  const { createCircleWalletsAdapter } = await import("@circle-fin/adapter-circle-wallets");
  const { createViemAdapterFromPrivateKey } = await import("@circle-fin/adapter-viem-v2");

  const sourceAdapter = createCircleWalletsAdapter({
    apiKey: process.env.CIRCLE_API_KEY as string,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
  });
  // Destination adapter: the Base DCW wallet resolves its own address. We use a
  // viem adapter keyed to the Base test key only to satisfy Bridge Kit's need
  // for a destination signer; the recipient is the Base DCW wallet address.
  const destAdapter = createViemAdapterFromPrivateKey({
    privateKey: process.env.BASE_TEST_PRIVATE_KEY as `0x${string}`,
  });

  const kit = new BridgeKit();
  await kit.bridge({
    from: { adapter: sourceAdapter, address: sourceAddress, chain: ArcTestnet },
    to: { adapter: destAdapter, chain: BaseSepolia, recipientAddress: BASE_ADDR() },
    amount,
    token: "USDC",
    config: {},
  });
}

export interface DeployBucketResult {
  obligationId: string;
  bucketName: string;
  bridgedUsdc: string;
  deploy: DeployResult;
}

/**
 * Deploy `amountUsdc` from an aggressive bucket into its lane, bridging from
 * Arc to Base first. Throws if the bucket isn't aggressive.
 */
export async function deployBucket(obligationId: string, amountUsdc: string): Promise<DeployBucketResult> {
  const { data: ob, error } = await supabase
    .from("obligations")
    .select("id,name,risk_tier,destination_address")
    .eq("id", obligationId)
    .single();
  if (error || !ob) throw new Error(`obligation not found: ${error?.message}`);
  if (ob.risk_tier !== "aggressive") {
    throw new Error(`bucket "${ob.name}" is ${ob.risk_tier}, not aggressive — refusing to deploy`);
  }

  console.log(`[deployBucket] ${ob.name} — bridging ${amountUsdc} USDC Arc->Base`);
  const sourceWalletId = await walletIdForAddress(ob.destination_address);

  const before = await baseUsdcBalance();
  await bridgeArcToBase(sourceWalletId, ob.destination_address, amountUsdc);

  // Wait for the bridged USDC to land on Base (CCTP FAST ~10s, poll to be safe).
  console.log("[deployBucket] waiting for USDC on Base...");
  const want = before + BigInt(Math.round(parseFloat(amountUsdc) * 1e6));
  let landed = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const now = await baseUsdcBalance();
    if (now >= want - 10n) { landed = true; console.log(`[deployBucket] arrived: ${formatUnits(now, 6)} USDC on Base`); break; }
  }
  if (!landed) throw new Error("bridged USDC did not arrive on Base within the window");

  console.log("[deployBucket] deploying to aggressive lane...");
  const deploy = await deployToAggressiveLane(amountUsdc);

  return { obligationId: ob.id, bucketName: ob.name, bridgedUsdc: amountUsdc, deploy };
}
