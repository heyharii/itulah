import { useQuery, useSuspenseQueries } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Select } from "@/components/ui/field"
import { FilterSheet } from "@/components/ui/filter-sheet"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ColumnsMenu } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, dateText, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  domainKeys,
  listTaxTypes,
  taxPeriodsQuery,
  taxReconciliationQuery,
} from "@/lib/queries/finance-domains"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useColumnFit } from "@/screens/finance/column-fit"
import { ScreenPending } from "@/screens/finance/pending"
import type { TaxPeriod } from "@itulah/contract"

/// Tax Payables — every tax period, what it owes or holds as credit, what has
/// been paid, and what is left.
///
/// PPh 25 is a CREDIT and PPh 29 is a PAYABLE: the same tax, opposite
/// balances, and the subledger refuses to record one against the other. So
/// the two totals above the list stay apart — a single "tax" figure would be
/// the netting the accounting refuses.
///
/// Redrawn 2026-10-01 in English (owner): one list of periods, narrowed by
/// tax and by status; the tax types themselves live on Tax › Tax Types.
type Show = "OPEN" | "FILED" | "SETTLED" | "ALL"

/// What the tax is called on the cell: the month and its year.
function periodOf(row: TaxPeriod): string {
  return dateText(new Date(row.period_year, row.period_month - 1, 1), {
    month: "short",
    year: "numeric",
  })
}

function statusWord(row: TaxPeriod): string {
  return row.status === "SETTLED"
    ? "Settled"
    : row.status === "FILED"
      ? "Filed"
      : "Open"
}

/// What the period owes (a payable) or holds (a credit).
function amountOf(row: TaxPeriod): number {
  return row.nature === "PAYABLE" ? row.obligation_minor : row.credit_minor
}

/// One tax period per row. On a phone the same columns are the card: the tax
/// over its month and nature, the three figures under them, and the status at
/// the right.
const columns: ColumnDef<TableSetup, TaxPeriod>[] = [
  {
    id: "period",
    accessorFn: (row) => row.period_year * 12 + row.period_month,
    header: "Period",
    size: 130,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="text-body">{periodOf(row.original)}</span>
    ),
  },
  {
    accessorKey: "tax_type_name",
    header: "Tax",
    size: 300,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <span className="text-ink">{row.original.tax_type_name}</span>
    ),
  },
  {
    accessorKey: "nature",
    header: "Nature",
    size: 110,
    meta: { card: "meta", priority: 3 },
    cell: ({ row }) => (
      <span className="text-mute">
        {row.original.nature === "CREDIT" ? "Credit" : "Payable"}
      </span>
    ),
  },
  {
    id: "owed",
    accessorFn: (row) => amountOf(row),
    header: "Owed or credit",
    size: 170,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => money(amountOf(row.original)),
  },
  {
    accessorKey: "settled_minor",
    header: "Paid",
    size: 150,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => money(row.original.settled_minor),
  },
  {
    accessorKey: "outstanding_minor",
    header: "Left",
    size: 150,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span
        className={
          row.original.outstanding_minor > 0
            ? "font-medium text-ink"
            : "text-mute"
        }
      >
        {row.original.outstanding_minor === 0
          ? "·"
          : money(row.original.outstanding_minor)}
      </span>
    ),
  },
  {
    id: "status",
    accessorFn: (row) => statusWord(row),
    header: "Status",
    size: 110,
    meta: { card: "status" },
    cell: ({ row }) => (
      <span
        className={
          row.original.status === "SETTLED"
            ? "text-ok-fg"
            : row.original.status === "FILED"
              ? "text-body"
              : "text-warn-fg"
        }
      >
        {statusWord(row.original)}
      </span>
    ),
  },
]

export function Tax() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Tax" title="Tax Payables">
          Reading the tax periods…
        </ScreenPending>
      }
    >
      <TaxScreen />
    </Suspense>
  )
}

