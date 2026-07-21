/**
 * PROBE — Trader Joe (LFJ) Liquidity Book on Avalanche Fuji: is the AVAX/USDC
 * market live and liquid, and which USDC does it use (Circle's or TJ's own)?
 * Reads ground truth from chain. Trusts no docs beyond the addresses.
 *
 * Run: npx tsx scripts/traderjoe-lp-probe.ts
 *   (Override RPC: FUJI_RPC=https://... )
 */
import { createPublicClient, http, getContract, parseUnits, formatUnits } from "viem";
import { avalancheFuji } from "viem/chains";

const RPC = process.env.FUJI_RPC || "https://api.avax-test.network/ext/bc/C/rpc";

// From LFJ's official Fuji deployment page
const LB_QUOTER = "0x9A550a522BBaDFB69019b0432800Ed17855A51C3"; // V2.2 Quoter
const TJ_USDC   = "0xB6076C93701D6a07266c31066B298AeC6dd65c2d"; // Trader Joe's test USDC
const CIRCLE_USDC_FUJI = "0x5425890298aed601595a70AB815c96711a31Bc65"; // Circle/CCTP USDC on Fuji
const WAVAX     = "0xd00ae08403B9bbb9124bB305C09058E32C39A48c"; // WAVAX on Fuji (standard)
// Known live pair from LFJ page: AVAX-USDC 20bps (V2.1)
const KNOWN_PAIR = "0x099deb72844417148E8ee4aA6752d138BedE0c39";

const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

// LBPair: read its two tokens + reserves to confirm what it holds and that it has liquidity
const lbPairAbi = [
  { type: "function", name: "getTokenX", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getTokenY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "reserveX", type: "uint128" }, { name: "reserveY", type: "uint128" }] },
  { type: "function", name: "getActiveId", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
] as const;

async function tokenInfo(client: any, addr: string) {
  try {
    const t = getContract({ address: addr as `0x${string}`, abi: erc20Abi, client });
    return { sym: await t.read.symbol(), dec: await t.read.decimals() };
  } catch { return { sym: "?", dec: 0 }; }
}

async function main() {
  const client = createPublicClient({ chain: avalancheFuji, transport: http(RPC) });
  console.log("--- Trader Joe (LFJ) AVAX/USDC LP probe — Fuji ---\nRPC:", RPC, "\n");

  // Inspect the known AVAX-USDC pair directly
  const code = await client.getBytecode({ address: KNOWN_PAIR as `0x${string}` });
  if (!code || code === "0x") {
    console.log(`✗ No contract at known pair ${KNOWN_PAIR}. Pool may have moved.`);
    return;
  }
  console.log(`✓ LBPair contract exists at ${KNOWN_PAIR}`);

  const pair = getContract({ address: KNOWN_PAIR as `0x${string}`, abi: lbPairAbi, client });
  const tokenX = await pair.read.getTokenX();
  const tokenY = await pair.read.getTokenY();
  const xi = await tokenInfo(client, tokenX);
  const yi = await tokenInfo(client, tokenY);
  console.log(`  tokenX: ${xi.sym} (${tokenX})`);
  console.log(`  tokenY: ${yi.sym} (${tokenY})`);

  const [reserveX, reserveY] = await pair.read.getReserves();
  console.log(`  reserveX: ${formatUnits(reserveX, xi.dec)} ${xi.sym}`);
  console.log(`  reserveY: ${formatUnits(reserveY, yi.dec)} ${yi.sym}`);
  const hasLiquidity = reserveX > 0n || reserveY > 0n;
  console.log(`  liquidity: ${hasLiquidity ? "✓ pool has reserves" : "✗ EMPTY pool"}`);
  try {
    const activeId = await pair.read.getActiveId();
    console.log(`  activeId: ${activeId} (pool initialized)`);
  } catch {}

  // Which USDC is in this pair?
  console.log("\n=== USDC IDENTITY CHECK ===");
  const usdcInPair = [tokenX.toLowerCase(), tokenY.toLowerCase()].find(a =>
    a === TJ_USDC.toLowerCase() || a === CIRCLE_USDC_FUJI.toLowerCase());
  if (usdcInPair === TJ_USDC.toLowerCase()) {
    console.log("⚠ Pool uses TRADER JOE's test USDC (0xB607...5c2d), NOT Circle/CCTP USDC.");
    console.log("  => Bridged Circle-USDC can't directly LP here on testnet. Would need a");
    console.log("     Circle-USDC -> TJ-USDC swap on Fuji, OR note as testnet-only (mainnet unifies).");
  } else if (usdcInPair === CIRCLE_USDC_FUJI.toLowerCase()) {
    console.log("✓✓ Pool uses CIRCLE/CCTP USDC — clean, bridged USDC LPs directly!");
  } else {
    console.log("? Neither known USDC matched the pair's tokens — inspect tokenX/tokenY above.");
  }

  console.log("\n=== VERDICT ===");
  console.log(hasLiquidity
    ? "Pool is LIVE with reserves. LP destination exists on Fuji. Remaining build reality:\n  - concentrated-liquidity (LB bins, ERC-1155 positions) = heavier add/remove logic\n  - USDC identity per above dictates whether bridged USDC works directly"
    : "Pool exists but is EMPTY — no liquidity to join meaningfully. Would need seeding.");
}

main().catch((e) => { console.error("Unhandled:", e); process.exit(1); });
