-- 0095: `BANK_STATEMENT` joins the source kinds.
--
-- # What was missing
--
-- 0071 was deliberate that reconciling posts nothing: a match records that the
-- bank has confirmed something we already booked. It said, in as many words,
-- that the interesting line is the UNMATCHED one — bank charges, interest
-- credited, a customer transfer nobody recorded — and that turning one into a
-- journal entry is "a separate, deliberate act with its own actor".
--
-- That act was never written. So a reconciliation could reach the point of
-- saying "these four lines are ours and these three are new", and then had
-- nowhere to go: the only way to book the three was a hand-keyed journal entry
-- that named no document, followed by a second visit to the statement to match
-- it. Two acts, and a gap between them in which the entry exists and nothing
-- points at the line that caused it.
--
-- # Why a new source kind, and not MANUAL
--
-- Exactly 0083's argument. MANUAL is the one kind that means "a person typed
-- this from nothing, and a person can therefore have got it wrong" — the
-- Journal screen paints it with a warning pill for that reason. A bank charge
-- booked from a statement line is the opposite: it has a document behind it,
-- and the document is the bank's own. Labelling it MANUAL would put it in the
-- list an auditor asks for when they want the entries with no evidence, which
-- is the one list it does not belong in.
--
-- MANUAL is also the kind the schema excuses from carrying a `source_id`. A
-- bank line has one to carry, and from here it carries it: `source_id` is the
-- `bank_statement_line.line_id`, so the entry and the line each name the other
-- — the line through `bank_line_match`, the entry through its source.

ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT'));

-- The other CHECK on this table — a non-MANUAL, non-REVERSAL entry must carry a
-- `source_id` — is deliberately left alone. BANK_STATEMENT falls under it,
-- which is the point.

COMMENT ON COLUMN journal_entry.source_kind IS
    'What caused this entry. MANUAL means a person typed it and carries no document; every other kind names one in source_id — DEPRECIATION names the asset it charged, BANK_STATEMENT the statement line it booked.';

-- Nothing else changes. Booking a line writes one ordinary journal entry
-- through `poster::post` and one ordinary row in `bank_line_match`, in one
-- transaction, so a booked line is agreed with its own entry the moment it
-- exists. Both of those tables already refuse everything they need to: the
-- entry must balance and its period must be open, and `bank_line_match`'s two
-- unique indexes refuse a line that is already matched and a journal line that
-- is already spoken for.
