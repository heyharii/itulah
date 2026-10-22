import { useQuery } from "@tanstack/react-query"

import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"
import { count, countPcs } from "@/lib/format"
import { allotmentDetail, inventoryKeys } from "@/lib/queries/inventory"
import type { DcReview, StoreReview } from "@/screens/allotment/review-data"

/// **MD's In review tab** (allotment-review-flow.html, owner 17–18 Oct 2026).
///
/// Grouped by where the goods stopped, because the two never share a word:
/// **At the DC** — a pick that could not go on, "2 pcs not picked" — and,
/// once the stores send what they counted, **At the store** — "Count
/// differs". One card per allotment × store, its one main act Review; Edit,
/// a ghost before it, opens the allotment in the matrix as on In progress.

const CARD =
  "flex cursor-pointer flex-col gap-3.5 rounded-card border border-hairline bg-canvas px-5 py-4 text-left shadow-soft transition-[border-color] duration-(--t-press) ease-(--ease-out) outline-none hover:border-hairline-strong focus-visible:ring-2 focus-visible:ring-accent/40 max-md:px-3.5 max-md:py-3.5"
const TAG =
  "inline-flex h-[1.625rem] items-center rounded-[0.4375rem] px-2.5 font-medium whitespace-nowrap"

export function InReview({
  dc,
  store,
  loading,
  onReview,
  onStoreReview,
  onEdit,
}: {
  dc: readonly DcReview[] | undefined
  store: readonly StoreReview[] | undefined
  loading: boolean
  /// Whose goods an allotment carries — the card's title, as on In progress.
  supplierOf: (allotmentId: string) => string | null
  onReview: (review: DcReview) => void
  onStoreReview: (review: StoreReview) => void
  onEdit: (allotmentId: string) => void
}) {
  const shop = useShopName()
  if (dc === undefined && store === undefined)
    return (
      <Card>
        <EmptyState>{loading ? "Loading…" : "Nothing to review."}</EmptyState>
      </Card>
    )
  if ((dc?.length ?? 0) + (store?.length ?? 0) === 0)
    return (
      <Card>
        <EmptyState>Nothing to review.</EmptyState>
      </Card>
    )
  return (
    <div className="flex flex-col gap-3">
      {(dc ?? []).map((review) => {
        const articles = [
          ...new Set(review.lines.map((line) => line.article_name)),
        ]
        return (
          <article
            key={review.key}
            role="button"
            tabIndex={0}
            onClick={() => onReview(review)}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget && event.key === "Enter")
                onReview(review)
            }}
            className="flex cursor-pointer flex-col gap-3.5 rounded-card border border-hairline bg-canvas px-5 py-4 text-left shadow-soft transition-[border-color] duration-(--t-press) ease-(--ease-out) outline-none hover:border-hairline-strong focus-visible:ring-2 focus-visible:ring-accent/40 max-md:px-3.5 max-md:py-3.5"
          >
            {/* As the trip card (owner, 20 Oct 2026): the allotment at the
                left with what the Gudang wrote, the store at the right in
                the same small table. */}
            <span className="grid items-start gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)]">
              <span className="flex min-w-0 flex-col">
                <span className="text-[1.0625rem] leading-6 font-semibold text-ink">
                  <span className="font-mono">{review.allotment_number}</span>
                </span>
                <span className="text-[0.9375rem] text-body">
                  {articles[0]}
                  {articles.length > 1 && ` +${count(articles.length - 1)}`}
                </span>
                {review.reason !== "" && (
                  <span className="mt-1.5 text-[0.9375rem] text-ink">
                    “{review.reason}”
                  </span>
                )}
              </span>
              <span className="block overflow-hidden rounded-inner border border-hairline text-[0.9375rem]">
                <span className="grid grid-cols-[8.5rem_minmax(0,1fr)_7.5rem] items-center gap-x-2.5 bg-soft px-3 py-1.5 text-mute">
                  <span>Status</span>
                  <span>Stores</span>
                  <span className="text-right">Pcs</span>
                </span>
                <span className="grid grid-cols-[8.5rem_minmax(0,1fr)_7.5rem] items-center gap-x-2.5 border-t border-hairline px-3 py-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-body">
                    <i aria-hidden className="inline-block size-2 shrink-0 rounded-full bg-warn-fg" />
                    Cannot pick
                  </span>
                  <span className="min-w-0 text-ink">
                    {shop(review.store_id).split(" · ")[0]}
                  </span>
                  <span className="text-right whitespace-nowrap tabular-nums">
                    <span className="font-semibold text-warn-fg">
                      {count(review.short)}
                    </span>
                    <span className="text-body"> not picked</span>
                  </span>
                </span>
              </span>
            </span>
            <span className="flex items-center justify-end gap-2 max-md:flex-wrap">
              <span className="flex gap-2 max-md:w-full max-md:[&>button]:flex-1">
                <Button
                  variant="ghost"
                  size="card"
                  onClick={(event) => {
                    event.stopPropagation()
                    onEdit(review.allotment_id)
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="primary"
                  size="card"
                  onClick={(event) => {
                    event.stopPropagation()
                    onReview(review)
                  }}
                >
                  Review
                </Button>
              </span>
            </span>
          </article>
        )
      })}
      {(store ?? []).map((review) => {
        const first = review.allotments[0]
        return (
          <article
            key={review.dispatch_id}
            role="button"
            tabIndex={0}
            onClick={() => onStoreReview(review)}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget && event.key === "Enter")
                onStoreReview(review)
            }}
            className={CARD}
          >
            {/* As an allotment card (owner, 20 Oct 2026): the delivery at
                the left with what differs, every store at the right with
                what it was sent and what it counted. */}
            <span className="grid items-start gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)]">
              <span className="flex min-w-0 flex-col">
                {/* One card per trip (owner, 20 Oct 2026): the trip is the
                    title; its allotments under it. */}
                <span className="text-[1.0625rem] leading-6 font-semibold text-ink">
                  Trip <span className="font-mono">{review.dispatch_number}</span>
                </span>
                {/* The trip's allotments, one under the other, each with
                    the pieces it sent (owner, 20 Oct 2026). */}
                <span className="mt-1.5 flex flex-col">
                  {review.allotments.map((one) => (
                    <TripAllotment
                      key={one.allotment_id}
                      id={one.allotment_id}
                      number={one.allotment_number}
                    />
                  ))}
                </span>
              </span>
              {/* D5 · By status, as on the allotment card: what each store
                  got against what it was sent (owner, 20 Oct 2026: "Short"
                  alone said nothing). */}
              <span className="block overflow-hidden rounded-inner border border-hairline text-[0.9375rem]">
                <span className="grid grid-cols-[8.5rem_minmax(0,1fr)_7.5rem] items-center gap-x-2.5 bg-soft px-3 py-1.5 text-mute">
                  <span>Status</span>
                  <span>Stores</span>
                  <span className="text-right">Received</span>
                </span>
                {(() => {
                  const groups = new Map<
                    string,
                    {
                      key: string
                      dot: string
                      codes: string[]
                      sent: number
                      got: number
                      waiting: boolean
                    }
                  >()
                  for (const one of review.stores) {
                    const waiting = one.counted === null
                    const diff = (one.counted ?? 0) - one.sent
                    const [key, dot] = waiting
                      ? ["Waiting", "bg-mute"]
                      : diff < 0
                        ? ["Short", "bg-bad-fg"]
                        : diff > 0
                          ? ["Extra", "bg-warn-fg"]
                          : ["Received", "bg-ok-fg"]
                    const group = groups.get(key) ?? {
                      key,
                      dot,
                      codes: [],
                      sent: 0,
                      got: 0,
                      waiting,
                    }
                    group.codes.push(shop(one.store_id).split(" · ")[0] ?? one.store_id)
                    group.sent += one.sent
                    group.got += one.counted ?? 0
                    groups.set(key, group)
                  }
                  return [...groups.values()].map((group) => {
                    const gap = group.got - group.sent
                    const word =
                      group.key === "Short"
                        ? `Short ${count(-gap)}`
                        : group.key === "Extra"
                          ? `Extra ${count(gap)}`
                          : group.key === "Waiting"
                            ? "Not received yet"
                            : "Received"
                    return (
                      <span
                        key={group.key}
                        className="grid grid-cols-[8.5rem_minmax(0,1fr)_7.5rem] items-center gap-x-2.5 border-t border-hairline px-3 py-2"
                      >
                        <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-body">
                          <i aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${group.dot}`} />
                          {word}
                        </span>
                        <span className="min-w-0 text-ink tabular-nums">
                          {group.codes.join(", ")}
                        </span>
                        <span className="text-right whitespace-nowrap tabular-nums">
                          {group.waiting ? (
                            <span className="text-body">
                              {countPcs(group.sent)} sent
                            </span>
                          ) : (
                            <>
                              <span className="font-semibold text-ink">
                                {count(group.got)}
                              </span>
                              <span className="text-body">
                                {" "}of {countPcs(group.sent)}
                              </span>
                            </>
                          )}
                        </span>
                      </span>
                    )
                  })
                })()}
              </span>
            </span>
            <span className="flex items-center justify-end gap-2 max-md:flex-wrap">
              <span className="flex gap-2 max-md:w-full max-md:[&>button]:flex-1">
                {first && (
                  <Button
                    variant="ghost"
                    size="card"
                    onClick={(event) => {
                      event.stopPropagation()
                      onEdit(first.allotment_id)
                    }}
                  >
                    Edit
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="card"
                  onClick={(event) => {
                    event.stopPropagation()
                    onStoreReview(review)
                  }}
                >
                  Review
                </Button>
              </span>
            </span>
          </article>
        )
      })}
    </div>
  )
}

/// One allotment of a trip: its number and the pieces it sent.
function TripAllotment({ id, number }: { id: string; number: string }) {
  const detail = useQuery({
    queryKey: inventoryKeys.allotment(id),
    queryFn: ({ signal }) => allotmentDetail(id, signal),
    staleTime: 30_000,
  })
  const sent = (detail.data?.lines ?? []).reduce(
    (sum, line) => sum + line.dispatched_quantity,
    0
  )
  return (
    <span className="grid w-fit grid-cols-[auto_4.5rem] items-center gap-x-4 py-0.5 text-[0.9375rem]">
      <span className="font-mono text-body">{number}</span>
      <span className="text-right font-semibold text-ink tabular-nums">
        {detail.data === undefined ? "…" : countPcs(sent)}
      </span>
    </span>
  )
}
