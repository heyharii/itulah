import { Icon, paths } from "@/components/dashboard/parts"
import { type Supplier } from "@/components/dashboard/data"
import { cn } from "@/lib/utils"

interface TileProps {
  label: string
  icon: React.ReactNode
  value: React.ReactNode
  unit?: string
  delta?: { dir: "up" | "down" | "flat"; text: string }
  pct: number
  bar: string
  onClick?: () => void
  active?: boolean
  title?: string
}

function Tile({
  label,
  icon,
  value,
  unit,
  delta,
  pct,
  bar,
  onClick,
  active,
  title,
}: TileProps) {
  const Wrapper = onClick ? "button" : "div"

  return (
    <Wrapper
      {...(onClick
        ? { type: "button" as const, onClick, "aria-pressed": active, title }
        : {})}
      className={cn(
        "flex min-w-0 flex-col gap-[5px] border-l border-line px-3.5 pt-3 pb-[13px] text-left transition-colors duration-[130ms] first:border-l-0",
        onClick && "hover:bg-hover",
        active && "bg-accent-tint"
      )}
    >
      <span className="flex items-center gap-[5px] text-[11px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
        {icon}
        {label}
      </span>
      <span className="flex items-baseline gap-[7px]">
        <span className="font-mono text-[21px] leading-none font-medium tracking-[-0.02em] text-ink">
          {value}
        </span>
        {unit && (
          <span className="text-[11.5px] font-medium text-ink-4">{unit}</span>
        )}
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-[3px] text-[11.5px] font-semibold",
              delta.dir === "up" && "text-grass",
              delta.dir === "down" && "text-ember",
              delta.dir === "flat" && "text-ink-4"
            )}
          >
            {delta.text}
          </span>
        )}
      </span>
      {/* a hairline bar under the value, carrying the metric's own colour */}
      <span className="h-[3px] overflow-hidden rounded-full bg-line">
        <i
          style={{ width: `${pct}%`, background: bar }}
          className="block h-full rounded-full transition-[width] duration-[420ms] ease-out-strong"
        />
      </span>
    </Wrapper>
  )
}

/**
 * KPIs summarise the rows currently in scope, so they move with the view, the
 * search box and the no-history filter rather than sitting still.  Every
 * metric here comes from the relational supplier list; contact recency and
 * relationship strength are deliberately not presented as live facts.
 */
export function KpiStrip({
  rows,
  noHistoryOnly,
  onToggleNoHistory,
}: {
  rows: Supplier[]
  noHistoryOnly: boolean
  onToggleNoHistory: () => void
}) {
  const total = rows.length
  const active = rows.filter((r) => r.status === "active").length
  const historyKnown = rows.every((r) => r.historyEvents !== undefined)
  const withHistory = historyKnown
    ? rows.filter((r) => (r.historyEvents ?? 0) > 0).length
    : null
  const noHistory = historyKnown ? total - (withHistory ?? 0) : null
  const incomingKnown = rows.every((r) => r.incomingQty !== undefined)
  const incoming = incomingKnown
    ? rows.reduce((sum, row) => sum + (row.incomingQty ?? 0), 0)
    : null

  const smallIcon = (path: React.ReactNode) => (
    <Icon path={path} size={12} width={2} />
  )

  return (
    <div className="grid shrink-0 grid-cols-2 border-b border-line-strong lg:grid-cols-4">
      <Tile
        label="In scope"
        icon={smallIcon(paths.rows)}
        value={total}
        unit="suppliers"
        pct={100}
        bar="var(--ink-4)"
      />
      <Tile
        label="Active"
        icon={smallIcon(paths.healthy)}
        value={active}
        unit="suppliers"
        pct={total ? (active / total) * 100 : 0}
        bar="var(--grass)"
      />
      <Tile
        label="No order history"
        icon={smallIcon(paths.rows)}
        value={noHistory === null ? "—" : noHistory}
        unit={historyKnown ? "suppliers" : "data unavailable"}
        pct={historyKnown && total ? ((noHistory ?? 0) / total) * 100 : 0}
        bar="var(--honey)"
        onClick={historyKnown ? onToggleNoHistory : undefined}
        active={noHistoryOnly}
        title={
          historyKnown
            ? "Filter to suppliers with no purchase-order or receipt history"
            : "Order history is unavailable"
        }
      />
      <Tile
        label="Incoming"
        icon={smallIcon(paths.download)}
        value={incoming === null ? "—" : incoming.toLocaleString("id-ID")}
        unit="units on active POs"
        pct={incoming === null ? 0 : incoming > 0 ? 100 : 0}
        bar="var(--accent)"
      />
    </div>
  )
}
