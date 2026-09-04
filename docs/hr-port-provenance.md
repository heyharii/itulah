# HR port provenance

The HR modules in this backend are adapted from two reference codebases rather
than written from scratch. This file records the source of each module, what was
changed, and what was deliberately left behind, so the copy stays auditable as
the codebases diverge.

## The two sources

| Source | Role |
|---|---|
| `~/Documents/fresh/crates/` | **Primary donor.** Split into `employee-domain`, `leave-domain`, `attendance-domain`, `employee-pay-domain`, and their `cloud-*` HTTP siblings. Already adapted once from the second source, and the adaptation is the reason it is preferred: it removed a duplicate authorization system. |
| `~/Documents/retail/final-product/backend/crates/` | The origin of the first. Larger (`hr-domain`, `cloud-hr`, `payroll-domain`, `cloud-payroll`), but carries `cloud-staff-auth` — a second directory of actors and role grants. Consulted only for parts the primary donor did not port, principally payroll runs. |

## Employment kernel

Source: `fresh/crates/employee-domain/src/{ids,error,audit,employee,assignment,contract,profile}.rs`

Destination: `backend/src/cloud/domain/employment/`

Direct ports, unchanged in substance:

- `employee.rs` — the employment state machine and the fold that validates it.
  `Employee::try_new` replays `history` and refuses a row whose claimed status
  the events do not produce.
- `profile.rs` — personal data as a fold over append-only amendments, with the
  same guarantee.
- `contract.rs` — `ContractKind` carries the end date inside the `Pkwt` variant
  and has nowhere to put one in `Pkwtt`, so neither statutory mistake is
  representable. `pkwt_run()` reports facts and draws no legal conclusion.
- `assignment.rs`, `ids.rs`, `error.rs` — ported as-is.

Adaptations:

- **Authorization.** The donor records a `cloud-authz` action key; the origin
  records its own `ActorRole`. We keep the action key as the recorded value and
  add `audit::required_role`, which maps a key to a rung of the existing
  `CASHIER < SUPERVISOR < ADMIN` ladder. The keys stay finer than the ladder can
  express — `people.profile.read` is distinct from `people.employee.read` even
  though both resolve to a rung today — so the day per-place grants arrive only
  that one function changes and nothing stored needs migrating.
- **Place.** The donor's `PlaceId` points at `authz_places`; ours points at
  `org_place` (see below). The origin's separate `StoreId` was not brought
  across in either hop.
- **Actor identity.** The donor's `SubjectId` becomes `ActorId`, and it holds an
  `app_user.username` rather than an `identity_subjects.id`. Two changes for two
  reasons. The rename is forced: `SubjectId` in this domain already means one
  tagged garment, and two meanings of one word in one namespace is how a person
  ends up joined to a shirt — the compiler caught it as an ambiguous glob import
  the moment the module was wired in. The username rather than the uuid is a
  choice: a recorded decision is read by people, and a name that was true when
  the decision was taken stays legible after the account is gone.
- **Crate layout.** The donor is a workspace of small crates; this backend is
  one crate. Each donor crate becomes a module under `src/cloud/`.
- **The word "profile" was taken.** The donor serves personal data — NIK,
  address, date of birth — at `/employees/{id}/profile`. `frontend-employee`
  already calls that exact path expecting something entirely different: employee
  number, job title, place, joining date, the card on its "me" screen. Both
  readings are reasonable; sharing one route is not, because the route they
  would share is the one carrying a national identity number. Shipping the
  donor's shape unchanged would have flipped the employee app's stand-in
  detection to "live", rendered every field as `undefined`, and delivered a NIK
  and a home address to a screen that never asked for either.

  So the surface is split. Personal data moves to
  `/employees/{id}/personal-data` behind `people.profile.read`; a new
  `EmploymentProfileView` serves `/employees/{id}/profile` behind
  `people.employee.read`, assembled from the employment record, the open
  assignment, `org_place` and the latest contract. It carries no NIK, no
  address and no contact details, because its audience is everyone who may read
  a rota. `joined_on` is read out of the first `HIRE` event rather than stored,
  so it cannot drift from the history that produced it.

  Three fields the employee app asks for have no source here yet —
  `preferred_name`, `department`, `manager_name`. They are omitted rather than
  faked; that file is a proposal awaiting generated types, not a specification.

