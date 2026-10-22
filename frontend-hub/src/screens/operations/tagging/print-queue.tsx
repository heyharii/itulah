import { Collapsible } from "@base-ui/react/collapsible"
import { useMutation, useQuery } from "@tanstack/react-query"
import { ChevronRight, Printer as PrinterIcon, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Problem } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { count } from "@/lib/format"
import { savePrinter, TAG_PRESETS, usePrinter } from "@/lib/operations/printer"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import {
  usePrintJobs,
  useReprintLine,
} from "@/screens/operations/tagging/print-run"
import type { PrintSessionSummary, TaggingWorkJob } from "@itulah/contract"

/// The print bench for one PO.
///
/// A run belongs to the article job (`GET tagging-jobs/{id}/print-session`),
/// not to the PO and not to the tab, so every press asks the job which run it
/// has. The printer is a fact about the bench and follows it (repoint on every
/// press). Reprints reuse the same EPCs, never fresh ones. Printing the last
/// label of a job books its units in (owner, 29 Sep) — no "tags are on" step.

export function ReprintButton({
  job,
  run,
  epcs,
}: {
  job: TaggingWorkJob
  run: PrintSessionSummary | null | undefined
  epcs: readonly string[]
}) {
  const reprint = useReprintLine(job, run, epcs)
  return (
    <>
      <Button
        variant="ghost"
        pending={reprint.isPending}
        onClick={(event) => {
          event.stopPropagation()
          reprint.mutate()
        }}
      >
        <RotateCcw />
        Reprint
      </Button>
      <Problem error={reprint.error} />
    </>
  )
}

export function PrintAllButton({
  jobs,
  runs,
  left,
  row,
  card,
}: {
  jobs: readonly TaggingWorkJob[]
  runs: Map<string, PrintSessionSummary | null>
  left: number
  /// On a list row: "Print 240", quiet, and the click stays on the button.
  row?: boolean
  /// On a phone's card: the same words as a tint text button, no icon.
  card?: boolean
}) {
  const print = usePrintJobs(jobs, runs)
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        // Solid blue on a row too (owner, 2026-10-18).
        variant={card ? "tint" : "primary"}
        size={card ? "card" : undefined}
        pending={print.isPending}
        onClick={(event) => {
          event.stopPropagation()
          print.mutate()
        }}
      >
        {!card && <PrinterIcon />}
        {print.isPending
          ? "Printing…"
          : `${row || card ? "Print" : "Print all"} ${count(left)}`}
      </Button>
      <Problem error={print.error} />
    </div>
  )
}

export function PrintJobButton({
  job,
  run,
  runs,
}: {
  job: TaggingWorkJob
  run: PrintSessionSummary | null | undefined
  runs: Map<string, PrintSessionSummary | null>
}) {
  const print = usePrintJobs([job], runs)
  const left = run == null ? job.total_quantity : run.pending_count
  return (
    <>
      <Button
        variant="primary"
        pending={print.isPending}
        onClick={(event) => {
          event.stopPropagation()
          print.mutate()
        }}
      >
        <PrinterIcon />
        Print {count(left)}
      </Button>
      <Problem error={print.error} />
    </>
  )
}

export function PrintedPill({
  printed,
  labels,
}: {
  printed: number
  labels: number
}) {
  if (printed === 0) return <span className="text-mute">—</span>
  return printed >= labels ? (
    <Pill tone="ok">{count(printed)}</Pill>
  ) : (
    <Pill tone="info">
      {count(printed)} / {count(labels)}
    </Pill>
  )
}

/// The hang tag as the node draws it, for the chosen SKU.
export function Preview({ jobId, sku }: { jobId: string; sku: string }) {
  const printer = usePrinter()
  const preview = useQuery({
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
          sku_code: sku,
          language: printer.language,
        },
        signal
      ),
  })
  return queryState(preview, {
    loading: "Drawing the label…",
    render: (drawn) => (
      <div className="flex flex-col gap-3">
        <div
          className="flex justify-center rounded-inner bg-soft-2 px-5 py-7 [&>svg]:block [&>svg]:h-auto [&>svg]:max-h-[12rem] [&>svg]:w-auto [&>svg]:max-w-full [&>svg]:rounded-[0.125rem] [&>svg]:shadow-soft"
          dangerouslySetInnerHTML={{ __html: drawn.svg }}
        />
        <KeyValue term="Size">
          {drawn.label_width_mm} × {drawn.label_height_mm} mm
        </KeyValue>
        <KeyValue term="EPC">
          {drawn.epc === "" ? (
            <span className="text-mute">—</span>
          ) : (
            <span className="font-mono text-id">{drawn.epc}</span>
          )}
        </KeyValue>
      </div>
    ),
  })
}

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
        pending={test.isPending}
        disabled={printer.host.trim() === ""}
        onClick={() => test.mutate()}
      >
        {test.isPending ? "Testing…" : "Test connection"}
      </Button>
      <Problem error={test.error} />
      {probe !== null &&
        (probe.reachable ? (
          <div className="flex flex-col gap-1 text-[0.9375rem]">
            <div className="flex items-center gap-1.5">
              <Pill tone="ok">answered</Pill>
              <span className="font-mono text-mute">
                {probe.address} · {probe.took_ms} ms
              </span>
            </div>
            {probe.identity === null ? null : (
              <p className="text-body">
                Says it speaks{" "}
                <span className="font-medium">{probe.speaks}</span>:{" "}
                <span className="font-mono text-mute">{probe.identity}</span>
                {probe.speaks !== printer.language && (
                  <span className="text-warn-fg">
                    {" "}
                    — set to {printer.language}
                  </span>
                )}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1 text-[0.9375rem]">
            <div className="flex items-center gap-1.5">
              <Pill tone="bad">no answer</Pill>
              <span className="font-mono text-mute">{probe.address}</span>
            </div>
            <p className="text-mute">{probe.error}</p>
          </div>
        ))}
    </div>
  )
}

export function PrinterCard() {
  const printer = usePrinter()

  return (
    <Collapsible.Root>
      {/* Shut, and it says what it is set to while shut. A bench is pointed
          at its machine once at commissioning and then never again — until
          somebody walks to another one, and then the first thing they want to
          know is which machine this browser still thinks it is talking to.
          The summary answers that without opening anything. */}
      <Collapsible.Trigger className="group flex w-full items-center gap-1.5 text-left text-[0.9375rem] font-medium text-body transition-colors hover:text-ink">
        <ChevronRight className="size-3.5 text-line-ico transition-transform duration-150 group-data-[panel-open]:rotate-90" />
        Printer
        <span className="font-normal text-mute">
          <span className="font-mono">
            {printer.host}:{printer.port}
          </span>{" "}
          · {printer.language} · {printer.widthMm} × {printer.heightMm} mm
        </span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="fold-panel">
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
                    darkness: clampTo(
                      event.target.value,
                      0,
                      30,
                      printer.darkness
                    ),
                  })
                }
              />
            </Field>
            <Field label="Speed" className="flex-1">
              <Input
                inputMode="numeric"
                value={String(printer.speedIps)}
                onChange={(event) =>
                  savePrinter({
                    ...printer,
                    speedIps: clampTo(
                      event.target.value,
                      1,
                      12,
                      printer.speedIps
                    ),
                  })
                }
              />
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
                  className={`min-h-[1.875rem] rounded-full px-2.5 text-[0.9375rem] tabular-nums transition-colors ${
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
