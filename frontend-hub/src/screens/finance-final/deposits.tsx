import { useQueries, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, type PillProps } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, day, money, span } from "@/lib/format"
import {
  bankStatementLines,
  financeKeys,
  listBankStatements,
  listCashCounts,
  listDeposits,
  moneyOverview,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Code } from "@/screens/finance-final/parts"
import { UnitName, UnitSelect, WindowControl } from "@/screens/finance/parts"
import { useSettledWindow } from "@/screens/finance/hooks"
import { ScreenPending } from "@/screens/finance/pending"
import type {
  BankStatementLineRow,
  BankStatementRow,
  StoreDeposit,
} from "@itulah/contract"

/// Takings on their way from a drawer to a bank account.
///
/// # A deposit is now a document, and the middle of the journey is a balance
///
/// A deposit is three facts — notes left a drawer, a person carried them, a
/// bank credited an account — and this system used to keep the first and the
/// third and nothing in between. So this screen was built as the **two-sided
/// gap** it really was: our unconfirmed postings on one side, the bank's
/// unclaimed credits on the other, and a note at the foot saying a deposit slip
/// was not a document the system kept.
///
/// Migration 0241 made it one. `store_deposit` carries the unit, the drawer,
/// the destination bank account, the amount, the day it left, who carried it
/// and the slip reference — and it posts **twice**:
///
/// ```text
///   banking  (on banked_on)  Dr cash_in_transit   Cr the drawer
///   landing  (on landed_on)  Dr the bank          Cr cash_in_transit
/// ```
///
/// Two entries and not one, because the two facts happen on different days. A
/// single entry would have to pick one of the dates and be wrong about the
/// other, which is exactly the defect the document exists to remove: the
/// distance between the two dates IS the exposure.
///
/// Debiting the bank on the day the bag leaves would say the bank holds money
/// it has never heard of, and every reconciliation afterwards would have to
/// explain a credit that has not happened yet. Debiting
/// `1011005001 Setoran Dalam Perjalanan` instead says what is true: the notes
/// are out of the till and not yet at the bank, and the balance on that account
/// is one number, per unit, that somebody is answerable for.
///
/// # Why "in the air" is the server's figure and not this page's
///
/// `in_transit_minor` comes off the list envelope, computed over everything the
/// unit filter matches rather than over the rows drawn — so filtering the table
/// to what has landed leaves it unchanged, because it is a fact about the unit
/// and not about which boxes are ticked. It agrees with the `cash_in_transit`
/// balance, because both move only when this document posts.
///
/// The page no longer fans out one ledger request per bank account to guess at
/// the same number. That was sixty-nine requests across fourteen units and it
/// could only ever find *postings no statement line agreed with*, which is not
/// the same finding as "the cash is in a bag somewhere".
///
/// # Debit and credit, on a statement, are the bank's way round
///
/// A debit on a bank statement is money LEAVING — the bank debits your account
/// when it pays somebody. So an arriving deposit is a `credit_minor`, and the
/// backend agrees: `banking.rs` derives `outgoing: line.debit_minor > 0`. The
/// column is headed `Deposit` after ERPNext's Bank Transaction, which names the
/// two sides rather than making a reader hold the convention in their head.
///
/// The bank's side is kept, and its job has changed. It is no longer half of a
/// subtraction; it is the evidence the second posting is matched against,
/// through the bank reconciliation that already exists and with no special case
/// for deposits anywhere in it.
export function Deposits() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Cash & Bank" title="Deposits">
          Reading the calendar…
        </ScreenPending>
      }
    >
      <DepositsScreen />
    </Suspense>
  )
}

