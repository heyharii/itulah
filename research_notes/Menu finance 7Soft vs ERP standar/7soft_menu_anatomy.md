# 7Soft finance-function anatomy: where every finance function sits in the 7Soft menu tree

*Conventions.* "M p.N" = printed page N of the 7Soft manual text (PDF page = N + 6). "Shot pNNN" = a manual screenshot (NNN = PDF page). "Screen copy" = the structured copies of those screenshots in `finance-7soft/scr7-*.js`. Categories: **AR**, **AP**, **GL**, **CB** (cash & bank), **FA** (fixed assets), **Tax**, **Close**, **Rep** (reporting), **Master**, **Sys** (system), **Op** (operational: a sales, purchase or stock document). Links are reference-style; their targets are listed at the end of the file.

## 1. What jobs does each 7Soft finance menu do (tabs, documents, inquiries, reports)?

### Takeaway
The manual's 37 "finance" menus are mostly not finance transactions. They break down as 9 master-data screens, 5 system screens, 4 "Info" inquiry hubs, 6 numbered report lists and 6 sales or purchase documents. Only 7 are finance transactions or processes: BKM, BKK, Pencairan BG Masuk and Keluar, Transaksi Jurnal, Closing Periode and Reproses Accounting. Every module repeats one triad: an **Info** screen with tabs, the **documents**, and a numbered **Laporan** list.

### Cited Findings

**Menu and report counts**
- The manual's table of contents has 69 menus. `data-menus.js` tags 37 of them as finance: Master 2.8–2.12 and 2.15–2.20, Pembelian 4.1 and 4.4–4.6, Penjualan 5.1 and 5.4–5.8, Kas-Bank 6.1–6.6, GL 7.1–7.4, Analisa 8.1–8.2, and Fasilitas 9.3 and 9.10–9.12 ([data-menus.js][DM]).
- The manual claims "lebih dari 157 jenis laporan" ([M p.4][M]) and "150+ business and financial statement reports" ([M p.1][M]). Per module it claims Inventory >20, Penjualan >45, Pembelian >30, Kas-Bank >20 and GL 27 ([M p.5–7][M]).
- The printed lists are shorter: Inventory 27, Pembelian 33, Penjualan 43, Kas/Bank 20, Laporan Accounting 12, Laporan Keuangan 15 and Laporan Manajerial 3, which is 153 in total ([M p.105–109, 131–137, 164–173, 192–199, 206–212][M]).
- The screenshots show 44 Penjualan reports (they add "SJ Outstanding Premium") and 4 Manajerial reports (they add "Fast Moving Kelompok Item") ([Shot p170][S170]; [Shot p217][S217]).
- GL's "27" equals the 12 Laporan Accounting reports plus the 15 Laporan Keuangan reports ([M p.7, 206–211][M]).

#### 1a. Master: the finance menus, plus the finance parts of other Master menus

| Menu | What is on it | Jobs (category) | Source |
|---|---|---|---|
| 2.8 Jangka Waktu Kredit | Nama/Kode, Keterangan, Jangka waktu (hari), Default, Aktif. The screen shows T0 "0 Hari (CASH)", T7, T14, T21. | Payment terms for both customers and suppliers (Master) | [M p.59–60][M]; [screen copy][SU] |
| 2.9 Alamat | Kode, Alamat, Telp, Fax, Status Bisa Kirim, Aktif: "alamat perusahaan pusat beserta cabang" | Head-office and branch addresses used by Gudang and Info Perusahaan. No ledger effect (Master, not really finance). | [M p.31, 60–61][M] |
| 2.10 Pajak | Kode pajak, Persen, Default, Aktif, for "PPh atau PPN". The screen shows PPN0 (0%) and PPN10 (10%, default). | Tax codes picked on documents (Tax, Master) | [M p.61–62][M]; [screen copy][SU] |
| 2.11 Customer | **Header:** Kode, Nama, T. Pembayaran, Batas J.Tempo, Batas piutang, Keterangan, Rayon, No NPWP ("untuk report pajak"), Status, Sales, COA Piutang, Tipe Harga Jual, and "Termasuk Supplier" (which opens COA Hutang). **Detail:** addresses with Bank Account, plus active and default flags for delivery and billing. **Tab Saldo Awal:** No Faktur, Tanggal, Jatuh Tempo, Total, Keterangan. Excel import. | Customer master (AR). Credit limit (AR control). Opening receivable per invoice (AR). Default receivable account (Master). Tax ID (Tax). Contra flag (AR/AP). | [M p.62–67][M] |
| 2.12 Supplier | **Header:** Kode, Nama, Termin, Batas hutang, Keterangan, Status, COA Hutang, No NPWP, and "Termasuk Customer" (which opens COA Piutang). **Detail:** addresses with Bank Account. **Tab Saldo Awal Hutang:** per invoice. Excel import, but "Saldo awal tidak bisa di import." | Supplier master (AP). Opening payable per invoice (AP). Default payable account. Tax ID. | [M p.67–71][M] |
| 2.15 Asset | Kode, Nama, Jumlah, Metode Depresiasi (Straight Line, Double Declining, Non Depreciable), Nilai Asset, Nilai Penyusutan (depreciation to date), Account Asset, Account Debet (expense), Account Kredit (accumulated), Intangible, Keterangan, Umur (years), Rate (calculated from Umur, editable), Tipe Asset, Tanggal Beli, Tanggal Pemakaian, Aktif | Asset register, depreciation parameters, account mapping per asset, opening accumulated depreciation (FA, Master) | [M p.74–75, 256–258][M] |
| 2.16 Account | Parent account (Kode, Nama, Tipe) and child accounts (No, Nama, Tipe, Aktif), Refresh, and "Create COA", which copies the accounts into Saldo Awal COA. An account typed **Kas/Bank** appears in every Kas/Bank picker. The screen's types are AKTIVA LANCAR, AKTIVA TETAP, AKTIVA TAK BERWUJUD, AKTIVA LAIN-LAIN, INVESTASI JANGKA PANJANG and KAS/BANK. | Chart of accounts (Master). Decides which accounts count as cash, bank or giro (CB). | [M p.37, 76–77][M]; [screen copy][SU] |
| 2.17 Saldo Awal COA | Kode, Nama, Saldo Awal (assets positive, liabilities and equity negative), Periode. The total must be 0. "Create New Saldo" adds accounts created later. Piutang, Hutang and Persediaan also need detail in Customer, Supplier and Item. | Opening trial balance (Master) | [M p.37–39, 77–78][M] |
| 2.18 Setting COA | **The text lists 23 default-account slots:** Default Kas Kecil (the default Kas/Bank on BKM and BKK), Disc Pembelian, Disc Penjualan, HPP, Hutang, Hutang Suspend (the BPB journal), Laba, Laba Ditahan, Pembelian Jasa, Penjualan, Penjualan Jasa, Persediaan Barang, Piutang, Potongan Hutang (the BKK discount), Potongan Piutang (the BKM discount), PPN Pembelian, PPN Penjualan, Retur Pembelian, Retur Penjualan, Stok Adjustment, Stok Opname, Uang Muka Pembelian, Uang Muka Penjualan. **The screenshot shows 22 rows** ("1 of 22"), with no Stok Adjustment row. | Default account mapping. Most slots are defaults copied onto new items and parties (Master). | [M p.78–80][M]; [Shot p84][S84] |
| 2.19 User & Group | **Group:** Nama, Keterangan, Status. **Users:** Nama user, Password, Nama Lengkap, Jabatan, Report level, Mulai and Sampai Tanggal. **Rights:** View, Tambah, Edit, Hapus per menu, in a tree of the 8 modules. The screen adds Select All, Unselect, Copy, Del All, Clear All and Create All. | Users and permissions (Sys) | [M p.81–83][M]; [Shot p88][S88] |
| 2.20 Setting Menu | Per menu: Display, Urutan, Kode No Transaksi (prefix, e.g. PJL-, PO-), Tanggal bisa edit, Tampil awal, Auto insert, Barcode, Ganti nama item, Sorting by, Keterangan, Template Nama/File, SQL | Document number prefixes, a back-dating lock per document type, print templates (Sys) | [M p.83–84][M] |
| 2.1 Daftar Nilai (non-finance) | Value lists. Holds the status words (New, Lunas, Cair, Tolakan …) and item groupings such as "Departement". | Sys | [M p.8, 45][M] |
| 2.2 Item (non-finance) | **Account tab:** 7 accounts per item (Acc. Penjualan, Persediaan, Disc. Penjualan, HPP, Ret Penjualan, Ret Pembelian, Hutang Suspend), Set as Default, and Synkron Acc, which moves already-entered transactions to a changed account. Also HPP Awal, and Jenis, which includes "Uang Muka": advances are booked on an item named UANG MUKA. | Account mapping per item (Master, GL) | [M p.47–51, 237][M] |
| 2.5 Saldo Awal (stock, non-finance) | Opening quantity and HPP per warehouse; importable | Opening inventory value | [M p.56–57][M] |
| 2.21 List Report (non-finance) | Catalogue of every report: Urutan, Nama, Display, Deskripsi, Modul, File Template, Aktif | Rep, Sys | [M p.85][M] |

#### 1b. Pembelian (4.1, 4.4, 4.5, 4.6)

