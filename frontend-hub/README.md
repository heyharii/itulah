# frontend-hub

The central console for the itulah cloud node, in the Cloud Hub ("ollama")
design language.

It replaces `frontend-cloud`. Both run side by side until every screen has
moved; nothing in `render.yaml` points here yet.

## Why a new app rather than a retheme

`frontend-cloud` reached this language by pointing shadcn's slots at Cloud Hub
values — `--background: var(--os-canvas)`, and so on. That works, but it leaves
two vocabularies alive: every component still speaks `--primary`/`--muted` and a
reader has to hold the mapping in their head. `CLOUDHUB-BRIEF.md` is 25kB of the
consequences.

This app has one vocabulary. The tokens in `src/styles/index.css` *are* the
design system and Tailwind's utilities are generated from them, so `bg-soft` and
`text-ink` are the only spellings that exist. There is no mapping layer to
forget, and no shadcn registry to be overwritten by the next `shadcn add`.

## Shape

```
src/
  styles/index.css        the design system: tokens → @theme → base layer
  lib/
    api.ts                the node and the two session keys
    session.tsx           useIdentity / useNodeIdentity / useSignOut
    navigation.ts         types + the composed module list
    table.ts              the one TanStack Table feature set
    format.ts             money / dates / the status taxonomy
    queries/<domain>.ts   one file per domain: fetchers + their query keys
  components/
    shell/                rail · sidebar · command palette (no header — see below)
    ui/                   the authored primitives every screen is built from
  screens/<module>/
    nav.ts                this module's rail tile and sidebar (owned by the module)
    index.ts              path → component, merged by routes.tsx
    *.tsx                 the screens
  routes.tsx              the route tree, GENERATED from the navigation registry
```

Two things are derived rather than transcribed, and both exist to stop the same
class of bug on a surface this wide:

- **The router is built from the navigation registry.** A path is declared once.
  A sidebar entry cannot 404, and a screen cannot be routed with nothing linking
  to it — `routes.tsx` throws at module load if one is.
- **Each module owns its own nav.** `lib/navigation.ts` only composes the nine.
  Adding a screen never touches another module's file.

## The shell has no header

`inventory-prototype.html` ships its `<header class="topbar">` with a literal
`hidden` attribute: the 58px icon rail and the 248px sidebar took over
everything it carried. This app reproduces that. Search is ⌘K, the account sits
at the foot of the sidebar, and every screen gets its full height.

## Density

The prototypes render at `zoom: 0.9` with declared px on top. DESIGN.md is
explicit that the zoom must never ship, so it is baked into the root instead:
`:root { font-size: 14.4px }` (16 × 0.9), and every size is written as
`declared/16` rem. A rail declared at 58px measures 52.2px on screen — exactly
what the prototype paints — and unlike `zoom` it survives browser text scaling.

**Never write a raw px type size.** It is the one defect that silently breaks
the whole scale.

## Running it

```bash
npm run dev        # :5273, proxying /api to VITE_API_TARGET
npm run build      # tsc -b && vite build — this is the real gate
npm run lint
```

`npm run typecheck` is `tsc -b`. A bare `tsc --noEmit` against the root
solution-style tsconfig checks nothing and always passes; `-b` is the gate.

Point it at a local node with `VITE_API_TARGET=http://127.0.0.1:8080 npm run dev`.
Same-origin matters: the session cookie is `SameSite=Strict`, so the dev proxy
is reproducing production's single origin, not saving a CORS config.

## Gates

```bash
npm run build          # tsc -b && vite build — the real gate
npm run lint
npm run design-lint    # px type sizes, hex colours, a fourth weight, dark overlays
npm run endpoint-audit # every cloud endpoint is reachable from the client
```

## Before writing a screen

Read `PATTERN.md`. It is short, and it is the difference between nine modules
that look like one app and nine that look like nine.
