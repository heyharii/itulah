import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query"

import { dc } from "@/lib/api"
import { usePrinter } from "@/lib/operations/printer"
import type { Printer } from "@/lib/operations/printer"
import { keys } from "@/lib/operations/keys"
import { useEdgeActor } from "@/lib/edge-session"
import { idempotencyKey } from "@itulah/contract/client"
import type { PrintSessionSummary, TaggingWorkJob } from "@itulah/contract"

/// Each job's run, read from the job. Keyed like the single reads so the
/// cache is shared with everything else that asks.
export function useRuns(jobs: readonly TaggingWorkJob[]) {
  const results = useQueries({
    queries: jobs.map((job) => ({
      queryKey: keys.jobRun(job.job_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        dc.jobPrintSession(job.job_id, signal),
    })),
  })
  const runs = new Map<string, PrintSessionSummary | null>()
  jobs.forEach((job, i) => {
    const data = results[i]?.data
    if (data !== undefined) runs.set(job.job_id, data)
  })
  return runs
}

/// Labels of a job already out of the machine.
export function printedOf(
  job: TaggingWorkJob,
  run: PrintSessionSummary | null | undefined
) {
  return run == null ? 0 : Math.min(run.printed_count, job.total_quantity)
}

/// Open (or resume) the job's run, follow the bench, and send chunks until
/// nothing is pending or a pass prints nothing. Books the units in when the run
/// finishes clean.
async function sendJob(
  job: TaggingWorkJob,
  existing: PrintSessionSummary | null,
  printer: Printer,
  actor: string
) {
  let session =
    existing ??
    (await dc.openPrintSession({
      job_id: job.job_id,
      printer_host: printer.host,
      printer_port: printer.port,
      label_width_mm: printer.widthMm,
      label_height_mm: printer.heightMm,
      label_offset_mm: printer.offsetMm,
      chunk_size: printer.chunk,
      darkness: printer.darkness,
      speed_ips: printer.speedIps,
      language: printer.language,
      actor_id: actor,
    }))
  const moved =
    session.printer_host !== printer.host ||
    session.printer_port !== printer.port ||
    session.label_width_mm !== printer.widthMm ||
    session.label_height_mm !== printer.heightMm
  if (moved) {
    session = await dc.repointPrintSession(session.session_id, {
      printer_host: printer.host,
      printer_port: printer.port,
      chunk_size: printer.chunk,
      label_width_mm: printer.widthMm,
      label_height_mm: printer.heightMm,
      label_offset_mm: printer.offsetMm,
      language: printer.language,
    })
  }
  return drain(job, session, actor)
}

async function drain(
  job: TaggingWorkJob,
  first: PrintSessionSummary,
  actor: string
) {
  let session = first
  while (session.pending_count > 0) {
    const report = await dc.runPrintChunk(session.session_id)
    session = report.session
    if (report.printed === 0) break
  }
  if (session.pending_count === 0 && session.failed_count === 0) {
    await dc.confirmTagging({
      job_id: job.job_id,
      actor_id: actor,
      // One tracked unit per label: applied twice it is twice the warehouse.
      idempotency_key: idempotencyKey(),
    })
  }
  return session
}

/// Print every job in `jobs` that still has labels to come.
export function usePrintJobs(
  jobs: readonly TaggingWorkJob[],
  runs: Map<string, PrintSessionSummary | null>
) {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const printer = usePrinter()
  return useMutation({
    mutationFn: async () => {
      for (const job of jobs) {
        const run = runs.get(job.job_id) ?? null
        if (run !== null && run.pending_count === 0) continue
        await sendJob(job, run, printer, actor)
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.taggingJobs() })
      void client.invalidateQueries({ queryKey: ["dc", "tagging-job"] })
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: ["inventory", "movements"] })
    },
  })
}

/// Put one SKU's labels back in the queue by their own EPCs and print them.
export function useReprintLine(
  job: TaggingWorkJob,
  run: PrintSessionSummary | null | undefined,
  epcs: readonly string[]
) {
  const client = useQueryClient()
  const printer = usePrinter()
  const actor = useEdgeActor()
  return useMutation({
    mutationFn: async () => {
      if (run == null) return
      const queued = await dc.reprintLabels(run.session_id, {
        epcs: [...epcs],
        from_seq: null,
        to_seq: null,
      })
      await sendJob(job, queued, printer, actor)
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.jobRun(job.job_id) })
      void client.invalidateQueries({ queryKey: keys.taggingJobs() })
    },
  })
}
