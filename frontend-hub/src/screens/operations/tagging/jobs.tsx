import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Tags } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Progress } from "@/components/ui/progress"
import {
  RecordActions,
  RecordBody,
  RecordCard,
  RecordHead,
} from "@/components/ui/record-card"
import { MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  EmptyState,
  LoadingState,
  Problem,
  Receipt,
} from "@/components/ui/states"
import { dc } from "@/lib/api"
import { ago, count, day, label, toneFor } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useEdgeActor } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { idempotencyKey } from "@itulah/contract/client"
import type { TaggingWorkJob } from "@itulah/contract"

/// The tagging queue: jobs head office has sent that this warehouse has not
/// finished.
///
/// The EPCs on these screens arrived as **finished strings** minted at the
/// centre. Nothing here computes one and nothing reorders them — they are
/// printed in the order they were minted so the sequence on the rail matches
/// the sequence in the ledger.
///
/// Confirming a job is said once, for the whole job, by the person who
/// attached the labels. That is the moment a counted quantity becomes that
/// many individually tracked units and enters the warehouse — so it is behind
/// a question, not behind a button.
export function TaggingJobs() {
  const job = useSheet("job")

  const jobs = useQuery({
    queryKey: keys.taggingJobs(),
    queryFn: ({ signal }) => dc.taggingJobs(signal),
  })

  const rows = jobs.data ?? []
  const labels = rows.reduce((total, row) => total + row.total_quantity, 0)
  // Worked out rather than taken from the end of the list: the node does not
  // promise an order, and "oldest" read off `rows[rows.length - 1]` is a
  // number that is right until the day it silently is not.
  const oldest = rows.reduce<string | null>(
    (earliest, row) =>
      earliest === null || Date.parse(row.issued_at) < Date.parse(earliest)
        ? row.issued_at
        : earliest,
    null
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Tagging"
        title="Jobs"
        sub="Labels the centre has minted. Print them, attach them, then say so."
      />

      <KpiStrip className="grid-cols-2 xl:grid-cols-3">
        <Kpi label="Jobs waiting" value={count(rows.length)} />
        <Kpi label="Labels to print" value={count(labels)} />
        <Kpi
          label="Oldest"
          value={oldest === null ? "—" : ago(oldest)}
          delta="since the centre issued it"
        />
      </KpiStrip>

      {queryState(jobs, {
        loading: "Reading the print queue…",
        render: () =>
          rows.length === 0 ? (
            <Card>
              <EmptyState>
                Nothing to tag. Head office issues these when goods are
                accepted, so the queue fills itself.
              </EmptyState>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {rows.map((row) => (
                <JobCard
                  key={row.job_id}
                  job={row}
                  onOpen={() => job.open(row.job_id)}
                />
              ))}
            </div>
          ),
      })}

      <JobSheet id={job.value ?? null} onClose={job.close} />
    </PageContent>
  )
}

/// One job, with the state of its run read from the job rather than
/// remembered by this screen.
///
/// A job is given exactly one run and the server refuses a second — two runs
/// would be two tags carrying one identity. So the card asks *the job* which
/// run it has, and a handheld that slept, a reloaded tab and the person who
/// took over at the next bench all come back to the same half-finished batch.
function JobCard({ job, onOpen }: { job: TaggingWorkJob; onOpen: () => void }) {
  const run = useQuery({
    queryKey: keys.jobRun(job.job_id),
    queryFn: ({ signal }) => dc.jobPrintSession(job.job_id, signal),
  })

  const summary = run.data ?? null

  return (
    <RecordCard>
      <RecordHead
        tile={<Tags />}
        id={job.article_code}
        title={`${job.article_name} · issued ${day(job.issued_at)}`}
        status={
          summary === null ? (
            <Pill tone="neutral">Not queued</Pill>
          ) : (
            <Pill tone={toneFor(summary.status)}>{label(summary.status)}</Pill>
          )
        }
        onClick={onOpen}
      />
      <RecordBody>
        {summary === null ? (
          <p className="text-meta text-body">
            {count(job.total_quantity)} labels across {job.lines.length}{" "}
            variants. Nobody has queued this one yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <Progress
              label="Printed"
              value={summary.printed_count}
              of={summary.total_items}
              tone={
                summary.failed_count > 0
                  ? "warn"
                  : summary.pending_count === 0
                    ? "ok"
                    : "accent"
              }
            />
            <p className="text-[0.71875rem] text-mute">
              {count(summary.pending_count)} still to print
              {summary.failed_count > 0 &&
                ` · ${count(summary.failed_count)} the printer refused`}{" "}
              · {summary.printer_host}:{summary.printer_port}
            </p>
          </div>
        )}
      </RecordBody>
      <RecordActions>
        <AppLink
          to="/operations/tagging/bench"
          sheet={{ key: "job", value: job.job_id }}
          variant="soft"
        >
          {summary === null ? "Queue the labels" : "Open the bench"}
        </AppLink>
        <Button variant="quiet" onClick={onOpen}>
          What is in it
        </Button>
      </RecordActions>
    </RecordCard>
  )
}

