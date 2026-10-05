-- A pool's role is one vocabulary, in the data and in the code.
--
-- `flow_template_version.destination_pool_role` was seeded (0619) and checked
-- (0615) in a vocabulary of its own: `PENDING` and `WAREHOUSE` for the two
-- roles `crate::pool_role` — the list BOTH nodes use, and the one
-- `operational_pool.role` and `pool_template.role` store — spells `RECEIVING`
-- and `STOCKROOM`. A flow that said goods land in `WAREHOUSE` therefore named a
-- role no pool a site is ever given carries, and the Rust had two `PoolRole`
-- enums that disagreed about six of their values.
--
-- The code now has one enum (`crate::pool_role`), so the stored values follow
-- it: `PENDING` becomes `RECEIVING`, `WAREHOUSE` becomes `STOCKROOM`, and the
-- CHECK admits exactly the ten roles that list defines.

-- 0615 makes a version immutable — "a flow template version is never changed
-- or removed; save a new version instead" — because a template's history is
-- never rewritten. This is not a rewrite of what a version SAID: it is the
-- same role under the one spelling both nodes use, so the guard is stepped
-- over and restored, the way 0605 did for the append-only journal while it
-- moved a column from site to unit.
ALTER TABLE flow_template_version DISABLE TRIGGER USER;

UPDATE flow_template_version
   SET destination_pool_role = 'RECEIVING'
 WHERE destination_pool_role = 'PENDING';

UPDATE flow_template_version
   SET destination_pool_role = 'STOCKROOM'
 WHERE destination_pool_role = 'WAREHOUSE';

ALTER TABLE flow_template_version ENABLE TRIGGER USER;

ALTER TABLE flow_template_version
    DROP CONSTRAINT flow_template_version_destination_pool_role_check;

ALTER TABLE flow_template_version
    ADD CONSTRAINT flow_template_version_destination_pool_role_check CHECK (
        destination_pool_role IS NULL OR destination_pool_role IN (
            'RECEIVING', 'STOCKROOM', 'FLOOR', 'REJECT', 'RETURN',
            'PICKING', 'PACKED', 'SHIPMENT', 'LOADED', 'IN_TRANSIT'
        )
    );

COMMENT ON COLUMN flow_template_version.destination_pool_role IS
    'The role of the pool goods land in at our destination, from the one list both nodes share (`crate::pool_role`, the same codes as operational_pool.role and pool_template.role). NULL when the destination is an outside party (0615; one vocabulary since 0707).';

-- Which roles a site kind can have is `pool_template`'s answer (0610). This
-- says so where a reader of the seed will look, because the template table
-- carries rows for the premises vocabulary 0600 deferred as well as for the
-- two kinds `site.kind` holds today.
COMMENT ON COLUMN pool_template.site_kind IS
    'A value `site.kind` holds. Today that is HO or STORE (0353); the WAREHOUSE and SHOP rows are the premises vocabulary 0600 left to another lane, and they match nothing until `site.kind` is renamed to it. Which role a site of a kind is GIVEN is this table; which a flow template may NAME is `crate::pool_role::PoolRole::exists_at`.';
