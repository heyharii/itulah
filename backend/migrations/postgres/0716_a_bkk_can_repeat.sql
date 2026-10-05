-- 0716: a BKK (or a BKM) can repeat.
--
-- Jadwal berulang, the owner's pick from the Mekari Jurnal comparison
-- (1 Oct 2026). Journals already repeat (0473) and so do supplier bills; the
-- payments that leave the bank on the same day every month without a bill in
-- front of them — rent paid by standing order, a monthly subscription, the
-- cleaning service — had nothing.
--
-- A repeat keeps the voucher body as the BKK screen sends it (the voucher
-- request, without its date) and raises a DRAFT voucher from it on its date.
-- It never posts: a payment is money leaving, and the person who approves it
-- is the control. Only OTHER lines may repeat — a bill is settled once and an
-- advance is netted once, so a repeat naming either would fail the second
-- month — and never a giro, whose number is a single piece of paper.

CREATE TABLE cash_document_repeat (
    repeat_id     uuid PRIMARY KEY,
    name          text NOT NULL CHECK (btrim(name) <> ''),
    -- OUT for a BKK, IN for a BKM; copied out of `voucher` so a list can
    -- filter without opening the json.
    direction     text NOT NULL CHECK (direction IN ('OUT', 'IN')),
    -- RecordVoucherRequest without doc_date.
    voucher       jsonb NOT NULL CHECK (jsonb_typeof(voucher) = 'object'),
    frequency     text NOT NULL CHECK (frequency IN ('MONTHLY', 'QUARTERLY', 'YEARLY')),
    next_date     date NOT NULL,
    end_date      date,
    is_active     boolean NOT NULL DEFAULT true,
    last_run_on   date,
    last_document_id uuid REFERENCES cash_document (document_id),
    -- The latest reason the sweep could not raise it, cleared on success, so
    -- the list says why a repeat is stuck instead of only that it is.
    last_error    text,
    created_by    text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (end_date IS NULL OR end_date >= next_date OR NOT is_active)
);

CREATE INDEX ix_cash_document_repeat_due ON cash_document_repeat (next_date) WHERE is_active;

COMMENT ON TABLE cash_document_repeat IS
    'A BKK/BKM that repeats (0716): raises a DRAFT voucher on its date, swept hourly like journal_repeat.';
