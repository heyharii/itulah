import { cva, type VariantProps } from "class-variance-authority"

import { Button } from "@/components/ui/button"
import { describe } from "@/lib/errors"
import { cn } from "@/lib/utils"

/// Empty, loading and error, authored once.
///
/// DESIGN.md carries these because a screen that invents them reaches for a
/// grey illustration, an amber "unknown", or a dark dim the first time it has
/// nothing to show — and then the app has two design systems.

/// Nothing to show, and it matters which kind of nothing.
///
/// An empty *filtered* list means the filters found nothing; an empty
/// *unfiltered* list means the thing has never happened. Those are different
/// sentences and the caller has to pick, which is why there is no default.
export function EmptyState({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mx-auto flex max-w-[28em] flex-col items-center gap-4 px-4 py-12 text-center">
      <p className="text-meta text-body">{children}</p>
      {action}
    </div>
  )
}

/// The same quiet sentence as empty, and no spinner.
///
/// A spinner on a 400ms fetch is a flash; a spinner on a hang is a lie that
/// work is still happening.
export function LoadingState({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[28em] px-4 py-12 text-center">
      <p className="text-meta text-body">{children ?? "Loading…"}</p>
    </div>
  )
}

/// Quote the node's sentence when there is one; never invent a code or a retry
/// countdown. An error is `{bad}` — not `{warn}`, not `{accent}`.
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown
  onRetry?: () => void
}) {
  return (
    <div className="mx-auto flex max-w-[28em] flex-col items-center gap-4 px-4 py-12 text-center">
      <p className="text-meta text-bad">{describe(error)}</p>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

const banner = cva(
  "flex items-start gap-2.5 rounded-inner px-3.5 py-2.5 text-[0.78125rem] leading-relaxed",
  {
    variants: {
      tone: {
        ok: "bg-ok-bg text-ok-fg",
        warn: "bg-warn-bg text-warn-fg",
        bad: "bg-bad-bg text-bad-fg",
        info: "bg-info-bg text-info-fg",
        accent: "bg-accent-bg text-info-fg",
      },
    },
    defaultVariants: { tone: "info" },
  },
)

/// A fact that sits on the screen — no price book, a backlog that is not
/// getting through, a sale the node refused.
///
/// Not a toast and not a dialog: the screen stays and the fact sits with it. A
/// till has no room for a message that disappears while the cashier is looking
/// at the customer.
export function Banner({
  className,
  tone,
  action,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof banner> & { action?: React.ReactNode }) {
  return (
    <div className={cn(banner({ tone }), className)} {...props}>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  )
}
