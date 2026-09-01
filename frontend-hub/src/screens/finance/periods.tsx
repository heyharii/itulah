import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Select } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Lifecycle } from "@/components/ui/timeline"
import { count, label, moment, toneFor } from "@/lib/format"
import {
  closePeriod,
  financeKeys,
  listPeriods,
  openPeriod,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { monthLabel } from "@/screens/finance/chart"
import type { FiscalPeriod } from "@itulah/contract"

/// Which months are open, and what closing one seals.
///
/// # Why a month has to be opened at all
///
/// Otherwise "post into whatever month the date says" files a mistyped invoice
/// in 2062 and nobody hears about it for four years. The refusal comes from the
/// database and names the month, so this screen never keeps its own copy of the
/// rule — it just makes the state visible.
///
/// # Why closing cannot race a posting
///
/// The gating trigger reads the period row `FOR SHARE`, so a close and a
/// posting serialise. There is no window in which a month closes and a late
/// entry slips in behind it.
///
/// # Why there is no reopen
///
/// Because there is no endpoint for one, and that is the right shape: a sealed
/// month is answered by a correcting entry in an open one, the same way a wrong
/// journal entry is answered by its mirror.

/// `2026-09` — the value the URL carries, and the key a period is addressed by.
function periodId(period: { year: number; month: number }): string {
  return `${period.year}-${String(period.month).padStart(2, "0")}`
}

const columns: ColumnDef<TableSetup, FiscalPeriod>[] = [
  {
    id: "period",
    // A calendar's decision order is its reading order: the month somebody has
    // to act on is almost always the most recent one, so the sort is on the
    // month itself rather than on a derived metric.
    accessorFn: (row) => row.year * 12 + row.month,
    header: "Month",
    size: 200,
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {monthLabel(row.original.year, row.original.month)}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 130,
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.status)}>
        {label(row.original.status)}
      </Pill>
    ),
  },
  {
    accessorKey: "entry_count",
    header: "Entries",
    size: 110,
    meta: { align: "right" },
    // A month with none is a month nobody has worked yet, which is a different
    // thing from a month that balanced — so a zero is drawn as a zero.
    cell: ({ row }) => (
      <span
        className={
          row.original.entry_count === 0 ? "text-mute" : "text-ink tabular-nums"
        }
      >
        {count(row.original.entry_count)}
      </span>
    ),
  },
  {
    accessorKey: "closed_by",
    header: "Closed by",
    size: 160,
    cell: ({ row }) => (
      <span className="text-body">{row.original.closed_by ?? "—"}</span>
    ),
  },
  {
    accessorKey: "closed_at",
    header: "Closed at",
    size: 180,
    cell: ({ row }) => moment(row.original.closed_at),
  },
]

export function Periods() {
  const client = useQueryClient()
  const period = useSheet("period")
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [receipt, setReceipt] = useState<string | null>(null)
  const [sorting, setSorting] = useState<SortingState>([
    { id: "period", desc: true },
  ])

  const periods = useQuery({
    queryKey: financeKeys.periods(),
    queryFn: ({ signal }) => listPeriods(signal),
  })

  const rows = useMemo(() => periods.data ?? [], [periods.data])
  const already = rows.some((row) => row.year === year && row.month === month)

  const open = useMutation({
    mutationFn: () => openPeriod(year, month),
    // The server answers with the whole list precisely so the screen does not
    // have to guess what changed, so it is written straight into the cache
    // rather than invalidated and refetched.
    onSuccess: (list) => {
      client.setQueryData(financeKeys.periods(), list)
      setReceipt(`${monthLabel(year, month)} is open for posting.`)
    },
  })

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: FiscalPeriod) => periodId(row),
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Period close"
        sub="Nothing can be posted into a month that has not been opened, and nothing can be posted into one that has been sealed."
        actions={
          <Button
            variant="dark"
            disabled={already || open.isPending}
            onClick={() => open.mutate()}
          >
            {already
              ? `${monthLabel(year, month)} is open`
              : open.isPending
                ? "Opening…"
                : `Open ${monthLabel(year, month)}`}
          </Button>
        }
      />

      <Toolbar>
        <Select
          value={String(month)}
          onChange={(event) => setMonth(Number(event.target.value))}
          aria-label="Month"
          className="w-40"
        >
          {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>
              {monthLabel(year, value)}
            </option>
          ))}
        </Select>
        <Select
          value={String(year)}
          onChange={(event) => setYear(Number(event.target.value))}
          aria-label="Year"
          className="w-28"
        >
          {Array.from(
            { length: 5 },
            (_, index) => now.getFullYear() - 2 + index
          ).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Toolbar.Spacer />
        <span className="text-[0.71875rem] text-mute">
          Opening a month is safe and undoable by closing it. Closing is not.
        </span>
      </Toolbar>

      {receipt && (
        <Banner tone="ok" className="mb-3" onDismiss={() => setReceipt(null)}>
          {receipt}
        </Banner>
      )}
      {open.isError && (
        <Banner tone="bad" className="mb-3">
          {open.error instanceof Error
            ? open.error.message
            : "The month could not be opened."}
        </Banner>
      )}

      <Card className="overflow-hidden">
        {queryState(periods, {
          loading: "Loading the calendar…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No month has been opened yet, so nothing can be posted at all.
                Open the current one to start the books.
              </EmptyState>
            ) : (
              <DataTable<FiscalPeriod>
                table={table}
                onRowClick={(row) => period.open(periodId(row))}
                isSelected={(row) => periodId(row) === period.value}
                className="max-h-[calc(100vh-20rem)]"
              />
            ),
        })}
      </Card>

      <PeriodSheet id={period.value ?? null} onClose={period.close} />
    </PageContent>
  )
}

