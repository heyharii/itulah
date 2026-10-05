-- 0711 — A BKK / BKM is a voucher with lines, the way SeventhSoft's is.
--
-- Until now a cash document moved one amount from one account to one other
-- account. The client's BKK (Bukti Kas/Bank Keluar) and BKM (Bukti Kas/Bank
-- Masuk) are more than that, and the owner wants them exactly as the finance
-- team knew them (2026-09-29, the Klasik layout of `bkm-bkk-prototype.html`):
--
--   header   the cash or bank account, the date, a reference, the party, how
--            it was paid (cash / transfer / giro, with the giro's number, bank
--            and due date), a note
--   Settle   bills of that supplier, each with what is paid and the POTONGAN
--   Other    lines to any other account — bank charges, electricity, supplies
--   Offset   what the party owes us, netted off (for a supplier: the advances
--            we paid them and have not yet set against a bill)
--
-- One voucher, one number (KK / KM from 0701), one journal entry. The total is
-- Settle − discount + Other − Offset, and it is what leaves (or reaches) the
-- money account.
--
-- A voucher that settles bills also writes the supplier payment and its
-- allocations that every payables screen already reads, in the same
-- transaction, so "who is owed what" is still answered by one set of rows.

ALTER TABLE cash_document
    ADD COLUMN method text NOT NULL DEFAULT 'CASH'
        CHECK (method IN ('CASH', 'TRANSFER', 'GIRO')),
    ADD COLUMN reference text,
    -- The bank a giro we RECEIVE is drawn on (the customer's bank). A giro we
    -- write is drawn on our own bank, which is the money side's qualifier.
    ADD COLUMN giro_bank text,
    -- True for a voucher keyed with lines; the side that is not the money
    -- account is then carried by `cash_document_line` and is NULL here.
    ADD COLUMN has_lines boolean NOT NULL DEFAULT false,
    -- The payment written when the voucher settled bills.
    ADD COLUMN supplier_payment_id uuid REFERENCES supplier_payment(payment_id);

-- Each side names a meaning or a code — except the lines side of a voucher,
-- which names neither because its lines do.
ALTER TABLE cash_document DROP CONSTRAINT cash_document_check;
ALTER TABLE cash_document DROP CONSTRAINT cash_document_check1;
ALTER TABLE cash_document ADD CONSTRAINT cash_document_from_names_one_account
    CHECK ((from_key IS NULL) <> (from_account_code IS NULL)
           OR (has_lines AND from_key IS NULL AND from_account_code IS NULL));
ALTER TABLE cash_document ADD CONSTRAINT cash_document_to_names_one_account
    CHECK ((to_key IS NULL) <> (to_account_code IS NULL)
           OR (has_lines AND to_key IS NULL AND to_account_code IS NULL));

-- A BKM can be paid by giro too: a customer's giro, received.
ALTER TABLE cash_document DROP CONSTRAINT cash_document_check7;
ALTER TABLE cash_document ADD CONSTRAINT cash_document_giro_is_a_method
    CHECK (giro_number IS NULL OR method = 'GIRO');

CREATE TABLE cash_document_line (
    document_id    uuid    NOT NULL REFERENCES cash_document(document_id) ON DELETE CASCADE,
    line_no        integer NOT NULL CHECK (line_no > 0),
    kind           text    NOT NULL CHECK (kind IN ('SETTLE', 'OTHER', 'OFFSET')),

    -- SETTLE: the bill.
    invoice_id     uuid REFERENCES supplier_invoice(invoice_id),
    -- OFFSET: the advance netted off.
    advance_id     uuid REFERENCES supplier_advance(advance_id),

    -- OTHER: the account, as a cash document side names one — a meaning, or a
    -- client code a person chose with its category — in a unit's books.
    semantic_key   text,
    qualifier      text NOT NULL DEFAULT '',
    account_code   text,
    category_code  text REFERENCES line_category(category_code),
    unit_id        text REFERENCES unit(id),

    -- What the line settles, pays or nets — the whole of it, discount included.
    amount_minor   bigint  NOT NULL CHECK (amount_minor > 0),
    -- The POTONGAN on a settled bill: part of `amount_minor` settled without
    -- money (0704).
    discount_minor bigint  NOT NULL DEFAULT 0
        CHECK (discount_minor >= 0 AND discount_minor <= amount_minor),
    note           text,

    PRIMARY KEY (document_id, line_no),
    CHECK (kind <> 'SETTLE' OR invoice_id IS NOT NULL),
    CHECK (kind <> 'OFFSET' OR advance_id IS NOT NULL),
    CHECK (kind =  'SETTLE' OR discount_minor = 0),
    CHECK (kind <> 'OTHER'
           OR (((semantic_key IS NULL) <> (account_code IS NULL)) AND unit_id IS NOT NULL)),
    CHECK (semantic_key IS NOT NULL OR qualifier = '')
);

CREATE INDEX ix_cash_document_line_invoice ON cash_document_line (invoice_id)
    WHERE invoice_id IS NOT NULL;
CREATE INDEX ix_cash_document_line_advance ON cash_document_line (advance_id)
    WHERE advance_id IS NOT NULL;

COMMENT ON TABLE cash_document_line IS
    'The lines of a BKK / BKM voucher (0711): bills settled, other accounts paid or received, and advances netted off. One voucher posts one journal entry.';
