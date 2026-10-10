import { Toggle } from "@base-ui/react/toggle"
import { ToggleGroup } from "@base-ui/react/toggle-group"
import { ListFilter } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"

import { DockPortal, useDock } from "@/components/shell/dock"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { cn } from "@/lib/utils"

/// The segmented control: switch which slice of one dataset is shown.
///
/// Distinct from `<SubTabs>`, and the distinction is load-bearing. A segment
/// filters one dataset (Payables / Receivables); a sub-tab switches to a
/// different dataset. Using the wrong one tells the reader the wrong thing
/// about what changed.
///
/// Base UI's toggle group draws it: one tab stop, the arrow keys move along
/// the row, and each segment says `aria-pressed`. It is single-select, and a
/// segmented control always has one slice showing — so pressing the segment
/// that is already on, which Base UI reports as "nothing pressed", is ignored
/// rather than passed on as a value the caller has no slice for.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly { readonly value: T; readonly label: React.ReactNode }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0] as T | undefined
        if (picked !== undefined && picked !== value) onChange(picked)
      }}
      // Never wider than what it stands in: a five-way switch is wider than a
      // phone, and it pushed the whole page sideways. On a desk it scrolls
      // inside its own pill, its scrollbar hidden; on a phone it wraps onto a
      // second row instead, because nothing scrolls sideways there (owner,
      // 2026-10-06) — a pill past the edge is a choice nobody sees.
      className={cn(
        "inline-flex max-w-full [scrollbar-width:none] overflow-x-auto rounded-inner bg-soft-2 p-0.5 max-md:flex max-md:flex-wrap max-md:overflow-visible [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          className={cn(
            "h-[1.75rem] shrink-0 rounded-[0.375rem] px-2.5 text-meta font-medium whitespace-nowrap transition-colors max-md:grow",
            // Under a finger: 40 inside the pill's 2px rim is a 44px control,
            // and the pseudo-element makes the whole 44 the target, rim
            // included (D1).
            "pointer-coarse:relative pointer-coarse:h-10 pointer-coarse:px-3 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-0.5 pointer-coarse:after:content-['']",
            option.value === value
              ? "bg-canvas text-ink shadow-soft"
              : "text-body hover:text-ink"
          )}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}

/// A row of buttons fused into one pill — "Day / Week / Month", "Export / Print".
/// Unlike `<Segmented>` these are actions, not a selection, so none of them is
/// ever "on".
export function ButtonGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex overflow-hidden rounded-inner border border-hairline-2",
        "[&>button]:h-8 [&>button]:px-3 [&>button]:text-[0.875rem] [&>button]:font-medium [&>button]:text-text pointer-coarse:[&>button]:h-11",
        "[&>button:hover]:bg-soft-2",
        "[&>button+button]:border-l [&>button+button]:border-hairline",
        className
      )}
      {...props}
    />
  )
}

/// The list toolbar: title-adjacent controls, with `<Toolbar.Spacer />` pushing
/// the rest right.
///
/// On a phone, a toolbar is not a row of controls at the top of the page: it is
/// one "Filters" button in the dock over the bottom bar and the sheet it opens,
/// with the controls stacked in it (owner, 2026-10-06: nothing to search or
/// filter at the top, nothing to scroll sideways, the same pattern on every
/// list). Left alone where it already stands in a sheet or a dialog, and where
/// the screen has a dock of its own (`DockTools` claims the search slot) and
/// hides the controls it has moved there.
export function Toolbar({
  className,
  children,
  inline = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /// Stay in the page on a phone: for a bar that is not a filter and has no
  /// business in the dock.
  inline?: boolean
}) {
  const dock = useDock()
  const probe = useRef<HTMLSpanElement>(null)
  /// Whether this toolbar stands inside a sheet or a dialog, found once it is
  /// in the document: nothing above it says so.
  const [inside, setInside] = useState<boolean | null>(null)
  useLayoutEffect(() => {
    setInside(probe.current?.closest('[role="dialog"]') != null)
  }, [])
  const docked =
    !inline &&
    dock?.available === true &&
    inside === false &&
    dock.claimed.search === 0
  if (docked) return <DockedToolbar>{children}</DockedToolbar>
  return (
    <div
      className={cn(
        "mb-3.5 flex flex-wrap items-center gap-[0.4375rem]",
        className
      )}
      {...props}
    >
      <span ref={probe} hidden aria-hidden />
      {children}
    </div>
  )
}

/// The toolbar as the dock draws it: a button, and a sheet holding the controls.
function DockedToolbar({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <DockPortal slot="tabs">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="inline-flex h-11 max-w-full items-center gap-1.5 rounded-full bg-soft-2 pr-4 pl-3.5 text-[0.875rem] font-medium text-ink transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]"
        >
          <ListFilter className="size-4 shrink-0 text-line-ico" />
          Filters
        </button>
      </DockPortal>
      <BottomSheet open={open} onOpenChange={setOpen} title="Filters">
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4 [&>*]:max-w-full [&>*:is(select,input,button)]:w-full">
          {children}
        </div>
      </BottomSheet>
    </>
  )
}

Toolbar.Spacer = function ToolbarSpacer() {
  return <div className="flex-1 max-md:hidden" />
}
