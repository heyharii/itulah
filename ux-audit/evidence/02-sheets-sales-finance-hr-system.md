# Record-sheet audit B: sales, members, stores, finance, HR, system, GA

Auditor B, 6 Oct 2026, ~14:00-14:40. Repo `/Users/hari/Documents/itulah/frontend-hub/src`. Read-only: only this file was written.

## 0. How to read this, and what I could not open

**Seen on screen** (hub dev server :5360, Rina, 1440x900 and 414x896): Employee sheet (all 10 tabs read on desk, Record tab on phone), Job role sheet (desk + phone), User sheet (desk + phone), Journal entry panel (desk + phone), Period sheet (desk + phone), Member sheet (desk), Shift sheet (desk), Store server (node) sheet (desk).
**Everything else is "from code".** I say so on every finding.

Why so little was opened:
- The rig has no rows for most of my area. API probes returned 0 for leave requests, overtime, swaps, claims, payroll runs, warning letters, change/hire proposals, F&F, supplier bills, payments, assets (finance and GA), giros, deposits, GA contracts / repairs / replacements / disposals / supplies / inspections, letters, devices, enrolments, invitations, sales and returns. Rows exist for: employees (5), users (6), journal (36 entries), periods (1), accounts (8), bank accounts (1), members (2), stores/units (13-14), exceptions (5), nodes (2), roles (16), notifications, discussions (3), chat (3), shifts (2), claim types (2), holiday calendar, leave types (3), pay components (16), benefit balances (5).
- Around 14:20 the browser session was signed out (`/api/v1/me/reach` -> 401, sign-in page). I did **not** sign in; it came back by itself about 20 minutes later (someone else re-authenticated the shared cookie), and I used that window for the Member, Shift, Node, Employee Pay/Leave and phone Job role / Period checks. Until then I could only read code.
- Before that, the browser was starved by the 6-connection-per-host limit (about 8 tabs, each with a notification SSE stream). The Employee > Leave tab sat on "Reading the ledger..." for minutes. I treat that as an environment artefact, not an app finding, but the loading bands in section 3 F24 are real in the code.
- The repo moved under me (HMR reloads; `finance-final/advances.tsx` changed from Indonesian "Batal / Cairkan" to English "Cancel / Pay out" between my two reads). Code evidence is a snapshot of about 14:00.
- `screens/finance-lab/*` (about 45 `<Sheet>` call sites) is not routed from any screen map. I did not census it. `finance/payments.tsx`, `finance/bank.tsx`, `finance/unmatched-charges.tsx`, `finance/journal.tsx` and `finance-lab-2/journal*.tsx` are also not routed (their sheets are dead).
- BKK/BKM (cash-documents) are 7Soft-literal Indonesian. Noted, not flagged.

Core files read: `components/ui/sheet.tsx` (Sheet, Facts, Fact), `record-panel.tsx`, `dialog.tsx` (Dialog, Panel, ConfirmButton, SavedDialog), `phone-drawer.tsx`, `picker-sheet.tsx`, `rows.tsx` (Section, KeyValue, TotalsLadder, MiniTable, SubHead), `pill.tsx`, `field.tsx`, `form.tsx` (Section), `button-style.ts`, `lib/sheets.ts`, `finance-final/parts.tsx` (Grid).

Numbers below come from a script over `<Sheet` call sites in my area (finance-lab excluded): **140 call sites; about 61 are record sheets (have `id`, `subject` or `Facts`)**, the rest are create/edit/task forms.

## 1. Census

Legend. Shell: **S** = `Sheet` (rail unless width noted), **P** = `Panel` (centred dialog, 52rem), **F** = `FactsSheet` (Sheet wrapper for table rows), **D** = Dialog/ConfirmButton. Head = mono id / title / caption / header badge. "Pill in body" means the status chip is a child of the body, not the `badge` prop. "Opened" = how the open state is held. Rows with `*` were seen on screen.

### 1.1 Sales, members, stores

| # | Sheet (component, file:line) | Shell, width | Head (id / title / caption / badge) | Body grammar | Actions, footer | Edit and confirm | Opened |
|---|---|---|---|---|---|---|---|
| 1 | SaleSheet `sales/sale-sheet.tsx:117` | S rail | sale_number / **store id** (`site_id`) / none / none (Lifecycle track in body; Pill only if VOIDED) | SubTabs in body when COMPLETED (Sale, Receipt, Pricing, Refund); Facts, **raw `h4`**, MiniTable with **raw `tr`/`td` (py-2)**, TotalsLadder | **Header:** Complete, Void (size sm) when OPEN. **Footer:** till composer (EPC input + Add; Segmented + Money + Take) | In place; Complete and Void fire at once (no confirm); Refund tab is a form with unlabelled Money/Input/Textarea and an in-body "Submit" | `?sale=`, subject sale |
| 2 | ShopSaleReceipt `sale-sheet.tsx:181` | S rail | `POS-<8 chars>` / store id or "Store sale" / none / none | Facts, SubHead, MiniTable with MiniRow, TotalsLadder, mono "Cloud sale ID" note | none | read-only | same `?sale=` (fallback on 404) |
| 3 | WindowSheet `sales/window-sheet.tsx:58` | S rail | **date span in the mono slot** / shop name / none / none | Facts, raw `h4`, MiniTable raw `tr`, TotalsLadder, LoadMore | none | read-only; rows open `sale` **over** this sheet | `?cell=`/`?store=` |
| 4 | MemberReceiptSheet `sales/customer.tsx:560` | S rail | customerId / store id / none / none | Facts, raw `h4`, MiniTable raw `tr` ("Shelf Price"), Tag "PROMOTION" (caps) | none | read-only | `?sale=` + `?member=` |
| 5 | Return `sales/returns.tsx:469` | S rail | id / `site_id` / none / none | Facts, MiniTable, KeyValue | none | read-only | `?refund=`, subject return |
| 6 | Sales breakdown sheet `sales/breakdown.tsx:654` | S rail | id only | per-grouping tables (a "Qty" column head exists in this file at 1496) | none | read-only | local state |
| 7 | MemberSheet `members/directory.tsx:806` * | S rail | member_id (card no.) / display name or "No name given" / none / none | Pill + explanatory sentence, **15 Facts in one grid** ("Card" repeats the mono id), IssueCode inline form, ghost AppLinks | none; IssueCode button in body | in place | local row; no `subject` |
| 8 | Enrol a card `members/counter.tsx:210` | S rail | id / "Enrol a card" | Field/Input | in body | in place | `?enrol=` |
| 9 | Segment form `members/segment-form.tsx:285` | S rail | none / "New segment" or "Edit segment" | MiniTable + Fields | footer Cancel / Submit (label is `editing ? "Submit" : "Submit"`) | create/edit | `?segmentEdit=` |
| 10 | Exception thresholds `stores/exceptions.tsx:243` | S rail | caption only | settings form | n/a | Admin only | `?exceptions-settings=` |
| 11 | Store exceptions (card, not a sheet) `stores/exceptions-shared.tsx` | n/a | n/a | card with Acknowledge | **D**: `ConfirmButton` | confirm dialog | filter keys only |
| 12 | Open stores `setup/open-stores-sheet.tsx:91` | S rail | caption | form then "Send these links" | footer Cancel / "Open N stores", then Done | create | `?new-stores=` |
| 13 | Company `setup/company-sheet.tsx:44` | S rail | caption | form | n/a | edit | `?company=` |

### 1.2 Finance (routed)

