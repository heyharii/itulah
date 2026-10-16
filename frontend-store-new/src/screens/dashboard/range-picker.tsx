import { Popover } from "@base-ui/react/popover"
import { CalendarDays, Check, ChevronDown } from "lucide-react"
import { useState } from "react"

import { DockPortal } from "@/components/shell/dock"
import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { Field, Input } from "@/components/ui/field"
import { SHEET_ROW } from "@/components/ui/list-chrome"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { useLayout } from "@/lib/layout"
import { PANEL } from "@/lib/popup-chrome"
import { isoDay } from "@/lib/queries"
import type { Span } from "@/lib/queries/dashboard"
import { cn } from "@/lib/utils"
import { PRESETS, type Choice } from "@/screens/dashboard/range"
import { spanWords } from "@/screens/money/format"

/// The dashboard's one filter: which days everything below it is about.
///
/// Presets first, because nobody fights a calendar for "last 30 days"; the two
/// dates behind them, with Apply, for the span that has no name. On a desk it
/// is a panel off the button at the top right of the page, presets down its
/// left and the dates beside them. On a phone nothing sits at the top: the
/// button is the dock's, and the same panel rises from the bottom as a sheet,
/// the dates under the presets.
export function RangePicker({
  choice,
  span,
  onChange,
}: {
  choice: Choice
  /// The days the choice stands for now.
  span: Span
  onChange: (next: Choice) => void
}) {
  const phone = useLayout() === "phone"
  const [open, setOpen] = useState(false)
  const label = spanWords(span.from, span.to)

  const panel = (
    <Panel
      choice={choice}
      span={span}
      touch={phone}
      onPick={(next) => {
        onChange(next)
        setOpen(false)
      }}
    />
  )

  if (phone) {
    return (
      <>
        <DockPortal slot="tabs">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-label={`Dates: ${label}`}
            className="inline-flex h-9 max-w-full items-center gap-1 rounded-full bg-soft-2 pr-2.5 pl-3.5 text-[0.875rem] font-medium text-ink transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]"
          >
            <span className="truncate">{label}</span>
            <ChevronDown className="size-4 shrink-0 text-line-ico" />
          </button>
        </DockPortal>
        <BottomSheet open={open} onOpenChange={setOpen} title="Dates">
          <div className="min-h-0 overflow-y-auto overscroll-contain pb-3">
            {panel}
          </div>
        </BottomSheet>
      </>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Dates: ${label}`}
        className={cn(button({ variant: "ghost" }), "gap-2")}
      >
        <CalendarDays />
        <span>{label}</span>
        <ChevronDown />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-50"
        >
          <Popover.Popup className={cn(PANEL, "w-[28.75rem] p-0")}>
            {panel}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/// The presets and the two dates. Mounted when the picker opens and gone when
/// it closes, so the dates always start from the span on screen.
function Panel({
  choice,
  span,
  touch,
  onPick,
}: {
  choice: Choice
  span: Span
  /// A finger: tall rows, and the dates under the presets rather than beside.
  touch: boolean
  onPick: (next: Choice) => void
}) {
  const [from, setFrom] = useState(span.from)
  const [to, setTo] = useState(span.to)
  const today = isoDay(new Date())
  // What is wrong with the dates, in a sentence, or nothing.
  const problem =
    to === "" || from === ""
      ? "Pick both days"
      : to < from
        ? "Ends before it starts"
        : to > today
          ? "After today"
          : null

  return (
    <div className={cn("flex", touch ? "flex-col" : "flex-row")}>
      <div
        role="group"
        aria-label="Spans"
        className={cn(
          touch
            ? "px-2 pb-1"
            : "w-44 shrink-0 border-r border-hairline p-[0.3125rem]",
        )}
      >
        {PRESETS.map((one) => {
          const on = choice.preset === one.id
          return (
            <button
              key={one.id}
              type="button"
              aria-pressed={on}
              onClick={() => onPick({ preset: one.id })}
              className={
                touch
                  ? cn(SHEET_ROW, on && "font-medium text-accent")
                  : cn(
                      "flex h-9 w-full items-center gap-2 rounded-inner px-2.5 text-left text-[0.9375rem] text-ink transition-colors duration-(--t-hover) ease-(--ease-out) hover:bg-soft-2",
                      on && "font-medium",
                    )
              }
            >
              <span className="min-w-0 flex-1 truncate">{one.label}</span>
              <Check
                className={cn(
                  "size-4 shrink-0 stroke-[2.5]",
                  touch && "text-accent",
                  !on && "opacity-0",
                )}
              />
            </button>
          )
        })}
      </div>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-3 p-4 md:[--form-box:2.5rem]",
          touch && "border-t border-hairline",
        )}
      >
        <Field label="From">
          <Input
            type="date"
            value={from}
            max={to === "" ? today : to}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <Field label="To" problem={problem}>
          <Input
            type="date"
            value={to}
            min={from === "" ? undefined : from}
            max={today}
            onChange={(event) => setTo(event.target.value)}
          />
        </Field>
        <Button
          variant="primary"
          size={touch ? "lg" : "default"}
          block
          disabled={problem !== null}
          onClick={() => onPick({ preset: "custom", span: { from, to } })}
        >
          Apply
        </Button>
      </div>
    </div>
  )
}
