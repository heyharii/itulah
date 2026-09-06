-- 0139: The client's seventh asset family is not depreciated at all.
--
-- # What the chart says, read properly
--
-- 0070 described `10216` as "the seven matching accumulated-depreciation
-- families" and `70102` as "six depreciation-expense families — the seventh,
-- land, correctly has none". Reading the client's own master account file
-- again, one line at a time, that is not what it says:
--
--     1021507  Operating Equipment                        36 accounts
--     1021607  Reserve Replacement - Operating Equipment  36 accounts
--     7010215  BIAYA REPLACEMENT OPERATING EQUIPMENT      36 accounts
--
-- `1021607` is not `Akum-Penyusu - Operating Equipment`; the other six under
-- `10216` are named exactly that and this one is not. And `70102` has no
-- "BIAYA DEPRESIASI OPERATING EQUIPMENT" — the sixth expense family is
-- REPLACEMENT. Three parallel blocks of thirty-six, class for class: `OE - Rak
-- 1`, `RR OE- Rak 1`, `Biaya Replacement OE - Rack 1`, and so on down to `OE -
-- Tas / Keranjang Belanja`.
--
-- So the client does not depreciate racks, mannequins, hangers and shopping
-- baskets. They charge a monthly amount per class into a reserve, and when a
-- rack is replaced they take the new one out of the reserve instead of putting
-- it through the profit and loss. It is a sinking fund, and their chart has
-- carried the accounts for it since before this system existed.
--
-- What the account map currently does is map `accumulated_depreciation` for
-- category `1021507` onto `1021607001 RR OE- Rak 1`. That resolves, balances,
-- and posts depreciation into a replacement reserve for a rack — one account,
-- for every class of operating equipment at every location. The books balance
-- and the client's own reserve report is nonsense.
--
-- # The rule
--
--     monthly, per class per location:
--       Dr  replacement_expense   (site, class)   the rate
--       Cr  replacement_reserve   (site, class)
--
--     a replacement purchase flagged as drawing the reserve:
--       Dr  replacement_reserve   (site, class)   instead of an expense
--       Cr  the supplier payable
--
-- The second is the whole point of the first. Without it the reserve only ever
-- grows, which is the same half-a-lifecycle mistake 0096 fixed for the register
-- and 0084 fixed for payables.
--
-- # Why the rate is per class AND per location
--
-- Because the accounts are. Every leaf in all three blocks carries the
-- location — `102150700103 OE - Rak 1 C003` — and the client reads a profit and
-- loss per shop. A single national rate per class would have to be split
-- somewhere, and the only honest split is the one Finance already makes when
-- they decide what each shop reserves.
--
-- # Why the rate is appended and never edited
--
-- The same argument `asset_capitalization` makes. "We reserved 250,000 a month
-- for racks and raised it to 400,000 in July" is itself the record; an edited
-- row would make every month before July look as if it had always been 400,000,
-- and the charges already posted would disagree with the rate that supposedly
-- produced them.

-- ---------------------------------------------------------------------------
-- One more source kind
-- ---------------------------------------------------------------------------
--
-- Same argument as 0083, 0095 and 0096: the kind says how an entry came to be
-- written, and MANUAL is reserved for what a person typed from nothing. A
-- monthly reserve charge is written by a machine from a rate.
--
-- The list is rewritten whole rather than appended to, because a CHECK has no
-- append. It is the union of every kind any lane has claimed, so that the
-- constraint ends the same way whichever order the migrations land in.

ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        -- 0051, 0083, 0095, 0096
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER',
        -- claimed by the lanes working beside this one
        'RETENDER', 'CASH_SHIFT', 'STORE_DEPOSIT', 'REMITTANCE', 'ADVANCE',
        'STORE_EXPENSE', 'PETTY_REPLENISH', 'CASH_DOC', 'GIRO',
        'INTERUNIT_SETTLE', 'RECLASS', 'ADJUSTMENT', 'WRITE_OFF',
        'ACQ_SETTLEMENT', 'GOODS_RECEIPT', 'CREDIT_NOTE', 'SUPPLIER_ADVANCE',
        'LANDED_COST', 'COGS_DAY',
        -- this migration
        'ASSET_RESERVE'));

-- ---------------------------------------------------------------------------
-- Which classes are reserved for
-- ---------------------------------------------------------------------------
--
-- An annotation on the client's own account, keyed by it, and not a second
-- register of asset kinds — 0070's rule, kept. The chart still says what the
-- classes ARE; this says which of them the company reserves against, which is
-- a policy decision the chart cannot hold.
--
-- Today the answer is the thirty-six under `1021507`, because that is where the
-- client's own three parallel blocks are. It is a row per class rather than a
-- prefix rule so that the day they add a reserve for vehicles, somebody sets a
-- flag instead of editing a LIKE pattern in Rust.

