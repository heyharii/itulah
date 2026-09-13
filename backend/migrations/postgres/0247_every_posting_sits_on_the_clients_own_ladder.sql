-- 0247: Every posting sits on the client's own ladder again.
--
-- # What was wrong
--
-- CENTRAL FASHION STORE's chart climbs a ladder of five rungs and never skips
-- one: 1 digit for the class, 3 for the section, 5 for the group, 7 for the
-- family, 10 for the account (12 in the imported file, where the last two were
-- the unit 0243 took off). All 7,528 of their accounts are on it. It has 76
-- seven-digit families alone.
--
-- `docs/fixtures/coa-final.json` — the 219-account chart 0243 loads — kept 44
-- groups and only five of those families, and it dropped the rest UNEVENLY.
-- Under `10113 Biaya Dibayar Dimuka`, two of the three siblings kept their rung
-- (`1011302 Pajak Dibayar Dimuka`, `1011303 Uang Muka`) and one did not: the
-- six `1011301*` prepayments were re-parented straight onto `10113`.
--
-- That is not a tidier chart, it is a chart with two shapes. Counted on the
-- collapsed chart, only 24 of the 175 postings sat where the client would put
-- them:
--
--     child -> parent    rows
--       3 -> 1              7   on the ladder
--       5 -> 1             10   skips the 3-digit rung
--       5 -> 3             14   on the ladder
--       7 -> 5              5   on the ladder
--      10 -> 1              5   skips three rungs
--      10 -> 3             13   skips two
--      10 -> 5            133   skips one
--      10 -> 7             24   on the ladder
--
-- It was found by running the app rather than by reading the chart. Two
-- screens died — `not found: account 1011301` on Prepaids and `not found:
-- account 1011101` on Receivables — because each reads a family at its group
-- code, which is how the client's chart is meant to be read. Two parents were
-- left holding both groups and postings (`10110`, `10113`), which the client's
-- chart never does anywhere.
--
-- # What this migration does
--
-- Creates the 79 missing rungs — 7 at three digits, 8 at five, 64 at seven —
-- and re-parents every account onto the longest group code that is a prefix of
-- it. The chart becomes 123 groups over 175 postings, 298 rows: still 25x
-- smaller than the client's 7,528, and now the same SHAPE as theirs.
--
--     rung   before   after
--        1        8       8
--        3        7      14
--        5       24      32
--        7        5      69
--
-- # Where the names come from
--
-- From the client's own chart, not from us. Three rules, in order:
--
--   1. The client has a row at that code: take their name. Theirs SHOUT
--      (`PIUTANG DAGANG`); the collapsed chart is in title case (`Piutang`,
--      `Biaya Dibayar Dimuka`), so the CASE is changed to match the chart this
--      rung is joining and NOTHING ELSE is — same words, same punctuation,
--      same spelling, including `Akumulasi Penyusu -Tanah` and `AFFILIASI`,
--      which are theirs. `dan`, `atau`, `di`, `and`, `on` stay lowercase and
--      `LAIN - LAIN` is written `Lain-lain`, both as the collapsed chart
--      already writes them. Nothing is translated: `name_en` is left NULL on
--      all 79, because an English name for a rung would be OURS, and this
--      migration's whole point is that the ladder is the client's.
--
--   2. The code was minted by 0243/0244 and the client files the same accounts
--      under a code of their own: take the name from THERE. Five rungs —
--      `1021508` from `1031803 Contract In Progress (CIP)`, `2012401` from
--      `205001 Uang Muka - Penjualan`, `7010310` from `70103 BIAYA USAHA
--      LAINNYA`, and `40202`/`4020210` from `80101`/`8010110 PENDAPATAN DAN
--      (BIAYA) LAIN - LAIN`, which is where the client keeps bank interest and
--      rent received.
--
--   3. Nothing in the client's chart corresponds, because the account is ours:
--      one rung, `1011005`, which exists to hold `1011005001 Setoran Dalam
--      Perjalanan` that 0244 minted at zero. It takes that account's name,
--      because inventing a different one would be a second authority.
--
-- Two consequences worth saying out loud rather than quietly smoothing:
--
--   * A rung often repeats its parent's name — `70103 Beban Usaha Lainnya`
--     over `7010310 Biaya Usaha Lainnya`, `20121 Hutang Pajak` over `2012101
--     Hutang Pajak`. That is the client's chart. Where a group has exactly one
--     family they spell it twice, and 0243 had in several places lifted the
--     dropped family's name up onto the group.
--   * Two rungs now hold more than their name says, because 0244 folded
--     families together: `1021401 Piutang Affiliasi Pembiayaan` also holds
--     what the client kept at 1021402/1021403 and 2012301/2012302/2012304, and
--     `6010210 Beban Pegawai Office` also holds the shop-floor payroll the
--     client kept at `6010111 BIAYA PEGAWAI OPERATION`. The code is the
--     client's and so is the name on it; `ledger_account_remap` is where the
--     fold is recorded, and renaming a rung to paper over it would hide it.
--
-- # Why it is derived rather than listed
--
-- The rungs to create are computed from the accounts that are actually there,
-- not from a list of 79 codes. Another lane is adding posting accounts in 0248
-- and 0249; a fixed list would either miss their rung or refuse their account.
-- What is listed is only the NAMES, and a required rung with no name in the
-- table below stops the migration with the code in the message rather than
-- being given one we made up.
--
-- # Nothing moves
--
-- Not one `journal_line` is touched: only `ledger_account.parent_code` changes
-- and 79 group rows appear. The trial balance per account and per site is
-- snapshotted before and compared after, in this transaction, so the promise
-- is enforced rather than hoped for — the same acceptance test 0244 had to
-- pass, and `scripts/verify-coa-collapse.py` is its longer form.
--
-- # Re-running it
--
-- Idempotent. The inserts conflict away and the re-parent sets what is already
-- set, so a second application is a no-op that still checks every invariant.

