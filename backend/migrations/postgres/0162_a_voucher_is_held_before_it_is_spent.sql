-- 0162: A voucher is held before it is spent.
--
-- # The hole this closes
--
-- A till could take a voucher without asking anybody. `complete_sale` accepted
-- `PaymentMethod::Voucher` with a `reference` that was any string at all — no
-- balance read, no code checked, no call to the centre. Two shops could settle
-- two different baskets against the same card and neither would know until the
-- sales synced, by which point both were sold.
--
-- The centre's own `redeem_voucher` was never the problem: it locks the row and
-- refuses an overdraw. The problem was that nothing made the till go through it.
--
-- # Why a hold and not just "call redeem at the till"
--
-- A redemption is final and a checkout is not. Between presenting a card and
-- paying the rest there is a card terminal, a queue, and a shopper who may walk
-- away — and a redemption taken at the start of that has to be given back by
-- hand if the sale never completes. A hold is the shape that survives it:
--
--     AUTHORIZED  the amount is spoken for and nobody else may have it
--     COMMITTED   the sale landed; the ledger moved
--     RELEASED    the checkout died; the amount is free again
--     EXPIRED     nobody came back, and the clock let it go
--
-- # The invariant, stated once
--
--     available = balance_minor − sum(AUTHORIZED holds not yet expired)
--
-- The subtraction is the whole point. A 100.000 card can otherwise take two
-- 100.000 authorizations, because both read a balance that neither has reduced
-- yet — checking a balance is not the same as reserving against it. Every read
-- of `available` therefore happens under `SELECT … FOR UPDATE` on the voucher
-- row, in the same transaction that writes the hold.
--
-- # Expiry does not release a hold on its own
--
-- `expires_at` makes a hold stop counting against `available`. It does NOT mean
-- the checkout failed: a card payment whose response was lost may yet turn out
-- to have succeeded, and a hold released on a timer while that is unresolved is
-- how a voucher gets spent twice through the front door instead of the back.
-- So an expired hold is still a row, still linked to its checkout, and a
-- commit against it is refused loudly rather than silently double-spending.
-- Reconciling those is a job for the checkout state machine, not for a clock.

CREATE TABLE voucher_authorization (
    authorization_id UUID PRIMARY KEY,
    voucher_id       UUID NOT NULL REFERENCES voucher(voucher_id),

    -- The checkout this hold belongs to. Text rather than a foreign key: the
    -- basket lives in a till's SQLite until it is sold, so at the moment a hold
    -- is taken there is no row here to point at.
    checkout_id      TEXT NOT NULL,

    amount_minor     BIGINT NOT NULL CHECK (amount_minor > 0),

    status           TEXT NOT NULL CHECK (status IN
                         ('AUTHORIZED', 'COMMITTED', 'RELEASED', 'EXPIRED')),

    site_id          TEXT,
    actor            TEXT NOT NULL,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL,
    settled_at       TIMESTAMPTZ,

    -- The movement this hold became, once it was committed. Null while it is
    -- open, and the link that makes "which redemption came from which hold"
    -- answerable without joining on amounts and hoping.
    movement_id      UUID,

    -- One hold per checkout per voucher. A till that asks twice for the same
    -- basket gets the hold it already has rather than a second one — which is
    -- what makes a retried authorize request safe.
    CONSTRAINT voucher_authorization_one_per_checkout
        UNIQUE (voucher_id, checkout_id)
);

-- The only index the invariant needs: summing the open holds on one card.
-- Partial, because a committed or released hold is history and must not be
-- subtracted from anything.
CREATE INDEX ix_voucher_authorization_open
    ON voucher_authorization (voucher_id)
    WHERE status = 'AUTHORIZED';

CREATE INDEX ix_voucher_authorization_checkout
    ON voucher_authorization (checkout_id);
