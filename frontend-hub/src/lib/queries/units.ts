import {
  queryOptions,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query"
import type {
  CreateUnitConversionRequest,
  CreateUnitRequest,
  UnitConversion,
  UnitOfMeasure,
  UnitsBook,
  UpdateUnitConversionRequest,
  UpdateUnitRequest,
} from "@itulah/contract"

import { node } from "@/lib/api"
import { count, quantity } from "@/lib/format"

export type {
  CreateUnitConversionRequest,
  CreateUnitRequest,
  UnitConversion,
  UnitOfMeasure,
  UnitsBook,
  UpdateUnitConversionRequest,
  UpdateUnitRequest,
}

/// Units of measure, and how many pieces each is.
///
/// Stock is kept in pieces and every quantity the server stores is one. A
/// supplier quotes by the LUSIN (12) or the KODI (20), so a buyer may order in
/// either — and the screen converts to pieces before it sends, reading the
/// factor from this master rather than from a constant. See migration 0394.

/// The unit stock is kept in, when nothing better is known.
export const BASE_UNIT = "PCS"

export const unitKeys = {
  all: ["units"] as const,
  book: () => ["units", "book"] as const,
}

/// Every unit and every conversion, retired ones included. Small enough to
/// hold whole — a company has a handful of units, not a thousand.
export function listUnits(signal?: AbortSignal) {
  return node.get<UnitsBook>("/api/v1/units", { signal })
}

function guarded(
  idempotencyKey: string,
  version?: number
): Record<string, string> {
  const headers: Record<string, string> = {
    "Idempotency-Key": idempotencyKey,
  }
  if (version !== undefined) headers["If-Match"] = `"${version}"`
  return headers
}

export function createUnit(
  request: CreateUnitRequest,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<UnitOfMeasure>("/api/v1/units", request, {
    signal,
    headers: guarded(idempotencyKey),
  })
}

/// The version is required: the handler refuses a PATCH without `If-Match`.
export function updateUnit(
  code: string,
  request: UpdateUnitRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.request<UnitOfMeasure>(
    "PATCH",
    `/api/v1/units/${encodeURIComponent(code)}`,
    request,
    { signal, headers: guarded(idempotencyKey, version) }
  )
}

export function createUnitConversion(
  request: CreateUnitConversionRequest,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<UnitConversion>("/api/v1/unit-conversions", request, {
    signal,
    headers: guarded(idempotencyKey),
  })
}

export function updateUnitConversion(
  conversionId: string,
  request: UpdateUnitConversionRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.request<UnitConversion>(
    "PATCH",
    `/api/v1/unit-conversions/${encodeURIComponent(conversionId)}`,
    request,
    { signal, headers: guarded(idempotencyKey, version) }
  )
}

/// The unit book as a query, for the master screen and for the prefetcher
/// (`screens/inventory/prefetch.ts`). A unit list changes a few times a year.
export const unitsBookQuery = () =>
  queryOptions({
    queryKey: unitKeys.book(),
    queryFn: ({ signal }) => listUnits(signal),
    staleTime: 5 * 60_000,
  })

export interface UseUnitsResult {
  /// Every unit, retired ones included — filter on `active` for a picker.
  readonly units: readonly UnitOfMeasure[]
  /// Every conversion, retired ones included. `toPieces` skips retired ones.
  readonly conversions: readonly UnitConversion[]
  /// The code of the unit stock is kept in: the one marked base, or `PCS`
  /// while the list is still loading.
  readonly baseUnit: string
  readonly isLoading: boolean
  readonly error: unknown
  /// The read itself, for a table's reload stamp (`refresh={[book.query]}`).
  readonly query: UseQueryResult<UnitsBook>
}

const NO_UNITS: readonly UnitOfMeasure[] = []
const NO_CONVERSIONS: readonly UnitConversion[] = []

/// The unit master, for a picker or a converter. One shared read: the master
/// screen and every form that offers a unit are the same query.
export function useUnits(): UseUnitsResult {
  const query = useQuery(unitsBookQuery())
  const units = query.data?.units ?? NO_UNITS
  return {
    units,
    conversions: query.data?.conversions ?? NO_CONVERSIONS,
    baseUnit: units.find((unit) => unit.is_base)?.code ?? BASE_UNIT,
    isLoading: query.isLoading,
    error: query.error,
    query,
  }
}

/// How many `baseUnit` one `unitCode` is — 12 for LUSIN — or `null` when no
/// chain of live conversions reaches the base.
///
/// Walks the table both ways (LUSIN → PCS at 12 also answers PCS → LUSIN at
/// 1/12) and through intermediate units, shortest chain first.
export function piecesPerUnit(
  unitCode: string,
  conversions: readonly UnitConversion[],
  baseUnit: string = BASE_UNIT
): number | null {
  const start = unitCode.trim().toUpperCase()
  const goal = baseUnit.trim().toUpperCase()
  if (start === goal) return 1

  const live = conversions.filter((one) => one.active)
  const seen = new Map<string, number>([[start, 1]])
  let frontier: string[] = [start]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const unit of frontier) {
      const here = seen.get(unit) ?? 1
      for (const one of live) {
        const factor = Number(one.factor)
        if (!Number.isFinite(factor) || factor <= 0) continue
        let reached: string | null = null
        let worth = 0
        if (one.from_unit === unit) {
          reached = one.to_unit
          worth = here * factor
        } else if (one.to_unit === unit) {
          reached = one.from_unit
          worth = here / factor
        }
        if (reached === null || seen.has(reached)) continue
        if (reached === goal) return worth
        seen.set(reached, worth)
        next.push(reached)
      }
    }
    frontier = next
  }
  return null
}

