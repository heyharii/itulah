# frontend-employee

The employee's own surface: profile, leave, hours, overtime, payslips.
A phone first — the tab bar, the tap targets and the safe-area padding are
sized for one hand in an apron pocket — and a sidebar layout from `md` up.

It talks to the **CLOUD** node, like head office does, because an employee's
record follows the person rather than the building.

## Half the backend exists now

**Live, against real routes, with no stand-in behind them:** the profile
(`/employees/me/profile`), leave — `/api/v1/leave-types`,
`/employees/me/leave-balances`, `/employees/me/leave-requests` and its
`withdraw` — overtime (`/employees/me/overtime-orders` and its `consent`), and
attendance: `/employees/me/attendance` for the derived fortnight and
`/employees/me/punches` to clock in or out. A failure on those is a failure and
says so.

**Still standing in:** corrections, and device sessions. The server answers 404
to those, and `demo.ts` covers them.

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

So `src/lib/hr/` makes the real request and falls back to `demo.ts` **only** on
a 404 or a 501:

- `types.ts` — the wire as proposed. Every other type in this repo is generated
  from Rust (`make contract`); these cannot be, because there is no Rust struct
  yet. When the routes land, these become generated `contract/` files and this
  file is deleted rather than kept in parallel.
- `api.ts` — one function per route, correct path and method. A 401 still means
  sign in and a 500 still fails; only "this route does not exist" stands in.
- `demo.ts` — one plausible employee's year. Reached only when the server has
  said 404, and the screen says so in a banner while it is being used.

A write is not attempted at all once the reads have come back 404: this node
answers an unrouted path with 405 to a POST, and 405 on a server that *has*
these routes would mean a real bug, not an absent backend.

Deleting `demo.ts` and the fallback in `api.ts` is the whole of the cleanup
once the server catches up.

## Running it

```bash
npm install && npm run dev
```

Point it at a local node with `VITE_API_TARGET=http://127.0.0.1:8080 npm run dev`.
With `INVENTORY_AUTH_MODE=disabled` on that node there is no account to create.
