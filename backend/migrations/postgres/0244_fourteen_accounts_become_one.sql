-- 0244: Fourteen accounts become one, and no rupiah moves.
--
-- 0243 wrote the 219-account chart beside the imported one. This migration
-- moves every reference from the old chart to the new one and then deletes
-- what is left, so that `ledger_account` ends up 219 rows.
--
-- # The mapping is data, and it is total
--
-- `ledger_account_remap` survives the migration on purpose. It is the only
-- record of where a balance went, and the first thing anybody comparing a
-- report against last year's will want. It is built in two steps:
--
--   1. `template` -> new code, 509 rows, written out below. A template is a
--      client code with the unit suffix already removed.
--   2. every account in the chart whose code is `template || <two digits>`
--      inherits that template's answer.
--
-- Then it RAISES if a single posting account, or a single code any other table
-- points at, is left without an answer. A chart migration that silently
-- orphans an account is worse than one that fails.
--
-- # Twelve minted codes
--
-- Ten of the 175 posting accounts are re-parented by the new chart into a
-- branch their client code does not sit under, so the code could not be kept —
-- the hierarchy is the code here, and a child must start with its parent:
--
--     1021508001  Aset Dalam Pengerjaan (CIP)   was 1031803001, under OTHER
--                                               ASSETS; the new chart files it
--                                               under AKTIVA TETAP
--     2012401001  Uang Muka Penjualan & Voucher was 205001, which hangs off `2`
--                                               and skips two rungs
--     4020210001  Pendapatan Bunga Bank         was 8010110001
--     4020210002  Potongan Pembelian            was 8010110003
--     4020210003  Pendapatan Sewa               was 8010110004/5
--     4020210009  Pendapatan Lain-lain          was 8010110007 + 600104
--     7010310003  Pajak Reklame                 was 7020310003
--     7010310004  Biaya Management Fee          was 7020310004
--     7010310005  Asuransi Kendaraan            was 7020310005
--
-- The four in class 4 are the only place a balance changes ROOT CLASS. The
-- client files bank interest, purchase discounts and rent received under `8
-- BEBAN NON OPERASIONAL`, whose name — `PENDAPATAN DAN (BIAYA) LAIN - LAIN` —
-- says it holds both sides. `coa-final.json` calls them revenue and puts them
-- in class 4. Same rupiah, different line of the P&L, and the verification
-- script prints the movement rather than hiding it.
--
-- Two more are new accounts with nothing to inherit: `1011005001 Setoran Dalam
-- Perjalanan` and `8010110008 Selisih Kas`. They start at zero, which is what
-- `docs/coa-final.md` says they should.
--
-- # What the seven asset categories turn into
--
-- `fixed_asset.category_code` points at a rung-7 GROUP — `1021501` Tanah,
-- `1021506` FFE. After the collapse the category and the account are the same
-- thing, so each category becomes the posting account it used to head. Land is
-- the one that splits: `1021501` held both Tanah Hak Milik and HGB, which are
-- two accounts now, and the register's category lands on Tanah Hak Milik.
--
-- The same seven codes appear as `account_map.qualifier` for
-- `fixed_asset`, `depreciation_expense` and `accumulated_depreciation` —
-- `assets.rs` passes the category as the qualifier — so the qualifier moves
-- with the FK or every depreciation run is refused for want of a mapping.
--
-- # Three families the fixture could not have known about
--
-- `coa-final.json` was derived from the client's export. Migration 0238 then
-- added three families of its own, and they have to land somewhere:
--
--     4010114001  Penjualan Barang Dagangan  -> 4010110001, the same meaning;
--                 0238 created it to hold counter sales tender-neutrally and
--                 the fixture had already folded all nine sales accounts into
--                 one.
--     1011101003  Piutang QRIS               -> 1011101002 Piutang Kartu Debit
--     1011101004  Piutang Tender Lain-Lain   -> 1011101002 Piutang Kartu Debit
--
-- The last two are a JUDGEMENT, and the only one in this migration. The
-- fixture has no tender-clearing account for QRIS or for a tender the till
-- could only call OTHER; it keeps credit and debit card receivables apart and
-- stops there. Both are money an acquirer owes for a card-rail tender taken at
-- the counter, which is what `1011101002` already means, so that is where they
-- go — and the choice is a row in `ledger_account_remap` with its reason on
-- it, so changing it later is an UPDATE and not an argument. If the owner
-- wants QRIS on its own line, that is a 176th account and a new migration.
--
-- # account_map keeps its per-site rows
--
-- Its primary key is `(semantic_key, site_id, qualifier)` and `site_id` is NOT
-- NULL with a foreign key to `site`. Dropping the site from that key is a
-- separate decision with its own blast radius, and this migration does not
-- take it. What changes is that all fourteen rows for one meaning now name the
-- SAME account, which is the collapse arriving at the map.

