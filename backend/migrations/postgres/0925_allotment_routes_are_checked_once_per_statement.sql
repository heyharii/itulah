-- Validate each distinct route once, rather than each SKU row. An invalid
-- route still raises inside the INSERT and rolls back every inserted line.
-- Transition rows also cover direct SQL writes; no application bypass exists.
CREATE FUNCTION allotment_inserted_routes_are_valid() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_kind text;
    route record;
BEGIN
    FOR route IN
        SELECT DISTINCT source_site_id, destination_type, destination_id
        FROM inserted_lines
        ORDER BY source_site_id, destination_type, destination_id
    LOOP
    IF route.destination_type = 'SUPPLIER' THEN
        -- The supplier counterparty is a place, not a site.
        IF route.destination_id <> 'external/supplier' THEN
            RAISE EXCEPTION 'a SUPPLIER destination is external/supplier, not %', route.destination_id;
        END IF;
        -- Stores never deal with suppliers: goods leave for one only from a
        -- site of the head-office unit, found by the unit's kind.
        IF NOT EXISTS (
            SELECT 1 FROM site s JOIN unit u ON u.id = s.unit_id
             WHERE s.id = route.source_site_id AND u.kind = 'HO'
        ) THEN
            RAISE EXCEPTION 'goods leave for a supplier only from a site of the head-office unit, not from %',
                route.source_site_id;
        END IF;
        CONTINUE;
    END IF;
    SELECT kind INTO v_kind FROM site WHERE id = route.destination_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'allotment destination % is not a site', route.destination_id;
    END IF;
    IF route.destination_type = 'STORE' AND NOT EXISTS (
        SELECT 1 FROM pool_template WHERE site_kind = v_kind AND role = 'FLOOR'
    ) THEN
        RAISE EXCEPTION 'allotment destination % is a % site, which sells nothing', route.destination_id, v_kind;
    END IF;
    IF route.destination_type = 'DC' AND NOT EXISTS (
        SELECT 1 FROM pool_template WHERE site_kind = v_kind AND role = 'RECEIVING'
    ) THEN
        RAISE EXCEPTION 'allotment destination % is a % site, which is no warehouse', route.destination_id, v_kind;
    END IF;
    IF route.destination_id = route.source_site_id THEN
        RAISE EXCEPTION 'an allotment line cannot send goods to the site they stand at';
    END IF;
    -- 0628: one store never sends goods to another; they go back to the
    -- Gudang and head office allots them onward.
    IF EXISTS (
        SELECT 1
          FROM site src JOIN unit su ON su.id = src.unit_id,
               site dst JOIN unit du ON du.id = dst.unit_id
         WHERE src.id = route.source_site_id AND dst.id = route.destination_id
           AND su.kind = 'STORE' AND du.kind = 'STORE'
    ) THEN
        RAISE EXCEPTION 'goods never move from one store to another (% to %); return them to the Gudang and allot them from there',
            route.source_site_id, route.destination_id;
    END IF;
    END LOOP;
    RETURN NULL;
END
$$;

DROP TRIGGER allotment_line_destination_is_a_site_of_its_kind ON allotment_line;
CREATE TRIGGER allotment_line_destination_is_a_site_of_its_kind
AFTER INSERT ON allotment_line
REFERENCING NEW TABLE AS inserted_lines
FOR EACH STATEMENT EXECUTE FUNCTION allotment_inserted_routes_are_valid();
