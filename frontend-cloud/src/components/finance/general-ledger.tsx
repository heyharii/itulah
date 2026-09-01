import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { Input } from "@/components/ui/input"
import { accountLedger, financeKeys, searchAccounts } from "@/lib/finance"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { useState } from "react"

/// One account's movements, with the balance walking down them.
///
/// # Why the account is in the URL
///
/// Because "look at what happened in cash at store 07 last month" is a thing
/// one person sends another. Holding the account in component state would make
/// every such conversation a set of instructions — open the ledger, search for
/// this, click that — instead of a link.
///
/// # Why an opening balance is shown even when it is zero
///
/// Without it the first figure in the running column is a movement wearing a
/// balance's clothes. A reader who scrolled in from the middle of a busy
/// account would take it for the account's position on that date, and be wrong
/// by everything that happened before the window.
export function GeneralLedgerScreen() {
  const search = useSearch({ strict: false }) as { account?: string }
  const navigate = useNavigate()
  const code = search.account ?? null
  const [needle, setNeedle] = useState("")

  const pick = (account: string) => {
    setNeedle("")
    void navigate({ to: "/finance/ledger", search: { account } })
  }

  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader title="General Ledger" subtitle={code ?? undefined}>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Which account?"
            aria-label="Find an account"
            className="h-8 w-64 pl-7 text-[13px]"
          />
          {needle.trim().length >= 2 && (
            <AccountSuggestions needle={needle.trim()} onPick={pick} />
          )}
        </div>
      </ScreenHeader>

      {code === null ? (
        <ScreenState>
          Pick an account to see its movements. A heading works too — asking for{" "}
          <span className="font-mono">1011001</span> gives cash across all fourteen
          locations, because the client's codes are a tree and this matches by prefix.
        </ScreenState>
      ) : (
        <Movements code={code} />
      )}
    </AppShell>
  )
}

function AccountSuggestions({
  needle,
  onPick,
}: {
  needle: string
  onPick: (code: string) => void
}) {
  const hits = useQuery({
    queryKey: ["finance", "ledger-picker", needle],
    queryFn: ({ signal }) => searchAccounts(needle, { limit: 20 }, signal),
  })
  if (hits.data === undefined || hits.data.length === 0) return null
  return (
    <ul className="bg-card absolute top-9 right-0 z-20 max-h-72 w-96 overflow-y-auto rounded-md border shadow-md">
      {hits.data.map((account) => (
        <li key={account.account_code}>
          <button
            type="button"
            onClick={() => onPick(account.account_code)}
            className="hover:bg-muted flex w-full items-baseline gap-2 px-2 py-1 text-left text-[12px]"
          >
            <span className="text-muted-foreground shrink-0 font-mono text-[10.5px]">
              {account.account_code}
            </span>
            <span className="truncate">{account.name}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Movements({ code }: { code: string }) {
  const ledger = useQuery({
    queryKey: financeKeys.ledger(code),
    queryFn: ({ signal }) => accountLedger(code, {}, signal),
  })

  if (ledger.isPending) {
    return <ScreenState>Loading movements…</ScreenState>
  }
  if (ledger.error !== null) {
    return (
      <ScreenState tone="problem">
        {ledger.error instanceof Error ? ledger.error.message : "could not load the ledger"}
      </ScreenState>
    )
  }

  const { account_name, from, to, opening_minor, closing_minor, rows } = ledger.data
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-baseline justify-between gap-3 border-b px-3.5 py-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">{account_name}</p>
          <p className="text-muted-foreground text-[11px]">
            {from} to {to}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-sm tabular-nums">{money(closing_minor)}</p>
          <p className="text-muted-foreground text-[11px]">
            opened at {money(opening_minor)}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <ScreenState>
          Nothing was posted to this account between {from} and {to}. It stood at{" "}
          {money(opening_minor)} throughout.
        </ScreenState>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-card sticky top-0 border-b">
              <tr className="text-muted-foreground text-[11px]">
                <th className="px-3.5 py-1.5 text-left font-medium">Date</th>
                <th className="px-3 py-1.5 text-left font-medium">Entry</th>
                <th className="px-3 py-1.5 text-left font-medium">Memo</th>
                <th className="px-3 py-1.5 text-right font-medium">Debit</th>
                <th className="px-3 py-1.5 text-right font-medium">Credit</th>
                <th className="px-3 py-1.5 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-muted-foreground border-b text-[12px]">
                <td className="px-3.5 py-1" colSpan={5}>
                  Opening balance
                </td>
                <td className="px-3 py-1 text-right font-mono tabular-nums">
                  {money(opening_minor)}
                </td>
              </tr>
              {rows.map((row, index) => (
                <tr key={`${row.entry_id}-${index}`} className="hover:bg-muted/40 border-b">
                  <td className="px-3.5 py-1 tabular-nums">{row.posting_date}</td>
                  <td className="px-3 py-1 font-mono text-[11.5px]">{row.entry_number}</td>
                  <td className="text-muted-foreground max-w-0 truncate px-3 py-1">
                    {row.memo ?? row.source_kind.toLowerCase().replace(/_/g, " ")}
                  </td>
                  <td className="px-3 py-1 text-right font-mono tabular-nums">
                    {row.debit_minor === 0 ? "" : money(row.debit_minor)}
                  </td>
                  <td className="px-3 py-1 text-right font-mono tabular-nums">
                    {row.credit_minor === 0 ? "" : money(row.credit_minor)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1 text-right font-mono tabular-nums",
                      row.running_minor < 0 && "text-amber-700",
                    )}
                  >
                    {money(row.running_minor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
