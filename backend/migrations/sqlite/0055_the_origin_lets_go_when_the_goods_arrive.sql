-- 0055: The origin lets go of the goods when they arrive (inventory-fleet G3).
--
-- A koli that left this site stood in its in-transit pool for ever, even after
-- the site it went to had counted it in: no movement crosses a node boundary,
-- and the two ledgers meet only in the transfer claims, which head office
-- pairs. Head office now tells this node when a pair matches
-- (`inventory.in_transit.release.v1`, one per received EPC), and the node
-- writes its own movement out of in-transit to `system/handed_over`.
--
-- One row per release, whatever came of it: RELEASED with the movement that
-- did it; NOT_IN_TRANSIT when the EPC no longer stands in transit here (it
-- was already let go, or Inventory settled it another way); NOT_HELD when
-- this node has never known the EPC. The last two are answers, not errors —
-- a release that cannot apply must not block the command stream behind it.
--
-- Creates rather than changes, so it runs on every open.

CREATE TABLE IF NOT EXISTS in_transit_release (
    release_id          TEXT PRIMARY KEY,
    command_id          TEXT NOT NULL,
    koli_id             TEXT NOT NULL,
    epc                 TEXT NOT NULL,
    destination_site_id TEXT NOT NULL,
    outcome             TEXT NOT NULL
                        CHECK (outcome IN ('RELEASED', 'NOT_IN_TRANSIT', 'NOT_HELD')),
    movement_group_id   TEXT,
    released_at         TEXT NOT NULL,
    CHECK ((outcome = 'RELEASED') = (movement_group_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS in_transit_release_by_koli
    ON in_transit_release (koli_id);
