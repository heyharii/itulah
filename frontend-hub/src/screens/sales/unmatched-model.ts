import {
  ArrowRightLeft,
  CircleHelp,
  Layers,
  PackageSearch,
  createLucideIcon,
  type LucideIcon,
} from "lucide-react"

import { sku } from "@/lib/format"
import type {
  UnmatchedKind,
  UnmatchedSale,
  UnmatchedStatus,
} from "@/lib/queries/unmatched"

/// What Sales › Unmatched sales says, in one place for the page and its sheet
/// (`unmatched-sales-prototype.html` is the spec).

/// The three tabs, in the order the prototype draws them.
export const TABS: readonly { value: UnmatchedStatus; label: string }[] = [
  { value: "open", label: "To match" },
  { value: "matched", label: "Matched" },
  { value: "found", label: "Found" },
]

/// A tag with a line through it: lucide has the tag and the line, not the two
/// together, and "No tag" is the one kind that is about a missing tag.
const TagOff = createLucideIcon("TagOff", [
  [
    "path",
    {
      d: "M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z",
      key: "tag",
    },
  ],
  [
    "circle",
    { cx: "7.5", cy: "7.5", r: ".5", fill: "currentColor", key: "eye" },
  ],
  ["path", { d: "m2 2 20 20", key: "line" }],
])

/// The four kinds of line a till could not take from its own store's stock, in
/// the order of the chips: No tag · Other place · Not in stock · Unknown item
/// (the till's own words: Tanpa tag · Dari {tempat} · Luar toko · Tak dikenal).
export const KINDS: readonly UnmatchedKind[] = [
  "NO_TAG",
  "OTHER",
  "NOT_IN_STOCK",
  "UNKNOWN",
]

export const KIND_WORD: Readonly<Record<UnmatchedKind, string>> = {
  NO_TAG: "No tag",
  OTHER: "Other place",
  NOT_IN_STOCK: "Not in stock",
  UNKNOWN: "Unknown item",
}

export const KIND_ICON: Readonly<Record<UnmatchedKind, LucideIcon>> = {
  NO_TAG: TagOff,
  OTHER: ArrowRightLeft,
  NOT_IN_STOCK: PackageSearch,
  UNKNOWN: CircleHelp,
}

/// "All", the chip that comes first.
export const ALL_ICON: LucideIcon = Layers

/// A sale still to match after this many days is shown in red.
export const OVERDUE_DAYS = 30

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/// What the head of store typed for an unknown item, capitalised.
export const typedName = (row: UnmatchedSale) => capital(row.name ?? "")

/// The article's name as the row reads it: the catalogue's once it has a SKU,
/// else what the head of store typed.
export function nameOf(row: UnmatchedSale): string {
  if (row.article_name !== null && row.article_name !== "")
    return row.article_name
  if (row.name !== null && row.name !== "") return typedName(row)
  return sku(row.sku_code)
}

/// "Khaki · 32", or nothing for a SKU without a colour and a size.
export function variantOf(row: {
  readonly colour: string | null
  readonly size: string | null
}): string {
  return [row.colour, row.size]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ")
}

/// The grey line under an article: "Khaki · 32 · 00011040·132", or "No SKU"
/// for an item nobody has identified yet.
export function variantLine(row: UnmatchedSale): string {
  if (row.sku_code === null) return "No SKU"
  return [variantOf(row), sku(row.sku_code)]
    .filter((part) => part !== "")
    .join(" · ")
}

/// Whole days between a moment and today, by the calendar.
export function daysSince(iso: string): number {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 0
  const start = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.round((start(new Date()) - start(at)) / 86_400_000)
}

/// Sold longer ago than a month and still not matched.
export const overdue = (row: UnmatchedSale) =>
  row.status === "OPEN" && daysSince(row.sold_at) > OVERDUE_DAYS

/// The count a piece was found at: "Count · CC-0093" → "CC-0093".
export const countDoc = (row: UnmatchedSale) =>
  (row.matched_with ?? "").replace(/^Count · /, "") || "—"

const stamp = (iso: string | null) => {
  const at = iso === null ? Number.NaN : Date.parse(iso)
  return Number.isNaN(at) ? 0 : at
}

/// To match: the oldest sale first, the one waiting longest. Matched and
/// Found: the latest first.
export function ordered(
  rows: readonly UnmatchedSale[],
  tab: UnmatchedStatus
): UnmatchedSale[] {
  return [...rows].sort((a, b) =>
    tab === "open"
      ? stamp(a.sold_at) - stamp(b.sold_at)
      : stamp(b.matched_at ?? b.sold_at) - stamp(a.matched_at ?? a.sold_at)
  )
}

/// What the search box reads in a row.
export const haystack = (row: UnmatchedSale) =>
  [
    nameOf(row),
    variantOf(row),
    row.sku_code ?? "",
    sku(row.sku_code),
    row.site_name,
    row.receipt_no,
    row.cashier_name ?? "",
  ]
    .join(" ")
    .toLowerCase()
