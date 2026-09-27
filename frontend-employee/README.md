# frontend-employee

The employee's own surface: profile, leave, hours, overtime, payslips.
A phone first — the tab bar, the tap targets and the safe-area padding are
sized for one hand in an apron pocket — and a sidebar layout from `md` up.

It talks to the **CLOUD** node, like head office does, because an employee's
record follows the person rather than the building.

## Every screen is live

Everything this app shows comes from a real route on the cloud node, typed
from `@itulah/contract` (generated from the Rust structs). There is no
example-data fallback any more: a 404 is a failure and says so, and a login
with no employment record behind it gets one "not linked yet" panel instead.

| Screen | Routes |
|---|---|
| Home, Me | `/employees/me/profile`, `/contracts`, `/payroll-identity`, `/lifecycle-tasks`, `/holiday-calendars` |
| Leave | `/leave-types`, `/employees/me/leave-balances`, `/employees/me/leave-requests` (+ `withdraw`) |
| Hours | `/employees/me/attendance`, `/employees/me/punches`, `/employees/me/attendance-corrections` |
| Swap a day | `/employees/me/roster-swaps`, `/employees/me/colleagues`, `/roster-swaps` (+ `withdrawal`) |
| Overtime | `/employees/me/overtime-orders` (+ `consent`) |
| Pay, Claims | `/employees/me/payslips`, `/employees/me/expense-claims`, `/expense-claims` (+ `submission`) |
| Raise a concern | `/grievance-types`, `/grievances` — read by head office HR only |
| Notifications | `/notifications` (+ `read`, `read-all`) |
| Team (store heads only) | `/leave-requests/pending`, `/attendance-corrections`, `/roster-swaps/pending` and their decisions |

Where these filings are *decided*: leave, corrections and swaps in the hub's
**People › Requests** (every place, head office included), on a store's till
under **HR**, or on this app's Team screen; claims in **People › Claims**.
Nobody decides their own filing — the server refuses it.

### Clocking in from here is a second punch source, and it says so

The owner's decision is a fingerprint station in every unit — no PIN, no card.
None has been bought, so until they arrive this app is the only way anybody
clocks in, and it exists so the HR month can be walked end to end at all.

It is therefore deliberately **not** disguised as a reader. The route is its own
(`POST /employees/me/punches`, bounded to the caller's own record), every row it
writes carries `source = 'EMPLOYEE_APP'` and names no station, and every day on
the Attendance screen says which source produced its readings. When the readers
land, the months either side of them stay tellable apart.

The body carries the direction and nothing else. The server stamps the instant,
resolves which roster day the reading answers — yesterday, for a shift running
past midnight — takes the place from the posting, and derives the punch's id
from its own content, so a double tap lands once and answers
`newly_recorded: false`.

Two things changed shape when leave landed, and they are worth knowing before
reading the diff. The proposal's `LeaveType` carried the reader's own balance
inside it; the server keeps the kind and the balance apart, because a kind is
one row for the company and a balance is a fold over one person's ledger — and
most kinds have no balance at all. `useLeaveEntitlements` joins the two reads
where the screens want them joined. And `cancel` became `withdraw`, because
only the person who filed a request may take it back; anybody else who wants it
gone must *reject* it under their own name, and one word for both would have
hidden which had happened.

Overtime renamed two things for the same kind of reason. `acknowledge` became
`consent` and `accepted` became `agreed`: acknowledging an instruction is
admitting you received it, and what PP 35/2021 art. 26(2) asks for is your
agreement. The answer is recorded under a key your supervisor does not hold —
which is why this app can answer an order and the head-office console cannot.

## Running it

```bash
npm install && npm run dev
```

Point it at a local node with `VITE_API_TARGET=http://127.0.0.1:8080 npm run dev`.
With `INVENTORY_AUTH_MODE=disabled` on that node there is no account to create.
