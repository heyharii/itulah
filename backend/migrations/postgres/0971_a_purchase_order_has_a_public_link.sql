-- A printed PO has a link anyone holding the paper can open (owner,
-- 2026-10-16: "di scan langsung keluar isinya", as the surat jalan's QR does).
--
-- The QR on the PO opens a read-only page of that order with no login. Unlike
-- the surat jalan (0962) the page reads the order as it is NOW, not a
-- snapshot, because what it is for is to say whether the order is still
-- active. One link per order: printing it again finds the same one. `token`
-- is the credential (32 random bytes, base64url); nothing lists these rows.
CREATE TABLE purchase_order_link (
    token              text PRIMARY KEY CHECK (length(token) BETWEEN 32 AND 128),
    purchase_order_id  uuid NOT NULL UNIQUE
                       REFERENCES purchase_order (purchase_order_id) ON DELETE CASCADE,
    created_by         text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now()
);
