# Matrix cakupan Finance — 7Soft, frontend-hub, finance-final, finance-lab-2, finance-lab

**Tanggal:** 27 Oktober 2026
**Tujuan:** menjawab “sudah dianalisa semua?” dan “semua sudah tercakup?” dalam satu matrix.
**Sumber:** `finance-7soft/data-coverage.js`, `finance-7soft/base.js` (`HUB`),
`frontend-hub/src/screens/finance/{nav.ts,index.ts}`, import graph empat folder finance.
**Sifat:** analisis. Tidak ada kode frontend-hub yang diubah.

---

## 0. Ringkasan

| Sumber | Menu / layar | Routed | Hidden / orphan | Cakupan 7Soft |
|---|---|---:|---:|---|
| **7Soft** | 25 menu | 25 layar prototipe | — | Pembanding utama |
| **frontend-hub** | 9 pintu · 86 rute · 59 tab · 17 Setup | 86 | 5 path tersembunyi | 22 dari 25 menu punya layar (10 penuh, 12 sebagian) |
| **finance-final** | 34 file | 25 layar / 29 rute | 6 layar nyata + 3 helper | Melengkapi Cash, Payables, Receivables, Month End, Reports |
| **finance-lab-2** | 15 file | 2 rute + 4 dependensi | 9 layar | Hanya Bank Accounts + Reconciliation |
| **finance-lab** | 48 file (33 top-level + 15 engine) | 0 | 31 layar + 15 engine | Tidak dipakai; arsip/referensi |

**Jawaban ringkas:**

- **22 dari 25 menu 7Soft** sudah punya layar hub, tetapi hanya **10 yang penuh**; **12 sebagian**;
  **3 belum punya layar** (`Faktur Penjualan`, `Retur Penjualan`, `Saldo Awal COA`).
- **21 dari 25** punya dukungan backend (16 penuh, 5 sebagian); **4 belum punya padanan
  7Soft penuh** (Info Penjualan, Faktur Penjualan, Retur Penjualan, Laporan Penjualan).
- **Semua menu sudah diinventaris dan dipetakan**; yang belum adalah audit perilaku
  baris-demi-baris untuk layar orphan/lab.

---

## 1. Matrix 25 menu 7Soft

Legenda **Hub**: `Yes` = layar penuh · `Partly` = ada tetapi hidden/parsial/orphan ·
`No` = tidak ada layar. **Backend** menurut `COVER.api`.

