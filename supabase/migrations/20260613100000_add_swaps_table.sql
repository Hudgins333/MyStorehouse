-- Swaps ledger — records USDC->EURC conversions on the savings obligation.
--
-- The savings obligation routes half its confirmed USDC into EURC via Arc
-- App Kit Swap (signing through the Circle developer-controlled savings
-- wallet). This table is an execute+log ledger: one row per swap attempt.
--
-- Safety: the swap runs only AFTER the savings transfer is confirmed and the
-- bucket credited, so the principal is already safe. A failed swap leaves the
-- funds as USDC in the savings wallet (status='failed'); there is no rollback
-- because nothing was ever at risk.
--
-- Target asset is cirBTC (hard-money store) per the product thesis, but the
-- USDC<->cirBTC route is not yet live on Arc Testnet (returns 331001 "No route
-- available"); EURC is the v1 routable target. See docs-planning/CIRCLE-FEEDBACK.md.
--
-- NOTE: RLS intentionally NOT enabled (v1 testnet, service-key-only access).
-- Must enable RLS + per-user policies before any multi-user/mainnet deploy.
-- Tracked in PROJECT-STATUS.md "Pre-Production Hardening".
-- ---------------------------------------------------------------------------

create table if not exists swaps (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid references transfers(id),
  obligation_id uuid references obligations(id),
  token_in text not null,
  token_out text not null,
  amount_in numeric not null,
  amount_out numeric,
  tx_hash text,
  status text not null default 'pending',   -- pending | executed | failed
  error_reason text,
  created_at timestamptz default now(),
  executed_at timestamptz
);
