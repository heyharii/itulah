import {
  infiniteQueryOptions,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import {
  Banknote,
  Coins,
  Download,
  Landmark,
  LayoutGrid,
  Wallet,
} from "lucide-react"
import {
  Suspense,
  useDeferredValue,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { DayRange } from "@/components/ui/day-range"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { FilterChips, type ChipOption } from "@/components/ui/filter-chips"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SheetSection,
} from "@/components/ui/rows"
import { CellMoney } from "@/components/ui/rows-switch"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { toast } from "@/lib/toast"
import { count, day, dayMonth, label, money, monthYear } from "@/lib/format"
import { cashDocumentsQuery } from "@/lib/queries/cash-documents"
import {
  accountLedger,
  cashCountsQuery,
  companyBankAccountsQuery,
  financeKeys,
  ledgerWindowQuery,
  moneyOverviewQuery,
  recordCashCount,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { parseMinor, todayIso } from "@/screens/finance/chart"
import { useSettledWindow, useWindow } from "@/screens/finance/hooks"
import { UnitSelect } from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"
import type {
  CashCountRow,
  GeneralLedgerRow,
  MoneyAccountRow,
  MoneyPot,
} from "@itulah/contract"

/// Cash & Bank: every cash and bank account as a card (owner's sketch,
/// 19 Oct 2026), and the card opens the account's kartu.
///
/// The card says, left to right and top to bottom: the account and its place;
/// Books | Bank (the statement's date) or Counted; money in | money out for the
/// month; and the one act that belongs to it, Reconcile | Upload statement for
/// a bank, Count cash for the rest. 7Soft's Info Kas Bank and Kartu Kas/Bank
/// are this page and its sheet.
///
/// # Where the figures come from
///
/// - Books, the statement's closing figure and its unmatched lines: `GET /money`.
/// - Money in and out: the ledger's own window totals for the account
///   (`GET /accounts/{code}/ledger`), debit in and credit out.
/// - Counted: the newest physical count of the account (`GET /cash-counts`).
///   A count belongs to a site; the site's unit finds the account.
/// - The kartu: the ledger's own lines, with the cash documents' numbers.
///
/// Nothing is added up that the server already adds up.

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/// One account's movements over a window, a page at a time.
const kartuQuery = (code: string, unit: string, from: string, to: string) =>
  infiniteQueryOptions({
    queryKey: [...financeKeys.all, "kartu-kas-bank", code, unit, from, to],
    queryFn: ({ pageParam, signal }) =>
      accountLedger(
        code,
        { unit, from, to, limit: 100, cursor: pageParam },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// The account and the unit it is kept in: one row of `/money` is one of
/// these, and the same code can be in two units' books.
function accountKey(row: { account_code: string; unit_id: string }): string {
  return `${row.unit_id}\t${row.account_code}`
}

function accountText(row: MoneyAccountRow): string {
  return `${row.account_code} · ${row.account_name}`
}

/// The quiet line under an account's name, as the card and the list write it:
/// a bank's own number, or where a cash box sits and its ledger code.
function accountSub(a: AccountCard): string {
  if (a.kind === "bank") return a.no ?? a.row.account_code
  return `${a.row.unit_name} · ${a.row.account_code}`
}

// ---------------------------------------------------------------------------
// Cash & Bank
// ---------------------------------------------------------------------------

export function KasBank() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Cash & Bank" title="Cash & Bank">
          Reading the accounts…
        </ScreenPending>
      }
    >
      <KasBankScreen />
    </Suspense>
  )
}

type Kind = "bank" | "cash" | "petty" | "float"

const KIND_OF: Partial<Record<MoneyPot, Kind>> = {
  BANK: "bank",
  CASH: "cash",
  PETTY_CASH: "petty",
  CASHIER_FLOAT: "float",
}

/// One account as the card draws it: the books' figure beside what the bank
/// or the drawer says, and what moved in the window.
interface AccountCard {
  readonly key: string
  readonly row: MoneyAccountRow
  readonly kind: Kind
  /// The account's own number at the bank, when somebody has described it.
  readonly no: string | null
  /// The unit as a person says it: "C003 · Purbalingga".
  readonly place: string
  readonly books: number
  /// The statement's closing figure, and the day it closes.
  readonly bank: number | null
  readonly stmtOn: string | null
  readonly statementId: string | null
  readonly toMatch: number
  /// The newest physical count of a cash account.
  readonly counted: number | null
  readonly countedOn: string | null
  readonly inM: number | null
  readonly outM: number | null
}

const WEEK_DAYS = 7

function daysSince(iso: string, today: string): number {
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) /
      86_400_000
  )
}

function hit(query: string, ...texts: readonly (string | null | undefined)[]) {
  const needle = query.trim().toLowerCase()
  if (needle === "") return true
  return texts.some((text) => (text ?? "").toLowerCase().includes(needle))
}

/// "+Rp 20.000" / "−Rp 50.000": a difference says which way it went.
function signedMoney(minor: number): string {
  return minor > 0 ? `+${money(minor)}` : money(minor)
}

/// Brand colours of the banks the client uses, for the mark on a bank's card.
const BANK_TONES: readonly (readonly [RegExp, string])[] = [
  [/bca/i, "#0060af"],
  [/mandiri|mdr/i, "#003d79"],
  [/bri\b/i, "#00529c"],
  [/bni/i, "#f15a23"],
  [/danamon/i, "#f39200"],
]

