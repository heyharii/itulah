import { Popover } from "@base-ui/react/popover"
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { dateOf, isoOf, monthGrid, shift, WEEKDAYS } from "@/lib/calendar"
import { PANEL } from "@/lib/filter-chrome"
import { dateRange, monthYear } from "@/lib/format"
import { cn } from "@/lib/utils"
import { type Range } from "@/screens/sales/explorer-model"

/// Pick dates: a range chosen off two months, with the shortcuts people ask
/// for in a column beside them, and Apply to take it.
///
/// `DayRange` in the kit is one month and a box to type into, and takes a range
/// the moment the second day is tapped. A report that reads a million sales
/// should not be re-asked on the way to the end date, so this one holds the
/// two days until Apply. On a phone it is a bottom sheet with one month in it.

const firstOf = (iso: string) => `${iso.slice(0, 8)}01`

function lastOf(iso: string): string {
  const at = dateOf(iso)
  return isoOf(new Date(at.getFullYear(), at.getMonth() + 1, 0))
}

/// The shortcuts, counted back from the last day there is anything to read.
function shortcuts(anchor: string): readonly [string, Range][] {
  const lastMonth = shift(firstOf(anchor), -1)
  return [
    ["Today", { from: anchor, to: anchor }],
    ["Yesterday", { from: shift(anchor, -1), to: shift(anchor, -1) }],
    ["Last 7 days", { from: shift(anchor, -6), to: anchor }],
    ["Last 30 days", { from: shift(anchor, -29), to: anchor }],
    ["This month", { from: firstOf(anchor), to: anchor }],
    ["Last month", { from: firstOf(lastMonth), to: lastOf(lastMonth) }],
    ["This year", { from: `${anchor.slice(0, 4)}-01-01`, to: anchor }],
  ]
}

interface Bounds {
  /// The days that can be chosen: the first sales day to the last.
  readonly min: string
  readonly max: string
  /// The last day, for the shortcuts.
  readonly anchor: string
}

