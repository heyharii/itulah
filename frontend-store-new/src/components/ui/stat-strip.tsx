import { cn } from "@/lib/utils"

/// The stat strip a People screen opens with — the hub's `KpiStrip`
/// (`frontend-hub/src/components/ui/kpi.tsx`), and the prototype's `sum()`.
///
/// Not the icon-tile `KpiGrid` in `kpi.tsx`: that one is the counter's, where a
/// coloured squircle is how a number is found at arm's length. A People screen
/// is read at a desk, and the prototype draws its figures as a quiet row of
/// label-over-value cards — the number is what is read, and a glyph beside it
/// would be one more thing to look past.
///
/// Two across on a phone, three on a tablet, as many as there are on a desk.
export function StatStrip({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:auto-cols-fr xl:grid-flow-col xl:grid-cols-none",
        className,
      )}
      {...props}
    />
  )
}

/// One figure in the strip.
///
/// `tone` colours the VALUE, and only for the prototype's three cases: `warn`
/// for something waiting on somebody, `bad` for something wrong, `ok` for a
/// state that is settled. A count that is simply a count stays ink — a strip
/// where every number is coloured is a strip where none of them means
/// anything.
export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: React.ReactNode
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: "ok" | "warn" | "bad"
}) {
  return (
    // Full height with the figure pushed to the bottom, as the hub does it: a
    // two-line label among one-line ones must not drop its number half a line
    // below the rest of the row.
    <div className="flex h-full min-w-0 flex-col rounded-card border border-hairline bg-canvas px-4 py-[0.8125rem] shadow-soft">
      <div className="text-eyebrow font-medium text-body">{label}</div>
      <div
        className={cn(
          "mt-auto truncate pt-[0.4375rem] text-[1.125rem] leading-none font-semibold tracking-[-0.02em] tabular-nums",
          tone === "ok" && "text-ok-fg",
          tone === "warn" && "text-warn-fg",
          tone === "bad" && "text-bad-fg",
          tone === undefined && "text-ink",
        )}
      >
        {value}
      </div>
      {sub !== undefined && (
        <div className="mt-1.5 truncate text-meta text-mute tabular-nums">
          {sub}
        </div>
      )}
    </div>
  )
}
