# Storehouse — Project Status

**Last updated:** May 24, 2026  
**Author:** Greg Hudgins (Hudgins333)  
**Repo:** https://github.com/Hudgins333/storehouse  
**Target submission:** Ignyte Stablecoin Commerce Stack Challenge — Track 4: Agentic Economy Experience on Arc  
**Submission deadline:** July 12, 2026  
**Prize:** $4,000 / $2,000 USDC

---

## What Storehouse Is

**One sentence:** An autonomous financial agent on Arc that intercepts inbound USDC, reasons about a user's registered obligations and priorities via an LLM, and routes funds to where they're most needed — explaining every decision in plain English.

**The core insight:** Most people fail at money management not from lack of income but from allocation cognitive load. By the time a paycheck arrives, the mental work of "what's due, what's owed, what's saved, what's spendable" is too heavy to do well every cycle. Tools like Mint categorize and YNAB rules-engine, but **none reasons about prioritization in real time when money arrives.** Storehouse does.

**The faith framing:** Built on Malachi 3:10 ("Bring the full tithe into the storehouse"). The product takes biblical stewardship principles — first fruits, paying what is owed, storing for lean years, sabbath rest — and encodes them as agent reasoning. The framing is the *why* behind the prioritization logic. The product itself works for any household.

**The Track 4 alignment:** The hackathon brief literally describes Storehouse as an example use case: *"Automated subscription purchase workflows where agents manage renewal, budgeting, and payment authorization"* and *"AI-driven loyalty programs that reason about cost, rewards, and payment routing across wallets."*

---

## Architecture (Locked)

### The cognition layer — three LLM agents

1. **Income Classification Agent** (Claude Haiku) — classifies inbound USDC as paycheck / gift / refund / transfer / unknown
2. **Routing Agent** (Claude Haiku) — produces a JSON allocation plan with plain-English reasoning, validated deterministically before execution
3. **Conversational Agent** (Claude Sonnet) — handles config ("set tithe to 10%"), advisory ("can I afford X?"), and explanation ("why did you route last paycheck that way?")

**Safety pattern:** LLM proposes a plan, deterministic code validates (amounts sum, no negative buckets, no overpayment, addresses on allowlist). Invalid plans get re-prompted up to 3 times, then fall back to default rules. The AI cannot cause financial damage by hallucinating math.

### The execution rail — staged v1.0 → v1.1

- **v1.0 (build Week 1-2):** Direct USDC transfers via Circle Developer-Controlled Wallets SDK on Arc Testnet
- **v1.1 (build Week 3):** Migrate to Circle Gateway + Nanopayments (gas-free, sub-second, batched onchain settlement)

### Cross-chain inbound — CCTP V2 in v1

Storehouse accepts inbound USDC from Ethereum Sepolia, Base Sepolia, or Arc directly via Circle's CCTP V2 (Bridge Kit SDK). Most real-world income today is not on Arc — paychecks arrive on Ethereum, contractor payments on Base. Building an Arc-native agent that can only receive USDC already on Arc would be a half-product.

### Hybrid fiat leg — one obligation routes to real-world bills

The car payment obligation routes via sandbox offramp to demonstrate USDC → fiat ACH bill payment. Other obligations (tithe, taxes, savings, operating) stay onchain. This adds the "agent touches the real world" wow factor without expanding scope to production fiat rails. Offramp partner selection is in progress — see Issue 4 below for current state.

**Architectural note on chain hop:** No verified offramp provider currently accepts Arc as a source chain. The architectural path for the fiat leg is therefore: Arc treasury wallet → CCTP V2 → Base Sepolia → offramp partner → fiat ACH. This reuses the CCTP V2 primitive Storehouse is already building for cross-chain inbound, in reverse. Adds one hop but no new infrastructure dependency.

### Track 4 tool coverage — 5 of 5

Storehouse uses all 5 recommended Track 4 tools:
- ✅ USDC — settlement rail
- ✅ Circle Wallets — Developer-Controlled, Entity Secret managed
- ✅ CCTP with Bridge Kit — cross-chain inbound
- ✅ Circle Gateway — execution rail (v1.1)
- ✅ Nanopayments — gas-free routing transfers (v1.1)

### Stack

