import {
  useIsFetching,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQueries,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { count, day, label, moneyFigure, money } from "@/lib/format"
import {
  accountSearchPagesQuery,
  periodsQuery,
  trialBalanceQuery,
} from "@/lib/queries/finance"
import {
  openingCutoversQuery,
  openingReportQuery,
} from "@/lib/queries/finance-opening"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { ROOT_CLASSES_SHORT } from "@/screens/finance/chart"
import { SiteName, UnitName } from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"
import type {
  OpeningCutoverReport,
  OpeningEquation,
  OpeningFallback,
  OpeningUnmapped,
  TrialBalanceRow,
} from "@itulah/contract"

/// Finance › Master › Saldo Awal COA (7Soft 2.17, manual p.77–78): the opening
/// balance of every account, and the proof that the opening is sound.
///
/// What 7Soft shows is here under its own names: the period and whether it is
/// closed, Refresh, and the grid Kode · Nama · Saldo Awal · Periode with a
/// footer that must be zero — signed as 7Soft signs it, debit less credit, so
/// an asset is positive and a liability or equity negative.
///
/// **Where it differs, and why the hub's way is better.**
///
/// - 7Soft types the balance into the grid, one account at a time, and every
///   account of the chart is a row whether it has a balance or not. The grid
///   here lists every account too, a class at a time, a zero reading 0. The
///   balances arrive from the client's own closing trial balance as a file
///   (`POST /finance/opening/balances`), rehearsed before it is committed, so
///   nothing is typed into the grid: the server has no write for one account.
/// - 7Soft keeps the receivable, payable and stock details on other menus and
///   leaves it to the accountant to check that each adds up to its account.
///   The server checks it — the open items and the stock layers against the
///   account that is meant to explain them — and the tie-out below shows its
///   answer.
///
/// **Read-only.** The import is an administrator's act from a file, rehearsed
/// by default; "Create New Saldo" has no equivalent on this screen. The period
/// is "Closed" when the month the opening sits in has been closed, and then
/// the opening cannot be posted into at all.
///
/// The grid is the trial balance as at the cutover date, which on a cutover is
/// the opening entries and nothing else. Accounts are summed across units.

/// One account of the grid. Signed: debit less credit.
interface GridRow {
  readonly code: string
  readonly name: string
  readonly net: number
}

/// The trial balance's lines, one row per account: the same account in two
/// units' books is one account of the chart, and the grid is the chart's.
function gridOf(rows: readonly TrialBalanceRow[]): GridRow[] {
  const by = new Map<string, GridRow>()
  for (const row of rows) {
    const net = row.debit_minor - row.credit_minor
    const found = by.get(row.account_code)
    by.set(row.account_code, {
      code: row.account_code,
      name: row.name,
      net: (found?.net ?? 0) + net,
    })
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code))
}

/// 7Soft's PERIODE: year and month as six digits, `202609`.
const periodOf = (cutover: string) => cutover.slice(0, 4) + cutover.slice(5, 7)

/// A control equation as the tie-out reads it. `details` is what the open
/// items or the stock layers add up to, `accounts` what the ledger says.
interface TieRow {
  readonly id: string
  readonly kind: "Receivables" | "Payables" | "Stock"
  readonly sub: string
  readonly unit: string | null
  readonly accounts: number
  readonly details: number
}

const KIND_ORDER = { Receivables: 0, Payables: 1, Stock: 2 } as const

