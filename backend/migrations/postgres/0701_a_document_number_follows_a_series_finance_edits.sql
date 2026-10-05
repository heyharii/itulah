-- 0701: A document's number follows a series Finance edits.
--
-- # Three counters, a dozen sequences, and a format in every module
--
-- Before this file a document's number came from one of three places:
--
--   * a Postgres sequence per kind (`journal_entry_number_seq`, `PV-`, `CN-`,
--     `AV-`, `PI-`, `DP-`, `COR-`, `ADV-`, `FAC-`, `PPD-`, `AST-`) — global,
--     never reset, and gapful: a rolled-back posting burns its number;
--   * `cash_document_sequence` — `KK`/`KM`/`TF` per month (0115);
--   * `store_document_counter` — a store's money documents per scope per
--     month (0110, 0607).
--
-- and its spelling was a `format!` in the module that minted it. The client's
-- books spell theirs `C006-BKK-26-07-00046`; ERPNext's Naming Series and
-- 7Soft's "Kode No Transaksi" make the spelling a setting. So does this.
--
-- # The shape
--
-- `number_series` is one row per kind of document: its pattern
-- (`domain::number_series` — `{UNIT}`, `{YYYY}`, `{YY}`, `{MM}`, `{###}`),
-- when its sequence restarts, and whether the kind names a unit that
-- `{UNIT}` could print. `number_series_counter` holds the last value issued
-- per (kind, pattern, unit, period). The pattern is in the key on purpose:
-- changing a pattern starts a new counter, and changing it BACK resumes the
-- old one, so no edit can ever issue a number that was issued before.
--
-- The counter row is taken with an upsert inside the document's own
-- transaction, so a document that rolls back takes its number back with it.
-- Every kind below is gapless from here on, the journal included.
--
-- # Nothing is renumbered
--
-- Every seeded pattern spells exactly what the code spelled, and every
-- counter below starts where the sequence or the table it replaces stopped.
-- The first number issued after this migration is the one that would have
-- been issued without it.

CREATE TABLE number_series (
    document_kind text PRIMARY KEY CHECK (document_kind ~ '^[A-Z][A-Z0-9_]{1,39}$'),
    label         text NOT NULL CHECK (btrim(label) <> ''),
    pattern       text NOT NULL CHECK (btrim(pattern) <> '' AND length(pattern) <= 48),
    reset         text NOT NULL CHECK (reset IN ('MONTHLY', 'YEARLY', 'NEVER')),
    -- May `{UNIT}` appear? Only for a kind whose documents each name the one
    -- unit whose books they are in; the journal, whose lines span units, does
    -- not.
    unit_aware    boolean NOT NULL,
    updated_by    text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT number_series_has_a_sequence CHECK (pattern ~ '\{#{1,12}\}'),
    CONSTRAINT number_series_unit_only_where_known CHECK (unit_aware OR pattern NOT LIKE '%{UNIT}%')
);

COMMENT ON TABLE number_series IS
    'How each kind of document is numbered: an editable pattern and reset (0701).';

CREATE TABLE number_series_counter (
    document_kind text NOT NULL REFERENCES number_series (document_kind) ON UPDATE CASCADE,
    pattern       text NOT NULL,
    -- The unit id when the pattern prints `{UNIT}`, '' otherwise.
    scope_key     text NOT NULL,
    -- 'YYYY-MM' for MONTHLY, 'YYYY' for YEARLY, '' for NEVER.
    period_key    text NOT NULL,
    last_value    bigint NOT NULL CHECK (last_value >= 0),
    PRIMARY KEY (document_kind, pattern, scope_key, period_key)
);

COMMENT ON TABLE number_series_counter IS
    'The last value issued per (kind, pattern, unit, period). Taken inside the '
    'document''s transaction, so numbers are gapless (0701).';

