import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import {
  Amount,
  Cell,
  EntryView,
  Row,
  Section,
  Table,
  count,
  FILTER_W,
} from "@/screens/finance-lab/parts"
import { CloseBoard, type Check } from "@/screens/finance-lab/signature"
import { useBook } from "@/screens/finance-lab/state"

/// Accounting & Close.
///
/// Signature visual is the close board, because the question this menu answers
/// is *may the month be closed* and that is a checklist, not a figure. The one
/// working list underneath is the journal; the trial balance lives on Reports
/// and the periods on Setup, so this page has one job.
const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]

export function LabClose() {
  const b = useBook()
  const [month, setMonth] = useState("2026-07")
  const [kind, setKind] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const tb = b.ledger.trialBalance({ book_id: "CFS" })
  const period = b.ledger.allPeriods().find((p) => p.period === month)
  const entries = b.ledger.allEntries().filter((e) => e.dates.period === month)
  const rows = entries.filter((e) => !kind || e.source_kind === kind)
  const kinds = [
    ...new Set(b.ledger.allEntries().map((e) => e.source_kind)),
  ].sort()

  const unbalanced = entries.filter(
    (e) =>
      e.lines.reduce((n, l) => n + l.debit, 0) !==
      e.lines.reduce((n, l) => n + l.credit, 0)
  )
  const depreciation = b.depreciationEntry("C006", month)
  const drafts = b.payments
    .all()
    .filter((p) => p.status !== "SETTLED" && p.dates.period === month)

  const checks: Check[] = [
    {
      label: "Journal balanced",
      state: unbalanced.length === 0 ? "done" : "todo",
      detail: `${count(entries.length, "entry")}`,
    },
    { label: "Trial balance balanced", state: tb.balanced ? "done" : "todo" },
    {
      label: "Depreciation posted",
      state: depreciation ? "done" : "todo",
      detail: depreciation?.entry_number,
    },
    {
      label: "Payments done",
      state: drafts.length === 0 ? "done" : "partial",
      detail: drafts.length ? `${drafts.length} not yet settle` : undefined,
    },
    { label: "Bank reconciled", state: "partial", detail: "3 lines unmatched" },
    {
      label: "Affiliation agreed both ways",
      state: "todo",
      detail: "head office journal not supplied",
    },
  ]

  const entry = open ? b.ledger.entry(open) : undefined

  return (
    <PageContent>
      <PageHeader
        crumb="Accounting & close"
        title="Period Close"
        actions={
          <div className="flex items-center gap-2">
            <Select value={month} onChange={setMonth} className={FILTER_W}>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
            <Button
              variant="primary"
              disabled={period?.status === "CLOSED"}
              onClick={() => b.setPeriod(month, true)}
            >
              {period?.status === "CLOSED" ? "Closed" : "Close month"}
            </Button>
          </div>
        }
      />

      <Section
        title={`Close readiness ${month}`}
        right={
          <Pill tone={period?.status === "CLOSED" ? "bad" : "ok"}>
            {period?.status === "CLOSED" ? "closed" : "open"}
          </Pill>
        }
      >
        <CloseBoard checks={checks} />
      </Section>

      <Section
        title={`Journal — ${rows.length}`}
        right={
          <Select value={kind} onChange={setKind} className={FILTER_W}>
            <option value="">All sources</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        }
      >
        {rows.length === 0 ? (
          <EmptyState>Nothing has been posted in this period.</EmptyState>
        ) : (
          <Table
            head={["Number", "Date", "Source", "Document", "Rule", ">Total"]}
          >
            {rows.map((e) => (
              <Row key={e.entry_id} className="hover:bg-soft-1 cursor-pointer">
                <Cell mono onClick={() => setOpen(e.entry_id)}>
                  {e.entry_number}
                </Cell>
                <Cell className="whitespace-nowrap">{e.dates.posting_on}</Cell>
                <Cell>
                  <Pill tone="accent">{e.source_kind.toLowerCase()}</Pill>
                </Cell>
                <Cell mono className="text-mute">
                  {e.document_ref}
                </Cell>
                <Cell mono className="text-mute">
                  {e.rule_version}
                </Cell>
                <Cell right>
                  <Amount minor={e.total} />
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={5}>{count(rows.length, "entry")}</Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, e) => n + e.total, 0)} />
              </Cell>
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(entry)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={entry?.memo ?? "Journal"}
        id={entry?.entry_number}
        actions={
          entry && !entry.reverses ? (
            <Button
              onClick={() =>
                b.reverseEntry(entry.entry_id, "2026-09-09", "koreksi")
              }
            >
              Reverse
            </Button>
          ) : undefined
        }
      >
        {entry && <EntryView entry={entry} />}
      </Sheet>
    </PageContent>
  )
}
