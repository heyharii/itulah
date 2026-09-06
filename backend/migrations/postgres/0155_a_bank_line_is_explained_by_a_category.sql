-- 0155: A bank line is explained by a category, not by an account code.
--
-- # What was missing
--
-- The client's chart has 7,528 accounts hanging off 493 twelve-digit templates.
-- `book_bank_line` (0095, rebuilt by 0115) asks the person reading a statement
-- for `account_code` — a twelve-digit code out of that chart — and
-- `bank_rule` (0116) asks whoever writes a rule for a `semantic_key`, which is
-- our own vocabulary and not theirs. Neither is a question a person can answer.
-- Ask a shop manager which account the PLN autodebit belongs to and the honest
-- reply is a shrug; ask them what it IS and they say "listrik" without
-- hesitating.
--
-- So this table is the vocabulary in between: about fifty business meanings a
-- person recognises, each of which knows the semantic key it resolves through,
-- and therefore — with the location — the client's own twelve-digit code. The
-- person never sees the code. The code is still the only thing posted.
--
-- # Why the category and not the key
--
-- `account_map` already maps meaning to code. A category could have been left
-- out and the screen could have offered semantic keys directly. It cannot,
-- for three reasons that are not style:
--
--   * A key is a posting rule's word. `prepaid_expense` is one key with nine
--     qualifiers behind it, and a person choosing "Asuransi Bayar Dimuka" is
--     choosing a qualifier as much as a key. The category carries both.
--   * A key says nothing about DIRECTION. `interest_income` cannot explain a
--     debit on the statement, and offering it against one is offering a choice
--     that can only be wrong.
--   * A key says nothing about whether it may be chosen AT ALL. `cogs` is a
--     real key with a real account, and a bank line that became a cost of goods
--     by somebody picking it off a list is a bank line that has quietly
--     invented a stock movement. The refusal has to live somewhere, and it has
--     to live beside the thing being refused.
--
-- # The categories that exist only to be refused
--
-- Payroll, sales, inventory and cost of goods, trade payables, acquirer
-- receivables, depreciation, retained earnings. Each is seeded, each names the
-- document a person should go and find instead, and none may be posted from a
-- bank line.
--
-- Leaving them out would be worse than refusing them. A list that simply does
-- not contain "Gaji" teaches the person that the list is incomplete and that
-- the right move is to pick the nearest thing — and the nearest thing to a
-- salary payment on a list of expense categories is some other expense. A list
-- that contains it and says "payroll is paid against a sealed payroll run —
-- find the payment" teaches them where to go.
--
-- The accounting reason is the one that matters: the salary expense was
-- recognised when the payroll run was sealed. Categorising the bank line as
-- salary would recognise it twice, and the books would still balance.
--
-- # Every account cited below is the client's own
--
-- Read out of `Laporan_Master_Account1.csv` and quoted verbatim, including
-- their spelling and their spacing — `F u e l  & O I l  Expences`,
-- `Hutang  VAT PPN Keluaran`. The code named in `expects_account_code` is the
-- ten-digit template; the twelve-digit leaf that carries it at one location is
-- the template plus that location's two digits, and which leaf a category
-- resolves to is `account_map`'s answer, never this table's.
--
-- The expectation is a suggestion for whoever maps the key, exactly as
-- `required_semantic_keys` in `ledger.rs` is. Nothing here is applied
-- automatically and nothing here posts.