INSERT INTO number_series (document_kind, label, pattern, reset, unit_aware, updated_by) VALUES
    ('JOURNAL_ENTRY',        'Journal entry',                'JV-{########}',               'NEVER',   false, 'migration:0701'),
    ('CASH_OUT',             'Cash/bank out (BKK)',          'KK-{YY}-{MM}-{#####}',        'MONTHLY', true,  'migration:0701'),
    ('CASH_IN',              'Cash/bank in (BKM)',           'KM-{YY}-{MM}-{#####}',        'MONTHLY', true,  'migration:0701'),
    ('CASH_TRANSFER',        'Transfer between our accounts','TF-{YY}-{MM}-{#####}',        'MONTHLY', true,  'migration:0701'),
    ('SUPPLIER_PAYMENT',     'Supplier payment',             'PV-{########}',               'NEVER',   true,  'migration:0701'),
    ('SUPPLIER_CREDIT_NOTE', 'Supplier credit note',         'CN-{########}',               'NEVER',   true,  'migration:0701'),
    ('SUPPLIER_ADVANCE',     'Supplier advance',             'AV-{########}',               'NEVER',   true,  'migration:0701'),
    ('PAYMENT_INSTRUCTION',  'Payment instruction',          'PI-{########}',               'NEVER',   true,  'migration:0701'),
    ('STORE_DEPOSIT',        'Store deposit',                'DP-{########}',               'NEVER',   true,  'migration:0701'),
    ('CORRECTION',           'Correction document',          'COR-{########}',              'NEVER',   false, 'migration:0701'),
    ('ADVANCE',              'Advance',                      'ADV-{######}',                'NEVER',   true,  'migration:0701'),
    ('FINANCING_FACILITY',   'Financing facility',           'FAC-{####}',                  'NEVER',   false, 'migration:0701'),
    ('PREPAID_SCHEDULE',     'Prepaid schedule',             'PPD-{######}',                'NEVER',   false, 'migration:0701'),
    ('FIXED_ASSET',          'Fixed asset',                  'AST-{######}',                'NEVER',   true,  'migration:0701'),
    ('STORE_EXPENSE',        'Store petty-cash expense',     'KK-{UNIT}-{YY}-{MM}-{#####}', 'MONTHLY', true,  'migration:0701'),
    ('EXPENSE_CLAIM',        'Expense claim',                'KLC-{UNIT}-{YY}-{MM}-{#####}','MONTHLY', true,  'migration:0701'),
    ('CLAIM_PAYOUT',         'Expense claim payout',         'KKC-{UNIT}-{YY}-{MM}-{#####}','MONTHLY', true,  'migration:0701'),
    ('STORE_BANKING',        'Store takings banked',         'SB-{YY}-{MM}-{#####}',        'MONTHLY', false, 'migration:0701'),
    ('REMITTANCE',           'Remittance order',             'REM-{YY}-{MM}-{#####}',       'MONTHLY', false, 'migration:0701'),
    ('OUTFLOW',              'Head-office outflow',          'OF-{YY}-{MM}-{#####}',        'MONTHLY', false, 'migration:0701'),
    ('CASH_HANDOVER',        'Cash handover',                'HO-{YY}-{MM}-{#####}',        'MONTHLY', false, 'migration:0701'),
    ('PETTY_REPLENISH',      'Petty-cash replenishment',     'KK-RPL-{YY}-{MM}-{#####}',    'MONTHLY', false, 'migration:0701');

-- ── the counters carry on where the old ones stopped ─────────────────────

-- Sequences: the value last handed out, or nothing if none ever was.
CREATE FUNCTION pg_temp.issued(sequence_name regclass) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
    value  bigint;
    called boolean;
BEGIN
    EXECUTE format('SELECT last_value, is_called FROM %s', sequence_name) INTO value, called;
    RETURN CASE WHEN called THEN value ELSE 0 END;
END $$;

