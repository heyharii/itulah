import { cva, type VariantProps } from "class-variance-authority"

import { Button } from "@/components/ui/button"
import { EmptyIllustration, type EmptyArt } from "@/components/ui/empty-art"
import { describe } from "@/lib/errors"
import { cn } from "@/lib/utils"

/// Empty, loading and error, authored once — the hub's
/// (`frontend-hub/src/components/ui/states.tsx`), cut to what a shop's screens
/// use.
///
/// A screen that invents them reaches for a grey illustration, an amber
/// "unknown", or a dark dim the first time it has nothing to show — and then
/// the app has two design systems.

/// Nothing to show, and it matters which kind of nothing.
///
/// An empty *filtered* list means the filters found nothing; an empty
/// *unfiltered* list means the thing has never happened. Those are different
/// sentences and the caller has to pick, which is why there is no default.
export function EmptyState({
  children,
  action,
  art,
}: {
  children: React.ReactNode
  action?: React.ReactNode
  /// The picture over the sentence. Left out, it follows the sentence: one that
  /// says nothing matches or was found gets the search, any other the empty
  /// tray. `null` draws none, for the places too small to hold one.
  art?: EmptyArt | null
}) {
  const picture: EmptyArt | null =
    art !== undefined
      ? art
      : typeof children === "string" && /match|found/i.test(children)
        ? "search"
        : "empty"
  return (
    <div className="mx-auto flex max-w-[28em] flex-col items-center gap-3 px-4 py-12 text-center">
      {picture !== null && <EmptyIllustration art={picture} />}
      <p className="text-meta text-body">{children}</p>
      {action}
    </div>
  )
}

/// The same quiet sentence as empty, and no spinner.
///
/// A spinner on a 400ms fetch is a flash; a spinner on a hang is a lie that
/// work is still happening. The words are the caller's, and they say what is
/// being read: "Reading this shop's range…", "Reading the stock count…".
///
/// `rows` draws the shape of what is coming instead — a list's rows, as a slow
/// fade — for a screen that is a list opened all day: a line of text that
/// becomes a list moves the whole page. The sentence stays for a screen reader.
export function LoadingState({
  children,
  rows = false,
}: {
  children?: React.ReactNode
  rows?: boolean
}) {
  const label = children ?? "Reading…"
  if (rows) return <ListSkeleton label={label} />
  return (
    <div className="mx-auto max-w-[28em] px-4 py-14 text-center">
      <p className="text-meta text-body">{label}</p>
    </div>
  )
}

/// A list's rows, drawn before the rows exist: a name and a figure per row, and
/// a slow fade so it reads as waiting and not as broken. Held still for anyone
/// who asked for less motion.
function ListSkeleton({ label }: { label: React.ReactNode }) {
  const widths = ["w-2/5", "w-1/3", "w-1/2", "w-2/5", "w-[28%]", "w-1/2"]
  return (
    <div role="status" aria-live="polite" className="px-0.5 pt-2">
      <span className="sr-only">{label}</span>
      <div
        aria-hidden
        className="overflow-hidden rounded-inner border border-hairline bg-canvas motion-safe:animate-pulse"
      >
        {Array.from({ length: 8 }, (_, row) => (
          <div
            key={row}
            className="flex h-14 items-center gap-6 border-t border-hairline px-4 first:border-t-0"
          >
            <span className={`h-3.5 rounded-full bg-soft ${widths[row % 6]}`} />
            <span className="ml-auto h-3.5 w-16 rounded-full bg-soft" />
          </div>
        ))}
      </div>
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
    <div className="mx-auto flex max-w-[28em] flex-col items-center gap-3 px-4 py-14 text-center">
      <p className="text-meta text-bad">{describe(error)}</p>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/// Something is here; the narrowing hid it.
///
/// Not just `EmptyState` with different words, because the two are opposite
/// findings and they look identical. An empty unfiltered list means the thing
/// has never been made; an empty *filtered* list means the data is fine and the
/// filter is the thing to change. `held` makes the difference sayable in a
/// number — omit it rather than guess.
export function NoMatch({
  what,
  held,
  onClear,
}: {
  what: string
  /// How many exist behind the narrowing, when the list can say so.
  held?: number
  onClear?: () => void
}) {
  return (
    <EmptyState
      action={
        onClear && (
          <Button variant="ghost" onClick={onClear}>
            Clear the narrowing
          </Button>
        )
      }
    >
      {held === undefined ? (
        <>No {what} matches the search and filters in force.</>
      ) : (
        <>
          There are {held.toLocaleString("id-ID")} {what} here, and not one of
          them passes the search and filters in force.
        </>
      )}
    </EmptyState>
  )
}

/// Refused, not absent: a forbidden list and an empty one render identically
/// and mean opposite things, so say it was permission.
export function NoAccessState({
  what,
  reach,
}: {
  what: string
  reach?: React.ReactNode
}) {
  return (
    <EmptyState>
      You do not have access to {what}. This is about permission, not about the
      data being absent.{reach ? <> {reach}</> : null}
    </EmptyState>
  )
}

const banner = cva(
  "flex items-start gap-2.5 rounded-inner px-3.5 py-2.5 text-meta leading-relaxed",
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
/// toast confirms an action that did not change the screen; a page-level
/// failure belongs here or in the empty state, never in a toast.
export function Banner({
  className,
  tone,
  action,
  onDismiss,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof banner> & {
    action?: React.ReactNode
    onDismiss?: () => void
  }) {
  return (
    <div className={cn(banner({ tone }), className)} {...props}>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
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

/// A failed write, said where the write was attempted. Renders nothing when
/// there is nothing wrong, so a caller can drop it under any form
/// unconditionally.
export function Problem({
  error,
  className,
}: {
  error: unknown
  className?: string
}) {
  if (error === null || error === undefined) return null
  return (
    <Banner tone="bad" className={className}>
      {describe(error)}
    </Banner>
  )
}

/// A write that worked, said in the same place.
export function Receipt({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <Banner tone="ok" className={className}>
      {children}
    </Banner>
  )
}
