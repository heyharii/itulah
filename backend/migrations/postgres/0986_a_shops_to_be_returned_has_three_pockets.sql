-- A shop's To be returned has three pockets (owner, 23 Oct 2026: "kantong
-- dalam kantong"):
--
--   * Reject item   `{site}.reject`            — the store head's own, as before
--   * Over delivery `{site}.to-return.over`    — what MD sent back from a delivery
--   * Return HO     `{site}.to-return.ho`      — what HO moved off the shelves
--
-- All three are role REJECT: off the shelves, not for sale, and sent to HO
-- the way the reject is — the shop's Send raises a return allotment from the
-- pocket (`postgres::store_reject_return`). Not RETURN: that role is a
-- warehouse's pool for one store's goods (`operational_pool_return_names_its_origin`,
-- one per origin, 0610), and a shop keeps none.
--
-- The template cannot give them (0610's `ensure_site_pools` matches by role,
-- and a shop already has its REJECT), so the shops that exist get them here
-- and a shop created later gets them from a trigger of its own.

CREATE FUNCTION ensure_to_return_pockets(p_site_id text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_site site%ROWTYPE;
    v_created integer := 0;
BEGIN
    SELECT * INTO v_site FROM site WHERE id = p_site_id;
    IF NOT FOUND OR v_site.kind NOT IN ('STORE', 'SHOP') THEN
        RETURN 0;
    END IF;
    IF NOT pool_id_segment_is_well_formed(v_site.id) THEN
        RAISE EXCEPTION 'site id % cannot be spelled into a pool id', v_site.id;
    END IF;
    v_created := v_created + create_operational_pool(
        v_site.id || '.to-return.over', v_site.id, 'REJECT', 'REJECT', 'OVER_DELIVERY',
        'Over delivery', FALSE, 31, NULL
    );
    v_created := v_created + create_operational_pool(
        v_site.id || '.to-return.ho', v_site.id, 'REJECT', 'REJECT', 'RETURN_HO',
        'Return HO', FALSE, 32, NULL
    );
    RETURN v_created;
END
$$;

COMMENT ON FUNCTION ensure_to_return_pockets(text) IS
    'Give a shop the Over delivery and Return HO pockets of its To be returned (0986). Idempotent.';

CREATE FUNCTION site_is_given_its_to_return_pockets() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM ensure_to_return_pockets(NEW.id);
    RETURN NULL;
END
$$;

CREATE TRIGGER site_is_given_its_to_return_pockets
AFTER INSERT ON site
FOR EACH ROW EXECUTE FUNCTION site_is_given_its_to_return_pockets();

SELECT ensure_to_return_pockets(id) FROM site ORDER BY id;
