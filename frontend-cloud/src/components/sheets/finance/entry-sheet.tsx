import { SheetShell } from "@/components/sheets/sheet-shell"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { financeKeys, journalEntry } from "@/lib/finance"
import { money } from "@/lib/money"
import { useEntrySheet } from "@/lib/sheets/finance"
import type { JournalEntryRow } from "@itulah/contract"
import { useQuery } from "@tanstack/react-query"

/// One journal entry, down to its lines.
///
/// # Why the lines are still not a row of the table
///
/// The register drew an opened entry underneath itself rather than as a
/// spanning row, and the reason has not changed: an opened entry is not another
/// entry, and a table that gains a row when you look at one has stopped
/// describing the journal. A sheet keeps that true and buys two things the
/// panel under the table could not — an entry has an address, which is what an
/// auditor asks for by name, and ↑/↓ walk the register, which is what checking
/// a day's postings actually is.
///
/// # Why a reversal is a button and not a status
///
/// Because both entries are real and both stay. The journal is append-only: a
/// wrong entry is not edited or deleted, it is answered by its mirror. So the
/// mirror is somewhere to go rather than a word about the entry you are on, and
/// going there is the same sheet moving — the register behind it never moves.
export function EntrySheet({ rows }: { rows: readonly string[] }) {
  const sheet = useEntrySheet()
  const entryId = sheet.entryId
  const detail = useQuery({
    queryKey: financeKeys.entry(entryId ?? ""),
    queryFn: ({ signal }) => journalEntry(entryId ?? "", signal),
    enabled: entryId !== null,
  })
  const entry = detail.data?.entry
  const lines = detail.data?.lines ?? []

  return (
    <SheetShell
      open={entryId !== null}
      onClose={sheet.close}
      title={
        entry === undefined ? (
          <Skeleton className="h-4 w-28" />
        ) : (
          <span className="font-mono">{entry.entry_number}</span>
        )
      }
      subtitle={entry === undefined ? undefined : entry.posting_date}
      description="One journal entry: its sides, what wrote it, and the entry that answers it if one does."
      rows={rows}
      current={entryId}
      onMove={sheet.open}
      className="sm:max-w-2xl"
    >
      {detail.error !== null ? (
        <div className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-xs text-destructive">
            {detail.error instanceof Error
              ? detail.error.message
              : "could not load the entry"}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void detail.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : entry === undefined ? (
        <p className="p-10 text-center text-xs text-muted-foreground">
          Loading the entry…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-3.5 py-2.5">
            <Figure label="Total">{money(entry.total_minor)}</Figure>
            <Figure label="Sides">{entry.line_count}</Figure>
            <Figure label="Source">{entry.source_kind}</Figure>
            <Figure label="Posted by">{entry.posted_by}</Figure>
            <Figure label="Posted">
              {new Date(entry.posted_at).toLocaleString("id-ID")}
            </Figure>
          </div>

          <Mirror entry={entry} onOpen={sheet.open} />

          {entry.memo !== null && entry.memo !== "" && (
            <p className="border-b px-3.5 py-2 text-xs text-muted-foreground italic">
              {entry.memo}
            </p>
          )}

          <table className="w-full text-[12px]">
            <tbody>
              {lines.map((line) => (
                <tr key={line.line_number} className="border-b last:border-0">
                  <td className="w-24 py-1.5 pl-3.5 font-mono text-[10.5px] text-muted-foreground">
                    {line.account_code}
                  </td>
                  {/* The client's own name for the account, never translated. */}
                  <td className="py-1.5 pr-3">{line.account_name}</td>
                  <td className="w-20 py-1.5 font-mono text-[10.5px] text-muted-foreground">
                    {line.site_id}
                  </td>
                  <td className="w-28 py-1.5 text-right font-mono tabular-nums">
                    {line.debit_minor === 0 ? "" : money(line.debit_minor)}
                  </td>
                  <td className="w-28 py-1.5 pr-3.5 text-right font-mono tabular-nums">
                    {line.credit_minor === 0 ? "" : money(line.credit_minor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </SheetShell>
  )
}

/// The entry on the other side of a reversal, as somewhere to go.
///
/// Both directions, because both are asked: an entry that undoes another, and
/// an entry that has been undone. Neither is a status — the original stays in
/// the ledger and stays in the balances up to the reversal date — so this is a
/// button rather than a word, and pressing it moves the sheet rather than the
/// screen behind it.
function Mirror({
  entry,
  onOpen,
}: {
  entry: JournalEntryRow
  onOpen: (entryId: string) => void
}) {
  const reverses = entry.reversal_of
  const reversedBy = entry.reversed_by
  if (reverses === null && reversedBy === null) return null
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2 text-[11.5px]">
      {reverses !== null && (
        <>
          <span className="text-muted-foreground">
            This entry undoes another.
          </span>
          <Button size="sm" variant="outline" onClick={() => onOpen(reverses)}>
            Open the entry it reverses
          </Button>
        </>
      )}
      {reversedBy !== null && (
        <>
          <span className="text-muted-foreground">
            This entry has been answered by its mirror. It stays in the ledger,
            and in the balances up to the reversal date.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpen(reversedBy)}
          >
            Open the reversal
          </Button>
        </>
      )}
    </div>
  )
}

function Figure({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <span className="flex flex-col">
      <span className="text-[10.5px] tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="font-mono text-xs tabular-nums">{children}</span>
    </span>
  )
}
