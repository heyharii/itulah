import { count } from "@/lib/format"
import type { JobWork } from "@/lib/outbox"
import type { PurchaseWorkLine } from "@itulah/contract"

/// The two things about floor work that more than one screen needs to agree on:
/// how a delivery gathers, and what a queued job is called.
///
/// They live here rather than beside the screen that uses them most because a
/// screen file that exports a helper stops being hot-reloadable — and because a
/// second screen that grouped an order its own way would be a second, quietly
/// different answer to "what is one lorry".

/// One purchase order, with its lines under it.
export interface Order {
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_name: string | null
  readonly activated_at: string
  readonly lines: readonly PurchaseWorkLine[]
}

/// Lines gathered under the order they belong to, newest activation first.
///
/// A lorry arrives against an order: nine lines owed on one order is one thing
/// to walk over to, and nine cards would be nine decisions about the same
/// pallet. The count sheet regroups the same list for itself rather than being
/// handed a selection, because a phone that reloads mid-count has no router
/// state left to be handed.
export function groupByOrder(
  lines: readonly PurchaseWorkLine[],
): readonly Order[] {
  const byOrder = new Map<string, PurchaseWorkLine[]>()
  for (const line of lines) {
    const held = byOrder.get(line.po_number)
    if (held === undefined) byOrder.set(line.po_number, [line])
    else held.push(line)
  }
  return [...byOrder.entries()]
    .map(([po_number, held]) => ({
      po_number,
      supplier_id: held[0]!.supplier_id,
      supplier_name: held[0]!.supplier_name,
      activated_at: held[0]!.activated_at,
      lines: held
        .slice()
        .sort((left, right) => left.line_number - right.line_number),
    }))
    .sort((left, right) => right.activated_at.localeCompare(left.activated_at))
}

/// One line naming what a queued job is, in the words of the station that made
/// it.
///
/// Not derived from the endpoint: `POST /dc/purchase-counts` means nothing to
/// the person who counted a lorry, and "Hitung 4400012 · 3 baris" is the same
/// fact in the language they did it in.
export function describeJob(work: JobWork): string {
  switch (work.kind) {
    case "hitung":
      return `Hitung ${work.po_number} · ${count(work.lines.length)} baris`
    case "periksa":
      return `${work.decision === "Accept" ? "Terima" : "Hitung ulang"} ${work.po_number} · ${count(work.count_ids.length)} baris`
    case "tag":
      return `Tag ${work.article_code} · ${count(work.quantity)} potong`
    case "ambil":
      return `Ronde ambil · ${count(work.lines.length)} SKU`
    case "kemas":
      return `Kemas untuk ${work.destination_store_id} · ${count(work.lines.length)} SKU`
    case "opname":
      return `Opname · ${count(work.entries.length)} tag`
  }
}
