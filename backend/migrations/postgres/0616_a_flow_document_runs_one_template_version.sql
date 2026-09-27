-- A flow document runs one template version, between two ends.
--
-- One document is one run of a flow: these goods, from here, to there, on the
-- template version that was current when somebody started it (0615). It keeps
-- that version whatever the template does afterwards — the trigger below
-- refuses to move it, or its ends, once written.
--
-- # The ends, and the units they belong to
--
-- Each end is our site or an outside party, never both and never neither.
-- For a site end the document also stores the site's UNIT, copied from
-- `site.unit_id` when the document starts and checked against it here: the
-- books follow the unit, and `crosses_units` — generated, never written — is
-- what makes depart and receive post inter-unit goods (0618). Nothing in a
-- template can switch that off, because nothing in a template is consulted.
--
-- # Stores never deal with suppliers
--
-- A document whose destination is a supplier must leave from a site of the
-- head-office unit, and one whose origin is a supplier must arrive at one.
-- The template already says so (0615); this is the same rule read off the
-- actual site's unit, because a template's `HO` is a site kind and the rule
-- is about whose books the supplier is on.
--
-- # Who and when, per status
--
-- As Medusa's order change keeps them: requested, confirmed, completed,
-- declined, canceled, each with its `_by` and `_at`, and CHECKs that a
-- status cannot be claimed without them.
--
-- # Nothing counted twice
--
-- A document may name the record it runs for (an allotment, a purchase
-- order, a delivery). One live document per record: two flows moving the
-- same allotment would count its goods twice.

CREATE SEQUENCE flow_document_number_sequence;

