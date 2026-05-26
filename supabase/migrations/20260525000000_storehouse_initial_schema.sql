-- Storehouse initial schema migration
--
-- Creates the data model for the autonomous USDC routing agent on Arc.
-- Replaces the upstream arc-commerce schema (transactions/credits/admin_wallets).
--
-- Table summary (9 tables, in dependency order):
--   obligations              - user's registered obligations (tithe, taxes, savings, etc.)
--   buckets                  - logical money buckets, one per obligation
--   income_events            - every inbound USDC event
--   cctp_transfers           - cross-chain bridging (inbound: source -> arc; outbound: arc -> base for fiat leg)
--   routing_decisions        - agent's allocation plan per income event
--   transfers                - individual outbound transfers (one decision -> N transfers)
--   chat_messages            - conversational agent history
--   gateway_authorizations   - Nanopayments / EIP-3009 authorizations (v1.1+)
--   offramp_transactions     - USDC -> fiat ACH leg via offramp partner
--
-- See docs-planning/SPEC.md Section 6 for the canonical data model description.

-- ---------------------------------------------------------------------------
-- Helper function: updated_at trigger
-- ---------------------------------------------------------------------------
-- Used by several tables. Defined first so trigger creation later in this
-- migration never fails with "function does not exist" — the exact failure
-- pattern documented in CIRCLE-FEEDBACK.md as a real issue in the upstream
-- arc-commerce migrations.

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Table: obligations
-- ---------------------------------------------------------------------------
-- The user's registered obligations. The routing agent reads this table on
-- every income event to determine the allocation plan.

CREATE TABLE public.obligations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT NOT NULL,
  type                     TEXT NOT NULL CHECK (type IN ('percentage', 'fixed', 'goal')),
  amount                   NUMERIC NOT NULL,
  destination_address      TEXT NOT NULL,
  destination_label        TEXT,
  destination_type         TEXT NOT NULL CHECK (destination_type IN ('onchain', 'fiat_offramp')),
  due_date                 DATE,
  due_recurrence           TEXT CHECK (due_recurrence IN ('monthly', 'quarterly', 'annually')),
  priority                 INTEGER NOT NULL,
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  current_period_target    NUMERIC,
  current_period_filled    NUMERIC NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_obligations_active_priority
  ON public.obligations(active, priority)
  WHERE active = TRUE;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.obligations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- Table: buckets
-- ---------------------------------------------------------------------------
-- Logical money buckets — one per obligation, holding the running balance
-- destined for that obligation. Wallet address is the on-chain destination.

