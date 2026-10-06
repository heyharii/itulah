import type { RowData } from "@tanstack/react-table"
import { Menu } from "@base-ui/react/menu"
import { Popover } from "@base-ui/react/popover"
import { ListFilter, Plus } from "lucide-react"
import { useEffect, useState } from "react"

import { Input } from "@/components/ui/field"
import { FilterChip, OptionRow } from "@/components/ui/filter-chip"
import {
  CHIP,
  ITEM,
  POPUP,
  POSITIONER,
  summarise,
  useOptions,
} from "@/lib/filter-chrome"
import {
  arity,
  isComplete,
  operatorsFor,
  type Filter,
  type FilterField,
  type FilterModel,
  type FilterState,
} from "@/lib/filters"
import { cn } from "@/lib/utils"

/// The filter bar: a row of chips over a list, each one a sentence.
///
/// It sits above the card, not in a column beside it. A 248px rail spends
/// permanent width on a control most readers touch twice a day, and on these
/// screens it pushed the table into two thirds of the viewport — which is why
/// the app it replaces removed the rail from every screen but two, taking the
/// filters with it. Every word of that is still true of a PERMANENT column,
/// and still true at every width where the list needs the whole page.
///
/// **What changed on 2026-09-11 is the tier, not the argument.** From 96rem up
/// the shell already hands a column to whatever is being read beside the list,
/// and at that width the table can spare it; below 96rem it cannot, which is
/// precisely why the controls arrive there as a sheet OVER the list rather
/// than as the cramped column this comment refused. So the CONTROLS moved into
/// `<FilterPanel>` — dismissible, never permanent — and what stays above the
/// card is the part that has to be readable without opening anything: the
/// chips. A filter you cannot see still narrows the list, and a hidden one is
/// how somebody reads a filtered list as the whole list.
///
/// This is the MOUSE-driven vocabulary, for the twelve screens that draw a
/// table: a menu for the column, a menu for the operator, a popover for the
/// value. The typed one is `<FilterOmnibox>`, which builds the same clause
/// from a single box; both draw the same chip, out of `ui/filter-chip`.
///
/// Three components, and they are one implementation seen from three places —
/// `<FilterChips>` is the summary, `<FilterControls>` is that plus the two
/// buttons that change the set, and `<FilterBar>` is `<FilterControls>` in a
/// row. The panel renders the same `<FilterControls>` in a column. A second
/// copy of any of it would drift, and the day it drifted the panel and the bar
/// would offer different operators for the same column.

/// The table a picker reads facet counts from — which values a column actually
/// holds, and how many rows hold each — so it offers what is there rather than
/// what the schema allows. Optional: a screen narrowed at the SERVER has no
/// faceted row model, and declares `counted` on the field instead.
// `useTable`'s return type is generic over the feature set and invariant in
// v9; naming it here would lock the bar to one table's columns.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FacetSource = any

/// The clauses in force, each one editable where it is read.
///
/// Typed against `FilterState` rather than `FilterModel` so the screens that
/// narrow at the server — which have clauses and fields but no table — can
/// draw the same chips. `FilterModel` extends it, so a table screen passes its
/// model unchanged.
export function FilterChips({
  model,
  table,
}: {
  readonly model: FilterState
  readonly table?: FacetSource
}) {
  const { filters, fields, update, remove } = model

  return (
    <>
      {filters.map((filter, index) => {
        const field = fields.find((one) => one.column === filter.column)
        if (!field) return null
        return (
          <Chip
            key={`${filter.column}-${index}`}
            filter={filter}
            field={field}
            table={table}
            onChange={(next) => update(index, next)}
            onRemove={() => remove(index)}
          />
        )
      })}
    </>
  )
}

