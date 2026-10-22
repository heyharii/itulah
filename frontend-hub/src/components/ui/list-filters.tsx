import { Popover } from "@base-ui/react/popover"
import { CalendarDays, LayoutGrid, X } from "lucide-react"
import { useRef, useState } from "react"

import { DayRange, type DayWindow } from "@/components/ui/day-range"
import { FilterChips as ClauseChips } from "@/components/ui/filter-bar"
import { FilterChips, type ChipOption } from "@/components/ui/filter-chips"
import { SwitchPill } from "@/components/ui/form"
import { SearchSuggest } from "@/components/ui/list-chrome"
import { POPUP, POSITIONER, type FilterOption } from "@/lib/filter-chrome"
import {
  operatorsFor,
  type Filter,
  type FilterField,
  type FilterState,
  type Operator,
} from "@/lib/filters"
import { count, day } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"

/// A list's filters, the way Purchase Orders wears them — and the one way every
/// list in Central wears them (owner, 2026-10-20: "standarisasi filter …
/// menyesuaikan po list").
///
/// No Filter button and no panel (owner, 2026-10-14: "filter di procurement
/// buttonnya hapus"; 2026-10-12: "jangan filter kanan"). Every question the
/// list can be asked is on view, in one order, decided by what KIND of
/// question it is rather than by each screen:
///
///   [🔍 Search + names] [📅 dates] [switches] [✕ Clear]
///   [All · chip · chip · chip · +N]          ← one line, only answers that exist
///
///  - **A long list** (supplier, store, account, person — more than six
///    answers, or `searchable`) is offered by the search box: type, pick, and
///    the name sits beside the box as a pill with ✕ ("search + dropdown, not a
///    dropdown box", 2026-10-05).
///  - **A date** is one `DayRange` box, labelled with the date's own name.
///  - **A short list** (kind, stage, category — six answers or fewer) is a line
///    of icon radio chips with counts, "All" first (2026-10-18: "filter
///    dropdown jangan pake … pakai radio icon"). Answers no row holds are left
///    out; past six the rest fold into "+N".
///  - **Yes / no** is a `SwitchPill`.
///  - **Text and number** clauses are not offered: the search box already
///    reads the text, and a figure is a column you sort. A link that carries
///    one still shows it as a chip with its ✕, so nothing narrows unseen.
///
/// Status is not here: it is the screen's `SubTabs`, with counts, above.
/// On a phone the same pieces stack in the sheet the dock opens (`sheet`).
export function ListFilters({
  model,
  table,
  search,
  sheet = false,
  openField,
  openDate,
  className,
}: {
  readonly model: FilterState
  /// Read for facet counts only, when the list is filtered in the browser.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table?: any
  /// The screen's own search text. Given, the box narrows the list as it is
  /// typed AND offers the long lists' names; left out, the box only offers
  /// names.
  readonly search?: {
    readonly value: string
    readonly onChange: (value: string) => void
    readonly label: string
  }
  /// Stacked for the phone's sheet: every choice on view, one page.
  readonly sheet?: boolean
  /// In a sheet: the page that lists every answer of a long field, and the
  /// calendar page of a date (the dock's sheet has both). Left out, the long
  /// field is offered by the search box and the date by its own box.
  readonly openField?: (column: string) => void
  readonly openDate?: (column: string) => void
  readonly className?: string
}) {
  const [typed, setTyped] = useState("")
  const { filters, fields } = model
  // A phone only ever meets these inside a sheet (the dock's, or a docked
  // toolbar's): stacked, every choice on view.
  const phone = useLayout() === "phone"
  sheet = sheet || phone

  /// The answers last seen while nothing was typed. The search text narrows
  /// the rows the answers are counted from, so without this, typing "hea"
  /// would leave no "Head Office" to offer the moment it was needed.
  const seen = useRef(new Map<string, FilterOption[]>())
  const searching = (search?.value ?? "").trim() !== ""
  /// Every answer's words, once seen: a pill keeps "Head Office" after the
  /// list it was picked from has been narrowed to nothing but that.
  const words = useRef(new Map<string, string>())
  const sorted = fields.map((field) => {
    const now = optionsFor(field, table)
    for (const one of now)
      if (one.label !== one.value)
        words.current.set(`${field.column}\u001f${one.value}`, one.label)
    if (!searching) seen.current.set(field.column, now)
    return {
      field,
      options: searching ? (seen.current.get(field.column) ?? now) : now,
    }
  })
  const dates = sorted.filter(({ field }) => field.spec.kind === "date")
  const switches = sorted.filter(({ field }) => field.spec.kind === "boolean")
  const lists = sorted.filter(
    ({ field }) => field.spec.kind === "option" || field.spec.kind === "multi"
  )
  /// ONE line of chips, never more: the first short question a list declares
  /// is the chip line; any other short one is offered by the search box like
  /// a long list. A question only one answer is held for asks nothing.
  const chipField = lists.find(
    ({ field, options }) =>
      isShort(field, options) &&
      options.filter((one) => one.rows !== 0).length >= 2
  )
  const short = chipField ? [chipField] : []
  const long = lists.filter(
    (one) =>
      one !== chipField &&
      (one.options.filter((option) => option.rows !== 0).length >= 2 ||
        filters.some((held) => held.column === one.field.column))
  )

  /// Replace one column's clauses in ONE write: a range is two clauses, and
  /// two writes would each start from this render's clauses.
  const setColumn = (column: string, next: readonly Filter[]) =>
    model.set([...filters.filter((one) => one.column !== column), ...next])

  const picks = filters.flatMap((filter) =>
    long.some(({ field }) => field.column === filter.column)
      ? filter.values.map((value) => ({ column: filter.column, value }))
      : []
  )
  const suggestions = long.flatMap(({ field, options }) =>
    options
      .filter(
        (option) =>
          !picks.some(
            (one) => one.column === field.column && one.value === option.value
          )
      )
      .map((option) => ({
        value: `${field.column}\u001f${option.value}`,
        label: option.label,
        hint: field.label,
      }))
  )
  const pick = (encoded: string) => {
    const [column, value] = encoded.split("\u001f")
    const field = fields.find((one) => one.column === column)
    if (!field) return
    const held = filters.find((one) => one.column === column)
    const many = field.spec.single !== true && held !== undefined
    setColumn(column, [
      {
        column,
        operator: listOperator(field),
        values: many ? [...held.values, value] : [value],
      },
    ])
  }
  const unpick = (column: string, value: string) => {
    const held = filters.find((one) => one.column === column)
    const rest = (held?.values ?? []).filter((one) => one !== value)
    setColumn(
      column,
      held && rest.length > 0 ? [{ ...held, values: rest }] : []
    )
  }

  /// Text and number clauses a link brought in: shown, never offered.
  const loose = filters
    .map((filter, index) => ({ filter, index }))
    .filter(({ filter }) => {
      const kind = fields.find((one) => one.column === filter.column)?.spec
        .kind
      return kind === "text" || kind === "number"
    })
  const looseModel: FilterState = {
    ...model,
    filters: loose.map((one) => one.filter),
    update: (at, next) => model.update(loose[at].index, next),
    remove: (at) => model.remove(loose[at].index),
  }

  if (fields.length === 0 && search === undefined) return null

  const searchBox = (search !== undefined || long.length > 0) && (
    <SearchSuggest
      value={search?.value ?? typed}
      onChange={search?.onChange ?? setTyped}
      label={
        search?.label ??
        `Find ${long.map(({ field }) => field.label.toLowerCase()).join(", ")}`
      }
      suggestions={suggestions}
      picked={null}
      onPick={pick}
      onClear={() => {}}
    />
  )
  const pills = picks.map(({ column, value }) => {
    const field = fields.find((one) => one.column === column)
    const formatted = field?.spec.format?.(value)
    const label =
      formatted !== undefined && formatted !== value
        ? formatted
        : (words.current.get(`${column}\u001f${value}`) ??
          labelOf(long, column, value))
    return (
      <button
        key={`${column}-${value}`}
        type="button"
        onClick={() => unpick(column, value)}
        aria-label={`Clear ${label}`}
        className="inline-flex h-[2.125rem] max-w-56 shrink-0 cursor-pointer items-center gap-1.5 rounded-inner border border-accent/40 bg-accent-bg pr-2 pl-2.5 text-[0.9375rem] font-medium text-accent transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97] pointer-coarse:h-11"
      >
        <span className="truncate">{label}</span>
        <X className="size-3.5 shrink-0" />
      </button>
    )
  })
  const dateBoxes = dates.map(({ field }) => (
    <DateBox
      key={field.column}
      field={field}
      filters={filters}
      onChange={(next) => setColumn(field.column, next)}
      wide={sheet}
    />
  ))
  const switchPills = switches.map(({ field }) => {
    const on = filters.some(
      (one) => one.column === field.column && one.values[0] === "true"
    )
    return (
      <SwitchPill
        key={field.column}
        on={on}
        label={field.label}
        onToggle={() =>
          setColumn(
            field.column,
            on ? [] : [{ column: field.column, operator: "is", values: ["true"] }]
          )
        }
      />
    )
  })
  const clear = filters.length > 0 && (
    <button
      type="button"
      onClick={() => model.clear()}
      className="inline-flex h-[2.125rem] shrink-0 items-center gap-1.5 rounded-inner px-2.5 text-[0.9375rem] font-medium text-accent transition-[background-color,scale] duration-(--t-press) ease-(--ease-out) hover:bg-accent-bg active:scale-[0.97] pointer-coarse:h-11"
    >
      <X className="size-3.5" />
      Clear
    </button>
  )
  const chipLines = short.map(({ field, options }) => (
    <ChipLine
      key={field.column}
      field={field}
      options={options}
      value={
        filters.find((one) => one.column === field.column)?.values[0] ?? null
      }
      onChange={(value) =>
        setColumn(
          field.column,
          value === null
            ? []
            : [
                {
                  column: field.column,
                  operator: listOperator(field),
                  values: [value],
                },
              ]
        )
      }
      wrap={sheet}
    />
  ))

  if (sheet)
    return (
      <div className={cn("flex flex-col gap-5", className)}>
        {openField === undefined && searchBox && (
          <div className="flex flex-wrap items-center gap-2">
            {searchBox}
            {pills}
          </div>
        )}
        {openField !== undefined &&
          long.map(({ field, options }) => (
            <Section key={field.column} label={field.label}>
              <LongPills
                field={field}
                options={options}
                held={
                  filters.find((one) => one.column === field.column)?.values ??
                  []
                }
                onPick={(value) => pick(`${field.column}\u001f${value}`)}
                onUnpick={(value) => unpick(field.column, value)}
                onMore={() => openField(field.column)}
              />
            </Section>
          ))}
        {dates.map(({ field }, at) => (
          <Section key={field.column} label={field.label}>
            {openDate === undefined ? (
              dateBoxes[at]
            ) : (
              <DateRow
                field={field}
                filters={filters}
                onOpen={() => openDate(field.column)}
              />
            )}
          </Section>
        ))}
        {short.map(({ field }, at) => (
          <Section key={field.column} label={field.label}>
            {chipLines[at]}
          </Section>
        ))}
        {switchPills.length > 0 && (
          <div className="flex flex-wrap gap-2">{switchPills}</div>
        )}
        {loose.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <ClauseChips model={looseModel} table={table} />
          </div>
        )}
        {clear && <div>{clear}</div>}
      </div>
    )

  // `contents`: the pieces sit in the screen's own bar, beside its Columns and
  // Export, and the chip lines drop to a line of their own under it.
  return (
    <div className={cn("list-filters contents", className)}>
      {searchBox}
      {pills}
      {dateBoxes}
      {switchPills}
      {loose.length > 0 && <ClauseChips model={looseModel} table={table} />}
      {clear}
      {chipLines.length > 0 && (
        <div className="order-last flex w-full min-w-0 flex-col gap-2 pt-1">
          {chipLines}
        </div>
      )}
    </div>
  )
}

