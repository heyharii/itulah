import { ArrowRight } from "lucide-react"

import { AppLink } from "@/components/ui/app-link"
import { Pill } from "@/components/ui/pill"
import { cn } from "@/lib/utils"
import { Amount, rp } from "@/screens/finance-lab/parts"
import type { Minor } from "@/screens/finance-lab/engine/types"

/// One signature visual per menu — the thing that says, in two seconds, what
/// this page is controlling.
///
/// Not one chart per menu. A chart is right where the question is a trend or a
/// composition, and wrong where the question is *which of these is late* or
/// *do these two numbers agree*. The eleven components below are the shapes
/// those other questions actually take, and each one is used by exactly the
/// menus whose mental model it matches.

// ---------------------------------------------------------------------------
// The flow — what a group does, drawn
// ---------------------------------------------------------------------------

export interface FlowStep {
  /// What happens. Two or three words.
  readonly label: string
  /// The state it leaves behind, with its figure. This is what makes the
  /// diagram worth the space: it is the group's numbers laid out in the order
  /// they occur, rather than four boxes in no order at all.
  readonly value?: React.ReactNode
  /// The posting, in the shortest form an accountant reads: `Dr x / Cr y`.
  readonly posts?: string
  /// The screen where this step is done.
  readonly to?: string
  /// Something is stuck here.
  readonly tone?: "ok" | "warn" | "bad"
}