INSERT INTO number_series_counter (document_kind, pattern, scope_key, period_key, last_value)
SELECT kind, pattern, '', '', pg_temp.issued(seq)
  FROM (VALUES
        ('JOURNAL_ENTRY',        'JV-{########}',  'journal_entry_number_seq'::regclass),
        ('SUPPLIER_PAYMENT',     'PV-{########}',  'supplier_payment_number_seq'::regclass),
        ('SUPPLIER_CREDIT_NOTE', 'CN-{########}',  'supplier_credit_note_number_seq'::regclass),
        ('SUPPLIER_ADVANCE',     'AV-{########}',  'supplier_advance_number_seq'::regclass),
        ('PAYMENT_INSTRUCTION',  'PI-{########}',  'payment_instruction_number_seq'::regclass),
        ('STORE_DEPOSIT',        'DP-{########}',  'store_deposit_number_seq'::regclass),
        ('CORRECTION',           'COR-{########}', 'correction_document_number_seq'::regclass),
        ('ADVANCE',              'ADV-{######}',   'advance_number_seq'::regclass),
        ('FINANCING_FACILITY',   'FAC-{####}',     'financing_facility_number_seq'::regclass),
        ('PREPAID_SCHEDULE',     'PPD-{######}',   'prepaid_schedule_number_seq'::regclass),
        ('FIXED_ASSET',          'AST-{######}',   'fixed_asset_number_seq'::regclass)
       ) AS old (kind, pattern, seq)
 WHERE pg_temp.issued(seq) > 0;

-- `cash_document_sequence`: kind per month.
INSERT INTO number_series_counter (document_kind, pattern, scope_key, period_key, last_value)
SELECT CASE s.kind WHEN 'PAY' THEN 'CASH_OUT'
                   WHEN 'RECEIVE' THEN 'CASH_IN'
                   ELSE 'CASH_TRANSFER' END,
       CASE s.kind WHEN 'PAY' THEN 'KK-{YY}-{MM}-{#####}'
                   WHEN 'RECEIVE' THEN 'KM-{YY}-{MM}-{#####}'
                   ELSE 'TF-{YY}-{MM}-{#####}' END,
       '',
       to_char(s.yyyymm / 100, 'FM0000') || '-' || to_char(s.yyyymm % 100, 'FM00'),
       s.last_no
  FROM cash_document_sequence s;

-- `store_document_counter`: a scope per month. `KK:<unit>`, `KLC:<unit>` and
-- `KKC:<unit>` were counted per unit; the rest were one counter each.
INSERT INTO number_series_counter (document_kind, pattern, scope_key, period_key, last_value)
SELECT m.kind, m.pattern,
       CASE WHEN m.per_unit THEN split_part(c.scope, ':', 2) ELSE '' END,
       to_char(c.year, 'FM0000') || '-' || to_char(c.month, 'FM00'),
       c.last_number
  FROM store_document_counter c
  JOIN (VALUES
        ('KK',  'STORE_EXPENSE',   'KK-{UNIT}-{YY}-{MM}-{#####}',  true),
        ('KLC', 'EXPENSE_CLAIM',   'KLC-{UNIT}-{YY}-{MM}-{#####}', true),
        ('KKC', 'CLAIM_PAYOUT',    'KKC-{UNIT}-{YY}-{MM}-{#####}', true),
        ('SB',  'STORE_BANKING',   'SB-{YY}-{MM}-{#####}',         false),
        ('REM', 'REMITTANCE',      'REM-{YY}-{MM}-{#####}',        false),
        ('OF',  'OUTFLOW',         'OF-{YY}-{MM}-{#####}',         false),
        ('HO',  'CASH_HANDOVER',   'HO-{YY}-{MM}-{#####}',         false),
        ('RPL', 'PETTY_REPLENISH', 'KK-RPL-{YY}-{MM}-{#####}',     false)
       ) AS m (scope_prefix, kind, pattern, per_unit)
    ON split_part(c.scope, ':', 1) = m.scope_prefix;

-- ── and the old ones go ──────────────────────────────────────────────────

DROP TABLE cash_document_sequence;
DROP TABLE store_document_counter;
DROP SEQUENCE journal_entry_number_seq;
DROP SEQUENCE supplier_payment_number_seq;
DROP SEQUENCE supplier_credit_note_number_seq;
DROP SEQUENCE supplier_advance_number_seq;
DROP SEQUENCE payment_instruction_number_seq;
DROP SEQUENCE store_deposit_number_seq;
DROP SEQUENCE correction_document_number_seq;
DROP SEQUENCE advance_number_seq;
DROP SEQUENCE financing_facility_number_seq;
DROP SEQUENCE prepaid_schedule_number_seq;
DROP SEQUENCE fixed_asset_number_seq;
