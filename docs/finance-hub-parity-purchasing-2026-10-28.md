# Hub parity: Faktur Pembelian, Invoice Retur Beli, Info Pembelian, Laporan Pembelian

**Date:** 28 Oct 2026
**Rule (owner):** the information in a menu is the same as in 7Soft; deviate only where the hub's way is certainly better, and say so. Hub extras (Due dates, Loans, recurring bills, three-way match, holds, GA handover, unbilled deliveries) stay.
**Business context (owner, plan 2026-10-27):** PO and receiving live in Procurement; in Central the payable is created when goods are received and the supplier's bill COMPLETES it (invoice no, PPN, terms, due date) and is matched three-way. So 7Soft's typed item lines, the PO tab, Barang Datang and item-level/PO reports are **Procurement** and are not rebuilt in Finance. Everything about the bill itself, its payment, advances (Uang Muka), returns, supplier info/ledger and payables reports is Finance's and must match 7Soft.
**Sources:** manual PDF pp. 116-143 (printed 110-137), 236-245, 256-259, 271-275 and the screenshots `p116`-`p120`, `p127`, `p130`, `p131`, `p134`, `p136`, `p137`, `p143`; `finance-7soft/scr7-buy.js`, `scr-buy.js`, `data-coverage.js`; plan §0-§4, §6-§8.
**Hub files:** `frontend-hub/src/screens/finance/` `supplier-bills.tsx`, `credit-notes.tsx`, `supplier-ledger.tsx`, `purchasing.ts` (new), `purchasing-info.tsx` (new), `purchasing-reports.tsx` (new); `finance-final/payable.tsx` (one export now renders the reports); `src/lib/queries/finance.ts` (seven readers added); `nav.ts` (two view labels, see §6).
**Not verified in a browser** (no login). Read, `prettier --check`, `eslint` (no new findings; four "Compilation Skipped" warnings in `supplier-bills.tsx` were there before), every touched module served by Vite with 200. No `tsc`.

