# Storehouse — Cross-Chain Yield Feasibility Map & Risk-Tier Architecture

**Status:** Living architecture doc. Captures on-chain probe results and the v1 product
direction for the "Build on Arc" hackathon (Circle × Encode, final submission Aug 9 2026).
Every path below is marked **PROVEN** (validated on-chain), **KILLED** (probed, not viable
on testnet), **LEAD** (partial evidence, execution unproven), or **ROADMAP** (mainnet-only /
future).

**Core principle carried throughout:** *validate deployability, not partnership status.*
Named ≠ deployed ≠ callable ≠ liquid. Every claim here was resolved from on-chain reads
(registry contracts, factory `getPool`, reserve reads), not docs or forums. Testnet APYs and
prices are noise — we demo the mechanism, never the number.

---

## 1. The product this validates

Storehouse's cognition layer (Haiku classify/route + deterministic validator, "LLM proposes /
code validates") stays on **Arc — home base, the brain**. Underneath it sits a **risk-graded
library of validated paths** across chains and protocols. The **user's risk appetite —
captured through the onboarding questioning prompt — selects which paths a bucket may route to.**

The paths are not the product. **Risk-matched autonomous routing across a validated path graph,
with plain-English explanation and consent at every step, is the product.** The moat is the
obligation graph + the risk-graded path graph + LLM matching.

Movement between Arc and destination chains uses **Circle's rails (Pattern A):** CCTP / Bridge Kit
consolidates and moves USDC; Gateway holds a chain-abstracted unified USDC balance. Arc stays the
brain and home; buckets reach live products on other chains and return; as Arc matures and products
deploy natively there, the same logic reroutes home (a `YieldProvider` config change, not a rewrite).

---

## 2. Movement rails — CONFIRMED

- **CCTP (via Bridge Kit)** — point-to-point USDC burn-and-mint. "Iris" = the CCTP attestation
  service. Two speeds: **Standard** (~13–19 min, waits hard finality, no onchain fee) and
  **Fast** (seconds, small onchain fee). `kit.bridge()` wraps approve → burn → attest → mint in
  one call. **DCW-native** and works with Storehouse's unified-EVM-address wallets — no EOA
  delegate needed on this path. This is the workhorse.
- **Gateway** — unified USDC *balance* across chains (<500ms mint to any supported chain, both
  directions). Deposit once, mint anywhere. **Arc testnet is supported.** Note: transferring from
  the Gateway unified balance with an SCA (smart-contract-account) wallet requires registering an
  **EOA delegate** to sign burn intents (EIP-712); without it the only exit is a 7-day trustless
  withdrawal. This delegate requirement is a **Gateway-only** concern — the CCTP path avoids it.
- **They compose (Pattern A):** CCTP consolidates USDC onto a chain → deposit into Gateway →
  unified balance → mint to wherever a product lives. Circle's own reference does exactly this.
- **Solana** is supported by both CCTP and Gateway (testnet too), but is **non-EVM** (Ed25519
  signing, SPL token accounts, separate SDK). → **ROADMAP**, its own integration effort.

---

## 3. The validated path menu (risk-tiered)

### Conservative tier — PROVEN ✅
**USDC → Aave V3 on Base Sepolia (stable lending).**
- Pool (resolved from PoolAddressesProvider `0xd449FeD49d9C443688d6816fE6872F21402e41de`):
  **`0x07eA79F68B2B3df564D0A34F8e19D9B1e339814b`**
- USDC reserve **`0x036CbD53842c5426634e7929541eC2318f3dCF7e`** === **Circle/CCTP USDC on Base
  Sepolia** (on-chain match confirmed — the USDC CCTP delivers is the USDC Aave accepts)
- Supply APY ~1.23% (real, not testnet-distorted), aToken `0xf53B60F4006cab2b3C4688ce41fD5362427A2A66`
- Reserve live/initialized. **Instant-withdrawable** (aToken redeems on demand) — satisfies the
  `instantlyWithdrawable` gate, so this tier is where **tax escrow** can safely go.
- Probe: `scripts/aave-probe.ts`

