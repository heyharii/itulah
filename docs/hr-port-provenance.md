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

**Resolved 2026-09-04.** The Rust kept `/pay` for the agreement, and payslips
got their own route at `/employees/{id}/payslips`. The employee app changed its
one path. Neither meaning had to give up its name, because they were never one
question: what somebody is *on* and what they were *paid in April* differ every
time a raise lands mid-year.

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

## Overtime

Source: `fresh/crates/overtime-domain` and `cloud-overtime`, migration
`045_overtime_v1.sql`.

Destination: `backend/src/cloud/domain/overtime/`, `postgres/overtime.rs`,
`http/overtime.rs`, migration
`backend/migrations/postgres/0103_overtime_is_ordered_and_agreed.sql`.

The rule worth the port, and the reason the crate exists: **overtime needs two
consents, not one.** PP 35/2021 art. 26(2) requires both a written instruction
from the employer and the worker's written agreement. Almost every system models
this as a single manager approval, and that shape produces exactly the outcome
the rule exists to prevent — hours worked because a supervisor said so, with no
record that anyone asked.

So the two acts are recorded under **disjoint** action keys
(`people.overtime.order`, `people.overtime.consent_own`), on two routes that
never accept each other's key, and `authorized_minutes()` is `Some` only in
`AGREED`. Kept exactly: the terminal `DECLINED` with no path out of it, the
refusal to withdraw an order the worker has already agreed to, the caps as
ratified configuration with no default, `>` rather than `>=` on both caps, and
the weekly check counting only agreed orders so an unanswered one cannot consume
somebody else's headroom.

Adaptations:

- **The caps are a table, and the donor argues against one.** Its reasoning is
  that a table makes the caps "a row somebody can leave empty, and an empty row
  reads as *no limit* to the first query that forgets to check". The objection
  is right and the conclusion does not transfer: that codebase installs them
  from configuration at boot and this one has no such mechanism — the equivalent
  here would be an environment variable, which is a row somebody can leave empty
  with less to see it by. So `overtime_policy` exists, both columns are NOT NULL
  and positive, nothing seeds a row, and **no row means no policy**, which
  refuses every order by name. The failure being guarded against is a cap that
  silently reads as unlimited; the absence of a row is not a number.
- **`people.overtime_policy.set` is a new key.** Ratifying the caps is head
  office's, and its own grant rather than a mode of the ordering key: the
  manager who orders overtime must not be the one who decides how much of it is
  lawful.
- **Every gate is bounded by place.** The donor authorizes at
  `ResourceScope::Global` throughout, even though `place_id` is on every row and
  its partial index is keyed on it — the survey of the crate flags this as a
  gap. Here ordering, withdrawing and the awaiting-answer queue all pass through
  `Reach`, so a manager reaches their own shop and no other.
- **The consent route is bounded by the record, not the rung.**
  `people.overtime.consent_own` sits at CASHIER, where the ladder bounds nothing;
  the handler checks `Access::own`, so a cashier answering somebody else's order
  is refused. Reading it as a rung would let every cashier answer every order in
  the company.
- **`day_kind` is cross-checked against the holiday calendar.** The donor takes
  it as trusted context because it depends on neither calendar nor roster; we
  have the calendar, so an order that calls a published holiday an ordinary day
  is refused with the date named. It is a refusal rather than a silent
  correction — the statutory table on the row is the operator's statement, and
  quietly changing it would hide the disagreement. The roster half stays
  caller-supplied, because a rest day is a roster fact and there is no roster.
- **No in-memory store**, no full re-sync on every write, and the update
  statement moves only the answer columns: what was ordered, by whom, for whom,
  on which day and for how many minutes are write-once.
- **The duplicate-order check is the primary key**, not a per-employee map. The
  donor detects duplicates per employee in memory while its primary key is
  global, so two employees could be given one order id in-process and the second
  would overwrite the first on flush.
- Table names singular; `Minutes` is the attendance kernel's, not a second one.

Not ported: the audit-event emission (this backend records authority on the row
rather than in an event stream), and `agreed_on`'s use by an attendance day —
there is no punch source, so nothing consumes it yet. `agreed_overtime_on` is
written and unused for that reason, and it is the seam the punch decision would
plug into.

## Shift patterns, the roster, and the close boundary

Source: `fresh/crates/attendance-domain/src/{roster,period,time}.rs` and the
roster half of `cloud-attendance`, migration `044_attendance_v1.sql`.

Destination: `backend/src/cloud/domain/attendance/{roster,period,time}.rs`,
`postgres/roster.rs`, `http/roster.rs`, migration
`backend/migrations/postgres/0104_a_plan_is_made_before_it_is_worked.sql`.

