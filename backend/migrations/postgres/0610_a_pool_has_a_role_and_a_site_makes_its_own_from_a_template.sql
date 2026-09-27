-- 0610: a pool has a role, and a site makes its own pools from a template.
--
-- Owner's decisions of 2026-09-27 (`CONTEXT.md`, "The stock" → Pool, and
-- `unit-site-architecture.html`, "Supaya dinamis"): what a pool is FOR is
-- fixed and defined in code — receiving/pending, stockroom, floor (saleable),
-- reject, return, and the outbound stages picking, packed, shipment, loaded,
-- in-transit. Which pools EXIST is data: a site gets its pools from a template
-- for its kind when it is created, and the thirteen shops are a number the
-- data holds, not one a migration spells with `generate_series(1, 13)`.
--
-- Until now the role of a pool was read off its id. `dc.…` was the warehouse,
-- `store-….warehouse` a shop's back room, and the one CHECK that said where a
-- store's goods may stand at the Gudang compared `site_id = 'dc'`. Nothing may
-- derive meaning from an id any more; the role is a column.
--
-- # 1. Every pool says its role
--
-- Backfilled from what the rows already say about themselves — their group,
-- their pool code, their outbound stage and whether they name a store of
-- origin — never from the spelling of the id. A pool this cannot place stops
-- the migration by name: guessing what a shelf is for would be the same fault
-- this migration exists to remove.
--
-- A store's return pool at the Gudang (`dc.reject.store-07`, "Store 07") is
-- role RETURN. It was filed under REJECT because nothing else existed; the
-- owner's route is that a store's return lands in its own return pool and is
-- then inspected — good goods to the racks, damaged to reject — so the two are
-- different stages. Its group and pool code are left as they are: screens
-- still show it where they always did.
--
-- A return pool names the store UNIT whose goods it holds (`origin_unit_id`).
-- `store_origin_site_id` is kept and still read; for the thirteen shops unit
-- and site share an id (0600), and the backfill goes through `site.unit_id`
-- rather than assuming it.
--
-- # 2. Outbound stages stand at their ORIGIN
--
-- 0009 split every outbound stage into one pool per destination store:
-- `dc.outbound.packed.store-07` and twelve siblings per stage, with the stage
-- itself (`dc.outbound.packed`) left as an aggregation parent that held
-- nothing. A destination in a pool id means a new shop is a migration, and a
-- shop that sends goods — a return to the Gudang, a transfer to another shop —
-- has no shelf to send them from.
--
-- From here each ORIGIN site has one pool per stage, and the destination
-- travels on the koli and the allotment line where it belongs. At the Gudang
-- the four parents become those pools: they are already the right ids, they
-- hold nothing (0009 moved their balances to the leaves), and their places
-- exist since 0002. The per-destination leaves stay exactly as they are —
-- their movement history is immutable and names them — and are read as the
-- same stage at the same site. Nothing new is written to them.
--
-- The rollup readers (`control.rs`, `observations.rs`, `movements.rs`,
-- `queries.rs`) selected "this stage, whatever the store" through a parent that
-- was NOT a placement. They now select through the origin's stage pool, which
-- is one, and gather the legacy leaves of the same stage AT THE SAME SITE.
--
-- # 3. The template
--
-- `pool_template` is one row per pool a site of a kind gets: role, the suffix
-- the pool id is spelled with (`{site}.{suffix}`), label, whether it is
-- saleable, and where it sorts. `pool_template_per_store_unit` is the pool a
-- warehouse site of the head-office unit gets for EACH store unit: that
-- store's return pool, `{site}.return.{unit}`.
--
-- Keyed by `site.kind` as the row holds it. 0603's lane keeps HO/STORE today
-- and the premises vocabulary (OFFICE, WAREHOUSE, SHOP) is another lane's to
-- land, so both spellings are seeded: HO and WAREHOUSE get the Gudang's pools,
-- STORE and SHOP get a shop's, and an OFFICE gets none because it keeps no
-- goods. Whichever lane lands the rename finds nothing to change here.
--
-- # 4. The functions
--
-- `ensure_site_pools(site)` gives a site every pool its template names that it
-- does not already have, and — for a warehouse site of the head-office unit —
-- a return pool for every store unit. `ensure_unit_return_pools(unit)` gives a
-- new store unit its return pool at every such warehouse. Both are idempotent
-- and both are called by triggers, so creating a site or a store unit is ONE
-- insert and no migration.
--
-- "Already has" is by ROLE, not by id: the Gudang's own reject is spelled
-- `dc.reject.dc`, and a template that re-created it as `dc.reject` would give
-- one site two rejects. Receiving has two pools at a warehouse (unidentified,
-- untagged), so there the pool code tells them apart.
--
-- # What this does not do
--
-- No pool id is renamed and no movement is touched. The seeds of 0002 are
-- history and are not edited. Existing sites get only what they lack: the
-- Gudang its LOADED stage (the centre never had one), and each shop a pick area
-- and four outbound stages of its own.