function bankMark(name: string): { short: string; tone: string | null } {
  const tone = BANK_TONES.find(([test]) => test.test(name))?.[1] ?? null
  const words = name.trim().split(/\s+/)
  const last = words[words.length - 1] ?? name
  const short = (last.length <= 4 ? last : last.slice(0, 3)).toUpperCase()
  return { short, tone }
}

/// What the right-hand figure of a card says: the statement for a bank, the
/// newest count for the rest.
function countedLine(a: AccountCard): {
  big: string
  sm: ReactNode
  bad: boolean
} {
  if (a.kind === "bank") {
    if (a.bank === null || a.stmtOn === null)
      return { big: "—", sm: "No statement", bad: false }
    return {
      big: money(a.bank),
      sm: `Bank · ${dayMonth(a.stmtOn)}`,
      bad: a.bank !== a.books,
    }
  }
  if (a.counted === null || a.countedOn === null)
    return { big: "—", sm: "Not counted yet", bad: false }
  const short = a.counted - a.books
  return {
    big: money(a.counted),
    sm:
      short === 0 ? (
        `Counted · ${dayMonth(a.countedOn)}`
      ) : (
        <>
          <span className="text-bad-fg">
            {short < 0 ? "Short" : "Over"} {money(Math.abs(short))}
          </span>{" "}
          · {dayMonth(a.countedOn)}
        </>
      ),
    bad: short !== 0,
  }
}

function reconcileWord(a: AccountCard): string {
  return a.toMatch > 0 ? `Reconcile · ${count(a.toMatch)}` : "Reconcile"
}