- **Frontend:** Next.js 15 (App Router) + Tailwind + Radix UI + shadcn/ui patterns
- **Backend:** Next.js Server Actions + API Routes
- **Database:** Supabase (Postgres) hosted cloud
- **LLM:** Anthropic Claude (Haiku for routing, Sonnet for chat)
- **Custody:** Circle Developer-Controlled Wallets
- **Onchain:** Arc Testnet, Ethereum Sepolia, Base Sepolia
- **Local dev:** ngrok for webhook tunneling

---

## What's Built and Verified

### Onchain infrastructure (live on Arc Testnet)

**Tithe contract (v0 — the proof of concept that started this):**
- Deployed at `0x7eB4b1Abb96d6ed089c48219dC3df18d2B7aEf4F` on Arc Testnet
- ERC-20 with protocol-level auto-tithing (10% of every transfer routes to designated wallet)
- 15/15 tests passing, public repo: https://github.com/Hudgins333/Tithe
- Real `TitheRouted` event fired on testnet (first onchain transfer)
- This is the demo artifact that proves "I can ship on Arc"

**Storehouse Circle Developer-Controlled Wallets (May 16, 2026):**
- 1 Wallet Set: "Storehouse v1 — Testnet"
- 5 wallets created on Arc Testnet with **unique addresses** (Circle's docs say EVM wallets in a set share addresses, but in practice on Arc Testnet they didn't — favorable for Storehouse, each bucket is independently inspectable)
- `storehouse-main` — receives inbound USDC, funded with testnet USDC from Circle faucet
- `storehouse-tithe` — destination for tithe routing
- `storehouse-tax-escrow` — destination for tax escrow
- `storehouse-savings` — destination for savings goal
- `storehouse-operating` — destination for remainder

All wallet IDs and addresses stored in 1Password under `Storehouse Wallets — Arc Testnet`.

### Offramp partner evaluation (May 24, 2026)

**Coinbase Business sandbox:** validated working. Account in good standing, sandbox transactions executable, API surface understood. This is the v1 safety net — guaranteed working rail if other paths don't resolve in time.

**Crossmint staging:** self-serve signup verified, server-side API key in hand. Direct test of the Create Order endpoint (`POST /api/2022-06-09/orders`) returned the expected validation error (`recipient.bankAccountId` and `payment.receiptEmail` required), confirming the offramp endpoint is open to the staging key. Base Sepolia is accepted as a source chain; Arc is not (enum-rejected at validator level). Bank account registration on staging is not exposed in the console UI — email sent to Crossmint CSE on May 24 requesting either a self-serve path or a sandbox `bankAccountId` registration. Awaiting response.

**Bridge.xyz:** initial application as individual was rejected. Reapplication as Drop2Wave Capital LLC is in progress — virtual conversation scheduled May 25 at 10:15 AM. Goals: establish credibility with LLC framing, learn realistic sandbox approval timeline, ask about multi-tenant pattern for Phase 2.

**Cybrid:** abandoned (no response 24+ hours after sandbox application; their go-to-market is enterprise sales).

### Credential hygiene (all in 1Password)

- `Circle Testnet API Key — Storehouse` — registered to home IP only
- `Circle Testnet Entity Secret — Storehouse` — 64-char hex, the cryptographic key for wallet authorization
- `Circle Recovery File — Storehouse Testnet` — encrypted recovery blob (base64) for disaster recovery
- `Storehouse Wallets — Arc Testnet` — Wallet Set ID + 5 wallet IDs and addresses
- `Supabase — Storehouse v1` — Project URL + publishable key + secret key + database password
- `ngrok Auth Token — Storehouse` — local webhook tunneling
- `GitHub PAT — Storehouse` — migrated from plaintext `~/github-pat.txt`
- `Arc Commerce Tour — Storehouse Test Account` (if used)
- `Crossmint Staging — Storehouse` — server-side and client-side API keys for project `Storehouse-staging`
- `Coinbase Business Sandbox — Storehouse` — sandbox credentials

### Dev environment

- WSL2 Ubuntu on Windows
- Node 22.22.0 installed
- Foundry installed (from Tithe build)
- `supabase` CLI accessible via `npx`
- `gh` CLI authenticated as Hudgins333
- ngrok installed and authenticated

