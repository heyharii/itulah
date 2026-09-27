# frontend-hub — how a screen is written

This app covers the cloud node's ~147 endpoints in the Cloud Hub ("ollama")
design language. It is deliberately consistent: one shell, one token vocabulary,
one table grammar, one way to read and one way to write. Read this before
adding a screen, and copy `src/screens/procurement/purchase-orders.tsx` — it is
the reference implementation and every part of it is there on purpose.

## Sources of truth

| Thing | Where |
|---|---|
| Design language | `~/Documents/retail/cloud-app/ollama/DESIGN.md` |
| Shell + component CSS | `~/Documents/retail/cloud-app/ollama/inventory-prototype.html` |
| Settled conflicts | `/Users/hari/itulah/CLOUDHUB-BRIEF.md` §0 |
| Wire types | `@itulah/contract` — **generated, never edit** |
| Endpoints | `backend/src/cloud/http/mod.rs` |

## The rules that are not negotiable

1. **No raw px type sizes, ever.** The root is `16px`, so `rem = declared/16`
   lands on exactly the pixel it is named for. Prefer the named scale
   (`text-hero`, `text-card-title`, `text-nav`, `text-meta`, `text-pill`,
   `text-id`, `text-cell`, `text-eyebrow`) over arbitrary values.
2. **Colour comes from tokens.** `text-ink text-body text-mute bg-soft
   border-hairline bg-accent-bg` — never a hex literal. If a value is not a
   token it probably should not exist.
3. **Three weights only**: `font-normal` (400), `font-medium` (500),
   `font-semibold` (600). Never `font-bold`.
4. **Two blues, fixed jobs.** Indigo `accent` = selected / active / primary
   series / focus. Sky `info` = *in motion* only — shipped, processing, issued,
   receiving. They never swap.
5. **Nothing darkens.** Overlays sit on the white veil (`--scrim`). No black
   scrim anywhere.
6. **One black CTA per screen** (`<Button variant="dark">`), and only one.
7. **Pills for interactive, 16px for cards.** Nothing between.
8. **Never `slice()` a list to cap it.** `<DataTable>` virtualises past 150
   rows on its own.

## The gates

```bash
npm run build         # tsc -b && vite build — the real gate
npm run lint          # eslint
npm run design-lint   # the design rules, checked mechanically
npm run endpoint-audit # every cloud endpoint is called from somewhere in src/
npm run format         # prettier — the repo's declared style, so run it
```

`endpoint-audit` reads the routes straight out of `backend/src/cloud/http/mod.rs`
and looks for each one in the client. "Every backend function works in the new
app" is a claim, and a claim nobody can check goes stale in a week — this turns
it into a number.

`design-lint` catches the four rules that break the *language* rather than the
build: a raw px type size, a hex colour, a fourth font weight, a dark overlay.
Prose in this file is not a gate; that script is. Geometry in px
(`size-[17px]`, `w-[248px]`) is fine and not flagged — those are measured boxes,
and the density is carried by the type scale.

## Reads

One `useQuery` per read. Keys live beside the fetch function in
`src/lib/queries/<domain>.ts`, first segment = the domain namespace so sign-out
drops a module's answers by prefix:

```ts
export const inventoryKeys = {
  all: ["inventory"] as const,
  pools: () => ["inventory", "pools"] as const,
  pool: (id: string) => ["inventory", "pools", id] as const,
}
```

No `useEffect` + `fetch` anywhere. Reach the node through `node` from
`@/lib/api`, which carries the session cookie and the CSRF token.

Render the three states with `queryState(query, { loading, render })` from
`@/components/ui/states` — never a bespoke spinner, never a bespoke error
sentence. A spinner on a 400ms fetch is a flash; a spinner on a hang is a lie.
A refetch that fails over data already on screen keeps the data and says so
above it (a warn banner with the time the rows are from, and Try again) — only
a first load that fails becomes the error state.