/// `qty` of `unitCode`, in pieces: `toPieces(5, "LUSIN", conversions)` is 60.
///
/// `null` when the unit has no live conversion to the base, so a caller never
/// sends a quantity it silently failed to convert. Rounded to four places,
/// the column's own scale, so float noise never reaches a quantity field; a
/// caller that needs whole pieces checks `Number.isInteger` on the answer.
export function toPieces(
  qty: number,
  unitCode: string,
  conversions: readonly UnitConversion[],
  baseUnit: string = BASE_UNIT
): number | null {
  if (!Number.isFinite(qty)) return null
  const per = piecesPerUnit(unitCode, conversions, baseUnit)
  if (per === null) return null
  return Math.round(qty * per * 10_000) / 10_000
}

/// Pieces in one of a unit, from the GLOBAL master only (owner, 2026-09-28:
/// the per-item pack-size override is gone — a LUSIN is 12 PCS everywhere).
/// "1" for the base unit, else what the live conversions chain to. Null when
/// no conversion reaches the base.
export function unitFactor(
  unitCode: string,
  conversions: readonly UnitConversion[],
  baseUnit: string = BASE_UNIT
): string | null {
  // Chained, as the server's `unit_pieces_per` is: KOLI = 10 LUSIN and
  // LUSIN = 12 PCS make a KOLI 120 without a KOLI → PCS row.
  const per = piecesPerUnit(unitCode, conversions, baseUnit)
  return per === null ? null : String(Math.round(per * 10_000) / 10_000)
}

/// One of an article's own units — its ERPNext `UOM Conversion Detail` row —
/// as read off `SupplierItem.article_units` or `ArticleDetail.units`.
export interface ItemUnitFactor {
  readonly unit_code: string
  readonly factor: string
}

/// How many `stockUnit` one `unitCode` is worth for THIS article (ERPNext
/// `get_conversion_factor`): "1" for the stock unit itself, the article's own
/// row when it has one, else the global chain — the same order the server
/// resolves a catalogue line in, so a composer that computes this and a
/// server that checks it never disagree.
///
/// `null` when none of the three applies: the code is neither the stock unit
/// nor one of the article's own units, and no global conversion reaches the
/// stock unit either.
///
/// `ownOnly` is for goods that ARE an article: they are dealt in their stock
/// unit and their own units and nothing else, as in 7Soft (migration 0657),
/// so the global chain is not consulted. Goods with no article yet have no
/// list to be held to and keep the global chain.
export function itemUnitFactor(
  unitCode: string,
  articleUnits: readonly ItemUnitFactor[],
  conversions: readonly UnitConversion[],
  stockUnit: string = BASE_UNIT,
  ownOnly: boolean = false
): string | null {
  const code = unitCode.trim().toUpperCase()
  const stock = stockUnit.trim().toUpperCase()
  if (code === stock) return "1"

  const own = articleUnits.find(
    (one) => one.unit_code.trim().toUpperCase() === code
  )
  if (own !== undefined) return own.factor
  if (ownOnly) return null

  return unitFactor(code, conversions, stock)
}

/// `pieces` split into whole `unitCode`s and a remainder, both in pieces
/// terms translated back to a display: `inUnit(500, unit)` where `unit` is
/// worth 12 pieces gives `{ whole: 41, rest: 8 }`. `null` when the unit's
/// worth in pieces (`UnitOfMeasure.pieces`) is unknown or not a whole number
/// — a fractional unit ("1.5 pcs") cannot be split into a clean remainder.
///
/// A negative stock quantity — a backorder, a correction gone the other way —
/// keeps its sign on both parts: -13 in LUSIN is `{ whole: -1, rest: -1 }`.
export function inUnit(
  pieces: number,
  unitPieces: string | null
): { whole: number; rest: number } | null {
  const per = unitPieces === null ? null : Number(unitPieces)
  if (per === null || !Number.isFinite(per) || per <= 0) return null
  if (!Number.isInteger(per)) return null
  const negative = pieces < 0
  const magnitude = Math.abs(pieces)
  const whole = Math.floor(magnitude / per)
  const rest = magnitude - whole * per
  return negative ? { whole: -whole, rest: -rest } : { whole, rest }
}

/// `pieces` in a chosen display unit, formatted for a person: "41 lusin 8
/// pcs" when the unit's worth doesn't divide evenly, "25 kodi" when it does,
/// or plain pieces ("500 pcs") for the base unit or a unit whose worth is
/// unknown. `unit.label` is used as printed; the base unit's own label is
/// used for the remainder ("pcs" in the examples above).
export function formatInUnit(
  pieces: number,
  unit: Pick<UnitOfMeasure, "code" | "label" | "pieces" | "is_base">,
  baseLabel: string = "pcs"
): string {
  if (unit.is_base) return quantity(pieces, unit.label)
  const split = inUnit(pieces, unit.pieces)
  if (split === null) return `${count(pieces)} ${baseLabel}`
  if (split.rest === 0) return `${count(split.whole)} ${unit.label}`
  return `${count(split.whole)} ${unit.label} ${count(split.rest)} ${baseLabel}`
}
