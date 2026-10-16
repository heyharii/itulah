import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Play } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Fab } from "@/components/ui/fab"
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { EmptyState, Problem, Receipt } from "@/components/ui/states"
import { count, day, label, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  journalRepeatsQuery,
  journalTemplatesQuery,
  runJournalRepeats,
  saveJournalRepeat,
  saveJournalTemplate,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useColumnFit } from "@/screens/finance/column-fit"
import { todayIso } from "@/screens/finance/chart"
import { useCategoriesByFamily } from "@/screens/finance/hooks"
import { JournalLinesGrid } from "@/screens/finance/journal-lines-grid"
import { PhoneChoice } from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"
import {
  blankLine,
  draftFromTemplate,
  draftTotals,
  templateLinesFrom,
  type DraftLine,
} from "@/screens/finance/journal-lines"
import type { JournalRepeat, JournalTemplate } from "@itulah/contract"

/// Journal Entry Templates, and the repeats that raise them (ERPNext Journal
/// Entry Template and Auto Repeat).
///
/// A template is a manual journal's lines, saved once: rent, the monthly
/// accrual, the insurance amortisation. "Start a journal" opens the Journal
/// Entries composer with its lines filled in, to be checked, dated and posted
/// like any entry. A repeat raises the template on its date — as a draft, or
/// posted when `auto post` is on — and moves the date on; the cloud sweeps
/// due repeats every hour, and "Run due now" does not wait for it.
const FREQUENCIES = ["MONTHLY", "QUARTERLY", "YEARLY"] as const

/// What a template's lines add up to, as the server keeps them.
function templateTotal(template: JournalTemplate): number {
  return template.lines.reduce(
    (sum, line) =>
      sum + (typeof line.debit_minor === "number" ? line.debit_minor : 0),
    0
  )
}

export function JournalTemplates() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Payments"
          title="Recurring Journal"
          className="max-md:hidden"
        >
          Reading the recurring journals…
        </ScreenPending>
      }
    >
      <JournalTemplatesScreen />
    </Suspense>
  )
}