CREATE TABLE flow_document (
    id                     uuid PRIMARY KEY,
    -- ALR-00000001: what paper and screens print.
    document_number        text NOT NULL UNIQUE CHECK (document_number ~ '^ALR-[0-9]{8,}$'),
    template_id            uuid NOT NULL,
    template_version_id    uuid NOT NULL,
    origin_site_id         text REFERENCES site (id),
    origin_party_kind      text CHECK (origin_party_kind IN ('SUPPLIER', 'CUSTOMER')),
    -- The supplier's or customer's own id, as its register keeps it.
    origin_party_id        text,
    destination_site_id    text REFERENCES site (id),
    destination_party_kind text CHECK (destination_party_kind IN ('SUPPLIER', 'CUSTOMER')),
    destination_party_id   text,
    origin_unit_id         text REFERENCES unit (id),
    destination_unit_id    text REFERENCES unit (id),
    crosses_units          boolean GENERATED ALWAYS AS (
        origin_unit_id IS NOT NULL
        AND destination_unit_id IS NOT NULL
        AND origin_unit_id <> destination_unit_id
    ) STORED,
    subject_kind           text CHECK (subject_kind IN ('ALLOTMENT', 'PURCHASE_ORDER', 'DELIVERY', 'RETURN')),
    subject_id             text,
    -- The role the initiator started it in (domain::flow::FlowRole).
    initiator_role         text NOT NULL,
    status                 text NOT NULL CHECK (status IN (
        'REQUESTED', 'CONFIRMED', 'COMPLETED', 'DECLINED', 'CANCELED'
    )),
    requested_by           text NOT NULL CHECK (btrim(requested_by) <> ''),
    requested_at           timestamptz NOT NULL DEFAULT now(),
    confirmed_by           text,
    confirmed_at           timestamptz,
    completed_by           text,
    completed_at           timestamptz,
    declined_by            text,
    declined_at            timestamptz,
    declined_reason        text,
    canceled_by            text,
    canceled_at            timestamptz,
    canceled_reason        text,
    -- How many actions have been applied: the optimistic lock a confirm
    -- names, so two people confirming the same stage cannot both win.
    action_seq             integer NOT NULL DEFAULT 0 CHECK (action_seq >= 0),
    -- The start request's key: starting twice with one key is one document.
    idempotency_key        text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
    notes                  text,
    updated_at             timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (template_version_id, template_id)
        REFERENCES flow_template_version (id, template_id),
    CONSTRAINT flow_document_one_origin CHECK ((origin_site_id IS NULL) <> (origin_party_kind IS NULL)),
    CONSTRAINT flow_document_one_destination CHECK (
        (destination_site_id IS NULL) <> (destination_party_kind IS NULL)
    ),
    CONSTRAINT flow_document_site_has_its_unit CHECK (
        (origin_site_id IS NULL) = (origin_unit_id IS NULL)
        AND (destination_site_id IS NULL) = (destination_unit_id IS NULL)
    ),
    CONSTRAINT flow_document_touches_our_site CHECK (
        origin_party_kind IS NULL OR destination_party_kind IS NULL
    ),
    CONSTRAINT flow_document_subject_is_whole CHECK ((subject_kind IS NULL) = (subject_id IS NULL)),
    CONSTRAINT flow_document_confirmed_is_whole CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
    CONSTRAINT flow_document_completed_is_whole CHECK ((completed_by IS NULL) = (completed_at IS NULL)),
    CONSTRAINT flow_document_declined_is_whole CHECK (
        (declined_by IS NULL) = (declined_at IS NULL)
        AND (declined_at IS NULL OR btrim(declined_reason) <> '')
    ),
    CONSTRAINT flow_document_canceled_is_whole CHECK (
        (canceled_by IS NULL) = (canceled_at IS NULL)
        AND (canceled_at IS NULL OR btrim(canceled_reason) <> '')
    ),
    CONSTRAINT flow_document_status_has_its_who CHECK (
        CASE status
            WHEN 'REQUESTED' THEN confirmed_at IS NULL AND completed_at IS NULL
                                  AND declined_at IS NULL AND canceled_at IS NULL
            WHEN 'CONFIRMED' THEN confirmed_at IS NOT NULL AND completed_at IS NULL
                                  AND declined_at IS NULL AND canceled_at IS NULL
            WHEN 'COMPLETED' THEN confirmed_at IS NOT NULL AND completed_at IS NOT NULL
            WHEN 'DECLINED'  THEN declined_at IS NOT NULL AND confirmed_at IS NULL
            WHEN 'CANCELED'  THEN canceled_at IS NOT NULL AND completed_at IS NULL
        END
    )
);

CREATE UNIQUE INDEX flow_document_one_live_flow_per_subject
    ON flow_document (subject_kind, subject_id)
    WHERE subject_kind IS NOT NULL AND status NOT IN ('DECLINED', 'CANCELED');

CREATE INDEX ix_flow_document_status ON flow_document (status, requested_at DESC);
CREATE INDEX ix_flow_document_template ON flow_document (template_id);

COMMENT ON TABLE flow_document IS
    'One run of one flow template version between two ends (0616). Keeps its version; crosses_units is generated from the ends'' units and decides the inter-unit posting, never the template.';

-- What was asked for, per SKU. Hidden from a blind stage by the reader.
CREATE TABLE flow_document_line (
    document_id uuid NOT NULL REFERENCES flow_document (id),
    sku_id      uuid NOT NULL REFERENCES sku (id),
    quantity    bigint NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (document_id, sku_id)
);

-- The ends match the template, the units are the sites' own, and suppliers
-- only meet head office.
CREATE FUNCTION flow_document_ends_hold() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    template_origin      text;
    template_destination text;
    actual_origin        text;
    actual_destination   text;
