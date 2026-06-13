# Storehouse — Yield Strategy

**Status:** Designed, not yet integrated. No liquid lending rail is confirmed
deployed-and-callable on Arc Testnet as of 2026-06-13 (see Deployability below).
This document defines the obligation-aware yield model and the provider-swap
plan so a real lending integration drops in cleanly the moment a rail goes live.

---

## 1. Core principle — yield must be obligation-aware

Storehouse does not chase the highest APY. Each obligation bucket has a different
liquidity profile and risk tolerance, and yield decisions must respect that. A
dollar in tax escrow is owed money the operator may need on short notice; a dollar
in savings is discretionary. They must NOT be treated the same just because both
are USDC sitting idle.

The gate is a single property on every yield venue: **`instantlyWithdrawable`**.

- A venue is `instantlyWithdrawable` only if supplied funds can be redeemed on
  demand without a lockup, redemption window, term, or queue.
- Buckets carry a per-bucket policy for the *minimum* withdrawal guarantee they
  will accept. Tax escrow demands `instantlyWithdrawable === true`. Discretionary
  buckets (savings) may relax this if the operator opts in.

This rules out, regardless of availability, any term-locked or RWA/credit venue
(Maple, Centrifuge, Securitize, tokenized funds) for the obligation buckets —
those carry redemption delays incompatible with obligation-owed money.

## 2. Bucket-by-bucket policy

| Bucket       | Yield eligibility | Rationale |
|--------------|-------------------|-----------|
| Tax Escrow   | **Pinned to `none`** until a deployed venue is BOTH live AND `instantlyWithdrawable`, with a pre-withdrawal liquidity check on every exit. | Owed money. Must be pullable in full on short notice. Even liquid pool lending can gate withdrawals when utilization spikes — unacceptable for taxes. Last bucket to ever earn yield, never the first. |
| Savings      | **First yield candidate.** USDC savings is discretionary, so it is the correct bucket to route into a liquid lending venue once one is callable on Arc. | Discretionary horizon. Already the most active bucket. Half is also diversified to EURC (see swapper); the USDC half is the natural supply candidate. |
| Tithe        | No yield. | Routed out promptly to the tithe destination; not a holding bucket. |
| Operating    | No yield (v1). | Working balance for immediate needs; liquidity-first. |
| Car Payment  | No yield. | Accumulates toward a fixed fiat obligation; offramp-bound, not a yield target. |

**Ordering rule:** savings earns yield before tax escrow, always. Tax escrow only
ever participates behind a hard instant-withdrawal guarantee plus a liquidity check.

## 3. The provider interface (already designed)

Yield is accessed through a swappable `YieldProvider` TypeScript interface so the
venue can change without touching the pipeline. The interface mirrors the standard
enter/exit/balance shape common to lending venues and aggregators:

- `NoneYieldProvider` — no-op default. Funds stay idle USDC. This is the current
  active provider for every bucket.
- `<Venue>YieldProvider` — a real implementation (e.g. Aave, Morpho) wired to a
  deployed pool/vault, exposing `supply` / `withdraw` / `balanceOf` and declaring
  its `instantlyWithdrawable` property honestly.

A bucket's eligible provider is gated by matching the bucket's required withdrawal
guarantee against the provider's declared `instantlyWithdrawable`. A provider that
cannot guarantee instant withdrawal is simply not offered to tax escrow.

## 4. Deployability finding (2026-06-13)

Same discipline as the cirBTC swap and Crossmint offramp probes: **named as an
ecosystem partner is not the same as deployed-and-callable.**

- Arc ecosystem announcements list Borrow/Lend partners (Aave, Maple, Morpho) and
  Yield partners (Centrifuge, Superform, Securitize), plus Euler and Fluid under
  DEX+lending. All are described in partnership/future tense ("integrating",
  "expected to", "deploying test versions — check the ecosystem page").
- The Arc Testnet contract-addresses reference lists USDC, EURC, USYC, CCTP,
  Gateway, StableFX — **no lending pool address.**
- Searches for an Aave (or other) lending pool deployed on Arc Testnet returned
  only deployments on other chains (Polygon, Ethereum). No Arc-testnet pool found.
- **Curve is the only DeFi rail confirmed live on Arc Testnet** (USDC/EURC swaps
  and liquidity) — a DEX, not a lending market. (This is the same App Kit swap
  rail already used for the savings USDC->EURC diversification.)

**Conclusion:** there is no liquid lending venue to supply USDC to on Arc Testnet
today. Yield stays `NoneYieldProvider` for all buckets. This is a deployability
gap, not a design gap.

## 5. Integration targets (when a rail goes live)

- **Aave (gold standard, primary target).** Liquid supply positions: `supply(asset,
  amount, onBehalfOf, referralCode)` mints aTokens; withdraw on demand subject to
  pool liquidity. The cleanest match for the `instantlyWithdrawable` model. Build
  an `AaveYieldProvider` against the Arc pool address the moment one is published.
- **Euler / Fluid (secondary).** Also pool-based liquid lending; viable if they
  deploy a callable USDC market on Arc before Aave does.
- **Crossmint Morpho extension (off-Arc path).** Crossmint offers a "supply USDC
  to Morpho Vaults" extension, but it requires a production API key and USDC on
  Base mainnet — not Arc testnet. Fits the existing `MorphoYieldProvider` stub
  name as a future production path, not a v1 testnet rail.
- **Crossmint / Yield.xyz aggregator (discovery path).** Yield.xyz exposes
  enter/exit/balance APIs over multiple venues with per-opportunity APY and
  enter/exit status — interface-compatible with `YieldProvider`. Production-
  oriented; worth evaluating as a venue-discovery layer if it ever covers Arc.

## 6. Re-test plan

A probe script (sibling to `scripts/swap-probe.ts`) should attempt a read/quote
against a candidate lending pool on Arc Testnet and report deployed/not-deployed.
It returns "not deployed" today; it becomes the green-light test the moment a venue
ships. Until then, yield remains a designed, evidence-backed roadmap item — the
interface is ready, the gate is defined, and the only missing piece is a callable
on-chain venue.

---

*Target asset thesis for savings remains EURC diversification today (routable) and
cirBTC when its route opens. Yield is an orthogonal layer on the USDC that stays in
savings: diversify half to EURC, supply the liquid USDC half once a lending rail is
live.*
