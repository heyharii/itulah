# frontend-store-new

The till, in the Cloud Hub ("ollama") design language. It replaces
`frontend-store`, which keeps running until this does.

It talks to the **store Edge node** — the machine behind the counter — over the
seven `/api/v1/store/*` endpoints plus the shared `inventory`, `sync`, `auth`
and `health` ones. It never addresses the centre.

## It is the same design system, and a different shell

`src/styles/index.css` carries the tokens of `frontend-hub` byte for byte. Two
things differ, and both differences are DESIGN.md's own — this app is that
document's **phone expression** (its `xs` row), not its desktop one.

**No rail, no sidebar, no app-card.** Full-bleed, a three-zone app-bar, a
floating squircle tab bar of four destinations, and a hamburger drawer for
everything else. The tab bar is four **separate** 54px squircles with 14px of
nothing between them — there is no containing bar, and the active one is a
solid indigo squircle with a white glyph. A pushed detail screen hides it.

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

## Before writing a screen

`PATTERN.md` in `frontend-hub` still applies for tokens, colour, weight and
state. Its shell rules do not. Two more hold here:

1. **Never a table.** A till is thumbs and glances. Lists are stacks of
   `<RecordCard>`; the only `<table>` in the app is `<MiniTable>`, which is the
   inside of one record, not a list.
2. **Never display or log a password.** `/node/password` has three write-only
   fields and no reveal control.
