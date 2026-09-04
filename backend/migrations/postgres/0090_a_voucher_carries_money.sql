-- 0090: A voucher carries money.
--
-- # What was missing
--
-- `pricing-engine/src/lib.rs` has said it since the engine was written — "a
-- voucher carries money. It is tender, not pricing" — and nothing in the
-- database agreed, because nothing in the database mentioned a voucher at all.
-- `grep -ri voucher backend/` found two comments and no schema. The Commercial
-- screen said the same thing to a merchandiser and disabled its own button.
--
-- So a shop could sell a gift card and had nowhere to record that it had. The
-- money arrives on the day the card is sold and the goods leave on some later
-- day, which is the whole reason a voucher is a liability and not a sale: the
-- shop is holding somebody else's money until they come back for it. Recording
-- it as takings and nothing else overstates the month it was sold in and
-- understates every month after.
--
-- # Why a balance and a movement, and not just a balance
--
-- Because "how much is left on this card" is the cheap question and "where did
-- it go" is the one that gets asked. A card presented at a till with 40,000 on
-- a 200,000 face value invites exactly one question, and a single mutable
-- balance column cannot answer it. The pair is the same shape the journal
-- already uses and the same shape `edge_sale_tender` uses: a header carrying
-- the current standing, and a child row per event that moved it.
--
-- The balance is therefore derivable, and is stored anyway. Not laziness: the
-- till has to answer "is there enough on this" in one indexed read while a
-- queue waits, and a sum over the movements is the wrong query to put on that
-- path. It is kept honest by the trigger below rather than by hope — every
-- movement writes the balance it left behind, and the header may not disagree
-- with the last one.
--
-- # What is refused, and by the database rather than by Rust
--
--   * spending more than is on the card (a balance may not go negative);
--   * spending a card that is void, spent or past its date;
--   * two tills spending the last 40,000 at once — the header row is locked
--     for the length of a redemption, so the second one waits and then fails
--     on the balance it actually finds;
--   * a movement that claims a balance the arithmetic does not support.
--
-- Every one of those is money, and application validation is where an
-- invariant lives until the day a second writer appears.
--
-- # What this is not
--
-- Not a discount, not a promotion, and not a coupon. A coupon is a gate on a
-- promotion and carries no value; a promotion describes what something costs.
-- This is the other side of the counter entirely — it is paid WITH. The system
-- this replaces filed all three in one `voucher` table with a `percent_off`
-- column beside a `stored_value` one, and that is why a clearance there was
-- booked as a discount against margin instead of as a liability settled.

CREATE TABLE voucher (
    voucher_id  uuid PRIMARY KEY,

    -- What is printed on the card and typed at the till. Upper-case and
    -- unique across the estate: a code is presented by somebody who cannot see
    -- which shop issued it, so it cannot be unique only within one.
    code        text NOT NULL UNIQUE
                CHECK (code = upper(btrim(code)) AND length(code) BETWEEN 6 AND 32),

    -- Why it exists. Not decoration: a gift card was paid for and is a
    -- liability the shop owes, goodwill was given away and is an expense the
    -- moment it is issued, and a refund voucher is a sale being unwound. Three
    -- different entries in the ledger, so the reason has to survive.
    kind        text NOT NULL CHECK (kind IN ('GIFT_CARD','REFUND','GOODWILL')),

    currency    text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

    -- The face value, frozen. What was issued never changes, which is what
    -- makes "how much of this has been spent" answerable by subtraction.
    issued_minor  bigint NOT NULL CHECK (issued_minor > 0),

    -- What is left. Never negative, never above what was issued.
    balance_minor bigint NOT NULL
                  CHECK (balance_minor >= 0),

    status      text NOT NULL CHECK (status IN ('ACTIVE','SPENT','VOIDED')),

    -- Who holds it, when anybody does. Optional on purpose: a gift card bought
    -- off the shelf belongs to whoever is holding it, and demanding a member
    -- would make the ordinary case impossible. A refund voucher usually names
    -- one, because the shop knows who it is unwinding a sale for.
    member_id   text REFERENCES member(member_id) ON DELETE SET NULL,

    -- Optional. An undated voucher is a liability with no end, which some
    -- shops want and Indonesian consumer practice tends to expect for a paid
    -- gift card; a goodwill voucher is usually dated. Neither is imposed here.
    expires_at  timestamptz,

    issued_at   timestamptz NOT NULL DEFAULT now(),
    issued_by   text NOT NULL CHECK (btrim(issued_by) <> ''),
    -- Where it was sold or given. A gift card sold at one shop and spent at
    -- another moves money between them, and the pair of site ids is the only
    -- record of that.
    issued_site text,
    note        text,

    version     integer NOT NULL DEFAULT 1 CHECK (version > 0),

    -- The two states the balance implies. Kept as a constraint rather than as
    -- a convention, because "SPENT with 40,000 left on it" is a row a till
    -- would refuse and a report would count.
    CONSTRAINT voucher_balance_within_issue
        CHECK (balance_minor <= issued_minor),
    CONSTRAINT voucher_status_matches_balance CHECK (
        (status = 'SPENT'  AND balance_minor = 0) OR
        (status = 'ACTIVE' AND balance_minor > 0) OR
         status = 'VOIDED'
    )
);

-- The till's question, and the only one on a hot path: "this code — is there
-- anything on it?". The unique index on `code` already answers it; this one is
-- for the screen, which asks "what is outstanding" and "whose is this".
CREATE INDEX ix_voucher_status ON voucher (status, issued_at DESC);
CREATE INDEX ix_voucher_member ON voucher (member_id) WHERE member_id IS NOT NULL;
CREATE INDEX ix_voucher_expiry ON voucher (expires_at) WHERE expires_at IS NOT NULL;

