CREATE TABLE commercial_publication (
    id UUID PRIMARY KEY,
    version BIGINT NOT NULL UNIQUE CHECK (version > 0),
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED')),
    effective_from TIMESTAMPTZ NOT NULL,
    effective_to TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_by TEXT,
    published_at TIMESTAMPTZ,
    CHECK (effective_to IS NULL OR effective_to > effective_from),
    CHECK ((status = 'DRAFT' AND published_at IS NULL) OR (status = 'PUBLISHED' AND published_at IS NOT NULL AND published_by IS NOT NULL))
);

CREATE TABLE commercial_tax_rule (
    id UUID PRIMARY KEY,
    publication_id UUID NOT NULL REFERENCES commercial_publication(id),
    tax_category TEXT NOT NULL,
    rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 100000),
    tax_inclusive BOOLEAN NOT NULL,
    UNIQUE (publication_id, tax_category)
);

CREATE TABLE commercial_assortment_rule (
    id UUID PRIMARY KEY,
    publication_id UUID NOT NULL REFERENCES commercial_publication(id),
    sku_id UUID NOT NULL REFERENCES sku(id),
    site_id TEXT REFERENCES site(id),
    channel TEXT NOT NULL CHECK (channel IN ('STORE', 'ONLINE', 'MARKETPLACE')),
    sellable BOOLEAN NOT NULL
);
CREATE UNIQUE INDEX commercial_assortment_scope_unique
ON commercial_assortment_rule(publication_id, sku_id, COALESCE(site_id, '*'), channel);

CREATE TABLE commercial_price_rule (
    id UUID PRIMARY KEY,
    publication_id UUID NOT NULL REFERENCES commercial_publication(id),
    sku_id UUID NOT NULL REFERENCES sku(id),
    site_id TEXT REFERENCES site(id),
    channel TEXT NOT NULL CHECK (channel IN ('STORE', 'ONLINE', 'MARKETPLACE')),
    currency CHAR(3) NOT NULL,
    unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
    tax_category TEXT NOT NULL
);
CREATE UNIQUE INDEX commercial_price_scope_unique
ON commercial_price_rule(publication_id, sku_id, COALESCE(site_id, '*'), channel);

CREATE SEQUENCE sale_number_sequence START 1;

CREATE TABLE sale (
    id UUID PRIMARY KEY,
    sale_number TEXT NOT NULL UNIQUE,
    site_id TEXT NOT NULL REFERENCES site(id),
    channel TEXT NOT NULL CHECK (channel IN ('STORE', 'ONLINE', 'MARKETPLACE')),
    status TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'VOIDED')),
    commercial_publication_id UUID NOT NULL REFERENCES commercial_publication(id),
    commercial_version BIGINT NOT NULL,
    currency CHAR(3) NOT NULL,
    net_minor BIGINT NOT NULL DEFAULT 0 CHECK (net_minor >= 0),
    tax_minor BIGINT NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    total_minor BIGINT NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
    paid_minor BIGINT NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
    change_minor BIGINT NOT NULL DEFAULT 0 CHECK (change_minor >= 0),
    movement_group_id UUID REFERENCES movement_group(id),
    actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    voided_at TIMESTAMPTZ,
    CHECK ((status = 'OPEN' AND completed_at IS NULL AND voided_at IS NULL)
        OR (status = 'COMPLETED' AND completed_at IS NOT NULL AND movement_group_id IS NOT NULL)
        OR (status = 'VOIDED' AND voided_at IS NOT NULL))
);
CREATE INDEX sale_site_time_idx ON sale(site_id, created_at DESC);

CREATE TABLE sale_line (
    id UUID PRIMARY KEY,
    sale_id UUID NOT NULL REFERENCES sale(id),
    subject_id UUID NOT NULL REFERENCES inventory_subject(id),
    sku_id UUID NOT NULL REFERENCES sku(id),
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
    net_minor BIGINT NOT NULL CHECK (net_minor >= 0),
    tax_minor BIGINT NOT NULL CHECK (tax_minor >= 0),
    total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
    currency CHAR(3) NOT NULL,
    tax_category TEXT NOT NULL,
    tax_rate_bps INTEGER NOT NULL,
    tax_inclusive BOOLEAN NOT NULL,
    commercial_publication_id UUID NOT NULL REFERENCES commercial_publication(id),
    commercial_version BIGINT NOT NULL,
    price_snapshot_digest TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sale_id, subject_id)
);
CREATE INDEX sale_line_sale_idx ON sale_line(sale_id, added_at);

