import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useCallback, useMemo, useState } from "react"

import type { PayrollAdjustmentRow } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill, Status } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { money, moment, monthYear } from "@/lib/format"
import {
  claimsKeys,
  fileAdjustment,
  listAdjustments,
  listEmployees,
  openAdvances,
  payComponents,
  payKeys,
  peopleKeys,
  useReachableUnits,
  withdrawAdjustment,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { tableSetup, type TableSetup } from "@/lib/table"
import { OneOffImport } from "@/screens/people/one-off-import-card"
import { useUnit } from "@/screens/people/parts"
import { CardFigure, CardName } from "@/components/ui/phone-cards"

/// Payroll › One-offs — the figures a place files into a month's batch that
/// are not part of anyone's standing pay: an incentive, a commission, a
/// kasbon instalment.
///
/// # Filed by the place, decided by head office
///
/// The figure is frozen the moment the place files it. Withdrawal exists only
/// while the batch is the place's — `withdrawable` says which side of that
/// line a row is on, and once it is false the way back is head office's
/// reopen, which clears both signatures where an audit can see it.
///
/// # Potong advance
///
/// A recovery rides a deduction: money coming back out of a wage can never be
/// an earning, so picking the advance narrows the component list to
/// DEDUCTION and caps the figure at what is still out. The cap is the
/// server's rule restated so the form refuses before a round trip rather than
/// after one — and the server states it again at filing and again at
/// approval, because filings sit while months move.

/// Everything this module caches about the filed list, whichever unit and
/// month it was read for.
const ADJUSTMENTS = ["people", "payroll", "adjustments"] as const

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

/// The units the caller may file for. Head office reaches many; a unit
/// manager reaches the one they are posted to, which the workforce facets
/// leave out (a filter offering a single value changes nothing) — so the
/// posting stands in for it.
function useFilingUnits(): {
  readonly choices: readonly { value: string; label: string }[]
  readonly fallback: string
} {
  const unit = useUnit()
  const listed = unit.units.map((one) => ({
    value: one.id,
    label: `${one.name} · ${one.employees}`,
  }))
  if (listed.length > 0) return { choices: listed, fallback: "" }
  if (unit.unitId === null) return { choices: [], fallback: "" }
  return {
    choices: [{ value: unit.unitId, label: unit.name ?? unit.unitId }],
    fallback: unit.unitId,
  }
}

const NO_ROWS: PayrollAdjustmentRow[] = []

/// Filed, or in the batch the place has sent. A filed figure can still be
/// taken back; one in the batch cannot.
function stateOf(row: PayrollAdjustmentRow): {
  readonly tone: "info" | "ok"
  readonly label: string
} {
  return row.withdrawable
    ? { tone: "info", label: "Filed" }
    : { tone: "ok", label: "In the batch" }
}

/// The component, with the advance it repays said in the same line.
function componentOf(row: PayrollAdjustmentRow): string {
  return row.advance_id === null ? row.label : `${row.label} · potong advance`
}

function columnsFor(
  unitLabel: (id: string) => string
): ColumnDef<TableSetup, PayrollAdjustmentRow>[] {
  return [
    {
      id: "who",
      accessorFn: (row) => row.full_name ?? row.employee_code,
      header: "Who",
      size: 260,
      meta: { card: "hide" },
    },
    {
      id: "component",
      accessorFn: (row) => componentOf(row),
      header: "Component",
      size: 260,
      meta: { card: "hide" },
    },
    {
      id: "unit",
      accessorFn: (row) => unitLabel(row.unit_id),
      header: "Unit",
      size: 160,
      meta: { card: "hide" },
      // Read at render: the table caches a row's values, and the unit names
      // can arrive after the rows.
      cell: ({ row }) => unitLabel(row.original.unit_id),
    },
    {
      accessorKey: "amount_minor",
      header: "Amount",
      size: 170,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => money(row.original.amount_minor),
    },
    {
      id: "state",
      accessorFn: (row) => stateOf(row).label,
      header: "State",
      size: 170,
      meta: { card: "hide" },
      cell: ({ row }) => (
        <Status tone={stateOf(row.original).tone}>
          {stateOf(row.original).label}
        </Status>
      ),
    },
    // Three columns that exist only on a card (`cardLead`; a phone): the person
    // over the component and unit, the amount as the figure, and where the
    // figure stands.
    {
      id: "head",
      accessorFn: (row) => row.full_name ?? row.employee_code,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "title" },
      cell: ({ row }) => (
        <CardName
          name={row.original.full_name ?? row.original.employee_code}
          line={[componentOf(row.original), unitLabel(row.original.unit_id)]}
        />
      ),
    },
    {
      id: "lead",
      accessorFn: (row) => row.amount_minor,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      cell: ({ row }) => (
        <CardFigure
          value={money(row.original.amount_minor)}
          caption={row.original.kind === "DEDUCTION" ? "deduction" : "earning"}
        />
      ),
    },
    {
      id: "foot",
      accessorFn: (row) => row.withdrawable,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) => (
        <Status tone={stateOf(row.original).tone}>
          {stateOf(row.original).label}
        </Status>
      ),
    },
  ]
}