CREATE TABLE transaction_category (
    -- Stable, ours, and never shown to anybody. Renaming the display name is a
    -- Tuesday afternoon; renaming this would orphan every rule, proposal and
    -- cash document that named it.
    code            text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
    display_name    text NOT NULL CHECK (btrim(display_name) <> ''),

    -- Which shelf it sits on. Twelve for the categories a person may choose,
    -- and six more that exist only to refuse. A family rather than a tree: the
    -- chart is already a tree and nobody navigating a list of fifty wants to
    -- walk one.
    family          text NOT NULL CHECK (family IN (
                        'SELLING', 'OPERATIONS', 'MAINTENANCE', 'RENT',
                        'INSURANCE_PROPERTY', 'FINANCE_COST', 'TAX_EXPENSE',
                        'OTHER_INCOME', 'PREPAID_ADVANCE', 'RECEIVABLE',
                        'FINANCING_EQUITY', 'TRANSFER',
                        'PAYROLL', 'SALES', 'INVENTORY_COGS', 'PAYABLE',
                        'ACQUIRER', 'DEPRECIATION')),

    -- Which way the money has to be going for this to be a possible answer.
    -- BOTH is rare and always earned: rounding falls either way, a loan is
    -- drawn and repaid, an inter-unit balance goes both directions.
    direction       text NOT NULL CHECK (direction IN ('OUTFLOW', 'INFLOW', 'BOTH')),

    -- What it resolves through. Not an account code — the whole point.
    semantic_key    text NOT NULL CHECK (semantic_key ~ '^[a-z][a-z0-9_]*$'),
    -- Which of the key's several accounts, when the key is one meaning over
    -- many leaves. Fixed here when the category knows (`prepaid_expense` with
    -- INSURANCE is "Asuransi Bayar Dimuka" and nothing else), and left to the
    -- caller when only they can know which bank.
    qualifier       text NOT NULL DEFAULT '',
    qualifier_asked boolean NOT NULL DEFAULT false,

    -- What making this produces. The first three all produce a cash document
    -- (0115) and are told apart by WHAT SITS ON THE OTHER SIDE, not by which
    -- way the money went — `cash_document.kind` is derived from the two
    -- accounts by `cash_direction` and cannot be chosen here or anywhere:
    --
    --   DIRECT_EXPENSE  the other side is a cost, or an asset we are buying
    --   RECEIPT         the other side is income, or a liability we are taking on
    --   TRANSFER        the other side holds money too, so nothing is earned
    --                   or spent and both legs are ours
    --
    -- That is why a category whose direction is BOTH still has one of these:
    -- a loan drawn and a loan repaid are the same liability, so the category is
    -- a RECEIPT either way, and the slip comes out headed KAS MASUK or KAS
    -- KELUAR according to the line.
    --
    -- The remaining values are, for the categories that exist to be refused,
    -- the DOCUMENT the
    -- person should have gone and found instead. That is the only difference
    -- between a category somebody may choose and one they may not, and it is
    -- one column rather than a boolean plus a comment.
    source_document text NOT NULL CHECK (source_document IN (
                        'DIRECT_EXPENSE', 'RECEIPT', 'TRANSFER',
                        'SUPPLIER_PAYMENT', 'PAYROLL_RUN', 'SALE',
                        'GOODS_RECEIPT', 'STOCK_COUNT', 'ACQUIRER_SETTLEMENT',
                        'GIRO', 'DEPRECIATION_RUN', 'PERIOD_CLOSE',
                        'INTERUNIT_SETTLE')),

    -- What the document cannot be written without.
    requires_party     boolean NOT NULL DEFAULT false,
    requires_reference boolean NOT NULL DEFAULT false,
    -- A second pair of eyes. See the CHECK below: this and posting straight
    -- off a statement line are mutually exclusive by construction.
    requires_approval  boolean NOT NULL DEFAULT false,

    -- Where this category may be offered at all. BANK is a statement line,
    -- CASH a slip written at head office, PETTY_CASH a claim out of the tin,
    -- STORE a shop spending its own takings. Empty is legal and means the
    -- category is documentation: it exists so that a refusal can name it.
    domains         text[] NOT NULL DEFAULT '{}',

    -- May a person turn a bank statement line straight into this, in one act?
    --
    -- False for every category whose money belongs to a document another screen
    -- owns, and false for anything needing a signature. A category can be
    -- perfectly real, perfectly choosable on a cash slip, and still not be
    -- something you do while reading a statement.
    bank_postable   boolean NOT NULL DEFAULT false,

    -- Why not, in the words the person reading the statement needs. Required
    -- exactly when the answer is no: a refusal with no sentence is a dead end,
    -- and a sentence beside a category that is allowed is a sentence nobody
    -- will ever read and nobody will maintain.
    refusal         text CHECK (refusal IS NULL OR btrim(refusal) <> ''),

    -- The client's own account, quoted from their chart. A suggestion for
    -- whoever maps the key on the Account Map screen, never applied.
    expects_account_code text,
    expects_account_name text,

    -- Retired rather than deleted, the same way a bank rule is: a cash document
    -- names the category it was explained by, and a category that could vanish
    -- would leave posted history unable to say why.
    active          boolean NOT NULL DEFAULT true,
    note            text,

    sort_order      integer NOT NULL DEFAULT 100,
    created_by      text NOT NULL DEFAULT 'migration' CHECK (btrim(created_by) <> ''),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      text,
    updated_at      timestamptz,

    -- A category that makes its own document is one that can be posted from a
    -- bank line; one that points at somebody else's document never is.
    CHECK (source_document IN ('DIRECT_EXPENSE', 'RECEIPT', 'TRANSFER')
           OR NOT bank_postable),
    -- Approval is a second person. Categorise-and-post is one person's single
    -- act while reading a statement — the same judgement 0115 made about maker
    -- and checker on a bank line — so the two cannot both be true.
    CHECK (NOT (requires_approval AND bank_postable)),
    -- No is always explained; yes never is.
    CHECK (bank_postable = (refusal IS NULL)),
    -- An expectation is a code and a name or neither. Half of one is a note
    -- nobody can act on.
    CHECK ((expects_account_code IS NULL) = (expects_account_name IS NULL)),
    -- A category that resolves to whatever the caller says would not be a
    -- category. Either it fixes the qualifier or it asks for one.
    CHECK (NOT (qualifier_asked AND qualifier <> ''))
);

CREATE INDEX ix_transaction_category_family
    ON transaction_category (family, sort_order, code) WHERE active;
CREATE INDEX ix_transaction_category_direction
    ON transaction_category (direction) WHERE active;
CREATE INDEX ix_transaction_category_key
    ON transaction_category (semantic_key, qualifier);

COMMENT ON TABLE transaction_category IS
    'The words a person explains money in. About fifty they may choose and twenty they may only be refused with. A category plus a location resolves through account_map to the client twelve-digit code; nothing outside this table names one.';
COMMENT ON COLUMN transaction_category.source_document IS
    'What choosing this produces. DIRECT_EXPENSE, RECEIPT and TRANSFER all make a cash document and differ by what sits on the other side; the KK/KM/TF kind is derived from the two accounts, never from this. Any other value names the document a person should go and find instead, and the category may not be chosen.';
COMMENT ON COLUMN transaction_category.bank_postable IS
    'Whether a bank statement line may be turned straight into this. False whenever the money belongs to a document another screen owns, or whenever a second signature is needed; refusal then says which.';
