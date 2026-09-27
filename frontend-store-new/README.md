# frontend-store-new

The shop's back office — catalogue, promotions, stock, the takings, its people
and its premises — in the same design language and the same shell as
`frontend-hub`. It replaced `frontend-store`, which has been removed; both
store sites in `render.yaml` build this app.

Selling is **not** here. The counter runs on the POS app (`pos-desktop`); this
app opens on the Catalogue. `lib/sale-queue.ts` and `lib/basket.ts` are still
started by `App.tsx` so a browser that queued sales before the counter screens
were removed goes on sending them, and the sign-out guard still asks before
leaving unsent sales behind.

## One server, one sign-in

The app talks to exactly one server: the **store Edge** behind the counter
(`/api/*`, proxied in dev and rewritten by Render in production, so the
`SameSite=Strict` session cookie is sent).

- **Catalogue, Promotions, Stock, Money** are answered by the Edge out of its
  own SQLite, so they keep working with the line to head office down.
- **People (HR), GA and Kabar** live only at head office. The Edge **relays**
  them: `/api/v1/store/central/{path}` → `{cloud}/api/v1/{path}`, on behalf of
  whoever is signed in at the till (`src/lib/cloud.ts`,
  `docs/store-edge-hr-relay.md`). The centre checks the node's machine key, that
  the person is an active head-office account assigned to this node, that the
  path is on the allowlist, and cuts every answer down to this node's own place.
  A LOCAL break-glass account, or a node running with sign-in off, is refused
  with a sentence on screen. With the line down these screens say so; nothing
  else stops.

There is no second, head-office sign-in and no `/central` proxy any more.
Every head-office call is written with the centre's own path
(`cloud.get("/api/v1/employees")`) so it can be read against the relay's
allowlist and the hub's screens by eye; `lib/cloud.ts` adds the relay prefix.

## The shell is the hub's

`src/styles/index.css` is `frontend-hub/src/styles/index.css`, copied whole,
plus a short "Till-only" block. If the two ever look a generation apart, diff
the files before looking anywhere else (`npm run design-lint` checks the
tokens).

`src/components/shell/` is the hub's shell over the shop's own modules:

- **Rail** (`rail.tsx`) — the dark column of modules: Catalogue, Promotions,
  Stock, Money, People, GA; Kabar and This node as icons at its foot.
- **Sidebar** (`sidebar.tsx`) — the active module's screens, the shop and node
  in the workspace chip, the person at the foot. A module with one screen
  (Catalogue) gets no column; the rail already names it. ⌘B folds it.
- **Top bar** (`top-bar.tsx`) — the breadcrumb, sync status, Kabar.
- **Under 64rem** both columns fold into one drawer; **under 48rem** a phone
  navigates from the bottom bar (`bottom-bar.tsx`), whose last tab opens that
  drawer.

`lib/navigation.ts` is the one registry (the hub's `AppModule` shape): the
rail, the sidebar, the bottom bar, the breadcrumb and `routes.tsx` all read it.
`routes.tsx` throws at load if a nav path has no screen or a screen has no nav
path, and redirects each item's `moved` paths so old bookmarks still land.

## Modules

| Module | Screens | Answered by |
| --- | --- | --- |
| Catalogue | the range as a grid with prices (the hub's Sourcing look); a product's card | Edge |
| Promotions | Promotions, Campaigns, Price drops, Vouchers | Edge (the price book) |
| Stock | On hand, Receive, Movements | Edge |
| Money | Sales, Reconciliation, Expenses, Reports | Edge |
| People | Overview, Directory · Time: Roster, Attendance, Leave, Overtime · Pay: Payroll (the month close), Expenses, Benefits · Talent: Recruitment, Onboarding & exit, Employment changes, Performance, Training | head office, relayed |
| GA | Overview · Premises: Assets, Contracts, Servicing · Requests: Repairs, Supplies | head office, relayed |
| Kabar | what head office has told this shop | head office, relayed |
| This node | Sync, Change password | Edge |

People follows the store role of the HR prototype (`prototypes/hr-v3/hr.html`,
"HR toko"); a shop records what happened and decides the day-to-day, head office
owns the rules and the money. GA is the hub's GA cut down to what a shop has,
matching the per-shop GA accounts in the client's chart (rent, fixed assets and
operating equipment, repairs, utilities, permits, insurance). Every head-office
list is scoped to this node's `site_id`; there is no unit picker.

## Shape

```
src/
  styles/index.css      the hub's design system + the till-only block
  lib/
    api.ts              the Edge client and the session keys
    cloud.ts            head office, through the Edge relay
    navigation.ts       the registry; the router is built from it
    layout.ts           the hub's breakpoints (phone / tablet / desktop / monitor)
    queries.ts          Edge reads, and the keys they are cached under
    queries/hr.ts       People reads and writes
    queries/ga.ts       GA reads and writes
  components/
    shell/              app-shell · rail · sidebar · top-bar · bottom-bar
    ui/                 the primitives; `screen.tsx` is every page's frame
  screens/              one file per screen; `index.ts` maps path → screen
  routes.tsx            the route tree, GENERATED from lib/navigation.ts
```

## Running it

```bash
npm run dev          # :5275, proxying /api to VITE_API_TARGET
npm run build        # tsc -b && vite build — the real gate
npm run lint
npm run design-lint
```

Point it at a local store Edge with
`VITE_API_TARGET=http://127.0.0.1:8081 npm run dev` (`launch.json` runs the
Edge on 8081). For People, GA and Kabar the Edge needs `SYNC_UPLOAD_URL` and
`SYNC_UPLOAD_KEY` for a cloud that has registered it, and the person signed in
must be a head-office account assigned to that node. Without those the screens
explain why, and every other module keeps working.

## Before writing a screen

`PATTERN.md` in `frontend-hub` applies — tokens, colour, weight, state — and
now the shell rules too. Frame a page with `Screen` from
`components/ui/screen.tsx` (`title`, `sub`, `actions`, `counter`, `foot`): it
draws the hub's `PageHeader` on a desk and leaves the phone's title to the bar.
Never display or log a password.
