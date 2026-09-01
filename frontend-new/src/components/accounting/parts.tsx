/*
 * The bits every accounting screen shares: the hairline table rules, the mono
 * numeral class, and the one read-state block that keeps "loading", "broken"
 * and "genuinely empty" visually distinct. The ledger is empty today, so the
 * empty state is load-bearing rather than decorative.
 */

import { Icon, paths } from "@/components/dashboard/parts"
import { cn } from "@/lib/utils"

/** The hairline under every row — the same rule the other apps draw. */
export const rule =
  "border-b border-b-[color-mix(in_srgb,var(--line)_78%,transparent)]"

/** Tabular numerals, so columns of money line up on the decimal. */
export const num = "font-mono text-xs tabular-nums"

export const headRow =
  "[&>th]:sticky [&>th]:top-0 [&>th]:z-5 [&>th]:h-9 [&>th]:border-b [&>th]:border-b-line-strong [&>th]:bg-surface [&>th]:px-3 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-[0.04em] [&>th]:text-ink-3 [&>th]:uppercase"

export function ReadState({
  variant,
  message,
  detail,
  onRetry,
}: {
  variant: "loading" | "error" | "empty"
  message: string
  detail?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 px-6 text-center text-ink-4">
      <span className="grid size-[36px] place-items-center rounded-panel bg-inset shadow-[inset_0_0_0_1px_var(--line-strong)]">
        {variant === "loading" ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-ink-4 border-t-transparent" />
        ) : variant === "error" ? (
          <Icon path={paths.alert} size={17} width={1.8} className="text-ember" />
        ) : (
          <span className="font-mono text-[15px]">—</span>
        )}
      </span>
      <span className="text-xs font-medium text-ink-2">{message}</span>
      {detail && (
        <span className="max-w-[460px] text-[11px] leading-[1.5]">{detail}</span>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex h-[28px] items-center rounded-control bg-ink px-2.5 text-[11px] font-medium text-surface transition-opacity hover:opacity-85"
        >
          Retry
        </button>
      )}
    </div>
  )
}

/** A small caps label above a value — used across the detail sheets. */
export function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[13px] text-ink">{children}</div>
    </div>
  )
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "bad"
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        tone === "neutral" &&
          "bg-inset text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]",
        tone === "good" && "bg-grass/12 text-grass",
        tone === "bad" && "bg-ember/12 text-ember"
      )}
    >
      {children}
    </span>
  )
}

/**
 * The hub attaches a `scope_note` to the statements saying what V1 does and
 * does not model. It is the API's own caveat, so it is shown, not paraphrased.
 */
export function ScopeNote({ note }: { note: string | null }) {
  if (!note) return null
  return (
    <p className="border-t border-line px-3.5 py-2.5 text-[11px] leading-[1.55] text-ink-4">
      <span className="font-semibold text-ink-3">From the API · </span>
      {note}
    </p>
  )
}