BEGIN
    SELECT t.origin_kind, t.destination_kind
      INTO template_origin, template_destination
      FROM flow_template t
     WHERE t.id = NEW.template_id;

    actual_origin := COALESCE((SELECT s.kind FROM site s WHERE s.id = NEW.origin_site_id),
                            NEW.origin_party_kind);
    actual_destination := COALESCE((SELECT s.kind FROM site s WHERE s.id = NEW.destination_site_id),
                                 NEW.destination_party_kind);
    IF actual_origin IS DISTINCT FROM template_origin
       OR actual_destination IS DISTINCT FROM template_destination THEN
        RAISE EXCEPTION 'this document runs % -> % but its template is for % -> % (0616)',
            actual_origin, actual_destination, template_origin, template_destination;
    END IF;

    IF NEW.origin_site_id IS NOT NULL
       AND NEW.origin_unit_id IS DISTINCT FROM (SELECT s.unit_id FROM site s WHERE s.id = NEW.origin_site_id) THEN
        RAISE EXCEPTION 'origin unit % is not the unit of site % (0616)', NEW.origin_unit_id, NEW.origin_site_id;
    END IF;
    IF NEW.destination_site_id IS NOT NULL
       AND NEW.destination_unit_id IS DISTINCT FROM (SELECT s.unit_id FROM site s WHERE s.id = NEW.destination_site_id) THEN
        RAISE EXCEPTION 'destination unit % is not the unit of site % (0616)',
            NEW.destination_unit_id, NEW.destination_site_id;
    END IF;

    IF NEW.destination_party_kind = 'SUPPLIER'
       AND (SELECT u.kind FROM unit u WHERE u.id = NEW.origin_unit_id) IS DISTINCT FROM 'HO' THEN
        RAISE EXCEPTION 'a supplier return leaves only from a head-office site; stores never deal with suppliers (0616)';
    END IF;
    IF NEW.origin_party_kind = 'SUPPLIER'
       AND (SELECT u.kind FROM unit u WHERE u.id = NEW.destination_unit_id) IS DISTINCT FROM 'HO' THEN
        RAISE EXCEPTION 'goods from a supplier arrive only at a head-office site; stores never deal with suppliers (0616)';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER flow_document_ends_are_checked
    BEFORE INSERT ON flow_document
    FOR EACH ROW EXECUTE FUNCTION flow_document_ends_hold();

-- A running document keeps its version and its ends.
CREATE FUNCTION flow_document_keeps_its_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.template_id <> OLD.template_id
       OR NEW.template_version_id <> OLD.template_version_id
       OR NEW.origin_site_id IS DISTINCT FROM OLD.origin_site_id
       OR NEW.origin_party_kind IS DISTINCT FROM OLD.origin_party_kind
       OR NEW.origin_party_id IS DISTINCT FROM OLD.origin_party_id
       OR NEW.destination_site_id IS DISTINCT FROM OLD.destination_site_id
       OR NEW.destination_party_kind IS DISTINCT FROM OLD.destination_party_kind
       OR NEW.destination_party_id IS DISTINCT FROM OLD.destination_party_id
       OR NEW.origin_unit_id IS DISTINCT FROM OLD.origin_unit_id
       OR NEW.destination_unit_id IS DISTINCT FROM OLD.destination_unit_id
       OR NEW.requested_by <> OLD.requested_by
       OR NEW.requested_at <> OLD.requested_at THEN
        RAISE EXCEPTION 'a flow document keeps its template version, its ends and who asked (0616)';
    END IF;
    IF OLD.status IN ('COMPLETED', 'DECLINED', 'CANCELED') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'a % flow document stays %', OLD.status, OLD.status;
    END IF;
    IF NEW.action_seq < OLD.action_seq THEN
        RAISE EXCEPTION 'applied actions are never taken back (0616)';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER flow_document_version_is_fixed
    BEFORE UPDATE ON flow_document
    FOR EACH ROW EXECUTE FUNCTION flow_document_keeps_its_version();

CREATE FUNCTION flow_document_line_is_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'what a flow document asked for is fixed when it starts (0616)';
END
$$;

CREATE TRIGGER flow_document_line_never_changes
    BEFORE UPDATE OR DELETE ON flow_document_line
    FOR EACH ROW EXECUTE FUNCTION flow_document_line_is_fixed();