/// The sub-ledger equations out of the report: the open items against their
/// control accounts (`payment_ledger.control_accounts`) and the shelf against
/// the inventory account (`stock.value_vs_gl`). The books-balance equations are
/// the grid's own footer, per unit, and are not repeated.
///
/// The server's `detail` sentence is the only place the side and the control
/// account's meaning are written down, so it is read once, here; a sentence
/// that does not match falls back to the equation's own title.
function tiesOf(equations: readonly OpeningEquation[]): TieRow[] {
  const rows: TieRow[] = []
  equations.forEach((one, index) => {
    if (one.key === "stock.value_vs_gl") {
      rows.push({
        id: `${one.key}|${one.unit_id}|${index}`,
        kind: "Stock",
        sub: "Inventory",
        unit: one.unit_id,
        accounts: one.right_minor,
        details: one.left_minor,
      })
    } else if (one.key === "payment_ledger.control_accounts") {
      const found =
        /^(.+?)(?: \((.*?)\))? in .+?'s books \((PAYABLE|RECEIVABLE)\)/.exec(
          one.detail
        )
      const kind =
        found?.[3] === "PAYABLE" ||
        (found === null && /payable/i.test(one.title))
          ? "Payables"
          : "Receivables"
      rows.push({
        id: `${one.key}|${one.unit_id}|${index}`,
        kind,
        sub:
          found === null
            ? one.title
            : `${label(found[1])}${found[2] ? ` · ${found[2]}` : ""}`,
        unit: one.unit_id,
        accounts: one.right_minor,
        details: one.left_minor,
      })
    }
  })
  return rows
    .filter((row) => row.accounts !== 0 || row.details !== 0)
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.sub.localeCompare(b.sub) ||
        (a.unit ?? "").localeCompare(b.unit ?? "")
    )
}

/// What 7Soft prints in the top left: whether the period the opening sits in
/// is closed.
function periodStatus(
  periods: readonly { year: number; month: number; status: string }[],
  cutover: string
): { word: string; tone: "ok" | "neutral" } {
  const found = periods.find(
    (one) =>
      one.year === Number(cutover.slice(0, 4)) &&
      one.month === Number(cutover.slice(5, 7))
  )
  if (found === undefined) return { word: "Not yet", tone: "neutral" }
  return found.status === "OPEN"
    ? { word: "Open", tone: "ok" }
    : { word: label(found.status), tone: "neutral" }
}

export function OpeningBalances() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Master" title="Saldo Awal COA">
          Reading the opening balances…
        </ScreenPending>
      }
    >
      <OpeningScreen />
    </Suspense>
  )
}

function OpeningScreen() {
  const client = useQueryClient()
  const cutovers = useSuspenseQuery(openingCutoversQuery())
  const periods = useSuspenseQuery(periodsQuery())
  const [picked, setPicked] = useState("")
  const dates = cutovers.data
  const cutover = dates.includes(picked) ? picked : (dates[0] ?? "")
  const reading = useIsFetching({ queryKey: ["finance"] }) > 0
  const status = cutover === "" ? null : periodStatus(periods.data, cutover)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Master"
        title="Saldo Awal COA"
        actions={
          <Button
            variant="primary"
            pending={reading}
            onClick={() =>
              void client.refetchQueries({
                queryKey: ["finance"],
                type: "active",
              })
            }
          >
            Refresh
          </Button>
        }
      />

      {cutover === "" ? (
        <EmptyState>
          No opening balance has been brought in yet. An administrator imports
          the closing trial balance of the old books as a file.
        </EmptyState>
      ) : (
        <>
          <Toolbar className="group/bar">
            {status !== null && (
              <Status tone={status.tone} className="mr-2 text-[1.0625rem]">
                {status.word}
              </Status>
            )}
            <span className="text-[0.9375rem] text-mute">Periode</span>
            <span className="inline-flex w-64 max-w-full shrink-0">
              <Select
                value={cutover}
                onChange={setPicked}
                aria-label="Periode"
                className="h-control w-64 max-w-full"
              >
                {dates.map((date) => (
                  <option key={date} value={date}>
                    {periodOf(date)} · {day(date)}
                  </option>
                ))}
              </Select>
            </span>
          </Toolbar>

          <Suspense
            fallback={<LoadingState>Reading the opening…</LoadingState>}
          >
            <OpeningBody key={cutover} cutover={cutover} />
          </Suspense>
        </>
      )}
    </PageContent>
  )
}

