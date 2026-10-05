import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import {
  createUnit,
  createUnitConversion,
  unitKeys,
  updateUnit,
  updateUnitConversion,
  useUnits,
  type UnitConversion,
  type UnitOfMeasure,
} from "@/lib/queries/units"
import { useIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"

/// Units of measure and how many of one another is worth.
///
/// Stock is counted in pieces. A supplier quotes by the LUSIN (12) or the KODI
/// (20), and this is where the company writes those numbers down once, so the
/// order composer can let a buyer type "5 lusin" and send 60 pieces.
///
/// The conversion table reads the way the owner wrote it: Other unit, Main
/// unit, Conversion value, Note — "one LUSIN is 12 PCS".
///
/// Nothing here is deleted. A unit a document used is part of what that
/// document said, so it is retired instead, and stays readable here.
///
/// Every piece of type on this screen is 14px or larger, by request.

type Editing =
  | { readonly kind: "unit"; readonly unit: UnitOfMeasure | null }
  | { readonly kind: "conversion"; readonly conversion: UnitConversion | null }

export function Units() {
  const book = useUnits()
  const identity = useIdentity()
  const isAdmin = identity.data?.role === "ADMIN"
  const [editing, setEditing] = useState<Editing | null>(null)
  const close = useCallback(() => setEditing(null), [])

  const retiredUnits = book.units.filter((unit) => !unit.active).length

  return (
    <PageContent>
      <PageHeader title="Satuan & conversions" />
      <p className="-mt-3 mb-5 max-w-[46rem] text-[0.875rem] leading-[1.375rem] text-body">
        Stock is kept in the main unit. A conversion says how many of the main
        unit one other unit is worth — one LUSIN is 12 PCS — so an order typed
        in lusin or kodi is sent in pieces.
      </p>

      {book.isLoading ? (
        <Card className="px-4 py-10 text-center text-[0.875rem] text-body">
          Reading the unit list…
        </Card>
      ) : book.error ? (
        <Card className="px-4 py-10 text-center text-[0.875rem] text-bad">
          {said(book.error)}
        </Card>
      ) : (
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>
                Satuan
                <span className="ml-2 text-[0.875rem] font-normal text-body">
                  {book.units.length}
                  {retiredUnits > 0 && ` · ${retiredUnits} cancelled`}
                </span>
              </CardTitle>
              <Button
                className="text-[0.875rem]"
                onClick={() => setEditing({ kind: "unit", unit: null })}
              >
                New unit
              </Button>
            </CardHeader>
            <UnitsTable
              units={book.units}
              selected={
                editing?.kind === "unit" ? (editing.unit?.code ?? null) : null
              }
              onPick={(unit) => setEditing({ kind: "unit", unit })}
            />
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>
                Conversions
                <span className="ml-2 text-[0.875rem] font-normal text-body">
                  {book.conversions.length}
                </span>
              </CardTitle>
              <Button
                className="text-[0.875rem]"
                disabled={book.units.length < 2}
                onClick={() =>
                  setEditing({ kind: "conversion", conversion: null })
                }
              >
                New conversion
              </Button>
            </CardHeader>
            <ConversionsTable
              conversions={book.conversions}
              units={book.units}
              selected={
                editing?.kind === "conversion"
                  ? (editing.conversion?.conversion_id ?? null)
                  : null
              }
              onPick={(conversion) =>
                setEditing({ kind: "conversion", conversion })
              }
            />
          </Card>
        </div>
      )}

      <Sheet
        open={editing !== null}
        onOpenChange={(next) => !next && close()}
        title={sheetTitle(editing)}
      >
        {editing?.kind === "unit" && (
          // Keyed so moving between rows starts a form on the row in front of
          // you rather than editing the second through the first one's values.
          <UnitForm
            key={editing.unit?.code ?? "new"}
            unit={editing.unit}
            units={book.units}
            isAdmin={isAdmin}
            onSaved={close}
          />
        )}
        {editing?.kind === "conversion" && (
          <ConversionForm
            key={editing.conversion?.conversion_id ?? "new"}
            conversion={editing.conversion}
            units={book.units}
            conversions={book.conversions}
            baseUnit={book.baseUnit}
            onSaved={close}
          />
        )}
      </Sheet>
    </PageContent>
  )
}

function sheetTitle(editing: Editing | null): string {
  if (editing === null) return ""
  if (editing.kind === "unit") return editing.unit?.label ?? "New unit"
  const one = editing.conversion
  return one === null
    ? "New conversion"
    : `1 ${one.from_unit} = ${one.factor} ${one.to_unit}`
}

/// The server's own sentence about why a write was refused.
function said(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The server could not be reached."
}

// ---------------------------------------------------------------------------
// Tables

const TH =
  "px-4 py-2.5 text-left text-[0.875rem] font-medium whitespace-nowrap text-body"
const TD = "px-4 py-3 text-[0.875rem] text-ink"

function Status({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-inner border px-2 py-0.5 text-[0.875rem] font-medium whitespace-nowrap",
        active ? "border-ok-fg/30 text-ok-fg" : "border-hairline-2 text-body"
      )}
    >
      {active ? "Active" : "Cancelled"}
    </span>
  )
}