function DepositsScreen() {
  const [tab, setTab] = useState<"deposits" | "landed">("deposits")
  const [unit, setUnit] = useState("")
  const range = useSettledWindow()
  const scoped = unit === "" ? null : unit

  /// The document. Unpaged and narrowed on the server, like every list in this
  /// module.
  const deposits = useQuery({
    queryKey: financeKeys.deposits(null, scoped),
    queryFn: ({ signal }) =>
      listDeposits(scoped === null ? {} : { unit }, signal),
  })

  const overview = useQuery({
    queryKey: financeKeys.money(null, scoped),
    queryFn: ({ signal }) =>
      moneyOverview(scoped === null ? {} : { unit }, signal),
  })

  /// The statements, narrowed to the unit on the server.
  ///
  /// `financeKeys.bankStatements` carries the unit, so asking for one unit's
  /// statements no longer overwrites the whole-company list that Finance's
  /// Cash & bank screen and the reconciliation tool read from the same cache —
  /// and a unit's statements are the unit's first page, never a slice of the
  /// company's.
  const statements = useQuery({
    queryKey: financeKeys.bankStatements(scoped),
    queryFn: ({ signal }) =>
      listBankStatements(signal, scoped === null ? {} : { unit }),
  })

  /// Every count, under the key the Cash Counts screen reads its whole list
  /// by. A count was taken at a site and keeps it, so it cannot be narrowed to
  /// a unit on the server: each is matched to its drawer through the unit
  /// that owns its site, and one outside the chosen unit meets no drawer.
  const counts = useQuery({
    queryKey: financeKeys.cashCounts(null, null),
    queryFn: ({ signal }) => listCashCounts(signal),
  })
  const register = useUnits()
  const owner = useMemo(() => {
    const table = new Map<string, string>()
    for (const one of register.data ?? []) {
      for (const site of one.sites) table.set(site.id, one.id)
    }
    return table
  }, [register.data])

  /// The statements that overlap the window, narrowed before their lines are
  /// asked for — which is what keeps this from being one request per statement
  /// ever imported.
  const inScope = useMemo(
    () =>
      (statements.data?.rows ?? []).filter(
        (statement) =>
          statement.period_start <= range.to &&
          statement.period_end >= range.from
      ),
    [statements.data, range.from, range.to]
  )

  const lines = useQueries({
    queries: inScope.map((statement) => ({
      queryKey: financeKeys.bankLines(statement.statement_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        bankStatementLines(statement.statement_id, signal),
    })),
    // `combine` rather than a memo over the results: `useQueries` hands back a
    // new array every render, so a memo keyed on it never holds.
    combine: (answers) => ({
      isPending: answers.some((one) => one.isPending),
      isError: answers.some((one) => one.isError),
      error: answers.find((one) => one.isError)?.error,
      rows: answers.flatMap((one, at) =>
        (one.data ?? []).map((line) => ({ line, statement: inScope[at] }))
      ),
    }),
  })

  /// Loading and error across every read the page stands on.
  ///
  /// One state for the lot because the answers are one claim: a page that drew
  /// the bank's side while the document list was still failing would say
  /// "nothing is in transit" about a unit it had not read the deposits for.
  const view = {
    isPending:
      deposits.isPending ||
      overview.isPending ||
      statements.isPending ||
      counts.isPending ||
      register.isPending ||
      lines.isPending,
    isError:
      deposits.isError ||
      overview.isError ||
      statements.isError ||
      counts.isError ||
      register.isError ||
      lines.isError,
    error:
      deposits.error ??
      overview.error ??
      statements.error ??
      counts.error ??
      register.error ??
      lines.error,
    data: deposits.data,
    refetch: () => {
      void deposits.refetch()
      void overview.refetch()
      void statements.refetch()
      void counts.refetch()
      void register.refetch()
    },
  }

  // Money that has not started the journey yet: notes still in the tills.
  const drawers = (overview.data?.rows ?? []).filter(
    (row) => row.pot === "CASH"
  )
  const inDrawers = drawers.reduce((sum, row) => sum + row.per_books_minor, 0)
  const neverCounted = drawers.filter(
    (row) =>
      !(counts.data ?? []).some(
        (count) =>
          count.account_code === row.account_code &&
          owner.get(count.site_id) === row.unit_id
      )
  ).length

  const arrivals = lines.rows
    .filter(
      ({ line }) =>
        line.credit_minor > 0 &&
        line.value_date >= range.from &&
        line.value_date <= range.to
    )
    .sort((a, b) => a.line.value_date.localeCompare(b.line.value_date))
  const landed = arrivals.reduce((sum, { line }) => sum + line.credit_minor, 0)
  const unclaimed = arrivals.reduce(
    (sum, { line }) => sum + line.unallocated_minor,
    0
  )

  // The window narrows the table, never the exposure: money banked in August
  // and still in the air is this unit's problem in September.
  const page = deposits.data
  const inWindow = useMemo(
    () =>
      (page?.rows ?? []).filter(
        (row) => row.banked_on >= range.from && row.banked_on <= range.to
      ),
    [page, range.from, range.to]
  )
  const flying = (page?.rows ?? []).filter((row) => row.status === "IN_TRANSIT")
  const oldest = flying.reduce(
    (worst, row) => Math.max(worst, row.days_in_transit),
    0
  )

  const depositTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: inWindow,
        columns: DEPOSIT_COLUMNS,
        getRowId: (row: StoreDeposit) => row.deposit_id,
      }),
      [inWindow]
    )
  )
  const arrivalTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: arrivals,
        columns: ARRIVAL_COLUMNS,
        getRowId: (row: Arrival) => row.line.line_id,
      }),
      [arrivals]
    )
  )

  const ready = view.data !== undefined && !view.isPending

  return (
    <PageContent>
      <PageHeader crumb="Finance · Cash & Bank" title="Deposits" />

      {/* The three figures are the server's and the books': what is still in
          the drawers, what is in a bag, and what the bank credited that
          nothing claims. */}
      <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
        <Kpi
          label="Still in the drawers"
          value={overview.data === undefined ? "—" : money(inDrawers)}
          delta={
            overview.data === undefined || counts.data === undefined
              ? undefined
              : drawers.length === 0
                ? "no cash account is mapped in scope"
                : neverCounted === 0
                  ? `${drawers.length} ${drawers.length === 1 ? "drawer" : "drawers"}, every one counted at least once`
                  : `${neverCounted} of ${drawers.length} ${drawers.length === 1 ? "drawer has" : "drawers have"} never been counted`
          }
          tone={neverCounted === 0 ? "flat" : "down"}
        />
        <Kpi
          label="In a bag, somewhere"
          value={
            page === undefined ? (
              "—"
            ) : (
              <span
                className={
                  page.in_transit_minor === 0 ? undefined : "text-warn-fg"
                }
              >
                {money(page.in_transit_minor)}
              </span>
            )
          }
          delta={
            page === undefined
              ? undefined
              : flying.length === 0
                ? "every deposit has been confirmed by a bank"
                : `${flying.length} ${flying.length === 1 ? "deposit" : "deposits"}, the oldest ${oldest} ${oldest === 1 ? "day" : "days"} out`
          }
          tone="flat"
        />
        <Kpi
          label="Bank credits nothing claims"
          value={
            inScope.length === 0 ? (
              "—"
            ) : (
              <span className={unclaimed === 0 ? undefined : "text-bad-fg"}>
                {money(unclaimed)}
              </span>
            )
          }
          delta={
            inScope.length === 0
              ? "no statement covers this window"
              : `of ${money(landed)} credited across ${inScope.length} ${inScope.length === 1 ? "statement" : "statements"}`
          }
          tone="flat"
        />
      </KpiStrip>

      {/* Two datasets, one body: the document, and what the bank says arrived. */}

      <Toolbar
        lead={
          <SubTabs
            tabs={[
              {
                value: "deposits",
                label: (
                  <span>
                    Deposits
                    {ready && (
                      <span className="ml-1.5 text-body tabular-nums">
                        {count(inWindow.length)}
                      </span>
                    )}
                  </span>
                ),
                short: "Deposits",
              },
              {
                value: "landed",
                label: (
                  <span>
                    Landed at the bank
                    {ready && (
                      <span className="ml-1.5 text-body tabular-nums">
                        {count(arrivals.length)}
                      </span>
                    )}
                  </span>
                ),
                short: "Landed",
              },
            ]}
            value={tab}
            onChange={(next) => setTab(next as typeof tab)}
          />
        }
      >
        <UnitSelect value={unit} onChange={setUnit} className="w-52" />
        <WindowControl range={range} />
      </Toolbar>

      {queryState(view, {
        loading:
          "Reading the drawers, the slips and what the bank says arrived…",
        render: (page) => (
          <div className="flex flex-col gap-3">
            {tab === "deposits" ? (
              inWindow.length === 0 ? (
                <EmptyState>
                  {page.total === 0 ? (
                    <>
                      Nothing has been banked{" "}
                      {scoped === null ? (
                        "anywhere"
                      ) : (
                        <>
                          by <UnitName id={unit} />
                        </>
                      )}{" "}
                      yet. The document exists —{" "}
                      <Code>POST /api/v1/finance/deposits</Code> — and no slip
                      has been written against it.
                    </>
                  ) : (
                    <>
                      No deposit left a drawer in this window. Widen it, or
                      clear the unit filter.
                    </>
                  )}
                </EmptyState>
              ) : (
                <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                  <DataTable<StoreDeposit>
                    table={depositTable}
                    summary={{
                      number: `${inWindow.length} ${inWindow.length === 1 ? "deposit" : "deposits"}`,
                      left: "In this window",
                      amount: money(
                        inWindow.reduce((sum, row) => sum + row.amount_minor, 0)
                      ),
                    }}
                    pageScroll
                    cardSort={false}
                    cardsApart
                    cardLead
                  />
                </Card>
              )
            ) : arrivals.length === 0 ? (
              <EmptyState>
                {inScope.length === 0
                  ? "No bank statement covering this window has been imported for the unit in scope."
                  : "The statements covering this window carry no incoming line — the bank credited nothing in it."}
              </EmptyState>
            ) : (
              <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                <DataTable<Arrival>
                  table={arrivalTable}
                  summary={{
                    description: `${arrivals.length} ${arrivals.length === 1 ? "credit" : "credits"}`,
                    deposit: money(landed),
                    allocated: money(landed - unclaimed),
                    unallocated: money(unclaimed),
                  }}
                  pageScroll
                  cardSort={false}
                  cardsApart
                />
              </Card>
            )}

            {/* The window is a lens on the table and never on the exposure, and
                a reader has to be told which is which. */}
            {tab === "deposits" && inWindow.length < page.total && (
              <p className="text-[0.9375rem] text-mute">
                {page.total - inWindow.length} more{" "}
                {page.total - inWindow.length === 1 ? "deposit" : "deposits"}{" "}
                outside this window. The figure above counts every one that is
                still in the air, whenever it was banked.
              </p>
            )}
            {tab === "landed" && inScope.length > 0 && (
              <p className="text-[0.9375rem] text-mute">
                {inScope.length === 1 ? "Statement" : "Statements"}:{" "}
                {inScope
                  .map(
                    (statement) =>
                      `${statement.account_name} ${span(statement.period_start, statement.period_end)}`
                  )
                  .join(" · ")}
              </p>
            )}
          </div>
        ),
      })}
    </PageContent>
  )
}