-- ---------------------------------------------------------------------------
-- 1. Role and origin on every pool
-- ---------------------------------------------------------------------------

ALTER TABLE operational_pool
    ADD COLUMN role text,
    ADD COLUMN origin_unit_id text REFERENCES unit (id);

UPDATE operational_pool
   SET role = CASE
           -- The retired per-store pick leaves and their parent (0252): the
           -- pick area, as it was once spelled.
           WHEN outbound_stage = 'PICKED' THEN 'PICKING'
           WHEN outbound_stage IS NOT NULL THEN outbound_stage
           WHEN pool_code = 'PICKING' THEN 'PICKING'
           WHEN group_code = 'PENDING' THEN 'RECEIVING'
           WHEN store_origin_site_id IS NOT NULL THEN 'RETURN'
           WHEN group_code = 'REJECT' THEN 'REJECT'
           WHEN pool_code = 'FLOOR' THEN 'FLOOR'
           WHEN pool_code = 'WAREHOUSE' THEN 'STOCKROOM'
       END;

UPDATE operational_pool AS pool
   SET origin_unit_id = origin.unit_id
  FROM site AS origin
 WHERE origin.id = pool.store_origin_site_id;

DO $$
DECLARE
    unplaced text;
BEGIN
    SELECT string_agg(id, ', ' ORDER BY id) INTO unplaced
      FROM operational_pool WHERE role IS NULL;
    IF unplaced IS NOT NULL THEN
        RAISE EXCEPTION
            '0610: these pools say nothing a role can be read from: %. Give them a role by hand first.',
            unplaced;
    END IF;
    SELECT string_agg(id, ', ' ORDER BY id) INTO unplaced
      FROM operational_pool WHERE role = 'RETURN' AND origin_unit_id IS NULL;
    IF unplaced IS NOT NULL THEN
        RAISE EXCEPTION
            '0610: these return pools name a store site that belongs to no unit: %',
            unplaced;
    END IF;
END
$$;

ALTER TABLE operational_pool
    ALTER COLUMN role SET NOT NULL,
    ADD CONSTRAINT operational_pool_role_check CHECK (role IN (
        'RECEIVING', 'STOCKROOM', 'FLOOR', 'REJECT', 'RETURN',
        'PICKING', 'PACKED', 'SHIPMENT', 'LOADED', 'IN_TRANSIT'
    )),
    ADD CONSTRAINT operational_pool_return_names_its_origin
        CHECK ((role = 'RETURN') = (origin_unit_id IS NOT NULL)),
    ADD CONSTRAINT operational_pool_stage_is_its_role
        CHECK (outbound_stage IS NULL
               OR role = CASE outbound_stage WHEN 'PICKED' THEN 'PICKING' ELSE outbound_stage END);

-- 0001's rule that a store of origin may be named only by a REJECT pool at
-- the site spelled `dc`. The same rule, read from the role.
DO $$
DECLARE
    constraint_row record;
BEGIN
    FOR constraint_row IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'operational_pool'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%store_origin_site_id%'
           AND pg_get_constraintdef(oid) LIKE '%site_id = ''dc''%'
    LOOP
        EXECUTE format('ALTER TABLE operational_pool DROP CONSTRAINT %I', constraint_row.conname);
    END LOOP;
END
$$;

ALTER TABLE operational_pool
    ADD CONSTRAINT operational_pool_store_origin_is_a_return
        CHECK (store_origin_site_id IS NULL OR role = 'RETURN');

CREATE INDEX operational_pool_site_role ON operational_pool (site_id, role) WHERE active;

