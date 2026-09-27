-- 0611: an allotment names a route, and not a spelling.
--
-- Owner's decisions of 2026-09-27: goods are not tied to "Gudang → store".
-- Any site can be an origin or a destination, subject to the route:
--
--   TO_SITE              our goods to a site of ours that sells them —
--                          REPLENISH from the Gudang, TRANSFER from a shop
--   RETURN_TO_WAREHOUSE  a shop's goods back to the Gudang, into that
--                          store's return pool, then inspected
--   RETURN_TO_SUPPLIER   goods back to a supplier, and ONLY from a site of
--                          the head-office unit: stores never deal with
--                          suppliers
--
-- Whether a line's source and destination fit its route is read from the
-- sites' rows (their kind, their unit and its kind), never from their ids.
-- 0005 checked the opposite way: a STORE destination had to be spelled
-- `store-%` and a DC destination had to BE `dc`. Both go.
--
-- # The old spellings stay readable
--
-- `TO_STORE` and `RETURN_TO_DC` are on every allotment written before this,
-- and the identity trigger forbids rewriting a type (0005), so they are not
-- rewritten: the CHECK admits them and every reader maps them — TO_STORE is
-- TO_SITE, RETURN_TO_DC is RETURN_TO_WAREHOUSE. New rows carry the new words.
--
-- The activation command still carries the OLD words to a node, and the
-- destination type still says STORE / DC / SUPPLIER on the line. Nodes in the
-- field run older builds; their own SQLite CHECKs (`dc_allotment_work`,
-- `dc_allotment_work_line`) admit only those, and an unreadable command blocks
-- a node's whole stream. On the line they are now DERIVED from the
-- destination site's kind rather than trusted from the id: STORE means a site
-- that sells, DC a site that keeps goods for others.
--
-- # Purpose
--
-- A TO_SITE allotment says why: REPLENISH (the Gudang sends) or TRANSFER (a
-- shop sends to a shop — the books cross through head office, another lane's
-- concern). Derived from the source site's unit, written once, never changed.
-- NULL on a row written before 0611, which reads as REPLENISH: every TO_STORE
-- was the Gudang's. Not backfilled, because the identity trigger refuses any
-- update to a finalised allotment and a backfill that skips some rows would
-- be two rules for one column.

-- ---------------------------------------------------------------------------
-- 1. The type and the purpose
-- ---------------------------------------------------------------------------

ALTER TABLE allotment DROP CONSTRAINT allotment_type_final_check;

ALTER TABLE allotment
    ADD CONSTRAINT allotment_type_route_check CHECK (type IN (
        'TO_SITE', 'RETURN_TO_WAREHOUSE', 'RETURN_TO_SUPPLIER',
        -- Written before 0611; read as TO_SITE and RETURN_TO_WAREHOUSE.
        'TO_STORE', 'RETURN_TO_DC'
    )),
    ADD COLUMN purpose text CHECK (purpose IN ('REPLENISH', 'TRANSFER')),
    ADD CONSTRAINT allotment_purpose_is_a_to_site_word
        CHECK (purpose IS NULL OR type IN ('TO_SITE', 'TO_STORE'));

COMMENT ON COLUMN allotment.type IS
    'The route (0611): TO_SITE, RETURN_TO_WAREHOUSE or RETURN_TO_SUPPLIER. TO_STORE and RETURN_TO_DC are the same routes as written before 0611.';
COMMENT ON COLUMN allotment.purpose IS
    'For TO_SITE: REPLENISH (from a site of the head-office unit) or TRANSFER (from a shop). NULL before 0611, read as REPLENISH.';

-- The purpose joins the identity: decided once, like the type.
CREATE OR REPLACE FUNCTION protect_allotment_identity() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'allotments cannot be deleted; cancel remaining quantity instead';
    END IF;
    IF OLD.type <> NEW.type
       OR OLD.purpose IS DISTINCT FROM NEW.purpose
       OR OLD.created_by <> NEW.created_by
       OR OLD.created_at <> NEW.created_at
       OR OLD.idempotency_key <> NEW.idempotency_key THEN
        RAISE EXCEPTION 'allotment identity, type and purpose are immutable; cancel and create a new allotment';
    END IF;
    IF OLD.status IN ('EXECUTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'finalized allotments are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 2. The destination is a site of the right kind, read from its row
-- ---------------------------------------------------------------------------

ALTER TABLE allotment_line DROP CONSTRAINT allotment_line_destination_id_check;

-- A shop is a site whose kind's template gives it a saleable floor; a
-- warehouse is one whose template gives it receiving (0610). The kind words
-- themselves are not listed here, so the premises rename (OFFICE, WAREHOUSE,
-- SHOP) changes nothing in this file.
CREATE FUNCTION allotment_line_destination_is_a_site_of_its_kind() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_kind text;
BEGIN
    IF NEW.destination_type = 'SUPPLIER' THEN
        -- The supplier counterparty is a place, not a site.
        IF NEW.destination_id <> 'external/supplier' THEN
            RAISE EXCEPTION 'a SUPPLIER destination is external/supplier, not %', NEW.destination_id;
        END IF;
        -- Stores never deal with suppliers: goods leave for one only from a
        -- site of the head-office unit, found by the unit's kind.
        IF NOT EXISTS (
            SELECT 1 FROM site s JOIN unit u ON u.id = s.unit_id
             WHERE s.id = NEW.source_site_id AND u.kind = 'HO'
        ) THEN
            RAISE EXCEPTION 'goods leave for a supplier only from a site of the head-office unit, not from %',
                NEW.source_site_id;
        END IF;
        RETURN NEW;
    END IF;
    SELECT kind INTO v_kind FROM site WHERE id = NEW.destination_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'allotment destination % is not a site', NEW.destination_id;
    END IF;
    IF NEW.destination_type = 'STORE' AND NOT EXISTS (
        SELECT 1 FROM pool_template WHERE site_kind = v_kind AND role = 'FLOOR'
    ) THEN
        RAISE EXCEPTION 'allotment destination % is a % site, which sells nothing', NEW.destination_id, v_kind;
    END IF;
    IF NEW.destination_type = 'DC' AND NOT EXISTS (
        SELECT 1 FROM pool_template WHERE site_kind = v_kind AND role = 'RECEIVING'
    ) THEN
        RAISE EXCEPTION 'allotment destination % is a % site, which is no warehouse', NEW.destination_id, v_kind;
    END IF;
    IF NEW.destination_id = NEW.source_site_id THEN
        RAISE EXCEPTION 'an allotment line cannot send goods to the site they stand at';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER allotment_line_destination_is_a_site_of_its_kind
BEFORE INSERT ON allotment_line
FOR EACH ROW EXECUTE FUNCTION allotment_line_destination_is_a_site_of_its_kind();

COMMENT ON COLUMN allotment_line.destination_type IS
    'STORE (a site that sells), DC (a warehouse) or SUPPLIER — the words nodes read. Derived from the destination site''s kind since 0611, never from its id.';