function JournalTemplatesScreen() {
  const navigate = useNavigate()
  const templates = useSuspenseQuery(journalTemplatesQuery())
  const [editing, setEditing] = useState<JournalTemplate | "new" | null>(null)
  const [inactive, setInactive] = useState(false)
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const phone = useLayout() === "phone"
  const client = useQueryClient()
  const repeats = useSuspenseQuery(journalRepeatsQuery())
  /// The schedule being edited: an existing repeat, or a new one for a
  /// template ("Schedule" on a row that has none).
  const [scheduling, setScheduling] = useState<{
    repeat: JournalRepeat | null
    template: string
  } | null>(null)
  const run = useMutation({
    mutationFn: runJournalRepeats,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: financeKeys.journalRepeats() })
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })
  const repeatOf = useMemo(() => {
    const table = new Map<string, JournalRepeat>()
    for (const repeat of repeats.data) {
      const held = table.get(repeat.template_id)
      // An active schedule wins over a stopped one.
      if (held === undefined || (!held.is_active && repeat.is_active))
        table.set(repeat.template_id, repeat)
    }
    return table
  }, [repeats.data])
  const due = repeats.data.filter(
    (row) => row.is_active && row.next_date <= todayIso()
  ).length

  const rows = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return templates.data.filter(
      (row) =>
        (inactive || row.is_active) &&
        (text === "" ||
          row.name.toLowerCase().includes(text) ||
          (row.memo ?? "").toLowerCase().includes(text))
    )
  }, [templates.data, inactive, needle])

  const columns = useMemo<ColumnDef<TableSetup, JournalTemplate>[]>(() => {
    const start = (template: JournalTemplate) =>
      navigate({
        to: "/finance/accounting/journal-entries",
        search: { journalTemplate: template.template_id },
      } as never)
    const schedule = (template: JournalTemplate) => {
      const repeat = repeatOf.get(template.template_id)
      setScheduling({
        repeat: repeat ?? null,
        template: template.template_id,
      })
    }
    return [
      {
        id: "journal",
        accessorFn: (row) => `${row.name} ${row.memo ?? ""}`,
        header: "Journal",
        size: 320,
        meta: { card: "title", grow: 200 },
        cell: ({ row }) => (
          <>
            <span className="block truncate text-ink">
              {row.original.name}
              {!row.original.is_active && (
                <span className="font-normal text-mute"> · stopped</span>
              )}
            </span>
            <span className="block truncate text-[0.9375rem] font-normal text-mute">
              {row.original.memo || `${count(row.original.lines.length)} lines`}
            </span>
          </>
        ),
      },
      {
        id: "amount",
        accessorFn: (row) => templateTotal(row),
        header: "Amount",
        size: 190,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) =>
          templateTotal(row.original) === 0 ? (
            <span className="text-mute">Filled in each time</span>
          ) : (
            money(templateTotal(row.original))
          ),
      },
      {
        id: "schedule",
        accessorFn: (row) => repeatOf.get(row.template_id)?.next_date ?? "",
        header: "Schedule",
        size: 250,
        meta: { card: "metric" },
        // The schedule is the row's own: one journal, one line, instead of a
        // second table to match it in.
        cell: ({ row }) => {
          const repeat = repeatOf.get(row.original.template_id)
          const late =
            repeat !== undefined &&
            repeat.is_active &&
            repeat.next_date <= todayIso()
          return (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                schedule(row.original)
              }}
              className="text-left hover:underline"
            >
              {repeat === undefined ? (
                <span className="text-accent">Add a schedule</span>
              ) : (
                <>
                  <span className="block text-ink">
                    {label(repeat.frequency)}
                    {!repeat.is_active && " · paused"}
                  </span>
                  <span
                    className={
                      late
                        ? "block text-[0.9375rem] text-warn-fg"
                        : "block text-[0.9375rem] text-mute"
                    }
                  >
                    Next {day(repeat.next_date)} ·{" "}
                    {repeat.auto_post ? "posts itself" : "as a draft"}
                  </span>
                </>
              )}
            </button>
          )
        },
      },
      {
        id: "last_run",
        accessorFn: (row) => repeatOf.get(row.template_id)?.last_run_on ?? "",
        header: "Last run",
        size: 130,
        meta: { card: "metric", priority: 2 },
        cell: ({ row }) => {
          const repeat = repeatOf.get(row.original.template_id)
          return (
            <span className="text-body">
              {repeat?.last_run_on ? (
                day(repeat.last_run_on)
              ) : (
                <span className="text-mute">Never</span>
              )}
            </span>
          )
        },
      },
      {
        id: "post",
        header: "",
        size: 190,
        enableSorting: false,
        enableHiding: false,
        meta: { align: "right", card: "status" },
        cell: ({ row }) => (
          <Button
            size={phone ? "card" : "sm"}
            variant={phone ? "tint" : "ghost"}
            disabled={!row.original.is_active}
            onClick={(event) => {
              event.stopPropagation()
              start(row.original)
            }}
          >
            {!phone && <Play />}
            Post one now
          </Button>
        ),
      },
    ]
  }, [navigate, repeatOf, phone])

  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: JournalTemplate) => row.template_id,
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
      [rows, columns, sorting, phone, fit]
    )
  )

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Payments"
        title="Recurring Journal"
        actions={
          <>
            <Button pending={run.isPending} onClick={() => run.mutate()}>
              {due > 0 ? `Run ${count(due)} due now` : "Run due now"}
            </Button>
            <Button variant="primary" onClick={() => setEditing("new")}>
              New recurring journal
            </Button>
          </>
        }
      />

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search recurring journals"
        />
        <Checkbox
          label="Show stopped"
          checked={inactive}
          onChange={setInactive}
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>

      {/* A phone: "Show stopped" is a chip in the dock, the new journal the
          round +, and "Run due now" stands at the foot of the list. */}
      <PhoneChoice
        title="Show"
        value={inactive ? "all" : "running"}
        onChange={(next) => setInactive(next === "all")}
        options={[
          { value: "running", label: "Running", short: "Running" },
          { value: "all", label: "Running and stopped", short: "All" },
        ]}
      />
      <Fab label="New recurring journal" onClick={() => setEditing("new")} />
      <DockTools
        search={{
          value: needle,
          onChange: setNeedle,
          label: "Search recurring journals",
        }}
        sort={dockSortOf(table)}
      />

      <Problem error={run.error} className="mb-3" />
      {run.isSuccess && (
        <Receipt className="mb-3">
          {count(run.data.drafted)} drafted · {count(run.data.posted)} posted
          {run.data.failed.length > 0 &&
            ` · ${count(run.data.failed.length)} failed: ${run.data.failed.join("; ")}`}
        </Receipt>
      )}

      {queryState(templates, {
        render: () =>
          rows.length === 0 ? (
            <EmptyState>
              {needle.trim() === ""
                ? "Nothing recurs yet. Save the lines of an entry that comes back every month, then give it a schedule."
                : "No recurring journal matches the search."}
            </EmptyState>
          ) : (
            <>
              <div ref={measure}>
                <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                  <DataTable<JournalTemplate>
                    table={table}
                    refresh={[templates, repeats]}
                    onRowClick={(row) => setEditing(row)}
                    isSelected={(row) =>
                      editing !== null &&
                      editing !== "new" &&
                      editing.template_id === row.template_id
                    }
                    pageScroll
                    cardsApart
                    cardSort={false}
                    summary={{
                      journal: (
                        <span>
                          {count(rows.length)}{" "}
                          <span className="font-normal text-body">
                            {rows.length === 1 ? "journal" : "journals"}
                          </span>
                        </span>
                      ),
                    }}
                  />
                </Card>
              </div>
              {phone && (
                <Button
                  className="mt-4 w-full"
                  pending={run.isPending}
                  onClick={() => run.mutate()}
                >
                  {due > 0 ? `Run ${count(due)} due now` : "Run due now"}
                </Button>
              )}
            </>
          ),
      })}

      {scheduling !== null && (
        <RepeatForm
          key={scheduling.repeat?.repeat_id ?? `new-${scheduling.template}`}
          repeat={scheduling.repeat}
          forTemplate={scheduling.template}
          templates={templates.data}
          onDone={() => setScheduling(null)}
        />
      )}

      {editing !== null && (
        <TemplateEditor
          key={editing === "new" ? "new" : editing.template_id}
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </PageContent>
  )
}