function KasBankScreen() {
  const range = useSettledWindow()
  const navigate = useNavigate()
  const [kind, setKind] = useState<string | null>(null)
  const [place, setPlace] = useState("")
  const [query, setQuery] = useState("")
  const [view, setView] = useState<"cards" | "list">("cards")
  const [opened, setOpened] = useState<string | null>(null)
  const [counting, setCounting] = useState<string | null>(null)

  const overview = useSuspenseQuery(moneyOverviewQuery())
  const counts = useQuery(cashCountsQuery())
  const described = useQuery(companyBankAccountsQuery())
  const units = useUnits()

  const accounts = useMemo(
    () =>
      overview.data.rows
        .filter((row) => KIND_OF[row.pot] !== undefined)
        .sort(
          (a, b) =>
            a.account_code.localeCompare(b.account_code) ||
            a.unit_id.localeCompare(b.unit_id)
        ),
    [overview.data.rows]
  )

  const flows = useQueries({
    queries: accounts.map((account) =>
      ledgerWindowQuery(
        account.account_code,
        account.unit_id,
        range.from,
        range.to
      )
    ),
    combine: (results) =>
      results.map((result) => ({
        inM: result.data?.window_debit_minor ?? null,
        outM: result.data?.window_credit_minor ?? null,
      })),
  })

  /// A count names its site; the site's unit finds the account.
  const countOf = useMemo(() => {
    const unitOfSite = new Map<string, string>()
    for (const unit of units.data ?? [])
      for (const site of unit.sites) unitOfSite.set(site.id, unit.id)
    const newest = new Map<string, CashCountRow>()
    // Newest first: the first count seen for an account is its latest.
    for (const one of counts.data ?? []) {
      const unit = unitOfSite.get(one.site_id)
      if (unit === undefined) continue
      const key = accountKey({ account_code: one.account_code, unit_id: unit })
      if (!newest.has(key)) newest.set(key, one)
    }
    return newest
  }, [counts.data, units.data])

  /// The account number at the bank, from the accounts somebody described —
  /// the same key the ledger row carries, so a code in two units' books keeps
  /// its own number.
  const describedOf = useMemo(() => {
    const table = new Map<string, string>()
    for (const one of described.data ?? [])
      table.set(`${one.unit_id}\t${one.ledger_account_code}`, one.account_no)
    return table
  }, [described.data])

  /// The unit as a person says it, `C003 · Purbalingga`, rather than the bare
  /// name the ledger row carries.
  const placeOf = useMemo(() => {
    const table = new Map<string, string>()
    for (const unit of units.data ?? [])
      table.set(unit.id, `${unit.code} · ${unit.name}`)
    return table
  }, [units.data])

  const cards = useMemo<AccountCard[]>(
    () =>
      accounts.map((row, index) => {
        const key = accountKey(row)
        const kindOf = KIND_OF[row.pot] ?? "cash"
        const last = countOf.get(key)
        const number = describedOf.get(key)
        return {
          key,
          row,
          kind: kindOf,
          // An empty number is "nobody has said", not a number.
          no: number === undefined || number === "" ? null : number,
          place: placeOf.get(row.unit_id) ?? row.unit_name,
          books: row.per_books_minor,
          bank: row.last_statement?.closing_minor ?? null,
          stmtOn: row.last_statement?.period_end ?? null,
          statementId: row.last_statement?.statement_id ?? null,
          toMatch: row.last_statement?.unmatched_count ?? 0,
          counted: kindOf === "bank" ? null : (last?.counted_minor ?? null),
          countedOn: kindOf === "bank" ? null : (last?.counted_on ?? null),
          inM: flows[index]?.inM ?? null,
          outM: flows[index]?.outM ?? null,
        }
      }),
    [accounts, countOf, flows, describedOf, placeOf]
  )

  const today = todayIso()
  const banks = cards.filter((a) => a.kind === "bank")
  const cash = cards.filter((a) => a.kind !== "bank")
  const toMatch = banks.reduce((sum, a) => sum + a.toMatch, 0)
  const short = cash.filter((a) => a.counted !== null && a.counted !== a.books)
  const stale = cash.filter(
    (a) => a.countedOn === null || daysSince(a.countedOn, today) > WEEK_DAYS
  )
  const sum = (list: readonly AccountCard[]) =>
    list.reduce((total, a) => total + a.books, 0)

  const shown = cards.filter(
    (a) =>
      (kind === null || a.kind === kind) &&
      (place === "" || a.row.unit_id === place) &&
      hit(
        query,
        a.row.account_name,
        a.row.account_code,
        a.place,
        a.row.unit_name,
        a.row.unit_id,
        a.no
      )
  )
  const n = (k: Kind) => cards.filter((a) => a.kind === k).length
  const kinds: ChipOption[] = [
    { value: null, label: "All", icon: LayoutGrid, count: cards.length },
    { value: "bank", label: "Bank", icon: Landmark, count: n("bank") },
    { value: "cash", label: "Cash", icon: Banknote, count: n("cash") },
    { value: "petty", label: "Petty cash", icon: Coins, count: n("petty") },
    { value: "float", label: "Float", icon: Wallet, count: n("float") },
  ]

  const reconcile = (a: AccountCard) =>
    void navigate({
      to: "/finance/cash-bank/bank-reconciliation",
      search: { statement: a.statementId ?? undefined },
    } as never)
  const upload = () =>
    void navigate({ to: "/finance/cash-bank/bank-transactions" } as never)

  const open = cards.find((a) => a.key === opened) ?? null
  const counted = cards.find((a) => a.key === counting) ?? null

  const columns = useMemo<ColumnDef<TableSetup, AccountCard>[]>(
    () => [
      {
        id: "account",
        accessorFn: (a) => a.row.account_name,
        header: "Account",
        size: 280,
        enableSorting: false,
        meta: { card: "title", grow: 240 },
        cell: ({ row }) => (
          <span className="block truncate">
            <span className="font-medium text-ink">
              {row.original.row.account_name}
            </span>{" "}
            <span className="text-mute">{accountSub(row.original)}</span>
          </span>
        ),
      },
      {
        id: "place",
        accessorFn: (a) => a.place,
        header: "Place",
        size: 170,
        enableSorting: false,
        meta: { card: "meta", priority: 2 },
        cell: ({ row }) => (
          <span className="block truncate">{row.original.place}</span>
        ),
      },
      {
        id: "books",
        accessorFn: (a) => a.books,
        header: "Books",
        size: 170,
        enableSorting: false,
        meta: { align: "right", card: "lead" },
        cell: ({ row }) => <CellMoney minor={row.original.books} />,
      },
      {
        id: "counted",
        accessorFn: (a) => a.bank ?? a.counted,
        header: "Bank or counted",
        size: 170,
        enableSorting: false,
        meta: { align: "right", card: "metric", priority: 1 },
        cell: ({ row }) => {
          const line = countedLine(row.original)
          return (
            <span
              className={cn(
                line.bad && row.original.kind !== "bank" && "text-bad-fg"
              )}
            >
              {line.big}
            </span>
          )
        },
      },
      {
        id: "date",
        accessorFn: (a) => a.stmtOn ?? a.countedOn ?? "",
        header: "Date",
        size: 100,
        enableSorting: false,
        meta: { card: "hide", priority: 3 },
        cell: ({ row }) => {
          const on = row.original.stmtOn ?? row.original.countedOn
          return on === null ? (
            <span className="text-faint">—</span>
          ) : (
            dayMonth(on)
          )
        },
      },
      {
        id: "in",
        accessorFn: (a) => a.inM,
        header: `In · ${monthYear(range.to)}`,
        size: 170,
        enableSorting: false,
        meta: { align: "right", card: "hide", priority: 2 },
        cell: ({ row }) =>
          row.original.inM === null ? (
            <span className="text-faint">—</span>
          ) : (
            <span className="text-ok-fg">+{money(row.original.inM)}</span>
          ),
      },
      {
        id: "out",
        accessorFn: (a) => a.outM,
        header: `Out · ${monthYear(range.to)}`,
        size: 170,
        enableSorting: false,
        meta: { align: "right", card: "hide", priority: 2 },
        cell: ({ row }) =>
          row.original.outM === null ? (
            <span className="text-faint">—</span>
          ) : (
            <span className="text-bad-fg">−{money(row.original.outM)}</span>
          ),
      },
      {
        id: "act",
        accessorFn: () => "",
        header: "",
        size: 190,
        enableSorting: false,
        meta: { card: "foot" },
        cell: ({ row }) => (
          <CardActions
            a={row.original}
            small
            onReconcile={reconcile}
            onUpload={upload}
            onCount={(a) => setCounting(a.key)}
          />
        ),
      },
    ],
    // `reconcile` and `upload` only read the router's navigate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range.to]
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: shown,
        columns,
        getRowId: (a: AccountCard) => a.key,
      }),
      [shown, columns]
    )
  )

  return (
    <PageContent>
      <PageHeader crumb="Finance · Cash & Bank" title="Cash & Bank" />
      <KpiStrip className="xl:grid-cols-5">
        <Kpi
          label="In banks"
          value={money(sum(banks))}
          onClick={() => setKind("bank")}
        />
        <Kpi
          label="In cash"
          value={money(sum(cash))}
          onClick={() => setKind("cash")}
        />
        <Kpi
          label="Bank lines to match"
          value={count(toMatch)}
          onClick={() =>
            void navigate({
              to: "/finance/cash-bank/bank-reconciliation",
            } as never)
          }
        />
        <Kpi
          label="Cash short or over"
          value={
            <span className={cn(short.length > 0 && "text-bad-fg")}>
              {count(short.length)}
            </span>
          }
        />
        <Kpi
          label="Not counted for a week"
          value={
            <span className={cn(stale.length > 0 && "text-warn-fg")}>
              {count(stale.length)}
            </span>
          }
        />
      </KpiStrip>

      <Toolbar className="group/bar">
        <ExpandingSearch
          value={query}
          onChange={setQuery}
          label="Account or shop"
        />
        <UnitSelect
          value={place}
          onChange={setPlace}
          emptyLabel="Every place"
          className="h-control w-52"
          aria-label="Place"
        />
        <Toolbar.Spacer />
        <Segmented
          options={[
            { value: "cards", label: "Cards" },
            { value: "list", label: "List" },
          ]}
          value={view}
          onChange={setView}
        />
      </Toolbar>
      <div className="mb-4">
        <FilterChips
          label="Kind"
          value={kind}
          options={kinds}
          onChange={setKind}
        />
      </div>

      {cards.length === 0 ? (
        <EmptyState>No cash or bank account is mapped yet.</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState>No account matches</EmptyState>
      ) : view === "cards" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,26rem),1fr))] gap-4">
          {shown.map((a) => (
            <AccountCardView
              key={a.key}
              a={a}
              onOpen={() => setOpened(a.key)}
              onReconcile={reconcile}
              onUpload={upload}
              onCount={(one) => setCounting(one.key)}
            />
          ))}
        </div>
      ) : (
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <DataTable<AccountCard>
            refresh={[overview]}
            table={table}
            onRowClick={(a) => setOpened(a.key)}
            pageScroll
            cardSort={false}
            cardsApart
            cardLead
          />
        </Card>
      )}

      {open !== null && (
        <AccountSheet
          a={open}
          from={range.from}
          to={range.to}
          onClose={() => setOpened(null)}
          onReconcile={reconcile}
          onUpload={upload}
          onCount={(a) => {
            setOpened(null)
            setCounting(a.key)
          }}
        />
      )}
      {counted !== null && (
        <CountCashSheet a={counted} onClose={() => setCounting(null)} />
      )}
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/// The act that belongs to an account: Reconcile | Upload statement for a
/// bank, Count cash for the rest.
function CardActions({
  a,
  small = false,
  onReconcile,
  onUpload,
  onCount,
}: {
  a: AccountCard
  small?: boolean
  onReconcile: (a: AccountCard) => void
  onUpload: () => void
  onCount: (a: AccountCard) => void
}) {
  const size = small ? "sm" : "default"
  const stop = (act: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation()
    act()
  }
  if (a.kind !== "bank")
    return (
      <Button variant="primary" size={size} onClick={stop(() => onCount(a))}>
        Count cash
      </Button>
    )
  if (a.statementId === null)
    return (
      <Button variant="primary" size={size} onClick={stop(onUpload)}>
        Upload statement
      </Button>
    )
  return (
    <span className="flex items-center gap-2">
      <Button
        variant="primary"
        size={size}
        onClick={stop(() => onReconcile(a))}
      >
        {reconcileWord(a)}
      </Button>
      {!small && (
        <Button variant="ghost" size={size} onClick={stop(onUpload)}>
          <Download />
          Upload statement
        </Button>
      )}
    </span>
  )
}

