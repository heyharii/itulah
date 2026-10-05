import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { Printer, Search } from "lucide-react"

import {
  Amount,
  Cell,
  Row,
  Section,
  Table,
  rp,
  count,
  FILTER_W,
  Filters,
} from "@/screens/finance-lab/parts"
import { LedgerPrint, PrintSheet } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"

/// General ledger — one account, every movement, running balance.
///
/// The trial balance answers *which accounts moved*; this answers *why this one
/// did*. Picking an account is the whole interaction, so it is the first
/// control and the table below it is the only other thing on the page.
export function GeneralLedger() {
  const b = useBook()
  const [code, setCode] = useState("")
  const [q, setQ] = useState("")
  const [printing, setPrinting] = useState(false)

  const tb = b.ledger.trialBalance({ book_id: "CFS" })
  const options = tb.rows

  const lines = useMemo(() => {
    if (!code) return []
    const out: {
      entry: string
      on: string
      doc: string
      memo: string
      debit: number
      credit: number
      running: number
    }[] = []
    let running = 0
    for (const e of [...b.ledger.allEntries()].sort((x, y) =>
      x.dates.posting_on.localeCompare(y.dates.posting_on)
    )) {
      for (const l of e.lines) {
        if (l.account_code !== code) continue
        running += l.debit - l.credit
        out.push({
          entry: e.entry_number,
          on: e.dates.posting_on,
          doc: e.document_ref,
          memo: l.memo ?? e.memo ?? "",
          debit: l.debit,
          credit: l.credit,
          running,
        })
      }
    }
    const needle = q.trim().toLowerCase()
    return needle
      ? out.filter((r) =>
          `${r.entry} ${r.doc} ${r.memo}`.toLowerCase().includes(needle)
        )
      : out
  }, [b, code, q])

  const chosen = options.find((o) => o.code === code)

  return (
    <PageContent>
      <PageHeader
        crumb="Reports"
        title="General ledger"
        sub="One account, every movement, running balance."
        actions={
          <Button disabled={!code} onClick={() => setPrinting(true)}>
            <Printer className="size-3.5" />
            Print
          </Button>
        }
      />

      <Filters>
        <Select value={code} onChange={setCode} className={FILTER_W}>
          <option value="">Select account…</option>
          {options.map((o) => (
            <option key={`${o.code}/${o.unit}`} value={o.code}>
              {o.code} — {o.name}
            </option>
          ))}
        </Select>
        <div className={`relative ${FILTER_W}`}>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
      </Filters>

      <Section
        title={chosen ? `${chosen.code} ${chosen.name}` : "Select an account"}
        right={
          chosen ? (
            <span className="text-meta text-mute">
              balance {rp(b.ledger.balance(chosen.code))}
            </span>
          ) : null
        }
      >
        {!code ? (
          <EmptyState>Pick an account to see how it moved.</EmptyState>
        ) : lines.length === 0 ? (
          <EmptyState>No movement matches.</EmptyState>
        ) : (
          <Table
            head={[
              "Date",
              "Journal",
              "Document",
              "Description",
              ">Debit",
              ">Credit",
              ">Balance",
            ]}
          >
            {lines.map((l, i) => (
              <Row key={i}>
                <Cell className="whitespace-nowrap">{l.on}</Cell>
                <Cell mono>{l.entry}</Cell>
                <Cell mono className="text-mute">
                  {l.doc}
                </Cell>
                <Cell className="text-body">{l.memo || "—"}</Cell>
                <Cell right>
                  <Amount minor={l.debit} muted />
                </Cell>
                <Cell right>
                  <Amount minor={l.credit} muted />
                </Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={l.running} />
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={4}>{count(lines.length, "line")}</Cell>
              <Cell right>
                <Amount minor={lines.reduce((n, l) => n + l.debit, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={lines.reduce((n, l) => n + l.credit, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={lines.at(-1)?.running ?? 0} />
              </Cell>
            </Row>
          </Table>
        )}
      </Section>

      <PrintSheet
        open={printing && Boolean(chosen)}
        onOpenChange={setPrinting}
        title={chosen ? `Buku besar ${chosen.code}` : ""}
      >
        {chosen && (
          <LedgerPrint
            account={chosen.name}
            code={chosen.code}
            unit={chosen.unit}
            from={lines[0]?.on ?? "—"}
            to={lines.at(-1)?.on ?? "—"}
            opening={0}
            lines={lines}
          />
        )}
      </PrintSheet>
    </PageContent>
  )
}
