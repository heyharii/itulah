-- 0386: The centre says when a promotion runs out.
--
-- A budget and a basket cap are brakes at the tills: each shop enforces from
-- the last count it was sent. Until this, head office learned that a line had
-- been crossed by opening the Promotions screen and noticing, and the shops
-- learned it on a fixed fifteen-minute beat whether anything had changed or
-- not. The watch in `postgres::marketing_watch` now notices the crossing as the
-- sale that caused it is applied, tells head office once, and sends the fleet
-- the new count at once rather than on the beat.
--
-- # One row per line crossed, and why the limit is in the key
--
-- A crossing is recorded once so it is announced once: the watch runs every
-- few seconds and a budget that is used up stays used up. The limit itself is
-- part of the key because a later price book may raise it — a promotion topped
-- up from one million to two has not crossed the two-million line just because
-- it once crossed the one-million line, and when it does, that is news again.
--
-- Nothing here gates anything. The tills refuse a spent offer from their own
-- counts; this table is only the memory of what head office has been told.

CREATE TABLE commercial_cap_alert (
    kind        text NOT NULL CHECK (kind IN ('RULE', 'CAMPAIGN', 'COUPON')),
    key         text NOT NULL CHECK (btrim(key) <> ''),
    measure     text NOT NULL CHECK (measure IN ('BUDGET', 'USES')),
    limit_value bigint NOT NULL CHECK (limit_value > 0),
    band        text NOT NULL CHECK (band IN ('NEAR', 'REACHED')),
    -- The count when the line was first seen crossed. Not updated afterwards:
    -- what it stood at when somebody was told is the whole value of the row.
    observed    bigint NOT NULL CHECK (observed >= 0),
    crossed_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, key, measure, limit_value, band)
);

-- The watch's words for what it tells head office. A notification kind is a
-- closed set (0217) because the browser routes on it, so adding one is a
-- migration, and the list is restated whole: every kind 0383 allowed, plus the
-- marketing ones.
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check
    CHECK (kind IN (
        'activity',
        'purchase.price_amendment.requested',
        'purchase.delivery.due_soon',
        'receipt.awaiting_identity',
        'receipt.excess_awaiting_decision',
        'finance.integrity.exception',
        'discussion.thread.opened',
        'discussion.thread.replied',
        'asset.assessment.overdue',
        'people.contract.expiring',
        'people.period.month_open',
        'people.roster.gap',
        'ga.contract.expiring',
        'ga.document.expiring',
        'finance.bill.due_soon',
        'finance.tax.deadline',
        -- A budget or basket cap four-fifths gone, and all gone.
        'commercial.cap.near',
        'commercial.cap.reached',
        -- A shop that could not put a price book into service, and one that
        -- has said nothing about it for half an hour.
        'commercial.rollout.failed',
        'commercial.rollout.stalled',
        -- A shop still enforcing from a promotion count half an hour old.
        'commercial.usage.stale',
        -- A campaign guardrail crossed on the scheduled check.
        'commercial.guardrail.breached',
        -- Promotions and campaigns that start or end tomorrow.
        'commercial.promotion.starting',
        'commercial.promotion.ending'
    ));
