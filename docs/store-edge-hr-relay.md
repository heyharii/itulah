# Store edge HR relay

The store till (`frontend-store-new`) talks to one server, its own store edge,
under one sign-in. HR data lives only at Cloud, and so does General Affairs.
The store edge therefore relays an allowlisted set of HR and GA calls to Cloud
for the person signed in at the till. Cloud limits HR to the unit that owns the
node's site, and limits GA to that physical site.

## The route

```
GET | POST | PUT | PATCH | DELETE   /api/v1/store/central/{path}
```

This is forwarded to `{cloud}/api/v1/{path}?{query}`. The store edge sends the
method, the path, the query string exactly as it arrived, and the JSON body
(256 KiB at most). Cloud's status and JSON body come back unchanged, so a
refusal reaches the till in Cloud's own words. If Cloud cannot be reached, the
edge answers `503` with a sentence and does not make up an answer of its own.
The timeout is 15 s.

The store edge sends these headers to Cloud:

| Header           | Value                                                               |
| ---------------- | ------------------------------------------------------------------- |
| `x-sync-key`     | the node's `SYNC_UPLOAD_KEY`, the same machine credential sync uses  |
| `x-relay-origin` | the node id (`INVENTORY_NODE_ID`, e.g. `store-07-edge`)             |
| `x-relay-user`   | the signed-in edge user's id, which for a CLOUD user is `app_user.id` |
| `content-type`   | `application/json`, when there is a body                            |

The browser's cookie, bearer token and CSRF token are never forwarded. They
belong to the edge session, and Cloud did not issue them.

## The allowlist

There is one list: `HR_RELAY_ALLOWLIST` in `backend/src/cloud/domain/relay.rs`.
The store edge checks a request against it before forwarding, and Cloud checks
it again when the request arrives. A `{}` in the list stands for exactly one id
segment made of ASCII letters, digits, `-`, `_`, `.` and `:`. A segment of `.`
or `..`, a `%`-encoded character, or an empty segment is refused. This matters
because a URL library can normalise or decode a path, so the path that was
checked could otherwise differ from the path that is sent.

The list matches exactly the calls `frontend-store-new` makes, and nothing
more:

- **The team and reference data:** `employees/me/reach`, the team list, one
  employee's record and profile, `org/positions`, `people-policy`, and the
  `payroll/components` catalogue.
- **Roster:** reading it, planning a day, reading attendance shifts, and
  deciding a roster swap.
- **Attendance:** reading today and punch readiness, reading one person's
  attendance, reading attendance corrections, deciding a correction, filing a
  correction for someone, and closing an attendance period.
- **Leave:** leave types, a year's holidays, a person's balances and requests,
  filing a request, and `…/leave-requests/{id}/approve|reject|withdraw`. Those
  three verbs are listed explicitly rather than matched by a wildcard.
- **Overtime:** reading a person's orders, issuing an order, and withdrawing
  one.
- **Expense claims:** reading claim types and the claim list, filing a claim,
  and submitting, deciding or returning one. Also reading a person's advances.
- **Change proposals:** reading the list and filing one.
- **Payroll adjustments:** reading, filing and withdrawing the place's one-off
  figures. Payroll runs and approval stay off the list.
- **Benefits and lifecycle:** reading and recording uniform issues, reading
  lifecycle tasks, and completing a task.
- **Recruitment:** reading staffing plans, reading and scheduling an
  applicant's interviews, recording an interview result, and reading or
  proposing hire proposals.
- **Performance and training:** reading templates and scores, recording a
  score, reading training programmes, and nominating somebody for one.
- **The shop's cash:** `store-cash/boxes` (its Cash on hand, Petty cash and
  Cashier float with today's book figure) and `store-cash/counts` (reading and
  recording a count, note by note). The handler binds both to the relaying
  node's own site, whatever the query names.
- **Notifications:** listing them and marking one read. These are always the
  person's own.
