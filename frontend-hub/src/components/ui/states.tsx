import { cva, type VariantProps } from "class-variance-authority"

import { Button } from "@/components/ui/button"
import { problemOf } from "@/lib/problem"
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

/// Something is here; the narrowing hid it.
///
/// ## Why this is not just `EmptyState` with different words
///
/// Because the two are opposite findings and they look identical. An empty
/// unfiltered list means the thing has never been made. An empty *filtered*
/// list means the data is fine and the filter is the thing to change. A screen
/// that draws one sentence for both teaches people to distrust the list.
///
/// `held` is what makes the difference sayable in a number: "there are 1,284
/// bills and not one of them matches" tells a reader, in one line, that nothing
/// is broken. Omit it rather than guess — an endpoint that cannot say how many
/// it holds is common here, and a fabricated count is worse than none.
export function NoMatch({
  what,
  held,
  onClear,
}: {
  what: string
  /// How many exist behind the narrowing, when the endpoint can say so.
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

/// Refused, not absent.
///
/// The distinction is the whole reason this is its own state. A forbidden list
/// and an empty one render identically and mean opposite things, and a reader
/// told "nothing here" goes looking for their data in the wrong place for an
/// afternoon. Say it was permission.
///
/// `reach` is what the caller's role DOES cover, when the server said. A
/// refusal that also says where to look is one somebody can act on; one that
/// only says no is a dead end with a person behind it.
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

/// The list you are reading was cut off, and the endpoint cannot say by how
/// much.
///
/// ## The defect this exists to make visible
///
/// Several lists here are fetched with a `limit` the server clamps, and then
/// searched and sorted in the browser. With a short list that is
/// indistinguishable from correct. Past the cap it silently omits rows, and
/// every figure summed from what remains looks like a total.
///
/// Nothing about drawing this strip fixes that — the fix is `q`, `sort` and a
/// cursor on the wire, which is a change to the endpoint. What this does is
/// stop the screen from lying quietly while that work is done: a reader who is
/// told the list was cut off can decide whether to trust it, and a reader who
/// is not told cannot.
///
/// So it is deliberately blunt about the figures. "There may be more" invites
/// somebody to read the total anyway.
export function Truncated({
  limit,
  noun,
  total,
  className,
}: {
  /// The number of rows actually asked for. Not the number returned — a screen
  /// that got exactly what it asked for is precisely the case where there is
  /// no way to know whether more exist.
  limit: number
  noun: string
  /// How many there are in all, when the server counted them.
  ///
  /// **`null` means the count was not asked for, and is drawn as an em dash
  /// with the reason.** Never as a zero: a list that says "the first 300 of 0"
  /// is a worse lie than the silence this banner exists to break. Leave it out
  /// where there is no total to have.
  total?: number | null
  className?: string
}) {
  return (
    <Banner tone="warn" className={className}>
      Showing the first {limit.toLocaleString("id-ID")}
      {total === undefined ? null : (
        <>
          {" of "}
          {total === null ? "—" : total.toLocaleString("id-ID")}
        </>
      )}{" "}
      {noun}. This list is searched and sorted in the browser, over these rows
      only, so there may be more that never arrived —{" "}
      <b className="font-medium">do not read the figures below as totals.</b>
      {total === null && (
        <> The full count was not asked for on this request.</>
      )}
    </Banner>
  )
}

/// A failed write, said where the write was attempted.
///
/// Not a toast: a toast confirms an action that did not change the screen, and
/// this is an action that did not happen at all. Renders nothing when there is
/// nothing wrong, so a caller can drop it under any form unconditionally.
export function Problem({
  error,
  className,
}: {
  error: unknown
  className?: string
}) {
  const message = problemOf(error)
  if (message === null) return null
  return (
    <Banner tone="bad" className={className}>
      {message}
    </Banner>
  )
}

/// A write that worked, said in the same place.
///
/// The counterpart, and it exists because half the writes here produce a
/// receipt worth reading — how many pieces were tagged, which allotment lines
/// a box was attributed to, how many cartons actually followed the paperwork.
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
