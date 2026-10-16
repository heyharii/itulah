# People / HR — use-case catalogue (domain tag `people`)

Branch map: `maps/people.md`. Helpers: `support/people.ts` (hire chain as in `scripts/demo-seed.sh`, leave/overtime/claim/benefit/letter/change helpers, `pickDay`/`pickOne`/`selectOne` for the hub's own controls, `freeRunSlot` for payroll). Tests: `hub/people/*.e2e.ts`. Sessions: `rina` files, `admin` decides (the filer never decides). Every test mints its own employee (`Uji <tag>`); the seeded people are never touched. Payroll runs use stores 05–13 in Feb–Aug of the current year (never store-01).

Status key: **pass** = green on the rig; **BUG** = red on purpose, tagged `bug`, asserts the right behaviour.

## Employees

| ID | Branch | Test | Status |
|---|---|---|---|
| HR-01 | HR rail opens People on Overview & Requests; the sidebar lists the groups | directory.e2e.ts | pass |
| HR-02 | Directory row: name, status Working, unit, job, contract, login None | directory.e2e.ts | pass |
| HR-03 | Registered-but-not-hired person is "Accepted, not started" / "Not enrolled yet" | directory.e2e.ts | pass |
| HR-04 | Row opens the employee sheet: facts, 10 tabs, employment history, postings | directory.e2e.ts | pass |
| HR-05 | Contracts tab: PKWT in force, run of fixed terms (361 days) | directory.e2e.ts | pass |
| HR-06 | Leave and Claims tabs show the person's own records | directory.e2e.ts | pass |
| HR-07 | Discipline tab lists a letter; Position tab "Not placed yet" | directory.e2e.ts | pass |
| HR-08 | Search by name; empty result sentence | directory.e2e.ts | pass |
| HR-20 | Add employee sheet (full form incl. date pickers, unit, PKWTT, salary) → active person, contract, posting, pay | employee-actions.e2e.ts | pass |
| HR-21 | Suspend then Reinstate; the login closes with the suspension | employee-actions.e2e.ts | pass |
| HR-22 | Terminate → Terminated, Exit tab appears, login closed, not selectable | employee-actions.e2e.ts | pass |
| HR-23 | Amend personal data (one field, trail) | employee-actions.e2e.ts | pass |
| HR-24 | Add a contract (PKWT → PKWTT renewal) | employee-actions.e2e.ts | pass |
| HR-25 | PKWT without an end date is blocked by the form | employee-actions.e2e.ts | pass |
| HR-26 | Correct the employee number; old number kept | employee-actions.e2e.ts | pass |
| HR-27 | The login: issue a new one, sign in with it, release it | employee-actions.e2e.ts | pass |
| HR-28 | Where they are posted (second posting from a date) | employee-actions.e2e.ts | pass |
| HR-30 | Pay tab: agree new pay supersedes the old from its date | employee-actions.e2e.ts | pass |
| HR-31 | Tax and BPJS: PTKP status change | employee-actions.e2e.ts | pass |
| HR-32 | Where the money goes: bank, number (masked), holder | employee-actions.e2e.ts | pass |
| HR-150 | Exit tab of a leaver: interview opened by the termination waits to be conducted | exit.e2e.ts | pass |
| HR-151 | A completed exit interview and a full & final statement show on the Exit tab | exit.e2e.ts | pass |
| HR-151b | Second exit interview for the same leaver: answers "stored interview does not hydrate" instead of a sentence | exit.e2e.ts | **BUG** |
| HR-152 | A terminated person cannot be terminated again or suspended | exit.e2e.ts | pass |
| HR-153 | Assignment to a unit that does not exist is a 500 "database operation failed" | exit.e2e.ts | **BUG** |
| HR-154 | Duplicate employee number refused | exit.e2e.ts | pass |
| HR-155 | Overlapping PKWT and a second HIRE refused | exit.e2e.ts | pass |

## Time

| ID | Branch | Test | Status |
|---|---|---|---|
| HR-10 | Approve leave in the sheet → balance charged (as of today) | time-off.e2e.ts | pass |
| HR-11 | Reject leave, reason recorded, balance whole | time-off.e2e.ts | pass |
| HR-12 | The filer's own filing is not in their Waiting list | time-off.e2e.ts | pass |
| HR-13 | Request leave sheet (employee picker, kind, From date) | time-off.e2e.ts | pass |
| HR-14 | Time Off Balances list and person sheet | time-off.e2e.ts | pass |
| HR-15 | Team Calendar bar for a waiting request | time-off.e2e.ts | pass |
| HR-16 | Approving more days than the balance: refused in the sheet with the figures | time-off.e2e.ts | pass |
| HR-90 | Order overtime sheet → AWAITING_CONSENT | time-ops.e2e.ts | pass |
| HR-91 | Order sheet: only the employee can answer; take the order back with a reason | time-ops.e2e.ts | pass |
| HR-92 | After the employee agrees, the order stays listed with its authorized minutes (the list is `/awaiting` only, so it vanishes) | time-ops.e2e.ts | **BUG** |
| HR-93 | Order past the daily cap refused | time-ops.e2e.ts | pass |
| HR-94 | Roster opens and shows a planned shift (page crashes: "day is not defined") | time-ops.e2e.ts | **BUG** |
| HR-95 | Roster day stored with shift hours and revision trail (API) | time-ops.e2e.ts | pass |
| HR-96 | Attendance day: stations, File correction sheet | time-ops.e2e.ts | pass |
| HR-97 | Org Chart lists the unplaced person; Place someone is offered | time-ops.e2e.ts | pass |
| HR-98 | Onboarding / Offboarding switches | time-ops.e2e.ts | pass |
| HR-99 | Overview "Needs attention" carries an unanswered overtime order | time-ops.e2e.ts | pass |
| HR-140 | Leave decided from the Overview queue | requests.e2e.ts | pass |
| HR-141 | Roster swap approved → shifts exchanged | requests.e2e.ts | pass |
| HR-142 | Roster swap refused → plan unchanged | requests.e2e.ts | pass |
| HR-143 | Attendance correction approved by a different person | requests.e2e.ts | pass |
| HR-144 | Filer cannot approve their own correction | requests.e2e.ts | pass |
| HR-145 | Leave over the balance: accepted at filing, refused at approval with the figures | requests.e2e.ts | pass |
| HR-146 | Grievance lifecycle (no hub screen: API only) | requests.e2e.ts | pass |

## Money

| ID | Branch | Test | Status |
|---|---|---|---|
| HR-50 | File claim sheet | finance.e2e.ts | pass |
| HR-51 | Approve a claim (second person), sanction recorded | finance.e2e.ts | pass |
| HR-52 | Sanction a lower figure | finance.e2e.ts | pass |
| HR-53 | Refuse (state REJECTED) | finance.e2e.ts | pass |
| HR-54 | Send back → DRAFT | finance.e2e.ts | pass |
| HR-55 | Filer cannot decide their own claim | finance.e2e.ts | pass |
| HR-56 | Filer takes a waiting claim back | finance.e2e.ts | pass |
| HR-57 | Pay from petty cash → PAID | finance.e2e.ts | pass |
| HR-58 | Claim type: define, cancel | finance.e2e.ts | pass |
| HR-59 | Yearly allowance for a kind | finance.e2e.ts | pass |
| HR-60 | Grant a loan from the employee sheet (500: migration 0701 dropped `advance_number_seq`, `pay.rs::grant_loan` still uses it) | finance.e2e.ts | **BUG** |
| HR-61 | Loans list shows the loan (same cause) | finance.e2e.ts | **BUG** |
| HR-80 | Benefit: Add (Added entry, who, why) | benefit.e2e.ts | pass |
| HR-81 | Benefit: Take off and Reset | benefit.e2e.ts | pass |
| HR-82 | Take off more than held: refused, nothing moves | benefit.e2e.ts | pass |
| HR-83 | Fill balances for several people at once | benefit.e2e.ts | pass |
| HR-84 | Benefit list: balances and Rp 0 for unfilled | benefit.e2e.ts | pass |
| HR-85 | Benefit settings screen lists statements | benefit.e2e.ts | pass |

## Payroll

| ID | Branch | Test | Status |
|---|---|---|---|
| HR-100 | Open run sheet (unit, month, why) → draft with one slip per person | payroll.e2e.ts | pass |
| HR-101 | Draft sheet: summary, slips, Send needs a reason → SUBMITTED | payroll.e2e.ts | pass |
| HR-102 | Head office approves a submitted run | payroll.e2e.ts | pass |
| HR-103 | Sender cannot approve own run | payroll.e2e.ts | pass |
| HR-104 | Send back returns it to the place | payroll.e2e.ts | pass |
| HR-105 | Second run for same unit+month refused | payroll.e2e.ts | pass |
| HR-106 | Payslip arithmetic: base, TER PPh 21 | payroll.e2e.ts | pass |
| HR-107 | Tax & BPJS report shows a draft run's people (the screen promises it; the API answers only approved runs) | payroll.e2e.ts | **BUG** |
| HR-107b | Tax & BPJS report after approval, Export CSV on | payroll.e2e.ts | pass |
| HR-108 | Empty month: sentence, Export CSV off | payroll.e2e.ts | pass |
| HR-109 | 1721-A1 year screen | payroll.e2e.ts | pass |

## Discipline and changes

| ID | Branch | Test | Status |
|---|---|---|---|
| HR-70 | Issue a letter (employee, level, text) | discipline.e2e.ts | pass |
| HR-71 | Revoke needs a reason; letter revoked | discipline.e2e.ts | pass |
| HR-72 | In force / All switch | discipline.e2e.ts | pass |
| HR-73 | A letter issued "today" (Jakarta) is active — server compares with the UTC date, so between 00:00 and 07:00 WIB it reads "Lapsed" and hides Revoke | discipline.e2e.ts | **BUG** (time-of-day) |
| HR-74 | New change (promotion) proposed | discipline.e2e.ts | pass |
| HR-75 | Approve a change with a decision reason | discipline.e2e.ts | pass |
| HR-76 | Reject leaves the record as it was | discipline.e2e.ts | pass |
| HR-77 | Filer cannot decide own change | discipline.e2e.ts | pass |

## Access

| ID | Branch | Test | Status |
|---|---|---|---|
| HR-40 | Job Roles lists the 16 built-ins with rung, holders, sections | access.e2e.ts | pass |
| HR-41 | Built-in role opened from the list: sections ticked, no Delete | access.e2e.ts | pass |
| HR-41b | Same role opened from `?role=HR`: form blank (Name empty, no sections) | access.e2e.ts | **BUG** |
| HR-42 | Custom role: edit sections, delete | access.e2e.ts | pass |
| HR-43 | Invite people sheet → link shown once, no login until accepted | access.e2e.ts | pass |
| HR-44 | Revoke a pending invitation; link dead | access.e2e.ts | pass |
| HR-45 | Renew: fresh link, old one dead | access.e2e.ts | pass |
| HR-46 | Pending list names role, unit, position | access.e2e.ts | pass |
| HR-47 | /join/{token}: greeting, username, password → signed in; link single-use | access.e2e.ts | pass |
| HR-48 | Mismatched passwords | access.e2e.ts | pass |
| HR-49 | Revoked / unknown link | access.e2e.ts | pass |
| HR-156 | Only an Admin can create a role | exit.e2e.ts | pass |
| HR-157 | Invitations need an existing role and unit | exit.e2e.ts | pass |

## Self-service (/me)

| ID | Branch | Test | Status |
|---|---|---|---|
| HR-110 | Profile home: greeting, waiting, leave balance, account | me.e2e.ts | pass |
| HR-111 | A cashier sees no HR and is refused People data | me.e2e.ts | pass |
| HR-112 | Request leave under their own name | me.e2e.ts | pass |
| HR-113 | Withdraw own request | me.e2e.ts | pass |
| HR-113b | Withdraw is offered on a request HR filed for them; the server always refuses it | me.e2e.ts | **BUG** |
| HR-114 | Overtime Agree | me.e2e.ts | pass |
| HR-115 | Overtime Decline is final | me.e2e.ts | pass |
| HR-116 | My Details: masked payroll identity, contract | me.e2e.ts | pass |
| HR-117 | Acknowledge a warning letter | me.e2e.ts | pass |
| HR-118 | New claim from the app | me.e2e.ts | pass |
| HR-119 | /me/pay shows the benefit balance | me.e2e.ts | pass |
| HR-120 | Clock in from the app | me.e2e.ts | pass |
| HR-121 | Change password | me.e2e.ts | pass |

## Screens

HR-130 (25 routes) and HR-131 (19 settings routes) in `screens.e2e.ts`: each opens on its heading without the error screen. `/people/roster` is the red one (same cause as HR-94).

## Branches without a test, and why

* **Import & export (CSV)** on the Employee List, **Import CSV** on One-offs: file pickers; nothing in the shared kit uploads from the rig's VM yet.
* **Settings screens' writes** (Company, Group, Departments, Levels, Attendance Rules, Shifts, Time Off Types, Holidays, Overtime Rules, Schedule, Components, Payslip, Absence, Rates, Checklists, Delegation, Employee App): they change company-wide rules the other domains' suites run on (shifts PAGI/SIANG, overtime caps, holidays, leave types). HR-131 only opens them.
* **THR, Finance hand-over of a run, payslip print/PDF, payslip password**: handed to the finance domain or print-only.
* **Org Chart placement write** (Position tab / Place someone), **onboarding checklist tasks**, **recruitment / hire proposals**, **performance, training**: no hub screen drives them on this build or they need seeded masters (departments/levels) that belong to the Settings screens above.
* **Phone layout of the People screens**: out of scope for this pass (desk viewport only).
* **Attendance fingerprint stations / device terminals**: no registered station on the rig (the screens say so, HR-96).