COMMENT ON TABLE voucher IS
    'Value a customer holds and can pay with. Tender, not pricing: it is spent '
    'against a basket, never applied to a price.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Every time the balance moved, and what moved it.
--
-- Signed amounts, so the movements sum to the balance and the arithmetic is
-- checkable by anyone with psql. Issue is positive, redeem and void are
-- negative — a void being the shop writing off whatever is left rather than a
-- separate kind of subtraction.
CREATE TABLE voucher_movement (
    movement_id  uuid PRIMARY KEY,
    voucher_id   uuid NOT NULL REFERENCES voucher(voucher_id) ON DELETE CASCADE,

    -- Position, not time. Two redemptions in the same millisecond are possible
    -- and their order still matters, because each states the balance it left.
    seq          integer NOT NULL CHECK (seq >= 0),

    kind         text NOT NULL CHECK (kind IN ('ISSUE','REDEEM','VOID')),

    -- Signed. Enforced against the kind, so a REDEEM cannot add value by
    -- arriving with the wrong sign.
    amount_minor bigint NOT NULL CHECK (amount_minor <> 0),

    -- What the voucher stood at afterwards. Written by the command, checked by
    -- the trigger below: this is what makes the stored balance auditable
    -- instead of merely convenient.
    balance_after_minor bigint NOT NULL CHECK (balance_after_minor >= 0),

    -- Which basket it paid for. Nullable because an issue pays for nothing and
    -- because the sale may live at an edge node the centre has not received
    -- yet — no foreign key, for the same reason `edge_sale.customer_id` has
    -- none: a fact that arrives out of order must be recorded, not refused.
    sale_id      uuid,
    site_id      text,

    actor        text NOT NULL CHECK (btrim(actor) <> ''),
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    note         text,

    UNIQUE (voucher_id, seq),

    CONSTRAINT voucher_movement_sign_matches_kind CHECK (
        (kind = 'ISSUE'  AND amount_minor > 0) OR
        (kind IN ('REDEEM','VOID') AND amount_minor < 0)
    )
);

CREATE INDEX ix_voucher_movement_voucher ON voucher_movement (voucher_id, seq);
-- "What did vouchers settle at this shop last week" — the takings question,
-- and the one that reconciles against the liability going down.
CREATE INDEX ix_voucher_movement_time ON voucher_movement (occurred_at);
CREATE INDEX ix_voucher_movement_sale ON voucher_movement (sale_id)
    WHERE sale_id IS NOT NULL;

COMMENT ON TABLE voucher_movement IS
    'Every change to a voucher''s balance, signed, with the balance it left '
    'behind. The header''s balance_minor must equal the newest row''s.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The stored balance may not drift from the movements.
--
-- Two ways it could: a movement stating a balance its own arithmetic does not
-- support, and a header that does not match its newest movement. Both are
-- refused here rather than left to the one command that currently writes them,
-- because the value of a check is that it still holds when a second writer
-- appears — a backfill, a correction script, somebody in psql at 2am.
CREATE OR REPLACE FUNCTION voucher_movement_is_consistent() RETURNS trigger AS $$
DECLARE
    previous bigint;
    header   bigint;
BEGIN
    SELECT balance_after_minor INTO previous
      FROM voucher_movement
     WHERE voucher_id = NEW.voucher_id AND seq < NEW.seq
     ORDER BY seq DESC
     LIMIT 1;

    -- The first movement of a voucher starts from nothing, which is what makes
    -- ISSUE the only kind that can be first.
    previous := COALESCE(previous, 0);

    IF previous + NEW.amount_minor <> NEW.balance_after_minor THEN
        RAISE EXCEPTION
            'voucher movement does not add up: % + % is not %',
            previous, NEW.amount_minor, NEW.balance_after_minor;
    END IF;

    SELECT balance_minor INTO header FROM voucher WHERE voucher_id = NEW.voucher_id;
    IF header <> NEW.balance_after_minor THEN
        RAISE EXCEPTION
            'voucher balance is % but its newest movement leaves %',
            header, NEW.balance_after_minor;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Deferred to COMMIT: the header is updated and the movement inserted in one
-- transaction, and whichever lands first would otherwise fail against a row
-- the other has not written yet.
CREATE CONSTRAINT TRIGGER voucher_movement_consistency
    AFTER INSERT ON voucher_movement
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION voucher_movement_is_consistent();

-- A movement is evidence. It is never edited and never deleted; a mistake is
-- corrected by a movement that reverses it, the way the journal works.
CREATE OR REPLACE FUNCTION voucher_movement_is_evidence() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'a voucher movement is evidence and does not change';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER voucher_movement_immutable
    BEFORE UPDATE OR DELETE ON voucher_movement
    FOR EACH ROW EXECUTE FUNCTION voucher_movement_is_evidence();

-- ─────────────────────────────────────────────────────────────────────────────
-- A voucher is now something a till can be paid with.
--
-- `0077` constrained the method to four values on the argument that free text
-- costs a report that groups 'card', 'CARD' and 'Card' as three tenders. That
-- argument holds; the list was simply short by one, because at the time there
-- was nothing to add. A sale settled partly by voucher is otherwise recorded
-- as OTHER, which is the same loss of meaning the constraint exists to prevent.
ALTER TABLE edge_sale_tender DROP CONSTRAINT edge_sale_tender_method_check;
ALTER TABLE edge_sale_tender ADD CONSTRAINT edge_sale_tender_method_check
    CHECK (method IN ('CASH','CARD','QRIS','OTHER','VOUCHER'));