-- ---------------------------------------------------------------------------
-- Step one: the mapping
-- ---------------------------------------------------------------------------

CREATE TABLE ledger_account_remap (
    legacy_code text PRIMARY KEY CHECK (legacy_code ~ '^[0-9]+$'),
    new_code    text NOT NULL REFERENCES ledger_account(account_code),
    note        text
);
CREATE INDEX ix_ledger_account_remap_new ON ledger_account_remap (new_code);

COMMENT ON TABLE ledger_account_remap IS
    'Where every account of the client''s imported 7,528-row chart went when 0244 collapsed it onto the unit dimension. Kept forever: it is what answers "this figure used to be under 101100100107".';

CREATE TEMPORARY TABLE template_map (template text PRIMARY KEY, new_code text NOT NULL)
    ON COMMIT DROP;

INSERT INTO template_map (template, new_code) VALUES
  ('1011001001', '1011001001'),
  ('1011001002', '1011001002'),
  ('1011001003', '1011001003'),
  ('1011002001', '1011002001'),
  ('1011002002', '1011002002'),
  ('1011002003', '1011002003'),
  ('1011002004', '1011002004'),
  ('1011002005', '1011002005'),
  ('1011003001', '1011003001'),
  ('1011003002', '1011003002'),
  ('1011003003', '1011003003'),
  ('1011003004', '1011003004'),
  ('1011003005', '1011003005'),
  ('1011004001', '1011004001'),
  ('1011004002', '1011004002'),
  ('1011004003', '1011004003'),
  ('1011004004', '1011004004'),
  ('1011101001', '1011101001'),
  ('1011101002', '1011101002'),
  ('1011101003', '1011101002'),
  ('1011101004', '1011101002'),
  ('1011102001', '1011102001'),
  ('1011102002', '1011102002'),
  ('1011102003', '1011102003'),
  ('1011103001', '1011103001'),
  ('1011103002', '1011103001'),
  ('1011103003', '1011103001'),
  ('1011201001', '1011201001'),
  ('1011202001', '1011202001'),
  ('1011202002', '1011202001'),
  ('1011202003', '1011202001'),
  ('1011202004', '1011202001'),
  ('1011202005', '1011202001'),
  ('1011202006', '1011202001'),
  ('1011202007', '1011202001'),
  ('1011202008', '1011202001'),
  ('1011202009', '1011202001'),
  ('1011202010', '1011202001'),
  ('1011203001', '1011203001'),
  ('1011203002', '1011203001'),
  ('1011203003', '1011203001'),
  ('1011203004', '1011203001'),
  ('1011203005', '1011203001'),
  ('1011203006', '1011203001'),
  ('1011203007', '1011203001'),
  ('1011203008', '1011203001'),
  ('1011203009', '1011203001'),
  ('1011203010', '1011203001'),
  ('1011203011', '1011203001'),
  ('1011203012', '1011203001'),
  ('1011203013', '1011203001'),
  ('1011203014', '1011203001'),
  ('1011204001', '1011204001'),
  ('1011204002', '1011204001'),
  ('1011204003', '1011204001'),
  ('1011204004', '1011204001'),
  ('1011204005', '1011204001'),
  ('1011204006', '1011204001'),
  ('1011204007', '1011204001'),
  ('1011204008', '1011204001'),
  ('1011204009', '1011204001'),
  ('1011204010', '1011204001'),
  ('1011204011', '1011204001'),
  ('1011204012', '1011204001'),
  ('1011204013', '1011204001'),
  ('1011204014', '1011204001'),
  ('1011299001', '1011299001'),
  ('1011299002', '1011299001'),
  ('1011301001', '1011301001'),
  ('1011301002', '1011301002'),
  ('1011301003', '1011301002'),
  ('1011301004', '1011301002'),
  ('1011301005', '1011301005'),
  ('1011301006', '1011301002'),
  ('1011301007', '1011301007'),
  ('1011301008', '1011301008'),
  ('1011301009', '1011301009'),
  ('1011302001', '1011302001'),
  ('1011302002', '1011302002'),
  ('1011302003', '1011302003'),
  ('1011302004', '1011302004'),
  ('1011302005', '1011302005'),
  ('1011302006', '1011302006'),
  ('1011303001', '1011303001'),
  ('1011303002', '1011303002'),
  ('1011303003', '1011303003'),
  ('1011303004', '1011303004'),
  ('1021401001', '1021401001'),
  ('1021401002', '1021401001'),
  ('1021401003', '1021401001'),
  ('1021401004', '1021401001'),
  ('1021401005', '1021401001'),
  ('1021401006', '1021401001'),
  ('1021401007', '1021401001'),
  ('1021401008', '1021401001'),
  ('1021401009', '1021401001'),
  ('1021401010', '1021401001'),
  ('1021401011', '1021401001'),
  ('1021401012', '1021401001'),
  ('1021401013', '1021401001'),
  ('1021401014', '1021401001'),
  ('1021402001', '1021401001'),
  ('1021402002', '1021401001'),
  ('1021402003', '1021401001'),
  ('1021402004', '1021401001'),
  ('1021402005', '1021401001'),
  ('1021402006', '1021401001'),
  ('1021402007', '1021401001'),
  ('1021402008', '1021401001'),
  ('1021402009', '1021401001'),
  ('1021402010', '1021401001'),
  ('1021402011', '1021401001'),
  ('1021402012', '1021401001'),
  ('1021402013', '1021401001'),
  ('1021402014', '1021401001'),
  ('1021403001', '1021401001'),
  ('1021403002', '1021401001'),
  ('1021403003', '1021401001'),
  ('1021403004', '1021401001'),
  ('1021403005', '1021401001'),
  ('1021403006', '1021401001'),
  ('1021403007', '1021401001'),
  ('1021403008', '1021401001'),
  ('1021403009', '1021401001'),
  ('1021403010', '1021401001'),
  ('1021403011', '1021401001'),
  ('1021403012', '1021401001'),
  ('1021403013', '1021401001'),
  ('1021403014', '1021401001'),
  ('1021501', '1021501001'),
  ('1021501001', '1021501001'),
  ('1021501002', '1021501002'),
  ('1021502', '1021502001'),
  ('1021502001', '1021502001'),
  ('1021502002', '1021502001'),
  ('1021502003', '1021502001'),
  ('1021503', '1021503001'),
  ('1021503001', '1021503001'),
  ('1021504', '1021504001'),
  ('1021504001', '1021504001'),
  ('1021504002', '1021504001'),
  ('1021504003', '1021504001'),
  ('1021504004', '1021504001'),
  ('1021505', '1021505001'),
  ('1021505001', '1021505001'),
  ('1021505002', '1021505001'),
  ('1021506', '1021506001'),
  ('1021506001', '1021506001'),
  ('1021506002', '1021506001'),
  ('1021506003', '1021506001'),
  ('1021506004', '1021506001'),
  ('1021506005', '1021506001'),
  ('1021506006', '1021506001'),
  ('1021506007', '1021506001'),
  ('1021507', '1021507001'),
  ('1021507001', '1021507001'),
  ('1021507002', '1021507001'),
  ('1021507003', '1021507001'),
  ('1021507004', '1021507001'),
  ('1021507005', '1021507001'),
  ('1021507006', '1021507001'),
  ('1021507007', '1021507001'),
  ('1021507008', '1021507001'),
  ('1021507009', '1021507001'),
  ('1021507010', '1021507001'),
  ('1021507011', '1021507001'),
  ('1021507012', '1021507001'),
  ('1021507013', '1021507001'),
  ('1021507014', '1021507001'),
  ('1021507015', '1021507001'),
  ('1021507016', '1021507001'),
  ('1021507017', '1021507001'),
  ('1021507018', '1021507001'),
  ('1021507019', '1021507001'),
  ('1021507020', '1021507001'),
  ('1021507021', '1021507001'),
  ('1021507022', '1021507001'),
  ('1021507023', '1021507001'),
  ('1021507024', '1021507001'),
  ('1021507025', '1021507001'),
  ('1021507026', '1021507001'),
  ('1021507027', '1021507001'),
  ('1021507028', '1021507001'),
  ('1021507029', '1021507001'),
  ('1021507030', '1021507001'),
  ('1021507031', '1021507001'),
  ('1021507032', '1021507001'),
  ('1021507033', '1021507001'),
  ('1021507034', '1021507001'),
  ('1021507035', '1021507001'),
  ('1021507036', '1021507001'),
  ('1021601002', '1021601002'),
  ('1021602001', '1021602001'),
  ('1021602002', '1021602001'),
  ('1021602003', '1021602001'),
  ('1021603001', '1021603001'),
  ('1021604001', '1021604001'),
  ('1021604002', '1021604001'),
  ('1021604003', '1021604001'),
  ('1021604004', '1021604001'),
  ('1021605001', '1021605001'),
  ('1021605002', '1021605001'),
  ('1021606001', '1021606001'),
  ('1021606002', '1021606001'),
  ('1021606003', '1021606001'),
  ('1021606004', '1021606001'),
  ('1021606005', '1021606001'),
  ('1021606006', '1021606001'),
  ('1021606007', '1021606001'),
  ('1021607001', '1021607001'),
  ('1021607002', '1021607001'),
  ('1021607003', '1021607001'),
  ('1021607004', '1021607001'),
  ('1021607005', '1021607001'),
  ('1021607006', '1021607001'),
  ('1021607007', '1021607001'),
  ('1021607008', '1021607001'),
  ('1021607009', '1021607001'),
  ('1021607010', '1021607001'),
  ('1021607011', '1021607001'),
  ('1021607012', '1021607001'),
  ('1021607013', '1021607001'),
  ('1021607014', '1021607001'),
  ('1021607015', '1021607001'),
  ('1021607016', '1021607001'),
  ('1021607017', '1021607001'),
  ('1021607018', '1021607001'),
  ('1021607019', '1021607001'),
  ('1021607020', '1021607001'),
  ('1021607021', '1021607001'),
  ('1021607022', '1021607001'),
  ('1021607023', '1021607001'),
  ('1021607024', '1021607001'),
  ('1021607025', '1021607001'),
  ('1021607026', '1021607001'),
  ('1021607027', '1021607001'),
  ('1021607028', '1021607001'),
  ('1021607029', '1021607001'),
  ('1021607030', '1021607001'),
  ('1021607031', '1021607001'),
  ('1021607032', '1021607001'),
  ('1021607033', '1021607001'),
  ('1021607034', '1021607001'),
  ('1021607035', '1021607001'),
  ('1021607036', '1021607001'),
  ('1021701001', '1021701001'),
  ('1021701002', '1021701001'),
  ('1021702001', '1021702001'),
  ('1021702002', '1021702001'),
  ('1031801001', '1031801001'),
  ('1031802001', '1031802001'),
  ('1031802002', '1031802002'),
  ('1031803001', '1021508001'),
  ('2012001001', '2012001001'),
  ('2012001002', '2012001002'),
  ('2012001003', '2012001003'),
  ('2012002001', '2012002001'),
  ('2012002002', '2012002001'),
  ('2012002003', '2012002001'),
  ('2012002004', '2012002001'),
  ('2012002005', '2012002001'),
  ('2012101001', '2012101001'),
  ('2012101002', '2012101002'),
  ('2012101003', '2012101003'),
  ('2012101004', '2012101004'),
  ('2012101005', '2012101005'),
  ('2012201001', '2012201001'),
  ('2012201002', '2012201001'),
  ('2012201003', '2012201003'),
  ('2012201004', '2012201001'),
  ('2012201005', '2012201001'),
  ('2012201006', '2012201006'),
  ('2012201007', '2012201006'),
  ('2012201008', '2012201006'),
  ('2012201009', '2012201009'),
  ('2012201010', '2012201009'),
  ('2012301001', '1021401001'),
  ('2012301002', '1021401001'),
  ('2012301003', '1021401001'),
  ('2012301004', '1021401001'),
  ('2012301005', '1021401001'),
  ('2012301006', '1021401001'),
  ('2012301007', '1021401001'),
  ('2012301008', '1021401001'),
  ('2012301009', '1021401001'),
  ('2012301010', '1021401001'),
  ('2012301011', '1021401001'),
  ('2012301012', '1021401001'),
  ('2012301013', '1021401001'),
  ('2012301014', '1021401001'),
  ('2012302001', '1021401001'),
  ('2012302002', '1021401001'),
  ('2012302003', '1021401001'),
  ('2012302004', '1021401001'),
  ('2012302005', '1021401001'),
  ('2012302006', '1021401001'),
  ('2012302007', '1021401001'),
  ('2012302008', '1021401001'),
  ('2012302009', '1021401001'),
  ('2012302010', '1021401001'),
  ('2012302011', '1021401001'),
  ('2012302012', '1021401001'),
  ('2012302013', '1021401001'),
  ('2012302014', '1021401001'),
  ('2012303001', '2012303001'),
  ('2012303002', '2012303001'),
  ('2012303003', '2012303001'),
  ('2012303004', '2012303001'),
  ('2012303005', '2012303001'),
  ('2012303006', '2012303001'),
  ('2012303007', '2012303001'),
  ('2012303008', '2012303001'),
  ('2012303009', '2012303001'),
  ('2012303010', '2012303001'),
  ('2012303011', '2012303001'),
  ('2012303012', '2012303001'),
  ('2012303013', '2012303001'),
  ('2012303014', '2012303001'),
  ('2012304001', '1021401001'),
  ('2012304002', '1021401001'),
  ('2012304003', '1021401001'),
  ('2012304004', '1021401001'),
  ('2012304005', '1021401001'),
  ('2012304006', '1021401001'),
  ('2012304007', '1021401001'),
  ('2012304008', '1021401001'),
  ('2012304009', '1021401001'),
  ('2012304010', '1021401001'),
  ('2012304011', '1021401001'),
  ('2012304012', '1021401001'),
  ('2012304013', '1021401001'),
  ('2012304014', '1021401001'),
  ('2012501001', '2012501001'),
  ('2012502001', '2012502001'),
  ('2012502002', '2012502001'),
  ('2012502003', '2012502001'),
  ('2012502004', '2012502001'),
  ('2012502005', '2012502001'),
  ('2022401001', '2022401001'),
  ('2022402001', '2022402001'),
  ('2022402002', '2022402001'),
  ('2022402003', '2022402001'),
  ('2022402004', '2022402001'),
  ('2022402005', '2022402001'),
  ('204001', '2012002001'),
  ('205001', '2012401001'),
  ('3013001001', '3013001001'),
  ('3013001002', '3013001002'),
  ('3013001003', '3013001003'),
  ('3013001004', '3013001004'),
  ('4010110001', '4010110001'),
  ('4010111001', '4010110001'),
  ('4010111002', '4010110001'),
  ('4010111003', '4010110001'),
  ('4010111004', '4010110001'),
  ('4010112001', '4010110001'),
  ('4010112002', '4010110001'),
  ('4010113001', '4010110001'),
  ('4010113002', '4010110001'),
  ('4010114001', '4010110001'),
  ('4010213001', '4010213001'),
  ('4010214001', '4010214001'),
  ('4020110001', '4020110001'),
  ('5010110001', '5010110001'),
  ('600104', '4020210009'),
  ('6010110001', '6010110001'),
  ('6010110002', '6010110002'),
  ('6010110003', '6010110003'),
  ('6010110004', '6010110004'),
  ('6010110005', '6010110005'),
  ('6010110006', '6010110006'),
  ('6010110007', '6010110007'),
  ('6010110008', '6010110008'),
  ('6010111001', '6010210001'),
  ('6010111002', '6010210002'),
  ('6010111003', '6010210003'),
  ('6010111004', '6010210004'),
  ('6010111005', '6010210005'),
  ('6010111006', '6010210006'),
  ('6010111007', '6010210007'),
  ('6010111008', '6010210008'),
  ('6010111009', '6010210009'),
  ('6010111010', '6010210010'),
  ('6010111011', '6010210011'),
  ('6010111012', '6010210012'),
  ('6010111013', '6010210013'),
  ('6010210001', '6010210001'),
  ('6010210002', '6010210002'),
  ('6010210003', '6010210003'),
  ('6010210004', '6010210004'),
  ('6010210005', '6010210005'),
  ('6010210006', '6010210006'),
  ('6010210007', '6010210007'),
  ('6010210008', '6010210008'),
  ('6010210009', '6010210009'),
  ('6010210010', '6010210010'),
  ('6010210011', '6010210011'),
  ('6010210012', '6010210012'),
  ('6010210013', '6010210013'),
  ('6010310001', '6010310001'),
  ('6010310002', '6010310002'),
  ('6010310003', '6010310003'),
  ('6010310004', '6010310004'),
  ('6010310005', '6010310005'),
  ('6010310006', '6010310006'),
  ('6010310007', '6010310007'),
  ('6010310008', '6010310008'),
  ('6010310009', '6010310009'),
  ('6010310010', '6010310010'),
  ('6010310011', '6010310011'),
  ('6010310012', '6010310012'),
  ('6010310013', '6010310013'),
  ('6010310014', '6010310014'),
  ('6010310015', '6010310015'),
  ('6010310016', '6010310016'),
  ('6010310017', '6010310017'),
  ('6010310018', '6010310018'),
  ('6010310019', '6010310017'),
  ('6010310020', '6010310005'),
  ('6010310021', '6010310021'),
  ('6010310022', '6010310022'),
  ('6010310023', '6010310023'),
  ('6010310024', '6010310024'),
  ('6010310099', '6010310099'),
  ('6010410001', '6010410001'),
  ('6010410002', '6010410002'),
  ('6010410003', '6010410003'),
  ('6010410004', '6010410004'),
  ('6010410005', '6010410005'),
  ('6010410006', '6010410006'),
  ('6010410007', '6010410007'),
  ('6010410008', '6010410008'),
  ('6010410009', '6010410004'),
  ('6010410010', '6010410010'),
  ('7010110001', '7010110001'),
  ('7010110002', '7010110002'),
  ('7010110003', '7010110003'),
  ('7010110004', '7010110004'),
  ('7010210001', '7010210001'),
  ('7010210002', '7010210001'),
  ('7010210003', '7010210001'),
  ('7010211001', '7010211001'),
  ('7010212001', '7010212001'),
  ('7010212002', '7010212001'),
  ('7010212003', '7010212001'),
  ('7010212004', '7010212001'),
  ('7010213001', '7010213001'),
  ('7010213002', '7010213001'),
  ('7010214001', '7010214001'),
  ('7010214002', '7010214001'),
  ('7010214003', '7010214001'),
  ('7010214004', '7010214001'),
  ('7010214005', '7010214001'),
  ('7010214006', '7010214001'),
  ('7010214007', '7010214001'),
  ('7010215001', '7010215001'),
  ('7010215002', '7010215001'),
  ('7010215003', '7010215001'),
  ('7010215004', '7010215001'),
  ('7010215005', '7010215001'),
  ('7010215006', '7010215001'),
  ('7010215007', '7010215001'),
  ('7010215008', '7010215001'),
  ('7010215009', '7010215001'),
  ('7010215010', '7010215001'),
  ('7010215011', '7010215001'),
  ('7010215012', '7010215001'),
  ('7010215013', '7010215001'),
  ('7010215014', '7010215001'),
  ('7010215015', '7010215001'),
  ('7010215016', '7010215001'),
  ('7010215017', '7010215001'),
  ('7010215018', '7010215001'),
  ('7010215019', '7010215001'),
  ('7010215020', '7010215001'),
  ('7010215021', '7010215001'),
  ('7010215022', '7010215001'),
  ('7010215023', '7010215001'),
  ('7010215024', '7010215001'),
  ('7010215025', '7010215001'),
  ('7010215026', '7010215001'),
  ('7010215027', '7010215001'),
  ('7010215028', '7010215001'),
  ('7010215029', '7010215001'),
  ('7010215030', '7010215001'),
  ('7010215031', '7010215001'),
  ('7010215032', '7010215001'),
  ('7010215033', '7010215001'),
  ('7010215034', '7010215001'),
  ('7010215035', '7010215001'),
  ('7010215036', '7010215001'),
  ('7010216001', '7010216001'),
  ('7010216002', '7010216002'),
  ('7010216003', '7010216001'),
  ('7010310001', '7010310001'),
  ('7010310002', '7010310002'),
  ('7020310003', '7010310003'),
  ('7020310004', '7010310004'),
  ('7020310005', '7010310005'),
  ('8010110001', '4020210001'),
  ('8010110002', '8010110002'),
  ('8010110003', '4020210002'),
  ('8010110004', '4020210003'),
  ('8010110005', '4020210003'),
  ('8010110006', '8010110006'),
  ('8010110007', '4020210009'),
  ('8020111001', '8020111001'),
  ('8020111002', '8020111002'),
  ('8030112001', '8030112001')