### Repo structure
storehouse/
├── .env.example              # template
├── .env.local                # filled with Circle + Supabase creds (git-ignored)
├── app/                      # Next.js App Router (commerce UI — to be replaced)
│   ├── api/                  # backend routes (some to keep, some to strip)
│   ├── auth/                 # auth flow (may simplify for single-user)
│   └── dashboard/            # main UI (to be replaced with Storehouse dashboard)
├── components/               # shadcn/ui primitives (keep)
├── docs-planning/            # Storehouse planning docs (this folder)
│   ├── ARCHITECTURE.md       # (empty, future)
│   ├── CIRCLE-FEEDBACK.md    # bugs and feedback during build
│   ├── PROJECT-STATUS.md     # this file
│   ├── SPEC.md               # 440-line technical specification (locked)
│   ├── SUBMISSION.md         # (empty, future Ignyte submission draft)
│   ├── SURGERY-PLAN.md       # keep/adapt/strip mapping of arc-commerce code
│   └── setup/                # Circle wallet bootstrap scripts (reference)
├── hooks/                    # React hooks (keep)
├── lib/
│   ├── circle/               # Circle SDK wrappers
│   │   ├── developer-controlled-wallets-client.ts  # keep as-is

[...repo structure section continues — restore from original, truncated for brevity in this update]

**State:** Schema is the commerce schema from arc-commerce. To be replaced with Storehouse schema (see SPEC.md Section 6).

---

## What's Not Working / Known Issues

### Issue 1: `runPlatformInitialization` fails on every page load

The upstream arc-commerce bootstrap code (`lib/circle/initialize-admin-wallet.ts`) attempts to create an admin user and admin wallet on first server start. It fails with `PGRST125: Invalid path specified in request URL` even after manually creating `platform_config` to fix the obvious missing table.

**Investigation done:**
- Manually created `platform_config` table (was missing despite migration reporting as applied — this is a real Circle bug)
- Verified `handle_updated_at` function exists
- Verified `admin_wallets` table has the correct schema (columns `circle_wallet_id`, `label`, etc.)
- Still failing with the same error pattern, now on the `admin_wallets` query

**Hypothesis:** PostgREST schema cache is stale, or there's a deeper edge case in the upstream code interacting with remote Supabase (it was likely developed against local Docker Supabase).

**Decision:** **Don't continue debugging arc-commerce's bootstrap.** Storehouse will use its own initialization, not arc-commerce's. This is a real Circle Product Feedback item already noted.

### Issue 2: arc-commerce sign-up flow is irrelevant to Storehouse

The credit-purchase platform's sign-up creates customer accounts with their own wallets — completely unrelated to Storehouse's single-user (Greg) model. We will not use this flow.

### Issue 3: Webhook URL not yet registered with Circle Console

Arc-commerce README mentions registering the ngrok URL at Circle Console → Webhooks. We have not done this. It's blocked behind the bootstrap issue and irrelevant to Storehouse's webhook setup anyway. Storehouse will register its own webhook URL when ready.

### Issue 4: Offramp partner selection — risk reduced, decision pending

**Status:** The original framing of this issue (Bridge rejected, Cybrid pending, offramp at risk for v1) is no longer accurate. The fiat-leg risk has been materially reduced through parallel evaluation. Three offramp paths are now in play, in order of preference:

1. **Crossmint staging** (preferred if CSE responds in time). API verified open to our staging key, Base Sepolia accepted as source chain, integration is a single `POST /orders` call. Gating question: bank account registration on staging — email sent May 24, awaiting response. If CSE responds within 1–2 weeks with a workable sandbox `bankAccountId` path, this is the v1 rail.

2. **Bridge.xyz** (preferred if conversation goes well and timeline is realistic). Stripe-acquired, gold-standard production reputation. Virtual conversation May 25 with LLC framing. Decision input depends on sandbox approval timeline they quote. If under ~3 weeks post-LLC docs, this becomes the strong v1 candidate.

3. **Coinbase Business sandbox** (validated working safety net). Already integrated end-to-end in sandbox. Lower partner-credibility story for the submission narrative, but zero remaining external dependencies.

