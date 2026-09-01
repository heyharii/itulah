import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { journalColumns } from "@/components/finance/columns"
import { DataGrid, useDataGrid } from "@/components/finance/data-grid"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { Input } from "@/components/ui/input"
import { EntrySheet } from "@/components/sheets/finance/entry-sheet"
import { financeKeys, listJournal } from "@/lib/finance"
import { useEntrySheet } from "@/lib/sheets/finance"
import type { JournalEntryRow } from "@itulah/contract"
import { useQuery } from "@tanstack/react-query"
import { Search } from "lucide-react"
import { useMemo } from "react"

/// Every entry in the books, newest first.
///
/// # Why a reversal is shown as a link and not as a status
///
/// Because both entries are real and both stay. The journal is append-only: a
/// wrong entry is not edited or deleted, it is answered by its mirror. Marking
/// the original "cancelled" would suggest it went away, and it did not — it is
/// still in the ledger, still in the balances up to the reversal date, and
/// still the record of what somebody actually did.
///
/// # Why the lines are not a row of the table
///
/// An opened entry is not another entry. Drawing it as a spanning row under the
/// one that was clicked would put it in the sort order and in the row count,
/// and a table that gains a row when you look at one has stopped describing the
/// journal. It opens in a sheet instead — see `EntrySheet`, which keeps that
/// argument and adds the address an auditor asks an entry for by name.
export function JournalScreen() {
  const sheet = useEntrySheet()
  const entries = useQuery({
    queryKey: financeKeys.journal(),
    queryFn: ({ signal }) => listJournal({ limit: 200 }, signal),
  })

  const rows = useMemo(() => [...(entries.data ?? [])], [entries.data])
  const table = useDataGrid({
    data: rows,
    columns: journalColumns,
    getRowId: rowId,
  })
  const drawn = table.getRowModel().rows
  const visible = table.getFilteredRowModel().rows.length
  /// The register as ids, in the order it is drawn, so the sheet's ↑/↓ walk
  /// what the search narrowed it to.
  const entryIds = drawn.map((row) => row.original.entry_id)

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
          Nothing has been posted yet. Entries appear here as soon as something
          writes one — a supplier bill, a payment, or a correction made by hand.
        </ScreenState>
      </Frame>
    )
  }

  const all = entries.data.length
  return (
    <Frame
      subtitle={
        visible === all ? `${all} entries` : `${visible} of ${all} entries`
      }
      onNeedle={(value) =>
        table.getColumn("entry_number")?.setFilterValue(value)
      }
    >
      <DataGrid
        table={table}
        empty="No entry matches that."
        onRowClick={(row) => sheet.open(row.original.entry_id)}
        rowClassName={(row) =>
          sheet.entryId === row.original.entry_id ? "bg-muted/60" : undefined
        }
      />
      <EntrySheet rows={entryIds} />
    </Frame>
  )
}

function rowId(row: JournalEntryRow): string {
  return row.entry_id
}

function Frame({
  children,
  subtitle,
  onNeedle,
}: {
  children: React.ReactNode
  subtitle?: string
  onNeedle?: (needle: string) => void
}) {
  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader title="Journal Entries" subtitle={subtitle}>
        {onNeedle !== undefined && (
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              onChange={(event) => onNeedle(event.target.value)}
              placeholder="Entry, memo or who posted it…"
              aria-label="Narrow the journal"
              className="h-8 w-64 pl-7 text-[13px]"
              data-os-search=""
            />
          </div>
        )}
      </ScreenHeader>
      <ScreenBody>{children}</ScreenBody>
    </AppShell>
  )
}