Not ported: attendance, punches, rosters, corrections, payroll periods, kiosks.

## Schema

Source: `fresh/crates/cloud-persist/migrations/034_employee_v1.sql` and
`041_employee_profile_contract_v1.sql`

Destination: `backend/migrations/postgres/0060_employment.sql`

Adaptations:

- **`org_place` is ours, not the donor's.** The donor points assignments at an
  existing `authz_places` tree. Our `site` table is DC and STORE only, with a
  mandatory `edge_node_id`, because every row of it is a node that syncs. Head
  office is neither and has no edge node, so a new table carries the
  organisational geography: HO plus one row per site, sites keeping their own
  ids. `site` and `operational_pool` are untouched.
- **The account link is far shorter than the donor's.** The donor's migration
  moves a pre-existing, unvalidated `identity_accounts.employee_id` into an
  `employee_link_legacy` table before adding the foreign key. Our `app_user` had
  no such column, so the whole rescue is dropped: one `ADD COLUMN`, one foreign
  key with `ON DELETE RESTRICT`, one unique partial index.
- **Table names are singular**, matching `app_user`, `site`, `article`.
- **Migration numbering.** HR occupies `0060+`. The 0047–0059 range is left to
  the finance lane, which was writing `0050_ledger` and its successors in
  parallel; two migrations sharing a number is a collision `sqlx::migrate!`
  refuses.
- The donor's reasoning comments were kept, including the UU 13/2003 art. 59
  constraint on PKWT and the note on why NIK is deliberately not unique.

## Attendance policy

Source: `fresh/crates/attendance-domain/src/policy.rs`, plus the handful of
supporting types it needs (`Minutes`, `PolicyId`, `PolicyVersion`) and the
policy half of `AttendanceError`. Migration `046_attendance_policy_v1.sql`.

Destination: `backend/src/cloud/domain/attendance/`, migration
`backend/migrations/postgres/0061_attendance_policy.sql`,
`postgres/attendance.rs`, `http/attendance.rs`.

Ported because it is the one half of attendance that needs no clock: head
office can decide what lateness means before anything is punching. The punches,
rosters, corrections and kiosks that consume it wait on an unanswered product
question — where clock-ins come from.

Kept as-is: the effective-dated schedule, the refusal of overlaps and of
anything following an open version, **gaps allowed and never filled**, the two
ceilings (eight hours of lateness grace, one hour of double-tap window), and
above all the absence of a default. A date no version covers has no policy.

Adaptations:

- **Supporting types come along rather than being imported.** The donor keeps
  `Minutes`, `PolicyId` and `PolicyVersion` in `attendance-domain`'s shared
  `time`/`ids` modules alongside forty other identities this slice does not
  use. They live in `policy.rs` here and move out when punch and roster arrive
  — which is a rename, not a redesign.
- **One action-key space.** `people.attendance_policy.set` joins the employment
  keys in `domain::employment::audit`, and `required_role` maps it like the
  rest. A second mapping would be a second answer to "may they".
- **Reading needs no key.** The donor gates the read behind a grant. Here any
  signed-in caller may read the policy: somebody measured against a tolerance
  is entitled to know it, and a rule kept from the people it governs is a trap.
- **Writes are always open-ended, and supersede.** `POST` appends a version
  starting on a given date and closes the currently open one the day before, in
  one transaction. A version backdated behind the open one is refused with a
  409 rather than written — accepting it would store a schedule that refuses to
  load, leaving the rules unreadable until somebody edited SQL.