export function OneOffs() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const unit = useUnit()
  const reachable = useReachableUnits()
  const reachableUnits = useMemo(() => reachable.data ?? [], [reachable.data])
  const postedId = unit.unitId
  const postedName = unit.name
  /// A unit's name, never its id: the posting stands in for a caller whose
  /// reach lists nothing.
  const unitLabel = useCallback(
    (id: string) =>
      reachableUnits.find((one) => one.id === id)?.name ??
      (id === postedId ? postedName : null) ??
      id,
    [reachableUnits, postedId, postedName]
  )
  const columns = useMemo(() => columnsFor(unitLabel), [unitLabel])
  const [unitId, setUnitId] = useState("")
  const [period, setPeriod] = useState(thisMonth)
  const [filing, setFiling] = useState(false)
  const [importing, setImporting] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const rows = useQuery({
    queryKey: payKeys.adjustments(unitId, period),
    queryFn: ({ signal }) =>
      listAdjustments(
        { unit: unitId === "" ? undefined : unitId, period },
        signal
      ),
    enabled: /^\d{4}-\d{2}$/.test(period),
  })
  const filed = rows.data ?? NO_ROWS
  const open = filed.find((row) => row.id === openId) ?? null
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: filed,
        columns,
        getRowId: (row: PayrollAdjustmentRow) => row.id,
        // The card's own columns are drawn on a phone and never on a desk;
        // the unit is a column only where there is more than one to tell apart.
        state: {
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            unit: unitId === "" && reachableUnits.length > 1,
          },
        },
      }),
      [filed, columns, phone, unitId, reachableUnits.length]
    )
  )

  return (
    <PageContent>
      <PageHeader
        title="One-offs"
        actions={
          !phone &&
          canWrite && (
            <>
              <Button variant="ghost" onClick={() => setImporting(true)}>
                Import CSV
              </Button>
              <Button variant="primary" onClick={() => setFiling(true)}>
                File one-off
              </Button>
            </>
          )
        }
      />
      {canWrite && <Fab label="File one-off" onClick={() => setFiling(true)} />}

      <Toolbar>
        {unit.units.length > 0 && (
          <Select value={unitId} onChange={setUnitId} className="h-8 w-52">
            <option value="">Every unit</option>
            {unit.units.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </Select>
        )}
        <Input
          type="month"
          aria-label="Month"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
          className="h-8 w-44"
        />
      </Toolbar>

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(rows, {
          loading: "Reading the one-offs…",
          render: () =>
            filed.length === 0 ? (
              <EmptyState>Nothing filed for {monthYear(period)}.</EmptyState>
            ) : (
              <DataTable<PayrollAdjustmentRow>
                refresh={[rows]}
                table={table}
                onRowClick={(row) => setOpenId(row.id)}
                isSelected={(row) => row.id === openId}
                cardsApart
                cardLead
                cardSort={false}
              />
            ),
        })}
      </Card>

      {/* Importing many is a desk job in the main, but it stays reachable: at
          the foot of the list on a phone, not at the top. */}
      {canWrite && (
        <div className="mt-4 md:hidden">
          <Button className="w-full" onClick={() => setImporting(true)}>
            Import CSV
          </Button>
        </div>
      )}

      {filing && (
        <FileOneOffSheet
          defaultUnit={unitId}
          defaultPeriod={period}
          onClose={() => setFiling(false)}
        />
      )}
      {importing && (
        <ImportSheet
          defaultUnit={unitId}
          defaultPeriod={period}
          onClose={() => setImporting(false)}
        />
      )}
      {open !== null && (
        <OneOffSheet
          row={open}
          unit={unitLabel(open.unit_id)}
          onClose={() => setOpenId(null)}
        />
      )}
    </PageContent>
  )
}

