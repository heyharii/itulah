import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, Status } from "@/components/ui/pill"
import {
  KeyValue,
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
} from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { Timeline } from "@/components/ui/timeline"
import { day, money, moment, monthYear } from "@/lib/format"
import { PickOne } from "@/components/ui/pick"
import {
  handOverRun,
  handoverLabel,
  listRuns,
  openRun,
  payKeys,
  readHandover,
  rebuildRun,
  setRunThr,
  holdPay,
  releasePay,
  runWithholdings,
  runReconciliation,
  runSlips,
  runStateLabel,
  stepRun,
  useReachableUnits,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import type { PayrollRunView, RunReconciliation } from "@itulah/contract"

import { CardMonth, CardName } from "@/components/ui/phone-cards"
import { SlipBreakdown } from "@/screens/people/slip-view"

/// Payroll runs. The place asks for its own; head office answers.
///
/// # Three states, and the two-person rule moved rather than went
///
/// The owner's decision of 2026-09-13 removed `verify` and `seal`. What is
/// left is **Draft → Submitted → Approved**, and approval is final. The rule
/// that one person cannot complete the control alone survived by changing
/// shape: it used to be *verifier is not approver* and it is now **submitter
/// is not approver** — the place sends the batch and head office decides it,
/// which is two actors by construction rather than by a second signature on
/// one desk.
///
/// # The buttons are not the control
///
/// The server refuses an approval by the person who submitted, and the refusal
/// is a conflict rather than a bad request: the payload is fine and what is
/// wrong is who is sending it. The screen offers the button and lets the server
/// answer, because the screen cannot know who is reading it without asking, and
/// a control that appears a moment late is worse than one that is answered
/// honestly.
///
/// # Read `incomplete_because` before reading a figure
///
/// A run says what it does not know, per run and per unit. A unit whose punch
/// station has never reported produces a run that knows what was planned and
/// never what was worked — and it says so in a sentence rather than leaving the
/// reader to infer it from a tidy total.
///
/// # Take-home pay, and what it was worked out from
///
/// Since 0800 every slip carries PPh 21 and BPJS, worked out by the server
/// from the employee's PTKP, tax method and BPJS numbers and the rates head
/// office states. The run reads like Talenta's payroll processing: a summary
/// across the run, one row per person with take-home pay, and the payslip
/// itself one click away — earnings, deductions, what the company paid on
/// top, and the tax behind the PPh 21 line. A slip that could not be worked
/// out says why instead of showing a number.

function stateTone(state: string) {
  switch (state) {
    case "APPROVED":
      return "ok" as const
    case "SUBMITTED":
      return "info" as const
    default:
      return "warn" as const
  }
}

/// A unit's name, or its id when the list has not arrived. Never a bare id
/// once it has: `store-07` is a primary key, and the list beside it says
/// `Store 07`.
function unitName(
  units: readonly { readonly id: string; readonly name: string }[],
  id: string
): string {
  return units.find((one) => one.id === id)?.name ?? id
}

type Units = readonly { readonly id: string; readonly name: string }[]

const NO_RUNS: PayrollRunView[] = []

function columnsFor(units: Units): ColumnDef<TableSetup, PayrollRunView>[] {
  return [
    {
      accessorKey: "period",
      header: "Month",
      size: 150,
      meta: { card: "hide" },
      cell: ({ row }) => monthYear(row.original.period),
    },
    {
      id: "unit",
      accessorFn: (row) => unitName(units, row.unit_id),
      header: "Unit",
      size: 220,
      meta: { card: "hide" },
      // Read at render: the table caches a row's values, and the unit names
      // can arrive after the runs.
      cell: ({ row }) => unitName(units, row.original.unit_id),
    },
    {
      id: "pay_on",
      accessorFn: (row) => row.pay_on,
      header: "Pay day",
      size: 160,
      meta: { card: "hide" },
      cell: ({ row }) => day(row.original.pay_on),
    },
    {
      accessorKey: "state",
      header: "State",
      size: 240,
      meta: { card: "hide" },
      // One dot and one line: a run that knows it is short says so after its
      // state, and why on hover.
      cell: ({ row }) =>
        row.original.complete ? (
          <Status tone={stateTone(row.original.state)}>
            {runStateLabel(row.original.state)}
          </Status>
        ) : (
          <span title={row.original.incomplete_because ?? undefined}>
            <Status tone="warn">
              {runStateLabel(row.original.state)}, incomplete
            </Status>
          </span>
        ),
    },
    {
      id: "finance",
      accessorFn: (row) => row.handover?.state ?? "",
      header: "Finance",
      size: 200,
      meta: { card: "hide" },
      cell: ({ row }) =>
        row.original.handover === null ? (
          <span className="text-mute">Not handed over</span>
        ) : (
          <Status tone={row.original.handover.state === "PAID" ? "ok" : "info"}>
            {handoverLabel(row.original.handover.state)}
          </Status>
        ),
    },
    // Three columns that exist only on a card (`cardLead`; a phone): the unit
    // over its pay day, the month as the figure, and where the run stands.
    {
      id: "head",
      accessorFn: (row) => unitName(units, row.unit_id),
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "title" },
      cell: ({ row }) => (
        <CardName
          name={unitName(units, row.original.unit_id)}
          line={`Pay day ${day(row.original.pay_on)}`}
        />
      ),
    },
    {
      id: "lead",
      accessorFn: (row) => row.period,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      cell: ({ row }) => <CardMonth period={row.original.period} />,
    },
    {
      id: "foot",
      accessorFn: (row) => row.state,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Status
            tone={
              row.original.complete ? stateTone(row.original.state) : "warn"
            }
          >
            {runStateLabel(row.original.state)}
            {!row.original.complete && ", incomplete"}
          </Status>
          {row.original.handover !== null && (
            <Status
              tone={row.original.handover.state === "PAID" ? "ok" : "info"}
            >
              {handoverLabel(row.original.handover.state)}
            </Status>
          )}
        </span>
      ),
    },
  ]
}