| # | Sheet | Shell, width | Head | Body grammar | Actions, footer | Edit and confirm | Opened |
|---|---|---|---|---|---|---|---|
| 14 | BillSheet `finance/supplier-bills.tsx:1470` | S rail | invoice_number / supplier name / none / **none: a row of up to 5 chips** (Status dot, kind Pill, GA, On hold, N days overdue) | Banner, SubHead + MiniTable (expense lines), Facts, TotalsLadder, "Paid by" MiniTable with `Status`, BillHandover (hold/release/return forms) | **Footer:** helper sentence left + "Post to the books" primary right. Hold/Return in body | in place; Post has no confirm | `?bill=`, subject bill |
| 15 | Record a supplier bill `supplier-bills.tsx:2251` | S rail | title only | Fields + KeyValue | footer Submit | create | local |
| 16 | JournalEntry panel `finance-final/journals.tsx:483` * | **P 52rem centred** | **no id** / entry number / `sub` = memo / none | 5 pills (Goods receipt, Posted by the system, Reversal, Reversed, Inter-unit), Facts (incl. raw "Source record" uuid), SubHead + **finance `Grid`** | none; **Reverse form at the bottom of the body** (label-less Textarea, Posting date, danger Reverse) | in place; no confirm | `?entry=` |
| 17 | New journal entry `journals.tsx:812` | P | title + `sub` sentence | composer | in body | create | local |
| 18 | Payment panel `finance-final/payments.tsx:482` | P | none / payment number / `sub` = "What left the bank, and which debts it answered." | Pill "Pay" + `Status` + Pill "Reserved...", Facts, SubHead, **Grid (6 cols)** | posting date + helper + "Post to the books" at body bottom | no confirm | `?payment=` |
| 19 | New payment `payments.tsx:914` | P | title + sub | composer | footer-like row in body | create | local |
| 20 | PeriodSheet `finance/periods.tsx:547` * | S rail | `2026-10` / October 2026 / none / none | Lifecycle, Facts (Status as a Fact), raw `h4` History as a plain `<ul>`, Checklist, long paragraph | **Footer:** lone danger "Close this month" (**left-aligned**) -> inline "Seal N entries?" Cancel / Seal. Undo closing = Textarea + Cancel / Undo closing in footer | inline two-step confirm | `?period=` |
| 21 | AccountSheet `finance/chart-of-accounts.tsx:562` | S rail | code / account name / none / none | breadcrumb path, Facts, raw `h4`, KeyValue, AccountChanges | **Header:** Edit, Deactivate (sm ghost) | edit form swaps in at the **top** of the body | `?account=`, subject account |
| 22 | New account `chart-of-accounts.tsx:911` | S rail | caption "Applies at once..." | Fields | Submit in body | create | local |
| 23 | AssetSheet (Finance) `finance/assets.tsx:1168` | S rail | id / name / none / none | Pill, Facts, SubHead, assess form | footer Submit | in place | `?asset=`, subject asset |
| 24 | Register an asset `finance/assets.tsx:2014` | S rail | title | Fields | footer Register | create | local |
| 25 | Asset register panel `finance/asset-register.tsx:442` | P | none / `"<no> · <name>"` / sub = category | read | n/a | n/a | local |
| 26 | Bank transaction `finance/bank-transactions.tsx:576` | S rail | title only | Facts only | none | read | local |
| 27 | Upload statement `bank-transactions.tsx:717` | S rail | title | Fields | footer Upload | create | local |
| 28 | Account link mapping `finance/account-links.tsx:565` | S rail | id / doc label / none | Pill, Problem | in body | edit | `?mapping=` |
| 29 | BKK/BKM slip `finance/cash-documents.tsx:1413` | P | none / slip number / sub "An Indonesian slip, ready to print." (7Soft-literal, not flagged) | print layout | n/a | n/a | local |
| 30 | Credit note `finance/credit-notes.tsx:381` | P | none / credit number / **sub = status component** | read + actions | in body | `ConfirmButton` | local |
| 31 | Accrual match, Recurring bill, Journal template, Bank rule, Contractor project (x4), Cash count, Bank account, Bank reconciliation (`finance/*`, `finance-lab-2/*`) | **P** | title + one-line `sub` sentence | forms and tables | in body | mixed | local |
| 32 | PaySheet (advances) `finance-final/advances.tsx:318` | S rail | none / "Pay out <no>" / none | Facts, 2 Fields | footer Cancel / Pay out | create | **local state** |
| 33 | Payroll RunSheet (Finance) `finance-final/payroll.tsx:312` | S rail | none / "Head Office · September 2026" | Facts (StatePill as a Fact), **Grid** | footer Cancel / Record payment (only when `canPay`) | create | **local state** |
| 34 | Payroll EntrySheet `finance-final/payroll.tsx:537` | S rail | none / entry number | Facts, **Grid**, `LoadingState` with no text | none | read | **local state** |
| 35 | FactsSheet users `finance/phone-parts.tsx:188` (cash, prepaids, prepaid-schedules, asset-disposals, dimension-results, sales-by-division, withholding-report, PhoneStatement) | S rail via `F` | id / title / caption | Facts built from a table row's columns | optional footer | read | local |
| 36 | Settings-type: permissions override `finance/permissions.tsx:175`, posting policies x2 `posting-policies.tsx:412,607`, period range close `period-closing.tsx:377` | S rail | title | forms | footer | edit | local |

### 1.3 HR (people)

| # | Sheet | Shell, width | Head | Body grammar | Actions, footer | Edit and confirm | Opened |
|---|---|---|---|---|---|---|---|
| 37 | EmployeeSheet `people/directory.tsx:842` * | S rail (760px at 1440) | employee_code / full name / none / **none (Pill row in body: status + up to 2 more)** | Pill row, Facts (4), **own `SheetTabs`**: Record, Leave, Claims, Contracts, Position, Checklist, Discipline, Pay, Loans, Change (+ Exit when TERMINATED); Employment Timeline, Postings MiniTable; **Activity disclosure at the bottom of every tab** | none; **each tab holds its own forms** (Leave: 2, Claims: 1, Position: 1, Discipline: 1, Pay: 4, Loans: 1, Change: 1 = 11 forms) with 11 different submit labels | in place | `?employee=` (+ `#tab`), subject employee |
| 38 | Add employee `people/add-employee.tsx:182` | S rail | title | SubHead sections, Fields | **footer on phone only** (Import & export / Add employee); on desk a button at the end of the body | create | `?addEmployee=` |
| 39 | Import & export `people/import-export.tsx:94` | S rail | id / title | SubHead, MiniTable, buttons | in body | in place | `?importExport=` |
| 40 | RequestSheet (leave) `people/requests.tsx:773` | S rail | **raw request id** / leave type name / none / **Pill in body "Waiting on a decision"** | Facts (Unit = raw `unit_id`; Asked by = login), Why field | desk: Approve / **Refuse** in a fused ButtonGroup **in the body**; phone: footer | in place; no confirm | `?request=` |
| 41 | CorrectionSheet `requests.tsx:859` | S rail | raw id / **"Attendance correction"** | same | same | same | `?request=` |
| 42 | SwapSheet `requests.tsx:954` | S rail | raw id / **"Roster swap"** | same | same | same | `?request=` |
| 43 | LeaveSheet `people/time-off.tsx:491` | S rail | raw request id / "Name · kind" / none / **header badge** | Facts, Why | footer on phone only: Approve / **Reject**; desk in body | in place | **local state** |
| 44 | Request leave `time-off.tsx:652` | S rail | title / caption | Fields | footer Cancel / "File request" | create | local |
| 45 | Time-off balances person `people/time-off-balances.tsx:248` | S rail | id / name / caption | **tabs prop**, employer-only tabs | n/a | n/a | local |
| 46 | ClaimSheet `people/claims.tsx:687` | S rail | **claim uuid** / claim number / none / Pill in body | Facts, SubHead + MiniTable, Timeline "History", Banner | **all in body**: Pay from petty cash, Send it in, Take it back, DecidePanel (Approve / Refuse / Send back in a ButtonGroup) | in place; no confirm | `?claim=` (no subject) |
| 47 | File claim `claims.tsx:532` | S rail | title | Fields | footer Cancel / "File and send it" | create | local |
| 48 | Claim type `people/claim-types.tsx:246` (+ new 157) | S rail | code / name | Pill with `mt-3` Facts, SubHead "Cancel this kind" + Why + danger | in body; new: footer Cancel / "Define it" | in place | local |
| 49 | OvertimeOrder `people/overtime.tsx:370` | S rail | raw order id / "2 h on 12 Oct 2026" | Pill, Facts (Day = `day_kind.toLowerCase()`), Banner | "Take the order back" in body | in place | `?overtimeOrder=` |
| 50 | Order overtime `overtime.tsx:493` | S rail | title / caption | Fields | footer Cancel / "Order it" | create | local |
| 51 | Payroll run (HR) `people/payroll.tsx:344` | S rail | **run uuid** / "**ho · 2026-09**" | Pill, Banner, Facts (Unit and Month repeat the title; Month is raw ISO), ThrControl, RunSummary, MiniTable "Slips" + **drill-down card in the sheet**, Timeline "Signed", Why | body row of up to 4 buttons: Recalculate, Send to head office, Approve, Send back | in place | `?payrollRun=` |
| 52 | One-off `people/one-offs.tsx:316` | S rail | employee_code / "label · name" | Pill (mt-3), Facts, SubHead "Why" paragraph, "Take it back" section | in body | in place | local |
| 53 | Reprimand letter `people/reprimands.tsx:264` | S rail | employee_code / "Level · name" / **header badge** | **KeyValue** (not Facts), paragraph, Field | **footer Close / Revoke letter** | in place | local |
| 54 | Data request / Change proposal `people/changes.tsx:465,592` | S rail | none / "Field · name" / **header badge** | Facts **and** KeyValue, paragraphs, Field "Why" | **footer Reject (danger) / Approve (primary)**, only if `canWrite` | in place | local |
| 55 | New change, Issue letter, File one-off, Open a run, Import CSV (wide), Allowance, Loan, Benefit fill, Org chart place, Checklist start, Attendance correction | S rail (CSV: wide) | title / caption | Fields | footer Cancel / (Propose it, Submit, File it, Open run, Close, Save allowance, Grant loan, Submit, ..., File correction) | create | local |
| 56 | JobRole `people/job-roles.tsx:244` * | S rail | `ADMIN` / "**Admin — ADMIN**" | **form first** (18 inputs: Name, Description, Rung, Store Servers, Read Only, Sections checklist, Flow Roles) | footer Delete (left) / Cancel / Submit, 36px | edit in place | `?role=` |
| 57 | Invitation / Invite people `invitations.tsx:285`, `invite-sheet.tsx:106` | S rail | id / "Renew <name>'s link" / "Invite people" | Field, link results | footer Done; Revoke / Cancel / Renew link | in place | `?invite=`/`?invitation=` |
| 58 | Attendance PersonSheet `people/attendance-days.tsx:1294` | **S table (64rem)** | code / name / date span caption / **header badge** | **tabs prop** (3): MiniTable (6 cols, Title Case heads), `Tag` for IN/OUT, uppercase eyebrow `<p>` | none | read | `?attendanceOf=` |
| 59 | 1721-A1 slip `people/tax-reports.tsx:57` | S rail | employee id / "1721-A1 · name" | Pill, Facts ("Masa perolehan"), tax lines | none | read | `?taxSlip=` |
| 60 | Settings editors via `FormSheet` `people/settings-parts.tsx:44` (shifts * (seen: head `PAGI` / `Pagi`, Facts only, footer Retire left + Close right, 36px), holidays x3, leave types x4, components x3, rates x2, overtime x3, mobile x2, attendance, absence, benefit, payroll schedule, payslip, departments, levels, group, company, checklists) | S rail | optional id / title (some with caption) | Fields (+Facts when read-only) | **footer: danger left, Cancel (or Close if read-only), primary right**; error Banner at the **bottom** of the body | edit/create | local |

