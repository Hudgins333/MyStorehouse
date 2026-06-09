# Storehouse — Technical Specification

**Status:** Draft v1
**Last updated:** 2026-06-09
**Author:** Greg Hudgins (Hudgins333)
**Submission target:** Ignyte "Stablecoin Commerce Stack Challenge" — Track 4: Best Agentic Economy Experience on Arc

---

## 1. One-Sentence Summary

Storehouse is an autonomous financial agent on Arc that intercepts inbound USDC from any CCTP-supported chain, reasons about the user's registered obligations and priorities, and routes the money to where it's most needed — explaining every decision in plain English.

## 2. The Problem

Most people fail at money management not from lack of income but from allocation cognitive load. By the time a paycheck arrives, the mental work of "what's due, what's owed, what's saved, what's spendable" is too heavy to do well every cycle. So they don't. Tithe gets skipped or shorted. Tax withholding gets neglected by self-employed and 1099 earners. Bills get paid in panic order. Savings goals erode. Discretionary spending eats principal because the principal "feels available" the moment it lands.

Existing tools solve fragments — Mint categorizes, YNAB rules, banks autopay. None reasons about *prioritization* in real time when money arrives. None defends the user's stated stewardship principles against their in-the-moment spending impulses.

## 3. The Solution

A household-CFO agent that:

1. **Holds a registry of the user's obligations** — recurring bills, percentage commitments (tithe, taxes, savings), goal-based targets (emergency fund, sinking funds), with priorities and due dates.
2. **Watches the user's primary USDC wallet** for inbound transactions via Circle webhooks across multiple chains.
3. **Bridges inbound USDC to Arc** via CCTP V2 when income arrives on non-Arc chains.
4. **Reasons about each inbound** — using an LLM — against the obligation registry, current bucket balances, calendar context, and stated priorities.
5. **Routes the funds autonomously** via Circle Gateway / Nanopayments authorizations, splitting one inbound into multiple outbound transfers on Arc.
6. **Explains every decision** in natural language, logged to a persistent ledger the user can browse and audit.
7. **Answers questions** about the user's financial position via chat: "Can I afford X?" "What's pressing this month?" "Why did you route my last paycheck that way?"

## 4. Out of Scope (v1)

Explicitly NOT in v1:

- Yield protocol integration (Aave/Morpho deposits) — deferred to v2 pending live Arc deployments
- Multi-recipient splits on a single obligation leg (e.g., tithe split across multiple charities)
- ERC-8004 agent identity registration — deferred to v2
- Multi-user / SaaS architecture — v1 is single-user (Greg), demo-focused
- Mobile app — web only
- Mainnet — testnet only for hackathon
- Outbound bill pay to real-world destinations as production ACH — v1 uses sandbox offramp provider (Cybrid or Bridge) for one leg
- Couples / shared household routing — deferred to v2
- Any-asset-any-chain inbound (LI.FI integration) — deferred to v2; v1 uses CCTP for USDC cross-chain only

## 5. Architectural Decisions

### 5.1 Custody and Execution Model: Circle Developer-Controlled Wallets + Circle Gateway / Nanopayments

Storehouse uses a two-layer custody + execution model:

**Custody layer — Circle Developer-Controlled Wallets**
- User's primary USDC wallet for inbound receipt
- Bucket destination wallets (tithe wallet, tax escrow wallet, savings wallet, operating wallet) — each a Developer-Controlled Wallet on Arc
- Entity Secret-based key management; keys never exposed to application code
- Native Arc support (`CIRCLE_BLOCKCHAIN=ARC-TESTNET`) — CONFIRMED in console May 14, 2026
- Webhook delivery for inbound events
- Sanctions screening built in

**Execution rail — Circle Gateway with Nanopayments**
- User deposits USDC into their Gateway unified balance once
- All routing transfers execute as Nanopayment authorizations (EIP-3009 signed messages)
- Gas-free routing — every cent of inbound preserved
- Sub-500ms transfer confirmation
- Batched onchain settlement on Arc (invisible to user)
- Recipients withdraw to any Gateway-supported chain when ready

**Why this architecture:**
- Arc is Circle's L1 and Gateway/Nanopayments is Circle's flagship execution rail. Building Storehouse on this stack rather than direct wallet transfers means we play to the chain's strengths rather than fighting them.
- The cognition layer (LLM agents) is identical regardless of execution rail. Decoupling custody from execution lets us reason about the agent loop independently of how transfers happen.
- Sub-cent capable execution opens future Storehouse use cases (micro-tithing on streaming income, agent-to-agent stewardship transfers) that direct USDC transfers can't economically support.

