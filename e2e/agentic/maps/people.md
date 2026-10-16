# People / HR (hub) and self-service — branch map (10 Oct 2026, from source + the running rig)

Paths are under `/Users/hari/Documents/itulah/frontend-hub/src`. Sidebar label on the top rail is **HR** (module id `people`, home `/people/overview`); the module is `screens/people/nav.ts`, screens map in `screens/people/index.ts`. Self-service is `screens/me/` (module "Profile"), the invite page is `screens/join/join-page.tsx` (public route `/join/{token}`, rendered by `App.tsx` before the signed-in shell).

**How a sheet is addressed.** A sheet is a URL search parameter (`lib/sheets.ts:470-500`): `?employee=<id>` (+ `#leave|claims|contracts|position|checklist|discipline|pay|loans|change` picks the tab), `?addEmployee=true`, `?invite=true`, `?role=<CODE>`, `?claim=<id>`, `?overtimeOrder=<id>`, `?payrollRun=<id>`, `?attendanceOf=<id>`. Tests deep-link instead of clicking through. Leave requests (`/people/leave`) open from the row, not the URL.

**Controls the hub draws itself** (none is a native element): `Select` = `combobox "<Field label>"` + `option`s in a portal; `PickOne` = typeable `combobox` + `option`; `Day` = a button named after the field, opening a calendar whose `textbox "Type …"` takes `yyyy-mm-dd` + Enter (`components/ui/day.tsx`). A `Field` with `required` adds " (required)" to the accessible name. Open sheets replace the page in the accessibility tree (only the dialog is listed). Money in `Rp 1.234.567`.

**Who sees what.** `usePeopleAudience()` (`screens/people/scope.ts`) → `employer` when `/employees/me/reach` says `EVERYWHERE` (rina, admin): the Change/Pay/Loans/Position/Discipline tabs and every "employer" row appear. Filing and deciding are different people everywhere: leave, claims, changes and payroll all refuse the filer as decider. The HR queue for the filer shows nothing of their own filings (`/leave-requests/pending` is empty for rina, 40+ for admin).

## 1. Employee List `/people` (directory.tsx)

| Branch | Where | API |
|---|---|---|
| List, search (unnamed `textbox`), filters (`Filter`), columns Number/Name/Status/Posted to/Job/Contract/Term Ends in/Login, status words `Working`, `Accepted, not started` (CANDIDATE), `Suspended`, `Terminated` | directory.tsx:150-420 | GET `/employees?q=&status=&unit=&…` → `{rows,total,facets,next_cursor}` |
| "Contracts running out" exception queue | directory.tsx:678 | GET `/employees/contracts/expiring` |
| Add employee (sheet): Employee number, Full name, NIK, Date of birth, Address, Join date, Unit, Employment status (PKWT/PKWTT), Contract ends, Job position, Grade, Base salary, PTKP; button `Add employee` | add-employee.tsx:187-340 | POST `/employees`, `/employment`, `/personal-data`, `/contracts`, `/assignments`, `/pay`, `/payroll-identity` |
| Import & export | import-export.tsx | CSV (not driven) |
| Employee sheet: facts (Posted to, Login, Job, Registered) + tabs Record · Leave · Claims · Contracts · Position · Checklist · Discipline · Pay · Loans · (Exit when TERMINATED) · Change | directory.tsx:824-1100 | GET `/employees/{id}`, `/contracts` |
| Record: employment timeline (`HIRE — CANDIDATE → ACTIVE`), postings table, number corrections | directory.tsx:945-1020 | |
| Contracts: PKWT/PKWTT rows, `In force`, "Run of fixed terms" (UU 13/2003) | directory.tsx:1041 | |
| Change › "What are you changing?" = Employment status (Transition HIRE/SUSPEND/REINSTATE/TERMINATE, Effective on, Reason, `Submit`) · Where they are posted (Place, From, Until, `Post them there`) · Add a contract (Kind, Starts on, Ends on, Position, Grade, `Submit`) · Correct the employee number (`Correct the number`) · The login (Issue a new one / Link one that exists; `Submit`, `Release the login`) · Amend personal data (Field, New value, `Amend`, trail) | directory.tsx:1119-2230 | POST `/employment`, `/assignments`, `/contracts`, `/code`, `/account/provision`, `/account`, `/account/release`, `/personal-data/amendments` |
| Pay tab: Agreements list, Payroll identity, Agree new pay (`Agree it`), Tax and BPJS (`Save`), Where the money goes (`Record it`, masked `••••••1234`), Reset payslip password | pay.tsx | POST `/employees/{id}/pay`, `/payroll-identity`; GET `/payslip-password` |
| Loans tab: Grant a loan (Amount, Instalments, First month off pay, For, Why, `Grant loan`) | loans.tsx | POST `/employees/{id}/loans` → **500 (bug)** |
| Position tab: Place from a date (Department, Job level, Grade, Reports to, `Save placement`) | placement.tsx | |
| Checklist tab: `Open onboarding checklist` / `Open separation checklist` | checklist.tsx | |
| Discipline tab: letters, `Revoke`, "Issue a letter" | discipline.tsx | |