| Menu | What is on it | Jobs (category) | Source |
|---|---|---|---|
| 4.1 Info Pembelian | **Tabs:** SUPPLIER (limit hutang, terms; drill-down from PO to Kartu Hutang; Supplier Baru) · PO (Supplier and Outstanding ticks; Order Pembelian Baru) · PEMBELIAN & RETUR (Nota Pembelian Baru, Retur Pembelian Baru) · PELUNASAN HUTANG (a "Pencairan Giro" button opens 6.5) · SUMMARY HUTANG · KARTU HUTANG (opening balance, purchases, returns and payments) | Payables inquiry, supplier ledger card, payment inquiry (AP). PO tracking (Op). A jump to giro clearing (CB). | [M p.110–114][M]; [screen copy][SB] |
| 4.4 Faktur / Invoice Pembelian | **Header:** No Faktur, Tanggal, Supplier, Lokasi, Jangka waktu, Jatuh Tempo, Tipe Invoice (Matching PO / Standard / Uang Muka), No PO, Gudang, No Ref (the supplier's invoice number), Total Diskon, PPN, Keterangan. **Lines:** discounts in Rp or %, cascading. **Buttons:** Apply Uang Muka. **Tabs:** Uang Muka (advance invoice, applied, Sisa) · Pelunasan (Voucher BKK, Jatuh Tempo, Hutang, No Reff, Bayar, Keterangan) · PO-BPB-INVOICE (quantity ordered, received, invoiced, outstanding, returned). **Right-click:** stock per warehouse, and "7 History harga beli". Unpaid invoices can be imported from Excel. The screen's toolbar has Cash and Pay. | Supplier invoice (AP). Three-way match view (AP control). Supplier advance and its application (AP). Input VAT (Tax). Stock receipt when there is no BPB (Op). Settlement view, and a second entry point for settlement (AP, CB). | [M p.121–128, 224][M]; [screen copy][SB] |
| 4.4 journals | **With a BPB:** Dr Utang Suspense / Cr Utang Dagang. **Without a BPB:** Dr Persediaan / Cr Utang Dagang. **Advance invoice:** Dr Uang Muka Pembelian / Cr Utang Dagang. **Apply the advance:** Dr Utang Dagang / Cr Uang Muka Pembelian. | GL | [M p.233–239][M] |
| 4.5 Invoice Retur Beli | **Header:** the invoice being returned (in full or in part), Gudang, Total Diskon, PPN. **Lines.** **Tab:** Pelunasan (BKK). "Bersifat mengurangi hutang dagang." **Journal with a BPB:** Dr Utang Dagang / Cr Utang Suspense. **Without:** Dr Utang Dagang / Cr Persediaan. | Debit note (AP). Stock out when no Retur Barang document exists (Op). | [M p.128–131, 236][M] |
| 4.6 Laporan Pembelian | **33 reports:**<br>• 1–11: purchase analysis (daily, monthly, per item, per supplier, Barang Datang value [Premium], price list, price history) (Op)<br>• 12: Summary Pembelian PPN (Tax)<br>• 13–16: Uang Muka summary, detail and outstanding (AP)<br>• 17–21: PO reports (Op)<br>• 22–23: returns (Op, AP)<br>• 24: Detail Pelunasan Nota Pembelian, with the BKK number and the Kas/Bank used (AP)<br>• 25: Hutang Jatuh Tempo<br>• 26: Summary Hutang Dagang<br>• 27: Summary Hutang per Tanggal (shows credit and cash purchases apart)<br>• 28: Kartu Hutang<br>• 29: Sisa Hutang<br>• 30: Umur Hutang per Supplier per Faktur<br>• 31: Sisa Hutang per Supplier<br>• 32: Umur Hutang (AP)<br>• 33: List Supplier (Master) | AP, Tax, Op | [M p.131–137][M]; [screen copy][SB] |

#### 1c. Penjualan (5.1, 5.4–5.8)

| Menu | What is on it | Jobs (category) | Source |
|---|---|---|---|
| 5.1 Info Penjualan | **Tabs:** CUSTOMER · SO · PENJUALAN & RETUR (Nota Baru, Retur Baru) · PELUNASAN PIUTANG (a "Pencairan Giro" button opens 6.4) · SUMMARY PIUTANG · KARTU PIUTANG. The screen's sales list has a SHIFT column. | Receivables inquiry and ledger card (AR). SO and sales list (Op). | [M p.138–143][M]; [screen copy][SS] |
| 5.4 Penjualan Cash | A sale with a customer that is "tidak melalui akun piutang dagang". **Header:** No Faktur, Tanggal, Customer, Lokasi, Gudang, Keterangan, No Ref, Total Diskon, PPN. **Lines:** with Barcode. Shown on the menu only if Set Up says so; default discount; printed automatically or by hand. | Cash sale document (Op, posts to the ledger) | [M p.21, 29, 150–151][M] |
| 5.5 Penjualan Barcode (POS) | No customer. Opens the cash drawer. **Header:** No Faktur, Tanggal, Total Diskon, Keterangan. **Lines:** by barcode. | Till sale (Op) | [M p.152–153][M] |
| 5.6 Faktur Penjualan | Credit invoice. **Header:** Tipe Invoice (Matching SO / Standard / Uang Muka), No SO, No Surat Jalan, Sales, Gudang, Jangka waktu, Jatuh Tempo, PPN. **Buttons:** Apply Uang Muka. **Tabs:** Uang Muka · Pelunasan (Voucher BKM) · Info SO-SJ-INVOICE. "7 History harga jual". Excel import of unpaid invoices. **Journals:** Dr Piutang Dagang / Cr Penjualan, plus Dr HPP / Cr Persediaan when there is no Surat Jalan. Advance invoice: Dr Piutang / Cr Uang Muka Penjualan. Apply the advance: Dr Uang Muka Penjualan / Cr Piutang. The module also offers "Mencetak Faktur Pajak Standard". | Customer invoice and customer advance (AR). Output VAT (Tax). Stock out when there is no Surat Jalan (Op). | [M p.6, 154–161, 242–250][M] |
| 5.7 Transaksi Retur Penjualan | **Header:** the invoice being returned, Gudang, PPN. **Lines.** **Tab:** Pelunasan (BKM). "Bersifat mengurangi piutang dagang." **Journal:** Dr Retur Penjualan / Cr Piutang, plus Dr Persediaan / Cr HPP when there is no stock-return document. | Credit note (AR). Stock back (Op). | [M p.161–164, 246][M] |
| 5.8 Laporan Penjualan | **43 reports in the text** (the screen adds "SJ Outstanding Premium"):<br>• 1–5: Harian Detail Item, Summary (New/Lunas status), Cetak Invoice (reprint), Nota, Rekap Detail Faktur<br>• 6: Nilai Surat Jalan [Premium]<br>• 7: Penjualan tiap User (takings per cashier, for cash, barcode and credit)<br>• 8: Bulanan, with a chart<br>• 9: Summary Penjualan PPN (Tax)<br>• 10: Barang dan Jasa<br>• 11–14: per item and per customer, daily and monthly (Op)<br>• 15–19: SO reports (Op)<br>• 20–21: Komisi Sales; one uses the BKM date, 1% if paid within 15 days of the due date<br>• 22–27: takings per salesman, per Rayon, per city (Op)<br>• 28–31: Uang Muka Penjualan (AR)<br>• 32–33: returns<br>• 34–42: Piutang Jatuh Tempo, Summary Piutang, Summary per Tanggal, Kartu Piutang, Sisa Piutang, Umur per Customer per Faktur, Sisa per Customer, Umur Piutang, Detail Pelunasan Nota Penjualan (AR)<br>• 43: List Customer (Master) | AR, Tax, Op | [M p.164–173][M]; [Shot p170][S170] |

#### 1d. Kas - Bank (6.1–6.6)

| Menu | What is on it | Jobs (category) | Source |
|---|---|---|---|
| 6.1 Info Kas Bank | An account picker (the demo shows "500 Kas Kecil"). **Tabs:**<br>• KAS/BANK: Kode Acc, Nama, opening balance, Debet, Kredit, closing balance; Periode, Sampai Tanggal, Refresh; Keterangan, Aktif<br>• KARTU KAS/BANK: Tanggal, No Transaksi, Tipe, Nama Client, Debet, Kredit, Saldo<br>• BKM register and BKK register: Tanggal, No, Client, No Cek/Giro/Card, Total, Keterangan, Periode, and an "only this Kas/Bank" tick<br>Only accounts typed Kas/Bank appear, and "semua kas, bank, maupun piutang giro" must carry that type. The demo list includes "AYAT PERANTARA", "GIRO MASUK", "GIRO EKON … BR" and even "Piutang 146". | Cash position, cash and bank book, voucher registers (CB) | [M p.174–179][M]; [Shot p180][S180] |
| 6.2 BKM (Bukti Kas/Bank Masuk) | **Header:** No Voucher, Tanggal (with time), Kas/Bank, No Ref, Keterangan, Customer with code, No Check/Giro, Check/Card dari Bank, Tgl J. Tempo, Total. **Buttons:** Tolakan (replacement money for a bounced giro), Browse Nota (many invoices at once), Del All. **Tabs:**<br>• Pelunasan Piutang: No Faktur, J.Tempo, Piutang, Reff No, Keterangan, Potongan (account set in Setting COA), Terima, Lunas<br>• Lain-lain: any account, e.g. "piutang pihak ketiga, kurang/lebih bayar", bank interest<br>• Hutang: purchase invoices, used for netting a party that is both customer and supplier, and for supplier refunds such as an advance being returned<br>Status NEW and READ ONLY. **Journal:** Dr Kas/Bank or Piutang Giro / Cr Piutang Dagang. | Customer receipt (AR, CB). Other income (CB, GL). Incoming giro: pick the Giro Masuk account as the Kas/Bank, giving Dr Piutang Giro (CB). Supplier refund and contra (AP). Transfer in (CB). | [M p.179–183, 250–251, 266–267][M]; [Shot p185][S185] |
| 6.3 BKK (Bukti Kas/Bank Keluar) | The mirror of BKM, with Supplier in the header. **Tabs:**<br>• Pelunasan Hutang: Potongan (Setting COA Potongan Hutang), Bayar, Lunas<br>• Lain-lain: expenses, e.g. "hutang pihak ketiga, adm bank", "biaya bensin, pajak bank"<br>• Piutang: sales invoices of a party that is both, and customer refunds<br>A giro payment needs giro accounts set up first ("Giro BCA, Giro Ekonomi"), so that "Hutang Giro bertambah". **Journal:** Dr Utang Dagang / Cr Kas/Bank or Utang Giro. | Supplier payment (AP, CB). Expenses and other payments (CB, GL). Outgoing giro (CB, AP). Customer refund (AR). Transfer out (CB). | [M p.183–187, 251–253, 268–269][M] |
| 6.4 Pencairan BG Masuk (Standard and Premium only) | **Tab List BG:** filled automatically from BKMs entered on a Giro Masuk account, status NEW. Filters All / Jatuh Tempo / New / Cair / Tolak.<br>**Buttons:**<br>• Cair: needs Bank tujuan and the clearing date; the BKM becomes CAIR<br>• Tolak: only from CAIR<br>• Batal Cair: refused once the giro is closed<br>• Checked<br>• Giro Baru: replaces a bounced giro<br>**Tab Saldo Awal:** giros still open at go-live.<br>**Journals:** Cair Dr Bank / Cr Piutang Giro. Tolak Dr Piutang Giro / Cr Bank. Giro Baru Dr Piutang Giro (new) / Cr Piutang Giro (old). BKM Tolakan Dr Kas/Bank / Cr Piutang Giro (old). | Clearing, bounce, replacement and opening of received giros (CB, AR side) | [M p.11, 187–189, 253–255][M] |
| 6.5 Pencairan BG Keluar | The same, for giros issued through BKK | Clearing of issued giros (CB, AP side) | [M p.190–192, 255][M] |
| 6.6 Laporan Kas/Bank | **20 reports:**<br>• 1: Harian Kas & Bank (balances, plus the bounced incoming-giro balance)<br>• 2–6: daily and period detail, per transaction and periodic (CB)<br>• 7–8: Summary and Detail Pelunasan Piutang, seen from the cash side, so they exclude Potongan (AR)<br>• 9–10: the same for hutang (AP)<br>• 11–14: Summary and Detail BKM, and Summary and Detail BKK, for receipts and payments other than piutang or hutang (CB, GL)<br>• 15–20: Giro Masuk, Giro Keluar, Belum Cair per customer, Belum Cair per supplier, Perincian Tolakan Masuk, Perincian Tolakan Keluar (CB) | CB, AR, AP | [M p.192–199][M]; [screen copy][SC] |

#### 1e. GL · Buku Besar (7.1–7.4)

| Menu | What is on it | Jobs (category) | Source |
|---|---|---|---|
| 7.1 Info Accounting | **Tabs:**<br>• ACCOUNT: balances by period; Account Baru<br>• JURNAL: manual journals only; Jurnal Baru<br>• ALL JURNAL: every automatic and manual journal for a date, for "melihat secara cepat balance/tidaknya"<br>• BUKU BESAR PEMBANTU: one account over a date range<br>• NERACA SALDO: trial balance at a date | Ledger inquiry (GL, Rep) | [M p.200–203, 264][M]; [screen copy][SG] |
| 7.2 Transaksi Jurnal | **Header:** No Jurnal, Tanggal, No Referensi, Keterangan, Status Otomatis (ticked when a document created the journal), Periode Acc. **Button:** PENYUSUTAN makes this month's depreciation journal from Master Asset. **Lines:** Deskripsi Acct, Kode Acct, Uraian, Debet, Kredit. Selisih must be 0. Used for adjusting and reversing journals ("jurnal penyesuaian, jurnal pembalik"), and for assets not acquired by purchase (credited to Modal). | Manual journals (GL). Depreciation run (FA). Asset acquisition outside purchasing (FA). | [M p.203–205, 255–258][M] |
| 7.3 Closing Periode Akuntansi | **Buttons:** Create Period, Closing, Undo Closing. **Grid:** Periode, Tanggal, Tahun, Bulan, Mulai, Akhir, Status (monthly periods). **The screen adds:**<br>• PROSES SALDO AWAL PROGRAM KE NERACA AWAL (Proses)<br>• TEST VALIDASI TRANSAKSI and TEST VALIDASI ACCOUNTING (Test, View Problem)<br>• a SETUJU ABAIKAN VALIDASI tick<br>• a warning that no other user may be in 7Soft<br>Every form shows its status in green (open) or red (closed). | Month close and reopen, balance roll-forward (Close) | [M p.8, 40, 205–206][M]; [Shot p211][S211] |
| 7.4 Laporan Accounting | **12 reports:**<br>• 1: Perhitungan HPP (Op, stock cost)<br>• 2: Laporan Jurnal (all sources, "ayat silang")<br>• 3–7: Jurnal Pembelian, Penjualan, Persediaan, Pengeluaran Kas (BKK), Penerimaan Kas (BKM) (GL, books of prime entry)<br>• 8: Buku Besar Pembantu (GL)<br>• 9: Persediaan Akhir Bulan (ties stock to the ledger)<br>• 10: Master Account (Master)<br>• 11–12: Aktiva Tetap dan Penyusutan, by period and by year (FA) | GL, FA, Rep | [M p.206–208][M]; [Shot p212][S212] |

#### 1f. Analisa (8.1–8.2)

| Menu | What is on it | Jobs (category) | Source |
|---|---|---|---|
| 8.1 Laporan Keuangan | **15 reports:**<br>• 1–5, profitability (Rep, management): Laba/Rugi Penjualan per Item; Laba Rugi Item/Barang (detail per customer); Laba Rugi Customer (detail per item); Laba Rugi Nota; Laba Rugi per Sales (for commission)<br>• 6–15, statements (Rep): Laba Rugi GL (period and year to date); Laba Rugi (Barang), with COGS worked out as opening stock + purchases − closing stock; Laba Rugi Tahunan (12 months); Neraca Saldo; Neraca ke Kanan and Neraca Standard (each with last month); Neraca Perbandingan 2 Bulan; Neraca Common Sized; Neraca Tahunan; Arus Kas | Rep | [M p.209–211][M]; [Shot p215][S215] |
| 8.2 Laporan Manajerial | The text lists Fast Moving Item, Slow Moving Item and 10 Top Customer, each with a pie chart. The screen adds Fast Moving Kelompok Item. | Rep, management: sales and stock analytics with no ledger content | [M p.211–212][M]; [Shot p217][S217] |

#### 1g. Fasilitas (9.3, 9.10–9.12) and screen-wide finance pieces

| Menu | What is on it | Jobs (category) | Source |
|---|---|---|---|
| 9.3 Reproses Accounting | For each open period, Proses re-journals every transaction. A closed month needs Undo Closing first. Used "jika ada jurnal yang tidak masuk ke Buku Besar". | Rebuild the ledger from the documents (Close, Sys) | [M p.42, 216–217][M] |
| 9.10 Persiapan Singkat dan Set Up | A wizard, "Langkah 1 dari 15".<br>**Tabs:**<br>• Info Perusahaan: Nama, Logo, Alamat, NPWP, No Seri Faktur Pajak, No and Tanggal Pengukuhan PKP<br>• Setup: General and Transaksi switches<br>• Setting Akun: Daftar Akun with Use Default and Clear All; default accounts per transaction; Jangka Waktu Kredit; Daftar Pajak<br>• Gudang & Barang, Person, Appearance<br>**Finance switches:**<br>• Tanggal Mulai Program<br>• No Transaksi, reset monthly or yearly, automatic or manual<br>• Saldo Awal COA Mulai dari Awal<br>• the cash and barcode sale forms on or off<br>• Sistem Pembelian and Sistem Penjualan (5 document flows each)<br>• order and sale value over the hutang/piutang limit<br>• selling below the price list or below HPP<br>• Pembulatan PPN<br>• Default Tanggal BKK/BKM<br>• Kosongkan Database, Import Master, Restore Default | Company tax identity (Tax). Numbering and controls (Sys). Second entry point to the COA, terms and tax masters (Master). | [M p.19–31, 222][M]; [Shot p228 (907)][S228a] |
| 9.11 History Report | A list of report files produced earlier (e.g. "Laporan_Kas-Bank_Detail_Per_Transaksi_Periodik1.xls"), with Print, Print Preview, Open to Excel, Zoom | Rep, Sys | [M p.222][M]; [Shot p228 (908)][S228b] |
| 9.12 History | Audit trail: Tanggal with time, Menu, Tipe (TAMBAH, EDIT, …, LAPORAN EXPORT XLS), No Dokumen, User. The demo has 550 rows. | Audit (Sys) | [M p.4, 223][M]; [Shot p229][S229] |
| Other Fasilitas | 9.1 Reproses Stok and 9.2 Reproses HPP (Close, inventory). 9.4 List User Online. 9.5 Restore & Patch. 9.6 Back Up (7zip). 9.7 Export/Import Master (with opening balances). 9.8 Archive Data Lama (deletes data up to a cut-off date, after a backup). | Sys | [M p.213–221][M] |
| Screen-wide | **Toolbar buttons:** "Pelunasan Penjualan/Pembelian tunai" and "… kredit"; "Info user pemakai dan tanggal serta edit terakhir"; Copy; Closed PO/SO. **Note for Today:** Omzet; minimum stock; open PO and SO; Piutang Jatuh Tempo (right-click to settle in BKM); Hutang Jatuh Tempo (right-click to pay in BKK). **Locks:** a saved header cannot be deleted, and a document used by a later one locks. | AR, AP, Sys | [M p.7, 33–35, 224][M] |

#### 1h. Operational menus outside the brief's list that post to the ledger

| Menu | Ledger effect | Source |
|---|---|---|
| 3.3 Stock Adjustment | An Account field takes the difference. The "Adjust Nilai" tick lets the user set HPP. | [M p.94–96][M] |
| 3.4 Adjustment Nilai | Changes value only (HPP), against a chosen Account | [M p.96–97][M] |
| 3.5 Retur Barang ke Supplier (Premium) | Dr Utang Suspense / Cr Persediaan | [M p.98, 236][M] |
| 3.6 Retur Barang dari Customer (Premium) | Dr Persediaan / Cr HPP | [M p.99, 245][M] |
| 3.8 Stok Opname | The count difference becomes an adjustment, on the Setting COA "Stok Opname" account | [M p.80, 103–104][M] |
| 3.9 Laporan Inventory | 27 reports. Only #11 Mutasi Item and #16 Persediaan Akhir show amounts. | [M p.105–109][M] |
| 4.2 Order Pembelian · 5.2 Sales Order | No journal | [M p.230, 240][M] |
| 4.3 Barang Datang / BPB (Premium) | Dr Persediaan / Cr Utang Suspense | [M p.231][M] |
| 5.3 Surat Jalan (Premium) | Dr HPP / Cr Persediaan | [M p.241][M] |

### Inferences
- How the 37 finance menus break down (from 1a–1g):

  | Kind | Count | Menus |
  |---|---|---|
  | Master data | 9 | 2.8–2.12, 2.15–2.18 |
  | System | 5 | 2.19, 2.20, 9.10–9.12 |
  | Info inquiry hubs | 4 | 4.1, 5.1, 6.1, 7.1 |
  | Numbered report lists | 6 | 4.6, 5.8, 6.6, 7.4, 8.1, 8.2 |
  | Sales and purchase documents | 6 | 4.4, 4.5, 5.4–5.7 |
  | Finance transactions or processes | 7 | 6.2–6.5, 7.2, 7.3, 9.3 |

- The Info hubs are not finance-only. Info Pembelian and Info Penjualan mix PO/SO tracking with the payables and receivables ledgers. Info Kas Bank is pure cash. Info Accounting is pure ledger.
- 7Soft's GL module holds no subledgers. It holds the output of every document, plus manual journals, depreciation and the month close.
- Giro is a pseudo-cash account. A received or issued giro is "paid into" a Kas/Bank-typed giro account, then moved to the real bank when it clears. That is why giro accounts, and in the demo even receivable accounts, appear in Info Kas Bank.
- The demo's "AYAT PERANTARA" account, typed Kas/Bank, suggests that some users route transfers through a clearing account. The manual does not describe this.

### Gaps
- The manual does not give the journal for Penjualan Cash or POS sales, or say which Kas account they hit. It is silent on voiding or editing BKM and BKK, and on how PPN on till sales is captured. The 27 Oct full-manual read reached the same conclusion ([memory note][MBX]).
- The text and the screens disagree in three places:
  - Setting COA: 23 slots in the text, 22 rows on the screen.
  - Laporan Penjualan: 43 reports in the text, 44 on the screen.
  - Laporan Manajerial: 3 reports in the text, 4 on the screen.
- The manual contradicts itself on cash sales. 5.4 says cash sales do not use Piutang Dagang, yet report #35 Summary Piutang Dagang counts "penjualan (tunai & kredit) – pelunasan", and #36 reports cash sales separately ([M p.150, 170–171][M]). The sources do not settle whether cash sales pass through the receivable.
- The book carries "Copyright©2007" on its cover ([M cover][M]), but its screenshots are from a 2016 "Seventhsoft Premium Accounting" demo ([Shot p229][S229]). The sources do not show which edition (Basic, Standard or Premium) or which build the client ran, or whether the client used the BPB, giro and Asset features.

## 2. Where does each standard finance function sit in 7Soft?

### Takeaway
Each standard function has a predictable home in 7Soft:

| Function area | Where it sits in 7Soft |
|---|---|
| Customer receivables (AR) | Penjualan; the money leg in Kas-Bank (BKM) |
| Supplier payables (AP) | Pembelian; the money leg in Kas-Bank (BKK) |
| Cash, bank and giro | Kas-Bank only |
| Journals, ledger inquiry, close | GL |
| Financial statements | Analisa |
| Fixed assets | Split between Master (register) and GL (depreciation button, reports) |
| Tax | No home: a code master, a field on documents, setup switches, three PPN reports |
| Setup and security | Spread over Master and Fasilitas |

For this client the live set is AP, cash and bank (including issued giros), GL, fixed assets, tax and close. Almost every AR function is irrelevant.

### Cited Findings

**Client chart facts used in the "Relevant" column**
- **Structure:** the chart has 626 rows, with code lengths 1/3/5/6/7/10 ([data-coa.js][COA]). Its header says "A 10-digit account is the base; a 12-digit account is the base + 2 digits of location (00 = HO, 01–13 = C001–C013)", but the file holds no 12-digit codes ([data-coa.js][COA]).
- **Receivables:** PIUTANG DAGANG (1011101) holds only "Piutang kartu Kredit" and "Piutang Debit Card". The other receivables are Piutang Pegawai, Piutang Kepala Toko, Piutang Manajemen, and per-unit Piutang Affiliasi (Pembiayaan, Atas Barang, Lain-lain) for HEAD OFFICE plus 13 named stores ([data-coa.js][COA]).
- **Card and QRIS takings:** since 1 Oct 2026 they post straight to Cash in Bank of the EDC's bank, cash goes to each store's Cash on Hand, and "EDC settlement tracking not wanted" ([memory, 1 Oct decision][MDT]).
- **Cash and bank:** CASH ON HAND, PETTY CASH, MODAL KASIR; CASH IN BANK GIRO (current accounts) at BCA, Mandiri, BRI, BNI and Danamon; CASH IN BANK TABUNGAN; TIME DEPOSIT ([data-coa.js][COA]).
- **Giro:** OUTSTANDING GIRO per bank (a liability), plus a 6-digit "204001 Giro Keluar". There is no incoming-giro or Piutang Giro account ([data-coa.js][COA]; [memory][MPRO]).
- **Payables:** Hutang Suppliers Barang Dagangan; Hutang Supplier Barang Dagang - Suspend; Hutang Supplier Non Barang Dagang ([data-coa.js][COA]).
- **Advances:** UANG MUKA / ADVANCED (Travelling, Purchase, To Contractors, Others), plus a 6-digit "205001 Uang Muka - Penjualan" ([data-coa.js][COA]).
- **Tax:** prepaid PPh 21/25/29 and "Prepaid - VAT (PPN Masukan)"; payable PPh 21, PPh 23 (withheld), PPh 25, "VAT PPN Keluaran" and PBB ([data-coa.js][COA]).
- **Accruals and prepayments:** 10 accrued-expense (YMHD) accounts and 9 prepaid (Bayar Dimuka) accounts ([data-coa.js][COA]).
- **Fixed assets:** buildings, installations, machinery, vehicles, 7 FF&E and 36 operating-equipment accounts, with accumulated depreciation or replacement reserves. Intangible software includes "Seventh Soft Application". There are also Pre Opening, CIP and Disposed Inventory accounts ([data-coa.js][COA]).
- **Revenue:** split by tender (Tunai; Debit Card per bank; Kartu Kredit VISA and Master; Online own and marketplace), plus Discount, Retur Penjualan and Management Fee ([data-coa.js][COA]).
- **Equity:** includes "Laba (Rugi) Ditahan" and "Laba (Rugi) bulan berjalan" ([data-coa.js][COA]).
- **Goods in transit:** BDP accounts per unit, for merchandise and for shopping bags ([data-coa.js][COA]).

**Function → 7Soft location(s) → category → relevant to this client**

*AR (customer side)*

| Function | 7Soft location(s) | Cat. | Relevant to this client? | Source |
|---|---|---|---|---|
| Customer invoice (credit) | 5.6 Faktur Penjualan (Standard or Matching SO; Matching SJ in Premium) | AR, Op | **No**: no credit sales and no customer receivable account | [M p.154–161, 242–245][M]; [memory][MPRO] |
| Cash or till sale | 5.4 Penjualan Cash; 5.5 Penjualan Barcode (POS); Set Up switches show or hide them | Op (posts revenue, cash, COGS) | **Yes in substance.** But sales are rung at the POS tills, so the entry form becomes a review list. | [M p.21, 150–153][M]; [gap doc §D][GAP] |
| Customer receipt / settlement | 6.2 BKM › Pelunasan Piutang (Browse Nota, Potongan, Lunas); the invoice toolbar's "Pelunasan Penjualan tunai/kredit"; Note for Today › Piutang Jatuh Tempo → BKM | AR, CB | **No** for customers; BKM stays for other receipts | [M p.33–35, 179–181, 224][M] |
| Payment inquiry per invoice | 5.6 Pelunasan tab; 5.1 PELUNASAN PIUTANG; Laporan Penjualan 42; Laporan Kas/Bank 7–8 | AR | No | [M p.142, 158, 172, 194][M] |
| Customer ledger card | 5.1 KARTU PIUTANG; Laporan Penjualan 37 | AR | No | [M p.143, 171][M] |
| Receivables balance / summary | 5.1 SUMMARY PIUTANG; Laporan Penjualan 35, 36, 38, 40 | AR | No | [M p.143, 170–171][M] |
| Customer aging | Laporan Penjualan 39 (per customer per invoice), 41 (Umur Piutang) | AR | No | [M p.171–172][M] |
| Due list / collection | Laporan Penjualan 34; Note for Today | AR | No | [M p.34, 170][M] |
| Customer statement (document sent to the customer) | **None.** The nearest is Kartu Piutang. | AR | No | [M p.143, 171][M] |
| Customer advance (uang muka) | 5.6 with Tipe Uang Muka (an item named UANG MUKA) → Apply Uang Muka and the Uang Muka tab; Laporan Penjualan 28–31; refunds through 6.3 BKK › Piutang; Setting COA Uang Muka Penjualan | AR | **Unclear.** The chart has "205001 Uang Muka - Penjualan" but no customer receivable. | [M p.80, 156–157, 169–170, 247–250, 267–269][M]; [data-coa.js][COA] |
| Credit note / sales return | 5.7 Retur Penjualan (value, with Pelunasan); 3.6 Retur Barang dari Customer (stock, Premium); Laporan Penjualan 32–33 | AR, Op | **Partly.** Till returns need the stock and revenue reversal (account Retur Penjualan), not the receivable leg. | [M p.99, 161–164, 245–247][M]; [data-coa.js][COA] |
| Opening receivables | 2.11 Customer › Saldo Awal (per invoice), plus 2.17 | AR, Master | No | [M p.38, 65–66][M] |
| Credit limit and terms | 2.11 Batas piutang, Batas J.Tempo, T. Pembayaran; 2.8; Set Up limit switches | AR, Master | No | [M p.25–26, 59–60, 63][M] |
| Contra (a party that is both customer and supplier) | Flags in 2.11 and 2.12; BKM › Hutang; BKK › Piutang | AR, AP | Unknown, probably rare | [M p.10, 63–64, 68, 182, 186][M] |
| Bad-debt provision or write-off | **No function**, only a manual journal in 7.2 | AR, GL | Low: the only receivables are card and staff balances, with matching provision accounts | [M p.203–204][M]; [data-coa.js][COA] |
| Commission based on collection | Laporan Penjualan 20–21 | Op, AR | No | [M p.168][M] |

*AP (supplier side)*

| Function | 7Soft location(s) | Cat. | Relevant to this client? | Source |
|---|---|---|---|---|
| Purchase order | 4.2 Order Pembelian (no journal) | Op | Yes | [M p.114–117, 230][M] |
| Goods received not invoiced (GRNI) | 4.3 BPB (Premium) posts Dr Persediaan / Cr Utang Suspense; Setting COA Hutang Suspend; Item › Acc. Hutang Suspend | AP, Op | **Yes**: the chart has "Hutang Supplier Barang Dagang - Suspend" | [M p.12, 50, 79, 231][M]; [data-coa.js][COA] |
| Supplier invoice | 4.4 Faktur Pembelian (Matching PO or Standard) | AP | **Yes, core** | [M p.121–128, 233–235][M] |
| Matching PO, receipt and invoice | 4.4 PO-BPB-INVOICE tab (also on 4.2 and 4.3); Set Up "Jumlah Item yang Dikirim > PO" and "Invoice … Matching Boleh Tambah Baris" | AP control | Yes | [M p.26–27, 117, 120, 126–127][M] |
| Supplier payment | 6.3 BKK › Pelunasan Hutang (Browse Nota, Potongan, Lunas); invoice toolbar Cash / Pay; Note for Today › Hutang Jatuh Tempo → BKK | AP, CB | **Yes, core** | [M p.34, 184–185, 224, 251–252][M]; [screen copy][SB] |
| Payment by bilyet giro | 6.3 BKK with a giro account (typed Kas/Bank) as the Kas/Bank → 6.5 Pencairan BG Keluar | AP, CB | **Yes**: the client pays by giro; the chart has OUTSTANDING GIRO per bank | [M p.190–192, 252, 255][M]; [data-coa.js][COA] |
| Payment inquiry | 4.4 Pelunasan tab; 4.1 PELUNASAN HUTANG; Laporan Pembelian 24; Laporan Kas/Bank 9–10 | AP | Yes | [M p.113, 125, 135, 194–195][M] |
| Supplier ledger card | 4.1 KARTU HUTANG; Laporan Pembelian 28 | AP | Yes | [M p.114, 136][M] |
| Payables balance / summary | 4.1 SUMMARY HUTANG; Laporan Pembelian 26, 27, 29, 31 | AP | Yes | [M p.113–114, 135–136][M] |
| Supplier aging | Laporan Pembelian 30, 32 | AP | Yes | [M p.136][M] |
| Due list | Laporan Pembelian 25; Note for Today | AP | Yes | [M p.34, 135][M] |
| Supplier-statement reconciliation | **None** among the 6 tabs and 33 reports | AP | Yes; a gap | [M p.110–114, 131–137][M] |
| Supplier advance (uang muka) | 4.4 with Tipe Uang Muka → Apply; the Uang Muka tab; Laporan Pembelian 13–16; refunds through 6.2 BKM › Hutang; Setting COA Uang Muka Pembelian; close the rest of the PO in 4.2 | AP | **Likely yes**: the chart has "Advanced - Purchase" | [M p.80, 124, 133–134, 237–239, 265–267][M]; [data-coa.js][COA] |
| Debit note / purchase return | 4.5 Invoice Retur Beli (value, with Pelunasan); 3.5 Retur Barang ke Supplier (stock, Premium); Laporan Pembelian 22–23 | AP, Op | Yes (supplier returns) | [M p.98, 128–131, 135, 236–237][M] |
| Opening payables | 2.12 Supplier › Saldo Awal Hutang (per invoice, not importable), plus 2.17; or import unpaid Faktur Pembelian from Excel | AP, Master | Yes, at go-live | [M p.38, 69–70, 121][M] |
| Terms and limits | 2.12 Termin and Batas hutang; 2.8; Set Up limit switches | AP, Master | Terms yes | [M p.25–26, 59–60, 68][M] |
| Default payables account | 2.12 COA Hutang; 2.18 Hutang | Master | Yes | [M p.68, 79][M] |
| Batch payment run across suppliers | **None.** Browse Nota works only inside one party's voucher. | AP | Yes; a gap | [M p.180, 184][M] |
| Purchase-price history | 4.4 right-click "7 History harga beli"; Laporan Pembelian 11 | Op | Yes | [M p.127–128, 133][M] |

*Cash & bank*

| Function | 7Soft location(s) | Cat. | Relevant to this client? | Source |
|---|---|---|---|---|
| Other receipts | 6.2 BKM › Lain-lain | CB, GL | Yes: supplier refunds, interest, other income | [M p.181–182, 251][M] |
| Other payments, expenses | 6.3 BKK › Lain-lain | CB, GL | Yes | [M p.185–186, 252–253][M] |
| Transfer between cash and bank | BKK or BKM: both claim "pemindahan atau transfer kas ke bank atau sebaliknya". The finance team's practice is one BKK with a Lain-lain line to the destination Kas/Bank. | CB | Yes: store cash to the bank | [M p.179, 183–184][M]; [memory][MBX] |
| Petty cash | Kas Kecil accounts typed Kas/Bank, used on BKM and BKK; Setting COA "Default Kas Kecil" is the default Kas/Bank on those vouchers. **No float or top-up function.** | CB | Yes: PETTY CASH and MODAL KASIR accounts | [M p.77–79][M]; [data-coa.js][COA] |
| Cash and bank balances | 6.1 KAS/BANK tab; Laporan Kas/Bank 1, 5 | CB | Yes | [M p.174–175, 192–194][M] |
| Cash and bank book | 6.1 KARTU KAS/BANK; Laporan Kas/Bank 2–6 | CB | Yes | [M p.175–176, 193–194][M] |
| Voucher registers | 6.1 BKM and BKK tabs; Laporan Kas/Bank 11–14 | CB | Yes | [M p.177–179, 195][M] |
| Giro received | 6.2 BKM on a Giro Masuk account (Dr Piutang Giro) | CB, AR | **No**: no incoming-giro account and no credit customers | [M p.250][M]; [memory][MPRO] |
| Giro issued | 6.3 BKK on a giro account (Hutang Giro increases) | CB, AP | **Yes** | [M p.252][M] |
| Giro clearing | 6.4 and 6.5 Cair (Bank tujuan, clearing date); also the "Pencairan Giro" button on the Info Pembelian and Info Penjualan Pelunasan tabs | CB | 6.5 yes; 6.4 no | [M p.113, 142, 188, 190–191, 253][M] |
| Giro bounce and replacement | 6.4 and 6.5 Tolak and Giro Baru; the Tolakan button on BKM and BKK; Laporan Kas/Bank 19–20 | CB | Issued giros: yes, rare | [M p.180, 184, 188, 196–197, 254–255][M] |
| Undo a clearing | Batal Cair, refused once the giro is closed | CB, Close | Yes | [M p.188, 191][M] |
| Opening giros | 6.4 and 6.5 Saldo Awal tab | CB, Master | Yes: giros still open at go-live | [M p.189, 191–192][M] |
| Giro reports | Laporan Kas/Bank 15–20; Harian Kas & Bank shows the bounced incoming-giro balance | CB | Reports 16, 18 and 20 | [M p.192–197][M] |
| **Bank reconciliation** | **None.** No menu, and 0 hits for "rekonsil" or "reconcil" in the manual text. | CB | **Yes, needed** | [M, full-text search][M] |
| Card / EDC settlement | **None** | CB | **No**: on 1 Oct the owner decided not to track it | [memory][MDT] |
| Bank charges and interest | BKK and BKM Lain-lain ("adm bank", "pajak bank", "bunga bank") | CB, GL | Yes | [M p.186, 251–253][M] |

*GL and close*

| Function | 7Soft location(s) | Cat. | Relevant to this client? | Source |
|---|---|---|---|---|
| Automatic journals | Every posting document (BPB, invoices, returns, Surat Jalan, cash sale, adjustments, BKM, BKK, giro). "Laporan Keuangan langsung dapat ditampilkan setiap saat, tanpa melalui posting." | GL | Yes | [M p.9, 230–255][M] |
| Manual, adjusting and reversing journals | 7.2 Transaksi Jurnal; reversals are typed by hand | GL | Yes | [M p.203–205, 255–256][M] |
| Recurring journal | **None** (0 hits for "berulang" or "recurring") | GL | Yes, needed: accruals, prepaid amortisation | [M, full-text search][M] |
| Journal inquiry | 7.1 JURNAL and ALL JURNAL; Laporan Accounting 2–7 | GL | Yes | [M p.201–202, 207][M] |
| Account detail (sub-ledger) | 7.1 BUKU BESAR PEMBANTU; Laporan Accounting 8 | GL | Yes | [M p.202, 207–208][M] |
| Trial balance | 7.1 NERACA SALDO; Laporan Keuangan 9 | GL, Rep | Yes | [M p.203, 210][M] |
| Create, close and reopen a period | 7.3 Create Period, Closing, Undo Closing (monthly) | Close | Yes | [M p.40, 205–206][M] |
| Pre-close checks | 7.3 Test Validasi Transaksi and Test Validasi Accounting, with View Problem; overridable by "Setuju Abaikan Validasi" | Close | Yes | [Shot p211][S211] |
| Roll balances forward | Closing makes the next period's opening balances; "Proses Saldo Awal Program ke Neraca Awal" | Close | Yes | [M p.40][M]; [Shot p211][S211] |
| Year-end close | **No separate step.** Setting COA slots LABA ("Laba Bulan Ini") and LABA DITAHAN; Laba Rugi Tahunan and Neraca Tahunan reports | Close | Yes. The hub plans an ERPNext-style Period Closing Voucher. | [M p.79, 210–211][M]; [Shot p84][S84]; [memory][MERP] |
| Reprocess | 9.1 Stok, 9.2 HPP, 9.3 Accounting; a closed month needs Undo Closing first | Close, Sys | Yes | [M p.41–42, 213–217][M] |
| Accruals and prepayments | **None**; manual journals only | Close, GL | Yes, needed: the YMHD and Bayar Dimuka accounts exist | [data-coa.js][COA] |
| Stock-to-ledger tie-out | **Only a written procedure** ("Cara Analisa Laporan": Mutasi Item = Persediaan Akhir Bulan = the inventory line of the balance sheet; the balance sheet = Buku Besar Pembantu); no screen | Close | Yes, needed | [M p.258–264][M] |
| Lock indicator | Green or red status on every form | Close | Yes | [M p.8][M] |

*Fixed assets*

| Function | 7Soft location(s) | Cat. | Relevant to this client? | Source |
|---|---|---|---|---|
| Asset register | 2.15 Asset; Laporan Accounting 11–12 | FA | Yes | [M p.74–75, 208][M] |
| Acquisition | Through 4.4 Faktur Pembelian (no extra journal), or through 7.2 (credited to Modal) when not bought | FA | Yes | [M p.256, 258][M] |
| Depreciation | 7.2 PENYUSUTAN button (this month, from Master Asset). Methods: Straight Line, Double Declining, Non Depreciable. An intangible is credited to the asset itself. | FA, Close | Yes | [M p.204, 257][M] |
| Disposal, transfer between stores, revaluation | **None**; only an Aktif tick | FA | Yes, needed: "Disposed Inventory" and operating-equipment replacement reserves exist | [M p.75][M]; [data-coa.js][COA] |
| Construction in progress, pre-opening costs | **None** | FA | Yes: CIP and Pre Opening accounts exist | [data-coa.js][COA] |

*Tax*

| Function | 7Soft location(s) | Cat. | Relevant to this client? | Source |
|---|---|---|---|---|
| Tax codes | 2.10 Pajak; Persiapan Singkat › Setting Akun › Daftar Pajak | Tax, Master | Yes | [M p.30, 61–62][M] |
| VAT on documents | The PPN field on PO, SO, invoices, returns and cash sales | Tax | Yes | [M p.116, 122, 151, 156][M] |
| VAT accounts | 2.18 PPN Pembelian and PPN Penjualan | Tax, Master | Yes | [M p.80][M] |
| VAT rounding | Set Up › Pembulatan PPN | Tax | Yes | [M p.29][M] |
| Company tax identity | Info Perusahaan: NPWP, No Seri Faktur Pajak, No and Tanggal Pengukuhan PKP | Tax | Yes | [M p.20][M]; [Shot p228 (907)][S228a] |
| Party tax number | 2.11 and 2.12 No NPWP, "untuk report pajak" | Tax | Suppliers | [M p.63, 68][M] |
| VAT reports | Laporan Pembelian 12; Laporan Penjualan 9; Laporan Inventory 7 (Kartu Stok Penjualan dgn PPN) | Tax, Rep | Yes | [M p.106, 133, 166][M] |
| Tax invoice print | "Mencetak Faktur Pajak Standard" | Tax | Unclear for till sales | [M p.6][M] |
| Tax returns (SPT), e-Faktur, withholding slips, tax payable tracking | **None.** 0 hits for "SPT" or "e-faktur"; PPh appears only as a code type. | Tax | Yes, needed: PPh 21/23/25 payables exist | [M p.62][M]; [data-coa.js][COA] |

*Reporting*

| Function | 7Soft location(s) | Cat. | Relevant to this client? | Source |
|---|---|---|---|---|
| Financial statements | 8.1 Laporan Keuangan 6–15 | Rep | Yes | [M p.209–211][M] |
| Profitability by item, customer, invoice or salesman | 8.1 Laporan Keuangan 1–5 | Rep | Item: yes. Customer and salesman: no. | [M p.209][M] |
| Management lists | 8.2 Fast/Slow Moving and 10 Top Customer; Note for Today | Rep | Partly | [M p.33–35, 211–212][M] |
| Books of prime entry | Laporan Accounting 2–7 | GL, Rep | Yes | [M p.207][M] |
| P&L or balance sheet per store or department | **None.** The client puts the location in the account code. | Rep | Yes, needed | [data-coa.js][COA] |
| Report catalogue, templates, Excel output | 2.21 List Report; editable templates; every report goes to Excel; 9.11 History Report | Rep, Sys | Yes | [M p.3–4, 85, 222][M] |

*Master and system*

| Function | 7Soft location(s) | Cat. | Relevant to this client? | Source |
|---|---|---|---|---|
| Chart of accounts | 2.16 Account (with Create COA and the Kas/Bank type); Persiapan Singkat › Setting Akun › Daftar Akun (Use Default, Clear All); Laporan Accounting 10 | Master | Yes | [M p.30–31, 37, 76–77, 208][M] |
| Opening balances | 2.17 (GL); 2.11 (receivables); 2.12 (payables); 2.2 and 2.5 (stock quantity and HPP); 6.4 and 6.5 Saldo Awal (giros); 2.15 Nilai Penyusutan (accumulated depreciation); 9.7 with opening balances; the Set Up switch "Saldo Awal COA Mulai dari Awal"; 7.3 "Proses Saldo Awal Program ke Neraca Awal" | Master | Yes, at go-live | [M p.21, 37–39, 56, 65, 69, 74, 77, 189, 219–220][M]; [Shot p211][S211] |
| Default account mapping | 2.18 (23 slots); 2.2 Item › Account (7 per item, with Synkron Acc); 2.11 COA Piutang; 2.12 COA Hutang; 2.15 asset, expense and accumulated accounts; the Account field on 3.3 and 3.4; Persiapan Singkat › Setting Akun | Master | Yes | [M p.30, 49–50, 63, 68, 74–75, 78–80, 95, 97][M] |
| Payment terms | 2.8; also Persiapan Singkat › Setting Akun | Master | Yes (suppliers) | [M p.30, 59–60][M] |
| Users and permissions | 2.19 (View, Tambah, Edit, Hapus per menu; report level; validity dates); Set Up switches marked "Khusus Admin"; a Personal Menu per user | Sys | Yes | [M p.22, 29, 35, 44, 81–83][M] |
| Numbering | 2.20 Kode No Transaksi; Set Up › No Transaksi (monthly or yearly, automatic or manual) | Sys | Yes | [M p.20–21, 83–84][M] |
| Date control | 2.20 "Tanggal bisa edit"; Set Up "Default Tanggal BKK/BKM" | Sys | Yes | [M p.29, 84][M] |
| Audit history | 9.12 History; the toolbar's Info button (who created a record and who last edited it, and when) | Sys | Yes | [M p.4, 223–224][M] |
| Approval workflow | **None** (0 hits for "approv" or "otoris") | Sys | Not wanted on the chart: the owner removed the maker-checker step. The hub's BKM and BKK keep Draft → Approved → Posted. | [M, full-text search][M]; [memory][MERP]; [gap doc §D][GAP] |
| Backup, restore, archive, users online | 9.4–9.8 | Sys | Not a hub function (server-side) | [M p.217–221][M] |

### Inferences
- The client does have receivables, but not the kind 7Soft's AR handles. Its receivables are employee, head-of-store, management, inter-unit and card balances. 7Soft's AR is built on customer invoices. In 7Soft these balances would move through BKK or BKM Lain-lain lines and Transaksi Jurnal, not through Penjualan.
- Two names in the chart are easy to misread:
  - "Cash In Bank Giro" means current (giro) bank accounts, not bilyet giro.
  - Issued bilyet giros sit in "Outstanding Giro". In 7Soft terms, Outstanding Giro plays the role of the Kas/Bank-typed giro account picked on a BKK, the one Pencairan BG Keluar clears.
- The chart's three 6-digit accounts (204001 Giro Keluar, 205001 Uang Muka - Penjualan, 600104 Pendapatan lain-lain) follow the 6-digit pattern of 7Soft's demo chart (the demo's 204001 is "GIRO EKON INDUK BR" in [Shot p180][S180]). They look like leftovers from 7Soft's default chart. This is an inference; the sources do not confirm it.
- The location suffix in account codes, the per-unit affiliate accounts and the per-unit goods-in-transit accounts look like the client's workarounds for 7Soft having no cost-centre, branch or inter-company feature.
- The chart carries both PPN Masukan and PPN Keluaran accounts, so the client is probably VAT-registered (PKP). That makes the tax pieces relevant.

### Gaps
- No transaction data was in the sources, so whether the client used 7Soft's advances, Asset module, BPB with Hutang Suspend, or Pencairan BG Keluar is inferred from the chart only.
- The sources do not say whether the client takes customer deposits (layaway, vouchers), which is the one place 5.6's advance flow could matter.
- The 12-digit per-location accounts the chart header describes are not in `data-coa.js`. Their real number and use are unknown.
- The chart names 13 stores plus HEAD OFFICE. Which code, if any, is the distribution centre ("Gudang") is not stated.

## 3. Which functions are duplicated or split across menus, and which are missing?

### Takeaway
7Soft duplicates by giving the same data two doors. Every Info tab has a twin in a report list, and a settlement can be started or seen from the invoice, the Info screen, BKM/BKK, the Note for Today and two report lists. It splits by document type rather than by function. Receivables and payables each straddle a sales or purchase menu, Kas-Bank and Master. Advances touch six places, returns are two documents, and giros live in four places.

What is missing clusters in four areas:
- Multi-entity and multi-dimension accounting: cost centre, consolidation, currency.
- Bank-statement work: reconciliation.
- Periodic automation: recurring journals, accruals, automatic reversals.
- Statutory tax filing.

### Cited Findings

**Duplicated or split**
1. **Receivables (piutang)** are spread over four menus plus the master:
   - Penjualan: the 5.1 tabs Pelunasan Piutang, Summary Piutang and Kartu Piutang; the 5.6 Pelunasan tab; 5.7; Laporan Penjualan 34–42.
   - Kas-Bank: 6.2 Pelunasan Piutang; 6.3 Piutang; 6.4; Laporan Kas/Bank 7–8, 15, 17 and 19.
   - Master: 2.11 Saldo Awal, Batas piutang and COA Piutang.
   - Analisa: Laba Rugi Customer and 10 Top Customer.
   - Note for Today: Piutang Jatuh Tempo.
   ([M p.33–35, 62–67, 138–143, 158, 170–172, 179–183, 186–189, 194–197, 209, 211–212][M])
2. **Payables (hutang)** mirror this:
   - Pembelian: the 6 tabs of 4.1; the 4.4 Pelunasan tab; 4.5; Laporan Pembelian 24–32.
   - Kas-Bank: 6.3 Pelunasan Hutang; 6.2 Hutang; 6.5; Laporan Kas/Bank 9–10, 16, 18 and 20.
   - Master: 2.12.
   - Note for Today: Hutang Jatuh Tempo.
   ([M p.34, 67–71, 110–114, 125, 135–136, 182, 184–185, 190–197][M])
3. **Every Info tab has a twin in a report list:**

   | Info tab | Report twin |
   |---|---|
   | 4.1 Kartu Hutang | Laporan Pembelian 28 |
   | 4.1 Summary Hutang | Laporan Pembelian 26–27 |
   | 5.1 Kartu Piutang | Laporan Penjualan 37 |
   | 5.1 Summary Piutang | Laporan Penjualan 35–36 |
   | 6.1 Kartu Kas/Bank | Laporan Kas/Bank 2–6 |
   | 7.1 Buku Besar Pembantu | Laporan Accounting 8 |
   | 7.1 All Jurnal | Laporan Accounting 2 |
   | 7.1 Neraca Saldo | Laporan Keuangan 9 |

   ([M p.113–114, 136, 143, 171, 175–176, 193–194, 201–203, 207–210][M])
4. **Settlements are reported twice, on different bases.** Laporan Pembelian 24 and Laporan Penjualan 42 show settlement per invoice. Laporan Kas/Bank 7–10 view it "dari sisi penerimaan Kas/Bank-nya, jadi tidak dapat dibandingkan" with the Summary reports. In the manual's example, a 102,000 settlement shows as 100,000 cash plus a 2,000 discount ([M p.135, 172, 194–195][M]).
5. **A settlement can be started in three places:** BKM or BKK; the invoice toolbar's "Pelunasan … tunai/kredit" buttons (Cash and Pay on the screen); and a right-click on Note for Today ([M p.34, 224][M]; [screen copy][SB]).
6. **Transfers between cash and bank** are claimed by both voucher types. The BKM and the BKK descriptions each cover "pemindahan atau transfer kas ke bank atau sebaliknya" ([M p.179, 183–184][M]). The finance team's practice is a single BKK ([memory][MBX]).
7. **Advances (uang muka) touch six places:**
   - Master Item: an item named UANG MUKA with Jenis Uang Muka.
   - Setting COA: two slots.
   - The invoice forms: Tipe Uang Muka, the Apply button, the Uang Muka tab.
   - Two report groups: Laporan Pembelian 13–16 and Laporan Penjualan 28–31.
   - Buku Besar Pembantu, for the balance.
   - BKM and BKK for refunds, plus closing the unfilled rest of the PO or SO.
   ([M p.80, 237–239, 247–250, 263–269][M])
8. **Returns are two documents in Premium.** A stock document (Inventory 3.5 and 3.6) and a value document (4.5 and 5.7). Without the stock document, the value document also moves the stock. The Set Up options "Sistem Pembelian" and "Sistem Penjualan" pick the flow ([M p.23–25, 236–237, 245–247][M]).
9. **The giro lifecycle lives in four places:**
   - Entered in BKM or BKK, by picking a giro account as the Kas/Bank.
   - Cleared in 6.4 or 6.5, which can also be reached from the Info Pembelian and Info Penjualan Pelunasan tabs.
   - Replaced through Giro Baru, or through the Tolakan button on BKM and BKK.
   - Reported in Laporan Kas/Bank 1 and 15–20.
   ([M p.113, 142, 180, 184, 187–197, 250–255][M])
10. **Opening balances sit in at least eight places:** 2.17; 2.11; 2.12; 2.2 and 2.5; the giro Saldo Awal tabs; Master Asset's Nilai Penyusutan; 9.7; and the Closing screen's "Proses Saldo Awal Program ke Neraca Awal". A Set Up switch decides when the COA opening balance locks ([M p.21, 37–39, 56, 65, 69, 74, 77, 189, 219–220][M]; [Shot p211][S211]).
11. **Default account mapping sits in at least six places:** 2.18; the Item Account tab (with Synkron Acc); the Customer and Supplier COA fields; the Asset accounts; the Account field on adjustments; and Persiapan Singkat › Setting Akun ([M p.30, 49–50, 63, 68, 74–75, 78–80, 95, 97][M]).
12. **Fixed assets are split three ways:** the register in Master (2.15); acquisition through a purchase invoice or a manual journal; and depreciation as a button inside GL's Transaksi Jurnal, with reports in Laporan Accounting 11–12 ([M p.74–75, 204, 208, 256–258][M]).
13. **Tax is spread** over the 2.10 master; Persiapan Singkat (Info Perusahaan, Daftar Pajak, Pembulatan PPN); the PPN slots in Setting COA; the PPN field on every document; and three PPN reports (Pembelian 12, Penjualan 9, Inventory 7) ([M p.20, 29–30, 61–62, 80, 106, 133, 166][M]).
14. **Close is spread** over GL 7.3 (periods); Fasilitas 9.1–9.3 (reprocess, which needs Undo Closing on closed months); the Set Up opening-balance lock; the giro "closed" flag that blocks Batal Cair; and 9.8 Archive ([M p.21, 40–43, 188, 205–206, 213–221][M]).
15. **Set-up masters are reachable twice.** Jangka Waktu Kredit, Pajak, Account, Setting COA, Gudang, Item, Customer, Supplier and Karyawan open both from Master and from Persiapan Singkat, whose Tambah/Edit buttons open the Master forms ([M p.30–32][M]).
16. **Finance reports live in six lists** (4.6, 5.8, 6.6, 7.4, 8.1, 8.2), plus Inventory 3.9 for stock value ([M p.105–109, 131–137, 164–173, 192–212][M]). HPP alone appears in four places: Inventory 11 Mutasi Item, Laporan Accounting 1 Perhitungan HPP, Laporan Accounting 9 Persediaan Akhir Bulan, and Laporan Keuangan 7 Laba Rugi (Barang) ([M p.107, 207–208, 210][M]).
17. **Audit lives in three places:** 9.12 History, the per-record Info button, and 9.11 History Report for report files ([M p.4, 222–224][M]).

**Missing from 7Soft.** The evidence is a full-text search of the manual on 28 Oct 2026 plus the menu lists.

| Missing function | Evidence |
|---|---|
| Bank reconciliation | 0 hits for "rekonsil" or "reconcil"; Kas-Bank has only 6.1–6.6 ([M][M]) |
| Budget | 0 hits for "budget" or "anggaran" ([M][M]) |
| Cost centre, department, project | 0 hits for "cost cent", "divisi" or "proyek". "Departement" appears only as an item grouping in Daftar Nilai ([M p.45][M]). 2.9 Alamat holds head-office and branch addresses only ([M p.60][M]). The client codes the location into the account number ([data-coa.js][COA]). |
| Multi-currency | 0 hits for "valas", "kurs", "currency" or "mata uang" ([M][M]) |
| Consolidation, inter-company or inter-store | 0 hits for "konsolid" or "antar cabang". The client chart carries Piutang and Hutang Affiliasi per unit, plus Management Fee accounts, so this ran through manual journals ([data-coa.js][COA]). |
| Tax returns, e-Faktur, withholding | 0 hits for "SPT" or "e-faktur". PPh is only a type of tax code ([M p.62][M]). |
| Recurring and automatically reversing journals | 0 hits for "berulang" or "recurring"; reversals are typed by hand ([M p.256][M]) |
| Accrual and prepayment schedules | None; only the accounts exist ([data-coa.js][COA]) |
| Approval or authorisation | 0 hits for "approv" or "otoris" ([M][M]) |
| Customer statement; supplier-statement reconciliation | Not among the 43 + 33 reports. "Statement" appears only in "financial statement reports" ([M p.1, 131–137, 164–173][M]). |
| Asset disposal, transfer or revaluation | Master Asset has an Aktif tick only ([M p.74–75, 256–258][M]) |
| Card/EDC settlement, till cash-up, cashier float, deposit slips | None in Kas-Bank 6.1–6.6 ([M p.174–199][M]) |
| Batch payment run across suppliers | None; Browse Nota works within one voucher ([M p.180, 184][M]) |
| Stock-to-ledger reconciliation screen | A written procedure only ([M p.258–261][M]) |
| Year-end close as its own step | Monthly closing only ([M p.40, 205–206][M]) |

### Inferences
- The duplication is mostly harmless for a 7Soft user. It means "you can see a supplier's debt from wherever you are". But it is also why the manual needs a whole section of report tie-outs ("Cara Analisa Laporan"): the same figure is computed in several places and must agree.
- The splits follow 7Soft's document chains. A function belongs to whichever document creates it. An advance is an invoice type, a giro is a voucher on a special account, depreciation is a button on the journal form.
- For this client the most important gaps are bank reconciliation, per-store results, inter-store accounting, accruals and tax payables. Those are the pressures of a 13-store retailer, which 7Soft was not built around. The client chart already shows hand-built workarounds for each.

### Gaps
- The "missing" list is checked against this manual only. A later 7Soft release may have added some of these features. The vendor site (seventhsoft.net) did not resolve when fetched on 28 Oct 2026, and seventhsoft.com is a domain-sale page, so no current product information was found.
- The manual may describe features under words the search missed (for example a different term for reconciliation). The menu lists were checked as well, and none was found.

## 4. Which 7Soft menus are really operational (documents that post), and which are irrelevant to this client?

### Takeaway
Six of the "finance" menus are really sales or purchase documents: Faktur Pembelian, Retur Beli, Penjualan Cash, Penjualan POS, Faktur Penjualan and Retur Jual. Meanwhile several menus tagged "other" (BPB, Surat Jalan, stock adjustments, stock counts, stock returns) also post journals. For this client the whole customer-credit side is irrelevant: Faktur Penjualan, the piutang tabs and reports, incoming giros, SO, salesman commission and rayon. The cash and till sale screens matter only as review screens, because the tills write the sales.

### Cited Findings

**Documents and their ledger effect**

| Menu | `data-menus.js` scope | Journal | Really | Source |
|---|---|---|---|---|
| 4.2 PO | other | none | Op | [M p.230][M]; [data-menus.js][DM] |
| 4.3 BPB (Premium) | other | Dr Persediaan / Cr Utang Suspense | Op that posts (GRNI) | [M p.231][M]; [data-menus.js][DM] |
| 4.4 Faktur Pembelian | fin | Cr Utang Dagang (Dr Suspense or Persediaan) | Op document that creates the payable | [M p.233–235][M] |
| 4.5 Invoice Retur Beli | fin | Dr Utang Dagang | Op document that reduces the payable | [M p.236][M] |
| 3.5 / 3.6 Retur Barang (Premium) | other | stock against Suspense or HPP | Op that posts | [M p.236, 245][M] |
| 5.2 SO | other | none | Op | [M p.240][M] |
| 5.3 Surat Jalan (Premium) | other | Dr HPP / Cr Persediaan | Op that posts | [M p.241][M] |
| 5.4 / 5.5 Penjualan Cash / POS | fin | not stated; "tidak melalui akun piutang dagang" | Op sale document | [M p.150, 152][M] |
| 5.6 Faktur Penjualan | fin | Dr Piutang / Cr Penjualan (+ HPP) | Op document that creates the receivable | [M p.242–245][M] |
| 5.7 Retur Penjualan | fin | Dr Retur Penjualan / Cr Piutang (+ stock) | Op document that reduces the receivable | [M p.246][M] |
| 3.3, 3.4, 3.8, 3.7 | other | Account field, Setting COA Stok Opname, HPP | Op stock documents that post | [M p.94–104][M] |

- `data-menus.js` scopes 2.9 Alamat as finance, but it holds only addresses ([data-menus.js][DM]; [M p.60–61][M]).
- In the finance-tagged lists, the operational analytics are Laporan Pembelian 1–11 and 17–23, Laporan Penjualan 1–8, 10–27 and 32–33, and Laporan Manajerial ([M p.131–137, 164–173, 211–212][M]). So are the PO and SO tabs of the Info screens ([M p.111, 140][M]).
- The flow from documents to finance can be configured: Set Up offers five purchase flows and five sales flows (with or without BPB, Surat Jalan and stock-return documents) ([M p.23–25][M]).

**Client context**
- Every sale is rung at POS tills. The hub's review of 7Soft's Penjualan Cash screen says: "7Soft's screen is for typing a nota, but here the tills write it. So the job is checking" ([gap doc §D][GAP]).
- There are no customer credit sales. The chart has no customer receivable and no incoming-giro account ([memory][MPRO]; [data-coa.js][COA]). The hub has no screen or row for Faktur Penjualan ("credit sales; the chart has no customer receivable") ([nav.ts][NAV]). The gap list marks credit items † "only if the client sells on credit" ([gap doc §B][GAP]).

**Irrelevant to this client (customer-credit and B2B-selling functions)**
- **Penjualan:**
  - 5.6 Faktur Penjualan.
  - The 5.1 tabs CUSTOMER (its limits), PELUNASAN PIUTANG, SUMMARY PIUTANG and KARTU PIUTANG.
  - 5.2 SO and 5.3 Surat Jalan.
  - Laporan Penjualan 6 (Nilai SJ), 15–19 (SO), 20–21 (commission), 22–27 (takings per salesman or Rayon), 28–31 (customer advances, unless deposits exist) and 34–42 (piutang).
  ([M p.138–173][M])
- **Kas-Bank:**
  - The BKM Pelunasan Piutang tab.
  - 6.4 Pencairan BG Masuk.
  - Laporan Kas/Bank 7–8, 15, 17 and 19.
  - The BKK Piutang tab, except a customer refund if one ever happens.
  ([M p.179–197][M])
- **Analisa:** Laba Rugi Customer, Laba Rugi Nota and Laba Rugi per Sales; 10 Top Customer ([M p.209, 211–212][M]).
- **Master and Set Up:**
  - 2.11's Batas piutang, COA Piutang and opening receivables.
  - The Set Up limits on order and sale value against the receivable limit.
  - The rules for SO price or discount differing from the price list or SO.
  - Setting COA slots Piutang and Potongan Piutang.
  ([M p.25–28, 62–67, 79–80][M])

**Relevant (the client buys on credit and pays by transfer or giro)**
- All of Pembelian. The Premium flow PO → BPB → Faktur matches receiving at the distribution centre, with Hutang Suspend in between.
- BKK in full, and BKM for refunds and other income.
- 6.5 Pencairan BG Keluar and its reports.
- GL, Asset, Pajak and Closing.
([M p.110–137, 183–199, 200–208][M]; [data-coa.js][COA])

### Inferences
- About half of Penjualan and about a third of Kas-Bank's reports are dead weight for this client. The Penjualan menu shrinks to a review of till sales and returns plus a handful of reports: daily detail, summary, reprint, nota, rekap, per cashier, monthly, PPN, goods and services, returns.
- 7Soft's split between "finance" and "operational" is blurry by design. Under 7Soft's principle a document posts itself, so a purchase invoice is both an operational document and the AP entry. A standard ERP structure would place supplier invoices in AP and treat receiving as operational. 7Soft files both under Pembelian.

### Gaps
- Whether the client ever sells on account (corporate orders, B2B, consignment) is not in the sources. If it does, a small part of the AR set becomes relevant.
- Whether 7Soft's own POS (5.5) was ever used by the client, or whether its tills always fed 7Soft some other way, is not in the sources.

## 5. What does the hub have that 7Soft does not ("Di luar 7Soft" and tabs inside the 7Soft rows)?

### Takeaway
The hub's Finance sidebar now copies 7Soft's tree: 28 rows in 7 groups. Its additions sit in two places. Most are extra tabs inside the nearest 7Soft row:
- Store cash, settlement and deposits sit under "Penjualan Cash · POS".
- Bank reconciliation and employee advances sit under "Info Kas Bank".
- Accruals, stock-to-ledger, tax payables and the closing voucher sit under "Closing Periode Akuntansi".
- Recurring journals sit under "Transaksi Jurnal".
- Projects and disposals sit under "Asset".
- Dimensions, posting readiness, EDC/MDR and payment methods sit under "Persiapan Singkat dan Set Up".

The rest sits as whole rows under "Di luar 7Soft": the Payables door, the Reports door and the 7Soft parity page. Almost every addition fills a function 7Soft lacks.

### Cited Findings

**How the sidebar is built**
- `SEVEN_SOFT_MENU` lists 28 rows. `SEVEN_SOFT_GROUP` places them as Kas - Bank 5, GL · Buku Besar 4, Pembelian 4, Penjualan 4, Analisa 2, Master 7 and Fasilitas 2. Kas - Bank comes first "because that is where the day starts; Master and Fasilitas last because they are set once" ([nav.ts][NAV]).
- Rows merge 7Soft menus: "Customer · Supplier · Pajak" covers 2.8 and 2.10–2.12, "Penjualan Cash · POS" covers 5.4 and 5.5, and "Pencairan BG" covers 6.4 and 6.5 ([nav.ts][NAV]).
- Some 7Soft menus have no row. Faktur Penjualan and History Report ("report opens are not logged") have no screen and no row ([nav.ts][NAV]). 2.9 Alamat and 9.3 Reproses Accounting have no row either; for 9.3 the prototype has "Only a confirm sheet inside Closing" ([nav.ts][NAV]; [data-menus.js][DM]).
- "Di luar 7Soft" collects every nav item that is not hidden, is not in a 7Soft group, and is not the dashboard ([nav.ts][NAV]).
- Doors carry their tabs. A row whose path is a door's first view shows the whole door. In the code:
  - Info Kas Bank is the Cash & Bank door.
  - Penjualan Cash · POS is the Stores door.
  - Transaksi Jurnal is the Journal door.
  - Asset is the Assets door.
  - Closing Periode Akuntansi is the Month End door.
  - Persiapan Singkat dan Set Up is the Setup page, which lights every master's path.
  ([nav.ts][NAV])
- Two doors' first paths, /finance/payables/bills and /finance/reports/profit-and-loss, are not 7Soft rows, so those doors land under "Di luar 7Soft" with the 7Soft parity page ([nav.ts][NAV]).
- After the 28 Oct frontend pass, the hub shows every 7Soft tab, column, button and report the API can feed. "Nothing was type-checked or run in a browser" ([gap doc §D][GAP]).

**Hub functions with no 7Soft counterpart, or with only a partial one**

| Hub screen | Where it sits now | 7Soft counterpart | Cat. | Source |
|---|---|---|---|---|
| Sales by day; Sales postings | "Penjualan Cash · POS" › Sales | None as a screen; 7Soft's sale posts itself; Laporan Jurnal Penjualan | GL, Op | [nav.ts][NAV]; [M p.207][M] |
| Card & EDC Settlement | "Penjualan Cash · POS" › Settlement | None | CB | [nav.ts][NAV] |
| Deposits | "Penjualan Cash · POS" › Deposits | None (in 7Soft, a BKK transfer) | CB | [nav.ts][NAV]; [memory][MBX] |
| Store cash: Balances, Cash on hand, Petty cash, Cashier float, Positions, Movements | "Penjualan Cash · POS" › Cash | Only the Kas accounts in Info Kas Bank | CB | [nav.ts][NAV]; [M p.174–176][M] |
| Cash counts; Last counted | "Penjualan Cash · POS" › Cash counts | None | CB | [nav.ts][NAV] |
| Bank: Reconciliation, Accounts, Statement lines, Month summary, Matching rules | "Info Kas Bank" › Bank | None | CB | [nav.ts][NAV]; [M, full-text search][M] |
| Employee Advances | "Info Kas Bank" › Advances | None (BKK Lain-lain to Piutang Pegawai) | CB, AR | [nav.ts][NAV]; [data-coa.js][COA] |
| Bank Clearance; Payment Entry | Off the menu since 1 Oct: "a giro clears on the Giro Board, and BKK pays a bill" | 6.5; 6.3 | CB | [nav.ts][NAV] |
| Templates (Recurring Journal) | "Transaksi Jurnal" › Templates | None | GL | [nav.ts][NAV] |
| All Jurnal | "Transaksi Jurnal" › All Jurnal | 7.1 ALL JURNAL tab (7Soft has it under Info Accounting) | GL | [nav.ts][NAV]; [M p.201–202][M] |
| Register by category; Contractor Projects; Asset Disposals | "Asset" › Register, Projects, Disposals | Laporan Accounting 11–12 (register only); none for projects or disposals | FA | [nav.ts][NAV]; [M p.208][M] |
| Checklist; Closing voucher (Period Closing Voucher); Periods | "Closing Periode Akuntansi" › Checklist, Periods | 7.3 (Create Period, Closing, Test Validasi); no closing voucher | Close | [nav.ts][NAV]; [Shot p211][S211] |
| Accruals: Unbilled expenses, Prepaid expenses, Accrual balances | "Closing Periode Akuntansi" › Accruals | None | Close, GL | [nav.ts][NAV] |
| Inventory: Stock vs ledger, Valuation, In transit, Adjustments, COGS | "Closing Periode Akuntansi" › Inventory | A tie-out procedure only; Mutasi Item and Persediaan Akhir; 3.3 Stock Adjustment; Perhitungan HPP; nothing for goods in transit | Close | [nav.ts][NAV]; [M p.94–96, 107, 207–208, 258–261][M] |
| Tax: Tax payables, Withheld | "Closing Periode Akuntansi" › Tax | None | Tax | [nav.ts][NAV] |
| Accounts Settings, Accounting Dimension, Posting Readiness, Posting Policies, Pay Components, Expense/Line Categories, Mode of Payment, Shop Payment Methods, EDC & MDR, Giro Templates, Tax Withholding, Asset Category | The "Persiapan Singkat dan Set Up" page | None. The partial matches are Account Links ≈ 2.18 Setting COA, Permissions ≈ 2.19, Tax Types ≈ 2.10. | Master, Sys | [nav.ts][NAV] |
| Payables door: Bills, Recurring bills, Payment calendar, Aging, Loans (plus Info Pembelian, Laporan Pembelian and Credit notes again) | "Di luar 7Soft" | Faktur Pembelian; none; Hutang Jatuh Tempo; Umur Hutang; none | AP | [nav.ts][NAV]; [M p.135–136][M] |
| Reports door: Profit and loss (Standard, By unit 2 years, Expenses by month, By dimension, Laporan Accounting); Balance sheet (Standard, 2 years, Changes in equity); Cash flow; Ledger (General Ledger, Trial Balance); Sales by division | "Di luar 7Soft" | Laba Rugi GL; none; none; none; Neraca; Neraca Perbandingan / Tahunan; none; Arus Kas; Buku Besar Pembantu; Neraca Saldo; none | Rep | [nav.ts][NAV]; [M p.209–211][M] |
| 7Soft parity | "Di luar 7Soft" | — | Sys | [nav.ts][NAV] |
| Overview dashboard; Accounts Receivable aging ("no debtor book"); Payments Dashboard | Off the menu | Note for Today; Umur Piutang | Rep | [nav.ts][NAV]; [M p.33–35][M] |

- **A possible conflict:** the 1 Oct decision says "EDC settlement tracking not wanted", and that the acquirer-settlement step refuses banks set to post straight to the bank ([memory][MDT]). The Stores door still has a Settlement tab (Card & EDC Settlement) ([nav.ts][NAV]).

### Inferences
- The hub's additions cluster where 7Soft has nothing: bank reconciliation, store cash and counts, deposits, accruals and prepayments, the stock-to-ledger tie-out, tax payables and withholding, dimensions and posting readiness, recurring journals, and asset projects and disposals. Most of them are parked as extra tabs inside the nearest 7Soft row, so a 7Soft user only finds them after opening that row.
- The two doors left under "Di luar 7Soft" partly duplicate 7Soft rows:
  - Info Pembelian, Laporan Pembelian and Credit notes are both 7Soft rows and Payables tabs.
  - Laporan Accounting is both a 7Soft row and a Reports view.
  The same screen is reachable twice, and its row highlight may be shared. This is inferred from the alsoLights logic and was not tested.
- Of the hub-only functions, those that matter most for this client are bank reconciliation, store cash, deposits, accruals, stock vs ledger, tax payables, per-unit P&L and dimensions. They map onto the gaps that the client chart's workarounds point to (Q2 and Q3).

### Gaps
- The "Di luar 7Soft" contents are derived by reading `nav.ts`, not from the running app. The 28 Oct pass was not type-checked or run in a browser ([gap doc §D][GAP]).
- Whether each hub-only screen holds real data for this client was not checked (for example, whether the Settlement tab is empty under the direct-to-bank rule).

## 6. What is 7Soft's organising principle, and how does it map onto a standard ERP finance structure?

### Takeaway
7Soft is organised by trading cycle and by document, not by ledger. The menu runs Master → Inventory → Pembelian (with Hutang) → Penjualan (with Piutang) → Kas-Bank → GL → Analisa → Fasilitas. Each module repeats Info + documents + a numbered Laporan list. A subledger lives with the business document that creates it. Kas-Bank is the only place money moves. GL is the by-product of documents, plus journals and the month close. The statements sit in a separate Analisa menu.

Against a standard ERP finance structure (AR, AP, GL, Cash & Bank, FA, Tax, Close, Reporting, Master, System):
- GL and Cash & Bank match well.
- AR and AP are not modules of their own. Each is split between a sales or purchase menu and Kas-Bank.
- FA and Tax have no module.
- Close and Reporting are spread over several menus.
- Master and System are mixed together.

### Cited Findings
- **Modules.** 7Soft is sold as a package of "inventory, sales, purchase, assets, finance, general ledger, and management report analysis", and "You don't need to be accountant … all modules are integrated and run automatically for financial reporting" ([M p.2][M]). The module chapters are named "Penjualan & Piutang Dagang", "Pembeliaan & Hutang Dagang", "Kas – Bank" and "GL", and GL includes "Manajemen Asset dan Penyusutan Aktiva Tetap" ([M p.5–7][M]).
- **Menu order.** The table of contents runs Master, Inventory, Pembelian, Penjualan, Kas-Bank, GL, Analisa, Fasilitas ([M TOC][M]). User & Group's rights tree has the same 8 modules ([Shot p88][S88]).
- **Info screens.** "Setiap modul dilengkapi dengan info yang berguna untuk mencari informasi atau analisa data" ([M p.3][M]).
- **No posting step.** Reports are numbered lists with a Keterangan column ([Shot p212][S212]; [Shot p215][S215]; [Shot p170][S170]). Every report goes to Excel ([M p.3–4][M]). "Laporan Keuangan langsung dapat ditampilkan setiap saat, tanpa melalui posting" ([M p.9][M]).
- **What each menu is for:**
  - Kas-Bank "menyajikan arus kas/bank, mulai dari Bukti Kas Masuk, Bukti Kas Keluar hingga Pencairan Bilyet Giro" ([M p.174][M]).
  - GL is where "posting semua jurnal dari seluruh transaksi diolah untuk menyajikan Laporan Keuangan" ([M p.200][M]).
  - Master data "tidak menimbulkan transaksi apapun" ([M p.44][M]).
  - Fasilitas supports "reproses, backup database dan setting awal aplikasi" ([M p.213][M]).
- **Editions.** They differ by business scale and document flow, not by module: "Semua modul dari stok sampai laporan keuangan ada pada tiap versi". Standard adds multiple warehouses and giro management. Premium adds Surat Jalan and BPB ([M p.11–12][M]).
- **Document chains.** Documents chain and lock through statuses: PO → BPB → Faktur; New, Partial, Complete, Closed PO, Tertagih, Belum Lunas, Lunas, Cair, Tolakan. A document used by a later one cannot be edited ([M p.4, 7–8][M]).
- **The hub's approach.** The hub copies the 7Soft vouchers on an ERPNext engine: "BKK/BKM = Payment Entry Pay/Receive, Lain-lain = Deductions, Kontra = Common Party Accounting" ([memory][MLIT]). Its rule is to follow 7Soft first, else ERPNext, and to make any difference a setting ([memory][MERP]).
- **Vendor.** SeventhSoft Komputindo was founded in April 2004. It began with a POS for a food court and cites "lebih dari 11 tahun pengalaman" ([M p.278][M]). The product is a Delphi client with a MySQL database, client-server ([M p.11][M]). A business-data aggregator lists the company's headquarters in Surabaya and its current focus as online sellers. This comes from a search-result summary; the page itself was not opened ([Datanyze][DZ]). A 2017 Indonesian study examined a cooperative in Jember that used "Program Seventhsoft" ([UNEJ proceedings][UNEJ]).

### Inferences

**Where each standard ERP finance area sits in 7Soft** (built from Q1–Q3):

| ERP finance area | 7Soft home(s) | Fit |
|---|---|---|
| AR | Penjualan (5.1, 5.6, 5.7, 5.8 #28–43) + Kas-Bank (6.2, 6.4, 6.6 #7–8) + Master 2.11 | Split over 3 menus; no AR module |
| AP | Pembelian (4.1, 4.4, 4.5, 4.6 #13–16, #24–32) + Kas-Bank (6.3, 6.5, 6.6 #9–10) + Master 2.12 | Split over 3 menus; no AP module |
| GL | GL 7.1–7.4 | Good |
| Cash & Bank | Kas-Bank 6.1–6.6 | Good, but no bank reconciliation |
| Fixed Assets | Master 2.15 + GL 7.2 PENYUSUTAN + 7.4 #11–12 | Split; no module; no disposals |
| Tax | Master 2.10 + Persiapan Singkat + document fields + 3 PPN reports | Scattered; no returns, no withholding |
| Close | GL 7.3 + Fasilitas 9.1–9.3 | Split; monthly only; validation can be overridden |
| Reporting | 6 report lists (4.6, 5.8, 6.6, 7.4, 8.1, 8.2) + Inventory 3.9 | Split by module; statements in Analisa |
| Master data | Master (finance masters mixed with items, units, BOM, price lists) + Persiapan Singkat | Mixed |
| System | Master 2.19–2.21 + Fasilitas 9.4–9.12 | Mixed |

- 7Soft's shape suits a distributor with credit customers and salesmen, which is the Premium edition's stated target ("Usaha Distribusi dan Pedagang Besar", [M p.12][M]). It suits this client less: customer-credit features take up much of Penjualan and part of Kas-Bank, while the retailer's needs (bank reconciliation, store cash, inter-store accounting, per-store results, accruals) are absent.
- The finance team thinks in 7Soft's words (Kas-Bank, Pembelian, GL) rather than AR/AP. That is why the hub mirrors the tree and parks its ERP additions inside or beside the 7Soft rows rather than reorganising by ledger.

### Gaps
- No source here compares 7Soft with named ERPs (SAP, Oracle, Odoo, ERPNext) beyond the hub's own ERPNext mapping. The ERP-standard side is assumed to come from other researchers.
- The vendor's current product, its versions, and any later finance features are not documented in the sources. The web gave only an aggregator profile and one academic paper; the vendor domain did not resolve.

[M]: file:///Users/hari/Documents/itulah/finance-7soft/manual-7soft.txt
[DM]: file:///Users/hari/Documents/itulah/finance-7soft/data-menus.js
[COA]: file:///Users/hari/Documents/itulah/finance-7soft/data-coa.js
[SC]: file:///Users/hari/Documents/itulah/finance-7soft/scr7-cash.js
[SG]: file:///Users/hari/Documents/itulah/finance-7soft/scr7-gl.js
[SB]: file:///Users/hari/Documents/itulah/finance-7soft/scr7-buy.js
[SS]: file:///Users/hari/Documents/itulah/finance-7soft/scr7-sell.js
[SU]: file:///Users/hari/Documents/itulah/finance-7soft/scr7-setup.js
[GAP]: file:///Users/hari/Documents/itulah/docs/research/2026-10-28-finance-hub-vs-7soft.md
[NAV]: file:///Users/hari/Documents/itulah/frontend-hub/src/screens/finance/nav.ts
[MDT]: file:///Users/hari/.claude/projects/-Users-hari-Documents-itulah/memory/digital_takings_to_bank_2026_10.md
[MBX]: file:///Users/hari/.claude/projects/-Users-hari-Documents-itulah/memory/project_bkm_bkk_party_optional_2026_10.md
[MLIT]: file:///Users/hari/.claude/projects/-Users-hari-Documents-itulah/memory/feedback_bkk_bkm_7soft_literal.md
[MERP]: file:///Users/hari/.claude/projects/-Users-hari-Documents-itulah/memory/finance_follow_client_or_erpnext.md
[MPRO]: file:///Users/hari/.claude/projects/-Users-hari-Documents-itulah/memory/project_finance_7soft_proto_2026_10.md
[S84]: file:///Users/hari/Documents/itulah/7soft-ref/manual/p84_Image645_1366x709.png
[S88]: file:///Users/hari/Documents/itulah/7soft-ref/manual/p88_Image651_1366x709.png
[S170]: file:///Users/hari/Documents/itulah/7soft-ref/manual/p170_Image799_1280x739.png
[S180]: file:///Users/hari/Documents/itulah/7soft-ref/manual/p180_Image814_1280x737.png
[S185]: file:///Users/hari/Documents/itulah/7soft-ref/manual/p185_Image823_1280x746.png
[S211]: file:///Users/hari/Documents/itulah/7soft-ref/manual/p211_Image873_740x649.png
[S212]: file:///Users/hari/Documents/itulah/7soft-ref/manual/p212_Image875_1280x744.png
[S215]: file:///Users/hari/Documents/itulah/7soft-ref/manual/p215_Image879_1280x768.png
[S217]: file:///Users/hari/Documents/itulah/7soft-ref/manual/p217_Image884_1280x766.png
[S228a]: file:///Users/hari/Documents/itulah/7soft-ref/manual/p228_Image907_1280x768.png
[S228b]: file:///Users/hari/Documents/itulah/7soft-ref/manual/p228_Image908_1280x768.png
[S229]: file:///Users/hari/Documents/itulah/7soft-ref/manual/p229_Image910_1280x768.png
[DZ]: https://www.datanyze.com/companies/seventhsoft-komputindo/359128521
[UNEJ]: https://jurnal.unej.ac.id/index.php/prosiding/article/download/6653/4819
