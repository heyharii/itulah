import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { KeyValue } from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, money } from "@/lib/format"
import {
  accountChildren,
  accountDetail,
  financeKeys,
  searchAccounts,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import { ROOT_CLASSES } from "@/screens/finance/chart"
import { Check } from "@/screens/finance/parts"
import type { LedgerAccount } from "@itulah/contract"

/// The client's chart, browsed the way it is numbered.
///
/// # Why this one screen is not a `<DataTable>`
///
/// Every other list in this app exists to compare rows, and the table grammar
/// is built for that. A chart of accounts has nothing to compare: each row is
/// an identifier and the client's own name for it, and the only structure that
/// matters — which heading an account hangs under — is destroyed by sorting.
/// The code *is* the tree (`101100100101` is ASSET / CURRENT ASSET / KAS &
/// SETARA KAS / CASH ON HAND / Cash on Hand / store 01, on their own
/// {1,3,5,7,10,12} digit ladder), so this is drawn as the ladder.
///
/// # Why it is fetched a level at a time
///
/// 7,528 accounts is about a megabyte of JSON and somebody opening the screen
/// wants eight rows. Each branch owns its own query keyed on its parent, so
/// opening a heading is independent of the one above it and closing one
/// discards its answer without touching its siblings.
export function ChartOfAccounts() {
  const [needle, setNeedle] = useState("")
  const [inactive, setInactive] = useState(false)
  const account = useSheet("account")

  const trimmed = needle.trim()
  const searching = trimmed.length >= 2

  const results = useQuery({
    queryKey: financeKeys.accountSearch(trimmed, inactive),
    queryFn: ({ signal }) =>
      searchAccounts(trimmed, { inactive, limit: 2000 }, signal),
    enabled: searching,
    staleTime: 60_000,
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Chart of accounts"
        sub="The client's own chart, in their own words. Nothing here is translated."
        actions={
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Search code or name"
            className="h-8 w-64"
          />
        }
      />

      <Toolbar>
        {/* Not a segmented control: "Active / Including inactive" spent two
            pills announcing that the default is the default, and the second
            label is the first plus something. A checkbox says "and also show
            me…" in the width of a checkbox. */}
        <Check
          label="Show inactive"
          checked={inactive}
          onChange={(event) => setInactive(event.target.checked)}
        />
        <Toolbar.Spacer />
        <span className="text-[0.71875rem] text-mute">
          {searching
            ? "Codes match from the start, names match anywhere."
            : "Eight roots. Open a heading to fetch what hangs under it."}
        </span>
      </Toolbar>

      <Card className="max-h-[calc(100vh-16rem)] overflow-auto">
        {searching ? (
          queryState(results, {
            loading: "Searching the chart…",
            render: (accounts) =>
              accounts.length === 0 ? (
                <EmptyState>
                  No account matches “{trimmed}”. Codes are matched from the
                  start, so a fragment from the middle of one will not find it.
                </EmptyState>
              ) : (
                <div>
                  {accounts.map((row) => (
                    <AccountRow
                      key={`${row.account_code}-${row.site_id ?? ""}`}
                      account={row}
                      level={0}
                      selected={row.account_code === account.value}
                      onOpen={() => account.open(row.account_code)}
                    />
                  ))}
                </div>
              ),
          })
        ) : (
          <Branch
            parent={null}
            level={0}
            inactive={inactive}
            openCode={account.value}
            onOpen={(code) => account.open(code)}
          />
        )}
      </Card>

      <AccountSheet code={account.value ?? null} onClose={account.close} />
    </PageContent>
  )
}

/// One rung of the ladder. Its own query, so it can be opened and closed
/// without the branch above it refetching.
function Branch({
  parent,
  level,
  inactive,
  openCode,
  onOpen,
}: {
  parent: string | null
  level: number
  inactive: boolean
  openCode: string | undefined
  onOpen: (code: string) => void
}) {
  const [expanded, setExpanded] = useState<readonly string[]>([])

  const children = useQuery({
    queryKey: financeKeys.accountChildren(parent, inactive),
    queryFn: ({ signal }) =>
      accountChildren({ parent: parent ?? undefined, inactive }, signal),
    // The chart is imported once and then sits for months; a branch reopened
    // twice in a session should not ask twice.
    staleTime: 10 * 60 * 1000,
  })

  return queryState(children, {
    loading: "Loading the chart…",
    render: (accounts) =>
      accounts.length === 0 ? (
        <p className="px-4 py-3 text-[0.71875rem] text-mute">
          Nothing hangs under this heading.
        </p>
      ) : (
        <div>
          {accounts.map((row) => {
            const isOpen = expanded.includes(row.account_code)
            return (
              <div key={`${row.account_code}-${row.site_id ?? ""}`}>
                <AccountRow
                  account={row}
                  level={level}
                  selected={row.account_code === openCode}
                  expanded={isOpen}
                  onToggle={
                    row.child_count > 0
                      ? () =>
                          setExpanded((open) =>
                            open.includes(row.account_code)
                              ? open.filter((code) => code !== row.account_code)
                              : [...open, row.account_code]
                          )
                      : undefined
                  }
                  onOpen={() => onOpen(row.account_code)}
                />
                {isOpen && (
                  <Branch
                    parent={row.account_code}
                    level={level + 1}
                    inactive={inactive}
                    openCode={openCode}
                    onOpen={onOpen}
                  />
                )}
              </div>
            )
          })}
        </div>
      ),
  })
}

function AccountRow({
  account,
  level,
  selected,
  expanded,
  onToggle,
  onOpen,
}: {
  account: LedgerAccount
  level: number
  selected: boolean
  expanded?: boolean
  onToggle?: () => void
  onOpen: () => void
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-hairline text-cell last:border-b-0",
        // Selection is a tint, the same as every list in the app.
        selected ? "bg-accent-bg" : "hover:bg-soft"
      )}
      style={{ paddingLeft: `${0.875 + level * 1.125}rem` }}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={onToggle === undefined}
        aria-label={expanded ? "Collapse" : "Expand"}
        className="grid size-5 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:text-ink disabled:opacity-0"
      >
        {expanded ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-3.5 text-left"
      >
        <Tag tone={account.is_active ? "neutral" : "warn"}>
          {account.account_code}
        </Tag>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            account.is_group ? "font-medium text-ink" : "text-text"
          )}
        >
          {account.name}
        </span>
        {account.counterparty_site_id && (
          <span className="shrink-0 font-mono text-[0.65625rem] text-mute">
            {account.counterparty_site_id} → {account.site_id}
          </span>
        )}
        {!account.counterparty_site_id && account.site_id && (
          <span className="shrink-0 font-mono text-[0.65625rem] text-mute">
            {account.site_id}
          </span>
        )}
        {account.child_count > 0 && (
          <span className="w-10 shrink-0 text-right text-[0.65625rem] text-faint tabular-nums">
            {count(account.child_count)}
          </span>
        )}
      </button>
    </div>
  )
}

