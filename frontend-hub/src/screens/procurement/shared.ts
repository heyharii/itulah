import { useQuery } from "@tanstack/react-query"
import { useCallback, useState } from "react"

import { count } from "@/lib/format"
import {
  catalogueVocabulary,
  procurementKeys,
  type PurchaseOrderDetail,
  type PurchaseOrderLine,
} from "@/lib/queries/procurement"
import { lineTotal, shareOut } from "@/screens/procurement/line-pricing-model"
import { useIdentity } from "@/lib/session"
import type { VocabularyTerm } from "@itulah/contract"

/// Helpers the procurement screens share. Non-components only, so the screens
/// beside it stay fast-refreshable.

/// The chrome of a ruled item grid, shared so the two places that draw one
/// cannot drift.
///
/// An order is read twice — on the review before it is created, and on its
/// detail sheet afterwards — and those are the same document. They were drawn
/// by two tables with different headers, different rules and different ways of
/// saying what a line is filed under, so the thing somebody approved did not
/// look like the thing they came back to. One pair of classes, imported by
/// both.
export const GRID_HEAD =
  "border-b border-l border-hairline bg-soft-2 px-3 py-2.5 text-left text-[0.875rem] font-medium text-body first:border-l-0"

/// A read-only cell in one of those grids. Padded, unlike the composer's own
/// editable `CELL`, which is `p-0` because the control inside it owns the
/// padding.
export const GRID_CELL =
  "border-t border-l border-hairline px-3 py-2 align-middle first:border-l-0"

/// Who is doing this.
///
/// Four purchasing writes name their actor in the body rather than taking it
/// from the session — `decided_by`, `closed_by`, `issued_by`, `created_by` —
/// because the server records them as facts about a decision and not about a
/// request. The screen therefore has to say who, and the only honest answer is
/// the signed-in user. Empty until `/auth/me` has answered, which is why the
/// buttons that need it are disabled while it is.
export function useActor(): string {
  const identity = useIdentity()
  return identity.data?.username ?? ""
}

/// A key generated once and held across retries, then rotated after a success.
///
/// The point of an idempotency key is that a retry carries the SAME one — the
/// server replays its first answer instead of writing twice — so it must not be
/// regenerated on every render or every click. Rotating after a success is what
/// makes the next, genuinely different write a new one rather than a replay of
/// the last.
/// The next number in today's series, from the orders already raised.
///
/// `DDMMYY-NNN` — `260926-001` is the first order of 26 September 2026 — the
/// shape the server gives an order it numbers itself (see `next_po_number`
/// in the backend). Only today's numbers count towards the serial, because it
/// restarts every day.
///
/// It is a suggestion, not an allocation: the import sends it, and the
/// server's UNIQUE constraint is the final word if another buyer wins a race.
export function nextPoNumber(
  existing: readonly { po_number: string }[]
): string {
  const today = new Date()
  const stamp = [
    String(today.getDate()).padStart(2, "0"),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getFullYear() % 100).padStart(2, "0"),
  ].join("")
  const highest = existing.reduce((top, order) => {
    const match = new RegExp(`^${stamp}-(\\d+)$`).exec(order.po_number)
    if (match === null) return top
    const seen = Number.parseInt(match[1], 10)
    return Number.isFinite(seen) && seen > top ? seen : top
  }, 0)
  return `${stamp}-${String(highest + 1).padStart(3, "0")}`
}

/// Advance a number already suggested by `nextPoNumber`. Importing several
/// orders at once needs one distinct candidate per order; the order endpoint
/// still remains the final authority if another buyer wins a race.
export function offsetPoNumber(base: string, offset: number): string {
  const match = /^(.*-)(\d+)$/.exec(base)
  if (match === null || offset === 0) return base
  const serial = Number.parseInt(match[2], 10)
  if (!Number.isFinite(serial)) return base
  return `${match[1]}${String(serial + offset).padStart(match[2].length, "0")}`
}

export function useIdempotencyKey(): {
  readonly key: string
  readonly rotate: () => void
} {
  const [key, setKey] = useState(() => crypto.randomUUID())
  const rotate = useCallback(() => setKey(crypto.randomUUID()), [])
  return { key, rotate }
}

