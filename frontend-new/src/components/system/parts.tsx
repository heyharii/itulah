/*
 * Small presentational pieces shared by the four System screens, kept here so
 * the tables, chips and empty states cannot drift apart between them.
 */

import { cn } from "@/lib/utils"

export const rule = "border-b border-b-[color-mix(in_srgb,var(--line)_78%,transparent)]"

export const headRow =
  "[&>th]:sticky [&>th]:top-0 [&>th]:z-5 [&>th]:h-9 [&>th]:border-b [&>th]:border-b-line-strong " +
  "[&>th]:bg-surface [&>th]:px-3 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-[0.04em] " +
  "[&>th]:text-ink-3 [&>th]:uppercase"

const STATUS_HUE: Record<string, string> = {
  active: "var(--grass)",
  suspended: "var(--honey)",
  retired: "var(--ember)",
  archived: "var(--ember)",
  revoked: "var(--ember)",
  candidate: "var(--violet)",
  terminated: "var(--ember)",
  // Audit severities, which share this chip with the lifecycle words.
  info: "var(--line-strong)",
  warning: "var(--honey)",
  error: "var(--ember)",
  critical: "var(--ember)",
}

/** A status word with the dot that the rest of the suite uses for lifecycle. */
export function StatusChip({ value, muted }: { value: string | null; muted?: string }) {
  if (!value) return <span className="text-[11.5px] text-ink-4">{muted ?? "—"}</span>
  const hue = STATUS_HUE[value.toLowerCase()] ?? "var(--line-strong)"
  return (
    <span className="inline-flex items-center gap-1.5">
      <span style={{ background: hue }} className="size-1.5 shrink-0 rounded-full" />
      <span className="text-[11.5px] text-ink-2 capitalize">{value.toLowerCase()}</span>
    </span>
  )
}

export function Count({ value, className }: { value: number | string; className?: string }) {
  return (
    <span className={cn("font-mono text-[12px] tabular-nums text-ink-2", className)}>{value}</span>
  )
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
        {label}
      </div>
      <div className="font-mono text-[15px] tabular-nums text-ink">{value}</div>
      {hint && <div className="pt-0.5 text-[11px] text-ink-4">{hint}</div>}
    </div>
  )
}

/** Used wherever cloud-hub cannot answer — never dressed up as a value. */
export function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  return (
    <p
      className={cn(
        "rounded-panel px-3 py-2 text-[11.5px] leading-[1.55]",
        tone === "warn"
          ? "bg-[color-mix(in_srgb,var(--ember)_8%,var(--inset))] text-ink-2"
          : "bg-inset text-ink-3"
      )}
    >
      {children}
    </p>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3.5 py-10 text-center text-xs text-ink-4">{children}</p>
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-1.5 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
      {children}
    </div>
  )
}

const RELATIVE_STEPS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
]

/** "3 h ago" style stamps; the API hands out ISO instants everywhere. */
export function relativeTime(iso: string): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return "—"
  let delta = (at - Date.now()) / 1000
  for (const [span, unit] of RELATIVE_STEPS) {
    if (Math.abs(delta) < span) {
      return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(delta), unit)
    }
    delta /= span
  }
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(delta), "week")
}
