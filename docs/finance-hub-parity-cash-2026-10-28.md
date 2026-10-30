# Hub parity: Info Kas Bank, BKM / BKK, Pencairan BG

**Date:** 28 Oct 2026
**Rule (owner):** the information in a menu is the same as in 7Soft; deviate only where the hub's way is certainly better, and say so. Hub extras (Bank, Advances, the Giro board) stay.
**Sources:** manual hal. 174-199 (PDF 180-199) and its screenshots, `finance-7soft/scr7-cash.js`, `data-coverage.js`, plan 2026-10-27 §0-§4, §6-§8.
**Hub files:** `frontend-hub/src/screens/finance/` `cash-info.tsx` (new), `cash-documents.tsx`, `giro-board.tsx`, `giro-list.tsx` (new), `giro-words.ts` (new); `src/lib/queries/cash-documents.ts`.
**Not verified in a browser** (no login). Read and linted (`prettier`, `eslint`); Vite serves every touched module with 200.

Legend: **Done** = built in this change. **Later** = KEEP, not built. **Drop** = 7Soft technical leftover.

---

## 1. Info Kas Bank (7Soft 6.1)

7Soft: four tabs KAS/BANK, KARTU KAS/BANK, BKM, BKK, over a record bar (First/Prior/Next/Last, Search, Filter, Refresh, Go to, Format, Default, XLS, "n of 16") and the account box ("500 Kas Kecil").