Ported because none of it needs a clock. A plan is written before anybody works
it, and a month is signed off by a person rather than by a sensor. Kept as-is:
the 0..2879 shift timeline (so an overnight shift needs no timezone machinery),
the refusal of a break at least as long as the span, the append-only revision
chain with `plan_as_of`, the roster being frozen by the close as well as the
facts, and the close/reopen machine folding its status back from its own
history.

Adaptations:

- **`CloseReadiness` distinguishes "not assessed" from "zero".** The
  reference's blockers are all punch-derived; there is no punch source here, so
  those counts are `Option<u32>` and are `None`. A close taken today records, in
  its own evidence, that the punch checks were *not made* — rather than that
  they passed. This is the reference's own argument for `PeriodEvent::readiness`
  being optional on a reopen ("a claim nobody made and nobody verified"),
  applied one level down.
- **The blockers that remain are ones we can actually compute**: leave dated in
  the period and still undecided, and overtime orders nobody has answered. Both
  are facts this backend holds. `employees_without_roster` stays informational,
  as in the reference — a place may legitimately have staff nobody scheduled.
- **Place scope moved out of the authority and into `Reach`.** The reference's
  `Authorization` carries its own place and `require_covers`; ours does not, so
  the bound is applied at the HTTP layer by the same `Reach` that bounds the
  Directory. One answer to "where", not two.
- **The period is stored by its first day**, a `date`, rather than as a
  `YYYY-MM` string: ordering and containment become the database's own
  arithmetic instead of a parse.
- **An absent period row is an open period**, not an error. An unclosed month is
  the resting state, so the row is materialised on the first close — the table
  is a record of decisions rather than a grid of every month since the shop
  opened.
- **One route plans and revises.** They are one act with two spellings, and
  which one is happening is a fact about the database rather than about the
  caller's intent.
- **Retire, never delete, a shift.** A roster day already naming one would
  otherwise point at nothing, and the plans it produced are still the record of
  what was planned.
- Table names singular; `Minutes` is the attendance policy's, not a second one.

Not ported: punches, corrections, kiosks, `basis.rs` and `attendance.rs` — the
derivation of a day's outcome from its punches. All of it waits on the punch
source. `frontend-hub/PEOPLE-BRIEF.md` states the three options and their costs.

## Pay, payroll identity, and the run

Source: `fresh/crates/employee-pay-domain` and `cloud-employee-pay`, migration
`042_employee_pay_v1.sql`; and, for the run lifecycle **only**, the retail
backend's `payroll-domain` and `cloud-payroll`.

Destination: `backend/src/cloud/domain/pay/`, `postgres/pay.rs`, `http/pay.rs`,
migration `backend/migrations/postgres/0105_a_salary_is_a_history_not_a_number.sql`.

Kept from the pay donor, all of it load-bearing: pay as an effective-dated
timeline with no current-salary field and no setter; the refusal of a backdated
record (a genuine backdated raise is a *rapel* in a current period, visible on
the payslip, rather than a rewrite of a closed month); fixed allowances in the
record and variable ones deliberately absent; and `statutory_base` as a fact
about the agreement that no rule here is applied to.

Adaptations and additions:

- **The two-person rule is added, not ported.** The retail donor lets one actor
  verify and approve. Here `verify` and `approve` are separate keys at the same
  rung — which is what lets the domain compare *actors*, since a rung cannot —
  and the same actor is refused on the transition **and** on the way in from
  storage. A stored run whose two signatures carry one name fails to hydrate.
- **Nothing statutory is computed, and the columns do not exist.** The retail
  donor carries a component engine that applies PPh 21 brackets and BPJS rates;
  none of it came across. `payroll_slip` has no `deductions` and no `net`, so
  nothing can quietly acquire a zero that reads as "nothing was owed". What a
  slip carries is the agreement in force plus the facts this backend recorded:
  approved leave, agreed overtime, rostered days.
- **A run knows it is incomplete, and says why.** There is no punch source, so
  nothing knows what was *worked*. `payroll_run.complete` is false and
  `incomplete_because` carries a sentence a person reads on the screen. The
  schema refuses the halfway shape: complete with a reason, or incomplete
  without one, are both unstorable.
- **Runs are keyed by `org_place`, not by a store.** Head office employs people
  too, and a payroll that could only be run for a shop cannot pay the buyer.
- **A run refuses a month whose attendance is not closed.** The period is the
  payroll gate; while it is open the facts are still moving.
- **A reopen clears the verifier.** Otherwise the person who verified before a
  reopen could never approve afterwards — a rule nobody stated.
