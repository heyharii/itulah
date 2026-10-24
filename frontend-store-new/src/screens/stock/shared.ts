import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { decodeEpc } from "@/lib/epc"
import { label as humanise, type Tone } from "@/lib/format"
import { catalogueQuery, movementsQuery } from "@/lib/queries"
import type { CatalogRow, MovementView } from "@itulah/contract"

/// The facts the three Stock screens share — the places, the ledger and the
/// words for both. Nothing here draws; the drawn pieces are in `parts.tsx`.

// ── The places ──────────────────────────────────────────────────────────────

/// The three places a shop's stock can be. Their codes are the second segment
/// of the pool id the node mints (`store-01.floor`), which is why they are
/// written once here and nowhere else.
export const PLACES = [
  { code: "warehouse", label: "Warehouse" },
  { code: "floor", label: "Store" },
  { code: "reject", label: "Reject" },
] as const

export type PlaceCode = (typeof PLACES)[number]["code"]

export function isPlaceCode(value: string): value is PlaceCode {
  return PLACES.some((place) => place.code === value)
}

/// `store-01.floor` → `floor`. Null for anything that is not one of the
/// shop's own three.
export function placeCodeOf(poolId: string): PlaceCode | null {
  const segment = poolId.split(":")[0].split(".").slice(1).join(".")
  return isPlaceCode(segment) ? segment : null
}

export function placeLabel(code: PlaceCode): string {
  return PLACES.find((place) => place.code === code)?.label ?? code
}

/// One end of a movement, read as words.
export interface Place {
  /// "Sales floor", "A customer", "Delivery".
  readonly name: string
  /// Drawn only when it is not `on_hand` — a piece moved to the missing half
  /// of its own pool reads as a no-op if the suffix is dropped.
  readonly state: string | null
  /// Inside the pool grammar at all. Stock crossing that line is arriving or
  /// leaving rather than moving about the shop.
  readonly inside: boolean
}

/// `store-01.floor:on_hand` → Sales floor. A place id is a wire format and
/// nobody standing at a counter should have to read one.
///
/// `cause` is there for the one place whose name depends on why it was used:
/// a receipt posts out of `system/opening`, and "Opening balance" on a
/// delivery that came in this morning is the ledger's word, not the shop's.
export function readPlace(id: string, cause?: string): Place {
  const cut = id.lastIndexOf(":")
  if (cut === -1) {
    return { name: outsideName(id, cause), state: null, inside: false }
  }
  const pool = id.slice(0, cut)
  const state = id.slice(cut + 1)
  const code = placeCodeOf(pool)
  const segment = pool.split(".").slice(1).join(" / ")
  return {
    name:
      code !== null
        ? placeLabel(code)
        : segment === ""
          ? pool
          : humanise(segment.replace(/\./g, " ")),
    state: state === "on_hand" ? null : humanise(state).toLowerCase(),
    inside: true,
  }
}

function outsideName(id: string, cause?: string): string {
  if (id.startsWith("external/customer")) return "A customer"
  if (id.startsWith("external/supplier")) return "A supplier"
  if (id.startsWith("external/disposal")) return "Disposal"
  if (id.startsWith("system/opening"))
    return cause === "STORE_RECEIVE" ? "Delivery" : "Opening balance"
  if (id.startsWith("system/count_gain")) return "Found in a count"
  if (id.startsWith("system/lost")) return "Written off"
  if (id.startsWith("system/identification")) return "Identified"
  return humanise(id.slice(id.lastIndexOf("/") + 1))
}

// ── The ledger ──────────────────────────────────────────────────────────────

/// The node caps a read at 500 and defaults to 100. A hundred is a shop's day;
/// five hundred is the most the node will hand over in one answer.
export const LEDGER_LIMIT = 100
export const LEDGER_MAX = 500

/// The newest movements, under the same key every Stock screen reads — so the
/// ledger the Movements screen fetched is the one a pool's detail and the move
/// sheet read from, and one write invalidates all three.
export function useLedger(limit: number = LEDGER_LIMIT, enabled = true) {
  return useQuery({
    ...movementsQuery(limit),
    enabled,
    // Asking for a longer page keeps the shorter one on screen while it
    // comes, rather than emptying the table to a loading line.
    placeholderData: (previous) => previous,
  })
}

