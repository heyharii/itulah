import { cn } from "@/lib/cn"

/// A screen's head and its toolbar.
///
/// Lifted out of `modules/finance/money.tsx` once a second screen needed the
/// same three rows, and no earlier. The shape here is that screen's, verbatim:
/// it was looked at and signed off, so it is the thing to copy rather than a
/// fresh idea about what a header should be.
///
/// ## Why the module name sits above the title
///
/// The sidebar already says which module is open, so the eyebrow is not
/// navigation — it is what makes the heading readable out of context. A screen
/// linked to from Overview, or landed on from a pasted URL, opens with
/// "Payables & Expenses / Supplier bills" and the reader knows where they are
/// without looking left.
///
/// ## Why the description is one sentence and always there
///
/// Two screens in this module are called "Payments" and "Payment queue", and
/// the difference between them is not in their names — it is that one holds
/// instructions that have not moved money and the other holds money that has
/// moved. A title cannot carry that. A sentence can, and it is read once.

export function PageHead({
  module,
  title,
  description,
  action,
}: {
  /// The module, for the eyebrow. Not a link: the sidebar is the way back and
  /// a second route to the same place is a second thing to keep in step.
  module: string
  title: string
  description: string
  /// The one primary action, or none.
  ///
  /// Singular on purpose. A header with three buttons has no primary action,
  /// it has three equal ones — and the screen has stopped saying what it is
  /// for. Everything else belongs on a row, in the toolbar, or behind More.
  action?: React.ReactNode
}) {
  return (
    <header className="border-line flex items-start gap-3 border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-meta text-ink-3">{module}</div>
        <h1 className="text-title font-semibold">{title}</h1>
        <p className="text-ctl text-ink-3 mt-0.5">{description}</p>
      </div>
      {action}
    </header>
  )
}

/// The row under the head: what narrows the list, and what says how much of it
/// is loaded.
///
/// ## Why `trailing` is a slot rather than a count prop
///
/// Because what belongs at the right end is not the same question on every
/// screen. A paged list says "50 of 1,284 loaded"; a reconciliation says how
/// many lines are still unmatched; a matrix says which version it is drawn
/// from. One prop called `count` would have made two of those lie.
export function Toolbar({
  children,
  trailing,
  className,
}: {
  children: React.ReactNode
  trailing?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "border-line flex shrink-0 items-center gap-2 border-b px-4 py-2",
        className,
      )}
    >
      {children}
      {trailing !== undefined && (
        <span className="text-ctl text-ink-4 ml-auto tabular-nums">
          {trailing}
        </span>
      )}
    </div>
  )
}

/// How much of a paged list is on screen.
///
/// Its own function because the sentence has to be exactly this one everywhere.
/// "50 of 1,284" and "showing 50" are different promises: the first says the
/// total is known and the list is not finished, the second says nothing about
/// what is missing. Every list here can make the first promise — the server
/// returns the matched total with the page — so every list makes it.
export function Loaded({
  loaded,
  total,
  pending,
  noun = "rows",
}: {
  loaded: number
  total: number
  pending?: boolean
  noun?: string
}) {
  if (pending) return <>Loading…</>
  return (
    <>
      {loaded.toLocaleString("id-ID")} of {total.toLocaleString("id-ID")} {noun}{" "}
      loaded
    </>
  )
}
