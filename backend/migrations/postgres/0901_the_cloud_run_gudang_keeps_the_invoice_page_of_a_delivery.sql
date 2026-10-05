-- The supplier's invoice page behind a delivery at the cloud-run Gudang
-- (DC-CLOUD-NATIVE.md, src/cloud/dc/receiving.rs).
--
-- One page per delivery: a second upload is somebody who photographed a
-- crumpled page and then a flat one, and they meant the flat one. The bytes
-- go to the attachment bucket when this cloud has one (`storage_key`), and
-- into `bytes` here when it does not — a Gudang without a bucket still keeps
-- its paper.

CREATE TABLE IF NOT EXISTS dc_invoice_document (
    receipt_id    uuid PRIMARY KEY REFERENCES dc_goods_receipt (receipt_id),
    filename      text NOT NULL CHECK (btrim(filename) <> ''),
    content_type  text NOT NULL,
    byte_count    bigint NOT NULL CHECK (byte_count > 0),
    storage_key   text,
    bytes         bytea,
    uploaded_by   text NOT NULL,
    uploaded_at   timestamptz NOT NULL,
    CHECK ((storage_key IS NULL) <> (bytes IS NULL))
);

COMMENT ON TABLE dc_invoice_document IS
    'The invoice page of a delivery at the cloud-run Gudang (0901): in the attachment bucket, or here when there is none.';
