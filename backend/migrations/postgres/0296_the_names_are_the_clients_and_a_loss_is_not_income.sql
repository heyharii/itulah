-- The names are the client's, and a loss is not income.
--
-- 0289 named the forty in textbook Indonesian — Beban, Aset, Utang, Penyusutan,
-- "tender" — and the client's own chart uses none of those words. They write
-- Biaya, Aktiva, Hutang, Depresiasi, Supplier, Principal, Affiliasi; they call
-- a card receivable Piutang Dagang and the cost of goods Harga Pokok Pembelian.
-- 0253 established the rule for the retired chart and it holds for the new one:
-- an accountant looks for the name they know, and any other name is a different
-- account to them. Every name below is lifted from the group in their chart
-- that the account folded out of, so the trial balance reads in their words.
--
-- Two of the forty change meaning as well as name, and one account is added.
--
-- `2102` was `Barang diterima belum ditagih` — my reading of their `Hutang
-- Supplier Barang Dagang - Suspend` as goods-received-not-invoiced. Plausible,
-- unconfirmed, and one of the open questions to their accountant. The account
-- now carries their word, `Suspend`, and no interpretation.
--
-- `1602` was `Aset takberwujud & aset tangguhan`, one name for two natures.
-- It becomes `Intangible Asset`, their group name, and pre-opening cost sits
-- inside it as an asset class — the same treatment CIP already has on `1601`.
--
-- `8301 Biaya Lain-lain` is new. The client's `Pendapatan dan (Biaya) Lain-lain`
-- is a signed family, income and expense in one branch, and 0289 carried that
-- shape forward as `4301` under root 4. Two independent reviews of the chart
-- objected to the same thing: a loss on disposing an asset, or a till that
-- came up short, was being posted as a debit inside a REVENUE account. The
-- arithmetic is right and the presentation is wrong — and it is exactly the
-- defect in the client's chart that everybody wanted this collapse to cure.
-- So the family splits along the line it always had in its name: gains stay
-- on `4301`, losses get `8301`, and root 8 is now purely cost, which is what
-- `financial_statements::section_of` has assumed since this morning.
--
-- The posting rules that produce a signed result — a cash count, an asset
-- disposal, a rounding — pick the side when they build the line, because
-- that is the one moment the sign is known. That is a change in `cash.rs`,
-- `assets.rs` and `sales_posting.rs`, and it is theirs to make; this migration
-- gives them somewhere to post to.

UPDATE ledger_account SET name = v.name, name_en = v.name_en
  FROM (VALUES
    ('1101', 'Cash On Hand',                                   'Cash on hand'),
    ('1102', 'Cash In Bank',                                   'Cash in bank'),
    ('1201', 'Piutang Dagang',                                 'Card and settlement receivables'),
    ('1202', 'Piutang Lain-lain',                              'Other receivables'),
    ('1209', 'Cadangan Penghapusan Piutang Tak Tertagih',      'Allowance for doubtful receivables'),
    ('1301', 'Persediaan',                                     'Inventory'),
    ('1302', 'Barang Dalam Perjalanan',                        'Goods in transit'),
    ('1309', 'Cadangan Kerusakan atau Kehilangan Barang',      'Allowance for inventory damage and loss'),
    ('1401', 'Biaya Dibayar Dimuka',                           'Prepaid expenses'),
    ('1402', 'Pajak Bayar Dimuka',                             'Prepaid taxes'),
    ('1403', 'Uang Muka',                                      'Advances'),
    ('1501', 'Piutang (Hutang) Affiliasi Antar Unit',          'Inter-unit current account'),
    ('1601', 'Aktiva Tetap',                                   'Fixed assets'),
    ('1602', 'Intangible Asset',                               'Intangible assets'),
    ('1609', 'Akumulasi Penyusutan Aktiva Tetap',              'Accumulated depreciation'),
    ('1610', 'Reserve Replacement Operating Equipment',        'Operating equipment replacement reserve'),
    ('1619', 'Akumulasi Amortisasi',                           'Accumulated amortisation'),
    ('2101', 'Hutang Supplier',                                'Trade payables'),
    ('2102', 'Hutang Supplier - Suspend',                      'Supplier payable — suspense'),
    ('2103', 'Outstanding Giro',                               'Cheques issued not cleared'),
    ('2201', 'Hutang Pajak',                                   'Taxes payable'),
    ('2301', 'Biaya Yang Masih Harus Dibayar',                 'Accrued expenses'),
    ('2401', 'Uang Muka Penjualan',                            'Customer deposits and voucher liability'),
    ('2501', 'Pinjaman Bank',                                  'Bank loans'),
    ('2502', 'Pinjaman Principal',                             'Owner loans'),
    ('3101', 'Modal Setor',                                    'Paid-in capital'),
    ('3102', 'Prive',                                          'Drawings'),
    ('3201', 'Laba (Rugi) Ditahan',                            'Retained earnings'),
    ('4101', 'Penjualan',                                      'Sales'),
    ('4201', 'Potongan dan Retur Penjualan',                   'Sales discounts and returns'),
    ('4301', 'Pendapatan Lain-lain',                           'Other income'),
    ('5101', 'Harga Pokok Pembelian',                          'Cost of goods sold'),
    ('5102', 'Kehilangan Barang & Selisih Stock Opname',       'Shrinkage and stocktake variance'),
    ('6101', 'Biaya Penjualan',                                'Selling expenses'),
    ('6201', 'Biaya Pegawai',                                  'Personnel expenses'),
    ('6301', 'Biaya Administrasi dan Umum',                    'General and administrative expenses'),
    ('6401', 'Biaya Sewa',                                     'Rent'),
    ('7101', 'Biaya Depresiasi dan Amortisasi',                'Depreciation and amortisation'),
    ('8101', 'Biaya Bunga',                                    'Interest expense'),
    ('8201', 'Pajak Penghasilan',                              'Income tax expense')
  ) AS v (account_code, name, name_en)
 WHERE ledger_account.account_code = v.account_code;