- **General Affairs:** `ga/locations/{site}`, the asset list, one asset, a note
  on an asset, contract types, one contract, repair objects, the repair list,
  filing a repair, the maintenance-task list, supply categories, the supply
  list, and filing a supply request.

Everything else is left off, including personal data (NIK), pay and payroll
runs, fingerprint enrolment, grievances, exit, rule-setting, finance and stock.
So are head office's own decisions: deciding a hire, a change proposal or a
claim payout, approving payroll, and reopening a closed month. Also off:
`/employees/me/colleagues`, because it reads the caller's own posting rather
than a reach; `ga/overview`, the estate-wide dashboard, which has nothing to
filter by site; and the `ga/contracts` list. A store reads its contracts,
including company-wide ones, through `ga/locations/{its site}`.

### What bounds each read

Every read or write that names a person or a place goes through the caller's
`Reach`, and a relayed call's reach is limited to the node's place (see below).
That covers the team, the roster, attendance, corrections, leave, overtime,
claims and advances, change proposals, payroll adjustments, uniforms,
lifecycle tasks, staffing plans, interviews, hire proposals and performance
scores. A request about the caller's own record (`me`) still reaches that
record.

The rest is reference data that the whole company shares and that names nobody:
leave types, a year's holiday calendar, shift patterns, `org/positions`,
`people-policy`, the pay-component catalogue, performance templates, and the
training-programme calendar (titles, dates, cost and a participant count, with
no names).

Two existing gaps were closed as part of this work, because the relay would
otherwise have exposed them to a store:

- `GET lifecycle/tasks?employee_id=…` returned a named employee's tasks to a
  caller whose reach is `Nowhere`. It now returns an empty list, the same as
  the other lists.
- `POST …/leave-requests/{id}/withdraw` did not check reach when someone
  withdrew a colleague's request. It now does, the same as approving or
  rejecting.

## What Cloud checks (`auth::relayed_principal`)

Any request that carries `x-relay-origin` or `x-relay-user` goes down the relay
path. It does this even when `INVENTORY_AUTH_MODE=disabled`, so a relayed call
never becomes the development `Admin`. Cloud then checks, in order:

1. **The path is on the allowlist.** If not, `403`.
2. **The node is who it says it is.** `x-relay-origin` must authenticate with its
   own `x-sync-key`, using the same `authenticate_origin` as `/sync/ingest`.
3. **The node belongs to a unit.** The origin's `site_id` must resolve through
   `unit_of_origin` (`site.unit_id`). If it does not, `403`.
4. **The person may sign in at this node now.** `x-relay-user` must be an
   active `app_user` with an active `edge_identity_assignment` at this origin.
   Revoking either one stops the relay on the next call.

Cloud then builds the `Principal` from the real user. Their username and display
name make `actor_id` checks and audit rows name the person, not the node. Their
role is the lower of the Cloud role and the edge role on the assignment.
`relayed: Some(RelayBinding { origin_id, site_id, site_kind, unit_id })` records
the node the call came through and the unit its site belongs to. These are two
different ids: a site is a premises, while a unit is the HR and accounting
scope. The path role gate and the `actor_id` check apply as they do for any
session. There is no CSRF check, because there is no cookie.

## How Cloud limits a relayed call to the node's site and unit

- **HR:** `reach_from` in `http/employment.rs` resolves every HR handler's
  reach, and `Reach::bounded_to(unit_id)` cuts it down to the unit resolved
  from the origin's site. `Everywhere` becomes `Only(unit_id)`, and
  `Only(unit_id)` stays. `Only(elsewhere)` and `Nowhere` both become
  `Nowhere`. So an Admin at a till reaches only that site's owning unit, and a
  supervisor posted to another unit reaches nothing there. A list that takes
  no unit filter is limited the same way. `employees/me/reach` reports this
  bounded `unit_id`; the store UI uses it for HR filters and queue fences and
  never compares it with the node's `site_id`.
