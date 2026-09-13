-- Payment terms, as something the company keeps rather than something a
-- screen hard-codes.
--
-- `frontend-hub/src/screens/procurement/composer.tsx` has carried four
-- arrangements in a `const` since the payment block was drawn: 40/60 on
-- dispatch, 50/50, net 30, cash on delivery. Adding a fifth has meant shipping
-- a release, which is the same complaint 0091 answered for divisions, sizes
-- and tags, and the same answer applies.
--
-- Read against `frappe/erpnext` at `develop` rather than invented. Two things
-- are taken from it and one is deliberately not:
--
--   * A TERM carries an offset and a BASIS, never a raw day count. ERPNext's
--     `Payment Term.due_date_based_on` has exactly three values and there are
--     three because "net 30 from the end of the month" is ordinary in
--     Indonesian trade and cannot be written as days-from-anything-else.
--   * A TEMPLATE is a list of terms with portions. That is
--     `Payment Terms Template` and its detail rows.
--   * What is NOT taken: `discount_type`, `discount` and `discount_validity`.
--     The owner reports no supplier here reduces a bill for settling it
--     sooner, so the columns, the validity window and the posting rule for a
--     discount taken are all left out. A term is master data, so it reopens
--     cleanly the day somebody is offered one.
--
-- This migration is step one of `PAYMENT-TERMS-PLAN.md` and deliberately
-- stops at the vocabulary. Nothing here changes a bill, a payment or the
-- ledger: it gives the company a place to say what its arrangements ARE
-- before anything starts depending on them.

-- ---------------------------------------------------------------------------
-- The term
-- ---------------------------------------------------------------------------
--
-- Shaped like `division` (0022) and carrying what 0091 and 0167 added to it:
-- `version` for If-Match, `active` for retiring, `ever_used` for the mark that
-- is set once and never cleared.
--
-- A term is a NAMED offset, and two arrangements that fall due on different
-- days are two terms even when a person calls them the same thing. "On
-- delivery" settled the day the goods land and "on delivery" settled
-- forty-five days later are not one term with a footnote; making that explicit
-- here is the master doing its job rather than a nuisance it imposes.
CREATE TABLE payment_term (
    code          text PRIMARY KEY CHECK (btrim(code) <> ''),
    label         text NOT NULL CHECK (btrim(label) <> ''),

    -- What the offset is counted from. ERPNext's three, spelled our way.
    --
    --   DAYS_AFTER_BILL              n days after the bill's own date
    --   DAYS_AFTER_BILL_MONTH_END    n days after the last day of that month
    --   MONTHS_AFTER_BILL_MONTH_END  n months after that month end
    --
    -- Counted from the BILL and never from the order: a purchase order raised
    -- today whose invoice arrives in six weeks must not carry a due date
    -- computed from today. ERPNext recomputes for the same reason.
    basis         text NOT NULL CHECK (basis IN (
                      'DAYS_AFTER_BILL',
                      'DAYS_AFTER_BILL_MONTH_END',
                      'MONTHS_AFTER_BILL_MONTH_END')),

    -- Days for the first two bases, months for the third. One column rather
    -- than ERPNext's `credit_days` + `credit_months`, because exactly one of
    -- theirs is ever populated and the basis already says which unit this is.
    -- Zero is legal and means "on the day itself".
    offset_value  integer NOT NULL DEFAULT 0 CHECK (offset_value >= 0),

    display_order integer NOT NULL DEFAULT 0,
    active        boolean NOT NULL DEFAULT true,
    ever_used     boolean NOT NULL DEFAULT false,
    version       integer NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- The template
-- ---------------------------------------------------------------------------
--
-- What a buyer actually picks, and what a supplier's standing arrangement
-- points at.
CREATE TABLE payment_terms_template (
    code          text PRIMARY KEY CHECK (btrim(code) <> ''),
    label         text NOT NULL CHECK (btrim(label) <> ''),
    display_order integer NOT NULL DEFAULT 0,
    active        boolean NOT NULL DEFAULT true,
    ever_used     boolean NOT NULL DEFAULT false,
    version       integer NOT NULL DEFAULT 1
);

CREATE TABLE payment_terms_template_line (
    template_code text NOT NULL
                      REFERENCES payment_terms_template(code) ON DELETE CASCADE,
    -- Presentation and ordering only. Nothing points AT a line by its number —
    -- see the plan's note on why a payment must never name "the second row".
    seq           integer NOT NULL CHECK (seq > 0),
    term_code     text NOT NULL REFERENCES payment_term(code),

    -- Basis points, so a third of an order is 3333 + 3333 + 3334 and the
    -- arithmetic closes. Percent would not: three equal instalments cannot be
    -- written in whole percent and the rounding would have to live somewhere
    -- nobody wrote down.
    portion_bps   integer NOT NULL CHECK (portion_bps > 0 AND portion_bps <= 10000),

    PRIMARY KEY (template_code, seq)
);
CREATE INDEX ix_payment_terms_template_line_term
    ON payment_terms_template_line (term_code);

-- ---------------------------------------------------------------------------
-- Invariant: a template is the whole bill or it is not a template
-- ---------------------------------------------------------------------------
--
-- Deferred, and on both tables, for the reason 0051 and 0084 give at length:
-- the lines do not exist when the header is inserted, and checking only one
-- side leaves a hole — a template with no lines, or lines appended to one that
-- already committed.
--
-- P0001 on purpose. `AppError::into_response` recognises exactly that SQLSTATE
-- and passes the message through as a 409, so what a person reads is the
-- sentence below rather than an opaque 500.
--
-- ERPNext validates the same sum and FAILS rather than adjusting the last row,
-- to a 0.1 tolerance. In basis points there is no tolerance to spend, so the
-- writer balances it.
CREATE OR REPLACE FUNCTION assert_template_whole() RETURNS trigger AS $$
DECLARE
    target text;
    parts  bigint;
    total  bigint;
BEGIN
    -- One function, three record shapes. The header's record has `code` and
    -- the line's has `template_code`, and a DELETE on the line has no `NEW`
    -- at all — PL/pgSQL resolves a field on a record at RUNTIME, so a single
    -- `COALESCE(NEW.template_code, NEW.code)` does not fall back, it raises.
    IF TG_TABLE_NAME = 'payment_terms_template' THEN
        target := NEW.code;
    ELSIF TG_OP = 'DELETE' THEN
        target := OLD.template_code;
    ELSE
        target := NEW.template_code;
    END IF;

    -- The template may have been rolled back out from under its lines; there
    -- is then nothing to check.
    PERFORM 1 FROM payment_terms_template WHERE code = target;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*), COALESCE(SUM(portion_bps), 0) INTO parts, total
      FROM payment_terms_template_line WHERE template_code = target;

    IF parts = 0 THEN
        RAISE EXCEPTION
            'payment terms template % has no instalments; a template that '
            'schedules nothing is not an arrangement', target
            USING ERRCODE = 'P0001';
    END IF;

    IF total <> 10000 THEN
        -- The percent sign travels INSIDE the value, not in the format: `%%`
        -- in a PL/pgSQL format string is a literal and consumes no argument,
        -- so writing the unit there makes the placeholders and the arguments
        -- disagree and the function will not compile.
        RAISE EXCEPTION
            'payment terms template % schedules % of the bill; the instalments '
            'have to add up to all of it',
            target, (trim(trailing '.' from trim(trailing '0' from
                       round(total / 100.0, 2)::text)) || '%')
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER assert_template_whole_on_header
    AFTER INSERT OR UPDATE ON payment_terms_template
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_template_whole();

