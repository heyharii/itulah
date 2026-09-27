-- 0380: giro follows the bank account; the unit side of every affiliate family
-- is the hutang account and head office's is the piutang account (2030 joins as
-- the unit side of Lain-lain); 1110 Disposed Inventory reopens for the client's
-- opening balances; 3004 Prive is Finance HO's to post.
--
-- Owner decisions, 25 Sep 2026, on the client's December 2025 per-branch
-- balance sheet. Changes to the chart and the map; the crosswalk follows in
-- 0381.
--
-- ── B. An outstanding giro follows the bank account it is drawn on ──────────
--
-- Eleven of the thirteen stores have giro bank accounts of their own
-- (1005-1009), and nine of them carry outstanding giro against those accounts
-- (2005 BCA, 2006 Mandiri, 2008 BNI; about 3.1B together). 0376 put 2005-2009
-- in `external_party_account` and made them `company`, which says a store's own
-- giro is head office's debt. It is not: the instrument is drawn on the store's
-- bank account and clears against it (giro_clear: Dr 2005 / Cr 1005 at the
-- giro's own site). So 2005-2009 leave the registry and go back to
-- `dimension = 'unit'` (what 0348 seeded). 2032 Giro Keluar stays retired.
--
-- A supplier's payable is still head office's alone (2002/2004 stay in the
-- registry and stay `company`). When a store's giro pays a supplier, the
-- payable is cleared at HO and the store's credit is on its own 2005; the
-- poster's balancer closes both books on the Pembiayaan pair (PAYMENT is a
-- financing source): unit Dr 2028 / Cr 2005, HO Dr 2002 / Cr 1057. The store
-- never sees 2002/2004.
--
-- ── C. 2030 Hutang Lain-lain Principal is the unit side of Lain-lain ────────
--
-- The client master pairs the affiliate families: Piutang Pembiayaan (1057) /
-- Hutang Pembiayaan (2028), Piutang Atas Barang (1058) / Hutang Atas Barang
-- (2029), Piutang Lain-lain (1059) / Hutang Lain-lain Principal (2030). There
-- is no "Piutang Afiliasi Principal". Until now Lain-lain used 1059 on both
-- sides and 2030 sat in the registry as an owner/lender liability at HO.
--
-- ── A. The unit side is always hutang, head office's always piutang ────────
--
-- Owner decision (following the client's own books), for all three families:
-- PEMBIAYAAN unit 2028 / HO 1057, BARANG unit 2029 / HO 1058, LAIN unit 2030 /
-- HO 1059, whichever way value moved; a balance may go negative. Until now the
-- balancer's leg followed "the side that gave value books the Piutang", so a
-- store remittance put 1057 in the store and 2028 at HO. The balancer and every
-- writer name the MEANINGS `affiliate_payable` / `affiliate_receivable`, never
-- a code, so the convention is made here, in the map: at every unit both
-- meanings resolve to the family's hutang account, at dc both resolve to its
-- piutang account. Consequences: store remittance is store Dr 2028 / Cr 1002,
-- HO Dr bank / Cr 1057; a goods return unit -> HO is store Dr 2029 / Cr
-- inventory, HO Dr inventory / Cr 1058.
--
--   * 2030: `dimension = 'unit'`, `requires_counter_site = true`, out of the
--     registry, and added to `ledger_account_counterparty_is_rare`.
--   * `principal_payable` -> 2030 (0375) is removed: nothing writes it, and a
--     meaning on 2030 with no counterparty is exactly what this refuses.
--   * 2031 Hutang Lain-lain stays the generic other payable (leasing, claims).
--
-- ── 3004 Prive is Finance HO's ─────────────────────────────────────────────
--
-- Owner decision: Finance HO may post to every account of every store; a store
-- has no manual-journal access at all (the HTTP layer refuses a shop role). The
-- owner taking cash at a store is an HO manual journal on the store's books:
-- Dr 3004 Prive / Cr 1002. 3004 is reached only by the hand-keyed kinds, the
-- opening import, and EQUITY_MOVEMENT (the principal document, Admin-only).
--
-- ── 1110 Disposed Inventory reopens, manual-only ───────────────────────────
--
-- 0377 retired it. The client carries 2.73B on it across twelve stores, so
-- opening balances need it. It reopens as a unit account that only a Finance
-- HO hand-keyed journal (MANUAL / RECLASS / ADJUSTMENT / WRITE_OFF, I2) and
-- the opening import may reach; no meaning maps to it, so no posting rule can.
-- What it contains, its valuation basis and how it clears are TO_CONFIRM.
--
-- What keys off these facts, checked for this change:
--   * `journal_line_external_party_is_head_office` (0376) reads the registry.
--   * `ledger.rs` refuses a `company` account at a shop, a
--     `requires_counter_site` line without a counter, and a source kind that
--     `account_source_rule` does not ALLOW.
--   * `company_banks::banking_readiness` reads `dimension` only for the bank
--     meanings, not giro.
--   * `finance_control` INTERUNIT_NETS sums every account an affiliate meaning
--     maps to, so 2030 joins that check by the map change below.
--   * `account_map` already maps `giro_outstanding` per bank at all fourteen
--     sites (0371).

-- DDL first: `ledger_account` refuses ALTER TABLE once this transaction has
-- pending trigger events, and the DML below queues some.
-- 2030 joins the accounts that must name the unit on the other side (C).
ALTER TABLE ledger_account DROP CONSTRAINT IF EXISTS ledger_account_counterparty_is_rare;
ALTER TABLE ledger_account ADD CONSTRAINT ledger_account_counterparty_is_rare
    CHECK (requires_counter_site = FALSE OR account_code IN (
        '1302', '1501', '1031', '1032', '1057', '1058', '1059', '2028', '2029', '2030',
        '1011203001', '1011204001', '1021401001', '1021402001', '1021403001',
        '2012301001', '2012302001'
    ));

-- ---------------------------------------------------------------------------
-- B. Giro follows the bank account
-- ---------------------------------------------------------------------------

DELETE FROM external_party_account
 WHERE account_code IN ('2005', '2006', '2007', '2008', '2009');

UPDATE ledger_account
   SET dimension = 'unit'
 WHERE account_code IN ('2005', '2006', '2007', '2008', '2009')
   AND dimension IS DISTINCT FROM 'unit';

-- ---------------------------------------------------------------------------
-- C. 2030 is the unit side of Lain-lain
-- ---------------------------------------------------------------------------

DELETE FROM external_party_account WHERE account_code = '2030';

-- Nothing writes it; a meaning pointing at 2030 without a counterparty would
-- be refused at posting anyway.
DELETE FROM account_map WHERE semantic_key = 'principal_payable';

UPDATE ledger_account
   SET dimension = 'unit',
       requires_counter_site = TRUE
 WHERE account_code = '2030';

-- ---------------------------------------------------------------------------
-- A. Every family: hutang at the unit, piutang at head office
-- ---------------------------------------------------------------------------

UPDATE account_map
   SET account_code = CASE split_part(qualifier, ':', 1)
                          WHEN 'PEMBIAYAAN' THEN CASE WHEN site_id = 'dc' THEN '1057' ELSE '2028' END
                          WHEN 'BARANG'     THEN CASE WHEN site_id = 'dc' THEN '1058' ELSE '2029' END
                          WHEN 'LAIN'       THEN CASE WHEN site_id = 'dc' THEN '1059' ELSE '2030' END
                      END,
       category_code = NULL,
       set_by = 'migration:0380',
       set_at = now(),
       note = 'Owner 25 Sep: the unit side of an affiliate family is always its hutang account (2028/2029/2030) and head office''s always its piutang account (1057/1058/1059), whichever way value moved; a balance may go negative.'
 WHERE semantic_key IN ('affiliate_payable', 'affiliate_receivable')
   AND split_part(qualifier, ':', 1) IN ('PEMBIAYAAN', 'BARANG', 'LAIN');

-- ---------------------------------------------------------------------------
-- 3004 Prive: Finance HO's to post
-- ---------------------------------------------------------------------------

INSERT INTO account_source_rule (account_code, source_kind, effect, set_by, note)
SELECT v.account_code, v.source_kind, 'ALLOW', 'migration:0380', v.note
  FROM (VALUES
    ('3004', 'MANUAL',          'Prive: a Finance HO journal, at any site (owner 25 Sep).'),
    ('3004', 'RECLASS',         'Prive: a Finance HO reclass.'),
    ('3004', 'ADJUSTMENT',      'Prive: a Finance HO adjustment.'),
    ('3004', 'EQUITY_MOVEMENT', 'Prive: the principal document (Admin only).'),
    ('3004', 'OPENING',         'Opening balances are history arriving.')
  ) AS v (account_code, source_kind, note)
 WHERE NOT EXISTS (
     SELECT 1 FROM account_source_rule r
      WHERE r.account_code = v.account_code
        AND r.source_kind = v.source_kind
        AND COALESCE(r.category_code, '') = ''
 );

-- ---------------------------------------------------------------------------
-- 1110 Disposed Inventory: reopened, manual-only
-- ---------------------------------------------------------------------------

UPDATE ledger_account
   SET is_active = TRUE,
       dimension = 'unit',
       posting_mode = 'MANUAL',
       manual_je_policy = 'YES',
       posting_policy_configured = TRUE
 WHERE account_code = '1110';

-- A set of ALLOW rows means "these and nothing else" (0261): the hand-keyed
-- kinds only Finance HO writes (I2), and the opening import.
INSERT INTO account_source_rule (account_code, source_kind, effect, set_by, note)
SELECT v.account_code, v.source_kind, 'ALLOW', 'migration:0380', v.note
  FROM (VALUES
    ('1110', 'MANUAL',     'Disposed Inventory: a Finance HO journal only; no automatic writer yet.'),
    ('1110', 'RECLASS',    'Disposed Inventory: a Finance HO reclass.'),
    ('1110', 'ADJUSTMENT', 'Disposed Inventory: a Finance HO adjustment.'),
    ('1110', 'WRITE_OFF',  'Disposed Inventory: cleared by a Finance HO write-off.'),
    ('1110', 'OPENING',    'Opening balances are history arriving (client carries 2.73B across 12 stores).')
  ) AS v (account_code, source_kind, note)
 WHERE NOT EXISTS (
     SELECT 1 FROM account_source_rule r
      WHERE r.account_code = v.account_code
        AND r.source_kind = v.source_kind
        AND COALESCE(r.category_code, '') = ''
 );

COMMENT ON TABLE external_party_account IS
    'Accounts whose only accounting counterparty is head office: supplier and vendor payables (2002/2004) and lenders, the owner''s loan included (2035-2040, 2043-2048). A journal line on one of these may only sit at dc; a shop reaches the same economic result through the affiliate accounts (1057/2028 Pembiayaan, 1058/2029 Atas Barang, 1059/2030 Lain-lain). Not here since 0380: outstanding giro 2005-2009 (a giro follows the bank account it is drawn on) and 2030 (the unit side of Lain-lain). Tax payables 2011-2015 are not here either: the client keeps them per unit. Read by the trigger journal_line_external_party_is_head_office.';

-- ---------------------------------------------------------------------------
-- What must now be true
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM external_party_account
         WHERE account_code IN ('2005', '2006', '2007', '2008', '2009', '2030')
    ) THEN
        RAISE EXCEPTION '0380: giro or 2030 is still registered as head office''s alone';
    END IF;
    IF EXISTS (
        SELECT 1 FROM ledger_account
         WHERE account_code IN ('2005', '2006', '2007', '2008', '2009', '2030', '1110')
           AND (dimension IS DISTINCT FROM 'unit' OR NOT is_active OR is_group)
    ) THEN
        RAISE EXCEPTION '0380: giro, 2030 or 1110 is not an active unit leaf';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ledger_account
                    WHERE account_code = '2030' AND requires_counter_site) THEN
        RAISE EXCEPTION '0380: 2030 must name the unit on the other side';
    END IF;
    -- Supplier and lenders are untouched.
    IF (SELECT count(*) FROM external_party_account
         WHERE account_code IN ('2002', '2004',
                                '2035', '2036', '2037', '2038', '2039', '2040',
                                '2043', '2044', '2045', '2046', '2047', '2048')) <> 14 THEN
        RAISE EXCEPTION '0380: the supplier/lender registry lost a row';
    END IF;
    IF EXISTS (
        SELECT 1 FROM external_party_account e
          JOIN ledger_account a USING (account_code)
         WHERE a.dimension IS DISTINCT FROM 'company'
    ) THEN
        RAISE EXCEPTION '0380: a registered external-party account is not company-dimension';
    END IF;
    IF EXISTS (SELECT 1 FROM ledger_account WHERE account_code = '2032' AND is_active) THEN
        RAISE EXCEPTION '0380: 2032 Giro Keluar must stay retired';
    END IF;

    -- Every affiliate row: piutang at HO, hutang at a unit, per family.
    IF EXISTS (
        SELECT 1 FROM account_map
         WHERE semantic_key IN ('affiliate_payable', 'affiliate_receivable')
           AND account_code IS DISTINCT FROM
               CASE split_part(qualifier, ':', 1)
                   WHEN 'PEMBIAYAAN' THEN CASE WHEN site_id = 'dc' THEN '1057' ELSE '2028' END
                   WHEN 'BARANG'     THEN CASE WHEN site_id = 'dc' THEN '1058' ELSE '2029' END
                   WHEN 'LAIN'       THEN CASE WHEN site_id = 'dc' THEN '1059' ELSE '2030' END
               END
    ) THEN
        RAISE EXCEPTION '0380: an affiliate map row is not piutang at HO / hutang at the unit';
    END IF;
    -- And nothing else maps to an affiliate account.
    IF EXISTS (
        SELECT 1 FROM account_map
         WHERE account_code IN ('1057', '1058', '1059', '2028', '2029', '2030')
           AND semantic_key NOT IN ('affiliate_payable', 'affiliate_receivable')
    ) THEN
        RAISE EXCEPTION '0380: a meaning other than the affiliate pair maps to an affiliate account';
    END IF;

    -- 1110: no meaning maps to it, so no posting rule can reach it.
    IF EXISTS (SELECT 1 FROM account_map WHERE account_code = '1110') THEN
        RAISE EXCEPTION '0380: a meaning maps to 1110 Disposed Inventory; it is manual-only';
    END IF;

    IF EXISTS (
        SELECT 1 FROM account_map m JOIN ledger_account a USING (account_code)
         WHERE NOT a.is_active OR a.is_group
    ) THEN
        RAISE EXCEPTION '0380: a map row points at a retired or heading account';
    END IF;
END;
$$;