;

-- A leaf inherits its template's answer; a template that is itself a posting
-- account, and the seven category groups, answer for themselves.
INSERT INTO ledger_account_remap (legacy_code, new_code, note)
SELECT a.account_code, m.new_code, 'unit suffix ' || right(a.account_code, 2) || ' dropped'
  FROM ledger_account a
  JOIN template_map m ON m.template = left(a.account_code, length(a.account_code) - 2)
 WHERE length(a.account_code) = 12
   AND NOT EXISTS (SELECT 1 FROM template_map t WHERE t.template = a.account_code);

INSERT INTO ledger_account_remap (legacy_code, new_code, note)
SELECT a.account_code, m.new_code, 'named directly'
  FROM ledger_account a
  JOIN template_map m ON m.template = a.account_code
 WHERE a.account_code <> m.new_code
    ON CONFLICT (legacy_code) DO NOTHING;

-- The one judgement in this file, written onto the rows it applies to so that
-- it is visible to anybody reading the map rather than buried in a comment.
UPDATE ledger_account_remap SET note =
    'JUDGEMENT: the 219-account chart has no tender-clearing account for QRIS '
    'or for an unnamed tender; both are an acquirer owing for a card-rail '
    'tender at the counter, so they land on Piutang Kartu Debit. Change this '
    'row if the owner wants QRIS on its own line.'
 WHERE left(legacy_code, 10) IN ('1011101003', '1011101004');

