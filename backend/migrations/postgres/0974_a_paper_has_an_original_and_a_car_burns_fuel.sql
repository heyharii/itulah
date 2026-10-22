-- 0974 — a paper can be filed before it is scanned, its original is kept
-- and lent, and GA writes down what a car or a genset burns.
--
-- # Three objects behind one word "BPKB" (owner, 17 Oct 2026)
--
-- The car is an asset (`fixed_asset`): its holder is the driver. The paper is
-- a document (`document`): its number, issuer, dates, the car it is about,
-- and a scan when there is one. The sheet of paper itself is an ORIGINAL kept
-- in a safe: who holds it now, where, until when, and every handover. The
-- three are different facts with different holders — the driver has the car,
-- Sari has the BPKB — so they are three rows, never one.
--
-- Files is the door to the paper and its original. The original is not a
-- fixed asset and is never capitalised.
--
-- ## A document without a scan
--
-- A BPKB sits in the safe long before anybody scans it, and GA must be able to
-- say "we hold BPKB M-12345678 for B 1234 ABC" on day one. So `file_id` may
-- now be empty. Every existing read that serves bytes joins `stored_file`, so
-- a paper with no scan is simply not offered for download there; the GA reads
-- that list papers join it LEFT and say "no scan".
ALTER TABLE document ALTER COLUMN file_id DROP NOT NULL;

COMMENT ON COLUMN document.file_id IS
    'The scan, when there is one. Empty for a paper filed before it was scanned (0974): the paper exists, its bytes do not yet.';

-- ## The original, and who has it
CREATE TABLE ga_document_original (
    original_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id      uuid NOT NULL REFERENCES document (document_id) ON DELETE RESTRICT,
    -- The sheet the issuer handed over, or a copy somebody certified. A paper
    -- can have both, and each is kept and lent on its own.
    kind             TEXT NOT NULL DEFAULT 'ORIGINAL'
                         CHECK (kind IN ('ORIGINAL', 'CERTIFIED_COPY')),
    -- IN_STORAGE: in its place. OUT: handed to somebody, due back.
    status           TEXT NOT NULL DEFAULT 'IN_STORAGE'
                         CHECK (status IN ('IN_STORAGE', 'OUT')),
    -- Where it is kept when it is home ("Brankas A-02, HO"). It does not move
    -- when the sheet is lent: a return puts it back here.
    storage_location TEXT NOT NULL CHECK (btrim(storage_location) <> ''),
    -- Who has it now: the storage itself while home, else a person's name or
    -- an outside party (the bank, Samsat). A name, as `fixed_asset.holder` is.
    holder_name      TEXT NOT NULL CHECK (btrim(holder_name) <> ''),
    holder_kind      TEXT NOT NULL DEFAULT 'STORAGE'
                         CHECK (holder_kind IN ('STORAGE', 'EMPLOYEE', 'EXTERNAL')),
    out_purpose      TEXT,
    due_back_on      date,
    notes            TEXT,
    created_by       TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at       timestamptz NOT NULL DEFAULT now(),
    version          integer NOT NULL DEFAULT 1,
    -- A due date belongs to a sheet that is out, and only to one.
    CONSTRAINT ga_document_original_due_when_out
        CHECK (status = 'OUT' OR (due_back_on IS NULL AND out_purpose IS NULL))
);

CREATE INDEX ix_ga_document_original_document ON ga_document_original (document_id);
-- The overview's question: which originals are out, and which are late.
CREATE INDEX ix_ga_document_original_out ON ga_document_original (due_back_on)
    WHERE status = 'OUT';

COMMENT ON TABLE ga_document_original IS
    'A physical original (or certified copy) of a filed paper, and who holds it now. Not a fixed asset. Its history is ga_document_custody_event.';

