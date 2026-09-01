/*
 * Chart of accounts — every account the ledger recognises, grouped by root
 * type, with the five group accounts carrying the leaves beneath them.
 *
 * `/v1/accounting/accounts` gives structure only (id, code, name, parent,
 * group, active). The balances beside them come from
 * `/v1/accounting/reports/trial-balance`, a separate date-ranged read that is
 * allowed to be empty while the journal is — and whose balance column is
 * formed here as debit − credit, since the report states the two sides but no
 * net.
 */

import { useMemo } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import {
  ROOT_LABEL,
  ROOT_TYPES,
  moneyOrDash,
  trialBalanceOf,
  type LedgerAccount,
  type RootType,
  type TrialBalanceRow,
} from "@/components/accounting/api"
import { num } from "@/components/accounting/parts"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

export interface AccountGroup {
  rootType: RootType
  accounts: LedgerAccount[]
}

const CHART_COLUMNS = "92px minmax(0,1fr) 110px 150px 150px 160px"

/** A root-type heading or one account — the two things the chart interleaves. */
type ChartFeedEntry =
  | { kind: "group"; rootType: RootType; count: number }
  | { kind: "account"; account: LedgerAccount }

/** Group accounts first, then their children, then any orphan under the root. */
export function groupAccounts(accounts: LedgerAccount[]): AccountGroup[] {
  return ROOT_TYPES.map((rootType) => {
    const inRoot = accounts.filter((account) => account.rootType === rootType)
    const groups = inRoot.filter((account) => account.isGroup)
    const leaves = inRoot.filter((account) => !account.isGroup)
    const ordered: LedgerAccount[] = []
    for (const group of groups.sort((a, b) => a.code.localeCompare(b.code))) {
      ordered.push(group)
      ordered.push(
        ...leaves
          .filter((leaf) => leaf.parentCode === group.code)
          .sort((a, b) => a.code.localeCompare(b.code))
      )
    }
    const placed = new Set(ordered.map((account) => account.code))
    ordered.push(
      ...leaves
        .filter((leaf) => !placed.has(leaf.code))
        .sort((a, b) => a.code.localeCompare(b.code))
    )
    return { rootType, accounts: ordered }
  }).filter((group) => group.accounts.length > 0)
}

export function ChartOfAccounts({
  accounts,
  balances,
  balancesReady,
  onOpen,
}: {
  accounts: LedgerAccount[]
  balances: TrialBalanceRow[]
  /** False while the trial balance is still loading or failed to load. */
  balancesReady: boolean
  onOpen: (account: LedgerAccount) => void
}) {
  const groups = useMemo(() => groupAccounts(accounts), [accounts])
  const byCode = useMemo(() => {
    const map = new Map<string, TrialBalanceRow>()
    for (const row of balances) map.set(row.accountCode, row)
    return map
  }, [balances])

  /* One flat list: a virtualizer positions by index, so a root-type heading
   * has to be an entry beside the accounts it introduces rather than a
   * wrapper around them. */
  const feed = useMemo<ChartFeedEntry[]>(
    () =>
      groups.flatMap((group): ChartFeedEntry[] => [
        { kind: "group", rootType: group.rootType, count: group.accounts.length },
        ...group.accounts.map(
          (account): ChartFeedEntry => ({ kind: "account", account })
        ),
      ]),
    [groups]
  )

  return (
    <VirtualRows
      rows={feed}
      rowKey={(entry) =>
        entry.kind === "group" ? `group:${entry.rootType}` : entry.account.code
      }
      columns={CHART_COLUMNS}
      rowHeight={(entry) => (entry.kind === "group" ? 32 : 34)}
      onRowClick={(entry) => {
        if (entry.kind === "account") onOpen(entry.account)
      }}
      header={
        <>
          <span className="pl-3.5">Code</span>
          <span>Account</span>
          <span>Kind</span>
          <span className="text-right">Debit</span>
          <span className="text-right">Credit</span>
          <span className="pr-3.5 text-right">Balance</span>
        </>
      }
      renderRow={(entry) => {
        if (entry.kind === "group") {
          return (
            <span
              role="gridcell"
              style={{ gridColumn: "1 / -1" }}
              className="flex h-full items-center bg-[color-mix(in_srgb,var(--inset)_55%,var(--surface))] px-3.5"
            >
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-3 uppercase">
                {ROOT_LABEL[entry.rootType]}
              </span>
              <span className="ml-2 font-mono text-[10.5px] text-ink-4">
                {entry.count}
              </span>
            </span>
          )
        }

        const { account } = entry
        const row = byCode.get(account.code)
        return (
          /* `contents` keeps every cell a direct grid item of the row (so
           * the columns still line up) while still giving the row a single
           * DOM ancestor the chevron's `group-hover/row` can key off. */
          <div className="contents group/row">
            <span role="gridcell" className="pl-3.5">
              <span
                className={cn(num, account.isGroup ? "text-ink" : "text-ink-3")}
              >
                {account.code}
              </span>
            </span>
            <span role="gridcell" className="min-w-0 px-3">
              <span
                className={cn(
                  "flex items-center gap-2",
                  !account.isGroup && "pl-4"
                )}
              >
                <span
                  className={cn(
                    "truncate text-xs",
                    account.isGroup ? "font-semibold text-ink" : "text-ink-2"
                  )}
                >
                  {account.name}
                </span>
                {!account.isActive && (
                  <span className="shrink-0 rounded-full bg-ember/12 px-1.5 text-[10px] font-medium text-ember">
                    inactive
                  </span>
                )}
                <Icon
                  path={paths.chevronRight}
                  size={12}
                  width={2}
                  className="shrink-0 text-ink-4 opacity-0 transition-opacity group-hover/row:opacity-100"
                />
              </span>
            </span>
            <span role="gridcell" className="px-3">
              <span className="text-[11px] text-ink-4">
                {account.isGroup ? "Group" : "Posting"}
              </span>
            </span>
            <span role="gridcell" className="px-3 text-right">
              <span className={cn(num, "text-ink-3")}>
                {balancesReady ? moneyOrDash(row?.debit ?? 0) : "·"}
              </span>
            </span>
            <span role="gridcell" className="px-3 text-right">
              <span className={cn(num, "text-ink-3")}>
                {balancesReady ? moneyOrDash(row?.credit ?? 0) : "·"}
              </span>
            </span>
            <span role="gridcell" className="pr-3.5 pl-3 text-right">
              <span
                className={cn(
                  num,
                  row && trialBalanceOf(row) !== 0 ? "text-ink" : "text-ink-4"
                )}
              >
                {balancesReady ? moneyOrDash(row ? trialBalanceOf(row) : 0) : "·"}
              </span>
            </span>
          </div>
        )
      }}
    />
  )
}
