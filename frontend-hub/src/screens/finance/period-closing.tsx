import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { ConfirmButton } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, Problem, Receipt } from "@/components/ui/states"
import { day, money, moment } from "@/lib/format"
import {
  cancelPeriodClosing,
  financeKeys,
  listPeriodClosings,
  postPeriodClosing,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Grid, Td, Th } from "@/screens/finance-final/parts"
import { Amount } from "@/screens/finance/parts"
import type { PeriodClosingVoucher } from "@itulah/contract"

/// Period Closing Voucher: a date range's profit or loss moved into retained
/// earnings, as one entry.
///
/// Separate from Period Close, which seals a month against new postings. This
/// is the year-end (or any range's) transfer ERPNext makes with a PCV. Only
/// the last voucher can be cancelled — its entry is reversed, never deleted —
/// because a range closed on top of it would otherwise have been computed
/// from a retained earnings balance that no longer holds.
function lastPosted(
  vouchers: readonly PeriodClosingVoucher[]
): PeriodClosingVoucher | undefined {
  return [...vouchers]
    .filter((one) => one.status === "POSTED")
    .sort((a, b) => b.period_end.localeCompare(a.period_end))[0]
}

/// The day after an ISO day, for the next range's default start.
function dayAfter(iso: string): string {
  const [year, month, date] = iso.split("-").map(Number)
  const next = new Date(year, month - 1, date + 1)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`
}

export function PeriodClosing() {
  const list = useQuery({
    queryKey: financeKeys.periodClosings(),
    queryFn: ({ signal }) => listPeriodClosings(signal),
  })
  const last = lastPosted(list.data ?? [])

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Opening & Closing"
        title="Period closing vouchers"
        sub="Move a range's profit or loss into retained earnings as one entry. Only the latest voucher can be cancelled, by reversing it."
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="overflow-hidden">
          {queryState(list, {
            loading: "Reading the vouchers…",
            render: (rows) =>
              rows.length === 0 ? (
                <EmptyState>
                  No range has been closed into retained earnings yet.
                </EmptyState>
              ) : (
                <Grid>
                  <thead>
                    <tr>
                      <Th>Range</Th>
                      <Th>Status</Th>
                      <Th align="right">Profit moved</Th>
                      <Th>Entry</Th>
                      <Th>By</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <VoucherRow
                        key={row.voucher_id}
                        voucher={row}
                        cancellable={row.voucher_id === last?.voucher_id}
                      />
                    ))}
                  </tbody>
                </Grid>
              ),
          })}
        </Card>

        <CloseRange
          key={last?.voucher_id ?? "first"}
          start={last === undefined ? "" : dayAfter(last.period_end)}
        />
      </div>
    </PageContent>
  )
}

function VoucherRow({
  voucher,
  cancellable,
}: {
  voucher: PeriodClosingVoucher
  cancellable: boolean
}) {
  const client = useQueryClient()
  const cancel = useMutation({
    mutationFn: () => cancelPeriodClosing(voucher.voucher_id),
    onSuccess: () => {
      // A reversal moves every balance and both statements.
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })
  const cancelled = voucher.status === "CANCELLED"

  return (
    <tr>
      <Td>
        <span className={cancelled ? "text-faint line-through" : "text-ink"}>
          {day(voucher.period_start)} – {day(voucher.period_end)}
        </span>
        {voucher.remarks && <div className="text-mute">{voucher.remarks}</div>}
        {cancel.isError && <Problem error={cancel.error} className="mt-1" />}
      </Td>
      <Td>
        <Pill tone={cancelled ? "neutral" : "ok"}>
          {cancelled ? "Cancelled" : "Posted"}
        </Pill>
        {cancelled && voucher.cancelled_by && (
          <div className="text-faint">
            {voucher.cancelled_by} · {moment(voucher.cancelled_at)}
          </div>
        )}
      </Td>
      <Td align="right">
        <Amount minor={voucher.profit_minor} warnNegative />
        <div className="text-faint">
          {voucher.profit_minor >= 0 ? "profit" : "loss"}
        </div>
      </Td>
      <Td>
        {voucher.entry_id === null ? (
          <span className="text-faint">Nothing to move</span>
        ) : (
          <AppLink
            to="/finance/accounting/journal-entries"
            sheet={{ key: "entry", value: voucher.entry_id }}
            className="underline underline-offset-2"
          >
            Open entry
          </AppLink>
        )}
        {voucher.reversal_entry_id !== null && (
          <div>
            <AppLink
              to="/finance/accounting/journal-entries"
              sheet={{ key: "entry", value: voucher.reversal_entry_id }}
              className="text-mute underline underline-offset-2"
            >
              Reversal
            </AppLink>
          </div>
        )}
      </Td>
      <Td>
        <span className="text-faint">
          {voucher.created_by} · {moment(voucher.created_at)}
        </span>
      </Td>
      <Td align="right">
        {cancellable && (
          <ConfirmButton
            label="Cancel"
            variant="quiet"
            tone="danger"
            title="Cancel this closing voucher?"
            description={`Its entry is reversed: ${money(Math.abs(voucher.profit_minor))} of ${voucher.profit_minor >= 0 ? "profit" : "loss"} moves back out of retained earnings into ${day(voucher.period_start)} – ${day(voucher.period_end)}. The voucher stays, marked cancelled.`}
            confirmLabel="Reverse it"
            pending={cancel.isPending}
            onConfirm={() => cancel.mutate()}
          />
        )}
      </Td>
    </tr>
  )
}

function CloseRange({ start }: { start: string }) {
  const client = useQueryClient()
  const [from, setFrom] = useState(start)
  const [to, setTo] = useState("")
  const [remarks, setRemarks] = useState("")

  const close = useMutation({
    mutationFn: () =>
      postPeriodClosing({
        period_start: from,
        period_end: to,
        remarks: remarks.trim() === "" ? null : remarks.trim(),
      }),
    onSuccess: () => {
      setRemarks("")
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const ready = from !== "" && to !== "" && from <= to

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="text-card-title font-semibold text-ink">Close a range</h3>
      <p className="text-[0.875rem] text-body">
        Every income and expense account's balance over the range is moved to
        retained earnings, at every site, in one entry dated the last day.
      </p>
      <Problem error={close.error} />
      {close.isSuccess && (
        <Receipt>
          Closed {day(close.data.period_start)} – {day(close.data.period_end)}:{" "}
          {money(Math.abs(close.data.profit_minor))}{" "}
          {close.data.profit_minor >= 0 ? "profit" : "loss"} moved.
        </Receipt>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" required>
          <Day value={from} onChange={setFrom} label="From" />
        </Field>
        <Field label="To" required>
          <Day
            value={to}
            onChange={setTo}
            notBefore={from || null}
            label="To"
          />
        </Field>
      </div>
      <Field label="Remarks">
        <Input
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
        />
      </Field>
      <div className="flex justify-end">
        <ConfirmButton
          label="Close into retained earnings"
          variant="primary"
          disabled={!ready || close.isPending}
          pending={close.isPending}
          title="Close this range?"
          description={`${ready ? `${day(from)} – ${day(to)}` : "The range"}'s profit or loss moves into retained earnings as one posted entry. Only the latest voucher can be cancelled afterwards.`}
          confirmLabel="Close it"
          onConfirm={() => close.mutate()}
        />
      </div>
    </Card>
  )
}
