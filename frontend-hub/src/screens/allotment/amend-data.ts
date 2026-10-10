import { count, quantity } from "@/lib/format"
import type {
  AmendAllotmentResult,
  AmendNewLine,
} from "@/lib/operations/changes"
import type {
  AllotmentAmendment,
  AllotmentDetail,
  AllotmentLine,
} from "@/lib/queries/inventory"
import { cellKey } from "@/screens/allotment/quick-fill"

/// The arithmetic behind MD's edit and cancel (outbound cancel / edit, 9 Oct
/// 2026; docs/research/2026-10-09-outbound-cancel-edit-build.md §1). Pure
/// functions, so the grid, its one-line summary and the receipt cannot say
/// three different things about the same change.
///
/// Everything here is a PREVIEW of what the server will do — the server's own
/// answer (`AmendAllotmentResult`) is what the receipt reports.

/// What MD wants the line to be now, net of what was edited out and in. The
/// server's `target_quantity`; the old `quantity` on a cloud that has not
/// started answering it.
export function targetOf(line: AllotmentLine): number {
  return line.target_quantity ?? line.quantity
}

/// The least an edit can take the line to: pieces already on a delivery note
/// or beyond. The server's `sent_quantity`; the same sum of stages on a cloud
/// that has not started answering it. Never above the target, so a line that
/// reads inconsistently is not forced to change just by being opened.
export function floorOf(line: AllotmentLine): number {
  const sent =
    line.sent_quantity ??
    line.at_shipment_qty +
      line.at_loaded_qty +
      line.at_in_transit_qty +
      line.received_quantity
  return Math.min(sent, targetOf(line))
}

/// What can still be given up across these lines: everything not sent yet.
/// Zero is "already sent in full" — nothing left to cancel or reduce.
export function roomOf(lines: readonly AllotmentLine[]): number {
  return lines.reduce(
    (sum, line) => sum + Math.max(0, targetOf(line) - floorOf(line)),
    0
  )
}

/// Pieces MD took out that still sit in an unsent carton: the warehouse has
/// not moved them back yet.
export function pendingOf(lines: readonly AllotmentLine[]): number {
  return lines.reduce(
    (sum, line) => sum + (line.takeout_pending_quantity ?? 0),
    0
  )
}

/// One line, changed.
export interface AmendChange {
  readonly line: AllotmentLine
  readonly was: number
  readonly to: number
  /// Taken from demand nobody packed yet: gone at once.
  readonly released: number
  /// Taken from pieces already in cartons: the warehouse moves them back.
  readonly owed: number
}

/// What changing `line` to `to` comes to, or `null` when it is not a change.
///
/// `free` is `to_pack_qty` — the pieces nobody has packed. A reduction takes
/// those first (closed at once); what is left is in cartons and is owed
/// (research doc §1, "The arithmetic of MD's reduction").
export function changeOf(line: AllotmentLine, to: number): AmendChange | null {
  const was = targetOf(line)
  if (to === was) return null
  const take = Math.max(0, was - to)
  const released = Math.min(take, Math.max(0, line.to_pack_qty))
  return { line, was, to, released, owed: take - released }
}

// ── The grid ───────────────────────────────────────────────────────────────
//
// Edit opens the same grid as New allotment, filled with the allotment (owner,
// 9 Oct 2026). A cell is a SKU and a store (`cellKey`): the cell of an existing
// line holds its net target, and a cell of a SKU × store the allotment did not
// have is a line to add.

/// The cells an edit opens with: every line's net target. A line with nothing
/// left to give has no number in its cell, the same as an empty box.
export function gridStartOf(
  lines: readonly AllotmentLine[]
): Record<string, number> {
  const cells: Record<string, number> = {}
  for (const line of lines) {
    const target = targetOf(line)
    if (target > 0) cells[cellKey(line.sku_id, line.destination_id)] = target
  }
  return cells
}

/// The least each existing cell may hold: pieces already sent.
export function gridFloorsOf(
  lines: readonly AllotmentLine[]
): Map<string, number> {
  return new Map(
    lines.map((line) => [
      cellKey(line.sku_id, line.destination_id),
      floorOf(line),
    ])
  )
}

/// What the allotment holds of each SKU now, over its stores. The pool already
/// counts these pieces as allotted, so the grid gives them back to the SKU's
/// free figure while the allotment is edited.
export function gridOwnOf(lines: readonly AllotmentLine[]): Map<string, number> {
  const own = new Map<string, number>()
  for (const line of lines)
    own.set(line.sku_id, (own.get(line.sku_id) ?? 0) + targetOf(line))
  return own
}

/// The edit as the grid's cells make it: the one request, and what the
/// summary line says about it.
export interface GridEdit {
  /// Existing lines whose cell is not what it was, as the server takes them.
  readonly lines: { allotment_line_id: string; to: number }[]
  /// Cells with pieces in them that the allotment had no line for.
  readonly add: AmendNewLine[]
  /// Stores and SKUs among `add` that the allotment did not have at all.
  readonly stores: number
  readonly skus: number
  /// Pieces the warehouse has to move back, as `changeOf` previews them.
  readonly owed: number
}