### 1.4 System, GA, workplace, /me

| # | Sheet | Shell, width | Head | Body grammar | Actions, footer | Edit and confirm | Opened |
|---|---|---|---|---|---|---|---|
| 61 | UserSheet `system/users.tsx:950` * | S rail | username / display name / none / none (**Pill + Tag in body**) | Facts, raw `h4` x4 ("Access at store servers", "Job role", "Access", "Password"), nested panel | **each section has its own button in the body**: Submit (disabled, beside a Select), "Block sign-in" (danger), "Set password" | in place; Block has no confirm | `?user=`; **no `subject`** (kind `app_user` exists) |
| 62 | Add a user `users.tsx:1182` | S rail | title | form | footer Cancel / Submit | create | local |
| 63 | NodeSheet `system/nodes.tsx:602` * | S rail | origin id (`dc`) / label ("rig DC") / none / none (Pill "Current" in body) | Pill, Banner, Facts, NodeHealthSection (Condition, Machine, History: 3 more h4s), `Section` x3; body is 1426px tall on a 785px viewport | "Publish access policy" and "Send initial data again" in body, each under a 2-3 line paragraph | in place | `?origin=` |
| 64 | DeviceSheet `system/devices.tsx:1218` | S rail | device_id / label | StatusPill div, Facts, Banner, `Section` "Switch it" (Field "Why" **not marked required** but buttons disabled until filled), MiniTable "History" (raw `tr`, "What Happened") | Suspend / Reactivate / **Revoke for good (ghost, same style)** in body | in place; no confirm | `?device=` |
| 65 | Register a reader / node / enrolment / sync command / person in charge `devices.tsx:876`, `nodes.tsx:815`, `enrolments.tsx:281`, `sync.tsx:699`, `organisation.tsx:197` | S rail | title | forms | footer Cancel / (Register, Register, Submit, Submit, "Put in charge") | create | local |
| 66 | Monitoring server `system/monitoring.tsx:302` | S rail | id / name | Card, Problem | n/a | read | `?monitor=` |
| 67 | Fleet alert settings `system/fleet-incidents.tsx:216` | S rail | caption | form | n/a | edit | `?fleet-alert-settings=` |
| 68 | Contract hub `contracts/hub.tsx:74` | **S wide** | contract_number / party / "type · site" / **badge** (StandingPill + "Archived") | **tabs prop**: Details, Bills (Finance), [Usage], Recurring bills (Finance), Documents; Facts under an **underlined** h4 | **Header:** Archive (soft + icon); archive form lands in the **footer** | in place | `?contract=`, subject |
| 69 | Asset hub (GA) `assets/hub.tsx:81` | S wide | asset_number / name / acquired_via / **badge = status + "Not yet assessed by Finance"** | **tabs**: Detail, Documents, History, Class accounts; h4 "Detail" **under tab "Detail"** | in body "Actions" section: Move, Replace, Request disposal (soft + icons) | in place | `?asset=`, subject |
| 70 | Location hub `locations/hub.tsx:63` | S wide | **raw site id** / site name / "kind · address" | tabs (Details, Assets, ...) | n/a | n/a | `?location=` |
| 71 | Repair / Replacement / Disposal `maintenance/hub.tsx:115,542,925` | S wide (disposal: rail) | repair has no id / title / "site · object · asset" / stage badge | tabs (Details, Cost, Accounts, Documents) | **Header: up to 3 soft buttons** ("Approve budget" or the 40-char label "Creator cannot approve their own request", "Move stage", "Send bill to Finance"); form lands in the footer | in place | `?repair=`, `?replacement=`, `?disposal=` |
| 72 | Supply request `supplies/supplies.tsx:490` | S wide | `requestId.slice(0,8)` / item / "category · site" / stage badge | tabs (Request, Stage, Bill (Finance), Accounts) | n/a | in place | `?supply=` |
| 73 | GA composers: contracts `composer.tsx:272`, register asset `register.tsx:131`, new repair `repairs.tsx:457`, recurring task / inspection / record done `schedule.tsx:551,832,1021`, supplies `composer.tsx:151` | S wide (record done: rail) | title / caption | `Section` + Fields | footer Cancel / Submit (Register for assets) | create | local |
| 74 | Letters sheets `letters/letters.tsx:545,946,985` | S wide / rail | title | New letter; "Keep this wording"; "Void this letter" | footer Cancel / (Keep it, Void it) | create | `?letter=` (letter itself is a page) |
| 75 | Vendors `vendors/vendors.tsx:457` | S rail | title (name or "Add supplier") | Fields | footer Deactivate (left) / Submit | create/edit | `?supplier=` |
| 76 | Vault file `workplace/vault-sheets.tsx:62`, Place `:253`; Chat start `chat.tsx:1920`; Chat info `chat-info.tsx:100`; Open a thread `discussions.tsx:2924` (wide) | S | id / title / caption | Facts, KeyValue, Pill; thread **page** has an aside with uppercase eyebrow h4s and an embedded RecordPanel; "Edits to #n" is a `P` | footer Start / "Open it" | create | `?file=`, `?thread=`, `?conversation=` |
| 77 | Change password `me/profile.tsx:201` | S rail | title | Fields | footer Cancel / "Change password" | edit | local |
| 78 | /me leave request, correction, swap, claims | **full pages in their own kit** (`me/ui/bits.tsx`: own Panel/Card/Row/Loading/Pill/Button) | n/a | n/a | "Send request", "Send", "Send to the store head", "File and send" | n/a | route |

Not sheets, noted for completeness: Notifications and Activity are pages that deep-link into sheets. The `notifications` key in `SHEET_PARAMS` has no consumer in my area.

## 2. Summary numbers (from script, finance-lab excluded)

- Shells for records: `Sheet` rail 122 call sites, wide 16, table 1, workspace 1 (unrouted); `Panel` 13 files in my area; `FactsSheet`/`BottomSheet` 8.
- Record sheets using the `badge` prop: **10**. Record sheets that put the status Pill in the body: **22** (18 routed).
- Record sheets that pass `subject` (activity): **17 of about 61**.
- Sheets using the `tabs` prop: **9**. Sheets with their own in-body tab strip (SheetTabs / SubTabs): Employee, Sale, plus others.
- Header `actions`: **6** sheets (sale, account, contract, 3 maintenance).
- Raw login names rendered as facts (`requested_by`, `ordered_by`, `posted_by`, ...): **66** places.
- Section-heading idioms in my area: SubHead 94, raw `mb-2 text-card-title` h4 33, underlined h4 10, `rows.Section`, `form.Section`, uppercase eyebrow about 15.
- `ConfirmButton` in only 10 files; `variant="danger"` buttons in 33 files.
- Loading copy in `queryState`: "Reading" 142, "Loading" 45, Opening/Adding/Looking/... 40+.

---

## 3. Findings

### [H] F1. Finance tables inside sheets and panels overlap on a phone
- **Sheets:** JournalEntry panel (`finance-final/journals.tsx`), Payment panel (`payments.tsx`, 6-column References grid), Payroll EntrySheet and RunSheet (`finance-final/payroll.tsx`), and every other `Grid` of 3+ columns drawn in a Finance sheet or panel.
- **Evidence (seen on screen, 414x896, `/finance/accounting/journal-entries?entry=b4c51a79-...`):** under "Accounting entries" the stacked rows print on top of each other: "Persediaan Barang Dagangan" over "Hutang Suppliers Barang Dagangan", the Debit/Credit labels over the amounts, and the "Reverse" heading collides with "Rp 600.000". The body reports `scrollHeight 894 / clientHeight 793`, so the overlap also shortens the scrollable height. Root cause from code: `finance-final/parts.tsx` `Grid` fixes `tr` height to `h-[3.75rem]` (60px) while `styles/index.css` `.mini-stack` (width < 48rem) turns each `tr` into a two-column grid with row-gap, so a 5-cell row needs about 140px.
- **Inconsistent with:** `MiniTable`, which stacks correctly on a phone (Employee > Postings on the same viewport reads cleanly), and the owner rule "long tables stack on phone and never scroll sideways".
- **Suggested standard:** record sheets draw item tables with `MiniTable` only. Drop the fixed row height under 48rem (`max-md:h-auto`) in `Grid` as a stop-gap, and retire `Grid` inside sheets.

