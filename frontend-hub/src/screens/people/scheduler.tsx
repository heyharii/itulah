import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { moment } from "@/lib/format"
import {
  listSchedulerRuns,
  runSchedulerNow,
  schedulerKeys,
  type SchedulerJobResult,
  type SchedulerRunRow,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

/// What the clock does when nobody is looking.
///
/// Four jobs, and none of them is a screen elsewhere: the accrual a leave
/// policy has earned, the carry-forward a cap put a deadline on, next week's
/// roster carried from this week's plan, and the nudges. This screen is the
/// evidence half — the run ledger the worker writes — plus one deliberate
/// "run now", because a test or a backfill that cannot name its date is a
/// test nobody can reproduce.
///
/// # Why "run now" is not the worker
///
/// The worker calls the same `run_all` on its hourly tick (see
/// `bin/cloud.rs`). A claim ledger makes a second pass over the same month,
/// day or week a no-op rather than a double accrual; the button is a
/// reproducible door onto that same pass, not a second implementation.
export function Scheduler() {
  const client = useQueryClient()
  const [asOf, setAsOf] = useState("")
  const [reason, setReason] = useState("")

  const runs = useQuery({
    queryKey: schedulerKeys.runs(),
    queryFn: ({ signal }) => listSchedulerRuns(signal),
  })

  const run = useMutation({
    mutationFn: () => runSchedulerNow({ asOf, reason: reason.trim() }),
    onSuccess: () => {
      setReason("")
      void client.invalidateQueries({ queryKey: schedulerKeys.runs() })
    },
  })

  const results = run.data ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="People · Setup"
        title="Scheduler"
        sub="Akrual cuti, expiry carry-forward, roster minggu depan, dan pengingat — dijalankan oleh clock, bukan oleh orang."
      />

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Run the pass now</CardTitle>
        </CardHeader>
        <div className="flex flex-col gap-3 border-t border-hairline p-4">
          <Banner tone="info">
            Leave the date empty for today where the shops are. A date is a
            backfill or a test. The reason is written to the run ledger beside
            what each job did — the activity log keeps the request and not its
            body.
          </Banner>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Business day" hint="Optional: defaults to today.">
              <Day value={asOf} onChange={setAsOf} />
            </Field>
            <Field label="Why now" hint="Required, and recorded.">
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="backfill akrual September"
              />
            </Field>
          </div>
          <div>
            <Button
              variant="primary"
              disabled={reason.trim() === "" || run.isPending}
              onClick={() => run.mutate()}
            >
              Run the schedule
            </Button>
          </div>

          {run.error !== null && <Banner tone="bad">{run.error.message}</Banner>}
          {results.length > 0 && (
            <div>
              <SubHead>What this pass did</SubHead>
              <div className="divide-y">
                {results.map((result) => (
                  <JobResult key={result.job} result={result} />
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
          <span className="text-meta text-mute">Newest first, one row per worked period.</span>
        </CardHeader>
        {queryState(runs, {
          loading: "Reading the run ledger…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                Nothing has run yet. The worker ticks hourly; a month with no
                row here has not accrued, and a roster with no carry has not
                been planned.
              </EmptyState>
            ) : (
              <div className="divide-y">
                {(runs.data ?? []).map((row) => (
                  <RunRow key={`${row.job}:${row.run_key}`} row={row} />
                ))}
              </div>
            ),
        })}
      </Card>
    </PageContent>
  )
}

function outcomeTone(outcome: string) {
  switch (outcome) {
    case "RAN":
      return "ok" as const
    case "FAILED":
      return "bad" as const
    default:
      return "warn" as const
  }
}

function RunRow({ row }: { row: SchedulerRunRow }) {
  return (
    <div className="flex flex-wrap items-baseline gap-3 px-4 py-2.5">
      <span className="w-56 shrink-0 font-mono text-id text-body">{row.job}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-meta text-mute">
        {row.run_key}
      </span>
      <span className="text-meta text-mute">
        {moment(row.started_at)}
        {row.finished_at === null ? " · running" : ""}
      </span>
      <Pill tone={outcomeTone(row.outcome)}>{row.outcome}</Pill>
      <span className="w-full truncate font-mono text-meta text-mute">
        {summarise(row.detail)}
      </span>
    </div>
  )
}

function JobResult({ result }: { result: SchedulerJobResult }) {
  return (
    <div className="flex flex-wrap items-baseline gap-3 py-2">
      <span className="w-56 shrink-0 font-mono text-id text-body">{result.job}</span>
      <Pill tone={outcomeTone(result.status)}>{result.status}</Pill>
      <span className="min-w-0 flex-1 truncate font-mono text-meta text-mute">
        {summarise(result.detail)}
      </span>
    </div>
  )
}

/// One sentence for the reader, and never a bare JSON blob in the column.
function summarise(detail: unknown): string {
  if (detail === null || detail === undefined) return "—"
  if (typeof detail === "string") return detail
  if (typeof detail === "object") {
    const parts = Object.entries(detail as Record<string, unknown>)
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .map(([key, value]) => `${key}: ${String(value)}`)
    return parts.length === 0 ? "—" : parts.join(" · ")
  }
  return String(detail)
}