-- ---------------------------------------------------------------------------
-- Step two: refuse to go on if anything would be orphaned
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    missing text;
BEGIN
    -- Every code any table actually points at must have an answer, whether it
    -- is a posting account or one of the groups `fixed_asset` names.
    SELECT string_agg(DISTINCT code, ', ' ORDER BY code) INTO missing FROM (
        SELECT account_code       AS code FROM journal_line
        UNION SELECT account_code        FROM account_map
        UNION SELECT category_code       FROM fixed_asset
        UNION SELECT account_code        FROM bank_statement
        UNION SELECT account_code        FROM bank_statement_line WHERE account_code IS NOT NULL
        UNION SELECT account_code        FROM bank_statement_source
        UNION SELECT account_code        FROM cash_count
        UNION SELECT ledger_account_code FROM company_bank_account
        UNION SELECT bank_account_code   FROM store_deposit
        UNION SELECT drawer_account_code FROM store_deposit
        UNION SELECT account_code        FROM supplier_invoice_expense_line
        UNION SELECT expense_account_code FROM supplier WHERE expense_account_code IS NOT NULL
    ) referenced
    WHERE code NOT IN (SELECT legacy_code FROM ledger_account_remap)
      AND code NOT IN (SELECT account_code FROM ledger_account WHERE is_active);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'these account codes are referenced but have nowhere to go: %', missing;
    END IF;

    -- And every posting account of the old chart, referenced or not, so that a
    -- balance nobody has looked at yet is not quietly deleted either.
    SELECT string_agg(a.account_code, ', ' ORDER BY a.account_code) INTO missing
      FROM ledger_account a
     WHERE NOT a.is_active
       AND NOT a.is_group
       AND NOT EXISTS (SELECT 1 FROM ledger_account_remap r WHERE r.legacy_code = a.account_code);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'posting accounts with no mapping: %',
            left(missing, 400) || CASE WHEN length(missing) > 400 THEN ' ...' ELSE '' END;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Step three: move every reference
