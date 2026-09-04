# People: one module, two faces

Approved by Hari 2026-09-04. This is the shape the People module is being built
to, the reasoning behind each part of it, and the one question still open.

The binding artefacts are the code: `src/screens/people/nav.ts` for what the
sidebar offers, `backend/src/cloud/domain/employment/audit.rs` for who may do
it, and `docs/hr-port-provenance.md` for where each ported piece came from.
This file says *why*, so the next person does not have to reconstruct it from
the diff.

## The formulation

**One People module, two faces — not three menus.**

The draft that preceded this one had a menu for head office, a menu for store
managers and a menu for the DC. It was wrong about the work. A store manager
and a DC manager do the *same* HR job: build next week's roster, see who is in
today, approve leave, order overtime, sign off the month's attendance. Only
their data differs — the DC runs pagi/siang/malam patterns and heavy overtime,
a store runs opening hours and till shifts. Two menus with the same eight
entries and different rows underneath is one menu.

Head office is not a third variant of that manager. It is the **employer**:
contracts, moving somebody between places, ending employment, pay, and every
rule the other places are measured against. It does not build rosters; it reads
them.

And employees themselves are not in this module at all. They are on
`frontend-employee`, the phone app, where they ask for leave, consent to
overtime and read their own payslip. Nothing self-service is duplicated in the
hub — a second place to do the same thing is a second place to get a different
answer.

## The sub-menu

Finance-style groups (Work · Records · Pay · Setup), one `nav.ts`, visibility
filtered per item by **scope** and **role**:

| Group | Screen | Place manager (Supervisor posted to a store or DC) | HR head office (Admin, posted to `ho`) |
|---|---|---|---|
| Work | **Today** — scheduled / in / late / not yet arrived | own place | picks a place |
| Work | **Roster** — weekly schedule per person, revisions recorded | builds | reads |
| Work | **Requests** — one queue: leave awaiting decision, corrections awaiting decision, overtime awaiting consent | decides | reads |
| Work | **Overtime** — supervisor orders, employee consents | orders | reads |
| Work | **Period close** — monthly attendance sign-off per place | closes | reopens |
| Records | **Directory** *(exists)* | own team, read only | all; hire · transfer · terminate |
| Records | **Contracts** — PKWT expiring, renewals | read | write |
| Pay | **Pay agreements** · **Payroll runs** · **Payroll identity** | **not shown** | yes |
| Setup | **Attendance policy** *(exists)* · **Shift patterns** · **Leave types** · **Holiday calendar** · **Devices** | **not shown** | yes |

One queue, not three, is the point of **Requests**. A manager does not have a
"leave task" and a "correction task" and an "overtime task"; they have five
minutes and a list of things waiting on them. Three screens each holding two
rows is how all three stop being opened.

## Scope: one posting, read from the caller's own record

