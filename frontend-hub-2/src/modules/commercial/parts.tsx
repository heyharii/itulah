import { AlertTriangle } from "lucide-react"

import { cn } from "@/lib/cn"

/// The marks this module draws more than once.
///
/// Components only — the vocabularies are next door in `labels.ts`, which has
/// no JSX in it and can therefore be read from a column definition without
/// dragging a component graph along.
///
/// ## A debt, named rather than hidden
///
/// `Facts`, `Fact`, `SubHead`, `Line` and `Quiet` below are the THIRD copy of
/// themselves in this app: `modules/people/parts.tsx` has one and
/// `modules/finance/money.tsx` has another. The house rule is promote on second
/// use — it is how `Switch` left the old app's commercial folder — and it has
/// now been missed twice. They belong in `kit/`, and moving them there edits
/// two modules this one does not own, which is a change to make deliberately
/// rather than as a side effect of adding a third module. Written down so the
/// next person finds a decision instead of a coincidence.

/// Something that is absent, drawn as absent.
///
/// Grey, always, so a column of them recedes and the rows that DO carry a value
/// are what the eye lands on.
export function Quiet({ children = "—" }: { children?: React.ReactNode }) {
  return <span className="text-ink-4">{children}</span>
}

/// A proportion of something with a ceiling — a budget spent, a card used up.
///
/// ## Why this is not offered a value for "unlimited"
///
/// Because there is no honest way to draw one. `null` budget means there is no
/// line to cross, and both available drawings are lies: a full bar says the
/// money has run out, an empty one says there is plenty left. So the caller
/// decides — every one of them prints the amount and the words "no limit"
/// instead — and this component simply cannot be asked the question.
export function Meter({
  share,
  className,
}: {
  /// 0–1. Clamped rather than trusted: a rule that overspent its budget
  /// reports more than its own limit, which is a real state and not a reason
  /// for a bar to run off the end of its track.
  share: number
  className?: string
}) {
  const filled = Math.max(0, Math.min(1, share))
  return (
    <span
      className={cn(
        "bg-field rounded-tag inline-block h-1.5 w-12 shrink-0 overflow-hidden",
        className,
      )}
      aria-hidden
    >
      <span
        className="rounded-tag block h-full"
        style={{
          width: `${filled * 100}%`,
          background:
            share >= 1
              ? "var(--bad)"
              : share >= 0.7
                ? "var(--warn)"
                : "var(--ok)",
        }}
      />
    </span>
  )
}

/// The list you are reading stops short, and the endpoint CAN say by how much.
///
/// Deliberately not `kit/notice.tsx`'s `Truncated`, whose sentence is "this
/// endpoint returns no total and no way to page". Half of that is false here:
/// `GET /commercial/article-prices` answers `total_article_count` over the same
/// narrowing, so the screen knows exactly what it is missing. What it still
/// cannot do is fetch the rest — there is no cursor — so the honest sentence is
/// a different one, and reusing the kit's would have told the reader the
/// endpoint is worse than it is.
export function Capped({
  shown,
  matched,
  noun,
  caveat,
}: {
  shown: number
  matched: number
  noun: string
  /// One more clause, where the total itself needs qualifying.
  caveat?: React.ReactNode
}) {
  return (
    <div
      role="status"
      className="border-warn/40 bg-warn-wash text-warn-ink text-ctl flex shrink-0 items-center gap-2 border-b px-4 py-2"
    >
      <AlertTriangle className="size-4 shrink-0" />
      <span className="min-w-0">
        Showing {shown.toLocaleString("id-ID")} of{" "}
        {matched.toLocaleString("id-ID")} {noun}. This endpoint has no cursor,
        so the rest cannot be fetched —{" "}
        <b className="font-medium">narrow the search to see them.</b> {caveat}
      </span>
    </div>
  )
}

/// A record's fields, inside a sheet.
///
/// A description list rather than a grid of divs, because that is what it is:
/// somebody reading with a screen reader gets "Budget, Rp 50.000.000" as one
/// utterance instead of two unrelated strings.
export function Facts({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-[18px] py-4">
      {children}
    </dl>
  )
}

export function Fact({
  label,
  children,
  wide,
}: {
  label: string
  children: React.ReactNode
  /// Across both columns, for a sentence rather than a value.
  wide?: boolean
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-label text-ink-4">{label}</dt>
      <dd className="text-cell text-ink-2 m-0 mt-0.5">{children}</dd>
    </div>
  )
}

/// A heading inside a sheet, over a list that is not the record itself — the
/// shops behind a style, the movements behind a card.
export function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-line bg-side text-meta text-ink-3 border-y px-[18px] py-1.5 font-medium">
      {children}
    </h2>
  )
}

/// One line of such a list.
export function Line({
  children,
  note,
  dim,
}: {
  children: React.ReactNode
  /// The reason, the date, the book — whatever the line is evidence of.
  note?: React.ReactNode
  /// A losing candidate. Dimmed rather than dropped: "why is it this price" is
  /// answered by what it beat, and a stack with the losers removed answers
  /// nothing.
  dim?: boolean
}) {
  return (
    <div
      className={cn(
        "border-line border-b px-[18px] py-2.5 last:border-b-0",
        dim && "opacity-55",
      )}
    >
      <div className="text-cell text-ink-2 flex items-baseline gap-3">
        {children}
      </div>
      {note !== undefined && (
        <div className="text-label text-ink-4 mt-0.5">{note}</div>
      )}
    </div>
  )
}

/// An offer as somebody will have to read it: a headline, the terms under it,
/// and — set apart — the limits a shopper is never told about.
///
/// **The last block is the honest half.** A budget, a use cap and a priority
/// are real and they are invisible: nobody at the counter is told the offer
/// stopped because a number in the centre ran out. Putting them in the same
/// numbered list as the terms is what made the preview this replaces read as a
/// promise.
export function Terms({
  headline,
  clauses,
  hidden,
  empty,
}: {
  /// The offer in three or four words — "20% off", "Rp 50.000 each".
  headline: React.ReactNode
  clauses: readonly string[]
  hidden: readonly string[]
  empty: string
}) {
  return (
    <div className="border-line-2 bg-side rounded-card mx-[18px] my-4 border px-3.5 py-3">
      <div className="text-metric text-ink mb-2 font-semibold">{headline}</div>

      {clauses.length === 0 ? (
        <p className="text-ctl text-ink-3 m-0">{empty}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {clauses.map((clause, index) => (
            <li key={index} className="text-ctl text-ink-2 flex gap-2">
              <span className="text-ink-4 shrink-0 tabular-nums">
                {index + 1}.
              </span>
              <span className="min-w-0">{clause}</span>
            </li>
          ))}
        </ol>
      )}

      {hidden.length > 0 && (
        <p className="border-line text-ctl text-ink-4 m-0 mt-2.5 border-t pt-2.5">
          A shopper is never told any of this: {hidden.join("; ")}.
        </p>
      )}
    </div>
  )
}