-- ---------------------------------------------------------------------------
-- Step zero: the trial balance, before
-- ---------------------------------------------------------------------------

CREATE TEMPORARY TABLE coa_ladder_before ON COMMIT DROP AS
SELECT account_code, site_id,
       sum(debit_minor) AS debit_minor, sum(credit_minor) AS credit_minor
  FROM journal_line
 GROUP BY 1, 2;

-- A posting that is not ten digits has no place on this ladder, and guessing
-- one would be worse than stopping. Nothing in the chart is like that today.
DO $$
DECLARE bad text;
BEGIN
    SELECT string_agg(account_code, ', ' ORDER BY account_code) INTO bad
      FROM ledger_account WHERE NOT is_group AND length(account_code) <> 10;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'these posting accounts are not ten digits and the ladder cannot place them: %', bad;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Step one: the client's names for the rungs
-- ---------------------------------------------------------------------------
--
-- Read out of the client's own export — `~/Downloads/Laporan_Master_Account1.csv`,
-- the same file `scripts/import-coa.py` loaded — and title-cased as described
-- above. The codes marked `minted` are ours; the NAME on them is still theirs,
-- taken from the code they file the same accounts under.

CREATE TEMPORARY TABLE coa_rung_name (
    account_code text PRIMARY KEY,
    name         text NOT NULL
) ON COMMIT DROP;