CREATE TABLE asset_class_reserve (
    class_code              text PRIMARY KEY REFERENCES ledger_account(account_code),
    has_replacement_reserve boolean NOT NULL DEFAULT true,
    -- Why. The one place a reader can find out that this is the client's own
    -- practice and not something the system invented.
    note                    text,
    set_by                  text NOT NULL CHECK (btrim(set_by) <> ''),
    set_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE asset_class_reserve IS
    'Which of the client''s asset classes are reserved against rather than depreciated. An annotation on the chart, keyed by the chart''s own code — not a second list of asset kinds.';

-- ---------------------------------------------------------------------------
-- What each class reserves, per location, from when
-- ---------------------------------------------------------------------------

CREATE TABLE asset_replacement_rate (
    class_code           text NOT NULL REFERENCES asset_class_reserve(class_code),
    site_id              text NOT NULL REFERENCES site(id),
    -- The month it starts applying, named by its first day. The rate in force
    -- for a month is the latest one that started on or before it.
    effective_from       date NOT NULL CHECK (EXTRACT(DAY FROM effective_from) = 1),

    -- A flat monthly amount and not a percentage of anything. There is nothing
    -- to take a percentage OF: operating equipment is not capitalised here, so
    -- no cost sits on `1021507*` for a rate to be applied to. What Finance
    -- decides is "this shop puts aside 400,000 a month against racks", and
    -- storing the decision they actually make is what stops a reader having to
    -- reconstruct it from a base nobody recorded.
    monthly_charge_minor bigint NOT NULL CHECK (monthly_charge_minor > 0),

    set_by               text NOT NULL CHECK (btrim(set_by) <> ''),
    set_at               timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (class_code, site_id, effective_from)
);

CREATE OR REPLACE FUNCTION protect_asset_replacement_rate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'a reserve rate is appended, not %: set a new one from the month it changes, and the '
        'charges already posted keep saying what they were charged at',
        lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_replacement_rate_append_only
    BEFORE UPDATE OR DELETE ON asset_replacement_rate
    FOR EACH ROW EXECUTE FUNCTION protect_asset_replacement_rate();

-- ---------------------------------------------------------------------------
-- What was actually charged
-- ---------------------------------------------------------------------------
--
-- One row per class per location per month, and the UNIQUE is the idempotency:
-- re-running a month charges nothing twice, exactly as the unique index on
-- `asset_depreciation_entry` makes the depreciation run safe to repeat.
--
-- The journal entry id is shared across the rows of one location's month —
-- thirty-six classes at one shop are two lines each in ONE entry, not
-- thirty-six entries. A shop's monthly reserve is one act.

CREATE TABLE asset_replacement_charge (
    charge_id        uuid PRIMARY KEY,
    class_code       text NOT NULL REFERENCES asset_class_reserve(class_code),
    site_id          text NOT NULL REFERENCES site(id),
    period_month     date NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
    amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
    journal_entry_id uuid NOT NULL REFERENCES journal_entry(entry_id),
    posted_by        text NOT NULL CHECK (btrim(posted_by) <> ''),
    posted_at        timestamptz NOT NULL DEFAULT now(),

    UNIQUE (class_code, site_id, period_month)
);
CREATE INDEX ix_asset_replacement_charge_period
    ON asset_replacement_charge (period_month, site_id);

COMMENT ON TABLE asset_replacement_charge IS
    'One month of reserve charged for one class at one location. The UNIQUE is what makes the monthly run safe to repeat.';

-- ---------------------------------------------------------------------------
-- Drawing the reserve down
-- ---------------------------------------------------------------------------
--
-- A replacement is bought on an ordinary supplier bill. What differs is one
-- thing: the debit goes to the reserve instead of to an expense, because the
-- expense was already taken, month by month, while the reserve was being built.
-- Charging it again would put the cost of one rack through the profit and loss
-- twice — once over the years of reserving and once on the day it arrived.
--
-- The class the draw comes out of is `asset_class_code`, added in 0137. On a
-- line that draws, that column names WHICH reserve rather than which asset to
-- mint, and no asset is minted: operating equipment is not capitalised here, so
-- there would be nothing for a register row to carry.

ALTER TABLE supplier_invoice_expense_line
    ADD COLUMN draws_reserve boolean NOT NULL DEFAULT false,
    -- A draw with no class is a debit with nowhere to go. Checked here because
    -- it names no account code — it is a rule about two of our own columns.
    ADD CONSTRAINT supplier_invoice_expense_line_draw_names_a_class
        CHECK (NOT draws_reserve OR asset_class_code IS NOT NULL);

COMMENT ON COLUMN supplier_invoice_expense_line.draws_reserve IS
    'This line replaces something the company has been reserving for: it debits replacement_reserve for its class instead of the account named on the line, and mints no asset.';
