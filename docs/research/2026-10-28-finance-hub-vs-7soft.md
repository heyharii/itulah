# Finance hub vs 7Soft — gap list (28 Oct 2026)

Goal 1: the hub's Finance shows every 7Soft finance menu and every piece of information on it. Only after that do we improve it.

This list compares the **real hub** (`frontend-hub/src/screens/finance`) with the 7Soft manual (`Integrated Accounting Application - DONE (2).pdf`, its text in `finance-7soft/manual-7soft.txt`, screenshots in `7soft-ref/manual/`). The before/after prototype (`finance-7soft-prototype.html`, :5404) is a different comparison: 7Soft against the *prototype*. The hub's own parity page (`/finance/7soft-parity`, `parity-menus.ts`) is out of date. It still lists giro gaps that are already built, and it marks BKM/BKK as having none.

Labels: **menu** = a whole screen, tab or report is missing. **info** = a field, column, button or status is missing or different. 7Soft technical leftovers are left out: Format/Default/DBF, First/Prior/Next/Last, the record counter, form size.

## A. Menu: 7Soft rows vs the hub sidebar

The sidebar now has 14 rows (`nav.ts` `SEVEN_SOFT_MENU`). The 7Soft finance menus not in it:

| 7Soft | In the hub now | Gap |
|---|---|---|
| 6.2 BKM · 6.3 BKK · 6.4/6.5 Pencairan BG | Tabs of Info Kas Bank | No row of their own. In 7Soft each is a menu. |
| 6.6 Laporan Kas/Bank | — | **menu**: all 20 reports are missing. Parity points at `/reports/cash-bank`, which is the drawer count. |
| 7.1 Info Accounting | General Ledger / Trial Balance, hidden under Reports | No row. 7Soft's five tabs (Account · Jurnal · All Jurnal · Buku Besar Pembantu · Neraca Saldo) are not one page. |
| 4.1 Info Pembelian | Hidden tab `/payables/supplier-ledger` | No row. |
| 4.4 Faktur Pembelian | **Two rows**: "Purchase Invoices" (English) + "Faktur Pembelian" | Two screens, and each shows a different status (Paid/Overdue vs New/Lunas). |
| 4.5 Invoice Retur Beli | Hidden tab "Credit notes" | No row. The label is English. |
| 4.6 Laporan Pembelian | Hidden `/reports/accounts-payable-summary` | No row. |
| 5.1 Info Penjualan | → `/sales/overview` (outside Finance) | **menu** |
| 5.6 Faktur Penjualan | — | **menu** (only if the client sells on credit) |
| 5.7 Retur Penjualan | → `/sales/returns` (outside Finance) | **menu** |
| 5.8 Laporan Penjualan | Sales by Division, hidden | **menu**: 1 report vs 43. |
| 8.1 Laporan Keuangan · 8.2 Manajerial | Inside "Laporan Accounting" | No Analisa group. |
| 2.20 Setting Menu | — | **menu** |
| 9.10 Persiapan Singkat · 9.11 History Report · 9.12 History | Set Up and History under Master | No Fasilitas group. History Report does not exist. |
| Master order | Asset sits after Customer·Supplier·Pajak | 7Soft order: Asset, Account, Saldo Awal, Setting COA, User & Group, Setting Menu. |

## B. Information per screen

### Kas - Bank
- **Info Kas Bank** (`cash-info.tsx`): in 7Soft it is **one screen with 4 tabs** (KAS/BANK · KARTU · BKM · BKK) for one account. In the hub the account you pick does not carry to the BKM/BKK lists. The Keterangan and Aktif columns are missing. Giro accounts (GIRO MASUK, Utang Giro) are not listed because the hub lists only accounts linked in `/money`.
- **BKM/BKK** (`cash-documents.tsx`):
  - BKM **Customer is free text**, not a picker with a code (2189).
  - **BKM Pelunasan Piutang and the Hutang tab are always empty** (2361, 2734).
  - BKK Piutang offsets supplier advances, not sales invoices.
  - There is no Keterangan per line on the Settle grid.
  - Reff No shows `bill.note`, because a bill has no reference field.
  - No Voucher cannot be typed (2128).
  - The date has no time.
  - Tolakan is disabled.
  - The status is Draft/Approved/Posted, not NEW/CAIR/TOLAKAN + READ ONLY.
  - The register has no "+" to expand lines.
