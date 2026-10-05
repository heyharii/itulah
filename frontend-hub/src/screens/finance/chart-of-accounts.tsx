import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { ChevronDown, ChevronRight, Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field"
import { KeyValue } from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadMore, Problem } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { label, moment, money } from "@/lib/format"
import {
  accountBalances,
  accountChildren,
  accountDetail,
  changeChart,
  chartChanges,
  financeKeys,
  searchAccounts,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import { ROOT_CLASSES } from "@/screens/finance/chart"
import { AccountPicker, SiteName, UnitSelect } from "@/screens/finance/parts"
import type {
  ChartChange,
  ChartChangeRequest,
  LedgerAccount,
} from "@itulah/contract"

/// The Finance chart, browsed through its parent-child relationships.
///
/// # Why this one screen is not a `<DataTable>`
///
/// Every other list in this app exists to compare rows, and the table grammar
/// is built for that. A chart of accounts has nothing to compare: each row is
/// an account number and name, and its parent relationship is the structure
/// that matters. Sorting a flat list would hide which group each account hangs
/// under, so this screen fetches and renders one branch at a time.
///
/// # Why it is fetched a level at a time
///
/// 7,528 accounts is about a megabyte of JSON and somebody opening the screen
/// wants eight rows. Each branch owns its own query keyed on its parent, so
/// opening a heading is independent of the one above it and closing one
/// discards its answer without touching its siblings.
///
/// # Why a change applies at once
///
/// Finance adds, renames, moves, retypes, retires and revives accounts here,
/// the way an Accounts Manager does in ERPNext — no migration and no approval,
/// on the owner's decision. What keeps that safe is the database, which
/// refuses a parent that is not a heading of the same root or a type that does
/// not fit it, and the server, which refuses to retire an account a link or a
/// balance still leans on. Its sentence is shown as it is written. Every
/// change is kept with the account before and after, who, and why — the
/// History tab.
/// How many matches one page of a chart search asks for. A step, not a
/// ceiling: the card asks for the next page as its last rows scroll into view.
const SEARCH_PAGE = 100

export function ChartOfAccounts() {
  const [needle, setNeedle] = useState("")
  const [inactive, setInactive] = useState(false)
  /// Whose books the balances are read from — the company's when blank, as
  /// ERPNext's tree is read per company.
  const [unit, setUnit] = useState("")
  const [tab, setTab] = useState("chart")
  const [creating, setCreating] = useState(false)
  // "Expand all" / "Collapse all": a sweep every branch applies once, when it
  // has its children. The tree loads a level at a time, so opening it all is
  // each branch opening its own parents as they arrive.
  const [sweep, setSweep] = useState<Sweep>({ mode: "close", epoch: 0 })
  const account = useSheet("account")

  const trimmed = needle.trim()
  const searching = trimmed.length >= 2

  // A page at a time, read on as the card scrolls. `101` matches 1,248
  // accounts in this client's chart; this used to stop at the server's 500
  // and ask somebody to narrow the search to see the rest.
  const results = useInfiniteQuery({
    queryKey: [...financeKeys.accountSearch(trimmed, inactive), "pages"],
    queryFn: ({ pageParam, signal }) =>
      searchAccounts(
        trimmed,
        { inactive, limit: SEARCH_PAGE, cursor: pageParam },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: searching,
    staleTime: 60_000,
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Accounting Masters"
        title="Chart of Accounts"
        actions={
          <>
            <Input
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              className="h-control w-64"
            />
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus />
              New account
            </Button>
          </>
        }
      />

      <SubTabs
        tabs={[
          { value: "chart", label: "Chart" },
          { value: "history", label: "History" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "history" ? (
        <ChartHistory onOpen={(code) => account.open(code)} />
      ) : (
        <>
          <Toolbar>
            {/* Not a segmented control: "Active / Including inactive" spent two
            pills announcing that the default is the default, and the second
            label is the first plus something. A checkbox says "and also show
            me…" in the width of a checkbox. */}
            <UnitSelect
              value={unit}
              onChange={setUnit}
              emptyLabel="Whole company"
              className="h-control w-52"
              aria-label="Whose books"
            />
            <Checkbox
              label="Show inactive"
              checked={inactive}
              onChange={(next) => setInactive(next)}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setSweep((now) => ({ mode: "open", epoch: now.epoch + 1 }))
              }
            >
              Expand all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setSweep((now) => ({ mode: "close", epoch: now.epoch + 1 }))
              }
            >
              Collapse all
            </Button>
            <Toolbar.Spacer />
            {/* What is on screen, in words — every toolbar in this module
            answers "what am I looking at". */}
            <span className="text-[0.875rem] text-mute">
              {searching
                ? `Matching “${trimmed}”`
                : "Balances as of today, headings summed"}
              {inactive ? " · including inactive" : ""}
            </span>
          </Toolbar>

          <Card className="max-h-[calc(100dvh-16rem)] overflow-auto">
            {/* The heading row every table in the app has, so the figures on
            the right are named. */}
            <div className="sticky top-0 z-10 flex h-10 items-center border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
              <span className="flex-1">Account</span>
              {!searching && <span>Balance</span>}
            </div>
            {searching ? (
              queryState(results, {
                loading: "Searching the chart…",
                render: (data) => {
                  const rows = data.pages.flatMap((page) => page.rows)
                  return rows.length === 0 ? (
                    <EmptyState>
                      No account matches “{trimmed}”. Codes are matched from the
                      start, so a fragment from the middle of one will not find
                      it.
                    </EmptyState>
                  ) : (
                    <div>
                      {rows.map((row) => (
                        <AccountRow
                          key={`${row.account_code}-${row.site_id ?? ""}`}
                          account={row}
                          level={0}
                          selected={row.account_code === account.value}
                          onOpen={() => account.open(row.account_code)}
                        />
                      ))}
                      {/* Inside the card, which is the box that scrolls. */}
                      <LoadMore query={results} />
                    </div>
                  )
                },
              })
            ) : (
              <Branch
                // A collapse remounts the tree, so every branch forgets what
                // it had opened.
                key={sweep.mode === "close" ? sweep.epoch : "open"}
                parent={null}
                level={0}
                unit={unit}
                inactive={inactive}
                openCode={account.value}
                onOpen={(code) => account.open(code)}
                sweep={sweep}
              />
            )}
          </Card>
        </>
      )}

      <AccountSheet code={account.value ?? null} onClose={account.close} />
      <NewAccountSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(code) => {
          setCreating(false)
          account.open(code)
        }}
      />
    </PageContent>
  )
}

/// One rung of the ladder. Its own query, so it can be opened and closed
/// without the branch above it refetching.
interface Sweep {
  readonly mode: "open" | "close"
  readonly epoch: number
}

function Branch({
  parent,
  level,
  unit,
  inactive,
  openCode,
  onOpen,
  sweep,
}: {
  parent: string | null
  level: number
  unit: string
  inactive: boolean
  openCode: string | undefined
  onOpen: (code: string) => void
  sweep: Sweep
}) {
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const swept = useRef(-1)

  const children = useQuery({
    queryKey: financeKeys.accountChildren(parent, inactive),
    // A branch is safely whole: no heading in this client's chart has more
    // than 36 children, against a page of 200. The envelope's `total` would
    // say otherwise if that ever changed.
    queryFn: ({ signal }) =>
      accountChildren({ parent: parent ?? undefined, inactive }, signal).then(
        (page) => page.rows
      ),
    // The chart is imported once and then sits for months; a branch reopened
    // twice in a session should not ask twice.
    staleTime: 10 * 60 * 1000,
  })

  // Beside the rows rather than inside them: the chart sits for months, the
  // balances move with every posting, so they are read on their own clock.
  const balances = useQuery({
    queryKey: financeKeys.accountBalances(parent, unit || null),
    queryFn: ({ signal }) =>
      accountBalances(
        { parent: parent ?? undefined, unit: unit || undefined },
        signal
      ).then(
        (rows) =>
          new Map(rows.map((row) => [row.account_code, row.balance_minor]))
      ),
    staleTime: 30_000,
  })

  // Once per sweep, as soon as this level is known: open every row that has
  // children. Their own branches mount, read their level, and do the same.
  useEffect(() => {
    if (sweep.mode !== "open" || swept.current === sweep.epoch) return
    if (children.data === undefined) return
    swept.current = sweep.epoch
    setExpanded(
      children.data
        .filter((row) => row.child_count > 0)
        .map((row) => row.account_code)
    )
  }, [sweep, children.data])

  return queryState(children, {
    loading: "Loading the chart…",
    render: (accounts) =>
      accounts.length === 0 ? (
        <p className="px-4 py-3 text-[0.875rem] text-mute">
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
                  balance={
                    balances.data === undefined
                      ? undefined
                      : (balances.data.get(row.account_code) ?? 0)
                  }
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
                    unit={unit}
                    inactive={inactive}
                    openCode={openCode}
                    onOpen={onOpen}
                    sweep={sweep}
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
  balance,
  selected,
  expanded,
  onToggle,
  onOpen,
}: {
  account: LedgerAccount
  level: number
  /// Debit minus credit; absent while it is being read, or in a search.
  balance?: number
  selected: boolean
  expanded?: boolean
  onToggle?: () => void
  onOpen: () => void
}) {
  return (
    <div
      className={cn(
        "flex h-row items-center gap-2 border-b border-hairline text-cell",
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
        <span className="w-16 shrink-0 font-mono text-[0.875rem] text-mute">
          {account.account_code}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            account.is_group ? "font-medium text-ink" : "text-text",
            !account.is_active && "text-mute line-through"
          )}
        >
          {account.name}
        </span>
        {/* The site as people read it — its unit's code and name — the same
            reading every other site in this module gets. The raw id was here
            in mono, which is the one thing an account row has no room to
            explain. */}
        {account.counterparty_site_id && (
          <span className="shrink-0 text-[0.875rem] text-mute">
            <SiteName id={account.counterparty_site_id} /> →{" "}
            <SiteName id={account.site_id} />
          </span>
        )}
        {!account.counterparty_site_id && account.site_id && (
          <span className="shrink-0 text-[0.875rem] text-mute">
            <SiteName id={account.site_id} />
          </span>
        )}
        {balance !== undefined && (
          <span
            className={cn(
              "w-48 shrink-0 text-right whitespace-nowrap tabular-nums",
              balance === 0
                ? "text-faint"
                : account.is_group
                  ? "font-medium text-ink"
                  : "text-text"
            )}
          >
            {balance === 0 ? (
              money(0)
            ) : (
              <>
                {money(Math.abs(balance))}
                <span className="ml-1.5 inline-block w-5 text-left text-[0.875rem] font-normal text-mute">
                  {balance > 0 ? "Dr" : "Cr"}
                </span>
              </>
            )}
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
  const [mode, setMode] = useState<"edit" | "state" | null>(null)
  const active = detail.data?.account.is_active ?? true

  return (
    <Sheet
      open={code !== null}
      subject={code === null ? undefined : { kind: "account", id: code }}
      onOpenChange={(open) => {
        if (!open) {
          setMode(null)
          onClose()
        }
      }}
      id={code ?? undefined}
      title={detail.data?.account.name ?? "Account"}
      actions={
        detail.data && (
          <>
            <Button
              size="sm"
              variant={mode === "edit" ? "soft" : "ghost"}
              onClick={() => setMode(mode === "edit" ? null : "edit")}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant={mode === "state" ? "soft" : "ghost"}
              onClick={() => setMode(mode === "state" ? null : "state")}
            >
              {active ? "Deactivate" : "Reactivate"}
            </Button>
          </>
        )
      }
    >
      {queryState(detail, {
        loading: "Loading the account…",
        render: ({ account, path, balance }) => (
          <div className="flex flex-col gap-5">
            {mode === "edit" && (
              <EditAccount
                key={account.account_code}
                account={account}
                onDone={() => setMode(null)}
              />
            )}
            {mode === "state" && (
              <RetireOrRevive
                key={account.account_code}
                account={account}
                onDone={() => setMode(null)}
              />
            )}
            {/* The headings above it, outermost first. This is what makes a
                twelve-digit code readable. */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.875rem] text-body">
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
              {/* "Unscoped" and not a dash: an account with no site is a
                  real and ordinary state in this chart — the headings and the
                  company-wide accounts — and it is not the same as a site
                  we could not name. */}
              <Fact term="Site">
                {account.site_id === null ? (
                  "Unscoped"
                ) : (
                  <SiteName id={account.site_id} />
                )}
              </Fact>
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
              <p className="text-[0.875rem] text-body">
                A goods-in-transit account: the code names a route rather than a
                place, and the goods came from{" "}
                <SiteName
                  id={account.counterparty_site_id}
                  className="font-medium text-ink"
                />
                .
              </p>
            )}

            <AccountChanges code={account.account_code} />
          </div>
        ),
      })}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Changing the chart
// ---------------------------------------------------------------------------

const ACCOUNT_TYPES_BY_ROOT: Readonly<Record<string, readonly string[]>> = {
  ASSET: [
    "CASH",
    "BANK",
    "RECEIVABLE",
    "INVENTORY",
    "PREPAID",
    "TAX",
    "AFFILIATE",
    "FIXED_ASSET",
    "ACCUMULATED_DEPRECIATION",
    "OTHER_ASSET",
  ],
  LIABILITY: [
    "PAYABLE",
    "TAX",
    "AFFILIATE",
    "ACCRUED_LIABILITY",
    "LOAN",
    "OTHER_LIABILITY",
  ],
  EQUITY: ["EQUITY"],
  INCOME: ["INCOME"],
  EXPENSE: ["COST_OF_GOODS_SOLD", "EXPENSE", "DEPRECIATION"],
}

const ALL_ACCOUNT_TYPES = [
  ...new Set(Object.values(ACCOUNT_TYPES_BY_ROOT).flat()),
]

const STATEMENT_SECTIONS = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "COST_OF_SALES",
  "OPERATING_EXPENSE",
  "OTHER_OPERATING_EXPENSE",
  "OTHER_INCOME",
  "OTHER_EXPENSE",
  "OTHER_NET",
  "INCOME_TAX",
] as const

/// The root a section belongs to — the database's `ledger_root_type`, which
/// is what decides which types an account may take. OTHER_NET follows the
/// normal balance, and with none chosen it could be either.
function rootOfSection(section: string, balance: string): string | null {
  switch (section) {
    case "ASSET":
      return "ASSET"
    case "LIABILITY":
      return "LIABILITY"
    case "EQUITY":
      return "EQUITY"
    case "REVENUE":
    case "OTHER_INCOME":
      return "INCOME"
    case "OTHER_NET":
      return balance === "C" ? "INCOME" : balance === "D" ? "EXPENSE" : null
    default:
      return "EXPENSE"
  }
}

/// The root the client's class number implies. Only a hint for narrowing a
/// select: class 8 holds both income and expense, so it answers nothing and
/// every type is offered. The database is the authority either way.
function rootOfClass(rootClass: string | undefined): string | null {
  switch (rootClass) {
    case "1":
      return "ASSET"
    case "2":
      return "LIABILITY"
    case "3":
      return "EQUITY"
    case "4":
      return "INCOME"
    case "5":
    case "6":
    case "7":
      return "EXPENSE"
    default:
      return null
  }
}

function typesFor(root: string | null): readonly string[] {
  return root === null
    ? ALL_ACCOUNT_TYPES
    : (ACCOUNT_TYPES_BY_ROOT[root] ?? ALL_ACCOUNT_TYPES)
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

/// Every change to the chart refreshes everything read about accounts: the
/// tree, the searches, the open account and the history all sit under
/// `["finance", "accounts"]`.
function useChartChange(onDone: (change: ChartChange) => void) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: ChartChangeRequest) => changeChart(request),
    onSuccess: (change) => {
      void client.invalidateQueries({ queryKey: ["finance", "accounts"] })
      onDone(change)
    },
  })
}

/// A heading, chosen from the chart. Leaves are shown and refused, like every
/// other picker here: a heading nobody can find reads as a broken search.
function HeadingPicker({
  value,
  onChange,
}: {
  value: { code: string; name: string } | null
  onChange: (next: { code: string; name: string } | null) => void
}) {
  if (value !== null) {
    return (
      <div className="flex items-center gap-2 rounded-inner border border-hairline px-3 py-2 text-[0.875rem]">
        <Tag>{value.code}</Tag>
        <span className="min-w-0 flex-1 truncate text-ink">{value.name}</span>
        <Button size="sm" variant="quiet" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    )
  }
  return (
    <AccountPicker
      allowGroups
      accept={(account) => (account.is_group ? null : "not a heading")}
      onPick={(account) =>
        onChange({ code: account.account_code, name: account.name })
      }
    />
  )
}

/// The class of a heading, read off its detail — the picker hands back a code
/// and a name, and the class is what narrows the type select.
function useRootClass(code: string | null): string | undefined {
  const detail = useQuery({
    queryKey: financeKeys.account(code ?? "", null),
    queryFn: ({ signal }) => accountDetail(code!, {}, signal),
    enabled: code !== null,
    staleTime: 10 * 60 * 1000,
  })
  return detail.data?.account.root_class
}

function NewAccountSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (code: string) => void
}) {
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [parent, setParent] = useState<{ code: string; name: string } | null>(
    null
  )
  const [isGroup, setIsGroup] = useState(false)
  const [accountType, setAccountType] = useState("")
  const [section, setSection] = useState("")
  const [dimension, setDimension] = useState("unit")
  const [balance, setBalance] = useState("")
  const [reason, setReason] = useState("")

  const reset = () => {
    setCode("")
    setName("")
    setParent(null)
    setIsGroup(false)
    setAccountType("")
    setSection("")
    setDimension("unit")
    setBalance("")
    setReason("")
  }

  const rootClass = useRootClass(parent?.code ?? null)
  const root =
    section !== "" ? rootOfSection(section, balance) : rootOfClass(rootClass)
  const types = typesFor(root)

  const save = useChartChange((change) => {
    reset()
    onCreated(change.account_code)
  })

  const missing =
    code.trim() === ""
      ? "Give the account a code."
      : name.trim() === ""
        ? "Give the account a name."
        : parent === null
          ? "Choose the heading it sits under."
          : null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New account"
      caption="Applies at once and is kept in the chart's history."
    >
      <div className="flex flex-col gap-3">
        <Problem error={save.error} />
        <Field label="Code" required>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="font-mono"
          />
        </Field>
        <Field label="Name" required aside="The client's own words">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Under heading" required>
          <HeadingPicker value={parent} onChange={setParent} />
        </Field>
        <Checkbox
          label="A heading — other accounts sit under it, nothing posts to it"
          checked={isGroup}
          onChange={(next) => setIsGroup(next)}
        />
        {!isGroup && (
          <Field
            label="Account type"
            aside={root === null ? undefined : label(root)}
          >
            <Select value={accountType} onChange={setAccountType}>
              <option value="">What most of its siblings are</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {label(type)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Statement section">
          <Select value={section} onChange={setSection}>
            <option value="">Same as the heading</option>
            {STATEMENT_SECTIONS.map((one) => (
              <option key={one} value={one}>
                {label(one)}
              </option>
            ))}
          </Select>
        </Field>
        {!isGroup && (
          <Field label="Kept per">
            <Select value={dimension} onChange={setDimension}>
              <option value="unit">Unit — each site has its own balance</option>
              <option value="company">Company — one balance for all</option>
            </Select>
          </Field>
        )}
        <Field label="Normal balance">
          <Select value={balance} onChange={setBalance}>
            <option value="">From the root</option>
            <option value="D">Debit</option>
            <option value="C">Credit</option>
          </Select>
        </Field>
        <Field label="Reason">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
          />
        </Field>
        <div className="flex items-center justify-end gap-2.5">
          <span className="min-w-0 flex-1 text-[0.875rem] text-mute">
            {missing ?? `${code.trim()} will sit under ${parent?.code}.`}
          </span>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={missing !== null}
            onClick={() =>
              save.mutate({
                kind: "CREATE",
                account_code: code.trim(),
                name: name.trim(),
                parent_code: parent?.code ?? null,
                is_group: isGroup,
                account_type: isGroup ? null : blankToNull(accountType),
                statement_section: blankToNull(section),
                dimension: isGroup ? null : dimension,
                normal_balance: blankToNull(balance),
                reason: blankToNull(reason),
              })
            }
          >
            {save.isPending ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/// Rename, move, retype. Only what was changed is sent: a blank select is
/// "leave it as it is", not "clear it".
function EditAccount({
  account,
  onDone,
}: {
  account: LedgerAccount
  onDone: () => void
}) {
  const [name, setName] = useState(account.name)
  const [parent, setParent] = useState<{ code: string; name: string } | null>(
    null
  )
  const [accountType, setAccountType] = useState("")
  const [section, setSection] = useState("")
  const [dimension, setDimension] = useState("")
  // "" leaves the flag as it is; the account row does not carry either flag,
  // so the form cannot show the current answer — only change it.
  const [frozen, setFrozen] = useState("")
  const [counterSite, setCounterSite] = useState("")
  const [reason, setReason] = useState("")

  const rootClass = useRootClass(parent?.code ?? null) ?? account.root_class
  const root =
    section !== "" ? rootOfSection(section, "") : rootOfClass(rootClass)
  const save = useChartChange(onDone)

  const nameChanged = name.trim() !== "" && name.trim() !== account.name
  const anything =
    nameChanged ||
    parent !== null ||
    accountType !== "" ||
    section !== "" ||
    dimension !== "" ||
    frozen !== "" ||
    counterSite !== ""

  return (
    <div className="flex flex-col gap-3 rounded-inner border border-hairline p-3">
      <h4 className="text-card-title font-semibold text-ink">Edit account</h4>
      <Problem error={save.error} />
      <Field label="Name">
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field
        label="Move under"
        aside={
          parent === null ? `Now ${account.parent_code ?? "a root"}` : undefined
        }
      >
        <HeadingPicker value={parent} onChange={setParent} />
      </Field>
      {!account.is_group && (
        <Field label="Account type">
          <Select value={accountType} onChange={setAccountType}>
            <option value="">Leave as it is</option>
            {typesFor(root).map((type) => (
              <option key={type} value={type}>
                {label(type)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Statement section">
        <Select value={section} onChange={setSection}>
          <option value="">Leave as it is</option>
          {STATEMENT_SECTIONS.map((one) => (
            <option key={one} value={one}>
              {label(one)}
            </option>
          ))}
        </Select>
      </Field>
      {!account.is_group && (
        <Field label="Kept per">
          <Select value={dimension} onChange={setDimension}>
            <option value="">Leave as it is</option>
            <option value="unit">Unit</option>
            <option value="company">Company</option>
          </Select>
        </Field>
      )}
      {!account.is_group && (
        <Field
          label="Frozen"
          aside="Takes no new line"
          hint="A frozen account keeps its history and balance; every new posting to it is refused."
        >
          <Select value={frozen} onChange={setFrozen}>
            <option value="">Leave as it is</option>
            <option value="yes">Freeze it</option>
            <option value="no">Unfreeze it</option>
          </Select>
        </Field>
      )}
      {!account.is_group && (
        <Field
          label="Requires counter unit"
          hint="Every line on this account must name the unit on the other side — an interunit account."
        >
          <Select value={counterSite} onChange={setCounterSite}>
            <option value="">Leave as it is</option>
            <option value="yes">Required</option>
            <option value="no">Not required</option>
          </Select>
        </Field>
      )}
      <Field label="Reason">
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={!anything}
          onClick={() =>
            save.mutate({
              kind: "UPDATE",
              account_code: account.account_code,
              name: nameChanged ? name.trim() : null,
              parent_code: parent?.code ?? null,
              account_type: blankToNull(accountType),
              statement_section: blankToNull(section),
              dimension: blankToNull(dimension),
              is_frozen: frozen === "" ? null : frozen === "yes",
              requires_counter_site:
                counterSite === "" ? null : counterSite === "yes",
              reason: blankToNull(reason),
            })
          }
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </div>
  )
}

/// Retire or revive. Retiring is refused while a link, a balance or a live
/// child still leans on the account — the server names which.
function RetireOrRevive({
  account,
  onDone,
}: {
  account: LedgerAccount
  onDone: () => void
}) {
  const [reason, setReason] = useState("")
  const save = useChartChange(onDone)
  const retiring = account.is_active

  return (
    <div className="flex flex-col gap-3 rounded-inner border border-hairline p-3">
      <h4 className="text-card-title font-semibold text-ink">
        {retiring ? "Deactivate" : "Reactivate"} {account.account_code}
      </h4>
      <p className="text-[0.875rem] text-body">
        {retiring
          ? "Nothing new can be posted to an inactive account. Its history stays, and it can be reactivated."
          : "The account takes postings again from now on."}
      </p>
      <Problem error={save.error} />
      <Field label="Reason">
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant={retiring ? "danger" : "primary"}
          pending={save.isPending}
          onClick={() =>
            save.mutate({
              kind: retiring ? "DEACTIVATE" : "REACTIVATE",
              account_code: account.account_code,
              reason: blankToNull(reason),
            })
          }
        >
          {save.isPending
            ? "Saving…"
            : retiring
              ? "Deactivate account"
              : "Reactivate account"}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/// The fields a change moved, before → after. A creation has no before, so
/// it shows what the account was made with.
function changedFields(
  change: ChartChange
): { field: string; before: string; after: string }[] {
  const show = (value: unknown) =>
    value === null || value === undefined ? "—" : String(value)
  const keys = new Set([
    ...Object.keys(change.before ?? {}),
    ...Object.keys(change.after),
  ])
  const out: { field: string; before: string; after: string }[] = []
  for (const key of keys) {
    const before = change.before?.[key]
    const after = change.after[key]
    if (change.before !== null && show(before) === show(after)) continue
    if (change.before === null && (after === null || after === undefined))
      continue
    out.push({ field: key, before: show(before), after: show(after) })
  }
  return out
}

function ChangeLine({
  change,
  onOpen,
}: {
  change: ChartChange
  onOpen?: (code: string) => void
}) {
  const fields = changedFields(change)
  return (
    <div className="flex flex-col gap-1 border-b border-hairline px-4 py-2.5 text-[0.875rem] last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        {onOpen ? (
          <button type="button" onClick={() => onOpen(change.account_code)}>
            <Tag tone="accent">{change.account_code}</Tag>
          </button>
        ) : null}
        <span className="font-medium text-ink">{label(change.action)}</span>
        {change.reason && <span className="text-body">— {change.reason}</span>}
        <span className="ml-auto text-faint">
          {change.changed_by} · {moment(change.changed_at)}
        </span>
      </div>
      {fields.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {fields.map((one) => (
            <div key={one.field} className="flex flex-wrap gap-x-2">
              <span className="w-36 shrink-0 text-mute">
                {label(one.field)}
              </span>
              {change.before !== null && (
                <>
                  <span className="text-body line-through decoration-faint">
                    {one.before}
                  </span>
                  <span className="text-faint">→</span>
                </>
              )}
              <span className="text-ink">{one.after}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/// How many changes one page of the chart's history asks for. The endpoint
/// answers a bare list, so a page that comes back full is the only sign there
/// may be another — and the last `change_id` on it is where the next starts.
const HISTORY_PAGE = 100

/// The chart's history (or one account's), newest first, a page at a time.
function useChartHistory(code: string | null, size: number) {
  return useInfiniteQuery({
    queryKey: [...financeKeys.chartChanges(code), "pages", size],
    queryFn: ({ pageParam, signal }) =>
      chartChanges(code, signal, size, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) =>
      last.length < size ? undefined : last[last.length - 1]?.change_id,
  })
}

function ChartHistory({ onOpen }: { onOpen: (code: string) => void }) {
  const history = useChartHistory(null, HISTORY_PAGE)
  return (
    <Card className="max-h-[calc(100dvh-16rem)] overflow-auto">
      {queryState(history, {
        loading: "Reading the chart's history…",
        render: (data) => {
          const changes = data.pages.flat()
          return changes.length === 0 ? (
            <EmptyState>
              Nobody has changed the chart from this screen yet.
            </EmptyState>
          ) : (
            <div>
              {changes.map((change) => (
                <ChangeLine
                  key={change.change_id}
                  change={change}
                  onOpen={onOpen}
                />
              ))}
              {/* Inside the card, which is the box that scrolls. */}
              <LoadMore query={history} />
            </div>
          )
        },
      })}
    </Card>
  )
}

/// This account's own changes, at the foot of its sheet — read on as the
/// sheet scrolls rather than stopping at the last twenty.
function AccountChanges({ code }: { code: string }) {
  const history = useChartHistory(code, 20)
  const changes = history.data?.pages.flat() ?? []
  if (changes.length === 0) return null
  return (
    <div>
      <h4 className="mb-2 text-card-title font-semibold text-ink">Changes</h4>
      <div className="rounded-inner border border-hairline">
        {changes.map((change) => (
          <ChangeLine key={change.change_id} change={change} />
        ))}
      </div>
      <LoadMore query={history} />
    </div>
  )
}