### [H] F2. Finance records open in a different shell: a centred Panel dialog instead of the right-hand rail
- **Sheets:** Journal entry, Payment (live), Credit note, Accrual match, Recurring bill, Journal template, Bank rule, Asset register, BKK/BKM slip, Contractor project (x4), Cash count, Bank account, Bank reconciliation (`finance-final/journals.tsx:483`, `payments.tsx:482`, `finance/credit-notes.tsx:381`, `finance/asset-register.tsx:442`, `finance/cash-documents.tsx:1413`, ...).
- **Evidence (seen on screen, 1440x900):** the journal entry opens as a centred **832x852** dialog at x=304 with a blurred backdrop (`backdrop-blur-[2px]`), a 32px bordered ghost x, no mono id, a one-line `sub` explainer and the Reverse form at the bottom of the body. Employee, User, Period and Job role open as a **760x860 rail** at x=660,y=20 with a plain x and the white veil. From code `Panel` (`components/ui/dialog.tsx:338`) has no `id`, `badge`, `tabs`, `caption`, `footer` or `subject` slots, never stands beside the list at >=96rem (the rail does), and gives actions no home (they sit in the body). Phone: `PhoneDrawer tall` with a different close button (44px bordered) than `Sheet` (plain x).
- **Inconsistent with:** the rail used by HR, System, GA and the other Finance sheets (BillSheet, PeriodSheet, AccountSheet, AssetSheet are all rails).
- **Suggested standard:** `Panel` is for working surfaces only (print queue, composer). Every record in Finance opens in `Sheet` with the same head, badge, tabs and footer.

### [H] F3. One record, several different sheets
- **Sheets:**
  - Leave request: `people/requests.tsx:773` vs `people/time-off.tsx:491`.
  - Journal entry: Panel `finance-final/journals.tsx:483` vs Sheet `finance-final/payroll.tsx:537` (plus unrouted `finance/journal.tsx:439`).
  - Payroll run: `people/payroll.tsx:344` vs `finance-final/payroll.tsx:312`.
  - Asset: `assets/hub.tsx` (GA) vs `finance/assets.tsx:1168` vs Panel `finance/asset-register.tsx:442`.
  - Payment: Panel `finance-final/payments.tsx:482` vs unrouted Sheet `finance/payments.tsx:688`.
  - Member: `members/directory.tsx:806` vs the receipt sheet `sales/customer.tsx:560` (id = customerId).
- **Evidence (from code):** the same leave request is "title = leave type, Pill 'Waiting on a decision' in the body, button 'Refuse', open via `?request=`" from one screen and "title = 'Name · kind', badge in the header, button 'Reject', local state (no URL)" from the other. The same payroll run is titled "ho · 2026-09" with a raw uuid id in HR and "Head Office · September 2026" with no id in Finance. The same journal entry is a dialog with 5 pills and a Reverse form in one place and a rail with 4 facts and no actions in another.
- **Inconsistent with:** the registry idea in `lib/sheets.ts` (one key per record, "a link to a record is a link").
- **Suggested standard:** one sheet component per record kind, one URL key, reused by every screen that links to it. Where two desks truly need different views (GA asset vs Finance asset), they are two tabs of one sheet.

### [H] F4. The "Comments" tab has no comments
- **Sheets:** every tabbed sheet with a `subject`: Contract hub, Asset hub, Location hub, Repair, Replacement, Disposal, Supply (`components/ui/sheet.tsx:176-186`).
- **Evidence (from code):** the appended tab is labelled "Comments" (the source comment says commenting is "what somebody comes here to DO"), but its content is `RecordPanel`, which renders only "N documents filed" and a collapsed "Activity" disclosure ("Nothing has been done to this record since the log began."). `addComment`, `editComment` and `removeComment` exist in `lib/queries/records.ts` and are called nowhere in the app. Untabbed sheets with a `subject` (Employee, Sale, Bill, Account) show the same panel as an "Activity 23" disclosure at the bottom of the body (seen on screen on Employee).
- **Inconsistent with:** the owner standard "the Activity tab appended for records with a `subject`" (the label is wrong) and with the untabbed sheets, where the same content is not a tab at all.
- **Suggested standard:** name the tab "Activity" until a composer exists. Append it as the last tab on every sheet with a `subject`, tabbed or not. Do not show a tab named for something that cannot be done.

### [H] F5. The status badge is not in one place, and there is more than one status
- **Sheets:** 22 record sheets keep the status `Pill` in the body by script count (BillSheet, ClaimSheet, RequestSheet x3, OvertimeOrder, Payroll run, One-off, Claim type, UserSheet, NodeSheet, MemberSheet, 1721-A1, Account links, Vault file, benefit, import-export, AssetSheet, and 4 unrouted), plus the Employee sheet and DeviceSheet (wrapper components) and the Journal entry / Payment panels (pills in the body); only 10 use `badge` (Asset hub, Contract hub, Repair x3, Supply, Attendance PersonSheet, LeaveSheet, Reprimand, Data request/Change).
- **Evidence:**
  - Seen on screen: Employee shows a body Pill "Working" above the Facts; User shows Pill "Active" + Tag "Cashier"; Member shows Pill "Never bought" + a two-line sentence; Store server shows Pill "Current" and then a second pill "Disk getting full" with a bar meter under "Condition"; Journal entry shows "Goods receipt" + "Posted by the system" (phone and desk). None of them is in the head.
  - From code: BillSheet draws up to five chips (`Status` dot + word, kind Pill, "GA", "On hold", "N days overdue", `supplier-bills.tsx:1524-1543`); JournalEntry up to five; Payment `Pill "Pay"` + `Status` + `Pill "Reserved against these bills"`; Asset hub's `badge` holds two Pills ("In service" + "Not yet assessed by Finance"); Contract hub holds "Standing" + "Archived"; Credit note puts status in the `sub` slot.
  - Four chip grammars: `Pill` (outlined), `Tag` (square, caps), `Status` (dot + word), Lifecycle track (Sale, Period).
- **Inconsistent with:** the standard "ONE status badge (Pill) in the same place on every sheet", and with the owner's "calm = fewer things (no chips)".
- **Suggested standard:** the `badge` prop is the only place, one `Pill`, tone ok / warn / bad / info (in motion only) / neutral. Kind, source, "GA", "On hold", "Overdue" become Facts or a Banner. Retire `Status` and `Tag` inside sheets.

### [H] F6. Head: the mono id and the title are used inconsistently, and some are raw ids
- **Sheets:** all.
- **Evidence:**
  - Seen on screen: Job role head is `ADMIN` / "**Admin — ADMIN**" (the code twice); Shift is `PAGI` / "Pagi" (the same word twice); User head is `dian` / "Dian Pertiwi" (a login in the id slot); Member is `081311110002` / "Andi Prasetyo" and the first Fact is "Card 081311110002" (the id again); Store server is `dc` / "rig DC"; Period is `2026-10` / "October 2026"; Employee `HO-0006` / "Nina Oktaviani" is the good form.
  - From code, raw uuid-style ids in the mono slot: `id={request.id}` (requests.tsx:778, 864, 959), `id={row.claim_id}` with the claim number as the *title* (claims.tsx:690, inverted), `id={order.id}` (overtime.tsx:368), `id={run.id}` (payroll.tsx:349), `id={requestId.slice(0,8)}` (supplies.tsx), `id={siteId}` (locations hub), `id={customerId}` (member receipt), `id={member_id}` (and Fact "Card" repeats it), `contract_id.slice(0,8)` in a Fact. `id={spanText}` puts a date span in the mono slot on the Shop window sheet.
  - Titles that are screen names ("Attendance correction", "Roster swap", "Window"), a store id for a sale and for a member receipt (`sale?.site_id`), or an id pair ("ho · 2026-09").
  - The Sheet draws the id as `font-mono text-id` with no truncation or `break-all`, so a 36-character id would run under the close button on a phone (not reproduced; no rows).
- **Inconsistent with:** "mono id above the title; title = what the record is".
- **Suggested standard:** mono id = the human record number (HO-0006, JV-00000032, INV-..., claim number) or omitted. Never a uuid, a username, a period, a date span or a repeat of the title. Title = the record in words ("Annual leave · Nina Oktaviani", "Journal entry JV-00000032" only if there is no better name). Truncate the id with ellipsis.

### [H] F7. Approval sheets: different verbs, order, placement and chrome for the same decision
- **Sheets:** leave request (requests.tsx), attendance correction, roster swap, leave (time-off.tsx), claims DecidePanel, data request / change proposal (changes.tsx), payroll run (people/payroll.tsx), repair budget (maintenance), disposal.
- **Evidence (from code):**
  - Verbs: **Approve / Refuse** (requests.tsx, claims), **Approve / Reject** (time-off.tsx, changes.tsx footer), **Approve / Send back** (payroll run), "Approve budget" / "Reject" (maintenance).
  - Order: Approve first (requests, time-off, claims) vs **Reject first, Approve last** (changes.tsx footer).
  - Placement: desk body under the reason with a fused `ButtonGroup`, phone footer (requests.tsx `Verdict`/`VerdictButtons`, time-off.tsx); changes.tsx always footer; claims always body; payroll body row of four buttons.
  - Gate: reason required to approve and to reject (HR); hidden when the reader cannot write (changes.tsx `canWrite`) vs offered and refused by the server (claims, payroll comments say so).
  - Status Pill "Waiting on a decision" in the body with no gap before Facts (requests, tax slip) vs header badge (time-off, changes).
  - No confirmation on any of them.
