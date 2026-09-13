import { CalendarDays } from "lucide-react"

import { day } from "@/lib/format"

/// What the figures on this screen COVER, said in words.
///
/// ## Why this is a component and not a sentence somebody writes each time
///
/// Because there are exactly three answers and they are routinely confused,
/// including by people who know the difference:
///
///   **during** — a period. Movements. "Transactions during September" — what
///     happened between two dates. Sum it and you get a flow.
///   **as at** — a day. A position. "Outstanding as at 11 Sep" — what is true
///     at one instant. Sum it and you get a balance.
///   **projection** — a future range. Neither of the above, and the only one
///     of the three that is not a fact.
///
/// A payables list, an ageing report and a cash forecast all draw money in a
/// column of the same width, and the reader is entitled to know which of the
/// three they are reading without inferring it from the screen's name. Written
/// freehand, the three drift into one phrase — "September figures" — which is
/// true of all three and useful for none.
///
/// The second thing this fixes is quieter. An ageing column is a function of
/// the as-at date, not a property of the bill, and a screen that does not say
/// what date it is standing on invites somebody to read yesterday's ageing as
/// today's.

export type Scope =
  | { readonly kind: "during"; readonly period: string }
  | { readonly kind: "asAt"; readonly date: string }
  | { readonly kind: "projection"; readonly from: string; readonly to: string }

/// The strip. Deliberately plain text on the page's own ground, not a chip or
/// a banner: it is a caption for everything below it, and a boxed caption
/// reads as a message that can be dismissed.
export function ScopeLine({
  scope,
  unit,
  note,
  measure = "IDR",
}: {
  scope: Scope
  /// Which unit the figures cover, if the screen is scoped to one. "Every unit
  /// you reach" when it is not — an unstated scope reads as "everything",
  /// which for somebody whose role reaches two stores is wrong.
  unit?: string
  /// One more clause, where the screen has a second thing worth saying: the
  /// forecast version, the basis of a valuation.
  note?: React.ReactNode
  /// What the figures below are COUNTED IN. Rupiah unless a screen says
  /// otherwise.
  ///
  /// Added for Inventory, where the default would have been a lie rather than
  /// a default: **no inventory route carries a cost, a price or a currency** —
  /// the ledger holds pieces and nothing prices them — so a strip stamped `IDR`
  /// over a column of piece counts invites somebody to read a warehouse total
  /// as a valuation. A screen whose figures are not money says which unit they
  /// are in, in the one place that already answers "what do these numbers
  /// cover".
  measure?: string
}) {
  return (
    <div className="border-line bg-side flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-1.5">
      <span className="text-ctl text-ink-3 flex items-center gap-1.5">
        <CalendarDays className="text-ink-4 size-3.5 shrink-0" />
        {phrase(scope)}
      </span>
      <span className="text-ctl text-ink-3">
        {unit ? (
          <>
            Unit <b className="text-ink-2 font-medium">{unit}</b>
          </>
        ) : (
          "Every unit you reach"
        )}
      </span>
      {note !== undefined && (
        <span className="text-ctl text-ink-4">{note}</span>
      )}
      <span className="text-ctl text-ink-4 ml-auto">{measure}</span>
    </div>
  )
}

/// The three sentences, in one place so they cannot be paraphrased apart.
function phrase(scope: Scope): React.ReactNode {
  switch (scope.kind) {
    case "during":
      return (
        <>
          Transactions <b className="text-ink-2 font-medium">during</b>{" "}
          {scope.period}
        </>
      )
    case "asAt":
      return (
        <>
          Position <b className="text-ink-2 font-medium">as at</b>{" "}
          {day(scope.date)}
        </>
      )
    case "projection":
      return (
        <>
          <b className="text-ink-2 font-medium">Projection</b> {scope.from} —{" "}
          {scope.to}
        </>
      )
  }
}