function OpeningBody({ cutover }: { cutover: string }) {
  const [report, balance] = useSuspenseQueries({
    queries: [openingReportQuery(cutover), trialBalanceQuery(cutover)],
  })
  const rows = useMemo(() => gridOf(balance.data.rows), [balance.data.rows])
  const total = rows.reduce((sum, row) => sum + row.net, 0)
  const ties = useMemo(() => tiesOf(report.data.equations), [report.data])
  const period = periodOf(cutover)

  return (
    <>
      <KpiStrip className="md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Accounts" value={count(rows.length)} />
        <Kpi
          label="Out of balance"
          value={
            <span className={cn(total !== 0 && "text-bad-fg")}>
              {money(total)}
            </span>
          }
        />
        <Kpi label="Receivables" value={money(report.data.receivable_minor)} />
        <Kpi label="Payables" value={money(report.data.payable_minor)} />
        <Kpi label="Stock" value={money(report.data.stock_value_minor)} />
      </KpiStrip>

      <Verdict report={report.data} total={total} />

      <AccountGrid rows={rows} total={total} period={period} />

      {ties.length > 0 && <TieOut rows={ties} />}
      {report.data.unmapped.length > 0 && (
        <NotPosted rows={report.data.unmapped} />
      )}
      {report.data.fallbacks.length > 0 && (
        <Fallbacks
          rows={report.data.fallbacks}
          value={report.data.fallback_value_minor}
        />
      )}
    </>
  )
}

/// The report's one-line answer, said only when it is not "sound".
function Verdict({
  report,
  total,
}: {
  report: OpeningCutoverReport
  total: number
}) {
  if (report.sound && total === 0) return null
  const parts = [
    total !== 0 ? `the accounts are out by ${money(total)}` : null,
    report.equations.some((one) => !one.agrees)
      ? `${count(report.equations.filter((one) => !one.agrees).length)} checks disagree`
      : null,
    report.unmapped.length > 0
      ? `${count(report.unmapped.length)} lines were never posted`
      : null,
  ].filter((part): part is string => part !== null)
  return (
    <Banner tone="bad" className="mb-4">
      The opening is not sound
      {parts.length > 0 ? `: ${parts.join(", ")}` : ""}.
    </Banner>
  )
}

/// Every account of the chart, as 7Soft's grid lists them, zero or not. The
/// chart is thousands of accounts, so one class is shown at a time and the
/// search reaches across all of them; the accounts that carry a balance take
/// it from the trial balance and the rest read 0.
function AccountGrid({
  rows,
  total,
  period,
}: {
  rows: readonly GridRow[]
  total: number
  period: string
}) {
  const [klass, setKlass] = useState("1")
  const [query, setQuery] = useState("")
  const needle = useDebounced(query.trim(), 400)
  const asked = needle === "" ? klass : needle
  const balances = useMemo(
    () => new Map(rows.map((row) => [row.code, row.net])),
    [rows]
  )

  return (
    <>
      <Toolbar className="group/bar">
        <Segmented
          options={Object.entries(ROOT_CLASSES_SHORT).map(([value, name]) => ({
            value,
            label: name,
          }))}
          value={klass}
          onChange={(next) => {
            setKlass(next)
            setQuery("")
          }}
        />
        <ExpandingSearch
          value={query}
          onChange={setQuery}
          label="Search account"
        />
      </Toolbar>
      <Suspense fallback={<LoadingState>Reading the chart…</LoadingState>}>
        <AccountRows
          key={asked}
          needle={asked}
          balances={balances}
          total={total}
          period={period}
        />
      </Suspense>
    </>
  )
}

