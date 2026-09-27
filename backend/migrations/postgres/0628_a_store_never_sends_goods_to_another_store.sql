-- A store never sends goods to another store.
--
-- Owner's ruling, 28 Sep 2026: "toko vs toko ga bisa ya, udah titik". Goods
-- leave a store only back to the Gudang (a return head office starts); a
-- store that has too much of something returns it, and head office allots it
-- onward. So the route STORE → STORE is closed everywhere a route is decided:
--
--   * `allotment_line`: the trigger 0611 wrote refuses a line whose source
--     and destination sites both belong to units of kind STORE. The units are
--     read from data (`site.unit_id`, `unit.kind`), never from an id.
--   * `flow_template`: the seeded MUTASI_ANTAR_TOKO template (0619) is
--     retired, and an ACTIVE template may not serve STORE → STORE. A retired
--     row stays readable, because a template's history is never deleted.
--
-- Nothing is lost: no store-to-store allotment could have been raised before
-- this, since the route had no screen and the posting for it was held.

CREATE OR REPLACE FUNCTION allotment_line_destination_is_a_site_of_its_kind() RETURNS trigger
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
    -- 0628: one store never sends goods to another; they go back to the
    -- Gudang and head office allots them onward.
    IF EXISTS (
        SELECT 1
          FROM site src JOIN unit su ON su.id = src.unit_id,
               site dst JOIN unit du ON du.id = dst.unit_id
         WHERE src.id = NEW.source_site_id AND dst.id = NEW.destination_id
           AND su.kind = 'STORE' AND du.kind = 'STORE'
    ) THEN
        RAISE EXCEPTION 'goods never move from one store to another (% to %); return them to the Gudang and allot them from there',
            NEW.source_site_id, NEW.destination_id;
    END IF;
    RETURN NEW;
END
$$;

UPDATE flow_template
   SET status = 'RETIRED', is_default = false,
       retired_at = now(), retired_by = 'migration:0628'
 WHERE origin_kind = 'STORE' AND destination_kind = 'STORE' AND status = 'ACTIVE';

-- flow_template carries deferred checks (0615); fire them now, or the ALTER
-- below is refused while their events are pending.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE flow_template
    ADD CONSTRAINT flow_template_no_store_to_store
    CHECK (status = 'RETIRED' OR NOT (origin_kind = 'STORE' AND destination_kind = 'STORE'));

COMMENT ON CONSTRAINT flow_template_no_store_to_store ON flow_template IS
    'A store never sends goods to another store (owner, 28 Sep 2026; 0628). Retired rows keep their history.';
