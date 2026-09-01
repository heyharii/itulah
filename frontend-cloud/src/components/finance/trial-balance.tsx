import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { trialBalanceColumns } from "@/components/finance/columns"
import { DataGrid, useDataGrid } from "@/components/finance/data-grid"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { Input } from "@/components/ui/input"
import { financeKeys, trialBalance } from "@/lib/finance"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { TrialBalanceRow } from "@itulah/contract"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, Search, TriangleAlert } from "lucide-react"
import { useMemo } from "react"

/// Every account that has been posted to, and the proof that the books hold.
///
/// # Why "balanced" leads
///
/// A trial balance has exactly one job before it has any others: to show that
/// total debits equal total credits. Everything else on the screen is detail
/// about a fact that is either true or catastrophic. So the answer goes at the
/// top, in words, and the server computes it — a browser-side subtraction over
/// a truncated list could say "balanced" about a list it had not finished
/// loading.
///
/// In practice it cannot be false: the database refuses an unbalanced entry
/// with a deferred constraint trigger at COMMIT, so an imbalance here would
/// mean something got past Postgres. That is exactly why it is worth showing —
/// the day it is false is the day somebody needs to know immediately.
///
/// # Why the totals in the foot are the server's and not the visible rows'
///
/// Because filtering the table is a way of looking and never a way of
/// restating the books. A foot that added up whatever was on screen would show
/// a trial balance that does not balance the moment somebody typed "kas" into
/// the box, and would be right to — which is exactly the alarm this screen must
/// never raise by accident.
export function TrialBalanceScreen() {
  const balance = useQuery({
    queryKey: financeKeys.trialBalance(),
    queryFn: ({ signal }) => trialBalance({}, signal),
  })

  const rows = useMemo(() => [...(balance.data?.rows ?? [])], [balance.data])
  const table = useDataGrid({ data: rows, columns: trialBalanceColumns, getRowId: rowId })
  const visible = table.getFilteredRowModel().rows.length

  if (balance.isPending) {
    return (
      <Frame>
        <ScreenState>Adding it up…</ScreenState>
      </Frame>
    )
  }
  if (balance.error !== null) {
    return (
      <Frame>
        <ScreenState tone="problem">
          {balance.error instanceof Error
            ? balance.error.message
            : "could not load the trial balance"}
        </ScreenState>
      </Frame>
    )
  }
  if (balance.data.rows.length === 0) {
    return (
      <Frame subtitle="nothing posted yet">
        <ScreenState>
          No account has been posted to yet, so there is nothing to balance. The first
          entry will appear here the moment it is written.
        </ScreenState>
      </Frame>
    )
  }

  const { total_debit_minor, total_credit_minor, balanced } = balance.data
  const all = balance.data.rows.length
  return (
    <Frame
      subtitle={`as at ${balance.data.as_of} · ${
        visible === all ? `${all} accounts` : `${visible} of ${all} accounts`
      }`}
      onNeedle={(value) => table.getColumn("account_code")?.setFilterValue(value)}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b px-3.5 py-2 text-[12px]",
          balanced ? "text-emerald-700" : "text-destructive",
        )}
      >
        {balanced ? (
          <CheckCircle2 className="size-4 shrink-0" />
        ) : (
          <TriangleAlert className="size-4 shrink-0" />
        )}
        <span>
          {balanced ? (
            <>
              Debits and credits agree at{" "}
              <span className="font-mono font-medium">{money(total_debit_minor)}</span>.
            </>
          ) : (
            <>
              The books do not balance: debits {money(total_debit_minor)}, credits{" "}
              {money(total_credit_minor)}, out by{" "}
              {money(Math.abs(total_debit_minor - total_credit_minor))}. The database
              refuses unbalanced entries, so this needs looking at now.
            </>
          )}
        </span>
      </div>

      <DataGrid
        table={table}
        empty="No account matches that."
        foot={
          <tfoot className="bg-card sticky bottom-0 border-t">
            <tr className="text-[12px] font-medium">
              <td className="px-3.5 py-1.5" colSpan={3}>
                Total{visible === all ? "" : " · every account, not only the visible ones"}
              </td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                {money(total_debit_minor)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                {money(total_credit_minor)}
              </td>
            </tr>
          </tfoot>
        }
      />
    </Frame>
  )
}

/// An account can be posted to at more than one location, and each is its own
/// line — the code alone is not a key here.
function rowId(row: TrialBalanceRow): string {
  return `${row.account_code}-${row.site_id ?? ""}`
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
      <ScreenHeader title="Trial Balance" subtitle={subtitle}>
        {onNeedle !== undefined && (
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
            <Input
              onChange={(event) => onNeedle(event.target.value)}
              placeholder="Code or name…"
              aria-label="Narrow the trial balance"
              className="h-8 w-56 pl-7 text-[13px]"
            />
          </div>
        )}
      </ScreenHeader>
      <ScreenBody>{children}</ScreenBody>
    </AppShell>
  )
}
