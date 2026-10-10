# UI kit — the shop's copy of the hub's design system

Phase 1 of making `frontend-store-new` look and behave like `frontend-hub`.
Copied from `frontend-hub/src` and adapted; nothing here imports the hub. If a
component looks a generation behind the hub's, diff it against the hub's file
(named in its header comment) before looking anywhere else. Tokens:
`src/styles/index.css` (`npm run design-lint` checks `:root` parity).

**The template screens** — copy these: `src/screens/catalogue.tsx` (a list: dock
+ card grid + docked panel on a desk) and `src/screens/product.tsx` (its record
sheet: tabs, facts, variant matrix).

## Rules every screen holds (phone = under 768px)

- Nothing at the top of a list but the title (the top bar draws it) and one line
  of figures. Search, status, sort, filter and "New" live in the **dock** over
  the bottom bar; every other action sits at the bottom (dock, `Fab`, sheet
  footer, a card's foot button).
- Nothing scrolls sideways. Tables become cards or stacked blocks; tab strips
  wrap or become a dock choice; KPI strips are one two-column hairline card.
- Records are the uniform **lead-figure card** (`LeadCard`).
- Record sheets: mono id above the title, ONE status badge, caption, tabs that
  wrap, facts as label/value, actions in the footer (36px buttons).
- Text never below 14px (`text-[0.875rem]`), body 15px. English only. Dates with
  the year; "Quantity", not "Qty". Numbers, not bars.
- Reuse tokens (`text-ink`, `bg-soft-3`, `rounded-card`) — no raw hex, no
  `font-bold`, no dark overlays (`bg-[var(--scrim)]`).

## `DockTools` — `components/shell/dock-tools.tsx`

Draws into the dock on a phone and **renders nothing anywhere else**, so a
screen mounts it unconditionally and hides its own desk toolbar with
`max-md:hidden`.

```tsx
<DockTools
  search={{ value, onChange, label: "Search articles" }}          // field -> search sheet
  status={{ value, onChange, options: [{ value, label, count? }] }} // chip -> "Show" sheet
  sort={{ label: "Range", directional?: boolean, onOpen?,          // row on the gear sheet
          choices: { options: [{ value, label }], value, desc, onChange: (value, desc) => void } }}
  filter={{ count: 0, label?: "Tags", onOpen: () => open(mySheet) }} // screen opens its OWN sheet
  views={[{ title: "View", value, options: [{ value, label }], onChange }]} // extra one-of-few choices
  actions={[{ label: "Export", onClick }]}                          // rows at the foot of the gear sheet
/>
```

Every prop is optional. The gear (⚙) sits at the end of the search field (or
alone when there is no search); with exactly one thing behind it, it goes
straight there, otherwise it opens "Filter and sort" with a row per thing.
`<DockChoice title value options onChange />` is just the status chip, for a
screen with a choice and no search (replaces a strip of tabs on a phone).
`<Fab label="New order" onClick icon? />` is the round "+" in the dock's action
slot (phone only; a desk uses a toolbar `Button variant="primary"`).
Low level: `DockPortal slot="search" | "tabs" | "action"`, `useDock()`
(`.phone`, `.available`, `.claimed`), `useDockRow()`.

## `Sheet` — `components/ui/sheet.tsx` (`RecordSheet` is the same thing)

```tsx
<Sheet
  open onOpenChange={(open) => …}
  id="30101010001"            // mono, above the title
  title="Kemeja Oxford Navy M"
  badge={<Pill tone="bad">Price down</Pill>}   // ONE status badge
  caption="Pria"              // quiet line under the title
  actions={…}                 // header actions (desk); on a phone put them in `footer`
  footer={<><Button>Cancel</Button><Button variant="primary">Save</Button></>}
  tabs={[{ value, label, content }]}  // or just children; `tab`/`onTabChange` to control
  width="rail" | "wide"       // wide for a form somebody writes a sentence into
>
  <Facts><Fact term="Division">Pria</Fact><Fact term="Notes" wide>…</Fact></Facts>
</Sheet>
```

Desk: right rail, floating, white veil, Esc closes. Phone: a Vaul sheet that
stops 12px under the notch, grip, swipe down closes, keyboard kept under the
footer. Tabs wrap on a phone; the body scrolls and restarts per tab. Hold "which
record is open" in the URL (`useParam("sku")`-style) so a reload keeps it.

Smaller sheets: `BottomSheet` (`ui/picker-sheet.tsx`: `open onOpenChange title
action? onBack?`), `PickerSheet` (pick one/many from a list), `MorphHeight`
(animate between pages of one sheet), `NumberPad` (a phone's number entry).

## `LeadCard` / `CardList` — `components/ui/lead-card.tsx`, `card-list.tsx`

```tsx
<CardList grid?>                                  // stack; `grid` = 1/2/3 columns by container width
  <LeadCard
    title="Kaos Oblong Charcoal M"
    code="00000003"                               // thin mono under the name
    lines={["Supplier X"]}                        // optional extra 14px lines
    media={<Photograph … />}                      // optional 64px thumbnail
    lead={{ figure: "Rp 49.000", caption: "from" }} // the ONE figure, 24px; caption plain
    foot={{ info: "16 SKUs · Pria",
            action: { label: "Pick", onClick },   // ONE tint word button …
            status: <Pill tone="ok">Open</Pill> }} // … OR one status, never both
    onOpen={() => …}  tone="alert"  selected
  />
</CardList>
<CardGroup heading="Menswear" aside="12 articles" defaultFolded? sticky? grid?>…cards…</CardGroup>
```

`CardGroup` is a foldable heading that sticks while its cards scroll under it.
`LeadFigure` and the card's keyboard handling (Enter/Space, arrows) are in
`lead-card.tsx`. A card with no foot is its head alone.

## `Button` — `ui/button.tsx` + `button-style.ts`

`<Button variant size pending block>` — variants `primary` (the one filled CTA),
`ghost` (default), `soft`, `tint` (card foot), `quiet`, `danger`; sizes `default`
(36 mouse / 44 finger), `sm`, `lg` (44, a form's own), `icon`, `card` (32 to see,
44 to land). `pending` = disabled + `aria-busy` (the label says "Saving…").
`button({ variant, size })` gives the classes for an `<AppLink>`.

## `Pill` / `Status` — `ui/pill.tsx`

`<Pill tone="ok|warn|bad|info|accent|neutral|new|done">` — outlined, text-only,
for a card foot or a sheet head. `<Status tone>` — dot and word, no box, for a
column of statuses. `toneFor(status)` in `lib/format` picks the tone.

## Others

- `ui/tag.tsx` `Tag` (mono label), `ui/kpi.tsx` `KpiStrip` + `Kpi` (two-column
  hairline card on a phone), `KpiRow` (one short row), `StatStrip` (older,
  same look).
- `ui/page-header.tsx` `PageHeader` (the desk title; hidden on a phone when it
  echoes the top bar). `Screen` (`ui/screen.tsx`) draws it.
- `ui/states.tsx` `EmptyState`, `LoadingState` ("Reading the …"; `rows` for a
  skeleton), `ErrorState`, `NoMatch`, `NoAccessState`, `Banner`, `Problem`,
  `Receipt`.
- `ui/segmented.tsx` `Segmented` (wraps on a phone), `ButtonGroup`, `Toolbar`
  (on a phone its controls move into a "Filters" dock sheet).
- `ui/field.tsx` `Field`, `Input` (a number opens `NumberPad` on a phone;
  `keyboard` opts out for NPWP/account numbers), `Textarea`, `Checkbox`, `Money`,
  `Select`. In a `<Field>` a box is 47px on a phone, 44 on a desk.
- `ui/card.tsx` `Card`, `CardHeader`, `CardTitle`, `CardStrip`, `RecordCard`.
- `ui/list-chrome.tsx` `SHEET_ROW`, `SheetSortRows`, `SheetChoiceRows`.
- Shell: `shell/app-shell.tsx` (rail · panel · bar, drawer, dock), `rail.tsx`,
  `sidebar.tsx` (`SubSidebar`, `DrawerNav`), `top-bar.tsx`, `bottom-bar.tsx`;
  `components/brand-mark.tsx` (`BrandMark`, `Launch`), `sign-in-door.tsx`.
- Hooks: `lib/layout.ts` (`useLayout()` phone/tablet/desktop/monitor).

## What was left out of the hub's kit

`DataTable` (no `@tanstack/react-table` here — use `CardList`, or a plain table
on a desk), the filter panel / saved views (a screen opens its own filter
sheet), `Sheet`'s comment panel and beside-the-list column, `SubTabs` (use
`DockChoice` on a phone), the assistant, command palette and virtual clock.
