-- Add status to routing_decisions for explicit lifecycle tracking
--
-- Previously, decision state was inferred from executed_at (null = not yet
-- executed). A status column makes the lifecycle explicit and lets batch/auto
-- runners filter cleanly (e.g. skip 'abandoned').
--
-- Values:
--   pending    - validated, awaiting execution (default)
--   executed   - all legs submitted, decision finalized
--   failed     - execution attempted, one or more legs failed
--   abandoned  - retired without execution (stale plan, superseded)
--
-- Backfill: rows with executed_at set -> 'executed'; the rest stay 'pending'.
-- ---------------------------------------------------------------------------

alter table routing_decisions
  add column if not exists status text not null default 'pending';

update routing_decisions
   set status = 'executed'
 where executed_at is not null;
