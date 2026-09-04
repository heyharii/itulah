import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Printer as PrinterIcon, Tags } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Progress } from "@/components/ui/progress"
import { KeyValue } from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState, Problem, Receipt } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { count, label, toneFor } from "@/lib/format"
import { savePrinter, TAG_PRESETS, usePrinter } from "@/lib/printer"
import { keys } from "@/lib/queries/keys"
import { queryState } from "@/lib/query-state"
import { useActor } from "@/lib/session"
import { useSheet } from "@/lib/sheets"

/// The print bench.
///
/// Three facts about a warehouse shape this screen, and each one is a bug that
/// was found by using it:
///
///  1. **A run belongs to the job, not to the tab.** The screen asks the job
///     which run it has (`GET tagging-jobs/{id}/print-session`) rather than
///     remembering one it opened, so a slept handheld comes back to a
///     half-finished batch instead of to a Queue button the server refuses.
///  2. **The printer is a fact about a bench.** It is kept on the device and
///     it changes when somebody walks to another machine — which is what
///     "repoint" is for. Without it the labels keep coming out where the run
///     started, and that is discovered by walking there.
///  3. **Reprints reuse the same EPCs, never fresh ones.** A tag destroyed
///     after it printed still belongs to a unit the ledger knows about, and a
///     second EPC for one garment reads downstream as a second garment.
export function PrintBench() {
  const job = useSheet("job")

  const jobs = useQuery({
    queryKey: keys.taggingJobs(),
    queryFn: ({ signal }) => dc.taggingJobs(signal),
  })

  const chosen = (jobs.data ?? []).find((row) => row.job_id === job.value)

  return (
    <PageContent>
      <PageHeader
        crumb="Tagging"
        title="Print bench"
        sub="Where the labels come out. One run per job, resumable from any bench."
      />

      <div className="grid gap-[1.125rem] xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="flex flex-col gap-[1.125rem]">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Which job</CardTitle>
              {chosen && (
                <span className="font-mono text-id text-body">
                  {chosen.article_code}
                </span>
              )}
            </CardHeader>
            <div className="border-t border-hairline">
              {queryState(jobs, {
                loading: "Reading the print queue…",
                render: (rows) =>
                  rows.length === 0 ? (
                    <EmptyState
                      action={
                        <AppLink to="/tagging" variant="soft">
                          Back to the queue
                        </AppLink>
                      }
                    >
                      Nothing to print. The centre issues tagging jobs when
                      goods are accepted.
                    </EmptyState>
                  ) : (
                    rows.map((row) => (
                      <button
                        key={row.job_id}
                        type="button"
                        onClick={() => job.open(row.job_id)}
                        className={`flex min-h-tap w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left transition-colors last:border-b-0 ${
                          row.job_id === job.value
                            ? "bg-accent-bg"
                            : "hover:bg-soft"
                        }`}
                      >
                        <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-body">
                          <Tags className="size-[0.9375rem]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-id text-ink">
                            {row.article_code}
                          </span>
                          <span className="block truncate text-[0.71875rem] text-mute">
                            {row.article_name}
                          </span>
                        </span>
                        <span className="shrink-0 text-[0.78125rem] text-body tabular-nums">
                          {count(row.total_quantity)}
                        </span>
                      </button>
                    ))
                  ),
              })}
            </div>
          </Card>

          {job.value === undefined ? (
            <Banner tone="info">
              Choose the job whose labels you are printing. The run it already
              has — if anybody queued it — is picked up rather than started
              again.
            </Banner>
          ) : (
            <>
              <Preview jobId={job.value} />
              <Run jobId={job.value} />
            </>
          )}
        </div>

        <PrinterCard />
      </div>
    </PageContent>
  )
}