/// A long field in the phone's sheet: what is chosen, the answers most rows
/// hold as pills to press, and every answer one page further.
function LongPills({
  field,
  options,
  held,
  onPick,
  onUnpick,
  onMore,
}: {
  readonly field: FilterField
  readonly options: readonly FilterOption[]
  readonly held: readonly string[]
  readonly onPick: (value: string) => void
  readonly onUnpick: (value: string) => void
  readonly onMore: () => void
}) {
  const top = options
    .filter((one) => !held.includes(one.value))
    .sort((a, b) => b.rows - a.rows)
    .slice(0, 4)
  const pill =
    "inline-flex h-11 max-w-full items-center gap-1.5 rounded-full px-4 text-[0.9375rem] font-medium transition-[background-color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]"
  return (
    <div className="flex flex-wrap gap-2">
      {held.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onUnpick(value)}
          className={cn(pill, "bg-accent-bg pr-3 text-accent ring-1 ring-accent ring-inset")}
        >
          <span className="truncate">
            {field.spec.format?.(value) ??
              options.find((one) => one.value === value)?.label ??
              value}
          </span>
          <X className="size-3.5 shrink-0" />
        </button>
      ))}
      {top.map((one) => (
        <button
          key={one.value}
          type="button"
          onClick={() => onPick(one.value)}
          className={cn(pill, "bg-soft-2 text-ink")}
        >
          <span className="truncate">{one.label}</span>
        </button>
      ))}
      {options.length > top.length + held.length && (
        <button
          type="button"
          onClick={onMore}
          className={cn(pill, "bg-soft-2 text-body")}
        >
          All {count(options.length)}
        </button>
      )}
    </div>
  )
}