- **A payslip appears only once somebody has signed for it** (`APPROVED` or
  `SEALED`). A draft is a working figure, and showing it to the person it is
  about invites them to plan around a number that is still moving.
- **The account number is masked everywhere.** It is stored whole because a
  payment file needs it whole; no view serves it, and the masking happens in the
  storage layer rather than the view so no caller can reach the number by asking
  a different layer.
- **`cloud-staff-auth` was not brought across**, as the plan required. The five
  payroll keys join the one action-key space and map onto the existing ladder.

Not ported: the component engine, `basis.rs`, `policy.rs` and the conservation
identity that goes with them. They are the arithmetic this backend declines to
do.

## The run, reworked: the place asks and head office decides

Owner's decisions, 2026-09-13. They reverse the formulation the section above
was written to, so both readings are recorded rather than one overwriting the
other.

Destination: `backend/src/cloud/domain/pay/{run.rs,handover.rs,error.rs}`,
`domain/employment/audit.rs`, `postgres/pay.rs`, `http/pay.rs`, migration
`backend/migrations/postgres/0231_a_payroll_is_asked_for_by_the_place_and_decided_at_head_office.sql`.

What changed, and why each change is a change rather than a rename:

- **The place submits the batch, and sees the figures** — its staff's base pay
  included. This was argued against twice and reaffirmed twice. It is the
  reason the rest of the rework follows: a signature on a batch somebody cannot
  see is not a signature, so making the store sign is only worth doing if the
  store can read what it is signing. `people.pay.read` is the new key, at the
  supervisor rung and bounded by `Reach`; the bound that replaces the one given
  up is the place, not the rung.
- **The place opens the run**, for its own unit, once that unit's attendance
  period is closed. The closed-period gate is unchanged and is now the same
  place's signature on both sides of it.
- **`VERIFIED` is gone, and it is not the same act as `SUBMITTED`.** Verifying
  was head office checking figures head office would then approve — one opinion
  recorded twice. Submitting is a place standing behind figures somebody else
  will decide. The state is migrated rather than dropped, because every stored
  `VERIFIED` *is* a first signature; the step code and the action key inside
  `payroll_run.history` are rewritten with it.
- **`SEALED` is gone.** Approval is final, and a state whose only content is
  "and we mean it" cannot be told from the one before it. The migration
  **refuses** rather than rewrites: folding a sealed run into `APPROVED` would
  silently unlock a month somebody deliberately locked, so it names what it
  found and stops. Same shape as `0230`.
- **The two-person rule survives in the shape the work has.** Submitter is not
  approver, compared on the *actor*, refused on the transition and again while
  folding a stored history. What is new is that the two keys are no longer at
  the same rung — which is the version of this control that means something,
  because the two signatures are no longer both head office's.
- **A reopen may undo an approval Finance has already booked.** The owner
  accepted that explicitly, so there is no guard. The reopen clears both
  signatures and goes into the history with its actor and reason; what makes it
  survivable is that the handover snapshots its own breakdown.
- **`verified_by` was never a column.** The rename the plan asked for is on the
  wire — `PayrollRunView.verified_by` became `submitted_by`, and gained
  `approved_by` beside it. The run's signatures have only ever lived inside
  `history`.

### The handover to Finance, and the one thing it deliberately does not do

`payroll_handover` plus `payroll_handover_line`: one gross liability per place
per month, with its per-employee breakdown, idempotent per (place, period) so
sending twice cannot double what the company owes. The header-agrees-with-its-
lines rule is a deferred constraint trigger, copied from `journal_entry`'s and
for the same reason 0051 gives.

**It is not a ledger posting, and that is a decision this lane refused to make
on Finance's behalf.** Every other module that owes Finance money calls
`poster::post` in its own transaction. A `journal_line` must name a
`site NOT NULL`; `org_place.site_id` is `NULL` for kind `HO` by its own check
constraint; and head office's payroll is the whole reason a run is keyed by
`org_place` rather than by a store (`0105`). So the one run the key exists for
is the one run with no site to post to. `ledger::book_locations` hints that head
office *is* the DC site — the client's codes suffix head office `00` — but no
function in the estate performs that mapping, and deciding it here would decide
which location thirteen shops' worth of salary expense lands in. That is an
owner-and-accountant question.

So the crossing records the liability honestly and Finance books it. There is
deliberately **no `journal_entry_id` column**: the convention for one —
`0052`'s nullable FK tied to status by `CHECK` — is right for a module that
posts, and a column nothing can write is a promise nothing keeps. When the site
question is answered, that column and its check are a two-line migration, and
`journal_entry.source_kind` needs `'PAYROLL'` adding to its allowlist at the
same time.

