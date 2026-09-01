import { cn } from "@/lib/utils"

/// The row of counted facts that opens a workbench.
///
/// The strip exists so a screen can stop saying its own numbers in prose. A
/// subtitle reading "7 open POs · 4 awaiting receipt · 2 partial" is three
/// facts the eye has to parse as a sentence; the same three in this grid are
/// three things it can compare at a glance and click through.
///
/// Four across is the default because that is the width at which a value
/// still reads as a headline rather than a table cell; the strip collapses to
/// two on a phone rather than shrinking the type.
const COLUMNS: Record<number, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-3 xl:grid-cols-5",
  6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
}

export function KpiStrip({
  columns = 4,
  className,
  children,
}: {
  columns?: 2 | 3 | 4 | 5 | 6
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "mb-[1.125rem] grid gap-3",
        COLUMNS[columns] ?? COLUMNS[4],
        className,
      )}
    >
      {children}
    </div>
  )
}

/// The delta's three readings. `flat` is here so a metric that has not moved
/// can say so in `{mute}` instead of borrowing green for "no change" — green
/// in this language means good, not merely different.
export type KpiTrend = "up" | "down" | "flat"

const TREND: Record<KpiTrend, string> = {
  up: "text-[var(--os-ok,#36b827)]",
  down: "text-[var(--os-bad,#d05151)]",
  flat: "text-[var(--os-mute,#a6a6ad)]",
}

/// One counted fact.
///
/// The label is the one place in this system where uppercase is correct: a KPI
/// eyebrow is a legend for the number under it, not a section heading, and at
/// 10px/600 it reads as a caption rather than a shout. Section labels
/// elsewhere stay sentence-case in `{mute}` — the two are easy to confuse and
/// swapping them is what makes an interface look like a spreadsheet.
///
/// The card carries no fill on purpose. A KPI is a frame around a number, not
/// a surface; giving it a white body would make six of them read as six cards
/// competing with the real card below.
export function Kpi({
  label,
  value,
  delta,
  trend = "flat",
  className,
  onClick,
}: {
  label: React.ReactNode
  value: React.ReactNode
  /// The second line: a movement ("▲ 6.1%") or a qualifying count
  /// ("2 overdue"). Both are said in the same slot because both answer the
  /// same question — is this number a problem?
  delta?: React.ReactNode
  trend?: KpiTrend
  className?: string
  onClick?: () => void
}) {
  const Tag = onClick ? "button" : "div"
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "rounded-[var(--os-r-card,1rem)] border border-[var(--os-hairline,#ececef)]",
        "bg-transparent px-[0.875rem] py-[0.8125rem] text-left",
        "shadow-[var(--os-shadow-soft,0_1px_2px_rgba(20,20,25,.03))]",
        onClick && "transition-colors hover:bg-[var(--os-soft,#f7f7f8)]",
        className,
      )}
    >
      <div className="truncate text-[0.625rem] font-semibold tracking-[0.04em] uppercase text-[var(--os-mute,#a6a6ad)]">
        {label}
      </div>
      <div className="mt-[0.4375rem] text-[1.4375rem] leading-[1.05] font-semibold tracking-[-0.02em] tabular-nums text-[var(--os-ink,#1d1d1f)]">
        {value}
      </div>
      {delta !== undefined && (
        <div
          className={cn(
            "mt-[0.375rem] inline-flex items-center gap-[0.1875rem]",
            "text-[0.71875rem] font-semibold tabular-nums",
            TREND[trend],
          )}
        >
          {delta}
        </div>
      )}
    </Tag>
  )
}