export function PayrollRuns() {
  const run = useSheet("payrollRun")
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const [opening, setOpening] = useState(false)
  const [unitFilter, setUnitFilter] = useState("")
  const [stateFilter, setStateFilter] = useState("")
  const reachable = useReachableUnits()
  const units = useMemo(() => reachable.data ?? [], [reachable.data])
  const runs = useQuery({
    queryKey: payKeys.runs(),
    queryFn: ({ signal }) => listRuns(signal),
  })
  const rows = runs.data ?? NO_RUNS
  const open = rows.find((row) => row.id === run.value) ?? null
  const shown = useMemo(
    () =>
      rows.filter(
        (row) =>
          (unitFilter === "" || row.unit_id === unitFilter) &&
          (stateFilter === "" || row.state === stateFilter)
      ),
    [rows, unitFilter, stateFilter]
  )
  const columns = useMemo(() => columnsFor(units), [units])
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: shown,
        columns,
        getRowId: (row: PayrollRunView) => row.id,
        // The card's own columns are drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone, lead: phone, foot: phone } },
      }),
      [shown, columns, phone]
    )
  )

  return (
    <PageContent>
      <PageHeader
        title="Payroll"
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => setOpening(true)}>
              Open run
            </Button>
          )
        }
      />
      {canWrite && <Fab label="Open run" onClick={() => setOpening(true)} />}

      <Toolbar>
        <Select
          value={unitFilter}
          onChange={setUnitFilter}
          className="h-8 w-52"
        >
          <option value="">Every unit</option>
          {units.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name}
            </option>
          ))}
        </Select>
        <Select
          value={stateFilter}
          onChange={setStateFilter}
          className="h-8 w-44"
        >
          <option value="">Every state</option>
          {["DRAFT", "SUBMITTED", "APPROVED"].map((state) => (
            <option key={state} value={state}>
              {runStateLabel(state)}
            </option>
          ))}
        </Select>
      </Toolbar>

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(runs, {
          loading: "Reading the runs…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>No run has been opened yet.</EmptyState>
            ) : shown.length === 0 ? (
              <EmptyState>No run matches these filters.</EmptyState>
            ) : (
              <DataTable<PayrollRunView>
                refresh={[runs]}
                table={table}
                onRowClick={(row) => run.open(row.id)}
                isSelected={(row) => row.id === run.value}
                cardsApart
                cardLead
                cardSort={false}
              />
            ),
        })}
      </Card>

      <OpenRunSheet open={opening} onClose={() => setOpening(false)} />
      <RunSheet
        run={open}
        unit={open === null ? "" : unitName(units, open.unit_id)}
        onClose={run.close}
      />
    </PageContent>
  )
}