| Element | In the hub before | Decision | Now |
| --- | --- | --- | --- |
| Tab KAS/BANK | missing | KEEP | **Done** `KasBank` (cash-info.tsx) |
| Periode + Sampai tanggal | missing | IMPROVE | **Done** one from-to box (`DayRange`) opening on the month in work. Better than two pickers: any start, any end, one control. |
| Location | missing | KEEP | **Done** Unit select |
| Columns Kode acc, Nama kas/bank, Saldo awal, Debet, Kredit, Saldo akhir | missing | KEEP | **Done**, plus Unit (the hub keeps several units' books) |
| Account list = every account of type Kas/Bank | missing | KEEP | **Done** from `GET /money`: every mapped cash, bank, giro and card-receivable account per unit. Not the full chart: an account nobody mapped is absent. |
| Figures | missing | KEEP | **Done** ledger window of each account (`/accounts/{code}/ledger`): opening, debit, credit, closing. Nothing summed in the browser. |
| Kode Acc / Nama Bank / Saldo / Periode / Keterangan / Aktif (manual text) | missing | Later | Keterangan and Aktif are account setup, not this screen |
| Row opens the account | n/a | IMPROVE | **Done** a row opens the account's card in a sheet |
| Tab KARTU KAS/BANK | missing | KEEP | **Done** `KartuKasBank` |
| Kas/Bank picker, Periode, Sampai tanggal | missing | KEEP | **Done** account select + the from-to box |
| Columns Tanggal, No transaksi, Tipe, Nama client, Debet, Kredit, Saldo | missing | KEEP | **Done**. No transaksi shows the BKM/BKK number when the row is a cash document, else the journal entry number. Tipe reads "BKM (Bukti Kas/Bank Masuk)" / "BKK (Bukti Kas/Bank Keluar)", else the hub's own word. Nama client is the supplier or the document's party. |
| SALDO AWAL row | missing | KEEP | **Done** first line over the movements |
| Footer AWAL / DEBET / KREDIT / AKHIR | missing | IMPROVE | **Done** as the four figures at the top (hub page anatomy: figures lead the list), same words |
| Row opens its record | n/a | IMPROVE | **Done** a cash-document row opens the BKM/BKK page; any other row opens the journal entry |
| Tab BKM | page "BKM" existed | KEEP | **Done** columns and filters, see §2 |
| Tab BKK | page "BKK" existed | KEEP | **Done**, see §2 |
| First / Prior / Next / Last, "n of 16", Go to | n/a | **Drop** | 7Soft paging by record. The hub lists scroll with the page and open their record. |
| Refresh | n/a | **Drop** | Hub tables read again every 10 s. |
| Format, Default | n/a | **Drop** | DBF grid leftovers. |
| XLS | missing | KEEP | **Done** Export CSV on Kas/Bank and on the BKM/BKK lists. Not on Kartu. |
| Search, Filter | missing | Later | A search box on the lists; none of 7Soft's filter dialogs. |
| Hub-only tabs Giro, Bank, Advances | present | keep | stay, after 7Soft's four |

**Registry change I could not make** (`index.ts`, `nav.ts` are the other session's): the two new screens are exported but not routed.

```ts
// index.ts
"/finance/cash-bank/kas-bank": lazyScreen("finance/cash-info", () => import("@/screens/finance/cash-info"), (m) => m.KasBank),
"/finance/cash-bank/kartu": lazyScreen("finance/cash-info", () => import("@/screens/finance/cash-info"), (m) => m.KartuKasBank),
// nav.ts, door "Cash & Bank" -> "Info Kas Bank", tabs in this order:
one("Kas/Bank", "/finance/cash-bank/kas-bank"),
one("Kartu Kas/Bank", "/finance/cash-bank/kartu"),
one("BKM", "/finance/cash-bank/bkm"),
one("BKK", "/finance/cash-bank/bkk"),
one("Giro", "/finance/cash-bank/giro"),
{ label: "Bank", views: [...] },
one("Advances", "/finance/receivables/employee"),
// home: "/finance/cash-bank/kas-bank"; SEVEN_SOFT_MENU / SEVEN_SOFT_GROUP key "/finance/cash-bank/kas-bank"
```

---

## 2. BKM and BKK lists (tabs 3 and 4 of Info Kas Bank)

| 7Soft column | Hub before | Now |
| --- | --- | --- |
| Tanggal | Date | **Done** Tanggal |
| No BKM / No BKK | Number | **Done** No BKM / No BKK |
| Kas/Bank (BKM) · Nama Kas/Bank (BKK) | Cash / bank | **Done** same words as 7Soft |
| Kode client | missing | **Done** supplier code; empty for a free-text customer |
| Nama client | Customer / Supplier | **Done** |
| No Cek/Giro/Card | missing | **Done** the giro number |
| Total | Amount | **Done**; a BKK puts Total before the cheque number, a BKM after (each as its 7Soft screen does) |
| Keterangan | missing | **Done** memo |
| Periode | missing | **Done** month of the date ("Oct 2026"; 7Soft prints 200710) |
| "+" row expander (the voucher's lines) | missing | Drop: the row opens the document page, which has the lines |
| Tick "Kas/Bank" (only the chosen account) | missing | **Done** a Kas/Bank select, "All Kas/Bank" first. Better than a tick tied to a record bar the hub does not have. |
| Tick "All" + two dates | missing | **Done** one Tanggal range box; open ends show everything |
| Button "BKM Baru" / "BKK Baru" | "New BKM" / "New BKK" | kept as the hub's primary at the page head |
| Status (Draft, Approved, Posted, Reversed) | present | keep: the hub numbers on approval and posts as a second step. 7Soft hides this (plan §4.3); the books need it. |
| Unit | present | keep |

Also fixed: `listCashDocuments` sent `unit`; the server reads `unit_id`, so the register's Unit box narrowed nothing. It now sends `unit_id`.

Limit: the register reads 300 documents per kind; the date range and the Kas/Bank select narrow those 300 in the browser. The endpoint takes no dates. A longer range than 300 documents needs a server filter.

---

## 3. BKM / BKK document (7Soft 6.2, 6.3)

Header, tabs and grids exist in the Klasik form the owner picked (29 Sep), in English words. Words were not renamed: the owner's 29 Sep / 6 Oct rulings put the hub's labels in English with 7Soft's behaviour. Behaviour is checked against the manual:

| 7Soft element | Hub | Decision |
| --- | --- | --- |
| No Voucher (manual or automatic) | "Voucher no", disabled; the number is taken on Approve | KEEP as is; a typed number conflicts with numbering on approval |
| Tanggal | Date | present |
| Kas/Bank | Cash / bank (+ Unit) | present |
| No Ref | Reference | present |
| Keterangan | Note (required, printed on the slip) | present |
| Customer (BKM) / Supplier (BKK) | Customer (free text) / Supplier picker, optional | present |
| No Cek/Giro, Tgl Jatuh Tempo | Giro no, Due (when Paid by = Giro) | present; 7Soft picks giro through the Kas/Bank, the hub through Paid by |
| Check/Card dari Bank (BKM) | Drawn on | present |
| Total | Total box, with the amount in words | present (words are a hub extra) |
| Tolakan | "Replace a bounced giro", disabled, "From the Giro board" | present; the replacement is done on the Giro board (Replace). KEEP |
| Browse Nota | "Browse open bills" (BKK with a supplier) | present. A BKM has no customer invoices to browse (no debtor book, plan §4.1). |
| Del All | missing | **Done** "Del all" clears the tab in view |
| Tab Detail / Pelunasan (Piutang or Hutang) | Settle bills / Settle invoices | present |
| Tab Lain-lain | Other lines | present |
| Tab Hutang (BKM) / Piutang (BKK) | Offset payables / Offset receivables | present for BKK (supplier advances); BKM offset reads "no open invoices" |
| Grid No Faktur, J. Tempo, Hutang/Piutang, Reff No, Keterangan, Potongan, Terima/Bayar, Lunas | Bill, Due, Payable, Ref, Note, Discount, Paid/Received, In full | present, per-row note and discount included |
| Lain-lain Kode Account, Nama Account, Keterangan, Jumlah | Account (with category), Note, Amount | present |
| First/Prior/Next/Last, record "n of m", New, Del, Save, Undo, View, Print, Info | Back, Save draft, Approve, Post, Reverse, Print slip, Repeat | The lifecycle replaces them. Print kept. Drop the record bar. |
| Status box NEW / READ ONLY | Draft / Approved / Posted / Reversed pill | present |
| Whole-voucher delete | Reverse (a posted document is never edited) | hub's way is better: the original stays as posted |

Left alone on purpose: renaming the form's English labels to 7Soft's Indonesian ones. That is the owner's call; say the word and it is a find-and-replace.

---

## 4. Pencairan BG (7Soft 6.4 Masuk, 6.5 Keluar)

Hub before: one Giro Board for issued giros (OUT), four lanes (Waiting, Due within 7 days, Cleared, Bounced), moves by drag or tap, forms on the card, a disabled "Opening giro" button.

| 7Soft element | Hub before | Decision | Now |
| --- | --- | --- | --- |
| Two menus Masuk and Keluar | OUT only (owner 1 Oct) | KEEP | **Done** a select "Pencairan BG Keluar / Masuk" in the list and Saldo Awal; opens on Keluar. The board stays OUT only. |
| Tab List BG | the board | KEEP | **Done** `List BG`, the default view; the board is a second view ("Board") |
| Radios ALL, J.TEMPO, NEW, CAIR, TOLAK | "Late only" | KEEP | **Done** as the status tabs, with counts (hub rule: a status is a tab with counts). J.Tempo = New and due date reached. |
| Statuses NEW, CAIR, TOLAKAN, DELETE | Waiting / Due / Cleared / Bounced | KEEP | **Done** adapter `giroStatusWord`: ISSUED, DELIVERED, DUE = New; CLEARED = Cair; REJECTED = Tolakan; VOIDED = Delete |
| Column No BG | number | KEEP | **Done** |
| Customer / Supplier | party | KEEP | **Done** |
| No BKM / No BKK | missing on the board | KEEP | **Done** the cash document or payment number |
| Bank (issuer's bank, BG masuk) | missing | Later | `GiroRow` carries one bank (ours); the cheque's drawing bank is on the cash document only |
| Total | amount | KEEP | **Done** |
| Tanggal Buat, Jatuh Tempo, Cair, Tolak | partly (due, cleared, bounced as text on the card) | KEEP | **Done** four columns |
| Bank Tujuan | bank | KEEP | **Done** |
| Periode | missing | KEEP | **Done** month of the clearing |
| Keterangan | the reason, on a bounced card | KEEP | **Done** bounce or void reason |
| Status | lane | KEEP | **Done** |
| TANDA tick | missing | KEEP | **Done** press a row to tick it |
| CLOSED mark "C" | missing | KEEP | **Done** the clearing month is closed |
| Button Cair | Clear on a card | KEEP | **Done** on the ticked New giros; asks the day; Bank tujuan is the giro's own |
| Button Tolak, only from Cair | "Bounce" from any open giro or a cleared one | KEEP | **Done** list and board: Tolak only from Cair; asks the day and the reason |
| Button Batal Cair, blocked once closed | "Undo clearing", any cleared giro | KEEP | **Done** blocked when the clearing's month is closed, with the sentence on screen. The server alone would take it back in the open month; 7Soft's stricter rule is kept. |
| Button Checked | missing | KEEP | the tick itself, and a "n Checked" count |
| Several giros at once | one card at a time | IMPROVE | **Done** the buttons act on every ticked giro, one after another; the first refusal stops the rest |
| Tab Saldo Awal: No BG, Giro, Total, Tanggal Buat, Jatuh Tempo, Keterangan, Status | disabled "Opening giro" | KEEP | **Done** read-only table: giros still New that were written before the earliest period. **Cannot be keyed in:** no endpoint takes an opening giro (`/opening/*` has balances, stock, subledger only). The dead button is removed. |
| Toolbar First/Prior/Next/Last, Format, Default, Save, Undo, Info, View | n/a | **Drop** | |
| Search, Filter, Print, "n of 791" | partly (bank, unit) | Later | Print of the list; the bank and unit selects stay |
| Giro board, Replace, Late only | present | keep | **Kept** as the Board view |

---

## 5. What was not done and why

- **Routes and tabs for Kas/Bank and Kartu Kas/Bank** (snippet in §1): the registry files are not mine to edit this round.
- **Saldo Awal entry:** no endpoint.
- **Bank (issuer) column on Pencairan BG Masuk:** not on `GiroRow`.
- **BKM/BKK date range beyond 300 documents:** needs a server filter.
- **7Soft Indonesian words in the document form:** not renamed (see §3).
- **Search and print** on the new lists.
