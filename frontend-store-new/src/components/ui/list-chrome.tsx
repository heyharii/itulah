import { ArrowDown, ArrowUp, Check } from "lucide-react"

import { cn } from "@/lib/utils"

/// The rows a list's sheets are made of — the part of the hub's
/// `list-chrome.tsx` a shop's lists use: a row of a sheet, the sort rows and a
/// plain pick-one list. (The hub's filter panel, saved views and column menu
/// stay there: a shop's lists open their own filter sheet.)

/// What a list can be sorted by, as the sort sheet lists it: a named order per
/// column, and `""` for the list's own order.
export interface SortChoices {
  readonly options: readonly {
    readonly value: string
    readonly label: string
  }[]
  /// The order in force. `""` is the list's own.
  readonly value: string
  readonly desc: boolean
  readonly onChange: (value: string, desc: boolean) => void
}

/// A row of a sheet: 48px, plain, a press tints it. Every list of choices in
/// every sheet is made of these (owner, 2026-10-06).
export const SHEET_ROW =
  "flex min-h-12 w-full items-center gap-3 rounded-inner px-3 text-left text-[0.9375rem] text-ink transition-[background-color,scale] duration-100 ease-(--ease-out) active:scale-[0.985] active:bg-soft-2"

/// The ways a list can be ordered, as rows. The column already in force turns
/// over on a second tap and the sheet stays to show it; choosing another one
/// shuts it. A choice with `desc` false and no `""` option has no direction
/// worth turning: pass `directional={false}` and a second tap just closes.
export function SheetSortRows({
  choices,
  withDefault = false,
  directional = true,
  rowClass = SHEET_ROW,
  onDone,
}: {
  choices: SortChoices
  /// Offer the list's own order as the first row.
  withDefault?: boolean
  /// Whether pressing the order already in force turns it over. A list whose
  /// orders are named ("Cheapest", "Dearest") says its direction in the name.
  directional?: boolean
  rowClass?: string
  onDone: () => void
}) {
  const options = withDefault
    ? [{ value: "", label: "Default order" }, ...choices.options]
    : choices.options
  return (
    <>
      {options.map((one) => {
        const on = one.value === choices.value
        const ordered = directional && on && one.value !== ""
        return (
          <button
            key={one.value}
            type="button"
            aria-pressed={on}
            aria-label={
              ordered
                ? `${one.label}, ${choices.desc ? "descending" : "ascending"}`
                : one.label
            }
            onClick={() => {
              if (ordered) {
                choices.onChange(one.value, !choices.desc)
                return
              }
              choices.onChange(one.value, choices.desc)
              onDone()
            }}
            className={cn(rowClass, on && "font-medium text-accent")}
          >
            <span className="flex-1">{one.label}</span>
            {ordered ? (
              choices.desc ? (
                <ArrowDown className="size-4 shrink-0" />
              ) : (
                <ArrowUp className="size-4 shrink-0" />
              )
            ) : on ? (
              <Check className="size-4 shrink-0" />
            ) : null}
          </button>
        )
      })}
    </>
  )
}

/// A plain pick-one list as rows, the current one ticked: the body of a
/// status or view sheet.
export function SheetChoiceRows<T extends string>({
  options,
  value,
  onPick,
}: {
  options: readonly {
    readonly value: T
    readonly label: React.ReactNode
    /// A figure at the right of the row: how many the choice holds.
    readonly trailing?: React.ReactNode
  }[]
  value: T
  onPick: (value: T) => void
}) {
  return (
    <>
      {options.map((one) => {
        const on = one.value === value
        return (
          <button
            key={one.value}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(one.value)}
            className={cn(SHEET_ROW, on && "font-medium text-accent")}
          >
            <span className="min-w-0 flex-1 truncate">{one.label}</span>
            {one.trailing !== undefined && (
              <span className="text-body tabular-nums">{one.trailing}</span>
            )}
            <Check className={cn("size-4 shrink-0", on ? "" : "opacity-0")} />
          </button>
        )
      })}
    </>
  )
}
