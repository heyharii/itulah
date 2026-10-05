-- 0074: a koli is numbered by its year.
--
-- Owner's ruling, 2026-10-02: a koli number is one letter for the year and a
-- five-digit serial — `A00001`. A is 2026, B 2027 … Z 2051. The serial starts
-- again at 00001 every year, and every DC numbers its own cartons.
--
-- One row per (site, year), bumped in the same transaction that writes the
-- koli, so two cartons sealed at the same instant never share a number. The
-- old `outbound_number_counter` row for KOLI is left where it is; koli already
-- packed keep the numbers they were printed with. Creates only, so it runs on
-- every open.

CREATE TABLE IF NOT EXISTS koli_number_counter (
    site_id     TEXT NOT NULL CHECK (trim(site_id) <> ''),
    year        INTEGER NOT NULL CHECK (year BETWEEN 2026 AND 2051),
    last_serial INTEGER NOT NULL DEFAULT 0
                CHECK (last_serial BETWEEN 0 AND 99999),
    PRIMARY KEY (site_id, year)
);
