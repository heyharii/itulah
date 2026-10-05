-- A return to a supplier from HO return stock is a RETURN_TO_SUPPLIER
-- allotment (the goods) plus the terms Buying agreed with the supplier (the
-- money owed back). An over-delivery is not one of these: it goes back on a
-- purchase_return (0710) and nothing is owed for it.

CREATE TABLE supplier_return (
    allotment_id        uuid PRIMARY KEY REFERENCES allotment (id),
    supplier_id         text NOT NULL CHECK (btrim(supplier_id) <> ''),
    supplier_name       text,
    reason              text NOT NULL CHECK (reason IN ('DEFECT', 'WRONG_ITEM', 'UNSOLD')),
    settle_by           text NOT NULL CHECK (settle_by IN ('REPLACEMENT', 'REFUND', 'CREDIT_NOTE')),
    note                text,
    raised_by           text NOT NULL CHECK (btrim(raised_by) <> ''),
    raised_at           timestamptz NOT NULL DEFAULT now(),
    closed_short_reason text,
    closed_short_by     text,
    closed_short_at     timestamptz,
    CHECK ((closed_short_at IS NULL) = (closed_short_reason IS NULL))
);

-- What each SKU was bought at when the return was raised: the return's value
-- never moves after that.
CREATE TABLE supplier_return_cost (
    allotment_id    uuid NOT NULL REFERENCES supplier_return (allotment_id),
    sku_id          uuid NOT NULL REFERENCES sku (id),
    unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),
    PRIMARY KEY (allotment_id, sku_id)
);

-- What came back: replacement goods (counted at Receiving), a refund (BKM) or
-- a credit note (Finance). Written once each.
CREATE TABLE supplier_return_settlement (
    settlement_id uuid PRIMARY KEY,
    allotment_id  uuid NOT NULL REFERENCES supplier_return (allotment_id),
    kind          text NOT NULL CHECK (kind IN ('REPLACEMENT', 'REFUND', 'CREDIT_NOTE')),
    quantity      bigint CHECK (quantity IS NULL OR quantity > 0),
    amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
    reference     text,
    recorded_by   text NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at   timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'REPLACEMENT') = (quantity IS NOT NULL))
);

CREATE INDEX ix_supplier_return_settlement_return ON supplier_return_settlement (allotment_id);

CREATE TRIGGER supplier_return_settlement_append_only
    BEFORE UPDATE OR DELETE ON supplier_return_settlement
    FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

COMMENT ON TABLE supplier_return IS
    'A return to a supplier from HO return stock (0717): the RETURN_TO_SUPPLIER allotment it is, why, and how the supplier settles it.';