COMMENT ON COLUMN transaction_category.expects_account_code IS
    'The client ten-digit template this is expected to map to, quoted from their own chart. A suggestion for the Account Map screen; account_map remains the only place a code is chosen.';

-- ---------------------------------------------------------------------------
-- The ones a person may choose
-- ---------------------------------------------------------------------------

INSERT INTO transaction_category
    (code, display_name, family, direction, semantic_key, qualifier, qualifier_asked,
     source_document, requires_party, requires_reference, requires_approval,
     domains, bank_postable, refusal, expects_account_code, expects_account_name,
     sort_order, note)
VALUES

-- Selling costs — 6010110* BIAYA PENJUALAN.
('selling_customer_supplies', 'Customer supplies (kantong belanja)', 'SELLING', 'OUTFLOW',
 'customer_supplies', '', false, 'DIRECT_EXPENSE', false, false, false,
 '{BANK,CASH,PETTY_CASH,STORE}', true, NULL,
 '6010110001', 'Biaya Customer Supplies', 10, NULL),
('selling_promotion', 'Promotion', 'SELLING', 'OUTFLOW',
 'promotion_expense', '', false, 'DIRECT_EXPENSE', false, false, false,
 '{BANK,CASH,STORE}', true, NULL,
 '6010110003', 'Biaya Promosi', 20, NULL),
('selling_advertising', 'Advertising', 'SELLING', 'OUTFLOW',
 'advertising_expense', '', false, 'DIRECT_EXPENSE', true, false, false,
 '{BANK,CASH}', true, NULL,
 '6010110005', 'Biaya Advertising / Iklan', 30, NULL),
('selling_freight_out', 'Delivery, courier and freight out', 'SELLING', 'OUTFLOW',
 'freight_out', '', false, 'DIRECT_EXPENSE', true, false, false,
 '{BANK,CASH,STORE}', true, NULL,
 '6010110007', 'Biaya Pengiriman Barang/kurir/Ekspedisi', 40,
 'Freight IN on merchandise belongs on the goods receipt, not here: it is part of what the stock cost.'),

-- Office and store operations — 6010310* BIAYA ADMINISTRASI DAN UMUM.
('ops_cleaning', 'Cleaning', 'OPERATIONS', 'OUTFLOW',
 'cleaning_expense', '', false, 'DIRECT_EXPENSE', false, false, false,
 '{BANK,CASH,PETTY_CASH,STORE}', true, NULL,
 '6010310001', 'Biaya Kebersihan (Cleaning)', 10, NULL),
('ops_office_supplies', 'Stationery and printing', 'OPERATIONS', 'OUTFLOW',
 'office_supplies', '', false, 'DIRECT_EXPENSE', false, false, false,
 '{BANK,CASH,PETTY_CASH,STORE}', true, NULL,
 '6010310002', 'Alat Tulis Kantor & Barang Cetakan', 20, NULL),
('ops_bank_charges', 'Bank charges', 'OPERATIONS', 'OUTFLOW',
 'bank_admin_fee', '', false, 'DIRECT_EXPENSE', false, false, false,
 '{BANK}', true, NULL,
 '6010310004', 'Biaya Bank HO', 30,
 'BANK only. A bank charge cannot arrive any way but on a statement, and offering it on a petty cash claim would be offering somebody a way to invent one.'),
('ops_telephone', 'Telephone, fax and internet', 'OPERATIONS', 'OUTFLOW',
 'telephone_expense', '', false, 'DIRECT_EXPENSE', false, true, false,
 '{BANK,CASH}', true, NULL,
 '6010310005', 'Biaya Telephone,Facsimile, Modem', 40,
 'The reference is the subscriber number: one bill per line, and a shop with four of them cannot otherwise tell which was paid.'),
('ops_electricity', 'Electricity', 'OPERATIONS', 'OUTFLOW',
 'electricity_expense', '', false, 'DIRECT_EXPENSE', false, true, false,
 '{BANK,CASH}', true, NULL,
 '6010310006', 'Biaya Pemakaian Listrik', 50,
 'The reference is the PLN customer number.'),
('ops_water', 'Water (PDAM)', 'OPERATIONS', 'OUTFLOW',
 'water_expense', '', false, 'DIRECT_EXPENSE', false, true, false,
 '{BANK,CASH}', true, NULL,
 '6010310007', 'Biaya Pemakaian Air Bersih (PDAM)', 60, NULL),
('ops_business_travel', 'Business travel', 'OPERATIONS', 'OUTFLOW',
 'travel_expense', '', false, 'DIRECT_EXPENSE', true, false, false,
 '{BANK,CASH,PETTY_CASH}', true, NULL,
 '6010310008', 'Biaya Perjalanan Dinas', 70,
 'The party is whoever travelled. Money handed over BEFORE the trip is advance_travel, not this.'),
('ops_computer', 'Computer expenses', 'OPERATIONS', 'OUTFLOW',
 'computer_expense', '', false, 'DIRECT_EXPENSE', false, false, false,
 '{BANK,CASH,PETTY_CASH}', true, NULL,
 '6010310011', 'Computer Expenses', 80, NULL),
('ops_consultant', 'Consultant and professional fees', 'OPERATIONS', 'OUTFLOW',
 'consultant_fee', '', false, 'DIRECT_EXPENSE', true, true, false,
 '{BANK,CASH}', true, NULL,
 '6010310022', 'Biaya Konsultan', 90,
 'The reference is the engagement or invoice. PPh 23 withheld on the fee is a separate line against tax_withholding.'),