-- One return pool per store unit per site.
CREATE UNIQUE INDEX operational_pool_one_return_per_origin
    ON operational_pool (site_id, origin_unit_id) WHERE role = 'RETURN';

COMMENT ON COLUMN operational_pool.role IS
    'What the pool is for (0610): RECEIVING, STOCKROOM, FLOOR, REJECT, RETURN, PICKING, PACKED, SHIPMENT, LOADED or IN_TRANSIT. Fixed in code; read this, never the id.';
COMMENT ON COLUMN operational_pool.origin_unit_id IS
    'For a RETURN pool: the store unit whose returned goods it holds (0610).';

-- ---------------------------------------------------------------------------
-- 2. Outbound stages at the origin
-- ---------------------------------------------------------------------------

ALTER TABLE operational_pool DROP CONSTRAINT operational_pool_outbound_shape_check;

ALTER TABLE operational_pool
    ADD CONSTRAINT operational_pool_outbound_shape_check CHECK (
        (outbound_stage IS NULL AND destination_store_id IS NULL AND is_placement)
        OR (
            group_code = 'OUTBOUND'
            AND outbound_stage IN ('PICKED', 'PACKED', 'SHIPMENT', 'LOADED', 'IN_TRANSIT')
            AND (
                -- A retired aggregation parent (`dc.outbound.picked`).
                (NOT is_placement AND destination_store_id IS NULL)
                -- The stage at its origin, destination on the koli (0610).
                OR (is_placement AND destination_store_id IS NULL)
                -- A legacy per-destination leaf (0009): read, never written.
                OR (is_placement AND destination_store_id IS NOT NULL)
            )
        )
    );

-- 0009's index was not scoped by site: two warehouses could not both have had
-- a leaf for the same shop. Scoped now, and one stage pool per origin.
DROP INDEX operational_pool_outbound_leaf_unique;
CREATE UNIQUE INDEX operational_pool_outbound_leaf_unique
    ON operational_pool (site_id, outbound_stage, destination_store_id)
    WHERE is_placement AND destination_store_id IS NOT NULL;
CREATE UNIQUE INDEX operational_pool_one_stage_per_origin
    ON operational_pool (site_id, outbound_stage)
    WHERE is_placement AND outbound_stage IS NOT NULL AND destination_store_id IS NULL;

-- The parents become the stages. The retired PICKED parent stays retired.
UPDATE operational_pool
   SET is_placement = TRUE
 WHERE NOT is_placement
   AND active
   AND outbound_stage IN ('PACKED', 'SHIPMENT', 'LOADED', 'IN_TRANSIT')
   AND destination_store_id IS NULL;

-- Their places exist since 0002; written again in case a database was built
-- without them. Never saleable.
INSERT INTO inventory_place (id, kind, pool_id, state, is_company, is_saleable)
SELECT pool.id || ':on_hand', 'OPERATIONAL', pool.id, 'NORMAL', TRUE, FALSE
  FROM operational_pool pool
 WHERE pool.is_placement AND pool.outbound_stage IS NOT NULL AND pool.destination_store_id IS NULL
ON CONFLICT (id) DO NOTHING;
INSERT INTO inventory_place (id, kind, pool_id, state, is_company, is_saleable)
SELECT pool.id || ':missing', 'OPERATIONAL', pool.id, 'MISSING', TRUE, FALSE
  FROM operational_pool pool
 WHERE pool.is_placement AND pool.outbound_stage IS NOT NULL AND pool.destination_store_id IS NULL
ON CONFLICT (id) DO NOTHING;

COMMENT ON COLUMN operational_pool.destination_store_id IS
    'Only on a legacy per-destination outbound leaf (0009). Since 0610 an outbound stage stands at its origin and the destination travels on the koli and the allotment line.';

-- ---------------------------------------------------------------------------
-- 3. The template
-- ---------------------------------------------------------------------------

