import { useState } from "react"

import {
  ConfirmButton,
  Panel,
  Problem,
  Row,
  RowNumber,
  RowText,
} from "@/components/ops/parts"
import { useAction } from "@/lib/action"
import { Note, Pill, ScreenBody, ScreenHeader, ScreenState } from "@/components/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { dc } from "@/lib/api"
import { clock, units } from "@/lib/format"
import { loadPrinter, savePrinter, type Printer } from "@/lib/printer"
import { keys } from "@/lib/queries"
import { useActor } from "@/lib/session"
import { idempotencyKey } from "@itulah/contract/client"
import type { PrintSessionSummary, TaggingWorkJob } from "@itulah/contract"
import { useQuery, useQueryClient } from "@tanstack/react-query"

/// Tagging: labels the centre has already minted, printed here and then
/// declared to be on the goods.
///
/// The EPCs on this screen arrived as finished strings. Nothing in the
/// warehouse computes one, and nothing here reorders them — they are printed
/// in the order they were minted so that the sequence on the rail matches the
/// sequence in the ledger.
export function TaggingScreen() {
  const [jobId, setJobId] = useState<string | null>(null)

  const jobs = useQuery({
    queryKey: keys.taggingJobs(),
    queryFn: ({ signal }) => dc.taggingJobs(signal),
  })

  const selected = jobs.data?.find((job) => job.job_id === jobId) ?? null

  return (
    <>
      <ScreenHeader
        title="Tagging"
        subtitle="Print what head office minted, then say the tags are on"
      />
      <ScreenBody className="lg:grid lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
        <Panel title="Print queue" meta={`${jobs.data?.length ?? 0} jobs`}>
          {jobs.isPending && <ScreenState>Reading the queue…</ScreenState>}
          {jobs.isError && (
            <ScreenState tone="problem">{(jobs.error as Error).message}</ScreenState>
          )}
          {jobs.data?.length === 0 && (
            <ScreenState>
              Nothing to print. Jobs appear here when head office issues labels
              for goods this DC has accepted.
            </ScreenState>
          )}
          {jobs.data?.map((job) => (
            <Row
              key={job.job_id}
              selected={job.job_id === jobId}
              onClick={() => setJobId(job.job_id)}
            >
              <RowText code={job.article_code}>
                {job.article_name} · issued {clock(job.issued_at)}
              </RowText>
              <RowNumber value={units(job.total_quantity)} label="labels" />
            </Row>
          ))}
        </Panel>

        {selected === null ? (
          <Panel title="Job">
            <ScreenState>Choose a job to print.</ScreenState>
          </Panel>
        ) : (
          <JobDetail job={selected} />
        )}
      </ScreenBody>
    </>
  )
}

