# Finance menus in Indonesian accounting/ERP software, compared with 7Soft (SeventhSoft Komputindo)

Research date: 28 Oct 2026. Source tags used below:
- **[fetched]**: page read directly.
- **[snippet]**: help.accurate.id and help-center.jurnal.id refused direct fetches (HTTP 403), and web.jurnal.id did not resolve. Content from these sites comes from search-engine snippets of the named article. Menu labels from snippets are verbatim as shown in the snippet, but surrounding detail is paraphrased.
- **[academic]**: Indonesian university teaching material (modul, RPS, buku ajar, thesis).
- **Older versions** are labelled (Accurate 5 desktop, Zahir Accounting 6 desktop, MYOB Accounting/AccountRight).

The 7Soft menu tree analysed here is the one given in the assignment (the client's own 7Soft install). No public 7Soft manual was found (see Gaps).

---

## Q0. Is 7Soft's finance menu organisation the Indonesian norm?

### Takeaway
Mostly yes. 7Soft's module set (master data / Pembelian / Penjualan / Kas-Bank / Buku Besar / reports / setup) is the standard Indonesian layout. Hutang under Pembelian and piutang under Penjualan is universal: no product surveyed has a top-level "Hutang/Piutang" menu. 7Soft departs from the Indonesian SME mainstream (Accurate, Zahir, Jurnal, MYOB) in three places:
1. Invoices are settled with BKM/BKK vouchers in Kas-Bank. The mainstream products settle invoices from Penjualan/Pembelian.
2. It has a dedicated "Pencairan BG" screen. Of the products checked, only Zahir has an equivalent, its "Giro Masuk/Giro Keluar" lists with a "Giro Cair" action.
3. Kartu/Summary/Pelunasan sit as tabs inside "Info Pembelian/Info Penjualan" inquiry screens. Accurate and Jurnal put aging and customer statements under Laporan.

### Cited Findings
- Seventhsoft's own site groups its finance features as "Pembelian & Hutang Dagang", "Penjualan & Piutang Dagang", "Kas/Bank & Keuangan" and "Jurnal & Laporan Keuangan". It lists two products, "Seventhsoft Business One" and "Seventhsoft Desktop". The company is at Rungkut Makmur Square C-30, Surabaya, and the footer reads "Copyright © 2004 - 2026" — [fetched] [seventhsoft.net](https://seventhsoft.net)
- A business directory lists Seventhsoft Komputindo as a Surabaya financial-software company with about 15 staff. These figures are directory estimates and unreliable — [Datanyze](https://www.datanyze.com/companies/seventhsoft-komputindo/359128521)
- 7Soft has been in use since at least 2017: a University of Jember paper (SNAPER-EBIS 2017) evaluated internal control in a Seventhsoft-computerised system at KOPEGTEL Camar Jember — [snippet] [jurnal.unej.ac.id](https://jurnal.unej.ac.id/index.php/prosiding/article/download/6653/4819)
- **Accurate 5 (desktop, older)** has these modules: Buku Besar (General Ledger), Kas dan Bank (Cash & Bank), Persediaan (Inventory), Penjualan (Sales), Pembelian (Purchases), Aset Tetap (Fixed Assets), Proyek (Project) and Pabrikasi (Manufacture) — [fetched] [Suwandhi, *Praktik Komputer Akuntansi Menggunakan Accurate 5*, Poltek LPP Press](https://repo.polteklpp.ac.id/704/1/BUKU%20AJAR%20KOMPUTER%20AKUNTANSI_ACCURATE%20ver%201.pdf)
- **Accurate Online** product navigation lists the modules "Penjualan", "Perusahaan", "Laporan Keuangan", "Pembelian", "Persediaan", "Buku Besar", "Aset Tetap", "Trade Portal (BETA)" and "E-Meterai", plus a separate "Kas & Bank" feature page — [fetched] [accurate.id/online/fitur/kas-bank](https://accurate.id/online/fitur/kas-bank/)
- **Zahir Accounting (desktop)** modules as taught: Data-Data, Buku Besar, Penjualan, Pembelian, Kas & Bank, Persediaan, Laporan — [academic][snippet] [RPS Lab Akuntansi Komputerisasi, Univ. Bina Darma](https://ak.binadarma.ac.id/document/1718775074_RPS%20Lab%20Akuntansi%20Komputerisasi%2002.pdf)
- Zahir Online's feature list has no separate hutang/piutang module. Managing utang and piutang is described inside "Transaksi Jual Beli" — [fetched] [zahironline.com/fitur](https://www.zahironline.com/fitur/)
- **MYOB AccountRight / MYOB Accounting** as taught in Indonesia has the command centres Accounts, Banking, Sales, Time Billing, Purchases, Payroll, Inventory and Card File — [academic][snippet] [Prosiding FRIMA, Digitech University](https://prosidingfrima.digitechuniversity.ac.id/index.php/prosidingfrima/article/download/377/360); [RPS Aplikasi Komputer, UIN Alauddin (AccountRight Premier v19)](https://pbs.febi.uin-alauddin.ac.id/assets/file/58__RPS_Aplikasi_Komputer.pdf)
- Invoice settlement sits under Sales/Penjualan and Purchases/Pembelian in Accurate Online, Accurate 5, Zahir, Jurnal and MYOB, not under Kas & Bank. Details and sources are in Q2.
- Zahir is the one mainstream product with a dedicated giro list and clearing action: "Kas dan Bank > Giro Masuk / Giro Keluar", then "Giro Cair". Details and sources are in Q3.

### Inferences
- Synthesis table built from the findings in Q1–Q4. Each cell's source is cited there.

| Function | 7Soft (given) | Accurate Online | Accurate 5 (older) | Zahir 6 / Online | Mekari Jurnal | MYOB (older) | ERPNext / SAP B1 |
|---|---|---|---|---|---|---|---|
| Customer invoice settlement | BKM in Kas-Bank; listed under Info Penjualan | Penjualan > Penerimaan Penjualan | Activities > Sales > Sales Receipt | Penjualan > Pembayaran Piutang Usaha | Penjualan > (invoice) Tindakan > Terima pembayaran | Sales > Receive Payments | Payment Entry (Receive) / Banking > Incoming Payments |
| Supplier invoice settlement | BKK in Kas-Bank; tab Pelunasan Hutang | Pembelian > Pembayaran Pembelian (+ Perintah Pembayaran) | Activities > Purchase > Purchase Payment | Pembelian > Pembayaran Hutang Usaha | Pembelian/Biaya > Tindakan > Bayar (Bayar Tagihan for Biaya) | Purchases > Pay Bills | Payment Entry (Pay) / Outgoing Payments |
| Non-invoice cash in/out | BKM / BKK | Kas & Bank > Penerimaan / Pembayaran | Cash&Bank > Deposit / Payment / Other Payment | Kas & Bank > Kas Masuk / Kas Keluar | Kas & Bank > Terima Uang / Kirim Uang (+ Biaya) | Banking > Receive Money / Spend Money | Journal/Payment Entry |
| Cash ↔ bank (setoran) | (not given) | Kas & Bank > Transfer Bank | (not found) | Kas & Bank > Transfer Kas | Kas & Bank > Transfer Uang | Banking > Prepare Bank Deposit | Internal Transfer / Deposit |
| Giro clearing | Kas-Bank > Pencairan BG Masuk/Keluar | No giro module; Cek/Giro is a payment method; bounced giro = Void receipt | (not found) | Kas & Bank > Giro Masuk/Giro Keluar > Giro Cair | No giro module; "Giro" Kas & Bank account + Transfer Uang | Undeposited Funds + Prepare Bank Deposit | Reference date / clearance; checks to clearing account + Deposit |
| AR aging / card | Info Penjualan tabs (Kartu Piutang etc.) | Daftar Laporan > Piutang/Utang > Laporan Umur Piutang; Pernyataan Piutang | Reports > Account Receivables & Customers > AR Subsidiary Ledger Detail / Customers Statement | Fasilitas Laporan: Custom Aging Schedule | Laporan > tab Penjualan > Laporan Piutang Pelanggan | (not checked) | Accounts Receivable report |
| Period close | GL > Closing Periode | (not found) | Aktivitas > Periodik > Proses Akhir Bulan | (not found) | Daftar Akun > Tindakan > Tutup buku & kunci periode | (not checked) | (not checked) |

- 7Soft's voucher-driven settlement (BKM/BKK settle invoices) is close to the clerical, manual-bookkeeping practice in which every cash movement is backed by a Bukti Kas Masuk/Keluar (see Q5). Structurally it resembles international ERPs, where the payment document lives in a banking/accounting area (SAP B1 Banking; ERPNext Payment Entry) rather than in Sales/Purchases. It is a recognisable Indonesian pattern, but not the dominant SME-package pattern.
- 7Soft's "Pencairan BG" matches Zahir and Indonesia's bilyet-giro practice (BG with effective dates and a validity window; see Q3). Accurate and Jurnal are weaker here, handling giro as a payment-method flag or a workaround.
- The word "Fasilitas" for a utilities/settings group also appears at Zahir: its help centre titles its feature catalogue "Fasilitas Yang Terdapat di Zahir Accounting", with groups "Fasilitas Data", "Fasilitas Laporan" and so on ([fetched] [help.zahironline.com](https://help.zahironline.com/portal/id/kb/articles/fasilitas-yang)). So 7Soft's label is not idiosyncratic.

### Gaps
- No public 7Soft manual, screenshots or help site was found. The 7Soft tree could not be checked independently: Info Pembelian tabs, BKM/BKK settling invoices, Pencairan BG, Closing Periode, Analisa, Fasilitas. Seventhsoft.net only shows marketing groupings.
- The current Accurate Online in-app left menu could not be captured verbatim, because the help site was blocked. In particular, it is unconfirmed whether a top-level "Perpajakan" menu exists. Only the marketing navigation and the help-site URL structure were seen (fitur-aol/penjualan, /pembelian, /kas-bank, /laporan, /pengaturan).
- Products rumoured to have a top-level "Hutang Piutang" menu (for example iPOS-type retail packages) were not checked.

---

## Q1. Exact menu labels per product; is there ever a separate "Hutang/Piutang" menu; where do Kartu Piutang / Kartu Hutang / Umur Piutang live?

### Takeaway
None of the products surveyed has a separate top-level Hutang/Piutang transaction menu. Hutang lives in Pembelian, piutang in Penjualan, and both resurface only as **report categories**: Accurate Online "Piutang/Utang"; Accurate 5 "Account Receivables & Customers" / "Account Payables & Vendors". Aging and customer statements live under **Laporan** (Accurate, Jurnal) or as a report facility (Zahir "Custom Aging Schedule"). The literal label "Kartu Piutang/Kartu Hutang" was not found in any vendor documentation checked. The vendors use "Pernyataan Piutang", "Rincian Piutang", "Laporan Umur Piutang", "Laporan Piutang Pelanggan" and "Buku Besar Pembantu Piutang".

### Cited Findings

#### 7Soft (SeventhSoft Komputindo) — current, from assignment and vendor site
- Groups as given in the assignment: Master; Pembelian (Info Pembelian with tabs Kartu Hutang / Summary Hutang / Pelunasan Hutang; Faktur Pembelian; Retur; Laporan); Penjualan (Info Penjualan with Kartu Piutang etc.; Penjualan Cash/POS; Faktur Penjualan; Retur; Laporan); Kas-Bank (Info Kas Bank; BKM / BKK; Pencairan BG Masuk/Keluar; Laporan Kas/Bank); GL · Buku Besar (Info Accounting, Transaksi Jurnal, Closing Periode, Laporan Accounting); Analisa (Laporan Keuangan, Laporan Manajerial); Fasilitas (Set Up, History).
- Vendor site groupings: "Pembelian & Hutang Dagang", "Penjualan & Piutang Dagang", "Kas/Bank & Keuangan", "Jurnal & Laporan Keuangan" — [fetched] [seventhsoft.net](https://seventhsoft.net)

#### Accurate Online (CPSSoft / PT Ultima Tekno Solusindo) — current 2026
- **Kas & Bank** feature labels: "Penerimaan", "Pembayaran", "Transfer Bank", "Rekonsiliasi Bank", "SmartLink e-Banking", "Rekening Koran", "Histori Bank", "Riwayat Virtual Account", "Riwayat e-Payment". There is no "Giro" item — [fetched] [accurate.id/online/fitur/kas-bank](https://accurate.id/online/fitur/kas-bank/)
- **Penjualan** feature labels: "Penawaran Penjualan", "Pesanan Penjualan", "Pengiriman Pesanan", "Uang Muka Penjualan", "Faktur Penjualan", "Penerimaan Penjualan". Further items: "Retur Penjualan", "Kategori Pelanggan", "Kategori Penjualan", "Pelanggan", "Penyesuaian Harga/Diskon", "Komisi Penjual", "Target Penjualan", "SmartLink e-Commerce". Kartu Piutang and Umur Piutang are not on this page. POS is a separate product, "Accurate POS" — [fetched] [accurate.id/online/fitur/penjualan](https://accurate.id/online/fitur/penjualan/)
- **Pembelian** feature labels: "Pesanan Pembelian", "Penerimaan Barang", "Uang Muka Pembelian", "Faktur Pembelian", "Pembayaran Pembelian", "Retur Pembelian". Further items: "Klaim Pemasok", "Harga Pemasok", "Kategori Pemasok", "Pemasok", "Perintah Pembayaran", "Transfer Pemasok". "Permintaan Pembelian" is not listed on this page — [fetched] [accurate.id/online/fitur/pembelian](https://accurate.id/online/fitur/pembelian/)
- Other navigation items: "Perusahaan", "Laporan Keuangan", "Persediaan", "Buku Besar", "Aset Tetap", "Trade Portal (BETA)", "E-Meterai". SmartLink features: "e-Banking", "e-Commerce", "e-Payment", "Smartlink Tax". Products: "Accurate Online", "Accurate POS", "Accurate Lite", "Bliss" — [fetched] [accurate.id/online/fitur/kas-bank](https://accurate.id/online/fitur/kas-bank/)
- **Aging:** "Daftar Laporan" has a report category "Piutang/Utang" containing "Laporan Umur Piutang" and "Laporan Umur Utang". The buckets are 1–30, 31–60, 61–90 … >120 days — [snippet] [help.accurate.id umur-piutang-utang](https://help.accurate.id/product/accurate-online/fitur-aol/laporan/daftar-laporan/umur-piutang-utang/); [help.accurate.id umur-piutang](https://help.accurate.id/product/accurate-online/fitur-aol/laporan/daftar-laporan/umur-piutang/)
- The aging range ("Rentang Umur") is set in "Preferensi", tab "Lain-lain", and can count from Tanggal Faktur or Tanggal Jatuh Tempo — [snippet] [help.accurate.id preferensi](https://help.accurate.id/product/accurate-online/fitur-aol/pengaturan/preferensi/pengaturan-lain-lain/)
- The per-customer card equivalent is "Laporan Pernyataan Piutang" (opening balance, additions, payments, closing balance per customer), under the Piutang reports — [snippet] [help.accurate.id rincian-piutang](https://help.accurate.id/product/accurate-online/fitur-aol/laporan/daftar-laporan/rincian-piutang/)

#### Accurate 5 / Accurate Desktop — OLDER desktop version (textbook examples dated 2017–2022)
- The textbook's case company sets the interface language in "Quick Setup (Persiapan Singkat)" (Inggris/Indonesia). The textbook uses English menu paths with Indonesian glosses.
  - Invoice-based work: "[Activities] > [Sales] > [Sales Order]", "[Sales Invoice]", "[Sales Receipt]"; "[Activities] > [Purchase] > [Purchase Order]", "[Purchase Invoice]", "[Purchase Payment]".
  - Non-invoice cash: "[Activities] > [Cash&Bank] > [Payment]", "[Other Payment]", "[Deposit]".
  - Journals: "[Activities] > [General Ledger] > [Journal Voucher]".
  - Period end: "Activities [Aktivitas] – Periodic [Periodik] – Period End [Proses Akhir Bulan]".
  - Lists: "List (Daftar) > Others (Daftar lain) > Term (Syarat Pembayaran) / Taxes (Kode Pajak)".
  - [fetched; text extracted from PDF] [Suwandhi, Poltek LPP Press, ISBN 978-602-53822-4-6](https://repo.polteklpp.ac.id/704/1/BUKU%20AJAR%20KOMPUTER%20AKUNTANSI_ACCURATE%20ver%201.pdf)
- Subsidiary ledgers are reports, not menus. "Laporan Buku Besar Pembantu Piutang" = "[Reports] > [Index to Reports] > [Account Receivables & Customers] > [AR Subsidiary Ledger Detail]"; the customer statement is "[Customers Statement]". "Laporan Buku Besar Pembantu Utang" = "[Account Payables & Vendors] > [AP Subsidiary Ledger Detail Statement]". "Neraca Saldo" = "[General Ledger] > [Trial Balance]" — [fetched] same textbook.
- Conflict: an AI-generated-looking quiz page claims Accurate 5 has "Kas/Bank → Penerimaan Piutang" and "Kas/Bank → Pembayaran Hutang". This contradicts the textbook above (Sales Receipt under Sales, Purchase Payment under Purchase) and should be treated as unreliable — [snippet] [daftarsekolah.spmb.teknokrat.ac.id](https://daftarsekolah.spmb.teknokrat.ac.id/2026/01/contoh-soal-accurate-5-lengkap-dengan-jawaban-dan-pembahasan/)

#### Zahir Accounting 6 (desktop, older but still sold) and Zahir Online (V2)
- Zahir's feature catalogue includes these groups and items — [fetched] [help.zahironline.com fasilitas-yang](https://help.zahironline.com/portal/id/kb/articles/fasilitas-yang)
  - "Modul Standar": "Giro Mundur", "Retur", "Fixed Asset", "Kas & Bank" (with "Transfer Kas", "Kas Masuk", "Kas Keluar"), "Rekonsiliasi Bank".
  - "Fasilitas Laporan": "Custom Aging Schedule", "Faktur pajak".
  - "Fasilitas Extra": "Sales Order", "Purchase Order", "Reminder", "Business Analysis".
- Customer settlement path is "modul penjualan > pembayaran piutang usaha". Form fields: Pelanggan, Akun, Tanggal, No Referensi, Deskripsi, No. Faktur, Pembayaran. A "daftar penerimaan piutang usaha" list holds the receipts — [fetched] [help.zahironline.com, Zahir Online V2](https://help.zahironline.com/portal/id/kb/articles/cara-input-transaksi-pembayaran-piutang-usaha-zahir-online-v2)
- Supplier settlement is "Modul Pembelian > Pembayaran Hutang Usaha" — [snippet] [zahiraccounting.com blog](https://zahiraccounting.com/id/blog/membayar-hutang-piutang-mata-uang-asing-dengan-rupiah/). The Zahir 6 help also opens the "Pembayaran Hutang Usaha" form from "Daftar Hutang Usaha" — [fetched] [help.zahironline.com transaksi-giro-keluar](https://help.zahironline.com/portal/id/kb/articles/transaksi-giro-keluar)
- The Kas & Bank module has "Transfer Kas", "Kas Masuk" and "Kas Keluar". Transfer Kas covers moving balances between cash/bank accounts, for example depositing cash to the bank — [snippet] [help.zahironline.com transaksi-kas-masuk](https://help.zahironline.com/portal/id/kb/articles/transaksi-kas-masuk)
- Zahir's feature page also lists "Penerimaan Pembayaran" (several bills in one receipt, multi-currency) and a "Kalender" that shows hutang, piutang and giro-mundur due dates — [fetched] [zahiraccounting.com Modul Pembayaran & Giro Mundur](https://zahiraccounting.com/en/produk-5/features-dan-keunggulan-zahir/modul-pembayaran-giro-mundur/)

#### Mekari Jurnal (jurnal.id) — current; UI refreshed late 2023 and Q4 2025
- **Kas & Bank:** the "Buat akun/transaksi" dropdown (newer UI: "+Buat Transaksi") offers three transaction types: "Transfer Uang", "Terima Uang", "Kirim Uang". Bank reconciliation and "Peraturan rekonsiliasi" (rules that auto-create Terima/Kirim Uang) sit here too. Terima Uang uses fields "Setor Ke" and "Terima Dari" — [snippet] [help-center.jurnal.id Sekilas Menu Kas & Bank](https://help-center.jurnal.id/hc/id/articles/4430407069209-Sekilas-Mengenai-Menu-Kas-Bank); [Terima Uang](https://help-center.jurnal.id/hc/id/articles/4444355705369-Bagaimana-Cara-Melakukan-Transaksi-Terima-Uang); [Kirim Uang](https://help-center.jurnal.id/hc/id/articles/4451429317145-Bagaimana-Cara-Membuat-Transaksi-Kirim-Uang)
- **Penjualan** has tabs for invoices ("Penagihan"/faktur), "Pengiriman", "Pemesanan", "Penawaran", plus a tab for items awaiting approval. Its status shortcuts are unpaid, overdue and paid in the last 30 days — [snippet] [help-center.jurnal.id Sekilas Menu Penjualan](https://help-center.jurnal.id/hc/id/articles/10199817700121-Sekilas-Mengenai-Menu-Penjualan). Conflict: the guidebook version says the Pengiriman/Pemesanan/Penawaran tabs are Enterprise-plan only — [snippet] [jurnal.id guidebook](https://www.jurnal.id/id/guidebooks/sekilas-mengenai-menu-penjualan)
- **Biaya** (expenses): ticking "Bayar Nanti" books expense against hutang; it is settled later with "Tindakan" > "Bayar Tagihan" — [snippet] [help-center.jurnal.id Biaya Baru](https://help-center.jurnal.id/hc/id/articles/4473886044569-Bagaimana-Cara-Membuat-Biaya-Baru). Settings lists sit under "Daftar Lainnya" ("Cara Pembayaran", "Syarat Pembayaran"); accounts sit under "Daftar Akun" — same snippet.
- **Laporan:** tab "Penjualan" holds "Daftar penjualan" (invoices, orders, quotes, returns, receipts; status filter open/partial/paid/overdue/closed) and the customer receivables report ("Laporan Piutang Pelanggan": unpaid invoices per customer with due date and balance) — [snippet] [Daftar Penjualan](https://help-center.jurnal.id/hc/id/articles/4477106149145-Bagaimana-Menyusun-Laporan-Daftar-Penjualan); [Laporan Piutang Pelanggan](https://help-center.jurnal.id/hc/id/articles/4478054098457-Bagaimana-Cara-Membuat-Laporan-Piutang-Pelanggan)
- "Kontak" is a separate list for customers and suppliers — [snippet] [Sekilas Daftar Kontak Pelanggan](https://help-center.jurnal.id/hc/id/articles/13885003425305-Sekilas-Daftar-Kontak-Pelanggan)

#### MYOB Accounting / MYOB AccountRight — OLDER in Indonesia; English UI
- AccountRight navigates by "command centres", each with a flowchart of tasks.
  - Banking has "Spend Money" (payments that are not supplier bills), "Receive Money" (receipts that are not invoice payments), "Prepare Bank Deposit" (groups payments held in Undeposited Funds) and "Reconcile Accounts".
  - Sales has "Receive Payments"; Purchases has "Pay Bills".
  - [snippet; official MYOB help, some pages 4–5 years old] [Exploring AccountRight](https://www.myob.com/au/support/myob-business/get-started/welcome-to-myob-business/learning-about-accountright/exploring-accountright); [Spend money](https://www.myob.com/au/support/myob-business/banking/spending-and-receiving-money/spend-money); [Receive Money window](https://help.myob.com/wiki/display/ar/Receive+Money+window); [Bank Register](https://help.myob.com/wiki/display/ar/Bank+Register)
- In Indonesia MYOB is described as Australian software. Showing other languages needs an on-screen translation program, and local tax needs DIY adjustment. Indonesian courses still teach MYOB v18/v19/v23 — [academic][snippet] [ejournal UIN Malang](https://ejournal.uin-malang.ac.id/index.php/saintek/article/download/2420/4389); [jurnal.id blog MYOB](https://www.jurnal.id/id/blog/myob-accounting/); [Gramedia: Mahir Komputerisasi Akuntansi dengan MYOB Accounting v23](https://www.gramedia.com/products/mahir-komputerisasi-akuntansi-dengan-myob-accounting-v23)
- In MYOB Basic editions there is no Inventory module, no Purchases module, no stock cards and no payables report; Premier is the most complete edition — [academic][snippet] [Prosiding FRIMA](https://prosidingfrima.digitechuniversity.ac.id/index.php/prosidingfrima/article/download/377/360)

#### ERPNext (Frappe) — current docs (page updated 2026-08-02)
- Payment Entry has the payment types "Receive", "Pay" and "Internal Transfer". It carries "Reference No and Date" for cheque or transfer evidence. "Get Outstanding Invoices" allocates against open invoices, and any remainder stays as an unallocated advance — [fetched] [docs.frappe.io Payment Entry](https://docs.frappe.io/erpnext/user/manual/en/payment-entry)
- A third-party "ERPNext Indonesia e-Faktur" app exists, so Indonesian localisation comes from community or partner apps — [snippet] [ecosire.com](https://ecosire.com/zh/apps/erpnext/erpnext-indonesia-efaktur)

#### SAP Business One — current training material
- Payment means are Check, Bank Transfer, Credit Card and Cash, with Bill of Exchange in some countries. Incoming cash, check and card payments post to a clearing or temporary account. A Deposit then moves the funds to the house bank, and one deposited check can be cancelled out of a multi-check deposit. Check number confirmation is in the Banking module — [fetched] [learning.sap.com Handling Payments](https://learning.sap.com/courses/handling-accounting-in-sap-business-one/handling-payments-1)
- Bill of Exchange as a payment means is relevant to localisations such as Spain, Italy, France and Portugal (older 8.82 help) — [snippet] [help.sap.com 8.82 Payment Wizard](https://help.sap.com/doc/saphelp_sbo882/8.82/en-US/45/0a572f37ca1f2ce10000000a1553f6/content.htm)
- An SAP partner (SNI) sells an Indonesian e-Faktur add-on: it stores DJP number ranges in SAP tables and uploads invoices to obtain a QR-coded PDF — [snippet] [snitechnology.net](https://snitechnology.net/efaktur-indonesia/)

#### Majoo, Moka, HashMicro, Bee, Krishand, Jubelio (supplementary)
- **Majoo:** the journal report is at dashboard "Keuangan" > "Laporan Keuangan" > "Laporan Jurnal". Journals are created automatically per transaction — [snippet] [majoo panduan 230](https://majoo.id/panduan-pengguna/detail/230). The May 2025 brochure lists accounting features (cash and bank, general and automatic journals, reports) and sales documents (invoice, sales order, surat jalan) — [snippet] [majoo brochure Mei 2025](https://portal-gcs-cdn.majoo.id/v2/downloadable/brosur-majoo-mei-2025.pdf)
- **Moka:** connecting Moka POS to Mekari Jurnal sends sales reports automatically. Olsera POS integrates the same way — [snippet] [jurnal.id blog POS](https://www.jurnal.id/id/blog/program-aplikasi-point-of-sale/); [jurnal.id blog Olsera](https://www.jurnal.id/id/blog/integrasi-jurnal-dengan-aplikasi-kasir-olsera-pos/)
- **HashMicro:** its marketing pages mention automatic bank-statement reconciliation and reminders, but nothing about giro or BG — [snippet] [hashmicro.com sistem-akuntansi](https://www.hashmicro.com/id/sistem-akuntansi); [hashmicro.com accounting-software](https://www.hashmicro.com/id/accounting-software/)
- **Bee (beecloud):** feature list covers utang & piutang, bank reconciliation, reporting and general ledger, with no menu-level detail — [snippet] [GetApp beecloud](https://www.getapp.com/all-software/a/beecloud/)
- **Krishand:** described by one BINUS piece as tax-focused, with usability weaknesses. No menu documentation was found — [snippet] [accounting.binus.ac.id](https://accounting.binus.ac.id/?p=22334)
- **Jubelio** (omnichannel): its "Kas dan Bank" menu shows all account transactions, including sales, purchases and settlements, and splits into "Transaksi Kas Bank" and "Rekonsiliasi Bank" — [snippet] [edu.jubelio.com](https://edu.jubelio.com/kelas-online/en/courses/oa02b-modul-akuntansi-terampil-2/pelajaran/mencatat-penerimaan-kas-dan-bank-copy)

### Inferences
- The Indonesian norm puts AR/AP **transactions** in Penjualan/Pembelian and AR/AP **views** in Laporan. 7Soft's "Info Pembelian/Info Penjualan" inquiry tabs are closest to Zahir's "Daftar Hutang Usaha" and "daftar penerimaan piutang usaha" lists. Accurate and Jurnal put the same information in Laporan.
- Both spellings, "Hutang" (Zahir, Jurnal, 7Soft) and "Utang" (Accurate's "Laporan Umur Utang"), are in live use. Matching the client's 7Soft literal "Hutang" will not look odd to clerks. (Spelling preference is an inference; no style source checked.)
- "Retur" as a sub-item of both Pembelian and Penjualan is universal: Accurate has "Retur Penjualan"/"Retur Pembelian" and Zahir has "Retur". 7Soft's placement is standard.

### Gaps
- The literal labels "Kartu Piutang" and "Kartu Hutang" were not found in any vendor documentation checked. No Indonesian textbook source defining "kartu piutang" was retrieved this session.
- The Jurnal sidebar order and labels are not confirmed verbatim (Dasbor, Laporan, Kas & Bank, Penjualan, Pembelian, Biaya, Produk, Aset Tetap, Kontak, Daftar Akun, Daftar Lainnya, Pengaturan). Individual items are confirmed only via snippets.
- The Accurate 5 aging report name was not found in the textbook. MYOB AR aging placement was not checked.
- ESB (F&B ERP) was not researched.

---

## Q2. Does invoice settlement sit under Penjualan/Pembelian or under Kas & Bank? (vs 7Soft's BKM/BKK)

### Takeaway
In every Indonesian SME package checked (Accurate Online, Accurate 5, Zahir, Jurnal, MYOB), settling an invoice is a **Penjualan/Pembelian** transaction:
- Accurate: "Penerimaan Penjualan" / "Pembayaran Pembelian"
- Zahir: "Pembayaran Piutang Usaha" / "Pembayaran Hutang Usaha"
- Jurnal: "Terima pembayaran" from the invoice
- MYOB: "Receive Payments" / "Pay Bills"

**Kas & Bank** is reserved for cash that is not tied to an invoice (Penerimaan/Pembayaran, Kas Masuk/Kas Keluar, Terima/Kirim Uang, Spend/Receive Money) and for transfers and reconciliation. 7Soft's BKM/BKK settling invoices from Kas-Bank is the exception. It resembles SAP B1/ERPNext (payment documents in a banking or accounting area), Jubelio (settlements shown in Kas dan Bank), and the manual voucher practice.

### Cited Findings
- Accurate Online: open menu "Penjualan" > "Penerimaan Penjualan", use "Ambil" to pull open invoices, then "Hitung Nilai Pembayaran" — [snippet] [help.accurate.id Penerimaan Penjualan](https://help.accurate.id/product/accurate-online/fitur-aol/penjualan/penerimaan-penjualan/mengenal-fitur-penerimaan-penjualan/). From an invoice: "Penjualan" > "Faktur Penjualan" > "Proses" opens Penerimaan Penjualan — [snippet] [help.accurate.id dari faktur](https://help.accurate.id/product/accurate-online/fitur-aol/penjualan/penerimaan-penjualan/membuat-penerimaan-penjualan-dari-faktur/)
- Accurate Online: paying suppliers starts from "Perintah Pembayaran" in Pembelian. Methods are Transfer Bank, Virtual Account and Cek/Giro, and the "Pembayaran Pembelian" status changes once the transfer is confirmed — [snippet] [help.accurate.id Perintah Pembayaran](https://help.accurate.id/product/accurate-online/fitur-aol/pembelian/perintah-pembayaran/membuat-perintah-pembayaran/). "Pembayaran Pembelian" is a Pembelian feature — [fetched] [accurate.id/online/fitur/pembelian](https://accurate.id/online/fitur/pembelian/)
- Accurate Online: non-invoice receipts go through "Kas & Bank" > "Penerimaan". The "Informasi Lainnya" tab has "No Cek" and "Pemberi" fields — [snippet] [help.accurate.id Kas & Bank Penerimaan](https://help.accurate.id/product/accurate-online/fitur-aol/kas-bank/penerimaan/membuat-penerimaan/)
- Accurate 5 (older): invoice receipt is "[Activities] > [Sales] > [Sales Receipt]" and supplier invoice payment is "[Activities] > [Purchase] > [Purchase Payment]". Cash for expenses and PPh 21 remittance is "[Activities] > [Cash&Bank] > [Payment]"; cash from non-invoiced sales is "[Cash&Bank] > [Deposit]" — [fetched] [Accurate 5 textbook](https://repo.polteklpp.ac.id/704/1/BUKU%20AJAR%20KOMPUTER%20AKUNTANSI_ACCURATE%20ver%201.pdf)
- Zahir: "modul penjualan > pembayaran piutang usaha" — [fetched] [Zahir Online V2 help](https://help.zahironline.com/portal/id/kb/articles/cara-input-transaksi-pembayaran-piutang-usaha-zahir-online-v2). "Modul Pembelian > Pembayaran Hutang Usaha" — [snippet] [Zahir blog](https://zahiraccounting.com/id/blog/membayar-hutang-piutang-mata-uang-asing-dengan-rupiah/). Kas Masuk/Kas Keluar are in Kas & Bank — [fetched] [Zahir fasilitas](https://help.zahironline.com/portal/id/kb/articles/fasilitas-yang)
- Zahir crosses over: for a piutang payment or a cash receipt, the user may instead record a giro masuk. The Kas Masuk form has a "Giro" option, so Kas & Bank forms also carry giro-backed settlements — [fetched] [help.zahironline.com Transaksi Giro Masuk](https://help.zahironline.com/portal/id/kb/articles/transaksi-giro-masuk)
- Jurnal: settlement is done from the sales invoice: menu "Penjualan" > invoice number > "Tindakan" > "Terima pembayaran". One invoice can take several receipts — [snippet] [help-center.jurnal.id Terima Pembayaran Tagihan Penjualan](https://help-center.jurnal.id/hc/id/articles/11681641022361-Bagaimana-Cara-Terima-Pembayaran-Tagihan-Penjualan). Kas & Bank "Terima Uang"/"Kirim Uang" are for other money in or out, for example bank loans and prive — [snippet] [Kas & Bank overview](https://help-center.jurnal.id/hc/id/articles/4430407069209-Sekilas-Mengenai-Menu-Kas-Bank); [Prive](https://help-center.jurnal.id/hc/id/articles/4417383922201-Prive)
- MYOB: "Receive Payments" (Sales) is for invoice payments and "Pay Bills" (Purchases) for supplier bills. "Spend Money"/"Receive Money" (Banking) are explicitly for items that are not bills or invoices — [snippet] [MYOB Spend money](https://www.myob.com/au/support/myob-business/banking/spending-and-receiving-money/spend-money); [MYOB Exploring AccountRight](https://www.myob.com/au/support/myob-business/get-started/welcome-to-myob-business/learning-about-accountright/exploring-accountright)
- ERPNext: one "Payment Entry" document (Receive/Pay/Internal Transfer) settles invoices via "Get Outstanding Invoices" — [fetched] [docs.frappe.io Payment Entry](https://docs.frappe.io/erpnext/user/manual/en/payment-entry)
- SAP B1: incoming and outgoing payments, deposits and checks form the Banking object family (Incoming Payments, Deposits, Checks for Payment, Bill of Exchange, bank statements and reconciliations) — [snippet] [WSO2 SAP B1 Banking connector](https://wso2.com/integration-platform/docs/connectors/catalog/erp-business/sap.businessone.banking/overview); [fetched] [learning.sap.com](https://learning.sap.com/courses/handling-accounting-in-sap-business-one/handling-payments-1)
- Jubelio's Kas dan Bank menu shows sales, purchases and settlements together — [snippet] [edu.jubelio.com](https://edu.jubelio.com/kelas-online/en/courses/oa02b-modul-akuntansi-terampil-2/pelajaran/mencatat-penerimaan-kas-dan-bank-copy)

### Inferences
- There are two Indonesian traditions:
  - **Document-flow** (Accurate/Zahir/Jurnal/MYOB): order → invoice → receipt, all inside Penjualan/Pembelian.
  - **Voucher-flow** (7Soft; manual bookkeeping): every cash movement is a BKM/BKK, and the voucher references invoices.
  
  A clerk trained on Accurate or Jurnal will look for "Penerimaan Penjualan" or "Terima pembayaran" under Penjualan. A clerk trained on 7Soft will look for BKM under Kas-Bank.
- 7Soft already shows "Pelunasan Hutang" as a tab inside Info Pembelian, a read-only view of settlements under Pembelian. This bridges both traditions: settlements are created in Kas-Bank but visible under Pembelian/Penjualan. A product could keep BKM/BKK as the single creation point (7Soft literal) and add an "invoice > receive payment" shortcut that opens a prefilled BKM. This mirrors Accurate's "Faktur Penjualan > Proses → Penerimaan Penjualan" jump.

### Gaps
- It is not confirmed whether Accurate Online's "Kas & Bank > Penerimaan" can also settle invoices, or only handles non-invoice receipts. The snippets only show non-invoice use.
- Jurnal's supplier-invoice payment path ("Pembelian" > tagihan > "Tindakan" > bayar) is inferred from the Biaya path; the exact label was not confirmed.

---

## Q3. Bilyet giro and cek: Giro Masuk/Keluar, Pencairan Giro, Giro Tolakan, Saldo Awal Giro

### Takeaway
- **Zahir** is the only mainstream Indonesian package with a dedicated giro workflow, and it closely matches 7Soft's "Pencairan BG Masuk/Keluar". Giro is flagged on Kas Masuk/Kas Keluar/Pembayaran Hutang. Lists sit at "Kas dan Bank > Giro Masuk / Giro Keluar", with a "Giro Cair" action, reminders and due-date reports.
- **Accurate Online** treats Cek/Giro as a payment method and a bounced giro as a **Void** of the receipt.
- **Jurnal** has no giro feature. Its documented workaround is a Kas & Bank account named "Giro" plus a "Transfer Uang" on clearing.
- International ERPs use clearing accounts plus deposits (SAP B1) or reference/clearance dates (ERPNext).
- No product documentation found covers "Saldo Awal Giro".

### Cited Findings
- **Zahir (Zahir Accounting 6):** on the Kas Masuk form, tick the "Giro" option and save. Clearing is done from "Kas dan Bank" > "Giro Masuk": select the giro and click "giro cair". Giro fields are Nomor Giro, Jatuh Tempo, Nama Bank and Nomor A/C. Reports under Laporan > Kas dan Bank are "Giro Masuk – Hari Jatuh Tempo", "Giro Masuk" and "Daftar Giro Masuk" — [fetched] [help.zahironline.com Transaksi Giro Masuk](https://help.zahironline.com/portal/id/kb/articles/transaksi-giro-masuk)
- **Zahir giro keluar:** the giro option appears on both "Kas Keluar" and "Pembayaran Hutang Usaha" (opened from "Daftar Hutang Usaha"). Clearing is "Kas&Bank > Giro Keluar" > "Giro Cair". The giro data form shows a status (sementara, diposting, batal). Once cleared, the item leaves the list and the journal is visible in Buku Besar. The report is "Laporan > Kas Dan Bank > Giro Keluar", including a due-date ("hari jatuh tempo") variant — [fetched] [help.zahironline.com Transaksi Giro Keluar](https://help.zahironline.com/portal/id/kb/articles/transaksi-giro-keluar)
- Zahir's feature page says any transaction (kas masuk/keluar or pembayaran hutang/piutang) can use giro mundur, and clicking "Giro Cair" on the due date posts the clearing automatically. A "Kalender" shows giro-mundur due dates — [fetched] [zahiraccounting.com Modul Pembayaran & Giro Mundur](https://zahiraccounting.com/en/produk-5/features-dan-keunggulan-zahir/modul-pembayaran-giro-mundur/)
- Zahir Online: the "Giro Mundur" feature covers incoming and outgoing giro, with "pencairan giro" or cancellation (pembatalan) chosen from the "daftar giro". There are separate "Reminder Giro Masuk" and "Reminder Giro Keluar" — [fetched] [zahironline.com/giro-mundur](https://www.zahironline.com/giro-mundur/)
- **Accurate Online:** "Cek/Giro" is one of the "Perintah Pembayaran" methods — [snippet] [help.accurate.id Perintah Pembayaran](https://help.accurate.id/product/accurate-online/fitur-aol/pembelian/perintah-pembayaran/membuat-perintah-pembayaran/). The Kas & Bank "Penerimaan" form has "No Cek"/"Pemberi" fields — [snippet] [help.accurate.id Penerimaan](https://help.accurate.id/product/accurate-online/fitur-aol/kas-bank/penerimaan/membuat-penerimaan/)
- **Accurate Online, bounced cek/giro:** open the receipt from menu "Penjualan" ("Penerimaan Pelanggan" in the snippet), go to tab "Info Lainnya" and tick "Void". The system posts a reversing journal and the invoice returns to "Belum Lunas". The replacement payment is entered as a new receipt — [snippet] [help.accurate.id Void Penerimaan Cek/Giro Kosong](https://help.accurate.id/product/accurate-online/fitur-aol/penjualan/penerimaan-penjualan/void-penerimaan-cek/)
- Accurate's blog on giro mundur records the receivable at delivery and the cash at maturity, without a separate giro account. It names no Accurate menu and does not cover tolakan (Sep 2022) — [fetched] [accurate.id/ekonomi-keuangan/giro-mundur](https://accurate.id/ekonomi-keuangan/giro-mundur/)
- **Jurnal:** for a giro mundur, record "Penjualan" > "Terima Pembayaran" with "Setor Ke" set to a Kas & Bank account named "Giro" (created by the user) and "Cara Pembayaran" set to "Cek & Giro". The giro's date goes in "Tanggal Jatuh Tempo". On clearing, record "Kas & Bank" > "Transfer Uang" from the Giro account to the bank account. Upcoming giro is monitored via "Laporan" > "Daftar Penjualan" filtered by receipts and sorted by due date — [snippet] [help-center.jurnal.id Mencatat Pembayaran dengan Cek/Giro](https://help-center.jurnal.id/hc/id/articles/4473246415513-Bagaimana-Cara-Mencatat-Pembayaran-dengan-Cek-Giro)
- **SAP B1:** check receipts post to a clearing account, and a Deposit moves them to the bank. A single deposited check can be cancelled. Postdated checks are not covered in the training page — [fetched] [learning.sap.com](https://learning.sap.com/courses/handling-accounting-in-sap-business-one/handling-payments-1). Incoming-payment check data (table RCT1) stores check date, number and bank details — [snippet] [help.sap.com RCT1](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/rct1.html)
- **ERPNext:** Payment Entry carries "Reference No and Date". The fetched page does not cover postdated cheques — [fetched] [docs.frappe.io Payment Entry](https://docs.frappe.io/erpnext/user/manual/en/payment-entry). An old 2014 forum thread notes a clearance date could not be edited in the bank reconciliation tool — [snippet] [discuss.frappe.io](https://discuss.frappe.io/t/standard-procedure-for-purchase-invoice-payment-bank-reconciliation-process/2762)
- **MYOB:** customer payments can be held in "Undeposited Funds" and later grouped with "Prepare Bank Deposit" (Banking) — [snippet] [MYOB Exploring AccountRight](https://www.myob.com/au/support/myob-business/get-started/welcome-to-myob-business/learning-about-accountright/exploring-accountright)
- **Regulation shaping giro features:**
  - Bank Indonesia's PBI 18/41/PBI/2016 on bilyet giro replaced SK Dir BI 28/32/KEP/DIR (1995) — [snippet] [Hukumonline Pro](https://pro.hukumonline.com/a/lt5847e916ddfe8/fax:+622122708909); [Hukumonline](https://www.hukumonline.com/berita/a/bi-terbitkan-aturan-bilyet-giro-terbaru-lt58d0e98ad7b44)
  - The BG validity window became 70 days from 1 April 2017, previously 70 days plus 6 months — [snippet] [Kontan (EN)](https://amp.kontan.co.id/news/bilyet-giro-transaction-would-be-restricted)
  - A BG is rejected as kosong if funds are insufficient on the effective date — [snippet] [UMS thesis citing SEBI 28/32/UPG](https://eprints.ums.ac.id/7849/)
  - Repeated cek/BG tolakan can put the drawer on BI's DHN (Daftar Hitam Nasional), and banks may freeze cek/BG rights within 14 working days — [snippet] [SMBCI product summary](https://www.smbci.com/SMBCI/RIPLAY/Giro/10-25/final_4--ringkasan--informasi--produk--giro--karya--billingual.pdf)
  - One search snippet claimed BI caps a single BG at Rp500 juta. This was not verified against the PBI text — [snippet] [Hukumonline](https://www.hukumonline.com/berita/a/bi-terbitkan-aturan-bilyet-giro-terbaru-lt58d0e98ad7b44)
- Mekari Jurnal's blog says bilyet giro simplifies bank reconciliation and record-keeping, but does not discuss tolakan — [snippet] [jurnal.id blog bilyet giro](https://www.jurnal.id/id/blog/2017-syarat-sifat-dan-proses-rekonsiliasi-bilyet-giro/)

### Inferences
- In products that model giro explicitly (Zahir, 7Soft), the screen naming is "Giro Masuk" / "Giro Keluar" and the action is "Giro Cair" (Zahir) or "Pencairan BG" (7Soft). Both are recognisable to Indonesian clerks. "BG" (bilyet giro) and "giro mundur" are the everyday terms.
- Rejected giro ("tolakan"): Accurate voids the receipt so the invoice is open again; Zahir sets the giro status to "batal". Both re-open the receivable, so a product should treat tolakan as "receipt reversed, invoice back to unpaid" rather than as a separate expense.
- The 70-day validity window and the effective date justify a due-date reminder list (Zahir has "Reminder Giro Masuk/Keluar" and "Hari Jatuh Tempo" reports). That would be the natural content of 7Soft's Pencairan BG list.

### Gaps
- No product documentation found mentions "Saldo Awal Giro" (opening outstanding giro). How Zahir or 7Soft load pre-existing uncleared BG at go-live is unknown.
- Zahir's exact tolakan workflow (whether "batal" auto-reverses the piutang payment) is not documented in the pages read.
- Accurate 5 desktop giro handling was not found in the textbook.

---

## Q4. Retail POS takings: daily sales journal, card/EDC and QRIS, setoran ke bank, MDR fees — where in the menu?

### Takeaway
POS sales land on the **sales side**, as invoices plus receipts per payment method, either per transaction or consolidated per cashier/day or per session:
- Accurate POS → Accurate Online Faktur Penjualan + Penerimaan Penjualan.
- ERPNext POS Invoices → consolidated Sales Invoice at POS Closing Entry.
- Moka/Olsera → Jurnal sales reports.
- Majoo: automatic journals visible under Keuangan > Laporan Keuangan.

Bank deposits (setoran) are Kas & Bank transfers. MDR is booked as an expense: Accurate uses "Akun Diskon" = Beban Administrasi Bank on the receipt; Jurnal's settlement guidance keeps revenue gross with the fee as a separate expense. 7Soft's "Penjualan Cash/POS" under Penjualan fits this norm.

### Cited Findings
- **Accurate POS → Accurate Online:** there are two recording modes. One creates a Faktur Penjualan per transaction; the other consolidates per cashier per day. A Faktur appears one day after the transaction. In consolidated mode, Penerimaan Penjualan is created per payment method (Tunai / Non Tunai) — [snippet] [help.accurate.id Pencatatan Penjualan di Accurate POS](https://help.accurate.id/product/accurate-pos/pengaturan-utama/pendapatan-biaya/pencatatan-penjualan-apos/). All POS sales are recorded automatically in Accurate Online — [snippet] [help.accurate.id data usaha AOL+APOS](https://help.accurate.id/product/accurate-online/memulai-aol/mengelola-data-usaha-baru/buat-data-usaha-aol-apos/)
- Accurate POS shift close: the cashier uses "Selesai Shift" from the three-dot menu and enters the cash in the drawer — [snippet] [help.accurate.id Menyelesaikan Shift](https://help.accurate.id/product/accurate-pos/pengaturan-aplikasi/karyawan/menyelesaikan-shif/). Other cash receipts in POS are under "Pendapatan dan Biaya > Penerimaan", with a "No. Cek" field — [snippet] [help.accurate.id Penerimaan Kas APOS](https://help.accurate.id/product/accurate-pos/pengaturan-utama/pendapatan-biaya/penerimaan/penerimaan-kas-apos/)
- **Accurate, bank/admin fee on a receipt:** for a net-of-fee receipt, choose "Beban Administrasi Bank" in the "Akun Diskon" field of Penerimaan Penjualan — [snippet] [help.accurate.id Biaya Admin Bank pada Penerimaan Penjualan](https://help.accurate.id/product/accurate-online/fitur-aol/penjualan/penerimaan-penjualan/mencatat-admin-bank/)
- **ERPNext (v13+):** POS sales sit in POS Invoices and do not touch the ledgers until a POS Closing Entry for the session is submitted. Submitting creates consolidated Sales Invoices by customer, with returns merged into a credit note, and auto-creates a "POS Invoice Merge Log" — [snippet] [docs.frappe.io POS invoice consolidation](https://docs.frappe.io/erpnext/pos-invoice-consolidation); [POS workflows](https://docs.frappe.io/erpnext/pos-workflows)
- **Jurnal:** POS, marketplace and omnichannel transactions flow automatically into Mekari Jurnal — [snippet] [jurnal.id fitur POS & e-commerce](https://www.jurnal.id/id/fitur/pos-e-commerce). Mekari Pay accepts customer payments by bank-transfer confirmation, virtual account, card and QRIS, and auto-records them in Jurnal — [snippet] [jurnal.id blog Mekari Pay](https://www.jurnal.id/id/blog/terima-pembayaran-pelanggan-secara-online-dengan-mekari-pay/)
- **Jurnal, settlement accounting:** platform fees are a separate expense rather than a reduction of revenue, and funds not yet in the bank sit as a temporary receivable until settled — [snippet] [jurnal.id blog Settlement dalam Akuntansi](https://www.jurnal.id/id/blog/settlement-dalam-akuntansi/). Kas & Bank "Transfer Uang" moves funds between accounts, for example from a temporary marketplace account to the bank — [snippet] [help-center.jurnal.id Kas & Bank](https://help-center.jurnal.id/hc/id/articles/4430407069209-Sekilas-Mengenai-Menu-Kas-Bank); [Online Shop](https://help-center.jurnal.id/hc/id/articles/4416082953497-Online-Shop)
- **Majoo:** when adding a QRIS provider, the MDR percentage and an MDR service charge are configured so the fee is computed automatically — [snippet] [majoo panduan QRIS Lainnya](https://majoo.id/panduan-pengguna/detail/264)
- **Zahir:** "Transfer Kas" handles moving cash to the bank, for example a cash setoran — [snippet] [help.zahironline.com Kas Masuk](https://help.zahironline.com/portal/id/kb/articles/transaksi-kas-masuk)
- **SAP B1:** credit-card receipts post to a card clearing account, and a credit-card Deposit records the acquirer's transfer to the bank — [fetched] [learning.sap.com](https://learning.sap.com/courses/handling-accounting-in-sap-business-one/handling-payments-1)
- **QRIS MDR rules (Bank Indonesia):**
  - 0.3% for usaha mikro (UMI) from 1 Jul 2023 — [snippet] [Bisnis.com](https://ekonomi.bisnis.com/read/20230705/9/1672079/mdr-qris-usaha-mikro-naik-jadi-03-persen-bi-biaya-jangan-dibebankan-ke-konsumen)
  - 0% for UMI transactions up to Rp500 ribu from 1 Dec 2024 (previously up to Rp100 ribu) — [snippet] [Pasardana](https://pasardana.id/news/2024/10/17/transaksi-qris-maksimal-rp500-ribu-ke-pedagang-kecil-gratis-berlaku-1-desember-2024); [Infobank](https://infobanknews.com/bi-bebaskan-biaya-qris-bagi-merchant-usaha-mikro-mulai-1-desember-2024/)
  - From 1 Oct 2026, 0% MDR for transactions up to Rp100 ribu for **all** merchant categories, with UMI keeping 0% up to Rp500 ribu (Katadata, 23 Aug 2026; single source; rates above the thresholds not stated) — [fetched] [Katadata](https://katadata.co.id/amp/foto/6a882ffd488a8/foto-bi-perluas-mdr-qris-0-mulai-oktober-2026)
  - Merchants may not surcharge QRIS users (PBI 23/6/PBI/2021 Art. 52(1)) — [snippet] [Bisnis.com Apr 2024](https://finansial.bisnis.com/read/20240430/11/1761523/biaya-qris-usaha-mikro-03-bi-tegaskan-merchant-tak-tarik-tarif-ke-konsumen)
  - IKPI reports that QRIS transactions up to Rp500 ribu at UMI merchants are not subject to PPN — [snippet] [IKPI](https://ikpi.or.id/bi-transaksi-qris-hingga-rp500-ribu-di-merchant-usaha-mikro-tak-kena-ppn/)

### Inferences
- Indonesian packages do not create a top-level "POS" finance menu. POS appears as a sales source (7Soft "Penjualan Cash/POS"; Accurate POS posting into Penjualan) and as consolidation at shift or day close.
- The PPN item in the IKPI report most likely refers to PPN on the MDR service fee, which falls away when the MDR is 0, not to PPN on the sale itself. This is unverified.
- Card/EDC and QRIS takings settle to the acquirer's bank with a delay and net of MDR. The common pattern is: book the receipt per payment method (Accurate "Non Tunai" receipts; SAP card clearing account) → bank/transfer on settlement → MDR as Beban Administrasi Bank. No product surveyed has a dedicated "Setoran EDC" menu label.

### Gaps
- None of the sources describe EDC (debit/credit card) MDR rates or an "EDC settlement" menu in Accurate, Jurnal or Zahir.
- How 7Soft posts Penjualan Cash/POS (per receipt or daily summary) and where its card/QRIS setoran is done is not documented publicly.
- Moka, Majoo and ESB account mapping for daily POS journals was not found in detail.

---

## Q5. Standard Indonesian terms for finance clerks (with standards/textbook grounding)

### Takeaway
Clerks know these terms:
- **Bukti Kas Masuk (BKM) / Bukti Kas Keluar (BKK)**: source vouchers for every cash in/out.
- **Buku (Besar) Pembantu Piutang/Utang**: AR/AP subsidiary ledger, the formal name for what 7Soft calls Kartu Piutang/Hutang.
- **Jurnal Umum / Journal Voucher**, **Buku Besar**, **Neraca Saldo** (trial balance), **Laba Rugi**, and **Tutup Buku** (closing, which posts the jurnal penutup to Laba Ditahan) with the separate **Kunci Periode** (lock).

The standards in force are SAK EMKM (micro/small) and SAK EP (from 1 Jan 2025, replacing SAK ETAP).

### Cited Findings
- BKK records every transaction that takes money out of the company's cash, and BKM every transaction that brings money in. Both support cash control and audit. Typical BKM: customer payment receipts, cash-paid sales invoices, bank deposits. Typical BKK: rent receipts, cash-paid purchase invoices, cheques issued, expense vouchers. A BKK should carry the company, date, description, amount and the finance officer's signature — [snippet] [accurate.id Bukti Kas Keluar](https://accurate.id/akuntansi/bukti-kas-keluar/); [accurate.id Bukti Kas Masuk](https://accurate.id/aplikasi-kasir/bukti-kas-masuk/)
- A petty-cash example uses numbered vouchers such as "BKK-004" (courier cost, receipt attached, approved by a supervisor) and "BKM-001" (opening petty-cash fund) — [snippet] [jurnal.id blog Kas Kecil](https://www.jurnal.id/id/blog/pengertian-tujuan-metode-dan-contoh-kas-kecil/)
- "Buku besar pembantu piutang" is the per-customer subsidiary record that complements the general ledger, citing IAI. It holds customer name, invoice number, due date, amount and payment status — [snippet] [accurate.id Buku Besar Pembantu Piutang](https://accurate.id/akuntansi/buku-besar-pembantu-piutang/)
- The Accurate 5 textbook teaches "Menyajikan Neraca Saldo", "Laporan Profit & Loss", "Laporan Perubahan Ekuitas", "Laporan Cash Flow", "Laporan Neraca", "Buku Pembantu Piutang" and "Buku Pembantu Utang", and calls journal entries "Journal Voucher". It describes the course as covering "input jurnal bukti kas masuk maupun keluar" — [fetched] [Accurate 5 textbook](https://repo.polteklpp.ac.id/704/1/BUKU%20AJAR%20KOMPUTER%20AKUNTANSI_ACCURATE%20ver%201.pdf)
- Jurnal's "Tutup Buku" closes the books up to a chosen period. It asks the user to check bank reconciliation, stock opname and depreciation first, and blocks if any warehouse has negative stock. It asks for the tax expense, tax payable and laba ditahan accounts, then posts the closing journal of net profit/loss to Laba Ditahan. "Kunci Periode" locks without a closing journal.
  - Paths: "Daftar Akun" > "Tindakan" > "Tutup buku & kunci periode"; "Daftar Lainnya" > "Daftar Kunci Periode & Tutup Buku" (old label "Daftar Penutupan Buku"). The UI was refreshed in Q4 2025.
  - [snippet] [Tutup Buku (New)](https://help-center.jurnal.id/hc/id/articles/43448083771161-Bagaimana-Cara-Melakukan-Tutup-Buku-New); [Kunci Periode (New)](https://help-center.jurnal.id/hc/id/articles/43448115083161-Bagaimana-Cara-Melakukan-Kunci-Periode-New); [Jurnal Updates Q4 2025](https://help-center.jurnal.id/hc/id/articles/52575585526937-Jurnal-Updates-Q4-Oktober-Desember-2025); [guidebook Daftar Penutupan Buku](https://www.jurnal.id/id/guidebooks/daftar-lainnya-daftar-penutupan-buku)
- Accurate 5's period routine is "Aktivitas – Periodik – Proses Akhir Bulan" (Period End) — [fetched] [Accurate 5 textbook](https://repo.polteklpp.ac.id/704/1/BUKU%20AJAR%20KOMPUTER%20AKUNTANSI_ACCURATE%20ver%201.pdf)
- **SAK EMKM** (issued by IAI in 2016, effective 1 Jan 2018) requires a statement of financial position (laporan posisi keuangan), a profit and loss statement (laporan laba rugi) and notes (catatan atas laporan keuangan). A cash-flow statement is not required — [snippet] [jurnal.id blog SAK EMKM](https://www.jurnal.id/id/blog/sak-akuntansi-emkm/); [academic] [UIN Malang journal](https://urj.uin-malang.ac.id/index.php/mij/article/download/4604/1646)
- **SAK EP** (Entitas Privat), approved by DSAK IAI on 30 Jun 2021, is effective 1 Jan 2025 and replaces SAK ETAP; early adoption was allowed from 2022 — [snippet] [DDTC kamus SAK EP](https://news.ddtc.co.id/literasi/kamus/1803456/apa-itu-standar-akuntansi-keuangan-entitas-privat-sak-ep); [UGM](https://imagama.feb.ugm.ac.id/dianggap-terlalu-sederhana-untuk-entitas-privat-sak-etap-diganti). Conflict: one snippet claimed SAK EMKM users must also move to SAK EP. A DDTC headline instead says former SAK ETAP entities cannot "downgrade" to SAK EMKM, which implies SAK EMKM remains for eligible entities. Treat the "must move" claim as unverified — [snippet] [DDTC](https://news.ddtc.co.id/berita/nasional/1802565/sak-ep-bakal-gantikan-sak-etap-tak-boleh-turun-kelas-pakai-sak-emkm)

### Inferences
- "Kartu Piutang/Kartu Hutang" (7Soft) is the clerical, card-based name for the Buku Pembantu Piutang/Utang. Vendors' report names differ ("Pernyataan Piutang", "AR Subsidiary Ledger"), but the concept is standard. A label like "Kartu Hutang" is idiomatic, not unusual.
- 7Soft's "Closing Periode" corresponds to Tutup Buku (with jurnal penutup) and/or Kunci Periode. The Jurnal split is a useful distinction: closing creates journals, a lock does not.
- "Laba Rugi" and "Neraca" remain the clerk words. SAK EMKM's formal titles ("laporan posisi keuangan", "laporan laba rugi") appear in statutory output, while software menus keep "Neraca"/"Laba Rugi".

### Gaps
- No primary IAI text of SAK EMKM or SAK EP was retrieved. Paragraph numbers are not cited.
- A textbook definition of "Kartu Piutang" and "Jurnal Penutup" was not retrieved. These are standard curriculum terms, but no source was captured this session.
- The PSAK renumbering (2024) was not researched.

---

## Q6. Indonesian tax/regulatory items that shape finance menus (e-Faktur/Coretax 2025, PPN 12% DPP nilai lain 11/12, PPh Bukti Potong)

### Takeaway
Since 1 Jan 2025, DJP's **Coretax** hosts e-Faktur and eBupot. Accounting packages respond with tax settings on sales and purchase documents plus **XML export** of output invoices and withholding slips, rather than a big tax module:
- Accurate: PPN 12% configuration, and XML export from "SPT PPN/PPnBM" in Daftar Laporan.
- Jurnal: e-Faktur and e-Bupot through Mekari Klikpajak.
- Zahir: "Faktur pajak" as a report facility.

PPN is 12% on a DPP of 11/12 of the price for non-luxury goods (PMK 131/2024), which keeps the effective rate at 11%. A product needs: a PPN code with DPP nilai lain, an export to Coretax XML (Faktur Keluaran), and Bukti Potong (BPPU / BP21) tracking for PPh withholding.

### Cited Findings
- **PMK 131/2024:** for non-luxury goods and services the DPP is a "nilai lain" of 11/12 of the selling price, import value or reimbursement, so 12% × 11/12 = 11% effective. Luxury goods use the full price — [snippet] [pajak.go.id](https://pajak.go.id/index.php/en/node/113508)
- Tax invoices must show 12% with the 11/12 DPP from 1 Apr 2025. Invoices showing 11% were tolerated during a three-month transition to 31 Mar 2025 — [snippet] [DDTC News](https://news.ddtc.co.id/berita/nasional/1808108/jangan-bingung-faktur-pajak-masih-boleh-pakai-ppn-11-hingga-31-maret). Later PMK 11/2025 and PER-1/PJ/2025 adjusted the scope of the nilai-lain formulas — [snippet] [DDTC Tax Manual](https://perpajakan.ddtc.co.id/id/publikasi/tax-manual-indonesia)
- **e-Faktur desktop fallback:** from 12 Feb 2025 all PKP may use the e-Faktur Client Desktop under KEP-54/PJ/2025 (PKP tertentu). This excludes PKP registered after 1 Jan 2025, and desktop data flows into Coretax within H+2 — [snippet] [pajak.go.id](https://pajak.go.id/en/node/113891)
- **Coretax menus:**
  - Output invoices are imported via "e-Faktur > Pajak Keluaran > Impor Data" (XML), and import errors are checked in "XML Monitoring".
  - Bukti potong unifikasi is created in "eBupot" > "BPPU" > "Create eBupot BPU", then issued from "Belum Terbit"; key-in or XML upload are both possible.
  - [snippet] [Ortax impor XML](https://ortax.org/cara-membuat-faktur-pajak-dengan-impor-xml-di-coretax); [Ortax Bukti Potong Unifikasi](https://ortax.org/bagaimana-cara-membuat-bukti-potong-unifikasi-di-coretax)
- The DJP Excel-to-XML converter v1.5 for Faktur Keluaran and Retur Faktur Masukan took effect 1 Mar 2025. Returns of input invoices must go via XML — [snippet] [Mekari Community](https://community.mekari.com/forums/topic/update-xml-versi-1-5-untuk-faktur-keluaran-dan-retur-faktur-masukan-01-03-2025/)
- **Accurate Online:** a help article covers setting PPN 12% for transactions and faktur pajak (title seen only) — [snippet] [help.accurate.id PPN 12%](https://help.accurate.id/product/accurate-online/fitur-aol/tutorial-penyesuaian-tarif-ppn/). Accurate exports .XML for Coretax: supported files were "faktur keluaran dan dokumen keluaran", made via "SPT PPN/PPnBM" in "Daftar Laporan" — [snippet] [accurate.id XML Coretax](https://accurate.id/ekonomi-keuangan/xml-coretax/); [Accurate press: webinar Coretax & PPN 12%](https://accurate.id/press-release/atalks-webinar-coretax-dan-ppn12/). No Accurate bukti-potong export was confirmed.
- **Mekari Jurnal / Klikpajak:** Klikpajak is a licensed PJAP. Its e-Bupot PPh 21/26 module is aligned with Coretax (forms BP 21, BP 26, BP MP, BP A1), and Jurnal links invoices to e-Faktur and e-Bupot — [snippet] [jurnal.id blog e-Faktur & e-Bupot](https://www.jurnal.id/id/blog/integrasi-invoice-dan-e-bupot-pph-21-26/); [Mekari Klikpajak e-Faktur](https://mekari.com/produk/klikpajak/efaktur/)
- **Zahir:** "Faktur pajak" is listed under "Fasilitas Laporan", and "Multi Tax" under "Fasilitas Multi" — [fetched] [help.zahironline.com fasilitas](https://help.zahironline.com/portal/id/kb/articles/fasilitas-yang)
- **Accurate 5 (older):** tax codes are set in "List (Daftar) > Others (Daftar lain) > Taxes (Kode Pajak)", with "VAT OUT" (sales tax account) and "VAT IN" (purchase tax account) — [fetched] [Accurate 5 textbook](https://repo.polteklpp.ac.id/704/1/BUKU%20AJAR%20KOMPUTER%20AKUNTANSI_ACCURATE%20ver%201.pdf)
- **Accurate Online "e-Meterai"** is a navigation module, and **"Smartlink Tax"** a SmartLink feature — [fetched] [accurate.id/online/fitur/kas-bank](https://accurate.id/online/fitur/kas-bank/)
- **SAP B1 / Odoo:** partner add-ons (SNI) or official localisations (Odoo's Indonesia e-Faktur modules) provide e-Faktur — [snippet] [SNI](https://snitechnology.net/efaktur-indonesia/); [Odoo Indonesia localisation](https://www.odoo.com/documentation/master/applications/finance/fiscal_localizations/indonesia.html)

### Inferences
- None of the products shows tax as a 7Soft-style top-level group. Tax lives in document settings (PPN code per line), in master lists (Kode Pajak), and in report/export functions (SPT PPN, e-Faktur XML). 7Soft having no "Pajak" group is consistent with the norm, provided the Laporan/Fasilitas areas expose a Coretax XML export.
- For retail POS takings, PPN applies to the sale (DPP 11/12 for non-luxury goods). MDR fees carry their own PPN treatment from the payment provider; this is unverified, see Q4.

### Gaps
- It is unconfirmed whether Accurate Online currently has a top-level "Perpajakan" menu with faktur pajak or bukti potong lists. The help site was blocked and marketing navigation shows only "E-Meterai" and "Smartlink Tax".
- Zahir's Coretax/XML support status in 2025–2026 was not researched.
- Primary texts of PMK 131/2024, PMK 81/2024 (Coretax) and PER-1/PJ/2025 were not retrieved; secondary commentary only.
