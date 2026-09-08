import { AlertTriangle, Check, FlaskConical, X } from "lucide-react"

import { Tag } from "@/components/ui/tag"
import { cn } from "@/lib/utils"
import type { Evidence, JournalEntry, Minor, Readiness } from "@/screens/finance-lab/engine/types"

/// Money for the lab, and why it does not use `lib/format`'s `money`.
///
/// The app's formatter treats a server "minor" as a whole rupiah, because
/// that is what the cloud node sends. The client's own ledger export is to two
/// decimals, so this engine keeps sen — Rp348,276 is 34,827,600 — precisely so
/// that a fixture can be typed straight off their CSV without a conversion
/// step somebody will forget. One divide, here, at the edge.
const fmt = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
})

export function rp(minor: Minor | null | undefined): string {
  if (minor === null || minor === undefined) return "—"
  return fmt.format(minor / 100)
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
  if (muted && !minor) return <span className="text-faint tabular-nums">—</span>
  return <span className={cn("tabular-nums", className)}>{rp(minor)}</span>
}

/// The label that has to be on every surface of this module.
///
/// Not decoration. A screen showing a general ledger that somebody screenshots
/// into a meeting becomes, in that meeting, the general ledger. The distinction
/// between a simulated posting and a real one has to survive being photographed.
export function SimBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-warn-bg px-2 py-0.5 text-[0.6875rem] font-semibold text-warn-fg",
        className
      )}
    >
      <FlaskConical className="size-3" />
      Simulasi
    </span>
  )
}

export function Section({
  title,
  sub,
  right,
  children,
  className,
}: {
  title: React.ReactNode
  sub?: React.ReactNode
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("mb-6", className)}>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-semibold text-ink">{title}</h2>
          {sub && <p className="mt-0.5 text-[0.8125rem] text-body">{sub}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {children}
    </section>
  )
}

export function Panel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[0.8125rem] border border-hairline bg-canvas shadow-soft",
        className
      )}
    >
      {children}
    </div>
  )
}

/// A plain table, styled once.
///
/// Not `components/ui/data-table`: that one wants a `useTable` instance and
/// earns it on a grid somebody sorts and filters. Everything in this module is
/// a fixed list of eight to fifty rows read top to bottom, and wiring a table
/// engine to each would be machinery with no question behind it.
export function Table({
  head,
  children,
  className,
}: {
  head: readonly React.ReactNode[]
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full min-w-[34rem] border-collapse text-[0.8125rem]", className)}>
        <thead>
          <tr className="border-b border-hairline">
            {head.map((h, i) => (
              <th
                key={i}
                className={cn(
                  "px-3 py-2 text-left text-eyebrow font-semibold text-mute uppercase",
                  typeof h === "string" && h.startsWith(">") && "text-right"
                )}
              >
                {typeof h === "string" && h.startsWith(">") ? h.slice(1) : h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Row({
  children,
  tone,
  className,
}: {
  children: React.ReactNode
  tone?: "ok" | "bad" | "warn" | "muted"
  className?: string
}) {
  return (
    <tr
      className={cn(
        "border-b border-hairline/60 last:border-0",
        tone === "bad" && "bg-bad-bg/40",
        tone === "warn" && "bg-warn-bg/40",
        tone === "muted" && "text-mute",
        className
      )}
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
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  right?: boolean
  mono?: boolean
}) {
  return (
    <td
      className={cn(
        "px-3 py-2 align-top",
        right && "text-right tabular-nums",
        mono && "font-mono text-[0.75rem]",
        className
      )}
      {...rest}
    >
      {children}
    </td>
  )
}

/// A pass or a fail, with what was expected when it failed.
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
    <div className="flex items-start gap-2 rounded-lg border border-warn-fg/25 bg-warn-bg/50 px-3 py-2 text-[0.8125rem] text-warn-fg">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

const EVIDENCE_TONE = {
  ACTUAL_JOURNAL: "ok",
  CLIENT_STATEMENT: "info",
  COA_ONLY: "warn",
  PROPOSAL: "neutral",
} as const

const EVIDENCE_LABEL = {
  ACTUAL_JOURNAL: "Jurnal aktual",
  CLIENT_STATEMENT: "Konfirmasi klien",
  COA_ONLY: "COA saja",
  PROPOSAL: "Usulan",
} as const

export function EvidenceTag({ evidence }: { evidence: Evidence }) {
  return <Tag tone={EVIDENCE_TONE[evidence.kind]}>{EVIDENCE_LABEL[evidence.kind]}</Tag>
}

const READY_TONE = { DRAFT: "neutral", VALIDATED: "info", TESTED: "ok" } as const

export function ReadinessTag({ readiness }: { readiness: Readiness }) {
  return <Tag tone={READY_TONE[readiness]}>{readiness.toLowerCase()}</Tag>
}

/// A journal entry as an accountant reads it: the header, then the lines,
/// then the proof it balances.
export function EntryView({ entry }: { entry: JournalEntry }) {
  const debits = entry.lines.reduce((n, l) => n + l.debit, 0)
  const credits = entry.lines.reduce((n, l) => n + l.credit, 0)
  return (
    <Panel>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline bg-soft-1 px-3 py-2">
        <span className="font-mono text-[0.75rem] font-semibold text-ink">{entry.entry_number}</span>
        <Tag tone="accent">{entry.source_kind}</Tag>
        <span className="text-[0.75rem] text-mute">{entry.document_ref}</span>
        <span className="text-[0.75rem] text-mute">posting {entry.dates.posting_on}</span>
        <span className="font-mono text-[0.6875rem] text-faint">{entry.rule_version}</span>
        <SimBadge className="ml-auto" />
      </div>
      <Table head={["Account", "Unit", ">Debit", ">Credit", "Memo"]}>
        {entry.lines.map((l) => (
          <Row key={l.line_no}>
            <Cell>
              <span className="font-mono text-[0.75rem] text-mute">{l.account_code}</span>
              <div className="text-ink">{l.account_name}</div>
              {l.role && <div className="font-mono text-[0.6875rem] text-faint">{l.role}</div>}
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
        <Row className="border-t border-hairline font-semibold">
          <Cell colSpan={2}>
            {debits === credits ? "Balanced" : "DOES NOT BALANCE"}
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
    </Panel>
  )
}
