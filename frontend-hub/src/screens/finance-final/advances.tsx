import {
  useMutation,
  useQuery,
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
import { Day } from "@/components/ui/day"
import { Field, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { CellMoney } from "@/components/ui/rows-switch"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState } from "@/components/ui/states"
import { money } from "@/lib/format"
import { financeKeys, listCompanyBankAccounts } from "@/lib/queries/finance"
import {
  advanceControlQuery,
  advancePagesQuery,
  payAdvance,
} from "@/lib/queries/finance-domains"
import { useCanWrite } from "@/lib/session"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Code } from "@/screens/finance-final/parts"
import { ScreenPending } from "@/screens/finance/pending"
import type { Advance } from "@itulah/contract"

/// Advances — money out with somebody, and how old it is.
///
/// Ageing is derived from the day the money left, not stored, so it cannot
/// disagree with the balance beside it.
export function Advances() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance" title="Advances">
          Reading the advances…
        </ScreenPending>
      }
    >
      <AdvancesScreen />
    </Suspense>
  )
}

function AdvancesScreen() {
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [paying, setPaying] = useState<PayTarget | null>(null)
  const canWrite = useCanWrite()
  // The tab answers at once; the list trails it, and the rows in hand stay on
  // screen (dimmed) until the next are read.
  const askedStatus = useDeferredValue(status)
  // A page at a time, newest first. The cards read the server's figures over
  // the whole book, never a sum of the pages loaded.
  const advances = useSuspenseInfiniteQuery(advancePagesQuery(askedStatus))
  const control = useSuspenseQuery(advanceControlQuery())

  const rows = useMemo(
    () => advances.data.pages.flatMap((page) => page.rows),
    [advances.data]
  )
  const head = advances.data.pages[0]
  const outstanding = head.outstanding_minor
  const old = head.over_thirty_days
  const difference = control.data.reduce(
    (total, row) => total + row.difference_minor,
    0
  )

  /// The advances, and how old each is. On a card the person names it, the
  /// number sits over it and the value, what is left and the age follow — with
  /// the verb, Pay out, where an approved one waits for it.
  const columns = useMemo<ColumnDef<TableSetup, Advance>[]>(
    () => [
      {
        id: "number",
        accessorFn: (row) => row.advance_number,
        header: "Number",
        size: 120,
        enableSorting: false,
        meta: { card: "id" },
        cell: ({ row }) => <Code>{row.original.advance_number}</Code>,
      },
      {
        id: "to",
        accessorFn: (row) => row.party_label,
        header: "To",
        size: 170,
        enableSorting: false,
        meta: { card: "title", grow: 150 },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col whitespace-normal">
            <span>{row.original.party_label}</span>
            <span className="text-[0.9375rem] font-normal text-mute">
              {row.original.party_type}
            </span>
          </span>
        ),
      },
      {
        id: "purpose",
        accessorFn: (row) => row.purpose,
        header: "Purpose",
        size: 230,
        enableSorting: false,
        meta: { card: "meta", priority: 2 },
        cell: ({ row }) => (
          <span className="whitespace-normal">{row.original.purpose}</span>
        ),
      },
      {
        id: "unit",
        accessorFn: (row) => row.site_id,
        header: "Unit",
        size: 100,
        enableSorting: false,
        meta: { card: "hide", priority: 3 },
        cell: ({ row }) => row.original.site_id,
      },
      {
        id: "value",
        accessorFn: (row) => row.amount_minor,
        header: "Value",
        size: 130,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => <CellMoney minor={row.original.amount_minor} />,
      },
      {
        id: "remaining",
        accessorFn: (row) => row.outstanding_minor,
        header: "Remaining",
        size: 130,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => <CellMoney minor={row.original.outstanding_minor} />,
      },
      {
        id: "age",
        accessorFn: (row) => row.age_days,
        header: "Age",
        size: 90,
        enableSorting: false,
        meta: { align: "right", card: "metric", priority: 2 },
        cell: ({ row }) =>
          row.original.age_days === null
            ? "—"
            : `${row.original.age_days} days`,
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        size: 200,
        enableSorting: false,
        meta: { card: "status" },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            <Pill
              tone={
                row.original.status === "SETTLED"
                  ? "ok"
                  : row.original.status === "CANCELLED"
                    ? "neutral"
                    : (row.original.age_days ?? 0) > 30
                      ? "warn"
                      : "info"
              }
            >
              {row.original.status}
            </Pill>
            {row.original.status === "APPROVED" && canWrite && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setPaying({
                    id: row.original.advance_id,
                    number: row.original.advance_number,
                    party: row.original.party_label,
                    purpose: row.original.purpose,
                    amount: row.original.amount_minor,
                  })
                }
              >
                Pay out
              </Button>
            )}
          </span>
        ),
      },
    ],
    [canWrite]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: Advance) => row.advance_id,
      }),
      [rows, columns]
    )
  )

  return (
    <PageContent>
      <PageHeader crumb="Finance" title="Advances" />

      <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
        <Kpi label="Still with people" value={money(outstanding)} />
        <Kpi
          label="Over 30 days"
          value={
            <span
              className={old === null || old === 0 ? undefined : "text-warn-fg"}
            >
              {money(old)}
            </span>
          }
        />
        <Kpi
          label="Difference from the ledger"
          value={
            <span className={difference === 0 ? undefined : "text-bad-fg"}>
              {money(difference)}
            </span>
          }
        />
      </KpiStrip>

      {/* The status is the dock's button on a phone. */}
      <SubTabs
        className="mb-3.5"
        tabs={[
          { value: "ALL", label: "All" },
          { value: "REQUESTED", label: "Requested" },
          { value: "APPROVED", label: "Approved" },
          { value: "PAID", label: "Paid" },
          { value: "PARTIALLY_SETTLED", label: "Partially settled" },
          { value: "SETTLED", label: "Settled" },
        ]}
        value={status ?? "ALL"}
        onChange={(next) => setStatus(next === "ALL" ? undefined : next)}
      />

      <Card
        aria-busy={askedStatus !== status || undefined}
        className="list-swap overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
      >
        {rows.length === 0 ? (
          <EmptyState>No advances yet</EmptyState>
        ) : (
          <DataTable<Advance>
            refresh={[advances]}
            table={table}
            more={advances}
            pageScroll
            cardSort={false}
            cardsApart
          />
        )}
      </Card>

      {paying !== null && (
        <PaySheet target={paying} onClose={() => setPaying(null)} />
      )}
    </PageContent>
  )
}

