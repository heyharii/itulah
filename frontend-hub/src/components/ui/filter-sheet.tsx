import { Check, SlidersHorizontal } from "lucide-react"
import { useState } from "react"

import { DockPortal, useDock } from "@/components/shell/dock"
import { SHEET_ROW } from "@/components/ui/list-chrome"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/// What a list can be narrowed by, as a phone asks it: one sheet from the dock's
/// ⚙. For the screens whose desk toolbar is a row of chips and menus rather than
/// a filter model — the same controls, set down in a sheet instead of across the
/// top of the page (owner, 2026-10-06).
///
/// Say the questions as `groups` — a group of rows per question, one answer per
/// group — and/or hand it the controls themselves as `children` (a checkbox, a
/// date, a select), stacked. The desk keeps its own toolbar and never draws this.
export interface FilterGroup {
  readonly key: string
  /// The question: "Condition", "Location".
  readonly label: string
  /// The chosen value; null is the first option's "any".
  readonly value: string | null
  readonly options: readonly {
    readonly value: string | null
    readonly label: string
    readonly count?: number
  }[]
  readonly onChange: (value: string | null) => void
}

export function FilterSheet({
  open,
  onOpenChange,
  title = "Filters",
  groups,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  groups?: readonly FilterGroup[]
  /// Controls of the screen's own, stacked under the groups.
  children?: React.ReactNode
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      action={
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="h-tap shrink-0 rounded-inner px-3 text-[0.9375rem] font-semibold text-accent active:opacity-60"
        >
          Done
        </button>
      }
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain pb-3">
        {groups?.map((group) => (
          <section key={group.key} className="px-2 pb-2">
            <h3 className="px-3 pt-3 pb-1 text-[0.875rem] font-medium text-mute">
              {group.label}
            </h3>
            {group.options.map((option) => {
              const on = option.value === group.value
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => group.onChange(option.value)}
                  className={cn(SHEET_ROW, on && "font-medium text-accent")}
                >
                  <span className="flex-1">{option.label}</span>
                  {option.count !== undefined && (
                    <span className="text-body tabular-nums">
                      {count(option.count)}
                    </span>
                  )}
                  <Check
                    className={cn("size-4 shrink-0", on ? "" : "opacity-0")}
                  />
                </button>
              )
            })}
          </section>
        ))}
        {children !== undefined && (
          <div className="flex flex-col gap-3 px-4 pb-1 [&>*]:max-w-full [&>*:is(select,input,button)]:w-full">
            {children}
          </div>
        )}
      </div>
    </BottomSheet>
  )
}

/// The controls that say WHAT a screen is reading — a moment, a pool, a unit —
/// as one chip in the dock and the `FilterSheet` that holds them on a phone. For
/// a screen whose search, filter and sort already hold the dock (`DockTools`),
/// so the toolbar's own "Filters" chip cannot stand in for them. The desk keeps
/// its toolbar and never draws this.
export function DockSettings({
  label,
  title,
  compact = false,
  children,
}: {
  /// One short word on the chip: "Replay".
  label: string
  title: string
  /// Only the icon, for a dock row that is already full of other chips.
  compact?: boolean
  children: React.ReactNode
}) {
  const dock = useDock()
  const [open, setOpen] = useState(false)
  return (
    <>
      <DockPortal slot="tabs">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={compact ? label : undefined}
          title={compact ? label : undefined}
          className={cn(
            "inline-flex h-9 max-w-full items-center gap-1.5 rounded-full bg-soft-2 text-[0.875rem] font-medium text-ink transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]",
            compact ? "w-9 justify-center" : "pr-3.5 pl-3"
          )}
        >
          <SlidersHorizontal className="size-4 shrink-0 text-line-ico" />
          {!compact && label}
        </button>
      </DockPortal>
      {dock?.available === true && (
        <FilterSheet open={open} onOpenChange={setOpen} title={title}>
          {children}
        </FilterSheet>
      )}
    </>
  )
}
