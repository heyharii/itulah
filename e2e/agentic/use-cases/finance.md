# Finance (hub) — use-case catalogue

Map: `maps/finance.md` · tests: `hub/finance/*.e2e.ts` · helpers: `support/finance.ts`, `support/finance-routes.ts` · rig `agentic`, run on the VM
(`./remote.sh --config hub.config.ts --output .e2e/out/finance hub/finance`, ~7–10 min when the VM is quiet).

**Result of the last full run (10 Oct 2026): 142 tests — 137 pass (+ the General Ledger test fixed afterwards, re-run green: 139), 3 red on real bugs (tag `bug`), 1 skipped (needs a rig fixture), 0 failures of the tests themselves.**

How every test proves itself: the document is created (API) or keyed (UI), the books are then read back through the cloud API — a journal entry's lines balance
(debit = credit), the bank account (`bank_giro` / DANAMON, ledger 1009, giro liability 2009 — nobody else's) moves by exactly the amount, the supplier's payable by the bill.
Own suppliers (`Finance e2e <purpose>`, created once), own accounts (`19NN`), run-unique tags. Nothing is closed, sealed, opened or remapped; Card/EDC settlement is
refused by design and Hari said to ignore it, so it is not tested.

## Bugs (red on purpose — the tests assert the right behaviour)

| # | Bug | Test | Evidence |
|---|---|---|---|
| B1 | **Record bill sheet files the bill under the supplier's register uuid, not its code.** The payable credit lands on a party `b0a959fb-…`; `GET /bills?supplier=<code>` does not list it; the BKK Settle tab and payables ageing cannot see it. | FIN-65 bills › "a bill keyed in the sheet is filed under the supplier's code…" | assertion: `expected "b0a959fb-09fe-4c09-8376-90e20af81e5d" to be "0022"` (supplier_id of the bill the sheet recorded) |
| B2 | **Purchase Invoice › Unbilled deliveries is cut at the oldest 200.** The screen calls the plain `GET /finance/unbilled` (200 cap) and says the list is whole; the banner exposure sums only those. | FIN-63 bills › "Unbilled deliveries counts every unbilled delivery…" | `the tab says 200 unbilled deliveries; the register holds 323` (paged API: `total 323`, `total_minor 195 300 000`) |
| B3 | **BKK/BKM Settle tab reads only the newest 200 bills of all suppliers** (`cash-documents.tsx:1680 listBills({})`, then filters by supplier client-side). Past 200 bills a supplier's older bills are not offered ("nothing open to settle") and "Rp N open" undercounts. | FIN-52 bkk › "the Settle tab lists every open bill of the supplier however many bills the book holds…" | register holds 306+ bills; a posted bill `INV-000-…` of the supplier is absent from the form (checkbox `Settle INV-000-…` not found) |

Observed but not asserted (details in `maps/finance.md` §11c): the "Paid by" segmented control is announced "Paid by Transfer Giro" for its first button; a warehouse user sees the Finance
page chrome (incl. **Record bill**) above the no-access sentence; hub "today" (Jakarta) vs cloud "today" (UTC) disagree 00:00–07:00 Jakarta ("Run 1 due now" counts what the server's
sweep skips); touch taps on the Giro Board's small inline buttons send no request under phone emulation (Enter does); approving a BKM in a month with no period consumes a voucher
number that can never be posted; a posted credit note lowers the supplier ledger but not the bill/ageing (by design).

## Blocked / needs a fixture

* FIN-78 *Settles return* (credit note settling a supplier return that is owed): the test is written and skips — the rig has no supplier return with an amount owed (needs HO return stock; the Return PO suite does not leave one).

## Branches with no behaviour test (and why)

| Branch | Why |
|---|---|
| Card & EDC Settlement (`/finance/receivables/card-settlement`) | refused by design — Hari: IGNORE; only the menu row exists |
| Accounting Period: Open a month / Seal / Undo closing, Period Close, Period Closing Voucher | the open month 2026-10 is shared by every suite; tests look (checklist, calendar) and prove the refusals, never change it |
| Sales Postings › Generate draft / post a day | would book other suites' till sales into the ledger; the posted day is read instead (cash → drawer, card/QRIS → Cash in Bank) |
| Chart: accounts other than the `19NN` ones created per run, Account Links / Posting Readiness edits, Posting Policies, Permissions | the chart and the map are what every posting leans on; read-only checks only |
| Payment Entry (hidden register), Employee Advances, Loans, Tax Payables / Types / Withholding, Assets (register, Contractor Projects, Asset Category, Disposals), Accruals, Prepaids, Inventory group (valuation, stock vs ledger, goods in transit, COGS, adjustments), Dimension Results, Deposits, Cash Transactions, Mode of Payment edits | the nav test proves each route opens its own screen (never the Placeholder) with its heading; their workflows are not exercised — nothing seeded to drive them |
| Bank statement reconciliation: split one bank line across vouchers ("Match several…"), fee shortfall | needs two vouchers per line; the paired/confirm, rule-proposal and book-by-hand branches are covered |

## Menu, routes, redirects, permissions

`hub/finance/nav.e2e.ts`

| ID | Branch | What the test proves | Status |
|---|---|---|---|
| FIN-01 | the Finance menu | the rail is a plain menu of ERPNext-style groups, in the owner's order, with Overview on top _(smoke)_ | pass |
| FIN-02 | the Finance menu | Stores: opening the group lists exactly its rail rows (the "more" and hidden rows are not in the rail) | pass |
| FIN-03 | the Finance menu | Inventory: opening the group lists exactly its rail rows (the "more" and hidden rows are not in the rail) | pass |
| FIN-04 | the Finance menu | Payables: opening the group lists exactly its rail rows (the "more" and hidden rows are not in the rail) | pass |
| FIN-05 | the Finance menu | Receivables: opening the group lists exactly its rail rows (the "more" and hidden rows are not in the rail) | pass |
| FIN-06 | the Finance menu | Payments: opening the group lists exactly its rail rows (the "more" and hidden rows are not in the rail) | pass |
| FIN-07 | the Finance menu | Banking: opening the group lists exactly its rail rows (the "more" and hidden rows are not in the rail) | pass |
| FIN-08 | the Finance menu | Financial Reports: opening the group lists exactly its rail rows (the "more" and hidden rows are not in the rail) | pass |
| FIN-09 | the Finance menu | Assets: opening the group lists exactly its rail rows (the "more" and hidden rows are not in the rail) | pass |
| FIN-10 | the Finance menu | Tax: opening the group lists exactly its rail rows (the "more" and hidden rows are not in the rail) | pass |
| FIN-11 | the Finance menu | Accounting Masters: opening the group lists exactly its rail rows (the "more" and hidden rows are not in the rail) | pass |
| FIN-12 | the Finance menu | Closing: opening the group lists exactly its rail rows (the "more" and hidden rows are not in the rail) | pass |
| FIN-13 | the Finance menu | clicking a rail row goes to its page: BKM → /finance/cash-bank/bkm | pass |
| FIN-14 | the Finance menu on a phone | a phone has the "Main" bottom bar (Home, the first rows, More) and no rail; every row of the department is reachable from More _(phone)_ | pass |
| FIN-15 | who may see Finance | warehouse staff (nina, OPERATIONS) are refused by the API and have no Finance in the menu | pass |
| FIN-16 | who may see Finance | typing a Finance address as warehouse staff shows no Finance data | pass |
| FIN-17 | moved modules redirect | /finance-final lands on a live screen | pass |
| FIN-18 | moved modules redirect | /finance-lab lands on a live screen | pass |
| FIN-19 | moved modules redirect | /finance-lab-2 lands on a live screen | pass |
| FIN-20 | moved modules redirect | /finance/bills lands on a live screen | pass |
| FIN-21 | moved modules redirect | /finance/journal lands on a live screen | pass |
| FIN-22 | moved modules redirect | /finance/accounts lands on a live screen | pass |
| FIN-23 | moved modules redirect | /finance/periods lands on a live screen | pass |
| FIN-24 | moved modules redirect | /finance/reports lands on a live screen | pass |
| FIN-25 | moved modules redirect | /finance/payroll/runs lands on a live screen | pass |
| FIN-26 | every routed Finance screen opens on its own page | Overview: each path draws its heading, never the Placeholder | pass |
| FIN-27 | every routed Finance screen opens on its own page | Stores: each path draws its heading, never the Placeholder | pass |
| FIN-28 | every routed Finance screen opens on its own page | Inventory: each path draws its heading, never the Placeholder | pass |
| FIN-29 | every routed Finance screen opens on its own page | Payables: each path draws its heading, never the Placeholder | pass |
| FIN-30 | every routed Finance screen opens on its own page | Receivables: each path draws its heading, never the Placeholder | pass |
| FIN-31 | every routed Finance screen opens on its own page | Payments: each path draws its heading, never the Placeholder | pass |
| FIN-32 | every routed Finance screen opens on its own page | Banking: each path draws its heading, never the Placeholder | pass |
| FIN-33 | every routed Finance screen opens on its own page | Financial Reports: each path draws its heading, never the Placeholder | pass |
| FIN-34 | every routed Finance screen opens on its own page | Assets: each path draws its heading, never the Placeholder | pass |
| FIN-35 | every routed Finance screen opens on its own page | Tax: each path draws its heading, never the Placeholder | pass |
| FIN-36 | every routed Finance screen opens on its own page | Accounting Masters: each path draws its heading, never the Placeholder | pass |
| FIN-37 | every routed Finance screen opens on its own page | Closing: each path draws its heading, never the Placeholder | pass |
| FIN-38 | every routed Finance screen opens on its own page | the document pages of BKK / BKM answer by id: an unknown id is said, not a blank page | pass |

## BKM — 7Soft Bukti Kas Masuk (money in)

`hub/finance/bkm.e2e.ts`

| ID | Branch | What the test proves | Status |
|---|---|---|---|
| FIN-39 | BKM register and form | the register lists BKM with its status filter and the New BKM button _(smoke)_ | pass |
| FIN-40 | BKM register and form | New BKM opens the Klasik form: header, three tabs, total box | pass |
| FIN-41 | BKM register and form | Save draft on an empty form lists every missing answer in one banner | pass |
| FIN-42 | BKM register and form | Paid by Giro asks for the giro number, the due date and the bank it is drawn on | pass |
| FIN-43 | BKM register and form | the Settle invoices tab explains that a BKM has nothing to settle | pass |
| FIN-44 | BKM on a phone | the register is a list of cards (party, amount, date, status) with the round New BKM button; a card opens the document _(phone)_ | pass |
| FIN-45 | BKM life | key it in the form, approve it, post it: numbered KM-, one balanced entry, the bank rises by exactly the amount _(smoke)_ | pass |
| FIN-46 | BKM life | reverse a posted BKM: a mirror entry, the document is Reversed, the bank is back where it was | pass |
| FIN-47 | BKM life | a BKM dated in a month with no accounting period cannot be posted: the refusal is read on the page | pass |
| FIN-48 | BKM life | the register filters by status | pass |

## BKK — 7Soft Bukti Kas Keluar (money out)

`hub/finance/bkk.e2e.ts`

| ID | Branch | What the test proves | Status |
|---|---|---|---|
| FIN-49 | BKK form | the register lists BKK; the form shows Settle bills / Other lines / Offset receivables and the supplier's open total _(smoke)_ | pass |
| FIN-50 | BKK form | over-settling is refused as it is typed and again when Save draft is pressed | pass |
| FIN-51 | BKK form | "In full" fills the whole outstanding amount | pass |
| FIN-52 | BKK Settle list at scale | the Settle tab lists every open bill of the supplier however many bills the book holds (the form reads only the newest 200 bills of all suppliers) _(bug)_ | **RED — bug** (line 68) |
| FIN-53 | BKK posts | settle a bill in full from the form: approved, posted, bill paid, supplier owed nothing, bank down by exactly the amount _(smoke)_ | pass |
| FIN-54 | BKK posts | a part payment with a discount (POTONGAN): cash out is paid minus discount, the bill keeps the rest | pass |
| FIN-55 | BKK posts | an Other line on a BKK books a cost against the bank (no bill to settle) | pass |
| FIN-56 | BKK posts | reversing a posted BKK reopens the bill and returns the money to the bank | pass |
| FIN-57 | BKK posts | a giro BKK does not touch the bank yet: it sits on the Giro Board and the "outstanding giro" account carries it | pass |
| FIN-58 | BKK Offset tab | an advance paid on a PO is netted off the bill it belongs to: the bank pays only the difference, the advance is used up and the bill is closed | pass |
| FIN-59 | BKK Offset tab | a supplier with no advance says so on the Offset tab | pass |

## Purchase Invoice — supplier bills, matched to deliveries

`hub/finance/bills.e2e.ts`

| ID | Branch | What the test proves | Status |
|---|---|---|---|
| FIN-60 | Purchase Invoice list | it opens on Merchandise with the four tabs, the search box, Record bill and a Unit filter _(smoke)_ | pass |
| FIN-61 | Purchase Invoice list | a posted merchandise bill shows its invoice number, supplier, Total and Outstanding; search finds it by number and by supplier | pass |
| FIN-62 | Purchase Invoice list | Unbilled deliveries lists the deliveries nobody has billed, oldest first, under the banner that explains the exposure | pass |
| FIN-63 | Purchase Invoice list | Unbilled deliveries counts every unbilled delivery and the banner carries the whole exposure — not just the oldest 200 _(bug)_ | **RED — bug** (line 45) |
| FIN-64 | recording a bill | the Record bill sheet takes a merchandise bill: submitted as a DRAFT with the typed figures | pass |
| FIN-65 | recording a bill | a bill keyed in the sheet is filed under the supplier's code, like every other bill (BKK Settle, Credit Note and the ageing find bills by that code) _(bug)_ | **RED — bug** (line 84) |
| FIN-66 | recording a bill | an expense bill must say what it was for: the lines have to add up to the subtotal | pass |
| FIN-67 | recording a bill | an invoice number is required and the subtotal must be a number | pass |
| FIN-68 | the bill sheet | Post to the books: Dr payable / Cr inventory... the entry balances and the bill becomes Posted _(smoke)_ | pass |
| FIN-69 | the bill sheet | a held bill cannot be posted until it is released | pass |
| FIN-70 | the bill sheet | "Check before posting" runs the six checks and says so when there is nothing to warn about | pass |
| FIN-71 | the bill sheet | the sheet reads like the bill: totals ladder, Paid and Outstanding after a part payment | pass |
| FIN-72 | a bill matched to a delivery | naming the delivery on the bill takes it off the unbilled list, and posting the bill replaces the delivery's payable instead of doubling it | pass |

## Credit Note (incl. "Settles return")

`hub/finance/credit-notes.e2e.ts`

| ID | Branch | What the test proves | Status |
|---|---|---|---|
| FIN-73 | Credit Note list and form | the register shows a credit note with its number, supplier, invoice, reason, total and status; Status filter narrows it _(smoke)_ | pass |
| FIN-74 | Credit Note list and form | New credit note: the invoice list is that supplier's posted bills; Submit waits for an invoice and an amount | pass |
| FIN-75 | Credit Note life | record one in the form, post it: Dr supplier payable / Cr inventory, the supplier ledger falls by the credit, the bill itself is untouched _(smoke)_ | pass |
| FIN-76 | Credit Note life | Record refund: the supplier sent the money — the bank rises by the credit and the note reads Refunded | pass |
| FIN-77 | Credit Note life | a credit note cannot exceed what the bill is worth | pass |
| FIN-78 | Settles return | a credit note can settle a supplier return that is still owed: the return is credited by the note total | skip |

## Journal Entry

`hub/finance/journal.e2e.ts`

| ID | Branch | What the test proves | Status |
|---|---|---|---|
| FIN-79 | Journal Entry register | it lists entries with Entry · Posted · Source · Memo · Answered · Lines · Total, filters by type and finds a memo by search _(smoke)_ | pass |
| FIN-80 | Journal Entry register | opening an entry shows its lines and the balanced totals | pass |
| FIN-81 | writing an entry by hand | two balanced rows post as JV-…: the footer says "Balanced at Rp N", the books move by exactly the amount _(smoke)_ | pass |
| FIN-82 | writing an entry by hand | an unbalanced entry cannot be posted: the footer shows both sides and Post entry stays disabled | pass |
| FIN-83 | writing an entry by hand | the books refuse what the form cannot see: a heading account, a month with no period, a one-sided entry | pass |
| FIN-84 | reversing an entry | Reverse posts a mirror, marks the original Reversed and returns both balances | pass |
| FIN-85 | reversing an entry | an entry that was already reversed cannot be reversed twice | pass |

## Recurring Journal · Recurring Bills · repeating BKK/BKM

`hub/finance/recurring.e2e.ts`

| ID | Branch | What the test proves | Status |
|---|---|---|---|
| FIN-86 | Recurring Journal | a template with a schedule shows its schedule and last run; "Run due now" raises it, posts it balanced, and moves the date on a month _(smoke)_ | pass |
| FIN-87 | Recurring Journal | "Add a schedule" on a template: pick the template, a next date, Post it automatically — the repeat is saved | pass |
| FIN-88 | Recurring Journal | a repeat that is not due is left alone by "Run due now" | pass |
| FIN-89 | Recurring Bills | New recurring bill: label, supplier, unit, expense account, day of the month and the expected amount — it is listed and then retired | pass |
| FIN-90 | repeating BKK / BKM | a posted BKM made of Other lines can be repeated: Repeat… saves it with its frequency and next date | pass |
| FIN-91 | repeating BKK / BKM | "Raise due now" drafts the BKM of a repeat that is due, and says it still needs approving and posting | pass |

## Banking — bank account, statements, reconciliation, bank rules, summary

`hub/finance/banking.e2e.ts`

| ID | Branch | What the test proves | Status |
|---|---|---|---|
| FIN-92 | Bank Account | our bank accounts are listed per unit with the bank and the number; the Danamon account of the e2e is described _(smoke)_ | pass |
| FIN-93 | Bank Transactions | Upload statement: account, unit, period, balances and pasted lines — the lines land Unreconciled | pass |
| FIN-94 | Bank Transactions | a row that cannot be read is reported and not counted; the Status filter separates reconciled from unreconciled lines | pass |
| FIN-95 | Bank Reconciliation | an exact pair is offered with its reasons; Confirm agrees it and the statement line reads Agreed _(smoke)_ | pass |
| FIN-96 | Bank Reconciliation | a rule's proposal turns a bank-only charge into a posted BKK: Dr bank charges / Cr bank, matched to the line | pass |
| FIN-97 | Bank Reconciliation | a bank-only line with no rule can be booked by hand: pick the account, say why, Create BKK | pass |
| FIN-98 | Bank Reconciliation | the list says what the bank and the books hold and the difference per account | pass |
| FIN-99 | Bank Rules | the seeded rules are listed lowest priority first with what they record as; Show retired is a switch | pass |
| FIN-100 | Bank Rules | New rule: Contains + text + category; the rule is saved, then Apply rules now proposes it on a matching bank line, then it is retired | pass |
| FIN-101 | Bank Rules | a rule needs text and a category before Submit is enabled; the priority takes a whole number only | pass |
| FIN-102 | Bank Reconciliation Summary | the report is the bank statement against the books: it lists the book-only postings and reaches a difference | pass |

## Giro Board

`hub/finance/giro.e2e.ts`

| ID | Branch | What the test proves | Status |
|---|---|---|---|
| FIN-103 | Giro Board | lanes Waiting / Due within 7 days / Cleared / Bounced; a giro lands in the lane its date says and shows its due tag _(smoke)_ | pass |
| FIN-104 | Giro Board | Late only keeps the giros past their date; the Bank filter narrows by bank | pass |
| FIN-105 | Giro Board | desk: dragging a giro to Cleared asks for the clearing date, then Clear Rp N posts it: Dr outstanding giro / Cr bank | pass |
| FIN-106 | Giro Board | phone: tap a giro, choose Bounced, give the date and the reason — the bill is open again | pass |
| FIN-107 | Giro Board | a cleared giro can be taken back (Undo clearing) with a reason, and the bank returns | pass |
| FIN-108 | Giro Board | the board is empty-safe: filtering to a bank with no giro shows the lanes with nothing in them | pass |

## Stores cash (cash on hand / petty / float / counts / sales by day) and where takings land

`hub/finance/stores-cash.e2e.ts`

| ID | Branch | What the test proves | Status |
|---|---|---|---|
| FIN-109 | Stores overview | every open shop shows its three boxes, equal to the ledger, with an "All shops · N" total row _(smoke)_ | pass |
| FIN-110 | Stores overview | the total row is the sum of the shops: it counts every open shop and adds their drawers | pass |
| FIN-111 | Cash on hand / Petty cash / Cashier float | Cash on hand of Cikupa: Balance now, In this month, Out this month and the ledger rows equal the API | pass |
| FIN-112 | Cash on hand / Petty cash / Cashier float | the ledger search narrows rows and says so when nothing matches; six month tabs | pass |
| FIN-113 | Cash on hand / Petty cash / Cashier float | choosing another shop in the rail changes the page to that shop and keeps the box | pass |
| FIN-114 | Cash on hand / Petty cash / Cashier float | Petty cash has Ledger · Spending by week · Approval codes; Cashier float is its own ledger | pass |
| FIN-115 | Sales by day and cash counts | Sales by day: pick a day on the rail — Sales / Returns / Cash expected in the drawer / Voided and the tender table equal the daily report | pass |
| FIN-116 | Sales by day and cash counts | Cash counts opens with its week rail and the counted-cash columns | pass |
| FIN-117 | where the takings land | a day's takings entry puts cash in the shop drawer and card/QRIS straight into Cash in Bank of head office — no card receivable | pass |
| FIN-118 | where the takings land | Sales Postings: choose a store and the posted day lists with its entry number; Deposits and Cash Transactions open | pass |

## Financial Reports

`hub/finance/reports.e2e.ts`

| ID | Branch | What the test proves | Status |
|---|---|---|---|
| FIN-119 | Trial Balance | it does not say "does not balance": debits = credits in the footing row and in the server's own totals _(smoke)_ | pass |
| FIN-120 | Trial Balance | an account row carries the ledger balance: the Danamon bank (only the e2e books on it) closes at the API's net | pass |
| FIN-121 | Trial Balance | Split by Unit adds a Unit column; the unit filter narrows the lines to that unit | pass |
| FIN-122 | General Ledger | an account's ledger lists the entry that moved it, with the entry number, memo and amount (an account of its own keeps the list short) | pass |
| FIN-123 | statements | Profit and Loss: a P&L account's row equals the API statement for the month | pass |
| FIN-124 | statements | Balance Sheet: the Danamon bank line is the ledger net, and assets equal liabilities plus equity | pass |
| FIN-125 | statements | Cash Flow: the direct-method statement explains the cash that moved (no out-of-balance) | pass |
| FIN-126 | statements | Profit and Loss by Unit: Net profit for Jan–Oct equals the API's P&L result; Balance Sheet 2 Years opens on its table | pass |
| FIN-127 | Jurnal-style reports | Statement of Changes in Equity: "Profit for the period" is the P&L result for the same window | pass |
| FIN-128 | Jurnal-style reports | Expenses by Month, Sales by Division and Cash open on their own screens with figures | pass |
| FIN-129 | Jurnal-style reports | Expenses by Month carries the month's cost on the account the e2e booked (6004) | pass |
| FIN-130 | Jurnal-style reports | Bank Reconciliation Summary, Tax Withholding Details and Dimension Results open | pass |
| FIN-131 | payables reports | Accounts Payable ageing: a supplier row carries what the API says the supplier is owed | pass |
| FIN-132 | payables reports | Supplier Ledger (hidden row) shows a supplier's movements with the running balance | pass |
| FIN-133 | payables reports | Payment Projection is one screen: a calendar and an itemised list of what falls due | pass |

## Accounting Masters — chart, periods, setup lists

`hub/finance/masters.e2e.ts`

| ID | Branch | What the test proves | Status |
|---|---|---|---|
| FIN-134 | Chart of Accounts | the chart opens as a tree with Chart / History tabs, the filters and New account; search finds an account by its code _(smoke)_ | pass |
| FIN-135 | Chart of Accounts | New account: code, name and a heading → it is in the chart (postable, under that heading), the chart history says so, and the same code is refused twice | pass |
| FIN-136 | Chart of Accounts | Deactivate: an inactive account takes no postings (the books refuse it), Reactivate takes them again, and an account that carries a balance cannot be retired | pass |
| FIN-137 | Chart of Accounts | History lists the chart changes, newest first | pass |
| FIN-138 | Accounting Period | the calendar shows the open month; its sheet carries the month-end checklist; this suite never seals it _(smoke)_ | pass |
| FIN-139 | Accounting Period | opening a month is a Month + Year pick whose button says "<month> is open" (disabled) while that month exists — nothing is opened here | pass |
| FIN-140 | Accounting Period | a posting into a month that was never opened is refused with the sentence that names the month | pass |
| FIN-141 | setup lists | Account Links lists the role → account links the posting rules read; Posting Readiness counts the roles with no account | pass |
| FIN-142 | setup lists | Mode of Payment, Tax Types, Expense Categories, Accounting Dimensions and Asset Category list what the API holds | pass |