function RunSheet({
  run,
  unit,
  onClose,
}: {
  run: PayrollRunView | null
  /// The unit's name; the run only carries its id.
  unit: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const [shown, setShown] = useState<string | null>(null)

  const slips = useQuery({
    queryKey: payKeys.slips(run?.id ?? ""),
    queryFn: ({ signal }) => runSlips(run?.id ?? "", signal),
    enabled: run !== null,
  })
  const reconciliation = useQuery({
    queryKey: payKeys.reconciliation(run?.id ?? ""),
    queryFn: ({ signal }) => runReconciliation(run?.id ?? "", signal),
    enabled: run !== null,
  })

  const recalculate = useMutation({
    mutationFn: () => {
      if (run === null) throw new Error("no run is open")
      return rebuildRun(run.id)
    },
    onSuccess: () => {
      setFailed(null)
      if (run === null) return
      void client.invalidateQueries({ queryKey: payKeys.slips(run.id) })
      void client.invalidateQueries({
        queryKey: payKeys.reconciliation(run.id),
      })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const step = useMutation({
    mutationFn: (which: "submission" | "approve" | "reopen") => {
      if (run === null) throw new Error("no run is open")
      return stepRun(run.id, which, reason.trim())
    },
    onSuccess: () => {
      setReason("")
      setFailed(null)
      void client.invalidateQueries({ queryKey: payKeys.runs() })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (run === null) return null
  const ready = reason.trim() !== "" && !step.isPending
  const selected =
    (slips.data ?? []).find((slip) => slip.employee_id === shown) ?? null

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={run.id}
      title={`${unit} · ${monthYear(run.period)}`}
    >
      <Pill tone={stateTone(run.state)}>{runStateLabel(run.state)}</Pill>

      {/* First, and before any figure. A total read before its caveat is a
          total somebody remembers. */}
      {run.incomplete_because !== null && (
        <Banner tone="warn" className="mt-3">
          {run.incomplete_because}
        </Banner>
      )}

      <Facts>
        <Fact term="Unit">{unit}</Fact>
        <Fact term="Month">{monthYear(run.period)}</Fact>
        <Fact term="Attendance">
          {day(run.attendance_from)} – {day(run.attendance_to)}
        </Fact>
        <Fact term="Pay day">{day(run.pay_on)}</Fact>
        <Fact term="Sent by">{run.submitted_by ?? "nobody yet"}</Fact>
        <Fact term="Approved by">{run.approved_by ?? "nobody yet"}</Fact>
        {run.thr_on !== null && (
          <Fact term="THR">for the holiday on {day(run.thr_on)}</Fact>
        )}
      </Facts>

      {run.state === "DRAFT" && <ThrControl run={run} />}

      {reconciliation.data !== undefined && (
        <RunSummary totals={reconciliation.data} />
      )}

      {(slips.data ?? []).length > 0 && (
        <div className="mt-4">
          <SubHead aside="Click a row for the payslip">Slips</SubHead>
          <MiniTable
            head={[
              "Employee",
              { label: "Days", align: "right" },
              { label: "Gross", align: "right" },
              { label: "Deductions", align: "right" },
              { label: "Take-home", align: "right" },
            ]}
          >
            {(slips.data ?? []).map((slip) => {
              const open = shown === slip.employee_id
              return (
                <MiniRow key={slip.employee_id}>
                  <MiniCell>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setShown(open ? null : slip.employee_id)}
                      className="text-left hover:underline"
                    >
                      <span className="block text-[0.9375rem] text-ink">
                        {slip.full_name ?? slip.employee_code}{" "}
                        {slip.withheld && <Pill tone="warn">Held</Pill>}
                      </span>
                      <span className="font-mono text-[0.9375rem] text-mute">
                        {slip.bank_account_masked ?? "no account"}
                      </span>
                    </button>
                  </MiniCell>
                  <MiniCell align="right">
                    {slip.days_paid === null
                      ? "—"
                      : `${slip.days_paid}/${slip.days_in_month ?? "—"}`}
                  </MiniCell>
                  <MiniCell align="right">{money(slip.gross_minor)}</MiniCell>
                  <MiniCell align="right">
                    {slip.deduction_total_minor === null
                      ? "—"
                      : money(slip.deduction_total_minor)}
                  </MiniCell>
                  <MiniCell align="right">
                    {slip.net_minor === null ? (
                      <Pill tone="warn">Incomplete</Pill>
                    ) : (
                      money(slip.net_minor)
                    )}
                  </MiniCell>
                </MiniRow>
              )
            })}
          </MiniTable>
          {selected !== null && (
            <div className="mt-4 rounded-card border border-hairline p-4">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <span className="text-card-title font-semibold text-ink">
                  {selected.full_name ?? selected.employee_code}
                </span>
                <span className="text-[0.9375rem] text-mute">
                  Payslip · {monthYear(run.period)}
                </span>
              </div>
              <SlipBreakdown slip={selected} />
              <HoldControl
                runId={run.id}
                employeeId={selected.employee_id}
                withheld={selected.withheld}
              />
            </div>
          )}
        </div>
      )}

      {run.history.length > 0 && (
        <div className="mt-4">
          <SubHead>Signed</SubHead>
          <Timeline
            events={run.history.map((event, index) => ({
              id: `${event.step}-${index}`,
              title: runStateLabel(event.step),
              detail: `${event.actor} · ${event.reason}`,
              at: moment(event.at),
              state: index === run.history.length - 1 ? "current" : "done",
            }))}
          />
        </div>
      )}

      {failed !== null && (
        <Banner tone="bad" className="mt-4">
          {failed}
        </Banner>
      )}

      <div className="mt-4 flex flex-col gap-3">
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {/* The place sends it. Offered on a draft to whoever is looking,
              and refused by the server for anybody outside that place — the
              screen cannot know where the reader is posted without asking,
              and a button that appears a moment late is worse than one the
              server answers honestly. */}
          {run.state === "DRAFT" && (
            <Button
              variant="ghost"
              pending={recalculate.isPending}
              onClick={() => recalculate.mutate()}
            >
              Recalculate
            </Button>
          )}
          {run.state === "DRAFT" && (
            <Button
              variant="primary"
              disabled={!ready}
              onClick={() => step.mutate("submission")}
            >
              Send to head office
            </Button>
          )}
          {/* Offered to everybody, refused by the server for the person who
              SENT it. That is the two-person rule in its new shape: it used to
              be verifier-is-not-approver and it is now submitter-is-not-
              approver. The screen cannot know who is looking at it, and
              guessing would hide the button from the wrong person. */}
          {run.state === "SUBMITTED" && (
            <Button
              variant="primary"
              disabled={!ready}
              onClick={() => step.mutate("approve")}
            >
              Approve
            </Button>
          )}
          {run.state !== "DRAFT" && (
            <Button
              variant="danger"
              disabled={!ready}
              onClick={() => step.mutate("reopen")}
            >
              Send back
            </Button>
          )}
        </div>
      </div>

      {run.state === "APPROVED" && <Handover run={run} />}
    </Sheet>
  )
}

/// Tahan gaji: hold one person's pay on this run, or let it go. The slip is
/// still worked out and still owed — the accrual does not change — but no
/// envelope or transfer can be listed for them on this run until the hold is
/// released. Any state: a hold is about paying, which comes after approval.
function HoldControl({
  runId,
  employeeId,
  withheld,
}: {
  runId: string
  employeeId: string
  withheld: boolean
}) {
  const client = useQueryClient()
  const [why, setWhy] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const holds = useQuery({
    queryKey: payKeys.withholdings(runId),
    queryFn: ({ signal }) => runWithholdings(runId, signal),
  })
  const current = (holds.data ?? []).find(
    (hold) => hold.employee_id === employeeId && hold.released_at === null
  )
  const change = useMutation({
    mutationFn: () =>
      withheld
        ? releasePay(runId, employeeId, why.trim())
        : holdPay(runId, employeeId, why.trim()),
    onSuccess: () => {
      setWhy("")
      setFailed(null)
      void client.invalidateQueries({ queryKey: payKeys.withholdings(runId) })
      void client.invalidateQueries({ queryKey: payKeys.slips(runId) })
      void client.invalidateQueries({ queryKey: payKeys.reconciliation(runId) })
    },
    onError: (error: Error) => setFailed(error.message),
  })
  return (
    <div className="mt-4 border-t border-hairline pt-4">
      <SubHead>Hold pay</SubHead>
      {withheld && current !== undefined && (
        <Banner tone="warn" className="mb-3">
          Held by {current.held_by} on {day(current.held_at)}: {current.reason}.
          Still owed; nothing is paid out to them on this run until released.
        </Banner>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Why" required>
          <Input value={why} onChange={(event) => setWhy(event.target.value)} />
        </Field>
        <Button
          variant={withheld ? "ghost" : "danger"}
          pending={change.isPending}
          disabled={why.trim() === ""}
          onClick={() => change.mutate()}
        >
          {withheld ? "Release pay" : "Hold pay"}
        </Button>
      </div>
      {failed !== null && (
        <Banner tone="bad" className="mt-2">
          {failed}
        </Banner>
      )}
    </div>
  )
}

/// THR on this run, as Talenta's Run THR: the holiday's date, and every slip
/// gains a THR line — a month's wage after twelve months' service, `months /
/// 12` of it after at least one (Permenaker 6/2016) — taxed with the month.
function ThrControl({ run }: { run: PayrollRunView }) {
  const client = useQueryClient()
  const [holiday, setHoliday] = useState(run.thr_on ?? "")
  const [failed, setFailed] = useState<string | null>(null)
  const set = useMutation({
    mutationFn: (on: string | null) =>
      setRunThr(run.id, on, on === null ? "THR cancelled" : "holiday THR"),
    onSuccess: () => {
      setFailed(null)
      void client.invalidateQueries({ queryKey: payKeys.runs() })
      void client.invalidateQueries({ queryKey: payKeys.slips(run.id) })
      void client.invalidateQueries({
        queryKey: payKeys.reconciliation(run.id),
      })
    },
    onError: (error: Error) => setFailed(error.message),
  })
  return (
    <div className="mt-4">
      <SubHead>THR</SubHead>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Holiday">
          <Day value={holiday} onChange={setHoliday} />
        </Field>
        <Button
          variant="ghost"
          pending={set.isPending}
          disabled={holiday === ""}
          onClick={() => set.mutate(holiday)}
        >
          {run.thr_on === null ? "Add THR to this run" : "Change the date"}
        </Button>
        {run.thr_on !== null && (
          <Button variant="quiet" onClick={() => set.mutate(null)}>
            Take THR off
          </Button>
        )}
      </div>
      {failed !== null && (
        <Banner tone="bad" className="mt-2">
          {failed}
        </Banner>
      )}
    </div>
  )
}

/// The run at a glance, as Talenta's payroll processing opens: how many
/// people, what they earn, what comes off, what they take home, and what the
/// company pays on top. A total over slips that could not all be worked out
/// is not stated — it would be a total somebody pays from.
function RunSummary({ totals }: { totals: RunReconciliation }) {
  const unknown = "not worked out"
  return (
    <div className="mt-4">
      <SubHead>Summary</SubHead>
      <KeyValue term="Employees">{totals.slips}</KeyValue>
      <KeyValue term="Gross">{money(totals.gross_total_minor)}</KeyValue>
      <KeyValue term="Deductions">
        {totals.deduction_total_minor === null
          ? unknown
          : money(totals.deduction_total_minor)}
      </KeyValue>
      <KeyValue term="Take-home pay">
        {totals.net_total_minor === null
          ? unknown
          : money(totals.net_total_minor)}
      </KeyValue>
      <KeyValue term="PPh 21">
        {totals.pph21_total_minor === null
          ? unknown
          : money(totals.pph21_total_minor)}
      </KeyValue>
      <KeyValue term="Paid by the company">
        {money(totals.company_borne_total_minor)} · BPJS share and borne tax
      </KeyValue>
      {/* Blockers a person can act on, stated rather than left to be
          inferred from a slip list. */}
      {totals.slips_with_unworkable_components > 0 && (
        <KeyValue term="Incomplete slips">
          {totals.slips_with_unworkable_components} · open the row to see why
        </KeyValue>
      )}
      <KeyValue term="Cannot be paid">
        {totals.unpayable} · no account on record
      </KeyValue>
      {totals.withheld > 0 && (
        <KeyValue term="Pay held">
          {totals.withheld} · owed, not paid out until released
        </KeyValue>
      )}
      <KeyValue term="No pay agreement">
        {totals.without_agreement} · not on this run
      </KeyValue>
    </div>
  )
}

/// The crossing to Finance, and what came back.
///
/// # Why this is the point of no return and approval is not
///
/// The owner removed the `seal` step on 2026-09-13: approval is final. So the
/// irreversible act is this one — once a liability is with Finance, reopening
/// the run means Finance has to reverse its own entry first. The screen says
/// that where the button is rather than in a doc nobody opens.
///
/// # Gross is the liability; the accrual splits it
///
/// What crosses is the run's gross. The accrual Finance receives splits it:
/// PPh 21 owed to the tax office (2011), BPJS owed to BPJS (2021, both shares),
/// and only net pay owed to the employees (2017) — the company's own BPJS share
/// and any tax it bears are its cost on top.
///
/// # Received is not paid
///
/// Two states, two signatures, and settling is Finance's own act under its own
/// key: a grant that could hand a liability over and then declare it paid
/// would be one person closing the loop on their own request.
function Handover({ run }: { run: PayrollRunView }) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const standing = useQuery({
    queryKey: payKeys.handover(run.id),
    queryFn: ({ signal }) => readHandover(run.id, signal),
  })

  const send = useMutation({
    mutationFn: () => handOverRun(run.id, reason.trim()),
    onSuccess: () => {
      setReason("")
      setFailed(null)
      void client.invalidateQueries({ queryKey: payKeys.handover(run.id) })
      void client.invalidateQueries({ queryKey: payKeys.runs() })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const crossed = standing.data ?? null

  return (
    <div className="mt-5">
      <SubHead>Finance</SubHead>
      {failed !== null && (
        <Banner tone="bad" className="mb-3">
          {failed}
        </Banner>
      )}

      {crossed === null ? (
        <div className="flex flex-col gap-3">
          <p className="text-meta text-body">
            Handing over cannot be taken back on its own: reopening this run
            then needs Finance to reverse its entry first.
          </p>
          <Field label="Why" required>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div>
            <Button
              variant="primary"
              pending={send.isPending}
              disabled={reason.trim() === ""}
              onClick={() => send.mutate()}
            >
              Hand over to Finance
            </Button>
          </div>
        </div>
      ) : (
        <>
          <KeyValue term="State">{handoverLabel(crossed.state)}</KeyValue>
          <KeyValue term="Gross">{money(crossed.gross_minor)}</KeyValue>
          <KeyValue term="Handed over">
            {crossed.handed_over_by} · {moment(crossed.handed_over_at)}
          </KeyValue>
          {crossed.settled_at !== null ? (
            <KeyValue term="Paid">
              {crossed.settled_by} · {moment(crossed.settled_at)}
            </KeyValue>
          ) : (
            <KeyValue term="Paid">not yet</KeyValue>
          )}
        </>
      )}
    </div>
  )
}

/// Opening a run: one unit, one month. A Sheet rather than a card under the
/// list — the list is the page, and opening one is an act with a button.
function OpenRunSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const reachable = useReachableUnits()
  const units = reachable.data ?? []
  const [unitId, setUnitId] = useState("")
  const [period, setPeriod] = useState(() =>
    new Date().toISOString().slice(0, 7)
  )
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const close = () => {
    setFailed(null)
    onClose()
  }

  const opening = useMutation({
    mutationFn: () => openRun(unitId.trim(), period, reason.trim()),
    onSuccess: () => {
      setReason("")
      void client.invalidateQueries({ queryKey: payKeys.runs() })
      close()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title="Open a run"
      footer={
        <div className="flex justify-end gap-2">
          <Button data-cancel variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={opening.isPending}
            disabled={
              unitId.trim() === "" || period === "" || reason.trim() === ""
            }
            onClick={() => opening.mutate()}
          >
            Open run
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        {/* Chosen, never typed. It asked for an `org_place` id in a text box
            and named three of them in the hint, which is a screen asking
            somebody to remember a primary key — and one typo away from a 404
            that reads as "there is no payroll for your shop". */}
        <Field label="Unit" required>
          <PickOne
            label="Unit"
            choices={units.map((one) => ({
              value: one.id,
              label: `${one.name} · ${one.employees}`,
            }))}
            value={unitId === "" ? null : unitId}
            onChange={(next) => setUnitId(next ?? "")}
          />
        </Field>
        <Field label="Month" required>
          <Input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </Field>
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