-- ---------------------------------------------------------------------------
--
-- Eleven foreign keys point into `ledger_account` and two more columns hold a
-- code without one. The journal is append-only by trigger — the rule that
-- makes it a ledger — so the trigger comes off for the length of this
-- statement and goes straight back on. Same for the two guards that refuse an
-- edit to a posted bill line or a disposed asset: this is not an edit to what
-- they say, it is the same fact under the account's new name.

ALTER TABLE journal_line DISABLE TRIGGER journal_line_append_only;
ALTER TABLE fixed_asset DISABLE TRIGGER fixed_asset_disposed_is_evidence;
ALTER TABLE supplier_invoice_expense_line DISABLE TRIGGER supplier_invoice_expense_line_is_evidence;
ALTER TABLE supplier_invoice_expense_line DISABLE TRIGGER supplier_invoice_expense_line_account_takes_costs;

-- Two composite foreign keys carry an account code as part of the key, and
-- neither is deferrable, so the parent and the child cannot be renamed in one
-- statement and cannot be renamed in two. They come off and go back on
-- unchanged. `bank_statement_line` is why a statement line cannot claim to be
-- for a different account than its statement; `supplier_payment` is why a
-- payment names a mapping that exists.
ALTER TABLE bank_statement_line DROP CONSTRAINT bank_statement_line_statement_id_account_code_fkey;
ALTER TABLE supplier_payment DROP CONSTRAINT supplier_payment_account_key_site_id_account_qualifier_fkey;

