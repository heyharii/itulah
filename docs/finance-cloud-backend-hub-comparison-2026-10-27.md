# Komparasi Finance — Backend Cloud ↔ Finance Hub ↔ Prototipe 7Soft

**Tanggal:** 27 Oktober 2026
**Sumber:** `backend/src/cloud/http/*` (280 path `/api/v1/finance`), `frontend-hub/src/screens/finance/nav.ts`
(9 pintu · 86 rute · 59 tab · 17 Setup), `frontend-hub/src/screens/finance/index.ts`
(91 path terdaftar), `finance-7soft-prototype.html` (40 menu), `docs/finance-navigation.md`,
`docs/finance-menu.md`.
**Sifat:** analisis. Tidak ada kode yang diubah.

---

## 0. Jawaban singkat

**Belum sesuai, tetapi masalahnya bukan backend kurang lengkap.** Backend cloud justru
paling maju: **280 path finance** dengan siklus tulis/baca untuk kas, bank, giro, tagihan,
pembayaran, jurnal, tutup buku, aset, persediaan, pajak, setup, dan opening.

Tiga lapisan hari ini:

| Lapisan | Isi | Kondisi |
|---|---|---|
| **Backend cloud** | 280 path `/api/v1/finance` + payroll/supplier/payment-terms di modul tetangga | **Kuat**; beberapa lubang kecil (interunit write, changes-in-equity, payroll facade) |
| **Finance hub** | 9 pintu · 86 rute · 59 tab · 17 Setup | **Baik untuk alur harian**, tetapi tidak semua kemampuan backend punya layar/rute |
| **Prototipe 7Soft** | 40 menu (25 7Soft + 14 native + 1 referensi) | **Tidak terhubung backend sama sekali**; semua angka demo, aksi lokal |

**Kesimpulan:** domain-nya sebagian besar sudah ada di backend. Menurut Coverage 25 menu
7Soft: **16 punya padanan backend, 5 sebagian, 4 belum punya padanan 7Soft penuh**
(Info Penjualan, Faktur Penjualan, Retur Penjualan, Laporan Penjualan). Dari 14 menu native:
**12 penuh, 2 sebagian** (Inter-unit, Payroll). Yang belum sesuai adalah **kontrak menu,
rute, status, dan wiring layar**. Pekerjaan utama: menyatukan menu ke 9 pintu,
memetakan setiap layar ke endpoint, menambah rute hub yang hilang, dan menyamakan istilah/status.

### Enam gap terbesar

1. **Prototipe tidak memanggil backend.** Tidak ada `fetch`/`/api/v1` di `finance-7soft`.
2. **Hub belum menampilkan beberapa kemampuan backend:** payment batches, payment destinations,
   payment instructions, supplier advances, opening balances, inter-unit, payroll handover,
   integrity/ledger health, number series, banking readiness, statement intake/sources,
   tax filings/settlements, asset reserve, receipts awaiting posting.
3. **Menu prototipe masih 7Soft-centric** (6 grup, 25 baris 7Soft) sementara hub sudah 9 pintu;
   native group baru menambal, belum menjadi kontrak rute.
4. **Tiga baris 7Soft tidak punya padanan backend/hub:** Info Penjualan, Faktur Penjualan,
   Retur Penjualan (customer AR/invoice/return). Untuk strategi 7Soft-first, ketiganya
   **tetap dipertahankan di lapisan 7Soft** dan dijembatani ke Sales/Receivables atau ditandai
   legacy read-only — jangan dihapus sebelum parity disetujui.
5. **Status dan istilah berbeda:** bill `Paid/Overdue` vs `DRAFT/MATCHED/POSTED/REJECTED/VOID`;
   giro `New/Bounced` vs `ISSUED/DELIVERED/DUE/CLEARED/REJECTED`; deposit `In transit` vs
   `PREPARED/DEPOSITED/CONFIRMED/CANCELLED`.
6. **Beberapa alur ditulis lokal di prototipe** (BKM/BKK, rekonsiliasi, opening, transfer,
   payroll) padahal backend sudah punya lifecycle approve/post/reverse yang harus dipakai.

---

## 1. Bukti angka

| Ukuran | Angka |
|---|---:|
| Path unik `/api/v1/finance` | **280** |
| Path finance terdaftar di hub (`index.ts`) | **91** |
| Rute navigasi hub (`nav.ts`) | **86** |
| Tab hub | **59** |
| Destinasi Setup hub | **17** |
| Menu prototipe | **40** (25 7Soft + 14 native + 1 referensi) |
| Panggilan backend dari prototipe | **0** |