function JobDetail({ job }: { job: TaggingWorkJob }) {
  const actor = useActor()
  const client = useQueryClient()
  const action = useAction()
  const [printer, setPrinter] = useState<Printer>(loadPrinter)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [report, setReport] = useState<string | null>(null)

  // Polled while a run is open: the printer is a physical machine and a chunk
  // it refused is not visible from here any other way.
  const session = useQuery({
    queryKey: keys.printSession(sessionId ?? ""),
    queryFn: ({ signal }) => dc.printSession(sessionId as string, signal),
    enabled: sessionId !== null,
    refetchInterval: 4000,
  })

  const remember = (next: Printer) => {
    setPrinter(next)
    savePrinter(next)
  }

  const startPrinting = () =>
    void action.run(async () => {
      const opened = await dc.openPrintSession({
        job_id: job.job_id,
        printer_host: printer.host,
        printer_port: printer.port,
        label_width_mm: printer.widthMm,
        label_height_mm: printer.heightMm,
        chunk_size: printer.chunk,
        actor_id: actor,
      })
      setSessionId(opened.session_id)
      setReport(null)
    })

  const runChunk = () =>
    void action.run(async () => {
      if (sessionId === null) {
        return
      }
      const chunk = await dc.runPrintChunk(sessionId)
      setReport(
        `${chunk.printed} printed, ${chunk.failed} refused of ${chunk.attempted} attempted`,
      )
      void client.invalidateQueries({ queryKey: keys.printSession(sessionId) })
    })

  const confirm = () =>
    void action.run(async () => {
      await dc.confirmTagging({
        job_id: job.job_id,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      })
      setSessionId(null)
      setReport(null)
      void client.invalidateQueries({ queryKey: ["dc"] })
    })

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={job.article_name}
        meta={`${units(job.total_quantity)} labels · ${job.lines.length} variants`}
      >
        {job.lines.map((line) => (
          <Row key={line.sku_code}>
            <RowText code={line.sku_code}>
              {line.colour_label} · {line.size_label}
            </RowText>
            <RowNumber value={units(line.quantity)} label="labels" />
          </Row>
        ))}
      </Panel>

      <Panel
        title="Printer"
        meta={
          session.data === undefined ? (
            "not started"
          ) : (
            <Pill tone={session.data.pending_count === 0 ? "good" : "warn"}>
              {session.data.status.toLowerCase()}
            </Pill>
          )
        }
      >
        <div className="flex flex-wrap gap-2 px-4 py-3">
          <Input
            value={printer.host}
            placeholder="Printer host"
            className="h-(--tap) min-w-40 flex-1 font-mono"
            onChange={(event) => remember({ ...printer, host: event.target.value })}
          />
          <Input
            value={String(printer.port)}
            inputMode="numeric"
            className="h-(--tap) w-24 font-mono"
            onChange={(event) =>
              remember({ ...printer, port: Number(event.target.value) })
            }
          />
          <Input
            value={String(printer.chunk)}
            inputMode="numeric"
            className="h-(--tap) w-24 font-mono"
            aria-label="Labels per pass"
            onChange={(event) =>
              remember({ ...printer, chunk: Number(event.target.value) })
            }
          />
        </div>

        {sessionId === null ? (
          <div className="border-t px-4 py-3">
            <Button
              className="h-(--tap) w-full"
              disabled={action.pending}
              onClick={startPrinting}
            >
              Queue {units(job.total_quantity)} labels
            </Button>
          </div>
        ) : (
          <>
            <PrintProgress summary={session.data ?? null} />
            <div className="flex flex-wrap gap-2 border-t px-4 py-3">
              <Button
                className="h-(--tap) flex-1"
                disabled={action.pending || (session.data?.pending_count ?? 0) === 0}
                onClick={runChunk}
              >
                Print next pass
              </Button>
              <Button
                variant="ghost"
                className="h-(--tap)"
                onClick={() => setSessionId(null)}
              >
                Leave it
              </Button>
            </div>
            {report !== null && (
              <p className="text-muted-foreground px-4 pb-3 text-xs">{report}</p>
            )}
          </>
        )}
        <Problem error={action.error} />
      </Panel>

      <Panel title="The tags are on the goods">
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-muted-foreground text-xs">
            One confirmation for the whole job, given by the person who attached
            them.
          </p>
          <ConfirmButton
            label={`Confirm ${units(job.total_quantity)} units tagged`}
            className="h-(--tap)"
            disabled={action.pending}
            title="Confirm the tags are attached"
            description={
              <>
                At this moment {units(job.total_quantity)} counted pieces become
                that many individually tracked units, and they enter the
                warehouse. Say it only once they are physically on the goods.
              </>
            }
            confirmLabel="They are on"
            onConfirm={confirm}
          />
        </div>
      </Panel>

      <Note>
        The EPCs on this job were minted at the centre and arrived as finished
        strings. The warehouse prints them; nothing here computes one, which is
        why a label that will not print is a printer problem and never a
        numbering problem.
      </Note>
    </div>
  )
}

function PrintProgress({ summary }: { summary: PrintSessionSummary | null }) {
  if (summary === null) {
    return <ScreenState>Opening the run…</ScreenState>
  }
  const done = summary.total_items - summary.pending_count
  const share = summary.total_items === 0 ? 0 : done / summary.total_items
  return (
    <div className="flex flex-col gap-2 border-t px-4 py-3">
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full transition-[width]"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] tabular-nums">
        <span>{units(summary.printed_count)} printed</span>
        <span className="text-muted-foreground">
          {units(summary.pending_count)} pending
        </span>
        {summary.failed_count > 0 && (
          <span className="text-destructive">
            {units(summary.failed_count)} refused — they come round again
          </span>
        )}
      </div>
    </div>
  )
}
