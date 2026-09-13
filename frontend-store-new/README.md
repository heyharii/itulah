# frontend-store-new

The till, in the Cloud Hub ("ollama") design language. It replaces
`frontend-store`, which keeps running until this does.

It talks to the **store Edge node** — the machine behind the counter — over the
seven `/api/v1/store/*` endpoints plus the shared `inventory`, `sync`, `auth`
and `health` ones.

It addresses the centre in exactly one place, and only because it has to: the
**HR screens**. The Edge has no HR at all — there is no employee, no roster, no
attendance and no leave in `backend/src/edge/` or in
`backend/migrations/sqlite/` — because a shop's rota is a fact about the
company rather than about the shop's machine, and the company keeps it in one
Postgres. Those five screens read the cloud through a second client
(`src/lib/cloud.ts`) and a second session, and they are the only screens here
that stop working when the line to head office does. **They say so on screen**;
everything else in this app goes on working with nothing reachable. See
"Head office, and the one exception to offline" below.

## It is the same design system, and a different shell

`src/styles/index.css` carries the tokens of `frontend-hub` byte for byte. Two
things differ, and both differences are DESIGN.md's own — this app is that
document's **phone expression** (its `xs` row), not its desktop one.

Re-cut against the console on 2026-09-13, which is the second time these two
files have drifted a generation apart without anything failing. If the till
ever looks older than the hub again, diff the two `:root` blocks before
looking anywhere else. What changed that round: the ink ramp went blue-grey,
the accent left indigo for a plain blue, every radius came down a step,
controls stopped being full pills, the status pill became outlined, and the
one filled action became `--cta` instead of a hardcoded black.

**No rail and no app-card, and — since 2026-09-13 — a sidebar at `md` and up.**
Full-bleed, a three-zone app-bar, a floating squircle tab bar, and a hamburger
drawer for everything else. The tab bar is five **separate** 54px squircles
with 14px of nothing between them — there is no containing bar, and the active
one is a solid `{accent}` squircle with a white glyph. It is the one thing here
that did NOT take the new control radius: 18px is measured from the frames
spec, which the responsive model was derived from, and it is a phone geometry
rather than a control geometry. A pushed detail screen hides the bar.

The sidebar is the correction of a hole this file used to describe as a
decision. The squircles were drawn `md:hidden` against a comment promising that
"the desk's own function board carries the same four destinations" — and
nothing ever drew that board. `components/shell/desk.tsx` still exports
`FunctionBoard` and `FunctionKey`, and no screen has ever imported either. So
every window wider than 768px had NO navigation at all: an app-bar whose
hamburger held four account items, and no way to reach Catalogue, Receive,
Stock or Reports. What replaced it is the console's own column, in the
console's own tokens (`components/shell/sidebar.tsx`), reading the sections
declared in `lib/navigation.ts`. Exactly one navigation is on screen at any
width: the column at `md`+, the squircles below it. If you ever hide one, draw
the other in the same commit.

**16px root, not 14.4px.** The console bakes DESIGN.md's `zoom:0.9` into the
root so a `declared/16` rem lands on the pixel the prototype paints. The phone
reference does not: `_archive-distribution-frames.html` sets `.app{zoom:1}` at
`max-width:860px`. It also cannot here — the mobile rules put a hard 44px floor
under a touch target, and 44 declared at 0.9 measures 39.6. So the scale is
full size, `declared/16` still lands on the declared pixel, and every control
in `components/ui/` clears 44px. Never write a raw px type size either way.

## Shape

```
src/
  styles/index.css      the design system: tokens → @theme → base layer
  lib/
    api.ts              the node, and the two session keys
    queries.ts          every read, and the key it is cached under
    sale-queue.ts       the durable outbox for money  ← read this one
    basket.ts           what is on the counter, kept on disk
    epc.ts              the tag codec, mirrored from the Rust
    cloud.ts            the SECOND backend — head office, and why it uses a token
    queries/hr.ts       every read and write the People screens make
    navigation.ts       four tabs + six pushed screens; the router is built from it
    params.ts           the screen state that lives in the URL
  components/
    shell/till-shell.tsx  app-bar · drawer · tab bar · outlet
    ui/                   the authored primitives, all of them ≥44px
  screens/*.tsx         one file per screen; `index.ts` maps path → screen
  routes.tsx            the route tree, GENERATED from lib/navigation.ts
```

`routes.tsx` throws at module load if `navigation.ts` and `screens/index.ts`
disagree in either direction. There are no placeholder screens: a tab that
opens on "not built yet" in front of a customer is worse than no tab.

## Offline is the design, not a fallback

A till that stops selling when the network drops is broken, so:

- **Reads are Query with a long `staleTime`** (5 min) and a 24h `gcTime`, on
  `networkMode: "offlineFirst"`. The whole price book is fetched once and held,
  which is what lets a basket be priced, a product looked up and a receipt
  written with nothing reachable.
- **The basket is on disk.** A tablet that sleeps, is killed by the OS, or is
  reloaded by somebody "fixing" the wifi does not lose eleven scanned garments
  with a customer standing there.