/// Everything that changes the set: the clauses, the menu that adds one, the
/// word that removes them all.
///
/// The arrangement is the caller's and the controls are not — a row above the
/// table and a column in the panel are the same buttons wrapped differently,
/// which is the whole reason this is a component and not a copied block.
export function FilterControls({
  model,
  table,
  stacked = false,
  touch = false,
  withClear = true,
  className,
}: {
  readonly model: FilterState
  readonly table?: FacetSource
  /// Down a column rather than along a row. What the panel asks for.
  readonly stacked?: boolean
  /// Finger-sized rather than mouse-sized. **Width decides the layout, pointer
  /// decides the size of what you press** — see `lib/layout.ts` — so this is a
  /// separate question from `stacked`, and an iPad in landscape answers yes to
  /// this one while taking the wide layout.
  readonly touch?: boolean
  /// Whether Clear rides at the end of the controls. The panel says no and
  /// pins it to its footer instead: at the end of a stack it is the first
  /// thing to scroll out of sight, and a panel long enough to scroll is
  /// exactly when somebody reaches for it.
  readonly withClear?: boolean
  readonly className?: string
}) {
  const { filters, fields, commit } = model
  /// The clause being composed, before it says anything.
  ///
  /// **This is why the "+ Filter" menu did nothing before.** It called
  /// `addColumn`, which writes `{column, operator, values: []}` to the URL —
  /// and `encodeFilters` drops an incomplete clause on the way out, so the
  /// navigation removed `?f=` again and no chip ever appeared. Picking a column
  /// out of that menu has been a dead click on every screen that draws this bar.
  ///
  /// The model already says how it should work and `lib/filters.ts` says why:
  /// `commit` exists because `addColumn` + `update` "are two navigations, and
  /// the first one writes an incomplete clause the URL should never carry". So
  /// a half-built clause lives HERE, in the one place a draft belongs — it is
  /// not a fact about the list, nothing else can act on it, and it is finished
  /// or abandoned within seconds — and reaches the URL in one navigation when
  /// it finally says something. That is the omnibox's flow, arrived at from the
  /// other end.
  const [draft, setDraft] = useState<Filter | null>(null)
  const drafted = draft && fields.find((one) => one.column === draft.column)

  if (fields.length === 0) return null

  return (
    <div
      className={cn(
        // `min-w-0` on both arrangements: a chip carrying a supplier's full
        // legal name is wider than a 27.5rem column, and a flex child is
        // allowed to overflow its parent unless it is told not to. The chip
        // truncates; the column never widens and nothing is pushed off the
        // edge of it.
        stacked
          ? "flex min-w-0 flex-col items-start gap-2"
          : "flex min-w-0 flex-wrap items-center gap-[0.4375rem]",
        className
      )}
    >
      <FilterChips model={model} table={table} />

      {drafted && draft && (
        <Chip
          // Keyed by its column so a second draft is a second chip: the editor
          // opens with the chip, and a reused one would arrive shut.
          key={`draft-${draft.column}`}
          filter={draft}
          field={drafted}
          table={table}
          onChange={(next) => {
            // "is empty" takes no value, so it has no editor to close and
            // would otherwise sit in the draft for ever: it is finished the
            // moment it is chosen.
            if (arity(next.operator) === "none") {
              commit(next)
              setDraft(null)
            } else setDraft(next)
          }}
          onRemove={() => setDraft(null)}
          // Its editor is open from the moment it is drawn: picking "Supplier"
          // out of a menu is half a sentence, and the half somebody is in the
          // middle of saying should not need a second click to carry on.
          composing
          // Committed when the editor closes rather than on the first tick, so
          // "is any of" takes three values in one navigation instead of
          // narrowing the list — and re-counting every facet under it — after
          // each one.
          onDone={() => {
            if (isComplete(draft)) commit(draft)
            setDraft(null)
          }}
        />
      )}

      <AddFilter
        fields={fields}
        onAdd={(column) => {
          const field = fields.find((one) => one.column === column)
          if (!field) return
          setDraft({
            column,
            operator: operatorsFor(field.spec)[0],
            values: [],
          })
        }}
        hasFilters={filters.length > 0}
        touch={touch}
      />

      {withClear && filters.length > 0 && (
        <ClearFilters model={model} touch={touch} />
      )}
    </div>
  )
}

