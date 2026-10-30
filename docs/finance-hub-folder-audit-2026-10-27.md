# Audit folder Finance di frontend-hub — mana yang hidup, mana yang yatim

**Tanggal:** 27 Oktober 2026
**Sumber:** `frontend-hub/src/screens/finance/{index.ts,nav.ts}`, daftar file dan import graph
`finance/`, `finance-final/`, `finance-lab-2/`, `finance-lab/`.
**Sifat:** analisis. Tidak ada kode frontend-hub yang diubah.

---

## 0. Jawaban singkat

**Belum semua dianalisa sebelumnya; sekarang inventaris dan routing-nya sudah lengkap.**
Yang belum adalahaudit perilaku baris demi baris untuk layar yatim (orphan), bukan lagi
“apakah layarnya ada”.

| Folder | File | Layar yang di-import | Rute | Status |
|---|---:|---:|---:|---|
| `screens/finance` | 74 | **45** | **59** | Hidup; menu utama |
| `screens/finance-final` | 34 | **25** | **29** | Dipakai sebagian; 6 layar nyata belum dirutekan |
| `screens/finance-lab-2` | 15 | **2 langsung + 4 dependensi** | **2** | Sebagian besar yatim; 9 layar tidak dipakai |
| `screens/finance-lab` | 48 | **0** | **0** | Tidak dipakai sama sekali |

Artinya:

- `finance-lab-2` **bukan** “14 layar dipakai”; hanya **2 rute** yang memakainya,
  `bank-accounts` dan `bank-reconciliation-list`, plus 4 file pendukung yang di-import
  oleh keduanya.
- `finance-final` **bukan 23 layar**; ada 34 file, 25 di-import, dan beberapa layar nyata
  belum punya rute.
- `finance-lab` **bukan 32 layar**; ada 48 file (termasuk `engine/`), dan **nol** import.
- “Tidak ada di hub” untuk **Antar unit** dan **Penjualan kredit** tidak sepenuhnya benar:
  keduanya ada di layar tersembunyi `finance-final/receivable`, bukan di menu.

---

## 1. Metode

1. Baca `screens/finance/index.ts`: 91 path terdaftar, 91 `lazyScreen` dengan nama file.
2. Baca `screens/finance/nav.ts`: 9 pintu, 86 rute, 59 tab, 17 Setup.
3. Hitung file dan import per folder.
4. Telusuri import graph `finance-lab-2` dan `finance-final` untuk membedakan
   **layar yang dirutekan**, **dependensi**, dan **yatim**.
5. Cocokkan layar yang dirutekan ke 25 menu 7Soft.

---

## 2. Rute per folder

| Folder | Rute | Contoh |
|---|---:|---|
| `finance` | 59 | `dashboard`, `cash-documents`, `giro-board`, `supplier-bills`, `credit-notes`, `recurring-bills`, `journal-templates`, `chart-of-accounts`, `periods`, `reports/*` |
| `finance-final` | 29 | `transactions`, `expenses`, `deposits`, `sales-reconciliation`, `advances`, `receivable`, `sales-postings`, `payments`, `payable`, `payroll`, `financing`, `tax`, `journals`, `controls`, `reports/*`, `prepaids`, `prepaid-schedules`, `cash`, `categories` |
| `finance-lab-2` | 2 | `bank-accounts`, `bank-reconciliation-list` |
| `projects` | 1 | halaman proyek kontraktor (`/finance/assets/contractor-projects/$project`) |

Total 91 path terdaftar di `index.ts`; 86 di antaranya ada di `nav.ts`.

---

## 3. `finance-final`: 6 layar nyata yang belum dirutekan

File yang tidak di-import dari `index.ts`:

| File | Isi | Status |
|---|---|---|
| `payment-instructions.tsx` | Toko minta HO membayar; submit/decide/withdraw/settle | **Layar nyata**, query `/finance/payment-instructions`; belum dirutekan |
| `payment-reconciliation.tsx` | Alokasi pembayaran ke tagihan; “Payment Reconciliation” | **Layar nyata**, query `/finance/payments` + `/finance/bills`; belum dirutekan |
| `sales.tsx` | Penjualan per toko per hari, split tender (cash/card/voucher) | **Layar nyata**, query analytics; belum dirutekan |
| `reports/sales-register.tsx` | Register penjualan, satu baris per sale | **Layar nyata**; belum dirutekan |
| `reports/ageing.tsx` | AP aging per supplier | **Layar nyata**; kemungkinan duplikat `finance-final/payable`; perlu dibandingkan |
| `period-close.tsx` | Period close | **Layar nyata**; kemungkinan superseded oleh `controls.tsx` yang sudah dirutekan |

File pendukung yang **bukan** kandidat hapus:

| File | Alasan |
|---|---|
| `parts.tsx` | Dipakai hampir semua layar `finance-final` |
| `reports/two-year.ts` | Helper tahun/bulan untuk P&L by unit |
| `reports/two-year-controls.tsx` | Kontrol tahun/bulan untuk P&L by unit |