**Folder hub:** `screens/finance` 74 file / 45 di-import / 59 rute; `screens/finance-final`
34 file / 25 di-import / 29 rute; `screens/finance-lab-2` 15 file / 2 rute langsung + 4
dependensi; `screens/finance-lab` 48 file / **0 import**. Rincian di
[`finance-hub-folder-audit-2026-10-27.md`](./finance-hub-folder-audit-2026-10-27.md).

Backend juga memakai modul tetangga yang tidak masuk hitungan 280:

- `/api/v1/payroll/*` — payroll runs, loans, **finance handover**, settlement.
- `/api/v1/suppliers` — supplier master.
- `/api/v1/payment-terms` — termin pembayaran.
- `/api/v1/records/bill/{id}/info` — gate tagihan.
- `/api/v1/reports/sales/*` — sales explorer/breakdown.

`docs/finance-navigation.md` sendiri menulis bahwa 86 rute itu **tidak** berarti semua form
transaksi dan laporan legacy sudah pindah ke desain sekarang. Jadi angka nav bukan bukti
kelengkapan.

---

## 2. Peta tiga lapis per domain

Legenda: **✅** ada dan memadai · **◐** sebagian/embedded/read-only · **—** tidak ada.

| Domain | Backend | Hub | Prototipe | Catatan |
|---|---|---|---|---|
| Accounts, ledger, trial balance, statements | ✅ | ✅ | ✅ | `/accounts`, `/journal`, `/trial-balance`, `/statement`, `/reports/*`; hub Ledger/Reports |
| Cash documents (BKM/BKK) | ✅ | ✅ | ◐ | `/cash-documents` + approve/post/reverse/slip/repeats; prototipe masih lokal |
| Cash counts | ✅ | ✅ | ◐ | `/cash-counts` + post; prototipe `Shop cash` lokal |
| Deposits | ✅ | ✅ | ◐ | `/deposits` + bank/land; status backend `PREPARED/DEPOSITED/CONFIRMED/CANCELLED` |
| Sales day & sales postings | ✅ | ✅ | ◐ | `/sale-days`, `/sales-postings`, exceptions; prototipe Stores statis |
| Store tender reconciliation | ✅ | ◐ | ◐ | `/store/{unit}/tender-recon`; hub lewat Card & EDC/Stores |
| Bank accounts & statements | ✅ | ✅ | ◐ | `/bank-accounts`, `/bank-statements`, `/bank-lines`; hub Bank |
| Bank rules & proposals | ✅ | ✅ | ◐ | `/bank-rules`, `/bank-proposals`; prototipe recon lokal |
| Banking readiness / statement intake | ✅ | — | — | backend ada, UI belum |
| Giros | ✅ | ✅ | ◐ | `/giros` + board/deliver/due/clear/reject/replace |
| Bills & credit notes | ✅ | ✅ | ◐ | `/bills`, `/credit-notes`, `/bill-templates`; prototipe buy rows statis |
| Supplier advances | ✅ | ◐ | ◐ | backend 4 rute; hub hanya di dalam BKK; 7Soft punya **Uang Muka Pembelian** di Faktur Pembelian |
| Payables aging & supplier ledger | ✅ | ✅ | ◐ | `/payables-aging`, `/payment-ledger`; hub Due/Suppliers |
| Payments & payment batches | ✅ | ◐ | ◐ | `/payments`, `/payment-batches`; hub belum punya layar batch |
| Payment instructions/destinations | ✅ | ◐ | — | backend 9 rute; layar instructions/reconciliation ada di `finance-final` tetapi belum dirutekan |
| Three-way / bill match | ✅ | ◐ | — | `/three-way`, `/bills/{id}/match`; perlu dipastikan dipakai layar Bills |
| Journal, drafts, repeats, corrections | ✅ | ◐ | ◐ | `/journal`, `/journal-repeats`, `/corrections`; hub Entries/Templates |
| Periods, closing, checklist, closing voucher | ✅ | ✅ | ◐ | `/periods`, `/close/*`, `/period-closing-vouchers`; hub Month End |
| Accruals, prepaids, unbilled | ✅ | ✅ | ◐ | `/accruals`, `/prepaid/*`, `/unbilled`; hub Month End/Journal |
| Assets, depreciation, reserve, disposal, transfer | ✅ | ◐ | ◐ | `/assets/*`, `/depreciation/*`, `/assets/reserve/*`; hub Register/Projects/Disposals |
| Contractor projects / CIP | ✅ | ✅ | ◐ | `/contractor-projects/*`; hub Assets Projects |
| Inventory valuation, COGS, in-transit, adjustments | ✅ | ✅ | ◐ | `/inventory/*`, `/valuation`, `/stock-ledger`; hub Month End |
| Tax types, periods, reconciliation, filings, settlements | ✅ | ◐ | ◐ | `/tax/*`; hub Tax hanya types/periods/reconciliation |
| Inter-unit | ◐ | ◐ | ◐ | `/interunit/pairs`, `/{unit}` read-only; baris between-units ada di hidden `finance-final/receivable`, tanpa route/tab khusus |
| Opening balances | ✅ | — | ◐ | `/opening/*`; tidak ada rute hub; prototipe native Opening statis |
| Payroll finance | ◐ | — | ◐ | `/payroll/runs/{id}/finance-handover`; hub memindahkan payroll ke HR/Journal |
| Setup: posting readiness, policies, permissions | ✅ | ✅ | ◐ | hub 17 destinasi; prototipe native Setup statis |
| Setup: number series, categories, EDC, giro templates, tax types, asset classes | ✅ | ◐ | ◐ | sebagian ada di hub, number series/banking readiness belum |
| Controls, attention, integrity, ledger health | ✅ | ◐ | ◐ | `/controls`, `/attention`, `/integrity`, `/ledger-health`; integrity/ledger health tidak punya rute |
| Reports: P&L, BS, cash flow, unit, dimension, expenses, sales division | ✅ | ✅ | ◐ | `/statement`, `/reports/*`; changes-in-equity dihitung di UI |

