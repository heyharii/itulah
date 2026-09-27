-- A node learns its site from head office, not from the spelling of its id.
--
-- Owner's ruling, 2026-09-27: nothing derives meaning from an id. A node had
-- no `site` table, so everything it needed to know about where it stood was
-- read off its own id: `dc`/`dc-…` meant the warehouse, `store-…` a shop, the
-- number printed on a koli was `KOLI-dc-01-…`, and every day was cut at UTC+7.
--
-- Head office now sends what its `site` rows say (0603) with the auth policy
-- it already renews every twelve hours: each site's kind, display code, name,
-- IANA time zone and that zone's offset in minutes (worked out centrally — a
-- node carries no tz database). This table holds the latest copy.
--
-- `is_own` marks the site this node stands in. For a shop that is its own
-- row; for a warehouse node enrolled under an id the centre does not hold as
-- a row (`dc-01`), head office marks its own site, by the node's ROLE.
--
-- A node that has not heard yet keeps working: the readers in
-- `edge::site_profile` fall back to Asia/Jakarta's offset and to the site id,
-- which is exactly what it did before this table existed.
--
-- Creates and never alters, so it runs on every open without a probe.

CREATE TABLE IF NOT EXISTS site_directory (
    site_id            TEXT PRIMARY KEY,
    kind               TEXT NOT NULL,
    code               TEXT,
    name               TEXT NOT NULL,
    timezone           TEXT NOT NULL,
    utc_offset_minutes INTEGER NOT NULL CHECK (utc_offset_minutes BETWEEN -840 AND 840),
    is_own             INTEGER NOT NULL DEFAULT 0 CHECK (is_own IN (0, 1)),
    policy_version     INTEGER NOT NULL,
    received_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS site_directory_one_own
    ON site_directory (is_own) WHERE is_own = 1;