The caller's place comes from their own posting — `GET
/api/v1/employees/me/profile` already carries `place_id`, resolved through
`app_user.employee_id` to the one open `employee_assignment` span.

- posting `ho` ⇒ every place;
- posting `store-07` ⇒ store-07 and nothing else;
- **no posting ⇒ nothing.** A Supervisor login with no employment record behind
  it reaches no place, which is the honest reading: we do not know where they
  work, so we cannot say whose roster is theirs.

This is not a new navigation concept. It is the sidebar's existing
`visibleItems(module)` filter, fed by scope and role instead of by a static
`hidden` flag.

**The browser is not where this is enforced.** Hiding a row hides a row; the
route is still typeable and the endpoint is still callable. Every bound below is
enforced server-side, in the one action-key space, and the nav filter exists so
a manager is not shown five screens that will answer 403.

`Principal` deliberately does not carry a place. A session says who you are and
which rung you hold; where you are posted is HR data with a history, and
copying it into the session is how it goes stale the day somebody is
transferred.

## Five decisions taken before the first line

### 1. Per-place grants live server-side, in the one key space

`domain::employment::audit` already holds every HR action key and one
`required_role` mapping onto `CASHIER < SUPERVISOR < ADMIN`. Its module doc
anticipated this exact day: *"the day we grow per-place grants only
`required_role` changes."*

So the new keys join that space in the same style —
`people.roster.manage`, `people.leave.decide`, `people.overtime.order`,
`people.correction.decide`, `people.attendance_period.close`,
`people.leave_type.set`, `people.holiday.set`, `people.shift_pattern.set`,
`people.pay.change`, `people.payroll.verify`, `people.payroll.approve`,
`people.payroll.seal`, `people.payroll.reopen` — and `required_role` stays the
single mapping. Beside it sits a **reach**: the set of places the caller may act
in, resolved once per request from their own open posting. Supervisor-rung keys
are bounded by that reach; Admin is unbounded.

The bound is retrospective as well as new. `people.employee.read` is bounded for
Supervisors too, because today any store supervisor can list every employee in
the company — a gap nobody had noticed because the Directory was the only
caller and only head office opened it.

A second directory of roles is what the port has been avoiding since the first
day (see `hr-port-provenance.md`); adding a place bound beside `required_role`
keeps it to one answer to "may they", now with two halves: which rung, and
where.

### 2. `/employees/{id}/pay` stays the pay agreement; payslips get their own route

The donor serves an effective-dated pay *agreement* there — base, allowances,
statutory base — under the doctrine *"a salary is a history, not a number"*, and
it computes nothing statutory. `frontend-employee` calls the same path expecting
a monthly payslip. This is the one wire mismatch `hr-port-provenance.md`
records.

The Rust keeps the route. Payslips move to `/employees/{id}/payslips` (and
`/payroll/runs/{id}/slips` for head office), and the employee app changes one
path — its `src/lib/hr/types.ts` was declared a proposal awaiting generated
types, and this is what awaiting them means.

### 3. Nothing invents a punch

The punch source is undecided (below). Everything that needs no clock is built:
shift patterns, rosters, roster revisions, and the attendance-period
closure/reopening state machine. Where a screen's *content* needs punches, it
says plainly that no punch source is connected — it does not draw zeros. A
roster with nobody marked present reads as "everybody is absent" to anyone who
does not know the backend, and that is worse than an empty screen.

### 4. Payroll runs are keyed to the place, and only head office approves

A run is created per place per period, keyed to `org_place.id` rather than the
donor's store id — head office employs people too, and a payroll that can only
be run for a store cannot pay the buyer.

**Hari's explicit decision: verify → approve → seal, and reopen, are head office
only.** A place manager's contribution to payroll is closing their attendance
period. They never see a run and never approve one.

Inputs are the pay agreement plus recorded leave, overtime and holiday facts.
Nothing statutory is computed — no PPh21, no BPJS arithmetic — because the
donor computes none and inventing it here would produce numbers somebody files
with the tax office. A run over a period whose attendance is not closed, or
whose place has no punch source, is refused or marked incomplete. Never silently
computed.

### 5. Two people, not one

Where the donor lets one actor both verify and approve a run, we keep the rule
that they must be different actors. A control that one person can complete
alone is a record of a signature, not a control.

## The open question: where does a punch come from

Nothing clocks anybody in today. Until that is answered, **Today**, attendance
**corrections** and **Devices** are routed-nowhere gaps rather than screens, and
Period close signs off a period whose content is empty. Three options, with
their real costs:

**(a) A kiosk at each place.** A fixed tablet running a punch screen; the donor
already carries kiosk registration and this is what it was designed for. Costs a
device per store and DC, and a queue at opening time — thirteen shops, thirteen
devices, and one of them will be unplugged on a Monday.

**(b) The RFID reader already installed.** The DC has readers for stock and the
handheld work is on this branch now. A staff badge is one more tag. But only the
DC has a reader, so it answers attendance for the warehouse and for nowhere
else — and an EPC that identifies a *person* is a materially different privacy
question from one that identifies a shirt, with a different answer.

**(c) The till shift the store already opens.** `cash_shift` on the edge already
records `opened_by` and `closed_by` against a till identity. It costs nothing
and needs no hardware. It also clocks only the people who open and close a till
— not the floor staff, not the stockroom — gives at most two events a day, and
`opened_by` is an `edge_identity_assignment` login rather than an `employee`, so
the join to a person does not exist yet. Cash shifts also stay on the edge
today: nothing syncs them to the cloud, so head office cannot see one.

None of the three is obviously right, which is why this is Hari's to decide and
not something to settle by writing code.

## Build order

Each phase is verified and committed before the next starts.

| Phase | What | State |
|---|---|---|
| 0 | This brief, and the People line in `IA-GAP.md` | done, `6755c3c` |
| 1 | Scope and grants: reach resolution, the new keys, bounded Supervisor reads and writes, `useReach()` in the hub, the four-group `nav.ts` | done, `93dd8b1` |
| 2 | Leave + Holiday: leave types, holiday calendar with amendments, the Requests queue, balances on the Directory sheet, the employee app's leave screens live | done, `43c1d05` |
| 3 | Overtime: orders, consent, withdrawal; "awaiting consent" joins the queue | — |
| 4 | Shift patterns + Roster: patterns at head office, the weekly grid and its revisions at the place | — |
| 5 | Pay + Payroll, head office only: agreements, payroll identity, the run lifecycle with its two-person rule, slips, and the attendance-period closure machine | — |
| 6 | Close-out: provenance, every gate green, both faces walked in the browser | — |

Leave comes before overtime because overtime's consent step is the same queue
mechanism with one more state, and roster comes after both because a roster is
only interesting once there is something to schedule around.

## What is *not* People

The temptation with an HR module is to file everything with a person's name on
it under it. Four things that belong elsewhere, and why:

| Not here | Where it lives | Why |
|---|---|---|
| Till access — which terminal somebody may sign into, with what PIN and role | System › Access (`edge_identity_assignment`) | An access grant is not a posting. A district supervisor holds five grants and one posting; an HR officer has a posting and no till access at all. One table answering both would lie about one of them, and 0060 says so in a comment. |
| Cash shift — opening float, drawer counts, the day's takings | Store ops | It is money, counted by whoever is standing at the till. That the same person also has a roster line is a coincidence of staffing, not a relationship. |
| Discussions, Chat, Files | The aside strip | Talking about work is not a department. Decided 2026-09-03; see `SIDEBAR-BRIEF.md`. |
| Employee self-service — request leave, consent to overtime, read a payslip | `frontend-employee` | The hub is where somebody's work is *decided*; the phone is where their own is *asked for*. Building both is building two places to disagree. |

Two more that sound adjacent and are not: **performance reviews** and
**training** have no endpoint and no table, and appear in `IA-GAP.md` as
proposals rather than here as plans. **Recruitment** stops at `CANDIDATE` —
somebody accepted and not yet started. What happened before that is not
recorded anywhere, deliberately.

## Status

Filled in as each phase lands; a phase with nothing under it here has not
shipped, whatever the code suggests.

### Phase 0 — the brief

Written 2026-09-04. `IA-GAP.md`'s People line now points here instead of listing
six unbuilt screens. Commit `6755c3c`.

### Phase 1 — scope and grants

Commit `93dd8b1` (backend and generated wire only — see "What is not in a
commit" below).

`Reach` resolves the caller's places from their own open posting, once per
request, and `required_role` stays the single mapping from a key to a rung. The
retrospective fix is the one worth naming: `GET /api/v1/employees` was
rung-only, so a supervisor at any shop could page through the whole company's
workforce. It could, and nobody had noticed, because the Directory was its only
caller and only head office opened it.

Thirteen action keys joined the space for the phases after this one.
`/employees/me/reach` is new so the console can draw the right module without
re-deriving the rule in the browser.

### Phase 2 — leave and holiday

Commit `43c1d05`. Ported from `leave-domain`/`cloud-leave` and
`holiday-domain`/`cloud-holiday`; `docs/hr-port-provenance.md` records every
adaptation. Migration `0101`.

What shipped: the holiday calendar (publish once, amend for ever, with *cuti
bersama* distinguished because it comes out of the twelve); leave types and the
policy generations a balance folds under; balances as a fold with no stored
number and no route that can spend one; and requests with approve, refuse and
withdraw, bounded by the decider's own posting.

Hub: **Setup › Leave types** and **Setup › Holiday calendar** at head office,
**Work › Requests** for both faces, and a **Leave** tab on the Directory sheet.
Employee app: leave, leave-new and the home card are live on the real routes,
with their proposal types and demo fallbacks deleted.

Three decisions taken here that the owner should hear about:

- **`people.leave.grant` is a new key** the plan did not list. Putting days
  *into* somebody's balance is head office's, and the alternative was letting
  the key that decides requests also hand out days — a manager who could
  approve leave could then grant themselves some.
- **`withdraw` won over `cancel`.** The employee app's proposal used the second
  word; the server uses the first, and the distinction is worth keeping.
- **`POST /api/v1/employees/me/…` is now CASHIER at the path gate.** It had
  been SUPERVISOR by fall-through, which silently made "ask for your own leave"
  a supervisor act. It grants nothing — every handler re-checks its own key.

Still open, unchanged: the punch source. Nothing in this phase needed one.

### What is not in a commit, and why

`frontend-hub` cannot be committed narrowly in this tree. Its `lib/navigation.ts`
imports `screens/master/nav.ts`, `screens/members/nav.ts` and
`screens/reports/nav.ts`, none of which is tracked in git — 130 hub files are
uncommitted work belonging to several lanes at once, so a commit of the People
files alone would not build, and a commit that made it build would be a commit
of most of the app.

So phases 1 and 2 commit their **backend and generated wire** — phase 2 also
commits the employee app, which is entirely this lane's — and the hub work sits
in the working tree.

Two other things sit uncommitted in the working tree on purpose. The
**login-provisioning** surface (`postgres/accounts.rs`, `users.rs::provision_account`,
the two handlers in `http/employment.rs`, migration `0097`, and the Directory's
form) belongs to another lane; the removal of the proposed-hires flow left its
handlers homeless and this lane rehoused them, but the feature is theirs to
commit. And the backend's committed `mod.rs` files must not be staged from the
working tree wholesale: several lanes have added `pub mod` lines for modules
they have not committed — `domain::voucher`, `http::{assistant,reports,vocabulary,vouchers}`,
`postgres::{assistant,membership,saved_reports,segments,vocabulary,vouchers}` —
and staging those registries by path publishes declarations with no file behind
them. Both commits here reconstruct those four files from the previous commit
plus their own lines, and each was verified by building the commit in isolation. The People files are
`src/screens/people/{nav.ts,index.ts,directory.tsx,requests.tsx,leave-types.tsx,holidays.tsx,scope.ts}`,
`src/lib/queries/people.ts`, and the `Audience` addition in `lib/navigation.ts`
and `components/shell/sidebar.tsx`. Somebody should commit the hub as a whole.
