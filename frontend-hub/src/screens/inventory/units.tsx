import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Check } from "lucide-react"
import { Suspense, useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import {
  createUnit,
  createUnitConversion,
  BASE_UNIT,
  unitKeys,
  unitsBookQuery,
  updateUnit,
  updateUnitConversion,
  type UnitConversion,
  type UnitOfMeasure,
} from "@/lib/queries/units"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useIdentity } from "@/lib/session"
import { tableSetup, type TableSetup } from "@/lib/table"
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
  // The title stands at once; the units wait for the book and stream in with
  // it (the server starts the read too). The head's buttons follow the tab and
  // the number of units, so they arrive with the book.
  return (
    <PageContent>
      <Suspense
        fallback={
          <>
            <PageHeader title="Units & Conversions" />
            <Card className="px-4 py-10 text-center text-[0.9375rem] text-body">
              Reading the unit list…
            </Card>
          </>
        }
      >
        <UnitBook />
      </Suspense>
    </PageContent>
  )
}

function UnitBook() {
  const query = useSuspenseQuery(unitsBookQuery())
  const units = query.data.units
  const conversions = query.data.conversions
  const baseUnit = units.find((unit) => unit.is_base)?.code ?? BASE_UNIT
  const identity = useIdentity()
  const isAdmin = identity.data?.role === "ADMIN"
  const [editing, setEditing] = useState<Editing | null>(null)
  const close = useCallback(() => setEditing(null), [])
  const phone = useLayout() === "phone"
  /// The two lists are two tabs: the strip on a desk, the dock's one button
  /// on a phone.
  const [view, setView] = useState<"units" | "conversions">("units")

  const retiredUnits = units.filter((unit) => !unit.active).length

  /// The card's own columns are drawn on a phone and never on a desk.
  const cardsOnly = { head: phone, lead: phone, foot: phone, state: phone }
  const unitTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: units as UnitOfMeasure[],
        columns: UNIT_COLUMNS,
        getRowId: (unit: UnitOfMeasure) => unit.code,
        // The list's own order: the main unit first, the rest as declared.
        enableSorting: false,
        state: { columnVisibility: cardsOnly },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [units, phone]
    )
  )
  const conversionColumns = useMemo(() => conversionColumnsFor(units), [units])
  const conversionTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: conversions as UnitConversion[],
        columns: conversionColumns,
        getRowId: (one: UnitConversion) => one.conversion_id,
        enableSorting: false,
        state: { columnVisibility: cardsOnly },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [conversions, conversionColumns, phone]
    )
  )

  return (
    <>
      {/* The screen's one action stands in its head, and follows the tab; a
          phone has the + at the thumb instead (`Fab` below). */}
      <PageHeader
        title="Units & Conversions"
        actions={
          phone ? undefined : view === "units" ? (
            <Button
              variant="primary"
              onClick={() => setEditing({ kind: "unit", unit: null })}
            >
              New unit
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={units.length < 2}
              onClick={() =>
                setEditing({ kind: "conversion", conversion: null })
              }
            >
              New conversion
            </Button>
          )
        }
      />

      {
        <>
          <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
            <Kpi label="Units" value={count(units.length)} />
            <Kpi label="Cancelled" value={count(retiredUnits)} />
            <Kpi label="Conversions" value={count(conversions.length)} />
          </KpiStrip>

          <SubTabs
            tabs={[
              { value: "units", label: "Units" },
              { value: "conversions", label: "Conversions" },
            ]}
            value={view}
            onChange={(next) => setView(next as "units" | "conversions")}
          />

          <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            {view === "units" ? (
              units.length === 0 ? (
                <EmptyState>No unit has been declared yet.</EmptyState>
              ) : (
                <DataTable<UnitOfMeasure>
                  refresh={[query]}
                  table={unitTable}
                  onRowClick={(unit) => setEditing({ kind: "unit", unit })}
                  isSelected={(unit) =>
                    editing?.kind === "unit" && unit.code === editing.unit?.code
                  }
                  roomy
                  pageScroll
                  cardSort={false}
                  cardsApart
                  cardLead
                />
              )
            ) : conversions.length === 0 ? (
              <EmptyState>
                No conversion yet. Add one to let an order be typed in another
                unit.
              </EmptyState>
            ) : (
              <DataTable<UnitConversion>
                refresh={[query]}
                table={conversionTable}
                onRowClick={(conversion) =>
                  setEditing({ kind: "conversion", conversion })
                }
                isSelected={(one) =>
                  editing?.kind === "conversion" &&
                  one.conversion_id === editing.conversion?.conversion_id
                }
                roomy
                pageScroll
                cardSort={false}
                cardsApart
                cardLead
              />
            )}
          </Card>

          {view === "units" ? (
            <Fab
              label="New Unit"
              onClick={() => setEditing({ kind: "unit", unit: null })}
            />
          ) : (
            units.length >= 2 && (
              <Fab
                label="New Conversion"
                onClick={() =>
                  setEditing({ kind: "conversion", conversion: null })
                }
              />
            )
          )}
        </>
      }

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
            units={units}
            isAdmin={isAdmin}
            onSaved={close}
          />
        )}
        {editing?.kind === "conversion" && (
          <ConversionForm
            key={editing.conversion?.conversion_id ?? "new"}
            conversion={editing.conversion}
            units={units}
            conversions={conversions}
            baseUnit={baseUnit}
            onSaved={close}
          />
        )}
      </Sheet>
    </>
  )
}

