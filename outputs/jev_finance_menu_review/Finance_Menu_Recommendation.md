# Rekomendasi Menu Finance — frontend-hub + Jev

Tanggal review: 19 September 2026  
Model Jev: `jev-1.13.0`  
Basis: kode aktual `frontend-hub`, struktur organisasi client, model posting dan segregation of duties yang telah disepakati.

## Kesimpulan

Gunakan **model hibrida**:

- Aktivitas uang fisik Unit tetap berada di **Operations/Store**: cash count, cashier float, petty cash, sales reconciliation, dan bukti serah/setor.
- Finance di `frontend-hub` menjadi workspace **HO Finance** untuk AP, Treasury, reconciliation, accounting, tax, close, dan reporting.
- Finance dapat membaca status kas Unit dan menangani exception, tetapi tidak menyediakan form pencatatan kas Unit yang kedua.
- Menu disaring berdasarkan role. Server tetap menjadi pengendali izin yang sebenarnya.

## Menu final sebagai gabungan kemampuan Finance

### Work

1. Overview
2. Accounts payable
3. Payments
4. Cash & bank
5. Asset accounting
6. Manual journals

### Books

7. Reports
8. Ledger

### Controls

9. Tax
10. Financing
11. Period close

### Setup — terbatas

12. Chart of accounts
13. Posting rules

Ini adalah **union menu**, bukan menu yang harus dilihat setiap orang.

## Isi tiap workspace

| Workspace | View atau tindakan di dalamnya |
|---|---|
| Overview | Antrean berdasarkan role, approval, exception, aging, unreconciled items, dan close readiness |
| Accounts payable | Bills/invoices, matching, aging, supplier advances, kandidat pembayaran |
| Payments | Payment instructions, approval status, bank-release status, payment history, cetak giro pada pembayaran yang disetujui |
| Cash & bank | Status kas Unit read-only, bank accounts terbatas, statements/transactions, bank reconciliation, charges without a sale |
| Asset accounting | Assessment/capitalization, depreciation, impairment, dan disposal accounting; register fisik tetap di GA |
| Manual journals | Draft, pending approval, posted, rejected, reversal; hanya General Accounting yang berwenang |
| Reports | Trial Balance, P&L, Balance Sheet, Cash Flow, AP/AR aging; Sales Register menggunakan sumber yang sama dengan Sales/Commercial |
| Ledger | Pencarian posting detail berdasarkan account, dimension, source document, site, dan period |
| Tax | Obligations, filings, tax reconciliation, dan exception |
| Financing | Bank loans serta owner capital/drawings sebagai view terpisah |
| Period close | Checklist, subledger certification, control, approval, close dan reopen |
| Chart of accounts | Tata kelola natural account oleh General Accounting/Finance Manager |
| Posting rules | Account map, line categories, serta unmapped meanings dalam satu layar |

## Perubahan dari menu Finance aktif

| Sekarang | Rekomendasi |
|---|---|
| Supplier bills | Ganti nama menjadi **Accounts payable**; bill, matching, aging, dan supplier advances menjadi view |
| Payments | Pertahankan; masukkan payment instruction dan tindakan cetak giro |
| Cash & bank | Pertahankan sebagai satu workspace dengan tab |
| Charges without a sale | Pindahkan menjadi exception view di Cash & bank dan alert di Overview |
| Assets | Ganti menjadi **Asset accounting**; register/custody fisik berada di GA |
| Journal | Ganti menjadi **Manual journals** dan tampil hanya untuk role berwenang |
| Reports | Pertahankan; Trial Balance menjadi salah satu report |
| Ledger | Pertahankan untuk investigasi posting detail |
| Chart of accounts | Pertahankan, tetapi khusus role General Accounting/Manager |
| Line categories | Gabungkan ke **Posting rules** |
| Account map | Gabungkan dan ganti nama menjadi **Posting rules** |
| Giro printing | Hapus sebagai row; layout di Bank Account settings, print dari approved Payment |
| Period close | Pertahankan dan satukan readiness, controls, approval, close/reopen |
| Belum ada: Tax | Tambahkan untuk Tax/Finance roles |
| Belum ada: Financing | Tambahkan secara terbatas untuk loan dan owner equity workflows |

## Menu menurut role

| Role | Menu utama yang terlihat |
|---|---|
| AP | Overview, Accounts payable, Payments read/prepare, Reports terbatas, Ledger terbatas |
| Treasury | Overview, Payments, Cash & bank, Financing bila ditugaskan, Reports/Ledger terbatas |
| General Accounting | Overview, Asset accounting, Manual journals, Reports, Ledger, Period close, Chart of accounts, Posting rules; Tax/Financing bila ditugaskan |
| Tax | Overview, Tax, Reports, Ledger, Period close |
| Finance Manager | Hampir seluruh 10–13 row untuk approval dan oversight |
| Auditor | Workspace relevan yang sama dalam mode read-only, termasuk evidence dan approval history |
| Unit | Tidak melihat menu Finance pusat; memakai Operations/Store untuk aktivitas kas dan dokumen Unit |

## Keputusan Jev

- 68 pertanyaan menu dalam tiga putaran.
- Keputusan fungsional final berada pada confidence 96–100%.
- Jev memilih menu hibrida dibanding memindahkan semua pekerjaan Store ke Finance.
- Jev memilih 4–7 row untuk specialist dan 10–13 row untuk Finance Manager, tetapi confidence untuk jumlah row lebih rendah karena merupakan preferensi UI. Gunakan role filtering dan uji dengan user, bukan menghapus kontrol atau workflow.

Raw request/response tersimpan di folder yang sama sebagai `request_1.json`–`request_3.json` dan `response_1.json`–`response_3.json`.
