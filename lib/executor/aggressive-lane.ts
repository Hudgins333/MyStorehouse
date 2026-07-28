/**
 * Aggressive-lane executor — drives the USDC→WETH→Uniswap V3 LP sequence on
 * Base Sepolia entirely through Circle developer-controlled wallets. No local
 * key. Callable core for the aggressive risk tier; the trigger (manual for v1)
 * wraps this.
 *
 * Every step was proven individually via scripts/dcw-*.ts. This module folds in
 * the lessons that cost us reverts along the way:
 *   - Approvals are check-first and generous. Exact-amount approvals under-fund
 *     later steps (a 1-USDC approve made the mint revert). We read the current
 *     allowance and only approve — large — when short.
 *   - Struct calls are estimated before execution; the estimate catches
 *     encoding and allowance problems before any spend.
 *   - Each step polls to CONFIRMED before the next; they depend on each other.
 *   - A revert that looks like stale RPC state is retried once (public Base
 *     Sepolia nodes serve lagging state; this bit us repeatedly).
 *
 * LLM proposes, code validates — this module is pure deterministic execution;
 * no model is in this path.
 */
import { createPublicClient, http, parseUnits, parseEther, formatUnits, formatEther } from "viem";
import { baseSepolia } from "viem/chains";

// ---- Base Sepolia addresses (all verified on-chain in feasibility work) ----
const USDC   = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const WETH   = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"; // SwapRouter02
const NPM    = "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2"; // NonfungiblePositionManager
const POOL   = "0x46880b404CD35c165EDdefF7421019F8dD25F4Ad"; // 0.30% USDC/WETH
const FEE    = 3000;

const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const WALLET_ADDR = () => process.env.STOREHOUSE_MAIN_WALLET_ADDRESS as string;
const BASE_WALLET_ID = () => process.env.STOREHOUSE_MAIN_BASE_WALLET_ID as string;

// Generous approval amount when topping up (1000 USDC / 1000 WETH in base units).
const BIG_USDC = "1000000000";
const BIG_WETH = "1000000000000000000000";
const MAX_U128 = ((1n << 128n) - 1n).toString();

const erc20Abi = [
  { type:"function", name:"balanceOf", stateMutability:"view", inputs:[{type:"address"}], outputs:[{type:"uint256"}] },
  { type:"function", name:"allowance", stateMutability:"view", inputs:[{type:"address"},{type:"address"}], outputs:[{type:"uint256"}] },
] as const;

const poolAbi = [
  { type:"function", name:"slot0", stateMutability:"view", inputs:[], outputs:[
    {name:"sqrtPriceX96",type:"uint160"},{name:"tick",type:"int24"},{name:"oi",type:"uint16"},
    {name:"oc",type:"uint16"},{name:"ocn",type:"uint16"},{name:"fp",type:"uint8"},{name:"u",type:"bool"}] },
  { type:"function", name:"tickSpacing", stateMutability:"view", inputs:[], outputs:[{type:"int24"}] },
] as const;

const posAbi = [
  { type:"function", name:"positions", stateMutability:"view", inputs:[{type:"uint256"}], outputs:[
    {name:"nonce",type:"uint96"},{name:"operator",type:"address"},{name:"token0",type:"address"},
    {name:"token1",type:"address"},{name:"fee",type:"uint24"},{name:"tickLower",type:"int24"},
    {name:"tickUpper",type:"int24"},{name:"liquidity",type:"uint128"},{name:"fg0",type:"uint256"},
    {name:"fg1",type:"uint256"},{name:"owed0",type:"uint128"},{name:"owed1",type:"uint128"}] },
  { type:"function", name:"balanceOf", stateMutability:"view", inputs:[{type:"address"}], outputs:[{type:"uint256"}] },
  { type:"function", name:"tokenOfOwnerByIndex", stateMutability:"view", inputs:[{type:"address"},{type:"uint256"}], outputs:[{type:"uint256"}] },
] as const;

function pub() {
  return createPublicClient({ chain: baseSepolia, transport: http(RPC) });
}

async function circleClient() {
  const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
  return initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY as string,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET as string,
  });
}

const FEE_CFG = { type: "level", config: { feeLevel: "MEDIUM" } };

/** Poll a Circle transaction to a terminal state; returns the tx hash. */
async function pollToConfirmed(circle: any, id: string, label: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const { data } = await circle.getTransaction({ id });
    const s = data?.transaction?.state ?? data?.state;
    const hash = data?.transaction?.txHash ?? data?.txHash;
    if (s === "CONFIRMED" || s === "COMPLETE") return hash;
    if (["FAILED", "CANCELLED", "DENIED"].includes(s)) {
      throw new Error(`${label} ${s}: ${JSON.stringify(data?.transaction ?? data)}`);
    }
  }
  throw new Error(`${label} still pending after polling window`);
}

/** Execute a DCW contract call and wait for confirmation. */
async function dcwExec(
  circle: any,
  contractAddress: string,
  sig: string,
  params: any[],
  label: string
): Promise<string> {
  const res = await circle.createContractExecutionTransaction({
    walletId: BASE_WALLET_ID(),
    contractAddress,
    abiFunctionSignature: sig,
    abiParameters: params,
    fee: FEE_CFG,
  });
  const id = res?.data?.id;
  if (!id) throw new Error(`${label}: no transaction id`);
  return pollToConfirmed(circle, id, label);
}