/// Where one deposit has got to, and which entry says so.
const STAGES: Readonly<
  Record<string, { readonly name: string; readonly tone: PillProps["tone"] }>
> = {
  DRAFT: { name: "slip written", tone: "neutral" },
  IN_TRANSIT: { name: "in a bag", tone: "warn" },
  LANDED: { name: "at the bank", tone: "ok" },
}

/// A credit on a statement, with the statement it came from.
interface Arrival {
  readonly line: BankStatementLineRow
  readonly statement: BankStatementRow
}

/// The document: a counted bag, a named person, and the two days it belongs
/// to. On a card the unit names it, the number sits over it, the route follows
/// and the amount stands at the right with where it is in the foot.
const DEPOSIT_COLUMNS: ColumnDef<TableSetup, StoreDeposit>[] = [
  {
    id: "number",
    accessorFn: (row) => row.deposit_number,
    header: "Number",
    size: 190,
    enableSorting: false,
    meta: { card: "id" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-ink">
          {row.original.deposit_number}
        </span>
        {row.original.slip_reference !== "" && (
          <span
            className="truncate font-mono text-[0.9375rem] text-mute"
            title={row.original.slip_reference}
          >
            {row.original.slip_reference}
          </span>
        )}
      </span>
    ),
  },
  {
    id: "left",
    accessorFn: (row) => row.banked_on,
    header: "Left the till",
    size: 140,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => day(row.original.banked_on),
  },
  {
    id: "unit",
    accessorFn: (row) => row.unit_id,
    header: "Unit",
    size: 130,
    enableSorting: false,
    meta: { card: "title", priority: 3 },
    cell: ({ row }) => <UnitName id={row.original.unit_id} />,
  },
  {
    id: "out_of",
    accessorFn: (row) => row.drawer_account_name,
    header: "Out of",
    size: 190,
    enableSorting: false,
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-ink">
          {row.original.drawer_account_name}
        </span>
        <Code>{row.original.drawer_account_code}</Code>
      </span>
    ),
  },
  {
    id: "into",
    accessorFn: (row) => row.bank_account_name,
    header: "Into",
    size: 190,
    enableSorting: false,
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-ink">
          {row.original.bank_account_name}
        </span>
        <Code>{row.original.bank_account_code}</Code>
      </span>
    ),
  },
  {
    id: "carried_by",
    accessorFn: (row) => row.carried_by,
    header: "Carried by",
    size: 140,
    enableSorting: false,
    meta: { card: "foot", priority: 3 },
    cell: ({ row }) => (
      <span className="block truncate text-body">
        {row.original.carried_by}
      </span>
    ),
  },
  {
    id: "amount",
    accessorFn: (row) => row.amount_minor,
    header: "Amount",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "lead" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {money(row.original.amount_minor)}
      </span>
    ),
  },
  {
    id: "where",
    accessorFn: (row) => row.status,
    header: "Where it is",
    size: 190,
    enableSorting: false,
    meta: { card: "status" },
    cell: ({ row }) => {
      const stage = STAGES[row.original.status]
      return (
        <span className="flex flex-col items-start">
          <Pill tone={stage?.tone ?? "neutral"}>
            {stage?.name ?? row.original.status}
          </Pill>
          {/* The two legs, each named by the entry that made it. A deposit
              that could not point at its own journal would be a status
              somebody set. */}
          {row.original.status === "IN_TRANSIT" && (
            <span className="mt-0.5 text-[0.9375rem] text-mute">
              {row.original.days_in_transit === 0
                ? "banked today"
                : `${row.original.days_in_transit} ${row.original.days_in_transit === 1 ? "day" : "days"} out`}
            </span>
          )}
          {row.original.landed_entry_id !== null &&
            row.original.landed_entry_number !== null && (
              <span className="mt-0.5 text-[0.9375rem] text-mute">
                {day(row.original.landed_on)} ·{" "}
                <AppLink
                  to="/finance/accounting/journal-entries"
                  sheet={{ key: "entry", value: row.original.landed_entry_id }}
                  className="font-mono text-accent hover:underline"
                >
                  {row.original.landed_entry_number}
                </AppLink>
              </span>
            )}
        </span>
      )
    },
  },
]