/// `KAUS_KAKI` → "Kaus Kaki", using the vocabulary the server sent.
///
/// Falls back to the code rather than to a blank: an unknown code is a screen
/// showing something the vocabulary has not caught up with, and hiding it would
/// make the row look unclassified when it is not.
export function termLabel(
  terms: readonly VocabularyTerm[] | undefined,
  code: string | null | undefined
): string {
  if (!code) return "—"
  return terms?.find((term) => term.code === code)?.label ?? code
}

/// `03` → "M", using the size table the server sent.
///
/// Falls back to the code, like `termLabel` does and for the same reason. It
/// replaces a hardcoded map transcribed from the `size_code` seed, which was
/// correct on the day it was written and silently read `21` for anything added
/// after it.
export function sizeLabel(
  sizes: readonly VocabularyTerm[] | undefined,
  code: string
): string {
  return sizes?.find((term) => term.code === code)?.label ?? code
}

/// "XS–XXL", or the one size when there is only one.
///
/// The ends rather than the whole list: something carrying eight sizes would
/// spend a card's width saying what its two ends already say. The server sends
/// size codes in size order, so the ends are the first and the last rather
/// than a sort every caller has to redo.
export function sizeSpan(
  sizes: readonly VocabularyTerm[] | undefined,
  codes: readonly string[]
): string {
  if (codes.length === 0) return "—"
  if (codes.length === 1) return sizeLabel(sizes, codes[0])
  return `${sizeLabel(sizes, codes[0])}–${sizeLabel(sizes, codes[codes.length - 1])}`
}

/// Toggle one value in a facet selection.
///
/// A facet is a set: a buyer looking at kids and footwear is looking at both,
/// not at the intersection of the two, which is empty.
export function toggle(
  values: readonly string[],
  value: string
): readonly string[] {
  return values.includes(value)
    ? values.filter((each) => each !== value)
    : [...values, value]
}

/// An item typed into the order composer that does not exist yet.
///
/// "New item" on an order used to write the item into the supplier's
/// catalogue the moment its sheet was saved — so an order abandoned halfway
/// left its new items behind in the catalogue, and a line that had not been
/// ordered was already a record. Now the item rides on the draft line as the
/// request it WILL be, and is created when the order is: both land together
/// or neither does. `key` is the create's idempotency key, fixed when the item
/// is drafted, so a raise that fails after the item was made and is pressed
/// again finds the same item rather than minting a second.
export interface PendingItem {
  readonly request: import("@itulah/contract").CreateSupplierItemRequest
  readonly photo: Blob | null
  readonly key: string
  /// How many pieces the order wants, typed on the item form beside the price.
  readonly quantity?: number
  /// The unit it was typed in and how many of it, when not pieces.
  readonly unitCode?: string
  readonly unitQuantity?: string
  /// What one of that unit costs, as typed, when the unit is not pieces. The
  /// request carries the per-piece figure it derives to.
  readonly unitPrice?: string
  /// What the goods will sell for, and the markup that came from.
  readonly basePrice?: string
  readonly markup?: string
  /// How many of each colour and size, and a SKU's own price.
  readonly variants?: readonly import("@/screens/procurement/line-pricing-model").VariantDraft[]
}

/// Where a purchase order stands, as the owner reads it (2026-09-26): active
/// green, partially received blue, short received amber, fully received a
/// settled dark grey, cancelled grey.
export const PO_STATUS: Readonly<
  Record<
    string,
    {
      readonly label: string
      readonly tone: "ok" | "info" | "warn" | "done" | "neutral"
    }
  >