/// What is about to come out of the printer.
///
/// Before this, the first sight of a hang tag was the tag itself, on stock
/// somebody had already loaded — so a tag size was two numbers typed into a
/// box and confirmed by walking to the machine and burning a ribbon. The
/// picture and the ZPL underneath it come out of one layout pass on the node
/// (`edge/zpl.rs`), so this is not a second rendering that has to be kept in
/// step with the printer's: it is the same label, described twice.
///
/// Drawn on the stock THIS bench says it is holding, not on the run's. Those
/// two disagree exactly when somebody has carried a run to a different bench,
/// and the run card below says so and offers to repoint it — which is the
/// honest order of events, because the reel in the machine is the fact and the
/// run's opinion of it is what needs correcting.
function Preview({ jobId }: { jobId: string }) {
  const printer = usePrinter()
  const [sku, setSku] = useState<string | undefined>(undefined)
  const [showing, setShowing] = useState<"tag" | "zpl">("tag")

  const jobs = useQuery({
    queryKey: keys.taggingJobs(),
    queryFn: ({ signal }) => dc.taggingJobs(signal),
  })
  const lines = (jobs.data ?? []).find((row) => row.job_id === jobId)?.lines ?? []

  const preview = useQuery({
    // The language is part of the key: switching it must redraw the machine's
    // copy, not serve the other printer's from cache.
    queryKey: keys.labelPreview(
      jobId,
      printer.widthMm,
      printer.heightMm,
      printer.offsetMm,
      sku,
      printer.language
    ),
    queryFn: ({ signal }) =>
      dc.previewJobLabel(
        jobId,
        {
          label_width_mm: printer.widthMm,
          label_height_mm: printer.heightMm,
          label_offset_mm: printer.offsetMm,
          sku_code: sku ?? null,
          language: printer.language,
        },
        signal
      ),
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>What comes out</CardTitle>
        <Segmented
          value={showing}
          onChange={setShowing}
          options={[
            { value: "tag", label: "Tag" },
            // Named for what is actually in the panel. A tab that says ZPL
            // over a TSPL job teaches the bench to trust the wrong word.
            { value: "zpl", label: printer.language },
          ]}
        />
      </CardHeader>

      <div className="flex flex-col gap-3 border-t border-hairline px-4 py-3.5">
        {lines.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {lines.map((line) => {
              const chosen = (sku ?? lines[0]?.sku_code) === line.sku_code
              return (
                <button
                  key={line.sku_code}
                  type="button"
                  onClick={() => setSku(line.sku_code)}
                  aria-pressed={chosen}
                  className={`min-h-[1.875rem] rounded-full px-2.5 text-[0.71875rem] transition-colors ${
                    chosen
                      ? "bg-ink text-canvas"
                      : "bg-soft-2 text-body hover:bg-soft-3"
                  }`}
                >
                  {line.colour_label} · {line.size_label}
                </button>
              )
            })}
          </div>
        )}

        {queryState(preview, {
          loading: "Drawing the label…",
          render: (drawn) => (
            <>
              {showing === "tag" ? (
                /* The node's own SVG, escaped there for exactly this: an
                   article name is operator-supplied text and it is drawn into
                   a document the browser parses. */
                <div
                  /* The node sends a `viewBox` and no size, so the tag keeps
                     its true proportions and this decides how big the picture
                     is. Without the child rules an SVG with no width lands on
                     the browser's 300 × 150 default and the tag comes out the
                     wrong shape. */
                  className="rounded-inner bg-soft-2 p-4 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full [&>svg]:rounded-[0.125rem] [&>svg]:shadow-soft"
                  dangerouslySetInnerHTML={{ __html: drawn.svg }}
                />
              ) : (
                <pre className="max-h-[19rem] overflow-auto rounded-inner bg-soft-2 p-3 font-mono text-[0.6875rem] leading-[1.5] text-body">
                  {drawn.zpl}
                </pre>
              )}

              <div>
                <KeyValue term="Tag">
                  {drawn.label_width_mm} × {drawn.label_height_mm} mm
                </KeyValue>
                <KeyValue term="Writes">
                  {drawn.epc === "" ? (
                    <span className="text-mute">
                      no tag yet — the centre has not sent the EPCs
                    </span>
                  ) : (
                    <span className="font-mono text-id">{drawn.epc}</span>
                  )}
                </KeyValue>
              </div>

              <p className="text-[0.71875rem] text-mute">
                {drawn.source === "SESSION"
                  ? "The next label this run has left to print, drawn from the words it froze when it was queued."
                  : "Drawn from the job as it stands now. Queueing freezes these words, so a reprint six weeks from now reproduces this tag and not today's catalogue."}{" "}
                The bars are shown as the space they will occupy, at true width
                — the printer encodes them, not this screen.
              </p>
            </>
          ),
        })}
      </div>
    </Card>
  )
}

