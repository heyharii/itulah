import { Icon, paths } from "@/components/dashboard/parts"
import type { Employee, EmployeeStatus, EmploymentType } from "@/components/hr/data"
import { cn } from "@/lib/utils"

export const STATUS_META: Record<EmployeeStatus, { label: string; hue: string }> = {
  active: { label: "Active", hue: "var(--grass)" },
  probation: { label: "Probation", hue: "var(--honey)" },
  notice: { label: "On notice", hue: "var(--ember)" },
}

export const TYPE_META: Record<EmploymentType, { label: string; hue: string }> = {
  permanent: { label: "Permanent", hue: "#0086fc" },
  contract: { label: "Contract", hue: "#7b5cfa" },
  "part-time": { label: "Part-time", hue: "#ffbb26" },
  intern: { label: "Intern", hue: "#00c978" },
}

export const KIND_ICON = {
  ho: paths.grid,
  store: paths.bag,
  warehouse: paths.archive,
} as const

/** Initials in a circle — we have no photographs of people, and inventing
 *  faces would be worse than owning the absence. */
export function Avatar({
  employee,
  size = 32,
  className,
}: {
  employee: Pick<Employee, "name" | "hue">
  size?: number
  className?: string
}) {
  const initials = employee.name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")

  return (
    <span
      title={employee.name}
      style={{ background: employee.hue, width: size, height: size, fontSize: size * 0.36 }}
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-white uppercase select-none",
        className
      )}
    >
      {initials}
    </span>
  )
}

export function StatusDot({ status }: { status: EmployeeStatus }) {
  const meta = STATUS_META[status]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
      <span style={{ background: meta.hue }} className="size-2 shrink-0 rounded-full" />
      {meta.label}
    </span>
  )
}

export function TypeChip({ type }: { type: EmploymentType }) {
  const meta = TYPE_META[type]
  return (
    <span
      style={{ "--tag": meta.hue } as React.CSSProperties}
      className={cn(
        "inline-flex h-[21px] shrink-0 items-center rounded-[7px] border px-[6px] text-[11.5px] font-medium whitespace-nowrap",
        "border-[color-mix(in_srgb,var(--tag)_26%,var(--surface))]",
        "text-[color-mix(in_srgb,var(--tag)_62%,var(--ink))]",
        "bg-[color-mix(in_srgb,var(--tag)_13%,var(--surface))]"
      )}
    >
      {meta.label}
    </span>
  )
}

/** A filled bar against its budget — over-plan runs past the line. */
export function PlanBar({ actual, plan }: { actual: number; plan: number }) {
  const ratio = plan ? actual / plan : 0
  const over = ratio > 1
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-[6px] w-full min-w-[52px] overflow-hidden rounded-full bg-line">
        <i
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
          className={cn(
            "block h-full rounded-full transition-[width] duration-[420ms] ease-out-strong",
            over ? "bg-honey" : ratio >= 0.95 ? "bg-grass" : "bg-ember"
          )}
        />
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-4">
        {actual}/{plan}
      </span>
    </span>
  )
}

export function Stat({
  label,
  value,
  unit,
  hint,
  tone,
  icon,
}: {
  label: string
  value: React.ReactNode
  unit?: string
  hint?: string
  tone?: "good" | "warn" | "bad"
  icon: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-[5px] border-l border-line px-3.5 pt-3 pb-[13px] first:border-l-0">
      <span className="flex items-center gap-[5px] text-[11px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
        {icon}
        {label}
      </span>
      <span className="flex items-baseline gap-[7px]">
        <span
          className={cn(
            "font-mono text-[21px] leading-none font-medium tracking-[-0.02em]",
            tone === "bad" ? "text-ember" : tone === "warn" ? "text-honey" : "text-ink"
          )}
        >
          {value}
        </span>
        {unit && <span className="text-[11.5px] font-medium text-ink-4">{unit}</span>}
      </span>
      {hint && <span className="truncate text-[11px] text-ink-4">{hint}</span>}
    </div>
  )
}

export const smallIcon = (path: React.ReactNode) => <Icon path={path} size={12} width={2} />