('ops_vehicle_licence', 'Vehicle licence (STNK, uji KIR)', 'OPERATIONS', 'OUTFLOW',
 'vehicle_licence', '', false, 'DIRECT_EXPENSE', false, true, false,
 '{BANK,CASH,PETTY_CASH}', true, NULL,
 '6010310023', 'Biaya Lisensi Kendaraan ( STNK, Uji Kir)', 100,
 'The reference is the plate.'),
('ops_donation', 'Donation (CSR, zakat)', 'OPERATIONS', 'OUTFLOW',
 'donation_expense', '', false, 'DIRECT_EXPENSE', true, false, true,
 '{CASH,BANK}', false,
 'a donation needs somebody to have agreed to it; key the cash document and have it approved rather than explaining it away on a statement',
 '6010310021', 'Biaya Donasi (CSR, Zakat)', 110, NULL),
('ops_miscellaneous', 'Miscellaneous', 'OPERATIONS', 'OUTFLOW',
 'miscellaneous_expense', '', false, 'DIRECT_EXPENSE', false, false, true,
 '{CASH}', false,
 'miscellaneous is where a thing goes when nobody looked for the right category; if it is genuinely none of the others, key the cash document and have somebody approve it',
 '6010310099', 'Miscellaneous Expences', 120,
 'Deliberately not offered on a bank line and deliberately needing a signature. Every chart has this leaf and every chart has it as the largest expense nobody can explain.'),

-- Maintenance — 6010410* BIAYA PERAWATAN DAN PEMELIHARAAN.
('maint_ffe', 'Fixtures and fittings repair', 'MAINTENANCE', 'OUTFLOW',
 'maintenance_ffe', '', false, 'DIRECT_EXPENSE', false, false, false,
 '{BANK,CASH,PETTY_CASH,STORE}', true, NULL,
 '6010410001', 'BIAYA PERBAIKAN DAN PERAWATAN FFE', 10, NULL),
('maint_software', 'Software maintenance', 'MAINTENANCE', 'OUTFLOW',
 'software_maintenance', '', false, 'DIRECT_EXPENSE', true, true, false,
 '{BANK}', true, NULL,
 '6010410002', 'SOFTWARE MAINTENANCE', 20,
 'A yearly licence paid in advance is prepaid_maintenance, not this; this is the month it belongs to.'),
('maint_building', 'Building repair', 'MAINTENANCE', 'OUTFLOW',
 'maintenance_building', '', false, 'DIRECT_EXPENSE', true, false, false,
 '{BANK,CASH,STORE}', true, NULL,
 '6010410004', 'BIAYA PERBAIKAN DAN PERAWATAN BANGUNAN', 30,
 'Repair keeps the building as it was; an improvement that lengthens its life is a fixed asset and belongs to the asset screen.'),
('maint_vehicle', 'Vehicle repair', 'MAINTENANCE', 'OUTFLOW',
 'maintenance_vehicle', '', false, 'DIRECT_EXPENSE', false, false, false,
 '{BANK,CASH,PETTY_CASH}', true, NULL,
 '6010410006', 'BIAYA PERBAIKAN DAN PERAWATAN KENDARAAN', 40, NULL),

-- Rent — 7010110* BIAYA SEWA.
('rent_land', 'Land rent', 'RENT', 'OUTFLOW',
 'rent_land', '', false, 'DIRECT_EXPENSE', true, true, false,
 '{BANK,CASH}', true, NULL,
 '7010110001', 'Biaya Sewa Tanah', 10, NULL),
('rent_store', 'Store and warehouse rent', 'RENT', 'OUTFLOW',
 'rent_store', '', false, 'DIRECT_EXPENSE', true, true, false,
 '{BANK,CASH}', true, NULL,
 '7010110003', 'Biaya Sewa Bangunan Toko dan Gudang', 20,
 'Rent for a period already run. Rent paid for months ahead is prepaid_store_rent: it is an asset until the months arrive.'),
('rent_staff_house', 'Staff house rent', 'RENT', 'OUTFLOW',
 'rent_staff_house', '', false, 'DIRECT_EXPENSE', true, false, false,
 '{BANK,CASH}', true, NULL,
 '7010110004', 'Biaya Sewa Rumah Dinas / Mess', 30, NULL),

-- Insurance and property — 7010310*, 7020310*.
('insurance_property', 'Property all-risk and fire insurance', 'INSURANCE_PROPERTY', 'OUTFLOW',
 'property_insurance', '', false, 'DIRECT_EXPENSE', true, true, false,
 '{BANK}', true, NULL,
 '7010310001', 'Property All Risk & Fire Insurance', 10,
 'The reference is the policy number.'),
('insurance_vehicle', 'Vehicle insurance', 'INSURANCE_PROPERTY', 'OUTFLOW',
 'vehicle_insurance', '', false, 'DIRECT_EXPENSE', true, true, false,
 '{BANK}', true, NULL,
 '7020310005', 'Biaya Asuransi Kendaraan', 20, NULL),
('property_land_building_tax', 'Land and building tax (PBB)', 'INSURANCE_PROPERTY', 'OUTFLOW',
 'land_building_tax', '', false, 'DIRECT_EXPENSE', false, true, false,
 '{BANK,CASH}', true, NULL,
 '7010310002', 'Biaya Pajak Bumi Dan Bangunan  (PBB)', 30,
 'The reference is the NOP on the SPPT.'),