/// One month, and the one irreversible thing that can be done to it.
///
/// There is no per-period read on the node, so this selects out of the same
/// list the table drew — the same query key, so it costs nothing and cannot
/// disagree with the row that was clicked.
function PeriodSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [sealed, setSealed] = useState<number | null>(null)

  const periods = useQuery({
    queryKey: financeKeys.periods(),
    queryFn: ({ signal }) => listPeriods(signal),
    enabled: id !== null,
  })

  const period = periods.data?.find((row) => periodId(row) === id)

  const close = useMutation({
    mutationFn: () => closePeriod(period!.year, period!.month),
    onSuccess: (receipt) => {
      setConfirming(false)
      setSealed(receipt.entries_sealed)
      // Sealing does not move a single figure — it only stops new ones being
      // written into the month — so the calendar is the only stale read.
      client.invalidateQueries({ queryKey: financeKeys.periods() })
    },
  })

  const isOpen = period?.status?.toUpperCase() === "OPEN"

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(next) => {
        if (!next) {
          setConfirming(false)
          setSealed(null)
          onClose()
        }
      }}
      id={id ?? undefined}
      title={period ? monthLabel(period.year, period.month) : "Period"}
      footer={
        period && isOpen ? (
          confirming ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[0.71875rem] text-body">
                Seal {count(period.entry_count)}{" "}
                {period.entry_count === 1 ? "entry" : "entries"}? Nothing can be
                posted into this month again.
              </span>
              <div className="flex shrink-0 gap-1.5">
                <Button variant="quiet" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={close.isPending}
                  onClick={() => close.mutate()}
                >
                  {close.isPending ? "Sealing…" : "Seal"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Close this month
            </Button>
          )
        ) : undefined
      }
    >
      {queryState(periods, {
        loading: "Loading the calendar…",
        render: () =>
          period === undefined ? (
            <EmptyState>
              No month is recorded under {id}. It may have been opened in
              another session and this list is from before.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              {sealed !== null && (
                <Banner tone="ok" onDismiss={() => setSealed(null)}>
                  Sealed {count(sealed)} {sealed === 1 ? "entry" : "entries"}.
                  Corrections now go into an open month.
                </Banner>
              )}
              {close.isError && (
                <Banner tone="bad">
                  {close.error instanceof Error
                    ? close.error.message
                    : "The month could not be closed."}
                </Banner>
              )}

              <Lifecycle
                steps={[
                  { label: "Open", state: isOpen ? "current" : "done" },
                  { label: "Sealed", state: isOpen ? "todo" : "current" },
                ]}
              />

              <Facts>
                <Fact term="Status">{label(period.status)}</Fact>
                <Fact term="Entries posted">{count(period.entry_count)}</Fact>
                <Fact term="Closed by">{period.closed_by ?? "—"}</Fact>
                <Fact term="Closed at">{moment(period.closed_at)}</Fact>
              </Facts>

              <p className="text-[0.71875rem] text-body">
                {isOpen
                  ? "Closing seals every entry already posted into this month. A close and a posting cannot interleave — the database serialises them — so the number above is the number that will be sealed."
                  : "This month is sealed. There is no reopen: a correction is posted into an open month, the way a wrong entry is answered by its mirror rather than edited away."}
              </p>
            </div>
          ),
      })}
    </Sheet>
  )
}