- **GA:** GA resolves no `Reach`, so helpers on `Principal` do the same job,
  and every GA handler on the list calls them using the node's physical
  `site_id`:
  - **Lists.** `site_filter` sets a list's `site` to the node's site when no
    site is given. Asking for another site, or for this site plus another, is
    refused with a sentence, not quietly narrowed.
  - **Rows by id.** `may_touch_site` refuses an asset, or an asset being
    noted, unless it is at the node's site. `may_touch_coverage` does the same
    for a contract: it must be at the node's site, or cover every site
    (`ALL_SITES`), or cover every store (`ALL_STORES`) when the node is a store.
    These are the same contracts that `ga/locations/{site}` lists.
  - **Bodies.** A new repair or supply request must name the node's site. A
    repair's `asset_id` must be at the node's site, and its `contract_id` must
    be at or cover the node's site. The supply request also passes the node's
    site to the domain's own-site guard.
  - **`ga/repairs` and `ga/maintenance-tasks`.** Their readers take no site
    filter. For a relayed call, the handler reads up to the readers' ceiling of
    1000 rows and keeps only the rows at the node's site, the same way
    `ga/locations/{site}` builds its strips. For maintenance tasks this means
    the task's own `site_id`, the same rule the location page uses. A relayed
    call may pass `site=`, which must be the node's site. Head office's own
    sessions behave as before and are still refused a `site` parameter.
  - **Facets.** Facets that count across the whole estate would reveal other
    shops' figures, so relayed calls change them. On the asset list, the `sites`
    facet keeps only the node's site, and the class, build, condition and
    status facets are emptied. On the repair list, `sites` keeps only the
    node's site, `objects` and `statuses` are recounted over the shop's own
    rows, and `total` and `actual_cost_total_minor` cover only those rows too.
    On the maintenance-task list, `sites` keeps only the node's site and
    `statuses` is recounted the same way.

A request about the person's own record (`me`) still reaches that record, just
as it does on every other surface, when that person has a posting inside the
node's bounded unit.

## Configuration

- The store edge needs `SYNC_UPLOAD_URL` and `SYNC_UPLOAD_KEY`. The key must be
  the one Cloud registered for this origin (`sync_origin_credential`), and the
  origin must be registered with its site (`site_id`). Without an upload URL the
  relay answers `503`.
- The person at the till must be a **CLOUD-projected** user. That means an
  active Cloud login with an active edge assignment to **this node**, published
  to the node by `auth.policy.replace`. A LOCAL break-glass account has no
  identity at Cloud and is refused with `403`. A node with sign-in disabled
  relays for nobody.
- Offline, HR and GA are unavailable at the till. Sales, the drawer and stock do
  not go through this route and keep working from the edge's own SQLite.

## Trust boundary

The node's key proves which premises is calling. It cannot prove who is
standing at the till; only the edge's own sign-in knows that. So Cloud takes the
node's word for the person, but only as far as its own register allows (an
active assignment at this node), and never beyond the owning unit for HR or the
physical site for GA. A stolen node key can at most act as a person assigned to
that node, inside those same bounds. That is the same limit the voucher relay
has.

## Tests

- `backend/src/cloud/domain/relay.rs`: which paths match the allowlist, and the
  lower-role rule.
- `backend/src/cloud/domain/employment/reach.rs`: `bounded_to`.
- `backend/tests/store_hr_relay_integration.rs`: Cloud refusals (wrong or
  missing key, unassigned or revoked user, node with no place, path not on the
  list, forged `actor_id`, dev mode), the HR reach limit, and GA site
  enforcement. `a_relayed_store_uses_the_site_owning_unit_for_hr` verifies that
  HR uses the unit resolved from a different `site_id`; the GA cases cover
  lists, rows by id, contract coverage, bodies, the narrowed repair and task
  lists, and the stripped facets.
- `backend/tests/store_central_relay_edge.rs`: edge refusals (no session,
  LOCAL account, path not on the list or encoded, no upload URL, sign-in
  disabled), plus one full trip from the edge to a live Cloud.
