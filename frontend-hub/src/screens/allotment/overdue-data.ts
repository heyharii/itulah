import type { AllotmentRow } from "@/lib/queries/inventory"

/// Overdue: an allotment still Active more than this many days after it was
/// made (the owner, 2 Oct 2026). One number, here.
export const OVERDUE_DAYS = 30

const DAY = 86_400_000

export interface OverdueRow {
  readonly id: string
  readonly number: string
  readonly store: string
  readonly pieces: number
  readonly items: number
  readonly days: number
  readonly stage: string
}

/// Where the goods are stuck: the earliest stage that still holds pieces.
function stageOf(row: AllotmentRow): string {
  if (row.edge_application_status === "PENDING") return "Waiting for DC"
  if (row.to_pack_qty > 0) return "To pack"
  if (row.at_packed_qty > 0) return "Packed"
  if (row.at_shipment_qty + row.at_loaded_qty > 0) return "Shipment"
  if (row.at_in_transit_qty > 0) return "In transit"
  return "Receiving"
}

/// The Active book's rows older than `OVERDUE_DAYS`, read at `at` — the
/// instant the book came off the server, so a render never changes the answer.
export function overdueOf(
  active: readonly AllotmentRow[],
  at: number
): readonly OverdueRow[] {
  if (at === 0) return []
  return active
    .map((row) => ({
      id: row.id,
      number: row.allotment_number,
      store: (row.destination_names ?? []).join(", ") || "—",
      pieces: row.total_quantity,
      items: row.article_count,
      days: Math.floor((at - Date.parse(row.created_at)) / DAY),
      stage: stageOf(row),
    }))
    .filter((row) => row.days > OVERDUE_DAYS)
    .sort((a, b) => b.days - a.days)
}
