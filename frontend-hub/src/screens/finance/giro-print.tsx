import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Printer } from "lucide-react"
import { useEffect, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Banner } from "@/components/ui/states"
import { money } from "@/lib/format"
import {
  createGiroPrintTemplate,
  financeKeys,
  giroPrintTemplates,
  saveGiroPrintTemplate,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { terbilang } from "@/lib/terbilang"
import { cn } from "@/lib/utils"
import type { GiroPrintPlacement, GiroPrintTemplate } from "@itulah/contract"

/// Calibrating the giro leaf.
///
/// # What this screen is for
///
/// A bilyet giro is the bank's paper. It arrives in a booklet with its number,
/// the bank's name and our account already on it, and nine boxes waiting. All a
/// printer does is put nine facts in those boxes — and every bank draws them
/// somewhere slightly different, so the facts have to be moved by hand, in
/// millimetres, against a real leaf, once per bank.
///
/// So this is not a document editor. It is a ruler. You pick a field, nudge it,
/// print onto a blank leaf, hold it to the light, nudge it again. The sample
/// values are deliberately long — the longest payee name and a terbilang line
/// that wraps — because a layout calibrated against "PT ABC" is a layout that
/// overflows the first time somebody is paid.
///
/// # Why the print is the browser's
///
/// No PDF, no server render. `@page` with the leaf's own size and a stylesheet
/// that hides everything else is exactly what a manual-feed office printer
/// wants, and it keeps the thing being calibrated and the thing being printed
/// the same DOM. A server-rendered PDF would be a second layout engine to keep
/// in agreement with this one.
const PRINT_CSS = `
/* No page margin, so the offsets mean what they say.
   A browser's default print margin is about twelve millimetres, and with it the
   leaf starts twelve millimetres in from a corner nobody measured — the numbers
   on screen would be honest about the leaf and wrong about the sheet. With it
   at zero, top_offset_mm and left_offset_mm are the only thing between the
   paper's corner and the leaf, which is what somebody feeding a carrier sheet
   is actually adjusting. */
@page { margin: 0; }
@media print {
  body * { visibility: hidden !important; }
  .giro-leaf, .giro-leaf * { visibility: visible !important; }
  .giro-leaf {
    position: absolute !important;
    left: 0; top: 0;
    box-shadow: none !important;
    border: 0 !important;
    background: transparent !important;
  }
  /* The backdrop is a calibration aid. Printing it would put a photograph of
     a blank giro on top of a real one. */
  .giro-backdrop { display: none !important; }
  /* Nothing that says "this field is selected" belongs on the paper. */
  .giro-field { outline: 0 !important; background: transparent !important; }
}
`

/// What each box is called, and what goes in it while calibrating.
///
/// The order is the order they are read on the leaf, top to bottom, which is
/// also the order the list beside it should offer them.
const FIELDS: readonly {
  code: string
  label: string
  sample: string
}[] = [
  { code: "PLACE_DATE", label: "Tempat & tanggal", sample: "Jambi, 13 September 2026" },
  { code: "ISSUED_ON", label: "Tanggal penarikan", sample: "13-09-2026" },
  { code: "EFFECTIVE_ON", label: "Tanggal efektif", sample: "13-11-2026" },
  {
    code: "PAYEE",
    label: "Nama penerima",
    sample: "PT SUMBER KAIN SEJAHTERA MANDIRI",
  },
  { code: "PAYEE_BANK", label: "Bank penerima", sample: "Bank Mandiri KC Jambi" },
  { code: "PAYEE_ACCOUNT", label: "Rekening penerima", sample: "123-456-7890" },
  { code: "AMOUNT_FIGURES", label: "Jumlah angka", sample: money(2_500_000_000) },
  {
    code: "AMOUNT_WORDS",
    label: "Terbilang",
    sample: `# ${terbilang(2_500_000_000)} #`,
  },
  { code: "NOTE", label: "Berita", sample: "Pelunasan INV-2026-0914" },
]

const labelOf = (code: string) =>
  FIELDS.find((one) => one.code === code)?.label ?? code
const sampleOf = (code: string) =>
  FIELDS.find((one) => one.code === code)?.sample ?? code

export function GiroPrinting() {
  const client = useQueryClient()
  const [selectedBank, setSelectedBank] = useState<string | null>(null)
  const [selectedField, setSelectedField] = useState<string | null>(null)
  /// The layout being nudged. Null means "showing what the server has" — the
  /// same rule the supplier sheet follows, and for the same reason: a separate
  /// `dirty` boolean beside the draft is a second answer to one question.
  const [draft, setDraft] = useState<{
    readonly templateId: string
    readonly placements: readonly GiroPrintPlacement[]
  } | null>(null)
  const [adding, setAdding] = useState(false)
  const [newBank, setNewBank] = useState("")
  const [key, setKey] = useState(() => crypto.randomUUID())

  const templates = useQuery({
    queryKey: financeKeys.giroPrintTemplates(false),
    queryFn: ({ signal }) => giroPrintTemplates(false, signal),
  })

  const rows = templates.data ?? []
  const current: GiroPrintTemplate | undefined =
    rows.find((one) => one.bank_qualifier === selectedBank) ?? rows[0]

  // Land on the first bank once the list arrives, and let go of a draft that
  // belongs to a template nobody is looking at any more.
  useEffect(() => {
    if (current && selectedBank === null) setSelectedBank(current.bank_qualifier)
  }, [current, selectedBank])

  const placements: readonly GiroPrintPlacement[] =
    draft !== null && current && draft.templateId === current.template_id
      ? draft.placements
      : (current?.placements ?? [])

  const nudge = (code: string, patch: Partial<GiroPrintPlacement>) => {
    if (!current) return
    setDraft({
      templateId: current.template_id,
      placements: placements.map((one) =>
        one.field_code === code ? { ...one, ...patch } : one
      ),
    })
  }

  const settled = () => {
    void client.invalidateQueries({
      queryKey: financeKeys.giroPrintTemplates(false),
    })
    setKey(crypto.randomUUID())
  }

  const save = useMutation({
    mutationFn: () =>
      saveGiroPrintTemplate(
        current!.template_id,
        { placements: [...placements] },
        Number(current!.version),
        key
      ),
    onSuccess: () => {
      settled()
      setDraft(null)
    },
  })

  const add = useMutation({
    mutationFn: () =>
      createGiroPrintTemplate(
        { bank_qualifier: newBank.trim(), label: `Bilyet giro ${newBank.trim()}` },
        key
      ),
    onSuccess: (made) => {
      settled()
      setAdding(false)
      setNewBank("")
      setSelectedBank(made.bank_qualifier)
    },
  })

  const selected = placements.find((one) => one.field_code === selectedField)
  const dirty = draft !== null && current && draft.templateId === current.template_id

  return (
    <PageContent>
      <style>{PRINT_CSS}</style>
      <PageHeader
        title="Giro printing"
        sub="Where the words land on each bank's own leaf."
        actions={
          current && (
            <>
              <Button
                variant="ghost"
                onClick={() => window.print()}
                disabled={Boolean(dirty)}
                title={
                  dirty
                    ? "Save first — a test print of an unsaved layout proves nothing"
                    : undefined
                }
              >
                <Printer /> Test print
              </Button>
              <Button
                variant="primary"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Saving…" : "Save layout"}
              </Button>
            </>
          )
        }
      />

      {save.isError && (
        <Banner tone="bad">{(save.error as Error).message}</Banner>
      )}
      {add.isError && <Banner tone="bad">{(add.error as Error).message}</Banner>}

      {queryState(templates, {
        loading: "Reading the templates…",
        render: () => (
          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="flex shrink-0 flex-col gap-3 lg:w-64">
              <Card className="flex flex-col gap-1.5 p-3">
                {rows.length === 0 && (
                  <p className="text-meta text-mute">
                    No bank has a leaf on file, so no giro can be printed.
                  </p>
                )}
                {rows.map((template) => (
                  <button
                    key={template.template_id}
                    type="button"
                    onClick={() => {
                      setSelectedBank(template.bank_qualifier)
                      setSelectedField(null)
                    }}
                    className={cn(
                      "flex items-center justify-between rounded-inner px-2.5 py-1.5 text-left text-control",
                      template.bank_qualifier === current?.bank_qualifier
                        ? "bg-soft-2 text-ink"
                        : "text-body hover:bg-soft-2"
                    )}
                  >
                    <span>{template.bank_qualifier}</span>
                    <span className="font-mono text-[0.65625rem] text-mute">
                      {template.width_mm}×{template.height_mm}
                    </span>
                  </button>
                ))}
                {adding ? (
                  <div className="flex flex-col gap-2 pt-1">
                    <Field
                      label="Bank"
                      hint="As the account map spells it — BCA, MANDIRI."
                    >
                      <Input
                        value={newBank}
                        onChange={(event) => setNewBank(event.target.value)}
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Button
                        variant="soft"
                        className="flex-1"
                        disabled={newBank.trim() === "" || add.isPending}
                        onClick={() => add.mutate()}
                      >
                        {add.isPending ? "Adding…" : "Add it"}
                      </Button>
                      <Button variant="quiet" onClick={() => setAdding(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="quiet"
                    className="mt-1 justify-start"
                    onClick={() => setAdding(true)}
                  >
                    Add a bank
                  </Button>
                )}
              </Card>

              {selected && (
                <Card className="flex flex-col gap-2.5 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-control text-ink">
                      {labelOf(selected.field_code)}
                    </span>
                    <Pill tone="accent">selected</Pill>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Nudge
                      label="x (mm)"
                      value={selected.x_mm}
                      onChange={(x_mm) => nudge(selected.field_code, { x_mm })}
                    />
                    <Nudge
                      label="y (mm)"
                      value={selected.y_mm}
                      onChange={(y_mm) => nudge(selected.field_code, { y_mm })}
                    />
                    <Nudge
                      label="width (mm)"
                      value={selected.width_mm}
                      onChange={(width_mm) =>
                        nudge(selected.field_code, { width_mm })
                      }
                    />
                    <Nudge
                      label="line (mm)"
                      value={selected.line_mm}
                      onChange={(line_mm) =>
                        nudge(selected.field_code, { line_mm })
                      }
                    />
                    <Nudge
                      label="font (pt)"
                      value={selected.font_pt}
                      step={0.5}
                      onChange={(font_pt) =>
                        nudge(selected.field_code, { font_pt })
                      }
                    />
                  </div>
                  <label className="flex items-center gap-2 text-meta text-body">
                    <input
                      type="checkbox"
                      checked={selected.uppercase}
                      onChange={(event) =>
                        nudge(selected.field_code, {
                          uppercase: event.target.checked,
                        })
                      }
                    />
                    Print in capitals
                  </label>
                  <p className="text-meta text-mute">
                    Arrow keys move it a millimetre; hold shift for a tenth.
                  </p>
                </Card>
              )}
            </div>

            {current && (
              <Card className="flex-1 overflow-auto p-4">
                <div
                  className="giro-leaf relative border border-hairline bg-canvas shadow-soft"
                  style={{
                    width: `${current.width_mm}mm`,
                    height: `${current.height_mm}mm`,
                    marginTop: `${current.top_offset_mm}mm`,
                    marginLeft: `${current.left_offset_mm}mm`,
                  }}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (!selected) return
                    const step = event.shiftKey ? 0.1 : 1
                    const moves: Record<string, [number, number]> = {
                      ArrowLeft: [-step, 0],
                      ArrowRight: [step, 0],
                      ArrowUp: [0, -step],
                      ArrowDown: [0, step],
                    }
                    const move = moves[event.key]
                    if (!move) return
                    event.preventDefault()
                    nudge(selected.field_code, {
                      x_mm: round(selected.x_mm + move[0]),
                      y_mm: round(selected.y_mm + move[1]),
                    })
                  }}
                >
                  {current.backdrop_url !== null && (
                    <img
                      src={current.backdrop_url}
                      alt=""
                      className="giro-backdrop pointer-events-none absolute inset-0 h-full w-full object-fill opacity-60"
                    />
                  )}
                  {placements.map((placement) => (
                    <button
                      key={placement.field_code}
                      type="button"
                      onClick={() => setSelectedField(placement.field_code)}
                      className={cn(
                        "giro-field absolute cursor-pointer text-left whitespace-pre-wrap text-ink",
                        placement.field_code === selectedField &&
                          "outline outline-2 outline-accent"
                      )}
                      style={{
                        left: `${placement.x_mm}mm`,
                        top: `${placement.y_mm}mm`,
                        width:
                          placement.width_mm === null
                            ? undefined
                            : `${placement.width_mm}mm`,
                        fontSize: `${placement.font_pt}pt`,
                        lineHeight:
                          placement.line_mm === null
                            ? undefined
                            : `${placement.line_mm}mm`,
                        textTransform: placement.uppercase
                          ? "uppercase"
                          : undefined,
                      }}
                    >
                      {sampleOf(placement.field_code)}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-meta text-mute">
                  Sample values, deliberately the long ones. The number printed
                  on the leaf is the bank's and is never printed by us — it is
                  read off the paper and typed onto the payment.
                </p>
              </Card>
            )}
          </div>
        ),
      })}
    </PageContent>
  )
}

/// A tenth of a millimetre is the smallest move worth making, and the largest
/// leaf this takes is A3's long edge — both held by the CHECKs in `0222`, and
/// repeated here so the input refuses before the request does.
function round(value: number): number {
  return Math.round(value * 10) / 10
}

function Nudge({
  label,
  value,
  step = 0.5,
  onChange,
}: {
  label: string
  value: number | null
  step?: number
  onChange: (value: number | null) => void
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        step={step}
        value={value === null ? "" : String(value)}
        onChange={(event) =>
          onChange(
            event.target.value === ""
              ? null
              : round(Number(event.target.value))
          )
        }
      />
    </Field>
  )
}