INSERT INTO coa_rung_name (account_code, name) VALUES
  ('301', 'Modal'),
  ('501', 'Harga Pokok Pembelian'),
  ('601', 'Biaya / Beban Usaha'),
  ('701', 'Beban Usaha Lainnya'),
  ('801', 'Pendapatan dan (Biaya) Lain-lain'),
  ('802', 'Biaya Bunga'),
  ('803', 'Pajak Penghasilan'),
  ('10318', 'Other Asset'),
  ('20224', 'Pinjaman Jangka Panjang'),
  ('30130', 'Modal'),
  ('40101', 'Penjualan'),
  ('40102', 'Discount / Potongan dan Return Penjualan'),
  ('40201', 'Management Fee'),
  ('40202', 'Pendapatan dan (Biaya) Lain-lain'),   -- minted by 0243/0244; see the note above
  ('50101', 'Harga Pokok Pembelian'),
  ('1011001', 'Cash on Hand'),
  ('1011005', 'Setoran Dalam Perjalanan'),   -- minted by 0243/0244; see the note above
  ('1011101', 'Piutang Dagang'),
  ('1011102', 'Piutang Lain-lain'),
  ('1011103', 'Cadangan Penghapusan Piutang Tak Tertagih'),
  ('1011201', 'Persediaan Barang Dagang'),
  ('1011202', 'Persediaan Kantong Belanja'),
  ('1011203', 'Barang Dalam Perjalanan Barang Dagangan'),
  ('1011204', 'Barang Dalam Perjalanan Kantong Belanja'),
  ('1011299', 'Cadangan Kerusakan atau kehilangan Barang'),
  ('1011301', 'Biaya Dibayar Dimuka'),
  ('1021401', 'Piutang Affiliasi Pembiayaan'),
  ('1021501', 'Tanah'),
  ('1021502', 'Bangunan'),
  ('1021503', 'Instalasi'),
  ('1021504', 'Machineries'),
  ('1021505', 'Kendaraan'),
  ('1021506', 'Furniture, Fixture & Equipment'),
  ('1021507', 'Operating Equipment'),
  ('1021508', 'Contract In Progress (CIP)'),   -- minted by 0243/0244; see the note above
  ('1021601', 'Akumulasi Penyusu -Tanah'),
  ('1021602', 'Akum-Penyusu - Bangunan'),
  ('1021603', 'Akum-Penyusu - Instalasi'),
  ('1021604', 'Akum-Penyusu - Mesin'),
  ('1021605', 'Akum-Penyusu Kendaraan'),
  ('1021606', 'Akum-Penyusu - FFE'),
  ('1021607', 'Reserve Replacement - Operating Equipment'),
  ('1021701', 'Software'),
  ('1021702', 'Acc Amort Software'),
  ('1031801', 'Disposed Inventory'),
  ('1031802', 'Pre Opening'),
  ('2012001', 'Hutang Supplier'),
  ('2012002', 'Outstanding Giro'),
  ('2012101', 'Hutang Pajak'),
  ('2012201', 'Accrued Expense (Biaya Yang Masih Harus Dibayar)'),
  ('2012303', 'Hutang Lain-lain Principal'),
  ('2012401', 'Uang Muka - Penjualan'),   -- minted by 0243/0244; see the note above
  ('2012501', 'PJP Jatuh Tempo - Principal'),
  ('2012502', 'PJP Jatuh Tempo - Bank'),
  ('2022401', 'Pinjaman Jangka Panjang Principal'),
  ('2022402', 'Pinjaman Jangka Panjang Bank'),
  ('3013001', 'Modal'),
  ('4010110', 'Penjualan Tunai'),
  ('4010213', 'Discount / Potongan Penjualan'),
  ('4010214', 'Retur Penjualan'),
  ('4020110', 'Management Fee'),
  ('4020210', 'Pendapatan dan (Biaya) Lain-lain'),   -- minted by 0243/0244; see the note above
  ('5010110', 'Harga Pokok Pembelian'),
  ('6010110', 'Biaya Penjualan'),
  ('6010210', 'Beban Pegawai Office'),
  ('6010310', 'Biaya Administrasi dan Umum'),
  ('6010410', 'Biaya Perawatan dan Pemeliharaan'),
  ('7010110', 'Biaya Sewa'),
  ('7010210', 'Biaya Depresiasi Bangunan'),
  ('7010211', 'Biaya Depresiasi Instalasi, Mekanikal, Elektrikal'),
  ('7010212', 'Biaya Depresiasi Mesin'),
  ('7010213', 'Biaya Depresiasi Kendaraan'),
  ('7010214', 'Biaya Depresiasi FFE'),
  ('7010215', 'Biaya Replacement Operating Equipment'),
  ('7010216', 'Biaya Amortisasi Intangible Asset and Other Asset'),
  ('7010310', 'Biaya Usaha Lainnya'),   -- minted by 0243/0244; see the note above
  ('8010110', 'Pendapatan dan (Biaya) Lain-lain'),
  ('8020111', 'Biaya Bunga'),
  ('8030112', 'Pajak Penghasilan');