/// The bank's own account of what arrived: every credit the statements
/// carry, and how much of each our books account for.
const ARRIVAL_COLUMNS: ColumnDef<TableSetup, Arrival>[] = [
  {
    id: "value_date",
    accessorFn: (row) => row.line.value_date,
    header: "Value date",
    size: 130,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => day(row.original.line.value_date),
  },
  {
    id: "account",
    accessorFn: (row) => row.statement.account_name,
    header: "Bank account",
    size: 200,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-ink">
          {row.original.statement.account_name}
        </span>
        <Code>{row.original.statement.account_code}</Code>
      </span>
    ),
  },
  {
    id: "unit",
    accessorFn: (row) => row.statement.unit_id,
    header: "Unit",
    size: 130,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => <UnitName id={row.original.statement.unit_id} />,
  },
  {
    id: "description",
    accessorFn: (row) => row.line.description,
    header: "Description",
    size: 240,
    enableSorting: false,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col whitespace-normal text-body">
        <span>{row.original.line.description}</span>
        {row.original.line.party_name !== "" && (
          <span className="text-[0.9375rem] text-mute">
            {row.original.line.party_name}
          </span>
        )}
      </span>
    ),
  },
  {
    id: "reference",
    accessorFn: (row) => row.line.reference,
    header: "Reference",
    size: 130,
    enableSorting: false,
    meta: { card: "id", priority: 3 },
    cell: ({ row }) => <Code>{row.original.line.reference ?? "—"}</Code>,
  },
  {
    id: "deposit",
    accessorFn: (row) => row.line.credit_minor,
    header: "Deposit",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {money(row.original.line.credit_minor)}
      </span>
    ),
  },
  {
    id: "allocated",
    accessorFn: (row) => row.line.allocated_minor,
    header: "Allocated",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "metric", priority: 2 },
    cell: ({ row }) =>
      row.original.line.allocated_minor === 0 ? (
        <span className="text-hairline-strong">·</span>
      ) : (
        money(row.original.line.allocated_minor)
      ),
  },
  {
    id: "unallocated",
    accessorFn: (row) => row.line.unallocated_minor,
    header: "Unallocated",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) =>
      row.original.line.unallocated_minor === 0 ? (
        <span className="text-hairline-strong">·</span>
      ) : (
        <span className="text-bad-fg">
          {money(row.original.line.unallocated_minor)}
        </span>
      ),
  },
  {
    id: "status",
    accessorFn: (row) => row.line.unallocated_minor,
    header: "Status",
    size: 140,
    enableSorting: false,
    meta: { card: "status" },
    cell: ({ row }) =>
      row.original.line.unallocated_minor === 0 ? (
        <Pill tone="ok">agreed</Pill>
      ) : row.original.line.allocated_minor === 0 ? (
        <Pill tone="bad">unexplained</Pill>
      ) : (
        <Pill tone="warn">part agreed</Pill>
      ),
  },
]