### Moderate tier — PROVEN ✅
**USDC → WETH → Aave V3 on Base Sepolia (ETH price exposure + lending yield).**
- WETH `0x4200000000000000000000000000000000000006` is a **live Aave reserve**, aToken
  `0x96e32dE4B1d1617B8c2AE13a88B9cC287239b13f`, reserve initialized.
  *(Its shown "70% APY" is a testnet thin-liquidity artifact — meaningless. Mainnet WETH supply
  is ~1–3%. Never show the testnet number.)*
- Swap route USDC→WETH via **Uniswap V3 Base Sepolia**: Factory
  `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24`, QuoterV2 `0xC5290058841028F1614F3A6F0F5816cAd0df5E27`,
  SwapRouter02 `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`. **All 4 fee tiers (0.01/0.05/0.30/1%)
  have live USDC/WETH pools with liquidity — real quotes returned.** *(Testnet prices vary ~16x
  across pools = noise; route through 0.05% or 0.30%; demo the mechanism, never the rate.)*
- Probes: `scripts/aave-weth-probe.ts`, `scripts/usdc-weth-swap-probe.ts`

### Aggressive tier — venue for testnet: Uniswap V3 LP (liquid); preferred venue Aerodrome (ROADMAP)
**USDC → USDC/WETH LP (fee capture + impermanent-loss risk).**
- **Testnet-viable venue: Uniswap V3 USDC/WETH on Base Sepolia** — the 4 pools proven liquid above
  are the LP venue. Concentrated liquidity (NFT positions, tick ranges) → heavier add/remove logic
  (`mint` on NonfungiblePositionManager → `decreaseLiquidity` + `collect` + `burn`). **Execution
  (add/remove round-trip) is UNPROVEN — needs a funded-wallet test, not a read-only probe.**
- **Preferred long-term venue: Aerodrome** — Solidly-style *simple fungible LP* (easy
  add/remove; separate `claimFees`), plus gauges for incentive rewards. **Aerodrome is coming to
  Arc** → ideal for the "build on Base now, reroute to Arc-native as it matures" thesis. BUT: the
  known Aerodrome addresses (PoolFactory `0x420DD381b31aEf6683db6B902084cB0FFECe40Da`, Router
  `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`) are **Base MAINNET**; that factory address is an
  **empty address on Base Sepolia** (0 ETH, no code, no txns — confirmed on BaseScan). Aerodrome on
  Base Sepolia is **NOT confirmed deployed** at known addresses. → **ROADMAP / mainnet + Arc-future.**
- Probe: `scripts/aerodrome-lp-probe.ts` (returned empty — address has no contract on Sepolia)

---

## 4. Killed / stranded paths (probed — do not re-chase on testnet)

- **cbBTC → Moonwell (BTC exposure), Base Sepolia — KILLED.** cbBTC mainnet token and Moonwell
  Comptroller are **absent** on Base Sepolia (mainnet addresses have no code there). Aave-Base has
  only USDC + WETH reserves. cbBTC/Moonwell is **mainnet-only.** Probe: `scripts/cbbtc-probe.ts`
- **Aave V3 on Avalanche Fuji — DEAD.** The candidate PoolAddressesProvider
  `0xc4dCB5126a3AfEd129BC3668Ea19285A9f56D15D` **reverts on `getPool()`**; no maintained
  `AaveV3Fuji` in bgd-labs address-book surfaced. Aave-on-Fuji is deprecated/moved.
  Probe: `scripts/aave-fuji-probe.ts`
- **Trader Joe (LFJ) WAVAX/USDC LP on Fuji — LIVE POOL, but Circle-USDC STRANDED.** The AVAX-USDC
  20bps pool (`0x099deb72844417148E8ee4aA6752d138BedE0c39`) is live with real reserves (~7 WAVAX /
  ~953 USDC). BUT it uses **Trader Joe's own test USDC** (`0xB6076C93701D6a07266c31066B298AeC6dd65c2d`,
  literally "Testnet USDC"), **not** Circle/CCTP Fuji USDC (`0x5425890298aed601595a70AB815c96711a31Bc65`).
  TJ-USDC `mint()` is **owner-only** (owner `0xFFC08538077a0455E0F4077823b1A0E3e18Faf0b`). No liquid
  Circle-USDC↔WAVAX pair on TJ Fuji (the shell pair exists but is empty). **Circle-USDC has no liquid
  market on Fuji** — it's systematically stranded because the Fuji ecosystem standardized on each
  protocol's own test tokens. Probes: `scripts/traderjoe-lp-probe.ts`, `scripts/tj-usdc-mint-probe.ts`,
  `scripts/circle-usdc-avax-route-probe.ts`