/// Read the cells against the allotment's lines. A cleared cell is the least
/// its line can be — the floor, or none — and a cell of no line is an added
/// one, taken from `source`.
export function gridEditOf(
  lines: readonly AllotmentLine[],
  cells: Readonly<Record<string, number>>,
  source: string
): GridEdit {
  const changed: GridEdit["lines"] = []
  const known = new Set<string>()
  let owed = 0
  for (const line of lines) {
    const key = cellKey(line.sku_id, line.destination_id)
    known.add(key)
    const to = Math.max(cells[key] ?? 0, floorOf(line))
    const change = changeOf(line, to)
    if (change === null) continue
    changed.push({ allotment_line_id: line.id, to })
    owed += change.owed
  }

  const hadStores = new Set(lines.map((line) => line.destination_id))
  const hadSkus = new Set(lines.map((line) => line.sku_id))
  const newStores = new Set<string>()
  const newSkus = new Set<string>()
  const add: AmendNewLine[] = []
  for (const [key, quantity] of Object.entries(cells)) {
    if (quantity <= 0 || known.has(key)) continue
    const [skuId, destinationId] = key.split("\u0000")
    add.push({
      sku_id: skuId,
      destination_id: destinationId,
      quantity,
      source_pool_id: source === "" ? null : source,
    })
    if (!hadStores.has(destinationId)) newStores.add(destinationId)
    if (!hadSkus.has(skuId)) newSkus.add(skuId)
  }
  // The same cells always make the same request, so a retry keeps its key.
  add.sort(
    (left, right) =>
      left.sku_id.localeCompare(right.sku_id) ||
      left.destination_id.localeCompare(right.destination_id)
  )
  return {
    lines: changed,
    add,
    stores: newStores.size,
    skus: newSkus.size,
    owed,
  }
}

/// The one line the grid says about the edit: "3 lines changed · 1 store
/// added".
export function gridNoteOf(edit: GridEdit): string {
  const parts: string[] = []
  const many = (n: number, one: string, more: string) =>
    `${count(n)} ${n === 1 ? one : more}`
  if (edit.lines.length > 0)
    parts.push(`${many(edit.lines.length, "line", "lines")} changed`)
  if (edit.stores > 0)
    parts.push(`${many(edit.stores, "store", "stores")} added`)
  if (edit.skus > 0) parts.push(`${many(edit.skus, "SKU", "SKUs")} added`)
  // A cell inside a store and a SKU the allotment already had.
  if (edit.stores === 0 && edit.skus === 0 && edit.add.length > 0)
    parts.push(`${many(edit.add.length, "line", "lines")} added`)
  return parts.length === 0 ? "No changes yet" : parts.join(" · ")
}

/// What the toast says once the server has answered: the allotment's quantity
/// before and after, and — only when there is work — what the warehouse moves
/// back. `before` is the allotment's total target when the edit began.
export function receiptOf(
  result: AmendAllotmentResult,
  before: number
): { title: string; detail: string | null } {
  const delta = [...result.lines, ...result.added].reduce(
    (sum, one) => sum + (one.now - one.was),
    0
  )
  return {
    title: `Quantity ${count(before)} → ${count(before + delta)}`,
    detail:
      result.owed_total > 0
        ? `${quantity(result.owed_total)} the warehouse moves back`
        : null,
  }
}

/// A reason as it is stored: the chip, and the note after it when there is one.
export function reasonOf(chip: string | null, note: string): string {
  const said = note.trim()
  if (chip === null) return said
  return said === "" ? chip : `${chip} · ${said}`
}

/// The newest of MD's changes, optionally of one kind.
export function latestOf(
  record: Pick<AllotmentDetail, "amendments">,
  kind?: AllotmentAmendment["kind"]
): AllotmentAmendment | null {
  let latest: AllotmentAmendment | null = null
  for (const one of record.amendments ?? []) {
    if (kind !== undefined && one.kind !== kind) continue
    if (latest === null || Date.parse(one.created_at) > Date.parse(latest.created_at))
      latest = one
  }
  return latest
}

/// Whether MD has cancelled the allotment, and who, why and when — read off the
/// latest cancel amendment when the detail lists them, else off the header.
/// The status alone is not enough: a cancel that left pieces already sent
/// keeps the header ACTIVE (research doc §1), and MD still reads "Cancelled".
export function cancelOf(record: AllotmentDetail): {
  cancelled: boolean
  by: string | null
  reason: string | null
  at: string | null
} {
  const amendment = latestOf(record, "CANCEL")
  const cancelled =
    record.status === "CANCELLED" ||
    record.cancelled_at !== null ||
    amendment !== null
  if (!cancelled) return { cancelled, by: null, reason: null, at: null }
  const said = amendment?.reason ?? record.cancellation?.reason ?? ""
  return {
    cancelled,
    by: amendment?.actor_id ?? record.cancellation?.requested_by ?? null,
    reason: said.trim() === "" ? null : said,
    at:
      amendment?.created_at ??
      record.cancelled_at ??
      record.cancellation?.requested_at ??
      null,
  }
}
