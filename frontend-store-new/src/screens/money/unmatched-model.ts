import {
  ArrowRightLeft,
  CircleHelp,
  Layers,
  PackageSearch,
  createLucideIcon,
  type LucideIcon,
} from "lucide-react"

import { dateText, sku as skuText } from "@/lib/format"
import type {
  UnmatchedKind,
  UnmatchedSale,
  UnmatchedStatus,
} from "@/lib/queries/unmatched"

/// Money › Unmatched sales, as the prototype (`unmatched-sales-prototype.html`,
/// `?app=store`) says it: the words, the marks and the small rules, apart from
/// the screen that draws them.

/// A price tag struck through — the till could not read one. Lucide has the tag
/// and the strike, not the two together.
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
    { cx: "7.5", cy: "7.5", r: ".5", fill: "currentColor", key: "hole" },
  ],
  ["path", { d: "m2 2 20 20", key: "strike" }],
])

/// The tabs, in the order head office works the list: what waits, then what
/// has been dealt with.
export const STATUSES: readonly { value: UnmatchedStatus; label: string }[] = [
  { value: "open", label: "To match" },
  { value: "matched", label: "Matched" },
  { value: "found", label: "Found" },
]

/// The till's four kinds of line it could not take from the shop's own stock
/// (POS: Tanpa tag · Dari {tempat} · Luar toko · Tak dikenal).
export const KINDS: readonly {
  value: UnmatchedKind
  label: string
  icon: LucideIcon
}[] = [
  { value: "NO_TAG", label: "No tag", icon: TagOff },
  { value: "OTHER", label: "Other place", icon: ArrowRightLeft },
  { value: "NOT_IN_STOCK", label: "Not in stock", icon: PackageSearch },
  { value: "UNKNOWN", label: "Unknown item", icon: CircleHelp },
]

/// "All" leads the chips and the kind sheet.
export const ALL_KINDS = { label: "All", icon: Layers } as const

export function kindWord(kind: UnmatchedKind): string {
  return KINDS.find((one) => one.value === kind)?.label ?? kind
}

/// The word a sheet's title and a row's name stand on: what head office's book
/// calls the article, or what the store head typed for an unknown item.
export function titleOf(row: UnmatchedSale): string {
  if (row.article_name !== null && row.article_name !== "")
    return row.article_name
  return (
    typedOf(row) ??
    (row.sku_code !== null ? skuText(row.sku_code) : "Unknown item")
  )
}

/// What the store head typed for an item with no SKU, with its first capital.
export function typedOf(row: UnmatchedSale): string | null {
  const typed = row.name?.trim() ?? ""
  return typed === "" ? null : typed.charAt(0).toUpperCase() + typed.slice(1)
}

/// "Khaki · 32 · 00011040·132", or "No SKU" for an item nobody could name.
export function variantOf(row: UnmatchedSale): string {
  if (row.sku_code === null || row.sku_code === "") return "No SKU"
  return [row.colour, row.size, skuText(row.sku_code)]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ")
}

/// How the sale was matched, as head office words it.
export function matchedWithOf(row: UnmatchedSale): string {
  return row.matched_with === null || row.matched_with === ""
    ? "—"
    : row.matched_with
}

/// A find's count document, out of "Count · CC-0093".
export function countDocOf(row: UnmatchedSale): string {
  const said = matchedWithOf(row)
  return said.replace(/^Count\s*·\s*/, "")
}

/// "14:12", on the clock of the machine that shows it.
export function timeText(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return "—"
  return dateText(at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
}

const DAY_MS = 86_400_000

/// Whether a sale has waited more than 30 days, counted in calendar days.
export function overdue(iso: string, now: Date = new Date()): boolean {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return false
  const startOf = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.round((startOf(now) - startOf(at)) / DAY_MS) > 30
}

/// Oldest sale first while it waits — it is the one to chase — and the latest
/// answer first once it has one.
export function sorted(
  rows: readonly UnmatchedSale[],
  status: UnmatchedStatus,
): UnmatchedSale[] {
  const at = (iso: string | null) => (iso === null ? 0 : Date.parse(iso) || 0)
  return [...rows].sort((a, b) =>
    status === "open"
      ? at(a.sold_at) - at(b.sold_at)
      : at(b.matched_at ?? b.sold_at) - at(a.matched_at ?? a.sold_at),
  )
}

/// What a search is read against: the article and its variant, the SKU as
/// typed and as shown, the receipt and the cashier.
export function haystackOf(row: UnmatchedSale): string {
  return [
    titleOf(row),
    row.colour ?? "",
    row.size ?? "",
    row.sku_code ?? "",
    row.sku_code === null ? "" : skuText(row.sku_code),
    row.receipt_no,
    row.cashier_name ?? "",
  ]
    .join(" ")
    .toLowerCase()
}
