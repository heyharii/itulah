-- 0137: A ledger line can name its asset, and a bill line can buy one.
--
-- Two halves of the same absence, and they are worth stating together because
-- either alone leaves the other useless.
--
-- # Half one: the ledger has no asset dimension
--
-- `journal_line` carries `supplier_id` and nothing else. So the forty-four
-- depreciation credits sitting on `10216*` are, as far as the ledger is
-- concerned, forty-four anonymous amounts: to answer "what has this machine
-- cost us" somebody has to read `asset_depreciation_entry`, which knows the
-- depreciation and knows nothing about the disposal, the transfer, or the
-- acquisition. The register and the ledger each hold half the answer and
-- neither can be asked the question.
--
-- `asset_id` here is the same kind of column `supplier_id` already is: a
-- sub-ledger dimension on the line, nullable because most lines are about
-- nothing of the sort. It is set by the posting rules that KNOW which asset
-- they are about — depreciation, disposal, transfer, and the acquisition line
-- below — and it is never inferred afterwards. A dimension guessed from an
-- account code would be wrong the first time two assets shared a class, which
-- in this client's chart is every asset.
--
-- The reserve charge added in 0139 deliberately leaves it NULL, and that is not
-- an oversight: a replacement reserve is charged per CLASS of equipment, not
-- per thing. There is no asset it is about.
--
-- # Half two: nothing on a bill line says it bought an asset
--
-- 0099 gave `fixed_asset` a pointer at the bill line that bought it and argued,
-- correctly, that there is no acquisition posting rule to write — the bill IS
-- the acquisition. What it left out is the other direction: a bill line coded
-- to `102150400305 Eskalator C005` is a capital purchase, and posting it put
-- the money in the books while nothing at all appeared on the register.
-- `acquisition_gap` has been reporting exactly that ever since, as a list
-- somebody has to work through by hand.
--
-- `asset_class_code` is the person keying the bill saying so at the moment they
-- are holding the paper — which is the only moment anybody knows. When the bill
-- posts, the asset appears, in DRAFT, pointing at the line that bought it. It
-- carries no cost of its own: the cost is the bill line, and Finance still has
-- to assess it. What is removed is the step where somebody notices.
--
-- # Why DRAFT is a fourth status and not an absent assessment
--
-- 0070 already distinguishes "nobody has assessed this" from "assessed and
-- expensed", and that distinction stays. DRAFT answers a different question:
-- who put this row here. A REGISTERED asset was registered by a person who saw
-- the thing; a DRAFT asset was minted by a posting, from a line of a document,
-- and nobody has yet confirmed that the thing exists, where it is, or what it
-- is called. Those are different worklists — one is Finance's, one is the
-- warehouse's — and a single "unassessed" bucket would merge them.
--
-- A DRAFT asset never depreciates, because the run asks for a CAPITALIZE
-- assessment and a draft has none. Assessing it is what promotes it.

-- ---------------------------------------------------------------------------
-- The dimension
-- ---------------------------------------------------------------------------

ALTER TABLE journal_line
    ADD COLUMN asset_id uuid REFERENCES fixed_asset(asset_id);

-- Partial, for the reason `ix_journal_line_supplier` is partial: almost every
-- line in the ledger is about no asset at all, and an index over those is an
-- index over nothing.
CREATE INDEX ix_journal_line_asset ON journal_line (asset_id)
    WHERE asset_id IS NOT NULL;

COMMENT ON COLUMN journal_line.asset_id IS
    'Which asset this line is about, when it is about one. Set by the posting rules that know — depreciation, disposal, transfer, acquisition — and never inferred from an account code, because a class holds many assets. NULL on a replacement-reserve charge, which is per class and about no single thing.';

-- ---------------------------------------------------------------------------
-- The acquisition, said on the document
-- ---------------------------------------------------------------------------

ALTER TABLE supplier_invoice_expense_line
    -- The client's own asset class: a family under `10215` such as `1021504
    -- Machineries`, or one of the thirty-six operating-equipment classes such
    -- as `1021507001 OE - Rak 1`. A foreign key to the chart rather than to a
    -- register of our own — 0070's argument, unchanged: the chart IS the list
    -- of asset kinds and a second one would drift.
    --
    -- That the code is under `10215` is checked in Rust and not here. A CHECK
    -- naming a client account code is precisely what 0050 exists to prevent,
    -- and 0099 makes the same call for the same reason.
    ADD COLUMN asset_class_code text REFERENCES ledger_account(account_code);

COMMENT ON COLUMN supplier_invoice_expense_line.asset_class_code IS
    'Set when this line buys a fixed asset: posting the bill mints a DRAFT fixed_asset in that class, pointing back here through acquired_via_line_id. NULL on the electricity.';

CREATE INDEX ix_supplier_invoice_expense_line_asset_class
    ON supplier_invoice_expense_line (asset_class_code)
    WHERE asset_class_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- DRAFT
-- ---------------------------------------------------------------------------

ALTER TABLE fixed_asset DROP CONSTRAINT fixed_asset_status_check;
ALTER TABLE fixed_asset ADD CONSTRAINT fixed_asset_status_check
    CHECK (status IN ('DRAFT', 'REGISTERED', 'IN_SERVICE', 'DISPOSED'));

COMMENT ON COLUMN fixed_asset.status IS
    'DRAFT: minted by a posted bill line, nobody has confirmed the thing exists. REGISTERED: a person put it here. IN_SERVICE / DISPOSED: the rest of the life.';

-- ---------------------------------------------------------------------------
-- A number for an asset nobody named
-- ---------------------------------------------------------------------------
--
-- `asset_number` is UNIQUE and a person types it. A posting cannot ask anybody,
-- so it needs a source of numbers that cannot collide with what is already
-- there. The sequence starts above the highest `AST-` number in the register,
-- so a fresh database starts at one and a seeded one does not tread on
-- `AST-000021`.
--
-- Deriving the number from the invoice instead was the other candidate and is
-- wrong: an invoice number is unique per SUPPLIER, so two suppliers' `INV-001`
-- would mint one asset and refuse the second, at COMMIT, inside somebody's
-- attempt to post a bill.

CREATE SEQUENCE fixed_asset_number_seq AS bigint START WITH 1;

SELECT setval(
    'fixed_asset_number_seq',
    GREATEST(
        1,
        COALESCE(
            (SELECT MAX(substring(asset_number FROM '^AST-([0-9]+)$')::bigint)
               FROM fixed_asset
              WHERE asset_number ~ '^AST-[0-9]+$'),
            0
        )
    )
);

COMMENT ON SEQUENCE fixed_asset_number_seq IS
    'Numbers for assets a posting minted rather than a person named. AST-000123.';
