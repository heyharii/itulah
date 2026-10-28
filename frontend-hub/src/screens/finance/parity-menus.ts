/// Every menu of the 7Soft manual, and how closely the Central screen that
/// answers it matches 7Soft.
///
/// Copied from `finance-7soft/data-menus.js` and `data-coverage.js` (the
/// prototype folder), read off the manual's table of contents and the
/// element-by-element audits of 27 Oct 2026. `screen` is the id of the
/// prototype screen that answers the menu; `parity.tsx` maps each id to the
/// hub route.

export type Scope = "fin" | "other"

export interface Menu {
  readonly number: string
  /// 7Soft's own name for the menu, as the manual writes it.
  readonly name: string
  readonly page: number
  /// 7Soft's group for the menu.
  readonly group: string
  readonly screen: string | null
  readonly scope: Scope
  readonly note?: string
}

export const MENUS: readonly Menu[] = [
  {
    number: "2.1",
    name: "Daftar Nilai",
    page: 45,
    group: "Master",
    screen: null,
    scope: "other",
  },
  {
    number: "2.2",
    name: "Item",
    page: 46,
    group: "Master",
    screen: null,
    scope: "other",
  },
  {
    number: "2.3",
    name: "Satuan",
    page: 53,
    group: "Master",
    screen: null,
    scope: "other",
  },
  {
    number: "2.4",
    name: "Formula (BOM)",
    page: 54,
    group: "Master",
    screen: null,
    scope: "other",
  },
  {
    number: "2.5",
    name: "Saldo Awal (stock)",
    page: 56,
    group: "Master",
    screen: null,
    scope: "other",
  },
  {
    number: "2.6",
    name: "Konversi Item",
    page: 57,
    group: "Master",
    screen: null,
    scope: "other",
  },
  {
    number: "2.7",
    name: "Gudang",
    page: 58,
    group: "Master",
    screen: null,
    scope: "other",
  },
  {
    number: "2.8",
    name: "Jangka Waktu Kredit",
    page: 59,
    group: "Master",
    screen: "parties",
    scope: "fin",
  },
  {
    number: "2.9",
    name: "Alamat",
    page: 60,
    group: "Master",
    screen: "parties",
    scope: "fin",
  },
  {
    number: "2.10",
    name: "Pajak",
    page: 61,
    group: "Master",
    screen: "parties",
    scope: "fin",
  },
  {
    number: "2.11",
    name: "Customer",
    page: 62,
    group: "Master",
    screen: "parties",
    scope: "fin",
  },
  {
    number: "2.12",
    name: "Supplier",
    page: 67,
    group: "Master",
    screen: "parties",
    scope: "fin",
  },
  {
    number: "2.13",
    name: "Karyawan",
    page: 71,
    group: "Master",
    screen: null,
    scope: "other",
  },
  {
    number: "2.14",
    name: "Daftar Harga",
    page: 72,
    group: "Master",
    screen: null,
    scope: "other",
  },
  {
    number: "2.15",
    name: "Asset",
    page: 74,
    group: "Master",
    screen: "assets",
    scope: "fin",
  },
  {
    number: "2.16",
    name: "Account",
    page: 76,
    group: "Master",
    screen: "coa-master",
    scope: "fin",
  },
  {
    number: "2.17",
    name: "Saldo Awal COA",
    page: 77,
    group: "Master",
    screen: "coa-opening",
    scope: "fin",
  },
  {
    number: "2.18",
    name: "Setting COA",
    page: 78,
    group: "Master",
    screen: "coa-links",
    scope: "fin",
  },
  {
    number: "2.19",
    name: "User & Group",
    page: 81,
    group: "Master",
    screen: "users",
    scope: "fin",
  },
  {
    number: "2.20",
    name: "Setting Menu",
    page: 83,
    group: "Master",
    screen: "setting-menu",
    scope: "fin",
  },
  {
    number: "2.21",
    name: "List Report",
    page: 85,
    group: "Master",
    screen: null,
    scope: "other",
  },
  {
    number: "3.1",
    name: "Info Barang & Stok",
    page: 86,
    group: "Inventory",
    screen: null,
    scope: "other",
  },
  {
    number: "3.2",
    name: "Pindah Antar Gudang (PAG)",
    page: 93,
    group: "Inventory",
    screen: null,
    scope: "other",
  },
  {
    number: "3.3",
    name: "Stock Adjustment",
    page: 94,
    group: "Inventory",
    screen: null,
    scope: "other",
  },
  {
    number: "3.4",
    name: "Adjustment Nilai",
    page: 96,
    group: "Inventory",
    screen: null,
    scope: "other",
  },
  {
    number: "3.5",
    name: "Retur Barang ke Supplier",
    page: 98,
    group: "Inventory",
    screen: null,
    scope: "other",
  },
  {
    number: "3.6",
    name: "Retur Barang dari Customer",
    page: 99,
    group: "Inventory",
    screen: null,
    scope: "other",
  },
  {
    number: "3.7",
    name: "Perakitan",
    page: 101,
    group: "Inventory",
    screen: null,
    scope: "other",
  },
  {
    number: "3.8",
    name: "Stok Opname",
    page: 103,
    group: "Inventory",
    screen: null,
    scope: "other",
  },
  {
    number: "3.9",
    name: "Laporan Inventory",
    page: 105,
    group: "Inventory",
    screen: null,
    scope: "other",
  },
  {
    number: "4.1",
    name: "Info Pembelian",
    page: 110,
    group: "Pembelian",
    screen: "buy-info",
    scope: "fin",
  },
  {
    number: "4.2",
    name: "Order Pembelian (PO)",
    page: 114,
    group: "Pembelian",
    screen: null,
    scope: "other",
  },
  {
    number: "4.3",
    name: "Barang Datang (BPB)",
    page: 118,
    group: "Pembelian",
    screen: null,
    scope: "other",
  },
  {
    number: "4.4",
    name: "Faktur / Invoice Pembelian",
    page: 121,
    group: "Pembelian",
    screen: "buy-invoice",
    scope: "fin",
  },
  {
    number: "4.5",
    name: "Invoice Retur Beli",
    page: 128,
    group: "Pembelian",
    screen: "buy-return",
    scope: "fin",
  },
  {
    number: "4.6",
    name: "Laporan Pembelian",
    page: 131,
    group: "Pembelian",
    screen: "buy-reports",
    scope: "fin",
  },
  {
    number: "5.1",
    name: "Info Penjualan",
    page: 138,
    group: "Penjualan",
    screen: "sell-info",
    scope: "fin",
  },
  {
    number: "5.2",
    name: "Sales Order",
    page: 144,
    group: "Penjualan",
    screen: null,
    scope: "other",
  },
  {
    number: "5.3",
    name: "Surat Jalan",
    page: 147,
    group: "Penjualan",
    screen: null,
    scope: "other",
  },
  {
    number: "5.4",
    name: "Penjualan Cash",
    page: 150,
    group: "Penjualan",
    screen: "sell-cash",
    scope: "fin",
  },
  {
    number: "5.5",
    name: "Penjualan Barcode (POS)",
    page: 152,
    group: "Penjualan",
    screen: "sell-cash",
    scope: "fin",
  },
  {
    number: "5.6",
    name: "Faktur Penjualan",
    page: 154,
    group: "Penjualan",
    screen: "sell-invoice",
    scope: "fin",
  },
  {
    number: "5.7",
    name: "Transaksi Retur Penjualan",
    page: 161,
    group: "Penjualan",
    screen: "sell-return",
    scope: "fin",
  },
  {
    number: "5.8",
    name: "Laporan Penjualan",
    page: 164,
    group: "Penjualan",
    screen: "sell-reports",
    scope: "fin",
  },
  {
    number: "6.1",
    name: "Info Kas Bank",
    page: 174,
    group: "Kas - Bank",
    screen: "kas-info",
    scope: "fin",
  },
  {
    number: "6.2",
    name: "BKM (Bukti Kas/Bank Masuk)",
    page: 179,
    group: "Kas - Bank",
    screen: "bkm-bkk",
    scope: "fin",
  },
  {
    number: "6.3",
    name: "BKK (Bukti Kas/Bank Keluar)",
    page: 183,
    group: "Kas - Bank",
    screen: "bkm-bkk",
    scope: "fin",
  },
  {
    number: "6.4",
    name: "Pencairan BG Masuk",
    page: 187,
    group: "Kas - Bank",
    screen: "giro-board",
    scope: "fin",
  },
  {
    number: "6.5",
    name: "Pencairan BG Keluar",
    page: 190,
    group: "Kas - Bank",
    screen: "giro-board",
    scope: "fin",
  },
  {
    number: "6.6",
    name: "Laporan Kas/Bank",
    page: 192,
    group: "Kas - Bank",
    screen: "kas-report",
    scope: "fin",
  },
  {
    number: "7.1",
    name: "Info Accounting",
    page: 200,
    group: "GL · Buku Besar",
    screen: "gl-info",
    scope: "fin",
  },
  {
    number: "7.2",
    name: "Transaksi Jurnal",
    page: 203,
    group: "GL · Buku Besar",
    screen: "gl-journal",
    scope: "fin",
  },
  {
    number: "7.3",
    name: "Closing Periode Akuntansi",
    page: 205,
    group: "GL · Buku Besar",
    screen: "gl-closing",
    scope: "fin",
  },
  {
    number: "7.4",
    name: "Laporan Accounting",
    page: 206,
    group: "GL · Buku Besar",
    screen: "report-acc",
    scope: "fin",
  },
  {
    number: "8.1",
    name: "Laporan Keuangan",
    page: 209,
    group: "Analisa",
    screen: "report-acc",
    scope: "fin",
  },
  {
    number: "8.2",
    name: "Laporan Manajerial",
    page: 211,
    group: "Analisa",
    screen: "report-acc",
    scope: "fin",
  },
  {
    number: "9.1",
    name: "Reproses Stok",
    page: 213,
    group: "Fasilitas",
    screen: null,
    scope: "other",
  },
  {
    number: "9.2",
    name: "Reproses HPP",
    page: 215,
    group: "Fasilitas",
    screen: null,
    scope: "other",
  },
  {
    number: "9.3",
    name: "Reproses Accounting",
    page: 216,
    group: "Fasilitas",
    screen: "gl-closing",
    scope: "fin",
    note: "Only a confirm sheet inside Closing",
  },
  {
    number: "9.4",
    name: "List User Online",
    page: 217,
    group: "Fasilitas",
    screen: null,
    scope: "other",
  },
  {
    number: "9.5",
    name: "Restore and Patch",
    page: 218,
    group: "Fasilitas",
    screen: null,
    scope: "other",
  },
  {
    number: "9.6",
    name: "Back Up",
    page: 219,
    group: "Fasilitas",
    screen: null,
    scope: "other",
  },
  {
    number: "9.7",
    name: "Export / Import Master",
    page: 219,
    group: "Fasilitas",
    screen: null,
    scope: "other",
  },
  {
    number: "9.8",
    name: "Archive Data Lama",
    page: 221,
    group: "Fasilitas",
    screen: null,
    scope: "other",
  },
  {
    number: "9.9",
    name: "About",
    page: 221,
    group: "Fasilitas",
    screen: null,
    scope: "other",
  },
  {
    number: "9.10",
    name: "Persiapan Singkat dan Set Up",
    page: 222,
    group: "Fasilitas",
    screen: "setup-switches",
    scope: "fin",
  },
  {
    number: "9.11",
    name: "History Report",
    page: 222,
    group: "Fasilitas",
    screen: "history",
    scope: "fin",
  },
  {
    number: "9.12",
    name: "History",
    page: 223,
    group: "Fasilitas",
    screen: "history",
    scope: "fin",
  },
  {
    number: "10",
    name: "Toolbar · Filter · Find · Calculator",
    page: 224,
    group: "Fasilitas",
    screen: null,
    scope: "other",
    note: "Screen furniture, not a menu",
  },
]

