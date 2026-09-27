-- 0464: a period is closed into retained earnings by a voucher.
--
-- Owner decision, 27 Sep 2026 ("sama dengan ERPNext"): closing a month only
-- locks it (0126, 0283); moving the profit of a period into retained earnings
-- is a separate document, ERPNext's Period Closing Voucher. It is also what
-- the client's 7Soft does once a year: C001's Laba (Rugi) Ditahan rose from
-- 2024 to 2025 by exactly its 2024 net profit. Replaces hard rule I10, which
-- said profit is never posted.
--
-- A voucher covers a date range that starts the day after the last voucher
-- ended (the first one may start anywhere), so periods are closed in order and
-- never twice. Once a year reproduces 7Soft and older ERPNext; every month or
-- quarter is what current ERPNext allows. Per site, every profit-and-loss
-- account's balance over the range is reversed to zero and the difference goes
-- to the role `retained_earnings` (3003) at that site, so each site's books
-- balance on their own and no affiliate leg is needed.
--
-- The entry carries source kind PERIOD_CLOSING. The profit and loss statement
-- leaves those entries out (the profit of a closed period is still shown as
-- the profit of that period); the balance sheet keeps them, so the profit is
-- in retained earnings and not counted twice.

ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'ACQ_SETTLEMENT', 'ADJUSTMENT', 'ADVANCE', 'AMORTIZATION_RUN',
        'ASSET_CAPITALIZATION', 'ASSET_DISPOSAL', 'ASSET_RESERVE',
        'ASSET_TRANSFER', 'BANK_STATEMENT', 'CASH_COUNT', 'CASH_DOC',
        'CASH_SHIFT', 'COGS_DAY', 'CREDIT_NOTE', 'DEPRECIATION',
        'EQUITY_MOVEMENT', 'EXPENSE_CLAIM', 'EXPENSE_CLAIM_PAYOUT', 'GIRO',
        'GOODS_RECEIPT', 'INTERUNIT_SETTLE', 'INVENTORY_WRITE_OFF',
        'LANDED_COST', 'MANAGEMENT_FEE', 'MANUAL', 'OPENING', 'PAYMENT',
        'PAYROLL_RUN', 'PETTY_REPLENISH', 'PREPAID_ALLOCATION', 'RECLASS',
        'REMITTANCE', 'RETENDER', 'REVERSAL', 'SALE_DAY', 'STOCK_COUNT',
        'STORE_DEPOSIT', 'STORE_EXPENSE', 'SUPPLIER_ADVANCE',
        'SUPPLIER_INVOICE', 'TAX_SETTLEMENT', 'TRANSFER', 'VOUCHER_ISSUE',
        'WRITE_OFF', 'FULL_AND_FINAL', 'SALE_DAY_EXCEPTION', 'PERIOD_CLOSING'));

-- A soft-closed month takes the entries a close is made of; the closing
-- voucher is the last of them. A CLOSED month takes nothing: close the books
-- into retained earnings before sealing the last month of the range.
CREATE OR REPLACE FUNCTION assert_period_open() RETURNS trigger AS $$
DECLARE
    y      smallint := EXTRACT(YEAR FROM NEW.posting_date)::smallint;
    m      smallint := EXTRACT(MONTH FROM NEW.posting_date)::smallint;
    state  text;
    closing_kinds text[] := ARRAY[
        'ADJUSTMENT', 'RECLASS', 'WRITE_OFF', 'REVERSAL', 'DEPRECIATION',
        'AMORTIZATION_RUN', 'ASSET_RESERVE', 'PREPAID_ALLOCATION',
        'TAX_SETTLEMENT', 'PAYROLL_RUN', 'OPENING', 'PERIOD_CLOSING'
    ];
BEGIN
    SELECT status INTO state FROM fiscal_period
        WHERE year = y AND month = m FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'no accounting period exists for %-%; open it before posting',
            y, lpad(m::text, 2, '0');
    END IF;
    IF state = 'CLOSED' THEN
        RAISE EXCEPTION 'accounting period %-% is closed',
            y, lpad(m::text, 2, '0');
    END IF;
    IF state = 'SOFT_CLOSED' AND NOT (NEW.source_kind = ANY (closing_kinds)) THEN
        RAISE EXCEPTION
            'accounting period %-% is soft-closed: it still takes the entries a close is '
            'made of (adjustments, reclasses, depreciation, allocations, tax, payroll, '
            'reversals, the closing voucher) and no longer takes a % — post it in the open '
            'month, or ask for the period to be reopened',
            y, lpad(m::text, 2, '0'), NEW.source_kind;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A closing voucher is a Finance person's act, like a manual journal, not an
-- automatic posting flow the pause switch is there to hold back.
CREATE OR REPLACE FUNCTION enforce_finance_posting_pause() RETURNS trigger AS $$
DECLARE
    source_posting_allowed boolean;
BEGIN
    IF NEW.source_kind IN ('MANUAL', 'REVERSAL', 'PERIOD_CLOSING') THEN
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

    IF NOT COALESCE(source_posting_allowed, false) THEN
        RAISE EXCEPTION 'automatic posting is paused for source kind % while Finance reviews its chart and posting maps', NEW.source_kind
            USING ERRCODE = 'P0001',
                  CONSTRAINT = 'finance_automatic_posting_paused';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE period_closing_voucher (
    voucher_id        uuid PRIMARY KEY,
    period_start      date NOT NULL,
    period_end        date NOT NULL CHECK (period_end >= period_start),
    status            text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'CANCELLED')),
    entry_id          uuid REFERENCES journal_entry (entry_id),
    reversal_entry_id uuid REFERENCES journal_entry (entry_id),
    -- What the voucher moved into retained earnings, per site, as posted. The
    -- entry is the authority; this is what the list shows without summing it.
    profit_minor      bigint NOT NULL DEFAULT 0,
    remarks           text,
    created_by        text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at        timestamptz NOT NULL DEFAULT now(),
    cancelled_by      text,
    cancelled_at      timestamptz,
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
    -- Two live vouchers never cover the same day.
    EXCLUDE USING gist (daterange(period_start, period_end, '[]') WITH &&)
        WHERE (status = 'POSTED')
);

CREATE INDEX ix_period_closing_voucher_end ON period_closing_voucher (period_end DESC)
    WHERE status = 'POSTED';

COMMENT ON TABLE period_closing_voucher IS
    'ERPNext Period Closing Voucher (owner decision 27 Sep 2026): the profit of a date range, per site, moved from the profit-and-loss accounts into retained_earnings (3003).';

-- Whether an entry is part of closing the books: a closing voucher, or the
-- reversal that cancelled one. The profit and loss leaves both out; the
-- balance sheet and the voucher's own arithmetic read them as any other entry.
CREATE FUNCTION journal_entry_closes_books(p_source_kind text, p_reversal_of uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT p_source_kind = 'PERIOD_CLOSING'
        OR (p_source_kind = 'REVERSAL'
            AND EXISTS (SELECT 1 FROM journal_entry o
                         WHERE o.entry_id = p_reversal_of AND o.source_kind = 'PERIOD_CLOSING'))
$$;