/// The server's own sentence about why a write was refused.
function said(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The server could not be reached."
}

function sheetTitle(editing: Editing | null): string {
  if (editing === null) return ""
  if (editing.kind === "unit") return editing.unit?.label ?? "New unit"
  const one = editing.conversion
  return one === null
    ? "New conversion"
    : `1 ${one.from_unit} = ${one.factor} ${one.to_unit}`
}

// ---------------------------------------------------------------------------
// Columns: a table on a desk, cards on a phone

/// What a unit is worth, as the card's figure: "12 pcs".
function worthOf(unit: UnitOfMeasure): string {
  return unit.is_base
    ? "1 pcs"
    : unit.pieces === null
      ? "—"
      : `${unit.pieces} pcs`
}

function ActiveWord({ active }: { active: boolean }) {
  return (
    <Pill tone={active ? "ok" : "neutral"}>
      {active ? "Active" : "Cancelled"}
    </Pill>
  )
}

const UNIT_COLUMNS: ColumnDef<TableSetup, UnitOfMeasure>[] = [
  {
    id: "code",
    accessorFn: (unit) => unit.code,
    header: "Code",
    size: 100,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="font-mono font-medium text-ink">
        {row.original.code}
      </span>
    ),
  },
  {
    id: "label",
    accessorFn: (unit) => unit.label,
    header: "Label",
    size: 170,
    meta: { card: "hide" },
    cell: ({ row }) => <span className="text-ink">{row.original.label}</span>,
  },
  {
    id: "aliases",
    accessorFn: (unit) => unit.aliases.join(", "),
    header: "Aliases",
    size: 200,
    meta: { card: "hide", grow: 160 },
    cell: ({ row }) => (
      <span className="block whitespace-normal text-body">
        {row.original.aliases.length > 0
          ? row.original.aliases.join(", ")
          : "—"}
      </span>
    ),
  },
  {
    id: "worth",
    accessorFn: (unit) => unit.pieces,
    header: "Worth",
    size: 100,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => (
      <span className="tabular-nums">{worthOf(row.original)}</span>
    ),
  },
  {
    id: "category",
    accessorFn: (unit) => unit.category,
    header: "Category",
    size: 110,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="text-body">{categoryLabel(row.original.category)}</span>
    ),
  },
  {
    id: "whole",
    accessorFn: (unit) => unit.whole_number,
    header: "Whole Number",
    size: 140,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="text-body">
        {row.original.whole_number ? "Yes" : "No"}
      </span>
    ),
  },
  {
    id: "base",
    accessorFn: (unit) => unit.is_base,
    header: "Main Unit",
    size: 120,
    meta: { card: "hide" },
    cell: ({ row }) =>
      row.original.is_base ? (
        <span className="font-medium text-ink">Main unit</span>
      ) : (
        <span className="text-body">—</span>
      ),
  },
  {
    id: "status",
    accessorFn: (unit) => unit.active,
    header: "Status",
    size: 120,
    meta: { card: "hide" },
    cell: ({ row }) => <ActiveWord active={row.original.active} />,
  },
  // Four columns that exist only on a card (`cardLead`; a phone): the unit over
  // its code, what it is worth as the figure, its category and aliases on the
  // foot, and whether it is live.
  {
    id: "head",
    accessorFn: (unit) => unit.label,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-1">
        <span className="min-w-0 text-[1rem] font-semibold break-words text-ink">
          {row.original.label}
        </span>
        {/* The code only where it says more than the label does. */}
        {row.original.label.toUpperCase() !== row.original.code && (
          <span className="font-mono text-[0.9375rem] font-normal text-mute">
            {row.original.code}
          </span>
        )}
      </span>
    ),
  },
  {
    id: "lead",
    accessorFn: (unit) => unit.pieces,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    // Most units are worth nothing in pieces: a figure of "—" would only shout
    // it, so the card leaves the figure out.
    cell: ({ row }) =>
      worthOf(row.original) === "—" ? null : (
        <span className="flex flex-col items-end tabular-nums">
          <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
            {worthOf(row.original)}
          </span>
          <span className="text-[0.9375rem] text-mute">worth</span>
        </span>
      ),
  },
  {
    id: "foot",
    accessorFn: (unit) => unit.category,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span>
          {categoryLabel(row.original.category)}
          {row.original.whole_number ? " · whole numbers" : ""}
          {row.original.is_base ? " · " : ""}
          {row.original.is_base && (
            <span className="font-medium text-ink">Main unit</span>
          )}
        </span>
        {row.original.aliases.length > 0 && (
          <span className="truncate">{row.original.aliases.join(", ")}</span>
        )}
      </span>
    ),
  },
  {
    id: "state",
    accessorFn: (unit) => unit.active,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) => <ActiveWord active={row.original.active} />,
  },
]

