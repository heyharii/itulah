import {
  useMutation,
  useQueryClient,
  useSuspenseQueries,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Check } from "lucide-react"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Fab } from "@/components/ui/fab"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { problemOf } from "@/lib/problem"
import { clearGiro, giroClearanceQueries } from "@/lib/queries/finance"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Code } from "@/screens/finance-final/parts"
import { PhoneFigures } from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"
import { FilterCheck, ReportFilters } from "@/screens/finance/report"

import type { GiroRow } from "@itulah/contract"

/// ERPNext's Bank Clearance (`accounts/doctype/bank_clearance`), for the giro.
///
/// ERPNext's form: pick the bank account, list the payments written by cheque
/// that the bank has not yet taken, type the Clearance Date the statement
/// shows beside each, and press Update Clearance Date. Here the cheque is the
/// giro — written out to a supplier, or handed to us — and clearing one posts
/// the clearing entry on the day the bank took it, never on the day somebody
/// pressed the button: a statement read on Monday carries Friday's clearings.
///
/// The columns are ERPNext's Payment Entries grid — Payment Document, Payment
/// Entry, Cheque Number, Cheque Date, Debit, Credit, Against Account (the
/// party here), Clearance Date — with the bank, the unit and the status after
/// them. Include Reconciled Entries is ERPNext's too: ticked, the cleared ones
/// are listed as well, with the day they cleared.
///
/// A bounce, a taken-back clearing and a replacement are the giro's own
/// actions and stay with the giro; this screen does the one thing ERPNext's
/// does.
export function BankClearance() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Banking" title="Bank Clearance">
          Reading the giros…
        </ScreenPending>
      }
    >
      <BankClearanceScreen />
    </Suspense>
  )
}

