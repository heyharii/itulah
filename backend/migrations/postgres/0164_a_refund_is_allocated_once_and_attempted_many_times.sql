-- 0164: A refund is allocated once and attempted many times.
--
-- `sale_return_payment` stored whatever the caller sent: a method and an
-- amount. Three things were missing and each one is a way to lose money.
--
-- **Which tender it goes back to.** A refund is not "Rp200.000 by card"; it is
-- Rp200.000 against the card that paid, and against that card only up to what
-- that card paid. Without the link there is no capacity to check, so a sale
-- paid 100.000 by voucher and 400.000 by card could be refunded 500.000 to the
-- card, converting a voucher liability into cash.
--
-- **Whether it actually happened.** A return being accepted and the money being
-- back are different facts, and a column that cannot tell them apart reports
-- the first as the second. A card refund can be pending for days, or fail.
--
-- **How many times it has been tried.** Retrying is normal; retrying by
-- creating a SECOND refund row is a double refund. The allocation is the
-- authority for the amount and the attempts hang off it.
--
-- # Capacity, stated once
--
--     remaining = original applied tender
--              − every allocation against it that has not been cancelled
--
-- Pending and failed-but-retriable allocations still count. A refund that has
-- been promised is capacity that has been spent, whatever the card network has
-- done about it yet — otherwise a second return promises the same rupiah again
-- while the first is still in flight.
--
-- Nullable `original_tender_id` for the rows already here, which were written
-- before the link existed and cannot be reconstructed: a stored method does not
-- say which of two card tenders it came back from.

ALTER TABLE sale_return_payment
    ADD COLUMN original_tender_id UUID REFERENCES sale_payment(id),
    ADD COLUMN status TEXT NOT NULL DEFAULT 'SUCCEEDED'
        CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN last_error TEXT,
    ADD COLUMN external_refund_id TEXT;

-- The default is `SUCCEEDED` and that is deliberate, not lazy. Every row
-- already here was written by a path that had no concept of a pending refund:
-- it recorded money the shop considered returned. Backfilling them to PENDING
-- would invent a queue of refunds nobody is working on.
ALTER TABLE sale_return_payment ALTER COLUMN status DROP DEFAULT;

-- One allocation per tender per return. The uniqueness is what stops a retry
-- becoming a second refund: an attempt updates the row it already has.
CREATE UNIQUE INDEX ux_sale_return_payment_tender
    ON sale_return_payment (return_id, original_tender_id)
    WHERE original_tender_id IS NOT NULL;

-- Capacity is summed per original tender across every return of one sale, so
-- the read goes the other way round from the primary key.
CREATE INDEX ix_sale_return_payment_capacity
    ON sale_return_payment (original_tender_id, status)
    WHERE original_tender_id IS NOT NULL;