-- Every handover, appended and never edited: from whom, to whom, where, why,
-- until when. The columns on the original say where it is now; this says how
-- it got there.
CREATE TABLE ga_document_custody_event (
    event_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    original_id  uuid NOT NULL REFERENCES ga_document_original (original_id) ON DELETE RESTRICT,
    kind         TEXT NOT NULL CHECK (kind IN ('REGISTERED', 'RELEASED', 'RETURNED')),
    from_holder  TEXT,
    to_holder    TEXT NOT NULL CHECK (btrim(to_holder) <> ''),
    to_location  TEXT,
    purpose      TEXT,
    due_back_on  date,
    occurred_on  date NOT NULL,
    recorded_by  TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_ga_document_custody_event_original
    ON ga_document_custody_event (original_id, occurred_on DESC, recorded_at DESC);

CREATE OR REPLACE FUNCTION protect_ga_document_custody_event() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'a custody history is appended, not %: write the correction as a new handover and the old one stays',
        lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ga_document_custody_event_append_only
    BEFORE UPDATE OR DELETE ON ga_document_custody_event
    FOR EACH ROW EXECUTE FUNCTION protect_ga_document_custody_event();

-- ## What a car or a genset burns (owner, 17 Oct 2026)
--
-- Fuel, tyres, oil, genset fuel, a computer part: routine spending on a thing
-- or a place that is neither a repair nor a supply request. GA writes down the
-- event (date, odometer, litres, amount, who sold it, the receipt) and asks
-- Finance to pay it. The GA row and the Finance transaction are different
-- things that point at each other: either GA files a DRAFT bill from it, or it
-- names the bill or BKK Finance already made — never both, never a second
-- draft for the same money. A cost that comes from a repair or a service is
-- billed from that work, not here.
CREATE TABLE ga_operating_expense (
    expense_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id          TEXT NOT NULL REFERENCES site (id),
    asset_id         uuid REFERENCES fixed_asset (asset_id),
    kind             TEXT NOT NULL CHECK (kind IN
                         ('FUEL', 'OIL', 'TYRES_PARTS', 'GENSET_FUEL', 'COMPUTER', 'TOOLS', 'OTHER')),
    spent_on         date NOT NULL,
    description      TEXT NOT NULL CHECK (btrim(description) <> ''),
    quantity         numeric(14, 3) CHECK (quantity IS NULL OR quantity > 0),
    unit             TEXT,
    odometer_km      integer CHECK (odometer_km IS NULL OR odometer_km >= 0),
    amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
    supplier_id      uuid REFERENCES supplier (supplier_id),
    receipt_number   TEXT,
    -- The Finance side, exactly one of the two once it is submitted.
    invoice_id       uuid REFERENCES supplier_invoice (invoice_id),
    cash_document_id uuid REFERENCES cash_document (document_id),
    status           TEXT NOT NULL DEFAULT 'RECORDED'
                         CHECK (status IN ('RECORDED', 'SUBMITTED', 'CANCELLED')),
    cancel_reason    TEXT,
    created_by       TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       TEXT,
    updated_at       timestamptz,
    version          integer NOT NULL DEFAULT 1,
    CONSTRAINT ga_operating_expense_one_finance_side
        CHECK (invoice_id IS NULL OR cash_document_id IS NULL),
    CONSTRAINT ga_operating_expense_submitted_points_at_finance
        CHECK (status <> 'SUBMITTED' OR invoice_id IS NOT NULL OR cash_document_id IS NOT NULL),
    CONSTRAINT ga_operating_expense_cancel_has_reason
        CHECK (status <> 'CANCELLED' OR btrim(coalesce(cancel_reason, '')) <> '')
);

CREATE INDEX ix_ga_operating_expense_asset ON ga_operating_expense (asset_id, spent_on DESC)
    WHERE asset_id IS NOT NULL;
CREATE INDEX ix_ga_operating_expense_site ON ga_operating_expense (site_id, spent_on DESC);
-- One Finance transaction answers one GA expense: a bill or a BKK named twice
-- would be the same money counted twice.
CREATE UNIQUE INDEX ux_ga_operating_expense_invoice ON ga_operating_expense (invoice_id)
    WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX ux_ga_operating_expense_cash ON ga_operating_expense (cash_document_id)
    WHERE cash_document_id IS NOT NULL;

COMMENT ON TABLE ga_operating_expense IS
    'Routine spending GA records on an asset or a site (fuel, tyres, oil, genset fuel…) and hands to Finance as a draft bill, or links to the bill/BKK Finance already made.';

-- Receipts and photos attach through document_link like any other paper.
INSERT INTO record_kind (code, label) VALUES
    ('operating_expense', 'Operating expense'),
    ('document_original', 'Document original')
ON CONFLICT (code) DO NOTHING;
