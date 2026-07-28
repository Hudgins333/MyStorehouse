-- Source of truth for aggressive-lane deployments.
--
-- Lets the auto-deploy background process distinguish idle balance (available
-- to deploy) from balance already in an LP position, and guarantees it never
-- double-deploys the same funds. A row is inserted as 'pending' BEFORE any
-- bridging begins; a concurrent run sees it and skips. It flips to 'active'
-- with the tokenId on success, or 'failed' if the sequence errors.

create table if not exists lane_deployments (
  id             uuid primary key default gen_random_uuid(),
  obligation_id  uuid not null references obligations(id) on delete cascade,
  tier           text not null default 'aggressive'
                   check (tier = any (array['moderate','aggressive'])),
  amount_usdc    numeric not null,          -- amount deployed (bridged)
  token_id       text,                      -- Uniswap position id, set on active
  status         text not null default 'pending'
                   check (status = any (array['pending','active','exited','failed'])),
  tx_hashes      jsonb,                     -- bridge/swap/mint (and exit) hashes
  error          text,                      -- failure reason if status=failed
  created_at     timestamptz not null default now(),
  activated_at   timestamptz,
  exited_at      timestamptz
);

-- Fast lookups: active deployments per obligation (idle-balance math) and the
-- pending guard (is a deployment already in flight for this bucket?).
create index if not exists lane_deployments_obligation_status_idx
  on lane_deployments (obligation_id, status);
