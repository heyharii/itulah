import { cn } from "@/lib/utils"

/// The stat strip a screen opens with — the hub's
/// (`frontend-hub/src/components/ui/kpi.tsx`), copied.
///
/// A strip belongs above a list of things needing a person, not instead of one.
/// A row of figures, never bars (owner, 2026-10-04): the number is what is
/// read.
///
/// On a phone the figures are ONE card, two to a row, hairlines between —
/// nothing to swipe sideways, and half the height of a card per figure. An odd
/// last figure takes the whole row. The cell resets below use `!` on purpose:
/// each `<Kpi>` carries its own rounded, bordered, shadowed card, and without
/// the important modifier the card's own utilities win over the strip's reset.
export function KpiStrip({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // `group/kpis`: a card with no delta line reserves one while any card
        // in the strip has a delta, so every figure in the row stands on the
        // same line — see `Kpi`.
        "group/kpis mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6",
        "max-md:gap-px max-md:overflow-hidden max-md:rounded-card max-md:border max-md:border-hairline max-md:bg-hairline max-md:shadow-soft max-md:[&_.kpi-card]:rounded-none! max-md:[&_.kpi-card]:border-0! max-md:[&_.kpi-card]:shadow-none! max-md:[&>*:last-child:nth-child(odd)]:col-span-2",
        className,
      )}
      {...props}
    />
  )
}

/// One figure: its name over the number, and an optional delta line under it.
export function Kpi({
  label,
  value,
  delta,
  tone,
}: {
  label: React.ReactNode
  value: React.ReactNode
  delta?: React.ReactNode
  tone?: "up" | "down" | "flat"
}) {
  return (
    // Full height, with the figure pushed to the BOTTOM rather than sitting
    // 7px under its label. A strip is read across: one two-line label among
    // three one-line ones used to drop that card's number half a line below
    // the rest of the row, which reads as four unrelated boxes instead of one
    // strip.
    <div className="kpi-card flex h-full flex-col rounded-card border border-hairline bg-canvas px-4 py-2.5 shadow-soft">
      <div className="text-eyebrow font-medium text-body">{label}</div>
      <div className="mt-auto pt-1.5 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
        {value}
      </div>
      {delta ? (
        <div
          data-kpi-delta
          className={cn(
            "mt-1.5 inline-flex items-center gap-0.5 text-[0.875rem] font-semibold",
            tone === "up" && "text-ok",
            tone === "down" && "text-bad",
            (tone === "flat" || !tone) && "text-mute",
          )}
        >
          {delta}
        </div>
      ) : (
        // An empty line where a delta would be, shown only when a sibling in
        // the strip has one: pushing the figure to the bottom kept a two-line
        // label from dropping it; this keeps a sibling's delta from lifting it.
        <div
          aria-hidden
          className="mt-1.5 hidden text-[0.875rem] group-has-[[data-kpi-delta]]/kpis:block"
        >
          &nbsp;
        </div>
      )}
    </div>
  )
}

/// The strip on a phone, as one short row: every figure in one card — figure
/// over its name — instead of cards the width of a thumb to swipe through.
/// From 48rem up it is not drawn: `KpiStrip` is.
///
/// Four fit across 320px; a fifth wraps the row to three and two. A money
/// figure takes a wider cell, `short` is the name where the full one does not
/// fit its cell (14px, so seven characters at 320px), and `compact` the
/// figure where it does not either ("Rp 4,0 bn").
export interface KpiRowItem {
  readonly label: string
  readonly short?: string
  readonly value: string
  readonly compact?: string
  readonly note?: string
  /// Drawn red while it is more than nothing — a figure that is a problem.
  readonly late?: boolean
  readonly wide?: boolean
}

export function KpiRow({
  items,
  className,
}: {
  items: readonly KpiRowItem[]
  className?: string
}) {
  const wrap = items.length > 4
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft md:hidden",
        className,
      )}
    >
      {items.map((item, index) => {
        const nothing = item.value === "0" || item.value === "—"
        return (
          <div
            key={item.label}
            title={item.note}
            // Equal cells; a wrapped second row starts with a rule over it.
            style={wrap ? { flex: "1 1 33%" } : { flex: item.wide ? 1.6 : 1 }}
            className={cn(
              "min-w-0 px-0.5 pt-[0.6875rem] pb-2.5 text-center",
              index > 0 && "border-l border-hairline",
              wrap && index >= 3 && "border-t",
              wrap && index === 3 && "border-l-0",
            )}
          >
            <div
              className={cn(
                "truncate text-[1rem] leading-none font-semibold tracking-[-0.02em] tabular-nums",
                nothing ? "font-medium text-mute" : "text-ink",
                item.late === true && !nothing && "text-bad-fg",
              )}
            >
              {item.compact ?? item.value}
            </div>
            <div className="mt-1 truncate text-[0.875rem] font-medium text-body">
              {item.short ?? item.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}