**Gross means base plus standing allowances**, the slip's
`statutory_base_minor`. Nothing else on a slip is money: overtime is minutes and
leave is days, and this backend holds no overtime rate and no daily rate
anywhere, so valuing them would be inventing the multiplier. Nothing statutory
is netted off, for the reason `0105` gives at length.

**Settling is Finance's own key.** `people.payroll.settle` is disjoint from
`people.payroll.hand_to_finance`, because a grant that could hand a liability
over *and* declare it paid would be one person closing the loop on their own
request.

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
`0101`, and overtime — after another lane took `0102` — is `0103`.

That leaves a gap at `0100`, which `tests/migration_hygiene.rs` flags. The test
was already failing on six older reserved ranges (`0047–0049`, `0053–0059`,
`0062–0069`), so the gap is not new; but it is worth saying that this one is
deliberate rather than a missing file. Renumbering is not available: `0101` is
applied to the dev database, and changing an applied migration's number changes
its checksum and stops the node for every lane.


## The hire proposal — written here, not ported

Destination: `backend/src/cloud/domain/hire/`, `postgres/hire.rs`,
`http/hire.rs`, migration
`backend/migrations/postgres/0232_a_shop_asks_for_a_new_employee_and_head_office_answers.sql`.

**Neither donor has this.** `fresh/crates` and the retail backend both begin at
an employment record that already exists; the act of a shop *asking* for one
appears in neither, because in both of them head office is the only party that
ever creates a person. So this module borrows shape rather than code, and the
shapes it borrows are named where they are used:

- **The fold** is `employee.rs`'s. `hire_proposal.state` is denormalised from
  `history`, and `HireProposal::try_new` replays every step and refuses a row
  whose claimed state that history does not produce.
- **The two-actor rule** is `pay/run.rs`'s. Verify and approve are disjoint keys
  there so the domain has two *names* to compare; proposing and deciding are
  disjoint here for the same reason. The owner's rule — the proposer may not
  decide their own proposal, head office's own HR included — cannot be a rung,
  because every store manager holds the same one and HR holds the deciding key.
- **The reach bound** is the Directory's. The unit a proposal names is fenced by
  `Reach`, so for a bounded caller the only value that passes is their own
  posting.
- **The action keys** join the one space in `domain::employment::audit`, and
  opening an employment record against an approved proposal reuses
  `people.employee.create` rather than inventing a key: it is the same act as
  creating a candidate directly, which is what "two ways in, one employee record
  out" means.

### This is not `0100` returning

`0100` was a proposed-hires *pipeline* — applicants, a queue, and a view whose
own comment in `tests/contract_types.rs` said it "carries the NIK and the home
address a proposal has to state". The owner rejected that on 2026-09-04 and
approved a narrow form on 2026-09-13. The difference is not size:

- It stops at a candidate head office accepted. No applicants, no interview
  stages, no CV store, no shortlist, no offer letter.
- **It stores no personal data at all beyond a name**, and there is no column
  for any: under UU 27/2022 the identity documents of somebody who may never be
  employed here have no business on a form that may be refused. They start
  existing at `employee_profile`, behind `people.profile.read`, when the person
  is actually hired.

`0100` stays unreused, for the reason above: `0101` is applied and renumbering
an applied migration changes its checksum. The stale comment in
`contract_types.rs` was replaced when this landed, because a note saying a
proposal carries a NIK is worse than no note.

## The payroll component engine

Source: the reference HRMS payroll module at
`hrms/payroll/doctype/{salary_component,salary_detail,additional_salary,salary_slip,salary_structure,salary_structure_assignment}`.

Destination: `backend/src/cloud/domain/component/`, `postgres/components.rs`,
`http/components.rs`, migrations
`backend/migrations/postgres/0250_a_payroll_component_is_one_of_five_shapes_and_its_rate_is_ratified.sql`
and `0251_a_slip_says_what_was_taken_off_and_what_it_could_not_work_out.sql`.

**Why this exists after the refusal above.** The section *"Pay, payroll
identity, and the run"* records that the retail donor's component engine —
PPh 21 brackets, BPJS rates — was deliberately not ported, and `0105` held the
same line by giving `payroll_slip` no deduction column at all: *"nothing can
quietly acquire a zero that reads as 'nothing was owed'."* The owner then asked
for four things the absence made impossible: a deduction, a valued minute of
overtime, a one-off figure the place can add to its own batch, and a net.

So a component engine arrives. What the earlier refusal was protecting against
was **two** things, and both are still protected against.

### What the refusal was protecting against, and how each is still refused