CREATE TABLE public.buckets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  obligation_id    UUID NOT NULL REFERENCES public.obligations(id) ON DELETE CASCADE,
  wallet_address   TEXT NOT NULL,
  current_balance  NUMERIC NOT NULL DEFAULT 0,
  target_balance   NUMERIC,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_buckets_obligation ON public.buckets(obligation_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- Table: income_events
-- ---------------------------------------------------------------------------
-- Every inbound USDC event captured by the webhook listener. The Income
-- Classification Agent reads from this table; status transitions track the
-- event through bridging (if needed) and routing.
--
-- Note on cctp_required vs cctp_transfer_id:
--   cctp_required is set at insert time based on source_chain (boolean
--     answer to "does this need bridging?")
--   cctp_transfer_id is populated later when the bridge transaction is
--     actually created (the FK to the cctp_transfers row)
--   These track different things and both have value.
--
-- The FK constraint on cctp_transfer_id is added after the cctp_transfers
-- table is defined (below) to break the circular reference cleanly.

CREATE TABLE public.income_events (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_tx_hash              TEXT UNIQUE NOT NULL,
  source_address              TEXT NOT NULL,
  source_chain                TEXT NOT NULL,
  amount                      NUMERIC NOT NULL,
  cctp_required               BOOLEAN NOT NULL,
  cctp_transfer_id            UUID,  -- FK added below after cctp_transfers exists
  classification              TEXT CHECK (classification IN ('paycheck', 'gift', 'refund', 'transfer', 'unknown')),
  classification_confidence   NUMERIC,
  classification_reasoning    TEXT,
  received_at                 TIMESTAMPTZ NOT NULL,
  status                      TEXT NOT NULL CHECK (status IN ('pending', 'bridging', 'arrived_on_arc', 'routed', 'failed', 'manual_review')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_income_events_status ON public.income_events(status);
CREATE INDEX idx_income_events_received ON public.income_events(received_at DESC);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.income_events
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- Table: cctp_transfers
-- ---------------------------------------------------------------------------
-- CCTP V2 cross-chain transfers. Bidirectional:
--   inbound:  source_chain (eth-sepolia, base-sepolia) -> arc-testnet
--             (triggered by incoming USDC on a non-arc chain)
--   outbound: arc-testnet -> base-sepolia
--             (triggered by the fiat-leg obligation; Arc isn't accepted
--              as source by current offramp providers)
--
-- Patches applied vs. original SPEC:
--   - destination_chain: no default (must be explicit per transfer)
--   - income_event_id and transfer_id are both nullable; CHECK constraint
--     enforces exactly one is set. Inbound CCTPs reference an income_event;
--     outbound CCTPs reference a transfer (the offramp leg).

CREATE TABLE public.cctp_transfers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  income_event_id          UUID REFERENCES public.income_events(id) ON DELETE SET NULL,
  transfer_id              UUID,  -- FK added below after transfers table exists
  source_chain             TEXT NOT NULL,
  source_tx_hash           TEXT NOT NULL,
  destination_chain        TEXT NOT NULL,
  destination_tx_hash      TEXT,
  amount                   NUMERIC NOT NULL,
  burn_tx_hash             TEXT,
  attestation_received     BOOLEAN NOT NULL DEFAULT FALSE,
  mint_tx_hash             TEXT,
  status                   TEXT NOT NULL CHECK (status IN ('burn_pending', 'attestation_pending', 'mint_pending', 'complete', 'failed')),
  initiated_at             TIMESTAMPTZ NOT NULL,
  completed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cctp_direction_check CHECK (
    (income_event_id IS NOT NULL AND transfer_id IS NULL) OR  -- inbound
    (income_event_id IS NULL AND transfer_id IS NOT NULL)     -- outbound
  )
);

CREATE INDEX idx_cctp_transfers_status ON public.cctp_transfers(status);
CREATE INDEX idx_cctp_transfers_income_event ON public.cctp_transfers(income_event_id) WHERE income_event_id IS NOT NULL;
CREATE INDEX idx_cctp_transfers_transfer ON public.cctp_transfers(transfer_id) WHERE transfer_id IS NOT NULL;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.cctp_transfers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Add back-reference FK on income_events.cctp_transfer_id now that cctp_transfers exists
ALTER TABLE public.income_events
  ADD CONSTRAINT fk_income_events_cctp_transfer
  FOREIGN KEY (cctp_transfer_id)
  REFERENCES public.cctp_transfers(id)
  ON DELETE SET NULL;

CREATE INDEX idx_income_events_cctp_transfer
  ON public.income_events(cctp_transfer_id)
  WHERE cctp_transfer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Table: routing_decisions
-- ---------------------------------------------------------------------------
-- The Routing Agent's allocation plan for an income event. plan is JSONB
-- holding the list of {obligation_id, amount, destination_address} entries.
-- validated tracks whether deterministic validation passed; validation_errors
-- holds the failure reasons if not.

CREATE TABLE public.routing_decisions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  income_event_id     UUID NOT NULL REFERENCES public.income_events(id) ON DELETE CASCADE,
  plan                JSONB NOT NULL,
  llm_reasoning       TEXT NOT NULL,
  llm_model           TEXT NOT NULL,
  validated           BOOLEAN NOT NULL,
  validation_errors   TEXT[],
  executed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_routing_decisions_income_event ON public.routing_decisions(income_event_id);
CREATE INDEX idx_routing_decisions_created ON public.routing_decisions(created_at DESC);

-- No updated_at trigger: routing decisions are append-only by design.

-- ---------------------------------------------------------------------------
-- Table: transfers
-- ---------------------------------------------------------------------------
-- Individual outbound transfers. One routing_decision produces N transfers
-- (one per obligation in the plan). For v1.0 these are direct Circle
-- transfers; for v1.1 they're backed by gateway_authorizations (below).

CREATE TABLE public.transfers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_decision_id      UUID NOT NULL REFERENCES public.routing_decisions(id) ON DELETE CASCADE,
  obligation_id            UUID NOT NULL REFERENCES public.obligations(id) ON DELETE RESTRICT,
  destination_address      TEXT NOT NULL,
  amount                   NUMERIC NOT NULL,
  circle_transaction_id    TEXT,
  tx_hash                  TEXT,
  status                   TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at             TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transfers_routing_decision ON public.transfers(routing_decision_id);
CREATE INDEX idx_transfers_status ON public.transfers(status);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Add back-reference FK on cctp_transfers.transfer_id now that transfers exists
ALTER TABLE public.cctp_transfers
  ADD CONSTRAINT fk_cctp_transfers_transfer
  FOREIGN KEY (transfer_id)
  REFERENCES public.transfers(id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Table: chat_messages
-- ---------------------------------------------------------------------------
-- Conversational Agent history. tool_calls captures any actions the agent
-- took as a result of the user's message (e.g., updating an obligation,
-- triggering a manual routing decision).

CREATE TABLE public.chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role         TEXT NOT NULL CHECK (role IN ('user', 'agent')),
  content      TEXT NOT NULL,
  tool_calls   JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_created ON public.chat_messages(created_at DESC);

-- No updated_at trigger: chat history is append-only.

-- ---------------------------------------------------------------------------
-- Table: gateway_authorizations
-- ---------------------------------------------------------------------------
-- Circle Gateway / Nanopayments authorizations (v1.1+). For each transfer,
-- Storehouse signs an EIP-3009 payload that Circle batches and settles
-- on-chain in batches. status tracks the journey from signed -> batched ->
-- settled.

CREATE TABLE public.gateway_authorizations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id                 UUID NOT NULL REFERENCES public.transfers(id) ON DELETE CASCADE,
  eip3009_payload             JSONB NOT NULL,
  signature                   TEXT NOT NULL,
  amount                      NUMERIC NOT NULL,
  destination_address         TEXT NOT NULL,
  signed_at                   TIMESTAMPTZ NOT NULL,
  batch_id                    TEXT,
  batch_settled_at            TIMESTAMPTZ,
  batch_settlement_tx_hash    TEXT,
  status                      TEXT NOT NULL CHECK (status IN ('signed', 'submitted', 'batched', 'settled', 'failed')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gateway_authorizations_transfer ON public.gateway_authorizations(transfer_id);
CREATE INDEX idx_gateway_authorizations_status ON public.gateway_authorizations(status);
CREATE INDEX idx_gateway_authorizations_batch ON public.gateway_authorizations(batch_id) WHERE batch_id IS NOT NULL;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.gateway_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- Table: offramp_transactions
-- ---------------------------------------------------------------------------
-- USDC -> fiat ACH transactions via offramp partner.
--
-- Patches applied vs. original SPEC:
--   - provider comment updated to reflect actual candidates (Cybrid abandoned)
--   - provider_metadata JSONB added — partner-specific fields (e.g.
--     bankAccountId for Crossmint, recipient model for Bridge) absorbed here
--     so the table doesn't need a column per partner.
--
-- The Storehouse executor calls an OfframpAdapter (lib/offramp/...) that
-- knows how to translate this row into the partner's API shape.

CREATE TABLE public.offramp_transactions (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id                   UUID NOT NULL REFERENCES public.transfers(id) ON DELETE CASCADE,
  provider                      TEXT NOT NULL,  -- 'coinbase_business' | 'crossmint' | 'bridge' (final v1 choice TBD)
  provider_transaction_id       TEXT NOT NULL,
  provider_metadata             JSONB,  -- partner-specific fields (bankAccountId, recipientId, etc.)
  usdc_amount                   NUMERIC NOT NULL,
  fiat_amount                   NUMERIC NOT NULL,
  fiat_currency                 TEXT NOT NULL DEFAULT 'USD',
  destination_account_label     TEXT,
  status                        TEXT NOT NULL CHECK (status IN ('initiated', 'processing', 'settled', 'failed')),
  initiated_at                  TIMESTAMPTZ NOT NULL,
  estimated_settlement_at       TIMESTAMPTZ,
  settled_at                    TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_offramp_transactions_transfer ON public.offramp_transactions(transfer_id);
CREATE INDEX idx_offramp_transactions_status ON public.offramp_transactions(status);
CREATE INDEX idx_offramp_transactions_provider ON public.offramp_transactions(provider);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.offramp_transactions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security (RLS)
-- ---------------------------------------------------------------------------
-- v1 is single-user. Enable RLS on every table as a defense-in-depth measure,
-- but only define service_role policies for now. When multi-user becomes a
-- real product requirement, per-row owner policies layer on top.
--
-- Principle: don't ship security theater. Today the service role is the only
-- principal that touches these tables (Storehouse's backend uses the service
-- key for all writes). When that changes, the policies change.

ALTER TABLE public.obligations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buckets                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cctp_transfers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routing_decisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_authorizations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offramp_transactions    ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS by default in Supabase (it has the BYPASSRLS
-- attribute), so no explicit policy is needed for backend writes. Anonymous
-- and authenticated roles will have no access until policies are added.
