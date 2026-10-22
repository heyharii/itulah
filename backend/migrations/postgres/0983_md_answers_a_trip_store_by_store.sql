-- MD answers a trip's review store by store (owner, 20 Oct 2026).
--
-- A store that counted its delivery need not wait for the whole trip: once
-- the stores its difference could pair with have counted (a short waits for
-- every store still to count; an extra only for those sent the same SKU), MD
-- answers that store alone — Accept as delivered or Return & reallot. Each
-- answer is written here; a trip leaves the review once every store has
-- counted and every store whose count differed is answered. A trip answered
-- whole before this (`allotment_store_review`, 0977) stays answered.

CREATE TABLE IF NOT EXISTS allotment_store_review_store (
    dispatch_id     uuid NOT NULL REFERENCES dc_dispatch (dispatch_id),
    store_id        text NOT NULL CHECK (btrim(store_id) <> ''),
    decision        text NOT NULL CHECK (decision IN ('AS_DELIVERED', 'RETURN_REALLOT')),
    decided_by      text NOT NULL CHECK (btrim(decided_by) <> ''),
    decided_at      timestamptz NOT NULL,
    idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
    -- What the answer made, as `allotment_store_review.result`.
    result          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
    PRIMARY KEY (dispatch_id, store_id)
);
