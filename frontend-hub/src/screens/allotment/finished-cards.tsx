import { useQueries } from "@tanstack/react-query"
import { useState } from "react"

import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { count, dayMonth } from "@/lib/format"
import {
  allotmentDetail,
  inventoryKeys,
  type AllotmentLine,
  type AllotmentRow,
} from "@/lib/queries/inventory"
import { cn } from "@/lib/utils"
import { cancelOf, floorOf, storesOf } from "@/screens/allotment/amend-data"
import { STAMP } from "@/screens/procurement/shared"

/// **Completed and Cancelled as cards: the In progress card, finished**
/// (allotment-finished-cards.html, option A, owner 17 Oct 2026: "yg di
/// highlight tetap suppliernya, pcsnya, storenya, articlenya").
///
/// Supplier on top with the number and the day under it; on a cancelled one
/// MD's reason under that. The pieces stand on the right beside the stamp. The
/// articles are one line of names; each store is a tile with its own pieces.
/// Nothing is struck through: the stamp already says it is cancelled
/// (owner, 17 Oct 2026).

/// What an allotment that is over is called: cancelled by MD, some of it was
/// closed, a store received less than was sent, or it was received in full.
///
/// A cancel MD made on a cloud-owned allotment is "Cancelled" whatever was
/// picked — what was picked is the warehouse's to move back, not a remainder.
/// A DC-owned one keeps the old reading: nothing picked is "Cancelled", the
/// rest "Closed short". A store receipt below what was sent (214 of 220) is
/// "Received short", never "Completed", and wins over a closed remainder: it is
/// what happened at the store, the other is what MD decided.
function endedWord(row: AllotmentRow): string {
  if (row.status === "CANCELLED" || row.status === "REJECTED") {
    return row.activation_target_origin_id === null ||
      (row.total_picked_quantity === 0 && row.received_qty === 0)
      ? "Cancelled"
      : "Closed short"
  }
  if (row.receiving_gap_qty > 0) return "Received short"
  return row.closed_short_qty > 0 ? "Closed short" : "Completed"
}

/// A finished allotment's status, pressed on like the rubber stamp a finished
/// order wears in Procurement: the word over the day it was reached. Completed
/// is ok, a closed remainder wants a look, received short is red and a
/// cancelled one is quiet.
export function EndedStamp({ row }: { row: AllotmentRow }) {
  const word = endedWord(row)
  return (
    <span
      className={cn(
        STAMP,
        word === "Completed" && "text-ok-fg",
        word === "Closed short" && "text-warn-fg",
        word === "Received short" && "text-bad-fg",
        word === "Cancelled" && "text-mute"
      )}
    >
      {word}
      <span className="block tabular-nums">{dayMonth(row.updated_at)}</span>
    </span>
  )
}

/// A long finished book reads its cards a page at a time: each card reads its
/// allotment's lines.
const PAGE = 20

/// What these lines meant to deliver when MD allotted them.
function allottedOf(lines: readonly AllotmentLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0)
}

/// What left the warehouse for these lines: on a delivery note or beyond.
function sentOf(lines: readonly AllotmentLine[]): number {
  return lines.reduce((sum, line) => sum + floorOf(line), 0)
}

/// What the stores counted in.
function receivedOf(lines: readonly AllotmentLine[]): number {
  return lines.reduce((sum, line) => sum + line.received_quantity, 0)
}

/// The article names, in name order, said once each.
function articlesOf(lines: readonly AllotmentLine[]): string[] {
  return [...new Set(lines.map((line) => line.article_name))].sort((a, b) =>
    a.localeCompare(b)
  )
}

