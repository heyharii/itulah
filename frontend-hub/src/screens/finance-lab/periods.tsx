import { Lock, Unlock } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Amount, Cell, Row, Section, Table } from "@/screens/finance-lab/parts"
import { useBook } from "@/screens/finance-lab/state"

/// Period close — the lock, and nothing else.
///
/// A closed month refuses a posting at the door: `Ledger.post` reads the period
/// before it writes anything, so this switch is a control rather than advice.
export function Periods() {
  const b = useBook()
  const periods = b.ledger.allPeriods()
  const entries = b.ledger.allEntries()

  return (
    <PageContent>
      <PageHeader crumb="Finance" title="Period close" />
      <Section title={`${periods.length} periods`}>
        <Table
          head={[
            "Periods",
            "Buku",
            "Status",
            ">Entries",
            ">Value",
            "Closed by",
            "",
          ]}
        >
          {periods.map((p) => {
            const own = entries.filter((e) => e.dates.period === p.period)
            return (
              <Row key={`${p.book_id}/${p.period}`}>
                <Cell mono>{p.period}</Cell>
                <Cell>{p.book_id}</Cell>
                <Cell>
                  <Pill tone={p.status === "CLOSED" ? "bad" : "ok"}>
                    {p.status === "CLOSED" ? "closed" : "open"}
                  </Pill>
                </Cell>
                <Cell right>{own.length}</Cell>
                <Cell right>
                  <Amount minor={own.reduce((n, e) => n + e.total, 0)} muted />
                </Cell>
                <Cell className="text-mute">{p.closed_by ?? "—"}</Cell>
                <Cell>
                  <button
                    type="button"
                    onClick={() => b.setPeriod(p.period, p.status !== "CLOSED")}
                    className="hover:bg-soft-1 inline-flex items-center gap-1.5 rounded-md border border-hairline px-2 py-1 text-[0.75rem] font-medium text-ink"
                  >
                    {p.status === "CLOSED" ? (
                      <>
                        <Unlock className="size-3" /> Buka
                      </>
                    ) : (
                      <>
                        <Lock className="size-3" /> Tutup
                      </>
                    )}
                  </button>
                </Cell>
              </Row>
            )
          })}
        </Table>
      </Section>
    </PageContent>
  )
}