| # | Menu 7Soft | Layar hub yang ada | Hub | Backend | Catatan |
|---:|---|---|:---:|:---:|---|
| 1 | Info Kas Bank | lab-2 `bank-accounts`; final `transactions`, `expenses`, `deposits`; finance `bank-transactions`, `bank-rules`, `giro-board` | Partly | Yes | Banyak layar, bukan satu layar 7Soft |
| 2 | BKM · BKK | finance `cash-documents` | Yes | Yes | Form/lifecycle backend |
| 3 | Pencairan BG | finance `giro-board` | Yes | Yes | Board + lifecycle |
| 4 | Laporan Kas/Bank | final `cash`; finance `bank-reconciliation-summary` | Partly | Partly | Tidak semua 20 laporan 7Soft |
| 5 | Info Accounting | final `reports/general-ledger`, `reports/trial-balance`; finance `chart-of-accounts` | Partly | Yes | Tersebar di tiga layar |
| 6 | Transaksi Jurnal | final `journals`; finance `journal-templates` | Yes | Yes | Draft/reverse/template |
| 7 | Closing Periode | final `controls`; finance `periods`, `period-closing` | Partly | Yes | Tidak ada Reprocess 7Soft |
| 8 | Laporan Accounting & Keuangan | final `reports/*`; finance `dimension-results`, `sales-by-division`, `changes-in-equity`, `expenses-by-month`, `withholding-report` | Partly | Partly | Banyak varian 7Soft belum |
| 9 | Info Pembelian | finance `supplier-bills`, `supplier-ledger`, `credit-notes`, `recurring-bills`; final `payable`, `payments`, `financing` | Partly | Yes | Payment instructions/reconciliation orphan |
| 10 | Faktur Pembelian | finance `supplier-bills` | Yes | Yes | Bills + post/hold/match |
| 11 | Invoice Retur Beli | finance `credit-notes` | Yes | Yes | Credit note + refund |
| 12 | Laporan Pembelian | final `payable`; finance `supplier-ledger`; orphan `reports/ageing` | Partly | Partly | AP aging orphan; 17 laporan belum |
| 13 | Info Penjualan | **hidden** final `receivable`; orphan final `sales` | Partly | No | Tidak ada customer ledger |
| 14 | Penjualan Cash · POS | finance `stores`, `stores-cash`; final `sales-postings`, `sales-reconciliation` | Yes | Yes | Sales day/tender |
| 15 | Faktur Penjualan | — | No | No | Sales module; bukan Finance |
| 16 | Retur Penjualan | — | No | No | Sales module; bukan Finance |
| 17 | Laporan Penjualan | finance `sales-by-division`; orphan final `sales`, `reports/sales-register` | Partly | No | Report set 7Soft belum |
| 18 | Account | finance `chart-of-accounts` | Yes | Yes | COA + chart changes |
| 19 | Saldo Awal COA | — | No | Yes | Backend `/opening/*` ada; layar hub tidak |
| 20 | Setting COA | finance `account-links`, `posting-readiness` | Yes | Yes | Links + readiness |
| 21 | Set Up | finance `settings/*`, `setup/*` | Partly | Partly | Number series/payment terms/banking readiness belum |
| 22 | Customer · Supplier · Pajak | finance `supplier-ledger`, `reports/accounts-payable-summary`, `taxes` | Partly | Partly | Supplier master di Procurement/GA; customer master tidak ada |
| 23 | Asset | finance `assets`, `asset-register`, `asset-disposals`, `contractor-projects` | Yes | Yes | Register/disposal/project |
| 24 | User & Group | finance `permissions`; People | Yes | Yes | Role di People |
| 25 | History | finance `chart-changes`/`account-link-history`; audit global | Partly | Yes | Tidak ada layar History Finance |

**Hitungan:**

- Hub: **10 Yes · 12 Partly · 3 No** → 22/25 minimal sebagian.
- Backend: **16 Yes · 5 Partly · 4 No** → 21/25 minimal sebagian.

---

## 2. Matrix 9 pintu frontend-hub

