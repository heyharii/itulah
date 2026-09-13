import { useMemo } from "react"

import { count } from "@/lib/format"
import {
  arity,
  type Filter,
  type FilterField,
  type Operator,
} from "@/lib/filters"

/// The chrome a filter chip wears, and the three functions that decide what it
/// says — kept out of `ui/filter-chip` so that file exports components only.
///
/// Two bars draw a chip: `<FilterBar>`, the mouse-driven one over a table, and
/// `<FilterOmnibox>`, the typed one. They differ in how a clause is BUILT and
/// not at all in how it READS, so everything after "the clause exists" is
/// shared. The alternative — a second chip beside the first — is the drift
/// this file exists to prevent, and the app being replaced has it: two facet
/// columns, one with a box to sift a long list and one without, because nobody
/// remembered the second when they improved the first.

/// The chip's geometry, shared by the chips and the buttons that sit with them
/// so a row of them has one height.
export const CHIP =
  "inline-flex h-8 items-stretch overflow-hidden rounded-full text-meta"

/// The panel a popup is drawn on: ground, hairline, radius, shadow, padding.
///
/// Split out from `POPUP` for the one control that needs the skin without the
/// scrolling. Base UI's select scrolls its own list — it has to, because it
/// measures that list to sit the chosen row over the trigger — and a second
/// scroll box wrapped around it makes the popup open in the wrong place.
export const PANEL =
  "z-50 min-w-[12rem] rounded-card border border-hairline bg-canvas p-[0.3125rem] text-[0.875rem] shadow-pop outline-none"

export const POPUP = `${PANEL} max-h-[22rem] overflow-y-auto`

/// The layer, which has to go on the POSITIONER rather than on the popup.
///
/// `PANEL` says `z-50` and that class does nothing: Base UI paints a popup
/// inside a positioner, the popup is `position: static`, and `z-index` only
/// applies to a positioned element. Over a page nobody noticed — a menu is
/// above the page whatever it claims — but a menu opened INSIDE `<Sheet>`,
/// whose panel is `z-40` and fixed, painted underneath the panel that opened
/// it: the rows were in the accessibility tree, visible nowhere, and a click
/// landed on the sheet's own text. That is what the filter panel does with
/// every one of its controls, so the layer is declared where the position is.
export const POSITIONER = "z-50"

export const ITEM =
  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-[0.4375rem] text-left text-text outline-none select-none data-[highlighted]:bg-soft-2 data-[highlighted]:text-ink"

/// Keep the values that still mean something when the operator changes.
///
/// Switching "is" to "is any of" should keep the supplier already picked —
/// retyping it is the kind of small insult that stops people using a control.
/// Going the other way keeps the first of them, and an emptiness test keeps
/// nothing because it takes nothing.
export function retarget(filter: Filter, operator: Operator): Filter {
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

/// What the value segment says when it is not being edited.
export function summarise(filter: Filter, field: FilterField): string {
  const label = (value: string) => field.spec.format?.(value) ?? value
  if (filter.values.length === 0) return "…"
  if (arity(filter.operator) === "two") {
    const [from, to] = filter.values
    return `${from || "…"} – ${to || "…"}`
  }
  if (filter.values.length === 1) return label(filter.values[0])
  return `${count(filter.values.length)} selected`
}

export interface FilterOption {
  readonly value: string
  readonly label: string
  /// How many rows carry it. The number is the whole affordance: it is how
  /// somebody decides whether a filter is worth pressing before they press it.
  readonly rows: number
}

/// The values a column actually holds, with how many rows hold each.
///
/// Three sources, in order. A `counted` spec wins — those are the server's own
/// numbers, computed over the whole catalogue rather than over the page that
/// happens to have loaded, and a screen that has them has no table to ask.
/// Then a declared `options` set, so a status nobody has yet is still offered:
/// its absence is the answer somebody is looking for. Otherwise the table.
///
/// The table is walked rather than read through `getFacetedUniqueValues`
/// because that map treats an array cell as one key — a tag list
/// `["Sale","Clearance"]` becomes a single option nobody would ever pick.
/// Flattening gives one option per tag, and the counts still respect the other
/// chips on the bar, which is what makes them worth showing.
export function useOptions(
  field: FilterField,
  /// The table, when there is one. `useTable`'s return type is generic over
  /// the feature set and invariant in v9, so naming it would lock this to one
  /// table's columns. Optional, because the screens that pass `counted` have
  /// no table at all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table?: any
): FilterOption[] {
  const column = table?.getColumn?.(field.column)
  const rows = column?.getFacetedRowModel?.().flatRows

  return useMemo(() => {
    const label = (value: string) => field.spec.format?.(value) ?? value

    if (field.spec.counted) {
      return field.spec.counted.map((one) => ({
        value: one.value,
        label: label(one.value),
        rows: one.count,
      }))
    }

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

    if (field.spec.options) {
      return field.spec.options.map((option) => ({
        value: option.value,
        label: option.label,
        rows: counts.get(option.value) ?? 0,
      }))
    }

    return [...counts]
      .map(([value, n]) => ({ value, label: label(value), rows: n }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rows, field])
}