/// Does the Central screen cover everything 7Soft's does?
///
/// - `yes` — all data present; toolbar drops are documented.
/// - `part` — something is missing: `note` counts it, `miss` lists it.
export interface Coverage {
  readonly same: "yes" | "part"
  readonly note: string
  readonly miss: readonly string[]
  /// What the backend already offers, for a screen the hub does not have.
  readonly backend?: string
}

export const COVERAGE: Readonly<Record<string, Coverage>> = {
  // Read off the hub on 28 Oct 2026, after every 7Soft tab, column, button and
  // report the existing API can feed was added. What is left is what the API
  // does not carry yet; the screen shows those fields as "—".
  "kas-info": {
    same: "part",
    note: "Needs backend 3",
    miss: [
      "Keterangan and Aktif per Kas/Bank account (not on the money accounts)",
      "Giro accounts (Giro Masuk, Utang Giro) told apart in the Kas/Bank list",
      "Record navigator and Format/Default (technical, dropped)",
    ],
  },
  "kas-report": {
    same: "yes",
    note: "All 20 reports; long periods read the first 200–500 rows",
    miss: [],
  },
  "giro-board": {
    same: "part",
    note: "Needs backend 2",
    miss: [
      "Cair asks Bank tujuan (the clear request takes only the date)",
      "Saldo Awal BG typed in (no create endpoint; read-only)",
    ],
  },
  "bkm-bkk": {
    same: "part",
    note: "Needs backend 4",
    miss: [
      "No Voucher typed by hand (the record request has no number)",
      "Tanggal with a time (doc_date is a date; the time shown is when it was written)",
      "BKM customer picker with a code, Pelunasan Piutang and Hutang tabs (no customer invoices in finance)",
      "Reff No from the supplier's own invoice number (bills carry no reference)",
    ],
  },
  "gl-info": {
    same: "yes",
    note: "All five tabs; All Jurnal reads the first 50 entries of a range",
    miss: [],
  },
  "gl-journal": {
    same: "part",
    note: "Needs backend 2",
    miss: [
      "No Referensi as its own field (kept inside the memo as [ref])",
      "Saved/draft journal status (an entry is New or Delete)",
    ],
  },
  "gl-closing": {
    same: "part",
    note: "Needs backend 3",
    miss: [
      "Tanggal on each period (the periods API has no creation date)",
      "Proses Saldo Awal Program ke Neraca Awal",
      "Test Validasi Transaksi / Accounting and Setuju Abaikan Validasi",
    ],
  },
  "report-acc": {
    same: "part",
    note: "Item and customer reports Later",
    miss: [
      "Laba rugi per item, customer, nota and sales; HPP per item (stock and sales lines are Merchandise's and Sales')",
      "Fast/Slow Moving and 10 Top Customer",
    ],
  },
  "buy-info": {
    same: "part",
    note: "Needs backend 2",
    miss: [
      "Supplier Lokasi, Fax and Limit Hutang",
      "PO tab with Close PO (Procurement's)",
    ],
  },
  "buy-invoice": {
    same: "part",
    note: "Needs backend 4",
    miss: [
      "No Ref, Lokasi, PO, BPB, Jangka and Tipe saved when a faktur is recorded",
      "Satuan, Diskon and Keterangan per item line",
      "Cash, Pay and Retur open with this faktur already picked",
      "Right-click stock per gudang and price history",
    ],
  },
  "buy-return": {
    same: "part",
    note: "Needs backend 3",
    miss: [
      "Item lines saved with the retur (shown only when linked to a supplier return)",
      "Kas/Bank, No Cek and Potongan on its refund",
      "Total diskon and No Ref",
    ],
  },
  "buy-reports": {
    same: "part",
    note: "All 33 listed; 8 empty",
    miss: [
      "5 receipts with value, 10 price list, 11 price history",
      "13, 14, 16 uang muka application history",
      "18 PO lines, 19 stock against open PO",
    ],
  },
  "sell-info": {
    same: "part",
    note: "Needs backend 3",
    miss: [
      "Discount per nota, customer name and place",
      "Shift, No Ref and Keterangan on a sale",
      "Customer, Pelunasan Piutang, Summary and Kartu Piutang tabs (only if the client sells on credit)",
    ],
  },
  "sell-cash": {
    same: "part",
    note: "Needs backend 2",
    miss: [
      "Discount and Satuan per line, Total diskon per nota",
      "No Ref and Keterangan on a sale",
    ],
  },
  "sell-invoice": {
    same: "part",
    note: "Credit sales only",
    miss: [],
    backend: "No sales invoice API; the chart has no customer receivable",
  },
  "sell-return": {
    same: "part",
    note: "Needs backend 2",
    miss: [
      "No Ref, PPN, Total diskon, price and discount per line",
      "Pelunasan with Kas/Bank and Cek/BG (only if the client sells on credit)",
    ],
  },
  "sell-reports": {
    same: "part",
    note: "Cash and POS reports in; credit reports out",
    miss: [
      "Per Kota (shops carry no city) and names per cashier",
      "SO, Surat Jalan, Uang Muka and Piutang reports (only if the client sells on credit)",
    ],
  },
  "coa-master": {
    same: "part",
    note: "Needs backend 2",
    miss: ["Create Coa", "Delete an account (deactivate only)"],
  },
  "coa-opening": {
    same: "part",
    note: "Needs backend 1",
    miss: [
      "Typing a balance into the grid and Create New Saldo: the opening comes in from a file an administrator imports",
    ],
  },
  "coa-links": {
    same: "part",
    note: "Needs backend 2",
    miss: [
      "Roles for Hutang Suspend, Laba, Pembelian Jasa, Penjualan Jasa, Piutang, Potongan Piutang and Uang Muka Penjualan",
      "Set as default and Synkron Acc",
    ],
  },
  "setting-menu": {
    same: "part",
    note: "Numbering saves; the rest needs backend",
    miss: [
      "Urutan, Tanggal Bisa Edit, Tampil Awal, Auto Insert, Sorting By and Keterangan per menu",
    ],
  },
  "setup-switches": {
    same: "part",
    note: "Needs backend",
    miss: [
      "7Soft General and Transaksi switches (Tanggal Mulai Program, Decimal, Pembulatan PPN, Default Tanggal BKK/BKM, limits)",
      "Logo, No Seri Faktur Pajak, PKP number and date",
    ],
  },
  parties: {
    same: "part",
    note: "Needs backend 3",
    miss: [
      "Supplier Lokasi, Fax, Bank Account, Batas Hutang, Diskon, COA Hutang, address ticks",
      "Saldo Awal hutang/piutang per party and Import",
      "Customer credit fields: Termin, Batas Piutang, NPWP, Rayon, Sales, COA Piutang",
    ],
  },
  assets: {
    same: "part",
    note: "Needs backend 2",
    miss: [
      "Keterangan and an Intangible flag stored on the asset; Import",
      "No Jurnal of the depreciation run",
    ],
  },
  users: {
    same: "part",
    note: "Rights shown, not set",
    miss: [
      "View/Tambah/Edit/Hapus ticks per group and menu that can be changed; Select All, Unselect, Copy",
      "Report Admin/Template/Excel, Mulai and Sampai Tanggal per user",
    ],
  },
  history: {
    same: "part",
    note: "Needs backend 2",
    miss: [
      "LAPORAN EXPORT XLS rows (the audit log records writes, never reads)",
      "Document number on every row (shown where the audit row carries one)",
    ],
  },
}
