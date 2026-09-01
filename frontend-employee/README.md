# frontend-employee

The employee's own surface: profile, leave, hours, overtime, payslips.
A phone first — the tab bar, the tap targets and the safe-area padding are
sized for one hand in an apron pocket — and a sidebar layout from `md` up.

It talks to the **CLOUD** node, like head office does, because an employee's
record follows the person rather than the building.

## The backend does not exist yet

None of the HR routes are implemented. `/api/v1/employees/*`, `/api/v1/leave-types`,
`/api/v1/notifications`, `/api/v1/me/sessions` — the server answers 404 to all
of them today.

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