/// The form: a name, a memo, and the composer's own grid.
///
/// Waits for the category list before it drafts: a template keeps each line's
/// category but not its family, and the family is what draws the picker.
function TemplateEditor({
  template,
  onClose,
}: {
  template: JournalTemplate | null
  onClose: () => void
}) {
  const categories = useCategoriesByFamily()
  if (categories.isPending) return null
  const familyOf = (code: string) =>
    categories.families.find((group) =>
      group.rows.some((row) => row.category_code === code)
    )?.family ?? null
  return (
    <TemplateForm template={template} familyOf={familyOf} onClose={onClose} />
  )
}

function TemplateForm({
  template,
  familyOf,
  onClose,
}: {
  template: JournalTemplate | null
  familyOf: (categoryCode: string) => string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  // Drafted once, when the form opens.
  const [drafted] = useState(() =>
    template === null
      ? { lines: [blankLine(), blankLine()], skipped: 0 }
      : draftFromTemplate(template.lines, familyOf)
  )
  const [name, setName] = useState(template?.name ?? "")
  const [memo, setMemo] = useState(template?.memo ?? "")
  const [active, setActive] = useState(template?.is_active ?? true)
  const [lines, setLines] = useState<DraftLine[]>(drafted.lines)

  const totals = draftTotals(lines)
  const kept = templateLinesFrom(lines)
  const balanced = totals.debits === totals.credits

  const save = useMutation({
    mutationFn: () =>
      saveJournalTemplate({
        template_id: template?.template_id ?? null,
        name: name.trim(),
        memo: memo.trim() === "" ? null : memo.trim(),
        // A template that names role lines keeps them: the grid cannot draw
        // one, and saving must not drop what it could not show.
        lines: [
          ...kept,
          ...(template?.lines ?? []).filter(
            (line) =>
              (line.account as { kind?: string } | undefined)?.kind !==
              "account"
          ),
        ],
        is_active: active,
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: financeKeys.journalTemplates(),
      })
      void client.invalidateQueries({ queryKey: financeKeys.journalRepeats() })
      onClose()
    },
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={template === null ? "New journal entry template" : template.name}
      caption="The lines an entry starts with. Leave a figure blank to fill it in each time."
      size="table"
      footer={
        <SheetFooter
          onCancel={onClose}
          error={save.error}
          note={
            kept.length === 0
              ? "A row needs an account and a unit to be kept."
              : !balanced
                ? `Debits ${money(totals.debits)} · credits ${money(totals.credits)} — an entry started from it will not post until they agree`
                : `${count(kept.length)} lines kept`
          }
          primary={{
            label: "Submit",
            pending: save.isPending,
            disabled: name.trim() === "" || kept.length === 0,
            onClick: () => save.mutate(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {drafted.skipped > 0 && (
          <Receipt>
            {count(drafted.skipped)} line
            {drafted.skipped === 1
              ? " names a posting role"
              : "s name a posting role"}{" "}
            rather than an account.{" "}
            {drafted.skipped === 1 ? "It is" : "They are"} kept as saved, and
            not drawn here.
          </Receipt>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Memo">
            <Input
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
            />
          </Field>
        </div>
        <JournalLinesGrid lines={lines} onChange={setLines} />
        <Checkbox label="Active" checked={active} onChange={setActive} />
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Repeats
// ---------------------------------------------------------------------------

function RepeatForm({
  repeat,
  forTemplate,
  templates,
  onDone,
}: {
  repeat: JournalRepeat | null
  /// The template a new schedule is for, chosen already.
  forTemplate?: string
  templates: readonly JournalTemplate[]
  onDone: () => void
}) {
  const client = useQueryClient()
  const [template, setTemplate] = useState(
    repeat?.template_id ?? forTemplate ?? ""
  )
  const [frequency, setFrequency] = useState(repeat?.frequency ?? "MONTHLY")
  const [next, setNext] = useState(repeat?.next_date ?? "")
  const [end, setEnd] = useState(repeat?.end_date ?? "")
  const [autoPost, setAutoPost] = useState(repeat?.auto_post ?? false)
  const [active, setActive] = useState(repeat?.is_active ?? true)

  const save = useMutation({
    mutationFn: () =>
      saveJournalRepeat({
        repeat_id: repeat?.repeat_id ?? null,
        template_id: template,
        frequency,
        next_date: next,
        end_date: end === "" ? null : end,
        auto_post: autoPost,
        is_active: active,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: financeKeys.journalRepeats() })
      onDone()
    },
  })

  const choices = templates.filter(
    (one) => one.is_active || one.template_id === template
  )

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onDone()
      }}
      title={repeat ? "Change the schedule" : "Add a schedule"}
      size="rail"
      footer={
        <SheetFooter
          onCancel={onDone}
          error={save.error}
          primary={{
            label: "Submit",
            pending: save.isPending,
            disabled: template === "" || next === "",
            onClick: () => save.mutate(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Template" required>
          <Select value={template} onChange={setTemplate}>
            <option value="">Choose a template</option>
            {choices.map((one) => (
              <option key={one.template_id} value={one.template_id}>
                {one.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Every">
          <Select value={frequency} onChange={setFrequency}>
            {FREQUENCIES.map((one) => (
              <option key={one} value={one}>
                {label(one)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Next date" required>
            <Day value={next} onChange={setNext} label="Next date" />
          </Field>
          <Field label="Until">
            <Day
              value={end}
              onChange={setEnd}
              notBefore={next || null}
              label="Until"
            />
          </Field>
        </div>
        <Checkbox
          label="Post it automatically"
          hint="Off, the repeat raises a draft somebody checks and posts. On, the entry is posted on its date without anybody looking."
          checked={autoPost}
          onChange={setAutoPost}
        />
        <Checkbox label="Active" checked={active} onChange={setActive} />
      </div>
    </Sheet>
  )
}
