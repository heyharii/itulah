import { useQueries } from "@tanstack/react-query"

import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { count, dayMonth, countPcs } from "@/lib/format"
import {
  allotmentDetail,
  inventoryKeys,
  type AllotmentDetail,
  type AllotmentLine,
  type AllotmentRow,
} from "@/lib/queries/inventory"
import {
  cancelOf,
  deliverableOf,
  missingOf,
  onRoadOf,
  onPicklistOf,
  roomOf,
  stagesOf,
  storesOf,
  targetOf,
} from "@/screens/allotment/amend-data"
import { useShortNotes } from "@/screens/allotment/short-notes"
import { EndedStamp } from "@/screens/allotment/finished-cards"

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
export const STAGE_COLOUR = {
  toPick: "#dcdce1",
  picked: "#e9c88f",
  packed: "#c9892e",
  dispatched: "#2f86d8",
  received: "#36b827",
} as const

/// The pieces these lines still mean to deliver. MD's edit and cancel on a
/// cloud-run allotment lower the target; a DC node's cancel leaves the target
/// and counts the pieces as cancelled — both come off here. So do pieces
/// closed short (`deliverableOf`).
function wantedOf(lines: readonly AllotmentLine[]): number {
  return lines.reduce(
    (sum, line) =>
      sum +
      Math.max(
        0,
        Math.min(deliverableOf(line), targetOf(line) - line.cancelled_quantity)
      ),
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

/// A store tile's word, its dot, and — received short — what came of what
/// was sent ("9 of 10").
interface StoreWord {
  readonly word: string
  readonly colour: string
  readonly short?: { readonly got: number; readonly sent: number }
}

/// What the store got of what was sent, once nothing of it is on the road.
/// A count that did not match is the one place a "Review" word would go
/// (store count review, proposed 17 Oct 2026): a third `StoreWord` here.
function arrivedOf(
  lines: readonly AllotmentLine[],
  missing: number
): StoreWord {
  const got = lines.reduce((sum, line) => sum + line.received_quantity, 0)
  return missing > 0
    ? {
        word: "Received",
        colour: STAGE_COLOUR.received,
        short: { got, sent: got + missing },
      }
    : { word: "Received", colour: STAGE_COLOUR.received }
}

/// One store's word: the least-done stage it still has goods in.
function storeStage(
  lines: readonly AllotmentLine[],
  missing: number
): StoreWord {
  const wanted = wantedOf(lines)
  if (wanted === 0) return { word: "Cancelled", colour: STAGE_COLOUR.toPick }
  const s = stagesOf(lines)
  if (s.toPick >= wanted)
    return { word: "To pick", colour: STAGE_COLOUR.toPick }
  if (s.toPick > 0) return { word: "Picking", colour: STAGE_COLOUR.picked }
  if (s.picked > 0) return { word: "Picked", colour: STAGE_COLOUR.picked }
  if (s.packed > 0) return { word: "Packed", colour: STAGE_COLOUR.packed }
  if (onRoadOf(lines) > missing)
    return { word: "Dispatched", colour: STAGE_COLOUR.dispatched }
  return arrivedOf(lines, missing)
}

/// A cancelled store's word: its pieces still on the road, what it got of
/// them once they arrived short, or none.
function goneStage(
  lines: readonly AllotmentLine[],
  missing: number
): StoreWord {
  if (onRoadOf(lines) > missing)
    return { word: "Dispatched", colour: STAGE_COLOUR.dispatched }
  return missing > 0
    ? arrivedOf(lines, missing)
    : { word: "Cancelled", colour: STAGE_COLOUR.toPick }
}

/// Cancel only while every piece is still on the picklist (owner, 21 Oct
/// 2026) — the sheet's own rule, so the card never offers what the sheet then
/// refuses. Once picking starts MD lowers what is left with Edit.
function cancellableOf(record: AllotmentDetail): boolean {
  return record.activation_target_origin_id !== null
    ? record.to_pack_qty > 0
    : onPicklistOf(record.lines) && roomOf(record.lines) > 0
}

/// Edit only moves what is still on the picklist, so a card with nothing
/// left to pick offers no Edit: the grid would open with every box locked.
function editableOf(record: AllotmentDetail): boolean {
  return record.activation_target_origin_id !== null
    ? record.to_pack_qty > 0
    : stagesOf(record.lines).toPick > 0
}

export function DeliveryCards({
  rows,
  stores,
  onOpen,
  onEdit,
  onCancel,
  ended,
}: {
  rows: readonly AllotmentRow[]
  stores: readonly { value: string; label: string }[]
  onOpen: (id: string) => void
  onEdit?: (id: string) => void
  onCancel?: (id: string) => void
  /// The Completed or Cancelled tab (owner, 20 Oct 2026: the same card as In
  /// progress): no Cancel or Edit, the ending said in the line under the name.
  ended?: "completed" | "cancelled"
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
  // Delivery notes the stores received short.
  const short = useShortNotes()
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
        // Cancelled with pieces already dispatched: it stays In progress
        // until the store has them, but says so and offers nothing to do.
        const gone =
          record === undefined
            ? (row.cancelled_at ?? null) !== null
            : cancelOf(record).cancelled
        const pieces =
          lines === undefined
            ? ended === "cancelled"
              ? row.total_quantity
              : wantedOfRow(row)
            : gone
              ? // On the Cancelled tab: what was called off and what is
                // still on the road, together.
                ended === "cancelled"
                ? Math.max(
                    onRoadOf(lines),
                    lines.reduce((n, line) => n + line.quantity, 0) -
                      lines.reduce((n, line) => n + line.dispatched_quantity, 0) +
                      onRoadOf(lines)
                  )
                : onRoadOf(lines)
              : wantedOf(lines)
        const mine = lines === undefined ? [] : storesOf(lines)
        /// How many stores the allotment goes to (owner, 20 Oct 2026), from
        /// the lines once read, the row's own names before.
        const storeCount =
          mine.length > 0 ? mine.length : (row.destination_names ?? []).length
        const isReturn =
          row.type === "RETURN_TO_DC" ||
          (row.type as string) === "RETURN_TO_WAREHOUSE"
        const cancellable = record === undefined || cancellableOf(record)
        const editable = record === undefined || editableOf(record)
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
            {/* The allotment at the left; its stores at the right, each with
                where it stands, its pieces and its articles (owner, 20 Oct
                2026: the stores are what the card is about). */}
            <span className="grid items-start gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)]">
              <span className="relative flex min-w-0 flex-col">
                {/* A finished one wears its stamp and day, as an order does
                    in Procurement (owner, 20 Oct 2026). */}
                {ended !== undefined && (
                  <span className="absolute top-0 right-0">
                    <EndedStamp row={row} />
                  </span>
                )}
                <span className="text-[1.0625rem] leading-6 font-semibold text-ink">
                  {row.supplier_names ?? "No supplier"}
                </span>
                <span className="text-[0.9375rem] text-body">
                  <span className="font-mono">{row.allotment_number}</span> ·{" "}
                  {dayMonth(row.created_at)}
                  {gone && ended === undefined && (
                    <span className="text-bad-fg"> · Cancelled</span>
                  )}
                </span>
                <span className="mt-1.5 text-[0.9375rem] text-ink tabular-nums">
                  <span className="font-semibold">{countPcs(pieces)}</span>
                  <span className="text-body">
                    {" · "}
                    {row.article_count === 1
                      ? "1 article"
                      : `${count(row.article_count)} articles`}
                    {storeCount > 0 &&
                      ` · ${storeCount === 1 ? "1 store" : `${count(storeCount)} stores`}`}
                  </span>
                </span>
              </span>

              {/* The stores, then Cancel and Edit right under them (owner,
                  20 Oct 2026). */}
              <span className="flex min-w-0 flex-col">
                {mine.length > 0 && (
                  // Option D5 · By status (owner, 20 Oct 2026): one row per
                  // stage with the stores in it and their pieces, so thirteen
                  // stores still fit in a few rows.
                  <span className="block overflow-hidden rounded-inner border border-hairline text-[0.9375rem]">
                    <span className="grid grid-cols-[8.5rem_minmax(0,1fr)_4.5rem] items-center gap-x-2.5 bg-soft px-3 py-1.5 text-mute">
                      <span>Status</span>
                      <span>Stores</span>
                      <span className="text-right">Pcs</span>
                    </span>
                    {(() => {
                      const groups = new Map<
                        string,
                        { word: string; colour: string; codes: string[]; pieces: number }
                      >()
                      for (const one of mine) {
                        const missing = missingOf(one.lines, short)
                        const stage = gone
                          ? goneStage(one.lines, missing)
                          : storeStage(one.lines, missing)
                        // A finished allotment's store that never got all of
                        // it was closed short, not still at the Gudang.
                        const stuck =
                          ended === "completed" &&
                          ["To pick", "Picking", "Picked", "Packed"].includes(
                            stage.word
                          )
                        const word = stuck ? "Closed short" : stage.word
                        const colour = stuck ? "#d68a00" : stage.colour
                        const group = groups.get(word) ?? {
                          word,
                          colour,
                          codes: [],
                          pieces: 0,
                        }
                        group.codes.push(
                          storeCode(
                            // A return names the store sending the goods
                            // back, not where they land (HO).
                            isReturn
                              ? (one.lines[0]?.source_site_id ?? one.id)
                              : one.id
                          )
                        )
                        // Called off before it left: the pieces MD
                        // cancelled; on the road: what is still travelling.
                        const left = one.lines.reduce(
                          (n, line) => n + line.dispatched_quantity,
                          0
                        )
                        group.pieces +=
                          gone && left === 0
                            ? one.lines.reduce((n, line) => n + line.quantity, 0)
                            : gone
                              ? onRoadOf(one.lines)
                              : wantedOf(one.lines)
                        groups.set(word, group)
                      }
                      return [...groups.values()].map((group) => (
                        <span
                          key={group.word}
                          className="grid grid-cols-[8.5rem_minmax(0,1fr)_4.5rem] items-center gap-x-2.5 border-t border-hairline px-3 py-2"
                        >
                          <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-body">
                            <i
                              aria-hidden
                              className="inline-block size-2 shrink-0 rounded-full"
                              style={{ background: group.colour }}
                            />
                            {group.word}
                          </span>
                          <span className="min-w-0 text-ink tabular-nums">
                            {group.codes.join(", ")}
                          </span>
                          <span className="text-right font-semibold text-ink tabular-nums">
                            {count(group.pieces)}
                          </span>
                        </span>
                      ))
                    })()}
                  </span>
                )}
                  {!gone && ended === undefined && (cancellable || editable) && (
                    <span className="mt-3 flex justify-end gap-2 max-md:[&>button]:flex-1">
                      {cancellable && (
                        <Button
                          variant="destructive"
                          size="card"
                          onClick={(event) => {
                            event.stopPropagation()
                            onCancel?.(row.id)
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                      {editable && (
                        <Button
                          variant="primary"
                          size="card"
                          onClick={(event) => {
                            event.stopPropagation()
                            onEdit?.(row.id)
                          }}
                        >
                          Edit
                        </Button>
                      )}
                    </span>
                  )}
              </span>
            </span>
          </article>
        )
      })}
    </div>
  )
}