Every paginated list is **infinite scroll** — never a "Show more" button. A
`<DataTable>` or `<VirtualList>` that scrolls itself takes `more={query}`
(the infinite query); a list that scrolls with the page (a card grid, a sheet
body) ends with `<LoadMore query={query} />`. Either one fetches the next page
as the foot nears view, says "Loading more…", and on a failed page stops and
shows the server's sentence with Try again. `LoadMore` must sit inside the box
that scrolls, or it stays in view and pulls every page.

## Writes

Every write is a `useMutation` that invalidates the keys that actually change,
named explicitly:

```ts
const client = useQueryClient()
const activate = useMutation({
  mutationFn: (id: string) => activateSupplier(id),
  onSuccess: () => client.invalidateQueries({ queryKey: procurementKeys.suppliers() }),
})
```

Invalidate a whole prefix only when the action genuinely touches everything, and
say so in a comment. A write that must not be applied twice sends an
`Idempotency-Key` header.

The button that starts a write takes `pending={save.isPending}`, never
`disabled={save.isPending}`: pending is disabled *and* `aria-busy`, and it is
drawn less faded than a button that will never work. The label still says what
is happening ("Saving…") — no spinner. A write that failed is `<Problem>` where
it was attempted; one that worked and left a receipt is `<Receipt>`; one that
worked and moved the screen on is a toast.

An action that must be confirmed is `<ConfirmButton>`. Give it
`reason={{ label: "Why" }}` when the write records one (required unless
`optional: true`), and return the mutation's promise from `onConfirm`
(`mutateAsync`) so the dialog stays open and pending until the write settles
and shows a refusal under the question instead of in a toast.

## Form fields

Every question is a `<Field>`, and the field owns its state — the control
inside never gets `border-bad`, `aria-invalid` or a star by hand:

- **Required** — `<Field required>`. A red star, `aria-required` on the
  control, and a required `<PickOne>`/`<Day>` loses its clearing ×. An
  unmarked field is optional, so a form that marks one required field marks
  all of them. Never the native `required` attribute (browser bubble).
- **Invalid** — `<Field problem={…}>`. Any sentence there turns the control's
  border `{bad}`, sets `aria-invalid`, and wires the sentence to it with
  `aria-describedby`. Show it after the field is left (`touched`) or after a
  refused submit, not on the first keystroke.
- **Hint** — `aside` beside the label for a fact about the question; `hint`
  under the control only for a figure to compare against.
- **Disabled / read-only** — `disabled` on the control. Every control in the
  kit takes it.
- **Outside a field** (a cell in a table) — the control's own `invalid` prop.

The controls that read all of this: `Input`, `Textarea`, `Money`, `Select`,
`PickOne`, `PickMany`, `Day`, `Checkbox`, `Choices`, `Stepper`, `Dial`
(and the `me/ui` `Input`/`Textarea`). A new control reads it with
`useFieldAria()` from `@/components/ui/field-state`.

## Tables

`useTable` with the shared `tableSetup` from `@/lib/table` — never a bespoke
feature set. Columns are `ColumnDef<TableSetup, TRow>[]` declared **outside** the
component. `meta: { align: "right" }` for numbers.

Default the sort to **the decision metric**, not the identifier: the first
screenful should already be the rows somebody has to act on.

DESIGN.md governs what goes in a column: every column is a computed business
metric that drives a decision or a comparison. Identifiers and contact facts —
phone, address, tax id, internal ids — do **not** occupy list columns. They live
one click away in the sheet.

## Three widths, one screen

A screen is written once and works on a phone, an iPad, a laptop and a big
monitor. There is no mobile screen, no mobile route and no second component:
three primitives carry it, and a screen's whole contribution is two more keys on
the columns it already declares.

| Where | What changes | Who does it |
|---|---|---|
| Shell | Sidebar becomes a drawer under 64rem, and the topbar `inventory-prototype.html` switched off comes back to carry its handle, ⌘K and ⌘J — the buttons a tablet has no keyboard for | `components/shell/app-shell.tsx` |
| List | Columns are shed one at a time until the table fits the card it stands in; under 48rem the rows are relaid as cards | `<DataTable>` |
| Detail | Under 48rem the floating rail arrives from the bottom instead; from 96rem up it stops covering the list and stands beside it — the shell hands it 29.5rem and the page narrows into what is left | `<Sheet>` + `lib/sheet-space.ts` |
| Hit targets | 44px rows, nav rows and icon buttons when the POINTER is coarse | `pointer-coarse:` + `touch` |