/// Drop every clause at once.
///
/// Its own component only so the panel can pin it to a footer while the bar
/// keeps it at the end of the row — one button, two places, and no second
/// `onClick={clear}` to forget about the day this grows a confirmation.
export function ClearFilters({
  model,
  touch = false,
  label = "Clear",
}: {
  readonly model: FilterState
  readonly touch?: boolean
  readonly label?: string
}) {
  return (
    <button
      type="button"
      onClick={model.clear}
      className={cn(
        "h-8 shrink-0 rounded-full px-2.5 text-meta text-mute transition-colors hover:text-ink",
        touch && "h-11 px-3.5"
      )}
    >
      {label}
    </button>
  )
}

export function FilterBar<TRow extends RowData>({
  model,
  table,
  className,
}: {
  readonly model: FilterModel<TRow>
  readonly table: FacetSource
  readonly className?: string
}) {
  return <FilterControls model={model} table={table} className={className} />
}

/* -------------------------------------------------------------------------- */

/// The shared chip, with a popover for its value segment.
function Chip({
  filter,
  field,
  table,
  onChange,
  onRemove,
  composing = false,
  onDone,
}: {
  filter: Filter
  field: FilterField
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table?: any
  onChange: (next: Filter) => void
  onRemove: () => void
  /// A clause still being written: its editor opens with it, and closing that
  /// editor is what finishes it. See the draft in `<FilterControls>`.
  composing?: boolean
  onDone?: () => void
}) {
  const said = summarise(filter, field)
  return (
    <FilterChip
      field={field}
      filter={filter}
      onChange={onChange}
      onRemove={onRemove}
    >
      <Popover.Root
        defaultOpen={composing}
        onOpenChange={(open) => {
          if (!open) onDone?.()
        }}
      >
        {/* `min-w-0` and `truncate`, with the whole of it on hover: a supplier
            called "PT Sinar Mas Agro Resources and Technology" is one value,
            and in a 27.5rem column an untruncated chip would either widen the
            panel or push the remove button off the edge of it. The title is
            what keeps the truncation honest — nothing is hidden, it is
            abbreviated. */}
        <Popover.Trigger
          title={said}
          className={cn(
            "flex min-w-0 items-center truncate px-2.5 font-medium transition-colors",
            filter.values.length > 0
              ? "text-accent hover:text-ink"
              : "text-mute hover:text-ink"
          )}
        >
          {said}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className={POSITIONER}
            side="bottom"
            align="start"
            sideOffset={6}
          >
            <Popover.Popup className={POPUP}>
              <ValueEditor
                filter={filter}
                field={field}
                table={table}
                onChange={onChange}
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </FilterChip>
  )
}

/* -------------------------------------------------------------------------- */

function ValueEditor({
  filter,
  field,
  table,
  onChange,
}: {
  filter: Filter
  field: FilterField
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
  onChange: (next: Filter) => void
}) {
  const kind = field.spec.kind

  if (kind === "option" || kind === "multi" || kind === "boolean") {
    return (
      <OptionPicker
        filter={filter}
        field={field}
        table={table}
        onChange={onChange}
      />
    )
  }

  return <TypedValue filter={filter} field={field} onChange={onChange} />
}

