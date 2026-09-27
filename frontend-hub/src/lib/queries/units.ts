import { useQuery } from "@tanstack/react-query"
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
}

const NO_UNITS: readonly UnitOfMeasure[] = []
const NO_CONVERSIONS: readonly UnitConversion[] = []

/// The unit master, for a picker or a converter. One shared read: the master
/// screen and every form that offers a unit are the same query.
export function useUnits(): UseUnitsResult {
  const query = useQuery({
    queryKey: unitKeys.book(),
    queryFn: ({ signal }) => listUnits(signal),
    // A unit list changes a few times a year.
    staleTime: 5 * 60_000,
  })
  const units = query.data?.units ?? NO_UNITS
  return {
    units,
    conversions: query.data?.conversions ?? NO_CONVERSIONS,
    baseUnit: units.find((unit) => unit.is_base)?.code ?? BASE_UNIT,
    isLoading: query.isLoading,
    error: query.error,
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

/// Pieces in one of a unit for one item, as the server works it out
/// (`unit_pieces_per`, migration 0399): "1" for the base unit, else the
/// item's own pack size, else the live global conversion straight to the
/// base. Null when the unit has no conversion for this item.
export function unitFactor(
  unitCode: string,
  itemUnits: readonly { readonly unit_code: string; readonly factor: string }[],
  conversions: readonly UnitConversion[],
  baseUnit: string = BASE_UNIT
): string | null {
  if (unitCode === baseUnit) return "1"
  const own = itemUnits.find((one) => one.unit_code === unitCode)
  if (own !== undefined) return own.factor
  const global = conversions.find(
    (one) => one.active && one.from_unit === unitCode && one.to_unit === baseUnit
  )
  return global?.factor ?? null
}