- **Inconsistent with:** the standard "action buttons live in the footer, primary on the right, destructive separated" and "same on every device".
- **Suggested standard:** one `DecisionFooter`: left = Reject (danger, quiet fill), right = Approve (primary), both in the footer on every device; a required "Reason" field in the body above; badge in the head. Use "Approve / Reject" everywhere. `DataRequestSheet` (`changes.tsx:465`) is the closest reference.

### [H] F8. Irreversible or ledger-writing actions have no confirmation and are not always styled as dangerous
- **Sheets:** SaleSheet (Complete, Void), UserSheet (Block sign-in), DeviceSheet (Revoke for good), JournalEntry (Reverse), BillSheet and Payment (Post to the books), Reprimand (Revoke letter), JobRole (Delete), ClaimSheet (Pay from petty cash), all approval sheets.
- **Evidence (from code):**
  - `sale-sheet.tsx:875-891`: `Complete` and `Void` call `mutate()` directly; the source comment says completing "moves the goods off the store floor ... there is no undo".
  - `devices.tsx:1300`: "Revoke for good" (the copy says a revoked device "never can again") uses the default ghost variant, same as "Suspend", with an unmarked "Why".
  - `users.tsx:1071`: "Block sign-in" signs the person out "here and at every store server", one click.
  - Only 10 files in my area use `ConfirmButton`; three confirm idioms exist: the Dialog (exceptions Acknowledge, segments), an inline footer two-step (Periods "Seal N entries? Cancel / Seal", Shifts "Yes, retire it"), and none.
- **Inconsistent with:** `dialog.tsx` itself ("a dialog asks one question ... none of the three has an undo").
- **Suggested standard:** anything with no undo or that posts to the books goes through `ConfirmButton` (phone: PhoneDrawer). Irreversible = `danger` variant. Pick one idiom (the Dialog); keep the Period inline two-step only if it becomes the shared footer pattern.

### [H] F9. The sheet title and its section headings are the same size and weight
- **Sheets:** all.
- **Evidence (seen on screen):** Employee sheet: title 16px/600; `h4`s "Employment", "Postings" 16px/600. Journal entry: title and "Accounting entries", "Reverse" 16px/600. User: "Access at store servers", "Job role", "Access", "Password" 16px/600. In code the title is `text-[1rem] font-semibold` and `--text-card-title` is 1rem (`styles/index.css:522`). Fact labels and values are 14px. The owner's own rule is "bold only in title/figures".
  Heading idioms in use: `SubHead` (94), raw `h4 mb-2 text-card-title` (33, Sales, Users, Period), underlined `h4 mb-2.5 border-b pb-1.5` (10, GA hubs), `rows.Section` (border-t), `form.Section` (border-b + optional icon), uppercase eyebrow `p`/`h4` (cash-documents x8, discussions x6, letters x3, vault x3, attendance x2; the 2 Oct ruling says no uppercase), and plain muted text ("Per employee", "What was done").
- **Inconsistent with:** itself; the owner "same section heading style (`SubHead`) everywhere".
- **Suggested standard:** title 18px/600 (the only bold in the head). Section heading = `SubHead` only, 15px/500 ink, no rule. Delete the other idioms from sheets (`rows.Section` and `form.Section` stay for forms but borrow the SubHead look).

### [M] F10. Actions live in the header (the Sheet contract says so) instead of the footer
- **Sheets:** SaleSheet (Complete, Void), AccountSheet (Edit, Deactivate), Contract hub (Archive), Repair / Replacement / Disposal (up to 3 soft buttons), Asset hub (actions inside an "Actions" section in the body).
- **Evidence (from code):** `Sheet`'s own doc says actions are "pinned in the header, not at the foot". On a phone the actions drop into a full-width third row under the title (`max-md:order-3 max-md:w-full max-md:flex-wrap`), sm buttons at 40px (coarse). `maintenance/hub.tsx:143-146` puts the 40-character label "Creator cannot approve their own request" on a header button.
- **Inconsistent with:** "phone: action buttons live in the FOOTER (>=44px) ... never as a row of small header buttons".
- **Suggested standard:** remove `actions` from the head on all widths (keep at most one overflow "..." on the desk). Move the verbs to the footer. Put explanations like "creator cannot approve" in a Banner above the footer, not in the label.

### [M] F11. Footer layout, alignment and height are not standardised
- **Sheets:** all with a footer (about 97 call sites).
- **Evidence:**
  - Seen on screen: Period footer is a lone danger "Close this month" at x=689 (left-aligned, disabled) while Job role is "Cancel | Submit" right-aligned (x=1244-1391), 36px high; Shift is "Retire" left + "Close" right. **On the phone (414x896):** Job role footer is 61px tall with Cancel 81x36 and Submit 82x36 while the head's close x is 44x44; Period footer is "Close this month" 151x36 at x=16 (left, small, pale red) on a full-width bar. So the one tap target a thumb needs most is the smallest.
  - From code: BillSheet footer = helper sentence left + primary right; FormSheet = danger left, Cancel, primary; Period = lone left button that swaps into a sentence + Cancel/Seal, or a Textarea + buttons; SaleSheet = a two-row input composer (Input `h-8` + Add; Segmented + Money `h-8` + Take) inside a footer whose buttons are forced to 36px; phone-only footers (requests x3, time-off, add-employee); verdict sheets with no footer on desk.
  - `sheet.tsx:278`: `[&_button]:h-9` forces **36px on every pointer** (owner 5 Oct: "oversized"), overriding the app's coarse-pointer 44px. This is the standard in the code but not the >=44px in the brief; flag for the owner to choose one number. Close x is 44px on a phone.
- **Inconsistent with:** the standard "primary on the right/last, destructive separated, >=44px" and "same on every device".
- **Suggested standard:** one `SheetFooter`: [destructive, left] ... [quiet Cancel] [primary]. One primary, right. Same on every width. Helper sentences go above the footer as a Banner/hint, not beside the button. Composers get their own sheet, not a footer.

### [M] F12. Five different ways of editing, and the record sheet doubles as a workbench
- **Sheets:** Employee, User, Account, Contract/Repair hubs, Period, Job role, Asset hub, Claim.
- **Evidence (from code and screen):**
  1. In-tab mini forms, each with its own button (Employee: Leave "Pay out", "Give the day back"; Claims "Set their allowance"; Position "Save placement"; Discipline "Issue letter"; Pay "Agree it", "Save", "Record it", "Reset payslip password"; Loans "Grant loan"; Change "Submit").
  2. Per-section mini forms in one body (User: Select + "Submit", "Block sign-in", Secret + "Set password").
  3. Form swapped into the top of the body (Account Edit).
  4. Form swapped into the footer (Contract Archive, Repair Approve/Move/Bill, Period Seal and Undo).
  5. Open straight into an editable form (Job role, 18 inputs) or a separate create sheet with footer Cancel / Submit.
  Read-only records (Journal, Payment, Bank transaction, Slip, Window) have no edit at all.
  Seen on screen: Employee > Pay is one tab of **2289px** (about three screens) with six sections (Agreements, Payroll identity, Agree new pay, Tax and BPJS, Where the money goes, Payslip password), 9 inputs and four separate Save-style buttons; Employee > Leave is 1351px with two forms; the Store server sheet is 1426px with six h4 sections and two action buttons at the end.
- **Inconsistent with:** "record DETAIL reads as facts ... never disabled inputs"; the Job role sheet opens as inputs, not facts.
- **Suggested standard:** view and edit are the same sheet in two states: facts by default, an "Edit" in the footer swaps the body to the form and the footer to [Cancel][Save changes]. Anything that is a separate act (issue a letter, grant a loan, agree new pay) opens its own sheet from a footer or "..." menu, not a form inside a tab.

### [M] F13. Employee sheet: ten tabs overflow on desk and wrap into three rows on phone, from a tab system no other sheet uses
- **Sheets:** EmployeeSheet (`people/directory.tsx:842`, `SheetTabs` in `people/parts.tsx:29`).
- **Evidence (seen on screen):** desk (760px wide): tablist `scrollWidth 748 > clientWidth 702`, the last tab "Change" is clipped ("Ch" visible) and the strip scrolls sideways. Phone (414px): `Segmented` wraps the 10 tabs into **3 rows** (about 210px of the 896 before any content). Tabs sit **inside the body** (SubTabs on desk, Segmented on phone) instead of the Sheet `tabs` prop used by the GA hubs and the attendance PersonSheet, so the head has no tab strip and the Activity disclosure repeats under every tab. Three tab systems exist in sheets: `Sheet.tabs`, `SheetTabs/SubTabs` (Employee, Sale, Reprimand), and `Segmented` on phone.
- **Inconsistent with:** "tabs/sections wrap on phone, never scroll sideways" (desk overflows) and with `Sheet.tabs`.
- **Suggested standard:** at most 5 tabs on a sheet, via `Sheet.tabs` only. Employee becomes Overview (facts + employment + postings), Time & leave, Pay, Documents/Claims, Activity; the rest (Position, Discipline, Loans, Change) become footer actions that open their own sheets.

