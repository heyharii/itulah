# Finance hub parity master - 28 Oct 2026

Rule (owner): the information in each menu is 7Soft's; deviate only where the hub's way is surely better, and say so. Hub-only extras stay.

## Master menus: Account, Setting COA, Set Up, Customer · Supplier · Pajak, Asset, User & Group

Audited 28 Oct 2026 against 7Soft manual 2.8, 2.10-2.12, 2.15, 2.16, 2.18-2.20, 4.2-4.3 and the screenshots
`p65 p67 p68 p71 p73 p75 p80 p82 p83 p84 p87 p88`. Status: **present** / **renamed** / **missing** / **elsewhere**.
Decision: **KEEP** (build it as 7Soft has it) / **IMPROVE** (7Soft's content, the hub's better way, reason given) / **DROP** (7Soft technical leftover only).
"Built" = in `frontend-hub` on 28 Oct 2026, read-checked and prettier/eslint clean, not run in a browser.

### 1. Account (2.16) - hub `/finance/accounting/chart-of-accounts`, `chart-of-accounts.tsx`

| 7Soft element | Hub | Decision | Built |
|---|---|---|---|
| Tabs: one window, Account tree + detail grid | Tabs Chart, History | KEEP; History is hub-only (7Soft's own History is menu 10) | - |
| Kode Account | code column, 12-digit codes kept | renamed **Kode** | yes (column + header) |
| Nama Account | name | renamed **Nama** | yes |
| Tipe Account (Kas/Bank, Aktiva Lancar...) | not on the list read; sheet shows class | renamed; column shows the **class** (ASSET, LIABILITIES...) because `LedgerAccount` has no `account_type` | partly |
| 7Soft's own Tipe list (AKTIVA LANCAR, AKTIVA TETAP...) | ledger types are CASH, BANK, RECEIVABLE... fixed by the database | IMPROVE: keep the hub's types (the database refuses others) | no, needs backend |
| Aktif tick | Deactivate / Reactivate in the sheet, line-through name | renamed **Aktif** column (check / dash) + sheet Fact | yes |
| Aktif tick on a new account | accounts are created active | KEEP the hub way; no field in `ChartChangeRequest` | no |
| Expandable tree (+ / -) | tree with Expand all / Collapse all | present | - |
| Create Coa | none: a new account applies at once, per-unit accounts are not "created" later | IMPROVE: no step to forget | - |
| New / Save | New account sheet, Submit | present, labels Kode / Nama / Tipe Account | yes |
| Del, Del All | Deactivate (a posted account cannot be deleted) | IMPROVE: history stays | - |
| Info (last edit) | Changes list at the foot of the sheet + History tab | IMPROVE | - |
| Filter, Refresh | search, unit, Show inactive; tables refresh live | present | - |
| First/Prior/Next/Last, Undo, View, Print, "1 of 25" | none | DROP (desktop leftovers) | - |
| Hub extras kept | Balance column, Dr/Cr, Whose books, statement section, frozen, counter unit, reason | stay | - |

### 2. Setting COA (2.18) - hub `/finance/setup/account-links`, `account-links.tsx` + `setting-coa.tsx` + `coa-slots.ts`

7Soft: one grid, Keterangan + Account, 23 slots. The hub keeps *posting roles* (78) linked per unit; a slot is a name for one role.
New tab **Setting COA** (first) lists 7Soft's 23 names; the hub's role table stays as tab **Posting roles**.

| 7Soft slot | Hub role | State |
|---|---|---|
| Default Kas Kecil | `petty_cash` | linked or "Missing in the chart" |
| Disc Pembelian | `purchase_discount` | same |
| Disc Penjualan | `sales_discount` | same |
| HPP | `cogs` | same |
| Hutang | `trade_payable` | same |
| Hutang Suspend | none | **Not in the hub**: purchases are booked at the posted bill, no goods-received-not-invoiced payable |
| Laba | none | **Not in the hub**: the balance sheet computes the year's profit |
| Laba Ditahan | `retained_earnings` | same as linked (the closing voucher posts to it) |
| Pembelian Jasa | none | **Not in the hub**: service bought is an expense line, account from the expense category |
| Penjualan | `revenue_cash` | same as linked |
| Penjualan Jasa | none | **Not in the hub**: shops sell goods |
| Persediaan Barang | `inventory` | same |
| Piutang | none | **Not in the hub**: no debtor book |
| Potongan Hutang | `settlement_discount` | same |
| Potongan Piutang | none | **Not in the hub**: no debtor book |
| PPN Pembelian | `vat_in` | same |
| PPN Penjualan | `vat_out` | same |
| Retur Pembelian | `inventory` | same account as Persediaan, as in 7Soft's own screenshot |
| Retur Penjualan | `sales_return` | same |
| Stok Adjustment | `stock_loss` | shares the role with Stok Opname |
| Stok Opname | `stock_loss` | same |
| Uang Muka Pembelian | `advance_purchase` | same |
| Uang Muka Penjualan | none | **Not in the hub**: no debtor book |

16 slots resolve to a role, 7 do not. Columns: **Keterangan**, **Account** (code and name of the company-wide link, "+n" when more), Used for (the manual's sentence), Posting role.
A slot row opens its role sheet (to change the account, with history); a slot with no role opens a short sheet saying why and where the job lives.
The role sheet now names its 7Soft slot ("Setting COA: ...").

| 7Soft element | Decision |
|---|---|
| Account picker per slot | KEEP via the role sheet (per unit, per kind of unit, history) - IMPROVE |
| Item · Account tab (7 rows x Goods/Service/Down payment), Set as default, Synkron Acc | DROP here: per-item accounts belong to Master > Articles; a changed link applies to postings from then on, no sync step |
| Save, Undo, Format, Default, First..Last, Search, Info, View, Print | DROP (every change saves and is written to the role's history) |
| Filter, Refresh | present: search, "Only slots without an account", live refresh |
| Hub extras kept | Posting roles tab, gap counts, readiness, source-qualified roles |

### 3. Set Up (9.10 + 2.20) - hub `/finance/accounts-setup`, `setup-index.tsx`

The hub page is an index of masters (Accounts, Posting, Categories, Payments, Tax, Assets) plus "Master kept outside Finance".
`/finance/settings` holds only numeric rules (tolerances, thresholds); **none** has a 7Soft switch's meaning, so no switch was added (rule: only where the key exists).

| 7Soft switch | State | Decision |
|---|---|---|
| Info Perusahaan (name, logo, alamat, NPWP, seri faktur pajak, PKP no and date) | elsewhere (company / unit records) | not built here; needs a company-profile source |
| Tanggal Mulai Program | missing (opening start is the Opening flow) | not built |
| No Transaksi: Bulanan / Tahunan (otomatis, manual) | `/finance/number-series` has MONTHLY / YEARLY / NEVER | KEEP, **built**: "No Transaksi" section, Bulanan / Tahunan / Never; manual numbering is not offered (the server numbers) - IMPROVE |
| Kode No Transaksi (KM, KK, PJL, PO...) | pattern per kind of document | KEEP, **built**: "Kode No Transaksi" column, editable in a sheet |
| Hapus History Report, Form Penjualan Cash/Barcode tampil, Note for Today, Menu Gambar, Jenis Form, Folder Gambar / Template | no key | DROP (desktop leftovers) |
| Saldo Awal COA Mulai dari Awal | no key (opening locks by period) | not built |
| Jumlah Decimal Point, Maksimum Cetak Nota, Jumlah Baris dalam Nota, Print Nota otomatis | no key | not built (receipt printing belongs to the till) |
| Sistem Pembelian / Penjualan (5 flows) | no key; the hub has one purchasing flow | DROP |
| Stok Boleh Minus, Screening Stock, Nilai Order > Limit, Jumlah Item > PO/SO, Boleh Tambah Baris, Harga Jual beda dengan Price List, Diskon beda, HPP ditampilkan, Pembulatan PPN, Default Tanggal BKK/BKM, Default Total Discount | no key | not built; each needs a backend setting first |
| Kosongkan Database, Import Master, Restore Default | none | DROP (dangerous / desktop) |
| Setting Akun (Daftar Akun, Setting Akun, Jangka Waktu Kredit, Daftar Pajak) | present as groups Accounts, Posting, Tax | KEEP |
| Gudang dan Barang, Person | "Master kept outside Finance" | KEEP (owner rule: no duplicate masters) |
| Appearance (5 colours) | none | DROP |
| 2.20 Setting Menu (Menu, Display, Urutan, Kode No Transaksi, Tanggal bisa edit, Tampil awal, Auto insert, Barcode, Ganti nama item, Sorting by, Keterangan, Template, SQL) | Kode No Transaksi only | rest DROP (SQL and template files are desktop leftovers) |
Title is now **Set Up**.

### 4. Customer · Supplier · Pajak (2.8, 2.10-2.12) - hub `/finance/tax-setup/types`, `taxes.tsx` + `parties-tabs.tsx`

One page, five tabs: **Pajak**, **Tax types**, **Jangka Waktu Kredit**, **Supplier**, **Customer**.

| 7Soft element | Hub | Decision | Built |
|---|---|---|---|
| Pajak: Kode Pajak | withholding category code | renamed **Kode Pajak** | yes |
| Pajak: Persen | withholding `rate_bps` | renamed **Persen** | yes |
| Pajak: Default | none: no default tax code in the hub (PPN is not posted, policy P11) | missing, needs backend | no |
| Pajak: Aktif | `is_active` | **Aktif** column (was a pill) | yes |
| 7Soft's PPN0 / PPN10 codes | PPN_OUT / PPN_IN are tax *types* with no rate | IMPROVE: the type list stays as tab **Tax types** (Kode Pajak, Aktif added) | yes |
| Jangka Waktu Kredit: Nama / Kode, Keterangan, Jangka Wkt (Hari), Aktif | `PaymentTermRow` code, label, offset_value, active (+ basis) | **built** read-only; rows open Master > Payment terms (written there) | yes |
| Jangka Waktu Kredit: Default | per supplier default, none company-wide | missing | no |
| Supplier: Kode Supplier, Nama Supplier, Termin Pembayaran, No NPWP, Status Aktif | `Supplier` | **built** read-only; rows open Master > Suppliers | yes |
| Supplier: Batas Hutang, Diskon, COA Hutang, Termasuk Customer, Keterangan | not on the supplier | missing, needs backend | no |
| Supplier: addresses (Lokasi, Alamat 1-3, Kota, Propinsi, Kontak, Phone, Fax, Bank Account, Default Kirim/Penagihan/Pajak), Saldo Awal, Import | one address, contacts and bank accounts in the supplier master | elsewhere | no |
| Customer (all): Sales, Batas JTempo, Batas Piutang, Rayon, Tipe Harga Jual, COA Piutang, Saldo Awal | no credit customers, no debtor book | tab states it and opens Sales > Customer | tab only |
| Toolbar: First..Last, New, Del, Save, Undo, Print, Info, View, Format, Default | none | DROP; New / edit live in the owning master | - |

### 5. Asset (2.15) - hub `/finance/assets/capitalization`, `assets.tsx` (+ `asset-penyusutan.tsx`)

| 7Soft field | Hub | Decision | Built |
|---|---|---|---|
| Kode Asset | `asset_number` | renamed, visible | yes |
| Nama Asset | `name` | renamed, number no longer stacked under it | yes |
| Jumlah | `quantity` | new column | yes |
| Metode Depresiasi | `method` (Garis Lurus / Saldo Menurun / Tidak Disusutkan) | new column | yes |
| Nilai Asset | cost | renamed | yes |
| Nilai Penyusutan | accumulated | renamed, visible by default | yes |
| Tipe Asset | category | renamed | yes |
| Tanggal Beli | `acquired_on` | new, in Columns menu | yes |
| Tanggal Pemakaian | `in_service_on` | new, in Columns menu | yes |
| Umur Asset (TH) | `useful_life_months` / 12 | new, in Columns menu | yes |
| Rate Depresiasi | 1200 / months for a straight line, none for declining balance | new, in Columns menu | yes |
| Aktif | not disposed | new, in Columns menu | yes |
| Account Asset / Debet / Kredit | per asset class via links (`fixed_asset`, `depreciation_expense`, `accumulated_depreciation`) | elsewhere (Setting COA > Posting roles) | no |
| Intangible Asset tick | class kind (software etc.) | present as category | - |
| Keterangan | not on the row | missing | no |
| PENYUSUTAN (Transaksi Jurnal tab, Create journal) | Period close only | KEEP, **built**: tab **Penyusutan**: Periode, status, Rehearse (writes nothing), Charge (same server call as month end, safe to repeat) | yes |
| Del, Import, Read only after closing | disposal / transfer, register sheet; no import | IMPROVE (disposal posts the loss) / missing import | - |
| Hub extras kept | Treatment (assessed / capitalised / expensed), Bought via, Charged through, Book value, Site, projects and disposals tabs of the door | stay | - |
Default visible now: Kode, Nama, Tipe Asset, Jumlah, Metode, Treatment, Nilai Asset, Nilai Penyusutan, Book Value (Site moved to Columns).

### 6. User & Group (2.19) - hub `/finance/settings/permissions`, `permissions.tsx`

| 7Soft element | Hub | Decision | Built |
|---|---|---|---|
| Nama Group / Keterangan / Status Aktif | job roles in People | elsewhere (link to People > Roles) | pointer |
| Nama User, Nama Lengkap, Jabatan, Mulai / Sampai Tanggal | people and invites in People | elsewhere | no |
| Password | never shown, invite link | DROP | - |
| Report Admin / Template / To Excel | none | missing | no |
| Menu grid: MENU x VIEW / TAMBAH / EDIT / HAPUS | a route answers to the *least rung* (Cashier < Supervisor < Admin) per HTTP method | IMPROVE: tab **Menu**, read-only: GET = View, POST = Tambah, PUT / PATCH = Edit, DELETE = Hapus, from the overrides; no override shows "Built-in" | yes |
| Modul / Deskripsi Menu, Select All / Unselect, Copy | none | not built (the grid is read from overrides, not a per-group tick list) | no |
| Hub extra kept | tab **Overrides** (add, change, remove), the previous screen | stays | - |
Honest limit: the hub grants by rung per route, not four ticks per menu per group, so the grid is a reading, not a 7Soft permission editor.

### Could not do, and why
- Tipe Account per row, Aktif on a new account: the account list has no `account_type`, `ChartChangeRequest` no active flag (backend).
- Pajak Default, supplier Batas Hutang / Diskon / COA Hutang, customer master, 7Soft's Set Up switches: no key or table in the hub; building them is a backend decision.
- Asset Account Asset / Debet / Kredit columns, Keterangan, Import.
- User & Group as an editable 4-tick grid.