/// Which movements mean something is wrong, and which are the ordinary day.
///
/// `toneFor` covers the shared status taxonomy; these are causes it has never
/// seen, and guessing at them from the word would put "confirmed lost" and
/// "found" in the same colour. The ordinary ones are neutral on purpose — a
/// ledger of green sales is a column of confetti, and the eye should stop on
/// the corrections and the losses, not on Tuesday.
const CAUSE_TONE: Readonly<Record<string, Tone>> = {
  CUSTOMER_RETURN: "info",
  RETURN_TO_DC: "info",
  SUPPLIER_RETURN: "info",
  PLACEMENT_CORRECTION: "warn",
  COUNT_SHORTAGE: "warn",
  CONFIRMED_LOST: "bad",
  DISPOSAL: "bad",
}

export function causeTone(cause: string): "neutral" | "info" | "warn" | "bad" {
  const tone = CAUSE_TONE[cause]
  return tone === "info" || tone === "warn" || tone === "bad" ? tone : "neutral"
}

/// The cause as the shop says it. `STORE_RECEIVE` is "Received" at a counter,
/// and `NORMAL_MOVE` is simply a move.
export function causeLabel(cause: string): string {
  switch (cause) {
    case "STORE_RECEIVE":
      return "Received"
    case "NORMAL_MOVE":
      return "Moved"
    case "RETURN_TO_DC":
      return "Back to the DC"
    default:
      return humanise(cause)
  }
}

/// Which way a movement crossed the shop's walls.
///
///  - `in` — arrived: a delivery, a customer's return, a piece found in a
///    count.
///  - `out` — left: a sale, a return to the DC, a write-off.
///  - `inside` — both ends are the shop's own places, including a piece
///    moving to the missing half of its own pool.
export type Direction = "in" | "out" | "inside"

export function directionOf(row: Pick<MovementView, "from" | "to">): Direction {
  const from = ours(row.from)
  const to = ours(row.to)
  if (from && to) return "inside"
  return to ? "in" : "out"
}

export const DIRECTION_WORD: Readonly<Record<Direction, string>> = {
  in: "In",
  out: "Out",
  inside: "Inside",
}

/// "Store room → Sales floor": a movement's route as one line of words, for a
/// card. The chips (`Route` in `parts.tsx`) are for a sheet, where there is
/// room for two boxes and an arrow.
export function routeText(from: string, to: string, cause?: string): string {
  const say = (id: string) => {
    const place = readPlace(id, cause)
    return place.state === null ? place.name : `${place.name} (${place.state})`
  }
  return `${say(from)} → ${say(to)}`
}

/// Where a delivery came from, as the shop says it: the DC, or the site's own
/// name.
export function sourceName(siteId: string): string {
  return siteId.toLowerCase() === "dc" ? "DC" : humanise(siteId)
}

/// One of this shop's three places. A DC's pool is inside the pool grammar
/// and still outside the shop, so the grammar alone does not answer this.
function ours(id: string): boolean {
  return placeCodeOf(id) !== null
}

// ── The range ───────────────────────────────────────────────────────────────

/// The SKU a tag was written for, read off the tag itself. Null for a tag
/// that is not ours — the ledger can still hold one from before the codec.
export function skuOf(epc: string): string | null {
  return decodeEpc(epc)?.sku_code ?? null
}

/// The resident price book as a lookup by SKU, for naming a garment.
///
/// The same key the Catalogue screen reads, so on a till that has opened it
/// this costs nothing; on one that has not, it is one read of a SQLite file in
/// the next room, and it answers with the line down.
export function useRange(enabled = true) {
  const catalogue = useQuery({ ...catalogueQuery(), enabled })
  const bySku = useMemo(() => {
    const index = new Map<string, CatalogRow>()
    for (const row of catalogue.data?.items ?? []) index.set(row.sku_code, row)
    return index
  }, [catalogue.data])
  return { catalogue, bySku }
}

/// A search box's needle against every word a row carries.
export function matches(
  needle: string,
  ...fields: readonly (string | null | undefined)[]
): boolean {
  if (needle === "") return true
  const plain = needle.replace(/·/g, "")
  return fields.some((field) => {
    const low = field?.toLowerCase()
    return low?.includes(needle) === true || low?.includes(plain) === true
  })
}
