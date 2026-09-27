> **RETIRED 2026-09-26.** This app is no longer used or run. Its receiving,
> counting and other DC stations now live in frontend-hub → **Operations**
> (Receiving at `/operations/intake`). See [RETIRED.md](RETIRED.md).

# frontend-floor

**Lantai** — the warehouse floor on a phone. One app for the six stations goods
pass through in a DC: receiving, tagging, picking, packing, despatch, and the
stock take that cuts across all of them.

It talks to a **DC edge node** — the machine standing in the building — over
`/api/v1/dc/*` plus the shared `inventory`, `catalog`, `sync`, `auth` and
`health` routes. It never addresses the centre.

## Three things make it different from every other surface here

**It is a phone, not a tablet or a desk.** The design system is
`frontend-hub`'s, byte for byte in `src/styles/index.css`, but the shell is
DESIGN.md's *phone expression*: full-bleed, a three-zone app-bar, a floating
squircle tab bar, a hamburger drawer, and every control at or above 44px.
`frontend-store-new` is the sibling this is built from — the same kit, a
different building.

"Byte for byte" stopped being true once already: the console re-cut its palette
and this app kept the old one for three days without anything failing, because
nothing checked. Re-cut on 2026-09-13 — blue-grey ink, a plain blue accent and
CTA, radii down a step, controls no longer full pills, outlined status pills —
and `npm run design-lint` now compares the two `:root` blocks and fails on a
difference, so the claim above is a test rather than a promise.

**It speaks Indonesian.** The hub is read at head office and the contract is
read by programmers; this is read by the person holding the carton. The server
shouts its enums in English (`PARTIALLY_RECEIVED`, `IN_TRANSIT`), so the
translation happens once, in `lib/format.ts`, rather than in forty template
literals that would each drift on their own.

**Work is written to disk before it is sent** (`lib/outbox.ts`). A rack aisle is
steel on both sides, the bay doors are at the edge of the wifi, and the phone is
pocketed between cartons. A count that existed only as an in-flight `fetch` is
an hour of somebody's counting that nobody knows to redo.

## Shape

```
src/
  styles/index.css        the design system: tokens → @theme → base layer
  lib/
    api.ts                the node, the pools, the SKU names
    queries.ts            every read, and the key it is cached under
    outbox.ts             the durable queue for floor work  ← read this one
    draft.ts              a tally that survives the phone sleeping
    waiting.ts            what is queued per station, for the work list
    epc.ts                the tag codec, mirrored from the Rust
    navigation.ts         5 tabs + 2 stations + 11 pushed; the router is built from it
  components/
    shell/floor-shell.tsx app-bar · drawer · tab bar · outlet
    ui/                   the authored primitives, all of them ≥44px
  screens/*.tsx           one file per screen; `index.ts` maps path → screen
  routes.tsx              the route tree, GENERATED from lib/navigation.ts
```

`routes.tsx` throws at module load if `navigation.ts` and `screens/index.ts`
disagree in either direction. There are no placeholder screens: a station that
opens on "belum dibuat" while a lorry is on the bay is worse than no station.

## Picking is free, packing is bounded

The two stations look alike — name a SKU, type how many — and the arithmetic
behind them is opposite. This is the node's design, not a choice made here, and
getting it wrong is how an app ends up arguing with the warehouse.

**Picking consults nothing.** `edge/sqlite.rs::pick_stock`: *"No allotment is
consulted here. Picking fetches a SKU and a number; which piece serves which
shop is settled when it goes into a carton."* So nobody is handed a list to work
through: a picker walks the racks, takes what is on them, and types how many. A
SKU no shop asked for is still pickable. A **short pick is ordinary** — asked for
300, found 200 — and the node records the 200 rather than failing, so the outbox
says which of the two numbers came back.

**Packing is refused twice.** `pack_by_quantity` will not take a line asking for
more than is standing in the picking area (*"a short pack is not an ordinary
outcome the way a short pick is"*), and `pack_koli` refuses a piece it cannot
attach to an open allotment line for that shop. Both are checked on the phone
before anything is queued, because a pack that leaves wrong comes back refused
an hour later, at a bench where the carton is already taped shut.

`outstanding_for_destination` keeps *wanted* and *available* apart on purpose,
so the pack sheet shows both: "the shop does not want more" and "nobody has
fetched it yet" call for very different next actions.

## What is in the outbox, and what is not

In: a count, a verification, a tagging confirmation, a pick round, a pack,
stock-take entries. Every one of them **records work already done to goods** —
the carton is on the trolley, the tags are on the garments — and losing it loses
the work, not the typing.

Out: opening a shipment, building a dispatch, sealing a carton, sending a truck
off the yard. Each is a decision made at a bench by somebody watching the
screen, needs the node's answer to do the next thing with, and costs nothing to
repeat. A queued consignment would be a number that does not exist yet, printed
on a document, handed to a driver.

Two properties the queue is built on:

- **Idempotency keys are derived from the job's own id**, so the attempt after
  the reload carries the same key the first one did and the node's
  `load_idempotent` recognises the second delivery of one count.
- **The actor travels with the job, not with the session.** The node refuses a
  verification by the person who counted, and stamping whoever happened to be
  signed in at send time would break that check in the one direction nobody
  would notice — by making two people look like one.

## Traps this app already walked into

- **A pick does not draw down an allotment line; a pack does.** `edge/sqlite.rs`
  says so in as many words ("picked and packed rise together"). So the picklist
  goes on asking for a garment that is already standing by the bench, and the
  Ambil screen says how many are there rather than letting somebody fetch them
  twice.
- **A picklist can be accepted and still not be fully done, two ways.** A line
  with nothing on the racks comes back in `refused` rather than failing the
  request; a line with only half of it there is not reported at all, because the
  node takes what it finds. The outbox works out the difference between what was
  typed and what was taken, marks the job `partial`, and says so.
- **A polled query that has never had an answer sits at `pending` between its
  attempts**, so a screen that watched only `isPending`/`isError` said
  "Menanyakan node…" for as long as the node was down. `lib/query-state.tsx`
  reads `failureCount` for exactly that reason.
- **A reload with the node unreachable must not become a login wall.** The
  session is a cookie and the cookie is still there; `lib/session.tsx` keeps the
  last known person and re-asks for real on reconnect.

## Running it

```bash
npm install
npm run dev        # http://localhost:5277, and on the LAN — see below
```

`VITE_API_TARGET` points the dev proxy at a DC node (default
`http://127.0.0.1:8082`). The `.claude/launch.json` entries are:

| Entry | What it runs |
|---|---|
| `floor` | this app on 5277, proxied to the demo DC on 8092 |
| `floor-dc-node` | that demo DC (`demo/dc`), with its uploader switched off |

**The dev server listens on the LAN** (`server.host: true`), which no other app
here does — this one is read on a phone that is not this machine, and the proxy
is what gives that phone one origin for the app and its API. Open
`http://<this-machine>:5277` from the handset, or reach it over the tailnet.

For a node you can safely write to, copy the demo rig first — it is 20MB and
gitignored:

```bash
cp -R demo/dc demo/floor-verify   # then set BIND_ADDR and empty SYNC_UPLOAD_URL in its .env
```

## Checks

```bash
npm run typecheck && npm run lint && npm run design-lint && npm run endpoint-audit
```

`design-lint` guards the four rules that break the visual language silently (a
raw px type size, a hex colour, `font-bold`, a dark overlay). `endpoint-audit`
reports which of the node's routes this app actually reaches — the store-role
ones are not this app's and are counted out.