function BankClearanceScreen() {
  const client = useQueryClient()
  const [bank, setBank] = useState("")
  const [direction, setDirection] = useState("")
  const [withCleared, setWithCleared] = useState(false)
  const [dates, setDates] = useState<Readonly<Record<string, string>>>({})
  const [done, setDone] = useState<number | null>(null)
  const phone = useLayout() === "phone"

  // One request per status, so every narrowing is the server's.
  // Ticking "Include reconciled" answers at once; the cleared ones follow,
  // and the giros in hand stay on screen until they are read.
  const asked = useDeferredValue(withCleared)
  const reads = useSuspenseQueries({
    queries: giroClearanceQueries(asked),
    combine: (results) => ({
      rows: results.flatMap((result) => result.data),
    }),
  })

  const banks = useMemo(
    () => [...new Set(reads.rows.map((row) => row.bank))].sort(),
    [reads.rows]
  )
  const rows = useMemo(
    () =>
      reads.rows
        .filter((row) => bank === "" || row.bank === bank)
        .filter((row) => direction === "" || row.direction === direction)
        .sort((a, b) =>
          a.due_date === b.due_date
            ? a.number.localeCompare(b.number)
            : a.due_date.localeCompare(b.due_date)
        ),
    [reads.rows, bank, direction]
  )

  const ready = rows.filter(
    (row) => row.status !== "CLEARED" && (dates[row.giro_id] ?? "") !== ""
  )

  const update = useMutation({
    mutationFn: async (entries: readonly GiroRow[]) => {
      // One at a time: each clearing is its own posting, and the first that
      // is refused stops the rest with the server's reason on screen.
      for (const entry of entries) {
        await clearGiro(entry.giro_id, dates[entry.giro_id] ?? "")
      }
      return entries.length
    },
    onSuccess: (cleared) => {
      setDone(cleared)
      setDates({})
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["finance", "giros"] })
      void client.invalidateQueries({ queryKey: ["finance", "money"] })
    },
  })

  const debit = rows
    .filter((row) => row.direction === "IN")
    .reduce((sum, row) => sum + row.amount_minor, 0)
  const credit = rows
    .filter((row) => row.direction === "OUT")
    .reduce((sum, row) => sum + row.amount_minor, 0)

  /// ERPNext's Payment Entries grid. The clearance date is the one cell that
  /// is typed into; on a card the party names it, the cheque number sits over
  /// it, and the figures and the date follow.
  const columns = useMemo<ColumnDef<TableSetup, GiroRow>[]>(
    () => [
      {
        id: "document",
        accessorFn: (row) =>
          row.supplier_payment_id !== null
            ? "Payment Entry"
            : row.cash_document_id !== null
              ? "Cash Document"
              : "—",
        header: "Payment Document",
        size: 110,
        enableSorting: false,
        meta: { card: "hide", priority: 3 },
      },
      {
        id: "entry",
        accessorFn: (row) => row.payment_number ?? row.cash_document_number,
        header: "Payment Entry",
        size: 140,
        enableSorting: false,
        meta: { card: "meta" },
        cell: ({ row }) => (
          <Code>
            {row.original.payment_number ??
              row.original.cash_document_number ??
              "—"}
          </Code>
        ),
      },
      {
        id: "number",
        accessorFn: (row) => row.number,
        header: "Cheque Number",
        size: 140,
        enableSorting: false,
        meta: { card: "id", priority: 2 },
        cell: ({ row }) => <Code>{row.original.number}</Code>,
      },
      {
        id: "date",
        accessorFn: (row) => row.due_date,
        header: "Cheque Date",
        size: 120,
        enableSorting: false,
        meta: { card: "meta", priority: 2 },
        cell: ({ row }) => day(row.original.due_date),
      },
      {
        id: "debit",
        accessorFn: (row) => (row.direction === "IN" ? row.amount_minor : null),
        header: "Debit",
        size: 130,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) =>
          row.original.direction === "IN"
            ? money(row.original.amount_minor)
            : "",
      },
      {
        id: "credit",
        accessorFn: (row) =>
          row.direction === "OUT" ? row.amount_minor : null,
        header: "Credit",
        size: 130,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) =>
          row.original.direction === "OUT"
            ? money(row.original.amount_minor)
            : "",
      },
      {
        id: "party",
        accessorFn: (row) => row.party_name,
        header: "Against Account",
        size: 150,
        enableSorting: false,
        meta: { card: "title", grow: 120 },
        cell: ({ row }) =>
          row.original.party_name === null ? (
            <span className="text-faint">—</span>
          ) : (
            <span className="block whitespace-normal">
              {row.original.party_name}
            </span>
          ),
      },
      {
        id: "clearance",
        // Never blank: on a card the date is typed here, and a card leaves out
        // a figure that says nothing.
        accessorFn: (row) => row.cleared_on ?? "open",
        header: "Clearance Date",
        size: 170,
        enableSorting: false,
        meta: { card: "metric" },
        cell: ({ row }) =>
          row.original.status === "CLEARED" ? (
            day(row.original.cleared_on)
          ) : (
            <Day
              value={dates[row.original.giro_id] ?? ""}
              onChange={(value) =>
                setDates((was) => ({ ...was, [row.original.giro_id]: value }))
              }
              className="h-control w-36"
              label="Clearance Date"
            />
          ),
      },
      {
        id: "bank",
        accessorFn: (row) => row.bank,
        header: "Bank",
        size: 80,
        enableSorting: false,
        meta: { card: "meta", priority: 3 },
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        size: 120,
        enableSorting: false,
        meta: { card: "status" },
        cell: ({ row }) => (
          <Status tone={STATUS_TONE[row.original.status] ?? "neutral"}>
            {STATUS_LABEL[row.original.status] ?? row.original.status}
          </Status>
        ),
      },
    ],
    [dates]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: GiroRow) => row.giro_id,
      }),
      [rows, columns]
    )
  )

  return (
    <PageContent>
      {/* The one action stands in the head; a phone has it at the thumb once a
          date has been typed. */}
      <PageHeader
        crumb="Finance · Banking"
        title="Bank Clearance"
        actions={
          phone ? undefined : (
            <Button
              variant="primary"
              pending={update.isPending}
              disabled={ready.length === 0}
              onClick={() => {
                setDone(null)
                update.mutate(ready)
              }}
            >
              Update Clearance Date
              {ready.length > 0 && ` (${count(ready.length)})`}
            </Button>
          )
        }
      />
      {phone && ready.length > 0 && (
        <Fab
          label={`Update Clearance Date (${count(ready.length)})`}
          icon={Check}
          onClick={() => {
            setDone(null)
            update.mutate(ready)
          }}
        />
      )}

      <ReportFilters
        note={`${count(rows.length)} ${rows.length === 1 ? "giro" : "giros"}`}
      >
        <span className="inline-flex w-44 shrink-0">
          <Select
            value={bank}
            onChange={setBank}
            className="h-control w-44"
            aria-label="Bank Account"
          >
            <option value="">All banks</option>
            {banks.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </span>
        <span className="inline-flex w-44 shrink-0">
          <Select
            value={direction}
            onChange={setDirection}
            className="h-control w-44"
            aria-label="Direction"
          >
            <option value="">Paid and received</option>
            <option value="OUT">Paid out</option>
            <option value="IN">Received</option>
          </Select>
        </span>
        <FilterCheck
          label="Include Reconciled Entries"
          checked={withCleared}
          onChange={setWithCleared}
        />
      </ReportFilters>

      {done !== null && (
        <Banner tone="ok" className="mb-3" onDismiss={() => setDone(null)}>
          {count(done)} {done === 1 ? "giro" : "giros"} cleared and posted.
        </Banner>
      )}
      {update.isError && (
        <Banner tone="bad" className="mb-3">
          {problemOf(update.error) ?? "The clearance could not be posted."}
        </Banner>
      )}

      {rows.length === 0 ? (
        <EmptyState>
          No giro is waiting for the bank
          {bank === "" ? "" : ` at ${bank}`}. A giro is written from a payment
          or a cash document paid by giro.
        </EmptyState>
      ) : (
        <>
          {phone && (
            <PhoneFigures
              items={[
                { label: "Received", value: debit },
                { label: "Paid out", value: credit },
              ]}
            />
          )}
          <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            <DataTable<GiroRow>
              table={table}
              summary={{
                document: "Total",
                debit: money(debit),
                credit: money(credit),
              }}
              pageScroll
              cardSort={false}
              cardsApart
            />
          </Card>
        </>
      )}
    </PageContent>
  )
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  ISSUED: "Issued",
  DELIVERED: "Delivered",
  DUE: "Due",
  CLEARED: "Cleared",
  REJECTED: "Bounced",
  VOIDED: "Voided",
}

const STATUS_TONE: Readonly<Record<string, "ok" | "warn" | "bad" | "neutral">> =
  {
    DUE: "warn",
    CLEARED: "ok",
    REJECTED: "bad",
  }