('property_management_fee', 'Management fee', 'INSURANCE_PROPERTY', 'OUTFLOW',
 'management_fee_expense', '', false, 'DIRECT_EXPENSE', true, true, true,
 '{BANK}', false,
 'a management fee is a related-party charge; key the cash document and have it approved, so somebody has signed for it',
 '7020310004', 'Biaya Management FEE', 40, NULL),

-- Finance cost — 80201*, and the tax the bank withholds on interest it pays us.
('finance_bank_interest', 'Bank loan interest', 'FINANCE_COST', 'OUTFLOW',
 'interest_expense', '', false, 'DIRECT_EXPENSE', false, true, false,
 '{BANK}', true, NULL,
 '8020111001', 'Biaya Bunga Pinjaman Bank', 10,
 'The reference is the facility. Interest and principal arrive on one bank line and are two categories: split the line rather than calling the whole of it one.'),
('finance_leasing_interest', 'Leasing interest', 'FINANCE_COST', 'OUTFLOW',
 'leasing_interest', '', false, 'DIRECT_EXPENSE', false, true, false,
 '{BANK}', true, NULL,
 '8020111002', 'Biaya Bunga Leasing', 20, NULL),
('finance_tax_on_interest', 'Tax withheld on bank interest', 'FINANCE_COST', 'OUTFLOW',
 'tax_on_interest', '', false, 'DIRECT_EXPENSE', false, false, false,
 '{BANK}', true, NULL,
 '8030112001', 'Current Tax Inc/Exp PPH Pasal 25', 30,
 'PPh 4(2) on jasa giro is FINAL — withheld and never recovered — so it is an expense and not a prepaid. The client keeps no leaf of its own for it; ledger.rs says the same thing about the key.'),

-- Tax — 8030112001, the prepaid taxes under 1011302*, the tax payables under
-- 2012101*. What is paid here is the LIABILITY, never the expense: the expense
-- was recognised when the thing that caused it was recognised.
('tax_income_tax', 'Corporate income tax', 'TAX_EXPENSE', 'OUTFLOW',
 'income_tax_expense', '', false, 'DIRECT_EXPENSE', false, true, false,
 '{BANK}', true, NULL,
 '8030112001', 'Current Tax Inc/Exp PPH Pasal 25', 10,
 'The reference is the NTPN off the payment slip.'),
('tax_prepaid_pph25', 'PPh 25 monthly instalment', 'TAX_EXPENSE', 'OUTFLOW',
 'prepaid_tax', 'PPH25', false, 'DIRECT_EXPENSE', false, true, false,
 '{BANK}', true, NULL,
 '1011302002', 'Prepaid - PPh Pasal 25', 20,
 'An instalment is money on account against a tax not yet assessed, so it is an asset and not an expense until the year is settled.'),
('tax_vat_payable', 'VAT payable (PPN keluaran)', 'TAX_EXPENSE', 'OUTFLOW',
 'tax_payable', 'PPN', false, 'DIRECT_EXPENSE', false, true, false,
 '{BANK}', true, NULL,
 '2012101003', 'Hutang  VAT PPN Keluaran', 30,
 'Settling what was already owed. The VAT itself was recognised on the sales and the bills.'),
('tax_withholding_pph21', 'PPh 21 withheld from pay, remitted', 'TAX_EXPENSE', 'OUTFLOW',
 'tax_payable', 'PPH21', false, 'DIRECT_EXPENSE', false, true, false,
 '{BANK}', true, NULL,
 '2012101001', 'Hutang Pajak PPH Pasal 21', 40,
 'This IS allowed from a bank line and payroll is not, and the difference is the whole rule: the expense was recognised when payroll was sealed, and what leaves the bank a fortnight later is the liability being settled.'),

-- Other income — 8010110*.
('income_bank_interest', 'Bank interest received', 'OTHER_INCOME', 'INFLOW',
 'interest_income', '', false, 'RECEIPT', false, false, false,
 '{BANK}', true, NULL,
 '8010110001', 'Pendapatan Bunga Bank', 10, NULL),
('income_rounding', 'Rounding difference', 'OTHER_INCOME', 'BOTH',
 'rounding', '', false, 'RECEIPT', false, false, false,
 '{BANK,CASH}', true, NULL,
 '8010110002', 'Selisih pembulatan', 20,
 'BOTH, because a rounding difference falls either way by definition. The document written is a RECEIVE or a PAY depending on the line, which cash_direction decides from the two accounts.'),
('income_building_rent', 'Building rent received', 'OTHER_INCOME', 'INFLOW',
 'rent_income_building', '', false, 'RECEIPT', true, true, false,
 '{BANK,CASH}', true, NULL,
 '8010110004', 'Pendapatan Sewa Gedung', 30, NULL),
('income_other', 'Other income and expense', 'OTHER_INCOME', 'BOTH',
 'other_income_expense', '', false, 'RECEIPT', true, false, true,
 '{CASH}', false,
 'other income is where money goes when nobody found the right category; key the cash document, say what it was, and have it approved',
 '8010110007', 'Pendapatan (Biaya) Lain-Lain', 40,
 'The client files gains and losses on asset disposal in this same leaf, which ledger.rs maps as asset_disposal_result. Two meanings, one account: allowed by account_map, and worth knowing when this balance is read.'),

