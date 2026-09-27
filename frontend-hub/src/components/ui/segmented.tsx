import { Toggle } from "@base-ui/react/toggle"
import { ToggleGroup } from "@base-ui/react/toggle-group"

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
      // phone, and it pushed the whole page sideways. It scrolls inside its
      // own pill instead, its scrollbar hidden — the pills past the edge are
      // the cue that there are more.
      className={cn(
        "inline-flex max-w-full [scrollbar-width:none] overflow-x-auto rounded-inner bg-soft-2 p-0.5 [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          className={cn(
            "h-[1.75rem] shrink-0 rounded-[0.375rem] px-2.5 text-meta font-medium whitespace-nowrap transition-colors",
            "pointer-coarse:h-9 pointer-coarse:px-3",
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
        "[&>button]:h-8 [&>button]:px-3 [&>button]:text-[0.875rem] [&>button]:font-medium [&>button]:text-text",
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
export function Toolbar({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mb-3.5 flex flex-wrap items-center gap-[0.4375rem]",
        className
      )}
      {...props}
    />
  )
}

Toolbar.Spacer = function ToolbarSpacer() {
  return <div className="flex-1" />
}