/// One filed figure: what it is, who filed it and why, and — while the batch
/// is still the place's — the way to take it back.
function OneOffSheet({
  row,
  unit,
  onClose,
}: {
  row: PayrollAdjustmentRow
  /// The unit's name; the row only carries its id.
  unit: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const canWrite = useCanWrite()
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const withdraw = useMutation({
    mutationFn: () => withdrawAdjustment(row.id, reason.trim()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ADJUSTMENTS })
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={row.employee_code}
      title={`${row.label} · ${row.full_name ?? row.employee_code}`}
    >
      <Pill tone={stateOf(row).tone}>{stateOf(row).label}</Pill>

      <Facts className="mt-3">
        <Fact term="Amount">{money(row.amount_minor)}</Fact>
        <Fact term="Kind">
          {row.kind === "DEDUCTION" ? "Deduction" : "Earning"}
        </Fact>
        <Fact term="Month">{monthYear(row.period)}</Fact>
        <Fact term="Unit">{unit}</Fact>
        <Fact term="Filed by">{row.filed_by}</Fact>
        <Fact term="Filed">{moment(row.filed_at)}</Fact>
        {row.advance_id !== null && (
          <Fact term="Repays">an advance taken from pay</Fact>
        )}
      </Facts>

      <div className="mt-4">
        <SubHead>Why</SubHead>
        <p className="text-[0.9375rem] text-body">{row.reason}</p>
      </div>

      {row.withdrawable ? (
        canWrite && (
          <div className="mt-5 flex flex-col gap-3 border-t border-hairline pt-4">
            <SubHead>Take it back</SubHead>
            {failed !== null && <Banner tone="bad">{failed}</Banner>}
            <Field label="Why (taking it back)" required>
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <div>
              <Button
                variant="danger"
                pending={withdraw.isPending}
                disabled={reason.trim() === ""}
                onClick={() => withdraw.mutate()}
              >
                Take back
              </Button>
            </div>
          </div>
        )
      ) : (
        <p className="mt-5 text-meta text-mute">
          In the batch the place has sent. Head office reopens the run before it
          can be taken back.
        </p>
      )}
    </Sheet>
  )
}

/// Filing one figure. The unit and month start from the page's filters, and
/// the person and component are chosen from what that unit has.
function FileOneOffSheet({
  defaultUnit,
  defaultPeriod,
  onClose,
}: {
  defaultUnit: string
  defaultPeriod: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const filingUnits = useFilingUnits()
  const [chosenUnit, setChosenUnit] = useState(defaultUnit)
  const unitId = chosenUnit !== "" ? chosenUnit : filingUnits.fallback
  const [period, setPeriod] = useState(defaultPeriod)
  const [employeeId, setEmployeeId] = useState("")
  const [componentCode, setComponentCode] = useState("")
  const [advanceId, setAdvanceId] = useState<string | null>(null)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const team = useQuery({
    queryKey: peopleKeys.employees({
      status: "ACTIVE",
      unitId: unitId === "" ? undefined : unitId,
      limit: 1000,
    }),
    queryFn: ({ signal }) =>
      listEmployees(
        {
          status: "ACTIVE",
          unitId: unitId === "" ? undefined : unitId,
          limit: 1000,
        },
        signal
      ),
    enabled: unitId !== "",
  })
  const catalogue = useQuery({
    queryKey: payKeys.components(),
    queryFn: ({ signal }) => payComponents(signal),
  })
  const advances = useQuery({
    queryKey: claimsKeys.advances(employeeId),
    queryFn: ({ signal }) => openAdvances(employeeId, signal),
    enabled: employeeId !== "",
  })

  // Only an advance that was actually paid out can be repaid from a wage:
  // one still requested has gone nowhere, and there is nothing in a wage to
  // recover it from. The server enforces this at filing; the picker restates
  // it so it never offers a link that would be refused.
  const recoverable = (advances.data ?? []).filter(
    (row) => row.status === "PAID" || row.status === "PARTIALLY_SETTLED"
  )
  const picked = recoverable.find((row) => row.advance_id === advanceId) ?? null
  const cap = picked === null ? null : picked.outstanding_minor

  // With no advance picked the form offers every one-off component; the
  // moment one is picked the list narrows to the deductions, and a component
  // chosen before that no longer qualifies stops being a choice.
  const oneOffs = (catalogue.data ?? []).filter(
    (component) =>
      component.basis === "PER_OCCASION" &&
      !component.retired &&
      (picked === null || component.kind === "DEDUCTION")
  )
  const componentChosen = oneOffs.some((one) => one.code === componentCode)
    ? componentCode
    : ""

  // The server's "minor" unit is already whole rupiah for IDR: a fraction of
  // a rupiah is not a thing a payroll figure carries. Multiplying by 100 here
  // was an old convention from a currency with cents and paid a Rp300.000
  // incentive as Rp30.000.000.
  const amountMinor = Number(amount.replace(/\D/g, "") || "0")
  const over = cap !== null && amountMinor > cap

  const file = useMutation({
    mutationFn: () =>
      fileAdjustment({
        unitId,
        period,
        employeeId,
        componentCode: componentChosen,
        amountMinor,
        reason: reason.trim(),
        ...(advanceId !== null ? { advanceId } : {}),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ADJUSTMENTS })
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="File one-off"
      footer={
        <div className="flex justify-end gap-2">
          <Button data-cancel variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={file.isPending}
            disabled={
              unitId === "" ||
              period === "" ||
              employeeId === "" ||
              componentChosen === "" ||
              amountMinor <= 0 ||
              over ||
              reason.trim() === ""
            }
            onClick={() => file.mutate()}
          >
            File it
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        <Field label="Unit" required>
          <PickOne
            label="Unit"
            choices={filingUnits.choices}
            value={unitId === "" ? null : unitId}
            onChange={(next) => {
              setChosenUnit(next ?? "")
              setEmployeeId("")
              setAdvanceId(null)
            }}
          />
        </Field>
        <Field label="Month" required>
          <Input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </Field>
        <Field label="Who" required>
          <PickOne
            label="Who"
            choices={(team.data ?? []).map((one) => ({
              value: one.employee_id,
              label:
                one.full_name === null
                  ? one.employee_code
                  : `${one.full_name} · ${one.employee_code}`,
            }))}
            value={employeeId === "" ? null : employeeId}
            onChange={(next) => {
              setEmployeeId(next ?? "")
              setAdvanceId(null)
              setComponentCode("")
            }}
          />
        </Field>
        <Field label="Component" required>
          <PickOne
            label="Component"
            choices={oneOffs.map((one) => ({
              value: one.code,
              label: `${one.label} · ${one.code}`,
            }))}
            value={componentChosen === "" ? null : componentChosen}
            onChange={(next) => setComponentCode(next ?? "")}
          />
        </Field>
        {employeeId !== "" && (
          <Field label="Potong advance">
            <PickOne
              label="Potong advance"
              choices={recoverable.map((one) => ({
                value: one.advance_id,
                label: `${one.advance_number} · ${money(one.outstanding_minor)} outstanding`,
              }))}
              value={advanceId}
              onChange={(next) => setAdvanceId(next)}
            />
          </Field>
        )}
        <Field label="Amount" required>
          <Input
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        {/* The cap and the freeze, where the figure is typed. The cap is the
            outstanding the advance carries now; the freeze is the batch's. The
            server states both again — a recovery approved months later lands
            on what the advance still carries, never on what the form hoped. */}
        {cap !== null && (
          <Banner tone="info">
            Capped at {money(cap)}, what is still out on{" "}
            {picked?.advance_number}.
          </Banner>
        )}
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

/// Import a month's one-offs from a sheet. The unit and month are chosen
/// here, then the file is read and each row filed through the same route as
/// the single form.
function ImportSheet({
  defaultUnit,
  defaultPeriod,
  onClose,
}: {
  defaultUnit: string
  defaultPeriod: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const filingUnits = useFilingUnits()
  const [chosenUnit, setChosenUnit] = useState(defaultUnit)
  const unitId = chosenUnit !== "" ? chosenUnit : filingUnits.fallback
  const [period, setPeriod] = useState(defaultPeriod)

  const team = useQuery({
    queryKey: peopleKeys.employees({
      status: "ACTIVE",
      unitId: unitId === "" ? undefined : unitId,
      limit: 1000,
    }),
    queryFn: ({ signal }) =>
      listEmployees(
        {
          status: "ACTIVE",
          unitId: unitId === "" ? undefined : unitId,
          limit: 1000,
        },
        signal
      ),
    enabled: unitId !== "",
  })
  const catalogue = useQuery({
    queryKey: payKeys.components(),
    queryFn: ({ signal }) => payComponents(signal),
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Import one-offs from CSV"
      width="wide"
      footer={
        <div className="flex justify-end">
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Unit" required>
          <PickOne
            label="Unit"
            choices={filingUnits.choices}
            value={unitId === "" ? null : unitId}
            onChange={(next) => setChosenUnit(next ?? "")}
          />
        </Field>
        <Field label="Month" required>
          <Input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </Field>
        {unitId === "" ? (
          <p className="text-[0.9375rem] text-mute">Choose a unit first.</p>
        ) : (
          <OneOffImport
            // A new unit or month is a new import: rows read for the last
            // one must not be filed into this one.
            key={`${unitId}-${period}`}
            unitId={unitId}
            period={period}
            people={team.data ?? []}
            components={(catalogue.data ?? []).filter(
              (component) =>
                component.basis === "PER_OCCASION" && !component.retired
            )}
            onFiled={() =>
              void client.invalidateQueries({ queryKey: ADJUSTMENTS })
            }
          />
        )}
      </div>
    </Sheet>
  )
}