### [M] F14. The save/submit vocabulary is a mix of "Submit" and ad-hoc verbs
- **Sheets:** all create/edit sheets.
- **Evidence (from code):** "Submit" with pending "Submitting..." in about 25 places (JobRole, User role, Vendor, GA composers, Repair, Schedule, Settings absence/benefit/holidays/payslip/mobile/company/levels/group, Invite people). Dead ternaries `editing ? "Submit" : "Submit"` (`segment-form.tsx:285`) and `eligible.length > 1 ? "Submit" : "Submit"` (`invite-sheet.tsx`) show a bulk replace. Verbs elsewhere: Register, Post entry, Post to the books, Seal, Reverse, Record payment, Pay out, "Save allowance", "File correction", "File and send it", "File it", "File request", "Propose it", "Define it", "Open run", "Order it", "Add employee", "Write the version", "Define", "Define component", "Ratify", "Ratify this version", "Restate", "State these rates", "State this schedule", "Close these dates", "Lift the closure", "Publish 2026", "Put in charge", "Start", "Open it". Dismiss: "Cancel" (most), "Close" (read-only, reprimand), ghost "Cancel" in Dialog vs quiet "Cancel" in Sheet footers. Reason field: "Why" (HR, Dialog hints) vs "Reason" (Finance, `Dialog` reason, payroll settle, `Why (taking it back)`, `Why revoke it`).
- **Inconsistent with:** the standard pair "Save / Save changes / Submit / Confirm / Post..." as one decision.
- **Suggested standard:** create = "Create <thing>" or "Add <thing>", edit = "Save changes", ledger = "Post <noun>", decision = "Approve" / "Reject", legal act = the verb on the record ("Issue letter"). Pending label = the present participle. One reason label: "Reason". Dismiss = "Cancel" (quiet) everywhere; "Close" only for read-only.

### [M] F15. Field labels are Title Case, headings and Facts are sentence case, and some headings repeat their own tab or label
- **Sheets:** everything with a `Field`; Asset hub, Contract hub, Repair, Location hub, User.
- **Evidence (seen on screen):** `Field` styles labels with `capitalize` (`field.tsx:94`), so they render "Paid With The Payroll Of", "Day Back Goes Into", "Their Own Figure For", "Job Role", "New Password", "Store Servers", "Flow Roles" while Fact terms ("Posted to", "Last sign-in") and SubHeads ("Job role", "Password") are sentence case. On the User sheet the heading "Job role" sits directly above the label "Job Role"; "Password" above "New Password". From code: Asset hub tab "Detail" opens with an h4 "Detail"; Contract tab "Details" -> "Contract details"; Repair tab "Details" -> h4 "Details"; Location tab "Details". Required marks: `Field required` draws `*`; the Device "Why" is mandatory (buttons stay disabled) but unmarked.
- **Inconsistent with:** the sentence-case rule from 2 Oct ("no uppercase, sentence case") and `Field`'s own comment ("a form that marks its required fields has to mark ALL of them").
- **Suggested standard:** drop `capitalize` from `Field`. A section whose title equals its tab or its only field loses the heading. Mark every required field.

### [M] F16. Facts truncate long values, are two-column even on a phone, and are used for free text
- **Sheets:** all that use `Facts`; worst for Journal entry, Leave/Overtime/Claim facts ("Reason", "They said", "Notes", "Handover reason", "Evidence").
- **Evidence:** `Fact`'s `dd` is `truncate` on one line (`sheet.tsx:425`). Seen on screen: the Member sheet is one undivided grid of **15 Facts** (Card, Joined, First bought, Last purchase, Spend, Transactions, Avg transaction, Units, UPT, Points held, Points earned, Points spent, Saved by promotions, On voucher, App) with no section break; "Card" repeats the mono id. Seen on phone: "Source record c7211ea6-ad39-4396-..." and "system:goods-receipt" fill their half-width cell. In code, free-text reasons are put into Facts (`<Fact term="Reason">{request.reason}</Fact>` in requests.tsx x3, time-off.tsx, overtime.tsx, supplies, maintenance "Notes"), so a sentence is cut to one line in a 340px (desk) or 190px (phone) column with no way to read it. The grid is `grid-cols-2` on every width. A second fact grammar, `KeyValue` (label left, value right-justified, `break-words`), is used in 15 sheets, sometimes beside Facts in the same sheet (changes.tsx, journal).
- **Inconsistent with:** "the same two-column Facts grid everywhere" and with `KeyValue`, which wraps.
- **Suggested standard:** `Facts` for short scalar values only (<= about 8); `dd` wraps, never truncates (ellipsis plus tooltip only for ids). Free text goes under a SubHead as a paragraph ("Reason"). One fact grammar; keep `KeyValue` only inside TotalsLadder.

### [M] F17. Raw logins, ids and enum codes are shown where a name belongs
- **Sheets:** requests x3, time-off, overtime, claims, payroll (HR and Finance), journal, payments, periods, bills, users, maintenance, supplies, directory.
- **Evidence:** 66 places render `*_by` logins as facts ("Asked by", "Ordered by", "Posted by", "Recorded by", "Filed by", "Closed by", "Created by"). Seen on screen: "Created by admin", "Posted by system:goods-receipt", Employment timeline "HIRE — CANDIDATE → ACTIVE" with "admin · joined as Staf gudang toko", Postings "admin · posted to ho" set in mono. From code: `Unit` = raw `unit_id` ("ho", "store-01") in requests.tsx, overtime.tsx, payroll.tsx, one-offs.tsx while Finance uses `UnitName`; "Month 2026-09" (HR run) vs "September 2026" (Finance run); `order.day_kind.toLowerCase()` ("working"); Sale "Cashier" = `actor_id`; "Store" = `site_id`; Device "Replaces" = a device id.
- **Inconsistent with:** the owner rule "employee FULL names" and with `UnitName` / `SupplierName` already available.
- **Suggested standard:** a single `Who` / `UnitName` / `PeriodName` renderer for facts and timelines. Raw ids appear only in a tooltip or the mono id slot.

### [M] F18. Three table idioms and card-in-sheet frames, with Title Case heads
- **Sheets:** Sales sheets, Node, Device (raw `tr`); HR/Contract/Bill (MiniTable); Finance journal/payment/payroll (Grid).
- **Evidence:**
  - Seen on screen (desk, Journal entry): the Grid is a framed, shadowed card inside the bordered Panel, with a tinted head row and 60px rows, a "card in sheet" double frame.
  - From code: `MiniTable` (hairline rows, py-3), raw `<tr className="border-t border-hairline"><td className="py-2 ...">` (py-2: sale-sheet.tsx x4, window-sheet.tsx x3, customer.tsx, nodes.tsx, devices.tsx) and `Grid` (60px rows, framed) draw rows at three different heights, sometimes inside one sheet (SaleSheet mixes `MiniTable` heads with raw rows). Payroll run draws a slip as a bordered `rounded-card p-4` card inside the sheet; User draws "Access at store servers" in a grey nested panel.
  - Title Case column heads in sheets: "Line Total" (sale), "Shelf Price" (member receipt), "What the Day Was", "Why Not", "Reached Us" (attendance), "What Happened" (device), "Acquirer Reference" (unmatched charge), "Already Expensed" (prepaid). `MiniTable`'s own comment says sentence case.
- **Inconsistent with:** the owner standard (one `MiniTable`; numbers right and tabular) and the 2 Oct sentence-case ruling.
- **Suggested standard:** `MiniTable` + `MiniRow` + `MiniCell` only. No frames inside sheets (rule + air separates). Sentence-case heads. Nested cards become a section.

### [M] F19. Phone shell: three drawers with different chrome, and a 12px strip
- **Sheets:** Sheet (`sheet.tsx`), Dialog/ConfirmButton (`dialog.tsx` + `PhoneDrawer`), Panel (`PhoneDrawer tall`), picker sheets.
- **Evidence (seen on screen, 414x896):** `Sheet` popup at y=12, height 884 (grip bar plus a 12px strip of the page above); close is a plain 44px x. `Panel` on phone uses a **bordered 44px ghost x** and a title/sub block in a different head layout (seen on Journal entry). Dead code in the `Sheet` Dialog branch (`inset-0 h-dvh ... max-md:`) and its doc ("Under 48rem it takes the whole screen") describe a layout the Drawer branch replaced. The footer sits inside `pb-[env(safe-area-inset-bottom)]` and the Drawer keyboard inset (good).
- **Inconsistent with:** "the sheet is the whole screen" (12px strip, intentional) and "close x" (two styles).
- **Suggested standard:** one phone head and one close button for all sheets; keep the 12px peek and grip, or drop both, but document one. Remove the dead classes.

### [M] F20. Desk width and "beside the list" depend on the module, not on the content
- **Sheets:** rail (122 call sites), wide (GA hubs, 6 composers), table (Attendance PersonSheet only), Panel (Finance).
- **Evidence:** at 1440px (page below 96rem) every rail floats over the list with the veil; the rail is 760px (`clamp(27.5rem, 62vw, 47.5rem)`), wide 896px, table 1024px, Panel 832px. Only `width="rail"` stands beside the list from 96rem (`sheet.tsx:190`, `layout.ts`): wide and table hubs, and all Panels, never do. A tab-heavy HR record (Employee, 10 tabs, 11 inline forms) is a narrow rail while a facts-only GA record (Contract hub, 5 tabs) is `wide`. Finance Panels are 832px with no tabs.
- **Inconsistent with:** the owner standard "width class chosen consistently by the kind of content (rail / wide / table / workspace)".
- **Suggested standard:** rail = a record (facts + one table), wide = a record with a wide table (not for forms), table = a read-only wide grid, workspace = a task. Make "beside" depend on the record being a rail, whatever the module. Document the rule next to the `width` prop.

