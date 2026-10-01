import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import {
  KeyValue,
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
} from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Timeline } from "@/components/ui/timeline"
import { day, money, moment } from "@/lib/format"
import { PickOne } from "@/components/ui/pick"
import {
  claimsKeys,
  fileAdjustment,
  handOverRun,
  handoverLabel,
  listAdjustments,
  listEmployees,
  listRuns,
  openAdvances,
  openRun,
  payComponents,
  payKeys,
  peopleKeys,
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
  withdrawAdjustment,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import type { PayrollRunView, RunReconciliation } from "@itulah/contract"

import { OneOffImport } from "@/screens/people/one-off-import-card"
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

export function PayrollRuns() {
  const run = useSheet("payrollRun")
  const reachable = useReachableUnits()
  const units = reachable.data ?? []
  const runs = useQuery({
    queryKey: payKeys.runs(),
    queryFn: ({ signal }) => listRuns(signal),
  })
  const rows = runs.data ?? []
  const open = rows.find((row) => row.id === run.value) ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Payroll"
        sub="One place, one month, and two different people: the place that sends it and the head office that approves it."
      />

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        {queryState(runs, {
          loading: "Reading the runs…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No run has been opened. A month has to be signed off before its
                payroll can be built.
              </EmptyState>
            ) : (
              <div className="px-4 pb-4">
                {rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => run.open(row.id)}
                    className="flex w-full items-baseline gap-3 border-b border-hairline py-2.5 text-left last:border-0 hover:bg-soft-2"
                  >
                    <span className="w-24 shrink-0 text-ink">{row.period}</span>
                    <span className="min-w-0 flex-1 truncate text-body">
                      {unitName(units, row.unit_id)}
                    </span>
                    <Pill tone={stateTone(row.state)}>
                      {runStateLabel(row.state)}
                    </Pill>
                    {!row.complete && <Pill tone="warn">Incomplete</Pill>}
                  </button>
                ))}
              </div>
            ),
        })}
      </Card>

      <OpenRun />
      <Adjustments />
      <RunSheet run={open} onClose={run.close} />
    </PageContent>
  )
}

function RunSheet({
  run,
  onClose,
}: {
  run: PayrollRunView | null
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
      title={`${run.unit_id} · ${run.period}`}
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
        <Fact term="Unit">{run.unit_id}</Fact>
        <Fact term="Month">{run.period}</Fact>
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
                      <span className="block text-[0.875rem] text-ink">
                        {slip.full_name ?? slip.employee_code}{" "}
                        {slip.withheld && <Pill tone="warn">Held</Pill>}
                      </span>
                      <span className="font-mono text-[0.875rem] text-mute">
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
                <span className="text-[0.875rem] text-mute">
                  Payslip · {run.period}
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
        <Field
          label="Why"
          hint="Recorded against the step, and required."
          required
        >
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="angka sudah dicek"
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
          <Input
            value={why}
            onChange={(event) => setWhy(event.target.value)}
            placeholder={
              withheld ? "dokumen sudah lengkap" : "dokumen belum lengkap"
            }
          />
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
      setRunThr(run.id, on, on === null ? "THR dibatalkan" : "THR hari raya"),
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
            Approved and not yet with Finance. Handing it over is the step that
            cannot be taken back on its own — after it, reopening this run needs
            Finance to reverse its entry first.
          </p>
          <Field
            label="Why"
            hint="Recorded against the handover, and required."
            required
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="penggajian September"
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
            <KeyValue term="Paid">
              not yet — Finance has received it, which is not the same as having
              paid it
            </KeyValue>
          )}
          <p className="mt-2 text-meta text-mute">
            Gross. The accrual splits it: PPh 21 to the tax office, BPJS to
            BPJS, and net pay to the employees.
          </p>
        </>
      )}
    </div>
  )
}

