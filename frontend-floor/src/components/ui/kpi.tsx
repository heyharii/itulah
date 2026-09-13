import { cn } from "@/lib/utils"

/// The KPI icon-tile grid — **2×2 on phones**, which is what DESIGN.md says and
/// what the frames draw.
///
/// The hallmark is the solid coloured squircle with a white glyph above a
/// `{body}` label and a 21/600 tabular value. The squircle takes its fill from
/// the saturated `fill-*` family or `{accent}`, never from the status hues: a
/// KPI is a quantity, not a state, and painting it `{ok}` would claim the
/// number itself means "fine".
export function KpiGrid({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("grid grid-cols-2 gap-2.5", className)} {...props} />
  )
}

export type KpiTone = "accent" | "sky" | "orange" | "green"

const fills: Record<KpiTone, string> = {
  accent: "bg-accent",
  sky: "bg-fill-sky",
  orange: "bg-fill-orange",
  green: "bg-fill-green",
}

export function Kpi({
  icon,
  label,
  value,
  sub,
  tone = "accent",
}: {
  icon: React.ReactNode
  label: React.ReactNode
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: KpiTone
}) {
  return (
    <div className="rounded-card border border-hairline bg-canvas px-3.5 pt-3.5 pb-4 shadow-soft">
      <span
        className={cn(
          "mb-3 grid size-[1.75rem] place-items-center rounded-inner text-on-dark [&_svg]:size-[0.9375rem]",
          fills[tone],
        )}
      >
        {icon}
      </span>
      <div className="text-meta text-body">{label}</div>
      <div className="mt-0.5 text-kpi leading-none font-semibold text-ink tabular-nums">
        {value}
      </div>
      {sub !== undefined && (
        <div className="mt-1.5 text-meta text-mute tabular-nums">{sub}</div>
      )}
    </div>
  )
}

/// The one number a whole screen is about, set at the size it is read from.
///
/// The payment screen's amount due, the receipt's change. Nothing else on this
/// surface uses `text-total`, and nothing else should: a screen with two
/// 32px numbers on it has no primary number at all.
export function BigNumber({
  label,
  value,
  sub,
  tone = "ink",
  className,
}: {
  label?: React.ReactNode
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: "ink" | "accent" | "ok" | "bad"
  className?: string
}) {
  return (
    <div className={cn("text-center", className)}>
      {label !== undefined && (
        <div className="text-eyebrow font-semibold text-mute uppercase">
          {label}
        </div>
      )}
      <div
        className={cn(
          "mt-1.5 text-total font-semibold tabular-nums",
          tone === "accent" && "text-accent",
          tone === "ok" && "text-ok-fg",
          tone === "bad" && "text-bad-fg",
          tone === "ink" && "text-ink",
        )}
      >
        {value}
      </div>
      {sub !== undefined && (
        <div className="mt-1.5 text-meta text-body">{sub}</div>
      )}
    </div>
  )
}
