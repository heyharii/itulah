-- 0468: a payment method says how it settles.
--
-- Stage 4 of "Desain Fondasi Finance Dinamis", ERPNext's Mode of Payment. The
-- day's takings were posted by tender names written in the Rust — CASH, CARD
-- debit or credit, QRIS, VOUCHER — and a bank became postable only through
-- "Tambah bank", which wrote three account codes of its own. Now:
--
--   * `payment_method` is master data Finance keeps: which tenders the
--     company accepts, through which bank or scheme, how each settles, and at
--     what MDR.
--   * The tender type is the grammar (the Rust keeps it): cash lands in the
--     drawer, a card or QRIS or e-wallet is owed by its acquirer, a voucher is
--     a discount, points are a loyalty cost (ERPNext Loyalty Program).
--   * Which ACCOUNT each role lands on is an account link narrowed by the
--     method's bank — `card_receivable_debit` / BCA, `revenue_debit` / BCA —
--     set on the Account Links screen. The client's chart splits revenue by
--     how it was paid (owner decision 27 Sep), so the revenue link is the
--     method's too.
--   * `settlement_mode`: VIA_RECEIVABLE (the default, today's behaviour — the
--     acquirer owes the gross until it pays, MDR is booked at settlement) or
--     DIRECT_TO_BANK (the sale lands in the bank net of MDR at `mdr_bps`, and
--     the MDR is booked the same day; the receivable role is then linked to a
--     bank account).

CREATE TABLE payment_method (
    code            text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    name            text NOT NULL CHECK (btrim(name) <> ''),
    tender_type     text NOT NULL CHECK (tender_type IN
                        ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'QRIS', 'EWALLET', 'VOUCHER', 'POINTS')),
    -- The bank, card scheme or wallet provider — the word the till and the
    -- EDC terminal register use, and the source the account links are
    -- narrowed by. Empty for cash, vouchers and points.
    bank_code       text NOT NULL DEFAULT '',
    settlement_mode text NOT NULL DEFAULT 'VIA_RECEIVABLE'
                        CHECK (settlement_mode IN ('IN_DRAWER', 'VIA_RECEIVABLE', 'DIRECT_TO_BANK', 'NONE')),
    -- Basis points of gross the acquirer keeps. Booked at the sale for
    -- DIRECT_TO_BANK; for VIA_RECEIVABLE the settlement's own figure is booked
    -- and the terminal rates (0373) check it.
    mdr_bps         integer NOT NULL DEFAULT 0 CHECK (mdr_bps BETWEEN 0 AND 10000),
    -- For POINTS: the Rupiah one point pays (ERPNext conversion_factor).
    point_value_minor bigint CHECK (point_value_minor > 0),
    is_active       boolean NOT NULL DEFAULT true,
    note            text,
    created_by      text NOT NULL DEFAULT 'system',
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tender_type, bank_code),
    CHECK ((tender_type = 'CASH') = (settlement_mode = 'IN_DRAWER')),
    CHECK ((tender_type IN ('VOUCHER', 'POINTS')) = (settlement_mode = 'NONE')),
    CHECK (tender_type <> 'POINTS' OR point_value_minor IS NOT NULL)
);

COMMENT ON TABLE payment_method IS
    'ERPNext Mode of Payment (0468): a tender the company accepts, through which bank, how it settles and at what MDR. Its accounts are account links narrowed by bank_code.';

-- The roles a method's day lines use, by tender type — the grammar, in one
-- place the readiness screen and the Rust agree on.
CREATE FUNCTION payment_method_roles(p_tender_type text, p_settlement_mode text)
RETURNS SETOF text LANGUAGE sql IMMUTABLE AS $$
    SELECT unnest(CASE p_tender_type
        WHEN 'CASH'        THEN ARRAY['cash', 'revenue_cash']
        WHEN 'DEBIT_CARD'  THEN ARRAY['card_receivable_debit', 'revenue_debit', 'card_fee', 'sales_return']
        WHEN 'QRIS'        THEN ARRAY['card_receivable_debit', 'revenue_debit', 'card_fee', 'sales_return']
        WHEN 'EWALLET'     THEN ARRAY['card_receivable_debit', 'revenue_debit', 'card_fee', 'sales_return']
        WHEN 'CREDIT_CARD' THEN ARRAY['card_receivable_credit', 'revenue_credit', 'card_fee', 'sales_return']
        WHEN 'VOUCHER'     THEN ARRAY['sales_discount', 'revenue_cash']
        WHEN 'POINTS'      THEN ARRAY['loyalty_redemption', 'revenue_cash']
    END)
