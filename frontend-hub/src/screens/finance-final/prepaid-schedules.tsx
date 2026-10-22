import {
  useMutation,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { Pill } from "@/components/ui/pill"
import { CellMoney } from "@/components/ui/rows-switch"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  allocatePrepaidMonth,
  prepaidDueQuery,
  prepaidSchedulePagesQuery,
} from "@/lib/queries/finance-domains"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Code, Note } from "@/screens/finance-final/parts"
import { FactsSheet } from "@/screens/finance/phone-parts"
import { ScreenPending } from "@/screens/finance/pending"
import type { PrepaidSchedule } from "@itulah/contract"

/// Prepaid schedules — what was paid for in advance, and the months it belongs
/// to.
///
/// The screen does not create the prepayment: the bill did that, and this is
/// the plan for taking it back out. One button posts a month for every schedule
/// that covers it, and pressing it twice is safe — the second press reports what
/// it found rather than posting again.
const statusTone = (status: string) =>
  status === "ACTIVE" ? "info" : status === "COMPLETED" ? "ok" : "warn"

/// One schedule: its number, what it is, the months it runs and where it
/// stands. On a card the account names it, the number sits over it and the
/// three figures follow, label over value.
const columns: ColumnDef<TableSetup, PrepaidSchedule>[] = [
  {
    id: "number",
    accessorFn: (row) => row.schedule_number,
    header: "Number",
    size: 130,
    enableSorting: false,
    meta: { card: "id" },
    cell: ({ row }) => <Code>{row.original.schedule_number}</Code>,
  },
  {
    id: "unit",
    accessorFn: (row) => row.site_id,
    header: "Unit",
    size: 90,
    enableSorting: false,
    meta: { card: "meta", priority: 3 },
    cell: ({ row }) => row.original.site_id,
  },
  {
    id: "account",
    accessorFn: (row) => row.prepaid_account_name,
    header: "Account",
    size: 240,
    enableSorting: false,
    meta: { card: "title", grow: 220 },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col whitespace-normal">
        <span>{row.original.prepaid_account_name}</span>
        <span className="text-[0.9375rem] font-normal text-mute">
          → {row.original.expense_account_name}
        </span>
      </span>
    ),
  },
  {
    id: "period",
    accessorFn: (row) => row.start_period,
    header: "Period",
    size: 190,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="tabular-nums">
          {row.original.start_period.slice(0, 7)} —{" "}
          {row.original.end_period.slice(0, 7)}
        </span>
        <span className="text-[0.9375rem] text-mute">
          {row.original.periods_allocated}/{row.original.periods} months
        </span>
      </span>
    ),
  },
  {
    id: "value",
    accessorFn: (row) => row.amount_minor,
    header: "Value",
    size: 130,
    enableSorting: false,
    meta: { align: "right", card: "metric", priority: 2 },
    cell: ({ row }) => <CellMoney minor={row.original.amount_minor} />,
  },
  {
    id: "expensed",
    accessorFn: (row) => row.allocated_minor,
    header: "Already Expensed",
    size: 165,
    enableSorting: false,
    meta: { align: "right", card: "metric", priority: 2 },
    cell: ({ row }) => <CellMoney minor={row.original.allocated_minor} />,
  },
  {
    id: "remaining",
    accessorFn: (row) => row.remaining_minor,
    header: "Remaining",
    size: 130,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => <CellMoney minor={row.original.remaining_minor} />,
  },
  {
    id: "status",
    accessorFn: (row) => row.status,
    header: "Status",
    size: 120,
    enableSorting: false,
    meta: { card: "status" },
    cell: ({ row }) => (
      <Pill tone={statusTone(row.original.status)}>{row.original.status}</Pill>
    ),
  },
]

export function PrepaidSchedules() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance" title="Prepaid Expenses">
          Reading the schedules…
        </ScreenPending>
      }
    >
      <PrepaidSchedulesScreen />
    </Suspense>
  )
}