-- Prepaid and advances — 1011301* and 1011303*, both qualifiers of keys the
-- ledger already declares.
('prepaid_insurance', 'Insurance paid in advance', 'PREPAID_ADVANCE', 'OUTFLOW',
 'prepaid_expense', 'INSURANCE', false, 'DIRECT_EXPENSE', true, true, false,
 '{BANK}', true, NULL,
 '1011301001', 'Asuransi Bayar Dimuka', 10,
 'A premium covering months ahead is an asset until those months arrive. Releasing it monthly is a journal, not a bank line.'),
('prepaid_store_rent', 'Store rent paid in advance', 'PREPAID_ADVANCE', 'OUTFLOW',
 'prepaid_expense', 'STORE_RENT', false, 'DIRECT_EXPENSE', true, true, false,
 '{BANK}', true, NULL,
 '1011301003', 'Sewa Toko Bayar Dimuka', 20,
 'Indonesian shop leases are paid years up front; booking the whole cheque as rent expense is the single most common way a set of retail books goes wrong.'),
('advance_travel', 'Travel advance', 'PREPAID_ADVANCE', 'OUTFLOW',
 'advance', 'TRAVEL', false, 'DIRECT_EXPENSE', true, false, false,
 '{BANK,CASH}', true, NULL,
 '1011303001', 'Advanced - Travelling', 30,
 'Money out ahead of a receipt. It stays an advance until the person comes back and accounts for it.'),
('advance_purchase', 'Purchase advance', 'PREPAID_ADVANCE', 'OUTFLOW',
 'advance', 'PURCHASE', false, 'DIRECT_EXPENSE', true, true, false,
 '{BANK}', true, NULL,
 '1011303002', 'Advanced  - Purchase', 40,
 'A deposit against an order that has not arrived. Once the goods are received it is the goods receipt that clears it, not this.'),
('advance_contractor', 'Contractor advance', 'PREPAID_ADVANCE', 'OUTFLOW',
 'advance', 'CONTRACTOR', false, 'DIRECT_EXPENSE', true, true, true,
 '{BANK}', false,
 'a contractor advance is money out against work not done; key the cash document and have it approved',
 '1011303003', 'Advanced  - To Contractors', 50, NULL),

-- Receivables — 1011102* PIUTANG LAIN-LAIN. BOTH, because lending and being
-- repaid are the same balance in two directions.
('receivable_employee', 'Employee loan', 'RECEIVABLE', 'BOTH',
 'employee_receivable', '', false, 'DIRECT_EXPENSE', true, false, false,
 '{BANK,CASH}', true, NULL,
 '1011102001', 'PIUTANG PEGAWAI', 10,
 'The party is the employee. A loan repaid by deduction from pay is settled inside the payroll run and never appears here.'),
('receivable_store_head', 'Store manager account', 'RECEIVABLE', 'BOTH',
 'store_head_receivable', '', false, 'DIRECT_EXPENSE', true, false, false,
 '{BANK,CASH}', true, NULL,
 '1011102002', 'PIUTANG KEPALA TOKO', 20, NULL),

-- Financing and equity — 20224*, 3013001*.
('financing_bank_loan', 'Bank loan drawn or repaid', 'FINANCING_EQUITY', 'BOTH',
 'loan_principal', '', true, 'RECEIPT', false, true, false,
 '{BANK}', true, NULL,
 '2022402001', 'Pinjaman Jangka Panjang  Bank BCA', 10,
 'Qualified by bank, so the caller says which facility. Principal only: the interest on the same line is finance_bank_interest.'),
('equity_capital_injection', 'Capital paid in', 'FINANCING_EQUITY', 'INFLOW',
 'paid_in_capital', '', false, 'RECEIPT', true, true, true,
 '{BANK}', false,
 'capital paid in is a shareholder act with a deed behind it; record the deed and key the receipt against it rather than explaining the bank line away',
 '3013001001', 'Modal Setor', 20, NULL),
('equity_owner_drawing', 'Owner drawing (prive)', 'FINANCING_EQUITY', 'OUTFLOW',
 'owner_drawing', '', false, 'DIRECT_EXPENSE', true, false, true,
 '{BANK}', false,
 'a drawing is the owner taking money out; key the cash document and have it approved, so the withdrawal is signed for rather than categorised',
 '3013001004', 'Prive', 30, NULL),

-- Transfers. Money arriving in one pot we hold from another pot we hold, which
-- `cash_direction` turns into a TF document because both sides hold money.
('transfer_to_cash', 'Cash withdrawn to the till', 'TRANSFER', 'BOTH',
 'cash', '', false, 'TRANSFER', false, false, false,
 '{BANK,CASH}', true, NULL,
 '1011001001', 'CASH ON HAND', 10, NULL),
('transfer_petty_cash', 'Petty cash float', 'TRANSFER', 'BOTH',
 'petty_cash', '', false, 'TRANSFER', false, false, false,
 '{BANK,CASH}', true, NULL,
 '1011001002', 'PETTY CASH', 20, NULL),
('transfer_bank_giro', 'Between our giro accounts', 'TRANSFER', 'BOTH',
 'bank_giro', '', true, 'TRANSFER', false, false, false,
 '{BANK}', true, NULL,
 '1011002001', 'Cash In Bank Giro Bank BCA', 30,
 'The qualifier is the OTHER bank. A transfer out of BCA into Mandiri appears on both statements and is one document; matching the second line to it is the first door, not this one.'),