-- ---------------------------------------------------------------------------
-- Step two: what the ladder requires
-- ---------------------------------------------------------------------------
--
-- Every 1, 3, 5 and 7 digit prefix of every posting account. Derived, so an
-- account another migration adds gets its rung from the same rule.

CREATE TEMPORARY TABLE coa_rung_required ON COMMIT DROP AS
SELECT DISTINCT left(a.account_code, n.len) AS account_code
  FROM ledger_account a
  CROSS JOIN (VALUES (1), (3), (5), (7)) AS n(len)
 WHERE NOT a.is_group;

DO $$
DECLARE unnamed text;
BEGIN
    SELECT string_agg(r.account_code, ', ' ORDER BY r.account_code) INTO unnamed
      FROM coa_rung_required r
      LEFT JOIN ledger_account a  ON a.account_code  = r.account_code
      LEFT JOIN coa_rung_name  nm ON nm.account_code = r.account_code
     WHERE a.account_code IS NULL AND nm.account_code IS NULL;
    IF unnamed IS NOT NULL THEN
        RAISE EXCEPTION
            'the ladder needs rungs this migration has no client name for: %. Read them out of the client chart and add them to coa_rung_name; do not let one be invented.',
            unnamed;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Step three: create the missing rungs
-- ---------------------------------------------------------------------------
--
-- `parent_code` is left NULL here and set for the whole chart in step four, so
-- that a rung and its own rung go in whatever order they come.

INSERT INTO ledger_account
    (account_code, name, name_en, parent_code, is_group,
     dimension, requires_counterparty, normal_balance, is_contra,
     is_active, site_id, counterparty_site_id)
