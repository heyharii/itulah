import { useQueries } from "@tanstack/react-query"

import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { count, dayMonth } from "@/lib/format"
import {
  allotmentDetail,
  inventoryKeys,
  type AllotmentDetail,
  type AllotmentLine,
  type AllotmentRow,
} from "@/lib/queries/inventory"
import {
  roomOf,
  stagesOf,
  storesOf,
  targetOf,
} from "@/screens/allotment/amend-data"

/// **MD's In progress list: one card per allotment — what MD allotted in one
/// go from one delivery — never article by article** (allotment-ops-prototype,
/// approved 15 Oct 2026).
///
/// Simple (owner, 16 Oct 2026): supplier, number, pieces; one tile per store
/// with the word of where its goods are; Cancel (red) and Edit (blue) on the
/// foot open the allotment's sheet ready to cancel or edit.
///
/// A store's own slice comes from the allotment's lines — the same read, and
/// the same cache entry, as its sheet, so the card and the sheet cannot say
/// two things. The by-store book is no use here: its rows carry the WHOLE
/// allotment's totals, so every store of a split allotment read the same
/// word (17 Oct 2026: C001 dispatched and C002 cancelled both said Picking).

/// The stage colours of the store tiles' dots.
const STAGE_COLOUR = {
  toPick: "#dcdce1",
  picked: "#e9c88f",
  packed: "#c9892e",
  dispatched: "#2f86d8",
  received: "#36b827",
} as const

/// The pieces these lines still mean to deliver. MD's edit and cancel on a
/// cloud-run allotment lower the target; a DC node's cancel leaves the target
/// and counts the pieces as cancelled — both come off here.
function wantedOf(lines: readonly AllotmentLine[]): number {
  return lines.reduce(
    (sum, line) => sum + Math.max(0, targetOf(line) - line.cancelled_quantity),
    0
  )
}

/// The card's pieces before its lines have arrived: the row's own totals,
/// where MD's edits are only counted as closed short.
function wantedOfRow(row: AllotmentRow): number {
  return Math.max(
    0,
    row.total_quantity -
      Math.max(row.total_cancelled_quantity, row.closed_short_qty)
  )
}

/// One store's word: the least-done stage it still has goods in.
function storeStage(lines: readonly AllotmentLine[]): [string, string] {
  const wanted = wantedOf(lines)
  if (wanted === 0) return ["Cancelled", STAGE_COLOUR.toPick]
  const s = stagesOf(lines)
  if (s.toPick >= wanted) return ["To pick", STAGE_COLOUR.toPick]
  if (s.toPick > 0) return ["Picking", STAGE_COLOUR.picked]
  if (s.picked > 0) return ["Picked", STAGE_COLOUR.picked]
  if (s.packed > 0) return ["Packed", STAGE_COLOUR.packed]
  const onWay = lines.some(
    (line) =>
      line.at_shipment_qty + line.at_loaded_qty + line.at_in_transit_qty > 0
  )
  if (onWay) return ["Dispatched", STAGE_COLOUR.dispatched]
  return ["Received", STAGE_COLOUR.received]
}

/// Nothing is left that is not dispatched: no cancel. The sheet's own rule
/// (`allSent` in allotments.tsx), so the card never offers what the sheet
/// then refuses.
function allSentOf(record: AllotmentDetail): boolean {
  return record.activation_target_origin_id !== null
    ? record.to_pack_qty === 0
    : roomOf(record.lines) === 0
}

export function DeliveryCards({
  rows,
  stores,
  onOpen,
  onEdit,
  onCancel,
}: {
  rows: readonly AllotmentRow[]
  stores: readonly { value: string; label: string }[]
  onOpen: (id: string) => void
  onEdit: (id: string) => void
  onCancel: (id: string) => void
}) {
  // Every card's lines: one read per allotment, shared with its sheet.
  const details = useQueries({
    queries: rows.map((row) => ({
      queryKey: inventoryKeys.allotment(row.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        allotmentDetail(row.id, signal),
      staleTime: 30_000,
    })),
  })
  const shop = useShopName()
  const storeCode = (id: string) => {
    // The board's name first ("C001 · Cikupa" → "C001"), the list's after.
    const named = shop(id)
    const label =
      named !== id
        ? named
        : (stores.find((one) => one.value === id)?.label ?? id)
    return label.split(" · ")[0] ?? label
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => {
        const record = details[index]?.data
        const lines = record?.lines
        const pieces = lines === undefined ? wantedOfRow(row) : wantedOf(lines)
        const mine = lines === undefined ? [] : storesOf(lines)
        const cancellable = record === undefined || !allSentOf(record)
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
            <span className="flex items-start justify-between gap-4 max-md:flex-col max-md:gap-1">
              <span className="flex min-w-0 flex-col">
                <span className="text-[1.0625rem] leading-6 font-semibold text-ink">
                  {row.supplier_names ?? "No supplier"}
                </span>
                <span className="text-[0.9375rem] text-body">
                  <span className="font-mono">{row.allotment_number}</span> ·{" "}
                  {row.article_count === 1
                    ? "1 article"
                    : `${count(row.article_count)} articles`}{" "}
                  · {dayMonth(row.created_at)}
                </span>
              </span>
              <span className="font-semibold whitespace-nowrap text-ink tabular-nums">
                {count(pieces)} pcs
              </span>
            </span>

            {mine.length > 0 && (
              <span className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2 max-md:grid-cols-2">
                {mine.map((one) => {
                  const [word, colour] = storeStage(one.lines)
                  return (
                    <span
                      key={one.id}
                      className="flex items-center justify-between gap-2 rounded-inner bg-soft px-3 py-2 text-[0.9375rem]"
                    >
                      <span className="min-w-0 truncate font-medium text-ink">
                        {storeCode(one.id)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-mute">
                        <i
                          aria-hidden
                          className="inline-block size-2 rounded-full"
                          style={{ background: colour }}
                        />
                        {word}
                      </span>
                    </span>
                  )
                })}
              </span>
            )}

            <span className="flex justify-end gap-2 border-t border-hairline pt-3.5 max-md:[&>button]:flex-1">
              {cancellable && (
                <Button
                  variant="destructive"
                  size="card"
                  onClick={(event) => {
                    event.stopPropagation()
                    onCancel(row.id)
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button
                variant="primary"
                size="card"
                onClick={(event) => {
                  event.stopPropagation()
                  onEdit(row.id)
                }}
              >
                Edit
              </Button>
            </span>
          </article>
        )
      })}
    </div>
  )
}
