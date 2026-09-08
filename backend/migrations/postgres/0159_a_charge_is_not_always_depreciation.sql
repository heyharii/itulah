-- 0159: A monthly charge is not always depreciation, and a row is not always
--       one thing.
--
-- Both halves of this come from reading the client's own two exports —
-- `MASTER ASSET.xls` (1,342 rows, their live register) against
-- `Laporan_Master_Account1.csv` (7,528 accounts, their chart) — and neither is
-- visible from inside this repository.
--
-- # What was wrong: `1021607` is not accumulated depreciation
--
-- 0070 read the client's chart as seven asset families under `10215` with
-- seven matching accumulated-depreciation families under `10216`, and mapped
-- one pair of meanings — `depreciation_expense` and
-- `accumulated_depreciation` — across all seven. Six of them are right. The
-- seventh is not, and the chart says so in its own names:
--
--     1021507  Operating Equipment
--     1021607  Reserve Replacement - Operating Equipment       <- not "Akum-Penyusu"
--     7010215  BIAYA REPLACEMENT OPERATING EQUIPMENT           <- not "BIAYA DEPRESIASI"
--
-- Racks, hangers, mannequins and sensor pins do not lose value over a useful
-- life; they get broken and replaced, and the client accrues the cost of
-- replacing them. Same debit-and-credit shape, same straight-line arithmetic,
-- entirely different meaning — and a different pair of accounts, in a family
-- `accumulated_depreciation` must never resolve to.
--
-- The same is true one family over. `10217 INTANGIBLE ASSET` is amortised, not
-- depreciated, through `1021702 Acc Amort Software` and `7010216 BIAYA
-- AMORTISASI`. 0070 could not register such an asset at all: `ASSET_FAMILY`
-- admits only `10215`.
--
-- # Why this is a column and not a prefix test
--
-- `charge_kind` is derivable — `1021507*` accrues, `10217*` amortises,
-- everything else depreciates. Deriving it is what this migration refuses to
-- do, because that puts three client account codes inside a posting rule, and
-- a posting rule that names a client account is the single thing 0050 exists to
-- prevent. `ASSET_FAMILY` is named in Rust and says why it is allowed to be:
-- it RECOGNISES an account, it does not CHOOSE one. Choosing which pair of
-- accounts a monthly charge lands in is choosing.
--
-- So the kind is what Finance decided, recorded beside the method it decided
-- with, and the accounts still come from `account_map` by meaning. Three
-- meanings become nine, and the map answers all nine the same way.
--
-- # The trap this closes, which is worth the column on its own
--
-- The client's register writes `NON DEPRECIABLE` in its METHOD column for all
-- 200 operating-equipment rows — and charges every one of them 20% a year,
-- every month, against `Biaya Replacement`. Their own file calls the accrual
-- "not depreciable" because in their vocabulary it is not depreciation.
--
-- An import that believes that column sets `method = 'NONE'` on all 200 rows,
-- `monthly_charge` returns `NotDepreciated`, and Rp 4.36 billion of
-- replacement accrual stops. Nothing fails. No entry is refused. The reserve
-- accounts simply never move again, and the first person to notice is whoever
-- reconciles `1021607*` a year later. With a `charge_kind` the two facts are
-- separate: HOW the value is spread, and WHAT the charge is called.
--
-- # What was wrong: a row is not always one thing
--
-- `fixed_asset` assumed one row is one object. The client's register does not:
--
--     OE - PIN / Kawat Sensor HO      JUMLAH 60,000   NILAI 1,000
--     OE - Hanger  Pria HO            JUMLAH 10,000   NILAI 15,000
--
-- 92 of their rows carry a quantity above one. Nobody tracks hanger number
-- 7,431, and exploding these into 60,000 registrations would turn a register
-- of 670 things into one of well over a hundred thousand, every one of them
-- indistinguishable from its neighbours.
--
-- So a row may be a LOT. `quantity` carries no money — cost stays in
-- `asset_capitalization`, where 0070 put it, and the cost of a lot is the cost
-- of the lot. It is an operational fact about the thing, which is exactly what
-- `fixed_asset` is for.
--
-- `unit_sequence` is the opposite case and stays: a receipt line for five
-- laptops yields five rows because those five are tracked apart. The two are
-- mutually exclusive, and the CHECK says so — a row that is one unit of a
-- receipt line cannot also be a lot of eight hundred.
--
-- # Note on partial disposal
--
-- A lot of 10,000 hangers of which 200 break is a real event this schema still
-- cannot record: 0096 disposes of a whole asset. That is deliberately NOT
-- added here. Whether the client reduces a lot's value or lets it run out its
-- life is a question that has been put to them and not yet answered, and
-- guessing at it would mean inventing a second way for cost to leave the
-- books.