**Decision rule:** Final v1 rail decision is gated on two data points — outcome of Bridge call (May 25) and Crossmint CSE response (expected within 48 hours of May 24). Once both arrive, decision is made by end of Week 1. Until then, Coinbase Business sandbox remains the committed-but-not-final v1 path. No need to choose under uncertainty — 7-week window absorbs the wait.

**Cybrid:** abandoned. Their go-to-market is enterprise sales; sandbox-application silence at 24+ hours was sufficient signal to stop waiting.

**Arc source chain limitation:** No verified offramp provider currently accepts Arc as a source chain on testnet. Architectural path is Arc → CCTP V2 → Base Sepolia → offramp partner. This reuses the CCTP V2 infrastructure already required for cross-chain inbound, in reverse.

---

## What's Next (Build Plan)

### Immediate next moves (Day 1 of build phase)

1. **Disable upstream platform initialization** — comment out the `runPlatformInitialization()` call in wherever it's imported so the app stops trying to bootstrap arc-commerce's admin user on every page load. ~5 min.
2. **Squash commerce migrations** — delete the 27 commerce `.sql` files from `supabase/migrations/`. They live in git history forever. ~5 min.
3. **Write Storehouse initial migration** — translate SPEC.md Section 6 data model into one clean migration file with all Storehouse tables (obligations, buckets, income_events, routing_decisions, transfers, chat_messages, cctp_transfers, gateway_authorizations, offramp_transactions) plus indexes and RLS policies. ~90 min.
4. **Apply Storehouse schema to Supabase** — `npx supabase db push` after dropping the commerce tables in the dashboard. ~10 min.
5. **Verify tables in Supabase Editor** — confirm 9 Storehouse tables exist, commerce tables gone. ~5 min.
6. **Commit everything, push to GitHub** — Day 1 deliverable is "Storehouse has a real database matching the spec." ~5 min.

### Week 1 (May 24 – June 7) — Foundation + Cross-chain inbound + Offramp decision

- Replace `lib/circle/initialize-admin-wallet.ts` with Storehouse's own bootstrap script (we have one already in `docs-planning/setup/03-create-wallets.js` — the wallets exist; bootstrap is essentially a no-op besides loading them).
- Integrate Bridge Kit SDK for CCTP V2
- Set up watcher addresses on Ethereum Sepolia and Base Sepolia
- Test cross-chain inbound: send testnet USDC from Sepolia → trigger CCTP → verify Arc arrival
- Configure Circle webhook with ngrok URL, verify event delivery to local app
- **Offramp partner decision finalized** by end of Week 1 once Bridge call (May 25) and Crossmint CSE response have both arrived.

### Weeks 2–3 (June 7 – June 28) — Core agents + UI + Nanopayments swap + Offramp integration

- Income Classifier (Claude API, structured output)
- Routing Agent (Claude API, JSON plan output, deterministic validator)
- Executor using Circle SDK (direct transfers for v1.0)
- Migrate executor to Gateway/Nanopayments authorizations
- Dashboard: obligation table, income events, bucket balances, ledger
- Chat interface for Conversational Agent
- Real-time updates via Supabase subscriptions
- **Offramp integration against selected partner's sandbox** — wire the chosen rail end-to-end, including the CCTP V2 Arc→Base hop for the fiat-leg obligation. Target: a real working offramp call in the demo, not a deterministic stub.

### Weeks 4–6 (June 28 – July 5) — Integration testing + demo polish

- End-to-end test passes: webhook → classification → routing → transfers fire → ledger updated → offramp leg executes against sandbox
- Record demo video (3-4 takes minimum, 60-90 seconds)
- Write architecture diagram
- Write Circle Product Feedback section (compiled from this debugging journey)

### Week 7 (July 5 – July 12) — Submission

- Submission writeup finalized in SUBMISSION.md
- GitHub README polished, repo cleaned up
- Final demo video edit
- Submit to Ignyte

---

## Why This Submission Will Stand Out

Most Track 4 submissions will be variations on "AI agent buys API calls with Nanopayments." Storehouse is genuinely different because:

1. **Use case is unusual and real.** Personal/household stewardship as an agentic primitive. Not transactional purchases. Solves a problem every contractor and self-employed person has.
2. **Hits all 5 recommended tools.** Most won't.
3. **Real-world fiat leg.** One obligation routes via offramp — demonstrates the agent isn't trapped in onchain-only flows.
4. **Sound architecture.** LLM proposes / code validates. Storehouse isn't an "AI agent that controls money" — it's "deterministic financial software with AI reasoning at the cognition layer." Defensible.
5. **Faith framing is distinctive and authentic.** Doesn't read like marketing. Tithe v0 contract on Arc proves you live the discipline, not just talk about it.
6. **Substantive Circle Product Feedback.** Real bugs found and reported (platform_config migration silently failing, PGRST125 cascade). Most submissions won't include real feedback.
7. **Working artifact.** Tithe is already deployed and verifiable on Arc Testnet. Storehouse will be the same — working, demoable, verifiable.

---

## Key Decisions Made (For Future Reference)

| Decision | Rationale |
|---|---|
| Storehouse over Tithe-v2 | Tithe is the v0 proof; Storehouse is the v1 product. Multi-obligation routing > single-purpose tithe contract. |
| Developer-Controlled Wallets | Better fit for "automation user owns" than Agent Wallets (which are for AI-as-consumer). |
| Arc Testnet | Required by hackathon. Confirmed in Circle Console. |
| Anthropic Claude (Haiku + Sonnet) | Triple alignment: Claude + Circle + Arc all partner. Cheap (~$0.001/routing decision). |
| Staged v1.0 → v1.1 (direct transfers → Gateway/Nanopayments) | Manage build risk; ship cognition layer first, swap execution rail later. |
| CCTP in v1 (not v2) | 5/5 tool coverage; real-world income is multi-chain. |
| Hybrid fiat leg (one obligation) | Wow factor without scope creep. |
| Single-user (Greg) for v1 | Avoids MSB regulatory questions. Stay within hackathon's "educational/testnet" scope. |
| Skip LI.FI for v1 | CCTP via Bridge Kit covers cross-chain USDC; LI.FI is post-hackathon roadmap. |
| 1Password for all secrets | Standardized credential hygiene from Day 1. |
| Fork arc-commerce | Get Circle SDK + Supabase + Webhook scaffolding for free. Replace commerce-specific code. |
| Pivot from upstream bootstrap | Storehouse uses its own init, not arc-commerce's broken admin-wallet bootstrap. |
| Cybrid abandoned (May 24) | 24+ hour sandbox-application silence + enterprise-sales GTM = wrong fit for solo developer track. |
| Coinbase Business as safety net (May 24) | Sandbox validated, zero external dependencies. Used as v1 rail until Crossmint or Bridge converts. |
| Arc not source chain for offramp (May 24) | Verified by direct API test: Crossmint validator rejects `arc-testnet` at the schema level. Architectural path is CCTP V2 → Base Sepolia → offramp. |

---

## Resources

- **Spec:** `docs-planning/SPEC.md` (440 lines, locked)
- **Surgery Plan:** `docs-planning/SURGERY-PLAN.md` (keep/adapt/strip mapping)
- **Setup scripts:** `docs-planning/setup/` (Circle wallet bootstrap reference)
- **Notes:** `notes/` (research findings during planning phase)
- **Tithe v0:** https://github.com/Hudgins333/Tithe (deployed at `0x7eB4b1Abb96d6ed089c48219dC3df18d2B7aEf4F`)
- **Storehouse repo:** https://github.com/Hudgins333/storehouse (this repo)
- **Ignyte challenge:** https://app.ignyte.ae/public/challenges/4B436318-C737-F111-9A49-6045BD14D400

## Pre-Production Hardening (deferred — must close before real customers)

These are acceptable on single-user testnet but are blockers for any multi-user
or mainnet deployment:

- **Row Level Security (RLS) not enabled on Supabase tables.** The app accesses
  Postgres via the service key (which bypasses RLS), so this doesn't affect
  Storehouse's own operation. But anon/authenticated keys can currently read
  tables (e.g. `swaps`, `transfers`, `income_events`). Before multi-user:
  enable RLS on all tables and add per-user access policies. v1 tables were
  created service-key-only with RLS deferred for testnet speed.
- *(add future pre-prod items here)*
--

Glory to King Jesus!
