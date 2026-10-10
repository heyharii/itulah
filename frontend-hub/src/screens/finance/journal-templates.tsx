import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Play } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Panel } from "@/components/ui/dialog"
import { Fab } from "@/components/ui/fab"
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, Problem, Receipt } from "@/components/ui/states"
import { count, day, label, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  listJournalRepeats,
  listJournalTemplates,
  runJournalRepeats,
  saveJournalRepeat,
  saveJournalTemplate,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Grid, Td, Th } from "@/screens/finance-final/parts"
import { todayIso } from "@/screens/finance/chart"
import { useCategoriesByFamily } from "@/screens/finance/hooks"
import { JournalLinesGrid } from "@/screens/finance/journal-lines-grid"
import { CardFigure, PhoneList } from "@/components/ui/phone-cards"
import { PhoneChoice } from "@/screens/finance/parts"
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
  const navigate = useNavigate()
  const templates = useQuery({
    queryKey: financeKeys.journalTemplates(),
    queryFn: ({ signal }) => listJournalTemplates(signal),
  })
  const [editing, setEditing] = useState<JournalTemplate | "new" | null>(null)
  const [inactive, setInactive] = useState(false)
  const phone = useLayout() === "phone"
  const client = useQueryClient()
  const repeats = useQuery({
    queryKey: financeKeys.journalRepeats(),
    queryFn: ({ signal }) => listJournalRepeats(signal),
  })
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
    for (const repeat of repeats.data ?? []) {
      const held = table.get(repeat.template_id)
      // An active schedule wins over a stopped one.
      if (held === undefined || (!held.is_active && repeat.is_active))
        table.set(repeat.template_id, repeat)
    }
    return table
  }, [repeats.data])
  const due = (repeats.data ?? []).filter(
    (row) => row.is_active && row.next_date <= todayIso()
  ).length

  const rows = useMemo(
    () => (templates.data ?? []).filter((row) => inactive || row.is_active),
    [templates.data, inactive]
  )

  const start = (template: JournalTemplate) =>
    navigate({
      to: "/finance/accounting/journal-entries",
      search: { journalTemplate: template.template_id },
    } as never)

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Payments"
        title="Recurring Journal"
        sub="Journals that come back on a schedule — accruals, amortisation, allocations. Each posts on its date."
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

      <Problem error={run.error} className="mb-3" />
      {run.isSuccess && (
        <Receipt className="mb-3">
          {count(run.data.drafted)} drafted · {count(run.data.posted)} posted
          {run.data.failed.length > 0 &&
            ` · ${count(run.data.failed.length)} failed: ${run.data.failed.join("; ")}`}
        </Receipt>
      )}

      <div className="mb-3 flex justify-end max-md:hidden">
        <Checkbox
          label="Show stopped"
          checked={inactive}
          onChange={setInactive}
        />
      </div>

      {queryState(templates, {
        loading: "Reading the recurring journals…",
        render: () =>
          rows.length === 0 ? (
            <EmptyState>
              Nothing recurs yet. Save the lines of an entry that comes back
              every month, then give it a schedule.
            </EmptyState>
          ) : phone ? (
            <>
              <PhoneList
                rows={rows.map((row) => {
                  const repeat = repeatOf.get(row.template_id)
                  const late =
                    repeat !== undefined &&
                    repeat.is_active &&
                    repeat.next_date <= todayIso()
                  return {
                    key: row.template_id,
                    title: (
                      <>
                        {row.name}
                        {!row.is_active && (
                          <span className="font-normal text-mute">
                            {" "}
                            · stopped
                          </span>
                        )}
                      </>
                    ),
                    line: row.memo || `${count(row.lines.length)} lines`,
                    lead:
                      templateTotal(row) === 0 ? (
                        <CardFigure value="—" caption="filled in each time" />
                      ) : (
                        <CardFigure value={money(templateTotal(row))} />
                      ),
                    foot: (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setScheduling({
                            repeat: repeat ?? null,
                            template: row.template_id,
                          })
                        }}
                        className="text-left"
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
                                late ? "block text-warn-fg" : "block text-mute"
                              }
                            >
                              Next {day(repeat.next_date)} ·{" "}
                              {repeat.auto_post ? "posts itself" : "as a draft"}
                              {repeat.last_run_on
                                ? ` · last ${day(repeat.last_run_on)}`
                                : ""}
                            </span>
                          </>
                        )}
                      </button>
                    ),
                    action: (
                      <Button
                        variant="tint"
                        size="card"
                        disabled={!row.is_active}
                        onClick={() => start(row)}
                      >
                        Post one now
                      </Button>
                    ),
                    onOpen: () => setEditing(row),
                  }
                })}
              />
              <Button
                className="mt-4 w-full"
                pending={run.isPending}
                onClick={() => run.mutate()}
              >
                {due > 0 ? `Run ${count(due)} due now` : "Run due now"}
              </Button>
            </>
          ) : (
            <Grid>
              <thead>
                <tr>
                  <Th>Journal</Th>
                  <Th align="right" width="10rem">
                    Amount
                  </Th>
                  <Th width="15rem">Schedule</Th>
                  <Th width="9rem">Last run</Th>
                  <Th width="11rem" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const repeat = repeatOf.get(row.template_id)
                  const late =
                    repeat !== undefined &&
                    repeat.is_active &&
                    repeat.next_date <= todayIso()
                  return (
                    <tr
                      key={row.template_id}
                      onClick={() => setEditing(row)}
                      className="cursor-pointer"
                    >
                      <Td className="max-w-0">
                        <span className="block truncate text-ink">
                          {row.name}
                          {!row.is_active && (
                            <span className="text-mute"> · stopped</span>
                          )}
                        </span>
                        <span className="block truncate text-[0.875rem] text-mute">
                          {row.memo || `${count(row.lines.length)} lines`}
                        </span>
                      </Td>
                      <Td align="right">
                        {templateTotal(row) === 0 ? (
                          <span className="text-mute">Filled in each time</span>
                        ) : (
                          money(templateTotal(row))
                        )}
                      </Td>
                      <Td>
                        {/* The schedule is the row's own: one journal, one
                            line, instead of a second table to match it in. */}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            setScheduling({
                              repeat: repeat ?? null,
                              template: row.template_id,
                            })
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
                                    ? "block text-[0.875rem] text-warn-fg"
                                    : "block text-[0.875rem] text-mute"
                                }
                              >
                                Next {day(repeat.next_date)} ·{" "}
                                {repeat.auto_post
                                  ? "posts itself"
                                  : "as a draft"}
                              </span>
                            </>
                          )}
                        </button>
                      </Td>
                      <Td className="text-body">
                        {repeat?.last_run_on ? (
                          day(repeat.last_run_on)
                        ) : (
                          <span className="text-mute">Never</span>
                        )}
                      </Td>
                      <Td align="right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!row.is_active}
                          onClick={(event) => {
                            event.stopPropagation()
                            start(row)
                          }}
                        >
                          <Play />
                          Post one now
                        </Button>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Grid>
          ),
      })}

      <Panel
        open={scheduling !== null}
        onOpenChange={(next) => !next && setScheduling(null)}
        title={scheduling?.repeat ? "Change the schedule" : "Add a schedule"}
      >
        {scheduling !== null && (
          <RepeatForm
            key={scheduling.repeat?.repeat_id ?? `new-${scheduling.template}`}
            repeat={scheduling.repeat}
            forTemplate={scheduling.template}
            templates={templates.data ?? []}
            onDone={() => setScheduling(null)}
          />
        )}
      </Panel>

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
    <Panel
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={template === null ? "New journal entry template" : template.name}
      sub="The lines an entry starts with. Leave a figure blank to fill it in each time."
    >
      <div className="flex flex-col gap-4">
        <Problem error={save.error} />
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
        <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3">
          <span className="text-[0.875rem] text-mute tabular-nums">
            {kept.length === 0
              ? "A row needs an account and a unit to be kept."
              : !balanced
                ? `Debits ${money(totals.debits)} · credits ${money(totals.credits)} — an entry started from it will not post until they agree`
                : `${count(kept.length)} lines kept`}
          </span>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={name.trim() === "" || kept.length === 0}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </div>
    </Panel>
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
    <div className="flex flex-col gap-4">
      <Problem error={save.error} />
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
      <div className="flex justify-end">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={template === "" || next === ""}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </div>
  )
}