/// A group's work, as a chain.
///
/// # Why a diagram and not a paragraph
///
/// Finance has eleven groups and each one is a sequence: something arrives, it
/// is recognised, it sits as a balance, it is settled. A reader who does not
/// already know that sequence cannot tell from a list of menus which screen
/// comes before which, and the doc comments explaining it are in the source
/// where nobody using the app will look.
///
/// So the sequence is drawn, with the group's own figures on it. It replaces
/// the KPI strip on a group overview rather than sitting beside it: the strip
/// showed four numbers in no particular order, and this shows the same numbers
/// in the order they happen, which is strictly more.
///
/// # Why each step names its posting
///
/// `Dr Inventory / Cr Hutang Supplier` under "Bill arrives" is the one line
/// that turns a workflow picture into an accounting one. It is also checkable:
/// the rule that fires there declares the same two roles, and `conformance`
/// fails the build if the builder disagrees with the declaration.
export function Flow({
  steps,
  className,
}: {
  steps: readonly FlowStep[]
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-stretch gap-y-3", className)}>
      {steps.map((s, i) => {
        const body = (
          <>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "size-[7px] shrink-0 rounded-full",
                  s.tone === "bad" && "bg-bad",
                  s.tone === "warn" && "bg-warn",
                  s.tone === "ok" && "bg-ok",
                  !s.tone && "bg-hairline-2"
                )}
              />
              <span className="text-meta font-semibold text-ink">
                {s.label}
              </span>
            </div>
            {s.value !== undefined && (
              <div className="mt-1 text-[0.9375rem] leading-none font-semibold text-ink tabular-nums">
                {s.value}
              </div>
            )}
            {s.posts && (
              <div className="mt-1.5 font-mono text-eyebrow leading-[1.35] text-mute">
                {s.posts}
              </div>
            )}
          </>
        )
        return (
          <div key={i} className="flex min-w-0 items-stretch">
            {s.to ? (
              <AppLink
                to={s.to}
                className="hover:bg-soft-1 block min-w-[9.5rem] rounded-[0.8125rem] border border-hairline px-3 py-2.5 transition-colors"
              >
                {body}
              </AppLink>
            ) : (
              <div className="min-w-[9.5rem] rounded-[0.8125rem] border border-dashed border-hairline px-3 py-2.5">
                {body}
              </div>
            )}
            {i < steps.length - 1 && (
              <div
                className="flex items-center px-1.5 text-line-ico"
                aria-hidden
              >
                <ArrowRight className="size-3.5" />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// A posting, drawn the way it is taught
// ---------------------------------------------------------------------------

export interface PostingLine {
  readonly account: string
  /// The client's own code, under the name.
  readonly code?: string
  readonly amount: Minor
  readonly note?: string
}

/// What an action will do to the ledger, as two columns.
///
/// # Why two columns and not a table with a Debit and a Credit column
///
/// Because that table has a hole in every row. Half its Debit cells are empty
/// and half its Credit cells are, and the reader's eye has to reassemble which
/// side each line is on before the entry means anything. Debits left, credits
/// right is how double entry is written on paper, taught in every first
/// lesson, and read by anybody who has kept a book — and it makes the one
/// thing that matters visible without arithmetic: the two columns are the same
/// height, or the entry does not post.
///
/// # Why it shows the totals even when there are two lines
///
/// The footer is the claim. An entry that does not balance is refused by the
/// engine, so a reader who sees the two totals agree here knows the button
/// will work — and a reader who sees them differ knows why it will not.
export function Posting({
  debits,
  credits,
  className,
}: {
  readonly debits: readonly PostingLine[]
  readonly credits: readonly PostingLine[]
  className?: string
}) {
  const d = debits.reduce((n, l) => n + l.amount, 0)
  const c = credits.reduce((n, l) => n + l.amount, 0)
  const side = (
    lines: readonly PostingLine[],
    label: string,
    align: "left" | "right"
  ) => (
    <div className="min-w-0 flex-1">
      <div
        className={cn(
          "mb-1.5 font-mono text-eyebrow tracking-[0.04em] text-body uppercase",
          align === "right" && "text-right"
        )}
      >
        {label}
      </div>
      <div className="flex flex-col gap-2">
        {lines.length === 0 ? (
          <div
            className={cn(
              "text-meta text-faint",
              align === "right" && "text-right"
            )}
          >
            —
          </div>
        ) : (
          lines.map((l, i) => (
            <div
              key={i}
              className={cn("min-w-0", align === "right" && "text-right")}
            >
              <div className="text-meta text-ink">{l.account}</div>
              {l.code && (
                <div className="font-mono text-eyebrow text-faint">
                  {l.code}
                </div>
              )}
              <div className="mt-0.5 text-meta font-semibold text-ink tabular-nums">
                {rp(l.amount)}
              </div>
              {l.note && <div className="text-eyebrow text-mute">{l.note}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  )
  return (
    <div
      className={cn(
        "rounded-[0.8125rem] border border-hairline px-3.5 py-3",
        className
      )}
    >
      <div className="flex gap-4">
        {side(debits, "Debit", "left")}
        <div className="w-px shrink-0 bg-hairline" aria-hidden />
        {side(credits, "Credit", "right")}
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-hairline pt-2 text-meta">
        <span className={d === c ? "text-mute" : "font-semibold text-bad-fg"}>
          {d === c ? "Balanced" : "Does not balance"}
        </span>
        <span className="font-semibold text-ink tabular-nums">
          {rp(d)} <span className="text-mute">·</span> {rp(c)}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Aging buckets — Receivables, Payables, in-transit
// ---------------------------------------------------------------------------

export interface Bucket {
  readonly label: string
  readonly amount: Minor
  readonly count?: number
  readonly bad?: boolean
}

/// Horizontal bars sharing one scale, so the eye compares lengths rather than
/// reading five numbers. The widest bucket is the reference; a bucket at zero
/// still draws its row, because a gap in the ladder is information.
export function Aging({
  buckets,
  className,
}: {
  buckets: readonly Bucket[]
  className?: string
}) {
  const max = Math.max(1, ...buckets.map((b) => b.amount))
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {buckets.map((b) => (
        <div key={b.label} className="flex items-center gap-3">
          <span className="w-[7.5rem] shrink-0 text-meta text-body">
            {b.label}
          </span>
          <span className="w-[6.5rem] shrink-0 text-right text-[0.875rem] font-semibold text-ink tabular-nums">
            {rp(b.amount)}
          </span>
          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-soft-2">
            <span
              className={cn(
                "block h-full rounded-full",
                b.bad ? "bg-bad" : "bg-accent"
              )}
              style={{
                width: `${Math.max(b.amount > 0 ? 3 : 0, (b.amount / max) * 100)}%`,
              }}
            />
          </span>
          {b.count !== undefined && (
            <span className="w-8 shrink-0 text-right text-eyebrow text-mute tabular-nums">
              {b.count}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Due timeline — Payables
// ---------------------------------------------------------------------------

export interface DueStop {
  readonly label: string
  readonly amount: Minor
  readonly bad?: boolean
}

/// Money against time, as stops on a line. Answers "when does the pressure
/// arrive", which an aging table can only answer by being read backwards.
export function Runway({
  stops,
  className,
}: {
  stops: readonly DueStop[]
  className?: string
}) {
  const max = Math.max(1, ...stops.map((s) => s.amount))
  return (
    <div className={cn("flex items-end gap-2", className)}>
      {stops.map((s) => (
        <div
          key={s.label}
          className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
        >
          <span className="text-[0.875rem] font-semibold text-ink tabular-nums">
            {rp(s.amount)}
          </span>
          <span
            className={cn(
              "w-full rounded-t-sm",
              s.bad ? "bg-bad" : "bg-accent"
            )}
            style={{ height: `${Math.max(4, (s.amount / max) * 56)}px` }}
          />
          <span className="truncate text-eyebrow text-mute">{s.label}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reconciliation meter — Cash & Bank, Inventory Valuation
// ---------------------------------------------------------------------------

/// Two figures that ought to agree, and the gap between them stated once.
///
/// Deliberately not a single "variance" number: which side is which is the
/// first thing anybody investigating needs, and a lone difference hides it.
export function Mirror({
  leftLabel,
  left,
  rightLabel,
  right,
  action,
  className,
}: {
  leftLabel: string
  left: Minor
  rightLabel: string
  right: Minor
  action?: React.ReactNode
  className?: string
}) {
  const diff = left - right
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-8 gap-y-3", className)}
    >
      <Side label={leftLabel} value={left} />
      <div className="flex flex-col items-center gap-1">
        <ArrowRight className="size-3.5 text-faint" />
        <span className="font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
          variance
        </span>
        <span
          className={cn(
            "text-[1rem] leading-none font-semibold tabular-nums",
            diff === 0 ? "text-ok-fg" : "text-bad-fg"
          )}
        >
          {rp(Math.abs(diff))}
        </span>
      </div>
      <Side label={rightLabel} value={right} />
      {action && <div className="ml-auto">{action}</div>}
    </div>
  )
}

function Side({ label, value }: { label: string; value: Minor }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
        {label}
      </div>
      <div className="mt-1 text-[1.125rem] leading-none font-semibold text-ink tabular-nums">
        {rp(value)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recognition funnel — Accruals
// ---------------------------------------------------------------------------

/// Recognised, then split into settled and still outstanding, then broken down.
/// The shape carries the one idea the menu exists to teach: the cost is already
/// in the profit and loss, and the cash has not left.
export function Funnel({
  recognised,
  settled,
  outstanding,
  parts,
  className,
}: {
  recognised: Minor
  settled: Minor
  outstanding: Minor
  parts: readonly { label: string; amount: Minor }[]
  className?: string
}) {
  const pct = recognised > 0 ? settled / recognised : 0
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <Stat label="Recognised" value={recognised} strong />
        <Stat label="Settled" value={settled} tone="ok" />
        <Stat label="Outstanding" value={outstanding} tone="bad" />
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-soft-2">
        <span className="bg-ok" style={{ width: `${pct * 100}%` }} />
        <span className="bg-warn" style={{ width: `${(1 - pct) * 100}%` }} />
      </div>
      {parts.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {parts.map((p) => (
            <span key={p.label} className="text-meta text-body">
              {p.label}{" "}
              <span className="font-semibold text-ink tabular-nums">
                {rp(p.amount)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  strong,
}: {
  label: string
  value: Minor
  tone?: "ok" | "bad"
  strong?: boolean
}) {
  return (
    <div>
      <div className="font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 leading-none font-semibold tabular-nums",
          strong ? "text-[1.25rem] text-ink" : "text-[1rem]",
          tone === "ok" && "text-ok-fg",
          tone === "bad" && "text-bad-fg",
          !tone && !strong && "text-ink"
        )}
      >
        {rp(value)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Schedule strip — Prepaids
// ---------------------------------------------------------------------------

/// Twelve months as twelve marks. Says "four done, eight to go" without a
/// percentage, and shows *which* months, which a progress bar cannot.
export function Strip({
  months,
  done,
  startMonth,
  className,
}: {
  months: number
  done: number
  /// `YYYY-MM` of the first mark.
  startMonth: string
  className?: string
}) {
  const [y, m] = startMonth.split("-").map(Number)
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {Array.from({ length: months }, (_, i) => {
        const d = new Date(y, m - 1 + i, 1)
        return (
          <span
            key={i}
            title={d.toLocaleDateString("id-ID", {
              month: "short",
              year: "numeric",
            })}
            className={cn(
              "flex h-5 w-7 items-center justify-center rounded-[0.25rem] text-[0.875rem] font-semibold",
              i < done ? "bg-ok-bg text-ok-fg" : "bg-soft-2 text-faint"
            )}
          >
            {d.toLocaleDateString("id-ID", { month: "short" }).slice(0, 3)}
          </span>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Attention queue — Overview
// ---------------------------------------------------------------------------

export interface Attention {
  readonly id: string
  readonly tone: "bad" | "warn" | "info"
  readonly title: string
  readonly amount?: Minor
  readonly action: string
  readonly to?: string
}

export function AttentionBoard({
  items,
  onAct,
  className,
}: {
  items: readonly Attention[]
  onAct?: (item: Attention) => void
  className?: string
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {items.map((i) => (
        <div
          key={i.id}
          className="flex items-center gap-3 border-b border-hairline py-2.5 last:border-0"
        >
          <span
            className={cn(
              "size-[7px] shrink-0 rounded-full",
              i.tone === "bad" && "bg-bad",
              i.tone === "warn" && "bg-warn",
              i.tone === "info" && "bg-info"
            )}
          />
          <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink">
            {i.title}
          </span>
          {i.amount !== undefined && (
            <span className="shrink-0 text-[0.875rem] font-semibold text-ink tabular-nums">
              <Amount minor={i.amount} />
            </span>
          )}
          <button
            type="button"
            onClick={() => onAct?.(i)}
            className="hover:bg-soft-1 shrink-0 rounded-lg border border-hairline bg-canvas px-2.5 py-1 text-[0.875rem] font-semibold text-ink"
          >
            {i.action}
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bridge — Revenue & Margin, Equity
// ---------------------------------------------------------------------------

export interface BridgeRow {
  readonly label: string
  readonly amount: Minor
  readonly kind: "start" | "add" | "less" | "subtotal" | "total"
  readonly note?: string
}

/// A waterfall read as a ladder rather than as floating bars: the arithmetic is
/// the point, and a reader has to be able to check it.
export function Bridge({
  rows,
  className,
}: {
  rows: readonly BridgeRow[]
  className?: string
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {rows.map((r, i) => (
        <div
          key={i}
          className={cn(
            "flex items-baseline justify-between gap-3 py-1.5",
            (r.kind === "subtotal" || r.kind === "total") &&
              "mt-1 border-t border-hairline pt-2"
          )}
        >
          <span
            className={cn(
              "text-[0.875rem]",
              r.kind === "total"
                ? "font-semibold text-ink"
                : r.kind === "subtotal"
                  ? "font-medium text-ink"
                  : "text-body",
              r.kind === "less" && "pl-3"
            )}
          >
            {r.kind === "less" ? `− ${r.label}` : r.label}
            {r.note && (
              <span className="ml-2 text-eyebrow text-mute">{r.note}</span>
            )}
          </span>
          <span
            className={cn(
              "shrink-0 tabular-nums",
              r.kind === "total"
                ? "text-[1rem] font-semibold text-ink"
                : r.kind === "subtotal"
                  ? "font-semibold text-ink"
                  : "text-body"
            )}
          >
            {rp(r.amount)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Maturity ladder — Financing
// ---------------------------------------------------------------------------

export function Ladder({
  buckets,
  className,
}: {
  buckets: readonly Bucket[]
  className?: string
}) {
  const total = Math.max(
    1,
    buckets.reduce((n, b) => n + b.amount, 0)
  )
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex h-3 overflow-hidden rounded-full">
        {buckets.map((b, i) => (
          <span
            key={b.label}
            className={cn(
              "block",
              ["bg-accent", "bg-info", "bg-warn", "bg-mute"][i % 4]
            )}
            style={{ width: `${(b.amount / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {buckets.map((b, i) => (
          <span
            key={b.label}
            className="flex items-center gap-1.5 text-meta text-body"
          >
            <span
              className={cn(
                "size-[7px] rounded-full",
                ["bg-accent", "bg-info", "bg-warn", "bg-mute"][i % 4]
              )}
            />
            {b.label}
            <span className="font-semibold text-ink tabular-nums">
              {rp(b.amount)}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Close board — Accounting & Close
// ---------------------------------------------------------------------------

export interface Check {
  readonly label: string
  readonly state: "done" | "partial" | "todo"
  readonly detail?: string
}

export function CloseBoard({
  checks,
  className,
}: {
  checks: readonly Check[]
  className?: string
}) {
  const done = checks.filter((c) => c.state === "done").length
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex items-center gap-3">
        <span className="text-[1.25rem] leading-none font-semibold text-ink tabular-nums">
          {Math.round((done / checks.length) * 100)}%
        </span>
        <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-soft-2">
          <span
            className="block h-full rounded-full bg-ok"
            style={{ width: `${(done / checks.length) * 100}%` }}
          />
        </span>
        <span className="text-meta text-mute">
          {done} of {checks.length}
        </span>
      </div>
      <div className="flex flex-col">
        {checks.map((c) => (
          <div
            key={c.label}
            className="flex items-center gap-2.5 border-b border-hairline py-2 last:border-0"
          >
            <Pill
              tone={
                c.state === "done"
                  ? "ok"
                  : c.state === "partial"
                    ? "warn"
                    : "neutral"
              }
            >
              {c.state === "done"
                ? "done"
                : c.state === "partial"
                  ? "partial"
                  : "not yet"}
            </Pill>
            <span className="min-w-0 flex-1 text-[0.875rem] text-ink">
              {c.label}
            </span>
            {c.detail && (
              <span className="shrink-0 text-meta text-mute">{c.detail}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Interunit matrix — Affiliation
// ---------------------------------------------------------------------------

export function Matrix({
  units,
  value,
  className,
}: {
  units: readonly string[]
  /// What `row` says it owes `col`. Undefined draws a dash.
  value: (row: string, col: string) => Minor | undefined
  className?: string
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[0.875rem]">
        <thead>
          <tr>
            <th className="pb-1.5 text-left font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
              unit
            </th>
            {units.map((u) => (
              <th
                key={u}
                className="pb-1.5 pl-3 text-right font-mono text-eyebrow tracking-[0.04em] text-body uppercase"
              >
                {u}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {units.map((r) => (
            <tr key={r} className="border-t border-hairline">
              <td className="py-2 font-medium text-ink">{r}</td>
              {units.map((c) => {
                const v = value(r, c)
                return (
                  <td key={c} className="py-2 pl-3 text-right tabular-nums">
                    {r === c ? (
                      <span className="text-faint">—</span>
                    ) : v === undefined || v === 0 ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span className="text-ink">{rp(v)}</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Account cards — Cash & bank
// ---------------------------------------------------------------------------

export interface MoneyAccount {
  readonly id: string
  readonly name: string
  /// `Giro`, `Tabungan`, `Cash` — the client's own distinction, which their
  /// chart keeps as two separate families and which decides what an account is
  /// for: a giro is written against, a savings account holds.
  readonly kind: string
  /// What the bank says. Absent when no statement has been loaded for it.
  readonly statement?: Minor
  /// What the books say. Always present — it is summed from the journal.
  readonly posted: Minor
  /// Statement lines still waiting on somebody.
  readonly pending: number
}

/// The row of account cards a banking screen opens with.
///
/// Deliberately NOT wrapped in a card of its own: cards inside a card is two
/// borders saying the same thing, and the reference this is modelled on
/// (QuickBooks' Bank transactions) puts them straight on the page under the
/// heading. The caller places this before its first `<Section>`.
///
/// Two balances per card, because that pair is the whole of a reconciliation:
/// what the bank thinks, and what we think. A single figure would be whichever
/// one the screen happened to pick, and the gap — the only number that needs
/// work — would not be on the page at all.
export function AccountCards({
  accounts,
  selected,
  onSelect,
  className,
}: {
  accounts: readonly MoneyAccount[]
  selected?: string
  onSelect?: (id: string) => void
  className?: string
}) {
  return (
    <div
      className={cn("mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}
    >
      {accounts.map((a) => {
        const gap = a.statement === undefined ? 0 : a.statement - a.posted
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect?.(a.id)}
            className={cn(
              "rounded-card border px-3.5 py-3 text-left shadow-soft transition-colors",
              selected === a.id
                ? "border-accent bg-accent-bg"
                : "hover:bg-soft-1 border-hairline bg-canvas"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate text-meta text-body">
                {a.name}
              </span>
              {a.pending > 0 && (
                <span className="inline-flex size-[1.125rem] shrink-0 items-center justify-center rounded-full bg-soft-2 text-[0.875rem] font-semibold text-body">
                  {a.pending}
                </span>
              )}
            </div>
            <div className="mt-1.5 text-[1.0625rem] leading-none font-semibold text-ink tabular-nums">
              {a.statement === undefined ? rp(a.posted) : rp(a.statement)}
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <span className="text-eyebrow text-mute">
                {a.statement === undefined ? "Books" : "Bank"}
              </span>
              <span className="text-eyebrow text-mute tabular-nums">
                {a.statement === undefined ? "" : `Books ${rp(a.posted)}`}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Pill
                tone={
                  a.kind === "Giro"
                    ? "info"
                    : a.kind === "Cash"
                      ? "neutral"
                      : "accent"
                }
              >
                {a.kind.toLowerCase()}
              </Pill>
              {a.statement !== undefined && (
                <Pill tone={gap === 0 ? "ok" : "bad"}>
                  {gap === 0 ? "reconciled" : `gap ${rp(Math.abs(gap))}`}
                </Pill>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
