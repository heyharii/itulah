-- 0070: Fixed assets — identity, the decision to capitalise, and depreciation.
--
-- Ported in shape from `~/Documents/fresh` (`037_assets_v1.sql`), which is the
-- third generation of this table and the first one that got the separation
-- right. Three of its ideas are kept, and three of its decisions are not.
--
-- # Kept: the thing and the money are different questions
--
-- `fixed_asset` carries NO monetary column. Not a cost, not a book value, not a
-- salvage figure. Operations answers "what is this and where is it"; Finance
-- answers "does it belong in the books and at what number", and those are
-- different people on different days. An asset that came from a delivery keeps
-- a REFERENCE to the receipt line, never a copy of its price — the price
-- Finance capitalises is often not the price on the order, because freight and
-- installation are capitalised and a discount is not.
--
-- # Kept: silence is not a decision
--
-- "Nobody has assessed this yet" and "we assessed it and decided to expense it"
-- are a control gap and a closed control respectively, and a table that only
-- recorded capitalised assets could not tell them apart. So a refusal is a real
-- row, and no rows means exactly one thing.
--
-- # Kept: assessments are appended
--
-- Finance can assess wrongly. "Capitalised in January, reversed in March" is
-- itself the audit trail, so the highest sequence is the treatment in force and
-- nothing is ever edited.
--
-- # Changed: there is no category register
--
-- `fresh` has an `asset_categories` table carrying a depreciation method and a
-- useful life. We do not, because the client's own chart already IS the
-- register: `10215` has seven asset families, `10216` has the seven matching
-- accumulated-depreciation families, and `70102` has six depreciation-expense
-- families — the seventh, land, correctly has none. A category here is that
-- triple, resolved through `account_map` by qualifier, exactly as every other
-- posting rule resolves an account.
--
-- Adding a second register would put the list of asset kinds in two places, and
-- the day somebody adds a category to one and not the other is the day the
-- depreciation run silently skips a class of assets.
--
-- # Changed: the depreciation entry stores no running totals
--
-- `fresh` stores `accumulated_after_minor` and `book_value_after_minor` on each
-- entry. Both are sums over the entries before it, and accumulated depreciation
-- is ALSO a balance on account `10216*`. That is three copies of one number,
-- and this repository has one rule about that. Here the entry records what was
-- posted and nothing else; the accumulated figure is read from the ledger.
--
-- # Changed: no `store_id` copy
--
-- `fresh` copies the store onto the asset. We have `site`, and an asset that
-- came from a receipt already knows its site through the receipt. It is stored
-- here only because an asset may be registered by hand with no receipt behind
-- it, and it is the same `site` every other finance table references.

CREATE TABLE fixed_asset (
    -- Immutable, never recycled. Everything that refers to an asset points
    -- here.
    asset_id        uuid PRIMARY KEY,
    -- `AST-000123`. The human-facing code: printed on labels, typed into
    -- search boxes, and re-issuable — which is exactly why no history keys on
    -- it.
    asset_number    text NOT NULL UNIQUE CHECK (btrim(asset_number) <> ''),
    name            text NOT NULL CHECK (btrim(name) <> ''),

    -- The client account family this asset belongs to: one of the seven under
    -- `10215`. This IS the category. A foreign key to the chart rather than to
    -- a register of our own, so an asset cannot belong to a kind the client
    -- does not keep.
    category_code   text NOT NULL REFERENCES ledger_account(account_code),

    site_id         text NOT NULL REFERENCES site(id),
    status          text NOT NULL DEFAULT 'REGISTERED'
                    CHECK (status IN ('REGISTERED', 'IN_SERVICE', 'DISPOSED')),

    brand           text,
    model           text,
    serial_number   text,

    -- Where it came from, when it came from a delivery. Null for an asset the
    -- company already owned when this system arrived — which is most of them
    -- on day one, and not a gap to be back-filled with an invented receipt.
    receipt_line_id uuid REFERENCES goods_receipt_line(receipt_line_id),
    -- A receipt line for five laptops yields five assets. The sequence says
    -- which one, so re-running registration collides instead of minting a
    -- sixth.
    unit_sequence   integer CHECK (unit_sequence IS NULL OR unit_sequence >= 1),

    acquired_on     date NOT NULL,
    disposed_on     date,
    notes           text,
    registered_by   text NOT NULL,
    registered_at   timestamptz NOT NULL DEFAULT now(),

    CHECK ((receipt_line_id IS NULL) = (unit_sequence IS NULL)),
    CHECK ((status = 'DISPOSED') = (disposed_on IS NOT NULL)),
    CHECK (disposed_on IS NULL OR disposed_on >= acquired_on)
);
CREATE INDEX ix_fixed_asset_site ON fixed_asset (site_id, status);
CREATE INDEX ix_fixed_asset_category ON fixed_asset (category_code, site_id);
-- One unit of one receipt line is one asset, exactly once.
CREATE UNIQUE INDEX ux_fixed_asset_receipt_unit
    ON fixed_asset (receipt_line_id, unit_sequence)
    WHERE receipt_line_id IS NOT NULL;

