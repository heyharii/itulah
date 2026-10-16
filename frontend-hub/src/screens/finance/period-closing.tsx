import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { ConfirmButton } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Fab } from "@/components/ui/fab"
import { Status } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { EmptyState, Problem } from "@/components/ui/states"
import { day, money, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  cancelPeriodClosing,
  financeKeys,
  periodClosingsQuery,
  postPeriodClosing,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { toast } from "@/lib/toast"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Amount } from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"
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
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Opening & Closing"
          title="Period Closing Vouchers"
        >
          Reading the vouchers…
        </ScreenPending>
      }
    >
      <PeriodClosingScreen />
    </Suspense>
  )
}

function PeriodClosingScreen() {
  const phone = useLayout() === "phone"
  /// The form is a sheet: the head's "Close a range" opens it, and on a phone
  /// the dock's + does.
  const [closing, setClosing] = useState(false)
  const list = useSuspenseQuery(periodClosingsQuery())
  const rows = list.data
  const last = lastPosted(rows)
  const lastId = last?.voucher_id

  /// The vouchers, newest range first as the server sends them. On a card the
  /// range names it, the entry it made sits under it, the profit it moved is
  /// the figure and who made it and where it stands are in the foot, with
  /// Cancel on the latest one.
  const columns = useMemo<ColumnDef<TableSetup, PeriodClosingVoucher>[]>(
    () => [
      {
        id: "range",
        accessorFn: (row) => row.period_start,
        header: "Range",
        size: 260,
        enableSorting: false,
        meta: { card: "title", grow: 220 },
        cell: ({ row }) => {
          const cancelled = row.original.status === "CANCELLED"
          return (
            <span className="flex flex-col whitespace-normal">
              <span
                className={cancelled ? "text-faint line-through" : "text-ink"}
              >
                {day(row.original.period_start)} –{" "}
                {day(row.original.period_end)}
              </span>
              {row.original.remarks && (
                <span className="text-[0.9375rem] text-mute">
                  {row.original.remarks}
                </span>
              )}
            </span>
          )
        },
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        size: 200,
        enableSorting: false,
        meta: { card: "foot" },
        cell: ({ row }) => {
          const cancelled = row.original.status === "CANCELLED"
          return (
            <span className="flex flex-col items-start">
              <Status tone={cancelled ? "neutral" : "ok"}>
                {cancelled ? "Cancelled" : "Posted"}
              </Status>
              <span className="text-[0.9375rem] text-mute">
                {cancelled && row.original.cancelled_by
                  ? `${row.original.cancelled_by} · ${moment(row.original.cancelled_at)}`
                  : `${row.original.created_by} · ${moment(row.original.created_at)}`}
              </span>
            </span>
          )
        },
      },
      {
        id: "profit",
        accessorFn: (row) => row.profit_minor,
        header: "Profit moved",
        size: 190,
        enableSorting: false,
        meta: { align: "right", card: "lead" },
        cell: ({ row }) => (
          <span className="flex flex-col items-end">
            <Amount minor={row.original.profit_minor} warnNegative />
            <span className="text-[0.9375rem] text-mute">
              {row.original.profit_minor >= 0 ? "profit" : "loss"}
            </span>
          </span>
        ),
      },
      {
        id: "entry",
        accessorFn: (row) => row.entry_id,
        header: "Entry",
        size: 160,
        enableSorting: false,
        meta: { card: "meta", priority: 2 },
        cell: ({ row }) => (
          <span className="flex flex-col items-start">
            {row.original.entry_id === null ? (
              <span className="text-mute">Nothing to move</span>
            ) : (
              <AppLink
                to="/finance/accounting/journal-entries"
                sheet={{ key: "entry", value: row.original.entry_id }}
                className="underline underline-offset-2"
              >
                Open entry
              </AppLink>
            )}
            {row.original.reversal_entry_id !== null && (
              <AppLink
                to="/finance/accounting/journal-entries"
                sheet={{ key: "entry", value: row.original.reversal_entry_id }}
                className="text-mute underline underline-offset-2"
              >
                Reversal
              </AppLink>
            )}
          </span>
        ),
      },
      {
        id: "cancel",
        accessorFn: (row) => row.voucher_id,
        header: "",
        size: 130,
        enableSorting: false,
        enableHiding: false,
        meta: { align: "right", card: "status" },
        cell: ({ row }) =>
          row.original.voucher_id === lastId ? (
            <CancelVoucher voucher={row.original} />
          ) : null,
      },
    ],
    [lastId]
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: PeriodClosingVoucher) => row.voucher_id,
      }),
      [rows, columns]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Opening & Closing"
        title="Period Closing Vouchers"
        // The one action stands in the head; a phone has the + at the thumb.
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setClosing(true)}>
              Close a range
            </Button>
          )
        }
      />

      {phone && <Fab label="Close a range" onClick={() => setClosing(true)} />}

      <div className="flex flex-col gap-4">
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(list, {
            render: () =>
              rows.length === 0 ? (
                <EmptyState>
                  No range has been closed into retained earnings yet.
                </EmptyState>
              ) : (
                <DataTable<PeriodClosingVoucher>
                  refresh={[list]}
                  table={table}
                  pageScroll
                  cardSort={false}
                  cardsApart
                  cardLead
                />
              ),
          })}
        </Card>

        <CloseRange
          key={last?.voucher_id ?? "first"}
          start={last === undefined ? "" : dayAfter(last.period_end)}
          open={closing}
          onOpenChange={setClosing}
        />
      </div>
    </PageContent>
  )
}

/// Cancel the latest voucher: its entry is reversed, never deleted.
function CancelVoucher({ voucher }: { voucher: PeriodClosingVoucher }) {
  const client = useQueryClient()
  const cancel = useMutation({
    mutationFn: () => cancelPeriodClosing(voucher.voucher_id),
    onSuccess: () => {
      // A reversal moves every balance and both statements.
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })
  return (
    <span className="flex flex-col items-end">
      <ConfirmButton
        label="Cancel"
        variant="quiet"
        size="sm"
        tone="danger"
        title="Cancel this closing voucher?"
        description={`Its entry is reversed: ${money(Math.abs(voucher.profit_minor))} of ${voucher.profit_minor >= 0 ? "profit" : "loss"} moves back out of retained earnings into ${day(voucher.period_start)} – ${day(voucher.period_end)}. The voucher stays, marked cancelled.`}
        confirmLabel="Reverse it"
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
      {cancel.isError && <Problem error={cancel.error} className="mt-1" />}
    </span>
  )
}

function CloseRange({
  start,
  open,
  onOpenChange,
}: {
  start: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
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
    onSuccess: (closed) => {
      setRemarks("")
      onOpenChange(false)
      // The sheet is gone, so the receipt is said here.
      toast.success(
        `Closed ${day(closed.period_start)} – ${day(closed.period_end)}: ${money(Math.abs(closed.profit_minor))} ${closed.profit_minor >= 0 ? "profit" : "loss"} moved.`
      )
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const ready = from !== "" && to !== "" && from <= to

  const fields = (
    <>
      <p className="text-[0.9375rem] text-body">
        Every income and expense account's balance over the range is moved to
        retained earnings, at every site, in one entry dated the last day.
      </p>
      <Problem error={close.error} />
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
    </>
  )
  const submit = (
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
  )

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Close a range"
      size="rail"
      footer={
        <SheetFooter onCancel={() => onOpenChange(false)} primary={submit} />
      }
    >
      <div className="flex flex-col gap-3">{fields}</div>
    </Sheet>
  )
}
