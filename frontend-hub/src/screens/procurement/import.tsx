import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Send,
  Trash2,
  Upload,
} from "lucide-react"
import { useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { SavedDialog } from "@/components/ui/dialog"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Section, TotalsLadder } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  unitFactor,
  useUnits,
  type UnitConversion,
  type UnitOfMeasure,
} from "@/lib/queries/units"
import {
  ingestPoFiles,
  poImportHealth,
  poImportKeys,
  validatePoDraft,
  type EditableDraft,
  type PoImportFileReport,
} from "@/lib/queries/po-import"
import {
  listPurchaseOrders,
  listSuppliers,
  procurementKeys,
  purchaseDestinations,
  raiseDirectPurchaseOrder,
} from "@/lib/queries/procurement"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import {
  nextPoNumber,
  offsetPoNumber,
  useActor,
} from "@/screens/procurement/shared"
import { SupplierName } from "@/screens/procurement/supplier-name"
import type { PurchaseDestination, Supplier } from "@itulah/contract"

/// Import PO — raise orders from documents instead of from a catalogue walk.
///
/// **The pipe.** Any number of files in — Excel sheets, PDFs, photographs —
/// and PO DRAFTS out. The cloud's intake kernel (`intake/po`) parses
/// each document, Jev judges what is usable (stage B2), and what is not becomes a
/// question in the wizard. Nothing here decides: the kernel's decisions
/// arrive as the draft's questions, and the buyer's answers go back through
/// `/validate` until none are left.
///
/// **And the wall at the end.** No PO exists until the summary's button is
/// pressed — that press is the only place this screen calls the cloud's
/// direct-order route. Everything before it is a draft in browser memory: a
/// closed tab loses nothing but the reading. The flow mirrors the composer's
/// two steps (edit, then review) for the same reason the composer has them —
/// the thing somebody approves must look like the thing that is created.
///
/// Grouping is the service's (same supplier + same printed PO number is one
/// order), and the number the book will file this under is offered from the
/// same `nextPoNumber` the composer offers — one book, one shape, two doors.

type Step = "upload" | "wizard" | "summary"

function fileIcon(name: string) {
  if (/\.(xlsx|xls|csv)$/i.test(name)) return FileSpreadsheet
  if (/\.pdf$/i.test(name)) return FileText
  return ImageIcon
}

/// The ruled grid's chrome, the same two classes the composer's review and
/// the order document wear — one pair, so what somebody approves looks like
/// what they come back to.
const HEAD =
  "border-b border-l border-hairline bg-soft-2 px-3 py-2 text-left font-mono text-eyebrow tracking-[0.04em] text-body uppercase first:border-l-0"
const CELL =
  "border-t border-l border-hairline px-3 py-2 align-middle first:border-l-0"

/// Whether a line printed a unit ("koli") the units master does not
/// recognise, and therefore still needs the buyer to say what it means
/// before it can be sent — the server has no way to turn "10 koli" into
/// pieces on its own, and neither does this screen.
function needsUnit(line: EditableDraft["lines"][number]): boolean {
  return (line.unit ?? "").trim() !== "" && line.unit_code === null
}

/// Whether a draft can become an order AT ALL: no open questions, a supplier
/// and destination actually picked from the book (a typed name is not an
/// id — the server refuses the order without one), and every line complete
/// AND, where something was printed on the paper, understood.
/// The Add PO buttons read this, so a half-finished draft cannot be pressed
/// through by an optimistic UI.
function isCreatable(draft: EditableDraft): boolean {
  return (
    draft.questions.length === 0 &&
    draft.supplier_id !== null &&
    draft.destination_site_id !== null &&
    draft.lines.length > 0 &&
    draft.lines.every(
      (line) =>
        (line.article_name ?? "").trim() !== "" &&
        (line.quantity ?? 0) > 0 &&
        (line.unit_price_minor ?? 0) > 0 &&
        !needsUnit(line)
    )
  )
}

interface UnitBookLike {
  readonly units: readonly UnitOfMeasure[]
  readonly conversions: readonly UnitConversion[]
  readonly baseUnit: string
}

/// The unit a line is ordered in: the buyer's own pick, or the base unit
/// while nothing has been chosen — which is right for a line that printed no
/// unit at all, and `needsUnit` above is what stops it standing in for a
/// unit that was printed but never resolved.
function chosenUnitCode(
  line: EditableDraft["lines"][number],
  unitBook: UnitBookLike
): string {
  return line.unit_code ?? unitBook.baseUnit
}

