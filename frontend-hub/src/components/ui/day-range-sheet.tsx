import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { dateOf, monthGrid, today, WEEKDAYS } from "@/lib/calendar"
import { dayRangeOf, setDayRange } from "@/lib/day-window"
import type { FilterField, FilterState } from "@/lib/filters"
import { cn } from "@/lib/utils"

/// A window of days as a page of a sheet: a month to tap, the first day and
/// then the last, for the fields that ask a question of a range — issued
/// between, due between.
///
/// `DayRange` is the same question on a desk, in a popover beside a box you
/// can type into. On a phone the sheet is the one surface every choice opens
/// in (owner, 2026-10-06), so the calendar is a page of it, with no box to type
/// into: a thumb taps a day.
///
/// Values are ISO days, `""` for an open end, and land as two clauses — `gte`
/// and `lte` — which is what the fields that use this declare they take.
export function DayRangePage({
  field,
  model,
  onComplete,
}: {
  field: FilterField
  model: FilterState
  /// Both ends are chosen: the page has nothing left to ask.
  onComplete: () => void
}) {
  const days = dayRangeOf(model, field.column)
  const [month, setMonth] = useState(() =>
    dateOf(days.from !== "" ? days.from : today())
  )
  /// The first day tapped, while the second is still to come.
  const [anchor, setAnchor] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimer(timer.current), [])
  const now = today()
  const grid = monthGrid(month.getFullYear(), month.getMonth())
  const step = (by: number) =>
    setMonth((was) => new Date(was.getFullYear(), was.getMonth() + by, 1))

  const tap = (iso: string) => {
    if (anchor === null) {
      // The start narrows the list at once; the end is still to choose.
      setAnchor(iso)
      setDayRange(model, field.column, { from: iso, to: "" })
      return
    }
    setAnchor(null)
    setDayRange(
      model,
      field.column,
      anchor <= iso ? { from: anchor, to: iso } : { from: iso, to: anchor }
    )
    // A beat to see the window close before the page goes.
    timer.current = window.setTimeout(onComplete, 200)
  }

  const lo = days.from
  const hi = days.to !== "" ? days.to : days.from
  const long = (iso: string) =>
    dateOf(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })

  return (
    <div className="px-2 pb-1">
      <div className="mb-1.5 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => step(-1)}
          className="grid size-9 place-items-center rounded-full text-line-ico transition-[background-color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.94] active:bg-soft-2"
        >
          <ChevronLeft className="size-5" />
        </button>
        <span className="text-[0.9375rem] font-semibold text-ink">
          {month.toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric",
          })}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => step(1)}
          className="grid size-9 place-items-center rounded-full text-line-ico transition-[background-color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.94] active:bg-soft-2"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {WEEKDAYS.map((name) => (
          <span
            key={name}
            className="grid h-8 place-items-center font-mono text-eyebrow tracking-[0.04em] text-mute uppercase"
          >
            {name.slice(0, 1)}
          </span>
        ))}
        {grid.map((iso) => {
          const inMonth = dateOf(iso).getMonth() === month.getMonth()
          const end = lo !== "" && (iso === lo || iso === hi)
          const between = lo !== "" && iso > lo && iso < hi
          return (
            <button
              key={iso}
              type="button"
              onClick={() => tap(iso)}
              className={cn(
                "grid h-11 place-items-center text-[0.9375rem] tabular-nums transition-colors duration-100",
                end
                  ? "rounded-full bg-ink font-medium text-white"
                  : between
                    ? "bg-soft-2 text-ink"
                    : cn(
                        "rounded-full active:bg-soft-2",
                        iso === now && "font-semibold text-accent",
                        !inMonth && iso !== now && "text-faint",
                        inMonth && iso !== now && "text-text"
                      )
              )}
            >
              {dateOf(iso).getDate()}
            </button>
          )
        })}
      </div>
      <p className="mx-1 mt-2 min-h-5 text-[0.875rem] text-mute">
        {anchor !== null
          ? `From ${long(anchor)} — pick the last day`
          : days.from === ""
            ? "Pick the first day"
            : `${long(days.from)}${days.to !== "" && days.to !== days.from ? ` – ${long(days.to)}` : ""}`}
      </p>
    </div>
  )
}

function clearTimer(handle: number | undefined): void {
  if (handle !== undefined) window.clearTimeout(handle)
}