- **Table name singular** (`attendance_policy`), and a unique partial index
  enforces at most one open version, which the donor left to the domain alone.

## Not yet ported

| Area | Donor source | Blocked on |
|---|---|---|
| Salary structure and payroll identity | `employee-pay-domain`, `cloud-employee-pay`, migration 042 | nothing — buildable now |
| Overtime | `cloud-overtime`, migration 045 | nothing — buildable now |
| Attendance corrections | `attendance-domain`, `cloud-attendance`, migration 044 | needs punches, and the punch source is undecided |
| Payroll runs | second source only (`payroll-domain`, `cloud-payroll`) | needs attendance and salary structure first |

## One known wire mismatch

`frontend-employee` calls `GET /api/v1/employees/me/pay` expecting a monthly
payslip: `period_start`, `gross_idr`, `deductions_idr`, `net_idr`, `lines[]`.

The donor serves the same path with an effective-dated pay *agreement*:
`effective_from`, `base`, `allowances[]`, `statutory_base`. Its own docs are
explicit — *"A salary is a history, not a number"*, and *"What this crate will
not do: compute anything statutory."*

Same path, different meaning. This is the only mismatch found between the
employee app and the donor; every other route matches path for path, with
`cancel`↔`withdraw` and `acknowledge`↔`consent` the only naming differences.
When salary structure lands, one of the two has to give up the route name.

## Holiday calendar

Source: `fresh/crates/holiday-domain` and `cloud-holiday`, migration
`040_holiday_calendar_v1.sql`.

Destination: `backend/src/cloud/domain/holiday/`, `postgres/holiday.rs`,
`http/holiday.rs`, migration
`backend/migrations/postgres/0101_a_day_off_is_counted_not_assumed.sql`.

Kept as-is, because all of it is load-bearing: the three kinds and the fact
that only *cuti bersama* consumes annual leave; the refusal of a regional day
that names nowhere and of a national day narrowed to some places; the stored
set being what was **published**, with the set in force replayed from
append-only amendments rather than stored beside them; and
`as_published_at`, which is what makes "the calendar March payroll was settled
under" answerable in June.

Adaptations:

- **One authority type.** The donor carries its own; amendments here record
  `employment::Authorization`, and `authorizes_holiday_change` joins the gates
  `Authorization` already re-checks on decode.
- **One action key for publishing and amending.** `people.holiday.set`, rather
  than the donor's `people.holiday_calendar.publish` plus a second for
  amendments. Adding a *cuti bersama* in March changes what people are owed
  exactly as much as publishing the year in January did — and usually more,
  because by then the year is running.
- **Reading needs no key at all.** The donor gates it. Here any signed-in
  caller may read a calendar, for the reason the attendance policy's read needs
  none: somebody planning leave has to know which days are red before they can
  ask for any.
- **`places` is a list on the wire**, empty meaning nationwide, rather than the
  donor's tagged enum. Unambiguous only because a scope naming no places is
  refused — `[]` cannot mean "observed nowhere", because no such holiday exists.
- Table name singular (`holiday_calendar`).

## Leave

Source: `fresh/crates/leave-domain` and `cloud-leave`, migration
`043_leave_v1.sql`.

Destination: `backend/src/cloud/domain/leave/`, `postgres/leave.rs`,
`http/leave.rs`, same migration `0101`.

The five properties worth the port, all kept:

1. **A balance is a fold, never a stored number.** There is no balance column
   anywhere and no setter. The implementation the donor itself replaced kept a
   balances table beside the ledger, so a crash between two statements parted
   them silently and for ever.
2. **Unratified policy has no constructor.** Four questions — how much carries
   forward, when it expires, whether encashment needs a second approver, whether
   protected leave keeps accruing — have no defaults. A deployment that has not
   decided gets `PolicyNotRatified` naming the open question.
