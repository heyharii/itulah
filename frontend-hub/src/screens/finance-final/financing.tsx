import { useSuspenseQueries } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { CellMoney } from "@/components/ui/rows-switch"
import { EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { facilitiesQuery, principalsQuery } from "@/lib/queries/finance-domains"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Code } from "@/screens/finance-final/parts"
import { useColumnFit } from "@/screens/finance/column-fit"
import { ScreenPending } from "@/screens/finance/pending"
import type { FinancingFacility, Principal } from "@itulah/contract"

/// One loan per row. On a phone the same columns are the card: the lender over
/// its number and kind, the figures under them, the status at the right.
const loanColumns: ColumnDef<TableSetup, FinancingFacility>[] = [
  {
    accessorKey: "facility_number",
    header: "Number",
    size: 130,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.facility_number}</Code>,
  },
  {
    accessorKey: "kind",
    header: "Type",
    size: 120,
    meta: { card: "meta", priority: 3 },
    cell: ({ row }) => row.original.kind,
  },
  {
    accessorKey: "lender_label",
    header: "Lender",
    size: 280,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <span className="whitespace-normal">{row.original.lender_label}</span>
    ),
  },
  {
    accessorKey: "principal_minor",
    header: "Principal",
    size: 150,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => <CellMoney minor={row.original.principal_minor} />,
  },
  {
    accessorKey: "outstanding_principal_minor",
    header: "Principal left",
    size: 160,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <CellMoney minor={row.original.outstanding_principal_minor} />
    ),
  },
  {
    accessorKey: "paid_interest_minor",
    header: "Interest paid",
    size: 150,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => <CellMoney minor={row.original.paid_interest_minor} />,
  },
  {
    accessorKey: "maturity_date",
    header: "Matures",
    size: 130,
    meta: { card: "metric" },
    cell: ({ row }) => row.original.maturity_date,
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 110,
    meta: { card: "status" },
    cell: ({ row }) => (
      <Pill tone={row.original.status === "ACTIVE" ? "info" : "ok"}>
        {row.original.status}
      </Pill>
    ),
  },
]

/// One owner per row.
const ownerColumns: ColumnDef<TableSetup, Principal>[] = [
  {
    accessorKey: "code",
    header: "Code",
    size: 130,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.code}</Code>,
  },
  {
    accessorKey: "name",
    header: "Name",
    size: 300,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <span className="whitespace-normal">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "contributed_minor",
    header: "Paid in",
    size: 170,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => <CellMoney minor={row.original.contributed_minor} />,
  },
  {
    accessorKey: "drawn_minor",
    header: "Drawings",
    size: 160,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => <CellMoney minor={row.original.drawn_minor} />,
  },
  {
    accessorKey: "equity_minor",
    header: "Net equity",
    size: 170,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => <CellMoney minor={row.original.equity_minor} />,
  },
  {
    accessorKey: "loan_outstanding_minor",
    header: "Lent to the company",
    size: 200,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <CellMoney minor={row.original.loan_outstanding_minor} />
    ),
  },
]

type View = "loans" | "owners"

/// Financing and owners — money borrowed on terms, and money the owners moved.
///
/// The two are on one screen because they answer one question: who has put
/// money into this company and on what terms. A bank lends it, an owner lends
/// it, or an owner owns it — and the third is not a debt however it is spent.
export function Financing() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Payables" title="Loans">
          Reading the loans and the owners…
        </ScreenPending>
      }
    >
      <FinancingScreen />
    </Suspense>
  )
}