/// What the direct-order route needs for one line — pieces, the unit it was
/// raised in off the base unit, and the price — mirroring the server's own
/// check so a refusal here never differs from one there (`ordered_quantity`
/// must equal `unit_quantity` × the unit's factor).
///
/// The printed price is per PRINTED unit ("Rp 240.000 per lusin"), and kept
/// exactly: `order_unit_price_minor` carries it unchanged, the line totals
/// the printed quantity times that (0656), and the server derives the
/// per-piece `unit_price_minor` itself. This screen still works one out —
/// dividing by the factor and rounding — because the field is not nullable
/// on the wire, but nothing here depends on that division being exact any
/// more; the total it used to protect with a "rounded" note is now exact.
function orderedFields(
  line: EditableDraft["lines"][number],
  unitBook: UnitBookLike
): {
  readonly ordered_quantity: number
  readonly unit_price_minor: number
  readonly unit_code: string | null
  readonly unit_quantity: string | null
  readonly order_unit_price_minor: number | null
} {
  const qty = line.quantity ?? 0
  const printedPrice = line.unit_price_minor ?? 0
  const code = chosenUnitCode(line, unitBook)
  if (code === unitBook.baseUnit) {
    return {
      ordered_quantity: qty,
      unit_price_minor: printedPrice,
      unit_code: null,
      unit_quantity: null,
      order_unit_price_minor: null,
    }
  }
  const rawFactor = unitFactor(code, unitBook.conversions, unitBook.baseUnit)
  const factor = rawFactor === null ? 1 : Number(rawFactor)
  return {
    ordered_quantity: Math.round(qty * factor * 10_000) / 10_000,
    unit_price_minor: Math.round(printedPrice / factor),
    unit_code: code,
    unit_quantity: String(qty),
    order_unit_price_minor: printedPrice,
  }
}

export function PoImport() {
  const [restart, setRestart] = useState(0)
  return (
    <PageContent>
      <PageHeader
        crumb="Procurement"
        title="Import PO"
        sub="Bangun PO dari file — Excel, PDF, atau foto dokumen order. PO baru dibuat setelah kamu periksa di ringkasan."
        actions={
          <Button variant="ghost" onClick={() => setRestart((n) => n + 1)}>
            <Plus className="size-4" />
            Mulai ulang
          </Button>
        }
      />
      {/* Remounted to restart. The flow holds four pieces of state that must
          all go back together, and a `key` change is the one way to say that
          which cannot leave one of them behind. */}
      <PoImportFlow key={restart} />
    </PageContent>
  )
}