UPDATE journal_line l SET account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = l.account_code;

UPDATE account_map m SET account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = m.account_code;

-- The category a fixed asset is in, and the qualifier the three asset meanings
-- are mapped under, are the same seven codes and have to move together.
UPDATE fixed_asset f SET category_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = f.category_code;

-- Two spellings of the same qualifier collide once they are rewritten.
--
-- The live map carries an asset category BOTH ways: `1021501` (the seven-digit
-- group) and `1021501001` (the ten-digit account), for the same meaning at the
-- same site, and pointing at the same account. Rewriting the seven-digit one
-- through the remap turns it INTO the ten-digit one, and the primary key
-- `(semantic_key, site_id, qualifier)` refuses the second arrival. That is why
-- this migration failed on the shared dev database with a duplicate key on
-- `(fixed_asset, dc, 1021501001)`.
--
-- The two rows are redundant rather than contradictory, so the older spelling
-- goes. The `account_code` equality is asserted, not assumed: two rows that
-- disagreed about where a meaning posts would be a real conflict and must stop
-- the migration rather than have one of them silently win.
--
-- This duplication is also the seven-vs-ten character qualifier mismatch that
-- makes the depreciation run refuse imported categories. Collapsing the chart
-- closes it as a side effect: after this, a category and its account are the
-- same code.
DO $$
DECLARE conflicting int;
BEGIN
    SELECT count(*) INTO conflicting
      FROM account_map m
      JOIN ledger_account_remap r ON r.legacy_code = m.qualifier
      JOIN account_map k
        ON k.semantic_key = m.semantic_key
       AND k.site_id = m.site_id
       AND k.qualifier = r.new_code
       AND k.account_code <> m.account_code;
    IF conflicting > 0 THEN
        RAISE EXCEPTION
            'account_map holds % qualifier pairs that disagree about where a '
            'meaning posts; resolve them by hand before applying 0244',
            conflicting;
    END IF;
