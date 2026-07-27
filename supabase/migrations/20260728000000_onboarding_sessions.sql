-- Telegram onboarding surface: the bot's working memory between updates.
-- Not the source of truth for obligations (that stays the obligations table);
-- partial_obligations stages captured rows until the user confirms commit.
-- See SPEC-telegram-addendum.md §11.4.

create table if not exists onboarding_sessions (
  id                  uuid primary key default gen_random_uuid(),
  telegram_user_id    bigint not null,
  state               text not null default 'idle',
  partial_obligations jsonb default '[]'::jsonb,
  last_update_id      bigint,               -- Telegram update dedup
  last_message_at     timestamptz,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  constraint onboarding_sessions_state_check
    check (state = any (array[
      'idle',
      'collecting',
      'confirming',
      'risk',          -- reserved: per-bucket risk-appetite pass (built later)
      'complete'
    ]))
);

-- One active session per Telegram user at a time; look-ups are by user id.
create index if not exists onboarding_sessions_user_idx
  on onboarding_sessions (telegram_user_id, created_at desc);
