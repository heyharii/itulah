-- 0146: What goods cost, kept as layers nobody may overwrite.
--
-- # The hole this fills
--
-- Until now the system knew what stock it HAD and never what that stock COST.
-- `inventory_projection` counts pieces; `journal_line` carries money that came
-- from a supplier bill; and nothing joins the two. So a sold shirt could not
-- say what it cost, `5010110001 Harga Pokok Pembelian` took nothing from any
-- sale, and the inventory account only ever went up.
--
-- # The scope decision everything else follows from
--
--     one queue per ARTICLE, for the whole company
--
-- Location is deliberately not in it. Moving a shirt from the DC to a store
-- does not change what it cost, so a queue per site would make an internal
-- transfer consume basis and post cost of goods for a shirt that never left the
-- company. That is the single most common way inventory valuation goes quietly
-- wrong, and it is quiet precisely because every individual number still looks
-- right and the trial balance still balances.
--
-- EPC is physical identity and nothing else. It links a sold unit back to the
-- delivery it arrived on, which is worth having, and it never chooses the cost
-- layer: PSAK 14 does not allow specific identification for interchangeable
-- goods, and neither does the tax treatment the client is already filing under.
--
-- # Why layers are appended and never edited
--
-- A layer that changes retroactively makes every report printed before the
-- change unreproducible. So a correction is a row in `cost_layer_adjustment`
-- and the effective cost is the fold of the layer and its live components, done
-- at read time. A mutable layer IS the authority the moment somebody updates
-- it, and the immutable facts underneath become decoration.
--
-- # What a layer costs, in version one
--
-- The net purchase price, and nothing else. Freight, duty, insurance and
-- handling are expensed as incurred — which is what the client already does,
-- through `6010110007 Biaya Pengiriman Barang/kurir/Ekspedisi`. Those component
-- types exist below and are switched OFF, so turning one on later is an UPDATE
-- to one row rather than a migration against live cost history.
--
-- A discount on the supplier's invoice REDUCES THE LAYER. The client's
-- periodic habit is to book it to `8010110003 Potongan Pembelian`, which is an
-- income account; doing that overstates both inventory and other income by the
-- same amount and leaves the goods carrying a price nobody paid.

-- ---------------------------------------------------------------------------
-- What a cost may be made of
-- ---------------------------------------------------------------------------
--
-- A table and not a CHECK, because "we now capitalise freight" has to be a data
-- change. A CHECK constraint would make it a migration, and a migration against
-- a table holding a year of cost history is the kind of change nobody schedules.
--
-- The composite unique key plus a pinned column on the child is the same device
-- `journal_line (account_code, is_group)` uses to make posting to a heading
-- impossible: the child pins `capitalised = true`, carries it into the foreign
-- key, and a component the company expenses simply cannot be written onto a
-- layer.
CREATE TABLE cost_component_type (
    component_type text PRIMARY KEY CHECK (component_type ~ '^[A-Z][A-Z_]*$'),
    label          text NOT NULL CHECK (btrim(label) <> ''),

    -- May this component sit on a layer at all? False means the company
    -- expenses it as incurred and it is not part of what the goods cost.
    capitalised    boolean NOT NULL,

    -- Is this component part of the layer's OPENING figure — what the goods
    -- cost on the day they arrived — as opposed to something that turned up
    -- afterwards? The opening components are checked against
    -- `cost_layer.opening_cost_minor`; the rest are folded in at read time.
    is_opening     boolean NOT NULL,

    note           text NOT NULL,

    -- Non-opening components cannot be capitalised without also being
    -- foldable, and an opening component that is not capitalised is a
    -- contradiction: it would be part of a cost the company does not carry.
    CHECK (capitalised OR NOT is_opening),
    UNIQUE (component_type, capitalised)
);

INSERT INTO cost_component_type (component_type, label, capitalised, is_opening, note) VALUES
    ('PURCHASE', 'Purchase price', true, true,
     'What the supplier charged for the goods themselves, gross of any discount.'),
    ('DISCOUNT', 'Invoice discount', true, true,
     'Negative. Reduces the layer. Never booked to 8010110003 Potongan Pembelian: a discount on merchandise is a lower cost, not other income.'),
    ('PRICE_CORRECTION', 'Price correction', true, false,
     'The supplier billed a different price than the goods were received at. Split once, when it arrives, between what is still on hand and what has already been sold.'),
    ('FREIGHT', 'Inbound freight', false, false,
     'Expensed as incurred, to 6010110007 Biaya Pengiriman Barang/kurir/Ekspedisi. Set capitalised = true to start landing it on the goods.'),
    ('DUTY', 'Import duty', false, false,
     'Expensed as incurred. Defined so switching it on is one UPDATE and not a migration.'),
    ('INSURANCE', 'Freight insurance', false, false,
     'Expensed as incurred.'),
    ('HANDLING', 'Handling and clearance', false, false,
     'Expensed as incurred.'),
    ('OTHER', 'Other landed cost', false, false,
     'Expensed as incurred. A catch-all that must never quietly become the usual answer.');