Legend. Status: **present** (same thing already in the hub), **renamed** (there, under another word), **missing** (not in the hub), **Procurement** (belongs to Procurement/Operations; where it lives). Decision: **KEEP** (as is), **IMPROVE** (7Soft's information, the hub does it better), **DROP** (7Soft technical leftover). "Done" = built in this change.

---

## 1. Faktur Pembelian (7Soft 4.4) — `/finance/payables/bills`, door tab Bills

| 7Soft element | Status before | Decision | Now |
| --- | --- | --- | --- |
| Toolbar First / Prior / Next / Last, "513 of 513", New, Del, Save, Undo, View | list + sheet | **DROP** record paging; New = Record bill | The list scrolls and a row opens its sheet. Record bill stays. A posted bill is never deleted (hold, return, credit note instead). |
| Filter, Refresh | present | KEEP | Filter panel, 10 s refresh. |
| Cash, Pay | elsewhere | KEEP | Payments are Payables › Payments and Cash & Bank › BKK; the bill's sheet links each payment. Not duplicated. |
| Print, Info, DBF | n/a | Print: later; Info: the sheet; DBF: **DROP** | No printed copy of a bill (nothing to print: the paper is the supplier's). Not built. |
| Import (Excel of unpaid bills) | missing | **Procurement / Opening** | Opening balances own it. |
| Header No Faktur | present (Invoice) | KEEP, **renamed** | Column "No faktur"; the sheet's title. The hub holds one number, 7Soft's No Faktur and No Ref are the same box here. BLI auto-numbering is a number-series question (plan §4.4), not built. |
| Tanggal | present | **renamed** | "Tanggal". |
| Supplier*, Kode | present (name only) | IMPROVE | Name with the code beside it in the sheet. |
| Lokasi + address | missing | KEEP, later | Supplier master data (Info Pembelian › Supplier shows Alamat). |
| Jangka waktu (T21) | missing | KEEP | **Done** "Jangka": `T{days}` from invoice date to due date (the bill has no term field). Column + sheet. |
| J.Tempo | present (Due) | **renamed** | "JTempo" column, "Jatuh tempo" in the sheet. |
| Tipe Invoice Matching / Standard / Uang Muka | missing | KEEP | **Done** sheet: Matching when the bill was matched to its deliveries, else Standard. Uang Muka is its own document here (`supplier-advances`), applied to a bill. |
| No PO, No Terima | missing | **Procurement** | Purchase Orders and Receiving PO; the match is `bills/{id}/match`, `/three-way`. |
| Gudang | present (Site) | **renamed** | "Gudang" (the site the goods came in at). |
| No Ref | missing | **missing** | One number on the wire. |
| Total Diskon | present (Discount) | **renamed** | "Total diskon" under the sheet's Total. |
| PPN (code) | present as rupiah | KEEP | **Done** column "PPN" and sheet: the code the rate implies (PPN0, PPN11). The rupiah amount stays in the totals. |
| Keterangan | present (note) | **renamed** | "Keterangan". |
| Sub-bar Del All, Browse Item, +, − (typed item lines) | n/a | **Procurement** | Lines are written by receiving and matching. |
| Tab Detail: Nama item, Jml, Satuan, Harga, Total | missing | KEEP | **Done** read-only "Detail" from `GET /bills/{id}/lines`: Nama item, Jml, Harga, Total. Satuan is not on the wire (**missing**). An expense bill keeps "What it was for" (account lines). |
| Tab Uang Muka: No Faktur, Tanggal, No Reff, Total, Uang Muka Yg Diapply, Sisa | missing | KEEP | **Done** "Uang muka": the advances already set against this bill (read from the bill's ledger settlements, each advance asked by id), columns No faktur (with Tanggal and No reff under it), Total, Uang muka diapply, Sisa. |
| Apply Uang Muka | missing in Finance | KEEP | **Done** "Apply Uang Muka" on a posted bill that still owes and whose supplier has an advance with money in it: choose the advance, the amount starts at the most that can go (the smaller of the advance's balance and what is owed). `POST /supplier-advances/{id}/apply`; the server refuses another supplier, unit or currency. |
| Tab Pelunasan: Voucher, No Reff, Tanggal, Kas/Bank, No Cek/BG, Bayar, Potongan, Keterangan | present (Paid by: payment, status, amount) | **IMPROVE** | **Done** "Pelunasan": Voucher (opens the payment), Tanggal, Kas/Bank, No reff, Bayar (net of discount), Potongan; a draft payment says Draft. No Cek/BG is **missing** (the giro is on Cash & Bank › Giro, not on the payment), Keterangan not shown. |
| Pelunasan footer Total Hutang / Total Bayar / Sisa | present (Total / Paid / Outstanding) | **renamed** | "Grand total / Total bayar / Sisa". |
| Tab PO-BPB-INVOICE | n/a | **Procurement** | The three-way match (hub extra). |
| Footer item and account line (kode - nama, "202101 Utang Suspend") | present as journal link | KEEP | "Journal" fact opens the entry; the accounts are in it. |
| Footer TOTAL / PPN / GRAND TOTAL / SISA UANG MUKA | partly | KEEP | **Done** "Total / Total diskon / PPN / Grand total / Total bayar / Sisa"; "Sisa uang muka Rp x" is the aside of the Uang muka section (the supplier's advances with money left). |
| Status NEW / LUNAS | present as Draft / Posted | KEEP | **Done** column and sheet say 7Soft's words for a bill in the books: **New** (nothing paid), **Part paid**, **Lunas**, from the server's `payment_state`. Draft and Matched stay as the hub says them: 7Soft has no state for a bill that is recorded and not in the books. The status filter asks the server for POSTED for the three and narrows the rest in the browser. |
| READ ONLY box | n/a | KEEP | A posted bill's sheet is read-only by construction. |

Hub extras kept untouched: Expenses / From GA / Unbilled deliveries tabs, hold, return to GA, "Check before posting", recurring bills, Record bill.

## 2. Invoice Retur Beli (7Soft 4.5) — `/finance/payables/credit-notes`, door tab Credit notes

Hub record: a credit note against one posted bill, by value (Amount), refundable. 7Soft: a return by item against a faktur.

| 7Soft element | Status before | Decision | Now |
| --- | --- | --- | --- |
| Title / New | Credit Note / New credit note | KEEP | **Done** "Invoice Retur Beli", button "Retur pembelian baru" (7Soft's own button text). |
| Header No Faktur (RBL) | present (Credit No) | **renamed** | "No faktur"; BLI-style prefix is the number series. |
| Tanggal | present (Date) | **renamed** | "Tanggal". |
| Supplier, Kode | present | KEEP | |
| Lokasi + address | missing | later | Supplier master. |
| Jangka waktu, Jatuh tempo | missing | **missing** | A credit note carries no term; it takes the invoice's. |
| No Faktur (the faktur returned) | present (Against invoice) | **renamed** | "Faktur diretur". |
| Gudang | present (Unit) | **renamed** | "Gudang", also a list column. |
| No Ref | present (Supplier's credit note no) | **renamed** | "No ref", also a list column. |
| Total Diskon | missing | **missing** | Not a field of a credit note. |
| PPN | present (tax, shown only if any) | KEEP | In the totals ladder. |
| Keterangan | present (Note) | **renamed** | "Keterangan". |
| Detail by item (Kode acc, Nama account, Nama item, Kode item, Jml, Satuan, Harga, Diskon Rp/%, Subtotal, Keterangan) | n/a | **Procurement** | Goods that go back are a Return PO (`/procurement/returns`) with its lines; the credit note settles it ("Settles return"). A credit note itself is value-based and also covers a price correction, which 7Soft's return cannot. |
| Delete unreturned lines, partial return | n/a | **Procurement** | Same. |
| Footer TOTAL / PPN / GRAND TOTAL | present as facts | KEEP | **Done** the same three as a ladder under the facts. |
| Status NEW / LUNAS | Draft / Posted / Refunded | KEEP | **Done** Draft (not in the books, hub word), **New** (in the books, money not back), **Lunas** (refunded). Same logic as a bill: Lunas when the money has moved. |
| Tab Pelunasan: Voucher, No Reff, Tanggal, Kas/Bank, No Cek/BG, Hutang, Bayar, Potongan, Sisa, Keterangan | present as "Refund entry" facts | KEEP | **Done** "Pelunasan" once refunded: Voucher (the refund entry, opens it), Tanggal, Hutang and Bayar as minus figures (what is owed back to us, as 7Soft shows it), Sisa 0. Kas/Bank, No Cek/BG, Potongan not carried: the refund names an account at record time but the note keeps only the entry. |
| Toolbar First..Last, Del, Filter, Cash, Pay, Save, Undo, View, Print, Info, DBF | n/a | **DROP** except Print (later) | |

Kept: Reason (goods returned / price correction), "Credit goes to", Record refund, Post.

## 3. Info Pembelian (7Soft 4.1) — `/finance/payables/supplier-ledger`, door tab Suppliers › Info Pembelian

The old Supplier Ledger page is now the screen with 7Soft's tabs: **Supplier · Pembelian & retur · Pelunasan hutang · Summary hutang · Kartu hutang**. The supplier picked (`?supplier=`, so Accounts Payable rows and the Supplier tab link here) narrows the tabs 7Soft narrows with its Supplier tick; none picked is 7Soft's unticked, all suppliers. Period is one from-to box (7Soft's two pickers and "All").

| 7Soft element | Status before | Decision | Now |
| --- | --- | --- | --- |
| Tab SUPPLIER: Kode supplier, Supplier, Alamat, Phone, Kontak, Jangka, Aktif | missing (master only) | KEEP | **Done** list from the supplier book. Jangka is the supplier's default terms code. Plus **Sisa hutang** per supplier (hub extra; today's ageing). A row opens that supplier's Kartu hutang. |
| Lokasi, Fax, Limit hutang | missing | **missing** | Not fields of the supplier record (master data is Procurement/Master). |
| Supplier Baru | missing | KEEP | **Done** button to Master › Suppliers. |
| Tab PO (Supplier / Outstanding ticks, Close PO, Tambah; Tanggal, No PO, No Ref, Status PO, Dibutuhkan, Supplier, Gudang, PPN, Total, Jangka, Keterangan) | n/a | **Procurement** | `/procurement/orders` (Purchase Orders), `/procurement/outstanding`. Not drawn here. |
| Tab PEMBELIAN & RETUR: Tanggal, No Faktur, Status, Supplier Kode / Nama / Lokasi, Gudang, Total, No PO, PPN, No Ref, Jangka, JTempo | missing | KEEP | **Done** bills and returns of the window together, newest first. Columns as 7Soft minus Lokasi, No PO and No Ref (see §1, §2), plus **Jenis**. |
| Ticks Supplier / Pembelian / Retur | n/a | **IMPROVE** | Supplier is the picker; Pembelian / Retur are the Jenis radio chips (hub rule: no tick boxes, no dropdowns). |
| Returns show as minus | n/a | IMPROVE | A return's Total is a minus figure. |
| Rows open their record | n/a | KEEP | A purchase opens its bill (`/payables/bills?bill=`), a return opens its credit note sheet in place. |
| Nota Pembelian Baru, Retur Pembelian Baru | missing | **DROP** | Bills and Credit notes are the door's tabs one click away; their forms are sheets of those screens, not deep links. |
| Tab PELUNASAN HUTANG: Tanggal, No Voucer, No Faktur, Bank, Supplier Nama / Kode / Lokasi, Nilai Faktur, Potongan, Bayar, No Reff, Giro No / JTempo | missing | KEEP | **Done** one row per bill per posted payment: Tanggal, No voucher, No faktur, Bank, Supplier, Nilai faktur, Potongan, Bayar, No reff, with the totals. A row opens the payment. Lokasi, Giro No and Giro JTempo are **missing** (a giro's own facts, Cash & Bank › Giro). |
| Pencairan Giro | missing | KEEP | **Done** header button to Cash & Bank › Giro. |
| Tab SUMMARY HUTANG: Supplier Nama / Kode, Saldo awal, Debet, Kredit, Saldo akhir; Periode, Sampai tanggal, Refresh | missing | KEEP | **Done** per supplier from its ledger (`payment-ledger/SUPPLIER/{code}/movements`), with a total row; unit box. IMPROVE: a supplier with nothing in any of the four is left out (7Soft lists every supplier with zeros). A row opens its Kartu hutang. |
| Tab KARTU HUTANG: Supplier, Periode, Sampai tanggal; Tanggal, No transaksi, Transaksi, Debet, Kredit, Saldo akhir, Keterangan; Awal / Debet / Kredit / Akhir | present (Supplier Ledger, English words) | **renamed** | **Done** 7Soft's words on the table, the Saldo awal line, the four figures (Awal, Debet, Kredit, Akhir) and the Excel export. Default window is the year so far (kept: a ledger is read over a year). |
| Record bar (First..Last, Search, Filter, Refresh, Go to, Format, Default, XLS, "n of 120") | n/a | **DROP** except XLS | Lists scroll and are searchable. XLS: Kartu hutang keeps its export; the other tabs have none yet (**later**). The reports have it. |

## 4. Laporan Pembelian (7Soft 4.6) — `/finance/reports/accounts-payable-summary`, door tab Suppliers › Laporan Pembelian

7Soft: a list "No / Laporan / Keterangan" of 33 reports; a row asks its parameters (a day, a window, a supplier, Jenis item) and prints. Hub: the same list, 7Soft's numbers, names and Keterangan, as a table with the Keterangan chips; a row of Finance's opens the report in a sheet with the boxes 7Soft asks and an Excel export (7Soft's Print / XLS). A row that is Procurement's opens that screen. The reports 7Soft lists but the hub cannot draw are not in the list (see "Not listed").

The page replaces the ERPNext Accounts Payable Summary that stood at this address; the same ageing with its bar is Due dates › Aging (Group By Supplier) and is also report 32 here.

| No | 7Soft report | Status | Decision / where |
| ---: | --- | --- | --- |
| 1 | Laporan Harian Detail Pembelian Item | item level | Not listed: no item-level purchase book in Finance. |
| 2 | Laporan Pembelian Bulanan | **Done** | per supplier: invoices, PPN, total; window; Jenis Stok (merchandise) / Jasa (expense). |
| 3 | Summary Pembelian | **Done** | per bill: Tanggal, No faktur, Supplier, Gudang, Status (New / Part paid / Lunas), JTempo, PPN, Total; window, supplier, Jenis. |
| 4 | Rekap Detail Faktur Pembelian | item level | Not listed: lines are per-bill reads (`bills/{id}/lines`), no bulk endpoint. |
| 5 | Laporan Barang Datang (Nilai) | **Procurement** | Operations › Receiving PO (`/operations/intake`). |
| 6-9 | Harian / Bulanan Pembelian Item Detail Supplier, Per Supplier Detail Item | item level | Not listed. |
| 10 | Laporan Daftar Harga | **Procurement** | Catalogue (`/procurement/catalogue`). |
| 11 | Laporan History Harga Pembelian | **Procurement** | Price Amendments (`/procurement/amendments`). |
| 12 | Summary Pembelian PPN | **Done** | bills with PPN: DPP, PPN, Total. |
| 13 | Laporan Summary Uang Muka Pembelian | **missing** | Only advances with money still in them can be read (`GET /supplier-advances`); a fully applied advance and the bills that took it cannot. See 15. |
| 14, 16 | Laporan Detail (Outstanding) Uang Muka Pembelian | item level | Not listed. |
| 15 | Laporan Summary Outstanding Uang Muka Pembelian | **Done** | advance, Tanggal, Supplier, No PO, No reff, Total, Uang muka diapply, Sisa. |
| 17, 18, 21 | Laporan Summary PO, Detail PO, Realisasi PO | **Procurement** | Purchase Orders (`/procurement/orders`). |
| 19, 20 | Perbandingan PO Outstanding dengan stok, PO Outstanding | **Procurement** | Outstanding (`/procurement/outstanding`). |
| 22 | Laporan Summary Retur Pembelian | **Done** | credit notes of the window with Status (New / Lunas). |
| 23 | Laporan Detail Retur Pembelian | **Procurement** | Return PO (`/procurement/returns`) holds the lines. |
| 24 | Laporan Detail Pelunasan Nota Pembelian | **Done** | per bill per payment: No faktur, No voucher, Tanggal, Kas/Bank, Supplier, Nilai faktur, Potongan, Bayar. |
| 25 | Hutang Jatuh Tempo | **Done** | bills and deliveries due on or before the day, as at that day (ledger wound back), with days late. |
| 26 | Summary Hutang Dagang | **Done** | Saldo awal, Debet, Kredit, Saldo akhir per supplier, window. |
| 27 | Summary Hutang Dagang Per Tanggal | **Done** | per day: Pembelian kredit, Pelunasan, Saldo akhir. 7Soft's "Pembelian tunai" column is not drawn: a purchase here is always a payable first. |
| 28 | Kartu Hutang | **Done** | one supplier's ledger over the window (same figures as the Info tab). |
| 29 | Sisa Hutang Dagang | **Done** | per supplier, as at the day (the server's ageing). |
| 30 | Umur Hutang Dagang Per Supplier Per Faktur | **Done** | per bill/delivery with its age band. |
| 31 | Sisa Hutang Dagang per Supplier | **Done** | open items per supplier: Total, Bayar, Sisa. |
| 32 | Umur Hutang | **Done** | per supplier with the five age bands. |
| 33 | List Supplier | **Done** | the supplier book. |

Why 25 and 29-32 read the ledger: "as at 15 Oct" must un-count payments made since, which only the payment ledger (`/payment-ledger`, `/payables-aging`) can; the bill list has no as-of date.

## 5. What the hub does better than 7Soft (said, as the rule asks)

- Status for a bill that is recorded but not in the books (Draft, Matched) and a hold: 7Soft cannot say it. Kept.
- Ledger-derived figures: Summary and Kartu Hutang and the as-of reports come from the books (payment ledger), not from re-adding documents, so they cannot drift from the balance.
- A from-to box instead of Periode + Sampai tanggal + All; Jenis radio chips instead of ticks; a row opens its record instead of a record bar.
- A return's refund is a dated second act with its own bank line (7Soft: a negative BKK).

## 6. Touched outside my files, and not done

- `nav.ts`: the two views of the Suppliers tab now read **Info Pembelian** (first, the landing) and **Laporan Pembelian**; they were "Summary" and "Ledger". Paths unchanged, so no route is added or removed. Re-read just before editing.
- `overview.tsx` links its payables card to `/finance/reports/accounts-payable-summary`, which is now the report list (the figure is report 32 and Due dates › Aging). Left to its owner.
- Not done: Print of a bill or return; Excel on the Info tabs 1-4 (the reports and Kartu have it); a credit note deep link (`?creditnote=`: no sheet key exists, so the Info tab opens it in place); Satuan on Detail lines; BLI/RBL auto-numbering; No Cek/BG on Pelunasan; Lokasi / Fax / Limit hutang on the supplier list.