| Pintu | Tab / view | Route | Folder | Padanan 7Soft |
|---|---|---|---|---|
| **Overview** | Overview | `/finance/dashboard` | finance | — (ERP+) |
| **Stores** | Sales by day | `/finance/stores/sales` | finance | Penjualan Cash / Info Penjualan |
| | Sales postings | `/finance/receivables/sales-postings` | finance-final | Penjualan Cash |
| | Settlement | `/finance/receivables/card-settlement` | finance-final | Penjualan Cash / Laporan Penjualan |
| | Deposits | `/finance/cash-bank/deposits` | finance-final | Info Kas / Shop cash |
| | Cash — balances, on hand, petty, float, positions, movements | `/finance/stores`, `/stores/cash-on-hand`, `/stores/petty-cash`, `/stores/cashier-float`, `/cash-bank/petty-cash`, `/cash-bank/cash-transactions` | finance + finance-final | Info Kas / Shop cash |
| | Cash counts / last counted | `/finance/stores/cash-counts`, `/finance/reports/cash-bank` | finance + finance-final | Shop cash |
| **Payables** | Bills / recurring | `/finance/payables/bills`, `/payables/recurring-bills` | finance | Faktur Pembelian / Info Pembelian |
| | Due dates — calendar, aging | `/finance/payables/projection`, `/payables/aging` | finance + finance-final | Laporan Pembelian |
| | Suppliers — summary, ledger | `/finance/reports/accounts-payable-summary`, `/payables/supplier-ledger` | finance-final + finance | Info Pembelian / Customer Supplier |
| | Credit notes | `/finance/payables/credit-notes` | finance | Invoice Retur Beli |
| | Loans | `/finance/financing/loans` | finance-final | — (ERP+) |
| **Cash & Bank** | BKK / BKM | `/finance/cash-bank/bkk`, `/bkm` (+ new/$id) | finance | BKM · BKK |
| | Giro | `/finance/cash-bank/giro` | finance | Pencairan BG |
| | Bank — reconciliation, accounts, statement lines, month summary, rules | `/finance/cash-bank/bank-reconciliation`, `/bank-accounts`, `/bank-transactions`, `/reports/bank-reconciliation-summary`, `/cash-bank/bank-rules` | finance-lab-2 + finance | Info Kas / Laporan Kas |
| | Advances | `/finance/receivables/employee` | finance-final | — (ERP+) |
| **Journal** | Entries | `/finance/accounting/journal-entries` | finance-final | Transaksi Jurnal |
| | Templates | `/finance/setup/journal-templates` | finance | Transaksi Jurnal |
| **Assets** | Register | `/finance/assets/capitalization`, `/reports/asset-register` | finance | Asset |
| | Projects | `/finance/assets/contractor-projects` (+ `$project`) | finance + projects | — (ERP+) |
| | Disposals | `/finance/reports/asset-disposals` | finance | Asset |
| **Month End** | Checklist / closing voucher | `/finance/period-close`, `/closing/period-closing-voucher` | finance-final + finance | Closing Periode |
| | Periods | `/finance/setup/periods` | finance | Closing Periode |
| | Accruals — unbilled, prepaid, balances | `/finance/payables/accruals`, `/accounting/prepaids`, `/accounting/accruals` | finance + finance-final | — (ERP+) |
| | Inventory — stock vs ledger, valuation, in transit, adjustments, COGS | `/finance/inventory/*` | finance | Laporan Accounting (sebagian) |
| | Tax — payables, withheld | `/finance/tax/payables`, `/reports/tax-withholding` | finance-final + finance | — (ERP+) |
| **Reports** | P&L — standard, by unit, expenses/month, by dimension | `/finance/reports/profit-and-loss`, `/profit-and-loss-by-unit`, `/expenses-by-month`, `/dimension-results` | finance-final + finance | Laporan Accounting |
| | Balance sheet — standard, 2 years, equity | `/finance/reports/balance-sheet`, `/balance-sheet-2-years`, `/changes-in-equity` | finance-final + finance | Laporan Accounting |
| | Cash flow | `/finance/reports/cash-flow` | finance-final | Laporan Accounting |
| | Ledger — GL, trial balance | `/finance/accounting/general-ledger`, `/trial-balance` | finance-final | Info Accounting |
| | Sales by division | `/finance/reports/sales-by-division` | finance | Laporan Penjualan |
| **Setup** | Accounts — COA, settings, dimensions | `/finance/accounting/chart-of-accounts`, `/settings/accounts`, `/setup/dimensions` | finance | Account / Set Up |
| | Posting — links, readiness, policies, permissions | `/finance/setup/account-links`, `/posting-readiness`, `/settings/posting-policies`, `/settings/permissions` | finance | Setting COA / Set Up |
| | Categories — pay components, expense, line | `/finance/setup/pay-components`, `/expense-categories`, `/line-categories` | finance + finance-final | Set Up |
| | Payments — methods, shop, EDC/MDR, giro templates | `/finance/setup/payment-methods`, `/shop-payment-methods`, `/edc-mdr`, `/giro-templates` | finance | Set Up |
| | Tax — types, withholding | `/finance/tax-setup/types`, `/withholding` | finance | Customer Supplier Pajak / Set Up |
| | Assets — classes | `/finance/setup/asset-classes` | finance | Asset / Set Up |

---

## 3. Matrix `finance-final` (34 file)

