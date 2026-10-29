/// The facts of Central Gudang's list that do not draw anything: the keys, the
/// places each move takes from and puts into, a draft and what scanning does to
/// it. `warehouse.tsx` holds the state and the effects; this is the part that
/// can be read — and checked — on its own.

import type { Held, Place, Reason, Room } from "@/gudang/api"
import { readScan } from "@epc"

// ── the keys ────────────────────────────────────────────────────────────

/// One key per kind of move, in the till's own toolbar.
export type ModeId = "in" | "floor" | "back" | "reject" | "ho"

/// The two lists that take the item list's place.
export type ListId = "check" | "history"

export type Mode = {
  readonly key: string
  readonly label: string
  /// The flag above the list.
  readonly flag: string
  /// Where it can take from; the first is the default, and more than one is a
  /// "Dari" choice.
  readonly from: readonly Place[]
  readonly to: Place
  /// A reason is picked on every line.
  readonly why?: true
}

export const MODES: Readonly<Record<ModeId, Mode>> = {
  in: { key: "F1", label: "Terima", flag: "Terima barang", from: ["dc"], to: "warehouse" },
  floor: { key: "F2", label: "Ke toko", flag: "Gudang → Toko", from: ["warehouse"], to: "floor" },
  back: { key: "F3", label: "Ke gudang", flag: "Toko → Gudang", from: ["floor"], to: "warehouse" },
  reject: { key: "F4", label: "Reject", flag: "Reject", from: ["floor", "warehouse"], to: "reject", why: true },
  ho: { key: "F5", label: "Kirim HO", flag: "Kirim ke HO", from: ["reject", "warehouse", "floor"], to: "ho" },
}

/// The toolbar, in the keyboard's order; a gap is drawn before F9.
export const KEYMAP: readonly (readonly [string, string, ModeId | ListId])[] = [
  ["F1", "Terima", "in"],
  ["F2", "Ke toko", "floor"],
  ["F3", "Ke gudang", "back"],
  ["F4", "Reject", "reject"],
  ["F5", "Kirim HO", "ho"],
  ["F9", "Cek stok", "check"],
  ["F10", "Riwayat", "history"],
]

export const isMode = (id: ModeId | ListId): id is ModeId => id !== "check" && id !== "history"

/// As the screen and the surat jalan say a place.
export const PLACE: Readonly<Record<Place, string>> = {
  dc: "DC",
  warehouse: "Gudang",
  floor: "Toko",
  reject: "Reject",
  ho: "HO",
}

export const routeText = (from: Place, to: Place) => `${PLACE[from]} → ${PLACE[to]}`

// ── a draft ─────────────────────────────────────────────────────────────

export type Line = {
  readonly sku: string
  readonly qty: number
  /// Terima: what the surat jalan says was sent; null for a piece it did not carry.
  readonly sent: number | null
  readonly why: Reason | null
}

/// The delivery a surat jalan named, for the line above the list.
export type Delivery = {
  readonly id: string
  /// The surat jalan number.
  readonly no: string
  readonly from: string
  readonly koli: number
}

/// One list per move: switching keys loses nothing.
export type Draft = {
  readonly lines: readonly Line[]
  /// The row ↑ ↓ and the numpad's + and − are about.
  readonly sel: number
  /// Terima only.
  readonly delivery: Delivery | null
  /// The tags already counted: one tag is one piece, however often the pad hears it.
  readonly epcs: ReadonlySet<string>
  /// Terima: the SKUs whose count now comes from tags read, not from what was
  /// sent. The first tag of a SKU starts its count over, so the pieces on the
  /// pad are the pieces received; the next tags add to it.
  readonly tallied: ReadonlySet<string>
}

export const emptyDraft: Draft = { lines: [], sel: 0, delivery: null, epcs: new Set(), tallied: new Set() }

export const emptyDrafts = (): Record<ModeId, Draft> => ({
  in: emptyDraft,
  floor: emptyDraft,
  back: emptyDraft,
  reject: emptyDraft,
  ho: emptyDraft,
})

export const pieces = (lines: readonly Line[]) => lines.reduce((sum, line) => sum + line.qty, 0)

/// The most a quantity box takes: four digits.
export const MOST = 9999

/// What stands at the source of a move, in pieces. Infinity where it is not
/// counted (the DC) or not known yet — a node that did not answer must not
/// block a save its own check will make anyway.
export function have(stock: ReadonlyMap<string, Held> | null, sku: string, place: Place): number {
  if (stock === null || (place !== "warehouse" && place !== "floor" && place !== "reject")) return Infinity
  const row = stock.get(sku)
  return row === undefined ? 0 : (row[place] ?? 0)
}

/// The room a place is, when it is one the node counts.
export const roomOf = (place: Place): Room | null =>
  place === "warehouse" || place === "floor" || place === "reject" ? place : null

/// What is wrong with a line, or null: short of stock where it is taken from,
/// or a Reject with no reason. A line of no pieces is no line at all.
export function problemOf(
  mode: ModeId,
  line: Line,
  held: number,
): "Stok" | "Alasan" | null {
  if (line.qty === 0) return null
  if (mode !== "in" && line.qty > held) return "Stok"
  if (MODES[mode].why === true && line.why === null) return "Alasan"
  return null
}