3. **Not every kind of leave draws on a balance.** UU 13/2003 art. 93 makes
   *cuti sakit* an entitlement rather than a withdrawal, art. 82 the same for
   maternity, and art. 93(4) bounds *alasan penting* per occurrence. Asking a
   balance of those is a malformed question, not one whose answer is zero.
4. **Days are exact integers** — hundredths of a day, for the reason money is
   an integer of the smallest unit.
5. **An approval and its deduction happen together, or neither happens.**
   `LeaveRequestState::Approved` carries the ledger entry id, `approve` is the
   only way to reach it, `decide_request` writes both in one transaction, and
   `leave_request_deduction_only_when_approved` refuses the halfway row. Three
   guards, because the first two are code.

Adaptations:

- **The event vocabulary is a CHECK constraint.** The donor leaves
  `leave_ledger_entry.event` unconstrained; the eight codes are spelled out in
  0101 for the reason every other vocabulary in this schema is.
- **`leave_request.place_id` is a real foreign key.** The donor has no place
  table to point at. Which shop a request belongs to is what bounds the manager
  who may decide it, so it is `org_place(id)` here — and the partial index on
  `(place_id, from_date) WHERE state = 'PENDING'` is exactly the queue query.
- **The policy table is read.** The donor writes `leave_policies` and never
  loads it; `load_policies` folds the whole timeline and `approve` resolves the
  generation in force on the day the leave *starts*.
- **Four action keys rather than the donor's role vocabulary.**
  `people.leave.decide` matches the donor's; `people.leave.request` and
  `people.leave.request_own` are the two halves of asking (a manager filing on
  somebody's behalf, and somebody asking about themselves — the second at the
  CASHIER rung, bounded to their own record); `people.leave.grant` is new and
  covers putting days *into* a balance, which is head office's and is not
  something a manager who can decide requests should also be able to do.
  `people.leave_type.set` covers both the kinds and the policy, because they
  are one decision.
- **There is no route that spends a balance.** `POST /leave-balances` refuses
  `USAGE` outright. A "just adjust it" path would put the halfway state back
  within reach of one careless caller.
- **`withdraw`, not `cancel`.** The employee app's proposal used the second
  word; the mismatch recorded below is resolved in the server's favour, because
  the distinction the donor draws is worth keeping — only the requester may
  withdraw, and anybody else must *reject* under their own name.
- **The employee app's `LeaveType` was two things.** Its proposal fused the
  kind and the reader's own balance. The server keeps them apart — a kind is
  one row for the company, a balance is a fold over one person's ledger, and
  most kinds have no balance at all — so `frontend-employee` joins the two reads
  in `useLeaveEntitlements` and is honest about the kinds that have none.
- Table names singular.

Not ported from `cloud-leave`: its in-memory store, and its own authority
directory.

## A gate that was one rung too high

`domain::auth::required_role(method, path)` derives a minimum rung from the
path, ahead of any handler. Its fall-through makes every unlisted write
SUPERVISOR — which silently made "ask for your own leave" a supervisor act, and
the employee app got a 403 before `people.leave.request_own` was ever consulted.

`POST /api/v1/employees/me/…` is now CASHIER. That widens the *path* gate and
grants nothing: every handler under `/employees/{id}/…` re-checks its own action
key, so `POST /employees/me/employment` is still `people.employment.change` and
still ADMIN. What it removes is a second gate that could not tell changing your
own address from ending your own employment, and answered the same to both.

## Migration numbering, as it actually happened

HR was given the `0100–0119` block. `0097_a_login_leaves_with_the_person.sql`
sits outside it: it was written by the account-provisioning lane and was already
applied to the dev database by the time this was noticed, and renumbering an
applied migration changes its checksum and stops the node for every lane. It
keeps its number.

`0100` was taken by a proposed-hires feature that the owner then decided against
(*"kita ga perlu hiring menu"*, 2026-09-04). It was removed before it reached
git, so the number is free but is deliberately not reused: leave and holiday are
`0101`.