CREATE TABLE sale_payment (
    id UUID PRIMARY KEY,
    sale_id UUID NOT NULL REFERENCES sale(id),
    method TEXT NOT NULL CHECK (method IN ('CASH', 'CARD', 'QRIS', 'OTHER')),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    reference TEXT,
    actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sale_payment_sale_idx ON sale_payment(sale_id, recorded_at);

CREATE OR REPLACE FUNCTION protect_commercial_rule() RETURNS trigger AS $$
DECLARE
    publication UUID;
    publication_status TEXT;
BEGIN
    publication := CASE WHEN TG_OP = 'DELETE' THEN OLD.publication_id ELSE NEW.publication_id END;
    SELECT status INTO publication_status FROM commercial_publication WHERE id = publication;
    IF publication_status = 'PUBLISHED' THEN
        RAISE EXCEPTION 'published commercial rules are immutable';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER commercial_tax_rule_immutable
BEFORE INSERT OR UPDATE OR DELETE ON commercial_tax_rule
FOR EACH ROW EXECUTE FUNCTION protect_commercial_rule();
CREATE TRIGGER commercial_assortment_rule_immutable
BEFORE INSERT OR UPDATE OR DELETE ON commercial_assortment_rule
FOR EACH ROW EXECUTE FUNCTION protect_commercial_rule();
CREATE TRIGGER commercial_price_rule_immutable
BEFORE INSERT OR UPDATE OR DELETE ON commercial_price_rule
FOR EACH ROW EXECUTE FUNCTION protect_commercial_rule();

CREATE OR REPLACE FUNCTION protect_commercial_publication() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'commercial publications cannot be deleted';
    END IF;
    IF OLD.status = 'PUBLISHED' THEN
        RAISE EXCEPTION 'published commercial publications are immutable';
    END IF;
    IF NEW.status NOT IN ('DRAFT', 'PUBLISHED') THEN
        RAISE EXCEPTION 'invalid commercial publication transition';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER commercial_publication_immutable
BEFORE UPDATE OR DELETE ON commercial_publication
FOR EACH ROW EXECUTE FUNCTION protect_commercial_publication();

CREATE OR REPLACE FUNCTION protect_sale_child() RETURNS trigger AS $$
DECLARE
    current_status TEXT;
    target_sale UUID;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        RAISE EXCEPTION 'sale lines and payments are append-only';
    END IF;
    target_sale := NEW.sale_id;
    SELECT status INTO current_status FROM sale WHERE id = target_sale;
    IF current_status <> 'OPEN' THEN
        RAISE EXCEPTION 'sale child facts can only be appended to an OPEN sale';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sale_line_append_only
BEFORE INSERT OR UPDATE OR DELETE ON sale_line
FOR EACH ROW EXECUTE FUNCTION protect_sale_child();
CREATE TRIGGER sale_payment_append_only
BEFORE INSERT OR UPDATE OR DELETE ON sale_payment
FOR EACH ROW EXECUTE FUNCTION protect_sale_child();

CREATE OR REPLACE FUNCTION protect_completed_sale() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'sales cannot be deleted';
    END IF;
    IF OLD.status IN ('COMPLETED', 'VOIDED') THEN
        RAISE EXCEPTION 'finalized sales are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sale_finalized_immutable
BEFORE UPDATE OR DELETE ON sale
FOR EACH ROW EXECUTE FUNCTION protect_completed_sale();

-- Published Commercial Version 1: company-wide Store offer for every seeded SKU.
INSERT INTO commercial_publication(id, version, name, status, effective_from, created_by)
VALUES (md5('commercial-publication:v1')::uuid, 1, 'Initial Store Price Book', 'DRAFT', now() - interval '1 day', 'system-seed');

INSERT INTO commercial_tax_rule(id, publication_id, tax_category, rate_bps, tax_inclusive)
VALUES (md5('commercial-tax:v1:standard')::uuid, md5('commercial-publication:v1')::uuid, 'STANDARD', 1100, TRUE);

INSERT INTO commercial_assortment_rule(id, publication_id, sku_id, site_id, channel, sellable)
SELECT md5('commercial-assortment:v1:' || sku_code)::uuid, md5('commercial-publication:v1')::uuid, id, NULL, 'STORE', TRUE
FROM sku;

INSERT INTO commercial_price_rule(id, publication_id, sku_id, site_id, channel, currency, unit_price_minor, tax_category)
SELECT md5('commercial-price:v1:' || sku_code)::uuid, md5('commercial-publication:v1')::uuid, id, NULL, 'STORE', 'IDR',
       99000 + row_number() OVER (ORDER BY sku_code) * 10000, 'STANDARD'
FROM sku;

UPDATE commercial_publication
SET status='PUBLISHED', published_by='system-seed', published_at=now() - interval '1 day'
WHERE id=md5('commercial-publication:v1')::uuid;

COMMENT ON TABLE commercial_publication IS 'Immutable published commercial versions consumed by Store Edge Sales.';
COMMENT ON TABLE sale_line IS 'Historical commercial snapshot; later price publications never rewrite a sale.';
COMMENT ON COLUMN sale.movement_group_id IS 'Atomic inventory SALE movement group created when the sale completes.';