**A monitor buys the list AND the record, not a wider margin — and nothing new
is drawn to fill it.** A permanent right-hand rail would have to be filled with
something, and both candidates are already ruled out here: the filter rail was
taken off every screen for spending 248px on a control people touch twice a day,
and a record's history already lives inside the panel. So the rail IS the
record: same `<Sheet>`, same place on the glass, `modal={false}` and no veil, so
every row stays clickable and clicking another one swaps the record instead of
closing it.

So a screen declares two things per column and nothing else:

```ts
meta: {
  align: "right",
  filter: { kind: "number", unit: "pcs" },
  card: "metric",   // id · title · status · metric · meta · hide
  priority: 1,      // 1 never drops · 3 goes first
}
```

Both are optional. A column with no `card` role is guessed at — first column is
the title, right-aligned columns are metrics, the rest are the meta line — so a
list nobody has thought about on a phone is still readable on one.

**Width decides the layout; the pointer decides the size of what you press.**
They are different questions and the answers live in different places
(`lib/layout.ts`). An iPad in landscape is 1180px, wider than most laptops, and
its rows are still pressed with a thumb.

**Never measure the window to decide a card's contents.** `useLayout()` exists
for the shell, which really is the window. Everything inside a card is decided
by the card: the article and sourcing grids use container queries, and
`<DataTable>` measures its own box with a `ResizeObserver`. A `lg:` breakpoint
cannot tell an iPad in landscape (872px of table) from a laptop window of the
same width with the sidebar collapsed (1100px), and the first of those is the
one that clips the figure the list is sorted by.

## Detail — sheets live in the URL

**Never hold "which record is open" in `useState`.** A sheet in component state
cannot be sent to a colleague, does not survive the reload a browser gets every
morning, and cannot be opened by the command palette or a notification — all
three of which want to.

Declare the key once in `src/lib/sheets.ts`, then:

```tsx
const order = useSheet("order")          // reads ?order=… from the URL
…
<DataTable
  onRowClick={(row) => order.open(row.id)}
  isSelected={(row) => row.id === order.value}
/>
<OrderSheet id={order.value ?? null} onClose={order.close} />
```

Opening pushes history (arriving at a record is somewhere you can go back
from); closing replaces it (back should leave the screen, not reopen what you
just dismissed). Both are handled for you by `useSheet`.

The sheet fetches its own read with `enabled: id !== null` — the list carries a
summary, and the lines are only wanted once somebody asks for one record. The
list keeps its scroll and its selection. Inside: status pill → `<Facts>` grid →
`<MiniTable>` (mono UPPERCASE micro-caps — the one place that grammar belongs) →
`<TotalsLadder>` where only the final row is ink/600.

## Making your records findable

The palette (⌘K) searches **the module you are standing in**, with "Everywhere"
one tab away. Add your module's main list to `searchSources` in
`src/lib/search.ts` — one entry, and the records become reachable from anywhere
in the app, opening straight into their sheet.

There is no search endpoint on the cloud node, so a source filters what Query
already holds and fetches the list if the cache is cold. That is honest at
today's volumes; when a list outgrows it, only that source's `run` changes.

## Screen skeleton

```tsx
export function Something() {
  const rows = useQuery({ queryKey: k.something(), queryFn: ({ signal }) => fetchIt(signal) })
  return (
    <PageContent>
      <PageHeader crumb="Module" title="Something" sub="…" actions={…} />
      <Card className="overflow-hidden">
        {queryState(rows, { loading: "Loading…", render: (data) => … })}
      </Card>
    </PageContent>
  )
}
```

## Files a module owns, and files it must not touch

A module owns `src/screens/<module>/**` and `src/lib/queries/<module>.ts`, and
nothing else. Two files are shared by all nine and are edited by one hand:

