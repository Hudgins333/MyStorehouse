-- Add confirm_transfer() — outbound confirmation + bucket credit
--
-- Closes the back half of the routing loop: when an outbound transfer settles
-- on Arc, mark it confirmed and credit its obligation's bucket. Called by the
-- Circle webhook handler on a confirmed outbound transaction notification
-- (and runnable by hand for backfill, as on 2026-06-09).
--
-- Correctness properties:
--   * Idempotent — credit gated on the state transition (status <> 'confirmed'),
--     so a Circle webhook re-delivery is a no-op; a bucket is never double-credited.
--   * Atomic — transfer update and bucket increment run in one transaction;
--     a missing bucket raises and rolls back, so a confirmed transfer can never
--     exist with an uncredited bucket.
--
-- Returns TRUE if this call performed the confirm+credit, FALSE if no-op
-- (unknown tx id, or already confirmed).
--
-- See docs-planning/SPEC.md Section 6 (transfers, buckets).
-- ---------------------------------------------------------------------------

create or replace function public.confirm_transfer(
  p_circle_transaction_id text,
  p_tx_hash text
)
returns boolean
language plpgsql
as $$
declare
  v_obligation_id uuid;
  v_amount        numeric;
  v_bucket_count  int;
begin
  update transfers
     set status       = 'confirmed',
         tx_hash      = p_tx_hash,
         confirmed_at = now()
   where circle_transaction_id = p_circle_transaction_id
     and status <> 'confirmed'
  returning obligation_id, amount
       into v_obligation_id, v_amount;

  if not found then
    return false;
  end if;

  update buckets
     set current_balance = current_balance + v_amount
   where obligation_id = v_obligation_id;

  get diagnostics v_bucket_count = row_count;
  if v_bucket_count = 0 then
    raise exception 'confirm_transfer: no bucket for obligation_id % (tx %)',
      v_obligation_id, p_circle_transaction_id;
  end if;

  return true;
end;
$$;