CREATE CONSTRAINT TRIGGER assert_template_whole_on_line
    AFTER INSERT OR UPDATE OR DELETE ON payment_terms_template_line
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_template_whole();

-- ---------------------------------------------------------------------------
-- The supplier's standing arrangement
-- ---------------------------------------------------------------------------
--
-- `Supplier.payment_terms` in ERPNext, and the thing that stops a buyer
-- choosing terms afresh on every order: terms are an arrangement with that
-- supplier, not a decision per document. Nullable, because a supplier the
-- company has no arrangement with is an ordinary state and inventing one for
-- them would be worse than leaving it blank.
ALTER TABLE supplier
    ADD COLUMN payment_terms_template_code text
        REFERENCES payment_terms_template(code);

COMMENT ON COLUMN supplier.payment_terms_template_code IS
    'The standing arrangement. Seeds a purchase order; the buyer overrides it when the phone call says otherwise.';

-- ---------------------------------------------------------------------------
-- Seed: the four arrangements the composer has been carrying in a const
-- ---------------------------------------------------------------------------
--
-- Lifted from `PAYMENT_TEMPLATES` so nothing on screen changes the day this
-- lands. One thing is corrected on the way: the second half of "50% advance,
-- 50% on delivery" was written as 45 days, which is not on delivery. It is
-- named for what it is.
INSERT INTO payment_term (code, label, basis, offset_value, display_order) VALUES
    ('ADVANCE',         'Advance',         'DAYS_AFTER_BILL',  0,  10),
    ('ON_DELIVERY',     'On delivery',     'DAYS_AFTER_BILL',  0,  20),
    ('BEFORE_DISPATCH', 'Before dispatch', 'DAYS_AFTER_BILL',  30, 30),
    ('NET_30',          'Net 30',          'DAYS_AFTER_BILL',  30, 40),
    ('NET_45',          'Net 45',          'DAYS_AFTER_BILL',  45, 50),
    ('EOM_30',          '30 days from month end',
                                           'DAYS_AFTER_BILL_MONTH_END', 30, 60);

INSERT INTO payment_terms_template (code, label, display_order) VALUES
    ('ADV40_DISPATCH60', '40% advance, 60% before dispatch', 10),
    ('ADV50_NET45',      '50% advance, 50% at 45 days',      20),
    ('NET_30',           'Net 30',                            30),
    ('COD',              'Cash on delivery',                  40);

INSERT INTO payment_terms_template_line (template_code, seq, term_code, portion_bps) VALUES
    ('ADV40_DISPATCH60', 1, 'ADVANCE',         4000),
    ('ADV40_DISPATCH60', 2, 'BEFORE_DISPATCH', 6000),
    ('ADV50_NET45',      1, 'ADVANCE',         5000),
    ('ADV50_NET45',      2, 'NET_45',          5000),
    ('NET_30',           1, 'NET_30',          10000),
    ('COD',              1, 'ON_DELIVERY',     10000);

-- The seeded terms are in use by the seeded templates, which is exactly what
-- `ever_used` means: retiring one now would leave a template pointing at
-- something the screens no longer offer.
UPDATE payment_term SET ever_used = true
 WHERE code IN (SELECT DISTINCT term_code FROM payment_terms_template_line);