### [M] F21. Activity coverage depends on whether the screen remembered `subject`
- **Sheets:** User, Member, Return, Claim, Overtime, Payroll run, Time off, Payment, Period, Letter sheets and most settings sheets pass no `subject`; 17 of about 61 record sheets do.
- **Evidence (from code):** `lib/sheets.ts` registers `user: "app_user"`, `member: "customer"`, `refund: "return"`, `thread`, `letter`, `document`, but `UserSheet`, `MemberSheet`, `ClaimSheet`, `OvertimeOrder` and the payroll run pass nothing to `Sheet`, so they get no history while the same registry says they should. `attendanceOf` is deliberately without one (comment says so). For tabbed sheets the Activity is a tab (see F4); for untabbed sheets it is a disclosure at the bottom (seen on screen).
- **Inconsistent with:** "the Activity tab appended for records with a `subject`" and with the `Sheet` comment "declared on the shell rather than pasted into thirty sheets".
- **Suggested standard:** `useSheet(key).subject` is passed by every record sheet; add a lint-style check: a record sheet without `subject` needs a comment.

### [M] F22. Many record sheets are not addressable: their open state is React state, not the URL
- **Sheets:** LeaveSheet (time-off), time-off balances person, Reprimand, One-off, Claim type, Change/Data request, Benefit, Loans, Payroll RunSheet and EntrySheet (Finance), Advances PaySheet, Bank transaction, MemberSheet, every settings editor (about 30), vendors, devices register.
- **Evidence (from code):** `useSheet` is called for `request`, `claim`, `overtimeOrder`, `payrollRun`, `employee`, `role`, `user`, `device`, `origin`, `entry`, `payment`, `bill`, `period`, `account`, `asset`, `contract`, `repair`, ... but not for the sheets above, which use `useState<Row | null>`. A reload, Back, a notification link or a pasted link cannot reopen them, which `lib/sheets.ts` states is the point ("a sheet in component state cannot be sent to a colleague").
- **Inconsistent with:** the registry's own rule, and with the same record being URL-addressable from its sibling screen (leave: `?request=` vs local).
- **Suggested standard:** every record sheet has a registry key; create/task sheets may stay local. Close clears the key (already true for `useSheet`).

### [M] F23. A sheet that opens another sheet gives no way back
- **Sheets:** WindowSheet -> SaleSheet; MemberSheet -> "Their transactions"; EmployeeSheet -> Claims "Open"; Bill -> Journal / Payment links; Journal "Reverses / Reversed by".
- **Evidence (from code):** `window-sheet.tsx:179-185` links each receipt with `AppLink sheet={{key:"sale"}}`; `useSheet.open` pushes and both Dialogs stay mounted at the same `fixed z-40` rail position, so the second hides the first and Back is the browser Back. `journals.tsx` swaps by `onOpen(id)` with the label "the entry it answers" (an unnumbered link). There is no "back to <parent>" affordance and no stacking offset. Not reproduced on screen (no sales rows).
- **Inconsistent with:** the owner question "opening a second record while one is open".
- **Suggested standard:** a stacked sheet shows a "Back to <parent>" link in its head (or the parent steps left). Links show the target's number, not a description.

### [M] F24. Loading, empty and error states are written five ways and take different amounts of room
- **Sheets:** all.
- **Evidence:** `queryState` copy in my area: "Reading ..." (142), "Loading ..." (45: "Loading the contracts...", "Loading the sale...", "Loading the bill...", "Loading..."), "Opening the contract...", "Adding ...", "Looking ...", "Counting ...". The Employee sheet shows a separate centred "Reading the ledger..." / "Reading the requests..." / "Reading the payouts..." band per section (seen on screen, each about 100px of blank space). `finance-final/payroll.tsx` EntrySheet and RunSheet use `LoadingState` with no words. Errors: top of body (Bill, Period, Journal), after the facts (requests, claims), at the bottom (FormSheet `Banner` after the fields; claims; people payroll), inside the footer (sale composer). Empty: `Quiet`, `EmptyState` (a whole card with 3.5rem padding), a bare `<p>` ("Nothing scanned onto this sale yet.").
- **Inconsistent with:** the owner standard "Reading the ..." and with `Quiet` being introduced exactly to avoid `EmptyState` in a sheet.
- **Suggested standard:** "Reading the <thing>..." always; one skeleton row, not a centred band; one `Quiet` for empty; errors in a Banner at the top of the body, directly under the head, on every sheet.

### [M] F25. Permission handling has two opposite policies
- **Sheets:** FormSheet (HR settings) and Data request/Change show only "Close" or hide the verbs when the reader cannot write; ClaimSheet, payroll run, requests, devices offer every verb and let the server answer.
- **Evidence (from code):** `settings-parts.tsx` ("A role that may not write sees the facts and a Close"), `changes.tsx` (`waiting && canWrite`) vs the comments in `claims.tsx` and `payroll.tsx` ("a button that appears a moment late is worse than one the server answers honestly").
- **Inconsistent with:** each other; there is no standard "you can read this but not change it" line.
- **Suggested standard:** one rule. Recommended: hide the verbs, and show one muted line under the facts naming who can act.

### [M] F26. Escape, swipe-down and outside-click discard typed work without asking
- **Sheets:** Add employee (12+ fields), every composer and settings editor, Refund form, Journal composer.
- **Evidence (from code):** `Sheet` uses `onOpenChange` straight into `onClose()` with no dirty check; the phone `Drawer` closes on a swipe from the grip or the head, and `Dialog` closes on Escape and (below 96rem) on a veil click. The Employee sheet forgets each tab's typed text when the tab changes (each tab component unmounts). Not reproduced.
- **Inconsistent with:** the owner question on "close/back/Esc/swipe-down behaviour".
- **Suggested standard:** a shared `dirty` flag on `Sheet`: if the form has input, Esc / swipe / x asks "Discard this?" once.

### [M] F36. Explanatory copy fills the sheets (notes, hints under every field, `sub` sentences)
- **Sheets:** Employee (Pay, Leave), Period, User, Store server, Journal entry reverse, Finance Panels, HR approvals.
- **Evidence (seen on screen unless noted):**
  - Employee > Pay: "A new agreement supersedes the one before it from its own date. It cannot be filed behind the latest — a backdated raise is paid as back pay, not by rewriting a month already settled." and "The holder's name matters as much as the number: an Indonesian transfer is rejected on a name mismatch, and one rejection fails the whole payroll file."
  - Employee > Leave: "Earns one day back into the kind chosen. The day must be a public holiday or a rest day on their roster."
  - Period: a three-line closing paragraph ("A close and a posting cannot interleave — the database serialises them ...").
  - User: "Signs them out now, here and at every store server, and keeps them out until the account is restored."
  - Store server: two 2-3 line paragraphs above Publish access policy and Send initial data again.
  - Journal entry: "This posts a new entry with the debits and credits exchanged ... It is not a cancellation; nothing in this book can be cancelled." plus "The reason is the only record of why."
  - From code: the hint "... and required." sits under 15 "Why" fields although the `*` already says so; Finance Panels carry a one-line explainer in `sub` ("An Indonesian slip, ready to print.", "What left the bank, and which debts it answered.", "When a bank line's description matches, propose what it is. Nothing posts until somebody accepts."); Job role has a hint under five fields.
- **Inconsistent with:** the owner rule "no explanatory subtitles / notes / footnotes; short plain labels", and with `Field`'s own comment that hints are read every time and "become furniture".
- **Suggested standard:** no `sub` slot on records; a note is allowed only when it changes what the person does next (blockers, consequences of an irreversible act) and then as one sentence in a Banner. Delete the "required" hint; the `*` is the mark.

### [L] F27. Spacing between loose body children is hand-set per sheet
- **Sheets:** requests x3, tax-reports (Pill straight into Facts, no gap); claim-types, one-offs (`Facts className="mt-3"`); claims (`mt-3` Banner, `mt-4` sections); people payroll (`mt-4` everywhere); others use `flex flex-col gap-5`.
- **Evidence (from code):** the Sheet body is a plain block, so children stack with whatever margin each author wrote: 0, 12, 16 or 20px. Section rule + air (`rows.Section`) vs `gap-5` vs `mt-4`.
- **Suggested standard:** `Sheet` wraps its children in `flex flex-col gap-6`; authors never add margins.

### [L] F28. Wording drifts between names for the same thing
- **Sheets:** System and Finance.
- **Evidence (from code):** sheets say "Node" ("Register a node", "That node is not in the register any more", "Command lane", "Generation", "Sequence") under a screen called "Store Servers"; Device sheet has Kind/Node/Reader; "Origin" in keys. Receipts say "Reached Cloud" (ShopSaleReceipt) and "Reached centre" (PricingPanel) in the same file. UI strings in English sheets that are Indonesian or half-Indonesian: "Masa perolehan" (1721-A1), "a kasbon (potong advance)" (one-offs "Repays"), "Tahan gaji" in a comment only. Terms for the same acts: Why / Reason; Asked by / Filed by / Requested by / Ordered by / Recorded by / Issued by; "They said" for a decision reason.
- **Suggested standard:** one glossary: "Store server" (not node), "Centre" (not Cloud), "Reason", "Requested by". Indonesian only inside the 7Soft BKK/BKM forms.

