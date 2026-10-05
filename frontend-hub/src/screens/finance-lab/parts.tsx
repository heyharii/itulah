import { useState } from "react"
import { AlertTriangle, Check, X } from "lucide-react"

import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import {
  BarSeries,
  LineSeries,
  type ChartRow,
  type ChartSeries,
} from "@/components/ui/chart"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { MiniCell, MiniTable, SubHead } from "@/components/ui/rows"
import { Banner } from "@/components/ui/states"
import { cn } from "@/lib/utils"
import type {
  Evidence,
  JournalEntry,
  Minor,
  Readiness,
} from "@/screens/finance-lab/engine/types"

/// The module's own chrome — and deliberately almost none of it.
///
/// The first cut of this file had a `Panel`, a `Table`, a `Row` and a `Cell`
/// written from scratch, and the screens built on them looked like a different
/// application: no page gutter, no max width, 13px rows against the app's
/// 12.5px, and status shown in `<Tag>`, whose own doc comment says in as many
/// words that it is *not* a status pill.
///
/// That was the same mistake this module was written to avoid, made in CSS
/// instead of in Rust: a second set of primitives that agrees with the first
/// on ordinary days. So everything below now delegates to
/// `components/ui`, and what is left here is only what this module genuinely
/// has that no other screen does — a simulation badge, an evidence tag, and a
/// journal entry rendered the way an accountant reads one.

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/// Money for the lab, and why it does not use `lib/format`'s `money`.
///
/// The app's formatter treats a server "minor" as a whole rupiah, because that
/// is what the cloud node sends. The client's own ledger export is to two
/// decimals, so this engine keeps sen — Rp348,276 is 34,827,600 — precisely so
/// a fixture can be typed straight off their CSV without a conversion step
/// somebody will forget. One divide, here, at the edge.
const fmt = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
})

export function rp(minor: Minor | null | undefined): string {
  if (minor === null || minor === undefined) return "—"
  return fmt.format(minor / 100)
}

/// A count and its noun, agreeing. `count(1, "bill")` is "1 bill".
///
/// Small, and the reason it exists is not smallness: "1 bills past due" on a
/// finance screen reads as machine output, and a reader who notices it starts
/// wondering what else was generated rather than written.
export function count(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? plural(one))}`
}

/// Enough English to cover the nouns this module counts. Anything irregular
/// beyond `person` is passed in explicitly rather than guessed at.
function plural(one: string): string {
  if (one === "person") return "people"
  if (/[^aeiou]y$/.test(one)) return `${one.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/.test(one)) return `${one}es`
  return `${one}s`
}

/// Days, said the way a person says them.
export function days(n: number): string {
  return `${n} ${Math.abs(n) === 1 ? "day" : "days"}`
}

