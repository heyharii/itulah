-- 0028: A till can be paid with a voucher.
--
-- `0020` constrained a tender's method to four values, on the argument that
-- free text costs a report which groups 'card', 'CARD' and 'Card' as three
-- tenders. That argument holds. The list was short by one, because when it was
-- written there was no voucher anywhere in the system to add — the centre's
-- `0090` has since given one a table, a balance and a movement per spend.
--
-- Without this, a basket settled partly by gift card is recorded as OTHER, and
-- the day's takings say the shop took money it did not take: the money arrived
-- when the card was sold, possibly at another shop and possibly last year.
-- That is precisely the meaning the constraint exists to preserve.
--
-- SQLite cannot alter a CHECK, so the table is rebuilt. The order below is the
-- one the manual prescribes — new table, copy, drop, rename — and it is done
-- inside the migration's own transaction, so a failure anywhere leaves the
-- original in place.

CREATE TABLE sale_tender_new (
    sale_id      TEXT NOT NULL REFERENCES sale(id) ON DELETE CASCADE,
    tender_seq   INTEGER NOT NULL,
    method       TEXT NOT NULL
                 CHECK (method IN ('CASH','CARD','QRIS','OTHER','VOUCHER')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    reference    TEXT,
    PRIMARY KEY (sale_id, tender_seq)
);

-- Every column named, rather than `SELECT *`. A rebuild that relies on column
-- order is a rebuild that silently transposes two of them the day somebody
-- adds a sixth.
INSERT INTO sale_tender_new (sale_id, tender_seq, method, amount_minor, reference)
SELECT sale_id, tender_seq, method, amount_minor, reference FROM sale_tender;

DROP TABLE sale_tender;

ALTER TABLE sale_tender_new RENAME TO sale_tender;

-- The index went with the table it was on.
CREATE INDEX IF NOT EXISTS ix_sale_tender_method ON sale_tender (method);