function AccountRows({
  needle,
  balances,
  total,
  period,
}: {
  needle: string
  balances: ReadonlyMap<string, number>
  total: number
  period: string
}) {
  const pages = useSuspenseInfiniteQuery(accountSearchPagesQuery(needle, false))
  const rows = useMemo<GridRow[]>(
    () =>
      pages.data.pages
        .flatMap((page) => page.rows)
        .filter((account) => !account.is_group)
        .map((account) => ({
          code: account.account_code,
          name: account.name,
          net: balances.get(account.account_code) ?? 0,
        })),
    [pages.data, balances]
  )
  const columns = useMemo<ColumnDef<TableSetup, GridRow>[]>(
    () => [
      {
        id: "code",
        accessorFn: (row) => row.code,
        header: "Kode",
        size: 160,
        enableSorting: false,
        meta: { card: "id" },
        cell: ({ row }) => (
          <AppLink
            to="/finance/accounting/chart-of-accounts"
            sheet={{ key: "account", value: row.original.code }}
            className="record-link tabular-nums"
          >
            {row.original.code}
          </AppLink>
        ),
      },
      {
        id: "name",
        accessorFn: (row) => row.name,
        header: "Nama",
        size: 320,
        enableSorting: false,
        meta: { card: "title", grow: 240 },
        cell: ({ row }) => (
          <span className="text-ink">{row.original.name}</span>
        ),
      },
      {
        id: "saldo",
        accessorFn: (row) => row.net,
        header: "Saldo Awal",
        size: 190,
        enableSorting: false,
        meta: { align: "right", card: "lead" },
        cell: ({ row }) => (
          <span
            className={cn(
              "tabular-nums",
              row.original.net === 0 && "text-faint"
            )}
          >
            {row.original.net === 0 ? "0" : moneyFigure(row.original.net)}
          </span>
        ),
      },
      {
        id: "periode",
        accessorFn: () => period,
        header: "Periode",
        size: 120,
        enableSorting: false,
        meta: { align: "right", card: "foot", priority: 2 },
        cell: () => <span className="text-mute tabular-nums">{period}</span>,
      },
    ],
    [period]
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: GridRow) => row.code,
      }),
      [rows, columns]
    )
  )

  return (
    <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      {rows.length === 0 ? (
        <EmptyState>No account matches.</EmptyState>
      ) : (
        <DataTable<GridRow>
          table={table}
          more={pages}
          pageScroll
          cardSort={false}
          cardsApart
          cardLead
          summary={{
            name: "Total",
            saldo: (
              <span
                className={cn("tabular-nums", total !== 0 && "text-bad-fg")}
              >
                {moneyFigure(total)}
              </span>
            ),
          }}
        />
      )}
    </Card>
  )
}

const SectionHead = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mt-8 mb-3 text-[1.0625rem] font-semibold text-ink">
    {children}
  </h2>
)

/// Receivables, payables and stock: what the account says, what the details
/// add up to, and whether they tie.
function TieOut({ rows }: { rows: readonly TieRow[] }) {
  const columns = useMemo<ColumnDef<TableSetup, TieRow>[]>(
    () => [
      {
        id: "kind",
        accessorFn: (row) => row.kind,
        header: "Sub-ledger",
        size: 280,
        enableSorting: false,
        meta: { card: "title", grow: 220 },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="text-ink">{row.original.kind}</span>
            <span className="text-mute">
              {row.original.sub} · <UnitName id={row.original.unit} />
            </span>
          </span>
        ),
      },
      {
        id: "accounts",
        accessorFn: (row) => row.accounts,
        header: "In the accounts",
        size: 190,
        enableSorting: false,
        meta: { align: "right", card: "meta" },
        cell: ({ row }) => (
          <span className="tabular-nums">
            {moneyFigure(row.original.accounts)}
          </span>
        ),
      },
      {
        id: "details",
        accessorFn: (row) => row.details,
        header: "Sum of the details",
        size: 190,
        enableSorting: false,
        meta: { align: "right", card: "meta" },
        cell: ({ row }) => (
          <span className="tabular-nums">
            {moneyFigure(row.original.details)}
          </span>
        ),
      },
      {
        id: "result",
        accessorFn: (row) => row.accounts - row.details,
        header: "Result",
        size: 220,
        enableSorting: false,
        meta: { card: "status" },
        cell: ({ row }) => {
          const difference = row.original.accounts - row.original.details
          return difference === 0 ? (
            <Status tone="ok">Tie</Status>
          ) : (
            <span className="text-bad-fg tabular-nums">
              Difference {moneyFigure(difference)}
            </span>
          )
        },
      },
    ],
    []
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as TieRow[],
        columns,
        getRowId: (row: TieRow) => row.id,
      }),
      [rows, columns]
    )
  )
  return (
    <>
      <SectionHead>Sub-ledger tie-out</SectionHead>
      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <DataTable<TieRow>
          table={table}
          pageScroll
          cardSort={false}
          cardsApart
          cardLead
        />
      </Card>
    </>
  )
}

