-- 0381: the client crosswalk names the other side of every affiliate balance,
-- and says out loud which client rows cannot open as they stand.
--
-- Owner decisions of 25 Sep 2026 (A, C, E) on the client's December 2025
-- per-branch balance sheet. `ledger_account_source_code` (0348) carries the
-- client's 6,908 posting codes. The goods-in-transit matrix (1031/1032) already
-- names its counterparty; the 1,176 affiliate rows do not — 1057/1058/1059
-- (piutang) and 2028/2029/2030 (hutang; 2030 is the unit side of Lain-lain
-- since 0380) — although the client's code encodes it the same way:
--
--     12-digit client code = 10-digit natural + 2-digit owning site suffix
--                            (00 = HO, 01..13 = C001..C013)
--     digits 8-10 of the natural = the counterparty
--                            (001 = HO, 002 = CIKUPA (C001) ... 014 = WONOSOBO (C013))
--
-- e.g. 102140100605 "Piutang Affiliasi Pembiayaan JAMBI - C005": natural
-- 1021401006, route 006 = JAMBI = store-05, suffix 05 = store-05 — a unit
-- booked against itself. 201230300800 "Hutang Lain-lain Principal BREBES - HO":
-- route 008 = BREBES = store-07, owned by HO.
--
-- The route is checked below against the BDP rows (which 0348 already routed)
-- and against the counterparty's name in the client's own account name before
-- anything is written.
--
-- Outcomes per row:
--   * HO <-> unit                 counter_site_id filled; no note. The only
--                                 shape an affiliate balance may have (A).
--   * counter = own site          counter left NULL; SELF_ROUTE. HO carries
--                                 17.1B net on these (11.48B of it on "Hutang
--                                 Lain-lain Principal HEAD OFFICE - HO"); the
--                                 client has to break them down per unit
--                                 before opening.
--   * unit <-> unit               counter filled; UNIT_TO_UNIT. Forbidden (A):
--                                 re-routed via HO at opening.
--   * a unit on a company account OPENING_RECLASS (2002, 2004, 2035-2040,
--                                 2043-2048). Since 0380 neither giro nor 2030
--                                 is one.
--
-- Nothing is remapped. `opening.rs` does not read this table: the opening
-- trial-balance import takes OUR account code, site and counter site per row,
-- and whoever prepares it translates once with this crosswalk to hand. The
-- notes are that preparer's instructions; the balancer is not in that loop (an
-- opening sheet is one entry per site, balanced on its own). So the unit rows
-- on company accounts are annotated, not moved to 2028.

-- ---------------------------------------------------------------------------
-- 0. The route decoder, verified before it is used
-- ---------------------------------------------------------------------------

CREATE TEMPORARY TABLE client_route (
    route        text PRIMARY KEY,
    site_id      text NOT NULL,
    client_name  text NOT NULL
) ON COMMIT DROP;

INSERT INTO client_route (route, site_id, client_name) VALUES
    ('001', 'dc',       'HEAD OFFICE'),
    ('002', 'store-01', 'CIKUPA'),
    ('003', 'store-02', 'MUARO BUNGO'),
    ('004', 'store-03', 'PURBALINGGA'),
    ('005', 'store-04', 'BUMIAYU'),
    ('006', 'store-05', 'JAMBI'),
    ('007', 'store-06', 'WIRAMODE'),
    ('008', 'store-07', 'BREBES'),
    ('009', 'store-08', 'PASURUAN'),
    ('010', 'store-09', 'WMJB'),
    ('011', 'store-10', 'WMBA'),
    ('012', 'store-11', 'SIPIN'),
    ('013', 'store-12', 'BANJARAN'),
    ('014', 'store-13', 'WONOSOBO');

DO $$
DECLARE
    affiliate_rows  bigint;
    bdp_mismatch    bigint;
    name_mismatch   bigint;
    suffix_mismatch bigint;
    unrouted        bigint;