function PrepaidSchedulesScreen() {
  const phone = useLayout() === "phone"
  /// The phone's "allocate a month" sheet, the dock's + opens it.
  const [allocating, setAllocating] = useState(false)
  const [shown, setShown] = useState<PrepaidSchedule | null>(null)
  const client = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  })
  const [status, setStatus] = useState<string | undefined>("ACTIVE")

  const asked = `${month.year}-${String(month.month).padStart(2, "0")}`

  // The tab and the month answer at once; the list trails them, and the rows
  // in hand stay on screen (dimmed) until the next are read.
  const askedStatus = useDeferredValue(status)
  const askedMonth = useDeferredValue(asked)
  const stale = askedStatus !== status || askedMonth !== asked

  // A page at a time, newest first. The cards read the server's figures over
  // every schedule the filter matches, never a sum of the pages loaded.
  const schedules = useSuspenseInfiniteQuery(
    prepaidSchedulePagesQuery(askedStatus)
  )
  // How many are due in the chosen month, asked separately so picking a month
  // re-asks one small question rather than reloading the list.
  const dueIn = useSuspenseQuery(prepaidDueQuery(askedStatus, askedMonth))

  const allocate = useMutation({
    mutationFn: () =>
      allocatePrepaidMonth({ year: month.year, month: month.month }),
    onSuccess: () => {
      setAllocating(false)
      void client.invalidateQueries({ queryKey: ["finance"] })
    },
  })

  const rows = useMemo(
    () => schedules.data.pages.flatMap((page) => page.rows),
    [schedules.data]
  )
  const head = schedules.data.pages[0]
  const remaining = head.remaining_minor
  const due = dueIn.data.due_in_period

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: PrepaidSchedule) => row.schedule_id,
      }),
      [rows]
    )
  )

  /// The month the schedules are allocated for, as the page's own picker.
  const monthPicker = (
    <input
      type="month"
      aria-label="Month"
      className="ui-field h-control rounded-inner border border-hairline-2 bg-canvas px-3 text-[0.9375rem] text-ink"
      value={`${month.year}-${String(month.month).padStart(2, "0")}`}
      onChange={(event) => {
        const [year, monthPart] = event.target.value.split("-")
        if (year !== undefined && monthPart !== undefined) {
          setMonth({ year: Number(year), month: Number(monthPart) })
        }
      }}
    />
  )

  const statusTabs = (
    <SubTabs
      tabs={[
        { value: "ACTIVE", label: "Active" },
        { value: "COMPLETED", label: "Completed" },
        { value: "CANCELLED", label: "Cancelled" },
        { value: "ALL", label: "All" },
      ]}
      value={status ?? "ALL"}
      onChange={(next) => setStatus(next === "ALL" ? undefined : next)}
    />
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Prepaid Expenses"
        // The one action stands in the head; on a phone choosing the month and
        // posting it is the dock's + and the sheet it opens.
        actions={
          phone ? undefined : (
            <Button
              variant="primary"
              pending={allocate.isPending}
              onClick={() => allocate.mutate()}
            >
              Allocate this month
            </Button>
          )
        }
      />

      {phone && (
        <>
          <Fab
            label="Allocate this month"
            onClick={() => setAllocating(true)}
          />
          <BottomSheet
            open={allocating}
            onOpenChange={setAllocating}
            title="Allocate this month"
          >
            <div className="flex flex-col gap-3 px-4 pb-4">
              <input
                type="month"
                aria-label="Month"
                className="h-11 w-full rounded-inner border border-hairline-2 bg-canvas px-3 text-[0.9375rem]"
                value={`${month.year}-${String(month.month).padStart(2, "0")}`}
                onChange={(event) => {
                  const [year, monthPart] = event.target.value.split("-")
                  if (year !== undefined && monthPart !== undefined) {
                    setMonth({ year: Number(year), month: Number(monthPart) })
                  }
                }}
              />
              <Button
                variant="primary"
                pending={allocate.isPending}
                onClick={() => allocate.mutate()}
              >
                Allocate this month
              </Button>
            </div>
          </BottomSheet>
        </>
      )}

      <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
        <Kpi label="Running schedules" value={count(head.total)} />
        <Kpi label="Left to expense" value={money(remaining)} />
        <Kpi label="Waiting in the chosen month" value={count(due)} />
      </KpiStrip>

      {allocate.data === undefined ? null : (
        <Note>
          {allocate.data.posted} schedules posted,{" "}
          {allocate.data.already_posted} already there,{" "}
          {allocate.data.completed} completed. Total{" "}
          {money(allocate.data.amount_minor)}.
        </Note>
      )}

      {/* The status is the dock's button on a phone; on a desk it leads the
          toolbar of the month the Waiting figure and Allocate this month are
          for. On a phone that month is the one in the sheet the dock's +
          opens. */}
      {phone ? statusTabs : <Toolbar lead={statusTabs}>{monthPicker}</Toolbar>}

      <Card
        aria-busy={stale || undefined}
        className="list-swap overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
      >
        {rows.length === 0 ? (
          <EmptyState>No schedules yet</EmptyState>
        ) : (
          <DataTable<PrepaidSchedule>
            refresh={[schedules]}
            table={table}
            onRowClick={setShown}
            isSelected={(row) => row.schedule_id === shown?.schedule_id}
            more={schedules}
            pageScroll
            cardSort={false}
            cardsApart
          />
        )}
      </Card>

      <FactsSheet
        open={shown !== null}
        onClose={() => setShown(null)}
        title={shown?.prepaid_account_name ?? ""}
        id={shown?.schedule_number}
        caption={shown === null ? undefined : `→ ${shown.expense_account_name}`}
        facts={
          shown === null
            ? []
            : [
                { label: "Unit", value: shown.site_id },
                {
                  label: "Period",
                  value: `${shown.start_period.slice(0, 7)} — ${shown.end_period.slice(0, 7)}`,
                },
                {
                  label: "Months",
                  value: `${shown.periods_allocated}/${shown.periods}`,
                },
                { label: "Value", value: money(shown.amount_minor) },
                {
                  label: "Already Expensed",
                  value: money(shown.allocated_minor),
                },
                { label: "Remaining", value: money(shown.remaining_minor) },
                { label: "Status", value: shown.status },
              ]
        }
      />
    </PageContent>
  )
}
