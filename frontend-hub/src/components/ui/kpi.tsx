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
        "group/kpis mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6",
        // On a phone the figures are one row to swipe, not three rows that push
        // the list below the fold: show the common path first.
        "max-md:-mx-4 max-md:flex max-md:snap-x max-md:snap-mandatory max-md:scroll-px-4 max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none] max-md:[&>*]:w-40 max-md:[&>*]:shrink-0 max-md:[&>*]:snap-start",
        className
      )}
      {...props}
    />
  )
}

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
    // strip — and a long label is not something the caller can always shorten.
    <div className="flex h-full flex-col rounded-card border border-hairline bg-canvas px-4 py-2.5 shadow-soft">
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
          className="mt-1.5 hidden text-[0.875rem] group-has-[[data-kpi-delta]]/kpis:block"
        >
          &nbsp;
        </div>
      )}
    </div>
  )
}
