import { Popover } from "@base-ui/react/popover"
import { ChevronDown } from "lucide-react"
import { useState } from "react"

import { Day } from "@/components/ui/day"
import { POPUP } from "@/lib/filter-chrome"
import { cn } from "@/lib/utils"
import {
  spanDays,
  type Comparison,
  type ComparisonMode,
  type SalesRange,
} from "@itulah/contract/reporting"

/// What the figures are measured against.
///
/// Two shortcuts and a pair of dates, rather than a dropdown of shortcuts
/// alone. The comparison that matters most in this business cannot be derived
/// from the current span: Ramadan moves about eleven days earlier every
/// Gregorian year, so "Ramadan against last Ramadan" is neither the previous
/// thirty days nor the same dates a year ago. It is a span a person names, and
/// nothing but a pair of dates will let them.
///
/// Two `<input type="date">` and not a calendar widget, because that is this
/// app's date control everywhere else — People, Deliveries, the vault. A
/// second date grammar on one screen is a second thing to learn.
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
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

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
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setFrom("")
          setTo("")
        }
      }}
    >
      <Popover.Trigger
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border border-hairline-2 bg-canvas px-3",
          "text-[0.78125rem] text-text transition-colors hover:bg-soft-2"
        )}
      >
        <span className="text-mute">Compare</span>
        <span className="max-w-40 truncate">{comparison.full}</span>
        {uneven && (
          <span
            className="text-warn-fg"
            title={`${there} days against ${here} — the percentages compare spans of different length`}
          >
            {there}d
          </span>
        )}
        <ChevronDown className="size-3.5 text-line-ico" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6}>
          <Popover.Popup className={cn(POPUP, "w-[20rem] p-2")}>
            <Shortcut
              active={comparison.mode === "prev"}
              onClick={() => pick("prev")}
              label="The span before this one"
              hint="Twelve calendar months, not 365 days — so February is read against a February"
            />
            <Shortcut
              active={comparison.mode === "year"}
              onClick={() => pick("year")}
              label="Same dates last year"
              hint="365 days back — right for a calendar month, wrong for a moving feast"
            />
            <div className="mt-2 border-t border-hairline pt-2">
              <p className="px-1 pb-1.5 text-[0.6875rem] text-mute">
                Or name the span — last Ramadan, last year's sale.
              </p>
              <div className="flex items-center gap-1.5">
                <Day
                  label="Compare from"
                  value={from}
                  notAfter={to === "" ? undefined : to}
                  onChange={setFrom}
                  className="h-8 min-w-0 flex-1 px-2.5 text-[0.71875rem]"
                />
                <span className="shrink-0 text-[0.6875rem] text-mute">to</span>
                <Day
                  label="Compare to"
                  value={to}
                  notBefore={from === "" ? undefined : from}
                  onChange={setTo}
                  className="h-8 min-w-0 flex-1 px-2.5 text-[0.71875rem]"
                />
              </div>
              <button
                type="button"
                // Committed on a press rather than on the second date being
                // typed. A date input fires on every keystroke, and "2026-0"
                // is a year nobody asked about — a half-typed span must not
                // reach the server as a question.
                disabled={from === "" || to === ""}
                onClick={() => {
                  onChange({ mode: "custom", from, to })
                  setOpen(false)
                }}
                className="mt-2 h-8 w-full rounded-full bg-ink text-[0.78125rem] font-medium text-white transition-colors hover:bg-black disabled:opacity-40"
              >
                Compare against that
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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
      aria-pressed={active}
      className={cn(
        "block w-full rounded-inner px-2.5 py-1.5 text-left text-[0.78125rem] transition-colors",
        active ? "bg-soft-2 font-medium text-ink" : "text-text hover:bg-soft"
      )}
    >
      {label}
    </button>
  )
}
