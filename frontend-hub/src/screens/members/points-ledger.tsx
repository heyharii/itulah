import { useInfiniteQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Tag } from "@/components/ui/tag"
import { EmptyState, LoadMore } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  describeEntryType,
  listPointsLedger,
  pointsKeys,
  type PointsEntry,
} from "@/lib/queries/points"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import {
  CardFigure,
  CardFoot,
  CardName,
  PhoneCard,
} from "@/components/ui/phone-cards"

/// Points Ledger — every movement, newest first.
///
/// ## This is the record; Points is the summary of it
///
/// `points_account.balance_points` is a cache. These entries are what it is a
/// cache OF, and the database refuses an entry of zero — a row that moves
/// nothing explains nothing. So every line here is a real change with a cause
/// attached, and the balance next door is derivable from this list and never
/// the other way round.
///
/// ## Signed, always
///
/// An award and a reversal are drawn with their sign and their colour, not as
/// two columns and not as absolute values with a type beside them. A column of
/// positives where some of them mean the opposite is the shape that makes a
/// balance impossible to check by eye — the same rule the voucher ledger
/// follows, for the same reason.
const PAGE = 200

/// Which record caused the entry. Exactly one is set, enforced by three partial
/// unique indexes — which is also what stops one sale awarding points twice.
function causeOf(entry: PointsEntry): { what: string; id: string } | null {
  if (entry.sale_id !== null) return { what: "Sale", id: entry.sale_id }
  if (entry.return_id !== null) return { what: "Return", id: entry.return_id }
  if (entry.redemption_id !== null)
    return { what: "Redemption", id: entry.redemption_id }
  return null
}

export function PointsLedger() {
  // A phone draws a card per movement, with the signed points as the figure.
  const phone = useLayout() === "phone"
  const customer = useSheet("customer")

  /// Newest first, a page at a time as the foot of the list comes into view.
  const list = useInfiniteQuery({
    queryKey: pointsKeys.ledger(customer.value ?? null),
    queryFn: ({ pageParam, signal }) =>
      listPointsLedger(
        { customerId: customer.value ?? null, cursor: pageParam, limit: PAGE },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  const entries = useMemo(
    () => list.data?.pages.flatMap((page) => page.items) ?? [],
    [list.data]
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Members"
        title="Points Ledger"
        sub="Every points movement and what caused it. The balances on Points are a summary of this list, never the other way round."
        actions={
          customer.value === undefined || phone ? undefined : (
            <button
              type="button"
              onClick={customer.close}
              className="text-[0.875rem] text-mute underline underline-offset-2 hover:text-ink"
            >
              Show every member
            </button>
          )
        }
      />

      {customer.value !== undefined && (
        <p className="mb-4 flex items-center gap-2 text-meta text-mute">
          Narrowed to <Tag>{customer.value}</Tag>
          <AppLink to="/members/points" className="text-accent">
            Back to balances
          </AppLink>
          {phone && (
            <button
              type="button"
              onClick={customer.close}
              className="text-accent underline underline-offset-2"
            >
              Show every member
            </button>
          )}
        </p>
      )}

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(list, {
          loading: "Reading the points ledger…",
          render: () =>
            entries.length === 0 ? (
              <EmptyState>
                {customer.value === undefined
                  ? "No points have ever moved. The ledger exists and is empty — which is not the same as loyalty being switched off, and is what you would expect before the first sale awards any."
                  : "This member has no entries. Their balance, if they have one, came from nowhere — which is a fault worth reporting rather than an empty page."}
              </EmptyState>
            ) : (
              <>
                {phone ? (
                  <ul className="flex flex-col gap-2.5">
                    {entries.map((entry) => {
                      const cause = causeOf(entry)
                      return (
                        <PhoneCard
                          key={entry.entry_id}
                          head={
                            <CardName
                              name={entry.display_name ?? entry.customer_id}
                              line={
                                <>
                                  {describeEntryType(entry.entry_type)}
                                  {entry.reason !== null &&
                                    ` · ${entry.reason}`}
                                </>
                              }
                            />
                          }
                          lead={
                            <CardFigure
                              value={`${entry.points < 0 ? "−" : "+"}${count(Math.abs(entry.points))}`}
                              caption="points"
                              tone={entry.points < 0 ? "bad" : undefined}
                            />
                          }
                          foot={
                            <CardFoot>
                              {moment(entry.created_at)}
                              {cause === null ? ` · by ${entry.actor}` : ""}
                            </CardFoot>
                          }
                          action={
                            cause === null ? undefined : (
                              <Pill tone="neutral">{cause.what}</Pill>
                            )
                          }
                        />
                      )
                    })}
                  </ul>
                ) : (
                  <MiniTable
                    head={[
                      { label: "When", align: "left" },
                      "Member",
                      { label: "What", align: "left" },
                      { label: "Points", align: "right" },
                      { label: "Caused by", align: "right" },
                    ]}
                  >
                    {entries.map((entry) => (
                      <MiniRow key={entry.entry_id}>
                        <MiniCell>
                          <span className="text-[0.875rem] text-body">
                            {moment(entry.created_at)}
                          </span>
                        </MiniCell>
                        <MiniCell>
                          <span className="block truncate text-ink">
                            {entry.display_name ?? entry.customer_id}
                          </span>
                        </MiniCell>
                        <MiniCell>
                          <span className="text-body">
                            {describeEntryType(entry.entry_type)}
                          </span>
                          {entry.reason !== null && (
                            <span className="block truncate text-[0.875rem] text-mute">
                              {entry.reason}
                            </span>
                          )}
                        </MiniCell>
                        <MiniCell align="right">
                          {/* Signed and coloured, so the column reads as
                          arithmetic rather than as a list of magnitudes. */}
                          <span
                            className={
                              entry.points < 0
                                ? "text-bad tabular-nums"
                                : "text-ok tabular-nums"
                            }
                          >
                            {entry.points < 0 ? "−" : "+"}
                            {count(Math.abs(entry.points))}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          {(() => {
                            const cause = causeOf(entry)
                            return cause === null ? (
                              // An adjustment names no record, and that is exactly
                              // when the actor matters: somebody did this by hand.
                              <span className="text-[0.875rem] text-mute">
                                by {entry.actor}
                              </span>
                            ) : (
                              <span className="flex flex-col items-end leading-tight">
                                <Pill tone="neutral">{cause.what}</Pill>
                                <span className="font-mono text-[0.875rem] text-mute">
                                  {cause.id.slice(0, 8)}
                                </span>
                              </span>
                            )
                          })()}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                )}
                {/* Inside the card, which scrolls with the page — see
                  `<LoadMore>`. */}
                <LoadMore query={list} className="py-3" />
              </>
            ),
        })}
      </Card>
    </PageContent>
  )
}
