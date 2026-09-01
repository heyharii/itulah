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

## Not yet ported

| Area | Donor source | Blocked on |
|---|---|---|
| Attendance policy | `attendance-domain/src/policy.rs`, migration 046 | nothing — buildable now |
| Salary structure and payroll identity | `employee-pay-domain`, `cloud-employee-pay`, migration 042 | nothing — buildable now |
| Holiday calendar | `cloud-holiday`, migration 040 | nothing — buildable now |
| Leave | `leave-domain`, `cloud-leave`, migration 043 | screens belong to the store surface |
| Overtime | `cloud-overtime`, migration 045 | screens belong to the store surface |
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
