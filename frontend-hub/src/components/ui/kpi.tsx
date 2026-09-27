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
        "mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6",
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
    <div className="flex h-full flex-col rounded-card border border-hairline bg-canvas px-4 py-[0.8125rem] shadow-soft">
      <div className="text-eyebrow font-medium text-body">{label}</div>
      <div className="mt-auto pt-[0.4375rem] text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
        {value}
      </div>
      {delta && (
        <div
          className={cn(
            "mt-1.5 inline-flex items-center gap-0.5 text-[0.875rem] font-semibold",
            tone === "up" && "text-ok",
            tone === "down" && "text-bad",
            (tone === "flat" || !tone) && "text-mute"
          )}
        >
          {delta}
        </div>
      )}
    </div>
  )
}