END $$;

DELETE FROM account_map m
 USING ledger_account_remap r, account_map k
 WHERE m.qualifier ~ '^[0-9]+$'
   AND r.legacy_code = m.qualifier
   AND r.new_code <> m.qualifier
   AND k.semantic_key = m.semantic_key
   AND k.site_id = m.site_id
   AND k.qualifier = r.new_code;

UPDATE account_map m SET qualifier = r.new_code
  FROM ledger_account_remap r
 WHERE m.qualifier ~ '^[0-9]+$'
   AND r.legacy_code = m.qualifier
   AND m.semantic_key IN ('fixed_asset', 'depreciation_expense', 'accumulated_depreciation',
                          'asset_replacement_reserve', 'replacement_expense');

UPDATE supplier_payment p SET account_qualifier = r.new_code
  FROM ledger_account_remap r
 WHERE p.account_qualifier ~ '^[0-9]+$'
   AND r.legacy_code = p.account_qualifier;

UPDATE bank_statement b SET account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = b.account_code;

UPDATE bank_statement_line b SET account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = b.account_code;

UPDATE bank_statement_source b SET account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = b.account_code;

UPDATE cash_count c SET account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = c.account_code;

UPDATE company_bank_account c SET ledger_account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = c.ledger_account_code;

UPDATE store_deposit d SET bank_account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = d.bank_account_code;

