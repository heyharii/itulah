import { Collapsible } from "@base-ui/react/collapsible"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, Printer as PrinterIcon, RotateCcw } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Problem, Receipt } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { count, toneFor } from "@/lib/format"
import { savePrinter, TAG_PRESETS, usePrinter } from "@/lib/operations/printer"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useEdgeActor } from "@/lib/edge-session"
import { idempotencyKey } from "@itulah/contract/client"

/// The print bench, which is two dialogs now rather than a screen.
///
/// It kept everything except the page around it. Printing is something done to
/// the article on the list in front of you, and a second screen meant walking
/// to it and re-choosing the article you had just been looking at.
///
/// Three facts about a warehouse shape this surface, and each one is a bug
/// that was found by using it:
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
///
/// **Print shows the label, not a list.** Somebody who pressed Print on a row
/// has already chosen the article; a job chooser at that point is the app
/// asking again. So this is what comes out of the machine — the tag, the ZPL
/// under it, the stock it is drawn on — and the button that sends it.
export function LabelSurface({
  jobId,
  onConfirmed,
}: {
  jobId: string
  /// The job has left the queue, so the surface showing it should go too.
  onConfirmed: () => void
}) {
  return (
    <div className="flex flex-col gap-[1.125rem]">
      <Preview jobId={jobId} />
      <PrintAction jobId={jobId} onConfirmed={onConfirmed} />
      {/* Folded shut, under the label it decides the shape of. It used to be
          a card in a Print queue dialog of its own, which meant the one
          setting a jam makes you want — the machine, the reel, the language —
          was two screens from the machine. Shut, because a bench is set once
          at commissioning; here, because that once happens standing at it. */}
      <PrinterCard />
    </div>
  )
}

