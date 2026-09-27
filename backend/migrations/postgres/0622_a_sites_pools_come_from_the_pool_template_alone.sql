-- A site's pools come from the pool template alone.
--
-- Two lanes each taught the database how to furnish a new site. The set-up
-- lane's 0521 kept `site_template_row`: whole `operational_pool` and
-- `inventory_place` rows copied from the first store and from head office,
-- with the ids and the name as tokens, put back by `jsonb_populate_record`.
-- The routes step's 0610 made the pools a site gets data of their own —
-- `pool_template`, one row per role a site of a kind has, and
-- `pool_template_per_store_unit` for a store's return pool at the Gudang — and
-- made furnishing the database's job: `site_is_given_its_pools` gives a new
-- site every pool its kind's template names, each with its places, and
-- `store_unit_is_given_its_return_pools` gives a new store unit its return
-- pool at every warehouse of head office.
--
-- One source, not two. The setup wizard (`postgres/setup.rs`) now inserts a
-- unit and its site and lets those triggers furnish them, so nothing reads the
-- template rows any more. Nothing could: since 0610 every pool has a `role`,
-- which no row here carries, so `jsonb_populate_record` would hand back the
-- NULL the column refuses.
--
-- # What the rows held that the pool template does not
--
-- Nothing a new site should get:
--
--   * the Gudang's per-destination outbound leaves for the store
--     (`dc.outbound.packed.store-01` and its siblings, 0009) — read for ever,
--     never written since 0610: a stage stands at its origin, and the
--     destination travels on the koli and the allotment line;
--   * the store's return pool spelled `dc.reject.store-01`, which 0610 spells
--     `{site}.return.{unit}` and ties to the store unit by `origin_unit_id`;
--   * the first Gudang's own reject spelled `dc.reject.dc` ("DC Reject"), which
--     a new warehouse gets as `{site}.reject`;
--   * the retired `outbound.picked` parent (0252).
--
-- The places were each pool's `:on_hand` and `:missing`, which
-- `create_operational_pool` (0610) writes for every pool it makes, with only
-- the floor's on-hand place saleable, exactly as the rows had it. The payment
-- methods a new shop's tills take were never template rows: the wizard writes
-- them itself (cash only, 0474).
--
-- So the table goes, and with it 0521's rule that a migration adding a NOT
-- NULL column to `operational_pool` or `inventory_place` must also rewrite
-- these rows. Such a migration now teaches `create_operational_pool` the
-- column instead.
--
-- It goes only where the pool template can furnish what the wizard makes — a
-- shop, and head office's site — so a database that lost those rows stops
-- here rather than opening sites with nowhere to put a single piece.

DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(kind, ', ' ORDER BY kind)
      INTO missing
      FROM (VALUES ('HO'), ('STORE')) AS wanted (kind)
     WHERE NOT EXISTS (SELECT 1 FROM pool_template t WHERE t.site_kind = wanted.kind);

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION
            '0622: pool_template furnishes no site of kind %, so the setup wizard '
            'could not open one once site_template_row is gone. Restore 0610''s '
            'template rows before running this.', missing;
    END IF;
END
$$;

DROP TABLE site_template_row;