Other People screens reached from the list: Org Chart (`org-chart.tsx`, "Not placed" list, `Place someone`), Onboarding/Offboarding (`onboarding.tsx`/`offboarding.tsx` → checklist-board: `Start onboarding`, `In progress`/`Completed`).

## 2. Time

| Screen | Route | Labels | API |
|---|---|---|---|
| Time Off Requests | `/people/leave` (time-off.tsx) | `Waiting (n)` / `By month`, `Search requests`, rows → sheet `<name> · <kind>`: Why, `Approve`, `Reject`; `Request leave` sheet: Employee, Kind of leave, From, To, Why, Evidence, `File request` | GET `/leave-requests/pending`; POST `/employees/{id}/leave-requests`, `…/{rid}/approve|reject|withdraw` |
| Time Off Balances | `/people/leave-balances` | `Search people`, unit filter, row sheet | GET `/employees/{id}/leave-balances` (**as of today**: approved leave in the future is not yet deducted) |
| Team Calendar | `/people/calendar` | month `‹ ›`, bars titled `<Leave> · waiting|approved` | GET `/leave-requests`… |
| Attendance | `/people/attendance-days` | day nav, `File correction` (sheet: Employee, Day, What was missed, Arrived at, Left at, Why), Stations, `Fingerprints` | GET `/attendance/today`, `/attendance-corrections`; POST `/attendance-corrections/{id}/decision` |
| Overtime | `/people/overtime` | cap line "Up to 4h a day and 18h a week", table, `Order overtime` (Who, Date, Kind of day, Minutes, Why; `Order it`); sheet `?overtimeOrder=` says "Only <name> can answer this", `Take the order back` | POST `/employees/{id}/overtime-orders`, `…/withdrawal`; the employee answers `POST /employees/me/overtime-orders/{id}/consent {agreed,reason}` |
| Roster | `/people/roster` | week nav, shift picker, Why gate | GET `/roster`, POST `/employees/{id}/roster` — **screen crashes ("day is not defined")** |

## 3. Money

| Screen | Route | Labels | API |
|---|---|---|---|
| Claims | `/people/claims` | `Waiting`/`All`; `File claim` (For, Kind of expense, Spent on, Amount, What for, Why this claim; `File and send it`); sheet `?claim=`: lines, **Decide** (per-line sanction spinbutton, Why, `Approve`/`Refuse`/`Send back`), `Send it in`, `Take it back`, `Pay from petty cash` | POST `/expense-claims`, `…/submission|decision|withdrawal|returnal|payout` |
| Loans | `/people/loans` | `Grant loan` | GET `/payroll/loans`, POST `/payroll/loans/{id}/stop` |
| Claim Allowances | `/people/claim-allowances` | `Set allowance` (Kind, From, A year per person, Why; `Save allowance`) | |
| Claim Types | `/people/claim-types` | `New type` (Code, Name, Expense category; `Define it`), row sheet `Cancel it` | `/expense-claim-types` |
| Benefit › Balances | `/people/benefit` | `Search people`, row sheet (Balance, `Add`/`Take off`/`Reset`, movement table `Added|Taken off|Reset|Spent at the till|Returned`), `Fill balances` (everyone shown / People / Action / Amount / Why) | GET `/benefit/balances`, POST `/benefit/adjustments {action,amount_minor,employee_ids,reason}`, GET `/employees/{id}/benefit`; taking off more than held is a 409 sentence |
| Settings › Benefit | `/people/settings/benefit` | statements list "On/Off · n min", `Edit` | GET/POST `/benefit/settings` |

## 4. Payroll

`/people/payroll` (payroll.tsx): filters Every unit / Every state, `Open run` (Unit, Month `yyyy-mm`, Why). Run sheet `?payrollRun=PR-yyyy-mm-Cnnn`: state words `Being built by the place` → `Waiting on head office` → approved; THR block; Summary; Slips table (click a row for the payslip); `Recalculate`, `Send to head office`, `Approve`, `Send back`, Finance hand-over. Endpoints: POST `/payroll/runs`, `…/{id}/submission|approve|reopen|rebuild`, GET `…/slips`. One run per unit and month; the sender cannot approve. `/people/tax-report` ("PPh 21 & BPJS", `Month` textbox, KPIs People paid / PPh 21 / BPJS, `Export CSV`) ← GET `/payroll/tax-report?period=`; `/people/annual-tax` (1721-A1, `Tax year`); `/people/one-offs` (File one-off / Import CSV); `/people/reports`.