CREATE TABLE pool_template (
    -- A value `site.kind` holds. Not a foreign key: kinds are a CHECK on
    -- `site`, and rows for a kind no site has yet are harmless.
    site_kind     text NOT NULL CHECK (site_kind ~ '^[A-Z][A-Z_]*$'),
    role          text NOT NULL CHECK (role IN (
                      'RECEIVING', 'STOCKROOM', 'FLOOR', 'REJECT',
                      'PICKING', 'PACKED', 'SHIPMENT', 'LOADED', 'IN_TRANSIT'
                  )),
    -- The pool id is `{site}.{code_suffix}`. Lower-case words joined by dots,
    -- so a pool id splits on its first dot into site and role path.
    code_suffix   text NOT NULL CHECK (code_suffix ~ '^[a-z][a-z-]*(\.[a-z][a-z-]*)*$'),
    group_code    text NOT NULL CHECK (group_code IN (
                      'PENDING', 'WAREHOUSE', 'OUTBOUND', 'REJECT', 'STORE_INVENTORY'
                  )),
    pool_code     text NOT NULL CHECK (btrim(pool_code) <> ''),
    label         text NOT NULL CHECK (btrim(label) <> ''),
    saleable      boolean NOT NULL DEFAULT FALSE,
    display_order integer NOT NULL,
    PRIMARY KEY (site_kind, code_suffix),
    CHECK (NOT saleable OR role = 'FLOOR')
);

CREATE TABLE pool_template_per_store_unit (
    site_kind     text NOT NULL CHECK (site_kind ~ '^[A-Z][A-Z_]*$'),
    role          text NOT NULL CHECK (role = 'RETURN'),
    -- The pool id is `{site}.{code_prefix}.{store unit id}`.
    code_prefix   text NOT NULL CHECK (code_prefix ~ '^[a-z][a-z-]*$'),
    group_code    text NOT NULL CHECK (group_code IN ('REJECT', 'WAREHOUSE')),
    pool_code     text NOT NULL CHECK (btrim(pool_code) <> ''),
    -- Followed by the store unit's name: "Return Bumiayu".
    label_prefix  text NOT NULL CHECK (btrim(label_prefix) <> ''),
    display_order integer NOT NULL,
    PRIMARY KEY (site_kind, role)
);

INSERT INTO pool_template
    (site_kind, role, code_suffix, group_code, pool_code, label, saleable, display_order)
SELECT kinds.site_kind, t.role, t.code_suffix, t.group_code, t.pool_code, t.label, t.saleable, t.display_order
  FROM (VALUES ('HO'), ('WAREHOUSE')) AS kinds (site_kind)
 CROSS JOIN (VALUES
       ('RECEIVING',  'pending.unidentified', 'PENDING',   'UNIDENTIFIED', 'Unidentified', FALSE, 10),
       ('RECEIVING',  'pending.untagged',     'PENDING',   'UNTAGGED',     'Untagged',     FALSE, 20),
       ('STOCKROOM',  'warehouse',            'WAREHOUSE', 'WAREHOUSE',    'Warehouse',    FALSE, 30),
       ('PICKING',    'outbound.picking',     'OUTBOUND',  'PICKING',      'Pick Area',    FALSE, 40),
       ('PACKED',     'outbound.packed',      'OUTBOUND',  'PACKED',       'Packed',       FALSE, 50),
       ('SHIPMENT',   'outbound.shipment',    'OUTBOUND',  'SHIPMENT',     'Shipment',     FALSE, 60),
       ('LOADED',     'outbound.loaded',      'OUTBOUND',  'LOADED',       'Loaded',       FALSE, 70),
       ('IN_TRANSIT', 'outbound.in-transit',  'OUTBOUND',  'IN_TRANSIT',   'In Transit',   FALSE, 80),
       ('REJECT',     'reject',               'REJECT',    'REJECT',       'Reject',       FALSE, 90)
 ) AS t (role, code_suffix, group_code, pool_code, label, saleable, display_order)
UNION ALL
SELECT kinds.site_kind, t.role, t.code_suffix, t.group_code, t.pool_code, t.label, t.saleable, t.display_order
  FROM (VALUES ('STORE'), ('SHOP')) AS kinds (site_kind)
 CROSS JOIN (VALUES
       ('STOCKROOM',  'warehouse',            'STORE_INVENTORY', 'WAREHOUSE',  'Warehouse',  FALSE, 10),
       ('FLOOR',      'floor',                'STORE_INVENTORY', 'FLOOR',      'Floor',      TRUE,  20),
       ('REJECT',     'reject',               'REJECT',          'REJECT',     'Reject',     FALSE, 30),
       ('PICKING',    'outbound.picking',     'OUTBOUND',        'PICKING',    'Pick Area',  FALSE, 40),
       ('PACKED',     'outbound.packed',      'OUTBOUND',        'PACKED',     'Packed',     FALSE, 50),
       ('SHIPMENT',   'outbound.shipment',    'OUTBOUND',        'SHIPMENT',   'Shipment',   FALSE, 60),
       ('LOADED',     'outbound.loaded',      'OUTBOUND',        'LOADED',     'Loaded',     FALSE, 70),
       ('IN_TRANSIT', 'outbound.in-transit',  'OUTBOUND',        'IN_TRANSIT', 'In Transit', FALSE, 80)
 ) AS t (role, code_suffix, group_code, pool_code, label, saleable, display_order);

