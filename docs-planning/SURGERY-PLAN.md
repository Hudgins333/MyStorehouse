# Storehouse Surgery Plan — Forking arc-commerce

**Date:** May 16, 2026
**Status:** Pre-surgery; reference doc for Week 1 build sequence
**Source:** Fork of `circlefin/arc-commerce` @ `bfea3f8`

This document maps every directory in the inherited arc-commerce codebase to one of three actions: **KEEP**, **ADAPT**, or **STRIP**. It will guide the Week 1 build.

---

## KEEP AS-IS (infrastructure we get for free)

These are good enough that we use them unchanged:

- `lib/circle/developer-controlled-wallets-client.ts` — Circle SDK client initialization
- `lib/supabase/` — Supabase client setup (auth helpers, server/client clients)
- `lib/utils.ts` — Utility helpers
- `lib/chains.ts` — Arc chain configuration
- `proxy.ts` — ngrok webhook tunneling for local dev
- `eslint.config.mjs`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs` — Build tooling
- All `@radix-ui/*`, `@tanstack/*`, `tailwindcss` dependencies in package.json
- `components/` (shadcn/ui primitives that don't reference commerce concepts)

## ADAPT (right shape, wrong content)

These have the architecture we want but the wrong domain model:

- `app/api/circle/` — Circle webhook handler. Adapt to dispatch to Storehouse's Income Classifier instead of credit purchase logic.
- `app/api/wallet/` — Wallet operations. Adapt to use Storehouse's labeled wallet semantics.
- `app/api/wallet-set/` — Wallet set operations. We already have the set; adapt for query/inspect only.
- `app/api/transactions/` — Transaction CRUD. Adapt to Storehouse's `income_events`, `routing_decisions`, `transfers` tables.
- `app/dashboard/page.tsx` — Main dashboard. Replace credit balance with obligation table + bucket balances + recent income events.
- `app/dashboard/layout.tsx` — Dashboard chrome. Adapt navigation: Dashboard / Obligations / Ledger / Chat.
- `app/dashboard/[txHash]/` — Transaction detail. Adapt to "routing decision detail" view showing LLM reasoning + every leg of the split.
- `lib/circle/initialize-admin-wallet.ts` — Bootstrap script. Rewrite as Storehouse's 5-wallet initialization (or use it just for verifying our existing setup).

## STRIP (commerce-specific, doesn't apply)

These need to go. Either delete the files or empty them and rebuild:

- `app/api/destination-wallet/` — Commerce destination logic, not how Storehouse routes.
- `app/api/openzepellin/` — Defender integration; may revisit for v1.1 but not needed now.
- `lib/circle/permit.ts` — ERC-2612 permit for commerce; revisit for v1.1 Gateway only.
- `lib/mock-data.ts` — Credit purchase mock data; replace with Storehouse seed obligations.
- `app/auth/` (probably) — Multi-user auth UI; v1 is single-user, simplify or remove.

## REPLACE WHOLESALE

These need fresh content from scratch, but the location/file shapes stay:

- All `supabase/migrations/*.sql` — Squash the commerce migrations into one "initial Storehouse schema" migration. Use SPEC.md Section 6 as the source of truth.

## ADD (new files for Storehouse)

These don't exist in arc-commerce and we'll write them in Week 1-3:

- `lib/agents/income-classifier.ts` — Income Classification Agent
- `lib/agents/routing-agent.ts` — Routing Agent with validator
- `lib/agents/conversational-agent.ts` — Conversational Agent
- `lib/agents/validator.ts` — Deterministic plan validator
- `lib/cctp/` — Cross-chain inbound via Bridge Kit SDK
- `app/api/agents/` — API routes for agent operations
- `app/dashboard/obligations/` — Obligation management UI
- `app/dashboard/ledger/` — Full transaction ledger view
- `app/dashboard/chat/` — Conversational Agent chat UI
- `lib/offramp/` — v1.1, sandbox offramp provider integration (Cybrid or Bridge)

## Week 1 Order of Operations

1. Set up Supabase cloud project, get URL + keys
2. Create `.env.local` from `.env.example`, fill from 1Password + Supabase
3. `npm install`
4. Run `npm run dev` to confirm upstream arc-commerce starts up cleanly
5. Squash old migrations: delete all `supabase/migrations/*.sql`, write one new `001_storehouse_initial.sql` based on SPEC.md Section 6
6. Apply new migration to Supabase project
7. Verify tables exist via Supabase dashboard
8. Commit "Initial Storehouse schema migration"
9. Then begin api route adaptations

## Surgery Principles

- **Preserve git history.** When stripping commerce content, commit before and after. Future-you should be able to trace what changed.
- **One concern per commit.** "Strip commerce migrations" is one commit. "Add Storehouse schema" is another. Don't combine.
- **Test after each surgery step.** If we strip something the app relied on, find out immediately, not later.
- **Keep upstream's patterns.** Arc-commerce makes specific choices (Server Actions, Realtime subscriptions, certain auth flows). When in doubt, follow the existing pattern rather than introducing new ones.
