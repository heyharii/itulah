import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import type { PayrollAdjustmentRow } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, money, moment } from "@/lib/format"
import {
  claimsKeys,
  fileAdjustment,
  listAdjustments,
  listEmployees,
  openAdvances,
  payComponents,
  payKeys,
  peopleKeys,
  withdrawAdjustment,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { OneOffImport } from "@/screens/people/one-off-import-card"
import { useUnit } from "@/screens/people/parts"

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

export function OneOffs() {
  const canWrite = useCanWrite()
  const unit = useUnit()
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
  const filed = rows.data ?? []
  const open = filed.find((row) => row.id === openId) ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="One-offs"
        sub="Incentives, commissions and kasbon instalments filed into a month's payroll."
        actions={
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
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute tabular-nums">
          {count(filed.length)} filed
        </span>
      </Toolbar>

      <Card className="overflow-hidden px-4 py-2">
        {queryState(rows, {
          loading: "Reading the one-offs…",
          render: () =>
            filed.length === 0 ? (
              <EmptyState>
                Nothing filed for {period}. Use File one-off to add an incentive
                or a kasbon instalment, or Import CSV to add many at once.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Who",
                  "Component",
                  "Unit",
                  { label: "Amount", align: "right" },
                  { label: "", align: "left" },
                ]}
              >
                {filed.map((row) => (
                  <MiniRow key={row.id}>
                    <MiniCell>
                      <button
                        type="button"
                        onClick={() => setOpenId(row.id)}
                        className="text-left hover:underline"
                      >
                        <span className="block text-[0.875rem] text-ink">
                          {row.full_name ?? row.employee_code}
                        </span>
                        <span className="font-mono text-[0.875rem] text-mute">
                          {row.employee_code}
                        </span>
                      </button>
                    </MiniCell>
                    <MiniCell>
                      <span className="block text-[0.875rem] text-ink">
                        {row.label}
                      </span>
                      <span className="font-mono text-[0.875rem] text-mute">
                        {row.component_code.toLowerCase()}
                        {row.advance_id !== null && " · potong advance"}
                      </span>
                    </MiniCell>
                    <MiniCell>{row.unit_id}</MiniCell>
                    <MiniCell align="right">{money(row.amount_minor)}</MiniCell>
                    <MiniCell>
                      <Pill tone={row.withdrawable ? "warn" : "ok"}>
                        {row.withdrawable ? "Filed" : "In the batch"}
                      </Pill>
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </Card>

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
        <OneOffSheet row={open} onClose={() => setOpenId(null)} />
      )}
    </PageContent>
  )
}

/// One filed figure: what it is, who filed it and why, and — while the batch
/// is still the place's — the way to take it back.
function OneOffSheet({
  row,
  onClose,
}: {
  row: PayrollAdjustmentRow
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
      <Pill tone={row.withdrawable ? "warn" : "ok"}>
        {row.withdrawable ? "Filed" : "In the batch"}
      </Pill>

      <Facts className="mt-3">
        <Fact term="Amount">{money(row.amount_minor)}</Fact>
        <Fact term="Kind">
          {row.kind === "DEDUCTION" ? "Deduction" : "Earning"}
        </Fact>
        <Fact term="Month">{row.period}</Fact>
        <Fact term="Unit">{row.unit_id}</Fact>
        <Fact term="Filed by">{row.filed_by}</Fact>
        <Fact term="Filed">{moment(row.filed_at)}</Fact>
        {row.advance_id !== null && (
          <Fact term="Repays">a kasbon (potong advance)</Fact>
        )}
      </Facts>

      <div className="mt-4">
        <SubHead>Why</SubHead>
        <p className="text-[0.875rem] text-body">{row.reason}</p>
      </div>

      {row.withdrawable ? (
        canWrite && (
          <div className="mt-5 flex flex-col gap-3 border-t border-hairline pt-4">
            <SubHead>Take it back</SubHead>
            {failed !== null && <Banner tone="bad">{failed}</Banner>}
            <Field
              label="Why (taking it back)"
              hint="Recorded against the withdrawal, and required."
              required
            >
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
          This is in the batch the place has sent. It cannot be taken back here:
          head office reopens the run first.
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
          <Button variant="quiet" onClick={onClose}>
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
        <Field
          label="Component"
          hint="A one-off files against a PER_OCCASION component."
          required
        >
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
          <Field
            label="Potong advance"
            hint="Optional. Links this deduction to the advance it repays."
          >
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
        <Field label="Amount" hint="Positive, in rupiah." required>
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
            Capped at {money(cap)} — what is still out on{" "}
            {picked?.advance_number}. The figure is frozen when this is filed,
            and head office decides it with the batch.
          </Banner>
        )}
        <Field
          label="Why"
          hint="Recorded against the figure, and required."
          required
        >
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
        <Field
          label="Month"
          hint="Every row in the file is filed into this unit and month."
          required
        >
          <Input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </Field>
        {unitId === "" ? (
          <p className="text-[0.875rem] text-mute">
            Choose a unit to read the file against its people.
          </p>
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