INSERT INTO pool_template_per_store_unit
    (site_kind, role, code_prefix, group_code, pool_code, label_prefix, display_order)
VALUES
    ('HO',        'RETURN', 'return', 'REJECT', 'STORE_REJECT', 'Return', 100),
    ('WAREHOUSE', 'RETURN', 'return', 'REJECT', 'STORE_REJECT', 'Return', 100);

COMMENT ON TABLE pool_template IS
    'The pools a site of a kind is given when it is created (0610). Roles are fixed in code; which pools exist is this data.';
COMMENT ON TABLE pool_template_per_store_unit IS
    'The pool a warehouse site of the head-office unit keeps for each store unit: that store''s return pool (0610).';

-- ---------------------------------------------------------------------------
-- 4. The functions and their triggers
-- ---------------------------------------------------------------------------

-- A site id or unit id as it may appear inside a pool id. A SHAPE check, the
-- same one `crate::ids::SiteId` applies: `.`, `:` and `/` would make a pool id
-- or a place id ambiguous. Nothing about what the id means.
CREATE FUNCTION pool_id_segment_is_well_formed(segment text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT segment ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
$$;

-- One pool and its two places. Returns 1 when it was created, 0 when a pool
-- with that id already stood there.
CREATE FUNCTION create_operational_pool(
    p_id text, p_site_id text, p_role text, p_group_code text, p_pool_code text,
    p_label text, p_saleable boolean, p_display_order integer, p_origin_unit_id text
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_stage text := CASE WHEN p_role IN ('PACKED', 'SHIPMENT', 'LOADED', 'IN_TRANSIT')
                         THEN p_role END;
    v_created integer;
BEGIN
    INSERT INTO operational_pool (
        id, site_id, group_code, pool_code, label, store_origin_site_id,
        display_order, active, is_placement, outbound_stage, destination_store_id,
        role, origin_unit_id
    )
    VALUES (
        p_id, p_site_id, p_group_code, p_pool_code, p_label, NULL,
        p_display_order, TRUE, TRUE, v_stage, NULL,
        p_role, p_origin_unit_id
    )
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_created = ROW_COUNT;

    INSERT INTO inventory_place (id, kind, pool_id, state, is_company, is_saleable)
    VALUES (p_id || ':on_hand', 'OPERATIONAL', p_id, 'NORMAL', TRUE, p_saleable),
           (p_id || ':missing', 'OPERATIONAL', p_id, 'MISSING', TRUE, FALSE)
    ON CONFLICT (id) DO NOTHING;
    RETURN v_created;
END
$$;

-- A store unit's return pool at one warehouse site. 0 when the site's kind
-- keeps no return pools, or the unit already has one there.
CREATE FUNCTION ensure_return_pool(p_site_id text, p_unit_id text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_site site%ROWTYPE;
    v_unit unit%ROWTYPE;
    v_template pool_template_per_store_unit%ROWTYPE;
BEGIN
    SELECT * INTO v_site FROM site WHERE id = p_site_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no site %', p_site_id;
    END IF;
    SELECT * INTO v_unit FROM unit WHERE id = p_unit_id;
    IF NOT FOUND OR v_unit.kind <> 'STORE' THEN
        RETURN 0;
    END IF;
    -- Only a site of the head-office unit keeps other units' returns.
    IF NOT EXISTS (SELECT 1 FROM unit WHERE id = v_site.unit_id AND kind = 'HO') THEN
        RETURN 0;
    END IF;
    SELECT * INTO v_template FROM pool_template_per_store_unit
     WHERE site_kind = v_site.kind AND role = 'RETURN';
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    IF EXISTS (SELECT 1 FROM operational_pool
                WHERE site_id = v_site.id AND role = 'RETURN' AND origin_unit_id = v_unit.id) THEN
        RETURN 0;
    END IF;
    IF NOT pool_id_segment_is_well_formed(v_unit.id) THEN
        RAISE EXCEPTION 'unit id % cannot be spelled into a pool id', v_unit.id;
    END IF;
    RETURN create_operational_pool(
        v_site.id || '.' || v_template.code_prefix || '.' || v_unit.id,
        v_site.id, 'RETURN', v_template.group_code, v_template.pool_code,
        v_template.label_prefix || ' ' || v_unit.name, FALSE,
        v_template.display_order, v_unit.id
    );
END
$$;

-- Every pool a site's template names that the site does not have, and, at a
-- warehouse of the head-office unit, a return pool per store unit. Returns how
-- many pools it created. Safe to call any number of times.
CREATE FUNCTION ensure_site_pools(p_site_id text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_site site%ROWTYPE;
    v_template pool_template%ROWTYPE;
    v_store record;
    v_created integer := 0;
BEGIN
    SELECT * INTO v_site FROM site WHERE id = p_site_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no site %', p_site_id;
    END IF;
    IF NOT pool_id_segment_is_well_formed(v_site.id) THEN
        RAISE EXCEPTION 'site id % cannot be spelled into a pool id', v_site.id;
    END IF;
    FOR v_template IN
        SELECT * FROM pool_template WHERE site_kind = v_site.kind ORDER BY display_order
    LOOP
        -- By role, not by id: see the header. A legacy per-destination leaf
        -- and a retired parent are not the stage at this site.
        IF NOT EXISTS (
            SELECT 1 FROM operational_pool existing
             WHERE existing.site_id = v_site.id
               AND existing.role = v_template.role
               AND existing.is_placement
               AND existing.destination_store_id IS NULL
               AND existing.origin_unit_id IS NULL
               AND (v_template.role <> 'RECEIVING' OR existing.pool_code = v_template.pool_code)
        ) THEN
            v_created := v_created + create_operational_pool(
                v_site.id || '.' || v_template.code_suffix,
                v_site.id, v_template.role, v_template.group_code, v_template.pool_code,
                v_template.label, v_template.saleable, v_template.display_order, NULL
            );
        END IF;
    END LOOP;
    FOR v_store IN SELECT id FROM unit WHERE kind = 'STORE' ORDER BY id LOOP
        v_created := v_created + ensure_return_pool(v_site.id, v_store.id);
    END LOOP;
    RETURN v_created;
END
$$;

-- A new store unit's return pool at every warehouse of the head-office unit.
CREATE FUNCTION ensure_unit_return_pools(p_unit_id text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_site record;
    v_created integer := 0;
BEGIN
    FOR v_site IN
        SELECT s.id FROM site s JOIN unit u ON u.id = s.unit_id
         WHERE u.kind = 'HO' ORDER BY s.id
    LOOP
        v_created := v_created + ensure_return_pool(v_site.id, p_unit_id);
    END LOOP;
    RETURN v_created;
END
$$;

CREATE FUNCTION site_is_given_its_pools() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM ensure_site_pools(NEW.id);
    RETURN NULL;
END
$$;

CREATE TRIGGER site_is_given_its_pools
AFTER INSERT ON site
FOR EACH ROW EXECUTE FUNCTION site_is_given_its_pools();

CREATE FUNCTION store_unit_is_given_its_return_pools() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.kind = 'STORE' THEN
        PERFORM ensure_unit_return_pools(NEW.id);
    END IF;
    RETURN NULL;
END
$$;

CREATE TRIGGER store_unit_is_given_its_return_pools
AFTER INSERT ON unit
FOR EACH ROW EXECUTE FUNCTION store_unit_is_given_its_return_pools();

COMMENT ON FUNCTION ensure_site_pools(text) IS
    'Give a site every pool its kind''s template names that it lacks (by role), and at a warehouse of the head-office unit a return pool per store unit. Idempotent (0610).';
COMMENT ON FUNCTION ensure_unit_return_pools(text) IS
    'Give a store unit its return pool at every warehouse of the head-office unit. Idempotent (0610).';

-- ---------------------------------------------------------------------------
-- 5. The sites that exist get what they lack
-- ---------------------------------------------------------------------------

SELECT ensure_site_pools(id) FROM site ORDER BY id;