// ── scanning ────────────────────────────────────────────────────────────

/// What came out of the scan field: a SKU or a tag of one (with the pieces a
/// "3*" asked for), or something that is neither — a surat jalan number in
/// Terima.
export type Scanned =
  | { readonly kind: "sku"; readonly sku: string; readonly epc: string | null; readonly count: number | null }
  | { readonly kind: "other"; readonly text: string }

/// `3*10021345104`: a quantity of one to three digits, a star and the code.
const WITH_COUNT = /^(\d{1,3})\s*\*\s*(\S+)$/

export function readCode(raw: string): Scanned {
  const text = raw.trim().toUpperCase()
  const counted = WITH_COUNT.exec(text)
  const code = counted === null ? text : (counted[2] ?? "")
  const read = readScan(code.replace(/[·.\s-]/g, ""))
  if (read.kind === "epc") {
    return { kind: "sku", sku: read.sku_code, epc: read.epc, count: counted === null ? null : Number(counted[1]) }
  }
  if (read.kind === "sku") {
    return { kind: "sku", sku: read.sku_code, epc: null, count: counted === null ? null : Number(counted[1]) }
  }
  return { kind: "other", text }
}

/// One thing scanned, to be folded into a draft.
export type Entry = {
  readonly sku: string
  readonly epc: string | null
  /// The pieces a "3*" named; null for one.
  readonly count: number | null
}

/// Fold what was scanned into a draft. A tag counts once. In Terima the list
/// is what was sent, already counted as sent: a scan of a SKU's code on it only
/// takes the receiver to its row (or sets the figure, when a quantity came with
/// it) — the store app's rule for the same count — while the tags of a SKU read
/// by the reader are a count, which starts over at the first tag and adds after
/// it. A SKU the surat jalan did not carry is added, a piece at a time. In every
/// other key a scan adds.
export function fold(
  draft: Draft,
  mode: ModeId,
  entries: readonly Entry[],
): { readonly draft: Draft; readonly skipped: number } {
  let lines = draft.lines
  let sel = draft.sel
  let skipped = 0
  const epcs = new Set(draft.epcs)
  const tallied = new Set(draft.tallied)
  for (const one of entries) {
    if (one.epc !== null) {
      if (epcs.has(one.epc)) {
        skipped += 1
        continue
      }
      epcs.add(one.epc)
    }
    const at = lines.findIndex((line) => line.sku === one.sku)
    const n = Math.min(MOST, one.count ?? 1)
    if (at < 0) {
      lines = [...lines, { sku: one.sku, qty: n, sent: null, why: null }]
      sel = lines.length - 1
    } else if (mode === "in" && lines[at].sent !== null) {
      if (one.epc !== null) {
        const fresh = !tallied.has(one.sku)
        tallied.add(one.sku)
        lines = lines.map((line, i) => (i === at ? { ...line, qty: Math.min(MOST, (fresh ? 0 : line.qty) + n) } : line))
      } else if (one.count !== null) {
        lines = lines.map((line, i) => (i === at ? { ...line, qty: n } : line))
      }
      sel = at
    } else {
      lines = lines.map((line, i) => (i === at ? { ...line, qty: Math.min(MOST, line.qty + n) } : line))
      sel = at
    }
  }
  return { draft: { ...draft, lines, sel, epcs, tallied }, skipped }
}

/// A key for one try at a save: the same list is the same try.
export function signature(mode: ModeId, from: Place, draft: Draft): string {
  return JSON.stringify([
    mode,
    from,
    draft.delivery?.id ?? null,
    draft.lines.filter((line) => line.qty > 0).map((line) => [line.sku, line.qty, line.why]),
  ])
}

// ── words ───────────────────────────────────────────────────────────────

const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
const two = (n: number) => String(n).padStart(2, "0")
export const hm = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}`
/// "25 Okt 2026, 09:12", as the status strip writes it.
export const dayTime = (d: Date) => `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${hm(d)}`
/// "25 Okt · 08:54", for a list.
export const dayClock = (d: Date) => `${d.getDate()} ${MON[d.getMonth()]} · ${hm(d)}`

/// A date from the node; "—" when it did not send one that reads.
export function when(iso: string | null, as: (d: Date) => string): string {
  if (iso === null) return "—"
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : as(at)
}

/// Where a delivery came from, as a surat jalan reads: "DC", or the site's own
/// name with its words spaced and capitalised.
export function sourceWord(siteId: string): string {
  const id = siteId.trim()
  if (id.toLowerCase() === "dc") return "DC"
  return id
    .replace(/[-_]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/^Dc\b/, "DC")
}

/// Two letters for an avatar: the first of the first two names, or the first
/// two of a single one.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== "")
  if (words.length === 0) return ""
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase()
  return `${(words[0] ?? "")[0] ?? ""}${(words[1] ?? "")[0] ?? ""}`.toUpperCase()
}
