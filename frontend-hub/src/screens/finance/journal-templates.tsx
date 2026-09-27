import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Play } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Panel } from "@/components/ui/dialog"
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, Problem, Receipt } from "@/components/ui/states"
import { count, day, label, money, moment } from "@/lib/format"
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
        crumb="Finance · Setup"
        title="Journal entry templates"
        sub="A manual journal's lines, saved once and started again — by hand, or by a repeat on its date."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            New template
          </Button>
        }
      />

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <Checkbox
            label="Show inactive"
            checked={inactive}
            onChange={setInactive}
          />
        </CardHeader>
        {queryState(templates, {
          loading: "Reading the templates…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No template yet. Save one from the lines of an entry that comes
                back every month.
              </EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th align="right">Lines</Th>
                    <Th align="right">Total</Th>
                    <Th>Saved</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.template_id}
                      onClick={() => setEditing(row)}
                      className="cursor-pointer hover:bg-soft"
                    >
                      <Td>
                        <span className="text-ink">{row.name}</span>
                        {!row.is_active && (
                          <Pill tone="neutral" className="ml-2">
                            Inactive
                          </Pill>
                        )}
                        {row.memo && (
                          <div className="text-mute">{row.memo}</div>
                        )}
                      </Td>
                      <Td align="right">{count(row.lines.length)}</Td>
                      <Td align="right">
                        {templateTotal(row) === 0 ? (
                          <span className="text-faint">
                            Filled in each time
                          </span>
                        ) : (
                          money(templateTotal(row))
                        )}
                      </Td>
                      <Td>
                        <span className="text-faint">
                          {row.created_by} · {moment(row.created_at)}
                        </span>
                      </Td>
                      <Td align="right">
                        <Button
                          size="sm"
                          variant="quiet"
                          disabled={!row.is_active}
                          onClick={(event) => {
                            event.stopPropagation()
                            start(row)
                          }}
                        >
                          <Play />
                          Start a journal
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Grid>
            ),
        })}
      </Card>

      <Repeats templates={templates.data ?? []} />

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
              placeholder="Sewa gedung bulanan"
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
            {save.isPending ? "Saving…" : "Save template"}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Repeats
// ---------------------------------------------------------------------------

function Repeats({ templates }: { templates: readonly JournalTemplate[] }) {
  const client = useQueryClient()
  const repeats = useQuery({
    queryKey: financeKeys.journalRepeats(),
    queryFn: ({ signal }) => listJournalRepeats(signal),
  })
  const [editing, setEditing] = useState<JournalRepeat | "new" | null>(null)

  const run = useMutation({
    mutationFn: runJournalRepeats,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: financeKeys.journalRepeats() })
      // Drafted or posted entries move the register and, when posted, every
      // balance.
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const due = (repeats.data ?? []).filter(
    (row) => row.is_active && row.next_date <= todayIso()
  ).length

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Repeats</CardTitle>
          <span className="flex items-center gap-2">
            <Button
              size="sm"
              pending={run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending
                ? "Running…"
                : due > 0
                  ? `Run ${count(due)} due now`
                  : "Run due now"}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={templates.length === 0}
              onClick={() => setEditing("new")}
            >
              New repeat
            </Button>
          </span>
        </CardHeader>
        <div className="px-4">
          <Problem error={run.error} className="mb-3" />
          {run.isSuccess && (
            <Receipt className="mb-3">
              {count(run.data.drafted)} drafted · {count(run.data.posted)}{" "}
              posted
              {run.data.failed.length > 0 &&
                ` · ${count(run.data.failed.length)} failed: ${run.data.failed.join("; ")}`}
            </Receipt>
          )}
        </div>
        {queryState(repeats, {
          loading: "Reading the repeats…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                Nothing repeats. A repeat raises a template on its date, every
                month, quarter or year.
              </EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th>Template</Th>
                    <Th>Every</Th>
                    <Th>Next</Th>
                    <Th>Until</Th>
                    <Th>Raises</Th>
                    <Th>Last run</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.repeat_id}
                      onClick={() => setEditing(row)}
                      className="cursor-pointer hover:bg-soft"
                    >
                      <Td>
                        <span className="text-ink">{row.template_name}</span>
                        {!row.is_active && (
                          <Pill tone="neutral" className="ml-2">
                            Stopped
                          </Pill>
                        )}
                      </Td>
                      <Td>{label(row.frequency)}</Td>
                      <Td>
                        <span
                          className={
                            row.is_active && row.next_date <= todayIso()
                              ? "font-medium text-warn-fg"
                              : ""
                          }
                        >
                          {day(row.next_date)}
                        </span>
                      </Td>
                      <Td>{row.end_date === null ? "—" : day(row.end_date)}</Td>
                      <Td>
                        {row.auto_post ? (
                          <Pill tone="warn">Posted entry</Pill>
                        ) : (
                          <Pill tone="neutral">Draft</Pill>
                        )}
                      </Td>
                      <Td>
                        {row.last_run_on === null ? (
                          <span className="text-faint">Never</span>
                        ) : (
                          day(row.last_run_on)
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Grid>
            ),
        })}
      </Card>

      {editing !== null && (
        <RepeatForm
          key={editing === "new" ? "new" : editing.repeat_id}
          repeat={editing === "new" ? null : editing}
          templates={templates}
          onDone={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function RepeatForm({
  repeat,
  templates,
  onDone,
}: {
  repeat: JournalRepeat | null
  templates: readonly JournalTemplate[]
  onDone: () => void
}) {
  const client = useQueryClient()
  const [template, setTemplate] = useState(repeat?.template_id ?? "")
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
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-card-title font-semibold text-ink">
          {repeat === null ? "New repeat" : `Repeat of ${repeat.template_name}`}
        </h3>
        <Button size="sm" variant="quiet" onClick={onDone}>
          Close
        </Button>
      </div>
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
            placeholder="No end"
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
          {save.isPending ? "Saving…" : "Save repeat"}
        </Button>
      </div>
    </Card>
  )
}