BEGIN
    IF EXISTS (SELECT 1 FROM client_route r
                WHERE NOT EXISTS (SELECT 1 FROM site s WHERE s.id = r.site_id)) THEN
        RAISE EXCEPTION '0381: a route names a site this estate does not have';
    END IF;

    SELECT count(*) INTO affiliate_rows
      FROM ledger_account_source_code
     WHERE source_system = 'CFS_MASTER_ACCOUNT'
       AND account_code IN ('1057', '1058', '1059', '2028', '2029', '2030');
    IF affiliate_rows <> 1176 THEN
        RAISE EXCEPTION '0381: expected 1,176 affiliate crosswalk rows (6 x 196), found %', affiliate_rows;
    END IF;

    -- Every affiliate row decodes to a known route.
    SELECT count(*) INTO unrouted
      FROM ledger_account_source_code c
     WHERE c.source_system = 'CFS_MASTER_ACCOUNT'
       AND c.account_code IN ('1057', '1058', '1059', '2028', '2029', '2030')
       AND (length(c.client_account_code) <> 12
            OR NOT EXISTS (SELECT 1 FROM client_route r
                            WHERE r.route = substr(c.client_account_code, 8, 3)));
    IF unrouted <> 0 THEN
        RAISE EXCEPTION '0381: % affiliate rows do not decode to a route', unrouted;
    END IF;

    -- The decoder reproduces the counterparty 0348 already gave the BDP matrix.
    SELECT count(*) INTO bdp_mismatch
      FROM ledger_account_source_code c
      JOIN client_route r ON r.route = substr(c.client_account_code, 8, 3)
     WHERE c.source_system = 'CFS_MASTER_ACCOUNT'
       AND c.account_code IN ('1031', '1032')
       AND c.counter_site_id IS DISTINCT FROM r.site_id;
    IF bdp_mismatch <> 0 THEN
        RAISE EXCEPTION '0381: the route decoder disagrees with 0348 on % BDP rows', bdp_mismatch;
    END IF;

    -- And it names the counterparty the client's own account name names.
    SELECT count(*) INTO name_mismatch
      FROM ledger_account_source_code c
      JOIN client_route r ON r.route = substr(c.client_account_code, 8, 3)
     WHERE c.source_system = 'CFS_MASTER_ACCOUNT'
       AND c.account_code IN ('1031', '1032', '1057', '1058', '1059', '2028', '2029', '2030')
       AND position(r.client_name IN upper(c.client_account_name)) = 0;
    IF name_mismatch <> 0 THEN
        RAISE EXCEPTION '0381: % rows name a counterparty other than their route', name_mismatch;
    END IF;

    -- The two-digit suffix is the owning site, as 0348 recorded it.
    SELECT count(*) INTO suffix_mismatch
      FROM ledger_account_source_code c
     WHERE c.source_system = 'CFS_MASTER_ACCOUNT'
       AND c.account_code IN ('1057', '1058', '1059', '2028', '2029', '2030')
       AND c.site_id IS DISTINCT FROM
           CASE right(c.client_account_code, 2)
               WHEN '00' THEN 'dc'
               ELSE 'store-' || right(c.client_account_code, 2)
           END;
    IF suffix_mismatch <> 0 THEN
        RAISE EXCEPTION '0381: % affiliate rows sit at a site other than their suffix', suffix_mismatch;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Name the other side of every affiliate row
-- ---------------------------------------------------------------------------

-- HO <-> unit and unit <-> unit: the counterparty is a fact of the client code.
UPDATE ledger_account_source_code c
   SET counter_site_id = r.site_id
  FROM client_route r
 WHERE c.source_system = 'CFS_MASTER_ACCOUNT'
   AND c.account_code IN ('1057', '1058', '1059', '2028', '2029', '2030')
   AND r.route = substr(c.client_account_code, 8, 3)
   AND r.site_id <> c.site_id
   AND c.counter_site_id IS NULL;

-- A site booked against itself: there is no other side to name.
UPDATE ledger_account_source_code c
   SET mapping_note = concat_ws('; ', c.mapping_note,
       'SELF_ROUTE: client booked this against itself; needs a per-unit breakdown from the client before opening')
  FROM client_route r
 WHERE c.source_system = 'CFS_MASTER_ACCOUNT'
   AND c.account_code IN ('1057', '1058', '1059', '2028', '2029', '2030')
   AND r.route = substr(c.client_account_code, 8, 3)
   AND r.site_id = c.site_id;

-- Unit to unit: the client's chart has the accounts; the owner forbids them.
UPDATE ledger_account_source_code c
   SET mapping_note = concat_ws('; ', c.mapping_note,
       'UNIT_TO_UNIT: forbidden; re-route via HO at opening')
 WHERE c.source_system = 'CFS_MASTER_ACCOUNT'
   AND c.account_code IN ('1057', '1058', '1059', '2028', '2029', '2030')
   AND c.site_id <> 'dc'
   AND c.counter_site_id IS NOT NULL
   AND c.counter_site_id <> 'dc';

