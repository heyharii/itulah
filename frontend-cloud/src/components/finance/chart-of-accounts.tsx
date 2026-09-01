import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { Input } from "@/components/ui/input"
import {
  accountDetail,
  financeKeys,
  listAccounts,
  ROOT_CLASSES,
  searchAccounts,
} from "@/lib/finance"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { LedgerAccount } from "@itulah/contract"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, Search } from "lucide-react"
import { useState } from "react"

/// The client's own chart of accounts, as a thing you can walk.
///
/// # Why a tree and not a table
///
/// Because the codes are the tree. `101100100101` is not an identifier with
/// digits in it; it is ASSET / CURRENT ASSET / KAS & SETARA KAS / CASH ON HAND /
/// Cash on Hand / at store 01, spelled out in six rungs. A flat table of 7,528
/// rows would hide the one piece of structure the chart actually has, and would
/// make somebody read twelve digits to work out what they were looking at.
///
/// # Why nothing here is translated
///
/// The names are the client's, in Indonesian, exactly as their own system
/// prints them — including the double spaces. An accountant checking a balance
/// is matching what is on this screen against what is on their report, and a
/// tidied or translated name is a different account as far as that check goes.
export function ChartOfAccounts() {
  const [needle, setNeedle] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const searching = needle.trim().length >= 2

  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader
        title="Chart of Accounts"
        subtitle="CENTRAL FASHION STORE · 14 locations"
      >
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Code or name…"
            aria-label="Search accounts"
            className="h-8 w-64 pl-7 text-[13px]"
          />
        </div>
      </ScreenHeader>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 overflow-y-auto py-1">
          {searching ? (
            <SearchResults needle={needle.trim()} onPick={setSelected} selected={selected} />
          ) : (
            <Branch parent={undefined} depth={0} onPick={setSelected} selected={selected} />
          )}
        </div>
        <aside className="hidden min-h-0 overflow-y-auto border-l xl:block">
          <AccountPanel code={selected} />
        </aside>
      </div>
    </AppShell>
  )
}

/// One level of the tree, which fetches itself when it is opened.
///
/// Recursion rather than a flattened list with indent levels: a branch that
/// owns its own query is a branch that can be opened without the parent knowing
/// anything about it, and closing one throws the data away without touching its
/// siblings.
function Branch({
  parent,
  depth,
  onPick,
  selected,
}: {
  parent: string | undefined
  depth: number
  onPick: (code: string) => void
  selected: string | null
}) {
  const branch = useQuery({
    queryKey: financeKeys.accounts(parent),
    queryFn: ({ signal }) => listAccounts({ parent }, signal),
    // The chart is imported once and then sits still for months. Refetching it
    // on every focus would be a request per branch per tab switch, for data
    // that has not moved since the seeder ran.
    staleTime: 10 * 60 * 1000,
  })

  if (branch.isPending) {
    return <p className="text-muted-foreground px-3 py-1.5 text-xs">Loading…</p>
  }
  if (branch.error !== null) {
    return (
      <p className="text-destructive px-3 py-1.5 text-xs">
        {branch.error instanceof Error ? branch.error.message : "could not load accounts"}
      </p>
    )
  }
  return (
    <ul>
      {branch.data.map((account) => (
        <AccountRow
          key={account.account_code}
          account={account}
          depth={depth}
          onPick={onPick}
          selected={selected}
        />
      ))}
    </ul>
  )
}