COMMENT ON TABLE cost_component_type IS
    'What a cost may be made of, and which parts the company capitalises. Data, not a CHECK, so capitalising freight later is an UPDATE rather than a migration against live cost history.';

-- ---------------------------------------------------------------------------
-- The layer
-- ---------------------------------------------------------------------------

CREATE TABLE cost_layer (
    layer_id           uuid PRIMARY KEY,

    -- The FIFO scope, and the whole of it. Not the site, not the pool, not the
    -- SKU: an order is placed against an article and the colours and sizes are
    -- worked out after the delivery has been accepted, so the article is the
    -- only grain a receipt can honestly cost.
    article_id         uuid NOT NULL REFERENCES article(id),

    -- Pieces, already converted out of the purchase unit of measure by whoever
    -- counted them. A carton of twelve is one line and twelve pieces.
    quantity           bigint NOT NULL CHECK (quantity > 0),

    -- The layer's money on the day it arrived: the purchase price less any
    -- discount on the invoice. Authoritative — `unit_cost_minor` is derived
    -- from it and not the other way round, because a line of seven pieces for
    -- 100,000 has no exact unit price and rounding the unit first loses a
    -- rupiah on every consumption.
    opening_cost_minor bigint NOT NULL CHECK (opening_cost_minor >= 0),

    -- What one piece cost, for reading. Pinned to the total by a CHECK rather
    -- than left to whoever inserts the row: two numbers describing one fact
    -- drift, and the day they do nobody can say which is the cost.
    unit_cost_minor    bigint NOT NULL CHECK (unit_cost_minor >= 0),

    currency           char(3) NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),

    -- When the goods were economically accepted, which is not when this row was
    -- written. Identification can finish days after a truck was unloaded, and
    -- stamping the later date drifts the cost into the wrong month — invisible
    -- until a close does not tie out.
    economic_date      date NOT NULL,
    recorded_at        timestamptz NOT NULL DEFAULT now(),

    -- Where the goods came from. Nullable because a layer can be opened for an
    -- opening balance or a correction that has no delivery behind it, and
    -- because Lane G is still wiring goods receipts through to here.
    receipt_id         uuid REFERENCES goods_receipt(receipt_id),
    receipt_line_id    uuid REFERENCES goods_receipt_line(receipt_line_id),
    -- The delivery note or document number a person would quote on the phone,
    -- for the days the reference above is not there to be had.
    source_reference   text,
    supplier_id        text,

    -- Where the goods physically landed. NOT the FIFO scope — see the header.
    -- Kept because a layer that cannot say where it arrived cannot be
    -- reconciled against a delivery.
    site_id            text NOT NULL REFERENCES site(id),

    idempotency_key    text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
    created_by         text NOT NULL CHECK (btrim(created_by) <> ''),

    CHECK (unit_cost_minor = opening_cost_minor / quantity)
);

-- The queue's own index: article, then the order it consumes in.
CREATE INDEX ix_cost_layer_queue
    ON cost_layer (article_id, economic_date, recorded_at, layer_id);
CREATE INDEX ix_cost_layer_receipt ON cost_layer (receipt_id) WHERE receipt_id IS NOT NULL;

COMMENT ON TABLE cost_layer IS
    'One receipt line, as a cost. The FIFO queue is article x company; location is deliberately not in the scope, because moving stock between our own places does not change what it cost.';
COMMENT ON COLUMN cost_layer.opening_cost_minor IS
    'Net purchase price for the whole line: purchase less invoice discount. Authoritative; unit_cost_minor is derived from it by a CHECK.';

-- ---------------------------------------------------------------------------
-- What the layer is made of, and what arrived afterwards
-- ---------------------------------------------------------------------------
--
-- Append-only. A superseded component is marked, never deleted, so a
-- correction that was itself wrong leaves both rows behind and the sequence can
-- be read.

CREATE TABLE cost_layer_adjustment (
    adjustment_id  uuid PRIMARY KEY,
    layer_id       uuid NOT NULL REFERENCES cost_layer(layer_id),

    component_type text NOT NULL,
    -- Pinned, and carried into the foreign key below. A component the company
    -- expenses as incurred is refused by the database, not by a convention
    -- somebody has to remember.
    capitalised    boolean NOT NULL DEFAULT true CHECK (capitalised = true),

    -- Signed. A discount is negative; a price correction goes either way. Zero
    -- is refused: a component that changes nothing is noise in a history whose
    -- whole value is being readable.
    amount_minor   bigint NOT NULL CHECK (amount_minor <> 0),

    effective_date date NOT NULL,
    reason         text NOT NULL CHECK (btrim(reason) <> ''),
    actor          text NOT NULL CHECK (btrim(actor) <> ''),

    -- The component that replaced this one. Self-referential rather than a
    -- status flag, because "which one replaced it" is the question anybody
    -- reading a corrected cost actually has.
    superseded_by  uuid REFERENCES cost_layer_adjustment(adjustment_id),

    -- How a price correction was split when it arrived, and the entry that
    -- recorded it. Both null on an opening component, which has no split and
    -- no journal of its own: the goods' arrival is posted by the supplier's
    -- bill, and debiting inventory here as well would put the same money in
    -- twice.
    inventory_portion_minor bigint,
    cogs_portion_minor      bigint,
    journal_entry_id        uuid REFERENCES journal_entry(entry_id),

    idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
    recorded_at     timestamptz NOT NULL DEFAULT now(),

    -- A split is both halves or neither, and it adds up to the component. This
    -- is the one place this system improves on the implementation it was ported
    -- from, which debits inventory in full and strands the sold portion there.
    CHECK ((inventory_portion_minor IS NULL) = (cogs_portion_minor IS NULL)),
    CHECK (inventory_portion_minor IS NULL
           OR inventory_portion_minor + cogs_portion_minor = amount_minor),

    FOREIGN KEY (component_type, capitalised)
        REFERENCES cost_component_type (component_type, capitalised)
);