---

## 3. Matriks 25 menu 7Soft

Kolom **Backend** menunjuk keluarga endpoint, bukan satu endpoint. **Prototipe ✅** berarti
layar ada dan bisa diklik, bukan berarti terhubung server.

| # | Menu 7Soft | Backend | Hub | Prototipe | Gap / tindakan |
|---:|---|---|---|---|---|
| 1 | Info Kas Bank | ✅ accounts, balances, statement, cash-documents, bank-*, deposits, cash-counts, giros, advances | ✅ Stores › Cash; Cash & Bank › Bank | ✅ `kas-info` + Reconciliation | Wire ke `/accounts`, `/bank-statements`, `/bank-lines`, `/cash-counts`; ganti state lokal |
| 2 | BKM · BKK | ✅ `/cash-documents` + approve/post/reverse/slip/repeats | ✅ Cash & Bank › BKK/BKM | ◐ external + form lokal | Wire; jangan `post` lokal |
| 3 | Pencairan BG | ✅ `/giros` + board/deliver/due/clear/reject/replace | ✅ Cash & Bank › Giro | ◐ external | Wire status `ISSUED…REJECTED` |
| 4 | Laporan Kas/Bank | ◐ banyak endpoint, tidak satu laporan | ◐ bank rec summary, cash last counted | ✅ 20 laporan | Definisikan laporan → endpoint; tambah route hub yang kurang |
| 5 | Info Accounting | ✅ accounts, journal, trial-balance, statement, ledger-health | ✅ Reports › Ledger; Setup › COA | ✅ | Wire; tampilkan ledger-health |
| 6 | Transaksi Jurnal | ✅ journal, drafts, submit, reverse, templates, repeats, corrections | ✅ Journal › Entries/Templates | ◐ | Wire draft/submit/reverse; tambah repeats/corrections |
| 7 | Closing Periode | ✅ periods, checklist, close/soft/reopen, closing vouchers | ✅ Month End › Checklist/Periods | ◐ | Wire; pakai `SOFT_CLOSED` juga |
| 8 | Laporan Accounting & Keuangan | ✅ statement, P&L, BS, CF, unit, dimension, expenses, sales division, withholding | ✅ Reports | ◐ | Wire; `changes-in-equity` masih dihitung UI |
| 9 | Info Pembelian | ✅ bills, bill-templates, credit-notes, supplier-advances, payables-aging, payment-ledger, batches | ✅ Payables | ◐ | Wire; tambah supplier advances + batches |
| 10 | Faktur Pembelian | ✅ bills + match/post/hold/release/return/warnings + three-way | ✅ Payables › Bills | ◐ | Wire; status tagihan dari alokasi, bukan kolom “Paid” |
| 11 | Invoice Retur Beli | ✅ credit-notes + post/refund | ✅ Payables › Credit notes | ◐ | Wire |
| 12 | Laporan Pembelian | ✅ payables-aging, payment-ledger/aging/integrity, bill-templates | ✅ Payables › Due/Suppliers | ◐ | Wire; tambah payment-ledger integrity |
| 13 | Info Penjualan | ◐ sales postings/receipts/acquirer, **tanpa debtor book** | ◐ hidden `/finance/receivables/aging` (`finance-final/receivable`); orphan `finance-final/sales` | ◐ customer hub | **Pertahankan di lapisan 7Soft**; bridge ke Sales/Receivables atau legacy read-only |
| 14 | Penjualan Cash · POS | ✅ sale-days, sales-postings, exceptions, tender-recon | ✅ Stores › Sales/Sales postings | ◐ | Wire; tampilkan exception |
| 15 | Faktur Penjualan | — (Sales module) | — | ◐ | **Pertahankan di lapisan 7Soft**; bridge ke Sales atau legacy |
| 16 | Retur Penjualan | — (Sales module) | — | ◐ | **Pertahankan di lapisan 7Soft**; bridge ke Sales atau legacy |
| 17 | Laporan Penjualan | ◐ sales-by-division, sales-postings, acquirer | ◐ Reports › Sales by division + orphan `finance-final/sales` / `reports/sales-register` | ◐ | Pindahkan laporan penjualan ke Sales; sisakan finance view |
| 18 | Account | ✅ accounts + chart-changes | ✅ Setup › COA | ✅ | Wire; samakan 10/12 digit |
| 19 | Saldo Awal COA | ✅ opening/balances, stock, subledger, report | — | ◐ | **Tambah rute hub** dan wire |
| 20 | Setting COA | ✅ account-links, history, posting-readiness, policies, party-links | ✅ Setup › Account links/Readiness | ◐ | Wire; tambah policies/party-links |
| 21 | Set Up | ✅ settings, number-series, permissions, dimensions, policies, payment methods, EDC, categories, giro templates, tax types, asset classes | ◐ 17 Setup | ◐ | Tambah number series/banking readiness; wire |
| 22 | Customer · Supplier · Pajak | ◐ supplier master + payment-terms di modul lain; tax types | ◐ Payables › Suppliers; Tax Setup | ◐ | **Pertahankan tampilan 7Soft**; supplier write ke `/api/v1/suppliers`, customer ke Sales/CRM |
| 23 | Asset | ✅ assets, depreciation, reserve, classes, dispose/transfer/assess, projects | ✅ Assets › Register/Projects/Disposals | ◐ | Wire; tambah reserve |
| 24 | User & Group | ◐ `/finance/permissions`; role di People/auth | ✅ Setup › Permissions; People | ◐ | Wire permissions; role tetap di People |
| 25 | History | ◐ audit log di luar finance; chart-changes/controls | ◐ activity log | ◐ | Tambah activity finance; before/after |

