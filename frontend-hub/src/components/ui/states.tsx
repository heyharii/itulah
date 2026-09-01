import { cva, type VariantProps } from "class-variance-authority"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"

/// Empty, loading and error, authored once.
///
/// DESIGN.md carries these because a screen that invents them reaches for a
/// grey illustration, an amber "unknown", or a dark dim the first time it has
/// nothing to show — and then the app has two design systems.

/// Nothing to show, and it matters which kind of nothing.
///
/// An empty *filtered* list means the filters found nothing; an empty
/// *unfiltered* list means the thing has never been made. Those are different
/// sentences and the caller has to pick, which is why there is no default.
export function EmptyState({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mx-auto flex max-w-[28em] flex-col items-center gap-3 px-4 py-14 text-center">
      <p className="text-meta text-body">{children}</p>
      {action}
    </div>
  )
}

/// The same quiet sentence as empty, and no spinner.
///
/// A spinner on a 400ms fetch is a flash; a spinner on a hang is a lie that
/// work is still happening. Skeleton rows are allowed inside an already-open
/// sheet whose header already shows the record id — never for a whole screen.
export function LoadingState({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[28em] px-4 py-14 text-center">
      <p className="text-meta text-body">{children ?? "Loading…"}</p>
    </div>
  )
}

/// Quote the server's sentence when there is one; never invent a code or a
/// retry countdown. An error is `{bad}` — not `{warn}`, not `{accent}`.
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown
  onRetry?: () => void
}) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : "The server could not be reached."
  return (
    <div className="mx-auto flex max-w-[28em] flex-col items-center gap-3 px-4 py-14 text-center">
      <p className="text-meta text-bad">{message}</p>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

const banner = cva(
  "flex items-start gap-2.5 rounded-inner px-3.5 py-2.5 text-[0.71875rem] leading-relaxed",
  {
    variants: {
      tone: {
        ok: "bg-ok-bg text-ok-fg",
        warn: "bg-warn-bg text-warn-fg",
        bad: "bg-bad-bg text-bad-fg",
        info: "bg-info-bg text-info-fg",
      },
    },
    defaultVariants: { tone: "info" },
  }
)

/// A fact that sits on the page — a publish receipt, a stalled fleet, "priced
/// as of last Tuesday".
///
/// Not a toast and not a dialog: the page stays and the fact sits with it. A
/// toast confirms an action that did not change the screen; a page-level
/// failure belongs here or in the empty state, never in a toast.
export function Banner({
  className,
  tone,
  onDismiss,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof banner> & { onDismiss?: () => void }) {
  return (
    <div className={cn(banner({ tone }), className)} {...props}>
      <span className="min-w-0 flex-1">{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 underline underline-offset-2 opacity-80 hover:opacity-100"
        >
          Dismiss
        </button>
      )}
    </div>
  )
}
