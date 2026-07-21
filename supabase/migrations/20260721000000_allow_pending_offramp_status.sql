-- Allow 'pending_offramp' as a transfers status.
--
-- The executor writes this status for fiat_offramp legs: it records the
-- allocation and stops, since the offramp adapter is deferred to v1.1.
-- The check constraint never permitted it, so every fiat leg failed on
-- insert. This went unnoticed until an inbound was large enough for the
-- routing agent to fund the fixed car-payment obligation — smaller
-- paychecks were correctly reasoned as insufficient and never allocated
-- to it at all.

alter table transfers drop constraint if exists transfers_status_check;

alter table transfers add constraint transfers_status_check
  check (status = any (array[
    'pending'::text,
    'submitted'::text,
    'confirmed'::text,
    'failed'::text,
    'pending_offramp'::text
  ]));