function AccountMark({ a }: { a: AccountCard }) {
  if (a.kind !== "bank")
    return (
      <span className="grid size-10 flex-none place-items-center rounded-[0.625rem] bg-soft-2 text-body">
        <Wallet className="size-5" />
      </span>
    )
  const mark = bankMark(a.row.account_name)
  return (
    <span
      className={cn(
        "grid size-10 flex-none place-items-center rounded-[0.625rem] text-[0.9375rem] font-semibold text-white",
        mark.tone === null && "bg-ink"
      )}
      style={mark.tone === null ? undefined : { background: mark.tone }}
    >
      {mark.short}
    </span>
  )
}

function AccountCardView({
  a,
  onOpen,
  onReconcile,
  onUpload,
  onCount,
}: {
  a: AccountCard
  onOpen: () => void
  onReconcile: (a: AccountCard) => void
  onUpload: () => void
  onCount: (a: AccountCard) => void
}) {
  const line = countedLine(a)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Enter")
          onOpen()
      }}
      className="flex cursor-pointer flex-col rounded-card border border-hairline bg-canvas px-[1.375rem] pt-5 pb-[1.125rem] transition-[border-color,box-shadow] duration-(--t-hover) ease-(--ease-out) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent pointer-fine:hover:border-hairline-2 pointer-fine:hover:shadow-soft"
    >
      <div className="flex items-start gap-3">
        <AccountMark a={a} />
        <div className="min-w-0 flex-1">
          <b className="block truncate font-semibold text-ink">
            {a.row.account_name}
          </b>
          <span className="block truncate text-body">{accountSub(a)}</span>
        </div>
        <span className="max-w-[40%] shrink-0 truncate text-body">
          {a.place}
        </span>
      </div>
      <div className="mt-[1.125rem] mb-3.5 grid grid-cols-2 gap-4">
        <div>
          <div className="text-[1.375rem] leading-7 font-semibold tracking-[-0.025em] whitespace-nowrap tabular-nums">
            {money(a.books)}
          </div>
          <div className="mt-0.5 text-body">Books</div>
        </div>
        <div>
          <div className="text-[1.375rem] leading-7 font-semibold tracking-[-0.025em] whitespace-nowrap tabular-nums">
            {line.big}
          </div>
          <div className="mt-0.5 text-body">{line.sm}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-hairline pt-2.5 pb-3 tabular-nums">
        {a.inM === null || a.inM === 0 ? (
          <span className="text-mute">{a.inM === null ? "—" : "Rp 0"}</span>
        ) : (
          <span className="text-ok-fg">+{money(a.inM)}</span>
        )}
        {a.outM === null || a.outM === 0 ? (
          <span className="text-mute">{a.outM === null ? "—" : "Rp 0"}</span>
        ) : (
          <span className="text-bad-fg">−{money(a.outM)}</span>
        )}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <CardActions
          a={a}
          onReconcile={onReconcile}
          onUpload={onUpload}
          onCount={onCount}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The account's sheet, with its kartu