**Alternative considered:** Circle Agent Wallets via CLI. Rejected because they're designed for AI-agent-as-consumer (x402 service purchases by autonomous agents), not user-owned-automation. Storehouse is automation the user owns, not autonomous agency over funds belonging to the AI.

**Alternative considered:** Direct USDC transfers from Developer-Controlled Wallets without Gateway. Used for v1.0 as a stepping-stone implementation while the agent loop is being validated, then migrated to Gateway in v1.1. Rejected as final architecture because (a) it doesn't leverage Circle's stack to its fullest, (b) routing gas accrues on every event, (c) sub-cent and streaming use cases become economically unviable.

### 5.2 Chain: Arc Testnet

Per Circle's `use-smart-contract-platform` skill: "ALWAYS default to Arc Testnet for demos unless specified otherwise." Aligns with hackathon requirements (Track 4 explicitly on Arc).

### 5.3 LLM Provider: Anthropic Claude (Haiku for routine, Sonnet for chat)

- Routing decisions and income classification: Claude Haiku — fast, cheap, deterministic enough for structured output
- User-facing chat (config, advisory): Claude Sonnet — better reasoning for conversational nuance

Rationale: Triple alignment with Anthropic + Circle + Arc. Arc explicitly partners with Anthropic's Claude Agent SDK. Worth namechecking in submission.

### 5.4 Reasoning Pattern: LLM Proposes, Code Validates

The LLM never executes directly. It produces a *proposed allocation plan* (JSON with structure). A deterministic validator checks:

- Amounts sum to inbound amount exactly (no remainder, no overflow)
- No bucket goes negative
- No obligation gets overpaid
- All destination addresses are pre-approved (in user's allowlist)
- No transfers exceed daily/weekly safety caps
- All destination addresses correspond to registered obligations (no routing to addresses not in the obligation table)

Only validated plans execute. Invalid plans get re-prompted with the validation error, max 3 retries, then fall back to a deterministic default rule.

This is the core safety pattern. The LLM brings reasoning; deterministic code enforces correctness. The AI cannot cause financial damage by hallucinating math.

### 5.5 Data Layer: Supabase (Postgres)

- Hosted Postgres + auth + realtime subscriptions
- Used by canonical Circle reference apps (arc-commerce, arc-escrow)
- Ledger queries need real SQL, not JSONL
- Postgres triggers can fire UI updates via Supabase realtime

### 5.6 Frontend: Next.js 14 (App Router) + Tailwind

- Forked from `circlefin/arc-commerce` reference architecture
- Server-rendered for SEO and demo speed
- Tailwind for fast UI iteration

### 5.7 Deployment

- Frontend: Vercel
- Backend (webhook handler, agent runtime): Vercel Functions or a thin Express server on Render/Railway
- Database: Supabase cloud
- LLM: Anthropic API

### 5.8 Execution Rail Migration: v1.0 → v1.1

To manage build risk, the execution rail migrates in two phases:

**v1.0 (Week 1-2):** Routing transfers use direct Circle Developer-Controlled Wallet API calls. Each routing decision triggers N onchain USDC transfers via `transfer()` SDK call. Gas paid in USDC on Arc. This proves the agent reasoning loop end-to-end without coupling early validation to Gateway integration.

**v1.1 (Week 3):** The execution layer migrates from direct transfers to Nanopayment authorizations. The Routing Agent's plan output stays identical — JSON describing destinations and amounts. The Executor changes from "call Circle SDK transfer" to "construct EIP-3009 authorization, sign via Gateway, submit to Nanopayments batch." User-facing experience improves (gas-free, sub-second), agent logic is unchanged.

**Rationale for staging:** Direct transfers are easier to debug. Get the cognition layer right first, then swap execution. If Week 3 slips, ship v1.0 with Nanopayments as the documented v2 roadmap. The submission is still strong because (a) the agent reasoning is the novel piece, and (b) staging demonstrates engineering discipline.

### 5.9 Cross-Chain Inbound via CCTP / Bridge Kit

Storehouse accepts inbound USDC from any CCTP V2-supported chain — Ethereum, Base, Polygon, Arbitrum, Avalanche, Optimism, Solana — not just Arc. Cross-chain inbound is handled via Circle's Cross-Chain Transfer Protocol (CCTP V2) using the Bridge Kit SDK.

**Inbound flow:**
1. Storehouse watches a designated "inbound" address across multiple chains (via Circle webhooks where supported, or chain-level event listeners as fallback)
2. When USDC arrives on a non-Arc chain, Storehouse initiates a CCTP transfer to its Arc wallet
3. CCTP V2 settles to Arc in seconds (Fast Transfer mode where available)
4. Once USDC lands on Arc, the standard routing pipeline triggers — Classification Agent → Routing Agent → Execution

**Why this matters:**
- Most real-world income today is not on Arc. Paychecks arrive on Ethereum, contractor payments on Base, etc.
- Building an Arc-native agent that can only receive USDC already on Arc would be a half-product
- CCTP V2 is Circle's flagship cross-chain primitive; using it demonstrates the agent's chain-agnostic reasoning

**v1.0:** CCTP integration via Bridge Kit SDK. Inbound from Ethereum Sepolia, Base Sepolia, and Arc Testnet (no-op on Arc; Sepolia/Base testnets bridge to Arc). All testnet.

**v1.1:** CCTP-on-mainnet path documented. Production deployment supports mainnet CCTP. Storehouse never holds funds during the bridge — CCTP is atomic burn-and-mint.

**Demo implication:** The "employer paycheck" in the demo arrives on Ethereum Sepolia, not Arc. Storehouse autonomously bridges via CCTP, then routes per obligations. Shows full chain-agnostic agent capability in 90 seconds.

## 6. Data Model

```sql
-- The user's registered obligations
obligations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,                    -- "Tithe", "Car payment", "Tax escrow"
  type TEXT NOT NULL,                    -- 'percentage' | 'fixed' | 'goal'
  amount NUMERIC,                        -- 0.10 for percentage, 450.00 for fixed
  destination_address TEXT NOT NULL,     -- where this money routes
  destination_label TEXT,                -- "Grace Community Church"
  destination_type TEXT NOT NULL,        -- 'onchain' | 'fiat_offramp'
  due_date DATE,                         -- for fixed obligations
  due_recurrence TEXT,                   -- 'monthly' | 'quarterly' | 'annually' | NULL
  priority INTEGER NOT NULL,             -- 1 = highest
  active BOOLEAN DEFAULT TRUE,
  current_period_target NUMERIC,         -- how much should be allocated this period
  current_period_filled NUMERIC,         -- how much already allocated
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

-- Logical money buckets (the destination accounting)
buckets (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  obligation_id UUID REFERENCES obligations(id),
  wallet_address TEXT NOT NULL,
  current_balance NUMERIC NOT NULL DEFAULT 0,
  target_balance NUMERIC                 -- for goal buckets
)

-- Every inbound USDC event
income_events (
  id UUID PRIMARY KEY,
  source_tx_hash TEXT UNIQUE NOT NULL,
  source_address TEXT NOT NULL,
  source_chain TEXT NOT NULL,            -- 'arc-testnet' | 'eth-sepolia' | 'base-sepolia' etc
  amount NUMERIC NOT NULL,
  cctp_required BOOLEAN NOT NULL,        -- true if source_chain != arc
  cctp_transfer_id UUID,                 -- references cctp_transfers if applicable
  classification TEXT,                   -- LLM output: 'paycheck' | 'gift' | 'refund' | 'transfer' | 'unknown'
  classification_confidence NUMERIC,
  classification_reasoning TEXT,         -- LLM's explanation
  received_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL                   -- 'pending' | 'bridging' | 'arrived_on_arc' | 'routed' | 'failed' | 'manual_review'
)

-- The agent's routing decision for each income event
routing_decisions (
  id UUID PRIMARY KEY,
  income_event_id UUID REFERENCES income_events(id),
  plan JSONB NOT NULL,                   -- [{obligation_id, amount, destination_address}, ...]
  llm_reasoning TEXT NOT NULL,           -- the agent's explanation in plain English
  llm_model TEXT NOT NULL,               -- 'claude-haiku-4-5' etc
  validated BOOLEAN NOT NULL,
  validation_errors TEXT[],
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)

-- Individual outbound transfers (one routing_decision → N transfers)
transfers (
  id UUID PRIMARY KEY,
  routing_decision_id UUID REFERENCES routing_decisions(id),
  obligation_id UUID REFERENCES obligations(id),
  destination_address TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  circle_transaction_id TEXT,            -- from Circle API
  tx_hash TEXT,                          -- onchain hash from Arc
  status TEXT NOT NULL,                  -- 'pending' | 'submitted' | 'confirmed' | 'failed'
  created_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ
)

-- Chat history with the agent
chat_messages (
  id UUID PRIMARY KEY,
  role TEXT NOT NULL,                    -- 'user' | 'agent'
  content TEXT NOT NULL,
  tool_calls JSONB,                      -- any actions the agent took
  created_at TIMESTAMPTZ
)

-- CCTP cross-chain inbound transfers
cctp_transfers (
  id UUID PRIMARY KEY,
  income_event_id UUID REFERENCES income_events(id),
  source_chain TEXT NOT NULL,
  source_tx_hash TEXT NOT NULL,
  destination_chain TEXT NOT NULL DEFAULT 'arc-testnet',
  destination_tx_hash TEXT,
  amount NUMERIC NOT NULL,
  burn_tx_hash TEXT,                     -- source-chain burn
  attestation_received BOOLEAN DEFAULT FALSE,
  mint_tx_hash TEXT,                     -- destination-chain mint on Arc
  status TEXT NOT NULL,                  -- 'burn_pending' | 'attestation_pending' | 'mint_pending' | 'complete' | 'failed'
  initiated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
)

-- Nanopayment authorizations (v1.1+)
gateway_authorizations (
  id UUID PRIMARY KEY,
  transfer_id UUID REFERENCES transfers(id),
  eip3009_payload JSONB NOT NULL,        -- the signed authorization
  signature TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  destination_address TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL,
  batch_id TEXT,                         -- assigned by Circle Gateway when batched
  batch_settled_at TIMESTAMPTZ,
  batch_settlement_tx_hash TEXT,         -- onchain settlement hash on Arc
  status TEXT NOT NULL                   -- 'signed' | 'submitted' | 'batched' | 'settled' | 'failed'
)

-- Fiat offramp transactions (one leg of v1)
offramp_transactions (
  id UUID PRIMARY KEY,
  transfer_id UUID REFERENCES transfers(id),
  provider TEXT NOT NULL,                -- 'cybrid' | 'bridge'
  provider_transaction_id TEXT NOT NULL,
  usdc_amount NUMERIC NOT NULL,
  fiat_amount NUMERIC NOT NULL,
  fiat_currency TEXT NOT NULL DEFAULT 'USD',
  destination_account_label TEXT,        -- "Car loan servicer" etc
  status TEXT NOT NULL,                  -- 'initiated' | 'processing' | 'settled' | 'failed'
  initiated_at TIMESTAMPTZ NOT NULL,
  estimated_settlement_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ
)
```

## 7. The Three Agents

Storehouse has three distinct LLM-powered agents, each with a focused role:

### 7.1 Income Classification Agent

**Trigger:** Circle webhook fires for inbound USDC (after CCTP completion if cross-chain)
**Input:** amount, source address, source chain, timestamp, source address history (have we seen them before?)
**Output:** JSON { type, confidence, reasoning }
**Model:** Claude Haiku
**Purpose:** Determine what *kind* of inbound this is so the Routing Agent has context

### 7.2 Routing Agent

**Trigger:** After Income Classification completes
**Input:** classified income event, full obligations table, current bucket balances, today's date, recent routing history
**Output:** JSON allocation plan + plain-English reasoning
**Model:** Claude Haiku
**Purpose:** Decide how to split the inbound across obligations given priorities, due dates, and current state
**Validation:** Plan goes through deterministic validator before execution. Failed validation = re-prompt with error, max 3 retries, then fallback to default rules.

### 7.3 Conversational Agent

**Trigger:** User sends a chat message
**Input:** user message, full obligations table, recent income events, current balances, chat history
**Output:** Natural language response + optional tool calls (add/edit/remove obligation, query state)
**Model:** Claude Sonnet
**Purpose:** Configuration ("set up my tithe at 10%"), advisory ("can I afford X?"), explanation ("why did you route my last paycheck that way?")

**v1 surface & scope (see §13):** In v1 this agent runs on Telegram and handles intake + read-side advisory + explanation. Live config mutation ("set tithe to 12%") is deferred to Phase 2 behind a feature flag, gated by the same propose/validate pattern as routing (§5.4).

## 8. The Demo Flow (60-90 seconds)

This is the demo we shoot for the submission video. Every architectural choice serves this.

> **Surface note (see §13):** The v1 intake surface is the Telegram bot, not an in-dashboard chat, and the dashboard is read-only. Scene 1 below predates that decision and will be revised in a demo-flow pass.

**Scene 1: Setup (10s)**
Open Storehouse dashboard. Empty state.
User: "Hey Storehouse, I want to set up my budget."
Agent: "Sure! What obligations should I track for you?"
User: "10% tithe to my church, 15% tax escrow, $450 car payment due the 15th, $50/month emergency fund target."
Agent: "Got it. I've added 4 obligations. I'll route incoming USDC according to these priorities."
[Dashboard now shows the obligation table populated]

**Scene 2: First income event with cross-chain inbound (25s)**
Title card: "Three days later, payday hits — from Ethereum, not Arc."
USDC sent to Storehouse's watched address on Ethereum Sepolia from "Employer" sender. (We trigger this manually in the demo by sending from a second testnet wallet on Sepolia.)
Dashboard updates in real-time:
- Income event appears: "$2,000 from 0xEmployer on Ethereum Sepolia"
- CCTP transfer initiates: "Bridging to Arc via CCTP V2... burn confirmed... attestation received... mint on Arc complete (12s)"
- Income classification appears: "Paycheck (confidence: 95%)"
- Routing plan appears with reasoning: "Routing $200 to tithe (10%), $300 to tax escrow (15%), $450 to car payment escrow (due in 12 days, top urgency unmet obligation), $50 to emergency fund target, $1,000 to operating."
- 5 Nanopayment authorizations sign in sequence (sub-second each), each showing the signed EIP-3009 payload + destination
- Routing plan status updates to "Authorized — settling in Gateway batch"
- Bucket balances update immediately (Gateway-level)
- Title card: "Cross-chain inbound, reasoned routing, gas-free outbound — fully autonomous"
- Within the demo window, the batch settles and the onchain Arc tx hashes appear, linked to testnet.arcscan.app

**Scene 3: The advisory moment (15s)**
User: "Storehouse, my brother needs $300 for a car repair. Can I help him this month?"
Agent: "Yes — you have $1,000 in operating right now. Helping your brother would leave $700 for the rest of the month, which is below your typical $850 discretionary spend. You'd want to delay the optional emergency-fund boost next paycheck to recover. Want me to flag that?"

**Scene 4: The transparency moment (10s)**
User clicks on the routing decision in the ledger.
Modal shows: full LLM reasoning trail, validated plan, every transfer with onchain tx hash linked to Arc explorer.
Title card: "Every decision, auditable. Every transfer, onchain."

**Scene 5: The thesis (5-10s)**
Voiceover: "Storehouse. Programmable stewardship for the agentic economy. Built on Arc and Circle."
End card.

## 9. Build Sequence

**Week 1 — Foundation + Cross-chain inbound**
- Fork arc-commerce, get it running locally
- Strip commerce-specific code, keep wallet/webhook/Supabase infrastructure
- Define Supabase schema (includes cctp_transfers + source_chain on income_events), run migrations
- Set up basic Next.js shell with dashboard layout placeholder
- Set up Circle Developer-Controlled Wallet on Arc Testnet
- Set up watcher addresses on Ethereum Sepolia and Base Sepolia
- Integrate Bridge Kit SDK for CCTP V2
- Test cross-chain inbound: send testnet USDC from Sepolia → trigger CCTP → verify Arc arrival
- Test webhook delivery on a manual USDC transfer to Arc wallet

**Week 2 — Core agents (no UI yet, direct wallet execution)**
- Build Income Classifier (Claude API, structured output)
- Build Routing Agent (Claude API, JSON plan output, deterministic validator)
- Build deterministic executor using Circle Developer-Controlled Wallets SDK (direct USDC transfers)
- End-to-end test: trigger a webhook manually → classification → routing → transfers fire → ledger updated
- All via API/CLI, no UI yet — agent loop works on direct transfers

**Week 3 — UI + Nanopayments execution swap + Conversational Agent + Offramp**
- Migrate executor from direct transfers to Gateway/Nanopayments authorizations
  - Set up Gateway unified balance for primary wallet
  - Implement EIP-3009 signing
  - Implement Nanopayments authorization submission
  - Verify batched settlement onchain on Arc
- Integrate fiat offramp sandbox (Cybrid or Bridge) for one obligation leg
- Dashboard: obligation table, recent income events, bucket balances, ledger
- Chat interface for Conversational Agent
- Tool calls from chat: add obligation, edit obligation, query state
- Real-time updates via Supabase subscriptions

**Week 4 — Demo polish + submission**
- Record demo video (3-4 takes minimum)
- Write architecture diagram
- Write Circle Product Feedback section (compiled from notes/agent-stack-reading.md)
- Submit to Ignyte

**Total: ~4 weeks of focused work.** Hackathon timeline is 3 months. Buffer included.

## 10. Success Criteria (for Ignyte submission)

- Functional MVP: ✅ inbound USDC routes through full pipeline live on Arc Testnet
- Architecture diagram: ✅ clear visual of all components
- Frontend: ✅ Next.js dashboard with obligation management, ledger, chat
- Backend: ✅ webhook handler, three LLM agents, deterministic executor
- Video demo: ✅ 60-90 second walkthrough hitting the scenes above
- GitHub repo: ✅ public, well-documented, runnable by a judge from clone
- Circle Product Feedback section: ✅ substantive, technical, honest — distinct from generic praise
- Tool coverage: ✅ uses all 5 recommended Track 4 tools (USDC, Circle Wallets, CCTP/Bridge Kit, Circle Gateway, Nanopayments)

## 11. Risks and Open Questions

**R1.** Circle webhook delivery latency on Arc Testnet is unknown. If webhooks lag by >30s, the "live demo" feel suffers. Mitigation: have a manual "process pending inbound" button that polls and triggers if webhook hasn't arrived.

**R2.** LLM might propose invalid plans more often than 3 retries handle. Mitigation: collect failure rate during dev, increase retries or improve prompt structure.

**R3.** Circle Developer-Controlled Wallets may not yet support all Arc Testnet operations we need. Mitigation: confirm via console.circle.com signup — verified May 14, 2026 ✓

**R4.** 4-week build timeline is tight if any single component (webhooks, agent reasoning, UI) blocks. Mitigation: weekly checkpoint, willing to cut Conversational Agent down to advisory-only (drop config-via-chat) if Week 3 slips.

**R5.** Gateway/Nanopayments testnet support on Arc may have gaps we discover during integration. Mitigation: v1.0 is fully functional on direct transfers; v1.1 Nanopayments migration is upside, not requirement. We can ship v1.0 with Nanopayments documented as v2 if blocked.

**R6.** Recipient wallets may not be Gateway-compatible — i.e., the user's church wallet is a plain Arc address, not a Gateway participant. Mitigation: Gateway supports settlement to any onchain address; the recipient doesn't need to be a Gateway participant for the user-side authorization to work. Settlement happens at the batch level to the recipient's onchain address. Verify this assumption in Week 3 first day.

**R7.** CCTP V2 Fast Transfer may not be available on Arc Testnet at hackathon submission time. Mitigation: standard CCTP V2 (slower attestation path) works on testnets; Fast Transfer is upside. Demo accommodates either path with appropriate timing.

**R8.** Offramp provider sandbox access uncertain. Bridge rejected individual application; reapplying with LLC. Cybrid pending. Mitigation: if neither approved by Week 3, ship v1 with offramp leg architecturally implemented but using a deterministic stub for the demo, with submission notes explaining production integration path.

**Open questions:**
- ~~Q1: Confirm Arc Testnet support in Circle Developer-Controlled Wallets~~ ✅ CONFIRMED (May 14, 2026)
- Q2: Verify Circle webhook latency on Arc Testnet — *measure during Week 1 build*
- ~~Q3: Decide on testnet income source~~ ✅ RESOLVED — Ethereum Sepolia as primary inbound chain, demonstrating CCTP flow
- Q4: Confirm Gateway/Nanopayments availability on Arc Testnet — *not visible in console; requires separate access request, deferred to Week 2*
- Q5: Verify Gateway recipient addressing — *deferred until Q4 resolves*
- Q6: Confirm Gateway testnet funding path — *deferred until Q4 resolves*
- Q7: Confirm CCTP V2 Fast Transfer availability on Arc Testnet — *verify during Week 1 Bridge Kit integration*
- Q8: Confirm Cybrid / Bridge.xyz sandbox access for fiat offramp leg — *Bridge rejected individual app, reapply with LLC; Cybrid pending*

## 12. Naming Note

The product is **Storehouse**, rooted in Malachi 3:10. The faith framing is the *why* behind the prioritization logic (stewardship as scriptural discipline), not a wedge in the product description. The README and demo can lead with the stewardship narrative. The technical pitch for judges leads with "household CFO agent" framing — both are true, both serve different audiences.

## 13. Conversational Surface (Telegram v1)

### 13.1 Purpose

Storehouse's conversational surface is how the user talks to the agent in plain language — to set up obligations, to ask what is happening with their money, and to hear the agent explain its own decisions. In v1 this surface is a Telegram bot. Its three responsibilities:

1. Walk a new user through natural-language obligation intake that produces validated rows in the `obligations` table (§6).
2. Answer read-only advisory questions ("what's my balance?", "what's due this month?", "what came in last week?").
3. Explain routing decisions on request ("why did you route last paycheck that way?"), drawing on the stored reasoning in `routing_decisions` (§6).

The surface exists because the worst part of every personal-finance tool is the empty-table problem: a user is dropped in front of a dashboard and told to "configure your obligations." That is exactly the allocation cognitive load Storehouse is built to remove (§2). Conversational intake — "tell me about your bills" — is how a human advisor would do it. The same brain handles ongoing questions, because the value of an agent is that you can ask it things in the moment money decisions actually happen, which is rarely at a desk.

### 13.2 Brain and transport are separate

The Conversational Agent (§7.3, Claude Sonnet) is a transport-agnostic core. It reasons about obligations, balances, and routing history and returns structured responses. Telegram is a thin *adapter* over that core — a mouth, not the product. Nothing in the agent layer knows it is speaking through Telegram specifically.

This is the swappable-adapter pattern applied to the surface (same discipline as the `OfframpAdapter`). It keeps the surface choice a two-way door: Telegram ships in v1 because it is cheap to build, demos cleanly, and matches how the operator already runs agents; a branded PWA or native app can be added later as a second adapter against the same brain, with no change to the agent layer (§13.10). The mass-market surface is expected to evolve toward an owned app; the architecture does not have to change when it does.

### 13.3 Scope (v1)

**In scope:**
- One Telegram bot, registered via BotFather, token in 1Password.
- Hardcoded to a single authorized Telegram user ID (the operator's). All other IDs are rejected with a static message.
- Conversational obligation intake driven by Sonnet, producing validated rows in `obligations`.
- Read-side advisory: balances, what is due, recent activity — all reads, no writes.
- Explanation of routing decisions, drawing on stored `routing_decisions` reasoning.
- A confirmation step before any database write during intake.

**Deferred to Phase 2 (feature-flagged, not abandoned):**
- Live config mutation via chat ("set tithe to 12%"). Sequenced deliberately — see §13.4.
- Routing/push notifications ("paycheck routed: $X to tithe…").
- Multi-tenant support, per-user wallet provisioning, deeplink/invite flows. The single-user assumption (§4) holds for v1.

### 13.4 Why config mutation is deferred, not dropped

Mutation — letting a chat message change financial configuration the agent then acts on — is the one conversational action that *writes* state. It is held behind a feature flag and sequenced into Phase 2 for a deliberate reason, not for lack of time.

The mutation path must ride the same safety discipline as the Routing Agent (§5.4): the LLM proposes a structured change, deterministic code validates it (the field is mutable, the value parses, it falls within the allowed range, and it does not violate a locked constraint such as a tax-escrow instant-withdrawal rule), and only a validated change is written, with a re-prompt loop on invalid output. Building mutation *after* the read-and-explain surface is proven means the highest-stakes write path is added on top of a working, observable foundation rather than alongside it. The interface and the brain are mutation-ready by design; the write path is simply enabled later, behind the flag.

(This also satisfies the contingency anticipated in §11/R4 — advisory-only is the v1 floor, with config-via-chat as a controlled add-on rather than a v1 dependency.)

### 13.5 Conversation design (intake)

Two intake modes, selected automatically from the user's first substantive response.

**Guided mode (default).** One question at a time: greet → first obligation → amount → cadence (monthly, percentage of income, fixed escrow target) → due date or trigger → confirm captured obligation → ask if there is another → loop until "done." Reliable and easy to debug.

**Free-form mode.** If the first message dumps multiple obligations at once ("car payment $487 the 5th, tithe 10%, tax escrow 25%, savings $500/mo, rest is operating"), Sonnet extracts all of them and presents the full list for confirmation before writing. If extraction is ambiguous, the bot falls back to guided mode to fill gaps.

In both modes the final step is a single confirmation showing all captured obligations as a numbered list; the user replies "yes" / "no" / "edit N" to commit, abort, or revise. Only on "yes" does the bot write to `obligations`.

### 13.6 Data-model addition (extends §6)

One new table for the bot's working memory during intake:

```sql
onboarding_sessions (
  id                  UUID PRIMARY KEY,
  telegram_user_id    BIGINT NOT NULL,
  state               TEXT NOT NULL,    -- 'idle' | 'collecting' | 'confirming' | 'complete'
  partial_obligations JSONB,            -- staged obligations before commit
  last_message_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ
)
```

This is working memory between Telegram updates, not the source of truth for obligations — `obligations` (§6) is. `partial_obligations` is discarded on successful commit or session reset. No change to the `obligations` schema itself; a row populated via Telegram is identical to one populated via any future surface.

### 13.7 Architecture

**Telegram webhook endpoint:** `/api/telegram/webhook` (Next.js API route). Receives Telegram update payloads, verifies the secret token in the header, filters by authorized Telegram user ID, and routes to the adapter.

**Telegram adapter → Conversational Agent.** The adapter translates the inbound Telegram update into a transport-neutral message for the Conversational Agent and translates the agent's structured response back into a Telegram Bot API reply. The agent itself is unaware of Telegram. For intake it loads or creates the user's `onboarding_sessions` row and passes the current state and history to Sonnet with the obligation schema in the system prompt; Sonnet returns (a) a next question, (b) a partial obligation to stage, or (c) a final commit instruction. For advisory and explanation, the adapter passes the read query through to the agent, which answers from `obligations`, `buckets`, and `routing_decisions`. Deterministic code — not Sonnet — performs all database access.

**Same safety pattern as the Routing Agent (§5.4).** The LLM proposes structured output; deterministic code validates (amounts parseable, due dates real calendar dates, cadences in the allowed set, no duplicate obligations) before any row is written. Invalid Sonnet outputs trigger a re-prompt up to 3 times, then the bot asks a clarifying question rather than failing silently.

**Conversation state strategy:** stateful via `onboarding_sessions` during intake; advisory and explanation are stateless reads.

### 13.8 Authentication & authorization

- Telegram bot token in 1Password as `Telegram Bot Token — Storehouse`.
- Webhook secret token configured at registration, in 1Password as `Telegram Webhook Secret — Storehouse`, verified on every inbound request.
- Authorized Telegram user ID in `.env.local` as `TELEGRAM_AUTHORIZED_USER_ID`. The handler rejects any update whose `message.from.id` does not match, with: "This bot is in private preview."
- No tokens, no deeplinks, no invite codes for v1.
- When mutation is enabled in Phase 2 it inherits this same single-user gate plus the validation layer in §13.4; it does not widen the auth surface on its own.

### 13.9 Failure modes

- **Sonnet returns malformed JSON:** re-prompt up to 3 times, then ask a plain-English clarifying question.
- **Database write fails:** "couldn't save that just now, try again in a moment," preserving `partial_obligations` so work isn't lost.
- **Telegram delivery fails:** Telegram retries automatically; idempotency via the Telegram update ID against a small dedup cache.
- **User abandons mid-onboarding:** session sits in `collecting` indefinitely; the next message resumes. No timeout cleanup in v1.

### 13.10 Relationship to the dashboard, and the path to an owned surface

For v1 the dashboard is read-only: it renders live balance, obligations, recent activity, and routing reasoning. All conversation — intake, advisory, explanation — happens through the Telegram surface, not the dashboard. This keeps the dashboard simple (Server Components, no client-side fetching) and gives the conversational layer a single home in v1.

The dashboard is also the seed of the eventual owned surface. The expected Phase 3 direction for a mass-market product is a branded PWA built from the existing Next.js dashboard: installable, push-capable, with auth and identity Storehouse controls, running *alongside* the Telegram adapter rather than replacing it. Because the Conversational Agent is transport-agnostic (§13.2), surfacing it inside that PWA is the addition of another adapter, not a re-architecture. v1 deliberately does not build this; it only avoids decisions that would foreclose it.

### 13.11 Demo role

The Telegram bot is the opening of the demo (cf. §8): the operator sends a message, walks through three to four obligations conversationally, confirms, and the view cuts to the dashboard showing those obligations populated. The remainder is the autonomous routing flow and the agent explaining its decisions — including any obligation it deferred and why — read back through the conversational surface and shown on the dashboard. Plain language goes in; structured, reasoned state comes out.

> **Note:** §8's Scene 1 currently depicts in-dashboard chat for setup. That predates this decision; the v1 intake surface is the Telegram bot and the dashboard is read-only. The demo flow in §8 should be revised to match in a later pass.

### 13.12 Non-goals & future work

- **Phase 2 (planned, feature-flagged):** live config mutation via chat (§13.4); routing/push notifications via Telegram.
- **Phase 3 (planned):** branded PWA surface built from the dashboard (§13.10).
- **Post-hackathon, requires analysis:** multi-user support with per-user wallet provisioning (MSB/custody review, cf. §4); migration to an SMS or WhatsApp surface.
- **Out of scope for now:** voice-message intake (transcription) — interesting but unrelated to Track 4.

### 13.13 Build estimate (v1)

Approximately one to one-and-a-half focused days: webhook route + auth (~1h), Telegram adapter + transport-neutral message contract (~1h), `onboarding_sessions` table and queries (~1h), Sonnet extraction prompt iteration (~2h), guided-mode loop (~2h), confirmation/commit path (~1h), free-form mode as a prompt variant (~1h), read-side advisory and explanation against existing data (~2–3h). Mutation is excluded from this estimate (Phase 2). Onboarding feeds the dashboard's data, so it needs to exist before the dashboard is meaningful to demo.

---

*Soli Deo gloria.*
