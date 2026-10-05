import { useCallback, useMemo, useState } from "react"

import { Select } from "@/components/ui/field"
import {
  BASE_UNIT,
  formatInUnit,
  useUnits,
  type UnitOfMeasure,
} from "@/lib/queries/units"

/// A viewer's choice of unit to READ stock quantities in — PCS, LUSIN, KODI —
/// shared by every screen under Inventory that shows an on-hand or available
/// figure.
///
/// Sorting and filtering never see this: those stay in pieces, which is what
/// the server holds and compares. This only changes how a piece count is
/// PRINTED, the way a currency toggle would — and like one, it is a per-viewer
/// convenience, remembered in `localStorage` rather than sent anywhere.

const STORAGE_KEY = "inventory.displayUnit"

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function remember(code: string) {
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // A private window or a blocked store loses the preference, not the
    // screen — the picker still works, it just forgets by the next visit.
  }
}

export interface DisplayUnit {
  /// The unit currently chosen — always one of `options`, or the base unit
  /// while the master is still loading.
  readonly code: string
  readonly unit: UnitOfMeasure | undefined
  /// Active units worth offering: the base, and every other COUNT-category
  /// unit whose worth in pieces is known and a whole number greater than
  /// one. Stock is counted in pieces, so a MASS or VOLUME unit — KG, LITER —
  /// has no "how many pieces is one KG" answer worth showing here; that
  /// question belongs to an article's own stock unit, not to this picker.
  readonly options: readonly UnitOfMeasure[]
  readonly setCode: (code: string) => void
  /// `pieces`, printed in the chosen unit — "41 lusin 8 pcs".
  readonly format: (pieces: number) => string
  readonly isLoading: boolean
}

export function useDisplayUnit(): DisplayUnit {
  const book = useUnits()
  const [code, setCodeState] = useState<string>(() => stored() ?? BASE_UNIT)

  const setCode = useCallback((next: string) => {
    setCodeState(next)
    remember(next)
  }, [])

  const options = useMemo(
    () =>
      book.units.filter((one) => {
        if (!one.active) return false
        if (one.is_base) return true
        if (one.category !== "COUNT") return false
        const worth = one.pieces === null ? null : Number(one.pieces)
        return worth !== null && Number.isInteger(worth) && worth > 1
      }),
    [book.units]
  )

  const base = book.units.find((one) => one.is_base)
  const chosen = options.find((one) => one.code === code) ?? base

  const format = useCallback(
    (pieces: number) =>
      chosen === undefined
        ? String(pieces)
        : formatInUnit(pieces, chosen, base?.label ?? "pcs"),
    [chosen, base]
  )

  return {
    code: chosen?.code ?? code,
    unit: chosen,
    options,
    setCode,
    format,
    isLoading: book.isLoading,
  }
}

/// "Show in: PCS / LUSIN / KODI …" — one dropdown, reused everywhere a table
/// or a KPI strip reads quantities through a `DisplayUnit`.
export function DisplayUnitPicker({
  display,
  className,
}: {
  display: DisplayUnit
  className?: string
}) {
  if (display.options.length <= 1) return null
  return (
    <label
      className={`flex items-center gap-2 text-[0.875rem] text-body ${className ?? ""}`}
    >
      Show in
      <Select
        aria-label="Show quantities in"
        value={display.code}
        onChange={display.setCode}
        className="h-8 w-auto min-w-[6rem]"
      >
        {display.options.map((unit) => (
          <option key={unit.code} value={unit.code}>
            {unit.label}
          </option>
        ))}
      </Select>
    </label>
  )
}