---

## 4. Matriks 14 menu native + referensi

| # | Menu native | Backend | Hub | Prototipe | Gap / tindakan |
|---:|---|---|---|---|---|
| 1 | Overview | ✅ attention, balances, money, payables-aging, inventory/valuation, statement, payment-ledger | ✅ Overview | ✅ | Compose dari 6–7 endpoint; jangan angka statis |
| 2 | Stores | ✅ sale-days, sales-postings, tender-recon, acquirer, deposits, cash-counts | ✅ Stores | ✅ | Wire semua tab |
| 3 | Payables | ✅ bills, bill-templates, payables-aging, payment-batches, facilities, payment-ledger | ◐ Payables (tanpa batches/advances) | ✅ | Tambah batches + supplier advances; wire |
| 4 | Cash & Bank | ✅ bank-rules, bank-statements, bank-lines, readiness, giros, advances, deposits | ✅ Cash & Bank | ✅ | Wire; tambah banking readiness |
| 5 | Journal | ✅ journal, templates, repeats, accruals, prepaid, corrections | ◐ Journal + Month End | ✅ | Wire repeats/corrections/prepaid |
| 6 | Month End | ✅ inventory, tax, periods, close, accruals, prepaid, unbilled | ✅ Month End | ✅ | Wire; tambah tax filings/settlements |
| 7 | Assets | ✅ assets, depreciation, reserve, projects, disposals, classes | ✅ Assets | ✅ | Wire reserve/depreciation |
| 8 | Reports | ✅ P&L, BS, CF, unit, dimension, expenses, sales division, trial balance, withholding | ✅ Reports | ✅ | Wire; equity tetap dihitung UI atau tambah endpoint |
| 9 | Setup | ✅ seluruh setup finance | ◐ 17 Setup | ✅ | Tambah number series/payment terms/banking readiness |
| 10 | Inter-unit | ◐ pairs/unit read-only | ◐ hidden in `finance-final/receivable`; no dedicated route | ✅ | **Butuh endpoint tulis** atau posting lewat Journal; tambah route hub |
| 11 | Payroll | ◐ `/payroll/*` finance handover | — | ✅ | Tambah facade finance atau link dari HR |
| 12 | Opening | ✅ `/opening/*` | — | ✅ | **Tambah rute hub** dan wire |
| 13 | Shop cash | ✅ sale-days, deposits, cash-counts, cash-documents | ✅ Stores › Cash | ✅ | Wire; status deposit `PREPARED…CONFIRMED` |
| 14 | Between units | ◐ interunit read-only | ◐ hidden in `finance-final/receivable` | ◐ | Sama dengan Inter-unit |
| — | Replica 7Soft | — | — | ref | Referensi; jangan jadi menu produk |

