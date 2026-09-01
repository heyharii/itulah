import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { financeKeys, ROOT_CLASSES, trialBalance } from "@/lib/finance"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { CheckCircle2, TriangleAlert } from "lucide-react"
import { Fragment, useMemo } from "react"

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
export function TrialBalanceScreen() {
  const balance = useQuery({
    queryKey: financeKeys.trialBalance(),
    queryFn: ({ signal }) => trialBalance({}, signal),
  })

  const grouped = useMemo(() => {
    const rows = balance.data?.rows ?? []
    const out = new Map<string, typeof rows>()
    for (const row of rows) {
      out.set(row.root_class, [...(out.get(row.root_class) ?? []), row])
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [balance.data])

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
  return (
    <Frame subtitle={`as at ${balance.data.as_of} · ${balance.data.rows.length} accounts`}>
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-card sticky top-0 border-b">
            <tr className="text-muted-foreground text-[11px]">
              <th className="px-3.5 py-1.5 text-left font-medium">Account</th>
              <th className="px-3 py-1.5 text-left font-medium">Location</th>
              <th className="px-3 py-1.5 text-right font-medium">Debit</th>
              <th className="px-3 py-1.5 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([rootClass, rows]) => (
              <Fragment key={rootClass}>
                <tr className="bg-muted/50">
                  <td colSpan={4} className="px-3.5 py-1 text-[11px] font-medium">
                    {rootClass} · {ROOT_CLASSES[rootClass] ?? "—"}
                  </td>
                </tr>
                {rows.map((row) => (
                  <tr
                    key={`${row.account_code}-${row.site_id}`}
                    className="hover:bg-muted/40 border-b"
                  >
                    <td className="px-3.5 py-1">
                      <Link
                        to="/finance/ledger"
                        search={{ account: row.account_code }}
                        className="flex items-baseline gap-2 hover:underline"
                      >
                        <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
                          {row.account_code}
                        </span>
                        <span className="truncate">{row.name}</span>
                      </Link>
                    </td>
                    <td className="text-muted-foreground px-3 py-1 font-mono text-[11px]">
                      {row.site_id ?? "—"}
                    </td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums">
                      {row.debit_minor === 0 ? "" : money(row.debit_minor)}
                    </td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums">
                      {row.credit_minor === 0 ? "" : money(row.credit_minor)}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot className="bg-card sticky bottom-0 border-t">
            <tr className="text-[12px] font-medium">
              <td className="px-3.5 py-1.5" colSpan={2}>
                Total
              </td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                {money(total_debit_minor)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                {money(total_credit_minor)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Frame>
  )
}

function Frame({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader title="Trial Balance" subtitle={subtitle} />
      {children}
    </AppShell>
  )
}