> = {
  ACTIVE: { label: "Active", tone: "ok" },
  PARTIALLY_RECEIVED: { label: "Partially received", tone: "info" },
  SHORT_RECEIVED: { label: "Closed short", tone: "done" },
  FULLY_RECEIVED: { label: "Fully received", tone: "done" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
}

export function poStatus(lifecycle: string) {
  return PO_STATUS[lifecycle] ?? { label: lifecycle, tone: "neutral" as const }
}

/// A quantity of pieces, "1 pc" or "12 pcs".
export function pcs(quantity: number): string {
  return `${count(quantity)} ${quantity === 1 ? "pc" : "pcs"}`
}

/// What an order's terms and conditions say when nobody wrote anything else.
/// Printed under the notes, in Indonesian, on every purchase order.
export const DEFAULT_TERMS =
  "Goods are received Monday to Saturday, 08:00–15:00, with a break from 12:00 to 13:00. On Fridays the break is from 11:30 to 13:00."

/// What `pieces` of a line come to, in whole rupiah, by the one rule: pieces
/// times the price as agreed (per dozen, per kodi or per piece) over the pieces
/// in that unit, rounded once. Never by way of a per-piece price.
export function lineValue(line: PurchaseOrderLine, pieces: number): number {
  if (
    line.order_unit_code &&
    line.unit_factor &&
    line.order_unit_price_minor !== null &&
    line.order_unit_price_minor !== undefined
  )
    return lineTotal(pieces, line.order_unit_price_minor, line.unit_factor)
  return lineTotal(pieces, line.unit_price_minor)
}

/// The order's discount, line by line. Every piece takes the same discount, so
/// a line's share goes by its pieces, to the rupiah, and the shares add up to
/// the order's discount exactly. The server's own split is used when it sends
/// one that adds up.
export function lineDiscounts(order: PurchaseOrderDetail): number[] {
  const server = order.lines.map((line) => line.discount_minor)
  if (
    server.every((one): one is number => one !== undefined) &&
    server.reduce((sum, one) => sum + one, 0) === order.discount_minor
  )
    return server
  return shareOut(
    order.discount_minor,
    order.lines.map((line) => line.ordered_quantity)
  )
}

/// How what arrived stands against what was ordered, or null when they agree.
/// More is over and fewer is short; both are differences. An order nothing has
/// arrived against is not short, it is simply not here yet.
export function receivedGap(
  ordered: number,
  received: number
): { readonly text: string } | null {
  if (received > ordered) return { text: `+${pcs(received - ordered)} over` }
  if (received > 0 && received < ordered)
    return { text: `${pcs(ordered - received)} short` }
  return null
}

/// The colour of a received figure set against what was ordered: green once
/// the line has all it asked for (over included — it did arrive), red while a
/// part is still owed, and nothing while nothing has come in at all (see
/// `receivedGap`: an order nothing has arrived against is not short, it is
/// simply not here yet).
export function receivedTone(
  ordered: number,
  received: number
): "ok" | "bad" | null {
  if (received <= 0) return null
  return received < ordered ? "bad" : "ok"
}

/// A reason from the server as a sentence: the first letter in capitals.
export function sentence(text: string | null | undefined): string | undefined {
  if (text === null || text === undefined || text === "") return undefined
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/// A size as people say it: the vocabulary's label ("M") for the code an order
/// or a SKU carries ("03"). A code the vocabulary does not know stays as it is.
export function useSizeLabel(): (code: string) => string {
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })
  const sizes = vocabulary.data?.sizes
  return (code) => sizeLabel(sizes, code)
}

