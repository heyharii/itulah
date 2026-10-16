import { ChevronLeft, ChevronRight } from "lucide-react"

import { DockPortal } from "@/components/shell/dock"
import { dateText } from "@/lib/format"
import { readMonth } from "@/lib/queries/hr"
import { cn } from "@/lib/utils"

/// Which payroll month is showing — the prototype's stepper, `‹ October 2026 ›`.
///
/// One control in two places, the same on every device: on a desk it sits in
/// the bar over the cards; on a phone it is the dock's (`DockMonth`), where the
/// thumb is, and it stretches across the row the way the dock's search field
/// does. A step is instant — a month changed with the arrows is changed a dozen
/// times in a row, and an animation would make each one wait.
export function MonthStepper({
  months,
  value,
  onChange,
}: {
  /// Oldest first.
  months: readonly string[]
  value: string
  onChange: (month: string) => void
}) {
  const { before, after } = neighbours(months, value)
  return (
    <div
      role="group"
      aria-label="Month"
      className="inline-flex h-9 items-stretch overflow-hidden rounded-[0.625rem] border border-hairline-2 bg-canvas pointer-coarse:h-11"
    >
      <Step
        label="Previous month"
        disabled={before === undefined}
        onClick={() => before !== undefined && onChange(before)}
      >
        <ChevronLeft className="size-4" />
      </Step>
      <span className="flex items-center border-x border-hairline px-2.5 text-[0.875rem] font-medium whitespace-nowrap text-ink tabular-nums">
        {readMonth(value)}
      </span>
      <Step
        label="Next month"
        disabled={after === undefined}
        onClick={() => after !== undefined && onChange(after)}
      >
        <ChevronRight className="size-4" />
      </Step>
    </div>
  )
}

/// The same stepper in the phone's dock. `dock-field` is the dock's own hook
/// for "this one takes the room that is left" (`shell/bottom-bar.tsx`).
export function DockMonth({
  months,
  value,
  onChange,
}: {
  months: readonly string[]
  value: string
  onChange: (month: string) => void
}) {
  const { before, after } = neighbours(months, value)
  const round =
    "grid size-9 shrink-0 place-items-center rounded-full text-body transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.92] disabled:text-faint disabled:active:scale-100"
  return (
    <DockPortal slot="search">
      <div
        role="group"
        aria-label="Month"
        className="dock-field flex h-9 min-w-0 items-center rounded-full bg-soft-2"
      >
        <button
          type="button"
          aria-label="Previous month"
          disabled={before === undefined}
          onClick={() => before !== undefined && onChange(before)}
          className={round}
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-[0.875rem] font-medium text-ink tabular-nums">
          {shortMonth(value)}
        </span>
        <button
          type="button"
          aria-label="Next month"
          disabled={after === undefined}
          onClick={() => after !== undefined && onChange(after)}
          className={round}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </DockPortal>
  )
}

function Step({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid w-9 place-items-center text-body transition-colors duration-(--t-hover) pointer-coarse:w-11",
        "hover:bg-soft disabled:text-faint disabled:hover:bg-transparent",
      )}
    >
      {children}
    </button>
  )
}

function neighbours(
  months: readonly string[],
  value: string,
): { before: string | undefined; after: string | undefined } {
  const at = months.indexOf(value)
  return {
    before: at > 0 ? months[at - 1] : undefined,
    after: at >= 0 && at < months.length - 1 ? months[at + 1] : undefined,
  }
}

/// `2026-10` → `Oct 2026`: the dock shares its row with a button.
function shortMonth(period: string): string {
  const parsed = new Date(`${period}-01T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return period
  return dateText(parsed, { month: "short", year: "numeric" })
}