-- `5101` keeps the client's own name, and that name is a periodic-system word:
-- purchases charged as incurred, closing stock counted later. This ledger is
-- perpetual — cost of goods is computed per trading day from what left the
-- floor. Their accountant will recognise the line; the number under it is
-- arrived at differently from the way the name suggests, and that is written
-- down here rather than hidden behind a translation.
COMMENT ON COLUMN ledger_account.name IS
    'The client''s own name for the account, lifted from their chart. 5101 says '
    '"Pembelian" because their chart does; the figure is perpetual cost of goods.';

-- The loss side of `Pendapatan dan (Biaya) Lain-lain`.
INSERT INTO line_category (category_code, family, name, name_en, sort_order, legacy_code) VALUES
    ('ASSET_DISPOSAL_LOSS', 'other_expense_kind', 'Rugi Pelepasan Aktiva',   'Loss on asset disposal', 0, NULL),
    ('CASH_SHORTAGE',       'other_expense_kind', 'Selisih Kas Kurang',      'Cash shortage',          1, NULL),
    ('ROUNDING_LOSS',       'other_expense_kind', 'Selisih Pembulatan',      'Rounding loss',          2, '8010110002'),
    ('OTHER_EXPENSE',       'other_expense_kind', 'Biaya Lain-lain',         'Other expense',          3, '8010110007');

-- And the gain side says so, now that it no longer has to carry both.
UPDATE line_category SET name = 'Laba Pelepasan Aktiva', name_en = 'Gain on asset disposal'
 WHERE category_code = 'ASSET_DISPOSAL';
UPDATE line_category SET name = 'Selisih Kas Lebih', name_en = 'Cash overage'
 WHERE category_code = 'CASH_VARIANCE';

INSERT INTO ledger_account (account_code, name, name_en, parent_code, is_group, is_active,
                            dimension, normal_balance, is_contra, category_family,
                            requires_counter_site, posting_mode, manual_je_policy,
                            posting_policy_configured, code_provenance)
VALUES ('8301', 'Biaya Lain-lain', 'Other expenses', '8', FALSE, TRUE,
        'unit', 'D', FALSE, 'other_expense_kind',
        -- A loss is reached through the document that produced it — a cash
        -- count, a disposal — or an approved correction. Not by hand.
        FALSE, 'SEMI_AUTO', 'OVERRIDE', TRUE, 'PENDING_CLIENT_CODE');

-- The bridge: both sides of a loss read back to the client's signed account,
-- because that is where they would have been. The span table holds it since
-- the remap is keyed on their code and already points `8010110007` at `4301`.
INSERT INTO legacy_code_span (new_code, category_code, legacy_code) VALUES
    ('8301', 'OTHER_EXPENSE',       '8010110007'),
    ('8301', 'CASH_SHORTAGE',       '8010110007'),
    ('8301', 'ASSET_DISPOSAL_LOSS', '8010110007'),
    ('8301', 'ROUNDING_LOSS',       '8010110002');

DO $$
DECLARE
    live     INTEGER;
    textbook TEXT;
BEGIN
    SELECT count(*) INTO live FROM ledger_account WHERE NOT is_group AND is_active;
    IF live <> 41 THEN RAISE EXCEPTION 'expected 41 live accounts, got %', live; END IF;

    -- None of the words the client does not use may survive in a live name.
    SELECT string_agg(account_code || ' ' || name, ', ') INTO textbook
      FROM ledger_account
     WHERE is_active AND NOT is_group
       AND (name ~* '\mBeban\M' OR name ~* '\mAset\M' OR name ~* '\mUtang\M'
            OR name ~* '\mPenyusutan\M' AND name !~* 'Akumulasi'
            OR name ~* '\mtender\M' OR name ~* '\mpemasok\M' OR name ~* '\mpemilik\M');
    IF textbook IS NOT NULL THEN
        RAISE EXCEPTION 'these live accounts still use a word the client does not: %', textbook;
    END IF;

    IF legacy_account_code('8301', 'OTHER_EXPENSE') <> '8010110007' THEN
        RAISE EXCEPTION 'the loss side does not read back to the client''s signed account';
    END IF;
END $$;
