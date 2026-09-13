# Finance — coverage against the client's chart of accounts

Source: `Laporan_Master_Account1.csv`, CENTRAL FASHION STORE.

**7,528 rows** on the client's six-rung ladder (1, 3, 5, 7, 10, 12 characters):
**76 families** at the seven-character rung, **496 accounts** at ten, **6,902 postable leaves** at twelve.

Every one of the 76 families has a screen that owns it — 6,902 of 6,902 leaves, 100%. The table below says which, so the claim can be checked rather than believed.

The whole chart is loaded into the prototype: `Accounting & close → Chart of accounts` lists all
7,528 rows, of which 6,902 are postable and **997 bindings across all 14 units** cover 55 roles and
26 rule packages — 23 live, 3 deliberately off (`interunit_receipt`, `oe_reserve_accrual`,
`card_clearing_at_checkout`), each refusing with the evidence it is waiting on.

Every subledger on these screens is posted, not typed: bills, advances, prepaids, payroll payables,
staff loans and card receivables each agree to the rupiah with their account in the trial balance,
and every action moves both together or fails.


## Affiliation — 8 families, 1,386 leaves

| Family | Name | Accounts | Leaves | Where it lives |
|---|---|---:|---:|---|
| `1021401` | PIUTANG AFFILIASI PEMBIAYAAN | 14 | 196 | Funding · Due from / due to |
| `1021402` | PIUTANG AFFILIASI ATAS BARANG | 14 | 196 | Due from / due to |
| `1021403` | PIUTANG AFFILIASI LAIN-LAIN | 14 | 196 | Due from / due to |
| `2012301` | HUTANG AFFILIASI PEMBIAYAAN | 14 | 196 | Due from / due to |
| `2012302` | HUTANG AFFILIASI ATAS BARANG | 14 | 196 | Due from / due to |
| `2012303` | HUTANG LAIN-LAIN PRINCIPAL | 14 | 196 | Due from / due to |
| `2012304` | HUTANG LAIN - LAIN | 14 | 196 | Due from / due to |
| `4020110` | Management Fee | 1 | 14 | Settlements — management fee · Reports → P&L |

## Assets — 25 families, 2,408 leaves

| Family | Name | Accounts | Leaves | Where it lives |
|---|---|---:|---:|---|
| `1021501` | Tanah | 2 | 28 | Asset register |
| `1021502` | Bangunan | 3 | 42 | Asset register |
| `1021503` | Instalasi | 1 | 14 | Asset register |
| `1021504` | Machineries | 4 | 56 | Asset register |
| `1021505` | Kendaraan | 2 | 28 | Asset register |
| `1021506` | Furniture, Fixture & Equipment | 7 | 98 | Asset register |
| `1021507` | Operating Equipment | 36 | 504 | Asset register |
| `1021601` | Akumulasi Penyusu -Tanah | 1 | 14 | Asset register — accumulated · Depreciation |
| `1021602` | Akum-Penyusu - Bangunan | 3 | 42 | Asset register — accumulated · Depreciation |
| `1021603` | Akum-Penyusu - Instalasi | 1 | 14 | Asset register — accumulated · Depreciation |
| `1021604` | Akum-Penyusu - Mesin | 4 | 56 | Asset register — accumulated · Depreciation |
| `1021605` | Akum-Penyusu Kendaraan | 2 | 28 | Asset register — accumulated · Depreciation |
| `1021606` | Akum-Penyusu - FFE | 7 | 98 | Asset register — accumulated · Depreciation |
| `1021607` | Reserve Replacement - Operating Equipment | 36 | 504 | OE replacement |
| `1021701` | Software | 2 | 28 | Asset register — software |
| `1021702` | Acc Amort Software | 2 | 28 | Depreciation & amortisation |
| `1031802` | Pre Opening | 2 | 28 | Pre-opening |
| `1031803` | Contract In Progress (CIP) | 1 | 14 | Projects / CIP |
| `7010210` | BIAYA DEPRESIASI BANGUNAN | 3 | 42 | Depreciation & amortisation · Reports → P&L |
| `7010211` | BIAYA DEPRESIASI INSTALASI, MEKANIKAL, ELEKTRIKAL | 1 | 14 | Depreciation & amortisation · Reports → P&L |
| `7010212` | BIAYA DEPRESIASI MESIN | 4 | 56 | Depreciation & amortisation · Reports → P&L |
| `7010213` | BIAYA DEPRESIASI KENDARAAN | 2 | 28 | Depreciation & amortisation · Reports → P&L |
| `7010214` | BIAYA DEPRESIASI FFE | 7 | 98 | Depreciation & amortisation · Reports → P&L |
| `7010215` | BIAYA REPLACEMENT OPERATING EQUIPMENT | 36 | 504 | OE replacement · Reports → P&L |
| `7010216` | BIAYA AMORTISASI INTANGIBLE ASSET AND OTHER ASSET | 3 | 42 | Depreciation & amortisation · Reports → P&L |

## Cash & bank — 5 families, 266 leaves

| Family | Name | Accounts | Leaves | Where it lives |
|---|---|---:|---:|---|
| `1011001` | CASH ON HAND | 3 | 42 | Accounts · Transactions |
| `1011002` | CASH IN BANK GIRO | 5 | 70 | Accounts · Transactions · Reconcile |
| `1011003` | CASH IN BANK TABUNGAN | 5 | 70 | Accounts · Transactions · Reconcile |
| `1011004` | TIME DEPOSIT | 4 | 14 | Accounts |
| `2012002` | OUTSTANDING GIRO | 5 | 70 | Transactions — giro status · shown on the Bill that raised it |