**1. An expression language fed by a database row.** The reference stores
`condition` and `formula` as `Code` fields an operator types, and
`salary_slip.py` hands them to `_safe_eval(formula, whitelisted_globals, data)`.
In Python that is a sandbox somebody has to keep winning at; in Rust it would be
an interpreter for a second language, reachable by anybody who can write to a
table.

There is no expression type anywhere in `domain::component`, and no column one
could be written into. A component's arithmetic is one of **five shapes**:

| Shape | What it is for |
|---|---|
| `FIXED_AMOUNT` | a flat figure every period |
| `SHARE_OF_BASE` | basis points of a named base, optionally capped — **this is how BPJS works** |
| `RATE_PER_UNIT` | money per counted unit: a transport or meal allowance per day |
| `FRACTION_OF_BASE_PER_UNIT` | a named base ÷ a ratified divisor of hours × a ratified multiplier × counted hours — Kepmenaker 102/2004 art. 8 and PP 35/2021 art. 31 |
| `PER_OCCASION` | no standing figure at all; its figure arrives one person and one month at a time |

A shape not in that enum cannot be constructed, stored, or sent. And **no
component may name another component** — `ComponentBasis::compute` takes only
`SlipFacts`, which is the pay agreement the slip already copied plus the counts
the slip already carries. With a component-to-component reference would come an
evaluation order, then a dependency graph, then a cycle check, and the engine
would be back; without it every line is computable in any order and a cycle is
unrepresentable rather than detected.

The one named base that would have broken that is `GROSS` — a deduction as a
share of the month's earnings — and it is deliberately absent. No rule this
estate implements needs it: an Indonesian statutory base is *upah*, not the
month's takings. The day one does, it is a new variant and a migration, which
is a visible act.

**2. Inventing statutory arithmetic.** PPh 21 is still nowhere near this code:
no brackets, no PTKP lookup, no annualisation. The owner's decision stands —
gross first, deductions at Finance. `Income Tax Slab`, `Taxable Salary Slab`,
the four `Employee Tax Exemption *` doctypes, `Gratuity` and the
`Employee Benefit *` family are not ported and have no destination here.

What changed is that BPJS is now *expressible*. **No rate is seeded.** There is
no BPJS percentage and no overtime multiplier written anywhere in this
repository; an operator states them through `pay_component_rate`, exactly as
`overtime_policy` makes an operator state the caps. A component with a standing
shape and no ratified rate makes every slip built under it refuse to report a
deduction total — **naming the component** — rather than report nought.

### Adaptations

- **A definition and a rate are two rows under two keys.** The reference keeps
  the amount, the formula and the condition on the `Salary Component` itself.
  Splitting them buys two things the design needs. It makes *"defined and
  nobody has priced it"* a state this system can name, which is the whole
  mechanism above. And it makes the rate **effective-dated**, so a BPJS rate
  that changes by regulation in January cannot rewrite what December was
  deducted — the reason `employee_pay` is a history rather than a column. The
  rate timeline is forward-only for the same reason `PayTimeline::append` is.
- **`people.pay_component.define` and `people.pay_component.ratify` are
  disjoint keys.** Inventing a line item decides what a payslip may say; its
  percentage decides what comes out of every wage. The same split
  `OVERTIME_POLICY_SET` makes against `OVERTIME_ORDER`, and for the same
  reason: a deployment that wants the figure in fewer hands than the
  vocabulary cannot say so with one key.
- **Reading the catalogue and the rates needs no key at all.** The position the
  attendance policy and the holiday calendar already take, and it has more
  force here: a rate that decides what comes out of somebody's wage is exactly
  the rule they are entitled to read, and a deduction kept from the person
  paying it is a trap. Nothing on those two routes is about a named person. The
  one-offs, which are, sit behind `people.pay.read` and `Reach`.
- **`Salary Structure` and `Salary Structure Assignment` are not ported.** The
  reference assigns each employee a structure listing their components, so one
  company has as many component sets as it has structures, and each assignment
  can drift from the pay agreement beside it. Here the standing agreement is
  `employee_pay` (0105), the catalogue is the **company's** — no `place_id`
  anywhere, because a place-scoped component is thirteen answers to what BPJS
  costs — and everything that varies per person per month is a
  `payroll_adjustment`. No assignment table, and nothing to drift.
- **`Employer Contribution` is not a kind.** The reference's `type` has three
  values. What the employer pays on top of a wage changes neither gross nor
  net, and putting it on a payslip is how a person comes to read a number that
  was never theirs. Two kinds, `EARNING` and `DEDUCTION`, and amounts are
  positive under both — which way a line points is its kind, so one typo cannot
  turn a deduction into a pay rise. The reference makes the same choice about
  signs.