export function Amount({
  minor,
  muted,
  className,
}: {
  minor: Minor | null | undefined
  muted?: boolean
  className?: string
}) {
  if (muted && !minor) return <span className="text-faint">—</span>
  return <span className={cn("tabular-nums", className)}>{rp(minor)}</span>
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/// A titled card. The shape every other screen in this app uses.
export function Section({
  title,
  sub,
  right,
  children,
  className,
  bare,
}: {
  title?: React.ReactNode
  sub?: React.ReactNode
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
  /// The children bring their own padding — a table that should sit flush to
  /// the card's edges rather than inside its gutter.
  bare?: boolean
}) {
  return (
    <Card className={cn("mb-4 overflow-hidden", className)}>
      {title && (
        <CardHeader className={cn(sub && "items-start")}>
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            {sub && <p className="mt-1 text-meta text-body">{sub}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </CardHeader>
      )}
      <div
        className={cn(
          !bare && "px-4 pt-0.5 pb-3.5",
          !title && !bare && "pt-3.5"
        )}
      >
        {children}
      </div>
    </Card>
  )
}

/// A heading one step below a card title, for a block inside a card or sheet.
export { SubHead }

/// Table primitives, mapped onto the app's own.
///
/// `head` keeps this module's `">Column"` convention for a right-aligned
/// column because forty call sites use it; it is translated here into
/// `MiniTable`'s `{label, align}` rather than reimplemented.
export function Table({
  head,
  children,
  className,
}: {
  head: readonly React.ReactNode[]
  children: React.ReactNode
  className?: string
}) {
  const columns = head.map((h) =>
    typeof h === "string"
      ? h.startsWith(">")
        ? { label: h.slice(1), align: "right" as const }
        : { label: h, align: "left" as const }
      : { label: String(h ?? ""), align: "left" as const }
  )
  // Scale the floor with the column count. A fixed 30rem is right for four
  // columns and cripples ten: the browser keeps the table inside the card and
  // squeezes every column instead of letting the container scroll, which is
  // what ran two headings together.
  const floor = Math.max(30, columns.length * 6.5)
  return (
    <div className="overflow-x-auto">
      <MiniTable
        head={columns}
        className={className}
        style={{ minWidth: `${floor}rem` }}
      >
        {children}
      </MiniTable>
    </div>
  )
}

export function Row({
  children,
  tone,
  className,
  ...rest
}: React.HTMLAttributes<HTMLTableRowElement> & {
  children: React.ReactNode
  tone?: "ok" | "bad" | "warn" | "muted" | "total"
}) {
  return (
    <tr
      className={cn(
        "border-t border-hairline",
        tone === "bad" && "bg-bad-bg/40",
        tone === "warn" && "bg-warn-bg/40",
        tone === "muted" && "text-mute",
        // Only the closing row is ink/600 — the rule that makes a total read as
        // a total without a box around it. Same one `TotalsLadder` follows.
        tone === "total" && "font-semibold text-ink",
        className
      )}
      {...rest}
    >
      {children}
    </tr>
  )
}

export function Cell({
  children,
  right,
  mono,
  className,
  colSpan,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  right?: boolean
  mono?: boolean
}) {
  // `colSpan` has to be pulled out by name. It used to travel in `...rest` onto
  // the inner `<div>`, where the browser ignores it — so every totals row in
  // this module drew its figures one or two columns to the left of the ones
  // they total, which is the kind of wrong that looks like a rounding error.
  return (
    <MiniCell
      align={right ? "right" : "left"}
      colSpan={colSpan}
      className={cn(mono && "font-mono text-[0.875rem]", className)}
    >
      {/* A cell that opens something is a button, so it is reached by Tab and
          pressed with Enter like every other control — a clickable `<div>`
          is a mouse-only door. It keeps the cell's own alignment and type. */}
      {rest.onClick ? (
        <button
          type="button"
          {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
          className="block w-full cursor-pointer [text-align:inherit]"
        >
          {children}
        </button>
      ) : (
        <div {...rest}>{children}</div>
      )}
    </MiniCell>
  )
}

// ---------------------------------------------------------------------------
// This module's own marks
// ---------------------------------------------------------------------------

/// A pass or a fail.
export function CheckMark({ pass }: { pass: boolean }) {
  return pass ? (
    <span className="inline-flex size-4 items-center justify-center rounded-full bg-ok-bg text-ok-fg">
      <Check className="size-3" strokeWidth={3} />
    </span>
  ) : (
    <span className="inline-flex size-4 items-center justify-center rounded-full bg-bad-bg text-bad-fg">
      <X className="size-3" strokeWidth={3} />
    </span>
  )
}

/// Why an action cannot be taken, said in place of the action.
///
/// §9 asks that a screen shows the reason rather than a greyed-out button. A
/// disabled button is a dead end; a sentence is a next step.
export function Blocked({ children }: { children: React.ReactNode }) {
  return (
    <Banner tone="warn" className="mb-3">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </Banner>
  )
}

const EVIDENCE_TONE = {
  ACTUAL_JOURNAL: "ok",
  CLIENT_STATEMENT: "info",
  COA_ONLY: "warn",
  PROPOSAL: "neutral",
} as const

const EVIDENCE_LABEL = {
  ACTUAL_JOURNAL: "Journal aktual",
  CLIENT_STATEMENT: "Konfirmasi klien",
  COA_ONLY: "COA saja",
  PROPOSAL: "Usulan",
} as const

export function EvidenceTag({ evidence }: { evidence: Evidence }) {
  return (
    <Pill tone={EVIDENCE_TONE[evidence.kind]}>
      {EVIDENCE_LABEL[evidence.kind]}
    </Pill>
  )
}

const READY_TONE = {
  DRAFT: "neutral",
  VALIDATED: "info",
  TESTED: "ok",
} as const

export function ReadinessTag({ readiness }: { readiness: Readiness }) {
  return <Pill tone={READY_TONE[readiness]}>{readiness.toLowerCase()}</Pill>
}

/// A journal entry as an accountant reads it: the header, then the lines, then
/// the proof it balances.
export function EntryView({ entry }: { entry: JournalEntry }) {
  const debits = entry.lines.reduce((n, l) => n + l.debit, 0)
  const credits = entry.lines.reduce((n, l) => n + l.credit, 0)
  return (
    <Card className="mb-3 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-t-card border-b border-hairline bg-soft px-4 py-2.5">
        <span className="font-mono text-[0.875rem] font-semibold text-ink">
          {entry.entry_number}
        </span>
        <Pill tone="accent">{entry.source_kind}</Pill>
        <span className="text-meta text-mute">{entry.document_ref}</span>
        <span className="text-meta text-mute">
          posting {entry.dates.posting_on}
        </span>
        <span className="font-mono text-eyebrow text-faint">
          {entry.rule_version}
        </span>
      </div>
      <div className="px-4 pt-2 pb-3">
        <Table head={["Account", "Unit", ">Debit", ">Credit", "Memo"]}>
          {entry.lines.map((l) => (
            <Row key={l.line_no}>
              <Cell>
                <span className="font-mono text-[0.875rem] text-mute">
                  {l.account_code}
                </span>
                <div className="text-ink">{l.account_name}</div>
                {l.role && (
                  <div className="font-mono text-eyebrow text-faint">
                    {l.role}
                  </div>
                )}
              </Cell>
              <Cell>{l.unit_id}</Cell>
              <Cell right>
                <Amount minor={l.debit} muted />
              </Cell>
              <Cell right>
                <Amount minor={l.credit} muted />
              </Cell>
              <Cell className="text-body">{l.memo ?? "—"}</Cell>
            </Row>
          ))}
          <Row tone="total">
            <Cell colSpan={2}>
              {debits === credits ? "Balanced" : "OUT OF BALANCE"}
            </Cell>
            <Cell right>
              <Amount minor={debits} />
            </Cell>
            <Cell right>
              <Amount minor={credits} />
            </Cell>
            <Cell />
          </Row>
        </Table>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The shape of a page
// ---------------------------------------------------------------------------

/// Every screen in this module is laid out the same way, and the shape is a
/// rule rather than a habit:
///
///   PageHeader — crumb, title, and the filters and the one primary action
///   ONE band  — a chart if the question is a trend or a composition,
///               a KPI strip if it is not
///   ONE table — the working list, and nothing under it
///   Sheet     — the row, in full
///
/// # Why one table
///
/// A screen with three tables has no subject. The reader has to work out which
/// of the three the page is *about* before they can start, and the answer is
/// usually "the first one, and the other two are context" — which is what a
/// band and a sheet are for. Context above, detail behind, one list in the
/// middle. Anything that wants a second table wants a second menu, and if it
/// does not deserve a menu it does not deserve the table.
///
/// # Why a chart *or* a KPI strip, never both
///
/// They answer the same question — *how are we doing* — in two registers, and
/// stacking them pushes the actual work below the fold. A chart earns its place
/// when the shape over time or the split between parts is the point. When the
/// answer is four numbers, four numbers is the better chart.

/// The filter row, above the card.
///
/// # Why filters are not in the page header
///
/// `<PageHeader>`'s own doc says its actions are "a search box and a CTA on
/// most screens". Four `<Select>`s went in there anyway, and two things broke
/// at once: the heading column collapsed to a few words per line, and — because
/// `<Select>` renders a `w-full` trigger — every filter grew to the full width
/// of the row and the bank became a stack of full-width pills. It looked like a
/// form, not a toolbar.
///
/// So the bank moved here, which is also where `<FilterBar>` says filters
/// belong: above the card, not beside the title. The header keeps the one
/// primary action — and a screen with a single filter keeps that in the header
/// too, because one control beside a button is what the header was drawn for.
export function Filters({
  children,
  right,
  className,
}: {
  children: React.ReactNode
  /// Pinned to the far end — a count, or a "clear" link.
  right?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-2", className)}>
      {children}
      {right && (
        <>
          <span className="flex-1" />
          <span className="text-meta text-mute">{right}</span>
        </>
      )}
    </div>
  )
}

/// A filter control's width.
///
/// Fixed above the small breakpoint, and it has to be: `<Select>`'s trigger is
/// `w-full`, so in a wrapping row without this every one of them claims the
/// whole line and the bank reads as a form. Below it they go full width on
/// purpose — on a phone a stack of edge-to-edge controls is the right shape,
/// and a 10.5rem pill floating in a 375px column is not.
export const FILTER_W = "w-full sm:w-[10.5rem]"

export interface KpiItem {
  readonly label: React.ReactNode
  /// Already formatted. Money goes through `rp`, counts do not.
  readonly value: React.ReactNode
  readonly sub?: React.ReactNode
  readonly tone?: "up" | "down" | "flat"
}

/// The band, when the answer is a handful of numbers.
export function Kpis({
  items,
  className,
}: {
  items: readonly KpiItem[]
  className?: string
}) {
  return (
    <KpiStrip
      className={cn(
        // `KpiStrip`'s own md:3 leaves a four-item strip as three-and-one,
        // which reads as two rows of unrelated boxes. Four wants 2 × 2 until
        // there is room for one line of four.
        items.length === 4 && "md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4",
        items.length === 3 && "md:grid-cols-3 xl:grid-cols-3",
        items.length === 5 && "xl:grid-cols-5",
        className
      )}
    >
      {items.map((k, i) => (
        <Kpi
          key={i}
          label={k.label}
          value={k.value}
          delta={k.sub}
          tone={k.tone}
        />
      ))}
    </KpiStrip>
  )
}

/// The band, when the answer is a shape.
///
/// A bare card rather than a `Section`, because a titled card holding a chart
/// that is itself inside the page's one card is the card-in-card this module
/// keeps being told off for. The heading is the chart's own line of text.
export function ChartBand({
  title,
  right,
  children,
  className,
}: {
  title?: React.ReactNode
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("mb-4 px-4 pt-3.5 pb-3", className)}>
      {(title || right) && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {title && (
            <div className="text-meta font-semibold text-ink">{title}</div>
          )}
          {right && <div className="text-meta text-body">{right}</div>}
        </div>
      )}
      {children}
    </Card>
  )
}

/// Money on a bar chart. `format` and the axis are fixed here so eleven screens
/// cannot each pick their own rounding.
export function MoneyBars({
  rows,
  series,
  stacked,
  labelOf,
  className,
}: {
  rows: readonly ChartRow[]
  series: readonly ChartSeries[]
  stacked?: boolean
  labelOf?: (bucket: string) => string
  className?: string
}) {
  return (
    <BarSeries
      rows={rows}
      series={series}
      stacked={stacked}
      format={(v) => rp(v)}
      titleOf={(b) => b}
      labelOf={labelOf ?? ((b) => b)}
      className={className}
    />
  )
}

/// Money over time.
export function MoneyLine({
  rows,
  dataKey,
  label,
  labelOf,
  className,
}: {
  rows: readonly ChartRow[]
  dataKey: string
  label: string
  labelOf?: (bucket: string) => string
  className?: string
}) {
  return (
    <LineSeries
      rows={rows}
      dataKey={dataKey}
      label={label}
      format={(v) => rp(v)}
      titleOf={(b) => b}
      labelOf={labelOf ?? ((b) => b)}
      className={className}
    />
  )
}

// ---------------------------------------------------------------------------
// Creating something
// ---------------------------------------------------------------------------

export interface FieldSpec {
  readonly name: string
  readonly label: string
  readonly kind?: "text" | "money" | "date" | "select"
  readonly options?: readonly { value: string; label: string }[]
  readonly required?: boolean
  readonly hint?: string
}

/// The form behind every `New …` button in this module.
///
/// # Why one component and not sixteen forms
///
/// Because they are the same shape. Every create in Finance is four to six
/// fields, one of which is money and one of which is a date, followed by a
/// posting the engine either accepts or refuses. Sixteen hand-written forms
/// would be sixteen chances to format money differently.
///
/// # Why it shows what came back
///
/// A create that posts can be refused — a closed period, an unbound role, a
/// rule that is deliberately off. The refusal is the most useful thing on the
/// screen at that moment, so it is shown here rather than swallowed, and the
/// sheet stays open so the entry is not lost.
export function NewRecord({
  open,
  onOpenChange,
  title,
  fields,
  submitLabel = "Submit",
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  fields: readonly FieldSpec[]
  submitLabel?: string
  /// Money fields arrive in minor units. Returns an outcome so a refusal can
  /// be shown; `true` means done.
  onSubmit: (
    values: Record<string, string>,
    minor: Record<string, number>
  ) => { ok: true } | { ok: false; code?: string; message: string }
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)

  const set = (name: string, v: string) =>
    setValues((p) => ({ ...p, [name]: v }))
  const missing = fields.filter((f) => f.required && !values[f.name]?.trim())

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setValues({})
          setProblem(null)
        }
        onOpenChange(o)
      }}
      title={title}
      actions={
        <Button
          variant="primary"
          disabled={missing.length > 0}
          onClick={() => {
            const minor: Record<string, number> = {}
            for (const f of fields) {
              if (f.kind === "money") {
                minor[f.name] = Math.round(
                  Number((values[f.name] ?? "0").replace(/[^\d]/g, "")) * 100
                )
              }
            }
            const out = onSubmit(values, minor)
            if (out.ok) {
              setValues({})
              setProblem(null)
              onOpenChange(false)
            } else {
              setProblem(out.message)
            }
          }}
        >
          {submitLabel}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {fields.map((f) => (
          <Field
            key={f.name}
            label={f.label}
            required={f.required}
            hint={
              f.hint || (f.kind === "money" && values[f.name]) ? (
                <>
                  {f.hint && <span className="block">{f.hint}</span>}
                  {f.kind === "money" && values[f.name] && (
                    <span className="block text-body">
                      {rp(
                        Math.round(
                          Number(values[f.name].replace(/[^\d]/g, "")) * 100
                        )
                      )}
                    </span>
                  )}
                </>
              ) : undefined
            }
          >
            {f.kind === "select" ? (
              <Select
                value={values[f.name] ?? ""}
                onChange={(v) => set(f.name, v)}
              >
                <option value="">Select…</option>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                value={values[f.name] ?? ""}
                onChange={(e) => set(f.name, e.target.value)}
              />
            )}
          </Field>
        ))}
        {problem && (
          <Banner tone="bad">
            <div className="min-w-0">{problem}</div>
          </Banner>
        )}
      </div>
    </Sheet>
  )
}