| File | Jenis | Status | Padanan 7Soft / native | Tindakan |
|---|---|---|---|---|
| `transactions.tsx` | layar | Routed | Info Kas | Pertahankan |
| `expenses.tsx` | layar | Routed | Info Kas / Shop cash | Pertahankan |
| `deposits.tsx` | layar | Routed | Info Kas / Shop cash | Pertahankan |
| `cash.tsx` | layar | Routed | Laporan Kas/Bank | Pertahankan |
| `sales-reconciliation.tsx` | layar | Routed | Penjualan Cash / Laporan Penjualan | Pertahankan |
| `advances.tsx` | layar | Routed | Native Advances | Pertahankan |
| `receivable.tsx` | layar | Hidden route | Info Penjualan / Antar unit | Pertahankan; pertimbangkan route/tab |
| `sales-postings.tsx` | layar | Routed | Penjualan Cash | Pertahankan |
| `payments.tsx` | layar | Routed | Info Pembelian | Pertahankan |
| `payable.tsx` | layar | Routed | Laporan Pembelian | Pertahankan |
| `payroll.tsx` | layar | Routed (moved) | Native Payroll | Putuskan HR/Finance |
| `financing.tsx` | layar | Routed | Native Loans | Pertahankan |
| `tax.tsx` | layar | Routed | Native Tax | Pertahankan |
| `journals.tsx` | layar | Routed | Transaksi Jurnal | Pertahankan |
| `controls.tsx` | layar | Routed | Closing Periode | Pertahankan |
| `prepaids.tsx` | layar | Routed | Native Accruals | Pertahankan |
| `prepaid-schedules.tsx` | layar | Routed | Native Prepaids | Pertahankan |
| `categories.tsx` | layar | Routed | Set Up | Pertahankan |
| `reports/balance-sheet.tsx` | layar | Routed | Laporan Accounting | Pertahankan |
| `reports/balance-sheet-2-years.tsx` | layar | Routed | Laporan Accounting | Pertahankan |
| `reports/cash-flow.tsx` | layar | Routed | Laporan Accounting | Pertahankan |
| `reports/general-ledger.tsx` | layar | Routed | Info Accounting | Pertahankan |
| `reports/profit-and-loss.tsx` | layar | Routed | Laporan Accounting | Pertahankan |
| `reports/profit-and-loss-by-unit.tsx` | layar | Routed | Laporan Accounting | Pertahankan |
| `reports/trial-balance.tsx` | layar | Routed | Info Accounting | Pertahankan |
| `payment-instructions.tsx` | layar | **Orphan** | Info Pembelian / BKM-BKK | Route atau merge |
| `payment-reconciliation.tsx` | layar | **Orphan** | Info Pembelian / BKM-BKK | Route atau merge |
| `sales.tsx` | layar | **Orphan** | Info Penjualan / Laporan Penjualan | Route |
| `reports/sales-register.tsx` | layar | **Orphan** | Laporan Penjualan | Route |
| `reports/ageing.tsx` | layar | **Orphan** | Laporan Pembelian | Bandingkan dengan `payable` |
| `period-close.tsx` | layar | **Orphan** | Closing Periode | Bandingkan dengan `controls`; merge/retire |
| `parts.tsx` | helper | Dipakai | — | Pertahankan |
| `reports/two-year.ts` | helper | Dipakai | — | Pertahankan |
| `reports/two-year-controls.tsx` | helper | Dipakai | — | Pertahankan |

---

## 4. Matrix `finance-lab-2` (15 file)

| File | Status | Padanan 7Soft / native | Tindakan |
|---|---|---|---|
| `bank-accounts.tsx` | **Routed** `/cash-bank/bank-accounts` | Info Kas | Pertahankan |
| `bank-reconciliation-list.tsx` | **Routed** `/cash-bank/bank-reconciliation` | Info Kas / Laporan Kas | Pertahankan |
| `bank-reconciliation.tsx` | Dependensi | Info Kas | Pertahankan |
| `bank-reconciliation-paired.tsx` | Dependensi | Info Kas | Pertahankan |
| `hooks.ts` | Dependensi | — | Pertahankan |
| `parts.tsx` | Dependensi | — | Pertahankan |
| `banks.tsx` | **Orphan** | Info Kas | Kandidat retire; superseded `bank-accounts` |
| `bills.tsx` | **Orphan** | Faktur Pembelian | Kandidat retire; superseded `supplier-bills` |
| `cash.tsx` | **Orphan** | Info Kas | Kandidat retire; superseded `final/cash` |
| `cash-counts.tsx` | **Orphan** | Shop cash | Kandidat retire; superseded `finance/stores` |
| `journal.tsx` | **Orphan** | Transaksi Jurnal | Kandidat retire; superseded `final/journals` |
| `journal-entry.tsx` | **Orphan** | Transaksi Jurnal | Kandidat retire |
| `statements.tsx` | **Orphan** | Laporan Kas/Bank | Kandidat retire |
| `trial-balance.tsx` | **Orphan** | Info Accounting | Kandidat retire; superseded `final/reports/trial-balance` |
| `bank-transactions.tsx` | **Orphan** | Info Kas | Kandidat retire; superseded `finance/bank-transactions` |

