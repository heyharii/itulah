-- 0020: How a sale was paid for, and not only how much.
--
-- A sale recorded `paid_minor` and `change_minor` and nothing about the form
-- the money took, because the till took cash and nothing else. That is no
-- longer the intent: half on a card and half in cash is an ordinary basket, and
-- a shop that cannot record it either refuses the sale or misreports how it
-- settled. The misreport is the expensive one — it surfaces at a bank
-- reconciliation weeks later as a difference with no transaction behind it.
--
-- A tender has no natural id. Its identity is its position in the list the till
-- captured, which is what `tender_seq` is for: a fact re-applied overwrites the
-- same row rather than recording one payment twice. Both reference
-- implementations arrived at the same key, independently, for the same reason.

CREATE TABLE IF NOT EXISTS sale_tender (
    sale_id      TEXT NOT NULL REFERENCES sale(id) ON DELETE CASCADE,
    tender_seq   INTEGER NOT NULL,
    -- Constrained rather than free text. The references leave this open and
    -- pay for it in reports that group by a column holding 'card', 'CARD' and
    -- 'Card' as three tenders.
    method       TEXT NOT NULL CHECK (method IN ('CASH','CARD','QRIS','OTHER')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    -- The acquirer, the issuing bank, an approval code — whatever the person
    -- reconciling this needs. Never an account number and never an instrument:
    -- the domain refuses a reference carrying twelve or more digits, because a
    -- card number that reaches a database is a card number that has to be
    -- erased from every backup of it.
    reference    TEXT,
    PRIMARY KEY (sale_id, tender_seq)
);

CREATE INDEX IF NOT EXISTS ix_sale_tender_method ON sale_tender (method);

-- Every sale already recorded was cash: the till could take nothing else. So
-- the history is not unknown, it is known and simply unwritten — and writing it
-- down is the difference between a takings report that reads "no cash today"
-- and one that reads the truth.
--
-- Left unbackfilled, the drawer figure for every past day would be zero, which
-- is the failure mode this whole change exists to avoid: money on the books
-- that no tender accounts for.
INSERT INTO sale_tender (sale_id, tender_seq, method, amount_minor, reference)
SELECT id, 0, 'CASH', paid_minor, NULL
  FROM sale
 WHERE paid_minor > 0
   AND NOT EXISTS (SELECT 1 FROM sale_tender t WHERE t.sale_id = sale.id);