// ---------------------------------------------------------------------------

function AccountSheet({
  a,
  from,
  to,
  onClose,
  onReconcile,
  onUpload,
  onCount,
}: {
  a: AccountCard
  from: string
  to: string
  onClose: () => void
  onReconcile: (a: AccountCard) => void
  onUpload: () => void
  onCount: (a: AccountCard) => void
}) {
  const line = countedLine(a)
  const bank = a.kind === "bank"
  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      context="Cash & Bank"
      id={a.row.account_code}
      title={
        bank && a.no !== null
          ? `${a.row.account_name} · ${a.no}`
          : a.row.account_name
      }
      caption={a.place}
      size="workspace"
      stack
      footer={
        <SheetFooter
          onPrint={() => window.print()}
          start={
            bank && a.statementId !== null ? (
              <Button variant="ghost" onClick={onUpload}>
                <Download />
                Upload statement
              </Button>
            ) : undefined
          }
          primary={
            bank
              ? a.statementId === null
                ? { label: "Upload statement", onClick: onUpload }
                : { label: reconcileWord(a), onClick: () => onReconcile(a) }
              : { label: "Count cash", onClick: () => onCount(a) }
          }
        />
      }
    >
      <KpiStrip className="mb-2! xl:grid-cols-4">
        <Kpi label="Books" value={money(a.books)} />
        <Kpi label={line.sm} value={line.big} />
        <Kpi
          label={`Money in · ${monthYear(to)}`}
          value={
            <span className="text-ok-fg">
              {a.inM === null ? "—" : `+${money(a.inM)}`}
            </span>
          }
        />
        <Kpi
          label={`Money out · ${monthYear(to)}`}
          value={
            <span className="text-bad-fg">
              {a.outM === null ? "—" : `−${money(a.outM)}`}
            </span>
          }
        />
      </KpiStrip>
      <SheetSection title="Kartu" aside={`${dayMonth(from)} – ${dayMonth(to)}`}>
        <Suspense fallback={<LoadingState>Reading the card…</LoadingState>}>
          <KartuLines
            code={a.row.account_code}
            unit={a.row.unit_id}
            from={from}
            to={to}
          />
        </Suspense>
      </SheetSection>
    </Sheet>
  )
}