---

## 5. Matrix `finance-lab` (48 file, 0 import)

Semua baris **Orphan/reference**; tidak ada yang dirutekan. Ini bukan menu hidup.

| Kelompok | File | Padanan / referensi |
|---|---|---|
| Overview | `overview.tsx` | Overview / referensi |
| Cash/bank | `bank.tsx`, `money-accounts.tsx`, `ledger.tsx` | Info Kas / Laporan Kas |
| Payables | `payables.tsx`, `payments.tsx`, `settlements.tsx`, `vendors.tsx` | Info Pembelian / BKM-BKK |
| Sales | `sales.tsx` | Info Penjualan / POS |
| Accounting | `accounting.tsx`, `transactions.tsx`, `periods.tsx`, `close.tsx`, `rules.tsx`, `setup.tsx` | GL / Closing / Set Up |
| Reports | `reports.tsx` | Laporan Accounting |
| Assets | `assets.tsx`, `capital.tsx` | Asset |
| Inventory | `inventory.tsx` | Laporan Accounting |
| Tax | `tax.tsx` | Native Tax |
| Payroll | `payroll.tsx` | Native Payroll |
| Interunit | `interunit.tsx` | Between units |
| Financing | `financing.tsx` | Loans |
| Accruals/prepaids | `accruals.tsx`, `prepaids.tsx` | Month End |
| Store | `store.tsx`, `expenses.tsx` | Stores |
| Contract/signature | `contract.tsx`, `signature.tsx` | Referensi |
| Scenarios/print | `scenarios.tsx`, `print.tsx` | Referensi |
| State/parts | `state.ts`, `parts.tsx` | Helper |
| Engine | `engine/` (15 file) | Referensi skenario |

**Kesimpulan:** `finance-lab` = arsip/referensi. Jangan dipakai sebagai bukti fitur
“sudah ada di hub”.

---

## 6. Apakah semua sudah tercakup?

| Pertanyaan | Jawaban |
|---|---|
| Semua menu 7Soft sudah diinventaris? | **Ya**, 25 baris. |
| Semua menu hub sudah diinventaris? | **Ya**, 9 pintu/86 rute/59 tab/17 Setup. |
| Semua file `finance-final` sudah diklasifikasi? | **Ya**, 34 file: 25 routed, 6 orphan nyata, 3 helper. |
| Semua file `finance-lab-2` sudah diklasifikasi? | **Ya**, 15 file: 2 routed, 4 dependensi, 9 orphan. |
| Semua file `finance-lab` sudah diklasifikasi? | **Ya**, 48 file: 0 routed; 31 layar + helper + 15 engine. |
| Semua menu 7Soft punya layar hub? | **Tidak.** 22/25 minimal sebagian; 3 tanpa layar (Faktur Jual, Retur Jual, Saldo Awal). |
| Semua menu 7Soft punya backend? | **Tidak.** 21/25 minimal sebagian; 4 belum padanan penuh. |
| Semua perilaku layar sudah diaudit baris demi baris? | **Belum.** Inventory + routing sudah; 6 orphan final, 9 orphan lab-2, dan 31 layar lab belum diaudit alur detail. |

---

## 7. Rekomendasi

1. **7Soft-first:** pakai matrix §1 sebagai backlog parity 25 menu; jangan pindah ke 9 pintu
   sebelum 25 menu stabil.
2. **`finance-final`:** route `payment-instructions`, `payment-reconciliation`, `sales`,
   `sales-register`; bandingkan `ageing` vs `payable`, `period-close` vs `controls`.
3. **`finance-lab-2`:** pertahankan 2 route + 4 dependensi; retire 9 orphan setelah diff.
4. **`finance-lab`:** arsip/referensi; hapus setelah pemilik setuju.
5. **Coverage page:** sudah 25 baris 7Soft (16 backend penuh, 5 sebagian, 4 belum);
   `Shop cash`/`Between units` dipindah ke hitungan native.
6. **Jangan ubah frontend-hub dulu**; matrix ini dipakai untuk memutuskan nanti.
