-- Tax is owed, and credited, by period — and the two are not the same balance.
--
-- # Why a subledger at all
--
-- The chart already has the accounts: `2012101001..006` for what is owed and
-- `1011302001..006` for what has been paid in advance. What it has no way of
-- saying is WHICH PERIOD a balance belongs to, and that is the whole of tax
-- administration: a return covers a month, it is filed once, and what was paid
-- against it either settles it or does not.
--
-- The second thing it cannot say is the difference between a CREDIT and a
-- PAYABLE. `Prepaid - PPh Pasal 25` is money the company has already handed to
-- the state and may set against next year's assessment; `Hutang Pajak PPh Pasal
-- 29` is money it still owes. They belong to the same tax and they are opposite
-- balances, and the one thing this module may never do is net them because
-- their names look alike. 0265 made that point when it created the PPh 29
-- liability; this table is where it is enforced: `nature` is on the TYPE, and a
-- type is either a credit or a payable, never both.
--
-- # The shape
--
--   tax_type        the kinds this company actually files. Reference data,
--                   written here rather than seeded, for 0268's reason.
--   tax_period      one return: a type, a month, and what has happened to it.
--   tax_ledger_item every movement in that period, typed as an obligation, a
--                   credit, or a settlement, and pointing at the document that
--                   caused it.
--
-- An item does NOT post. Obligations arrive from documents that have already
-- posted — output VAT is recognised by the day's takings, withholding by the
-- payroll run or the supplier payment — so the subledger records what the
-- ledger already holds, per period, and a settlement is the one movement this
-- module writes itself.
--
-- # Why a type names a meaning rather than an account code
--
-- Because everything else in this estate does: `account_map` turns a meaning
-- plus a place into a code, the map is data a person edits, and no Rust names a
-- client account code. Four meanings did not exist and are added with this
-- migration's own vocabulary — `pph21_payable`, `pph25_credit`,
-- `pph29_payable`, `pbb_payable` — because the accounts existed with nothing
-- pointing at them.

CREATE TABLE IF NOT EXISTS tax_type (
    code            text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    name            text NOT NULL CHECK (btrim(name) <> ''),
    -- PAYABLE: the company owes it. CREDIT: the company has paid it and may set
    -- it off. The one thing that must never be inferred from the name.
    nature          text NOT NULL CHECK (nature IN ('PAYABLE', 'CREDIT')),
    -- The meaning the balance sits on. Resolved through `account_map` per
    -- place, like every other account in this system.
    semantic_key    text NOT NULL CHECK (semantic_key ~ '^[a-z][a-z0-9_]*$'),
    -- What the return is filed against, for a person reading the list.
    authority       text NOT NULL DEFAULT 'DJP',
    active          boolean NOT NULL DEFAULT true,
    note            text
);

INSERT INTO tax_type (code, name, nature, semantic_key, note) VALUES
    ('PPH21',   'PPh Pasal 21 — karyawan',        'PAYABLE', 'pph21_payable',
     'Dipotong dari gaji oleh payroll run; disetor bulan berikutnya.'),
    ('PPH23',   'PPh Pasal 23 — jasa',            'PAYABLE', 'pph23_payable',
     'Dipotong saat membayar vendor jasa.'),
    ('PPH25',   'PPh Pasal 25 — angsuran',        'CREDIT',  'pph25_credit',
     'Angsuran bulanan; kredit terhadap PPh 29 akhir tahun. BUKAN beban pajak.'),
    ('PPH29',   'PPh Pasal 29 — kurang bayar',    'PAYABLE', 'pph29_payable',
     'Kurang bayar akhir tahun. Tidak dijaringkan otomatis dengan PPh 25.'),
    ('PPN_OUT', 'PPN Keluaran',                   'PAYABLE', 'vat_out',
     'Sudah ada di dalam harga; diakui oleh posting hari dagang.'),
    ('PPN_IN',  'PPN Masukan',                    'CREDIT',  'vat_in',
     'Dari faktur pembelian; dikreditkan terhadap PPN keluaran pada SPT.'),
    ('PBB',     'Pajak Bumi & Bangunan',          'PAYABLE', 'pbb_payable',
     'Tahunan; dicatat saat ketetapan diterima.')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS tax_period (
    period_id     uuid PRIMARY KEY,
    tax_type_code text NOT NULL REFERENCES tax_type (code),
    period_year   smallint NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
    period_month  smallint NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    -- OPEN: still collecting. FILED: the return went in. SETTLED: it is paid,
    -- or the credit is claimed, and nothing more belongs to it.
    status        text NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN', 'FILED', 'SETTLED')),
    due_date      date,
    filed_at      timestamptz,
    filed_by      text,
    filed_reference text,
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now(),

    UNIQUE (tax_type_code, period_year, period_month),
    CHECK ((status = 'OPEN') = (filed_at IS NULL)),
    CHECK (filed_at IS NULL OR btrim(coalesce(filed_by, '')) <> '')
);

CREATE INDEX IF NOT EXISTS ix_tax_period_month
    ON tax_period (period_year DESC, period_month DESC, tax_type_code);

CREATE TABLE IF NOT EXISTS tax_ledger_item (
    item_id       uuid PRIMARY KEY,
    period_id     uuid NOT NULL REFERENCES tax_period (period_id),
    site_id       text NOT NULL REFERENCES site (id),
    -- OBLIGATION: tax the company now owes for this period.
    -- CREDIT:     tax already paid that may be set against a liability.
    -- SETTLEMENT: money actually paid to, or refunded by, the authority.
    kind          text NOT NULL CHECK (kind IN ('OBLIGATION', 'CREDIT', 'SETTLEMENT')),
    amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
    -- The document behind it, named as the journal names one. An obligation
    -- points at the posting that recognised it; a settlement points at the
    -- entry this module wrote.
    source_kind   text NOT NULL CHECK (btrim(source_kind) <> ''),
    source_id     text NOT NULL CHECK (btrim(source_id) <> ''),
    entry_id      uuid REFERENCES journal_entry (entry_id),
    evidence      text,
    note          text,
    created_by    text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at    timestamptz NOT NULL DEFAULT now(),

    -- One document recognises one thing once. This is what makes a payroll run
    -- or a day's takings replayable into the tax subledger.
    UNIQUE (period_id, kind, source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS ix_tax_ledger_period ON tax_ledger_item (period_id, kind);
CREATE INDEX IF NOT EXISTS ix_tax_ledger_source ON tax_ledger_item (source_kind, source_id);

COMMENT ON TABLE tax_type IS
    'The taxes this company files. `nature` says whether a balance is owed or
     held as a credit, and it is the reason PPh 25 and PPh 29 are never netted.';
COMMENT ON TABLE tax_period IS 'One return: a tax, a month, and its filing state.';
COMMENT ON TABLE tax_ledger_item IS
    'Every movement in a period, typed and pointing at the document that caused
     it. Obligations and credits are recorded from postings that already
     happened; a settlement is the one entry this module writes.';
