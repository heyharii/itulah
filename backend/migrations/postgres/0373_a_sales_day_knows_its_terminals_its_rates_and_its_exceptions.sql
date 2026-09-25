-- 0373: Finance Connect stage 2 — the sales day knows its EDC terminals, the
-- acquirer's fee rates, and the tender lines it could not post.
--
-- Owner decisions of 25 Sep (FINANCE-CONNECT-BRIEF.md, stage 2):
--   * QRIS rides the EDC of a bank. It posts to that bank's debit-card
--     receivable (1021, qualifier bank) and debit-card sales leaf (4003-4006);
--     no QRIS account is created. The tender kind stays on the sale-day line.
--   * The POS sends the terminal id; `edc_terminal` says which bank it is.
--   * MDR defaults are Finance's: `acquirer_fee_rate`. The bank's MDR already
--     includes VAT, so the rate is the final figure.
--   * A tender line that cannot post (QRIS with no bank, an online tender)
--     does not stop the day: it waits in `sales_posting_exception`.

-- ── Finance settings ───────────────────────────────────────────────────────
CREATE TABLE finance_setting (
    setting_key   text PRIMARY KEY CHECK (setting_key ~ '^[a-z][a-z0-9_]*$'),
    value_numeric numeric NOT NULL,
    unit          text NOT NULL,
    note          text,
    set_by        text NOT NULL,
    set_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE finance_setting IS
    'Numbers Finance owns and may change: tolerances, windows, thresholds. Read by the posting rules; never guessed in code.';

INSERT INTO finance_setting (setting_key, value_numeric, unit, note, set_by) VALUES
    ('mdr_tolerance_minor', 1000, 'IDR', 'Settlement MDR may differ from the rate table by this much (or mdr_tolerance_bps of gross, whichever is larger) and still post.', 'migration:0373'),
    ('mdr_tolerance_bps', 5, 'bps', '0.05% of settled gross.', 'migration:0373'),
    ('return_window_days', 7, 'days', 'A RETURN may reference a receipt at most this many days old (owner decision 11).', 'migration:0373');

-- ── EDC terminals ──────────────────────────────────────────────────────────
CREATE TABLE edc_terminal (
    site_id      text NOT NULL REFERENCES site (id),
    terminal_id  text NOT NULL CHECK (btrim(terminal_id) <> ''),
    bank_code    text NOT NULL CHECK (bank_code = upper(bank_code) AND btrim(bank_code) <> ''),
    label        text,
    active       boolean NOT NULL DEFAULT true,
    created_by   text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, terminal_id)
);

COMMENT ON TABLE edc_terminal IS
    'Which bank each shop EDC terminal belongs to. A QRIS tender that names no bank takes the bank of the terminal it was paid on.';

-- ── acquirer fee rates ─────────────────────────────────────────────────────
CREATE TABLE acquirer_fee_rate (
    bank_code       text NOT NULL CHECK (bank_code = upper(bank_code) AND btrim(bank_code) <> ''),
    fee_kind        text NOT NULL CHECK (fee_kind IN ('DEBIT_ON_US', 'DEBIT_OFF_US', 'CREDIT', 'QRIS')),
    rate_percent    numeric(7,4) NOT NULL CHECK (rate_percent >= 0 AND rate_percent < 100),
    effective_from  date NOT NULL,
    note            text,
    set_by          text NOT NULL,
    set_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (bank_code, fee_kind, effective_from)
);

COMMENT ON TABLE acquirer_fee_rate IS
    'Finance''s MDR per acquirer bank and kind. Final rates: the bank''s MDR already includes VAT (owner decision 8).';

ALTER TABLE acquirer_settlement
    ADD COLUMN mdr_expected_minor bigint,
    ADD COLUMN mdr_check text NOT NULL DEFAULT 'UNCHECKED'
        CHECK (mdr_check IN ('UNCHECKED', 'OK', 'NO_RATE', 'VARIANCE', 'ACCEPTED')),
    ADD COLUMN mdr_checked_by text,
    ADD COLUMN mdr_checked_at timestamptz;

COMMENT ON COLUMN acquirer_settlement.mdr_check IS
    'OK: actual MDR within tolerance of the rate table. NO_RATE: no rate set for the bank, actual MDR posted and flagged. VARIANCE: outside tolerance, refused until Finance accepts it (ACCEPTED).';

