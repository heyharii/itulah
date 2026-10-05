import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { problemOf } from "@/lib/problem"
import { clearGiro, financeKeys, listGiros } from "@/lib/queries/finance"
import { Code, Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
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
  const client = useQueryClient()
  const [bank, setBank] = useState("")
  const [direction, setDirection] = useState("")
  const [withCleared, setWithCleared] = useState(false)
  const [dates, setDates] = useState<Readonly<Record<string, string>>>({})
  const [done, setDone] = useState<number | null>(null)

  // One request per status, so every narrowing is the server's.
  const statuses = withCleared ? [...OPEN, "CLEARED"] : OPEN
  const reads = useQueries({
    queries: statuses.map((status) => ({
      queryKey: financeKeys.giros(status),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listGiros({ status, limit: 500 }, signal),
    })),
    combine: (results) => ({
      rows: results.flatMap((result) => result.data ?? []),
      pending: results.some((result) => result.isPending),
      error: results.find((result) => result.isError)?.error,
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

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Banking"
        title="Bank Clearance"
        actions={
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
        }
      />

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
            <option value="">Every bank</option>
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

      {reads.pending ? (
        <p className="py-10 text-center text-[0.875rem] text-mute">
          Reading the giros…
        </p>
      ) : reads.error !== undefined ? (
        <Banner tone="bad">
          {problemOf(reads.error) ?? "The giros could not be read."}
        </Banner>
      ) : rows.length === 0 ? (
        <EmptyState>
          No giro is waiting for the bank
          {bank === "" ? "" : ` at ${bank}`}. A giro is written from a payment
          or a cash document paid by giro.
        </EmptyState>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th width="9rem">Payment Document</Th>
              <Th width="10rem">Payment Entry</Th>
              <Th width="9rem">Cheque Number</Th>
              <Th width="7.5rem">Cheque Date</Th>
              <Th align="right" width="9rem">
                Debit
              </Th>
              <Th align="right" width="9rem">
                Credit
              </Th>
              <Th>Against Account</Th>
              <Th width="11rem">Clearance Date</Th>
              <Th width="6rem">Bank</Th>
              <Th width="7rem">Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.giro_id}>
                <Td>
                  {row.supplier_payment_id !== null
                    ? "Payment Entry"
                    : row.cash_document_id !== null
                      ? "Cash Document"
                      : "—"}
                </Td>
                <Td>
                  <Code>
                    {row.payment_number ?? row.cash_document_number ?? "—"}
                  </Code>
                </Td>
                <Td>
                  <Code>{row.number}</Code>
                </Td>
                <Td className="whitespace-nowrap">{day(row.due_date)}</Td>
                <Td align="right">
                  {row.direction === "IN" ? money(row.amount_minor) : ""}
                </Td>
                <Td align="right">
                  {row.direction === "OUT" ? money(row.amount_minor) : ""}
                </Td>
                <Td>
                  {row.party_name ?? <span className="text-faint">—</span>}
                </Td>
                <Td>
                  {row.status === "CLEARED" ? (
                    day(row.cleared_on)
                  ) : (
                    <Day
                      value={dates[row.giro_id] ?? ""}
                      onChange={(value) =>
                        setDates((was) => ({ ...was, [row.giro_id]: value }))
                      }
                      className="h-control w-40"
                      label="Clearance Date"
                    />
                  )}
                </Td>
                <Td>{row.bank}</Td>
                <Td>
                  <Status tone={STATUS_TONE[row.status] ?? "neutral"}>
                    {STATUS_LABEL[row.status] ?? row.status}
                  </Status>
                </Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td />
              <Td />
              <Td />
              <Td align="right">{money(debit)}</Td>
              <Td align="right">{money(credit)}</Td>
              <Td />
              <Td />
              <Td />
              <Td />
            </TotalRow>
          </tbody>
        </Grid>
      )}
    </PageContent>
  )
}

/// Written and not yet taken by the bank: in hand, handed over, or due.
const OPEN: readonly string[] = ["ISSUED", "DELIVERED", "DUE"]

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