- **The overtime rate is ratified configuration, and the bands are the
  statutory table's own axes.** PP 35/2021 art. 31 pays the first hour of an
  ordinary working day at one multiplier and the hours after it at another, and
  rest days and public holidays at their own. `overtime_order.day_kind` already
  records which table applies, so the banding is a `GROUP BY` over agreed
  orders rather than a derivation — and the first-hour band is per **day**, not
  per order, because two orders on one evening are one evening.

  The divisor (173) and every multiplier are rows an operator ratifies. **No row
  means no rate means overtime is reported in minutes and valued nowhere**,
  which is precisely today's behaviour — so the absence of configuration
  changes no existing answer, and `payroll_integration`'s
  `a_slip_carries_the_agreement_and_the_facts_and_no_invented_deductions`
  proves it on a deployment where nothing is defined.
- **Overtime is counted in whole minutes and priced by the hour.** Leave is
  hundredths of a day here, and the obvious move was hundredths of an hour. It
  is worse: the count on a slip line is then a *conversion* of
  `overtime_order.planned_minutes` and the two can disagree, and twenty minutes
  is not a terminating decimal of an hour. So `CountedUnit::per_whole` is 60 for
  the overtime bands, the stored count is the same integer the order holds, and
  `rate_minor × units / 60` reproduces the line exactly.
- **What is deliberately NOT banded**: the ladder *within* a rest day or
  holiday — art. 31's 2× for the first eight hours, 3× for the ninth, 4× for
  the tenth and eleventh. Every rest-day minute lands in one unit, so an
  operator ratifying a single rest-day multiplier **understates a very long
  holiday shift**. Naming the limit is the point of writing it here and in
  `0250`; closing it is three more `CountedUnit` variants and a migration,
  which is a visible act rather than a formula somebody types.
- **`ROSTERED_DAY` is days planned, not days worked.** There is no punch source
  in this estate, so a unit called `DayWorked` would be a claim the slip cannot
  support — `payroll_run.incomplete_because` already says so. A `RATE_PER_UNIT`
  allowance therefore pays nothing for somebody nobody rostered, and that is a
  real risk rather than a theoretical one: the line is written with `units = 0`
  rather than omitted, and `RunReconciliation::lines_that_counted_nothing`
  counts them, because "26 days at nil" and "nil days at 20.000" are two
  different explanations of the same missing money.
- **A cap bounds the base, not the contribution.** BPJS Kesehatan caps the
  *wage* a percentage is taken of. Capping the answer instead gives the same
  figure for one rate and a different one for every other — the sort of fault
  that only becomes wrong after a regulation changes — so `SHARE_OF_BASE`
  applies the cap to the base and the line records the capped base it used.
- **`Additional Salary` becomes `payroll_adjustment`, keyed by (place, month)
  and with no state machine of its own.** The reference keys it by a free
  `payroll_date`; a run here is one place and one month, so that is the key.
  Deliberately **not** keyed by `run_id`: a run may only be opened once the
  attendance period is closed, so a run-keyed adjustment could not be filed in
  the month it was earned.

  The brief for this work asked that filing go through the same decide-and-
  return path the payroll submission does, *or say why not*. It goes through
  exactly that path, and it carries no second one: an adjustment is writable
  while its month has no run or a `DRAFT` one and **frozen by the place's
  submission**, so the decision on it is head office's `people.payroll.approve`
  on the batch carrying it, and the way back is the reopen that already exists
  and already clears both signatures. Its own `PROPOSED → APPROVED/RETURNED`
  machine — `hire_proposal`'s shape — was rejected because it would ask head
  office to approve one figure twice, and two approvals of one number is how two
  screens come to disagree about whether something was decided. `hire_proposal`
  needs its own machine because nothing else carries a candidate; an adjustment
  has a batch to ride.
- **A one-off may only name a `PER_OCCASION` component.** The reference lets an
  `Additional Salary` *overwrite* a structure component's amount
  (`overwrite_salary_structure_amount`, plus a validation and a `msgprint` when
  the component turns out not to be in the structure). Here one component cannot
  produce two figures at all: the rule is a `basis = 'PER_OCCASION'` CHECK plus
  a composite foreign key onto `pay_component (code, basis)`, so no line on any
  slip is ever the answer to "which of these two won".
- **Duplicates are refused by the key, not by application code.** The reference
  has `validate_duplicate_additional_salary`; here it is
  `UNIQUE (place_id, period, employee_id, component_code)`. Two incentives for
  one person in one month are one incentive of the sum, or two components, and
  either way somebody has to say which. Correcting a figure is a withdrawal and
  a new filing, each under its own reason.
