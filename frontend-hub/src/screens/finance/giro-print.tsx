import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Field, Input } from "@/components/ui/field"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { EmptyState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  createGiroPrintTemplate,
  financeKeys,
  giroPrintTemplatesQuery,
  saveGiroPrintTemplate,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useColumnFit } from "@/screens/finance/column-fit"
import { ScreenPending } from "@/screens/finance/pending"
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
  /* The leaf in the sheet is for the eye; the paper gets the copy that stands
     in the page itself, outside the sheet's own box, so the offsets measure
     from the paper's corner and from nothing else. */
  .giro-screen-leaf { display: none !important; }
  .giro-print-only { display: block !important; }
}
.giro-print-only { display: none; }
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
  {
    code: "PLACE_DATE",
    label: "Tempat & tanggal",
    sample: "Jambi, 13 September 2026",
  },
  { code: "ISSUED_ON", label: "Tanggal penarikan", sample: "13-09-2026" },
  { code: "EFFECTIVE_ON", label: "Tanggal efektif", sample: "13-11-2026" },
  {
    code: "PAYEE",
    label: "Nama penerima",
    sample: "PT SUMBER KAIN SEJAHTERA MANDIRI",
  },
  {
    code: "PAYEE_BANK",
    label: "Bank penerima",
    sample: "Bank Mandiri KC Jambi",
  },
  { code: "PAYEE_ACCOUNT", label: "Rekening penerima", sample: "123-456-7890" },
  {
    code: "AMOUNT_FIGURES",
    label: "Jumlah angka",
    sample: money(2_500_000_000),
  },
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

/// One bank per row. On a phone the same columns are the card: the bank over
/// the size of its leaf.
const columns: ColumnDef<TableSetup, GiroPrintTemplate>[] = [
  {
    accessorKey: "bank_qualifier",
    header: "Bank",
    size: 320,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => row.original.bank_qualifier,
  },
  {
    id: "leaf",
    accessorFn: (row) => row.width_mm * row.height_mm,
    header: "Leaf",
    size: 200,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="font-mono text-[0.9375rem] text-mute">
        {row.original.width_mm}×{row.original.height_mm} mm
      </span>
    ),
  },
  {
    id: "fields",
    accessorFn: (row) => row.placements.length,
    header: "Fields",
    size: 130,
    meta: { align: "right", card: "metric", priority: 2 },
    cell: ({ row }) => count(row.original.placements.length),
  },
]

export function GiroPrinting() {
  return (
    <Suspense
      fallback={
        <ScreenPending title="Giro Printing">
          Reading the templates…
        </ScreenPending>
      }
    >
      <GiroPrintingScreen />
    </Suspense>
  )
}

function GiroPrintingScreen() {
  const phone = useLayout() === "phone"
  const client = useQueryClient()
  const [selectedBank, setSelectedBank] = useState<string | null>(null)
  /// The leaf's sheet: open on the bank a row was pressed on.
  const [calibrating, setCalibrating] = useState(false)
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
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])

  const templates = useSuspenseQuery(giroPrintTemplatesQuery())

  const rows = templates.data
  const shown = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return text === ""
      ? rows
      : rows.filter((one) => one.bank_qualifier.toLowerCase().includes(text))
  }, [rows, needle])
  const current: GiroPrintTemplate | undefined =
    rows.find((one) => one.bank_qualifier === selectedBank) ?? undefined

  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: shown,
        columns,
        getRowId: (row: GiroPrintTemplate) => row.template_id,
        state: {
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [shown, sorting, phone, fit]
    )
  )

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
        {
          bank_qualifier: newBank.trim(),
          label: `Bilyet giro ${newBank.trim()}`,
        },
        key
      ),
    onSuccess: (made) => {
      settled()
      setAdding(false)
      setNewBank("")
      setSelectedBank(made.bank_qualifier)
      setSelectedField(null)
      setCalibrating(true)
    },
  })

  const selected = placements.find((one) => one.field_code === selectedField)
  const dirty = Boolean(
    draft !== null && current && draft.templateId === current.template_id
  )

  const leave = () => {
    setCalibrating(false)
    setSelectedField(null)
    setDraft(null)
    save.reset()
  }

  return (
    <PageContent>
      <style>{PRINT_CSS}</style>
      <PageHeader
        title="Giro Printing"
        // On a phone the new bank is the dock's +.
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add a bank
            </Button>
          )
        }
      />

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search banks"
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>
      <Fab label="Add a bank" onClick={() => setAdding(true)} />
      <DockTools
        search={{ value: needle, onChange: setNeedle, label: "Search banks" }}
        sort={dockSortOf(table)}
      />

      {queryState(templates, {
        render: () =>
          rows.length === 0 ? (
            <EmptyState>
              No bank has a leaf on file, so no giro can be printed.
            </EmptyState>
          ) : (
            <div ref={measure}>
              <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                <DataTable<GiroPrintTemplate>
                  table={table}
                  refresh={[templates]}
                  onRowClick={(row) => {
                    setSelectedBank(row.bank_qualifier)
                    setSelectedField(null)
                    setCalibrating(true)
                  }}
                  isSelected={(row) =>
                    calibrating && row.bank_qualifier === selectedBank
                  }
                  empty="No bank matches the search."
                  pageScroll
                  cardsApart
                  cardSort={false}
                />
              </Card>
            </div>
          ),
      })}

      <Sheet
        open={adding}
        onOpenChange={(next) => {
          if (!next) {
            setAdding(false)
            add.reset()
          }
        }}
        title="Add a bank"
        size="rail"
        footer={
          <SheetFooter
            onCancel={() => {
              setAdding(false)
              add.reset()
            }}
            error={add.error}
            primary={{
              label: "Submit",
              pending: add.isPending,
              disabled: newBank.trim() === "",
              onClick: () => add.mutate(),
            }}
          />
        }
      >
        <Field
          label="Bank"
          required
          hint="As the account map spells it — BCA, MANDIRI."
        >
          <Input
            value={newBank}
            onChange={(event) => setNewBank(event.target.value)}
          />
        </Field>
      </Sheet>

      <Sheet
        open={calibrating && current !== undefined}
        onOpenChange={(next) => {
          if (!next) leave()
        }}
        title={current?.bank_qualifier ?? ""}
        caption={
          current === undefined
            ? undefined
            : `${current.width_mm} × ${current.height_mm} mm`
        }
        size="workspace"
        dirty={dirty}
        footer={
          <SheetFooter
            // A test print of an unsaved layout proves nothing, so the Print
            // is only there once the layout is saved.
            onPrint={dirty ? undefined : () => window.print()}
            note={
              dirty
                ? "Save first — a test print of an unsaved layout proves nothing"
                : undefined
            }
            onCancel={leave}
            error={save.error}
            primary={{
              label: "Submit",
              pending: save.isPending,
              disabled: !dirty,
              onClick: () => save.mutate(),
            }}
          />
        }
      >
        {current && (
          <div className="flex flex-col gap-4 lg:flex-row">
            {selected && (
              <Card className="flex shrink-0 flex-col gap-2.5 p-3 lg:w-64 lg:self-start">
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
                    onChange={(x_mm) =>
                      x_mm !== null && nudge(selected.field_code, { x_mm })
                    }
                  />
                  <Nudge
                    label="y (mm)"
                    value={selected.y_mm}
                    onChange={(y_mm) =>
                      y_mm !== null && nudge(selected.field_code, { y_mm })
                    }
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
                      font_pt !== null &&
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

            <Card className="min-w-0 flex-1 overflow-auto p-4">
              <Leaf
                template={current}
                placements={placements}
                selectedField={selectedField}
                onSelect={setSelectedField}
                onMove={(code, x_mm, y_mm) => nudge(code, { x_mm, y_mm })}
                selected={selected}
              />
              <p className="mt-3 text-meta text-mute">
                Sample values, deliberately the long ones. The number printed on
                the leaf is the bank's and is never printed by us — it is read
                off the paper and typed onto the payment.
              </p>
            </Card>
          </div>
        )}
      </Sheet>

      {/* What the printer is given: the same leaf, standing in the page itself
          and drawn only on paper (see `PRINT_CSS`). */}
      {calibrating &&
        current !== undefined &&
        createPortal(
          <Leaf template={current} placements={placements} printOnly />,
          document.body
        )}
    </PageContent>
  )
}

