import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { CellMoney } from "@/components/ui/rows-switch"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Toolbar } from "@/components/ui/segmented"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState } from "@/components/ui/states"
import { node } from "@/lib/api"
import { count, day, money } from "@/lib/format"
import { problemOf } from "@/lib/problem"
import {
  accrualKeys,
  accrualsQuery,
  listBills,
  type AccrualRow,
} from "@/lib/queries/finance"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useSupplierName, useUnitName } from "@/screens/finance/hooks"
import { UnitSelect } from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"

/// Payables › Accruals (owner, 2026-10-01).
///
/// A cost booked before its bill — the month's telephone, electricity, water
/// on a YMHD account — waits here until the supplier's bill arrives. Matching
/// the bill reverses the accrual on the bill's date, so the month carries the
/// cost once: the bill in Accounts Payable, the accrual gone from YMHD. Before
/// this screen nothing took an accrual back, and every billed month counted
/// its cost twice.
///
/// A list and not a board: an accrual has two states, waiting and settled.

function settleAccrual(entryId: string, invoiceId: string | null) {
  return node.post<AccrualRow>(`/api/v1/finance/accruals/${entryId}/settle`, {
    invoice_id: invoiceId,
  })
}

export function Accruals() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Payables" title="Accruals">
          Reading the accruals…
        </ScreenPending>
      }
    >
      <AccrualsScreen />
    </Suspense>
  )
}

