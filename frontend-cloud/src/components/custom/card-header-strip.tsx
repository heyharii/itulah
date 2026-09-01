import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

/// The `{soft}` band a data card opens with.
///
/// A card needs to name itself, and the two obvious ways of doing that are
/// both wrong here: a bare `h2` above the card leaves the title floating on
/// the well with nothing tying it to the rows, and a bordered header row
/// stacks a second rule on top of the table's own first hairline. The band
/// solves both by changing surface instead of drawing a line — the strip is
/// `{soft}`, the body stays white, and the step between them is the divider.
///
/// It must sit as the first child of a card with `overflow-hidden` (which is
/// what `ScreenCard` gives you); the card's radius is then what rounds the
/// band's top corners, so this component never restates a radius of its own.
export function CardHeaderStrip({
  title,
  meta,
  children,
  className,
}: {
  title: React.ReactNode
  /// The qualifying line — a count, a period, a scope. `{mute}`, because it
  /// is context for the title rather than a second title.
  meta?: React.ReactNode
  /// Trailing controls: a cross-link, a status pill, a `Segmented`.
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-[0.625rem]",
        "bg-[var(--os-soft,#f7f7f8)] px-4 pt-[0.875rem] pb-[0.6875rem]",
        className,
      )}
    >
      <h3 className="min-w-0 truncate text-[0.875rem] font-semibold tracking-[-0.01em] text-[var(--os-ink,#1d1d1f)]">
        {title}
      </h3>
      {meta !== undefined && (
        <span className="min-w-0 truncate text-[0.75rem] font-normal text-[var(--os-mute,#a6a6ad)]">
          {meta}
        </span>
      )}
      {children !== undefined && (
        <div className="ml-auto flex shrink-0 items-center gap-[0.4375rem]">
          {children}
        </div>
      )}
    </div>
  )
}

/// The "go to the fuller version of this" link that sits at the end of a
/// header strip.
///
/// It is text with a chevron rather than a button because it navigates rather
/// than acts — and because a screen is allowed exactly one black CTA, which a
/// cross-link is never spending.
export function CardHeaderLink({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-[0.1875rem] whitespace-nowrap",
        "text-[0.75rem] font-medium text-[var(--os-body,#74747b)]",
        "transition-colors hover:text-[var(--os-ink,#1d1d1f)]",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden className="size-[0.75rem]" />
    </button>
  )
}