### [L] F29. Dead and stale code that will mislead the next refactor
- **Sheets:** `finance/payments.tsx:688,1074`, `finance/bank.tsx:691,1341`, `finance/unmatched-charges.tsx:269`, `finance/journal.tsx:439,765`, `finance-lab-2/journal-entry.tsx:162` (workspace width), all of `screens/finance-lab/*` (about 45 sheets).
- **Evidence (from code):** none of them is imported from a routed screen map. `Sheet`'s Dialog branch carries `inset-0 h-dvh pt-[env(...)]` classes that only the (now Drawer) phone branch would have used; `Fact`'s comment describes "Inter 12/18 sentence case ... mono micro-caps" while the code is 14px sentence case; `Sheet` doc says "Under 48rem it takes the whole screen".
- **Suggested standard:** delete the dead duplicates, and fix the comments, so a search for "journal sheet" finds one answer.

### [L] F30. Icons, links and ghost buttons in the body vary by author
- **Sheets:** GA hubs (icons on soft buttons: Archive, Move, Replace, Request disposal), MemberSheet (ghost `AppLink` "Their transactions"), Claims (plain primary), Employee (none).
- **Evidence (from code):** icon + label buttons exist only in `contracts/hub.tsx` and `assets/hub.tsx`; elsewhere text only. Link-style buttons are `AppLink variant="ghost"` (member), `text-accent hover:underline` spans (journal "the entry it answers", bill "Journal"), and mono accent links (Window sheet).
- **Suggested standard:** no icons in sheet buttons except a leading plus on "Add". One link style for record cross-links (accent, number shown).

### [L] F31. Confirm dialog on a phone stacks full-width buttons the other way round
- **Sheets:** every `ConfirmButton`/`Dialog`.
- **Evidence (from code):** `dialog.tsx:111`: `max-md:flex-col-reverse max-md:[&>*]:w-full` puts Confirm above Cancel, ghost-styled Cancel (bordered) vs the quiet Cancel in Sheet footers; the desk uses a right-aligned pair. Sheet footers on a phone are side by side.
- **Suggested standard:** same footer component for sheet and dialog: side by side, Cancel quiet left, primary right.

### [L] F32. Long titles and wide badges fight for one line
- **Sheets:** Asset hub (badge "Not yet assessed by Finance" + status), Contract hub (StandingPill + "Archived"), Repair ("title" + stage), Attendance PersonSheet.
- **Evidence (from code):** the title row is `flex min-w-0 items-center gap-2.5` with the title `truncate` and the badge `shrink-0`, so a 200px badge on a 414px phone leaves about 120px for the name. No tooltip on the truncated title. Not reproduced (no rows).
- **Suggested standard:** badge moves under the title on phone; title wraps to two lines before it truncates.

### [L] F33. /me (employee app) uses its own kit and different words for the same acts
- **Sheets:** `/me/leave/new`, `/me/attendance/correction`, `/me/attendance/swap`, `/me/pay/claims` (pages), `me/profile.tsx:201` (a normal Sheet).
- **Evidence (from code):** own `Panel`, `Row`, `Loading` ("Loading...", not "Reading ..."), `Failure`; verbs "Send request", "Send", "Send to the store head", "Send", "File and send" vs HR-side "File request", "File correction", "Propose it", "File and send it". The `Panel` there is a card, unrelated to `ui/dialog` `Panel`.
- **Suggested standard:** decide whether `/me` is a separate product (then document it) or reuse the hub verbs and `queryState` copy.

### [L] F34. SHEET_PARAMS has keys with no sheet and one key serving two sheets
- **Sheets:** `notifications`, `hireProposal`, `applicant`, `grievance`, `exitInterview`, `fnf`, `terminal` (no consumer in my area), `asset` (GA hub and Finance AssetSheet, the same word for two different sheets), `account` (Chart of accounts and General Ledger).
- **Evidence (from code):** `lib/sheets.ts` vs the `useSheet(...)` map above.
- **Suggested standard:** prune keys with no sheet; one key = one sheet component (ties to F3).

### [L] F35. The Facts vocabulary for "who and when" varies on every sheet
- **Sheets:** all with provenance facts.
- **Evidence (from code):** "Posted by / Posted at", "Recorded by / Recorded at", "Filed / Filed by", "Asked by / Asked at", "Ordered by", "Created by / Created", "Closed by / Closed at", "Handed over", "Paid", "Held by ... on". The same fact is one Fact in some sheets ("Handed over: 4 Oct 2026 · name") and two in others.
- **Suggested standard:** one "provenance" line under the facts: "<Action> by <Full name> · <date, time>", produced by one component.

---

## 4. Already good: the references to copy

| Sheet | Why |
|---|---|
| **Contract hub** (`contracts/hub.tsx`) | The only sheet that fills the whole anatomy: mono contract number, party as title, "type · site" caption, one badge slot, `tabs`, `subject`, an action form that lands in the footer. Its flaws (heading "Details" repeated under the tab, two chips in the badge, Archive in the header) are small. |
| **Attendance PersonSheet** (`people/attendance-days.tsx:1294`) | Correct use of `width="table"` for a 6-column table, `tabs` prop, caption with the span, header badge; flaw: Title Case heads and uppercase eyebrows. |
| **FormSheet** (`people/settings-parts.tsx`) | The best footer: danger left, quiet Cancel, primary right, read-only role gets "Close"; used by about 30 settings editors. Flaw: error Banner at the bottom of the body, "Submit" default. |
| **DataRequestSheet / ChangeSheet** (`people/changes.tsx:465,592`) | Header badge, footer Reject (danger) / Approve (primary), required reason field in the body; the model for the approval sheets once Facts and KeyValue are unified. |
| **LeaveSheet** (`people/time-off.tsx:491`) | Header badge for the state, "Name · kind" title. Flaw: footer on phone only, raw request id. |
| **Reprimand letter** (`people/reprimands.tsx:264`) | Header badge, footer Close / Revoke letter on every device. |
| **Employee head** (seen) | `HO-0006` / full name is the right id/title pair; Postings table stacks cleanly on phone. |
| **PeriodSheet** footer (seen) | Inline two-step "Seal 412 entries? Nothing can be posted ... Cancel / Seal" is clear and keeps the user in place; reusable if it becomes the shared confirm. |
| **BillSheet footer** (`supplier-bills.tsx:1480`) | One primary, with the reason it may be disabled stated beside it. Copy only the primary, not the sentence. |
| **Window/sale TotalsLadder**, `MiniTable`, `Lifecycle` | Numbers right-aligned and tabular; the ladder reads as a sum. |
| **ConfirmButton** (`dialog.tsx`) | Waits on the write, shows the failure under the question, phone drawer; use it for every irreversible act. |

## 5. Proposed ONE record-sheet anatomy

```
Sheet  (rail 47.5rem | wide 56rem for tabbed records with a wide table | table 64rem read-only grids)
  Phone: Drawer, 12px peek + grip, body scrolls, footer pinned above keyboard and safe area, 44px close.

HEAD  (one block, never actions)
  id        mono 15px, the human record number (HO-0006, JV-00000032). Omit if none. Never a uuid, a login, a period, a date span, or the title again.
  title     18px/600, one line, what the record is ("Annual leave · Nina Oktaviani"). Wraps to 2 lines on phone before it truncates.
  badge     exactly ONE Pill right of the title (under it on phone): ok / warn / bad / info (in motion only) / neutral. Nothing else status-like.
  caption   one muted line: kind · place · date.
  close     x, same component on every shell.

TABS  (only if the record has 2-5 content groups; Sheet `tabs` prop only; wrap on phone, never scroll sideways)
  ... content tabs ...
  Activity  appended last whenever the sheet has a `subject` (label "Activity" until comments exist).

BODY  (flex column, gap-6, nobody sets margins)
  1. Banner (only blockers: warn/bad; errors from the last save)
  2. Facts   2-col grid, label over value, sentence case, values wrap, <= 8 short values. One component (no KeyValue).
  3. SubHead sections, 15px/500, in a fixed order: Items (MiniTable) -> Totals (TotalsLadder) -> Timeline -> Notes (paragraph).
  4. Tables: MiniTable only; stacks on phone; money right-aligned and tabular; no frames inside the sheet.
  5. Names, never ids: Who / UnitName / PeriodName; dates "06 Oct 2026"; money in the house format.
  Edit: "Edit" in the footer swaps body to a form (Field labels sentence case, all required marked) and footer to [Cancel] [Save changes].

FOOTER  (the only home for actions; same on every width; 36px desk / 44px phone, one number agreed with the owner)
  [ destructive, left ]  ..........  [ Cancel, quiet ]  [ primary, right ]
  - One primary. Verbs: Save changes | Create <thing> | Approve / Reject | Post <noun> | the act's own verb.
  - Decision sheets: Reject (danger) + Approve, with a required "Reason" field in the body.
  - Irreversible or ledger-writing acts go through ConfirmButton; irreversible = danger style.
  - Pending = present participle ("Posting..."); disabled until valid; failure Banner at the top of the body.
  - Read-only reader: no verbs, one muted line naming who can act; footer shows only "Close".

STATES
  loading  "Reading the <thing>..." (one skeleton row)   empty  one `Quiet` line   error  top Banner
  open     URL key from lib/sheets.ts for every record sheet; close clears it; a dirty form asks before Esc / swipe / x.
  stacking a sheet opened from another shows "Back to <parent>" in its head.
```
