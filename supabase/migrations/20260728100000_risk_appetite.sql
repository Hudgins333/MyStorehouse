-- Risk-appetite per bucket + consent audit trail.
--
-- risk_tier on obligations records which routing lane a bucket may use.
-- risk_consents is an append-only log: whenever a user selects a tier above
-- conservative, the exact caution they were shown and their acknowledgment are
-- recorded as an event. Consent is history, not a current-state flag — a bucket
-- may change tiers over time and each change is its own consent event.

-- Which lane a bucket routes to. 'conservative' is the safe default; no
-- consent needed. 'moderate' and 'aggressive' require a logged consent.
alter table obligations
  add column if not exists risk_tier text not null default 'conservative'
    constraint obligations_risk_tier_check
    check (risk_tier = any (array['conservative','moderate','aggressive']));

create table if not exists risk_consents (
  id             uuid primary key default gen_random_uuid(),
  obligation_id  uuid not null references obligations(id) on delete cascade,
  telegram_user_id bigint,              -- who acknowledged (single-user v1)
  risk_tier      text not null
    check (risk_tier = any (array['moderate','aggressive'])),
  caution_text   text not null,         -- the EXACT wording shown to the user
  acknowledged_at timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists risk_consents_obligation_idx
  on risk_consents (obligation_id, acknowledged_at desc);