function OpenRun() {
  const client = useQueryClient()
  const reachable = useReachableUnits()
  const units = reachable.data ?? []
  const [unitId, setUnitId] = useState("")
  const [period, setPeriod] = useState(() =>
    new Date().toISOString().slice(0, 7)
  )
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const open = useMutation({
    mutationFn: () => openRun(unitId.trim(), period, reason.trim()),
    onSuccess: () => {
      setFailed(null)
      setReason("")
      void client.invalidateQueries({ queryKey: payKeys.runs() })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Open a run</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        <Banner tone="info">
          A run is a draft until the place submits it: recalculate it whenever
          leave, overtime, pay or a PTKP status changes, and submitting it
          freezes the figures.
        </Banner>
        {/* Chosen, never typed. It asked for an `org_place` id in a text box
            and named three of them in the hint, which is a screen asking
            somebody to remember a primary key — and one typo away from a 404
            that reads as "there is no payroll for your shop". */}
        <Field label="Unit" required>
          <PickOne
            label="Unit"
            placeholder="Choose a unit…"
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
        <Field label="Why" hint="Recorded against the run." required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="penggajian April"
          />
        </Field>
        <div>
          <Button
            variant="primary"
            pending={open.isPending}
            disabled={
              unitId.trim() === "" || period === "" || reason.trim() === ""
            }
            onClick={() => open.mutate()}
          >
            Open it
          </Button>
        </div>
      </div>
    </Card>
  )
}

/// The one-offs a place files into a month's batch, and the advance a filing
/// can repay.
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
function Adjustments() {
  const client = useQueryClient()
  const reachable = useReachableUnits()
  const units = reachable.data ?? []
  const [unitId, setUnitId] = useState("")
  const [period, setPeriod] = useState(() =>
    new Date().toISOString().slice(0, 7)
  )
  const [employeeId, setEmployeeId] = useState("")
  const [componentCode, setComponentCode] = useState("")
  const [advanceId, setAdvanceId] = useState<string | null>(null)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [withdrawReason, setWithdrawReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const rows = useQuery({
    queryKey: payKeys.adjustments(unitId, period),
    queryFn: ({ signal }) =>
      listAdjustments(
        { unit: unitId === "" ? undefined : unitId, period },
        signal
      ),
    // Hidden until a unit is chosen, so it fetches nothing before that.
    enabled: unitId !== "",
  })
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
      setFailed(null)
      setAmount("")
      setReason("")
      setAdvanceId(null)
      setComponentCode("")
      void client.invalidateQueries({
        queryKey: payKeys.adjustments(unitId, period),
      })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawAdjustment(id, withdrawReason.trim()),
    onSuccess: () => {
      setFailed(null)
      setWithdrawReason("")
      void client.invalidateQueries({
        queryKey: payKeys.adjustments(unitId, period),
      })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>One-offs</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        <Field label="Unit" required>
          <PickOne
            label="Unit"
            placeholder="Choose a unit…"
            choices={units.map((one) => ({
              value: one.id,
              label: `${one.name} · ${one.employees}`,
            }))}
            value={unitId === "" ? null : unitId}
            onChange={(next) => {
              setUnitId(next ?? "")
              setEmployeeId("")
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

        {unitId !== "" && (
          <div>
            <SubHead>Filed</SubHead>
            <Field
              label="Why (taking one back)"
              hint="Recorded against the withdrawal, and required."
              required
            >
              <Input
                value={withdrawReason}
                onChange={(event) => setWithdrawReason(event.target.value)}
                placeholder="double filing"
              />
            </Field>
            <div className="mt-2">
              {queryState(rows, {
                loading: "Reading the one-offs…",
                render: (filed) =>
                  filed.length === 0 ? (
                    <EmptyState>
                      Nothing filed for this month. A one-off — an incentive, a
                      kasbon instalment — is filed here and decided by head
                      office with the batch.
                    </EmptyState>
                  ) : (
                    <MiniTable
                      head={[
                        "Who",
                        "Component",
                        { label: "Amount", align: "right" },
                        "",
                      ]}
                    >
                      {filed.map((row) => (
                        <MiniRow key={row.id}>
                          <MiniCell>
                            <span className="block text-[0.875rem] text-ink">
                              {row.full_name ?? row.employee_code}
                            </span>
                            <span className="font-mono text-[0.875rem] text-mute">
                              {row.employee_code}
                            </span>
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
                          <MiniCell align="right">
                            {money(row.amount_minor)}
                          </MiniCell>
                          <MiniCell align="right">
                            {row.withdrawable ? (
                              <Button
                                variant="danger"
                                pending={withdraw.isPending}
                                disabled={withdrawReason.trim() === ""}
                                onClick={() => withdraw.mutate(row.id)}
                              >
                                Take back
                              </Button>
                            ) : (
                              <span className="text-mute">in the batch</span>
                            )}
                          </MiniCell>
                        </MiniRow>
                      ))}
                    </MiniTable>
                  ),
              })}
            </div>
          </div>
        )}

        {unitId !== "" && (
          <OneOffImport
            unitId={unitId}
            period={period}
            people={team.data ?? []}
            components={(catalogue.data ?? []).filter(
              (component) =>
                component.basis === "PER_OCCASION" && !component.retired
            )}
            onFiled={() =>
              void client.invalidateQueries({
                queryKey: payKeys.adjustments(unitId, period),
              })
            }
          />
        )}

        <SubHead>File one</SubHead>
        <Field label="Who" required>
          <PickOne
            label="Who"
            placeholder="Choose a person…"
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
            placeholder="Choose a component…"
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
              placeholder="Not linked to an advance"
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
            placeholder="300000"
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
            placeholder="kasbon — cicilan 1 dari 3"
          />
        </Field>
        <div>
          <Button
            variant="primary"
            pending={file.isPending}
            disabled={
              unitId === "" ||
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
      </div>
    </Card>
  )
}
