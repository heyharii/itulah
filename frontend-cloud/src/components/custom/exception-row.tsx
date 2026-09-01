import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import type { StatusTone } from "./status-pill"

/// The unit of an exception queue: one problem, what it is worth, how bad it
/// is, and a way in.
///
/// An overview leads with what is wrong, and the thing that decides whether a
/// queue is usable is row height. A stacked inline form per exception runs
/// ~170px and fits two problems on a laptop; this row is 56px and fits eight,
/// which is the difference between a queue you triage and a queue you scroll.
/// Everything that does not help you rank the row — the explanation of what
/// the exception type means, the resolution controls — belongs above the list
/// or behind the chevron, said once, not repeated per row.
export function ExceptionRows({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "[&>*+*]:border-t [&>*+*]:border-[var(--os-hairline,#ececef)]",
        className,
      )}
    >
      {children}
    </div>
  )
}

const TILE: Record<StatusTone, string> = {
  ok: "bg-[var(--os-ok-bg,#d9f4d2)] text-[var(--os-ok,#36b827)]",
  warn: "bg-[var(--os-warn-bg,#faeacd)] text-[var(--os-warn,#c9892e)]",
  bad: "bg-[var(--os-bad-bg,#fbeaea)] text-[var(--os-bad,#d05151)]",
  info: "bg-[var(--os-info-bg,#ddebfa)] text-[var(--os-info,#2f86d8)]",
  neutral: "bg-[var(--os-soft-2,#f3f3f5)] text-[var(--os-body,#74747b)]",
}

export function ExceptionRow({
  tone = "neutral",
  icon,
  title,
  subtitle,
  amount,
  status,
  onClick,
  className,
}: {
  /// Tints the leading squircle only. It is the same four-tone status scale
  /// as the pill, never a categorical accent — an exception queue painted in
  /// `a-violet` and `a-orange` reads as a legend rather than a severity.
  tone?: StatusTone
  icon?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  /// Right-aligned and tabular so the column ranks itself. Money is Inter,
  /// not mono.
  amount?: React.ReactNode
  /// A `StatusPill` carrying the severity. Passed in rather than derived,
  /// because the word ("High", "Blocked", "Over tolerance") is the caller's
  /// domain language and this row has no business inventing it.
  status?: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  const Tag = onClick ? "button" : "div"
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-[0.6875rem] text-left",
        onClick && "transition-colors hover:bg-[var(--os-soft,#f7f7f8)]",
        className,
      )}
    >
      {icon !== undefined && (
        <span
          aria-hidden
          className={cn(
            "grid size-[1.875rem] shrink-0 place-items-center",
            "rounded-[var(--os-r-inner,0.5625rem)] [&_svg]:size-4",
            TILE[tone],
          )}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.84375rem] font-medium text-[var(--os-ink,#1d1d1f)]">
          {title}
        </span>
        {subtitle !== undefined && (
          <span className="block truncate text-[0.75rem] text-[var(--os-mute,#a6a6ad)]">
            {subtitle}
          </span>
        )}
      </span>
      {amount !== undefined && (
        <span className="shrink-0 text-right text-[0.84375rem] font-semibold tabular-nums whitespace-nowrap text-[var(--os-ink,#1d1d1f)]">
          {amount}
        </span>
      )}
      {status}
      {onClick && (
        <ChevronRight
          aria-hidden
          className="size-[0.9375rem] shrink-0 text-[var(--os-faint,#d3d3d8)]"
        />
      )}
    </Tag>
  )
}