**Kesimpulan:** jangan hapus `finance-final` sebagai folder. Enam layar nyata di atas perlu
diputuskan: **route, merge, atau retire**.

---

## 4. `finance-lab-2`: 2 rute, 4 dependensi, 9 yatim

### Dipakai

| File | Peran |
|---|---|
| `bank-accounts.tsx` | Rute `/finance/cash-bank/bank-accounts` |
| `bank-reconciliation-list.tsx` | Rute `/finance/cash-bank/bank-reconciliation` |
| `bank-reconciliation.tsx` | Di-import oleh `bank-reconciliation-list` (tool rekonsiliasi) |
| `bank-reconciliation-paired.tsx` | Di-import oleh `bank-reconciliation-list` (paired view) |
| `hooks.ts` | Dipakai bank-accounts + rekonsiliasi |
| `parts.tsx` | Dipakai layar lab-2 |

### Yatim (tidak di-import siapa pun)

`banks.tsx` · `bills.tsx` · `cash.tsx` · `cash-counts.tsx` · `journal.tsx` ·
`journal-entry.tsx` · `statements.tsx` · `trial-balance.tsx` · `bank-transactions.tsx`

Kesembilannya terlihat seperti versi lama yang sudah digantikan:

- `bills` → `finance/supplier-bills`
- `journal`/`journal-entry` → `finance-final/journals`
- `trial-balance` → `finance-final/reports/trial-balance`
- `cash` → `finance-final/cash`
- `banks` → `finance-lab-2/bank-accounts`
- `bank-transactions` → `finance/bank-transactions`
- `cash-counts` → `finance/stores` / `finance/stores-cash`
- `statements` → `finance/bank-transactions` / statement lines

**Kesimpulan:** 9 file kandidat retire setelah diff; 6 file dipertahankan.

---

## 5. `finance-lab`: 0 import

48 file, termasuk `engine/` (chart, ledger, resolver, rules, scenarios, fixtures).
Tidak ada satu pun yang di-import dari `index.ts` atau layar lain.

Isinya mencakup konsep yang juga muncul di 7Soft/native:

- `interunit.tsx` — antar unit
- `payroll.tsx` — payroll finance
- `vendors.tsx` — vendor
- `settlements.tsx` — settlement
- `capital.tsx`, `financing.tsx` — modal/pembiayaan
- `contract.tsx`, `signature.tsx` — kontrak/ttd
- `scenarios.tsx`, `engine/*` — laboratorium skenario

**Kesimpulan:** bukan kode hidup. Jadikan **arsip/referensi**; hapus setelah pemilik setuju.
Jangan jadikan dasar “fitur sudah ada di hub”.

---

## 6. Koreksi terhadap analisa sebelumnya

| Klaim sebelumnya | Temuan |
|---|---|
| `finance-lab-2` 14 layar dipakai sebagian | **2 rute + 4 dependensi**; 9 yatim |
| `finance-final` 23 layar | **34 file, 25 di-import, 29 rute**; 6 layar nyata belum dirutekan |
| `finance-lab` 32 layar | **48 file, 0 import** |
| Saldo Awal COA tidak ada di hub | **Benar**; tidak ada rute, meski backend `/opening/*` ada |
| Antar unit tidak ada di hub | **Sebagian benar**; ada di layar tersembunyi `finance-final/receivable` (baris between-units), tanpa rute/tab khusus |
| History tidak ada di hub | **Benar untuk Finance**; audit ada di `/api/v1/audit`, chart changes/account-link history ada di Setup |
| Penjualan kredit tidak ada | **Sebagian benar**; hidden AR `finance-final/receivable` mencakup card/between units/people, **bukan customer ledger**; sales invoice/return tidak ada |
| Laporan penjualan tidak ada | **Sebagian benar**; `sales-by-division` ada, `finance-final/sales` dan `sales-register` nyata tapi belum dirutekan |

---

## 7. Peta 25 menu 7Soft ke layar hub yang benar-benar ada

Legenda: **R** = routed, **H** = hidden route (ada di `index.ts`, tidak di nav),
**O** = orphan (file ada, tidak dirutekan), **—** = tidak ada.

