-- Takings are in a bag before they are in a bank.
--
-- The shop banks cash on Monday afternoon and the statement shows it landing on
-- Tuesday. Between those two facts the money is in somebody's hands, and until
-- now this system kept the first fact and the third and nothing in between: the
-- Deposits screen composed bank statement lines against cash counts and said,
-- honestly, that a deposit slip is not a document the system keeps.
--
-- So the gap was a subtraction a screen performed, not a position in the books,
-- and a subtraction cannot be reconciled, cannot be aged and cannot name the
-- person carrying the bag.
--
-- # The account this needs, and why it is not the bank
--
-- `1-1104 Setoran Dalam Perjalanan` — deposits in transit — from the simplified
-- chart (`docs/coa-final.md` §8.7, which lists it as one of exactly two
-- accounts the client's own chart lacks and needs). Posting straight into the
-- bank account on the day the bag leaves says the bank holds money the bank has
-- never heard of, and every reconciliation afterwards has to explain a credit
-- that has not happened yet.
--
-- Crediting the drawer and debiting an in-transit account instead says what is
-- actually true: the notes are out of the till and not yet at the bank, and the
-- balance on that account IS the exposure — one number, per unit, that somebody
-- is answerable for. It is the same shape `goods_in_transit` already has for
-- stock, which is not a coincidence: a thing in a van and a thing in a bag are
-- the same accounting problem.
--
-- The meaning is `cash_in_transit` in `account_map`, so nothing in Rust names
-- the code. Unqualified: the unit is a dimension on the line, not a suffix on
-- the account, which is this module's whole argument.
--
-- # Two postings, two dates, and neither is optional
--
--   leaving  (on `banked_on`)  Dr cash_in_transit   Cr the drawer
--   landing  (on `landed_on`)  Dr the bank          Cr cash_in_transit
--
-- Two entries rather than one, because they happen on different days and a
-- single entry would have to pick one of them and be wrong about the other.
-- That is exactly the defect this table exists to remove.
--
-- The second posting is the one the bank statement agrees with, so an imported
-- statement line reconciles against a real journal line on the bank account —
-- through the bank reconciliation that already exists, with no special case for
-- deposits anywhere in it.
--
-- # What it is not
--
-- It is not a cash count. A count is one moment and one figure and asks why the
-- drawer disagrees with the books (0216); a deposit is a movement between two
-- accounts and asks where the money is today. A shop may well count the drawer
-- before banking it, and the two documents stay separate: the count explains a
-- difference, the deposit moves a balance.

ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER', 'CASH_COUNT', 'DEPOSIT'));

-- The shared development database already carries a `store_deposit` — and no
-- migration in this tree creates it.
--
-- It is an orphan: an agent worktree's migration was run against the shared dev
-- database and the file it came from lives on no branch anybody checks out.
-- This is the fourth such leftover found on 2026-09-13, after
-- `journal_line.counter_site_id` and the two `payment_ledger_*` tables, and it
-- is why this migration cannot simply CREATE: the node refuses to start with
-- `relation "store_deposit" already exists` and takes every other lane's work
-- down with it.
--
-- Dropped only when all three hold: the table exists, it holds NO rows, and it
-- is NOT the shape below (the orphan has `deposit_date`/`out_entry_id` where
-- this has `banked_on`/`sent_entry_id`). A table with a row in it is somebody's
-- data and stops this migration rather than being silently discarded.
DO $$
BEGIN
    IF to_regclass('public.store_deposit') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_name = 'store_deposit' AND column_name = 'banked_on')
    THEN
        IF EXISTS (SELECT 1 FROM store_deposit) THEN
            RAISE EXCEPTION
                'store_deposit exists in an older shape and holds rows; '
                'migrate or remove them by hand before applying 0241';
        END IF;
        RAISE NOTICE 'dropping the orphan store_deposit (0 rows, older shape)';
        DROP TABLE store_deposit CASCADE;
        DROP SEQUENCE IF EXISTS store_deposit_number_seq;
    END IF;
END $$;

CREATE SEQUENCE store_deposit_number_seq;