/// One account, the headings above it, and what it is worth.
function AccountSheet({
  code,
  onClose,
}: {
  code: string | null
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: financeKeys.account(code ?? "", null),
    queryFn: ({ signal }) => accountDetail(code!, {}, signal),
    enabled: code !== null,
  })

  return (
    <Sheet
      open={code !== null}
      subject={code === null ? undefined : { kind: "account", id: code }}
      onOpenChange={(open) => !open && onClose()}
      id={code ?? undefined}
      title={detail.data?.account.name ?? "Account"}
    >
      {queryState(detail, {
        loading: "Loading the account…",
        render: ({ account, path, balance }) => (
          <div className="flex flex-col gap-5">
            {/* The headings above it, outermost first. This is what makes a
                twelve-digit code readable. */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.71875rem] text-body">
              {path.map((step) => (
                <span
                  key={step.account_code}
                  className="flex items-center gap-1.5"
                >
                  <span className="truncate">{step.name}</span>
                  <span className="text-faint">/</span>
                </span>
              ))}
              <span className="font-medium text-ink">{account.name}</span>
            </div>

            <Facts>
              <Fact term="Class">
                {account.root_class} · {ROOT_CLASSES[account.root_class] ?? "—"}
              </Fact>
              <Fact term="Kind">
                {account.is_group ? "Heading" : "Postable"}
              </Fact>
              <Fact term="Location">{account.site_id ?? "Unscoped"}</Fact>
              <Fact term="State">
                {account.is_active ? "Active" : "Inactive"}
              </Fact>
            </Facts>

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                {account.is_group
                  ? "Balance, including everything under it"
                  : "Balance"}
              </h4>
              {balance.debit_minor === 0 && balance.credit_minor === 0 ? (
                <p className="text-meta text-body">
                  Nothing has been posted here yet.
                </p>
              ) : (
                <div>
                  <KeyValue term="Debits">
                    {money(balance.debit_minor)}
                  </KeyValue>
                  <KeyValue term="Credits">
                    {money(balance.credit_minor)}
                  </KeyValue>
                  {/* Signed as the ledger holds it — debits positive — and
                      deliberately not flipped for a liability or an income
                      account. A report decides how to present a balance; a
                      balance does not decide how to present itself. */}
                  <KeyValue term="Debit less credit">
                    {money(balance.balance_minor)}
                  </KeyValue>
                </div>
              )}
            </div>

            {account.counterparty_site_id && (
              <p className="text-[0.71875rem] text-body">
                A goods-in-transit account: the code names a route rather than a
                place, and the goods came from{" "}
                <span className="font-mono text-id text-ink">
                  {account.counterparty_site_id}
                </span>
                .
              </p>
            )}
          </div>
        ),
      })}
    </Sheet>
  )
}
