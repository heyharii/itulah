-- A till numbers its sales in seven letters, and registers a member whole
-- (client, 23 Oct 2026: "ikut client").
--
-- `edge_sale.receipt_no`: the store's two letters, the till's letter, and the
-- till's running number scrambled into four letters — made and kept unique on
-- the store node (`sale_receipt`), carried up on `sales.completed`. Indexed
-- here, not unique: a node restored from a backup may hand a number out again,
-- and a refused sale fact would stop that store's whole stream.
--
-- `member`: a till registers phone, name, gender (L/P), birth place and birth
-- date, and optionally an address and an email. Nullable here: members
-- enrolled before, and at the hub, have none of them.

ALTER TABLE edge_sale ADD COLUMN IF NOT EXISTS receipt_no text;

CREATE INDEX IF NOT EXISTS edge_sale_site_receipt_no
    ON edge_sale (site_id, receipt_no)
    WHERE receipt_no IS NOT NULL;

ALTER TABLE member ADD COLUMN IF NOT EXISTS gender text
    CHECK (gender IS NULL OR gender IN ('L', 'P'));
ALTER TABLE member ADD COLUMN IF NOT EXISTS birth_place text;
ALTER TABLE member ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE member ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE member ADD COLUMN IF NOT EXISTS email text;