- **A completed sale is written to disk before it is sent.** `lib/sale-queue.ts`
  mints the `idempotency_key` once, at enqueue, and persists it with the
  request — so this attempt, the one after the reload and the one tomorrow
  morning all carry the same key, and the node's `load_idempotent` returns the
  first answer rather than ringing the sale twice. The key also travels as an
  `Idempotency-Key` header.
- **This is the one place `retry: false` is wrong.** Everywhere else a refusal
  is a sentence to show; here the alternative to retrying is money taken with no
  record of it. `shouldRetry` retries the network and a lapsed session, and
  hands a reasoned refusal to a person.
- **Every attempt has a deadline.** `fetch` has none, and a half-open socket
  would otherwise leave the pump wedged and the sale marked _sending_ for the
  life of the tab — a till that looks like it is sending and never sends again.
- **Two tabs do not eat each other.** Both stores write their whole key, so
  each write merges against what is on disk and each store listens for
  `storage`. The queue merges (two sales are two sales); the basket converges
  (one counter has one basket).

`/sell/queue` is where all of that is visible, and it is the number a manager
should look at before locking up.

## Head office, and the one exception to offline

`src/screens/hr/*` is the store face of the People module. The approved menu is
`prototypes/hr/menu-final.md`: one People workspace, **role decides the
actions and unit decides the rows**, and a store gets five domains — Ringkasan,
Karyawan, Jadwal & Kehadiran, Cuti & Lembur, Laporan — and never Payroll or
Pengaturan. That exclusion is honoured literally: there is no screen here that
could show a pay agreement, a run or a slip. Laporan is not here either,
because no store-scoped HR report route exists at the centre and a nav entry
with nothing behind it is worse than a missing entry.

- **Two backends, two sessions.** `src/lib/api.ts` is the shop's Edge and holds
  the **cookie**; `src/lib/cloud.ts` is the centre and holds a **bearer token**.
  It has to be that way round: both nodes name their cookies identically
  (`inventory_session`, `inventory_csrf`, from `security.rs`), so proxied onto
  one origin they are the same cookie, and signing in to head office would sign
  the cashier out of their own counter mid-shift. This is the mirror of
  `frontend-hub`, which holds the cookie for the centre and a token for a DC.
- **The token is in memory, not in storage.** The hub keeps its second token in
  `sessionStorage`; this does not. A counter tablet is shared by three people in
  a day, and a head-office session that survives a reload is one the next
  cashier inherits. A reload signs the centre out, and that is the right
  default here.
- **The scope is the node's.** Every cloud read is scoped to this till's own
  `site_id` — which *is* the centre's `org_place.id`, because migration 0060
  seeded places from sites and kept their ids. There is no unit picker and
  there will not be one.
- **Two of the routes cannot be scoped by a parameter.**
  `/leave-requests/pending` and `/overtime-orders/awaiting` bound themselves by
  the caller's own posting, which is exactly right for a store credential and
  wrong for one that reaches everywhere (including every caller on a node
  running with `INVENTORY_AUTH_MODE=disabled`). The browser fences the rows to
  this site and **says how many it dropped** — a fence, not a scope.
- **`/central` is the dev prefix** and the proxy strips it (see
  `vite.config.ts`). **Production does not have the matching rewrite yet:**
  Render serves this front end on one origin and rewrites `/api/*` to the store
  node, and nothing rewrites `/central/*` to the cloud service, so HR would 404
  against the till's own node until that rule is added.
- **Not reachable from the phone drawer.** The hamburger in
  `src/components/shell/till-shell.tsx` is a hand-written list, not one
  generated from `fromDrawer`, so below `md` the HR screens are reachable by URL
  and by the module's own strip once you are in one. Adding a `People` section
  to that drawer is the one-line change that closes it.
- **There is no attendance anywhere in this system.** Every screen that could
  imply otherwise says so instead. The centre's own `CloseReadinessView`
  answers `open_corrections: null` and `punches_assessed: false` — "not
  assessed, not zero" — and these screens repeat that rather than drawing a
  clean sheet.

## Running it

```bash
npm run dev        # :5275, proxying /api to VITE_API_TARGET
npm run build      # tsc -b && vite build — the real gate
npm run lint
npm run design-lint
```

Point it at a local store node with
`VITE_API_TARGET=http://127.0.0.1:8081 npm run dev` — 8081 is where the estate's
`launch.json` runs the store Edge; 8080 is the cloud node and this app would get
404s from it. Same-origin matters: the session cookie is `SameSite=Strict`, so
the dev proxy is reproducing production's single origin, not saving a CORS
config.

The HR screens need a **cloud** node as well, proxied under `/central` and
pointed at by `VITE_CLOUD_TARGET` (default `http://127.0.0.1:8080`, which is
`launch.json`'s `cloud-api`). Without one they say head office is not
reachable, which is the correct answer rather than a broken screen — every
other tab keeps working.

## Before writing a screen

`PATTERN.md` in `frontend-hub` still applies for tokens, colour, weight and
state. Its shell rules do not. Two more hold here:

1. **Never a table.** A till is thumbs and glances. Lists are stacks of
   `<RecordCard>`; the only `<table>` in the app is `<MiniTable>`, which is the
   inside of one record, not a list.
2. **Never display or log a password.** `/node/password` has three write-only
   fields and no reveal control.