/// The columns a page-scrolled list has to give up to fit its card, worked out
/// from the card's measured width and the columns' own sizes.
///
/// `DataTable` does this itself while the screen leaves `columnVisibility`
/// alone; Purchase orders and Suppliers control it (the View menu), so they
/// do it here and merge the answer into what the reader chose. A table wider
/// than its card scrolls sideways, and a box that scrolls sideways takes the
/// sticky heading and the floating total with it — so no column is worth that.
///
/// Highest `meta.priority` first, right-most first within one; a priority 1
/// column is never given up. Attach `ref` to a box exactly as wide as the card.
export function useFitHidden(
  columns: ReadonlyArray<{
    id?: string
    accessorKey?: unknown
    columns?: unknown
    size?: number
    meta?: unknown
  }>,
  visibility: Readonly<Record<string, boolean>>,
  /// Columns the reader has touched in the View menu: theirs, never given up
  /// for room. The table may then scroll sideways, which is what they asked for.
  pinned: ReadonlySet<string> = new Set()
): {
  ref: (node: HTMLElement | null) => void
  hidden: Record<string, boolean>
} {
  const [width, setWidth] = useState(0)
  const ref = useCallback((node: HTMLElement | null) => {
    if (node === null) return
    const observer = new ResizeObserver(() => setWidth(node.clientWidth))
    observer.observe(node)
    setWidth(node.clientWidth)
  }, [])

  const leaves: {
    id: string
    size: number
    priority: number
    index: number
  }[] = []
  const walk = (list: ReadonlyArray<any>) => {
    for (const column of list) {
      if (Array.isArray(column.columns)) {
        walk(column.columns)
        continue
      }
      const id =
        column.id ??
        (typeof column.accessorKey === "string"
          ? column.accessorKey
          : undefined)
      if (id === undefined) continue
      const meta = column.meta as
        { priority?: number; grow?: number } | undefined
      leaves.push({
        id,
        size: meta?.grow ?? column.size ?? 150,
        priority: meta?.priority ?? 1,
        index: leaves.length,
      })
    }
  }
  walk(columns)

  const hidden: Record<string, boolean> = {}
  if (width > 0) {
    const shown = leaves.filter((one) => visibility[one.id] !== false)
    let total = shown.reduce((sum, one) => sum + one.size, 0)
    const order = shown
      .filter((one) => one.priority > 1 && !pinned.has(one.id))
      .sort((a, b) => b.priority - a.priority || b.index - a.index)
    for (const one of order) {
      if (total <= width - 2) break
      hidden[one.id] = false
      total -= one.size
    }
  }
  return { ref, hidden }
}

/// A heading group that has shrunk to one visible column is not a group any
/// more: "Ordered" over a lone "Quantity" is two rows and a box to say one
/// thing. The column takes the group's word and stands in the single heading
/// row — "Ordered Quantity" — and a group that still holds two or more stays.
export function flattenSingles<
  T extends {
    id?: string
    accessorKey?: unknown
    columns?: unknown
    header?: unknown
  },
>(columns: readonly T[], hidden: Readonly<Record<string, boolean>>): T[] {
  const idOf = (column: T) =>
    column.id ??
    (typeof column.accessorKey === "string" ? column.accessorKey : undefined)
  return columns.map((column) => {
    if (!Array.isArray(column.columns)) return column
    const shown = (column.columns as T[]).filter((one) => {
      const id = idOf(one)
      return id === undefined || hidden[id] !== false
    })
    if (shown.length !== 1 || typeof column.header !== "string") return column
    const only = shown[0]
    const header =
      typeof only.header === "string"
        ? `${column.header} ${only.header}`
        : column.header
    return { ...only, header }
  })
}

/// The View menu's column switches, with the room the card has taken into
/// account: what the reader switched stays as they set it, and any other
/// low-priority column the card has no room for is left out (`useFitHidden`).
///
/// The menu is drawn from `shown`, so a column the card gave up reads as off,
/// and one press turns it on — and pins it. Without the pin, a column switched
/// on was given up again on the next measure and the switch did nothing (a
/// tester tried four columns at laptop width).
export function useFittedVisibility(
  columns: Parameters<typeof useFitHidden>[0],
  initial: Record<string, boolean>
) {
  const [visibility, setVisibility] = useState<Record<string, boolean>>(initial)
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set())
  const fit = useFitHidden(columns, visibility, pinned)
  const shown = { ...visibility, ...fit.hidden }
  const change = (
    next:
      | Record<string, boolean>
      | ((was: Record<string, boolean>) => Record<string, boolean>)
  ) => {
    const resolved = typeof next === "function" ? next(shown) : next
    const touched = Object.keys(resolved).filter(
      (id) => (resolved[id] ?? true) !== (shown[id] ?? true)
    )
    if (touched.length === 0) return
    setVisibility((was) => ({
      ...was,
      ...Object.fromEntries(touched.map((id) => [id, resolved[id] ?? true])),
    }))
    setPinned((was) => new Set([...was, ...touched]))
  }
  return { visibility, shown, change, ref: fit.ref, hidden: fit.hidden }
}
