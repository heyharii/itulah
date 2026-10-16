import { ChevronLeft, ChevronRight } from "lucide-react"

import { DockPortal } from "@/components/shell/dock"
import { useLayout } from "@/lib/layout"
import { isoDay } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { dayTitle, dayYear } from "@/screens/money/format"

/// The day a Money screen is reading, with a step either side.
///
/// On a desk it stands in the page header; on a phone it is the dock's, where
/// the thumb is. One control, the same on both: it can go back as far as there
/// is a day to read and never past today.
export function DayControl({
  day,
  onChange,
}: {
  day: string
  onChange: (next: string) => void
}) {
  const phone = useLayout() === "phone"
  const today = isoDay(new Date())

  const move = (by: number) => {
    const next = new Date(`${day}T00:00:00`)
    next.setDate(next.getDate() + by)
    onChange(isoDay(next))
  }
  const step = cn(
    "grid h-full w-9 place-items-center text-body transition-colors duration-(--t-hover) disabled:text-faint pointer-coarse:w-11",
    "enabled:hover:bg-soft-2 active:enabled:bg-soft-2",
  )

  const control = (
    <div
      role="group"
      aria-label="Day"
      className="inline-flex h-9 items-center overflow-hidden rounded-inner border border-hairline-2 bg-canvas shadow-soft pointer-coarse:h-11"
    >
      <button
        type="button"
        aria-label="Previous day"
        onClick={() => move(-1)}
        className={step}
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="flex h-full items-center border-x border-hairline px-3 text-control font-medium whitespace-nowrap text-ink tabular-nums">
        {day === today ? "Today" : phone ? dayYear(day) : dayTitle(day)}
      </span>
      <button
        type="button"
        aria-label="Next day"
        disabled={day >= today}
        onClick={() => move(1)}
        className={step}
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
  return phone ? <DockPortal slot="tabs">{control}</DockPortal> : control
}
