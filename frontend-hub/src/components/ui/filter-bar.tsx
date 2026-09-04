import type { RowData } from "@tanstack/react-table"
import { Menu } from "@base-ui/react/menu"
import { Popover } from "@base-ui/react/popover"
import { ListFilter, Plus } from "lucide-react"
import { useEffect, useState } from "react"

import { Input } from "@/components/ui/field"
import { FilterChip, OptionRow } from "@/components/ui/filter-chip"
import { CHIP, ITEM, POPUP, summarise, useOptions } from "@/lib/filter-chrome"
import {
  arity,
  type Filter,
  type FilterField,
  type FilterModel,
} from "@/lib/filters"
import { cn } from "@/lib/utils"

/// The filter bar: a row of chips over a list, each one a sentence.
///
/// It sits above the card, not in a column beside it. A 248px rail spends
/// permanent width on a control most readers touch twice a day, and on these
/// screens it pushed the table into two thirds of the viewport — which is why
/// the app it replaces removed the rail from every screen but two, taking the
/// filters with it.
///
/// This is the MOUSE-driven bar, for the eleven screens that draw a table: a
/// menu for the column, a menu for the operator, a popover for the value. The
/// typed one is `<FilterOmnibox>`, which builds the same clause from a single
/// box; both draw the same chip, out of `ui/filter-chip`.

export function FilterBar<TRow extends RowData>({
  model,
  table,
  className,
}: {
  readonly model: FilterModel<TRow>
  /// The table the bar narrows. Read for facet counts only — which values a
  /// column actually holds, and how many rows hold each — so the picker offers
  /// what is there rather than what the schema allows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `useTable`'s
  // return type is generic over the feature set and invariant in v9; naming it
  // here would lock the bar to one table's columns.
  readonly table: any
  readonly className?: string
}) {
  const { filters, fields, add, update, remove, clear } = model

  if (fields.length === 0) return null

  return (
    <div
      className={cn("flex flex-wrap items-center gap-[0.4375rem]", className)}
    >
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

      <AddFilter fields={fields} onAdd={add} hasFilters={filters.length > 0} />

      {filters.length > 0 && (
        <button
          type="button"
          onClick={clear}
          className="h-8 rounded-full px-2.5 text-meta text-mute transition-colors hover:text-ink"
        >
          Clear
        </button>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/// The shared chip, with a popover for its value segment.
function Chip({
  filter,
  field,
  table,
  onChange,
  onRemove,
}: {
  filter: Filter
  field: FilterField
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
  onChange: (next: Filter) => void
  onRemove: () => void
}) {
  return (
    <FilterChip
      field={field}
      filter={filter}
      onChange={onChange}
      onRemove={onRemove}
    >
      <Popover.Root>
        <Popover.Trigger
          className={cn(
            "flex items-center px-2.5 font-medium transition-colors",
            filter.values.length > 0
              ? "text-accent hover:text-ink"
              : "text-mute hover:text-ink"
          )}
        >
          {summarise(filter, field)}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6}>
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
    <div className="flex min-w-[15rem] flex-col gap-1">
      {/* Eight, not four: twenty suppliers is a list you search, five statuses
          is a list you read, and a search box over five rows is furniture. */}
      {options.length > 8 && (
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          className="h-8"
        />
      )}

      {shown.length === 0 ? (
        <p className="px-2.5 py-3 text-center text-meta text-mute">
          Nothing matches.
        </p>
      ) : (
        <div className="flex flex-col">
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
            placeholder={field.spec.unit ?? field.label}
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
}: {
  fields: readonly FilterField[]
  onAdd: (column: string) => void
  hasFilters: boolean
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
          "items-center gap-1.5 border border-dashed border-hairline-strong px-2.5 text-body transition-colors hover:bg-soft-2 hover:text-ink"
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
        <Menu.Positioner side="bottom" align="start" sideOffset={6}>
          <Menu.Popup className={POPUP}>
            {fields.length > 8 && (
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
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