$$;

-- What the company accepts today, from the links that already make it
-- postable. QRIS rides the EDC of its bank (owner decision 25 Sep), so each
-- debit bank also takes QRIS on the same accounts.
INSERT INTO payment_method (code, name, tender_type, bank_code, settlement_mode, created_by) VALUES
    ('CASH',    'Tunai',   'CASH',    '', 'IN_DRAWER', 'migration:0468'),
    ('VOUCHER', 'Voucher', 'VOUCHER', '', 'NONE',      'migration:0468');

INSERT INTO payment_method (code, name, tender_type, bank_code, settlement_mode, created_by)
SELECT 'DEBIT_' || l.source_id, 'Debit ' || l.source_id, 'DEBIT_CARD', l.source_id,
       'VIA_RECEIVABLE', 'migration:0468'
  FROM (SELECT DISTINCT source_id FROM account_link
         WHERE role = 'card_receivable_debit' AND source_type = 'COMPANY' AND source_id <> '') l;

INSERT INTO payment_method (code, name, tender_type, bank_code, settlement_mode, created_by)
SELECT 'QRIS_' || l.source_id, 'QRIS ' || l.source_id, 'QRIS', l.source_id,
       'VIA_RECEIVABLE', 'migration:0468'
  FROM (SELECT DISTINCT source_id FROM account_link
         WHERE role = 'card_receivable_debit' AND source_type = 'COMPANY' AND source_id <> '') l;

INSERT INTO payment_method (code, name, tender_type, bank_code, settlement_mode, created_by)
SELECT 'CREDIT_' || l.source_id, 'Kartu kredit ' || l.source_id, 'CREDIT_CARD', l.source_id,
       'VIA_RECEIVABLE', 'migration:0468'
  FROM (SELECT DISTINCT source_id FROM account_link
         WHERE role = 'card_receivable_credit' AND source_type = 'COMPANY' AND source_id <> '') l;

-- A method that settles straight into a bank has its receivable role linked
-- to that bank account, so the role takes a bank as well as a receivable.
UPDATE posting_role
   SET allowed_account_types = ARRAY(SELECT DISTINCT unnest(allowed_account_types || ARRAY['BANK']::text[]) ORDER BY 1)
 WHERE role IN ('card_receivable_debit', 'card_receivable_credit');

-- Points spent are a loyalty cost (ERPNext Loyalty Program expense_account).
-- The client's chart has no such account yet; Finance adds one and links it.
INSERT INTO posting_role (role, allowed_account_types, note)
VALUES ('loyalty_redemption', ARRAY['EXPENSE'], 'points spent as payment (0468, ERPNext Loyalty Program)')
ON CONFLICT (role) DO NOTHING;

-- ERPNext's "Enable discount accounting for selling", off by default: the
-- client books promotions net inside revenue (owner policy P18). Turned on,
-- revenue reads gross and the promotions are debited to `promotion_discount`,
-- which Finance links to a contra-revenue account.
INSERT INTO finance_setting (setting_key, value_numeric, unit, note, set_by)
VALUES ('sales.discount_accounting', 0, 'flag',
        '1 books till promotions to their own account (ERPNext discount accounting); 0 keeps them net in revenue.',
        'migration:0468')
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO posting_role (role, allowed_account_types, note)
VALUES ('promotion_discount', ARRAY['INCOME', 'EXPENSE'],
        'till promotions under discount accounting (0468)')
ON CONFLICT (role) DO NOTHING;