/// The run this job has, or the button that opens the only one it will ever
/// get.
function Run({ jobId }: { jobId: string }) {
  const actor = useActor()
  const client = useQueryClient()
  const printer = usePrinter()
  const runKey = useSheet("run")

  const existing = useQuery({
    queryKey: keys.jobRun(jobId),
    queryFn: ({ signal }) => dc.jobPrintSession(jobId, signal),
  })

  const sessionId = existing.data?.session_id ?? null

  /// Kept in step with the URL so a supervisor can be sent the run itself, and
  /// so a reload lands on the same one. The job is the source of truth; this
  /// is the shareable name for it.
  const summary = useQuery({
    queryKey: keys.run(sessionId ?? runKey.value ?? ""),
    queryFn: ({ signal }) =>
      dc.printSession((sessionId ?? runKey.value)!, signal),
    enabled: sessionId !== null || runKey.value !== undefined,
  })

  const open = useMutation({
    mutationFn: () =>
      dc.openPrintSession({
        job_id: jobId,
        printer_host: printer.host,
        printer_port: printer.port,
        label_width_mm: printer.widthMm,
        label_height_mm: printer.heightMm,
        label_offset_mm: printer.offsetMm,
        chunk_size: printer.chunk,
        language: printer.language,
        actor_id: actor,
      }),
    onSuccess: (opened) => {
      runKey.replace(opened.session_id)
      void client.invalidateQueries({ queryKey: keys.jobRun(jobId) })
    },
  })

  const chunk = useMutation({
    mutationFn: () => dc.runPrintChunk(sessionId!),
    onSuccess: () => {
      // The run's counts moved, and the job card on the queue screen draws
      // its meter from the same read.
      void client.invalidateQueries({ queryKey: keys.jobRun(jobId) })
      void client.invalidateQueries({ queryKey: keys.run(sessionId!) })
    },
  })

  const repoint = useMutation({
    mutationFn: () =>
      dc.repointPrintSession(sessionId!, {
        printer_host: printer.host,
        printer_port: printer.port,
        chunk_size: printer.chunk,
        label_width_mm: printer.widthMm,
        label_height_mm: printer.heightMm,
        language: printer.language,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.jobRun(jobId) })
      void client.invalidateQueries({ queryKey: keys.run(sessionId!) })
    },
  })

  const state = summary.data ?? existing.data ?? null

  if (existing.isPending) {
    return (
      <Card>
        <EmptyState>Asking the job whether it has a run…</EmptyState>
      </Card>
    )
  }

  if (state === null) {
    return (
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>No run yet</CardTitle>
        </CardHeader>
        <div className="flex flex-col gap-3 border-t border-hairline px-4 py-3.5">
          <p className="text-meta text-body">
            Queueing the labels opens the one run this job will ever get. It
            will print to {printer.host}:{printer.port} on {printer.widthMm}×
            {printer.heightMm} mm tags, {printer.chunk} at a time — change that
            on the right before you start, or repoint the run afterwards.
          </p>
          <Button
            variant="dark"
            disabled={open.isPending}
            onClick={() => open.mutate()}
          >
            {open.isPending ? "Queueing…" : "Queue the labels"}
          </Button>
          <Problem error={open.error} />
        </div>
      </Card>
    )
  }

  const elsewhere =
    state.printer_host !== printer.host || state.printer_port !== printer.port
  /// The same discrepancy as `elsewhere`, one axis over. A run opened at
  /// another bench carries that bench's tag, and until the stock could be
  /// repointed the only way to notice was to watch the first label come out
  /// the wrong size.
  const otherStock =
    state.label_width_mm !== printer.widthMm ||
    state.label_height_mm !== printer.heightMm

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>The run</CardTitle>
          <Pill tone={toneFor(state.status)}>{label(state.status)}</Pill>
        </CardHeader>
        <div className="flex flex-col gap-3.5 border-t border-hairline px-4 py-3.5">
          <Progress
            label="Printed"
            value={state.printed_count}
            of={state.total_items}
            tone={
              state.failed_count > 0
                ? "warn"
                : state.pending_count === 0
                  ? "ok"
                  : "accent"
            }
          />

          <div>
            <KeyValue term="Still to print">
              {count(state.pending_count)}
            </KeyValue>
            <KeyValue term="Refused by the printer">
              {count(state.failed_count)}
            </KeyValue>
            <KeyValue term="Labels per pass">
              {count(state.chunk_size)}
            </KeyValue>
            <KeyValue term="Coming out at">
              {state.printer_host}:{state.printer_port}
            </KeyValue>
            <KeyValue term="Drawn for">
              {state.label_width_mm} × {state.label_height_mm} mm
            </KeyValue>
          </div>

          {elsewhere && (
            <Banner tone="warn">
              This run prints at {state.printer_host}:{state.printer_port}, and
              this bench is set to {printer.host}:{printer.port}. Repoint it
              before you press print, or the labels come out in another room.
            </Banner>
          )}

          {otherStock && (
            <Banner tone="warn">
              This run is drawn for {state.label_width_mm} ×{" "}
              {state.label_height_mm} mm tags, and this bench is set to{" "}
              {printer.widthMm} × {printer.heightMm} mm. Repoint it, or the
              labels come out laid out for a tag that is not in the machine.
            </Banner>
          )}

          {chunk.isSuccess && chunk.data && (
            <Receipt>
              {count(chunk.data.printed)} of {count(chunk.data.attempted)}{" "}
              labels went to the printer
              {chunk.data.failed > 0 &&
                ` · ${count(chunk.data.failed)} came back and will be tried again`}
              .
            </Receipt>
          )}
          <Problem error={chunk.error ?? repoint.error} />

          <div className="flex flex-wrap gap-2">
            <Button
              variant="dark"
              disabled={chunk.isPending || state.pending_count === 0}
              onClick={() => chunk.mutate()}
            >
              {chunk.isPending
                ? "Printing…"
                : state.pending_count === 0
                  ? "Nothing left to print"
                  : `Print the next ${count(Math.min(state.chunk_size, state.pending_count))}`}
            </Button>
            <Button
              variant="ghost"
              disabled={repoint.isPending}
              onClick={() => repoint.mutate()}
            >
              <PrinterIcon />
              {otherStock ? "Use this bench and its tags" : "Print at this bench"}
            </Button>
          </div>
        </div>
      </Card>

      <Reprint sessionId={state.session_id} jobId={jobId} />
    </>
  )
}