/// Trial-balance lines that were handed over and have nowhere to land.
function NotPosted({ rows }: { rows: readonly OpeningUnmapped[] }) {
  const columns = useMemo<ColumnDef<TableSetup, OpeningUnmapped>[]>(
    () => [
      {
        id: "account",
        accessorFn: (row) => row.account_code,
        header: "Account",
        size: 220,
        enableSorting: false,
        meta: { card: "title" },
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="text-ink tabular-nums">
              {row.original.account_code}
            </span>
            <span className="text-mute">
              <UnitName id={row.original.unit_id} />
            </span>
          </span>
        ),
      },
      {
        id: "amount",
        accessorFn: (row) => row.amount_minor,
        header: "Amount",
        size: 190,
        enableSorting: false,
        meta: { align: "right", card: "lead" },
        cell: ({ row }) => (
          <span className="tabular-nums">
            {moneyFigure(row.original.amount_minor)}
          </span>
        ),
      },
      {
        id: "why",
        accessorFn: (row) => row.why,
        header: "Why",
        size: 420,
        enableSorting: false,
        meta: { card: "meta", grow: 280 },
        cell: ({ row }) => (
          <span className="whitespace-normal text-body">
            {row.original.why}
          </span>
        ),
      },
    ],
    []
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as OpeningUnmapped[],
        columns,
        getRowId: (row: OpeningUnmapped) =>
          `${row.unit_id}|${row.account_code}`,
      }),
      [rows, columns]
    )
  )
  return (
    <>
      <SectionHead>Not posted</SectionHead>
      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <DataTable<OpeningUnmapped>
          table={table}
          pageScroll
          cardSort={false}
          cardsApart
          cardLead
        />
      </Card>
    </>
  )
}

/// The stock somebody priced by something other than what was paid for it:
/// the list to read before agreeing to the cutover.
function Fallbacks({
  rows,
  value,
}: {
  rows: readonly OpeningFallback[]
  value: number
}) {
  const columns = useMemo<ColumnDef<TableSetup, OpeningFallback>[]>(
    () => [
      {
        id: "article",
        accessorFn: (row) => row.article_code,
        header: "Article",
        size: 260,
        enableSorting: false,
        meta: { card: "title", grow: 200 },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="text-ink">{row.original.article_code}</span>
            <span className="text-mute">
              <SiteName id={row.original.site_id} />
            </span>
          </span>
        ),
      },
      {
        id: "basis",
        accessorFn: (row) => row.basis,
        header: "Priced by",
        size: 240,
        enableSorting: false,
        meta: { card: "meta", priority: 2 },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col whitespace-normal">
            <span className="text-body">{label(row.original.basis)}</span>
            {row.original.note !== "" && (
              <span className="text-mute">{row.original.note}</span>
            )}
          </span>
        ),
      },
      {
        id: "quantity",
        accessorFn: (row) => row.quantity,
        header: "Quantity",
        size: 130,
        enableSorting: false,
        meta: { align: "right", card: "meta", priority: 2 },
        cell: ({ row }) => (
          <span className="tabular-nums">{count(row.original.quantity)}</span>
        ),
      },
      {
        id: "cost",
        accessorFn: (row) => row.unit_cost_minor,
        header: "Cost",
        size: 160,
        enableSorting: false,
        meta: { align: "right", card: "meta", priority: 3 },
        cell: ({ row }) => (
          <span className="tabular-nums">
            {moneyFigure(row.original.unit_cost_minor)}
          </span>
        ),
      },
      {
        id: "value",
        accessorFn: (row) => row.value_minor,
        header: "Value",
        size: 180,
        enableSorting: false,
        meta: { align: "right", card: "lead" },
        cell: ({ row }) => (
          <span className="tabular-nums">
            {moneyFigure(row.original.value_minor)}
          </span>
        ),
      },
    ],
    []
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as OpeningFallback[],
        columns,
        getRowId: (row: OpeningFallback) =>
          `${row.site_id}|${row.article_code}|${row.basis}`,
      }),
      [rows, columns]
    )
  )
  return (
    <>
      <SectionHead>Stock priced without a purchase price</SectionHead>
      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <DataTable<OpeningFallback>
          table={table}
          pageScroll
          cardSort={false}
          cardsApart
          cardLead
          summary={{ article: "Total", value: moneyFigure(value) }}
        />
      </Card>
    </>
  )
}
