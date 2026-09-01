import type { RowData } from "@tanstack/react-table"
import { Menu } from "@base-ui/react/menu"
import { Popover } from "@base-ui/react/popover"
import { Check, ListFilter, Plus, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Input } from "@/components/ui/field"
import {
  OPERATORS,
  arity,
  operatorLabel,
  type Filter,
  type FilterField,
  type FilterModel,
  type Operator,
} from "@/lib/filters"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/// The filter bar: a row of chips over a list, each one a sentence.
///
/// A chip reads left to right as **column · operator · value**, and every part
/// of it is the control that changes that part. That is the whole idea the
/// facet rail it replaces did not have: the operator is visible and editable,
/// so "supplier is any of" and "supplier is none of" are the same chip with one
/// word changed rather than two different features, one of which was never
/// built.
///
/// It sits above the card, not in a column beside it. A 248px rail spends
/// permanent width on a control most readers touch twice a day, and on these
/// screens it pushed the table into two thirds of the viewport — which is why
/// the app it replaces removed the rail from every screen but two, taking the
/// filters with it.

/// The chip's own geometry, shared by the chips and the two buttons that sit
/// with them so the row has one height.
const CHIP = "inline-flex h-8 items-stretch overflow-hidden rounded-full text-meta"

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
    <div className={cn("flex flex-wrap items-center gap-[0.4375rem]", className)}>
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
  const takes = arity(filter.operator)

  return (
    <span className={cn(CHIP, "border border-hairline-2 bg-canvas")}>
      <span className="flex items-center px-2.5 font-medium text-ink">
        {field.label}
      </span>

      <Menu.Root>
        <Menu.Trigger className="flex items-center border-x border-hairline bg-soft px-2 text-body transition-colors hover:text-ink">
          {operatorLabel(filter.operator)}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="start" sideOffset={6}>
            <Menu.Popup className={POPUP}>
              {OPERATORS[field.spec.kind].map((operator) => (
                <Menu.Item
                  key={operator}
                  onClick={() => onChange(retarget(filter, operator))}
                  className={ITEM}
                >
                  <span className="flex-1">{operatorLabel(operator)}</span>
                  {operator === filter.operator && (
                    <Check className="size-3.5 text-ink" />
                  )}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      {takes !== "none" && (
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
      )}

      <button
        type="button"
        aria-label={`Remove the ${field.label} filter`}
        onClick={onRemove}
        className="flex items-center border-l border-hairline px-2 text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
      >
        <X className="size-3.5" />
      </button>
    </span>
  )
}

/// Keep the values that still mean something when the operator changes.
///
/// Switching "is" to "is any of" should keep the supplier already picked —
/// retyping it is the kind of small insult that stops people using a control.
/// Going the other way keeps the first of them, and an emptiness test keeps
/// nothing because it takes nothing.
function retarget(filter: Filter, operator: Operator): Filter {
  const was = arity(filter.operator)
  const now = arity(operator)
  if (now === "none") return { ...filter, operator, values: [] }
  if (now === "many") return { ...filter, operator }
  if (was === "many" || was === "two") {
    return {
      ...filter,
      operator,
      values: filter.values.slice(0, now === "two" ? 2 : 1),
    }
  }
  return { ...filter, operator }
}

function summarise(filter: Filter, field: FilterField): string {
  const label = (value: string) => field.spec.format?.(value) ?? value
  if (filter.values.length === 0) return "…"
  if (arity(filter.operator) === "two") {
    const [from, to] = filter.values
    return `${from || "…"} – ${to || "…"}`
  }
  if (filter.values.length === 1) return label(filter.values[0])
  return `${count(filter.values.length)} selected`
}

/* -------------------------------------------------------------------------- */

const POPUP =
  "z-50 max-h-[22rem] min-w-[13rem] overflow-y-auto rounded-inner border border-hairline bg-canvas p-1 text-meta shadow-pop outline-none"

const ITEM =
  "flex w-full cursor-pointer items-center gap-2 rounded-[calc(var(--r-inner)-0.25rem)] px-2.5 py-1.5 text-left text-body outline-none select-none data-[highlighted]:bg-soft-2 data-[highlighted]:text-ink"

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

/// The values a column actually holds, with how many rows hold each.
///
/// Counted here rather than through `getFacetedUniqueValues` because that map
/// treats an array cell as one key — a tag list `["Sale","Clearance"]` becomes
/// a single option nobody would ever pick. Walking the faceted rows and
/// flattening gives one option per tag, and the counts still respect the other
/// chips on the bar, which is what makes them worth showing.
function useOptions(
  field: FilterField,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
): { value: string; label: string; rows: number }[] {
  const column = table.getColumn(field.column)
  const rows = column?.getFacetedRowModel?.().flatRows

  return useMemo(() => {
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

    if (field.spec.kind === "boolean") {
      return [
        { value: "true", label: "Yes", rows: counts.get("true") ?? 0 },
        { value: "false", label: "No", rows: counts.get("false") ?? 0 },
      ]
    }

    // A declared set wins, so a status nobody has yet is still offered — its
    // absence is the answer somebody is looking for.
    if (field.spec.options) {
      return field.spec.options.map((option) => ({
        value: option.value,
        label: option.label,
        rows: counts.get(option.value) ?? 0,
      }))
    }

    return [...counts]
      .map(([value, n]) => ({
        value,
        label: field.spec.format?.(value) ?? value,
        rows: n,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rows, field])
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
          {shown.map((option) => {
            const checked = filter.values.includes(option.value)
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className={cn(
                  ITEM,
                  "justify-between",
                  checked && "text-ink",
                  "hover:bg-soft-2"
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-[5px] border-[1.5px] transition-colors",
                      single && "rounded-full",
                      checked
                        ? "border-accent bg-accent text-on-dark"
                        : "border-hairline-strong"
                    )}
                  >
                    {checked && <Check className="size-2.5" />}
                  </span>
                  <span className="truncate">{option.label}</span>
                </span>
                <span className="shrink-0 pl-2 text-mute tabular-nums">
                  {count(option.rows)}
                </span>
              </button>
            )
          })}
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
    const settled = draft.every((value, at) => value === (filter.values[at] ?? ""))
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
