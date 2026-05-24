# Storehouse — Project Status

**Last updated:** May 2026  
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

The car payment obligation routes via sandbox offramp to demonstrate USDC → fiat ACH bill payment. Other obligations (tithe, taxes, savings, operating) stay onchain. This adds the "agent touches the real world" wow factor without expanding scope to production fiat rails.

**Architectural note on chain hop:** Because Arc is a newer chain, the most established offramp providers do not yet accept Arc as a source chain on testnet. The architectural path for the fiat leg is therefore: Arc treasury wallet → CCTP V2 → Base Sepolia → offramp partner → fiat ACH. This reuses the CCTP V2 primitive Storehouse is already building for cross-chain inbound, in reverse. Adds one hop but no new infrastructure dependency.

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

**Storehouse Circle Developer-Controlled Wallets:**
- 5 wallets created on Arc Testnet, one per obligation bucket (main / tithe / tax-escrow / savings / operating)
- Bootstrap script reproducible from `docs-planning/setup/`
- Funded with testnet USDC from Circle faucet

### Offramp partner evaluation

Multiple sandbox offramp providers are under active evaluation to identify the right rail for the fiat-leg obligation. Architecture is partner-agnostic — the executor calls a thin offramp adapter that can be backed by any of several candidate APIs.

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
│   │   ├── initialize-admin-wallet.ts              # to be replaced
│   │   └── permit.ts                               # evaluate for v1.1
│   ├── supabase/             # Supabase clients (keep)
│   ├── chains.ts             # Arc chain config (keep)
│   ├── mock-data.ts          # commerce mock data (replace)
│   └── utils.ts              # utility helpers (keep)
├── notes/                    # research notes
│   ├── agent-stack-reading.md
│   ├── arc-reading.md
│   └── questions.md
├── public/                   # static assets
├── supabase/
│   ├── config.toml           # Supabase project config
│   └── migrations/           # 27 commerce migrations (to be squashed)
├── types/                    # TypeScript types
├── package.json              # Circle SDK, Supabase, Next.js 15, Radix UI, etc.
└── README.md                 # arc-commerce README (will be replaced with Storehouse README)

### Supabase project state

**Tables present (commerce schema applied via migrations):**
- `admin_wallets`
- `credits`
- `transaction_events`
- `transaction_webhook_events`
- `transactions`
- `platform_config` (manually created — see "Issues encountered" below)

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

The credit-purchase platform's sign-up creates customer accounts with their own wallets — completely unrelated to Storehouse's single-user model. We will not use this flow.

### Issue 3: Webhook URL not yet registered with Circle Console

Arc-commerce README mentions registering the ngrok URL at Circle Console → Webhooks. We have not done this. It's blocked behind the bootstrap issue and irrelevant to Storehouse's webhook setup anyway. Storehouse will register its own webhook URL when ready.

### Issue 4: Offramp partner selection in progress

The fiat-leg obligation requires a USDC → ACH offramp rail. Multiple sandbox providers are under evaluation. The integration surface is abstracted behind a thin adapter, so the choice of partner is a swap rather than a rewrite. Selection criteria include sandbox accessibility, API design fit (backend-triggered programmatic flow rather than user-facing widget), source-chain support, and post-hackathon production path.

A final v1 partner decision will be made in Week 1 of the build phase. Until then, a working sandbox path is already validated as a fallback, so the offramp leg is no longer at risk for v1.

---

## What's Next (Build Plan)

### Immediate next moves (Day 1 of build phase)

1. **Disable upstream platform initialization** — comment out the `runPlatformInitialization()` call in wherever it's imported so the app stops trying to bootstrap arc-commerce's admin user on every page load. ~5 min.
2. **Squash commerce migrations** — delete the 27 commerce `.sql` files from `supabase/migrations/`. They live in git history forever. ~5 min.
3. **Write Storehouse initial migration** — translate SPEC.md Section 6 data model into one clean migration file with all Storehouse tables (obligations, buckets, income_events, routing_decisions, transfers, chat_messages, cctp_transfers, gateway_authorizations, offramp_transactions) plus indexes and RLS policies. ~90 min.
4. **Apply Storehouse schema to Supabase** — `npx supabase db push` after dropping the commerce tables in the dashboard. ~10 min.
5. **Verify tables in Supabase Editor** — confirm 9 Storehouse tables exist, commerce tables gone. ~5 min.
6. **Commit everything, push to GitHub** — Day 1 deliverable is "Storehouse has a real database matching the spec." ~5 min.

### Week 1 — Foundation + Cross-chain inbound + Offramp decision

- Replace `lib/circle/initialize-admin-wallet.ts` with Storehouse's own bootstrap script.
- Integrate Bridge Kit SDK for CCTP V2
- Set up watcher addresses on Ethereum Sepolia and Base Sepolia
- Test cross-chain inbound: send testnet USDC from Sepolia → trigger CCTP → verify Arc arrival
- Configure Circle webhook with ngrok URL, verify event delivery to local app
- Finalize offramp partner selection

### Weeks 2–3 — Core agents + UI + Nanopayments swap + Offramp integration

- Income Classifier (Claude API, structured output)
- Routing Agent (Claude API, JSON plan output, deterministic validator)
- Executor using Circle SDK (direct transfers for v1.0)
- Migrate executor to Gateway/Nanopayments authorizations
- Dashboard: obligation table, income events, bucket balances, ledger
- Chat interface for Conversational Agent
- Real-time updates via Supabase subscriptions
- Offramp integration against selected partner's sandbox — wire the chosen rail end-to-end, including the CCTP V2 Arc→Base hop for the fiat-leg obligation. Target: a real working offramp call in the demo, not a deterministic stub.

### Weeks 4–6 — Integration testing + demo polish

- End-to-end test passes: webhook → classification → routing → transfers fire → ledger updated → offramp leg executes against sandbox
- Record demo video (3-4 takes minimum, 60-90 seconds)
- Write architecture diagram
- Write Circle Product Feedback section (compiled from this debugging journey)

### Week 7 — Submission

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
| Single-user for v1 | Avoids MSB regulatory questions. Stay within hackathon's "educational/testnet" scope. |
| Skip LI.FI for v1 | CCTP via Bridge Kit covers cross-chain USDC; LI.FI is post-hackathon roadmap. |
| Fork arc-commerce | Get Circle SDK + Supabase + Webhook scaffolding for free. Replace commerce-specific code. |
| Pivot from upstream bootstrap | Storehouse uses its own init, not arc-commerce's broken admin-wallet bootstrap. |
| Offramp adapter pattern | Partner-agnostic abstraction; partner choice is a swap rather than a rewrite. |
| Arc + CCTP V2 → Base for fiat leg | Bridges to a more widely-supported source chain for offramp. Reuses existing CCTP infrastructure in reverse. |

---

## Resources

- **Spec:** `docs-planning/SPEC.md` (440 lines, locked)
- **Surgery Plan:** `docs-planning/SURGERY-PLAN.md` (keep/adapt/strip mapping)
- **Setup scripts:** `docs-planning/setup/` (Circle wallet bootstrap reference)
- **Notes:** `notes/` (research findings during planning phase)
- **Tithe v0:** https://github.com/Hudgins333/Tithe (deployed at `0x7eB4b1Abb96d6ed089c48219dC3df18d2B7aEf4F`)
- **Storehouse repo:** https://github.com/Hudgins333/storehouse (this repo)
- **Ignyte challenge:** https://app.ignyte.ae/public/challenges/4B436318-C737-F111-9A49-6045BD14D400

--

Glory to King Jesus!
