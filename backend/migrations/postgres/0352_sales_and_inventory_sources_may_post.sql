-- Selectively reopen document posting for the Sales and Inventory flows that
-- now have deliberate account-map targets. The global switch stays false.

CREATE TABLE finance_posting_source_policy (
    source_kind text PRIMARY KEY CHECK (source_kind ~ '^[A-Z][A-Z_]*$'),
    module text NOT NULL CHECK (module IN ('SALES', 'INVENTORY')),
    enabled boolean NOT NULL DEFAULT false,
    set_by text NOT NULL,
    set_at timestamptz NOT NULL DEFAULT now(),
    note text
);

COMMENT ON TABLE finance_posting_source_policy IS
    'Per-source exception to the global Finance posting pause. Only explicitly reviewed Sales and Inventory source kinds may post while the global switch remains off.';

INSERT INTO finance_posting_source_policy
    (source_kind, module, enabled, set_by, note)
VALUES
    ('SALE_DAY', 'SALES', true, 'migration:0352', 'Daily sales; unresolved tender meanings fail closed at account resolution.'),
    ('RETENDER', 'SALES', true, 'migration:0352', 'Operator-requested reclassification between supported tender accounts.'),
    ('VOUCHER_ISSUE', 'SALES', true, 'migration:0352', 'Voucher issue against cash, sales return, promotion, and customer advances.'),
    ('GOODS_RECEIPT', 'INVENTORY', true, 'migration:0352', 'Goods received but not yet invoiced.'),
    ('SUPPLIER_INVOICE', 'INVENTORY', true, 'migration:0352', 'Supplier invoice with merchandise and input VAT mappings.'),
    ('CREDIT_NOTE', 'INVENTORY', true, 'migration:0352', 'Supplier credit note and inventory return.'),
    ('COGS_DAY', 'INVENTORY', true, 'migration:0352', 'Cost of merchandise sold from the valued stock ledger.'),
    ('STOCK_COUNT', 'INVENTORY', true, 'migration:0352', 'Stock-count loss against inventory.'),
    ('WRITE_OFF', 'INVENTORY', true, 'migration:0352', 'Inventory damage or disposal.'),
    ('LANDED_COST', 'INVENTORY', true, 'migration:0352', 'Allocate landed cost between remaining stock and cost of sales.')
ON CONFLICT (source_kind) DO UPDATE
    SET module = EXCLUDED.module,
        enabled = EXCLUDED.enabled,
        set_by = EXCLUDED.set_by,
        set_at = now(),
        note = EXCLUDED.note;

CREATE OR REPLACE FUNCTION enforce_finance_posting_pause()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    source_posting_allowed boolean;
BEGIN
    -- A Finance user explicitly submitting a manual journal or requesting a
    -- reversal remains an allowed, human-controlled action.
    IF NEW.source_kind IN ('MANUAL', 'REVERSAL') THEN
        RETURN NEW;
    END IF;

    SELECT control.automatic_posting_enabled
           OR EXISTS (
               SELECT 1
                 FROM finance_posting_source_policy policy
                WHERE policy.source_kind = NEW.source_kind
                  AND policy.enabled
           )
      INTO source_posting_allowed
      FROM finance_posting_control control
     WHERE control.singleton = true
     FOR SHARE;

    -- Fail closed if the singleton control row is ever missing.
    IF NOT COALESCE(source_posting_allowed, false) THEN
        RAISE EXCEPTION 'automatic posting is paused for source kind % while Finance reviews its chart and posting maps', NEW.source_kind
            USING ERRCODE = 'P0001',
                  CONSTRAINT = 'finance_automatic_posting_paused';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON TRIGGER finance_posting_pause_guard ON journal_entry IS
    'The database refuses source-driven journal entries unless global Finance posting is enabled or the source kind has an explicit allowlist entry. MANUAL entries and explicit reversals remain permitted.';

DO $$
BEGIN
    IF (SELECT automatic_posting_enabled FROM finance_posting_control WHERE singleton = true) THEN
        RAISE EXCEPTION '0352 expects global automatic posting to remain off';
    END IF;

    IF (SELECT count(*) FROM finance_posting_source_policy WHERE enabled) <> 10 THEN
        RAISE EXCEPTION '0352 did not install the complete Sales and Inventory source allowlist';
    END IF;
END;
$$;
