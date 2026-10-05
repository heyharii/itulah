import { Trash2 } from "lucide-react"
import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { useUnits } from "@/lib/queries/units"

/// What an article is counted, bought and sold in (ERPNext's `stock_uom`,
/// `purchase_uom`, `sales_uom`), plus the article's own units — a CARTON of
/// THIS shirt may be 24 while the global master says nothing about CARTON at
/// all.
///
/// Held as strings the way the rest of this form holds a draft: `""` is "no
/// default chosen" for the purchase and sales unit, and a blank `factor` on
/// one of the article's own units is "take the global conversion", which the
/// input previews as a placeholder rather than a value somebody typed.
export interface UnitsDraft {
  stockUnit: string
  purchaseUnit: string
  salesUnit: string
  units: readonly { unitCode: string; factor: string }[]
}

/// Stock unit, defaults and the article's own units — one section, because a
/// merchandiser reads them as one question: what does this article come in.
export function UnitsSection({
  value,
  onChange,
  disabled,
}: {
  value: UnitsDraft
  onChange: (next: UnitsDraft) => void
  disabled?: boolean
}) {
  const book = useUnits()

  /// Only a whole-number unit can hold stock — the ledger counts in whole
  /// numbers — so that is all the stock-unit picker offers, plus whatever is
  /// already chosen even if it has since been cancelled.
  const stockOptions = useMemo(
    () =>
      book.units.filter(
        (one) =>
          (one.active && one.whole_number) || one.code === value.stockUnit
      ),
    [book.units, value.stockUnit]
  )

  /// A default purchase or sales unit is one this article is dealt in: its
  /// stock unit or a row of its own list — an article uses nothing else, as
  /// in 7Soft (0657). A listed row with a blank factor still counts: the
  /// server fills it from the global chain when it is saved.
  const listed = useMemo(
    () => new Set(value.units.map((one) => one.unitCode)),
    [value.units]
  )
  const defaultOptions = useMemo(
    () =>
      book.units.filter(
        (one) =>
          (one.active ||
            one.code === value.purchaseUnit ||
            one.code === value.salesUnit) &&
          (one.code === value.stockUnit || listed.has(one.code))
      ),
    [book.units, listed, value.stockUnit, value.purchaseUnit, value.salesUnit]
  )

  /// Units offered for a NEW row of the article's own table: active, not
  /// already the stock unit, and not already listed.
  const usedCodes = new Set(value.units.map((one) => one.unitCode))
  const rowOptions = book.units.filter(
    (one) => one.active && one.code !== value.stockUnit
  )
  const addable = rowOptions.filter((one) => !usedCodes.has(one.code))

  const setUnits = (units: UnitsDraft["units"]) => onChange({ ...value, units })

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Stock unit" required>
          <Select
            value={value.stockUnit}
            disabled={disabled}
            onChange={(stockUnit) => onChange({ ...value, stockUnit })}
          >
            {stockOptions.map((one) => (
              <option key={one.code} value={one.code}>
                {one.label}
              </option>
            ))}
          </Select>
        </Field>
        <div />
        <Field label="Default purchase unit">
          <Select
            value={value.purchaseUnit}
            disabled={disabled}
            onChange={(purchaseUnit) => onChange({ ...value, purchaseUnit })}
          >
            <option value="">Same as stock unit</option>
            {defaultOptions.map((one) => (
              <option key={one.code} value={one.code}>
                {one.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Default sales unit">
          <Select
            value={value.salesUnit}
            disabled={disabled}
            onChange={(salesUnit) => onChange({ ...value, salesUnit })}
          >
            <option value="">Same as stock unit</option>
            {defaultOptions.map((one) => (
              <option key={one.code} value={one.code}>
                {one.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[0.875rem] font-medium text-text">Other UoM</span>
        {value.units.length === 0 ? (
          <p className="text-[0.875rem] text-body">
            This article is only ever counted in{" "}
            {value.stockUnit || "its stock unit"}.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {value.units.map((row, index) => {
              const options = rowOptions.filter(
                (one) => !usedCodes.has(one.code) || one.code === row.unitCode
              )
              return (
                <div key={index} className="flex items-center gap-2">
                  <Select
                    className="w-32"
                    value={row.unitCode}
                    disabled={disabled}
                    aria-label="Unit"
                    onChange={(unitCode) =>
                      setUnits(
                        value.units.map((one, i) =>
                          i === index ? { ...one, unitCode } : one
                        )
                      )
                    }
                  >
                    {options.map((one) => (
                      <option key={one.code} value={one.code}>
                        {one.label}
                      </option>
                    ))}
                  </Select>
                  <span className="text-[0.875rem] text-body">=</span>
                  <Input
                    className="flex-1 text-right tabular-nums"
                    inputMode="decimal"
                    value={row.factor}
                    disabled={disabled}
                    aria-label={`Stock units in one ${row.unitCode}`}
                    onChange={(event) =>
                      setUnits(
                        value.units.map((one, i) =>
                          i === index
                            ? { ...one, factor: event.target.value }
                            : one
                        )
                      )
                    }
                  />
                  <span className="text-[0.875rem] text-body">
                    {value.stockUnit}
                  </span>
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={disabled}
                    aria-label={`Remove ${row.unitCode}`}
                    onClick={() =>
                      setUnits(value.units.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={disabled || addable.length === 0}
          onClick={() =>
            setUnits([
              ...value.units,
              { unitCode: addable[0].code, factor: "" },
            ])
          }
        >
          Add a unit
        </Button>
      </div>
    </div>
  )
}