-- ---------------------------------------------------------------------------
-- 2. Client rows at a unit on an account only head office may hold
-- ---------------------------------------------------------------------------

-- Supplier payables and the lenders (the owner's loan 2035/2043 included).
UPDATE ledger_account_source_code c
   SET mapping_note = concat_ws('; ', c.mapping_note,
       format('OPENING_RECLASS: a unit cannot hold %s %s; opening moves the balance to HO and the unit carries 2028 Hutang Afiliasi Pembiayaan (counter dc)',
              a.account_code, a.name))
  FROM ledger_account a
 WHERE a.account_code = c.account_code
   AND c.source_system = 'CFS_MASTER_ACCOUNT'
   AND c.site_id IS NOT NULL
   AND c.site_id <> 'dc'
   AND a.dimension = 'company';

COMMENT ON COLUMN ledger_account_source_code.mapping_note IS
    'Why a row maps as it does, and what opening has to do with it. Tags (0381): SELF_ROUTE (an affiliate row booked against its own site; needs a per-unit breakdown from the client), UNIT_TO_UNIT (forbidden; re-route via HO at opening), OPENING_RECLASS (a unit row on a head-office-only account; opening moves it to HO and the unit carries 2028 counter dc).';

-- ---------------------------------------------------------------------------
-- 3. What must now be true
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    unexplained    bigint;
    ho_unit        bigint;
    self_rows      bigint;
    unit_unit      bigint;
    reclass        bigint;
    reclass_codes  text;
BEGIN
    -- No affiliate row lacks a counterparty unless it says why.
    SELECT count(*) INTO unexplained
      FROM ledger_account_source_code
     WHERE source_system = 'CFS_MASTER_ACCOUNT'
       AND account_code IN ('1057', '1058', '1059', '2028', '2029', '2030')
       AND counter_site_id IS NULL
       AND mapping_note IS NULL;
    IF unexplained <> 0 THEN
        RAISE EXCEPTION '0381: % affiliate rows have no counterparty and no note', unexplained;
    END IF;

    SELECT count(*) FILTER (WHERE counter_site_id IS NOT NULL
                              AND (site_id = 'dc') <> (counter_site_id = 'dc')
                              AND mapping_note IS NULL),
           count(*) FILTER (WHERE mapping_note LIKE 'SELF_ROUTE:%' AND counter_site_id IS NULL),
           count(*) FILTER (WHERE mapping_note LIKE 'UNIT_TO_UNIT:%')
      INTO ho_unit, self_rows, unit_unit
      FROM ledger_account_source_code
     WHERE source_system = 'CFS_MASTER_ACCOUNT'
       AND account_code IN ('1057', '1058', '1059', '2028', '2029', '2030');
    -- Per account: 26 HO <-> unit, 14 self, 13 x 12 unit <-> unit; six accounts.
    IF ho_unit <> 156 OR self_rows <> 84 OR unit_unit <> 936 THEN
        RAISE EXCEPTION '0381: expected 156 HO<->unit, 84 self and 936 unit<->unit affiliate rows, got %, %, %',
            ho_unit, self_rows, unit_unit;
    END IF;

    -- The reclass set is exactly the head-office-only liabilities; neither
    -- giro nor 2030 is among them (0380).
    SELECT count(*), string_agg(DISTINCT account_code, ',' ORDER BY account_code)
      INTO reclass, reclass_codes
      FROM ledger_account_source_code
     WHERE source_system = 'CFS_MASTER_ACCOUNT'
       AND mapping_note LIKE '%OPENING_RECLASS:%';
    IF reclass_codes IS DISTINCT FROM
       '2002,2004,2035,2036,2037,2038,2039,2040,2043,2044,2045,2046,2047,2048' THEN
        RAISE EXCEPTION '0381: OPENING_RECLASS landed on an unexpected set of accounts: %', reclass_codes;
    END IF;
    IF reclass <> 182 THEN
        RAISE EXCEPTION '0381: expected 182 OPENING_RECLASS rows (14 accounts x 13 units), got %', reclass;
    END IF;
    IF EXISTS (
        SELECT 1 FROM ledger_account_source_code
         WHERE source_system = 'CFS_MASTER_ACCOUNT'
           AND account_code IN ('2005', '2006', '2007', '2008', '2009')
           AND mapping_note IS NOT NULL
    ) THEN
        RAISE EXCEPTION '0381: an outstanding-giro row is annotated; a unit may hold its own giro';
    END IF;
END;
$$;