interface PayTarget {
  id: string
  number: string
  party: string
  purpose: string
  amount: number
}

/// Pay an approved advance out: the day the money left and where it left
/// from. An employee's loan starts being taken back from pay only once it is
/// paid out here.
function PaySheet({
  target,
  onClose,
}: {
  target: PayTarget
  onClose: () => void
}) {
  const client = useQueryClient()
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10))
  const [source, setSource] = useState("petty_cash|")
  const banks = useQuery({
    queryKey: financeKeys.companyBankAccounts(null),
    queryFn: ({ signal }) => listCompanyBankAccounts(signal),
  })
  const pay = useMutation({
    mutationFn: () => {
      const [cashKey, qualifier] = source.split("|")
      return payAdvance(target.id, {
        posting_date: on,
        cash_key: cashKey,
        cash_qualifier: qualifier ?? "",
      })
    },
    onSuccess: () => {
      // Every status filter's pages, and the control figure beside them.
      void client.invalidateQueries({ queryKey: ["finance", "advances"] })
      void client.invalidateQueries({ queryKey: ["people"] })
      onClose()
    },
  })
  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title={`Pay out ${target.number}`}
      footer={
        <SheetFooter
          onCancel={onClose}
          primary={{
            label: "Pay out",
            pending: pay.isPending,
            disabled: on === "",
            onClick: () => pay.mutate(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Facts>
          <Fact term="To">{target.party}</Fact>
          <Fact term="Purpose">{target.purpose}</Fact>
          <Fact term="Value">{money(target.amount)}</Fact>
        </Facts>
        <Field label="Date" required>
          <Day value={on} onChange={setOn} />
        </Field>
        <Field label="Paid From" required>
          <Select value={source} onChange={setSource}>
            <option value="petty_cash|">Unit petty cash</option>
            {(banks.data ?? []).map((bank) => (
              <option
                key={`${bank.ledger_account_code}-${bank.bank_code}`}
                value={`${bank.kind === "SAVINGS" ? "bank_savings" : "bank_giro"}|${bank.bank_code}`}
              >
                {`${bank.bank_code} ${bank.account_no}`}
              </option>
            ))}
          </Select>
        </Field>
        {pay.error !== null && <Banner tone="bad">{pay.error.message}</Banner>}
      </div>
    </Sheet>
  )
}