/// The account's movements with the running balance: Date · Document · For ·
/// In · Out · Balance, the opening first and the window's totals last.
function KartuLines({
  code,
  unit,
  from,
  to,
}: {
  code: string
  unit: string
  from: string
  to: string
}) {
  const navigate = useNavigate()
  const pages = useSuspenseInfiniteQuery(kartuQuery(code, unit, from, to))
  const first = pages.data.pages[0]
  const rows = useMemo(
    () => pages.data.pages.flatMap((page) => page.rows),
    [pages.data]
  )
  const paid = useQuery(cashDocumentsQuery("PAY", "POSTED"))
  const received = useQuery(cashDocumentsQuery("RECEIVE", "POSTED"))
  const documents = useMemo(
    () =>
      new Map(
        [...(paid.data ?? []), ...(received.data ?? [])].map(
          (doc) => [doc.document_id, doc] as const
        )
      ),
    [paid.data, received.data]
  )

  const open = (row: GeneralLedgerRow) => {
    if (row.source_kind === "CASH_DOC" && row.source_id !== null) {
      void navigate({
        to:
          row.debit_minor > 0
            ? "/finance/cash-bank/bkm/$id"
            : "/finance/cash-bank/bkk/$id",
        params: { id: row.source_id },
      } as never)
      return
    }
    void navigate({
      to: "/finance/accounting/journal-entries",
      search: { entry: row.entry_id },
    } as never)
  }

  return (
    <>
      <MiniTable
        head={[
          "Date",
          "Document",
          { label: "For", align: "left" },
          "In",
          "Out",
          "Balance",
        ]}
      >
        <MiniRow>
          <MiniCell className="text-mute">{dayMonth(from)}</MiniCell>
          <MiniCell className="text-mute">Opening</MiniCell>
          <MiniCell> </MiniCell>
          <MiniCell align="right"> </MiniCell>
          <MiniCell align="right"> </MiniCell>
          <MiniCell align="right">{money(first.opening_minor)}</MiniCell>
        </MiniRow>
        {rows.map((row) => {
          const doc =
            row.source_id === null ? undefined : documents.get(row.source_id)
          const name = row.supplier_name ?? doc?.party_name ?? ""
          const memo = doc?.memo ?? row.memo ?? ""
          return (
            <MiniRow key={row.line_id}>
              <MiniCell>{dayMonth(row.posting_date)}</MiniCell>
              <MiniCell>
                <button
                  type="button"
                  onClick={() => open(row)}
                  className="font-medium text-ink underline-offset-2 hover:underline"
                >
                  {doc?.number ?? row.entry_number}
                </button>
              </MiniCell>
              <MiniCell>
                <span
                  className="block max-w-72 truncate"
                  title={
                    memo === ""
                      ? name
                      : `${name}${name === "" ? "" : " · "}${memo}`
                  }
                >
                  {name === "" ? (memo === "" ? "—" : memo) : name}
                  {name !== "" && memo !== "" && (
                    <span className="text-mute"> · {memo}</span>
                  )}
                </span>
              </MiniCell>
              <MiniCell align="right">
                {row.debit_minor > 0 ? money(row.debit_minor) : ""}
              </MiniCell>
              <MiniCell align="right">
                {row.credit_minor > 0 ? money(row.credit_minor) : ""}
              </MiniCell>
              <MiniCell align="right">{money(row.running_minor)}</MiniCell>
            </MiniRow>
          )
        })}
        <MiniRow>
          <MiniCell className="font-semibold text-ink"> </MiniCell>
          <MiniCell className="font-semibold text-ink">
            {count(first.total)} {first.total === 1 ? "line" : "lines"}
          </MiniCell>
          <MiniCell> </MiniCell>
          <MiniCell align="right" className="font-semibold text-ink">
            {money(first.window_debit_minor)}
          </MiniCell>
          <MiniCell align="right" className="font-semibold text-ink">
            {money(first.window_credit_minor)}
          </MiniCell>
          <MiniCell align="right" className="font-semibold text-ink">
            {money(first.closing_minor)}
          </MiniCell>
        </MiniRow>
      </MiniTable>
      {pages.hasNextPage && (
        <div>
          <Button
            variant="ghost"
            pending={pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
          >
            Show more lines
          </Button>
        </div>
      )}
      {rows.length === 0 && (
        <p className="text-[0.9375rem] text-mute">
          Nothing moved in {first.account_name} in this period.
        </p>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Count cash
// ---------------------------------------------------------------------------

/// The rupiah, as it comes out of a drawer: seven notes and three coins,
/// largest first.
const DENOMINATIONS = [
  100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
] as const

/// Counting cash: notes and coins, the figure fills itself. Saving writes the
/// count down; putting its difference in the books is a separate act on the
/// Cash counts screen, by somebody who has read the reason.
function CountCashSheet({
  a,
  onClose,
}: {
  a: AccountCard
  onClose: () => void
}) {
  const client = useQueryClient()
  const units = useUnits()
  const [quantities, setQuantities] = useState<Record<number, string>>({})
  const [countedBy, setCountedBy] = useState("")
  const [witness, setWitness] = useState("")
  const [reason, setReason] = useState("")
  const [siteChoice, setSiteChoice] = useState("")

  // The account is in a unit's books; the count is taken at one of its
  // sites. A unit with one site needs no question.
  const sites =
    units.data?.find((unit) => unit.id === a.row.unit_id)?.sites ?? []
  const siteId =
    sites.length === 1
      ? sites[0].id
      : sites.some((site) => site.id === siteChoice)
        ? siteChoice
        : ""

  const pieces = (note: number) => parseMinor(quantities[note] ?? "") ?? 0
  const counted = DENOMINATIONS.reduce(
    (total, note) => total + note * pieces(note),
    0
  )
  const diff = counted - a.books

  const save = useMutation({
    mutationFn: () =>
      recordCashCount({
        account_code: a.row.account_code,
        site_id: siteId,
        counted_on: todayIso(),
        counted_by: countedBy.trim(),
        witnessed_by: witness.trim(),
        counted_minor: counted,
        reason: reason.trim(),
        notes: DENOMINATIONS.map((note) => ({
          denomination_minor: note,
          quantity: pieces(note),
        })).filter((note) => note.quantity > 0),
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: financeKeys.cashCounts(null, null),
      })
      toast.success("Count saved", {
        description: `${a.row.account_name} · ${a.row.unit_name}`,
      })
      onClose()
    },
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      context="Cash & Bank"
      title={`Count ${a.row.account_name.toLowerCase()}`}
      caption={a.place}
      size="rail"
      stack
      dirty={counted > 0}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: "Save count",
            pending: save.isPending,
            disabled: counted === 0 || siteId === "" || countedBy.trim() === "",
            onClick: () => save.mutate(),
          }}
        />
      }
    >
      <KpiStrip className="mb-2! grid-cols-3 md:grid-cols-3 xl:grid-cols-3">
        <Kpi label="Books" value={money(a.books)} />
        <Kpi label="Counted" value={money(counted)} />
        <Kpi
          label="Difference"
          value={
            counted === 0 ? (
              "—"
            ) : (
              <span
                className={cn(
                  diff !== 0 && (diff < 0 ? "text-bad-fg" : "text-warn-fg")
                )}
              >
                {diff === 0 ? money(0) : signedMoney(diff)}
              </span>
            )
          }
        />
      </KpiStrip>
      <MiniTable
        head={["Note or coin", "Pieces", "Amount"]}
        className="[&_td]:py-1.5"
      >
        {DENOMINATIONS.map((note) => (
          <MiniRow key={note}>
            <MiniCell>{money(note)}</MiniCell>
            <MiniCell align="right">
              <Input
                inputMode="numeric"
                placeholder="0"
                value={quantities[note] ?? ""}
                onChange={(event) =>
                  setQuantities((was) => ({
                    ...was,
                    [note]: event.target.value,
                  }))
                }
                className="ml-auto h-9 w-24 text-right"
                aria-label={`How many ${money(note)}`}
              />
            </MiniCell>
            <MiniCell align="right">
              {pieces(note) === 0 ? "—" : money(note * pieces(note))}
            </MiniCell>
          </MiniRow>
        ))}
      </MiniTable>
      <div className="flex flex-col gap-4">
        {sites.length > 1 && (
          <Field label="Site" required>
            <Select value={siteId} onChange={setSiteChoice} aria-label="Site">
              <option value="">Choose one</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Counted by" required>
          <Input
            value={countedBy}
            onChange={(event) => setCountedBy(event.target.value)}
          />
        </Field>
        <Field label="Witnessed by">
          <Input
            value={witness}
            onChange={(event) => setWitness(event.target.value)}
          />
        </Field>
        {counted > 0 && diff !== 0 && (
          <Field label="Why it differs">
            <Textarea
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Kartu kas/bank
// ---------------------------------------------------------------------------

export function KartuKasBank() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Info Kas Bank" title="Kartu Kas/Bank">
          Reading the accounts…
        </ScreenPending>
      }
    >
      <KartuKasBankScreen />
    </Suspense>
  )
}

function KartuKasBankScreen() {
  const range = useWindow()
  const overview = useSuspenseQuery(moneyOverviewQuery())
  const accounts = useMemo(
    () =>
      [...overview.data.rows].sort(
        (a, b) =>
          a.account_code.localeCompare(b.account_code) ||
          a.unit_id.localeCompare(b.unit_id)
      ),
    [overview.data.rows]
  )
  const [picked, setPicked] = useState("")
  const chosen =
    accounts.find((row) => accountKey(row) === picked) ?? accounts[0] ?? null

  return (
    <PageContent>
      <PageHeader crumb="Finance · Info Kas Bank" title="Kartu Kas/Bank" />
      <Toolbar className="group/bar">
        <Select
          value={chosen === null ? "" : accountKey(chosen)}
          onChange={setPicked}
          aria-label="Kas/Bank"
          className="h-control w-80 max-w-full"
        >
          {accounts.map((row) => (
            <option key={accountKey(row)} value={accountKey(row)}>
              {accountText(row)}
            </option>
          ))}
        </Select>
        <DayRange
          label="Periode"
          placeholder="Periode"
          value={{ from: range.from, to: range.to }}
          onChange={(next) => {
            range.setFrom(next.from)
            range.setTo(next.to)
          }}
          className="h-control min-h-0 w-52 shrink-0 py-0"
        />
      </Toolbar>

      {chosen === null ? (
        <EmptyState>No cash or bank account is mapped yet.</EmptyState>
      ) : (
        <Suspense fallback={<LoadingState>Reading the card…</LoadingState>}>
          <KartuBody
            key={accountKey(chosen)}
            code={chosen.account_code}
            unit={chosen.unit_id}
            from={range.from}
            to={range.to}
          />
        </Suspense>
      )}
    </PageContent>
  )
}

/// The account's card: Awal / Debet / Kredit / Akhir over the movements, an
/// opening row first and the running Saldo down the right. A row opens the
/// document that moved the money — the BKM or BKK — or the journal entry when
/// it was something else.
function KartuBody({
  code,
  unit,
  from,
  to,
  inSheet = false,
}: {
  code: string
  unit: string
  from: string
  to: string
  /// Inside the Kas/Bank row's sheet: the sheet already holds the account.
  inSheet?: boolean
}) {
  const navigate = useNavigate()
  const askedFrom = useDeferredValue(from)
  const askedTo = useDeferredValue(to)
  const stale = askedFrom !== from || askedTo !== to
  const pages = useSuspenseInfiniteQuery(
    kartuQuery(code, unit, askedFrom, askedTo)
  )
  const first = pages.data.pages[0]
  const rows = useMemo(
    () => pages.data.pages.flatMap((page) => page.rows),
    [pages.data]
  )

  // The voucher numbers 7Soft quotes (KK-…, KM-…) belong to the cash
  // documents; the ledger row only knows the journal entry's own number.
  // Read the posted documents once and borrow their numbers and names.
  const paid = useQuery(cashDocumentsQuery("PAY", "POSTED"))
  const received = useQuery(cashDocumentsQuery("RECEIVE", "POSTED"))
  const documents = useMemo(
    () =>
      new Map(
        [...(paid.data ?? []), ...(received.data ?? [])].map(
          (doc) => [doc.document_id, doc] as const
        )
      ),
    [paid.data, received.data]
  )

  const open = (row: GeneralLedgerRow) => {
    if (row.source_kind === "CASH_DOC" && row.source_id !== null) {
      void navigate({
        to:
          row.debit_minor > 0
            ? "/finance/cash-bank/bkm/$id"
            : "/finance/cash-bank/bkk/$id",
        params: { id: row.source_id },
      } as never)
      return
    }
    void navigate({
      to: "/finance/accounting/journal-entries",
      search: { entry: row.entry_id },
    } as never)
  }

  const columns = useMemo<ColumnDef<TableSetup, GeneralLedgerRow>[]>(
    () => [
      {
        id: "date",
        accessorFn: (row) => row.posting_date,
        header: "Tanggal",
        size: 130,
        enableSorting: false,
        meta: { card: "meta" },
        cell: ({ row }) => (
          <span className="text-body">{day(row.original.posting_date)}</span>
        ),
      },
      {
        id: "number",
        accessorFn: (row) => row.entry_number,
        header: "No transaksi",
        size: 170,
        enableSorting: false,
        meta: { card: "id" },
        cell: ({ row }) => {
          const doc =
            row.original.source_id === null
              ? undefined
              : documents.get(row.original.source_id)
          return (
            <span className="text-ink">
              {doc?.number ?? row.original.entry_number}
            </span>
          )
        },
      },
      {
        id: "type",
        accessorFn: (row) => row.source_kind,
        header: "Tipe",
        size: 210,
        enableSorting: false,
        meta: { card: "foot", priority: 3 },
        cell: ({ row }) => (
          <span className="text-body">{tipeOf(row.original)}</span>
        ),
      },
      {
        id: "client",
        accessorFn: (row) => row.supplier_name ?? "",
        header: "Nama client",
        size: 240,
        enableSorting: false,
        meta: { card: "title", grow: 200 },
        cell: ({ row }) => {
          const doc =
            row.original.source_id === null
              ? undefined
              : documents.get(row.original.source_id)
          const name = row.original.supplier_name ?? doc?.party_name ?? ""
          return (
            <span className="block truncate text-ink" title={name}>
              {name === "" ? "—" : name}
            </span>
          )
        },
      },
      {
        id: "debit",
        accessorFn: (row) => (row.debit_minor === 0 ? null : row.debit_minor),
        header: "Debet",
        size: 140,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) =>
          row.original.debit_minor === 0 ? (
            <span className="text-mute">·</span>
          ) : (
            <CellMoney minor={row.original.debit_minor} />
          ),
      },
      {
        id: "credit",
        accessorFn: (row) => (row.credit_minor === 0 ? null : row.credit_minor),
        header: "Kredit",
        size: 140,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) =>
          row.original.credit_minor === 0 ? (
            <span className="text-mute">·</span>
          ) : (
            <CellMoney minor={row.original.credit_minor} />
          ),
      },
      {
        id: "balance",
        accessorFn: (row) => row.running_minor,
        header: "Saldo",
        size: 160,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => (
          <span className="font-medium text-ink">
            <CellMoney minor={row.original.running_minor} />
          </span>
        ),
      },
    ],
    [documents]
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: GeneralLedgerRow) => row.line_id,
      }),
      [rows, columns]
    )
  )

  return (
    <>
      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="Awal" value={money(first?.opening_minor ?? null)} />
        <Kpi label="Debet" value={money(first?.window_debit_minor ?? null)} />
        <Kpi label="Kredit" value={money(first?.window_credit_minor ?? null)} />
        <Kpi label="Akhir" value={money(first?.closing_minor ?? null)} />
      </KpiStrip>
      {inSheet && (
        <p className="mb-3 text-[0.9375rem] text-mute">
          {day(from)} – {day(to)}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState>
          Nothing moved in {first?.account_name ?? "this account"} in this
          period.
        </EmptyState>
      ) : (
        <div className="list-swap" aria-busy={stale || undefined}>
          <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            <DataTable<GeneralLedgerRow>
              refresh={[pages]}
              table={table}
              more={pages}
              onRowClick={open}
              // Saldo awal: the balance the day before the window, where the
              // first movement picks it up.
              renderBefore={(_row, index) =>
                index === 0 ? (
                  <div className="flex items-baseline justify-between gap-3 bg-soft px-3 py-2 text-[0.9375rem] text-mute">
                    <span>Saldo awal</span>
                    <span className="tabular-nums">
                      {money(first.opening_minor)}
                    </span>
                  </div>
                ) : null
              }
              pageScroll
              cardSort={false}
              cardsApart
            />
          </Card>
          <p className="mt-3 text-[0.9375rem] text-mute tabular-nums">
            {count(rows.length)} of {count(first.total)} lines
          </p>
        </div>
      )}
    </>
  )
}

/// 7Soft's Tipe column: "BKM (Bukti Kas/Bank Masuk)" when the account was
/// debited by a cash document, "BKK (Bukti Kas/Bank Keluar)" when credited.
/// Anything else says what it was in the hub's own words.
function tipeOf(row: GeneralLedgerRow): string {
  if (row.source_kind === "CASH_DOC")
    return row.debit_minor > 0
      ? "BKM (Bukti Kas/Bank Masuk)"
      : "BKK (Bukti Kas/Bank Keluar)"
  return label(row.source_kind)
}
