import { useQueries } from "@tanstack/react-query"

import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { count, dayMonth } from "@/lib/format"
import {
  allotmentsByStore,
  inventoryKeys,
  type AllotmentRow,
} from "@/lib/queries/inventory"

/// **MD's In progress list: one card per allotment — what MD allotted in one
/// go from one delivery — never article by article** (allotment-ops-prototype,
/// approved 15 Oct 2026).
///
/// Simple (owner, 16 Oct 2026): supplier, number, pieces; one tile per store
/// with the word of where its goods are; Cancel (red) and Edit (blue) on the
/// foot open the allotment's sheet ready to cancel or edit. A store's own
/// slice comes from the by-store book — one read per store.

/// The stage colours of the store tiles' dots.
const STAGE_COLOUR = {
  toPick: "#dcdce1",
  picked: "#e9c88f",
  packed: "#c9892e",
  dispatched: "#2f86d8",
  received: "#36b827",
} as const

/// Where an allotment's (or one store's slice of it) pieces are.
function stagesOf(row: AllotmentRow) {
  const total = Math.max(0, row.total_quantity - row.total_cancelled_quantity)
  const received = row.received_qty
  const onWay = row.at_in_transit_qty
  const packed = row.at_packed_qty + row.at_shipment_qty + row.at_loaded_qty
  const worked = Math.max(row.total_picked_quantity, packed + onWay + received)
  const picked = Math.max(0, worked - packed - onWay - received)
  const toPick = Math.max(0, total - worked)
  return { total, received, onWay, packed, picked, toPick, worked }
}

/// One store's word: the least-done stage it still has goods in.
function storeStage(row: AllotmentRow): [string, string] {
  const s = stagesOf(row)
  if (s.total === 0) return ["Cancelled", STAGE_COLOUR.toPick]
  if (s.toPick === s.total) return ["To pick", STAGE_COLOUR.toPick]
  if (s.toPick > 0) return ["Picking", STAGE_COLOUR.picked]
  if (s.picked > 0) return ["Picked", STAGE_COLOUR.picked]
  if (s.packed > 0) return ["Packed", STAGE_COLOUR.packed]
  if (s.onWay > 0) return ["Dispatched", STAGE_COLOUR.dispatched]
  return ["Received", STAGE_COLOUR.received]
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
  // Every store's own slice of every allotment, by allotment then store.
  const slices = useQueries({
    queries: stores.map((store) => ({
      queryKey: inventoryKeys.allotmentsByStore(store.value),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        allotmentsByStore(store.value, signal),
      staleTime: 30_000,
    })),
  })
  const byAllotment = new Map<string, { store: string; row: AllotmentRow }[]>()
  slices.forEach((slice, index) => {
    const store = stores[index]
    if (store === undefined) return
    for (const row of slice.data?.items ?? []) {
      const list = byAllotment.get(row.id) ?? []
      list.push({ store: store.value, row })
      byAllotment.set(row.id, list)
    }
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
      {rows.map((row) => {
        const s = stagesOf(row)
        const mine = (byAllotment.get(row.id) ?? []).filter(
          (one) => one.row.total_quantity > 0
        )
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
                {count(s.total)} pcs
              </span>
            </span>

            {mine.length > 0 && (
              <span className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2 max-md:grid-cols-2">
                {mine.map((one) => {
                  const [word, colour] = storeStage(one.row)
                  return (
                    <span
                      key={one.store}
                      className="flex items-center justify-between gap-2 rounded-inner bg-soft px-3 py-2 text-[0.9375rem]"
                    >
                      <span className="min-w-0 truncate font-medium text-ink">
                        {storeCode(one.store)}
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