## 5. Discipline and changes

* Reprimands `/people/reprimands`: `In force`/`All`, `Issue letter` (Employee, Level SP 1/2/3 + reprimand, Issued on, In force for months 1–12, What was done, Why; `Submit`), letter sheet `Revoke letter` (Why revoke it). POST `/employees/{id}/warning-letters`, `/warning-letters/{id}/revocation`. The employee acknowledges on `/me/details` (`I have received this letter`).
* Transfers & Changes `/people/changes`: `Employment`/`Detail requests`, `Waiting`/`All`, `New change` (Employee, Change Transfer/Promotion/Salary/Separation, To / New position / New grade / New base salary, Effective on, Why; `Propose it`), row sheet `<Kind> · <name>`: Reason for the decision, `Approve`/`Reject`. POST `/employees/{id}/change-proposals`, `/change-proposals/{id}/decision {approved,reason,note}`.

## 6. Access: roles, invitations, join

* Job Roles `/people/job-roles` (job-roles.tsx): 16 built-in roles (OWNER, ADMIN, FINANCE, MERCHANDISE, PROCUREMENT, OPERATIONS, INVENTORY, STORE_MANAGER, STORE_SUPERVISOR, CASHIER, STORE_STAFF, MARKETING, HR, GA, AUDITOR, IT), each a button "`<Name> <CODE> Built in <description> <RUNG> · n holders <sections>`" (`No sections` for cashiers). Sheet `?role=`: Name, Description, Rung, Store servers, Read only, Sections checkboxes, Flow roles, `Submit`; `Delete` only for custom roles with no holders. API `/roles` GET, PUT/DELETE `/roles/{code}` (Admin-only; PUT creates a custom role with `name`+`rung`).
* Invitations `/people/invitations` (invitations.tsx, invite-sheet.tsx): tabs Pending/Accepted/Expired/Revoked, unit filter, per-row `Renew` / `Revoke` (rows are plain divs, not table rows); `Invite people` sheet (Name, Role, Unit, Position, `Add another person`, `Submit`) → "Send these links" with `Copy`/`WhatsApp` (link shown once). `Renew` sheet "Renew <Name>’s link" → `Renew link`. API: POST `/invitations {people:[{name,role_code,unit_id,position}]}` returns `link = {origin}/join/{token}` (the only moment the token exists), GET `/invitations?status=`, POST `/invitations/{id}/revoke|renew`, public GET/POST `/invitations/accept/{token}`.
* Join `/join/{token}` (join-page.tsx): "Welcome to <company>", "<name>, invited as <role> at <unit>", Username (suggested), Password (≥8), Confirm password ("The two do not match."), `Set password and sign in`; dead links: heading "You’ve been invited", the server sentence, "Ask your admin for a new link."

## 7. Self-service `/me` (screens/me)

`/me` (greeting, Waiting on you, Today, Leave balance + Apply, Account + `Change password`/`Sign out`), `/me/attendance` (Clock: `Clock in`/`Clock out`, Last 14 days, Fixes you asked for), `/me/attendance/correction`, `/me/attendance/swap`, `/me/leave` (Your balance, Your requests + `Withdraw`, Who's off · next 2 weeks), `/me/leave/new` (Kind of leave, First day, Last day, Why, `Send request`), `/me/overtime` (Orders, `Agree`/`Decline`), `/me/pay` (Your pay, Benefit, Your loans, 1721-A1), `/me/pay/slip`, `/me/pay/claims` (My claims, `New claim` form, `Send`), `/me/details` (You, Contract, Payroll details part-masked, Days off, Warning letters + `I have received this letter`, `Ask to change`, This app). The owning endpoints are `/employees/me/*`.

## 8. Settings (smoke only)

Company & NPP, Group & Business Units, Departments, Job Levels & Grades, Attendance Rules, Mobile & Locations, Shifts & Breaks (PAGI/SIANG), Time Off Types, Holidays, Overtime Rules, Schedule & Pro-rate, Components & Structures, Payslip, Absence Deduction, BPJS & Tax Rates, Benefit, Onboarding Tasks, Approval Delegation, Employee App — each is `/people/settings/<slug>`; they change company-wide rules the other suites rely on, so the suite only opens them.

## 9. Facts found while mapping the rig (not in the source)

* Unit ids are `ho`, `store-01`…`store-13`, `store-c014`… (other agents add `Uji …` stores); an assignment to an unknown unit answers `500 database operation failed`.
* The hub formats dates in Jakarta (UTC+7); the server judges a warning letter's start against the UTC date (letters issued 00:00–07:00 WIB are "not active" for hours).
* `advance_number_seq` is dropped by migration 0701, yet `postgres/pay.rs::grant_loan` still calls `nextval('advance_number_seq')`.