function AccrualsScreen() {
  const [status, setStatus] = useState("OPEN")
  const [matching, setMatching] = useState<AccrualRow | null>(null)
  const [needle, setNeedle] = useState("")
  const [unit, setUnit] = useState("")
  const unitName = useUnitName()
  const supplierName = useSupplierName()

  // Every accrual in one read, so each tab can say how many it holds.
  const accruals = useSuspenseQuery(accrualsQuery())
  const every = accruals.data
  const waiting = every.filter((row) => row.status === "OPEN")
  const settled = every.length - waiting.length

  /// The search and the unit narrow what the list and its toolbar figure
  /// say; the tab counts stay whole, so a tab still tells how many exist.
  const matched = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return every.filter(
      (row) =>
        (unit === "" || row.unit_id === unit) &&
        (text === "" ||
          [
            row.expense_name,
            row.account_name,
            row.entry_number,
            row.invoice_number,
            row.supplier_name,
          ].some((field) => (field ?? "").toLowerCase().includes(text)))
    )
  }, [every, needle, unit])
  const rows = useMemo(
    () =>
      status === "ALL"
        ? matched
        : matched.filter((row) => row.status === status),
    [matched, status]
  )
  const waitingShown = matched.filter((row) => row.status === "OPEN")
  const owed = waitingShown.reduce((sum, row) => sum + row.amount_minor, 0)
  const narrowed = needle.trim() !== "" || unit !== ""

  /// What was accrued, and what replaced it. A card is the cost over the unit
  /// and the day, the amount as its figure and the bill's state in the foot,
  /// with Match bill at the right while one is still waited for.
  const columns = useMemo<ColumnDef<TableSetup, AccrualRow>[]>(
    () => [
      {
        id: "date",
        accessorFn: (row) => row.posting_date,
        header: "Accrued on",
        size: 130,
        enableSorting: false,
        meta: { card: "meta", priority: 2 },
        cell: ({ row }) => (
          <span className="text-body">{day(row.original.posting_date)}</span>
        ),
      },
      {
        id: "cost",
        accessorFn: (row) => row.expense_name ?? row.account_name,
        header: "Cost",
        size: 280,
        enableSorting: false,
        meta: { card: "title", grow: 240 },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ink">
              {row.original.expense_name ?? row.original.account_name}
            </span>
            <span className="truncate text-[0.9375rem] font-normal text-mute">
              {row.original.account_code} {row.original.account_name} ·{" "}
              {row.original.entry_number}
            </span>
          </span>
        ),
      },
      {
        id: "unit",
        accessorFn: (row) => unitName(row.unit_id),
        header: "Unit",
        size: 150,
        enableSorting: false,
        meta: { card: "meta", priority: 3 },
        cell: ({ row }) => (
          <span className="text-body">
            {unitName(row.original.unit_id).replace(/^[^·]*· /, "")}
          </span>
        ),
      },
      {
        id: "amount",
        accessorFn: (row) => row.amount_minor,
        header: "Accrued",
        size: 150,
        enableSorting: false,
        meta: { align: "right", card: "lead" },
        cell: ({ row }) => (
          <span className="font-medium text-ink">
            <CellMoney minor={row.original.amount_minor} />
          </span>
        ),
      },
      {
        id: "bill",
        accessorFn: (row) => row.invoice_number ?? row.status,
        header: "Bill",
        size: 240,
        enableSorting: false,
        meta: { card: "foot" },
        cell: ({ row }) =>
          row.original.status === "OPEN" ? (
            <span className="text-warn-fg">Waiting for a bill</span>
          ) : row.original.invoice_number !== null ? (
            <span className="flex min-w-0 flex-col">
              <span className="text-ink">{row.original.invoice_number}</span>
              <span className="text-[0.9375rem] text-mute">
                {row.original.supplier_name
                  ? `${supplierName(null, row.original.supplier_name)} · `
                  : ""}
                settled {day(row.original.settled_on)}
              </span>
            </span>
          ) : (
            <span className="text-mute">
              Released {day(row.original.settled_on)}
            </span>
          ),
      },
      {
        id: "match",
        accessorFn: (row) => row.entry_id,
        header: "",
        size: 130,
        enableSorting: false,
        enableHiding: false,
        meta: { align: "right", card: "status" },
        cell: ({ row }) =>
          row.original.status === "OPEN" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                setMatching(row.original)
              }}
            >
              Match bill
            </Button>
          ),
      },
    ],
    [unitName, supplierName]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: AccrualRow) => row.entry_id,
      }),
      [rows, columns]
    )
  )

  return (
    <PageContent>
      <PageHeader crumb="Finance · Payables" title="Accruals" />

      <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
        <Kpi label="Waiting for a bill" value={count(waitingShown.length)} />
        <Kpi label="Still to be billed" value={money(owed)} />
      </KpiStrip>

      <Toolbar
        className="group/bar"
        lead={
          <SubTabs
            tabs={[
              {
                value: "OPEN",
                label: (
                  <TabLabel text="Waiting for a bill" n={waiting.length} />
                ),
                short: "Waiting",
              },
              {
                value: "SETTLED",
                label: <TabLabel text="Settled" n={settled} />,
                short: "Settled",
              },
              {
                value: "ALL",
                label: <TabLabel text="All" n={every.length} />,
                short: "All",
              },
            ]}
            value={status}
            onChange={setStatus}
          />
        }
      >
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search accruals"
        />
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        <Toolbar.Spacer />
      </Toolbar>

      {rows.length === 0 ? (
        <EmptyState>
          {needle.trim() !== ""
            ? `No accrual matches “${needle.trim()}”.`
            : status === "OPEN" && !narrowed
              ? "Every accrued cost has its bill."
              : "No accrual matches."}
        </EmptyState>
      ) : (
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <DataTable<AccrualRow>
            refresh={[accruals]}
            table={table}
            onRowClick={(row) => row.status === "OPEN" && setMatching(row)}
            pageScroll
            cardSort={false}
            cardsApart
            cardLead
          />
        </Card>
      )}

      {matching !== null && (
        <MatchForm
          key={matching.entry_id}
          accrual={matching}
          onClose={() => setMatching(null)}
          onDone={() => setMatching(null)}
        />
      )}
    </PageContent>
  )
}