('transfer_bank_savings', 'Between our savings accounts', 'TRANSFER', 'BOTH',
 'bank_savings', '', true, 'TRANSFER', false, false, false,
 '{BANK}', true, NULL,
 '1011003001', 'Cash In Bank Tabungan Bank BCA', 40, NULL),
('transfer_time_deposit', 'To or from a time deposit', 'TRANSFER', 'BOTH',
 'time_deposit', '', true, 'TRANSFER', false, true, false,
 '{BANK}', true, NULL,
 '1011004001', 'TIME DEPOSIT BANK BCA', 50,
 'The reference is the deposit number. Interest credited on maturity is income_bank_interest and a separate line.'),
('transfer_interunit_receivable', 'Money sent to another unit', 'TRANSFER', 'BOTH',
 'affiliate_receivable', '', true, 'INTERUNIT_SETTLE', false, true, false,
 '{BANK}', false,
 'what one unit owes another is settled by an inter-unit settlement, which names both sides; create that rather than putting half of it on this statement',
 '1021401001', 'Piutang Affiliasi Pembiayaan HEAD OFFICE', 60,
 'Refused on purpose. The client keeps 14 receivable leaves and 14 payable ones, and a bank line categorised on one side leaves the other unit''s books to be squared by somebody guessing.'),
('transfer_interunit_payable', 'Money received from another unit', 'TRANSFER', 'BOTH',
 'affiliate_payable', '', true, 'INTERUNIT_SETTLE', false, true, false,
 '{BANK}', false,
 'what one unit owes another is settled by an inter-unit settlement, which names both sides; create that rather than putting half of it on this statement',
 '2012301001', 'Hutang Affiliasi Pembiayaan  HEAD OFFICE', 70, NULL),

-- ---------------------------------------------------------------------------
-- The ones that exist only to be refused
-- ---------------------------------------------------------------------------
--
-- `domains` is `{BANK}` for all of them and `bank_postable` is false. They are
-- on the list precisely so a person looking for "Gaji" finds it, and finds a
-- sentence telling them where to go. A list that omitted them would teach
-- people to pick the nearest wrong thing.

('payroll_salary_operations', 'Salary — shop and warehouse', 'PAYROLL', 'OUTFLOW',
 'payroll_salary_operations', '', false, 'PAYROLL_RUN', false, false, false,
 '{BANK}', false,
 'payroll is paid against a sealed payroll run — find the payment, or seal the run first. The salary expense was recognised when the run was sealed; categorising this line would recognise it a second time and the books would still balance',
 '6010111001', 'Biaya Gaji Karyawan', 10, NULL),
('payroll_salary_office', 'Salary — office', 'PAYROLL', 'OUTFLOW',
 'payroll_salary_office', '', false, 'PAYROLL_RUN', false, false, false,
 '{BANK}', false,
 'payroll is paid against a sealed payroll run — find the payment, or seal the run first',
 '6010210001', 'Biaya Gaji Pegawai', 20, NULL),
('payroll_overtime', 'Overtime', 'PAYROLL', 'OUTFLOW',
 'payroll_overtime', '', false, 'PAYROLL_RUN', false, false, false,
 '{BANK}', false,
 'overtime is earned against an order and paid inside the payroll run — find the payment',
 '6010111002', 'Biaya Lembur', 30, NULL),
('payroll_bpjs', 'BPJS and employee insurance', 'PAYROLL', 'OUTFLOW',
 'payroll_bpjs', '', false, 'PAYROLL_RUN', false, false, false,
 '{BANK}', false,
 'the employer contribution is part of the sealed payroll run and the employee share is withheld inside it — find the payment',
 '6010111006', 'Biaya Asuransi Pegawai / BPJS', 40, NULL),
('payroll_thr', 'Tunjangan Hari Raya', 'PAYROLL', 'OUTFLOW',
 'payroll_thr', '', false, 'PAYROLL_RUN', false, false, false,
 '{BANK}', false,
 'THR is paid against a sealed payroll run — find the payment',
 '6010111007', 'Tunjangan Hari Raya (THR)', 50, NULL),

('sales_cash', 'Cash sales', 'SALES', 'INFLOW',
 'sales_cash', '', false, 'SALE', false, false, false,
 '{BANK}', false,
 'a sale is recognised at the till when it is rung up; this line is the day''s takings reaching the bank — match it to the deposit, or create one',
 '4010110001', 'Penjualan Tunai', 10, NULL),
('sales_debit_card', 'Debit card sales', 'SALES', 'INFLOW',
 'sales_debit_card', '', false, 'SALE', false, false, false,
 '{BANK}', false,
 'a card sale is recognised at the till; what the bank credits is the acquirer settling — match the settlement',
 '4010111001', 'Penjualan Debit Card Bank BCA', 20, NULL),
('sales_credit_card', 'Credit card sales', 'SALES', 'INFLOW',
 'sales_credit_card', '', false, 'SALE', false, false, false,
 '{BANK}', false,
 'a card sale is recognised at the till; what the bank credits is the acquirer settling — match the settlement',
 '4010112001', 'Penjualan Kartu Kredit VISA Card', 30, NULL),