---

## 5. Backend yang belum punya layar hub

Ini daftar yang paling berdampak. “Tidak ada rute” berarti tidak ada path di `nav.ts` /
`index.ts`, bukan berarti tidak ada query.

| Kemampuan | Endpoint backend | Bukti UI | Rekomendasi |
|---|---|---|---|
| Payment batches | `/payment-batches` (5) | Tidak ada rute; hanya disebut di komentar | Tambah Payables › Batches / Payments |
| Payment destinations | `/payment-destinations` (3) | Tidak ada query | Tambah Setup › Payment destinations |
| Payment instructions | `/payment-instructions` (6) | `finance-final/payment-instructions.tsx` ada, tidak dirutekan | Rutekan ke Cash & Bank / Payables |
| Payment reconciliation | `/payments`, `/bills`, `/payables-aging` (composition) | `finance-final/payment-reconciliation.tsx` ada, tidak dirutekan | Rutekan ke Payables/Payments |
| Sales tender & register | `/reports/sales/*`, `/sale-days` | `finance-final/sales.tsx`, `reports/sales-register.tsx` ada, tidak dirutekan | Rutekan sebagai 7Soft Info Penjualan/Laporan Penjualan |
| Period close duplicate | `/periods`, `/close/*` | `finance-final/period-close.tsx` tidak dirutekan; `controls.tsx` sudah | Bandingkan; merge/retire |
| AP ageing duplicate | `/payables-aging` | `finance-final/reports/ageing.tsx` tidak dirutekan; `payable.tsx` sudah | Bandingkan; merge/retire |
| Supplier advances | `/supplier-advances` (4) | Hanya dipakai di dalam BKK | 7Soft sudah punya Uang Muka di Faktur Pembelian; hub perlu tab/route sendiri |
| Opening balances | `/opening/*` (4) | Tidak ada rute | Tambah Month End / Setup › Opening |
| Inter-unit | `/interunit/pairs`, `/{unit}` (2) | Baris between-units ada di hidden `finance-final/receivable`; tidak ada route/tab khusus | Tambah Inter-unit › Due from/to; putuskan write |
| Payroll finance | `/payroll/runs/{id}/finance-handover` | Rute payroll ada tapi `moved`/hidden | Tambah Finance › Payroll postings atau link dari HR |
| Integrity checks | `/integrity` (3) | Tidak ada rute | Tambah Reports › Integrity |
| Ledger health | `/ledger-health` (1) | Tidak ada rute | Tambah Reports › Ledger health |
| Controls | `/controls` (1) | Query ada, layar tidak | Tambah Overview/Reports › Controls |
| Number series | `/number-series` (2) | Tidak ada query | Tambah Setup › Numbering |
| Banking readiness | `/banking-readiness` (1) | Tidak ada query | Tambah Setup/Bank › Readiness |
| Statement intake/sources | `/statement-intake`, `/statement-sources` (4) | Tidak ada query | Tambah Bank › Import statement / Sources |
| Tax filings/items/settlements | `/tax/filings`, `/tax/items`, `/tax/settlements` | Tax UI hanya types/periods/reconciliation | Tambah tab Month End › Tax |
| Asset reserve | `/assets/reserve/*` (4) | Tidak ada query | Tambah Assets › Reserve |
| Receipts awaiting posting | `/receipts/*` (3) | Tidak ada query | Hubungkan ke BKM/Cash & Bank |
| Management fees | `/management-fees` (1) | Tidak ada query | Putuskan produk; mungkin GA/Finance |
| Payment terms | `/api/v1/payment-terms` | Hanya dipakai payment projection | Tambah Setup › Payment terms |

**Catatan:** beberapa endpoint ini bisa saja sudah dipakai di layar yang tidak saya sebut
(embedded), tetapi tidak punya rute navigasi sendiri. Itu tetap gap dari sisi menu.

---

## 6. Hub yang perlu backend tambahan / kontrak