**Structural finding:** *Base Sepolia standardized on Circle's actual USDC (so paths there are
clean); Avalanche Fuji did not (so bridged Circle-USDC is stranded).* This is the core reason Base
is the viable yield chain for v1 and Avax is not, on testnet.

---

## 5. Roadmap / mainnet-only venues (real, just not testnet-demoable now)

- **Aerodrome** (Base + coming to Arc) — simple LP, gauges; the preferred aggressive-LP venue once
  on Arc. Reroute target par excellence.
- **cbBTC + Moonwell** (Base mainnet) — BTC-exposure lending leg.
- **AUSD** (Agora's VanEck/State-Street-backed digital dollar) on **Avalanche mainnet** — onboarded
  to Aave V3 Avalanche + BENQI; strong stable-yield venue. Nice-yield stable play Greg flagged.
- **Trader Joe / BENQI** (Avax mainnet) — LP and lending, where canonical USDC unifies.

*All drop in via the swappable `YieldProvider` interface — venue is a config change, not a rewrite.*

---

## 6. Risk elicitation + cautionary-statement consent model

When a user selects an aggressive path, the brain **generates a path-specific, plain-English
cautionary statement** (e.g. impermanent loss for LP: "if AVAX/ETH moves sharply against USDC you
can end up with less dollar value than simply holding — this is impermanent loss") **before** the
irreversible routing choice locks.

Design decisions:
- **Consent gates, not just informs:** explanation is shown, user must **affirmatively acknowledge**
  ("I understand impermanent loss, proceed") before the brain routes. Given faith-stewardship framing
  and potentially less-DeFi-savvy users, affirmative consent is the right posture.
- **Generated for readability, validated for accuracy:** the LLM writes the personalized plain-English
  caution, but it is grounded in / checked against a **vetted risk template per path** — same
  "LLM proposes, code validates" pattern. Guards against a hallucinated or subtly-wrong disclosure,
  which for a consent artifact is worse than a static one.
- **Logged as a consent trail:** store the exact caution shown + timestamp + the user's acknowledgment.
  Matters ethically now and legally if Storehouse ever handles real funds under the LLC.

This makes the risk-appetite product **safe** as well as smart, using capabilities Storehouse already
has (LLM explanation + validate pattern + logging).

---

## 7. v1 design direction

**Concept:** forced two-lane MVP that demonstrates risk-tiered routing without building the full
dynamic engine yet:
- **Conservative lane → Base → Aave lending** (PROVEN; principal-stable; tax-escrow-safe)
- **Aggressive lane → Base → Uniswap V3 USDC/WETH LP** (liquid + token-clean; execution to be
  tested; Aerodrome is the mainnet/Arc upgrade)

Trade-off named: the original idea was *aggressive on a different chain* (Avax) for a "ubiquity"
flourish. On testnet that fails — Circle-USDC is stranded on Fuji. **Keeping both lanes on Base
means both are token-compatible and validate-able end-to-end**, which is worth more than the
geographic flourish. Ubiquity story shifts from "two chains" to **"two primitives on one chain"
(lending vs. LP / market-making)** — still a strong differentiation, arguably cleaner to demo. The
multi-chain reach remains real (movement rails proven) and returns as a mainnet/Arc-native story.

---

## 8. Open frontier (next sessions — NOT read-only probes; these need a funded wallet)

1. **Aggressive-LP execution test.** Fund a Base Sepolia wallet (Circle-USDC + WETH + ETH gas),
   write and run the Uniswap V3 add-liquidity → remove-liquidity round-trip. This is the last thing
   between the aggressive lane and 100%-validated. It is *building*, not probing.
2. **Car-payment fiat off-ramp rail — UNSOLVED, expected hard.** The fiat exit (USDC → ACH/fiat) is
   the gnarliest rail: KYC, banking partners, partner gating (Bridge.xyz LLC-vs-individual history,
   Crossmint CSE gating, Coinbase CDP sandbox as prior v1 candidate). Needs its own dig. Likely
   architecture: Arc → CCTP → destination chain → offramp partner → fiat ACH, behind the
   partner-agnostic `OfframpAdapter`.
3. **Solana leg** (Jupiter swap + Kamino yield) — non-EVM, separate tooling (`@solana/web3.js` +
   Anchor, SPL ATAs, Jupiter quote API, Kamino SDK). v1-add-if-time / v2 material. Its own session.
4. **Avax role, reconsidered** — if a genuine cross-chain-ubiquity demo is still wanted, either seed
   a Circle-USDC pool on Fuji ourselves (honest demo scaffolding) or wait for mainnet where USDC unifies.

---

## 9. Probe artifacts (evidence — commit these)

```
scripts/aave-probe.ts                  # USDC→Aave Base: PROVEN, USDC match, ~1.23%
scripts/aave-weth-probe.ts             # WETH reserve on Aave Base: live
scripts/usdc-weth-swap-probe.ts        # USDC→WETH Uniswap V3: 4 liquid pools
scripts/cbbtc-probe.ts                 # cbBTC/Moonwell Base Sepolia: KILLED (mainnet-only)
scripts/aave-fuji-probe.ts             # Aave Fuji: DEAD (getPool reverts)
scripts/traderjoe-lp-probe.ts          # TJ WAVAX/USDC Fuji: live pool, TJ-USDC not Circle
scripts/tj-usdc-mint-probe.ts          # TJ-USDC: owner-only mint; no Circle↔TJ route
scripts/circle-usdc-avax-route-probe.ts# Circle-USDC↔WAVAX on TJ Fuji: empty (stranded)
scripts/aerodrome-lp-probe.ts          # Aerodrome Base Sepolia: address empty (mainnet-only)
```

These are evidence artifacts (per Engineering Principle §7 — feedback/validation as a strength).
Suggested commit:

```
git add scripts/aave-probe.ts scripts/aave-weth-probe.ts scripts/usdc-weth-swap-probe.ts \
        scripts/cbbtc-probe.ts scripts/aave-fuji-probe.ts scripts/traderjoe-lp-probe.ts \
        scripts/tj-usdc-mint-probe.ts scripts/circle-usdc-avax-route-probe.ts \
        scripts/aerodrome-lp-probe.ts
git commit -m "probes: cross-chain yield feasibility validation across Base + Avax

Validate destination yield venues on-chain before committing build time.

PROVEN (Base Sepolia):
- USDC -> Aave V3 lending: pool 0x07eA79..., USDC reserve === Circle/CCTP USDC,
  supply APY ~1.23%, instant-withdrawable (tax-escrow-safe)
- WETH -> Aave V3: live reserve/aToken (ETH-exposure moderate tier)
- USDC->WETH Uniswap V3: all 4 fee tiers liquid (swap + LP venue)

KILLED / stranded:
- cbBTC/Moonwell absent on Base Sepolia (mainnet-only)
- Aave V3 Fuji provider reverts on getPool (deprecated)
- Trader Joe Fuji WAVAX/USDC live but uses TJ-USDC not Circle USDC; TJ-USDC
  mint owner-only; no liquid Circle-USDC route on Fuji (Circle-USDC stranded)
- Aerodrome known addresses are Base mainnet; empty on Base Sepolia

Structural finding: Base Sepolia standardized on Circle USDC (clean paths);
Fuji did not (bridged Circle-USDC stranded). Base is the v1 yield chain.

To Christ be the Glory."
git push origin master
```

---

## Addendum — July 21, 2026: aggressive lane validated end to end

The open item in §8 ("aggressive-LP execution test") is now closed. A funded
Base Sepolia wallet completed the full Uniswap V3 round-trip: swap into the
pair, mint a concentrated-liquidity position, decrease liquidity, collect, and
burn the position NFT. Capital returned essentially whole.

**All three risk tiers are now proven on Base Sepolia:**

| Tier | Path | Status |
|---|---|---|
| Conservative | USDC → Aave V3 lending | proven (read-only probe) |
| Moderate | USDC → WETH → Aave V3 | proven (read-only probe) |
| Aggressive | USDC → WETH → Uniswap V3 LP | **proven end to end (executed)** |

### What was executed

Test wallet funded from faucets: Base Sepolia ETH (gas) and Circle USDC.
WETH was obtained by swapping USDC rather than wrapping ETH — ETH was the
scarce asset (one faucet drop per day), USDC was not.

1. **Swap** — 5 USDC to 0.00283 WETH via SwapRouter02
   `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`. Quoted all four fee tiers and
   routed through the best (0.30%). Testnet quotes still vary ~3x across tiers;
   the mechanism is what matters, not the rate.
2. **Mint** — position opened in the 0.30% USDC/WETH pool
   `0x46880b404CD35c165EDdefF7421019F8dD25F4Ad`, range ±50 tick spacings around
   the current tick. The pool consumed 3.544379 USDC and 0.002 WETH, returning
   **tokenId 81492**.
3. **decreaseLiquidity**, then **collect**, then **burn**, in that order.

Accounting: 15.000000 USDC in, 14.999999 out (one unit of rounding dust); WETH
returned to within 1 wei. Total gas across the whole sequence, swap included,
was roughly 0.0000056 ETH.

### Finding — the documented position manager address is wrong for Base Sepolia

Uniswap's Base deployments page lists `NonfungiblePositionManager` as
`0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1`. **That address has no contract on
Base Sepolia** — it is the Base mainnet deployment; the table's Sepolia column
did not carry through.

The live Base Sepolia position manager is
**`0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2`**, confirmed on-chain rather than
from documentation: its `factory()` returns the Base Sepolia UniswapV3Factory
`0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` and its `WETH9()` returns canonical
WETH. This is the same class of trap as the Aerodrome addresses in §3 — a
documented address that is real on one network and empty on another. Verifying a
contract's `factory()` against a known-good factory is a cheap, reliable check
and belongs before any state-changing call.

### Operational note — use a dedicated RPC for multi-step sequences

The public `https://sepolia.base.org` endpoint served stale state repeatedly
during this session, and the failure mode is misleading rather than obvious:

- Two transactions failed pre-flight with `STF` (Uniswap's `safeTransferFrom`
  failure) because `eth_estimateGas` simulated against a node that had not yet
  seen the approval block. The allowance was set; the simulation could not see
  it. Both succeeded unchanged on a retry.
- `collect` was mined and **reverted on-chain** for the same reason: gas was
  estimated against pre-`decreaseLiquidity` state, where `tokensOwed` was still
  zero and the cheaper code path applied. It hit the limit executing the real one.
- Balance reads immediately after a confirmed transaction returned the previous
  block's values, unchanged to the last digit.

None of these were contract or logic errors. For any sequence where one
transaction's result feeds the next, use a dedicated RPC (Alchemy/Infura); on the
public endpoint, expect phantom reverts and re-run before debugging.

### What this means for v1

The forced two-lane design in §7 is fully validated:

- **Conservative lane, Base, Aave lending.** Proven, principal-stable,
  instant-withdrawable, tax-escrow-safe.
- **Aggressive lane, Base, Uniswap V3 USDC/WETH LP.** Proven executable,
  token-clean (Circle USDC throughout), liquid, and reversible.

Remaining work on this lane is integration, not validation: driving these calls
from Storehouse's executor with Circle DCW signing rather than a local EOA, and
wiring the movement rail (CCTP/Gateway) that gets USDC from Arc to Base. Both are
distinct sessions. Concentrated-liquidity range selection also remains a real
design decision — this test used a wide range around the current tick, which is
the safe default but not necessarily the right strategy.

Execution artifacts added:

- `scripts/base-wallet-balance.ts` — ETH, USDC and WETH on the test wallet
- `scripts/base-swap-usdc-weth.ts` — quote all fee tiers, route the best, swap
- `scripts/base-lp-add.ts` — mint a position, print the tokenId
- `scripts/base-lp-remove.ts` — decreaseLiquidity, collect, burn
