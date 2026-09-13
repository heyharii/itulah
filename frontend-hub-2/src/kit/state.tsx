import { AlertTriangle, Ban, Lock, RefreshCw } from "lucide-react"

import { Button } from "@/kit/button"
import { cn } from "@/lib/cn"

/// The states a screen is in when it is not showing a list.
///
/// ## Why these are components rather than a line of text each time
///
/// Because they are routinely collapsed into one, and collapsing them loses the
/// only information the reader needed. "No bills" and "no bills matched that
/// filter" look alike and are opposites: the first wants a button that creates
/// one, the second wants a button that clears the filter. A screen that shows
/// the same empty box for both sends half its readers to the wrong place.
///
/// Six states, and each is a different sentence and a different next action:
///
///   `Loading`   — a skeleton in the shape of what is coming, not a spinner.
///   `Empty`     — there has never been anything here. Offer to create.
///   `NoMatch`   — there is something here, the narrowing hid it. Offer to clear.
///   `Failed`    — the request did not finish. Say what failed; offer to retry.
///   `NoAccess`  — this is about permission, not about absence. Say which.
///   `Partial`   — some of it worked. Say which part did not, per row.
///
/// The seventh and eighth — a document that changed while it was open, and an
/// action whose outcome is not yet certain — are not empty states: they appear
/// over content that is still on screen. They live in `kit/notice.tsx`.

/// Rows in the shape of the table that is coming.
///
/// Not a spinner. A spinner says "something is happening"; a skeleton says
/// "a table with six columns is happening", and the reader has already started
/// reading the layout by the time the rows land. The widths vary a little per
/// row on purpose — an even grid reads as a rendering fault.
export function Loading({
  rows = 8,
  cols = 6,
}: {
  rows?: number
  cols?: number
}) {
  return (
    <div
      className="flex-1 overflow-hidden p-4"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading</span>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex gap-4">
            {Array.from({ length: cols }, (_, col) => (
              <div
                key={col}
                className="rounded-tag bg-field h-3 animate-pulse"
                style={{
                  width: `${col === 0 ? 22 : 8 + ((row * 7 + col * 11) % 9)}%`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function Frame({
  icon,
  title,
  detail,
  hint,
  actions,
  tone,
}: {
  icon?: React.ReactNode
  title: string
  detail?: React.ReactNode
  /// The technical line — a request path, a status. Small, grey, and last:
  /// useful to whoever has to fix it, ignorable by whoever does not.
  hint?: React.ReactNode
  actions?: React.ReactNode
  tone?: "bad"
}) {
  return (
    <div className="grid flex-1 place-items-center p-10 text-center">
      <div className="max-w-[34rem]">
        {icon && (
          <div
            className={cn(
              "rounded-ctl mx-auto mb-2 grid size-9 place-items-center",
              tone === "bad"
                ? "bg-bad-wash text-bad-ink"
                : "bg-field text-ink-4",
            )}
          >
            {icon}
          </div>
        )}
        <div
          className={cn(
            "text-cell font-semibold",
            tone === "bad" ? "text-bad-ink" : "text-ink",
          )}
        >
          {title}
        </div>
        {detail && <p className="text-ctl text-ink-3 mt-1">{detail}</p>}
        {hint && <p className="text-meta text-ink-4 mt-2">{hint}</p>}
        {actions && (
          <div className="mt-4 flex justify-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}

/// Nothing has ever been here.
///
/// `onCreate` is offered only when the reader may actually create one — an
/// empty state that dangles a button somebody's role forbids is worse than no
/// button, because the refusal arrives after the click.
export function Empty({
  what,
  detail,
  onCreate,
  createLabel = "Create the first one",
}: {
  what: string
  detail?: React.ReactNode
  onCreate?: () => void
  createLabel?: string
}) {
  return (
    <Frame
      title={`No ${what} yet`}
      detail={detail}
      actions={
        onCreate && (
          <Button variant="primary" onClick={onCreate}>
            {createLabel}
          </Button>
        )
      }
    />
  )
}

/// There is something here; the narrowing hid it.
///
/// The count is not decoration — it is the difference between this state and
/// `Empty`, said in a number. "There are 1,284 bills and none of them match"
/// tells the reader the data is fine and the filter is the thing to change.
export function NoMatch({
  what,
  held,
  onClear,
}: {
  what: string
  /// How many exist behind the filter, when the endpoint can say. Omit rather
  /// than guess: a fabricated count is worse than none.
  held?: number
  onClear?: () => void
}) {
  return (
    <Frame
      title="Nothing matches this narrowing"
      detail={
        held === undefined ? (
          <>No {what} matches the search and filters in force.</>
        ) : (
          <>
            There are {held.toLocaleString("id-ID")} {what} here, and not one of
            them passes the search and filters in force.
          </>
        )
      }
      actions={
        onClear && (
          <Button variant="primary" onClick={onClear}>
            Clear the narrowing
          </Button>
        )
      }
    />
  )
}

/// The request did not finish.
///
/// Says plainly that nothing was changed. On a finance screen that sentence is
/// not reassurance, it is information: somebody who pressed a button and saw an
/// error needs to know whether to press it again.
export function Failed({
  what,
  error,
  onRetry,
}: {
  what: string
  error: unknown
  onRetry?: () => void
}) {
  const detail =
    error instanceof Error ? error.message : "The request did not complete."
  return (
    <Frame
      tone="bad"
      icon={<AlertTriangle className="size-5" />}
      title={`Could not load ${what}`}
      detail={
        <>{detail} Nothing of yours has changed, and no action was sent.</>
      }
      actions={
        onRetry && (
          <Button icon={<RefreshCw className="size-4" />} onClick={onRetry}>
            Try again
          </Button>
        )
      }
    />
  )
}

/// A refusal about permission, said as one.
///
/// The distinction this draws is the whole reason it is a separate state: an
/// empty list and a forbidden one look identical and mean opposite things, and
/// the reader who is told "nothing here" goes looking for the data in the wrong
/// place for an afternoon.
export function NoAccess({
  what,
  reach,
}: {
  what: string
  /// What the reader's role DOES reach, when it is known. A refusal that also
  /// says where to go is a refusal somebody can act on.
  reach?: React.ReactNode
}) {
  return (
    <Frame
      icon={<Lock className="size-5" />}
      title={`You do not have access to ${what}`}
      detail={
        <>
          This is about permission, not about the data being absent.{" "}
          {reach ?? null}
        </>
      }
      hint="Ask through Finance Settings → Access &amp; Approvals"
    />
  )
}

/// Some of it worked.
///
/// Deliberately NOT an error state. The successful part is real and must not be
/// retried; the failed part is named so it can be dealt with on its own. This
/// is the shape a payment run needs — one status for a batch is how somebody
/// pays the successful half twice.
export function Partial({
  done,
  failed,
  children,
}: {
  done: number
  failed: number
  /// The failures, listed. One row each, with its own reason and its own next
  /// action — never one summary line for all of them.
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line bg-warn-wash text-ctl text-warn-ink flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <Ban className="size-4 shrink-0" />
        <span>
          <b className="font-medium">
            {done.toLocaleString("id-ID")} succeeded,{" "}
            {failed.toLocaleString("id-ID")} did not.
          </b>{" "}
          What succeeded is done and must not be sent again. Deal with the rest
          one at a time.
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}