function TabLabel({ text, n }: { text: string; n: number }) {
  return (
    <span>
      {text}
      <span className="ml-1.5 text-body tabular-nums">{count(n)}</span>
    </span>
  )
}

/// Pick the posted bill that replaces the accrual. Settling reverses the
/// accrual on the bill's date; the bill itself is not touched.
function MatchForm({
  accrual,
  onClose,
  onDone,
}: {
  accrual: AccrualRow
  onClose: () => void
  onDone: () => void
}) {
  const client = useQueryClient()
  const supplierName = useSupplierName()
  const [needle, setNeedle] = useState("")
  const [chosen, setChosen] = useState<string | null>(null)

  const bills = useQuery({
    queryKey: ["finance", "bills", "accrual-match", needle],
    queryFn: ({ signal }) =>
      listBills(
        { status: "POSTED", q: needle.trim() || undefined, limit: 30 },
        signal
      ),
  })
  const candidates = useMemo(() => bills.data?.rows ?? [], [bills.data])

  const settle = useMutation({
    mutationFn: (invoiceId: string | null) =>
      settleAccrual(accrual.entry_id, invoiceId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: accrualKeys.all })
      void client.invalidateQueries({ queryKey: ["finance"] })
      onDone()
    },
  })

  const picked = candidates.find((bill) => bill.invoice_id === chosen)

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Match the bill"
      caption={`${accrual.expense_name ?? accrual.account_name} · ${money(accrual.amount_minor)} accrued ${day(accrual.posting_date)}`}
      size="rail"
      footer={
        <SheetFooter
          start={
            <Button
              variant="ghost"
              disabled={settle.isPending}
              onClick={() => settle.mutate(null)}
              title="The cost is not owed after all: take the accrual back without a bill."
            >
              Release without a bill
            </Button>
          }
          onCancel={onClose}
          primary={{
            label: "Settle with this bill",
            pending: settle.isPending,
            disabled: chosen === null,
            onClick: () => settle.mutate(chosen),
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {settle.isError && (
          <Banner tone="bad">
            {problemOf(settle.error) ?? "The accrual could not be settled."}
          </Banner>
        )}

        <Input
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
          aria-label="Search bills"
          autoFocus
        />

        <div className="max-h-[22rem] overflow-y-auto rounded-inner border border-hairline">
          {bills.isPending ? (
            <p className="px-4 py-6 text-center text-[0.9375rem] text-mute">
              Reading the bills…
            </p>
          ) : candidates.length === 0 ? (
            <p className="px-4 py-6 text-center text-[0.9375rem] text-mute">
              No posted bill matches.
            </p>
          ) : (
            candidates.map((bill) => (
              <button
                key={bill.invoice_id}
                type="button"
                onClick={() => setChosen(bill.invoice_id)}
                aria-pressed={chosen === bill.invoice_id}
                className="flex w-full items-center justify-between gap-3 border-b border-hairline px-4 py-3 text-left last:border-b-0 hover:bg-soft aria-pressed:bg-accent-bg"
              >
                <span className="min-w-0">
                  <span className="block truncate text-ink">
                    {supplierName(bill.supplier_id, bill.supplier_name)}
                  </span>
                  <span className="block text-[0.9375rem] text-mute">
                    {bill.invoice_number} · {day(bill.invoice_date)}
                  </span>
                </span>
                <span className="shrink-0 text-ink tabular-nums">
                  {money(bill.total_minor)}
                </span>
              </button>
            ))
          )}
        </div>

        {picked !== undefined && (
          <p className="text-[0.9375rem] text-body">
            The accrual of {money(accrual.amount_minor)} is reversed on the
            bill&rsquo;s date; the bill&rsquo;s {money(picked.total_minor)}{" "}
            stays in Accounts Payable.
            {picked.total_minor !== accrual.amount_minor &&
              ` The month's cost moves by ${money(picked.total_minor - accrual.amount_minor)}.`}
          </p>
        )}
      </div>
    </Sheet>
  )
}