export interface JournalDraftLine {
  account_code: string
  memo: string
  debit: string
  credit: string
}

/// The grid a manual journal entry is written on.
///
/// # Why the two columns are separate inputs
///
/// A single "amount" plus a side toggle is fewer keystrokes and reads nothing
/// like a journal. An accountant checking this wants to run their eye down the
/// debit column and down the credit column and see two totals agree; a toggle
/// makes that a mental exercise per row.
///
/// # Why it will not let an unbalanced entry through
///
/// The foot states both totals and the difference, and the caller disables the
/// button on it. The engine refuses too — that check lives in `post()`, not
/// here — but a form that lets somebody press a button that cannot work is a
/// form that wastes their time to make a point.
export function JournalGrid({
  lines,
  onChange,
  accountName,
}: {
  lines: readonly JournalDraftLine[]
  onChange: (lines: JournalDraftLine[]) => void
  /// Resolves a code to the client's own name, so a typo is visible while it
  /// is still a typo.
  accountName: (code: string) => string | undefined
}) {
  const set = (i: number, patch: Partial<JournalDraftLine>) =>
    onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const money = (v: string) =>
    Math.round(Number(v.replace(/[^\d]/g, "") || "0") * 100)
  const debit = lines.reduce((n, l) => n + money(l.debit), 0)
  const credit = lines.reduce((n, l) => n + money(l.credit), 0)

  return (
    <div className="flex flex-col gap-2">
      <Table head={["Account", "Description", ">Debit", ">Credit", ""]}>
        {lines.map((l, i) => {
          const name = accountName(l.account_code.trim())
          const unknown = l.account_code.trim().length > 0 && !name
          return (
            <Row key={i} tone={unknown ? "bad" : undefined}>
              <Cell>
                <Input
                  value={l.account_code}
                  onChange={(e) => set(i, { account_code: e.target.value })}
                  className="font-mono text-[0.875rem]"
                />
                <div
                  className={cn(
                    "mt-0.5 text-eyebrow",
                    unknown ? "text-bad-fg" : "text-mute"
                  )}
                >
                  {unknown ? "not in the chart" : (name ?? " ")}
                </div>
              </Cell>
              <Cell>
                <Input
                  value={l.memo}
                  onChange={(e) => set(i, { memo: e.target.value })}
                />
              </Cell>
              <Cell right>
                <Input
                  value={l.debit}
                  onChange={(e) =>
                    set(i, { debit: e.target.value, credit: "" })
                  }
                  className="text-right"
                />
              </Cell>
              <Cell right>
                <Input
                  value={l.credit}
                  onChange={(e) =>
                    set(i, { credit: e.target.value, debit: "" })
                  }
                  className="text-right"
                />
              </Cell>
              <Cell>
                {lines.length > 2 && (
                  <button
                    type="button"
                    onClick={() => onChange(lines.filter((_, k) => k !== i))}
                    className="text-mute hover:text-bad-fg"
                    aria-label="Remove line"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </Cell>
            </Row>
          )
        })}
        <Row tone="total">
          <Cell colSpan={2}>
            {debit === credit
              ? "Balanced"
              : `Out by ${rp(Math.abs(debit - credit))}`}
          </Cell>
          <Cell right>
            <Amount minor={debit} />
          </Cell>
          <Cell right>
            <Amount minor={credit} />
          </Cell>
          <Cell />
        </Row>
      </Table>
      <div>
        <Button
          onClick={() =>
            onChange([
              ...lines,
              { account_code: "", memo: "", debit: "", credit: "" },
            ])
          }
        >
          Add a line
        </Button>
      </div>
    </div>
  )
}

/// A row's worth of small facts, for the top of a sheet.
export function Meta({
  items,
}: {
  items: readonly { label: string; value: React.ReactNode }[]
}) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {items.map((m) => (
        <div key={m.label} className="min-w-0">
          <div className="text-eyebrow font-semibold text-mute uppercase">
            {m.label}
          </div>
          <div className="mt-0.5 text-meta text-ink tabular-nums">
            {m.value}
          </div>
        </div>
      ))}
    </div>
  )
}