function conversionColumnsFor(
  units: readonly UnitOfMeasure[]
): ColumnDef<TableSetup, UnitConversion>[] {
  const labels = new Map(units.map((unit) => [unit.code, unit.label]))
  const unitCell = (code: string) => (
    <>
      <span className="font-mono font-medium">{code}</span>
      {labels.get(code) && labels.get(code) !== code && (
        <span className="ml-2 text-body">{labels.get(code)}</span>
      )}
    </>
  )
  return [
    {
      id: "from",
      accessorFn: (one) => one.from_unit,
      header: "Other Unit",
      size: 200,
      meta: { card: "hide" },
      cell: ({ row }) => (
        <span className="text-ink">{unitCell(row.original.from_unit)}</span>
      ),
    },
    {
      id: "to",
      accessorFn: (one) => one.to_unit,
      header: "Main Unit",
      size: 200,
      meta: { card: "hide" },
      cell: ({ row }) => (
        <span className="text-ink">{unitCell(row.original.to_unit)}</span>
      ),
    },
    {
      id: "factor",
      accessorFn: (one) => one.factor,
      header: "Conversion Value",
      size: 160,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => (
        <span className="font-medium tabular-nums">{row.original.factor}</span>
      ),
    },
    {
      id: "note",
      accessorFn: (one) => one.note ?? "",
      header: "Note",
      size: 240,
      meta: { card: "hide", grow: 160 },
      cell: ({ row }) => (
        <span className="block whitespace-normal text-body">
          {row.original.note ?? "—"}
        </span>
      ),
    },
    {
      id: "status",
      accessorFn: (one) => one.active,
      header: "Status",
      size: 120,
      meta: { card: "hide" },
      cell: ({ row }) => <ActiveWord active={row.original.active} />,
    },
    // The card's own columns, as the units' are: "1 LUSIN" over its name, what
    // it is worth as the figure, the note on the foot, and whether it is live.
    {
      id: "head",
      accessorFn: (one) => one.from_unit,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "title" },
      cell: ({ row }) => {
        const label = labels.get(row.original.from_unit)
        return (
          <span className="flex min-w-0 flex-col gap-1">
            <span className="min-w-0 text-[1rem] font-semibold break-words text-ink">
              1 {row.original.from_unit}
            </span>
            {label !== undefined && label !== row.original.from_unit && (
              <span className="text-[0.9375rem] font-normal text-mute">
                {label}
              </span>
            )}
          </span>
        )
      },
    },
    {
      id: "lead",
      accessorFn: (one) => one.factor,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      cell: ({ row }) => (
        <span className="flex flex-col items-end tabular-nums">
          <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
            {row.original.factor}
          </span>
          <span className="font-mono text-[0.9375rem] text-mute">
            {row.original.to_unit}
          </span>
        </span>
      ),
    },
    {
      id: "foot",
      accessorFn: (one) => one.note,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) => (
        <span className="block truncate">{row.original.note ?? ""}</span>
      ),
    },
    {
      id: "state",
      accessorFn: (one) => one.active,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { align: "right", card: "status" },
      cell: ({ row }) => <ActiveWord active={row.original.active} />,
    },
  ]
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
          "inline-flex items-center gap-2.5 text-[0.9375rem] text-ink capitalize",
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
        <span className="pl-7 text-[0.9375rem] leading-[1.375rem] text-body">
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
      className="rounded-inner bg-bad-bg px-3.5 py-2.5 text-[0.9375rem] leading-[1.375rem] text-bad-fg"
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
        <p className="text-[0.9375rem] text-body">
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

      <div className="submit-row flex justify-end">
        <Button
          type="submit"
          variant="primary"
          className="h-10 text-[0.9375rem]"
          pending={save.isPending}
          disabled={invalid}
        >
          {save.isPending ? "Submitting…" : unit === null ? "Submit" : "Submit"}
        </Button>
      </div>
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
        <span role="alert" className="-mt-2 text-[0.9375rem] text-bad">
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

      <div className="submit-row flex justify-end">
        <Button
          type="submit"
          variant="primary"
          className="h-10 text-[0.9375rem]"
          pending={save.isPending}
          disabled={invalid}
        >
          {save.isPending
            ? "Submitting…"
            : conversion === null
              ? "Submit"
              : "Submit"}
        </Button>
      </div>
    </form>
  )
}