SELECT r.account_code, nm.name, NULL, NULL, true,
       NULL, false, NULL, false,
       true, NULL, NULL
  FROM coa_rung_required r
  JOIN coa_rung_name nm ON nm.account_code = r.account_code
    ON CONFLICT (account_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Step four: put every account on the rung below it
-- ---------------------------------------------------------------------------
--
-- The parent is the LONGEST group code that is a strict prefix — which is the
-- ladder, now that every rung of it exists. This moves the 151 misparented
-- postings and also the groups that were hanging too high: `60101` off `6`
-- onto `601`, `40101` off `401`. Codes are digits, so `LIKE` has no
-- metacharacter to meet.

WITH ladder AS (
    SELECT a.account_code,
           (SELECT g.account_code
              FROM ledger_account g
             WHERE g.is_group
               AND length(g.account_code) < length(a.account_code)
               AND a.account_code LIKE g.account_code || '%'
             ORDER BY length(g.account_code) DESC
             LIMIT 1) AS rung
      FROM ledger_account a
     WHERE length(a.account_code) > 1)
UPDATE ledger_account a
   SET parent_code = l.rung
  FROM ladder l
 WHERE l.account_code = a.account_code
   AND a.parent_code IS DISTINCT FROM l.rung;

-- ---------------------------------------------------------------------------
-- Step five: the invariants, asserted
-- ---------------------------------------------------------------------------
--
-- Five statements about the chart that were true of the client's and have to
-- be true of ours. They are checked here rather than in a script because a
-- chart that drifts off the ladder again should not be able to commit.

DO $$
DECLARE n bigint; bad text;
BEGIN
    -- 1. Every posting hangs off a seven-digit family.
    SELECT string_agg(account_code || ' -> ' || coalesce(parent_code, 'nothing'), ', '
                      ORDER BY account_code) INTO bad
      FROM ledger_account
     WHERE NOT is_group AND (parent_code IS NULL OR length(parent_code) <> 7);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'these postings do not hang off a seven-digit family: %', bad;
    END IF;

    -- 2. No rung is skipped, anywhere: 7 under 5, 5 under 3, 3 under 1, and a
    --    one-digit class under nothing.
    SELECT string_agg(account_code || ' -> ' || coalesce(parent_code, 'nothing'), ', '
                      ORDER BY account_code) INTO bad
      FROM ledger_account
     WHERE is_group
       AND CASE length(account_code)
               WHEN 1 THEN parent_code IS NOT NULL
               WHEN 3 THEN parent_code IS NULL OR length(parent_code) <> 1
               WHEN 5 THEN parent_code IS NULL OR length(parent_code) <> 3
               WHEN 7 THEN parent_code IS NULL OR length(parent_code) <> 5
               ELSE true
           END;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'these groups skip a rung of the ladder: %', bad;
    END IF;

    -- 3. No parent holds both groups and postings. This is the one the app
    --    met: a screen reading a family at its group code got a group that
    --    was half a family and half a list.
    SELECT string_agg(parent_code, ', ' ORDER BY parent_code) INTO bad
      FROM ledger_account
     WHERE parent_code IS NOT NULL
     GROUP BY parent_code
    HAVING count(*) FILTER (WHERE is_group) > 0
       AND count(*) FILTER (WHERE NOT is_group) > 0;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'these parents hold both groups and postings: %', bad;
    END IF;

    -- 4. No rung was created and left empty. An empty group is a new kind of
    --    disorder, not an improvement on the old one.
    SELECT string_agg(g.account_code, ', ' ORDER BY g.account_code) INTO bad
      FROM ledger_account g
     WHERE g.is_group
       AND NOT EXISTS (SELECT 1 FROM ledger_account c WHERE c.parent_code = g.account_code);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'these groups have no children: %', bad;
    END IF;

    -- 5. Not one rupiah moved. A chart repair that moves money is wrong even
    --    if the chart comes out beautiful.
    -- Parenthesised: EXCEPT and UNION bind equally and left to right, so
    -- without them this would ask a different and much weaker question.
    SELECT count(*) INTO n FROM (
        (SELECT account_code, site_id, sum(debit_minor), sum(credit_minor)
           FROM journal_line GROUP BY 1, 2
         EXCEPT ALL
         SELECT account_code, site_id, debit_minor, credit_minor
           FROM coa_ladder_before)
        UNION ALL
        (SELECT account_code, site_id, debit_minor, credit_minor
           FROM coa_ladder_before
         EXCEPT ALL
         SELECT account_code, site_id, sum(debit_minor), sum(credit_minor)
           FROM journal_line GROUP BY 1, 2)) drift;
    IF n <> 0 THEN
        RAISE EXCEPTION 'the trial balance moved on % account/site pairs', n;
    END IF;

    RAISE NOTICE 'chart is now % groups over % postings: % at one digit, % at three, % at five, % at seven',
        (SELECT count(*) FROM ledger_account WHERE is_group),
        (SELECT count(*) FROM ledger_account WHERE NOT is_group),
        (SELECT count(*) FROM ledger_account WHERE is_group AND length(account_code) = 1),
        (SELECT count(*) FROM ledger_account WHERE is_group AND length(account_code) = 3),
        (SELECT count(*) FROM ledger_account WHERE is_group AND length(account_code) = 5),
        (SELECT count(*) FROM ledger_account WHERE is_group AND length(account_code) = 7);
END $$;

COMMENT ON COLUMN ledger_account.parent_code IS
    'The rung below this account on the client''s own ladder: 1 -> 3 -> 5 -> 7 -> 10 digits, never skipped. A posting always hangs off a seven-digit family, and no parent holds both groups and postings — 0247 restored both after the first cut of the collapse flattened them unevenly.';
