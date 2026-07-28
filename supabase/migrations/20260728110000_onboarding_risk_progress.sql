-- Transient risk-phase progress for the onboarding conversation.
-- Holds the queue of risk-eligible buckets still to ask about, and the tier
-- currently awaiting consent. Cleared when the session completes.
alter table onboarding_sessions
  add column if not exists risk_progress jsonb;
