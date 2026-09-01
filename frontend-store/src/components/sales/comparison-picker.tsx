import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Comparison, ComparisonMode, SalesRange } from "@itulah/contract/reporting"
import { isoDate, spanDays } from "@itulah/contract/reporting"
import { cn } from "@/lib/utils"
import { ChevronDownIcon } from "lucide-react"
import { useState } from "react"
import type { DateRange } from "react-day-picker"

/// What the figures are measured against.
///
/// Two shortcuts and a calendar, rather than a dropdown of shortcuts alone.
/// The comparison that matters most in this business cannot be derived from
/// the current span: Ramadan moves about eleven days earlier every Gregorian
/// year, so "Ramadan against last Ramadan" is neither the previous thirty days
/// nor the same dates a year ago. It is two spans a person names, and nothing
/// but a calendar will let them.
export function ComparisonPicker({
  comparison,
  range,
  onChange,
}: {
  comparison: Comparison
  /// The span being measured, so a mismatch in length can be said out loud.
  range: SalesRange
  onChange: (next: { mode: ComparisonMode; from?: string; to?: string }) => void
}) {
  const [open, setOpen] = useState(false)
  // Starts empty every time the calendar is opened, and that is the whole
  // point. Seeding it with the comparison already in force makes the first
  // click EXTEND that range instead of beginning a new one — click the 10th
  // meaning "from the 10th" and you get the old start to the 10th, committed
  // before you can click the end. The trigger above already says which span is
  // in force, so showing it again here bought nothing and cost the gesture.
  const [draft, setDraft] = useState<DateRange | undefined>(undefined)

  const pick = (mode: ComparisonMode) => {
    onChange({ mode })
    setOpen(false)
  }

  // Eleven days against thirty is not a comparison, it is a ratio of two
  // different questions — and it comes out as a confident-looking percentage
  // that says trade collapsed. The reader is allowed to do it (two Ramadans
  // are not the same length either), so this says the lengths differ rather
  // than refusing, and says it where the choice was made.
  const here = spanDays(range.from, range.to)
  const there = spanDays(comparison.from, comparison.to)
  const uneven = Math.abs(here - there) > Math.max(1, here * 0.1)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setDraft(undefined)
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5 font-normal">
            <span className="text-muted-foreground">Compare</span>
            <span className="max-w-40 truncate">{comparison.full}</span>
            {uneven && (
              <span
                className="text-amber-700 dark:text-amber-500"
                title={`${there} days against ${here} — the percentages compare spans of different length`}
              >
                {there}d
              </span>
            )}
            <ChevronDownIcon className="text-muted-foreground size-3.5" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex flex-col gap-1 border-b p-1.5">
          <Shortcut
            active={comparison.mode === "prev"}
            onClick={() => pick("prev")}
            label="Previous period"
            hint="The span of the same shape immediately before this one"
          />
          <Shortcut
            active={comparison.mode === "year"}
            onClick={() => pick("year")}
            label="Same dates last year"
            hint="365 days back — right for a calendar month, wrong for a moving feast"
          />
        </div>
        <div className="p-1.5">
          <p className="text-muted-foreground px-1.5 pt-1 pb-1.5 text-[11px]">
            {draft?.from === undefined
              ? "Or pick the span to compare against — last Ramadan, last year's sale."
              : "Now pick the day it ends."}
          </p>
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={new Date(`${comparison.from}T12:00:00`)}
            selected={draft}
            onSelect={(next: DateRange | undefined) => {
              if (next?.from === undefined) {
                setDraft(undefined)
                return
              }
              // Counted in clicks, not in whether both ends are filled in.
              // react-day-picker answers the FIRST click with from and to both
              // set to that day, so "commit once the range is complete" commits
              // a one-day span the moment you name its start — and closes
              // before the end can be picked. A genuine one-day comparison is
              // legitimate, so the guard cannot be "reject from === to"; it has
              // to be "this is only the first click".
              const anchored = draft?.from !== undefined
              setDraft(next)
              if (!anchored) {
                return
              }
              onChange({
                mode: "custom",
                from: isoDate(next.from),
                to: isoDate(next.to ?? next.from),
              })
              setDraft(undefined)
              setOpen(false)
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Shortcut({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean
  onClick: () => void
  label: string
  hint: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={cn(
        "cursor-pointer rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
        active ? "bg-muted font-medium" : "hover:bg-muted/60",
      )}
    >
      {label}
    </button>
  )
}