export function FinishedCards({
  rows,
  cancelled,
  stores,
  onOpen,
}: {
  rows: readonly AllotmentRow[]
  /// The Cancelled tab: pieces are what was called off, and the reason shows.
  cancelled: boolean
  stores: readonly { value: string; label: string }[]
  onOpen: (id: string) => void
}) {
  const [limit, setLimit] = useState(PAGE)
  const visible = rows.slice(0, limit)
  const details = useQueries({
    queries: visible.map((row) => ({
      queryKey: inventoryKeys.allotment(row.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        allotmentDetail(row.id, signal),
      staleTime: 60_000,
    })),
  })
  const shop = useShopName()
  const storeLabel = (id: string, fallback: string) => {
    const named = shop(id)
    return named !== id
      ? named
      : (stores.find((one) => one.value === id)?.label ?? fallback)
  }

  return (
    <div className="flex flex-col gap-3">
      {visible.map((row, index) => {
        const record = details[index]?.data
        const lines = record?.lines
        const reason = record === undefined ? null : cancelOf(record).reason
        // The dialog's own word when no reason was picked says nothing.
        const why = reason === null || reason === "Cancelled" ? null : reason

        const allotted =
          lines === undefined ? row.total_quantity : allottedOf(lines)
        const sent = lines === undefined ? null : sentOf(lines)
        const received =
          lines === undefined ? row.received_qty : receivedOf(lines)
        const pieces = cancelled ? allotted : received
        const under = cancelled
          ? sent !== null && sent > 0
            ? `${count(sent)} already dispatched`
            : null
          : row.receiving_gap_qty > 0
            ? `of ${count(received + row.receiving_gap_qty)} sent`
            : received < allotted
              ? `of ${count(allotted)} allotted`
              : null

        const articles = lines === undefined ? [] : articlesOf(lines)
        const names =
          articles.length > 3
            ? `${articles.slice(0, 3).join(", ")} +${articles.length - 3}`
            : articles.join(", ")
        const mine = lines === undefined ? [] : storesOf(lines)

        return (
          <article
            key={row.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(row.id)}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget && event.key === "Enter")
                onOpen(row.id)
            }}
            className="flex cursor-pointer flex-col gap-3.5 rounded-card border border-hairline bg-canvas px-5 py-4 text-left shadow-soft transition-[border-color] duration-(--t-press) ease-(--ease-out) outline-none hover:border-hairline-strong focus-visible:ring-2 focus-visible:ring-accent/40 max-md:px-3.5 max-md:py-3.5"
          >
            <span className="flex items-start justify-between gap-4">
              <span className="flex min-w-0 flex-col">
                <span className="text-[1.0625rem] leading-6 font-semibold [overflow-wrap:anywhere] text-ink">
                  {row.supplier_names ?? "No supplier"}
                </span>
                <span className="text-[0.9375rem] text-body">
                  <span className="font-mono">{row.allotment_number}</span> ·{" "}
                  {dayMonth(row.created_at)}
                </span>
                {cancelled && why !== null && (
                  <span className="inline-flex items-baseline gap-2 text-[0.9375rem] [overflow-wrap:anywhere] text-ink">
                    <i
                      aria-hidden
                      className="inline-block size-1.5 shrink-0 -translate-y-0.5 rounded-full bg-bad-fg"
                    />
                    {why}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-6">
                <span className="max-md:hidden">
                  <EndedStamp row={row} />
                </span>
                <span className="flex flex-col items-end text-right">
                  <span className="text-xl leading-[1.625rem] font-bold whitespace-nowrap text-ink tabular-nums">
                    {count(pieces)}{" "}
                    <span className="text-[0.9375rem] font-medium text-body">
                      pcs
                    </span>
                  </span>
                  {under !== null && (
                    <span className="text-[0.9375rem] whitespace-nowrap text-warn-fg tabular-nums">
                      {under}
                    </span>
                  )}
                </span>
              </span>
            </span>

            {articles.length > 0 && (
              <span className="text-[0.9375rem] text-body">
                {articles.length === 1
                  ? "1 article"
                  : `${count(articles.length)} articles`}{" "}
                · {names}
              </span>
            )}

            {mine.length > 0 && (
              <span className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-2 max-md:grid-cols-2">
                {mine.map((one) => {
                  const full = storeLabel(one.id, one.name)
                  const code = full.split(" · ")[0] ?? full
                  const storeSent = sentOf(one.lines)
                  const storeGot = receivedOf(one.lines)
                  const gap = one.lines.reduce(
                    (sum, line) => sum + line.receiving_gap_qty,
                    0
                  )
                  return (
                    <span
                      key={one.id}
                      className="flex items-center justify-between gap-2 rounded-inner bg-soft px-3 py-2 text-[0.9375rem]"
                    >
                      <span
                        className={cn(
                          "min-w-0 truncate font-medium",
                          cancelled && storeSent === 0
                            ? "text-mute"
                            : "text-ink"
                        )}
                        title={full}
                      >
                        <span className="max-md:hidden">{full}</span>
                        <span className="md:hidden">{code}</span>
                      </span>
                      <span className="whitespace-nowrap text-body tabular-nums">
                        {cancelled ? (
                          storeSent > 0 ? (
                            `${count(storeSent)} sent`
                          ) : (
                            count(allottedOf(one.lines))
                          )
                        ) : gap > 0 ? (
                          <span className="text-warn-fg">
                            {count(storeGot)} of {count(storeGot + gap)}
                          </span>
                        ) : (
                          count(storeGot)
                        )}
                      </span>
                    </span>
                  )
                })}
              </span>
            )}

            <span className="flex justify-end md:hidden">
              <EndedStamp row={row} />
            </span>
          </article>
        )
      })}

      {rows.length > limit && (
        <Button
          variant="ghost"
          className="self-center"
          onClick={() => setLimit((now) => now + PAGE)}
        >
          Show {count(Math.min(PAGE, rows.length - limit))} more
        </Button>
      )}
    </div>
  )
}
