import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { financeKeys, journalEntry, listJournal } from "@/lib/finance"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Undo2 } from "lucide-react"
import { Fragment, useState } from "react"

/// Every entry in the books, newest first.
///
/// # Why a reversal is shown as a link and not as a status
///
/// Because both entries are real and both stay. The journal is append-only: a
/// wrong entry is not edited or deleted, it is answered by its mirror. Marking
/// the original "cancelled" would suggest it went away, and it did not — it is
/// still in the ledger, still in the balances up to the reversal date, and
/// still the record of what somebody actually did.
export function JournalScreen() {
  const [open, setOpen] = useState<string | null>(null)
  const entries = useQuery({
    queryKey: financeKeys.journal(),
    queryFn: ({ signal }) => listJournal({ limit: 200 }, signal),
  })

  if (entries.isPending) {
    return (
      <Frame>
        <ScreenState>Loading the journal…</ScreenState>
      </Frame>
    )
  }
  if (entries.error !== null) {
    return (
      <Frame>
        <ScreenState tone="problem">
          {entries.error instanceof Error
            ? entries.error.message
            : "could not load the journal"}
        </ScreenState>
      </Frame>
    )
  }
  if (entries.data.length === 0) {
    return (
      <Frame subtitle="empty">
        <ScreenState>
          Nothing has been posted yet. Entries appear here as soon as something writes
          one — a supplier bill, a payment, or a correction made by hand.
        </ScreenState>
      </Frame>
    )
  }

  return (
    <Frame subtitle={`${entries.data.length} entries`}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-card sticky top-0 border-b">
            <tr className="text-muted-foreground text-[11px]">
              <th className="px-3.5 py-1.5 text-left font-medium">Entry</th>
              <th className="px-3 py-1.5 text-left font-medium">Date</th>
              <th className="px-3 py-1.5 text-left font-medium">Source</th>
              <th className="px-3 py-1.5 text-left font-medium">Memo</th>
              <th className="px-3 py-1.5 text-right font-medium">Amount</th>
              <th className="px-3 py-1.5 text-left font-medium">By</th>
            </tr>
          </thead>
          <tbody>
            {entries.data.map((entry) => (
              <Fragment key={entry.entry_id}>
                <tr
                  onClick={() =>
                    setOpen((was) => (was === entry.entry_id ? null : entry.entry_id))
                  }
                  className={cn(
                    "hover:bg-muted/40 cursor-pointer border-b",
                    open === entry.entry_id && "bg-muted/60",
                  )}
                >
                  <td className="px-3.5 py-1 font-mono text-[11.5px]">
                    {entry.entry_number}
                  </td>
                  <td className="px-3 py-1 tabular-nums">{entry.posting_date}</td>
                  <td className="px-3 py-1">
                    <span className="bg-muted rounded px-1.5 py-0.5 text-[10.5px]">
                      {entry.source_kind.toLowerCase().replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="text-muted-foreground max-w-0 truncate px-3 py-1">
                    {entry.reversal_of !== null && (
                      <Undo2 className="mr-1 inline size-3 align-[-1px]" />
                    )}
                    {entry.memo ?? ""}
                  </td>
                  <td className="px-3 py-1 text-right font-mono tabular-nums">
                    {money(entry.total_minor, entry.currency)}
                  </td>
                  <td className="text-muted-foreground px-3 py-1">{entry.posted_by}</td>
                </tr>
                {open === entry.entry_id && (
                  <tr>
                    <td colSpan={6} className="bg-muted/30 px-3.5 py-2">
                      <EntryLines entryId={entry.entry_id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  )
}

/// The two or more sides of one entry.
///
/// Fetched when the row is opened rather than sent with the register: a
/// two-hundred-entry list carrying every line is most of a ledger, to show
/// six lines somebody asked for.
function EntryLines({ entryId }: { entryId: string }) {
  const detail = useQuery({
    queryKey: financeKeys.entry(entryId),
    queryFn: ({ signal }) => journalEntry(entryId, signal),
  })

  if (detail.isPending) {
    return <p className="text-muted-foreground text-[11px]">Loading lines…</p>
  }
  if (detail.error !== null) {
    return (
      <p className="text-destructive text-[11px]">
        {detail.error instanceof Error ? detail.error.message : "could not load the lines"}
      </p>
    )
  }
  return (
    <table className="w-full text-[12px]">
      <tbody>
        {detail.data.lines.map((line) => (
          <tr key={line.line_number}>
            <td className="text-muted-foreground w-24 py-0.5 font-mono text-[10.5px]">
              {line.account_code}
            </td>
            {/* The client's own name for the account, never translated. */}
            <td className="py-0.5 pr-3">{line.account_name}</td>
            <td className="text-muted-foreground w-20 py-0.5 font-mono text-[10.5px]">
              {line.site_id}
            </td>
            <td className="w-32 py-0.5 text-right font-mono tabular-nums">
              {line.debit_minor === 0 ? "" : money(line.debit_minor)}
            </td>
            <td className="w-32 py-0.5 text-right font-mono tabular-nums">
              {line.credit_minor === 0 ? "" : money(line.credit_minor)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Frame({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader title="Journal Entries" subtitle={subtitle} />
      {children}
    </AppShell>
  )
}
