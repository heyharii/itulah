import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
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
import { money, moment } from "@/lib/format"
import { PickOne } from "@/components/ui/pick"
import {
  listRuns,
  openRun,
  payKeys,
  runReconciliation,
  runSlips,
  runStateLabel,
  stepRun,
  usePlaces,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import type { PayrollRunView } from "@itulah/contract"

/// Payroll runs — head office only, and two people sign each one.
///
/// # The buttons are not the control
///
/// The server refuses an approval by the person who verified, and the refusal
/// is a conflict rather than a bad request: the payload is fine and what is
/// wrong is who is sending it. This screen hides the approve button from the
/// verifier because offering an action that will be refused is a lie, not
/// because hiding it enforces anything.
///
/// # Read `incomplete_because` before reading a figure
///
/// A run says what it does not know, and today it always does: there is no
/// punch source, so nothing here knows what was worked. The banner is at the
/// top of the sheet for that reason — a total somebody reads before the caveat
/// is a total they remember.
///
/// # No net, anywhere
///
/// Nothing computes tax or BPJS. A slip is the agreement in force plus the
/// facts recorded, and the column that would hold a deduction does not exist.

function stateTone(state: string) {
  switch (state) {
    case "SEALED":
      return "ok" as const
    case "APPROVED":
      return "info" as const
    default:
      return "warn" as const
  }
}

/// A unit's name, or its id when the list has not arrived. Never a bare id
/// once it has: `store-07` is a primary key, and the list beside it says
/// `Store 07`.
function unitName(
  places: readonly { readonly id: string; readonly name: string }[],
  id: string
): string {
  return places.find((one) => one.id === id)?.name ?? id
}

export function PayrollRuns() {
  const run = useSheet("payrollRun")
  const units = usePlaces()
  const places = units.data ?? []
  const runs = useQuery({
    queryKey: payKeys.runs(),
    queryFn: ({ signal }) => listRuns(signal),
  })
  const rows = runs.data ?? []
  const open = rows.find((row) => row.id === run.value) ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="People · Pay"
        title="Payroll runs"
        sub="One place, one month, and the two people who sign it."
      />

      <Banner tone="warn" className="mb-4">
        No punch source is connected, so a run knows what was planned and what
        was decided — never what was worked. Tax and BPJS are not calculated
        here either.
      </Banner>

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
                      {unitName(places, row.place_id)}
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

  const step = useMutation({
    mutationFn: (which: "verify" | "approve" | "seal" | "reopen") => {
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

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={run.id}
      title={`${run.place_id} · ${run.period}`}
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
        <Fact term="Unit">{run.place_id}</Fact>
        <Fact term="Month">{run.period}</Fact>
        <Fact term="Checked by">{run.verified_by ?? "nobody yet"}</Fact>
      </Facts>

      {reconciliation.data !== undefined && (
        <div className="mt-4">
          <SubHead>What it adds up to</SubHead>
          <KeyValue term="Slips">{reconciliation.data.slips}</KeyValue>
          <KeyValue term="Base">
            {money(reconciliation.data.base_total_minor)}
          </KeyValue>
          <KeyValue term="Base plus fixed allowances">
            {money(reconciliation.data.statutory_base_total_minor)}
          </KeyValue>
          <KeyValue term="Leave taken">
            {reconciliation.data.leave_days_total} days
          </KeyValue>
          {/* Both of these are blockers a person can act on, so they are
              stated rather than left to be inferred from a slip list. */}
          <KeyValue term="Cannot be paid">
            {reconciliation.data.unpayable} · no account on record
          </KeyValue>
          <KeyValue term="No pay agreement">
            {reconciliation.data.without_agreement} · not on this run
          </KeyValue>
        </div>
      )}

      {(slips.data ?? []).length > 0 && (
        <div className="mt-4">
          <SubHead>Slips</SubHead>
          <MiniTable
            head={["Who", { label: "Base", align: "right" }, "With allowances"]}
          >
            {(slips.data ?? []).map((slip) => (
              <MiniRow key={slip.employee_id}>
                <MiniCell>
                  <span className="block text-[0.8125rem] text-ink">
                    {slip.full_name ?? slip.employee_code}
                  </span>
                  <span className="font-mono text-[0.65625rem] text-mute">
                    {slip.bank_account_masked ?? "no account"}
                  </span>
                </MiniCell>
                <MiniCell align="right">{money(slip.base_minor)}</MiniCell>
                <MiniCell align="right">
                  {money(slip.statutory_base_minor)}
                </MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
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

      {run.state !== "SEALED" && (
        <div className="mt-4 flex flex-col gap-3">
          <Field label="Why" hint="Recorded against the step, and required.">
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="angka sudah dicek"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {run.state === "DRAFT" && (
              <Button
                variant="primary"
                disabled={!ready}
                onClick={() => step.mutate("verify")}
              >
                Check the figures
              </Button>
            )}
            {run.state === "VERIFIED" && (
              // Offered to everybody, refused by the server for the person who
              // verified. The screen cannot know who is looking at it, and
              // guessing would hide the button from the wrong person.
              <Button
                variant="primary"
                disabled={!ready}
                onClick={() => step.mutate("approve")}
              >
                Approve
              </Button>
            )}
            {run.state === "APPROVED" && (
              <Button
                variant="primary"
                disabled={!ready}
                onClick={() => step.mutate("seal")}
              >
                Seal
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
      )}

      {run.state === "SEALED" && (
        <p className="mt-4 text-meta text-mute">
          Sealed. The figures do not move again — a seal that could be undone
          would not be one.
        </p>
      )}
    </Sheet>
  )
}

function OpenRun() {
  const client = useQueryClient()
  const units = usePlaces()
  const places = units.data ?? []
  const [placeId, setPlaceId] = useState("")
  const [period, setPeriod] = useState(() =>
    new Date().toISOString().slice(0, 7)
  )
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const open = useMutation({
    mutationFn: () => openRun(placeId.trim(), period, reason.trim()),
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
          The month's attendance has to be closed first. While it is open the
          facts are still moving, and a run built over moving facts disagrees
          with itself an hour later.
        </Banner>
        {/* Chosen, never typed. It asked for an `org_place` id in a text box
            and named three of them in the hint, which is a screen asking
            somebody to remember a primary key — and one typo away from a 404
            that reads as "there is no payroll for your shop". */}
        <Field label="Unit">
          <PickOne
            label="Unit"
            placeholder="Choose a unit…"
            choices={places.map((one) => ({
              value: one.id,
              label: `${one.name} · ${one.employees}`,
            }))}
            value={placeId === "" ? null : placeId}
            onChange={(next) => setPlaceId(next ?? "")}
          />
        </Field>
        <Field label="Month">
          <Input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </Field>
        <Field label="Why" hint="Recorded against the run.">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="penggajian April"
          />
        </Field>
        <div>
          <Button
            variant="primary"
            disabled={
              placeId.trim() === "" ||
              period === "" ||
              reason.trim() === "" ||
              open.isPending
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