- **Pencairan BG** (`giro-list.tsx`):
  - BG Masuk has no separate BANK (issuing bank) column.
  - **Cair does not ask for Bank tujuan**.
  - **Saldo Awal BG is read-only** (it should be typed in).
  - There is no Print/XLS.
- **Laporan Kas/Bank**: **all 20 missing**:
  - Daily: Harian, Harian Detail, per Transaksi.
  - Period: Periodik, Per Periode, Per Periode Detail.
  - Settlements: Summary/Detail Pelunasan Piutang and Hutang.
  - Vouchers: Summary/Detail BKM and BKK.
  - Giro: Masuk/Keluar, Belum Cair per party, Perincian Tolakan.
  - Also the giro parameters and the bounced-giro balance.

### GL · Buku Besar
- **Transaksi Jurnal** (`journal.tsx`). The page title is "Journal". The list reads Entry/Posted/Source/Memo/Answered. The new entry is a sheet with **one card per line**, not 7Soft's grid. Missing:
  - **No Referensi**
  - **Uraian per line** (the code says no box for it, 607)
  - the separate **Kode Account** column
  - the time on Tanggal
  - **Selisih**
  - the **Status Otomatis** tick (now the Source pill)
  - **Periode Acc**
  - the **PENYUSUTAN** button in the form
  - Del All
  - Print
  - NEW / READ ONLY status
  - The detail sheet has no No Ref, Periode or Uraian column either.
- **Info Accounting**: there is no single page with the 5 tabs. Buku Besar Pembantu (the sub-ledger per transaction) and Neraca Saldo with "Sampai tanggal" + Refresh are split across Ledger/Trial Balance.
- **Closing Periode** (`periods.tsx`, `period-closing.tsx`): these were in the old coverage list, still to check by hand:
  - the Tanggal/Tahun/Bulan columns
  - "Proses Saldo Awal Program ke Neraca Awal"
  - Undo Closing in 7Soft words
- **Laporan Accounting / Keuangan / Manajerial**: 7Soft has 3 lists (`scr7-gl.js` LACC/LKEU/LMAN). The hub has P&L, Balance Sheet and Cash Flow, plus the "Laporan Accounting" page. Missing:
  - Laporan Jurnal Pembelian/Penjualan/BKK/BKM
  - Neraca Ke Kanan with Bln Lalu
  - Neraca perbandingan 2 bulan / common-sized
  - Laba Rugi per Item / Customer / Nota / Sales
  - Fast/Slow Moving
  - 10 Top Customer

### Pembelian
- **Info Pembelian**:
  - Missing on the Supplier tab: Lokasi, Fax, Limit Hutang.
  - Missing on Pembelian & Retur: Lokasi, No PO, No Ref.
  - The buttons Nota Pembelian Baru and Retur Pembelian Baru are missing.
  - Missing on Pelunasan: Kode, Lokasi, Giro No, Giro JTempo.
  - Summary Hutang: there is no "Sampai tanggal" + Refresh.
  - XLS is on Kartu only.
  - The PO tab is in Procurement.
- **Faktur Pembelian**:
  - Header: missing Lokasi, No PO, No Terima (BPB), No Ref, Jangka waktu, and Tipe invoice (MATCHING/STANDARD/UANG MUKA). PPN is typed as an amount, not picked as a code.
  - Grid: missing Kode, Satuan, Diskon Rp/%, Keterangan.
  - Uang Muka tab: missing Tanggal, No Reff.
  - Pelunasan tab: missing Jatuh Tempo, Hutang, No Reff, Keterangan.
  - The **PO-BPB-INVOICE tab** (qty PO/BPB/Invoice/sisa) is missing.
  - Buttons: missing Cash, Pay, Retur, and Print on Bills. The right-click stock and price history views are missing.
