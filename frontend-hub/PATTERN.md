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

1. **No raw px type sizes, ever.** The root is `14.4px`, so `rem = declared/16`
   lands on exactly the pixel the prototype paints. Prefer the named scale
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
| Form input | `<Field>` + `<Input>` / `<Textarea>` |
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
