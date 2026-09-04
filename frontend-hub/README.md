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
    shell/                sidebar · command palette (no header, no rail — see below)
    assistant/            the panel, the page's transcript, the session, the renderers
    ui/                   the authored primitives every screen is built from
  screens/<module>/
    nav.ts                this module's sidebar row and sub-items (owned by the module)
    index.ts              path → component, merged by routes.tsx
    *.tsx                 the screens
  routes.tsx              the route tree, GENERATED from the navigation registry
```

Two things are derived rather than transcribed, and both exist to stop the same
class of bug on a surface this wide:

- **The router is built from the navigation registry.** A path is declared once.
  A sidebar entry cannot 404, and a screen cannot be routed with nothing linking
  to it — `routes.tsx` throws at module load if one is.
- **Each module owns its own nav.** `lib/navigation.ts` only composes them.
  Adding a screen never touches another module's file.

## The assistant

Two surfaces, one conversation.

- **`⌘J`, or the Ask row in the sidebar** — a panel over whatever is on screen.
  Its questions are asked *about* something already in front of somebody, and
  the path of that screen is sent with the question.
- **`/assistant`** — the whole screen, with its own column of past chats. For
  the questions that are the work rather than a footnote to it: six turns, a
  table to read, a chart to look at twice. 30rem is not enough room for any of
  those.

Both read the same session (`components/assistant/state.ts`), so a chat started
in the panel continues on the page by pressing one button, and a half-written
answer stays half-written across the move. Which conversation is open lives in
`?chat=` — a chat that cannot be linked to is a chat somebody starts again.

The model runs on the server (`backend/src/cloud/http/assistant.rs`), never
here: the browser posts one question and reads an event stream back, and the
node reaches the model through OpenRouter with a key that never leaves it. The
transcript is the server's (migration `0102`); a follow-up is answered from the
words, never from rows fetched twenty minutes ago.

Its tools are nine curated reads that already back nine screens, one that
composes a report definition, and two that reach the rest: `describe_schema`
and `sql_query`. The last is one SELECT inside a Postgres `READ ONLY`
transaction — which is what makes "ask it anything about the business" true
rather than a claim about a catalogue somebody has to keep extending. It cannot
write, and credentials and live sessions are out of bounds.

What comes back is drawn, not narrated. Each curated tool has a renderer in
`components/assistant/artifact.tsx`; `sql_query` has the one that knows nothing
about what it is drawing (`query-card.tsx`, `query-chart.tsx`) — a table with
the query on the card, and a bar, line, area or pie chart when the model asked
for one. A composed report draws the chart its own spec asks for, from the same
rules the Reports screen uses (`lib/report-chart.ts`), so a chart does not
change shape when somebody presses "keep". How much a card may show depends on
where it is: `components/assistant/space.ts` — twelve rows in the panel, forty
on the page. The model is told the cards are there, so it says what the figures
mean instead of reciting them. Adding a curated tool is a `Tool` in the Rust
catalogue plus a renderer here, keyed by the same name.

Whether it is still *right* is not something a type checker can answer.
`scripts/assistant-check.mjs` asks a set of questions whose answers it computes
itself in SQL, and fails on a figure that has drifted. Cases can also carry the
classic mistake — the sum without the COMPLETED filter, the day taken off the
UTC calendar — and a case whose right and wrong answers come out the same on
the node it is run against reports BLIND rather than green, because a suite
that cannot tell them apart has proved nothing.

`/home` is the brief those questions start from: four figures, three suggested
questions, and the same composer. It costs no model call — the server assembles
it from reads it already had.

## One sidebar, no header and no rail

`inventory-prototype.html` ships its `<header class="topbar">` with a literal
`hidden` attribute: the left-hand navigation took over everything it carried.
This app reproduces that — search is ⌘K, the account sits at the foot of the
sidebar, every screen gets its full height.

The prototype's 58px rail of module tiles is gone as well. Nine modules did not
earn a switcher of their own, and two strips asked people to learn that one
meant "which part of the business" while its neighbour meant "which screen".
Now there is one column: every module is a row, and **the module you are in is
the one unfolded into its screens**. Which module that is comes off the URL, so
there is no open/closed state to restore, to keep in step with navigation, or
to be wrong in a second tab.

⌘B narrows the column to the same 58px of icons the rail used to be, tooltips
included, rather than sliding it away — navigation that vanishes leaves the
shortcut as its only way back, and nothing on screen says so.

A screen a module reaches only by a link from another screen sets `hidden` in
its nav file: still routed, still in ⌘K, not a sub-item. A sidebar is a list of
places somebody sets out for.

Five screens are not places in the business at all — Discussions, Chat, Files,
Documents and Reports — and they sit in an icon strip above the module list,
declared with `aside: true`. The flag changes only where the sidebar draws the
row: routing, ⌘K and the active highlight treat an aside like any other module,
which is why there is one flag rather than a second kind of nav entry.

**Master data** is one module holding Articles, Suppliers and the four
vocabularies (Divisions, Colours, Sizes, Tags). It groups them by what they
are rather than by who uses them, which is what makes Divisions, Sizes and Tags
findable — until `0091` they were tables nothing could edit. The chart of
accounts is deliberately not in it: nobody looks for an account outside
Finance.

## Density

The prototypes render at `zoom: 0.9` with declared px on top. DESIGN.md is
explicit that the zoom must never ship, so it is baked into the root instead —
and since 2026-09-04 it is baked at **1.0**: `:root { font-size: 16px }`, with
every size written as `declared/16` rem, so a value named 12.5 renders at 12.5.

The 0.9 was there first, faithfully (`14.4px` = 16 × 0.9). It was too small to
work in. The scale already bottoms out near 10px, and taking a tenth off that
put micro-caps at 9px, mono ids at 9.45 and a grid cell of money at 11.25. A
prototype is looked at; a pricelist is worked in for an afternoon. The bottom of
the scale came up a step with it — eyebrow 10 → 11, id 11.5 → 12, meta and cell
12.5 → 13.

**The root is the one knob for the app's size.** Shell geometry is rem too
(`w-[15.5rem]` sidebar, `w-[3.625rem]` rail), so changing it scales type and
spacing together — reach for it before touching any individual size.

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
