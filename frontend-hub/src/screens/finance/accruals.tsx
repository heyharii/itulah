import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/ui/dialog"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { SubTabs } from "@/components/ui/sub-tabs"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states"
import { node } from "@/lib/api"
import { count, day, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { problemOf } from "@/lib/problem"
import { listBills } from "@/lib/queries/finance"
import { Grid, Td, Th } from "@/screens/finance-final/parts"
import { useSupplierName, useUnitName } from "@/screens/finance/hooks"
import { CardFigure, PhoneList } from "@/components/ui/phone-cards"
import { PhoneFigures, UnitSelect } from "@/screens/finance/parts"

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

interface AccrualRow {
  readonly entry_id: string
  readonly entry_number: string
  readonly posting_date: string
  readonly unit_id: string
  readonly account_code: string
  readonly account_name: string
  readonly expense_code: string | null
  readonly expense_name: string | null
  readonly amount_minor: number
  readonly memo: string | null
  readonly status: "OPEN" | "SETTLED"
  readonly settled_on: string | null
  readonly invoice_id: string | null
  readonly invoice_number: string | null
  readonly supplier_name: string | null
  readonly invoice_total_minor: number | null
}

const accrualKeys = {
  all: ["finance", "accruals"] as const,
  list: (status: string) => ["finance", "accruals", status] as const,
}

function listAccruals(status: string, signal?: AbortSignal) {
  return node.get<AccrualRow[]>(
    `/api/v1/finance/accruals${status === "ALL" ? "" : `?status=${status}`}`,
    { signal }
  )
}

function settleAccrual(entryId: string, invoiceId: string | null) {
  return node.post<AccrualRow>(`/api/v1/finance/accruals/${entryId}/settle`, {
    invoice_id: invoiceId,
  })
}

export function Accruals() {
  const [status, setStatus] = useState("OPEN")
  const [matching, setMatching] = useState<AccrualRow | null>(null)
  const [needle, setNeedle] = useState("")
  const [unit, setUnit] = useState("")
  const phone = useLayout() === "phone"
  const unitName = useUnitName()
  const supplierName = useSupplierName()

  // Every accrual in one read, so each tab can say how many it holds.
  const accruals = useQuery({
    queryKey: accrualKeys.list("ALL"),
    queryFn: ({ signal }) => listAccruals("ALL", signal),
  })
  const every = accruals.data ?? []
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
  const rows =
    status === "ALL" ? matched : matched.filter((row) => row.status === status)
  const waitingShown = matched.filter((row) => row.status === "OPEN")
  const owed = waitingShown.reduce((sum, row) => sum + row.amount_minor, 0)
  const narrowed = needle.trim() !== "" || unit !== ""

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Payables"
        title="Accruals"
        sub="Costs booked before their bill. Match each one to the bill that replaces it."
      />

      <SubTabs
        tabs={[
          {
            value: "OPEN",
            label: <TabLabel text="Waiting for a bill" n={waiting.length} />,
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

      {waitingShown.length > 0 && (
        <PhoneFigures
          items={[
            {
              label: "Waiting for a bill",
              value: waitingShown.length,
              unit: "count",
            },
            { label: "Still to be billed", value: owed },
          ]}
        />
      )}

      <Toolbar>
        <Input
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
          aria-label="Search accruals"
          placeholder="Search accruals"
          className="h-control w-64"
        />
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        <Toolbar.Spacer />
        {waitingShown.length > 0 && (
          <span className="text-[0.875rem] text-mute max-md:hidden">
            {count(waitingShown.length)} waiting ·{" "}
            <span className="font-medium text-ink tabular-nums">
              {money(owed)}
            </span>{" "}
            still to be billed
          </span>
        )}
      </Toolbar>

      {accruals.isPending ? (
        <LoadingState>Reading the accruals…</LoadingState>
      ) : accruals.isError ? (
        <ErrorState error={accruals.error} />
      ) : rows.length === 0 ? (
        <EmptyState>
          {needle.trim() !== ""
            ? `No accrual matches “${needle.trim()}”.`
            : status === "OPEN" && !narrowed
              ? "Every accrued cost has its bill."
              : "No accrual matches."}
        </EmptyState>
      ) : phone ? (
        <PhoneList
          rows={rows.map((row) => ({
            key: row.entry_id,
            title: row.expense_name ?? row.account_name,
            code: row.entry_number,
            line: unitName(row.unit_id).replace(/^[^·]*· /, ""),
            lead: (
              <CardFigure
                value={money(row.amount_minor)}
                caption={`accrued ${day(row.posting_date)}`}
              />
            ),
            foot:
              row.status === "OPEN" ? (
                <span className="text-warn-fg">Waiting for a bill</span>
              ) : row.invoice_number !== null ? (
                <span className="flex flex-col">
                  <span className="text-ink">{row.invoice_number}</span>
                  <span>
                    {row.supplier_name
                      ? `${supplierName(null, row.supplier_name)} · `
                      : ""}
                    settled {day(row.settled_on)}
                  </span>
                </span>
              ) : (
                <span>Released {day(row.settled_on)}</span>
              ),
            action:
              row.status === "OPEN" ? (
                <Button
                  variant="tint"
                  size="card"
                  onClick={() => setMatching(row)}
                >
                  Match bill
                </Button>
              ) : undefined,
            onOpen: row.status === "OPEN" ? () => setMatching(row) : undefined,
          }))}
        />
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th width="8rem">Accrued on</Th>
              <Th>Cost</Th>
              <Th width="10rem">Unit</Th>
              <Th align="right" width="10rem">
                Accrued
              </Th>
              <Th width="16rem">Bill</Th>
              <Th width="9rem" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.entry_id}>
                <Td className="text-body">{day(row.posting_date)}</Td>
                <Td className="max-w-0">
                  <span className="block truncate text-ink">
                    {row.expense_name ?? row.account_name}
                  </span>
                  <span className="block truncate text-[0.875rem] text-mute">
                    {row.account_code} {row.account_name} · {row.entry_number}
                  </span>
                </Td>
                <Td className="text-body">
                  {unitName(row.unit_id).replace(/^[^·]*· /, "")}
                </Td>
                <Td align="right" className="font-medium text-ink">
                  {money(row.amount_minor)}
                </Td>
                <Td>
                  {row.status === "OPEN" ? (
                    <span className="text-warn-fg">Waiting for a bill</span>
                  ) : row.invoice_number !== null ? (
                    <>
                      <span className="text-ink">{row.invoice_number}</span>
                      <span className="block text-[0.875rem] text-mute">
                        {row.supplier_name
                          ? `${supplierName(null, row.supplier_name)} · `
                          : ""}
                        settled {day(row.settled_on)}
                      </span>
                    </>
                  ) : (
                    <span className="text-mute">
                      Released {day(row.settled_on)}
                    </span>
                  )}
                </Td>
                <Td align="right">
                  {row.status === "OPEN" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setMatching(row)}
                    >
                      Match bill
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Grid>
      )}

      <Panel
        open={matching !== null}
        onOpenChange={(next) => !next && setMatching(null)}
        title="Match the bill"
        sub={
          matching === null
            ? undefined
            : `${matching.expense_name ?? matching.account_name} · ${money(matching.amount_minor)} accrued ${day(matching.posting_date)}`
        }
      >
        {matching !== null && (
          <MatchForm
            key={matching.entry_id}
            accrual={matching}
            onDone={() => setMatching(null)}
          />
        )}
      </Panel>
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
  onDone,
}: {
  accrual: AccrualRow
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
          <p className="px-4 py-6 text-center text-[0.875rem] text-mute">
            Reading the bills…
          </p>
        ) : candidates.length === 0 ? (
          <p className="px-4 py-6 text-center text-[0.875rem] text-mute">
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
                <span className="block text-[0.875rem] text-mute">
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
        <p className="text-[0.875rem] text-body">
          The accrual of {money(accrual.amount_minor)} is reversed on the
          bill&rsquo;s date; the bill&rsquo;s {money(picked.total_minor)} stays
          in Accounts Payable.
          {picked.total_minor !== accrual.amount_minor &&
            ` The month's cost moves by ${money(picked.total_minor - accrual.amount_minor)}.`}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          disabled={settle.isPending}
          onClick={() => settle.mutate(null)}
          title="The cost is not owed after all: take the accrual back without a bill."
        >
          Release without a bill
        </Button>
        <Button
          variant="primary"
          pending={settle.isPending}
          disabled={chosen === null}
          onClick={() => settle.mutate(chosen)}
        >
          Settle with this bill
        </Button>
      </div>
    </div>
  )
}