| Layar hub | Kondisi | Tindakan |
|---|---|---|
| `changes-in-equity` | Dihitung di UI dari statement; tidak ada endpoint khusus | Tambah `/reports/changes-in-equity` **atau** dokumentasikan sebagai computed |
| `cash-flow` | Memakai `/finance/statement?kind=CASH_FLOW` | Bukan gap; tambahkan alias `/reports/cash-flow` kalau ingin konsisten |
| `receivables/aging` | Disembunyikan; tidak ada debtor book | Pertahankan keputusan “tidak ada AR di Finance”; jangan munculkan lagi |
| `payroll/*` | Rute ada, tetapi `moved` dan tidak masuk nav | Pilih: Finance hanya membaca handover, atau HR yang punya layar |
| `interunit/*` | Dipindah ke Journal; backend read-only | Tambah endpoint write atau jadikan read-only + posting via Journal |
| `finance-final/payment-instructions` | Layar ada, tidak dirutekan | Rutekan atau hapus dari repo |
| `finance-final/payment-reconciliation` | Layar ada, tidak dirutekan | Rutekan ke Payables/Payments |
| `finance-final/deposits` | Layar ada dan dirutekan | Cocokkan status dengan backend |
| `supplier-advances` | Hanya di BKK | Tambah tab/screen |

---

## 7. Status dan istilah: ini yang membuat “terlihat beda” meski backend sama

| Objek | Backend | Prototipe | Tindakan |
|---|---|---|---|
| Bill | `DRAFT · MATCHED · POSTED · REJECTED · VOID`; paid/overdue diturunkan dari alokasi | `Paid · Overdue · Due` | Jangan simpan “Paid” sebagai status; turunkan dari `supplier_payment_allocation` |
| Payment | `DRAFT · POSTED · REVERSED` | `Draft · Approved · Executed · Settled` | Petakan; tambah state antara hanya jika produk memutuskan |
| Cash document | `DRAFT · APPROVED · POSTED · REVERSED` | Langsung “Posted” | Gunakan approve → post → reverse |
| Giro | `ISSUED · DELIVERED · DUE · CLEARED · REJECTED` | `New · Overdue · Cleared · Bounced` | Map `New→ISSUED/DELIVERED`, `Overdue→DUE`, `Bounced→REJECTED` |
| Deposit | `PREPARED · DEPOSITED · CONFIRMED · CANCELLED` | `In transit · Cleared` | Map `In transit→DEPOSITED`, `Cleared→CONFIRMED`; tambah PREPARED/CANCELLED |
| Payment batch | `DRAFT · READY · PARTIAL · EXECUTED · HELD · CANCELLED` | `Draft · Ready · Executed` | Tambah PARTIAL/HELD/CANCELLED |
| Period | `OPEN · SOFT_CLOSED · CLOSED` + reopen | `Open · Closed · Not yet` | Tambah SOFT_CLOSED |
| Bank line/recon | matches + proposals; tidak ada status kolom tunggal | `Matched · Unmatched · Ignored` | Map Ignore ke proposal/ignore; jangan mengarang status line |
| Asset | aktif, terjadwal, dibuang, dipindah | `Active/Inactive` | Tambah disposed/transferred/scheduled |

**Aturan:** satu kamus status, dipakai backend, hub, dan prototipe. Kalau backend tidak punya
state `In Payment/Awaiting Settlement`, jangan tampilkan di UI — atau tambahkan state itu
secara sadar lewat migrasi.

---

## 8. Cara membuat lebih sesuai

### A. Satu kontrak menu, dua lapis

1. **Fase ini: menu 7Soft (6 grup, 25 baris) adalah menu utama.** 9 pintu hub adalah target
   setelah parity, bukan menu yang dipaksakan sekarang.
2. Buat `financeScreenContract` (JSON/TS) dengan kolom:
   `layer (7soft|erp) → menu → tab → route → backend endpoint → status → owner`.
3. Setiap baris 7Soft dipetakan ke backend. Baris yang belum punya padanan (Faktur Penjualan,
   Retur Penjualan, Info Penjualan, customer master) **tetap di lapisan 7Soft** sebagai
   legacy/bridge; baru diputuskan setelah parity disetujui.
4. `Store money`, `Shop cash`, `Between units` tetap di group **“Di luar 7Soft”** sebagai
   lapisan ERP+; nanti dipromosikan ke pintu Stores/Inter-unit saat convergence.

### B. Wire layar ke endpoint

