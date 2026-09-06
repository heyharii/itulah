-- 0122: The affiliate map, for every head-office/shop pair and both columns.
--
-- # What was there, and why it could not work
--
-- `scripts/seed-finance.py` mapped `affiliate_receivable` and
-- `affiliate_payable` once each, with the qualifier `PEMBIAYAAN`, at all
-- fourteen locations — pointing every one of them at the leaf under
-- `1021401001` / `2012301001`, which is the HEAD OFFICE counterparty. At head
-- office that resolves to `102140100100`, "Piutang Affiliasi Pembiayaan HEAD
-- OFFICE to HO": head office's receivable from itself. Nothing posted to it,
-- so nothing was wrong yet; the day something did, thirteen shops would have
-- shared one account and no pair could be reconciled.
--
-- # How the client's codes actually work
--
-- The COUNTERPARTY is in the ten-digit rung, and the OWNER is the two-digit
-- suffix. Read one out loud and it is unambiguous:
--
--   102140200200   Piutang Affiliasi Atas Barang CIKUPA - HO
--                  ^^^^^^^                              ^^  owner: suffix 00 = HO
--                         ^^^                               counterparty: 002 = CIKUPA
--
--   201230200101   Hutang Affiliasi Atas Barang HEAD OFFICE - C001
--                  owner: suffix 01 = C001, counterparty: 001 = HEAD OFFICE
--
-- Those two are the same balance from both sides — head office's receivable
-- from shop 01 for goods, and shop 01's payable to head office for goods. Every
-- pair has such a couple, in each of two columns, and the client's chart
-- already carries all 784 combinations. This maps the 52 that head office and
-- its thirteen shops actually use.
--
-- The counterparty index is the shop's number plus one, because `001` is head
-- office: `1011203002 BDP Barang Dagangan CIKUPA` is the same ordering, and it
-- is the ordering `scripts/import-coa.py` assumed when it filed the leaves by
-- suffix. If that assumption is ever found to be wrong, it is wrong in one
-- place and this migration moves with it.
--
-- # Why the qualifier is `<KIND>:<counterparty>`
--
-- `account_map` is keyed on (meaning, location, qualifier). The location is the
-- owner. That leaves the qualifier to carry the two things the client's code
-- carries in its rung: which column, and with whom. `BARANG:store-01` is both,
-- in the order somebody reads them, and `domain::interunit` builds exactly that
-- string — so a leg the poster adds resolves without the poster ever naming a
-- code.
--
-- # Why this is guarded and idempotent
--
-- The chart is imported by `scripts/import-coa.py`, not by a migration, so a
-- database built from migrations alone has an empty `ledger_account`. The JOIN
-- below makes this a no-op there instead of a foreign-key failure on every test
-- database. ON CONFLICT DO UPDATE makes a re-run, and a run over a map somebody
-- has already edited by hand, land on the same rows.

-- The old single-qualifier rows go first. They point at the wrong counterparty
-- for thirteen of the fourteen locations, and leaving them would leave a
-- meaning resolvable two ways.
DELETE FROM account_map
 WHERE semantic_key IN ('affiliate_receivable', 'affiliate_payable')
   AND qualifier NOT LIKE '%:%';

WITH unit (site_id, suffix, family_index) AS (VALUES
    ('dc',       '00', '001'),   -- HEAD OFFICE
    ('store-01', '01', '002'),   -- CIKUPA
    ('store-02', '02', '003'),   -- MUARO BUNGO
    ('store-03', '03', '004'),   -- PURBALINGGA
    ('store-04', '04', '005'),   -- BUMIAYU
    ('store-05', '05', '006'),   -- JAMBI
    ('store-06', '06', '007'),   -- WIRAMODE
    ('store-07', '07', '008'),   -- BREBES
    ('store-08', '08', '009'),   -- PASURUAN
    ('store-09', '09', '010'),   -- WMJB
    ('store-10', '10', '011'),   -- WMBA
    ('store-11', '11', '012'),   -- SIPIN
    ('store-12', '12', '013'),   -- BANJARAN
    ('store-13', '13', '014')    -- WONOSOBO
),
column_family (kind, receivable, payable) AS (VALUES
    -- 1021402 PIUTANG AFFILIASI ATAS BARANG / 2012302 HUTANG AFFILIASI ATAS BARANG
    ('BARANG',     '1021402', '2012302'),
    -- 1021401 PIUTANG AFFILIASI PEMBIAYAAN / 2012301 HUTANG AFFILIASI PEMBIAYAAN
    ('PEMBIAYAAN', '1021401', '2012301')
),
pair AS (
    SELECT ho.site_id AS ho_site, ho.suffix AS ho_suffix, ho.family_index AS ho_index,
           st.site_id AS store_site, st.suffix AS store_suffix, st.family_index AS store_index,
           f.kind, f.receivable, f.payable
      FROM unit ho
      CROSS JOIN unit st
      CROSS JOIN column_family f
     WHERE ho.site_id = 'dc' AND st.site_id <> 'dc'
),
wanted AS (
    -- Head office's side: an asset, named for the shop, kept at suffix 00.
    SELECT 'affiliate_receivable'::text        AS semantic_key,
           ho_site                             AS site_id,
           kind || ':' || store_site           AS qualifier,
           receivable || store_index || ho_suffix AS account_code
      FROM pair
    UNION ALL
    -- The shop's side: a liability, named for head office, kept at its own suffix.
    SELECT 'affiliate_payable'::text,
           store_site,
           kind || ':' || ho_site,
           payable || ho_index || store_suffix
      FROM pair
)
INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, set_by, note)
SELECT w.semantic_key, w.site_id, w.qualifier, w.account_code,
       'migration 0122', 'inter-unit pair, from the client''s own affiliate families'
  FROM wanted w
  JOIN ledger_account a ON a.account_code = w.account_code AND a.is_group = false
ON CONFLICT (semantic_key, site_id, qualifier) DO UPDATE
   SET account_code = EXCLUDED.account_code,
       set_by       = EXCLUDED.set_by,
       set_at       = now(),
       note         = EXCLUDED.note;

COMMENT ON TABLE account_map IS
    'semantic_key x site x qualifier -> client account code. The only place a client account code is chosen. An unmapped key makes posting refuse, never guess. On the two affiliate meanings the site is the OWNER of the books and the qualifier is `<KIND>:<counterparty>`, which is the pair the client''s own code spells as a rung and a suffix.';
