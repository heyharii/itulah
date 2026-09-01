-- 0032: Operational Supplier Catalog.
--
-- Supplier and Supplier Item are Cloud-owned masters. Purchase orders keep
-- their existing wire-compatible text fields as snapshots and gain nullable
-- canonical references. Nullable additions preserve every historical row and
-- the legacy POST /api/v1/purchase-orders contract.

CREATE TABLE supplier (
    supplier_id              uuid PRIMARY KEY,
    supplier_code            text NOT NULL CHECK (btrim(supplier_code) <> ''),
    supplier_code_normalized text NOT NULL CHECK (btrim(supplier_code_normalized) <> ''),
    name                     text NOT NULL CHECK (btrim(name) <> ''),
    contact_name             text,
    phone                    text,
    email                    text,
    address                  text,
    status                   text NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE', 'INACTIVE')),
    version                  bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by               text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_by               text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    UNIQUE (supplier_code_normalized)
);

CREATE INDEX ix_supplier_status_name ON supplier (status, name, supplier_id);

CREATE TABLE supplier_item (
    supplier_item_id              uuid PRIMARY KEY,
    supplier_id                   uuid NOT NULL REFERENCES supplier(supplier_id) ON DELETE RESTRICT,
    supplier_item_code            text NOT NULL CHECK (btrim(supplier_item_code) <> ''),
    supplier_item_code_normalized text NOT NULL CHECK (btrim(supplier_item_code_normalized) <> ''),
    name                          text NOT NULL CHECK (btrim(name) <> ''),
    description                   text,
    image_url                     text,
    unit_price_minor              bigint NOT NULL CHECK (unit_price_minor >= 0),
    currency                      char(3) NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
    internal_article_code         text REFERENCES article(article_code) ON DELETE RESTRICT,
    status                        text NOT NULL DEFAULT 'ACTIVE'
                                  CHECK (status IN ('ACTIVE', 'INACTIVE')),
    version                       bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by                    text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at                    timestamptz NOT NULL DEFAULT now(),
    updated_by                    text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at                    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (supplier_id, supplier_item_code_normalized)
);

CREATE INDEX ix_supplier_item_supplier_status_name
    ON supplier_item (supplier_id, status, name, supplier_item_id);
CREATE INDEX ix_supplier_item_internal_article
    ON supplier_item (internal_article_code)
    WHERE internal_article_code IS NOT NULL;

-- Canonical identity for new catalog-backed orders. The old supplier_id and
-- supplier_name columns remain the business-code/name snapshots consumed by
-- the current DC command and old clients.
ALTER TABLE purchase_order
    ADD COLUMN supplier_ref_id uuid REFERENCES supplier(supplier_id) ON DELETE RESTRICT,
    ADD COLUMN supplier_code_snapshot text,
    ADD COLUMN supplier_name_snapshot text;

CREATE INDEX ix_purchase_order_supplier_ref
    ON purchase_order (supplier_ref_id)
    WHERE supplier_ref_id IS NOT NULL;

-- Existing article_code/article_name/image_url/unit_price_minor remain the
-- Edge-compatible item snapshots. These explicit columns provide canonical
-- provenance without changing the existing command payload.
ALTER TABLE purchase_order_line
    ADD COLUMN supplier_item_id uuid REFERENCES supplier_item(supplier_item_id) ON DELETE RESTRICT,
    ADD COLUMN supplier_item_code_snapshot text,
    ADD COLUMN supplier_item_name_snapshot text,
    ADD COLUMN supplier_item_image_snapshot text,
    ADD COLUMN supplier_item_version bigint CHECK (supplier_item_version IS NULL OR supplier_item_version > 0),
    ADD COLUMN currency char(3) CHECK (currency IS NULL OR currency = 'IDR');

CREATE INDEX ix_purchase_order_line_supplier_item
    ON purchase_order_line (supplier_item_id)
    WHERE supplier_item_id IS NOT NULL;

COMMENT ON TABLE supplier IS
    'Cloud-owned Supplier master. Inactive rows remain readable and are never physically deleted by the API.';
COMMENT ON TABLE supplier_item IS
    'Current purchasable catalog per Supplier. Purchase orders snapshot mutable names, images, and prices.';
COMMENT ON COLUMN purchase_order.supplier_id IS
    'Legacy-compatible Supplier business-code snapshot; canonical identity is supplier_ref_id.';
COMMENT ON COLUMN purchase_order_line.article_code IS
    'Legacy-compatible Supplier Item code snapshot for purchase-order delivery to DC.';
