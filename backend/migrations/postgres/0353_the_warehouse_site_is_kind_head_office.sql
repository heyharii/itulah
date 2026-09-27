-- The warehouse's `site` row says what the code already believes: kind `HO`.
--
-- Owner's ruling, 2026-09-13: the distribution centre is part of head office.
-- 0230 and 0236 carried that into HR geography and left `site` alone. The code
-- that came after did not wait: allotments (a TO_STORE line must be sourced at
-- the `HO` site), letters, payables, the ledger's and the statements' site
-- ordering, and the hub's warehouse filter all read `site.kind = 'HO'` for the
-- warehouse — citing 0256 as the migration that made it so. 0256 is held for
-- the full rename (`dc` → `ho`, refusing `dc` as a site id) and has not landed,
-- so on a freshly migrated database the row still said `DC`, the constraint
-- would not even admit `HO`, and every TO_STORE allotment was refused with
-- "requires an allowed non-fulfillment DC source pool".
--
-- # Only the kind, not the id
--
-- The id stays `dc`. Every node, pool (`dc.warehouse`, …), koli number and
-- demo rig spells it that way, and the edge's `SiteId` refuses `ho`. Renaming
-- it is 0256's job, with its own definitions; this is the part of that change
-- the committed code already depends on, and it is correct before and after
-- the rename.
--
-- # `DC` leaves the vocabulary
--
-- One building, one row, one kind. Leaving `DC` admissible would let the next
-- provisioned warehouse come back as `DC` and silently drop out of every query
-- above — an empty source list rather than an error. `edge_node_id` still says
-- a node syncs from here; the node's ROLE is still `DC`, and that is recorded
-- on `sync_origin_credential`, not here.

ALTER TABLE site DROP CONSTRAINT site_kind_check;

UPDATE site SET kind = 'HO' WHERE kind = 'DC';

ALTER TABLE site
    ADD CONSTRAINT site_kind_check CHECK (kind IN ('HO', 'STORE'));