- `src/lib/sheets.ts` — the URL key registry. The root route validates every key
  at once, so they cannot be declared per module. **Ask for a key**; do not add
  one. Ask for the right *validator* too: a date is `isoDay`, a fixed set is
  `oneOf([…])`, a count is `counted`. A blanket string lets `?bucket=fortnight`
  reach a request that can only answer 400.
- `src/lib/search.ts` — the palette's sources. **Send the entry**; do not append
  to the array. Several hands appending to one array is a lost update, and the
  symptom is a module whose records silently stop being findable.

Everything else shared — `lib/table.ts`, `lib/format.ts`, `lib/api.ts`,
`styles/index.css`, `components/**`, `routes.tsx` — is read-only to a module. If
you need a primitive that does not exist, build it inside your own folder and
say so, and it gets promoted once a second module wants it.

## Registering it

Add the path to `src/lib/navigation.ts` (if it is not already there) and the
component to `src/screens/<module>/index.ts`. The router is generated from the
navigation registry, so those two files are the whole wiring — and a screen
registered under a path no nav entry claims fails at module load.

## The primitives

Everything in `src/components/ui/` is authored against DESIGN.md. Reach for one
before writing markup:

| Need | Use |
|---|---|
| Page opening | `<PageHeader crumb title sub actions>` |
| Container | `<Card> <CardHeader> <CardTitle> <CardStrip>` |
| Full-width list | `<DataTable>` (virtualises past 150 rows) |
| Record detail | `<Sheet>` + `<Facts>` / `<Fact>` |
| State badge | `<Pill tone>` — tone from `toneFor(status)` |
| Data label | `<Tag>` (mono micro-label; NOT a status) |
| Action | `<Button variant="dark｜ghost｜soft｜quiet｜danger">` |
| Fused actions | `<ButtonGroup>` |
| Slice of one dataset | `<Segmented>` |
| Different dataset | `<SubTabs>` |
| Controls above a list | `<Toolbar>` + `<Toolbar.Spacer />` |
| Stats | `<KpiStrip>` + `<Kpi>` |
| Problems, at the top | `<ExceptionQueue>` |
| Record history | `<Timeline>` · `<Lifecycle>` |
| In-card item table | `<MiniTable>` (mono micro-caps live here, and only here) |
| Closing a record | `<TotalsLadder>` |
| Summary rows | `<KeyValue>` |
| A proportion | `<Meter>` |
| Form input | `<Field required problem>` + `<Input>` / `<Textarea>` — see *Form fields* |
| Page-level fact | `<Banner tone>` |
| Choice from a list | `<Select>` |
| Link to another screen | `<AppLink to sheet>` — **not** Router's `<Link>` |

## Linking between screens

Use `<AppLink>` from `@/components/ui/app-link`, never Router's `<Link>`.

Router infers `to` from a statically-declared route tree; ours is generated from
the navigation registry, so there is no literal union to infer and
`<Link to="/inventory/pools">` does not typecheck. `<AppLink>` checks the path
against the registry instead — in development a path nothing declares throws
where it is written, rather than 404ing when somebody clicks it.

It also takes a sheet, so "show me this order" is one link:

```tsx
<AppLink to="/procurement/orders" sheet={{ key: "order", value: id }}>
  {poNumber}
</AppLink>
```

DESIGN.md asks for no dead ends: if two things relate in the database, the UI
must let you cross from one to the other in one click. This is how.

## Motion

Read `MOTION.md`. The short version: motion explains space, confirms input,
shows state or softens a change — and if you cannot say which, it should not
move. Durations come from tokens (`--t-press` … `--t-sheet`), curves from
`--ease-out` / `--ease-in-out`, and the base layer already applies the hover
default, so a component rarely needs to name either.

Reduced motion keeps opacity and colour and drops travel. It is handled
globally; mark anything that must additionally not transform with
`data-motion="travel"`.

## Empty, error, banner

- **Empty filtered** and **empty unfiltered** are different sentences. Say which.
- **Errors** quote the server (`ApiError.message`); never invent a code.
- A page-level fact — a publish receipt, a stale price — is a `<Banner>`, not a
  toast. Toasts confirm an action that did not change the screen.