CREATE TABLE store_deposit (
    deposit_id          uuid PRIMARY KEY,
    -- DP-00000001. The slip a shop writes on has the bank's number; this is
    -- ours, and a deposit has to be nameable before the bank has said anything
    -- about it at all.
    deposit_number      text NOT NULL UNIQUE CHECK (btrim(deposit_number) <> ''),

    -- The unit, on the row, as it is on every posting this will make.
    site_id             text NOT NULL REFERENCES site(id),

    -- Where the notes came from and where they are going, as the client's own
    -- account codes — the way every money screen in this estate addresses a
    -- place money sits. Both are resolved BACK to a meaning before anything
    -- posts, so a deposit out of an account nobody mapped is refused by name
    -- rather than discovered at posting time.
    drawer_account_code text NOT NULL,
    drawer_is_group     boolean NOT NULL DEFAULT false CHECK (drawer_is_group = false),
    bank_account_code   text NOT NULL,
    bank_is_group       boolean NOT NULL DEFAULT false CHECK (bank_is_group = false),
    -- A deposit into the account it came out of is a round trip, not a
    -- deposit.
    CHECK (drawer_account_code <> bank_account_code),

    amount_minor        bigint NOT NULL CHECK (amount_minor > 0),
    currency            text NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),

    -- The day the bag left the drawer. Our side of the two dates.
    banked_on           date NOT NULL,
    -- The day the bank credited the account. The bank's side, and null until
    -- the bank has said so — which is the whole point: the distance between
    -- these two dates is the exposure.
    landed_on           date,
    CHECK (landed_on IS NULL OR landed_on >= banked_on),

    -- Who carried it. Not ceremony: an in-transit balance with nobody's name on
    -- it is a number nobody can be asked about, and being asked about it is the
    -- only control there is between a till and a bank.
    carried_by          text NOT NULL CHECK (btrim(carried_by) <> ''),
    -- What the bank stamped. Empty while the slip is still in somebody's
    -- pocket; it is evidence when it arrives, never a precondition.
    slip_reference      text NOT NULL DEFAULT '',
    note                text NOT NULL DEFAULT '',

    status              text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                            'DRAFT', 'IN_TRANSIT', 'LANDED')),

    -- The two entries, one per leg. Separate columns and not one, because they
    -- carry different dates and either can be the last thing that happened.
    sent_entry_id       uuid REFERENCES journal_entry(entry_id),
    landed_entry_id     uuid REFERENCES journal_entry(entry_id),

    -- The statement line that agreed with it, when the reconciliation found
    -- one. Optional: a deposit can be confirmed by a person reading a
    -- statement before the file is imported, and refusing to close it until
    -- the import happens would leave money in transit that everybody knows has
    -- landed.
    bank_line_id        uuid REFERENCES bank_statement_line(line_id),

    recorded_by         text NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at         timestamptz NOT NULL DEFAULT now(),
    sent_by             text,
    landed_by           text,

    -- Both legs must name a POSTABLE account. The `is_group` column beside each
    -- code is not data anybody sets: it is pinned false by a CHECK and joined
    -- into the foreign key, which is how 0216 makes "not a heading" a thing the
    -- database enforces rather than a thing the caller is trusted about.
    FOREIGN KEY (drawer_account_code, drawer_is_group)
        REFERENCES ledger_account (account_code, is_group),
    FOREIGN KEY (bank_account_code, bank_is_group)
        REFERENCES ledger_account (account_code, is_group),

    -- The status and the entries say the same thing, both ways round. A
    -- deposit marked in transit with no entry behind it, or an entry with a
    -- deposit that says it has not left, are states nobody could explain
    -- afterwards — the same rule `supplier_payment` keeps about POSTED.
    CHECK ((status IN ('IN_TRANSIT', 'LANDED')) = (sent_entry_id IS NOT NULL)),
    CHECK ((status = 'LANDED') = (landed_entry_id IS NOT NULL)),
    CHECK ((status = 'LANDED') = (landed_on IS NOT NULL))
);

-- What is in the air, per unit. The index the in-transit figure is read from,
-- and the one a shop's list is drawn from.
CREATE INDEX ix_store_deposit_place
    ON store_deposit (site_id, banked_on DESC);
CREATE INDEX ix_store_deposit_outstanding
    ON store_deposit (status, banked_on) WHERE status = 'IN_TRANSIT';
CREATE INDEX ix_store_deposit_bank_line
    ON store_deposit (bank_line_id) WHERE bank_line_id IS NOT NULL;

COMMENT ON TABLE store_deposit IS
    'Takings between a drawer and a bank account. Two postings on two dates: '
    'out of the drawer into cash_in_transit when the bag leaves, out of '
    'cash_in_transit into the bank when the statement agrees. The in-transit '
    'balance is a ledger position, not a screen''s arithmetic.';

COMMENT ON COLUMN store_deposit.landed_on IS
    'The bank''s date, not ours. Null while the money is in transit.';