/// The import itself, with no page around it.
///
/// Its own component because this flow now has two doors: the screen above,
/// and the sheet the order book raises over itself — see `PoImportSheet`. A
/// buyer whose supplier emails a PDF is standing in the order book when it
/// arrives, and sending them to another screen to act on it loses the place
/// they were in.
export function PoImportFlow({ onDone }: { onDone?: () => void }) {
  const [step, setStep] = useState<Step>("upload")
  const [drafts, setDrafts] = useState<EditableDraft[]>([])
  const [reports, setReports] = useState<readonly PoImportFileReport[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const orders = useQuery({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders({}, signal),
  })
  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
  })
  const destinations = useQuery({
    queryKey: procurementKeys.destinations(),
    queryFn: ({ signal }) => purchaseDestinations(signal),
  })
  const health = useQuery({
    queryKey: poImportKeys.health(),
    queryFn: ({ signal }) => poImportHealth(signal),
    staleTime: 60_000,
  })

  const active = drafts.find((draft) => draft.draft_id === activeId) ?? null

  const reset = () => {
    setDrafts([])
    setReports([])
    setActiveId(null)
    setStep("upload")
  }

  return (
    <>
      {health.data !== undefined && !health.data.gateway && (
        <Banner tone="info" className="mb-4">
          Jev (AI Gateway) belum dikonfigurasi — keputusan keyakinan memakai
          aturan deterministik, jadi wizard akan bertanya lebih banyak.
        </Banner>
      )}
      {health.data !== undefined &&
        !health.data.openparser &&
        !health.data.liteparse && (
          <Banner tone="warn" className="mb-4">
            OCR belum tersedia (OPENPARSER_API_KEY / LITEPARSE_BIN kosong) — PDF
            hasil scan dan foto belum bisa dibaca; PDF teks dan Excel tetap
            jalan.
          </Banner>
        )}

      {step === "upload" && (
        <UploadStep
          reports={reports}
          drafts={drafts}
          onIngested={(nextReports, nextDrafts) => {
            setReports(nextReports)
            setDrafts([...nextDrafts])
            const withQuestions = nextDrafts.find((d) => d.questions.length > 0)
            if (withQuestions !== undefined) {
              setActiveId(withQuestions.draft_id)
              setStep("wizard")
            } else if (nextDrafts.length > 0) {
              setActiveId(nextDrafts[0].draft_id)
              setStep("summary")
            }
          }}
          onReviewAll={() => setStep("summary")}
          onOpenDraft={(id) => {
            setActiveId(id)
            setStep("wizard")
          }}
        />
      )}

      {step === "wizard" && active !== null && (
        <WizardStep
          key={active.draft_id}
          draft={active}
          suppliers={suppliers.data ?? []}
          destinations={destinations.data ?? []}
          onValidated={(next) => {
            setDrafts((current) =>
              current.map((d) => (d.draft_id === next.draft_id ? next : d))
            )
            if (next.questions.length > 0) {
              setActiveId(next.draft_id)
              return
            }
            const remaining = drafts.find(
              (d) => d.draft_id !== active.draft_id && d.questions.length > 0
            )
            if (remaining !== undefined) {
              setActiveId(remaining.draft_id)
            } else {
              setStep("summary")
            }
          }}
        />
      )}

      {step === "summary" && (
        <SummaryStep
          drafts={drafts}
          suggestedNumber={nextPoNumber(orders.data ?? [])}
          onChanged={(next) =>
            setDrafts((current) =>
              current.map((d) => (d.draft_id === next.draft_id ? next : d))
            )
          }
          onFixDraft={(id) => {
            setActiveId(id)
            setStep("wizard")
          }}
          onDone={() => {
            reset()
            onDone?.()
          }}
        />
      )}
    </>
  )
}

/// The same flow, over the order book.
///
/// **A sheet, not a second screen.** An imported PO is an order like any
/// other, and the place somebody is standing when a supplier's PDF lands is
/// the order book — so the import opens over it and the book is still there
/// underneath when it closes. The screen at `/procurement/import` stays: it is
/// what a link in an email opens, and what somebody sets out for when the job
/// of the morning is twenty documents.
///
/// `workspace` width, which is the widest this kit draws. The wizard puts a
/// document's lines in a ruled grid beside the questions asked about them, and
/// a narrower sheet makes the buyer scroll between the question and the figure
/// it is about.
export function PoImportSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  /// Bumped to start over, and bumped on every opening — so a sheet reopened
  /// after an import does not greet the next document with the last one's
  /// summary still on the glass.
  const [run, setRun] = useState(0)
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Import PO"
      caption="Bangun PO dari file — Excel, PDF, atau foto dokumen order. PO baru dibuat setelah kamu periksa di ringkasan."
      width="workspace"
      actions={
        <Button variant="ghost" onClick={() => setRun((n) => n + 1)}>
          <Plus className="size-4" />
          Mulai ulang
        </Button>
      }
    >
      <PoImportFlow key={`${open}-${run}`} onDone={onClose} />
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — upload