function OptionPicker({
  filter,
  field,
  table,
  onChange,
}: {
  filter: Filter
  field: FilterField
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
  onChange: (next: Filter) => void
}) {
  const options = useOptions(field, table)
  const [query, setQuery] = useState("")
  const single = arity(filter.operator) === "one"

  const shown = options.filter(
    (option) =>
      query === "" || option.label.toLowerCase().includes(query.toLowerCase())
  )

  const toggle = (value: string) => {
    if (single) return onChange({ ...filter, values: [value] })
    const held = filter.values.includes(value)
    onChange({
      ...filter,
      values: held
        ? filter.values.filter((one) => one !== value)
        : [...filter.values, value],
    })
  }

  return (
    <div className="flex max-w-[min(22rem,calc(100vw-2.5rem))] min-w-[15rem] flex-col gap-1">
      {/* Eight, not four: twenty suppliers is a list you search, five statuses
          is a list you read, and a search box over five rows is furniture. */}
      {(options.length > 8 || field.spec.searchable === true) && (
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 shrink-0"
        />
      )}

      {shown.length === 0 ? (
        <p className="px-2.5 py-3 text-center text-meta text-mute">
          Nothing matches.
        </p>
      ) : (
        /* The rows scroll in their own box rather than in the popup's. A
           column with 112 pools or 7,528 accounts in it is a real value list
           here, and when the whole popup scrolled, the search box — the one
           control that makes a list that long usable — scrolled away with the
           first dozen rows. */
        <div className="flex max-h-[17rem] flex-col overflow-y-auto">
          {shown.map((option) => (
            <OptionRow
              key={option.value}
              option={option}
              field={field}
              checked={filter.values.includes(option.value)}
              single={single}
              onToggle={() => toggle(option.value)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/// Text, number and date all edit the same way: one or two boxes.
///
/// Typing is debounced before it reaches the URL. Without that every keystroke
/// is a navigation, and holding backspace in a search box writes twelve history
/// entries — or, with `replace`, twelve renders of a table with 2,811 rows in
/// it.
function TypedValue({
  filter,
  field,
  onChange,
}: {
  filter: Filter
  field: FilterField
  onChange: (next: Filter) => void
}) {
  const takes = arity(filter.operator)
  const slots = takes === "two" ? 2 : 1
  const [draft, setDraft] = useState<string[]>(() =>
    Array.from({ length: slots }, (_, at) => filter.values[at] ?? "")
  )

  // The chip is the source of truth; a filter cleared from elsewhere (the
  // Clear button, a pasted link) has to reach the boxes.
  useEffect(() => {
    setDraft(Array.from({ length: slots }, (_, at) => filter.values[at] ?? ""))
  }, [filter.values, slots])

  useEffect(() => {
    const settled = draft.every(
      (value, at) => value === (filter.values[at] ?? "")
    )
    if (settled) return
    const timer = setTimeout(() => {
      onChange({ ...filter, values: draft })
    }, 250)
    return () => clearTimeout(timer)
    // `onChange` and `filter` are re-made every render by the parent; the draft
    // is what this effect is actually watching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  const type =
    field.spec.kind === "date"
      ? "date"
      : field.spec.kind === "number"
        ? "number"
        : "text"

  return (
    <div className="flex min-w-[13rem] flex-col gap-1.5 p-1">
      {Array.from({ length: slots }, (_, at) => (
        <span key={at} className="flex items-center gap-2">
          {slots === 2 && (
            <span className="w-8 shrink-0 text-meta text-mute">
              {at === 0 ? "From" : "To"}
            </span>
          )}
          <Input
            autoFocus={at === 0}
            type={type}
            inputMode={type === "number" ? "decimal" : undefined}
            value={draft[at] ?? ""}
            onChange={(event) => {
              const next = [...draft]
              next[at] = event.target.value
              setDraft(next)
            }}
            className="h-8"
          />
        </span>
      ))}
      {field.spec.scale === 100 && (
        <p className="px-1 text-meta text-mute">
          In whole {field.spec.unit ?? "currency"}, not cents.
        </p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function AddFilter({
  fields,
  onAdd,
  hasFilters,
  touch = false,
}: {
  fields: readonly FilterField[]
  onAdd: (column: string) => void
  hasFilters: boolean
  touch?: boolean
}) {
  const [query, setQuery] = useState("")
  const shown = fields.filter(
    (field) =>
      query === "" || field.label.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          CHIP,
          "items-center gap-1.5 border border-dashed border-hairline-strong px-2.5 text-body transition-colors hover:bg-soft-2 hover:text-ink",
          touch && "h-11 px-3.5"
        )}
      >
        {hasFilters ? (
          <Plus className="size-3.5" />
        ) : (
          <ListFilter className="size-3.5" />
        )}
        Filter
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className={POSITIONER}
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup className={POPUP}>
            {fields.length > 8 && (
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="mb-1 h-8"
              />
            )}
            {shown.map((field) => (
              <Menu.Item
                key={field.column}
                onClick={() => onAdd(field.column)}
                className={ITEM}
              >
                {field.label}
              </Menu.Item>
            ))}
            {shown.length === 0 && (
              <p className="px-2.5 py-3 text-center text-meta text-mute">
                No column by that name.
              </p>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