- **Filing and withdrawing are one key**, unlike `PAYROLL_SUBMIT` and
  `PAYROLL_REOPEN`. Those are two because a reopen undoes work somebody has
  signed for; nothing here is signed while the batch is a draft, and a grant
  that could add a figure but not take it back would be a grant to make a
  mistake permanent. Withdrawal is `POST .../withdrawal` rather than `DELETE`,
  matching `/attendance-corrections/{id}/withdrawal`: taking a figure back needs
  a reason and a `DELETE` has nowhere to put one.
- **Absence is three states on a slip, not two.** `0251` adds the columns `0105`
  refused, and keeps the guarantee by making them nullable:

  | | `deduction_total_minor` | `net_minor` |
  |---|---|---|
  | nobody has defined a deduction | `null` | `null` |
  | a DEDUCTION component has no ratified rate | `null` | `null` |
  | an EARNING component has no ratified rate | `Some` | `null` |
  | everything is ratified | `Some` | `Some` |

  The third row is the one worth having: an unratified earning leaves the
  deduction total perfectly knowable and the net not, because the gross it
  would be subtracted from is short. `components_incomplete_because` carries the
  sentence naming the components, the discipline `CloseReadiness`'s
  `Option<u32>` and `payroll_run.incomplete_because` already follow.

  A deduction total of nought needs at least one defined deduction, because a
  company that has defined an incentive and nothing else has said nothing about
  deductions at all. `RunReconciliation` sums the two `Option` totals
  all-or-nothing rather than over the slips that happen to have a figure — a
  total that silently leaves people out looks like an answer — and counts
  `slips_with_unworkable_components` and `slips_with_negative_net` so head
  office sees both before approving.
- **Every number is an integer.** Money in the smallest unit, percentages and
  statutory multipliers in **basis points**, overtime in whole minutes. No `f64`
  in the module or the two migrations. 1.5 happens to be exactly representable
  in binary floating point and 1.05 is not, which is the kind of luck that hides
  a rounding fault for a year. Division is half-up, once per step, stated in one
  place because a payslip is checked by hand.
- **A line is a snapshot with its working shown.** `payroll_slip_line` stores
  the amount as computed **and every input it was computed from** — the base
  after any cap, the basis points, the cap, the divisor, the multiplier, the
  unit, the count, the per-unit rate. So a rate ratified next January cannot
  change what December's slip said, and any line reproduces from itself without
  joining to anything that may since have moved. This is also the answer to a
  fault this estate has already had: a computation that derives more than it
  keeps leaves a figure nobody can explain, and the explanation is needed
  exactly when somebody disputes their payslip.
- **Retire, never delete a component.** The rule the other four master lists
  follow. A slip line naming a deleted component would point at nothing, and the
  slips it produced are still the record of what somebody was paid. A retired
  component produces no new standing line, but an adjustment filed against it
  while it was live is still honoured — head office withdrawing a code should
  not silently cancel a figure a place is waiting to see approved.
- **The handover to Finance now crosses `payroll_slip.gross_minor`.** `0231`
  crossed `statutory_base_minor` and said why: *"no rate for either exists
  anywhere in this estate, so neither becomes money here."* One now can, so the
  crossing includes valued overtime and the one-off earnings the place filed.
  Still **gross** — nothing statutory netted off, and deliberately not the net,
  which is `null` whenever a deduction was not assessed and a liability of
  unknown is not a liability Finance can book. `0251` corrects `0231`'s column
  comment rather than leaving it to contradict the query.
- **Migration numbers.** This lane was assigned `0235` and `0236` and found both
  taken by the floor-delivery and org-place lanes by the time it had finished
  reading, so it took `0250` and `0251` — a distant block, the convention
  `tests/migration_hygiene.rs` exists to record. The gap below them is claimed
  in that file's `RESERVED`.

