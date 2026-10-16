import { cn } from "@/lib/utils"

/// The reading pieces of a Money sheet: a box of label-and-figure rows, and the
/// strip of figures a form leads with.
///
/// A record's facts are read, not edited — label on the left, the figure on the
/// right, a sum in heavier ink — so none of this is an input.

/// A bordered box of rows, optionally under a band that names it.
export function FactBox({
  title,
  aside,
  className,
  children,
}: {
  title?: React.ReactNode
  /// Beside the band's title: a count, a sum.
  aside?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-card border border-hairline bg-canvas",
        className,
      )}
    >
      {title !== undefined && (
        <div className="flex items-baseline justify-between gap-3 border-b border-hairline bg-soft px-4 py-2 text-meta font-medium text-body">
          <span>{title}</span>
          {aside !== undefined && <span className="tabular-nums">{aside}</span>}
        </div>
      )}
      {children}
    </div>
  )
}

/// One row: what it is (with a quieter line under it), and its figure.
///
/// `sum` sets a subtotal in ink; `big` is the figure the box exists for.
export function FactRow({
  label,
  sub,
  sum = false,
  big = false,
  tone,
  onClick,
  children,
}: {
  label: React.ReactNode
  sub?: React.ReactNode
  sum?: boolean
  big?: boolean
  /// A class for the figure's colour: a difference's.
  tone?: string
  onClick?: () => void
  children?: React.ReactNode
}) {
  const body = (
    <>
      <span className="min-w-0">
        <span
          className={cn(
            "block text-[0.9375rem]",
            sum || big ? "font-semibold text-ink" : "text-text",
          )}
        >
          {label}
        </span>
        {sub !== undefined && sub !== null && sub !== "" && (
          <span className="block text-meta text-mute">{sub}</span>
        )}
      </span>
      <span
        className={cn(
          "shrink-0 text-right tabular-nums",
          big
            ? "text-[1.125rem] font-semibold tracking-[-0.01em]"
            : sum
              ? "text-[0.9375rem] font-semibold"
              : "text-[0.9375rem] font-medium",
          tone ?? "text-ink",
        )}
      >
        {children}
      </span>
    </>
  )
  const row = cn(
    "flex min-h-[3.25rem] w-full items-center justify-between gap-4 border-t border-hairline px-4 py-2 first:border-t-0",
    (sum || big) && "bg-soft",
  )
  if (onClick === undefined) return <div className={row}>{body}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        row,
        "text-left transition-colors duration-(--t-hover) hover:bg-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:bg-soft",
      )}
    >
      {body}
    </button>
  )
}

/// Figures in a row, each a name over its number: what a form leads with so
/// the person filling it can see what it is about.
export function FigureStrip({
  items,
  className,
}: {
  items: readonly {
    readonly label: React.ReactNode
    readonly value: React.ReactNode
    readonly tone?: string
  }[]
  className?: string
}) {
  return (
    <dl
      className={cn("flex flex-wrap gap-x-9 gap-y-3 tabular-nums", className)}
    >
      {items.map((item, index) => (
        <div key={index} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-meta text-mute">{item.label}</dt>
          <dd
            className={cn(
              "text-[1.125rem] font-semibold tracking-[-0.01em]",
              item.tone ?? "text-ink",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