function AccountRow({
  account,
  depth,
  onPick,
  selected,
}: {
  account: LedgerAccount
  depth: number
  onPick: (code: string) => void
  selected: string | null
}) {
  const [open, setOpen] = useState(false)
  const expandable = account.child_count > 0
  const here = selected === account.account_code
  return (
    <li>
      <div
        className={cn(
          "hover:bg-muted/60 flex items-baseline gap-1.5 rounded-md py-1 pr-3 text-[13px] transition-colors",
          here && "bg-muted",
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            aria-label={open ? `Collapse ${account.name}` : `Expand ${account.name}`}
            className="text-muted-foreground hover:text-foreground -my-1 shrink-0 self-center p-0.5"
          >
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="w-[19px] shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onPick(account.account_code)}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        >
          <span
            className={cn(
              "text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums",
              !account.is_active && "line-through",
            )}
          >
            {account.account_code}
          </span>
          <span
            className={cn(
              "truncate",
              account.is_group && "font-medium",
              !account.is_active && "text-muted-foreground/60",
            )}
          >
            {account.name}
          </span>
        </button>
        {/* A heading says how much is filed under it; a postable leaf says
            where it is. Two different facts, and neither is useful on the
            other kind of row. */}
        {account.is_group ? (
          <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
            {account.child_count}
          </span>
        ) : (
          account.site_id !== null && (
            <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
              {account.counterparty_site_id !== null
                ? `${account.counterparty_site_id} → ${account.site_id}`
                : account.site_id}
            </span>
          )
        )}
      </div>
      {open && (
        <Branch
          parent={account.account_code}
          depth={depth + 1}
          onPick={onPick}
          selected={selected}
        />
      )}
    </li>
  )
}

/// Search results, which are a flat list and therefore need their path shown.
///
/// A code out of the tree is unreadable — that is the whole reason the tree
/// exists — so every hit carries the headings above it.
function SearchResults({
  needle,
  onPick,
  selected,
}: {
  needle: string
  onPick: (code: string) => void
  selected: string | null
}) {
  const hits = useQuery({
    queryKey: financeKeys.accounts(undefined, needle),
    queryFn: ({ signal }) => searchAccounts(needle, { limit: 200 }, signal),
    staleTime: 60 * 1000,
  })

  if (hits.isPending) {
    return <ScreenState>Searching…</ScreenState>
  }
  if (hits.error !== null) {
    return (
      <ScreenState tone="problem">
        {hits.error instanceof Error ? hits.error.message : "search failed"}
      </ScreenState>
    )
  }
  if (hits.data.length === 0) {
    return (
      <ScreenState>
        Nothing in the chart matches “{needle}”. Codes match from the start —
        try <span className="font-mono">1011</span> — and names match anywhere.
      </ScreenState>
    )
  }
  return (
    <ul className="py-1">
      {hits.data.map((account) => (
        <li key={account.account_code}>
          <button
            type="button"
            onClick={() => onPick(account.account_code)}
            className={cn(
              "hover:bg-muted/60 flex w-full items-baseline gap-2 rounded-md px-3 py-1 text-left text-[13px]",
              selected === account.account_code && "bg-muted",
            )}
          >
            <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
              {account.account_code}
            </span>
            <span className={cn("truncate", account.is_group && "font-medium")}>
              {account.name}
            </span>
            <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
              {ROOT_CLASSES[account.root_class] ?? account.root_class}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/// One account: where it sits, and what it holds.
function AccountPanel({ code }: { code: string | null }) {
  const detail = useQuery({
    queryKey: financeKeys.account(code ?? ""),
    queryFn: ({ signal }) => accountDetail(code as string, {}, signal),
    enabled: code !== null,
  })

  if (code === null) {
    return (
      <div className="text-muted-foreground p-4 text-xs">
        Pick an account to see where it sits in the chart and what it holds.
      </div>
    )
  }
  if (detail.isPending) {
    return <div className="text-muted-foreground p-4 text-xs">Loading…</div>
  }
  if (detail.error !== null) {
    return (
      <div className="text-destructive p-4 text-xs">
        {detail.error instanceof Error ? detail.error.message : "could not load the account"}
      </div>
    )
  }

  const { account, path, balance } = detail.data
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="text-muted-foreground font-mono text-[11px]">{account.account_code}</p>
        <h2 className="text-sm leading-tight font-semibold">{account.name}</h2>
      </div>

      {/* The path is the point of this panel. Twelve digits mean nothing until
          you can see the four headings they hang under. */}
      <div>
        <p className="text-muted-foreground pb-1 text-[10px] font-medium tracking-wide uppercase">
          Where it sits
        </p>
        <ol className="space-y-0.5 text-[12px]">
          {path.map((step, index) => (
            <li
              key={step.account_code}
              className="text-muted-foreground truncate"
              style={{ paddingLeft: `${index * 10}px` }}
            >
              <span className="font-mono text-[10px]">{step.account_code}</span> {step.name}
            </li>
          ))}
          <li
            className="truncate font-medium"
            style={{ paddingLeft: `${path.length * 10}px` }}
          >
            <span className="font-mono text-[10px]">{account.account_code}</span> {account.name}
          </li>
        </ol>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
        <Fact label="Kind" value={account.is_group ? "Heading" : "Postable"} />
        <Fact label="Status" value={account.is_active ? "Active" : "Inactive"} />
        {account.site_id !== null && <Fact label="Location" value={account.site_id} />}
        {account.counterparty_site_id !== null && (
          <Fact label="From" value={account.counterparty_site_id} />
        )}
      </dl>

      <div className="rounded-lg border p-3">
        <p className="text-muted-foreground pb-1.5 text-[10px] font-medium tracking-wide uppercase">
          Balance
          {account.is_group && " (including everything under it)"}
        </p>
        <p className="font-mono text-lg tabular-nums">{money(balance.balance_minor)}</p>
        <p className="text-muted-foreground pt-1 font-mono text-[11px] tabular-nums">
          Dr {money(balance.debit_minor)} · Cr {money(balance.credit_minor)}
        </p>
        {balance.debit_minor === 0 && balance.credit_minor === 0 && (
          <p className="text-muted-foreground pt-2 text-[11px]">
            Nothing has been posted here yet.
          </p>
        )}
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </>
  )
}