CREATE INDEX ix_cost_layer_adjustment_layer
    ON cost_layer_adjustment (layer_id) WHERE superseded_by IS NULL;

COMMENT ON TABLE cost_layer_adjustment IS
    'Append-only components of a cost: the purchase and the discount that make up the opening figure, and every correction that arrived after. Nothing here edits a layer.';

-- ---------------------------------------------------------------------------
-- Invariant: the opening figure agrees with the components that make it up
-- ---------------------------------------------------------------------------
--
-- Deliberately redundant, and checked, in exactly the arrangement
-- `journal_entry.total_minor` has with its lines. The header is what the queue
-- reads; the components are what a person reads when they want to know why the
-- header says what it says. A header that silently disagreed with them would be
-- the failure this trigger exists to make impossible.
--
-- Deferred, because the layer is inserted before its components exist. Fires on
-- both tables, because either one alone leaves a hole: checking only the layer
-- misses components appended afterwards, and checking only the components
-- misses a layer that never got any.
--
-- P0001 on purpose. `AppError::into_response` passes exactly that SQLSTATE
-- through as a 409 with the message intact; anything more precise-looking
-- arrives as an opaque 500. Same convention as `assert_journal_balanced`.

CREATE OR REPLACE FUNCTION assert_cost_layer_opens_at_its_components() RETURNS trigger AS $$
DECLARE
    target   uuid;
    header   bigint;
    parts    bigint;
    n        bigint;
BEGIN
    target := NEW.layer_id;

    SELECT opening_cost_minor INTO header FROM cost_layer WHERE layer_id = target;
    -- Rolled back out from under us; there is nothing left to check.
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*), COALESCE(SUM(a.amount_minor), 0) INTO n, parts
      FROM cost_layer_adjustment a
      JOIN cost_component_type t ON t.component_type = a.component_type
     WHERE a.layer_id = target AND a.superseded_by IS NULL AND t.is_opening;

    IF n = 0 THEN
        RAISE EXCEPTION
            'cost layer % has no purchase component; a layer has to say what was paid for the goods',
            target;
    END IF;
    IF parts <> header THEN
        RAISE EXCEPTION
            'cost layer % opens at % but its purchase and discount come to %',
            target, header, parts;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER cost_layer_opens_at_its_components
    AFTER INSERT ON cost_layer
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_cost_layer_opens_at_its_components();

CREATE CONSTRAINT TRIGGER cost_layer_adjustment_opens_at_its_components
    AFTER INSERT ON cost_layer_adjustment
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_cost_layer_opens_at_its_components();

-- ---------------------------------------------------------------------------
-- Invariant: a layer is never overwritten
-- ---------------------------------------------------------------------------
--
-- Same shape as `protect_journal` in 0051. An UPDATE that fixed a wrong cost
-- would leave no trace that it had ever been wrong, and every report printed
-- before it would become unreproducible. `superseded_by` is the one column that
-- may move, because marking a replaced component IS the append-only way to
-- correct one.

CREATE OR REPLACE FUNCTION protect_cost_layer() RETURNS trigger AS $$
DECLARE
    replacement uuid;
    probe       cost_layer_adjustment;
BEGIN
    -- The one legal UPDATE: an untouched component being marked as replaced.
    -- Checked by nulling the pointer on a copy and comparing whole rows, rather
    -- than by listing the columns that must not move — a list like that is
    -- silently wrong the day somebody adds a column.
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'cost_layer_adjustment'
       AND OLD.superseded_by IS NULL AND NEW.superseded_by IS NOT NULL THEN
        replacement := NEW.superseded_by;
        probe := NEW;
        probe.superseded_by := NULL;
        IF ROW(probe.*) IS NOT DISTINCT FROM ROW(OLD.*) THEN
            RETURN NEW;
        END IF;
        NEW.superseded_by := replacement;
    END IF;
    RAISE EXCEPTION
        'a cost is append-only: correct % by appending a component and marking the old one superseded, not by a raw %',
        TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cost_layer_append_only
    BEFORE UPDATE OR DELETE ON cost_layer
    FOR EACH ROW EXECUTE FUNCTION protect_cost_layer();
CREATE TRIGGER cost_layer_adjustment_append_only
    BEFORE UPDATE OR DELETE ON cost_layer_adjustment
    FOR EACH ROW EXECUTE FUNCTION protect_cost_layer();