('sales_online', 'Online sales', 'SALES', 'INFLOW',
 'sales_online', '', false, 'SALE', false, false, false,
 '{BANK}', false,
 'an online sale is recognised when it is rung up; the marketplace payout is a settlement — match it',
 '4010113001', 'Penjualan  Online Sendiri', 40,
 'Their own webshop. 4010113002 Penjualan Online Market Place is the other one, and is the same refusal.'),

('inventory_merchandise', 'Merchandise stock', 'INVENTORY_COGS', 'OUTFLOW',
 'inventory', '', false, 'GOODS_RECEIPT', false, false, false,
 '{BANK}', false,
 'stock is valued when it is received — find the goods receipt, or the supplier payment that settled the bill for it',
 '1011201001', 'Persediaan Barang Dagangan', 10, NULL),
('inventory_cost_of_goods', 'Cost of goods sold', 'INVENTORY_COGS', 'OUTFLOW',
 'cogs', '', false, 'GOODS_RECEIPT', false, false, false,
 '{BANK}', false,
 'cost of goods follows the stock out of the door, not the money out of the bank; nothing on a statement can be a cost of goods',
 '5010110001', 'Harga Pokok Pembelian', 20, NULL),
('inventory_damage', 'Damaged merchandise', 'INVENTORY_COGS', 'OUTFLOW',
 'merchandise_damage', '', false, 'STOCK_COUNT', false, false, false,
 '{BANK}', false,
 'damage is written off against the stock it happened to — record it on a count or a write-off',
 '6010110008', 'Biaya  Kerusakan Persediaan Barang Dagangan', 30, NULL),
('inventory_variance', 'Stock count variance', 'INVENTORY_COGS', 'BOTH',
 'stock_loss', '', false, 'STOCK_COUNT', false, false, false,
 '{BANK}', false,
 'a variance is what a count found — record the count',
 '8010110006', 'Kehilangan Barang atau Selisih Stock Opname', 40, NULL),

('payable_supplier', 'Supplier payable', 'PAYABLE', 'OUTFLOW',
 'trade_payable', '', false, 'SUPPLIER_PAYMENT', false, false, false,
 '{BANK}', false,
 'a supplier is paid against a bill — find the payment, or create one so the bill is settled and the balance moves',
 '2012001001', 'Hutang Suppliers  Barang Dagangan', 10, NULL),
('payable_non_merchandise', 'Non-merchandise payable', 'PAYABLE', 'OUTFLOW',
 'non_merchandise_payable', '', false, 'SUPPLIER_PAYMENT', false, false, false,
 '{BANK}', false,
 'a non-merchandise bill is paid against the bill — find the payment, or create one',
 '2012001003', 'Hutang Supplier  Non Barang Dagang', 20, NULL),
('payable_giro_outstanding', 'Giro issued, not cleared', 'PAYABLE', 'OUTFLOW',
 'giro_outstanding', '', true, 'GIRO', false, false, false,
 '{BANK}', false,
 'a giro clearing is the giro board''s act — find the giro and clear it, which is what moves the bank balance',
 '2012002001', 'Outstanding Giro Bank BCA', 30, NULL),

('acquirer_credit_card', 'Credit card receivable', 'ACQUIRER', 'INFLOW',
 'card_receivable_credit', '', false, 'ACQUIRER_SETTLEMENT', false, false, false,
 '{BANK}', false,
 'what the acquirer pays clears a receivable the till already raised — match the settlement, so the fee and the gross are both accounted for',
 '1011101001', 'Piutang kartu Kredit', 10, NULL),
('acquirer_debit_card', 'Debit card receivable', 'ACQUIRER', 'INFLOW',
 'card_receivable_debit', '', false, 'ACQUIRER_SETTLEMENT', false, false, false,
 '{BANK}', false,
 'what the acquirer pays clears a receivable the till already raised — match the settlement',
 '1011101002', 'Piutang Debit Card', 20, NULL),
('acquirer_card_fee', 'Card fee (MDR)', 'ACQUIRER', 'OUTFLOW',
 'card_fee', '', false, 'ACQUIRER_SETTLEMENT', false, false, false,
 '{BANK}', false,
 'the merchant discount is deducted inside the settlement, not charged separately — match the payout and the fee comes with it',
 '6010110002', 'Biaya Credit Card', 30,
 'Acquirers here net the fee off the payout. A line that looks like a standalone card fee is almost always a gross settlement somebody has not matched yet.'),

('depreciation_charge', 'Depreciation', 'DEPRECIATION', 'OUTFLOW',
 'depreciation_expense', '', true, 'DEPRECIATION_RUN', false, false, false,
 '{BANK}', false,
 'depreciation is computed by the monthly run and never leaves the bank; no statement line can be one',
 '7010214001', 'Biaya Depresiasi FFE Office', 10, NULL),
('depreciation_accumulated', 'Accumulated depreciation', 'DEPRECIATION', 'OUTFLOW',
 'accumulated_depreciation', '', true, 'DEPRECIATION_RUN', false, false, false,
 '{BANK}', false,
 'accumulated depreciation is what the runs have added up to — it is written by the run and by disposal, never by hand',
 '1021606001', 'Akum Penyusu - FFE Office', 20, NULL),

('equity_retained_earnings', 'Retained earnings', 'FINANCING_EQUITY', 'BOTH',
 'retained_earnings', '', false, 'PERIOD_CLOSE', false, false, false,
 '{BANK}', false,
 'retained earnings is what closing the year computes; nothing writes to it by hand and no bank line is one',
 '3013001002', 'Laba (Rugi) Ditahan', 40, NULL);
