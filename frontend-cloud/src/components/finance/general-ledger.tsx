import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { ledgerColumns } from "@/components/finance/columns"
import { DataGrid, useDataGrid } from "@/components/finance/data-grid"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { Input } from "@/components/ui/input"
import { accountLedger, financeKeys, searchAccounts } from "@/lib/finance"
import { money } from "@/lib/money"
import type { GeneralLedgerRow } from "@itulah/contract"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Search } from "lucide-react"
import { useMemo, useRef, useState } from "react"

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
        <ScreenBody>
          <Movements code={code} />
        </ScreenBody>
      )}
    </AppShell>
  )
}

/// How many accounts the picker asks for.
///
/// It used to be twenty, which is not a page size — it is a filter nobody
/// wrote down. `1011` prefixes hundreds of the client's accounts and the one
/// somebody wanted was rarely in the first twenty; they would type more digits
/// to get past a limit they could not see. The list is virtualised, so the
/// cost of a longer answer is one HTTP response and not a longer layout.
const SUGGESTIONS = 500

/// The height each suggestion is drawn at, and therefore the height the
/// virtualiser reserves for the ones that are not.
const SUGGESTION = 24

function AccountSuggestions({
  needle,
  onPick,
}: {
  needle: string
  onPick: (code: string) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const hits = useQuery({
    queryKey: ["finance", "ledger-picker", needle],
    queryFn: ({ signal }) =>
      searchAccounts(needle, { limit: SUGGESTIONS }, signal).then((page) => page.rows),
  })
  const accounts = hits.data ?? []

  const rows = useVirtualizer({
    count: accounts.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => SUGGESTION,
    overscan: 12,
  })

  if (accounts.length === 0) return null
  return (
    <div
      ref={scroller}
      className="bg-card absolute top-9 right-0 z-20 max-h-72 w-96 overflow-y-auto rounded-md border shadow-md"
    >
      <ul className="relative" style={{ height: rows.getTotalSize() }}>
        {rows.getVirtualItems().map((item) => {
          const account = accounts[item.index]
          if (account === undefined) return null
          return (
            <li
              key={account.account_code}
              className="absolute top-0 left-0 w-full"
              style={{ height: SUGGESTION, transform: `translateY(${item.start}px)` }}
            >
              <button
                type="button"
                onClick={() => onPick(account.account_code)}
                className="hover:bg-muted flex h-full w-full items-baseline gap-2 px-2 text-left text-[12px]"
              >
                <span className="text-muted-foreground shrink-0 font-mono text-[10.5px]">
                  {account.account_code}
                </span>
                <span className="truncate">{account.name}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/// An entry can touch one account twice — a correction against itself — so the
/// entry id alone is not a key for a line of the ledger.
function rowId(row: GeneralLedgerRow): string {
  return `${row.entry_id}-${row.posting_date}-${row.debit_minor}-${row.credit_minor}-${row.running_minor}`
}

function Movements({ code }: { code: string }) {
  const ledger = useQuery({
    queryKey: financeKeys.ledger(code),
    queryFn: ({ signal }) => accountLedger(code, {}, signal),
  })

  // A heading like `1011001` gathers cash at fourteen locations over the whole
  // window, which is tens of thousands of movements. The server sends all of
  // them — a ledger that stops early is not a ledger — so the layout is what
  // has to give, and `DataGrid` draws only the rows on the screen.
  const rows = useMemo(() => [...(ledger.data?.rows ?? [])], [ledger.data])
  const table = useDataGrid({ data: rows, columns: ledgerColumns, getRowId: rowId })

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

  const { account_name, from, to, opening_minor, closing_minor } = ledger.data
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

      {ledger.data.rows.length === 0 ? (
        <ScreenState>
          Nothing was posted to this account between {from} and {to}. It stood at{" "}
          {money(opening_minor)} throughout.
        </ScreenState>
      ) : (
        <DataGrid
          table={table}
          lead={
            <tr className="text-muted-foreground border-b text-[12px]">
              <td className="px-3.5 py-1" colSpan={5}>
                Opening balance
              </td>
              <td className="px-3 py-1 text-right font-mono tabular-nums">
                {money(opening_minor)}
              </td>
            </tr>
          }
        />
      )}
    </div>
  )
}
