import { cn } from "@/lib/utils"

/// The segmented control: switch which slice of one dataset is shown.
///
/// Distinct from `<SubTabs>`, and the distinction is load-bearing. A segment
/// filters one dataset (Payables / Receivables); a sub-tab switches to a
/// different dataset. Using the wrong one tells the reader the wrong thing
/// about what changed.
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
    <div
      role="group"
      className={cn("inline-flex rounded-inner bg-soft-2 p-0.5", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-[1.75rem] rounded-[0.375rem] px-2.5 text-meta font-medium transition-colors",
            option.value === value
              ? "bg-canvas text-ink shadow-soft"
              : "text-body hover:text-ink"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
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
        "[&>button]:h-8 [&>button]:px-3 [&>button]:text-[0.78125rem] [&>button]:font-medium [&>button]:text-text",
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