-- ---------------------------------------------------------------------------
-- What a monthly charge is called, and which pair of accounts it lands in.
-- ---------------------------------------------------------------------------

ALTER TABLE asset_capitalization ADD COLUMN charge_kind text;

-- Existing assessments predate the distinction and are all depreciation: the
-- register as it stands holds nothing under `10217`, because until this
-- migration nothing under `10217` could be registered.
--
-- The append-only trigger is stood down for exactly this statement. It exists
-- to stop an ASSESSMENT being edited — a decision being quietly restated — and
-- this is not that: no decision changes, a fact that was already true is
-- written down where it can be read. A correction to a real assessment is
-- still a new row with a higher sequence, and after this statement the trigger
-- enforces that again.
ALTER TABLE asset_capitalization DISABLE TRIGGER asset_capitalization_append_only;
UPDATE asset_capitalization SET charge_kind = 'DEPRECIATION' WHERE decision = 'CAPITALIZE';
ALTER TABLE asset_capitalization ENABLE TRIGGER asset_capitalization_append_only;

ALTER TABLE asset_capitalization
    ADD CONSTRAINT asset_capitalization_charge_kind_known
    CHECK (charge_kind IS NULL
           OR charge_kind IN ('DEPRECIATION', 'REPLACEMENT_RESERVE', 'AMORTISATION'));

-- Carried by a capitalised asset and by nothing else, for the same reason
-- 0070 gives for the rest of the basis: half a basis is what makes a run
-- guess. An expensed asset has no monthly charge, so it has no name for one.
ALTER TABLE asset_capitalization
    ADD CONSTRAINT asset_capitalization_charge_kind_follows_decision
    CHECK ((decision = 'CAPITALIZE' AND charge_kind IS NOT NULL)
           OR (decision = 'EXPENSE' AND charge_kind IS NULL));

COMMENT ON COLUMN asset_capitalization.charge_kind IS
    'What the monthly charge is called, which decides the pair of meanings it posts through: DEPRECIATION -> depreciation_expense/accumulated_depreciation, REPLACEMENT_RESERVE -> replacement_expense/replacement_reserve (the client''s 1021607 is a reserve, not accumulated depreciation), AMORTISATION -> amortisation_expense/accumulated_amortisation. Separate from `method`, which is how the value is spread: the client''s own register writes NON DEPRECIABLE against 200 rows it charges every month.';

-- ---------------------------------------------------------------------------
-- One row may be a lot.
-- ---------------------------------------------------------------------------

ALTER TABLE fixed_asset
    ADD COLUMN quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1);

ALTER TABLE fixed_asset
    ADD CONSTRAINT fixed_asset_a_lot_is_not_a_tracked_unit
    CHECK (unit_sequence IS NULL OR quantity = 1);

COMMENT ON COLUMN fixed_asset.quantity IS
    'How many things this row is. 1 for one object; the client keeps lots — 60,000 sensor pins as one row. Carries no money: the cost of the lot is the lot''s capitalized_cost_minor. Mutually exclusive with unit_sequence, which is the opposite case: a receipt line split into units tracked apart.';