function TaxScreen() {
  const phone = useLayout() === "phone"
  const types = useQuery({
    queryKey: domainKeys.taxTypes(),
    queryFn: ({ signal }) => listTaxTypes(signal),
  })
  const [periods, control] = useSuspenseQueries({
    queries: [taxPeriodsQuery(), taxReconciliationQuery()],
  })
  const [show, setShow] = useState<Show>("OPEN")
  const [taxType, setTaxType] = useState("")
  const [filtering, setFiltering] = useState(false)

  const all = periods.data
  const payable = all
    .filter((row) => row.nature === "PAYABLE")
    .reduce((total, row) => total + row.outstanding_minor, 0)
  const credit = all
    .filter((row) => row.nature === "CREDIT")
    .reduce((total, row) => total + row.outstanding_minor, 0)
  const mismatched = control.data.filter(
    (row) => row.difference_minor !== 0
  ).length

  const inStatus = (row: (typeof all)[number], which: Show) =>
    which === "ALL" ||
    (which === "OPEN"
      ? row.status !== "FILED" && row.status !== "SETTLED"
      : row.status === which)
  const rows = useMemo(
    () =>
      all.filter(
        (row) =>
          inStatus(row, show) &&
          (taxType === "" || row.tax_type_code === taxType)
      ),
    // `inStatus` only reads its arguments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, show, taxType]
  )

  const [sorting, setSorting] = useState<SortingState>([])
  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: TaxPeriod) => String(row.period_id),
        state: {
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, sorting, phone, fit]
    )
  )

  return (
    <PageContent>
      <PageHeader crumb="Finance · Tax" title="Tax Payables" />

      <KpiStrip className="md:grid-cols-3 xl:grid-cols-3">
        <Kpi
          label="Tax owed, not yet paid"
          value={money(payable)}
          delta="PPh 21, 23, 29, output PPN, PBB"
        />
        <Kpi
          label="Tax credit not yet used"
          value={money(credit)}
          delta="PPh 25 instalments, input PPN"
        />
        <Kpi
          label="Periods off the ledger"
          value={
            <span className={mismatched === 0 ? "text-ok-fg" : "text-bad-fg"}>
              {count(mismatched)}
            </span>
          }
          tone={mismatched === 0 ? "up" : "down"}
          delta={
            mismatched === 0
              ? "Every period agrees with the books"
              : "Their balance differs from the tax account"
          }
        />
      </KpiStrip>

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <SubTabs
          // The status is the button in the drawer over the bottom bar on a
          // phone.
          className="max-md:hidden"
          tabs={[
            {
              value: "OPEN",
              label: (
                <Count
                  text="Open"
                  n={all.filter((row) => inStatus(row, "OPEN")).length}
                />
              ),
            },
            {
              value: "FILED",
              label: (
                <Count
                  text="Filed"
                  n={all.filter((row) => inStatus(row, "FILED")).length}
                />
              ),
            },
            {
              value: "SETTLED",
              label: (
                <Count
                  text="Settled"
                  n={all.filter((row) => inStatus(row, "SETTLED")).length}
                />
              ),
            },
            { value: "ALL", label: <Count text="All" n={all.length} /> },
          ]}
          value={show}
          onChange={(next) => setShow(next as Show)}
        />
        <Select
          value={taxType}
          onChange={setTaxType}
          className="h-control w-56"
          aria-label="Tax"
        >
          <option value="">Every tax</option>
          {(types.data ?? []).map((row) => (
            <option key={row.code} value={row.code}>
              {row.name}
            </option>
          ))}
        </Select>
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>

      <DockTools
        sort={dockSortOf(table)}
        filter={{
          count: taxType === "" ? 0 : 1,
          onOpen: () => setFiltering(true),
        }}
        status={{
          value: show,
          options: (
            [
              ["OPEN", "Open"],
              ["FILED", "Filed"],
              ["SETTLED", "Settled"],
              ["ALL", "All"],
            ] as const
          ).map(([value, text]) => ({
            value,
            label: text,
            count:
              value === "ALL"
                ? all.length
                : all.filter((row) => inStatus(row, value)).length,
          })),
          onChange: (next) => setShow(next as Show),
        }}
      />

      <FilterSheet
        open={filtering}
        onOpenChange={setFiltering}
        groups={[
          {
            key: "tax",
            label: "Tax",
            value: taxType === "" ? null : taxType,
            options: [
              { value: null, label: "Every tax" },
              ...(types.data ?? []).map((row) => ({
                value: row.code,
                label: row.name,
              })),
            ],
            onChange: (next) => setTaxType(next ?? ""),
          },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState>
          {all.length === 0
            ? "No tax period has been opened yet."
            : "No period matches these filters."}
        </EmptyState>
      ) : (
        <div ref={measure}>
          <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            <DataTable<TaxPeriod>
              table={table}
              refresh={[periods]}
              pageScroll
              cardsApart
              cardSort={false}
              summary={{
                tax_type_name: (
                  <span>
                    {count(rows.length)}{" "}
                    <span className="font-normal text-body">
                      {rows.length === 1 ? "period" : "periods"}
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

function Count({ text, n }: { text: string; n: number }) {
  return (
    <span>
      {text}
      <span className="ml-1.5 text-body tabular-nums">{count(n)}</span>
    </span>
  )
}