function Month({
  year,
  month,
  low,
  high,
  bounds,
  onPick,
}: {
  year: number
  month: number
  low: string | null
  high: string | null
  bounds: Bounds
  onPick: (iso: string) => void
}) {
  const cells = monthGrid(year, month)
  const lead = cells.findIndex((iso) => dateOf(iso).getMonth() === month)
  const days = new Date(year, month + 1, 0).getDate()
  const shown = cells.slice(0, Math.ceil((lead + days) / 7) * 7)
  return (
    <div className="min-w-0 flex-1">
      <h4 className="mb-1.5 text-center text-[0.9375rem] font-semibold text-ink">
        {monthYear(new Date(year, month, 1), true)}
      </h4>
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((name) => (
          <span
            key={name}
            className="grid h-7 place-items-center text-[0.9375rem] text-mute"
          >
            {name.slice(0, 2)}
          </span>
        ))}
        {shown.map((iso) => {
          if (dateOf(iso).getMonth() !== month)
            return <span key={iso} className="h-9" />
          const dead = iso < bounds.min || iso > bounds.max
          const end = low !== null && (iso === low || iso === high)
          const between =
            low !== null && high !== null && iso > low && iso < high
          return (
            <button
              key={iso}
              type="button"
              disabled={dead}
              onClick={() => onPick(iso)}
              className={cn(
                "h-9 text-[0.9375rem] tabular-nums transition-colors duration-100 ease-out",
                dead
                  ? "cursor-default text-faint"
                  : end
                    ? "rounded-inner bg-ink text-white"
                    : between
                      ? "bg-accent-bg text-ink"
                      : "text-text hover:bg-soft-2"
              )}
            >
              {dateOf(iso).getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/// The first of the month to draw at the left, so `last` is in the right-hand one.
function leftOf(last: string, months: 1 | 2): Date {
  const at = dateOf(last)
  return new Date(at.getFullYear(), at.getMonth() - (months - 1), 1)
}

function RangeCalendar({
  initial,
  bounds,
  months,
  onApply,
  onCancel,
}: {
  initial: Range | null
  bounds: Bounds
  /// How many months stand side by side.
  months: 1 | 2
  onApply: (range: Range) => void
  onCancel: () => void
}) {
  const [first, setFirst] = useState<string | null>(initial?.from ?? null)
  const [last, setLast] = useState<string | null>(initial?.to ?? null)
  // The left month: the one before the last day, so that day's month is on the
  // right while two are showing.
  const [left, setLeft] = useState(() =>
    leftOf(initial?.to ?? bounds.anchor, months)
  )
  const step = (by: number) =>
    setLeft((was) => new Date(was.getFullYear(), was.getMonth() + by, 1))

  const low = first !== null && last !== null && last < first ? last : first
  const high = first !== null && last !== null && last < first ? first : last
  const span =
    low !== null && high !== null
      ? Math.round(
          (dateOf(high).getTime() - dateOf(low).getTime()) / 86_400_000
        ) + 1
      : 0

  const pick = (iso: string) => {
    if (first === null || last !== null) {
      setFirst(iso)
      setLast(null)
    } else setLast(iso)
  }
  const canBack = left.getTime() > dateOf(firstOf(bounds.min)).getTime()
  const rightEdge = new Date(
    left.getFullYear(),
    left.getMonth() + months - 1,
    1
  )
  const canForward = rightEdge.getTime() < dateOf(firstOf(bounds.max)).getTime()

  return (
    <div className="flex max-md:flex-col">
      <div className="flex shrink-0 flex-col gap-0.5 border-hairline p-2.5 max-md:flex-row max-md:flex-wrap max-md:border-b md:w-40 md:border-r">
        {shortcuts(bounds.anchor).map(([label, range]) => {
          const on = low === range.from && high === range.to
          return (
            <button
              key={label}
              type="button"
              onClick={() => {
                setFirst(range.from)
                setLast(range.to)
                setLeft(leftOf(range.to, months))
              }}
              className={cn(
                "h-9 rounded-inner px-2.5 text-left text-[0.9375rem] transition-[background-color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]",
                on
                  ? "bg-soft-2 font-medium text-ink"
                  : "text-text hover:bg-soft"
              )}
            >
              {label}
            </button>
          )
        })}
      </div>
      <div className="min-w-0 p-4 pb-0 max-md:p-3 max-md:pb-0">
        <div className="mb-1.5 flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            disabled={!canBack}
            onClick={() => step(-1)}
            className="grid size-8 place-items-center rounded-inner text-body transition-[background-color,scale] duration-(--t-press) ease-(--ease-out) hover:bg-soft-2 active:scale-[0.97] disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            disabled={!canForward}
            onClick={() => step(1)}
            className="grid size-8 place-items-center rounded-inner text-body transition-[background-color,scale] duration-(--t-press) ease-(--ease-out) hover:bg-soft-2 active:scale-[0.97] disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="flex gap-6">
          {Array.from({ length: months }, (_, i) => {
            const at = new Date(left.getFullYear(), left.getMonth() + i, 1)
            return (
              <Month
                key={i}
                year={at.getFullYear()}
                month={at.getMonth()}
                low={low}
                high={high}
                bounds={bounds}
                onPick={pick}
              />
            )
          })}
        </div>
        <div className="-mx-4 mt-3 flex items-center gap-2.5 border-t border-hairline px-4 py-3 max-md:-mx-3 max-md:px-3">
          <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-mute tabular-nums">
            {low !== null && high !== null
              ? `${dateRange(low, high)} · ${span} ${span === 1 ? "day" : "days"}`
              : first !== null
                ? "Pick the last day"
                : "Pick the first day"}
          </span>
          <Button data-cancel variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={first === null}
            onClick={() => {
              if (first === null) return
              const to = last ?? first
              onApply(
                first < to ? { from: first, to } : { from: to, to: first }
              )
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  )
}

/// The header's button and the calendar that drops from it, on a desk.
export function PickDates({
  label,
  custom,
  range,
  bounds,
  onApply,
}: {
  /// What the button says: "Pick dates", or the range once one was picked.
  label: string
  custom: boolean
  range: Range
  bounds: Bounds
  onApply: (range: Range) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn(
          "inline-flex h-control shrink-0 items-center justify-center gap-1.5 rounded-inner border bg-canvas px-2.5 text-control font-medium whitespace-nowrap text-text shadow-soft transition-[color,background-color,border-color,scale] duration-(--t-press) ease-(--ease-out) outline-none hover:bg-soft-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.97] [&_svg]:size-4 [&_svg]:text-line-ico",
          custom ? "border-ink text-ink" : "border-hairline-2"
        )}
      >
        <CalendarDays />
        {label}
        <ChevronDown />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="z-50"
          side="bottom"
          align="end"
          sideOffset={6}
        >
          <Popover.Popup className={cn(PANEL, "w-max rounded-[0.875rem] p-0")}>
            <RangeCalendar
              initial={custom ? range : null}
              bounds={bounds}
              months={2}
              onCancel={() => setOpen(false)}
              onApply={(next) => {
                onApply(next)
                setOpen(false)
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/// The same calendar as a bottom sheet with one month in it, for a phone.
export function PickDatesSheet({
  open,
  onOpenChange,
  custom,
  range,
  bounds,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  custom: boolean
  range: Range
  bounds: Bounds
  onApply: (range: Range) => void
}) {
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Pick dates">
      {/* Mounted only while open, so each opening starts from the range in
          force and not from where the last one was left. */}
      {open && (
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          <RangeCalendar
            initial={custom ? range : null}
            bounds={bounds}
            months={1}
            onCancel={() => onOpenChange(false)}
            onApply={(next) => {
              onApply(next)
              onOpenChange(false)
            }}
          />
        </div>
      )}
    </BottomSheet>
  )
}