/// One leaf, at its own size in millimetres, with its fields where they are
/// placed. On screen it can be walked with the arrow keys; `printOnly` is the
/// bare copy the printer gets.
function Leaf({
  template,
  placements,
  selectedField = null,
  onSelect,
  onMove,
  selected,
  printOnly = false,
}: {
  template: GiroPrintTemplate
  placements: readonly GiroPrintPlacement[]
  selectedField?: string | null
  onSelect?: (code: string) => void
  onMove?: (code: string, x_mm: number, y_mm: number) => void
  selected?: GiroPrintPlacement
  printOnly?: boolean
}) {
  return (
    <div
      className={cn(
        "giro-leaf relative border border-hairline bg-canvas shadow-soft",
        printOnly ? "giro-print-only" : "giro-screen-leaf"
      )}
      style={{
        width: `${template.width_mm}mm`,
        height: `${template.height_mm}mm`,
        marginTop: `${template.top_offset_mm}mm`,
        marginLeft: `${template.left_offset_mm}mm`,
      }}
      tabIndex={printOnly ? undefined : 0}
      onKeyDown={
        printOnly
          ? undefined
          : (event) => {
              if (!selected || onMove === undefined) return
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
              onMove(
                selected.field_code,
                round(selected.x_mm + move[0]),
                round(selected.y_mm + move[1])
              )
            }
      }
    >
      {!printOnly && template.backdrop_url !== null && (
        <img
          src={template.backdrop_url}
          alt=""
          className="giro-backdrop pointer-events-none absolute inset-0 h-full w-full object-fill opacity-60"
        />
      )}
      {placements.map((placement) => {
        const style: React.CSSProperties = {
          left: `${placement.x_mm}mm`,
          top: `${placement.y_mm}mm`,
          width:
            placement.width_mm === null ? undefined : `${placement.width_mm}mm`,
          fontSize: `${placement.font_pt}pt`,
          lineHeight:
            placement.line_mm === null ? undefined : `${placement.line_mm}mm`,
          textTransform: placement.uppercase ? "uppercase" : undefined,
        }
        return printOnly ? (
          <span
            key={placement.field_code}
            className="giro-field absolute text-left whitespace-pre-wrap text-ink"
            style={style}
          >
            {sampleOf(placement.field_code)}
          </span>
        ) : (
          <button
            key={placement.field_code}
            type="button"
            onClick={() => onSelect?.(placement.field_code)}
            className={cn(
              "giro-field absolute cursor-pointer text-left whitespace-pre-wrap text-ink",
              placement.field_code === selectedField &&
                "outline outline-2 outline-accent"
            )}
            style={style}
          >
            {sampleOf(placement.field_code)}
          </button>
        )
      })}
    </div>
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
            event.target.value === "" ? null : round(Number(event.target.value))
          )
        }
      />
    </Field>
  )
}
