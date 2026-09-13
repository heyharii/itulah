-- 0165: Points are a ledger, and a voucher is how they are spent.
--
-- Until now the engine computed an award and nothing recorded it.
-- `edge_sale.points_earned` held a total per receipt and there was no balance
-- anywhere, so "how many points does this member have" had no answer and
-- "spend them" had nothing to spend.
--
-- # Why a ledger and not a balance column
--
-- A balance that is only ever mutated cannot say why it is what it is, and the
-- first time it disagrees with the receipts there is no way to tell which is
-- wrong. Entries are appended and the balance is their sum; the column below is
-- a cache of that sum and is never the authority.
--
-- It also makes reversal possible without erasing history. A shopper who earned
-- 638 points on a pair of shoes and returned them has two entries, not one
-- edited entry — and the second one is attributable to the return that caused
-- it.
--
-- # Negative balances are allowed, and blocked from being spent again
--
-- Someone can earn points, spend them on a voucher, and then return the goods
-- that earned them. The reversal must still happen: the points were awarded for
-- a purchase that was undone. So the balance may go negative — decision D02 and
-- the locked rule.
--
-- What must NOT happen is clawing the voucher back. It may already have been
-- spent, possibly at another shop. The shopper keeps it and the balance carries
-- the debt; further redemption is refused until earning brings it back up.
--
-- # Points from an offline sale are pending, not available
--
-- A sale taken with the line down is not evidence the centre has accepted. Its
-- points are earned when the sale syncs and is validated, and `posted_at` is
-- what separates "this receipt says so" from "the centre agrees".

CREATE TABLE points_account (
    customer_id       TEXT PRIMARY KEY,
    -- A cache of the ledger sum, kept so a till need not sum a member's whole
    -- history to show a balance. Signed: see the note above.
    balance_points    BIGINT NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE points_ledger (
    entry_id          UUID PRIMARY KEY,
    customer_id       TEXT NOT NULL REFERENCES points_account(customer_id),

    entry_type        TEXT NOT NULL CHECK (entry_type IN (
                          'OPENING',
                          'EARN',
                          'RETURN_REVERSAL',
                          'REDEEM_TO_VOUCHER',
                          'ADJUSTMENT'
                      )),

    -- Signed. An EARN is positive, a REDEEM and a RETURN_REVERSAL are negative,
    -- and an ADJUSTMENT is whichever a person decided — which is why it carries
    -- a reason below and the others do not need one.
    points            BIGINT NOT NULL CHECK (points <> 0),

    -- What caused it. Exactly one of these is set for every type except
    -- OPENING and ADJUSTMENT, and the uniqueness below is what stops one cause
    -- producing two entries.
    sale_id           UUID,
    return_id         UUID,
    redemption_id     UUID,

    reason            TEXT,
    actor             TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One sale earns once, one return reverses once, one redemption debits once.
-- Partial indexes rather than a single composite: the columns are alternatives,
-- not a compound key, and a composite would let a null in one of them wave two
-- entries through.
CREATE UNIQUE INDEX ux_points_ledger_earn
    ON points_ledger (sale_id) WHERE entry_type = 'EARN';
CREATE UNIQUE INDEX ux_points_ledger_reversal
    ON points_ledger (return_id) WHERE entry_type = 'RETURN_REVERSAL';
CREATE UNIQUE INDEX ux_points_ledger_redeem
    ON points_ledger (redemption_id) WHERE entry_type = 'REDEEM_TO_VOUCHER';

CREATE INDEX ix_points_ledger_customer ON points_ledger (customer_id, created_at DESC);

-- # Points to voucher, as one business object
--
-- Not two writes hopefully both landing. The debit and the issue are one
-- transaction, and this row is the thing that makes a retry answerable: the
-- same idempotency key returns the voucher already issued rather than issuing a
-- second one. INV-10: one redemption yields at most one voucher, and the
-- uniqueness that guarantees it is here rather than in an application check.
CREATE TABLE loyalty_redemption (
    redemption_id     UUID PRIMARY KEY,
    customer_id       TEXT NOT NULL REFERENCES points_account(customer_id),

    points_spent      BIGINT NOT NULL CHECK (points_spent > 0),
    voucher_value_minor BIGINT NOT NULL CHECK (voucher_value_minor > 0),

    -- Null only while the row is being written inside its own transaction. A
    -- committed redemption always names its voucher.
    voucher_id        UUID REFERENCES voucher(voucher_id),

    idempotency_key   TEXT NOT NULL,
    actor             TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT loyalty_redemption_one_per_key UNIQUE (customer_id, idempotency_key)
);

-- A voucher is issued by at most one redemption. Without this, a repair script
-- or a second code path could attach two redemptions to one card and the points
-- debited would be twice the value handed over.
CREATE UNIQUE INDEX ux_loyalty_redemption_voucher
    ON loyalty_redemption (voucher_id) WHERE voucher_id IS NOT NULL;