UPDATE store_deposit d SET drawer_account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = d.drawer_account_code;

UPDATE supplier_invoice_expense_line e SET account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = e.account_code;

UPDATE supplier s SET expense_account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = s.expense_account_code;

-- The bill-total check on `supplier_invoice_expense_line` is a DEFERRED
-- constraint trigger, and a table with queued trigger events cannot be
-- ALTERed. Firing them now — they pass, because an account code is not an
-- amount — empties the queue so the guards can go back on inside this
-- transaction rather than at COMMIT, when it would be too late to notice.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE bank_statement_line
    ADD CONSTRAINT bank_statement_line_statement_id_account_code_fkey
    FOREIGN KEY (statement_id, account_code) REFERENCES bank_statement (statement_id, account_code);
ALTER TABLE supplier_payment
    ADD CONSTRAINT supplier_payment_account_key_site_id_account_qualifier_fkey
    FOREIGN KEY (account_key, site_id, account_qualifier)
    REFERENCES account_map (semantic_key, site_id, qualifier);

ALTER TABLE journal_line ENABLE TRIGGER journal_line_append_only;
ALTER TABLE fixed_asset ENABLE TRIGGER fixed_asset_disposed_is_evidence;
ALTER TABLE supplier_invoice_expense_line ENABLE TRIGGER supplier_invoice_expense_line_is_evidence;
ALTER TABLE supplier_invoice_expense_line ENABLE TRIGGER supplier_invoice_expense_line_account_takes_costs;

-- `cash_variance` was bound to `8010110007 Pendapatan (Biaya) Lain-Lain` by
-- 0238, which said in as many words that it was putting a short drawer in the
-- client's catch-all because there was nowhere better. There is now:
-- `docs/coa-final.md` gives it `8-1003 Selisih Kas` of its own, and 0243 wrote
-- it. Left alone, that account would be unreachable and every cash variance
-- would keep landing in other income.
UPDATE account_map SET account_code = '8010110008',
                       note = 'Selisih Kas, its own account since 0244'
 WHERE semantic_key = 'cash_variance';

-- ---------------------------------------------------------------------------
-- Step four: retire the old chart
-- ---------------------------------------------------------------------------
--
-- One statement, so that a parent and its children go together: referential
-- integrity for a DELETE is checked at the end of the statement, by which time
-- the children are gone too.

DELETE FROM ledger_account WHERE NOT is_active;

DO $$
DECLARE n bigint;
BEGIN
    SELECT count(*) INTO n FROM ledger_account;
    IF n <> 219 THEN
        RAISE EXCEPTION 'the chart should be 219 accounts, found %', n;
    END IF;
    SELECT count(*) INTO n FROM ledger_account a
     WHERE a.parent_code IS NOT NULL
       AND (a.account_code NOT LIKE a.parent_code || '%' OR a.account_code = a.parent_code);
    IF n <> 0 THEN
        RAISE EXCEPTION '% accounts are not a strict extension of their parent', n;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Step five: make it structural
-- ---------------------------------------------------------------------------
--
-- The unit cannot come back by accident. `scripts/import-coa.py` sets
-- `site_id`, so re-running it against this database now fails on the first
-- row, which is the correct outcome: the chart is no longer imported.

ALTER TABLE ledger_account
    ADD CONSTRAINT ledger_account_carries_no_unit CHECK (site_id IS NULL AND counterparty_site_id IS NULL),
    ADD CONSTRAINT ledger_account_dimension_on_postings CHECK ((dimension IS NULL) = is_group),
    ADD CONSTRAINT ledger_account_counterparty_is_rare
        CHECK (requires_counterparty = false OR account_code IN ('1011203001', '1011204001', '1021401001'));

COMMENT ON CONSTRAINT ledger_account_carries_no_unit ON ledger_account IS
    'The unit is journal_line.site_id. An account that also named one would be a second authority, and the two would disagree the first time a shop opened.';