| Layar | Endpoint utama |
|---|---|
| Overview | `/attention`, `/balances`, `/money`, `/payables-aging`, `/inventory/valuation`, `/statement?kind=CASH_FLOW` |
| Stores | `/sale-days`, `/sales-postings`, `/store/{unit}/tender-recon`, `/acquirer-settlements`, `/deposits`, `/cash-counts` |
| Payables | `/bills`, `/bill-templates`, `/payables-aging`, `/payment-batches`, `/supplier-advances`, `/facilities` |
| Cash & Bank | `/cash-documents`, `/bank-accounts`, `/bank-statements`, `/bank-lines`, `/bank-rules`, `/giros`, `/advances` |
| Journal | `/journal`, `/journal-templates`, `/journal-repeats`, `/accruals`, `/prepaid/schedules`, `/corrections` |
| Month End | `/inventory/*`, `/tax/periods`, `/tax/items`, `/tax/settlements`, `/periods`, `/close/readiness`, `/period-closing-vouchers` |
| Assets | `/assets`, `/depreciation/run`, `/assets/{id}/dispose`, `/assets/{id}/transfer`, `/contractor-projects`, `/asset-classes`, `/assets/reserve/*` |
| Reports | `/statement`, `/reports/profit-and-loss`, `/reports/balance-sheet`, `/reports/unit-results`, `/reports/dimension-results`, `/reports/expenses-by-month`, `/reports/sales-by-division`, `/trial-balance` |
| Setup | `/accounts`, `/account-links`, `/posting-readiness`, `/policies/posting`, `/policies/source-rules`, `/permissions`, `/dimensions`, `/number-series`, `/settings`, `/payment-methods`, `/edc-*`, `/tax/types`, `/asset-classes` |
| Inter-unit | `/interunit/pairs`, `/interunit/{unit}`; tambah write endpoint atau Journal |
| Payroll | `/payroll/runs/{id}/finance-handover`, `/finance-handover/settlement` |
| Opening | `/opening/balances`, `/opening/stock`, `/opening/subledger`, `/opening/report` |

### C. Tambah rute hub yang hilang

Prioritas P0:

1. Payables › **Payment batches**.
2. Cash & Bank › **Payment instructions** dan **Payment destinations**.
3. Month End/Setup › **Opening balances**.
4. Inter-unit › **Due from / Due to** (read-only dahulu).
5. Reports › **Integrity** dan **Ledger health**.
6. Setup › **Number series**, **Banking readiness**, **Payment terms**.
7. Bank › **Statement intake** dan **Statement sources**.
8. Month End › **Tax filings / settlements**.
9. Assets › **Reserve**.
10. Payables › **Supplier advances**.

### D. Backend tambahan (kecil, bukan besar)

- **Inter-unit write**: `POST /finance/interunit/transfers`, `POST /settlements`, atau
  posting via `/journal` + dimension. Tanpa ini, layar Inter-unit hanya baca.
- **Changes in equity**: endpoint khusus, atau biarkan dihitung UI dan catat sebagai computed.
- **Payroll finance facade**: `GET/POST /finance/payroll/{run}/handover` yang memanggil
  `/payroll/...`; atau hub link ke HR.
- **Cash-flow alias** (opsional): `/finance/reports/cash-flow` → `statement?kind=CASH_FLOW`.
- **Supplier advances screen/route**: endpoint sudah ada; tinggal UI.
- **Payment batches/destinations UI**: endpoint sudah ada; tinggal UI.
- **Tax filings/settlements UI**: endpoint sudah ada; tinggal UI.
- **Status tambahan** hanya jika produk memang butuh `In Payment/Awaiting Settlement`; kalau
  tidak, jangan tampilkan.

### E. Kontrak dan tes

1. **Route coverage test**: setiap path `/api/v1/finance` harus punya layar hub **atau**
   masuk allowlist “backend-only” dengan alasan.
2. **Menu coverage test**: setiap baris prototipe harus punya `hub route` + `backend endpoint`
   atau ditandai `drop`.
3. **Status vocabulary test**: label UI harus berasal dari enum backend; tidak ada label
   “Paid” yang disimpan sebagai status bill.
4. **Golden-path tests** per domain: sales day → posting, deposit → bank, bill → post → pay,
   cash doc → approve → post → reverse, giro → clear/reject, bank statement → match,
   period → close, asset → dispose, tax → settle, opening → report.
5. **Permission tests**: `ADMIN` vs finance vs store; pastikan route finance tidak terbuka
   untuk yang tidak berhak.
6. **404/error budget**: ukur route hub yang memanggil endpoint tidak ada; target 0.

---

## 9. Urutan kerja yang saya sarankan

### P0 — 7Soft parity dulu

1. **Bekukan checklist parity 7Soft**: 25 menu, tab, field, tombol, laporan, nomor dokumen,
   dan label status.
2. Buat `financeScreenContract` untuk 40 menu; layer `7soft` dan `erp` dipisah.
3. Wire 7Soft core: `kas-info`, BKM/BKK, Giro, Laporan Kas/Bank, Info Accounting, Jurnal,
   Closing, Laporan Accounting.
4. Lanjut 7Soft purchasing/sales/master; putuskan bridge untuk customer AR/sales invoice.
5. **Setelah parity**, tambah rute hub untuk payment batches, payment instructions/destinations,
   opening, integrity, ledger health, number series, banking readiness, tax filings.