## Expenses & bills — 9 families, 952 leaves

| Family | Name | Accounts | Leaves | Where it lives |
|---|---|---:|---:|---|
| `1011301` | BIAYA DIBAYAR DIMUKA | 9 | 126 | Prepaids |
| `1011303` | UANG MUKA / ADVANCED | 4 | 56 | Advances |
| `2012001` | HUTANG SUPPLIER | 3 | 42 | Suppliers · Vendors · Bills |
| `6010110` | BIAYA PENJUALAN | 8 | 112 | Expenses · Reports → P&L |
| `6010310` | BIAYA ADMINISTRASI DAN UMUM | 25 | 350 | Expenses · Reports → P&L |
| `6010410` | BIAYA PERAWATAN DAN PEMELIHARAAN | 10 | 140 | Expenses · Reports → P&L |
| `7010110` | BIAYA SEWA | 4 | 56 | Prepaids · Accounting → Accruals & deferrals |
| `7010310` | — | 2 | 28 | Prepaids — insurance & PBB · Reports → P&L |
| `7020310` | BIAYA USAHA LAINNYA | 3 | 42 | Expenses · Reports → P&L |

## Financing — 6 families, 252 leaves

| Family | Name | Accounts | Leaves | Where it lives |
|---|---|---:|---:|---|
| `2012501` | PJP JATUH TEMPO - PRINCIPAL | 1 | 14 | Repayments — principal, falling due |
| `2012502` | PJP JATUH TEMPO - BANK | 5 | 70 | Repayments — bank, falling due |
| `2022401` | Pinjaman Jangka Panjang Principal | 1 | 14 | Loans — principal |
| `2022402` | Pinjaman Jangka Panjang Bank | 5 | 70 | Loans — bank |
| `3013001` | MODAL | 4 | 56 | Equity |
| `8020111` | BIAYA BUNGA | 2 | 28 | Repayments — interest · Reports → P&L |

## Inventory — 7 families, 602 leaves

| Family | Name | Accounts | Leaves | Where it lives |
|---|---|---:|---:|---|
| `1011201` | Persediaan Barang Dagang | 1 | 14 | Valuation |
| `1011202` | Persediaan Kantong Belanja | 10 | 140 | Valuation — kantong belanja |
| `1011203` | Barang Dalam Perjalanan Barang Dagangan | 14 | 196 | BDP / in transit |
| `1011204` | Barang Dalam Perjalanan Kantong Belanja | 14 | 196 | BDP / in transit |
| `1011299` | Cadangan Kerusakan atau kehilangan Barang | 2 | 28 | Adjustments · Accounting → Provisions |
| `1031801` | Disposed Inventory | 1 | 14 | Adjustments — disposed |
| `5010110` | HARGA POKOK PEMBELIAN | 1 | 14 | Valuation · Reports → P&L |

## Payroll — 3 families, 504 leaves

| Family | Name | Accounts | Leaves | Where it lives |
|---|---|---:|---:|---|
| `2012201` | ACCRUED EXPENSE (BIAYA YANG MASIH HARUS DIBAYAR) | 10 | 140 | Payables — and Expenses, Financing, Accounting → Accruals |
| `6010111` | BIAYA PEGAWAI OPERATION | 13 | 182 | Overview · Reports → P&L |
| `6010210` | BEBAN PEGAWAI OFFICE | 13 | 182 | Overview · Reports → P&L |

## Receivables — 6 families, 224 leaves

| Family | Name | Accounts | Leaves | Where it lives |
|---|---|---:|---:|---|
| `1011101` | PIUTANG DAGANG | 2 | 28 | Receivables · Settlements |
| `1011102` | PIUTANG LAIN-LAIN | 3 | 42 | Receivables — staff & management filter |
| `1011103` | CADANGAN PENGHAPUSAN PIUTANG TAK TERTAGIH | 3 | 42 | Receivables — allowance · Accounting → Provisions |
| `4010111` | Penjualan Kartu Debit | 4 | 56 | Settlements — debit · Reports → P&L |
| `4010112` | Penjualan Kartu Kredit | 2 | 28 | Settlements — credit · Reports → P&L |
| `4010113` | Penjualan Online | 2 | 28 | Settlements — marketplace · Reports → P&L |

## Reports — 1 families, 98 leaves

| Family | Name | Accounts | Leaves | Where it lives |
|---|---|---:|---:|---|
| `8010110` | PENDAPATAN DAN (BIAYA) LAIN - LAIN | 7 | 98 | Profit & loss — non-operating |

## Sales — 3 families, 42 leaves

| Family | Name | Accounts | Leaves | Where it lives |
|---|---|---:|---:|---|
| `4010110` | Penjualan Tunai | 1 | 14 | Reconcile · Reports → P&L |
| `4010213` | Discount / Potongan Penjualan | 1 | 14 | Reconcile · Reports → P&L |
| `4010214` | Retur Penjualan | 1 | 14 | Reconcile · Reports → P&L |

## Tax — 3 families, 168 leaves

| Family | Name | Accounts | Leaves | Where it lives |
|---|---|---:|---:|---|
| `1011302` | PAJAK BAYAR DIMUKA/PREPAID TAX | 6 | 84 | Tax position — prepaid side |
| `2012101` | HUTANG PAJAK | 5 | 70 | Tax position — payable side |
| `8030112` | PAJAK PENGHASILAN | 1 | 14 | Overview · Reports → P&L |