Not ported: `Payroll Entry` (the estate's `payroll_run` predates it and is
shaped by the owner's submit/approve decision), `Salary Withholding`,
`Retention Bonus`, `Arrear`, `Payroll Correction`, and the reference's
`round_to_the_nearest_integer` / `do_not_include_in_total` /
`statistical_component` flags — every one of them is a way for a component to be
on a slip and not in its totals, which is the shape that makes a payslip stop
adding up.

## Expense claims — HRMS's Expenses module, adapted

Destination: `backend/src/cloud/domain/claim/`, `postgres/claims.rs`,
`http/claims.rs`, migrations
`backend/migrations/postgres/0341_a_claim_is_asked_for_and_sanctioned_by_two_people.sql`
and `0342_the_claim_postings_have_somewhere_to_go.sql` (2026-09-23). Hub face:
`frontend-hub/src/screens/people/claims.tsx` (Work group) plus the Requests
banner and the Directory sheet's Claims and Advances sections.

The reference is `hrms/hr/doctype/expense_claim` and `expense_claim_type`; the
shape kept is the one that matters — a claim lists what was spent, a decider
sanctions each line, and the sanction books the money. What did not cross:
taxes and charges (the estate nets no statutory figure), multi-currency
(one currency, IDR, integer minor units), and `is_paid` as a checkbox (here
paying is a state with a journal behind it, not a flag).

Decisions worth naming:

- **Filing and deciding are two people's acts, in the schema.** The
  two-actor rule is a CHECK on the row (`decided_by <> claimed_by` on decided
  states), not only a live-path guard, because a rule just the handler knows
  is a rule `psql` removes.
- **One meaning, split by qualifier.** `employee_expense` is qualified by
  claim-type code, and 0342 mints the map rows per type per site in the same
  transaction that defines the type — because `resolve_account` matches
  qualifiers exactly, a bare `''` row would have marked the pair mapped while
  every posting refused. The `advance`/PERJALANAN qualified mould wins over
  the spec's single unqualified seed.
- **The debit leaf is minted, on the client's own rung.** `6010210014 Klaim
  Karyawan` under 60102 Beban Pegawai, in the 0277 mould; `6201` was refused
  because its pay-component family would force a payslip component onto every
  claim line.
- **Payment is the imprest's.** A payout is `Dr employee_claim_payable [site,
  for_employee] / Cr petty_cash [site]`, numbered in the `KKC-` series, so the
  cash-position fold sees it with no new table. What a shop may not pay from
  stays refused exactly as the store-money lane refuses it.
- **Advances are not rebuilt.** The finance lane's `advance`/
  `advance_settlement` (0280) is the advance; People serves a read-only
  projection of it, and the settlement fold — not stored columns — is the
  outstanding. HRMS's `repay_unclaimed_amount_from_salary` is deferred: it
  needs a third settlement kind riding the payout envelopes, which is its own
  decision.
- Reading the catalogue needs no key; filing is `people.claim.file` (manager,
  under Reach) or `people.claim.request_own` (self, `Access::own`);
  `people.claim.decide` and `people.claim.pay` are separate grants because
  handing money over and declaring it paid must not be one person's loop.

## Grievance, exit interview, and the Full & Final statement

Destination: `backend/src/cloud/domain/{grievance,exit}.rs`,
`postgres/{grievance,exit}.rs`, `http/{grievance,exit}.rs`, migrations
`backend/migrations/postgres/0343*` and `0344*` (2026-09-23). Hub face:
`frontend-hub/src/screens/people/{grievances,exits}.tsx`; a **Records** group
appears between Work and Pay because Exits is its first screen with an
endpoint behind it.

Reference: `hrms/hr/doctype/{grievance_type,employee_grievance,exit_interview,
full_and_final_statement}`. Not taken: the questionnaire email machinery,
`boarding` templates (the estate's termination already carries its reasons),
and `company` links.

- **The grievance queue is head office's, by construction.** A grievance
  against a store manager cannot be investigated by that store manager, and in
  a thirteen-store estate the only place that is nobody's posting is head
  office. Filing is `people.grievance.file` (manager, under Reach) or
  `people.grievance.request_own` (self, `Access::own`) — an employee must be
  able to complain about their own supervisor without asking them. Reading is
  its own key, `people.grievance.read`, mapped ADMIN: the accused supervisor
  holds `people.employee.read` and must not therefore read the queue.
  Investigating and resolving are two disjoint ADMIN keys — the payroll run's
  lesson, applied to a verdict about a person.
- **The exit interview exists from the termination, not after it.** The
  TERMINATE path opens a PENDING row in the same transaction; `employee.rs`
  has no transition out of TERMINATED (rehire is a new record), so the UNIQUE
  is `employee_id` alone — a key for a span the machine cannot produce would
  be a lie about the machine. Withdrawn offers get nothing: nobody who never
  worked has an appointment at the door. A backfill route covers
  terminations predating the hook.
- **The Full & Final statement freezes its reads.** The leaver's open
  advances (0280), approved-unpaid claims (0341) and manual asset-recovery
  rows are summed at creation; SETTLE re-reads the sources inside the settle
  transaction and refuses on drift, naming what moved. The net posts once,
  idempotent on `(source_kind, source_id, purpose)`; the person-side leg is
  `employee_claim_payable` at the leaver's place, the cash side the HO
  imprest, and the affiliate legs are the poster's. A zero net refuses by
  name — a journal of nothing is not a settlement.
- `employee_stance` is nullable, paired to COMPLETED by CHECK: a PENDING row
  carrying a stance is an answer before the question.
