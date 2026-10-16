import { ChevronRight } from "lucide-react"

import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/// Exceptions-first: what is wrong, stuck or mismatched, at the top of an
/// overview.
///
/// DESIGN.md is blunt about this — an Overview leads with a queue of problems
/// carrying a severity, an amount and one action, not with vanity KPIs. A
/// dashboard of green numbers tells somebody their day is fine; this tells them
/// what their day is.
export interface Exception {
  readonly id: string
  readonly title: React.ReactNode
  readonly detail?: React.ReactNode
  /// The number that says how much this one matters — a value, a count, an age.
  readonly amount?: React.ReactNode
  readonly severity: "high" | "medium" | "low"
  readonly icon?: React.ReactNode
  readonly onOpen?: () => void
}

export function ExceptionQueue({
  title = "Needs attention",
  exceptions,
  empty = "Nothing needs attention.",
  className,
}: {
  title?: React.ReactNode
  exceptions: readonly Exception[]
  /// The sentence when the queue is clear. Worth writing per screen: "no
  /// unmatched receipts" reads better than a generic all-clear.
  empty?: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("mb-[1.125rem] overflow-hidden", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {exceptions.length > 0 && (
          <span className="text-[0.9375rem] text-mute tabular-nums">
            {exceptions.length}
          </span>
        )}
      </CardHeader>
      {exceptions.length === 0 ? (
        <p className="px-4 pb-4 text-meta text-body">{empty}</p>
      ) : (
        <div className="border-t border-hairline">
          {exceptions.map((exception) => (
            <button
              key={exception.id}
              type="button"
              onClick={exception.onOpen}
              className="flex w-full items-center gap-3 border-b border-hairline px-4 py-[0.6875rem] text-left transition-colors last:border-b-0 hover:bg-soft"
            >
              <span
                className={cn(
                  "grid size-[1.875rem] shrink-0 place-items-center rounded-inner",
                  exception.severity === "high" && "bg-bad-bg text-bad-fg",
                  exception.severity === "medium" && "bg-warn-bg text-warn-fg",
                  exception.severity === "low" && "bg-soft-2 text-body"
                )}
              >
                {exception.icon}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[0.9375rem] font-medium text-ink">
                  {exception.title}
                </b>
                {exception.detail && (
                  <small className="block text-[0.9375rem] text-mute">
                    {exception.detail}
                  </small>
                )}
              </span>
              {exception.amount && (
                <span className="shrink-0 text-right text-[0.9375rem] font-semibold whitespace-nowrap tabular-nums">
                  {exception.amount}
                </span>
              )}
              <span
                className={cn(
                  "inline-flex h-[1.3125rem] shrink-0 items-center rounded-full px-2 text-[0.9375rem] font-semibold whitespace-nowrap",
                  exception.severity === "high" && "bg-bad-bg text-bad-fg",
                  exception.severity === "medium" && "bg-warn-bg text-warn-fg",
                  exception.severity === "low" && "bg-soft-2 text-body"
                )}
              >
                {exception.severity === "high"
                  ? "High"
                  : exception.severity === "medium"
                    ? "Medium"
                    : "Low"}
              </span>
              <ChevronRight className="size-[0.9375rem] shrink-0 text-faint" />
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}
