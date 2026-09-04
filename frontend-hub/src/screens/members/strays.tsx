import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { UserPlus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { ago, count, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  enrolMember,
  listUnenrolled,
  memberKeys,
  type UnenrolledRow,
} from "@/lib/queries/members"
import { queryState } from "@/lib/query-state"

/// The customer numbers a till wrote onto sales that belong to nobody.
///
/// The segment book has shown a count of these since it was built, next to a
/// sentence saying they are "the only group on this screen with an obvious
/// next action" — and then offered none. This is that action.
///
/// **Enrolling one is not a repair.** Nothing is rewritten and no sale is
/// touched: the directory joins a member to their sales on the card number, so
/// the moment the card exists the history is already attached to it. That is
/// also why the number is shown exactly as the till wrote it — enrolling a
/// tidied-up version of it would mint a third number and adopt nothing.
///
/// **Half of this list cannot be fixed and the screen has to say so.** A
/// mistyped number is one sale, at one shop, on one day, and the sale it is
/// written on is a completed sale: a shop's takings are not editable from a
/// customer screen and should not be. What this list can do about those is let
/// somebody see them, which is more than a count could.

/// Enough to work through in a sitting, and the same page the directory takes.
const PAGE = 200

/// Whether this row looks like a customer or like a slip of the finger.
///
/// Stated as a hint and never as a filter: it is a guess from two columns, and
/// a list that hid the rows it guessed were mistakes would hide exactly the
/// ones somebody needs to see.
function looksMistyped(row: UnenrolledRow): boolean {
  return row.transaction_count === 1 && row.site_count === 1
}

export function Strays({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  /// Width decides the shape below: a table needs columns and a phone has
  /// room for a list instead. See `lib/layout.ts`.
  const layout = useLayout()

  const strays = useQuery({
    queryKey: memberKeys.unenrolled(PAGE),
    queryFn: ({ signal }) => listUnenrolled(PAGE, signal),
    enabled: open,
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Named on a sale, not enrolled"
    >
      <div className="flex flex-col gap-4">
        <p className="text-[0.78125rem] leading-relaxed text-body">
          Numbers the till has written onto sales with no card enrolled against
          them. Enrolling one hands that shopper every sale it already carries —
          nothing is rewritten, because a member and their sales are joined on
          the card number.
        </p>

        {queryState(strays, {
          loading: "Reading the sales…",
          render: (data) =>
            data.strangers.length === 0 ? (
              <EmptyState>
                Every customer number on a sale belongs to an enrolled card.
                Nothing to adopt.
              </EmptyState>
            ) : (
              <>
                {/* Five columns on a desk, none on a phone. The sheet is
                    27.5rem and a card number is long: points came out because
                    "spent" already says how much is at stake, and below 48rem
                    even five will not fit — the Enrol button ends up past the
                    right edge of a sheet that does not scroll sideways, which
                    is the same as not having built it. */}
                {layout === "phone" ? (
                  <div className="flex flex-col">
                    {data.strangers.map((row) => (
                      <StrayCard key={row.customer_id} row={row} />
                    ))}
                  </div>
                ) : (
                  <MiniTable
                    head={[
                      "Number",
                      "Sales",
                      "Spent",
                      "Last seen",
                      { label: "", align: "right" },
                    ]}
                  >
                    {data.strangers.map((row) => (
                      <Stray key={row.customer_id} row={row} />
                    ))}
                  </MiniTable>
                )}
                <p className="text-[0.71875rem] leading-relaxed text-mute">
                  {count(data.unenrolled_count)} in all, holding{" "}
                  <span className="tabular-nums">
                    {money(data.unenrolled_spent_minor)}
                  </span>{" "}
                  of spend the scheme cannot see.
                  {data.strangers.length < data.unenrolled_count &&
                    ` Showing the ${count(data.strangers.length)} largest.`}{" "}
                  A number with one sale at one shop is usually a typing mistake
                  rather than a customer — and it cannot be undone from here,
                  because it is written on a sale that has been paid for.
                </p>
              </>
            ),
        })}
      </div>
    </Sheet>
  )
}

/// The act, shared by the two shapes this list takes.
///
/// Written once because a second copy of "enrol, then invalidate" is a second
/// place to forget the invalidation — and the whole point of the screen is
/// that the counts behind it move when a row is adopted.
function useAdopt(row: UnenrolledRow) {
  const client = useQueryClient()
  /// Only for the gap between the write landing and the list re-reading:
  /// once it has, this row is not a stranger any more and unmounts. Without it
  /// the button stays live in that gap — harmless, because enrolment upserts,
  /// but it reads as though nothing happened.
  const [enrolled, setEnrolled] = useState(false)

  const adopt = useMutation({
    mutationFn: () => enrolMember({ member_id: row.customer_id }),
    onSuccess: () => {
      setEnrolled(true)
      // The row belongs to the directory now, and the count on the card that
      // opened this sheet has changed. Both are the same key.
      void client.invalidateQueries({ queryKey: memberKeys.all })
    },
  })

  return { adopt, enrolled }
}

function EnrolButton({ row }: { row: UnenrolledRow }) {
  const { adopt, enrolled } = useAdopt(row)
  if (enrolled) {
    return <span className="text-[0.71875rem] text-ok-fg">Enrolled</span>
  }
  return (
    <>
      <Button
        size="sm"
        onClick={() => adopt.mutate()}
        disabled={adopt.isPending}
      >
        <UserPlus />
        Enrol
      </Button>
      <Problem error={adopt.error} className="mt-1.5 text-left" />
    </>
  )
}

/// The phone shape: a list, because a phone has room for a list and not for a
/// list's columns (`lib/layout.ts` says so in as many words).
///
/// Not a horizontally scrolling table. The one control on the row is the point
/// of the screen, and putting it off the right-hand edge behind a swipe is the
/// same as not having built it.
function StrayCard({ row }: { row: UnenrolledRow }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-hairline py-3">
      {/* `items-start`, or the tag stretches to the column and a six-character
          card number arrives as a pill the width of the phone. */}
      <div className="flex min-w-0 flex-col items-start gap-1">
        <Tag>{row.customer_id}</Tag>
        <span className="text-[0.71875rem] text-body tabular-nums">
          {count(row.transaction_count)}
          {row.transaction_count === 1 ? " sale" : " sales"} ·{" "}
          {money(row.spent_minor)} · {ago(row.last_purchase_at)}
        </span>
        {looksMistyped(row) && (
          <span className="text-[0.71875rem] text-mute">
            One shop, once — probably a typing mistake.
          </span>
        )}
      </div>
      <div className="shrink-0 text-right">
        <EnrolButton row={row} />
      </div>
    </div>
  )
}

function Stray({ row }: { row: UnenrolledRow }) {
  return (
    <MiniRow>
      <MiniCell>
        {/* Stacked, not inline: a card number is already wide, and a note
            beside it pushes every figure in the row onto a second line. */}
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <Tag>{row.customer_id}</Tag>
          {looksMistyped(row) && (
            <span className="text-[0.71875rem] whitespace-nowrap text-mute">
              one shop, once
            </span>
          )}
        </span>
      </MiniCell>
      <MiniCell align="right">{count(row.transaction_count)}</MiniCell>
      <MiniCell align="right" className="whitespace-nowrap">
        {money(row.spent_minor)}
      </MiniCell>
      <MiniCell align="right" className="whitespace-nowrap">
        {ago(row.last_purchase_at)}
      </MiniCell>
      <MiniCell align="right">
        <EnrolButton row={row} />
      </MiniCell>
    </MiniRow>
  )
}