/// The job's variants and the confirmation that ends it.
function JobSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const actor = useEdgeActor()
  const client = useQueryClient()

  const jobs = useQuery({
    queryKey: keys.taggingJobs(),
    queryFn: ({ signal }) => dc.taggingJobs(signal),
  })
  const job = (jobs.data ?? []).find((row) => row.job_id === id)

  const run = useQuery({
    queryKey: keys.jobRun(id ?? ""),
    queryFn: ({ signal }) => dc.jobPrintSession(id!, signal),
    enabled: id !== null,
  })

  const confirm = useMutation({
    mutationFn: () =>
      dc.confirmTagging({
        job_id: id!,
        actor_id: actor,
        // Confirming creates one tracked unit per label. Applied twice it is
        // twice the warehouse, and the second set has no garments behind it.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      // The job leaves the queue, the units appear in the pools, and the
      // ledger gains a movement group. All three are on screen somewhere.
      void client.invalidateQueries({ queryKey: keys.taggingJobs() })
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: ["inventory", "movements"] })
    },
  })

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={job?.article_code}
      title={job?.article_name ?? "Tagging job"}
    >
      {job === undefined ? (
        jobs.isPending ? (
          <LoadingState>Reading the print queue…</LoadingState>
        ) : (
          <EmptyState>
            That job is no longer in the queue — it has been confirmed, or the
            centre withdrew it.
          </EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Labels">{count(job.total_quantity)}</Fact>
            <Fact term="Variants">{count(job.lines.length)}</Fact>
            <Fact term="Issued">{day(job.issued_at)}</Fact>
            <Fact term="Printed">
              {run.data === null || run.data === undefined
                ? "not queued"
                : `${count(run.data.printed_count)} of ${count(run.data.total_items)}`}
            </Fact>
          </Facts>

          <div>
            <h4 className="mb-2 text-card-title font-semibold text-ink">
              Variants
            </h4>
            <MiniTable head={["SKU", "Colour", "Size", "Labels"]}>
              {job.lines.map((line) => (
                <tr key={line.sku_code} className="border-t border-hairline">
                  <td className="py-2 pr-2 font-mono text-[0.71875rem] text-ink">
                    {line.sku_code}
                  </td>
                  <td className="py-2 text-right">{line.colour_label}</td>
                  <td className="py-2 text-right">{line.size_label}</td>
                  <td className="py-2 text-right tabular-nums">
                    {count(line.quantity)}
                  </td>
                </tr>
              ))}
            </MiniTable>
          </div>

          {confirm.isSuccess && confirm.data && (
            <Receipt>
              {count(confirm.data.tagged_units)} pieces are now individually
              tracked and in this warehouse.
            </Receipt>
          )}
          <Problem error={confirm.error} />

          <div className="flex flex-wrap gap-2">
            <ConfirmButton
              label="The tags are on"
              title="Confirm this job is tagged"
              description={
                <>
                  This turns {count(job.total_quantity)} counted pieces into
                  that many individually tracked units, and puts them in the
                  warehouse. Say it once, for the whole job, when the labels are
                  physically attached — there is no way to take it back.
                </>
              }
              confirmLabel="They are on"
              variant="dark"
              pending={confirm.isPending}
              onConfirm={() => confirm.mutate()}
            />
            <AppLink
              to="/operations/tagging/bench"
              sheet={{ key: "job", value: job.job_id }}
              variant="ghost"
            >
              Print bench
            </AppLink>
          </div>
        </div>
      )}
    </Sheet>
  )
}