/// One button, and the run behind it.
///
/// The bench used to be a card of its own with a Queue button, a Print button,
/// a repoint, a reprint and five key-values. Almost none of it was a decision:
/// a job gets exactly one run, that run prints to the bench it is standing at,
/// and what a person at the machine wants is for the next labels to come out.
/// So the run is opened on the first press rather than asked about, and what
/// is left of it is a sentence beside the button.
///
/// The printer itself is set in the Print queue dialog, which is where a fact
/// about the bench belongs — it is the same machine for every job on it.
///
/// **When the run is finished the button becomes the next job, not a dead
/// one.** Labels that have all printed are labels somebody is about to attach,
/// and saying so is what turns a counted quantity into that many tracked
/// units. It stays behind a question, because there is no way to take it
/// back.
function PrintAction({
  jobId,
  onConfirmed,
}: {
  jobId: string
  onConfirmed: () => void
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const printer = usePrinter()

  const existing = useQuery({
    queryKey: keys.jobRun(jobId),
    queryFn: ({ signal }) => dc.jobPrintSession(jobId, signal),
  })
  const run = existing.data ?? null

  // The job itself, for the one number the run cannot give before it exists:
  // how many labels this article is owed.
  const jobs = useQuery({
    queryKey: keys.taggingJobs(),
    queryFn: ({ signal }) => dc.taggingJobs(signal),
  })
  const job = (jobs.data ?? []).find((row) => row.job_id === jobId)

  const print = useMutation({
    mutationFn: async () => {
      // A job gets exactly one run and the node refuses a second, so this asks
      // the job rather than remembering: a bench that was walked away from
      // resumes its half-finished batch instead of being told no.
      const session =
        run ??
        (await dc.openPrintSession({
          job_id: jobId,
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
      // Follow the bench, every press.
      //
      // A run stores the printer it was opened against, and the node keeps
      // sending there — which is right, because a half-finished batch has to
      // come out of one machine. But it made the printer on this screen a
      // setting that stopped meaning anything the moment a run existed: change
      // it, press Print, and the labels go on appearing at the machine you
      // walked away from. That is discovered by walking there.
      //
      // `repointPrintSession` exists for exactly this and nothing called it.
      // The language rides along because a run carried to another bench may be
      // carried to another make of printer, and one that cannot say so keeps
      // sending ZPL to something that only reads TSPL — which prints nothing
      // and looks exactly like a printer that is switched off.
      //
      // The tag GEOMETRY travels with the machine, and the WORDS do not.
      //
      // That line used to be drawn in the wrong place: geometry was withheld
      // on the grounds that a run's label was frozen when it was queued. The
      // words are — a reprint has to reproduce the tag that was printed, not
      // the one today's catalogue would make. But the reel is a fact about the
      // bench, exactly like the host and the port beside it. Withholding it
      // meant a run opened on 50x30 kept being drawn for 50x30 after somebody
      // loaded a 45x18 reel, and what came out was the old layout crushed onto
      // short stock while the preview beside it showed the new one. Two
      // pictures of one label, and the paper was the one nobody could argue
      // with.
      const moved =
        session.printer_host !== printer.host ||
        session.printer_port !== printer.port ||
        session.label_width_mm !== printer.widthMm ||
        session.label_height_mm !== printer.heightMm
      const target = moved
        ? await dc.repointPrintSession(session.session_id, {
            printer_host: printer.host,
            printer_port: printer.port,
            chunk_size: printer.chunk,
            label_width_mm: printer.widthMm,
            label_height_mm: printer.heightMm,
            label_offset_mm: printer.offsetMm,
            language: printer.language,
          })
        : session
      return dc.runPrintChunk(target.session_id)
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.jobRun(jobId) })
      void client.invalidateQueries({ queryKey: keys.taggingJobs() })
    },
  })

  /// Putting the whole run back in the queue.
  ///
  /// Offered from the moment the last label prints until somebody says the
  /// tags are on, because that is exactly the window in which a bench finds
  /// out: a jam that ate the middle of a batch, a ribbon that ran out, a
  /// reel loaded crooked. The span is the whole run rather than a picked
  /// range — a person who has the EPCs off a reader can name them, and a
  /// person holding a tray of ruined tags cannot.
  ///
  /// **The same EPCs come back, never fresh ones.** A destroyed tag still
  /// belongs to a unit the ledger knows about, and a second EPC for one
  /// garment reads downstream as a second garment.
  const reprint = useMutation({
    mutationFn: () =>
      dc.reprintLabels(run!.session_id, {
        epcs: [],
        from_seq: 1,
        to_seq: run!.total_items,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.jobRun(jobId) })
      void client.invalidateQueries({ queryKey: keys.taggingJobs() })
    },
  })

  const confirm = useMutation({
    mutationFn: () =>
      dc.confirmTagging({
        job_id: jobId,
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
      onConfirmed()
    },
  })

  // How many labels are actually left. Before a run exists this was
  // `printer.chunk` — the size of a pass, not the size of the job — so a job
  // of eleven wore a button that said "Print 25". It printed eleven, because
  // the node claims what is there; the button was the only thing lying.
  const left = run === null ? (job?.total_quantity ?? 0) : run.pending_count
  // Nothing left is a STATE, not a disabled button. A button that says it will
  // not do anything is a button anyway: somebody presses it, nothing happens,
  // and they press it again. When the run is finished the button goes and the
  // pill says so.
  const done = run !== null && run.pending_count === 0

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[0.875rem] text-body">
          {run === null
            ? "Not queued yet"
            : `${count(run.printed_count)} of ${count(run.total_items)} printed`}
          {run !== null && run.failed_count > 0 && (
            <span className="text-bad-fg">
              {" "}
              · {count(run.failed_count)} the printer refused
            </span>
          )}
        </span>
        <div className="flex-1" />
        {/* Reprint stands beside the confirmation rather than replacing it:
            the labels are printed and the tags are not on yet, and both of
            those are things a person at the bench might mean. */}
        {done && (
          <Button
            variant="soft"
            disabled={reprint.isPending || confirm.isPending}
            onClick={() => reprint.mutate()}
          >
            <RotateCcw />
            {reprint.isPending ? "Queueing…" : "Reprint all"}
          </Button>
        )}
        {done ? (
          <ConfirmButton
            label="The tags are on"
            title="Confirm this job is tagged"
            description={
              <>
                All {count(run.total_items)} labels have printed. This turns
                that many counted pieces into individually tracked units and
                puts them in the warehouse. Say it once, when the labels are
                physically attached — there is no way to take it back.
              </>
            }
            confirmLabel="They are on"
            variant="primary"
            pending={confirm.isPending}
            onConfirm={() => confirm.mutate()}
          />
        ) : (
          <Button
            variant="primary"
            disabled={print.isPending || existing.isPending}
            onClick={() => print.mutate()}
          >
            <PrinterIcon />
            {print.isPending
              ? "Printing…"
              : `Print ${count(Math.min(printer.chunk, left))}`}
          </Button>
        )}
      </div>

      {print.isSuccess && print.data && (
        <Receipt>
          {count(print.data.printed)} of {count(print.data.attempted)} labels
          went to the printer
          {print.data.failed > 0 &&
            ` · ${count(print.data.failed)} came back and will be tried again`}
          .
        </Receipt>
      )}
      <Problem error={print.error ?? reprint.error ?? confirm.error} />
    </div>
  )
}

/// How far one job's run has got, read from the job rather than remembered.
///
/// A run belongs to the job, so this asks it — a bench that was walked away
/// from shows its half-finished batch here rather than looking untouched.
///
/// It is a column on the tagging list now. A printed row used to be
/// indistinguishable from an untouched one: same words, same Print button,
/// nothing anywhere saying eleven of eleven had already come out of the
/// machine. The row stays until somebody says the tags are ON — printed is
/// not attached — but it should not have to lie about which of the two it is
/// while it waits.
export function RunPill({ jobId }: { jobId: string }) {
  const run = useQuery({
    queryKey: keys.jobRun(jobId),
    queryFn: ({ signal }) => dc.jobPrintSession(jobId, signal),
  })
  const summary = run.data ?? null

  return (
    <>
      {summary === null ? (
        <span className="text-mute">Not printed</span>
      ) : summary.pending_count === 0 ? (
        <Pill tone="ok">All {count(summary.total_items)} printed</Pill>
      ) : (
        <Pill tone={toneFor(summary.status)}>
          {count(summary.printed_count)} of {count(summary.total_items)}
        </Pill>
      )}
    </>
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
/// Drawn on the stock THIS bench says it is holding, which is set in the Print
/// queue dialog — a fact about the machine, not about the job.
function Preview({ jobId }: { jobId: string }) {
  const printer = usePrinter()
  const [sku, setSku] = useState<string | undefined>(undefined)
  const [showing, setShowing] = useState<"tag" | "zpl">("tag")

  const jobs = useQuery({
    queryKey: keys.taggingJobs(),
    queryFn: ({ signal }) => dc.taggingJobs(signal),
  })
  const job = (jobs.data ?? []).find((row) => row.job_id === jobId)
  const lines = job?.lines ?? []
  const total = job?.total_quantity ?? 0

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
        {/* One tag, not the run. The dialog showed a single label with a
            single EPC under it and never said which of the batch it was, so
            an article of eleven pieces read as an article of one — the owner
            asked why "Writes" held one serial when eleven were printing. It
            is a specimen: this variant, its first serial, drawn at the size
            the bench below is set to. */}
        <p className="text-[0.875rem] text-mute">
          One label of {count(total)}
          {lines.length > 1 && " — pick a variant to see its own"}. Each piece
          gets its own serial and its own EPC.
        </p>

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
                  className={`min-h-[1.875rem] rounded-full px-2.5 text-[0.875rem] transition-colors ${
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
                     wrong shape.

                     Capped by HEIGHT as well as width, and centred: a 50 × 30
                     tag stretched to the full width of a dialog is a picture
                     of a poster, and nobody can tell from it whether the words
                     will fit on the thing in the machine. */
                  className="flex justify-center rounded-inner bg-soft-2 p-5 [&>svg]:block [&>svg]:h-auto [&>svg]:max-h-[13rem] [&>svg]:w-auto [&>svg]:max-w-full [&>svg]:rounded-[0.125rem] [&>svg]:shadow-soft"
                  dangerouslySetInnerHTML={{ __html: drawn.svg }}
                />
              ) : (
                <pre className="max-h-[13rem] overflow-auto rounded-inner border border-hairline bg-soft-2 p-3.5 font-mono text-[0.875rem] leading-[1.6] whitespace-pre text-body">
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

              <p className="text-[0.875rem] text-mute">
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

/// Which machine is in front of this person.
///
/// Saved on every change rather than behind a Save button, because there is no
/// submit: walking to another bench is how this changes, and nobody would
/// press "save printer" first.
/// Ask the node whether the address in these fields has a machine behind it.
///
/// Sat here rather than beside the run button because this is a question about
/// the SETTING, not about the job: it is asked while commissioning a bench, or
/// when a run has just failed and nobody knows whether the fault is the
/// address, the network or the printer itself.
///
/// It prints nothing. Somebody checking a typo must not have to peel a tag off
/// the reel to find out, and on RFID stock that tag would carry an EPC.
function ConnectionTest() {
  const printer = usePrinter()
  const test = useMutation({
    mutationFn: () =>
      dc.testPrinter({
        printer_host: printer.host,
        printer_port: printer.port,
      }),
  })
  const probe = test.data ?? null

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="soft"
        disabled={test.isPending || printer.host.trim() === ""}
        onClick={() => test.mutate()}
      >
        {test.isPending ? "Knocking…" : "Test connection"}
      </Button>
      <Problem error={test.error} />
      {probe !== null &&
        (probe.reachable ? (
          <div className="flex flex-col gap-1 text-[0.875rem]">
            <div className="flex items-center gap-1.5">
              <Pill tone="ok">answered</Pill>
              <span className="font-mono text-mute">
                {probe.address} · {probe.took_ms} ms
              </span>
            </div>
            {/* Silence is the common case and must not read as a fault: most
                printers only speak when handed a job, and a TSC in its native
                mode ignores the ZPL query outright. */}
            {probe.identity === null ? (
              <p className="text-mute">
                A socket opened. The machine did not identify itself, which most
                printers do not — it says nothing about whether a tag will come
                out.
              </p>
            ) : (
              <p className="text-body">
                Says it speaks{" "}
                <span className="font-medium">{probe.speaks}</span>:{" "}
                <span className="font-mono text-mute">{probe.identity}</span>
                {probe.speaks !== printer.language && (
                  <span className="text-warn-fg">
                    {" "}
                    — this bench is set to {printer.language}, and a machine
                    handed the wrong language prints nothing at all.
                  </span>
                )}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1 text-[0.875rem]">
            <div className="flex items-center gap-1.5">
              <Pill tone="bad">no answer</Pill>
              <span className="font-mono text-mute">{probe.address}</span>
            </div>
            <p className="text-mute">{probe.error}</p>
            <p className="text-mute">
              The node could not open a socket. The machine is off, on another
              network, or the address is a typo. A printer on a USB cable never
              answers here — it is not on the network at all, and needs a bridge
              that listens on this port on the machine it is plugged into.
            </p>
          </div>
        ))}
    </div>
  )
}

function PrinterCard() {
  const printer = usePrinter()

  return (
    <Collapsible.Root className="border-t border-hairline pt-3">
      {/* Shut, and it says what it is set to while shut. A bench is pointed
          at its machine once at commissioning and then never again — until
          somebody walks to another one, and then the first thing they want to
          know is which machine this browser still thinks it is talking to.
          The summary answers that without opening anything. */}
      <Collapsible.Trigger className="group flex w-full items-center gap-1.5 text-left text-[0.875rem] font-medium text-body transition-colors hover:text-ink">
        <ChevronRight className="size-3.5 text-line-ico transition-transform duration-150 group-data-[panel-open]:rotate-90" />
        Printer
        <span className="font-mono text-[0.875rem] text-mute">
          {printer.host}:{printer.port} · {printer.language} · {printer.widthMm}
          ×{printer.heightMm} mm
        </span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="overflow-hidden">
        <div className="flex flex-col gap-3 px-1 py-3.5">
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
          {/* Two facts about the machine, not about the job. They sit beside
              the size for the same reason it does: a reel, a ribbon and a head
              are what they describe, and all three change at the bench. */}
          <div className="flex gap-3">
            <Field label="Darkness" className="flex-1">
              <Input
                inputMode="numeric"
                value={String(printer.darkness)}
                onChange={(event) =>
                  savePrinter({
                    ...printer,
                    darkness: clampTo(event.target.value, 0, 30, printer.darkness),
                  })
                }
              />
              <p className="mt-1 text-meta text-mute">0–30</p>
            </Field>
            <Field label="Speed" className="flex-1">
              <Input
                inputMode="numeric"
                value={String(printer.speedIps)}
                onChange={(event) =>
                  savePrinter({
                    ...printer,
                    speedIps: clampTo(event.target.value, 1, 12, printer.speedIps),
                  })
                }
              />
              <p className="mt-1 text-meta text-mute">inci/detik</p>
            </Field>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TAG_PRESETS.map((preset) => {
              const chosen =
                preset.widthMm === printer.widthMm &&
                preset.heightMm === printer.heightMm &&
                (preset.offsetMm ?? printer.offsetMm) === printer.offsetMm
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
                      // A reel that states its own inset carries it; one that
                      // does not leaves whatever the bench already had, because
                      // the inset belongs to the stock and not to the size.
                      ...(preset.offsetMm === undefined
                        ? {}
                        : { offsetMm: preset.offsetMm }),
                    })
                  }
                  title={preset.note}
                  className={`min-h-[1.875rem] rounded-full px-2.5 text-[0.875rem] tabular-nums transition-colors ${
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
          <ConnectionTest />
          <p className="text-[0.875rem] text-mute">
            58 × 40 mm is the tag the label layout was tuned against by hand,
            and what the node assumes when a run leaves it out. Other sizes
            scale from it — the ones above are starting points, not a list of
            what this warehouse stocks, and anything can be typed. What the tag
            actually looks like at a given size is the picture above.
          </p>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

/// Keep a typed number inside what the machine accepts.
///
/// An empty box keeps the last value rather than becoming zero: zero darkness
/// is a blank label, and a half-typed "1" on the way to "18" must not be sent
/// as a setting. Out of range clamps rather than refuses, because the person
/// is dragging toward a number and being told "no" mid-keystroke is worse than
/// being stopped at the edge.
function clampTo(raw: string, low: number, high: number, fallback: number) {
  const value = Number(raw)
  if (raw.trim() === "" || Number.isNaN(value)) return fallback
  return Math.min(high, Math.max(low, Math.round(value)))
}