-- Finance's decision about one asset, appended.
CREATE TABLE asset_capitalization (
    capitalization_id      uuid PRIMARY KEY,
    asset_id               uuid NOT NULL REFERENCES fixed_asset(asset_id),
    sequence               integer NOT NULL CHECK (sequence >= 1),
    decision               text NOT NULL CHECK (decision IN ('CAPITALIZE', 'EXPENSE')),

    -- Finance's number, not the order's. Freight and installation belong in
    -- it; a discount comes off it.
    capitalized_cost_minor bigint,
    salvage_value_minor    bigint,
    useful_life_months     integer,
    -- STRAIGHT_LINE  Garis Lurus
    -- DECLINING      Saldo Menurun
    -- NONE           Tidak Disusutkan — land, and it is a method rather than an
    --                absent value so a run never has to pre-filter on a null
    method                 text CHECK (method IS NULL
                                       OR method IN ('STRAIGHT_LINE', 'DECLINING', 'NONE')),
    in_service_on          date,

    reason                 text NOT NULL CHECK (btrim(reason) <> ''),
    assessed_by            text NOT NULL,
    assessed_at            timestamptz NOT NULL DEFAULT now(),

    UNIQUE (asset_id, sequence),
    -- A capitalised asset carries a COMPLETE basis; an expensed one carries
    -- none. Half a basis is what makes a depreciation run guess.
    CHECK (
        (decision = 'CAPITALIZE'
            AND capitalized_cost_minor IS NOT NULL AND capitalized_cost_minor > 0
            AND salvage_value_minor IS NOT NULL AND salvage_value_minor >= 0
            AND salvage_value_minor < capitalized_cost_minor
            AND useful_life_months IS NOT NULL AND useful_life_months >= 0
            AND method IS NOT NULL
            AND in_service_on IS NOT NULL)
        OR (decision = 'EXPENSE'
            AND capitalized_cost_minor IS NULL AND salvage_value_minor IS NULL
            AND useful_life_months IS NULL AND method IS NULL
            AND in_service_on IS NULL)
    ),
    -- A depreciable method without a life posts nothing, silently; a
    -- non-depreciable one must not pretend to have one.
    CHECK (method IS NULL
           OR (method = 'NONE' AND useful_life_months = 0)
           OR (method <> 'NONE' AND useful_life_months > 0))
);
-- The hot read is "the treatment in force for this asset".
CREATE INDEX ix_asset_capitalization_latest ON asset_capitalization (asset_id, sequence DESC);

CREATE OR REPLACE FUNCTION protect_asset_capitalization() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'an assessment is appended, not %: record a new one and the highest sequence wins',
        lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_capitalization_append_only
    BEFORE UPDATE OR DELETE ON asset_capitalization
    FOR EACH ROW EXECUTE FUNCTION protect_asset_capitalization();

-- One posted month of depreciation for one asset.
--
-- Idempotency is doubled deliberately: this unique index refuses a second entry
-- for a month, and the journal refuses a second entry for the same document.
-- Either alone is enough on the happy path; together they survive a crash
-- between the two writes.
CREATE TABLE asset_depreciation_entry (
    entry_id     uuid PRIMARY KEY,
    asset_id     uuid NOT NULL REFERENCES fixed_asset(asset_id),
    -- A month named by its first day. Any other day would let two "March"
    -- entries coexist.
    period_month date NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    -- No accumulated total and no book value. Both are sums over the entries
    -- before this one, and the accumulated figure is already a balance on the
    -- client's `10216*` accounts. Three copies of one number is two too many.
    journal_entry_id uuid NOT NULL REFERENCES journal_entry(entry_id),
    posted_by    text NOT NULL,
    posted_at    timestamptz NOT NULL DEFAULT now(),

    UNIQUE (asset_id, period_month)
);
CREATE INDEX ix_asset_depreciation_period ON asset_depreciation_entry (period_month, asset_id);

COMMENT ON TABLE fixed_asset IS
    'What the company owns, as Operations knows it. Carries no monetary column: the money is asset_capitalization, which Finance owns.';
COMMENT ON COLUMN fixed_asset.category_code IS
    'A family under the client''s 10215. This is the category — the chart is the register, and there is no second one.';