function UploadStep({
  reports,
  drafts,
  onIngested,
  onReviewAll,
  onOpenDraft,
}: {
  reports: readonly PoImportFileReport[]
  drafts: readonly EditableDraft[]
  onIngested: (
    reports: readonly PoImportFileReport[],
    drafts: readonly EditableDraft[]
  ) => void
  onReviewAll: () => void
  onOpenDraft: (id: string) => void
}) {
  const [picked, setPicked] = useState<File[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const ingest = useMutation({
    mutationFn: ({ signal }: { signal?: AbortSignal }) =>
      ingestPoFiles(picked, signal),
    onSuccess: (body) => {
      onIngested(body.reports, body.drafts)
      setPicked([])
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (drafts.length === 0 && reports.length > 0) {
    return (
      <div className="flex flex-col gap-4">
        <Section title="Hasil Baca">
          <div className="flex flex-col gap-2">
            {reports.map((report, index) => (
              <div
                key={`${report.file_name}-${index}`}
                className="rounded-inner border border-hairline px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[0.875rem] text-ink">
                    {report.file_name}
                  </span>
                  <Pill tone={report.status === "parsed" ? "ok" : "bad"}>
                    {report.status}
                  </Pill>
                </div>
                <p className="mt-1 text-[0.875rem] text-mute">
                  {report.error ?? report.note ?? report.parser}
                </p>
              </div>
            ))}
          </div>
          <Banner tone="bad" className="mt-3">
            Tidak ada draf PO yang bisa ditinjau. Perbaiki file atau konfigurasi
            OCR, lalu coba lagi.
          </Banner>
        </Section>
        <PickFiles
          picked={picked}
          setPicked={setPicked}
          inputRef={inputRef}
          ingest={ingest}
        />
      </div>
    )
  }

  if (drafts.length > 0) {
    return (
      <div className="flex flex-col gap-4">
        <Section title={`Draf dari dokumen (${drafts.length})`}>
          <p className="-mt-2 mb-3 text-[0.875rem] text-mute">
            {reports
              .map(
                (r) =>
                  `${r.file_name}: ${r.status === "parsed" ? r.parser : (r.error ?? r.status)}`
              )
              .join(" · ")}
          </p>
          <div className="flex flex-col gap-2">
            {drafts.map((draft) => (
              <button
                key={draft.draft_id}
                type="button"
                onClick={() => onOpenDraft(draft.draft_id)}
                className="flex items-center justify-between gap-3 rounded-inner border border-hairline px-4 py-3 text-left hover:bg-soft"
              >
                <div className="min-w-0">
                  <div className="truncate text-[0.875rem] text-ink">
                    {draft.supplier_name === null &&
                    draft.supplier_id === null ? (
                      "Supplier belum ditentukan"
                    ) : (
                      <SupplierName
                        code={draft.supplier_id}
                        name={draft.supplier_name}
                      />
                    )}
                    <span className="ml-2 text-body">
                      {draft.lines.length} baris
                    </span>
                  </div>
                  <div className="text-[0.875rem] text-mute">
                    {draft.source_files.join(", ")}
                  </div>
                </div>
                {draft.questions.length > 0 ? (
                  <Pill tone="warn">{draft.questions.length} pertanyaan</Pill>
                ) : (
                  <Pill tone="ok">lengkap</Pill>
                )}
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onReviewAll}>
              Lanjut ke ringkasan
            </Button>
          </div>
        </Section>
        <PickFiles
          picked={picked}
          setPicked={setPicked}
          inputRef={inputRef}
          ingest={ingest}
        />
      </div>
    )
  }

  return (
    <PickFiles
      picked={picked}
      setPicked={setPicked}
      inputRef={inputRef}
      ingest={ingest}
    />
  )
}

function PickFiles({
  picked,
  setPicked,
  inputRef,
  ingest,
}: {
  picked: File[]
  setPicked: (files: File[]) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  ingest: {
    mutate: (vars: { signal?: AbortSignal }) => void
    isPending: boolean
  }
}) {
  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".xlsx,.xls,.csv,.pdf,image/*"
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) setPicked(files)
          event.target.value = ""
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = "copy"
        }}
        onDrop={(event) => {
          event.preventDefault()
          const files = Array.from(event.dataTransfer.files)
          if (files.length > 0) setPicked(files)
        }}
        className="flex flex-col items-center gap-2 rounded-inner border border-dashed border-hairline-strong px-6 py-12 text-center hover:bg-soft"
      >
        <Upload className="size-6 text-mute" />
        <span className="text-[0.875rem] text-ink">
          Pilih atau tarik file — bisa beberapa sekaligus
        </span>
        <span className="text-[0.875rem] text-mute">
          Excel (.xlsx/.xls/.csv), PDF, atau foto dokumen order
        </span>
      </button>

      {picked.length > 0 && (
        <div className="flex flex-col gap-2">
          {picked.map((file) => {
            const Icon = fileIcon(file.name)
            return (
              <div
                key={file.name}
                className="flex items-center gap-2.5 rounded-inner border border-hairline px-3 py-2"
              >
                <Icon className="size-4 shrink-0 text-mute" />
                <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink">
                  {file.name}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPicked(picked.filter((f) => f.name !== file.name))
                  }
                  className="text-[0.875rem] text-mute hover:text-bad"
                >
                  buang
                </button>
              </div>
            )
          })}
          <div className="flex justify-end">
            <Button
              variant="primary"
              pending={ingest.isPending}
              onClick={() => ingest.mutate({})}
            >
              {ingest.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Baca {picked.length} file
            </Button>
          </div>
        </div>
      )}

      <EmptyState>
        File-file yang menyebut supplier dan nomor PO yang sama digabung jadi
        satu order. Semua draf diperiksa dulu — tidak ada PO dibuat dari file
        mentah.
      </EmptyState>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — the wizard, one draft at a time

function WizardStep({
  draft,
  suppliers,
  destinations,
  onValidated,
}: {
  draft: EditableDraft
  suppliers: readonly Supplier[]
  destinations: readonly PurchaseDestination[]
  onValidated: (draft: EditableDraft) => void
}) {
  /// Answers are held LOCAL until the buyer presses periksa: a wizard that
  /// round-tripped on every keystroke would re-judge half-finished typing.
  const [answers, setAnswers] = useState<
    Record<string, { value: string; label?: string | null }>
  >({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const answer = (id: string, value: string, label?: string | null) =>
    setAnswers((current) => ({
      ...current,
      [id]: { value, label: label ?? null },
    }))

  const submit = async () => {
    setSending(true)
    setError(null)
    try {
      const next = await validatePoDraft(draft, answers)
      onValidated(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : "gagal memeriksa jawaban")
    } finally {
      setSending(false)
    }
  }

  const remaining = draft.questions.filter((q) => {
    const given = answers[q.id]
    return given === undefined || given.value.trim() === ""
  })

  return (
    <div className="flex flex-col gap-5">
      <Section title="Lengkapi Data Yang Belum Jelas">
        <p className="-mt-2 mb-3 text-[0.875rem] text-mute">
          {draft.source_files.join(", ")} · {draft.parser_note ?? draft.parser}
        </p>
        {draft.questions.length === 0 ? (
          <EmptyState>Semua sudah jelas untuk draf ini.</EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            {draft.questions.map((question) => (
              <QuestionRow
                key={question.id}
                question={question}
                suppliers={suppliers}
                destinations={destinations}
                value={answers[question.id]?.value ?? ""}
                onChange={(value, label) => answer(question.id, value, label)}
              />
            ))}
          </div>
        )}
      </Section>

      {error !== null && <Banner tone="bad">{error}</Banner>}

      <div className="flex items-center justify-end gap-2">
        {remaining.length > 0 && (
          <span className="mr-auto text-[0.875rem] text-mute">
            {remaining.length} pertanyaan belum dijawab — boleh lanjut, nanti
            ditanya lagi di ringkasan.
          </span>
        )}
        <Button
          variant="primary"
          disabled={sending}
          onClick={() => void submit()}
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : null}
          Periksa jawaban
        </Button>
      </div>
    </div>
  )
}

function QuestionRow({
  question,
  suppliers,
  destinations,
  value,
  onChange,
}: {
  question: EditableDraft["questions"][number]
  suppliers: readonly Supplier[]
  destinations: readonly PurchaseDestination[]
  value: string
  onChange: (value: string, label?: string | null) => void
}) {
  return (
    <Field
      label={question.label}
      hint={
        question.hint ??
        (question.confidence !== null
          ? `Keyakinan bacaan ${Math.round(question.confidence * 100)}%`
          : null) ??
        undefined
      }
    >
      {question.options === "supplier" ? (
        <PickFromBook
          value={value}
          choices={suppliers.map((s) => ({
            value: s.supplier_id,
            label: s.name,
          }))}
          onChange={onChange}
        />
      ) : question.options === "destination" ? (
        <PickFromBook
          value={value}
          choices={destinations.map((d) => ({
            value: d.site_id,
            label: d.label,
          }))}
          onChange={onChange}
        />
      ) : (
        <Input
          type={
            question.kind === "number"
              ? "number"
              : question.kind === "date"
                ? "date"
                : "text"
          }
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}

/// A text box that also offers the book's real records. Picking one fills the
/// value with the RECORD'S ID and the label with its name — the draft carries
/// both, because the order needs the id and the summary reads the name.
function PickFromBook({
  value,
  choices,
  onChange,
}: {
  value: string
  choices: readonly { value: string; label: string }[]
  onChange: (value: string, label?: string | null) => void
}) {
  const [typed, setTyped] = useState(value)
  const chosen = choices.find((c) => c.value === value)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {choices.slice(0, 8).map((choice) => (
          <button
            key={choice.value}
            type="button"
            onClick={() => {
              setTyped(choice.label)
              onChange(choice.value, choice.label)
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-[0.875rem]",
              chosen?.value === choice.value
                ? "border-accent bg-soft text-ink"
                : "border-hairline text-body hover:bg-soft"
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <Input
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value)
          onChange(event.target.value)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — the review summary of EVERY imported order, and the only place a
// PO is actually created.

function SummaryStep({
  drafts,
  suggestedNumber,
  onChanged,
  onFixDraft,
  onDone,
}: {
  drafts: readonly EditableDraft[]
  suggestedNumber: string
  onChanged: (draft: EditableDraft) => void
  onFixDraft: (id: string) => void
  onDone: () => void
}) {
  const actor = useActor()
  const client = useQueryClient()
  const unitBook = useUnits()
  const [created, setCreated] = useState<readonly string[]>([])
  const [failure, setFailure] = useState<string | null>(null)

  // Give each number-less draft its own candidate from the same series as the
  // composer. The order endpoint remains the final authority if another buyer
  // wins a race while this screen is open.
  const automaticNumbers = new Map<string, string>()
  const reservedNumbers = new Set(
    drafts
      .map((draft) => draft.po_number?.trim())
      .filter(
        (number): number is string => number !== undefined && number !== ""
      )
  )
  let numberOffset = 0
  for (const draft of drafts) {
    if (draft.po_number?.trim()) continue
    let candidate = offsetPoNumber(suggestedNumber, numberOffset)
    while (reservedNumbers.has(candidate)) {
      numberOffset += 1
      candidate = offsetPoNumber(suggestedNumber, numberOffset)
    }
    automaticNumbers.set(draft.draft_id, candidate)
    reservedNumbers.add(candidate)
    numberOffset += 1
  }

  /// One mutation per press: each PO is its own write, its own failure, its
  /// own receipt. A "create all" that stops at the first refusal would leave
  /// the buyer guessing which of five orders went through.
  const create = useMutation({
    mutationFn: async ({
      draft,
      poNumber,
    }: {
      draft: EditableDraft
      poNumber: string
    }) => {
      const receipt = await raiseDirectPurchaseOrder({
        po_number: poNumber,
        supplier_id: draft.supplier_id ?? "",
        supplier_name: draft.supplier_name,
        destination_site_id: draft.destination_site_id ?? "",
        origin_kind: "DIRECT",
        currency: draft.currency || "IDR",
        notes: draft.notes,
        created_by: actor,
        lines: draft.lines.map((line) => {
          const fields = orderedFields(line, unitBook)
          return {
            article_code:
              line.article_code ??
              `IMPORT-${line.line_id.slice(2, 8).toUpperCase()}`,
            article_name: line.article_name ?? "",
            ordered_quantity: fields.ordered_quantity,
            unit_price_minor: fields.unit_price_minor,
            unit_code: fields.unit_code,
            unit_quantity: fields.unit_quantity,
            order_unit_price_minor: fields.order_unit_price_minor,
            image_url: null,
            division_code: null,
            tags: [],
            promised_date: line.promised_date ?? draft.expected_arrival,
          }
        }),
      })
      return { receipt, poNumber }
    },
    onSuccess: ({ receipt, poNumber }, { draft }) => {
      setCreated((current) => [...current, draft.draft_id])
      // One press can raise several orders (`Buat N PO`), so the receipt
      // gathers everything it minted and stays up until it is read (the
      // owner, 2026-10-04); the next press is the buyer's again once the
      // dialog is dismissed.
      setMade((was) => [
        ...was,
        {
          number: receipt.po_number,
          lines: draft.lines.length,
          recorded: poNumber,
        },
      ])
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
    },
    onError: (error: Error) => {
      setFailure(error.message)
      toast.error(error.message)
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
    },
  })
  /// The orders the presses minted, held in the receipt dialog until read.
  const [made, setMade] = useState<
    readonly {
      readonly number: string
      readonly lines: number
      readonly recorded: string
    }[]
  >([])

  if (drafts.length === 0) {
    return (
      <EmptyState
        action={
          <Button variant="primary" onClick={onDone}>
            Mulai upload lagi
          </Button>
        }
      >
        Tidak ada draf — semua sudah dibuat atau dibuang.
      </EmptyState>
    )
  }

  const pending = drafts.filter((d) => !created.includes(d.draft_id))
  const ready = pending.filter(isCreatable)
  const incomplete = pending.filter((d) => !isCreatable(d))
  const grandMinor = ready.reduce(
    (sum, draft) =>
      sum +
      draft.lines.reduce(
        (lineSum, line) =>
          lineSum + (line.quantity ?? 0) * (line.unit_price_minor ?? 0),
        0
      ),
    0
  )

  return (
    <div className="flex flex-col gap-4">
      <Section title={`Ringkasan import — ${drafts.length} order`}>
        <p className="-mt-2 mb-3 text-[0.875rem] text-mute">
          Periksa setiap order sebelum dibuat. PO hanya dibuat saat tombol di
          bawah ditekan.
        </p>
        <div className="flex flex-col gap-4">
          {drafts.map((draft) => (
            <SummaryDraftCard
              key={draft.draft_id}
              draft={draft}
              created={created.includes(draft.draft_id)}
              creating={
                create.isPending &&
                create.variables?.draft.draft_id === draft.draft_id
              }
              onCreate={() =>
                create.mutate({
                  draft,
                  poNumber:
                    draft.po_number?.trim() ||
                    automaticNumbers.get(draft.draft_id) ||
                    suggestedNumber,
                })
              }
              onFix={() => onFixDraft(draft.draft_id)}
              onChanged={onChanged}
            />
          ))}
        </div>

        {ready.length > 0 && (
          <TotalsLadder
            rows={[
              {
                label: `${ready.length} order siap dibuat`,
                value: `${ready.reduce((n, d) => n + d.lines.length, 0)} baris`,
              },
            ]}
            total={{ label: "Total nilai", value: money(grandMinor) }}
          />
        )}

        {failure !== null && <Banner tone="bad">{failure}</Banner>}

        <div className="flex items-center justify-end gap-2">
          {incomplete.length > 0 && (
            <span className="mr-auto text-[0.875rem] text-mute">
              {incomplete.length} order belum lengkap — selesaikan wizardnya
              dulu sebelum bisa dibuat.
            </span>
          )}
          {created.length > 0 && pending.length === 0 && (
            <Button variant="primary" onClick={onDone}>
              Selesai
            </Button>
          )}
          <Button
            variant="primary"
            pending={create.isPending}
            disabled={ready.length === 0}
            onClick={() =>
              ready.forEach((draft) =>
                create.mutate({
                  draft,
                  poNumber:
                    draft.po_number?.trim() ||
                    automaticNumbers.get(draft.draft_id) ||
                    suggestedNumber,
                })
              )
            }
          >
            <CheckCircle2 className="size-4" />
            Buat {ready.length} PO
          </Button>
        </div>
      </Section>
      <SavedDialog
        open={made.length > 0}
        onOpenChange={(next) => {
          if (!next) setMade([])
        }}
        title={
          made.length === 1 ? (
            <>{made[0].number} dibuat</>
          ) : (
            <>
              {made.length} PO dibuat ·{" "}
              {made.map((one) => one.number).join(", ")}
            </>
          )
        }
      >
        {made.length === 1
          ? `${made[0].lines} baris · tercatat sebagai ${made[0].recorded}.`
          : `${made.reduce((sum, one) => sum + one.lines, 0)} baris · tercatat sebagai ${made.map((one) => one.recorded).join(", ")}.`}
      </SavedDialog>
    </div>
  )
}

function SummaryDraftCard({
  draft,
  created,
  creating,
  onCreate,
  onFix,
  onChanged,
}: {
  draft: EditableDraft
  created: boolean
  creating: boolean
  onCreate: () => void
  onFix: () => void
  onChanged: (draft: EditableDraft) => void
}) {
  const unitBook = useUnits()
  /// Units offerable in the "Satuan" picker: the base and every active unit
  /// whose factor to it is known — the same set an order composed by hand
  /// offers, so import does not let through a unit ordering elsewhere forbids.
  const unitChoices = unitBook.units.filter(
    (one) =>
      one.active &&
      unitFactor(one.code, unitBook.conversions, unitBook.baseUnit) !== null
  )
  const setLine = (
    lineId: string,
    patch: Partial<EditableDraft["lines"][number]>
  ) =>
    onChanged({
      ...draft,
      lines: draft.lines.map((line) =>
        line.line_id === lineId ? { ...line, ...patch } : line
      ),
    })
  const total = draft.lines.reduce(
    (sum, line) => sum + (line.quantity ?? 0) * (line.unit_price_minor ?? 0),
    0
  )

  return (
    <div className="rounded-inner border border-hairline">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-[0.9375rem] font-medium text-ink">
            {draft.supplier_name === null && draft.supplier_id === null ? (
              "Supplier belum ditentukan"
            ) : (
              <SupplierName
                code={draft.supplier_id}
                name={draft.supplier_name}
              />
            )}
          </div>
          <div className="text-[0.875rem] text-mute">
            {draft.source_files.join(", ")} · {draft.lines.length} baris
            {draft.expected_arrival !== null &&
              ` · delivery ${day(draft.expected_arrival)}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {created ? (
            <Pill tone="ok">sudah dibuat</Pill>
          ) : !isCreatable(draft) ? (
            <Pill tone="warn">
              {draft.questions.length > 0
                ? `${draft.questions.length} pertanyaan`
                : "belum lengkap"}
            </Pill>
          ) : (
            <Pill tone="ok">siap</Pill>
          )}
          {!created && !isCreatable(draft) && (
            <Button variant="ghost" onClick={onFix}>
              Lengkapi
            </Button>
          )}
          {!created && (
            <Button
              variant="primary"
              disabled={!isCreatable(draft) || creating}
              onClick={onCreate}
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Submit
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] table-fixed border-collapse text-[0.875rem]">
          <thead>
            <tr>
              <th className={HEAD}>Barang</th>
              <th className={`${HEAD} w-[7rem] text-right`}>Quantity</th>
              <th className={`${HEAD} w-[9rem]`}>Satuan</th>
              <th className={`${HEAD} w-[10rem] text-right`}>Harga</th>
              <th className={`${HEAD} w-[11rem] text-right`}>Jumlah</th>
              <th className={`${HEAD} w-[2.5rem]`} />
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((line) => (
              <tr key={line.line_id}>
                <td className={CELL}>
                  <Input
                    value={line.article_name ?? ""}
                    onChange={(event) =>
                      setLine(line.line_id, {
                        article_name: event.target.value,
                      })
                    }
                    className="h-8 border-transparent bg-transparent"
                  />
                </td>
                <td className={CELL}>
                  <Input
                    type="number"
                    value={line.quantity ?? ""}
                    onChange={(event) =>
                      setLine(line.line_id, {
                        quantity:
                          event.target.value === ""
                            ? null
                            : Number.parseInt(event.target.value, 10),
                      })
                    }
                    className="h-8 border-transparent bg-transparent text-right"
                  />
                </td>
                <td className={CELL}>
                  <Select
                    aria-label="Satuan"
                    value={line.unit_code ?? ""}
                    invalid={needsUnit(line)}
                    onChange={(unit_code) =>
                      setLine(line.line_id, { unit_code })
                    }
                    className="h-8 border-transparent bg-transparent"
                  >
                    {unitChoices.map((unit) => (
                      <option key={unit.code} value={unit.code}>
                        {unit.label}
                      </option>
                    ))}
                  </Select>
                  {needsUnit(line) ? (
                    <div className="mt-0.5 text-[0.875rem] text-bad">
                      Satuan "{line.unit}" belum dikenal — pilih satuan
                    </div>
                  ) : (
                    line.unit && (
                      <div className="mt-0.5 text-[0.875rem] text-mute">
                        tertulis "{line.unit}"
                      </div>
                    )
                  )}
                </td>
                <td className={CELL}>
                  <Input
                    type="number"
                    value={line.unit_price_minor ?? ""}
                    onChange={(event) =>
                      setLine(line.line_id, {
                        unit_price_minor:
                          event.target.value === ""
                            ? null
                            : Number.parseInt(event.target.value, 10),
                      })
                    }
                    className="h-8 border-transparent bg-transparent text-right tabular-nums"
                  />
                </td>
                <td className={`${CELL} text-right tabular-nums`}>
                  {money((line.quantity ?? 0) * (line.unit_price_minor ?? 0))}
                </td>
                <td className={CELL}>
                  <button
                    type="button"
                    aria-label="Buang baris"
                    onClick={() =>
                      onChanged({
                        ...draft,
                        lines: draft.lines.filter(
                          (l) => l.line_id !== line.line_id
                        ),
                      })
                    }
                    className="text-mute hover:text-bad"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[0.875rem] text-mute">{draft.parser_note}</span>
        <span className="text-[0.875rem] font-semibold text-ink tabular-nums">
          {money(total)}
        </span>
      </div>
    </div>
  )
}
