import { FlowText } from "@/components/ui/flow-text"
import { cn } from "@/lib/utils"

/// The stat strip an overview opens with.
///
/// DESIGN.md is blunt that an Overview leads with exceptions rather than vanity
/// KPIs — so a strip belongs above a list of things needing a person, not
/// instead of one.
export function KpiStrip({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // `group/kpis`: a card with no delta line reserves one while any
        // card in the strip has a delta, so every figure in the row stands
        // on the same line — see `Kpi`.
        "kpi-strip group/kpis mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6",
        // On a phone the figures are ONE card, two to a row, hairlines between:
        // nothing to swipe sideways (owner, 2026-10-06 — a row that scrolls
        // hides its third figure behind the edge), and half the height of a
        // card per figure. An odd last figure takes the whole row.
        "max-md:gap-px max-md:overflow-hidden max-md:rounded-card max-md:border max-md:border-hairline max-md:bg-hairline max-md:shadow-soft max-md:[&_.kpi-card]:rounded-none! max-md:[&_.kpi-card]:border-0! max-md:[&_.kpi-card]:shadow-none! max-md:[&>*:last-child:nth-child(odd)]:col-span-2",
        className
      )}
      {...props}
    />
  )
}

export function Kpi({
  label,
  value,
  title,
  delta,
  tone,
  onClick,
}: {
  label: React.ReactNode
  value: React.ReactNode
  /// The exact figure behind a compact one ("Rp 589.200.000" under
  /// "Rp 589,2 M"), shown on hover.
  title?: string
  delta?: React.ReactNode
  tone?: "up" | "down" | "flat"
  /// A figure that is also its list's filter: pressing it applies the filter
  /// ("Due for renewal" turns the bar's switch on). The figure stays a figure:
  /// no underline, no colour; its label darkens under the pointer.
  onClick?: () => void
}) {
  const Card = onClick === undefined ? "div" : "button"
  return (
    // Full height, with the figure pushed to the BOTTOM rather than sitting
    // 7px under its label. A strip is read across: one two-line label among
    // three one-line ones used to drop that card's number half a line below
    // the rest of the row, which reads as four unrelated boxes instead of one
    // strip — and a long label is not something the caller can always shorten.
    <Card
      type={onClick === undefined ? undefined : "button"}
      onClick={onClick}
      className={cn(
        "kpi-card flex h-full flex-col rounded-card border border-hairline bg-canvas px-4 py-2.5 shadow-soft",
        onClick !== undefined &&
          "group/kpi cursor-pointer text-left transition-transform duration-(--t-press) ease-(--ease-out) active:scale-[0.97]"
      )}
    >
      <div
        className={cn(
          "kpi-label text-eyebrow font-medium text-body",
          onClick !== undefined &&
            "transition-colors pointer-fine:group-hover/kpi:text-ink!"
        )}
      >
        {label}
      </div>
      <div
        title={title}
        className="kpi-value mt-auto pt-1.5 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums"
      >
        {/* A written figure rolls to its next value (FlowText); anything
            else a screen draws is shown as it is. */}
        {typeof value === "string" || typeof value === "number" ? (
          <FlowText text={String(value)} />
        ) : (
          value
        )}
      </div>
      {delta ? (
        <div
          data-kpi-delta
          className={cn(
            "mt-1.5 inline-flex items-center gap-0.5 text-[0.9375rem] font-semibold",
            tone === "up" && "text-ok",
            tone === "down" && "text-bad",
            (tone === "flat" || !tone) && "text-mute"
          )}
        >
          {delta}
        </div>
      ) : (
        // An empty line where a delta would be, shown only when a sibling in
        // the strip has one. Pushing the figure to the bottom kept a two-line
        // label from dropping it; this keeps a sibling's delta from lifting
        // it: "Loose cartons 0 · sealed, unclaimed" beside "Surat jalan 0"
        // put the two zeros a line apart.
        <div
          aria-hidden
          className="mt-1.5 hidden text-[0.9375rem] group-has-[[data-kpi-delta]]/kpis:block"
        >
          &nbsp;
        </div>
      )}
    </Card>
  )
}

/// The strip on a phone: every figure in one card, in one short row — figure
/// over its name — instead of cards the width of a thumb to swipe through
/// (owner, 2026-10-06). From 48rem up it is not drawn: `KpiStrip` is.
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
        "kpi-row mb-4 flex flex-wrap overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft md:hidden",
        className
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
              "kpi-row-cell min-w-0 px-0.5 pt-[0.6875rem] pb-2.5 text-center",
              index > 0 && "border-l border-hairline",
              wrap && index >= 3 && "border-t",
              wrap && index === 3 && "border-l-0"
            )}
          >
            <div
              className={cn(
                "truncate text-[1rem] leading-none font-semibold tracking-[-0.02em] tabular-nums",
                nothing ? "font-medium text-mute" : "text-ink",
                item.late === true && !nothing && "text-bad-fg"
              )}
            >
              {item.compact ?? item.value}
            </div>
            <div className="mt-1 truncate text-[0.9375rem] font-medium text-body">
              {item.short ?? item.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/// One figure of a `KpiBox`.
export interface KpiBoxItem {
  readonly label: string
  readonly value: React.ReactNode
  readonly note?: string
}

/// The figures of a list as ONE box, a cell each with a rule between, standing
/// at the right of the title (`ListHead`) — not a card apiece in a row of their
/// own over the list (owner, 2026-10-10: the table comes up by about 110px).
/// Under 1024px it takes the full width, cells equal, under the title.
export function KpiBox({
  items,
  className,
}: {
  items: readonly KpiBoxItem[]
  className?: string
}) {
  return (
    <div
      className={cn(
        "kpi-box flex w-full min-w-0 overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft lg:w-auto",
        className
      )}
    >
      {items.map((item, index) => (
        <div
          key={item.label}
          title={item.note}
          className={cn(
            "kpi-box-cell min-w-0 flex-1 px-4 py-2 lg:flex-none lg:px-5",
            index > 0 && "border-l border-hairline"
          )}
        >
          <div className="truncate text-[0.9375rem] text-body">
            {item.label}
          </div>
          <div className="text-[1.125rem] leading-6 font-semibold tracking-[-0.02em] whitespace-nowrap text-ink tabular-nums">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  )
}