-- ── sale-day exceptions ────────────────────────────────────────────────────
CREATE TABLE sales_posting_exception (
    exception_id     uuid PRIMARY KEY,
    posting_id       uuid NOT NULL REFERENCES sales_posting (posting_id) ON DELETE CASCADE,
    method           text NOT NULL,
    acquirer         text NOT NULL DEFAULT '',
    terminal_id      text,
    receipts_minor   bigint NOT NULL CHECK (receipts_minor >= 0),
    refunds_minor    bigint NOT NULL DEFAULT 0 CHECK (refunds_minor >= 0),
    tender_count     bigint NOT NULL DEFAULT 0,
    reason           text NOT NULL CHECK (btrim(reason) <> ''),
    status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
    resolved_bank    text,
    journal_entry_id uuid REFERENCES journal_entry (entry_id),
    resolved_by      text,
    resolved_at      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL))
);

CREATE INDEX sales_posting_exception_open
    ON sales_posting_exception (posting_id) WHERE status = 'OPEN';

COMMENT ON TABLE sales_posting_exception IS
    'Tender lines of a sales day that could not post (QRIS without a bank, online tenders). The rest of the day posts; these wait here with the reason.';

-- The tender kind of each sale-day bucket already lives on
-- `sales_posting_line.method` (CARD vs QRIS), which is where reports split
-- QRIS from debit cards now that both share one account.

ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'ACQ_SETTLEMENT', 'ADJUSTMENT', 'ADVANCE', 'AMORTIZATION_RUN',
        'ASSET_CAPITALIZATION', 'ASSET_DISPOSAL', 'ASSET_RESERVE',
        'ASSET_TRANSFER', 'BANK_STATEMENT', 'CASH_COUNT', 'CASH_DOC',
        'CASH_SHIFT', 'COGS_DAY', 'CREDIT_NOTE', 'DEPRECIATION',
        'EQUITY_MOVEMENT', 'EXPENSE_CLAIM', 'EXPENSE_CLAIM_PAYOUT', 'GIRO',
        'GOODS_RECEIPT', 'INTERUNIT_SETTLE', 'INVENTORY_WRITE_OFF',
        'LANDED_COST', 'MANUAL', 'OPENING', 'PAYMENT', 'PAYROLL_RUN',
        'PETTY_REPLENISH', 'PREPAID_ALLOCATION', 'RECLASS', 'REMITTANCE',
        'RETENDER', 'REVERSAL', 'SALE_DAY', 'STOCK_COUNT', 'STORE_DEPOSIT',
        'STORE_EXPENSE', 'SUPPLIER_ADVANCE', 'SUPPLIER_INVOICE',
        'TAX_SETTLEMENT', 'TRANSFER', 'VOUCHER_ISSUE', 'WRITE_OFF',
        'FULL_AND_FINAL', 'SALE_DAY_EXCEPTION'
    ));

INSERT INTO finance_posting_source_policy (source_kind, module, enabled, set_by, note)
VALUES ('SALE_DAY_EXCEPTION', 'SALES', true, 'migration:0373',
        'A sale-day tender line resolved after the day posted (QRIS whose bank was named later).')
ON CONFLICT (source_kind) DO UPDATE
    SET module = EXCLUDED.module, enabled = EXCLUDED.enabled,
        set_by = EXCLUDED.set_by, set_at = now(), note = EXCLUDED.note;

-- Vouchers are free (owner decision 13): no journal at issue.
UPDATE finance_posting_source_policy
   SET enabled = false, set_by = 'migration:0373', set_at = now(),
       note = 'Retired: vouchers are free; the value spent posts as a sales discount on the sales day.'
 WHERE source_kind = 'VOUCHER_ISSUE';

-- Returned goods given out again as the replacement (owner decision 11) are a
-- bucket of their own on the day: revenue with no asset side.
ALTER TABLE sales_posting_line DROP CONSTRAINT IF EXISTS sales_posting_line_method_check;
ALTER TABLE sales_posting_line ADD CONSTRAINT sales_posting_line_method_check
    CHECK (method IN ('CASH', 'CARD', 'QRIS', 'OTHER', 'VOUCHER', 'RETURN'));