function Row({
  selected,
  onPick,
  children,
}: {
  selected: boolean
  onPick: () => void
  children: React.ReactNode
}) {
  return (
    <tr
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onPick()
        }
      }}
      aria-selected={selected}
      className={cn(
        "cursor-pointer border-t border-hairline transition-colors outline-none hover:bg-soft-2 focus-visible:bg-soft-2",
        selected && "bg-accent-bg hover:bg-accent-bg"
      )}
    >
      {children}
    </tr>
  )
}

function UnitsTable({
  units,
  selected,
  onPick,
}: {
  units: readonly UnitOfMeasure[]
  selected: string | null
  onPick: (unit: UnitOfMeasure) => void
}) {
  if (units.length === 0) {
    return (
      <p className="px-4 pt-2 pb-6 text-[0.875rem] text-body">
        No unit has been declared yet.
      </p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse">
        <thead>
          <tr className="bg-soft">
            <th className={TH}>Code</th>
            <th className={TH}>Label</th>
            <th className={TH}>Aliases</th>
            <th className={cn(TH, "text-right")}>Worth</th>
            <th className={TH}>Category</th>
            <th className={TH}>Whole Number</th>
            <th className={TH}>Main Unit</th>
            <th className={TH}>Status</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit) => (
            <Row
              key={unit.code}
              selected={selected === unit.code}
              onPick={() => onPick(unit)}
            >
              <td className={cn(TD, "font-mono font-medium")}>{unit.code}</td>
              <td className={TD}>{unit.label}</td>
              <td className={cn(TD, "max-w-[16rem] truncate text-body")}>
                {unit.aliases.length > 0 ? unit.aliases.join(", ") : "—"}
              </td>
              <td className={cn(TD, "text-right tabular-nums")}>
                {unit.is_base
                  ? "1 pcs"
                  : unit.pieces === null
                    ? "—"
                    : `${unit.pieces} pcs`}
              </td>
              <td className={cn(TD, "text-body")}>
                {categoryLabel(unit.category)}
              </td>
              <td className={cn(TD, "text-body")}>
                {unit.whole_number ? "Yes" : "No"}
              </td>
              <td className={TD}>
                {unit.is_base ? (
                  <span className="font-medium text-accent">Main unit</span>
                ) : (
                  <span className="text-body">—</span>
                )}
              </td>
              <td className={TD}>
                <Status active={unit.active} />
              </td>
            </Row>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ConversionsTable({
  conversions,
  units,
  selected,
  onPick,
}: {
  conversions: readonly UnitConversion[]
  units: readonly UnitOfMeasure[]
  selected: string | null
  onPick: (conversion: UnitConversion) => void
}) {
  const labels = useMemo(
    () => new Map(units.map((unit) => [unit.code, unit.label])),
    [units]
  )
  if (conversions.length === 0) {
    return (
      <p className="px-4 pt-2 pb-6 text-[0.875rem] text-body">
        No conversion yet. Add one to let an order be typed in another unit.
      </p>
    )
  }
  const unitCell = (code: string) => (
    <>
      <span className="font-mono font-medium">{code}</span>
      {labels.get(code) && labels.get(code) !== code && (
        <span className="ml-2 text-body">{labels.get(code)}</span>
      )}
    </>
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse">
        <thead>
          <tr className="bg-soft">
            <th className={TH}>Other Unit</th>
            <th className={TH}>Main Unit</th>
            <th className={cn(TH, "text-right")}>Conversion Value</th>
            <th className={TH}>Note</th>
            <th className={TH}>Status</th>
          </tr>
        </thead>
        <tbody>
          {conversions.map((one) => (
            <Row
              key={one.conversion_id}
              selected={selected === one.conversion_id}
              onPick={() => onPick(one)}
            >
              <td className={TD}>{unitCell(one.from_unit)}</td>
              <td className={TD}>{unitCell(one.to_unit)}</td>
              <td className={cn(TD, "text-right font-medium tabular-nums")}>
                {one.factor}
              </td>
              <td className={cn(TD, "max-w-[20rem] truncate text-body")}>
                {one.note ?? "—"}
              </td>
              <td className={TD}>
                <Status active={one.active} />
              </td>
            </Row>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Forms

/// A key held across retries and rotated after a success, so a double-clicked
/// Save is one write replayed rather than two. Same reasoning as the colour
/// master's copy.
function useIdempotencyKey(): {
  readonly key: string
  readonly rotate: () => void
} {
  const [key, setKey] = useState(() => crypto.randomUUID())
  const rotate = useCallback(() => setKey(crypto.randomUUID()), [])
  return { key, rotate }
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        className={cn(
          "inline-flex items-center gap-2.5 text-[0.875rem] text-ink capitalize",
          disabled ? "opacity-55" : "cursor-pointer"
        )}
      >
        <BaseCheckbox.Root
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          className={cn(
            "grid size-[1.125rem] shrink-0 place-items-center rounded-[0.3125rem] border border-hairline-strong bg-canvas transition-colors outline-none",
            "hover:border-line data-checked:border-accent data-checked:bg-accent"
          )}
        >
          <BaseCheckbox.Indicator className="flex text-white">
            <Check className="size-3" strokeWidth={3} />
          </BaseCheckbox.Indicator>
        </BaseCheckbox.Root>
        {label}
      </label>
      {hint && (
        <span className="pl-7 text-[0.875rem] leading-[1.375rem] text-body">
          {hint}
        </span>
      )}
    </div>
  )
}

function Refusal({ error }: { error: unknown }) {
  return (
    <div
      role="alert"
      className="rounded-inner bg-bad-bg px-3.5 py-2.5 text-[0.875rem] leading-[1.375rem] text-bad-fg"
    >
      {said(error)}
    </div>
  )
}

/// COUNT, MASS, VOLUME, LENGTH or AREA (ERPNext's UOM Category), as a friendly
/// word — a conversion only ever joins two units of the same one.
const CATEGORIES: readonly { value: string; label: string }[] = [
  { value: "COUNT", label: "Count" },
  { value: "MASS", label: "Weight" },
  { value: "VOLUME", label: "Volume" },
  { value: "LENGTH", label: "Length" },
  { value: "AREA", label: "Area" },
]

function categoryLabel(category: string): string {
  return CATEGORIES.find((one) => one.value === category)?.label ?? category
}

const CODE = /^[A-Z0-9_]{1,16}$/

/// Aliases as they are typed — comma-separated — and as they are sent: lower
/// case, trimmed, blanks and duplicates dropped. A picker matches a
/// supplier's own spelling ("lsn", "dz") to the master, so case and stray
/// spaces are noise the master should not have to carry.
function parseAliases(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of text.split(",")) {
    const one = raw.trim().toLowerCase()
    if (one !== "") seen.add(one)
  }
  return [...seen]
}

function UnitForm({
  unit,
  units,
  isAdmin,
  onSaved,
}: {
  unit: UnitOfMeasure | null
  units: readonly UnitOfMeasure[]
  /// Aliases are an Admin-only edit — everyone else reads them off the table.
  isAdmin: boolean
  onSaved: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const [code, setCode] = useState(unit?.code ?? "")
  const [label, setLabel] = useState(unit?.label ?? "")
  const [isBase, setIsBase] = useState(unit?.is_base ?? false)
  const [active, setActive] = useState(unit?.active ?? true)
  const [aliasText, setAliasText] = useState(unit?.aliases.join(", ") ?? "")
  const [category, setCategory] = useState(unit?.category ?? "COUNT")
  const [wholeNumber, setWholeNumber] = useState(unit?.whole_number ?? true)

  // Refused server-side once a conversion joins the unit — those rows were
  // written for the kind it was — so the picker is disabled rather than left
  // to fail silently on save.
  const categoryLocked = unit !== null && unit.pieces !== null && !unit.is_base

  const typedCode = code.trim().toUpperCase()
  const problems: { code?: string; label?: string } = {}
  if (unit === null) {
    if (typedCode === "") problems.code = "A code is needed — PCS, LUSIN."
    else if (!CODE.test(typedCode))
      problems.code = "Letters, digits or _, at most 16."
    else if (units.some((one) => one.code === typedCode))
      problems.code = `${typedCode} already exists.`
  }
  if (label.trim() === "") problems.label = "A unit needs a label."

  const wasBase = unit?.is_base ?? false

  const save = useMutation({
    mutationFn: () =>
      unit === null
        ? createUnit(
            {
              code: typedCode,
              label: label.trim(),
              is_base: isBase,
              category,
              whole_number: wholeNumber,
              aliases: isAdmin ? parseAliases(aliasText) : undefined,
            },
            idempotency.key
          )
        : updateUnit(
            unit.code,
            {
              label: label.trim(),
              // Only `true` is an act; the server refuses to unmark the base.
              is_base: isBase && !wasBase ? true : undefined,
              active,
              // Present replaces the list, so a non-admin — who never sees
              // the field — must not send it at all.
              aliases: isAdmin ? parseAliases(aliasText) : undefined,
              category: categoryLocked ? undefined : category,
              whole_number: wholeNumber,
            },
            unit.version,
            idempotency.key
          ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: unitKeys.all })
      idempotency.rotate()
      onSaved()
    },
  })

  const invalid = problems.code !== undefined || problems.label !== undefined

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!invalid) save.mutate()
      }}
    >
      {save.isError && <Refusal error={save.error} />}

      <Field label="Code" required problem={problems.code}>
        <Input
          value={code}
          disabled={unit !== null}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          autoFocus={unit === null}
        />
      </Field>

      <Field label="Label" required problem={problems.label}>
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>

      <Field
        label="Category"
        hint={
          categoryLocked
            ? "Fixed while a conversion joins this unit — those rows were written for this kind."
            : "A conversion only ever joins two units of the same category."
        }
      >
        <Select
          value={category}
          onChange={setCategory}
          disabled={categoryLocked}
        >
          {CATEGORIES.map((one) => (
            <option key={one.value} value={one.value}>
              {one.label}
            </option>
          ))}
        </Select>
      </Field>

      <Toggle
        label="Whole numbers only"
        hint="A quantity in this unit is always whole — needed for a unit to be an article's stock unit."
        checked={wholeNumber}
        onChange={setWholeNumber}
      />

      {isAdmin && (
        <Field
          label="Aliases"
          hint="Other spellings a supplier's paper uses for this unit — comma-separated."
        >
          <Input
            value={aliasText}
            onChange={(event) => setAliasText(event.target.value)}
          />
        </Field>
      )}

      {unit !== null && !unit.is_base && (
        <p className="text-[0.875rem] text-body">
          Worth{" "}
          {unit.pieces === null
            ? "— (no conversion yet)"
            : `${unit.pieces} pcs`}
        </p>
      )}

      <Toggle
        label="Main unit"
        hint={
          wasBase
            ? "Stock is kept in this unit. To change it, make another unit the main unit."
            : "The unit stock is kept in. There is only one; choosing this moves it here."
        }
        checked={isBase}
        disabled={wasBase}
        onChange={setIsBase}
      />

      {unit !== null && (
        <Toggle
          label="Active"
          hint={
            wasBase
              ? "The main unit cannot be cancelled."
              : "Cancelled units are hidden from pickers and stay readable on old documents."
          }
          checked={active}
          disabled={wasBase || isBase}
          onChange={setActive}
        />
      )}

      <Button
        type="submit"
        variant="primary"
        className="h-10 text-[0.875rem]"
        pending={save.isPending}
        disabled={invalid}
      >
        {save.isPending ? "Submitting…" : unit === null ? "Submit" : "Submit"}
      </Button>
    </form>
  )
}

/// A positive number, at most four places, with a comma read as the point.
function factorProblem(text: string): string | undefined {
  const value = text.trim().replace(",", ".")
  if (value === "") return "A conversion value is needed."
  if (!/^\d+(\.\d{1,4})?$/.test(value))
    return "A positive number, at most four decimal places."
  if (Number(value) <= 0) return "Must be greater than zero."
  return undefined
}

function ConversionForm({
  conversion,
  units,
  conversions,
  baseUnit,
  onSaved,
}: {
  conversion: UnitConversion | null
  units: readonly UnitOfMeasure[]
  conversions: readonly UnitConversion[]
  baseUnit: string
  onSaved: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const offered = units.filter(
    (unit) =>
      unit.active ||
      unit.code === conversion?.from_unit ||
      unit.code === conversion?.to_unit
  )
  const firstOther = offered.find((unit) => unit.code !== baseUnit)?.code ?? ""
  const [from, setFrom] = useState(conversion?.from_unit ?? firstOther)
  const [to, setTo] = useState(conversion?.to_unit ?? baseUnit)
  const [factor, setFactor] = useState(conversion?.factor ?? "")
  const [note, setNote] = useState(conversion?.note ?? "")
  const [active, setActive] = useState(conversion?.active ?? true)

  const byCode = useMemo(
    () => new Map(offered.map((unit) => [unit.code, unit])),
    [offered]
  )
  // A conversion only ever joins two units of one category — the "Main unit"
  // box offers only units the chosen "Other unit" could actually convert
  // into, rather than a list somebody has to already know to avoid.
  const fromCategory = byCode.get(from)?.category
  const toOptions =
    fromCategory === undefined
      ? offered
      : offered.filter((unit) => unit.category === fromCategory)

  const problems: { from?: string; factor?: string } = {}
  if (conversion === null) {
    if (from === "" || to === "") problems.from = "Choose both units."
    else if (from === to) problems.from = "A unit cannot convert to itself."
    else if (
      conversions.some(
        (one) =>
          (one.from_unit === from && one.to_unit === to) ||
          (one.from_unit === to && one.to_unit === from)
      )
    )
      problems.from = `A conversion between ${from} and ${to} already exists.`
  }
  problems.factor = factorProblem(factor)
  const invalid = problems.from !== undefined || problems.factor !== undefined

  const save = useMutation({
    mutationFn: () => {
      const value = factor.trim().replace(",", ".")
      const trimmedNote = note.trim()
      return conversion === null
        ? createUnitConversion(
            {
              from_unit: from,
              to_unit: to,
              factor: value,
              note: trimmedNote === "" ? null : trimmedNote,
            },
            idempotency.key
          )
        : updateUnitConversion(
            conversion.conversion_id,
            {
              factor: value,
              note: trimmedNote === "" ? null : trimmedNote,
              active,
            },
            conversion.version,
            idempotency.key
          )
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: unitKeys.all })
      idempotency.rotate()
      onSaved()
    },
  })

  const preview =
    from !== "" && to !== "" && problems.factor === undefined
      ? `1 ${from} = ${factor.trim().replace(",", ".")} ${to}`
      : null

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!invalid) save.mutate()
      }}
    >
      {save.isError && <Refusal error={save.error} />}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Other unit" required>
          <Select
            value={from}
            onChange={(next) => {
              setFrom(next)
              // Changing the category out from under a chosen "Main unit"
              // would leave it selected but no longer offered.
              const nextCategory = byCode.get(next)?.category
              if (
                nextCategory !== undefined &&
                byCode.get(to)?.category !== nextCategory
              ) {
                setTo(
                  offered.find((unit) => unit.category === nextCategory)
                    ?.code ?? ""
                )
              }
            }}
            disabled={conversion !== null}
            invalid={problems.from !== undefined}
            aria-label="Other unit"
          >
            {offered.map((unit) => (
              <option key={unit.code} value={unit.code}>
                {unit.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Main unit" required>
          <Select
            value={to}
            onChange={setTo}
            disabled={conversion !== null}
            invalid={problems.from !== undefined}
            aria-label="Main unit"
          >
            {toOptions.map((unit) => (
              <option key={unit.code} value={unit.code}>
                {unit.code}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {problems.from && (
        <span role="alert" className="-mt-2 text-[0.875rem] text-bad">
          {problems.from}
        </span>
      )}

      <Field label="Conversion value" required problem={problems.factor}>
        <Input
          value={factor}
          inputMode="decimal"
          onChange={(event) => setFactor(event.target.value)}
          className="tabular-nums"
          autoFocus={conversion === null}
        />
      </Field>

      {preview && (
        <div className="rounded-inner bg-soft-2 px-3.5 py-2.5 text-[0.9375rem] font-medium text-ink tabular-nums">
          {preview}
        </div>
      )}

      <Field label="Note">
        <Textarea
          value={note}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      {conversion !== null && (
        <Toggle
          label="Active"
          hint="A cancelled conversion is no longer offered when ordering."
          checked={active}
          onChange={setActive}
        />
      )}

      <Button
        type="submit"
        variant="primary"
        className="h-10 text-[0.875rem]"
        pending={save.isPending}
        disabled={invalid}
      >
        {save.isPending
          ? "Submitting…"
          : conversion === null
            ? "Submit"
            : "Submit"}
      </Button>
    </form>
  )
}