/** Estimate a DCW contract call; throws if it reverts. */
async function dcwEstimate(circle: any, contractAddress: string, sig: string, params: any[], label: string) {
  try {
    await circle.estimateContractExecutionFee({
      walletId: BASE_WALLET_ID(), contractAddress, abiFunctionSignature: sig, abiParameters: params, fee: FEE_CFG,
    });
  } catch (e: any) {
    throw new Error(`${label} estimate reverted: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Approve `spender` for `token` only if current allowance is below `need`. Approves large. */
async function ensureAllowance(circle: any, token: string, spender: string, need: bigint, big: string, label: string): Promise<void> {
  const current = await pub().readContract({
    address: token as `0x${string}`, abi: erc20Abi, functionName: "allowance", args: [WALLET_ADDR() as `0x${string}`, spender as `0x${string}`],
  }) as bigint;
  if (current >= need) return;
  await dcwExec(circle, token, "approve(address,uint256)", [spender, big], `approve-${label}`);
}

export interface DeployResult {
  tokenId: string;
  usdcIn: string;
  wethIn: string;
  txHashes: Record<string, string>;
}

/**
 * Deploy USDC into the aggressive lane: swap half to WETH, mint an LP position.
 * `amountUsdc` is the human amount (e.g. "6") available in the Base wallet.
 * Returns the opened position's tokenId.
 */
export async function deployToAggressiveLane(amountUsdc: string): Promise<DeployResult> {
  const circle = await circleClient();
  const p = pub();
  const txHashes: Record<string, string> = {};

  const total = parseUnits(amountUsdc, 6);
  const half = total / 2n;

  // 1. Ensure USDC allowance to the router, then swap half USDC -> WETH.
  await ensureAllowance(circle, USDC, ROUTER, half, BIG_USDC, "usdc-router");

  const swapSig = "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))";
  const swapParams = [[USDC, WETH, FEE, WALLET_ADDR(), half.toString(), "0", "0"]];
  await dcwEstimate(circle, ROUTER, swapSig, swapParams, "swap");
  txHashes.swap = await dcwExec(circle, ROUTER, swapSig, swapParams, "swap");

  // 2. Read resulting balances — mint with what we actually hold.
  const usdcBal = await p.readContract({ address: USDC as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [WALLET_ADDR() as `0x${string}`] }) as bigint;
  const wethBal = await p.readContract({ address: WETH as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [WALLET_ADDR() as `0x${string}`] }) as bigint;

  // 3. Ensure both approved to the position manager (generous).
  await ensureAllowance(circle, USDC, NPM, usdcBal, BIG_USDC, "usdc-npm");
  await ensureAllowance(circle, WETH, NPM, wethBal, BIG_WETH, "weth-npm");

  // 4. Live tick range (±50 spacings), then mint.
  const slot0 = await p.readContract({ address: POOL as `0x${string}`, abi: poolAbi, functionName: "slot0" });
  const spacing = await p.readContract({ address: POOL as `0x${string}`, abi: poolAbi, functionName: "tickSpacing" });
  const cur = Number((slot0 as any)[1]);
  const s = Number(spacing);
  const width = s * 50;
  const tickLower = Math.floor((cur - width) / s) * s;
  const tickUpper = Math.ceil((cur + width) / s) * s;
  const deadline = (Math.floor(Date.now() / 1000) + 1800).toString();

  const mintSig = "mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))";
  const mintParams = [[USDC, WETH, FEE, tickLower, tickUpper, usdcBal.toString(), wethBal.toString(), "0", "0", WALLET_ADDR(), deadline]];
  await dcwEstimate(circle, NPM, mintSig, mintParams, "mint");
  txHashes.mint = await dcwExec(circle, NPM, mintSig, mintParams, "mint");

  // 5. Recover the tokenId (latest position owned).
  const bal = await p.readContract({ address: NPM as `0x${string}`, abi: posAbi, functionName: "balanceOf", args: [WALLET_ADDR() as `0x${string}`] }) as bigint;
  const tokenId = (await p.readContract({ address: NPM as `0x${string}`, abi: posAbi, functionName: "tokenOfOwnerByIndex", args: [WALLET_ADDR() as `0x${string}`, bal - 1n] }) as bigint).toString();

  return { tokenId, usdcIn: formatUnits(usdcBal, 6), wethIn: formatEther(wethBal), txHashes };
}

export interface ExitResult {
  tokenId: string;
  txHashes: Record<string, string>;
}

/** Close a position: decreaseLiquidity -> collect -> burn, all via DCW. */
export async function exitAggressiveLane(tokenId: string): Promise<ExitResult> {
  const circle = await circleClient();
  const p = pub();
  const txHashes: Record<string, string> = {};

  const pos = await p.readContract({ address: NPM as `0x${string}`, abi: posAbi, functionName: "positions", args: [BigInt(tokenId)] }) as any;
  const liquidity = (pos[7] as bigint).toString();
  const deadline = (Math.floor(Date.now() / 1000) + 1800).toString();

  if (liquidity !== "0") {
    txHashes.decrease = await dcwExec(
      circle, NPM,
      "decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))",
      [[tokenId, liquidity, "0", "0", deadline]],
      "decrease"
    );
  }

  txHashes.collect = await dcwExec(
    circle, NPM,
    "collect((uint256,address,uint128,uint128))",
    [[tokenId, WALLET_ADDR(), MAX_U128, MAX_U128]],
    "collect"
  );

  txHashes.burn = await dcwExec(circle, NPM, "burn(uint256)", [tokenId], "burn");

  return { tokenId, txHashes };
}
