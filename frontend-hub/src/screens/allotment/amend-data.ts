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
import type { ReceivedShipmentRow } from "@/screens/inventory/received-feed"
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

/// The most the line can still deliver, closed short taken off once. An
/// Edit's move lowers the target AND books the moved piece closed short
/// (quantity 2, target 1, closed short 1); a short pick MD accepted keeps the
/// target (2, 2, 1). Taking closed short off the target counted the Edit's
/// piece twice.
export function deliverableOf(line: AllotmentLine): number {
  return Math.min(targetOf(line), line.quantity - (line.closed_short_qty ?? 0))
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

/// What MD's Edit may not move on a line (owner, 18 Oct 2026): everything
/// the warehouse has already worked — picked, packed, sent. Edit only moves
/// what is still to pick; to move the rest, Ops puts it back to the picklist
/// first (the board's Put back). Never under the sent floor, never above the
/// target.
export interface Lock {
  readonly n: number
  /// "2 picked · 1 sent" — the box's tooltip.
  readonly title: string
  /// Every locked piece is on the road or received: the truck, not the box.
  readonly shipped: boolean
}

export function lockOf(line: AllotmentLine): Lock {
  const target = targetOf(line)
  const s = stagesOf([line])
  const n = Math.min(target, Math.max(floorOf(line), target - s.toPick))
  const said = [
    s.picked > 0 && `${s.picked} picked`,
    s.packed > 0 && `${s.packed} packed`,
    s.dispatched > 0 && `${s.dispatched} sent`,
  ].filter(Boolean)
  const worked = s.picked + s.packed > 0
  return {
    n,
    title:
      said.join(" · ") +
      (worked
        ? ". Ask Ops to put it back to the picklist to move it."
        : ": it cannot go lower."),
    shipped: !worked,
  }
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

// ── MD's sheet: stores, then articles, never sizes ─────────────────────────
//
// MD is a policy maker (allotment-ops-prototype, "MD · Allotments", 15 Oct
// 2026): the sheet shows STORES, an article only when a store is opened, and a
// size never. An edit is a store's total or one article's total for a store;
// the app spreads it over the sizes underneath, in proportion, and the server
// takes the result as per-line `to` targets on `/amend`.

/// What a line has already left the warehouse with — on a delivery note or
/// beyond — unclamped: the figure the Dispatched column reads.
export function sentOf(line: AllotmentLine): number {
  return (
    line.sent_quantity ??
    line.at_shipment_qty +
      line.at_loaded_qty +
      line.at_in_transit_qty +
      line.received_quantity
  )
}

/// Where a slice of the allotment's pieces stand, by stage — one store, one
/// article for a store, or a set of stores for a cancel. Picked and Packed are
/// only what is still wanted; what MD already took out is the warehouse's to
/// put back and is not counted again.
export interface Stages {
  readonly allotted: number
  readonly toPick: number
  readonly picked: number
  readonly packed: number
  readonly dispatched: number
  readonly received: number
}

export function stagesOf(lines: readonly AllotmentLine[]): Stages {
  let allotted = 0
  let toPick = 0
  let picked = 0
  let packed = 0
  let dispatched = 0
  let received = 0
  for (const line of lines) {
    const target = targetOf(line)
    const sent = sentOf(line)
    const wanted = Math.max(0, target - sent)
    const inKoli = Math.min(Math.max(0, line.at_packed_qty), wanted)
    // `picked_quantity` counts every piece ever picked, packed and gone ones
    // too (the delivery cards read it the same way).
    const worked = Math.max(line.picked_quantity, line.at_packed_qty + sent)
    const inPickArea = Math.max(0, worked - line.at_packed_qty - sent)
    allotted += target
    picked += Math.min(inPickArea, wanted - inKoli)
    packed += inKoli
    // A close short (a DC's cancel, a short pick closed) gives pieces up
    // without moving the target: they are not to pick any more.
    toPick += Math.max(0, deliverableOf(line) - worked)
    dispatched += sent
    received += line.received_quantity
  }
  return { allotted, toPick, picked, packed, dispatched, received }
}

/// Every piece of these lines is still on the picklist: nothing picked,
/// packed or sent. The one time MD may Cancel (owner, 21 Oct 2026): once the
/// warehouse has started, pieces only go back through Ops' Put back.
export function onPicklistOf(lines: readonly AllotmentLine[]): boolean {
  return lines.every(
    (line) =>
      Math.max(line.picked_quantity, line.at_packed_qty + sentOf(line)) === 0
  )
}

/// The pieces of these lines already on the road: on a delivery note, loaded
/// or in transit.
export function onRoadOf(lines: readonly AllotmentLine[]): number {
  return lines.reduce(
    (sum, line) =>
      sum + line.at_shipment_qty + line.at_loaded_qty + line.at_in_transit_qty,
    0
  )
}

/// Pieces of one store's lines the store has counted for and not found: the
/// books still have them on the road, but the delivery note they left on was
/// received with a gap (17 Oct 2026: C001 received 9 of 10 and still read
/// Dispatched). The note is the one the store's other pieces of these lines
/// were received on; never more than is on the road.
export function missingOf(
  lines: readonly AllotmentLine[],
  short: readonly ReceivedShipmentRow[]
): number {
  const store = lines[0]?.destination_id
  const notes = new Set(
    lines.flatMap((line) =>
      line.received_breakdown.map((unit) => unit.shipment_reference)
    )
  )
  const gap = short
    .filter(
      (one) =>
        one.destination_store_id === store && notes.has(one.shipment_number)
    )
    .reduce((sum, one) => sum + one.open_gap_qty, 0)
  return Math.min(gap, onRoadOf(lines))
}

/// A shop's own id, shortened the way the allotment lists shorten it —
/// `store-04` → `04` — for the line that has no name (§14 #17).
function nameOf(line: AllotmentLine): string {
  return (
    line.destination_name ??
    (line.destination_id.replace(/^store-?/i, "") || line.destination_id)
  )
}

export interface StoreArticle {
  readonly id: string
  readonly name: string
  readonly code: string
  readonly image: string | null
  readonly colour: string | null
  readonly lines: AllotmentLine[]
}

export interface StoreGroup {
  readonly id: string
  readonly name: string
  readonly lines: AllotmentLine[]
  readonly articles: StoreArticle[]
}

/// The lines as stores, each with its articles, in reading order.
export function storesOf(lines: readonly AllotmentLine[]): StoreGroup[] {
  const byStore = new Map<string, AllotmentLine[]>()
  for (const line of lines)
    byStore.set(line.destination_id, [
      ...(byStore.get(line.destination_id) ?? []),
      line,
    ])
  return [...byStore.entries()]
    .sort(([left], [right]) =>
      left.localeCompare(right, undefined, { numeric: true })
    )
    .map(([id, mine]) => {
      const byArticle = new Map<string, AllotmentLine[]>()
      for (const line of mine)
        byArticle.set(line.article_id, [
          ...(byArticle.get(line.article_id) ?? []),
          line,
        ])
      return {
        id,
        name: nameOf(mine[0]),
        lines: mine,
        articles: [...byArticle.entries()]
          .map(([articleId, group]) => ({
            id: articleId,
            name: group[0].article_name,
            code: group[0].article_code,
            image: group[0].image_url,
            colour: group[0].colour,
            lines: group,
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      }
    })
}

/// A new total for these lines, spread over them in proportion to what each
/// holds above its floor (what is dispatched) — the prototype's `spread`. A
/// total at or under the sum of the floors leaves every line at its floor;
/// lines with nothing above their floor share an increase evenly, or by what
/// they hold. The pieces a division leaves over go to the largest remainders,
/// so the lines always add up to the total.
export function spreadOf(
  lines: readonly AllotmentLine[],
  total: number,
  current: (line: AllotmentLine) => number
): Map<string, number> {
  const floors = lines.map(floorOf)
  const least = floors.reduce((sum, n) => sum + n, 0)
  if (total <= least)
    return new Map(lines.map((line, at) => [line.id, floors[at]]))
  const now = lines.map(current)
  let weights = now.map((n, at) => Math.max(0, n - floors[at]))
  if (weights.every((n) => n === 0)) weights = now.map((n) => n || 1)
  const whole = weights.reduce((sum, n) => sum + n, 0)
  const extra = total - least
  const raw = weights.map((n) => (extra * n) / whole)
  const base = raw.map(Math.floor)
  let left = extra - base.reduce((sum, n) => sum + n, 0)
  const order = raw
    .map((n, at) => [n - base[at], at] as const)
    .sort((left, right) => right[0] - left[0])
  for (const [, at] of order) {
    if (left === 0) break
    base[at] += 1
    left -= 1
  }
  return new Map(lines.map((line, at) => [line.id, floors[at] + base[at]]))
}

/// The edit as MD's draft makes it (line id → the line's new target): the
/// request's `lines`, and the one sentence the foot and the toast say about it.
export interface DraftEdit {
  readonly lines: { allotment_line_id: string; to: number }[]
  /// Each changed line's target before the edit — what Undo goes back to.
  readonly before: Map<string, number>
  readonly more: number
  readonly fewer: number
  /// Pieces already in koli the warehouse puts back.
  readonly putBack: number
}

export function draftEditOf(
  lines: readonly AllotmentLine[],
  draft: ReadonlyMap<string, number>
): DraftEdit {
  const changed: DraftEdit["lines"] = []
  const before = new Map<string, number>()
  let more = 0
  let fewer = 0
  let putBack = 0
  for (const line of lines) {
    const asked = draft.get(line.id)
    if (asked === undefined) continue
    const to = Math.max(asked, floorOf(line))
    const change = changeOf(line, to)
    if (change === null) continue
    changed.push({ allotment_line_id: line.id, to })
    before.set(line.id, change.was)
    more += Math.max(0, to - change.was)
    fewer += Math.max(0, change.was - to)
    putBack += change.owed
  }
  return { lines: changed, before, more, fewer, putBack }
}

/// "+20 to pick · 30 fewer · 10 put back by the warehouse", or "No changes".
export function draftNoteOf(edit: DraftEdit): string {
  const parts: string[] = []
  if (edit.more > 0) parts.push(`+${count(edit.more)} to pick`)
  if (edit.fewer > 0) parts.push(`${count(edit.fewer)} fewer`)
  if (edit.putBack > 0)
    parts.push(`${count(edit.putBack)} put back by the warehouse`)
  return parts.length === 0 ? "No changes" : parts.join(" · ")
}

/// Undo of MD's Save or store cancel: each line back to what it was, read
/// against the allotment as it stands NOW — never under what has been
/// dispatched since, and a line already where it was is left out.
export function undoLinesOf(
  lines: readonly AllotmentLine[],
  before: ReadonlyMap<string, number>
): { allotment_line_id: string; to: number }[] {
  const back: { allotment_line_id: string; to: number }[] = []
  for (const line of lines) {
    const was = before.get(line.id)
    if (was === undefined) continue
    const to = Math.max(was, floorOf(line))
    if (to !== targetOf(line)) back.push({ allotment_line_id: line.id, to })
  }
  return back
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
export function gridOwnOf(
  lines: readonly AllotmentLine[]
): Map<string, number> {
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

/// MD's changes, one per line changed: the detail's own list when the cloud
/// sends one, else read off the events each change wrote (every one carries
/// its amendment's kind, reason and targets in `details`).
export function amendmentsOf(
  record: Pick<AllotmentDetail, "amendments" | "events">
): readonly AllotmentAmendment[] {
  if (record.amendments !== undefined) return record.amendments
  const byId = new Map<string, AllotmentAmendment>()
  for (const event of record.events) {
    if (event.reference_type !== "ALLOTMENT_AMENDMENT") continue
    const details = event.details ?? {}
    const id = event.reference_id ?? event.id
    const kind = details.kind
    if (byId.has(id)) continue
    if (kind !== "REDUCE" && kind !== "ADD" && kind !== "CANCEL") continue
    byId.set(id, {
      id,
      kind,
      reason: typeof details.reason === "string" ? details.reason : null,
      actor_id: event.actor_id,
      created_at: event.occurred_at,
      target_before:
        typeof details.target_before === "number"
          ? details.target_before
          : undefined,
      target_after:
        typeof details.target_after === "number"
          ? details.target_after
          : undefined,
      sku_id: event.sku_id,
      destination_id: event.destination_id,
    })
  }
  return [...byId.values()]
}

/// The newest of MD's changes, optionally of one kind.
export function latestOf(
  record: Pick<AllotmentDetail, "amendments" | "events">,
  kind?: AllotmentAmendment["kind"]
): AllotmentAmendment | null {
  let latest: AllotmentAmendment | null = null
  for (const one of amendmentsOf(record)) {
    if (kind !== undefined && one.kind !== kind) continue
    if (
      latest === null ||
      Date.parse(one.created_at) > Date.parse(latest.created_at)
    )
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