function FinancingScreen() {
  const phone = useLayout() === "phone"
  const [facilities, owners] = useSuspenseQueries({
    queries: [facilitiesQuery(), principalsQuery()],
  })
  const [view, setView] = useState<View>("loans")
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])

  const rows = facilities.data
  const holders = owners.data
  const outstanding = rows.reduce(
    (total, row) => total + row.outstanding_principal_minor,
    0
  )
  const current = rows.reduce(
    (total, row) => total + row.current_portion_minor,
    0
  )
  const equity = holders.reduce((total, row) => total + row.equity_minor, 0)

  const loans = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return text === ""
      ? rows
      : rows.filter(
          (row) =>
            row.lender_label.toLowerCase().includes(text) ||
            row.facility_number.toLowerCase().includes(text) ||
            row.kind.toLowerCase().includes(text)
        )
  }, [rows, needle])
  const people = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return text === ""
      ? holders
      : holders.filter(
          (row) =>
            row.name.toLowerCase().includes(text) ||
            row.code.toLowerCase().includes(text)
        )
  }, [holders, needle])

  const [loanMeasure, loanFit] = useColumnFit(loanColumns, phone)
  const [ownerMeasure, ownerFit] = useColumnFit(ownerColumns, phone)
  const loanTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: loans,
        columns: loanColumns,
        getRowId: (row: FinancingFacility) => row.facility_id,
        state: {
          sorting,
          columnVisibility: loanFit.visibility,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: loanFit.onChange,
      }),
      // The fits are new each render: the room is measured, and the columns
      // the card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [loans, sorting, phone, loanFit]
    )
  )
  const ownerTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: people,
        columns: ownerColumns,
        getRowId: (row: Principal) => row.principal_id,
        state: {
          sorting,
          columnVisibility: ownerFit.visibility,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: ownerFit.onChange,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [people, sorting, phone, ownerFit]
    )
  )
  const table = view === "loans" ? loanTable : ownerTable
  const measure = view === "loans" ? loanMeasure : ownerMeasure

  const change = (next: View) => {
    setView(next)
    setSorting([])
  }
  const tabs = [
    { value: "loans", label: "Loans", n: rows.length },
    { value: "owners", label: "Owners & Investors", n: holders.length },
  ] as const

  return (
    <PageContent>
      <PageHeader crumb="Finance · Payables" title="Loans" />

      <KpiStrip className="md:grid-cols-3 xl:grid-cols-3">
        <Kpi label="Principal still owed" value={money(outstanding)} />
        <Kpi
          label="Due within a year"
          value={money(current)}
          delta="The current part, counted from today"
          tone="flat"
        />
        <Kpi label="Owners' equity" value={money(equity)} />
      </KpiStrip>

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <SubTabs
          // The two views are the status button in the dock on a phone.
          className="max-md:hidden"
          tabs={tabs.map((one) => ({
            value: one.value,
            label: (
              <span>
                {one.label}
                <span className="ml-1.5 text-body tabular-nums">
                  {count(one.n)}
                </span>
              </span>
            ),
          }))}
          value={view}
          onChange={(next) => change(next as View)}
        />
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label={view === "loans" ? "Search loans" : "Search owners"}
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>
      <DockTools
        search={{
          value: needle,
          onChange: setNeedle,
          label: view === "loans" ? "Search loans" : "Search owners",
        }}
        sort={dockSortOf(table)}
        status={{
          value: view,
          options: tabs.map((one) => ({
            value: one.value,
            label: one.label,
            count: one.n,
          })),
          onChange: (next) => change(next as View),
        }}
      />

      {view === "loans" ? (
        rows.length === 0 ? (
          <EmptyState>No loan yet.</EmptyState>
        ) : (
          <div ref={measure}>
            <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              <DataTable<FinancingFacility>
                table={table}
                refresh={[facilities]}
                empty="No loan matches the search."
                pageScroll
                cardsApart
                cardSort={false}
                summary={{
                  lender_label: (
                    <span>
                      {count(loans.length)}{" "}
                      <span className="font-normal text-body">
                        {loans.length === 1 ? "loan" : "loans"}
                      </span>
                    </span>
                  ),
                }}
              />
            </Card>
          </div>
        )
      ) : holders.length === 0 ? (
        <EmptyState>No owner recorded yet.</EmptyState>
      ) : (
        <div ref={measure}>
          <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            <DataTable<Principal>
              table={table}
              refresh={[owners]}
              empty="No owner matches the search."
              pageScroll
              cardsApart
              cardSort={false}
              summary={{
                name: (
                  <span>
                    {count(people.length)}{" "}
                    <span className="font-normal text-body">
                      {people.length === 1 ? "owner" : "owners"}
                    </span>
                  </span>
                ),
              }}
            />
          </Card>
        </div>
      )}
    </PageContent>
  )
}