- **Retur Beli** (`credit-notes.tsx`):
  - The return is an **amount only** with no item grid.
  - Header: missing Lokasi, Jangka, J.Tempo, Tipe, PO, BPB, Total diskon, PPN code.
  - The status differs between the filter and the badge.
  - Pelunasan: missing J.Tempo, No Reff, Keterangan.
  - No Print.
- **Laporan Pembelian**:
  - Reports 1, 4, 6–9, 13, 14, 16 are not there (item level, Uang Muka).
  - 5, 10, 11, 17–21, 23 send you to Procurement.
  - 3 and 22 lack the No faktur, Gudang and Jenis parameters.
- **Jangka Waktu**: read-only, with no New/Del and no Default column.
- **Pajak**: the PPN0/PPN10 master with a percent is missing. It is inferred from the amounts.
- **Supplier**:
  - The list lacks Batas Hutang, Diskon, COA Hutang, Termasuk Customer + COA Piutang, Keterangan.
  - The detail lacks Lokasi per address, Fax, Kontak, Bank Account, and the Kirim/Penagihan/Pajak ticks.
  - The per-supplier Saldo Awal hutang tab and Import are missing.

### Penjualan
The client has no Piutang Dagang. Points marked † apply only if the client sells on credit.
- **Penjualan Cash · POS** (`stores.tsx`):
  - One page with no Cash/Barcode tabs.
  - **No receipt list** (No Faktur, Tanggal, Customer, Lokasi, Gudang, No Ref, Keterangan).
  - **No item grid** (Barcode, Nama, Kode, Jml, Satuan, Harga, Diskon, Subtotal).
  - No PPN/Total/Total diskon footer. `tax_minor` is already in the data.
  - Only a fixed 14 days, no date range.
  - No Print/View/Info.
- **Info Penjualan**:
  - The Penjualan & Retur list is missing: Tanggal, No Faktur, Status, Shift, Customer, Gudang, J.Tempo, No Ref, PPN, Total, Diskon, Total Bersih.
  - XLS is missing.
  - † The Customer/Pelunasan/Summary/Kartu Piutang tabs are missing.
- † **Faktur Penjualan**: the whole screen.
- **Retur Penjualan**: in Sales, with no item lines, Gudang, No Ref, Keterangan, PPN, Grand Total. † Pelunasan is missing.
- **Laporan Penjualan**: the cash/POS reports are missing:
  - Harian Detail Item
  - Summary
  - Cetak Ulang Nota
  - Nota
  - Rekap Faktur
  - per User
  - Bulanan with chart
  - PPN
  - Retur
  - per Kota
- **Customer**: the tab is only a note and a link. The list (Kode, Nama, Lokasi, Alamat, Phone, Fax, Kontak, Termin, Batas Piutang, Aktif) and the form (NPWP, Rayon, Sales, Tipe Harga, address detail) are missing.

### Master + Fasilitas
- **Asset**:
  - The Account Asset/Debet/Kredit columns, the Intangible tick, Keterangan and Import are missing.
  - The Penyusutan tab has no 7Soft journal (No Jurnal + grid + Selisih).
- **Account**:
  - Tipe Account uses ERP types. The 7Soft types are missing: AKTIVA LANCAR/TETAP/TAK BERWUJUD/LAIN-LAIN, INVESTASI JP, KAS/BANK.
  - "Create Coa" is missing.
  - An account can only be deactivated, not deleted.
- **Saldo Awal COA**:
  - **Read-only, from an import**. It cannot be typed into the grid.
  - It lists only accounts that carry a balance, not all 281.
  - There is no Create New Saldo and no Search.
- **Setting COA**:
  - **7 slots have no role**: Hutang Suspend, Laba, Pembelian Jasa, Penjualan Jasa, Piutang, Potongan Piutang, Uang Muka Penjualan.
  - Stok Adjustment and Stok Opname are one role.
  - The Item·Account tab, Set as default and Synkron Acc are missing.
- **User & Group**:
  - The group header (Nama, Keterangan, Aktif) is missing.
  - The user detail is missing: Jabatan, Report Admin/Template/Excel, Mulai–Sampai.
  - The Menu grid lists API paths, not 7Soft menu names with a Modul column.
  - The View/Tambah/Edit/Hapus ticks per group cannot be set.
  - Select All, Unselect, Copy are missing.