6. Samakan status di **adapter**, bukan di label 7Soft: bill, payment, cash doc, giro, deposit,
   batch, period.

### P1 — setelah alur harian cocok

- Inter-unit write + due-from/to.
- Payroll finance handover.
- Supplier advances, payment terms.
- Asset reserve, depreciation schedule, transfer.
- Tax settlements/filings.
- Reports: changes-in-equity (endpoint/computed), sales by division, withholding.
- Statement intake/sources.

### P2 — kualitas

- Hapus angka statis dari prototipe; semua dari fixture backend.
- Delapan keadaan layar (loading/empty/no-result/error/no-permission/changed/processing).
- Mobile/store-head.
- Audit before/after.
- Print/export nyata.
- Route usage/observability.

---

## 10. Satu kalimat

> Backend cloud sudah siap jauh lebih jauh daripada menu yang menampilkannya. Yang membuat
> belum sesuai bukan kekurangan endpoint, tetapi **dua lapis menu (7Soft dan ERP+) yang belum
> punya kontrak, layar prototipe yang tidak memanggil API, rute hub yang belum menampilkan
> beberapa kemampuan backend, dan kamus status yang berbeda**. Untuk fase ini, 7Soft adalah
> menu utama; ERP+ ditambahkan di atasnya. Rapikan kontraknya, dan sebagian besar menu akan
> “sesuai” tanpa menulis backend baru.

---

## Lampiran A — domain route backend

| Domain | Jumlah path |
|---|---:|
| Assets | 12 |
| Contractor projects | 9 |
| Giros | 9 |
| Acquirer settlements | 8 |
| Bills | 8 |
| Corrections | 8 |
| Reports | 8 |
| Advances | 7 |
| Cash documents | 7 |
| Journal | 7 |
| Tax | 7 |
| Bank lines | 6 |
| Payment instructions | 6 |
| Sales postings | 6 |
| Store tender | 6 |
| Inventory | 5 |
| Payment batches | 5 |
| Payment ledger | 5 |
| Payments | 5 |
| Periods | 5 |
| Policies | 5 |
| Prepaid | 5 |
| Accounts | 4 |
| Attention | 4 |
| Bank statements | 4 |
| Credit notes | 4 |
| Deposits | 4 |
| Opening | 4 |
| Supplier advances | 4 |
| Bank proposals | 3 |
| Bank rules | 3 |
| Close | 3 |
| Facilities | 3 |
| Integrity | 3 |
| Payment destinations | 3 |
| Receipts | 3 |
| Sites | 3 |
| Transaction categories | 3 |
| Sisanya | 1–2 masing-masing |

Total: **280 path unik**.

## Lampiran B — 9 pintu hub

| Pintu | Tab |
|---|---|
| Overview | — |
| Stores | Sales · Settlement · Deposits · Cash · Cash counts |
| Payables | Bills · Due dates · Suppliers · Credit notes · Loans |
| Cash & Bank | BKK · BKM · Giro · Bank · Advances |
| Journal | Entries · Templates |
| Assets | Register · Projects · Disposals |
| Month End | Checklist · Periods · Accruals · Inventory · Tax |
| Reports | Profit and loss · Balance sheet · Cash flow · Ledger · Sales by division |
| Setup | 17 destinasi |

## Lampiran C — bukti yang dipakai

- `backend/src/cloud/http/finance.rs` — accounts, journal, bills, bank statements, statements.
- `backend/src/cloud/http/money.rs` — cash documents, cash counts, deposits, bank rules, giros.
- `backend/src/cloud/http/payments_lane.rs` — payments, batches, instructions, destinations.
- `backend/src/cloud/http/acquirer.rs` — EDC/acquirer settlement, tender reconciliation.
- `backend/src/cloud/http/opening.rs` — opening balances/stock/subledger/report.
- `backend/src/cloud/http/stock_ledger.rs` — valuation, stock ledger, transfers.
- `backend/src/cloud/http/finance_setup.rs` — setup, payment methods, EDC, number series.
- `backend/src/cloud/http/finance_control.rs` — close, reports, controls.
- `backend/src/cloud/http/categories.rs` — transaction categories, bank-line categorisation.
- `backend/src/cloud/http/pay.rs` — payroll runs, loans, finance handover.
- `frontend-hub/src/screens/finance/nav.ts` — 9 pintu, 86 rute.
- `frontend-hub/src/screens/finance/index.ts` — 91 path terdaftar.
- `frontend-hub/src/screens/finance-final/*` — layar yang belum masuk nav (payment instructions,
  payment reconciliation, payroll).
- `finance-7soft-prototype.html` / `finance-7soft/*` — 40 menu prototipe, tanpa panggilan API.