/// A date in the phone's sheet: its window in words, the calendar a page on.
function DateRow({
  field,
  filters,
  onOpen,
}: {
  readonly field: FilterField
  readonly filters: readonly Filter[]
  readonly onOpen: () => void
}) {
  const mine = filters.filter((one) => one.column === field.column)
  const said =
    mine.length === 0
      ? "Any day"
      : mine
          .map((one) =>
            one.values.map((v) => day(v)).join(" – ")
          )
          .join(" – ")
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-11 w-full items-center gap-2 rounded-inner border px-3 text-left text-[0.9375rem] transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.99]",
        mine.length > 0
          ? "border-accent/40 bg-accent-bg text-accent"
          : "border-hairline-2 text-ink"
      )}
    >
      <CalendarDays className="size-4 shrink-0" />
      <span className="flex-1 truncate">{said}</span>
    </button>
  )
}

function Section({
  label,
  children,
}: {
  readonly label: string
  readonly children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[0.9375rem] text-mute">{label}</span>
      {children}
    </div>
  )
}

/// The answers a list field offers, with how many rows hold each.
///
/// The same reading as `useOptions`, without the memo, so one component can
/// read every field without a hook per field: a server's own counts first, then
/// the declared set, then whatever the table holds.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function optionsFor(field: FilterField, table?: any): FilterOption[] {
  const label = (value: string) => field.spec.format?.(value) ?? value
  if (field.spec.counted)
    return field.spec.counted.map((one) => ({
      value: one.value,
      label: label(one.value),
      rows: one.count,
    }))
  const rows = table?.getColumn?.(field.column)?.getFacetedRowModel?.()
    .flatRows as { getValue: (id: string) => unknown }[] | undefined
  const counts = new Map<string, number>()
  for (const row of rows ?? []) {
    const value = row.getValue(field.column)
    const held =
      value === null || value === undefined || value === ""
        ? []
        : Array.isArray(value)
          ? value
          : [value]
    for (const one of held) {
      const key = String(one)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  if (field.spec.options)
    return field.spec.options.map((option) => ({
      value: option.value,
      label: option.label,
      // Unknown without a table: the chip then shows no figure at all rather
      // than a 0 that reads as "empty".
      rows: rows === undefined ? -1 : (counts.get(option.value) ?? 0),
    }))
  return [...counts]
    .map(([value, n]) => ({ value, label: label(value), rows: n }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/// Six answers or fewer from a CLOSED set — one the screen declared (`options`)
/// or gave marks to (`icon`). Answers read out of the rows (people, codes,
/// sites) are an open list however few there are today, and open lists are
/// looked up by name in the search box, never laid out as chips.
function isShort(field: FilterField, options: readonly FilterOption[]) {
  if (field.spec.searchable === true) return false
  if (field.spec.icon === undefined && field.spec.options === undefined)
    return false
  return options.length <= 6
}

function listOperator(field: FilterField): Operator {
  const offered = operatorsFor(field.spec)
  if (field.spec.kind === "multi") return "includesAnyOf"
  if (offered.includes("isAnyOf")) return "isAnyOf"
  return offered[0]
}

function labelOf(
  long: readonly { field: FilterField; options: readonly FilterOption[] }[],
  column: string,
  value: string
) {
  return (
    long
      .find(({ field }) => field.column === column)
      ?.options.find((one) => one.value === value)?.label ?? value
  )
}

/// One line of icon radio chips: "All", then the answers rows hold, biggest
/// first, and "+N" for the rest. The one chosen always stays in view.
function ChipLine({
  field,
  options,
  value,
  onChange,
  wrap,
}: {
  readonly field: FilterField
  readonly options: readonly FilterOption[]
  readonly value: string | null
  readonly onChange: (value: string | null) => void
  readonly wrap: boolean
}) {
  const MAX = 6
  const known = options.every((one) => one.rows >= 0)
  const used = options
    .filter((one) => !known || one.rows > 0 || one.value === value)
    .sort((a, b) => (known ? b.rows - a.rows : 0))
  let shown = wrap ? used : used.slice(0, MAX)
  const chosen = used.find((one) => one.value === value)
  if (chosen && !shown.includes(chosen))
    shown = [...shown.slice(0, MAX - 1), chosen]
  const rest = used.filter((one) => !shown.includes(one))
  const total = known
    ? field.spec.kind === "multi"
      ? undefined
      : used.reduce((sum, one) => sum + one.rows, 0)
    : undefined
  const chips: ChipOption[] = [
    {
      value: null,
      label: "All",
      icon: field.spec.icon?.(null) ?? LayoutGrid,
      count: total,
    },
    ...shown.map((one) => ({
      value: one.value,
      label: one.label,
      icon: field.spec.icon?.(one.value),
      count: known ? one.rows : undefined,
    })),
  ]
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <FilterChips
        label={field.label}
        value={value}
        options={chips}
        onChange={onChange}
        className={cn(
          "min-w-0",
          !wrap && "flex-nowrap overflow-hidden [&>*]:shrink-0"
        )}
      />
      {rest.length > 0 && (
        <Popover.Root>
          <Popover.Trigger className="inline-flex h-9 shrink-0 items-center rounded-full border border-hairline-2 px-3.5 text-[0.9375rem] font-medium text-mute transition-[background-color,scale] duration-(--t-press) ease-(--ease-out) hover:bg-soft-2 active:scale-[0.97]">
            +{rest.length}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner
              className={POSITIONER}
              side="bottom"
              align="start"
              sideOffset={6}
            >
              <Popover.Popup className={POPUP}>
                {rest.map((one) => {
                  const Glyph = field.spec.icon?.(one.value)
                  return (
                    <Popover.Close
                      key={one.value}
                      onClick={() => onChange(one.value)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-[0.4375rem] text-left text-ink hover:bg-soft-2"
                    >
                      {Glyph && <Glyph className="size-4 text-body" />}
                      <span className="flex-1">{one.label}</span>
                      {known && (
                        <span className="text-mute tabular-nums">
                          {count(one.rows)}
                        </span>
                      )}
                    </Popover.Close>
                  )
                })}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  )
}

/// A date column as one box: from and to, either end open.
///
/// A field the SERVER narrows names its own two operators (`gte`/`lte`, as
/// Purchase Orders does); one the browser narrows uses the date kind's own.
function DateBox({
  field,
  filters,
  onChange,
  wide,
}: {
  readonly field: FilterField
  readonly filters: readonly Filter[]
  readonly onChange: (next: readonly Filter[]) => void
  readonly wide: boolean
}) {
  const offered = operatorsFor(field.spec)
  const [fromOp, toOp]: [Operator, Operator] = offered.includes("gte")
    ? ["gte", "lte"]
    : ["onOrAfter", "onOrBefore"]
  const mine = filters.filter((one) => one.column === field.column)
  const between = mine.find((one) => one.operator === "between")
  const value: DayWindow = {
    from:
      mine.find((one) => one.operator === fromOp)?.values[0] ??
      between?.values[0] ??
      "",
    to:
      mine.find((one) => one.operator === toOp)?.values[0] ??
      between?.values[1] ??
      "",
  }
  return (
    <DayRange
      label={field.label}
      placeholder={field.label}
      value={value}
      quiet
      onChange={(next) =>
        onChange([
          ...(next.from === ""
            ? []
            : [{ column: field.column, operator: fromOp, values: [next.from] }]),
          ...(next.to === ""
            ? []
            : [{ column: field.column, operator: toOp, values: [next.to] }]),
        ])
      }
      className={cn("h-control min-h-0 shrink-0 py-0", wide ? "w-full" : "w-44")}
    />
  )
}