- **Setting Menu**: only Kode No Transaksi exists. Missing: Display, Urutan, Tanggal Bisa Edit, Tampil Awal, Auto Insert, Sorting, Keterangan.
- **Persiapan Singkat / Set Up**:
  - Info Perusahaan: missing Logo, No Seri Faktur Pajak, PKP no/date.
  - General/Transaksi switches are missing, for example Tanggal Mulai Program, Decimal, Pembulatan PPN, Default Tanggal BKK/BKM, Limit nilai.
  - Kosongkan DB/Import Master/Restore Default are missing.
- **History Report**: does not exist, because report opens are not logged.
- **History**:
  - Shows Finance only.
  - No Dokumen shows a shortened id, not the document number.
  - No Search, Tipe filter or Print.
  - The "LAPORAN EXPORT XLS" rows are missing.

## C. Order of work (proposed)

1. **Menu** (cheap, frontend only): make the sidebar follow the 7Soft menu exactly. Give every 7Soft finance menu a row in 7Soft's order and words, with the Analisa and Fasilitas groups. Join the two Faktur Pembelian rows into one. Fix `parity-menus.ts` to show the hub's real state.
2. **Transaksi Jurnal** (the page Hari sent): a 7Soft header (No Jurnal, Tanggal+time, No Referensi, Keterangan, Periode, Otomatis) plus a grid (Deskripsi Account · Kode · Uraian · Debet · Kredit) plus Total/Selisih, a Penyusutan button and Print. Uraian per line already exists on the server (`memo`).
3. **Info Kas Bank as one 4-tab screen**, the BKM customer picker, and the Settle/offset rows that work.
4. **Laporan Kas/Bank** 20 reports, then Laporan Pembelian/Penjualan/Accounting.
5. Faktur/Retur Pembelian item grid + PO-BPB-INVOICE; the Penjualan Cash receipt list + lines.
6. Master: Saldo Awal COA typed in, the 7 Setting COA slots, User & Group per 7Soft, Setting Menu, Set Up switches, History.

Points 3–6 partly need backend work (new fields, endpoints, posting roles).

## D. After the frontend pass (28 Oct 2026): what was added, and which way is better

The pass added every 7Soft tab, column, button and report that the existing API can feed. A field the API does not carry shows "—" where 7Soft has it. The list of what is still missing, which is mostly backend, is on `/finance/7soft-parity` (`parity-menus.ts` `COVERAGE`).

Nothing was type-checked or run in a browser. Every changed file passes a syntax parse and transforms through the running Vite server.

The verdict column compares 7Soft's way with the hub as it was **before** today, judged for a finance clerk who used 7Soft for years:
- **7Soft**: 7Soft's way is better.
- **Ours**: our earlier way is better.
- **Both**: keep both, as built now.

