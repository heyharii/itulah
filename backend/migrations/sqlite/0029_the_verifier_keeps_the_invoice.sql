-- The supplier's invoice, kept as the paper it is.
--
-- `goods_receipt` has carried the invoice's NUMBERS since 0005 — number, date,
-- total, and a `invoice_document_ref` that was only ever a string somebody
-- typed. The numbers are what the system compares; the paper is what settles
-- an argument about them, and until now there was nowhere to put it.
--
-- It lives on this node, in this table, and not in the centre's file vault:
-- the vault's rows are reachable only through the conversation they were
-- posted in, and a DC has to be able to take a delivery with the line to head
-- office down. The bytes travel later, like everything else here.
--
-- One row per delivery, because one lorry brings one invoice. A second
-- upload replaces the first rather than accumulating: the verifier who
-- photographed a crumpled page and then a flat one meant the second.
CREATE TABLE IF NOT EXISTS goods_receipt_invoice_document (
    receipt_id   TEXT PRIMARY KEY REFERENCES goods_receipt(receipt_id),
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_count   INTEGER NOT NULL CHECK (byte_count > 0),
    bytes        BLOB NOT NULL,
    uploaded_by  TEXT NOT NULL,
    uploaded_at  TEXT NOT NULL
);
