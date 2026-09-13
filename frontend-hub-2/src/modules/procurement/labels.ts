import type { SupplierItem, VocabularyTerm } from "@itulah/contract"

/// The words this module reads out loud, and the codes underneath them.
///
/// No JSX here on purpose — a column definition imports from this file, and a
/// module that exports a mix of components and plain functions is one Fast
/// Refresh cannot hot-swap. The marks live next door in `parts.tsx`.
///
/// ## Why every one of these falls back to the CODE
///
/// Because a code the vocabulary has not caught up with is a real row that a
/// buyer has to deal with, and blanking it makes the item look unclassified
/// when it is not. `KAUS_KAKI` in front of somebody is bad; an empty cell that
/// hides a filing mistake is worse.

/// `KAUS_KAKI` → "Kaus Kaki".
export function termLabel(
  terms: readonly VocabularyTerm[] | undefined,
  code: string | null | undefined,
): string {
  if (!code) return "—"
  return terms?.find((term) => term.code === code)?.label ?? code
}

/// `03` → "M", from the size table the server sent.
///
/// The table is read rather than transcribed. `frontend-hub` carried a
/// hardcoded map copied out of the `size_code` seed; it was correct on the day
/// it was written and silently read `21` for every size added afterwards.
export function sizeLabel(
  sizes: readonly VocabularyTerm[] | undefined,
  code: string,
): string {
  return sizes?.find((term) => term.code === code)?.label ?? code
}

/// "XS–XXL", or the one size when there is only one.
///
/// The ends rather than the whole list: an item carrying eight sizes would
/// spend a card's width saying what its two ends already say. The server sends
/// size codes in size order, so the ends are the first and the last rather than
/// a sort every caller has to redo.
export function sizeSpan(
  sizes: readonly VocabularyTerm[] | undefined,
  codes: readonly string[],
): string {
  if (codes.length === 0) return "—"
  if (codes.length === 1) return sizeLabel(sizes, codes[0])
  return `${sizeLabel(sizes, codes[0])}–${sizeLabel(sizes, codes[codes.length - 1])}`
}

/// Where an order STANDS, in a word somebody says out loud.
///
/// These are the server's derived lifecycle, not the stored `order_status`.
/// That column only ever reads `ISSUED` or `CLOSED`, so a book drawn from it
/// showed an order that had arrived in full as though it were still waiting —
/// and offered a "Draft" tab for a state nothing can produce, because raising
/// an order issues it.
///
/// A declared set rather than one derived from the rows: "show me what is still
/// outstanding" is an answer somebody is looking for, and a tab built from the
/// data cannot give it because the option disappears with the last row.
export const ORDER_STATUS: Record<
  string,
  { label: string; tone: "neutral" | "ok" | "warn" | "bad" }
> = {
  ACTIVE: { label: "Nothing yet", tone: "warn" },
  PARTIALLY_RECEIVED: { label: "Part arrived", tone: "warn" },
  FULLY_RECEIVED: { label: "All arrived", tone: "ok" },
  CLOSED: { label: "Closed", tone: "neutral" },
}

export const ORDER_STATUSES = [
  "ACTIVE",
  "PARTIALLY_RECEIVED",
  "FULLY_RECEIVED",
  "CLOSED",
]

export function orderStatusLabel(code: string): string {
  return ORDER_STATUS[code]?.label ?? code
}

export function orderStatusTone(code: string): "neutral" | "ok" | "warn" | "bad" {
  return ORDER_STATUS[code]?.tone ?? "neutral"
}

/// How far an item is from being something we can actually sell.
///
///   0 — no division. It cannot be filed.
///   1 — filed, but no article code of ours. It can be ordered and received and
///       can never be tagged, priced or sold, because a SKU is OUR article code
///       plus a colour and a size.
///   2 — finished.
///
/// A number rather than three booleans because it is an ORDER: the list sorts
/// by it ascending so the rows somebody has to finish lead.
export function readinessOf(item: SupplierItem): 0 | 1 | 2 {
  if (item.division_code === null) return 0
  if (item.internal_article_code === null) return 1
  return 2
}

export const READINESS: Record<
  number,
  { label: string; tone: "neutral" | "ok" | "warn" }
> = {
  0: { label: "Unclassified", tone: "warn" },
  1: { label: "Not linked", tone: "neutral" },
  2: { label: "Ready", tone: "ok" },
}

/// Whole rupiah or whole pieces from what somebody typed, falling back when it
/// is not a number yet.
///
/// A blank box is somebody mid-edit, not an order for nothing — which is why
/// the fallback is a parameter rather than zero. Parsing on every keystroke
/// without one turns an emptied field into an order for zero and a `1` on the
/// way to `150` into an order for one.
export function whole(text: string, fallback: number): number {
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/// The next number in the series, from the orders already raised.
///
/// `PO-20260904-2217` is the shape the book is written in: the day it was
/// raised, then a counter that does not restart. So the counter is the largest
/// tail anybody has used plus one — read from the book rather than invented,
/// because a number that collides is refused by a UNIQUE constraint and the
/// buyer is the one left guessing again.
///
/// **It is a suggestion, not an allocation.** Nothing reserves it, two people
/// composing at once are offered the same one, and the second to press Create
/// is told the number is taken. That is the honest failure for a book with no
/// server-side counter behind it, and it is why a refused order refetches the
/// book: the next press is offered a number that is free.
export function nextPoNumber(
  existing: readonly { po_number: string }[],
): string {
  const highest = existing.reduce((top, order) => {
    const tail = /-(\d+)$/.exec(order.po_number)
    if (tail === null) return top
    const seen = Number.parseInt(tail[1], 10)
    return Number.isFinite(seen) && seen > top ? seen : top
  }, 0)
  const today = new Date()
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("")
  return `PO-${stamp}-${String(highest + 1).padStart(4, "0")}`
}

/// One value in or out of a facet selection.
///
/// A facet is a SET: a buyer looking at kids and footwear is looking at both,
/// not at the intersection of the two, which is empty.
export function toggle(
  values: readonly string[],
  value: string,
): readonly string[] {
  return values.includes(value)
    ? values.filter((each) => each !== value)
    : [...values, value]
}