| Menu | Added today | Verdict | Why |
|---|---|---|---|
| Info Kas Bank | One screen with Kas/Bank · Kartu · BKM · BKK tabs for the picked account; Keterangan and Aktif columns | Both | 7Soft never makes you pick the account twice. Ours keeps the unit filter, live balances and export. |
| BKM · BKK | "+" row expand, Keterangan per settle line, Reff No, giro status NEW/CAIR/TOLAKAN, READ ONLY, time | Both | 7Soft's expand and line notes let you check a voucher without opening it. Our Draft → Approved → Posted flow and the Klasik form's checks stop over-settling before it posts. |
| Pencairan BG | Separate issuing Bank column, Print, XLS | Both | 7Soft's columns are what the clerk checks before banking. Our board shows what is due at a glance. |
| Laporan Kas/Bank | All 20 reports with 7Soft's selection box | 7Soft | We had none. |
| Info Accounting | New page: Account · Jurnal · All Jurnal · Buku Besar Pembantu · Neraca Saldo | 7Soft | One window for "check the trial balance, then drill into one account" beats two separate pages. Our drill-through links stay. |
| Transaksi Jurnal | 7Soft header (No Referensi, Periode, Otomatis), grid Deskripsi · Kode · Uraian · Debet · Kredit, Selisih, Del All, Penyusutan, Print, NEW/READ ONLY | Both | 7Soft's grid is faster to type, and Selisih shows an unbalanced entry at once. Ours never deletes (reverse only), keeps unit and category per line, and refuses a closed month. |
| Closing Periode | Tanggal column, View Problem | Ours | 7Soft lets you tick "ignore validation" and close anyway. Our checklist will not seal a month with open problems. |
| Laporan Accounting · Keuangan · Manajerial | Three separate menus, each with its own numbered list | Both | 7Soft's numbered list is the better index. Our report screens have real filters. |
| Info Pembelian | Lokasi, Fax, Limit hutang, No PO, No Ref, giro no and due date on Pelunasan, Sampai tanggal, XLS on every tab, Nota/Retur baru | Both | 7Soft puts supplier, purchases, payments and debt on one screen. Ours keeps the live balance and ledger. |
| Faktur Pembelian | One row; 7Soft header, grid, Uang Muka / Pelunasan / PO-BPB-INVOICE tabs, Cash, Pay, Retur, Print | Both | 7Soft's PO-BPB-INVOICE view catches "invoiced more than received". Our register and its draft, matched and held states stop paying the wrong bill. |
| Invoice Retur Beli | Item grid (where linked), 7Soft header, Pelunasan, Print, READ ONLY | Both | Ours was an amount only, so you could not see what went back. |
| Laporan Pembelian | All 33 in 7Soft's order; 8 are still empty | Both | Complete like 7Soft, but an empty report is noise. Hide the 8 until their data exists. |
| Info Penjualan | New page: sales and returns in one list, with 7Soft's columns, chips, date range, XLS | Both | One place to find a nota number. Credit columns we do not use read "—" and should go in the improvement pass. |
| Penjualan Cash · POS | Cash / Barcode (POS) tabs, nota list, line grid, PPN / Total diskon / Total, free date range, Print | Both | 7Soft's screen is for typing a nota, but here the tills write it. So the job is checking: 7Soft's nota list and lines on top of our day KPIs and tenders. |
| Retur Penjualan | New page: lines, Gudang, Grand Total, refund as Pelunasan | Both | 7Soft's form is easier to audit. Ours shows where the piece went (stock or reject). |
| Laporan Penjualan | 7Soft's cash and POS reports, monthly chart, Cetak Ulang Nota | 7Soft | We had one report. |
| Customer · Supplier · Pajak | Supplier and customer lists with 7Soft's columns and detail sheets, a PPN tab, Default columns | Both | 7Soft keeps the parties in one menu. Our split by owner stops two masters drifting apart. |
| Asset | Account Asset / Debet / Kredit, Intangible, Keterangan, a 7Soft journal under the depreciation run | Both | 7Soft's account trio shows a wrongly linked category. Ours adds book value and treatment. |
| Account | 7Soft Tipe Account names | Both | The clerk's words on top of our tree with live balances. |
| Saldo Awal COA | Every account listed (zero shows 0), search | Ours | Typing 281 balances by hand is slow and error-prone. Our import, rehearsed and tied out, catches more. |
| Setting COA | Item · Account tab | Both | 7Soft's 23 flat rows are easy to scan. Our roles show gaps and per-unit exceptions. |
| User & Group | Group tab with 7Soft's header, users, and a menu grid with View/Tambah/Edit/Hapus (read only) | 7Soft | Ticking rights per menu is faster than reading role rungs. It needs backend to be settable. |
| Setting Menu | New page; numbering saves | Both | One screen for numbering and menu behaviour. Only numbering is live. |
| Persiapan Singkat dan Set Up | 7Soft tabs (Info Perusahaan, Setup, Setting Akun, …) | Both | 7Soft's flow is a good install checklist. Ours applies settings at once and validates them. |
| History | Search, Tipe chips, Print, document numbers | Both | 7Soft's columns with our user and date filters. |

**Pattern.** 7Soft wins on **one window per job** (everything about one account, supplier or voucher on its tabs) and on **numbered report lists**. Ours wins on **controls**:
- draft and approval
- reverse-not-delete
- month gates
- import tie-outs
- live balances

The improvement pass should keep 7Soft's windows and lists and put our controls inside them.