/// Putting labels that already printed back in the queue.
///
/// Two ways to name them, because the tag is in two states when this is
/// needed. A tag whose print smeared still reads: the chip gives the EPC, and
/// that is the exact label to redo. A tag the jam destroyed reads nothing, and
/// all anybody has is where it sat in the run — "it ate three hundred and
/// thirty-eight to three hundred and forty-one".
function Reprint({ sessionId, jobId }: { sessionId: string; jobId: string }) {
  const client = useQueryClient()
  const [how, setHow] = useState<"tags" | "range">("tags")
  const [epcs, setEpcs] = useState<string[]>([])

  const reprint = useMutation({
    mutationFn: (input: {
      epcs: string[]
      from: number | null
      to: number | null
    }) =>
      dc.reprintLabels(sessionId, {
        epcs: input.epcs,
        from_seq: input.from,
        to_seq: input.to,
      }),
    onSuccess: () => {
      setEpcs([])
      form.reset()
      void client.invalidateQueries({ queryKey: keys.jobRun(jobId) })
      void client.invalidateQueries({ queryKey: keys.run(sessionId) })
    },
  })

  const form = useForm({
    defaultValues: { epc: "", from: "", to: "" },
    onSubmit: () => undefined,
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Reprint</CardTitle>
        <Segmented
          value={how}
          onChange={setHow}
          options={[
            { value: "tags", label: "By tag" },
            { value: "range", label: "By position" },
          ]}
        />
      </CardHeader>

      <div className="flex flex-col gap-3 border-t border-hairline px-4 py-3.5">
        <p className="text-[0.71875rem] text-mute">
          The same EPCs go back in the queue, never fresh ones — a second EPC
          for one garment reads downstream as a second garment.
        </p>

        {how === "tags" ? (
          <>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                const value = form.state.values.epc.trim().toUpperCase()
                if (value === "" || epcs.includes(value)) return
                setEpcs((current) => [...current, value])
                form.setFieldValue("epc", "")
              }}
            >
              <form.Field name="epc">
                {(field) => (
                  <Input
                    className="flex-1 font-mono"
                    placeholder="Scan a smeared tag"
                    autoCapitalize="off"
                    autoCorrect="off"
                    aria-label="EPC to reprint"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
              </form.Field>
              <Button type="submit" variant="soft">
                Add
              </Button>
            </form>

            {epcs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {epcs.map((epc) => (
                  <button
                    key={epc}
                    type="button"
                    onClick={() =>
                      setEpcs((current) =>
                        current.filter((other) => other !== epc)
                      )
                    }
                    className="rounded-full bg-soft-2 px-2.5 py-1 font-mono text-[0.6875rem] text-body transition-colors hover:bg-bad-bg hover:text-bad-fg"
                  >
                    {epc}
                  </button>
                ))}
              </div>
            )}

            <Button
              variant="dark"
              disabled={epcs.length === 0 || reprint.isPending}
              onClick={() => reprint.mutate({ epcs, from: null, to: null })}
            >
              Reprint {count(epcs.length)} tags
            </Button>
          </>
        ) : (
          <>
            <div className="flex gap-3">
              <form.Field name="from">
                {(field) => (
                  <Field label="From" className="flex-1">
                    <Input
                      inputMode="numeric"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="to">
                {(field) => (
                  <Field label="To" hint="Inclusive" className="flex-1">
                    <Input
                      inputMode="numeric"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  </Field>
                )}
              </form.Field>
            </div>
            {/* Subscribed rather than read straight off `form.state`: a plain
                read does not re-render, so the button would stay disabled
                after the two numbers were typed. */}
            <form.Subscribe selector={(state) => state.values}>
              {(values) => (
                <Button
                  variant="dark"
                  disabled={
                    reprint.isPending ||
                    values.from.trim() === "" ||
                    values.to.trim() === ""
                  }
                  onClick={() =>
                    reprint.mutate({
                      epcs: [],
                      from: Number(values.from),
                      to: Number(values.to),
                    })
                  }
                >
                  Reprint that stretch
                </Button>
              )}
            </form.Subscribe>
          </>
        )}

        {reprint.isSuccess && reprint.data && (
          <Receipt>
            Back in the queue. {count(reprint.data.pending_count)} labels are
            now pending.
          </Receipt>
        )}
        <Problem error={reprint.error} />
      </div>
    </Card>
  )
}

/// Which machine is in front of this person.
///
/// Saved on every change rather than behind a Save button, because there is no
/// submit: walking to another bench is how this changes, and nobody would
/// press "save printer" first.
function PrinterCard() {
  const printer = usePrinter()

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>This bench</CardTitle>
        <span className="text-[0.75rem] text-mute">kept on the device</span>
      </CardHeader>
      <div className="flex flex-col gap-3 border-t border-hairline px-4 py-3.5">
        <Field label="Printer host">
          <Input
            className="font-mono"
            value={printer.host}
            onChange={(event) =>
              savePrinter({ ...printer, host: event.target.value })
            }
          />
        </Field>
        {/* Not a preference. A machine that is handed the wrong language
            prints nothing at all — which on a bay is indistinguishable from a
            printer that is switched off, and is discovered by walking to it. */}
        <Field label="Language">
          <Segmented
            value={printer.language}
            onChange={(language) => savePrinter({ ...printer, language })}
            options={[
              { value: "ZPL", label: "ZPL" },
              { value: "TSPL", label: "TSPL" },
            ]}
          />
        </Field>
        <div className="flex gap-3">
          <Field label="Port" className="flex-1">
            <Input
              inputMode="numeric"
              value={String(printer.port)}
              onChange={(event) =>
                savePrinter({
                  ...printer,
                  port: Number(event.target.value) || 0,
                })
              }
            />
          </Field>
          <Field label="Per pass" className="flex-1">
            <Input
              inputMode="numeric"
              value={String(printer.chunk)}
              onChange={(event) =>
                savePrinter({
                  ...printer,
                  chunk: Number(event.target.value) || 1,
                })
              }
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TAG_PRESETS.map((preset) => {
            const chosen =
              preset.widthMm === printer.widthMm &&
              preset.heightMm === printer.heightMm
            return (
              <button
                key={`${preset.widthMm}x${preset.heightMm}`}
                type="button"
                aria-pressed={chosen}
                onClick={() =>
                  savePrinter({
                    ...printer,
                    widthMm: preset.widthMm,
                    heightMm: preset.heightMm,
                  })
                }
                title={preset.note}
                className={`min-h-[1.875rem] rounded-full px-2.5 text-[0.71875rem] tabular-nums transition-colors ${
                  chosen
                    ? "bg-ink text-canvas"
                    : "bg-soft-2 text-body hover:bg-soft-3"
                }`}
              >
                {preset.widthMm}×{preset.heightMm}
              </button>
            )
          })}
        </div>
        <div className="flex gap-3">
          <Field label="Tag width" hint="mm" className="flex-1">
            <Input
              inputMode="numeric"
              value={String(printer.widthMm)}
              onChange={(event) =>
                savePrinter({
                  ...printer,
                  widthMm: Number(event.target.value) || 0,
                })
              }
            />
          </Field>
          <Field label="Tag height" hint="mm" className="flex-1">
            <Input
              inputMode="numeric"
              value={String(printer.heightMm)}
              onChange={(event) =>
                savePrinter({
                  ...printer,
                  heightMm: Number(event.target.value) || 0,
                })
              }
            />
          </Field>
          {/* Not part of the tag size, which is why it is not one of the
              presets: two benches on the same 50 × 30 stock can hold reels
              whose tags start at different insets. Wrong here, the tag prints
              with its left column on the liner and looks like a layout fault
              nobody can find. The picture on the left is what says it is
              right. */}
          <Field label="Left inset" hint="mm" className="flex-1">
            <Input
              inputMode="numeric"
              value={String(printer.offsetMm)}
              onChange={(event) =>
                savePrinter({
                  ...printer,
                  offsetMm: Number(event.target.value) || 0,
                })
              }
            />
          </Field>
        </div>
        <p className="text-[0.71875rem] text-mute">
          58 × 40 mm is the tag the label layout was tuned against by hand, and
          what the node assumes when a run leaves it out. Other sizes scale from
          it — the ones above are starting points, not a list of what this
          warehouse stocks, and anything can be typed. What the tag actually
          looks like at a given size is the picture on the left.
        </p>
      </div>
    </Card>
  )
}