| # | Menu 7Soft | Layar hub yang benar-benar ada | Status |
|---:|---|---|---|
| 1 | Info Kas Bank | lab-2 `bank-accounts`; final `transactions`, `expenses`, `deposits`; finance `bank-transactions`, `bank-rules`, `giro-board` | R/H + partial |
| 2 | BKM · BKK | finance `cash-documents` | R |
| 3 | Pencairan BG | finance `giro-board` | R |
| 4 | Laporan Kas/Bank | final `cash`; finance `bank-reconciliation-summary` | R + partial |
| 5 | Info Accounting | final `reports/general-ledger`, `reports/trial-balance`; finance `chart-of-accounts` | R |
| 6 | Transaksi Jurnal | final `journals`; finance `journal-templates` | R |
| 7 | Closing Periode | final `controls`; finance `periods`, `period-closing` | R |
| 8 | Laporan Accounting & Keuangan | final `reports/*`; finance `dimension-results`, `sales-by-division`, `changes-in-equity`, `expenses-by-month`, `withholding-report` | R + partial |
| 9 | Info Pembelian | finance `supplier-bills`, `supplier-ledger`, `credit-notes`, `recurring-bills`; final `payable`, `payments`, `financing` | R + O (`payment-instructions`, `payment-reconciliation`) |
| 10 | Faktur Pembelian | finance `supplier-bills` | R |
| 11 | Invoice Retur Beli | finance `credit-notes` | R |
| 12 | Laporan Pembelian | final `payable`; finance `supplier-ledger`; O `reports/ageing` | R + O |
| 13 | Info Penjualan | H `final/receivable` (card/between units/people); O `final/sales` | H + O; no customer ledger |
| 14 | Penjualan Cash · POS | finance `stores`, `stores-cash`; final `sales-postings`, `sales-reconciliation` | R |
| 15 | Faktur Penjualan | — (Sales module) | — |
| 16 | Retur Penjualan | — (Sales module) | — |
| 17 | Laporan Penjualan | finance `sales-by-division`; O `final/sales`, `reports/sales-register` | R + O |
| 18 | Account | finance `chart-of-accounts` | R |
| 19 | Saldo Awal COA | — | — |
| 20 | Setting COA | finance `account-links`, `posting-readiness` | R |
| 21 | Set Up | finance `settings/*`, `setup/*` | R + partial |
| 22 | Customer · Supplier · Pajak | finance `supplier-ledger`, `reports/accounts-payable-summary`, `taxes`; supplier master di Procurement/GA | R + partial |
| 23 | Asset | finance `assets`, `asset-register`, `asset-disposals`, `contractor-projects` | R |
| 24 | User & Group | finance `permissions`; People | R |
| 25 | History | finance `chart-changes` / `account-link-history`; audit global | Partial; no Finance history route |
| — | Shop cash | finance `stores`, `stores-cash` | R |
| — | Between units | H `final/receivable` (between-units rows); no dedicated route/tab | H |
| — | Inter-unit (native) | sama dengan Between units | H |

---

## 8. Yang harus diputuskan

### Route, bukan hapus

- `finance-final/payment-instructions.tsx` — nyata; cocok untuk Payables/Cash & Bank.
- `finance-final/payment-reconciliation.tsx` — nyata; cocok untuk Payables/Payments.
- `finance-final/sales.tsx` — nyata; cocok untuk 7Soft Info Penjualan/Laporan Penjualan.
- `finance-final/reports/sales-register.tsx` — nyata; cocok untuk Laporan Penjualan.

### Bandingkan dulu

- `finance-final/reports/ageing.tsx` vs `finance-final/payable.tsx` (AP aging).
- `finance-final/period-close.tsx` vs `finance-final/controls.tsx` (period close).

### Kandidat retire

- 9 layar yatim `finance-lab-2` setelah diff dengan layar pengganti.
- Seluruh `finance-lab` setelah pemilik setuju (0 import; arsip/referensi).

### Coverage page

- `HUB` di `base.js` sudah diperbarui untuk Info Penjualan, Laporan Penjualan,
  Info Pembelian, Inter-unit, History, Set Up, Parties, Laporan Kas/Bank.
- `COVER['interunit'].api` diubah ke `part`: read-only, belum ada transfer/settlement.
- KPI Coverage sudah diperbaiki: sekarang 25 baris 7Soft, dengan 16 backend penuh,
  5 sebagian, 4 tidak ada. Baris central-only (`Shop cash`, `Between units`) tidak lagi
  dicampur ke hitungan 7Soft; keduanya ada di group Di luar 7Soft.

---

## 9. Jawaban “sudah dianalisa semua?”

- **Inventaris dan routing:** sudah. 4 folder, 91 path, 172 file, import graph.
- **Perilaku layar:** belum baris demi baris untuk 9 yatim `finance-lab-2`, 6 orphan
  `finance-final`, dan 48 file `finance-lab`. Header/tujuan sudah dibaca; alur detail belum.
- **Yang belum perlu dilakukan sekarang:** menghapus atau merutekan apa pun di frontend-hub.
  Sesuai keputusan 7Soft-first, prototipe dulu; frontend-hub nanti.

---

## 10. Satu kalimat

> `finance-final` bukan sampah: ada 6 layar nyata yang belum dirutekan. `finance-lab-2`
> hanya 2 rute + 4 dependensi, bukan 14 layar hidup. `finance-lab` benar-benar 0 import.
> Dan “tidak ada di hub” hanya benar untuk Saldo Awal dan History; Antar unit/Penjualan
> kredit ada di layar tersembunyi `finance-final/receivable`.
