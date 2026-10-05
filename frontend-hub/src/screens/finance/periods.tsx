import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Select, Textarea } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { FilterPanel } from "@/components/ui/filter-panel"
import { MiniTable } from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Lifecycle } from "@/components/ui/timeline"
import { count, day, label, money, moment, toneFor } from "@/lib/format"
import {
  assetDepreciationStatus,
  closePeriod,
  financeKeys,
  listBankStatements,
  listBills,
  listPeriods,
  openPeriod,
  periodChecklist,
  periodEvents,
  previewDepreciation,
  reopenPeriod,
  runDepreciation,
  trialBalance,
} from "@/lib/queries/finance"
import { useFilters } from "@/lib/filters"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { usePostingReadiness } from "@/screens/finance/badges"
import { isoDay, monthLabel, monthOf } from "@/screens/finance/chart"
import type { DepreciationRun, FiscalPeriod } from "@itulah/contract"

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
/// # Why a sealed month can be reopened
///
/// Sometimes the entry has to go into the month it belongs to, and a correcting
/// entry in an open one is not the same thing. So "Undo closing" exists, with
/// the rules that keep it honest: newest month first, one at a time, and a
/// reason that is kept with who asked and when. The server refuses it while a
/// later month is still sealed or a year-end voucher covers the month; this
/// screen shows that refusal as it is worded rather than keeping its own copy.

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
    meta: { filter: { kind: "option", format: label } },
    cell: ({ row }) => (
      <Status tone={toneFor(row.original.status)}>
        {label(row.original.status)}
      </Status>
    ),
  },
  {
    accessorKey: "entry_count",
    header: "Entries",
    size: 110,
    // `is 0` is the question: a month standing open with nothing in it is
    // either a month nobody has worked yet or one opened by mistake, and both
    // are worth finding before somebody closes the calendar on them.
    meta: { align: "right", filter: { kind: "number", unit: "entries" } },
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
    // A closed set of names, and blank where nobody has sealed it — so "is
    // empty" answers "every month still standing open" from this column too.
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="text-body">{row.original.closed_by ?? "—"}</span>
    ),
  },
  {
    accessorKey: "closed_at",
    header: "Closed at",
    size: 180,
    meta: { filter: { kind: "date" } },
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
    queryFn: ({ signal }) => listPeriods(signal).then((page) => page.rows),
  })

  const rows = useMemo(() => periods.data ?? [], [periods.data])
  const already = rows.some((row) => row.year === year && row.month === month)

  const open = useMutation({
    mutationFn: () => openPeriod(year, month),
    // The server answers with the whole list precisely so the screen does not
    // have to guess what changed, so it is written straight into the cache
    // rather than invalidated and refetched.
    //
    // `page.rows`, not the page. Every reader of this key holds a
    // `FiscalPeriod[]` — `listPeriods` unwraps the envelope before caching it —
    // so writing the envelope here replaced an array with an object, and the
    // next reader to call `.filter` on it threw. `setQueryData` is untyped for
    // this key, so the compiler could not see it and only pressing the button
    // could.
    onSuccess: (page) => {
      client.setQueryData(financeKeys.periods(), page.rows)
      setReceipt(`${monthLabel(year, month)} is open for posting.`)
    },
  })

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: FiscalPeriod) => periodId(row),
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Accounting Masters"
        title="Accounting Period"
        actions={
          <Button
            variant="primary"
            pending={open.isPending}
            disabled={already}
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
        {/* Wrapped for the reason `<UnitSelect>` is: `<Select>` draws a
            `w-full` span around the native control, and in a wrapping toolbar
            that claims the whole row — which is why these two sat on two lines
            with their chevrons out at the edge of the page. */}
        <span className="inline-flex w-40 shrink-0">
          <Select
            value={String(month)}
            onChange={(next) => setMonth(Number(next))}
            aria-label="Month"
            className="h-8 w-40"
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map(
              (value) => (
                <option key={value} value={value}>
                  {monthLabel(year, value)}
                </option>
              )
            )}
          </Select>
        </span>
        <span className="inline-flex w-28 shrink-0">
          <Select
            value={String(year)}
            onChange={(next) => setYear(Number(next))}
            aria-label="Year"
            className="h-8 w-28"
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
        </span>
        {/* The two selects above are not a filter on this list — they name the
            month the button opens. So the panel is the only thing here that
            narrows what is on screen, and it sits beside them rather than
            among them. */}
        <FilterPanel model={filters} table={table} />
        <Toolbar.Spacer />
        {/* The effective answer, like every other toolbar in this module: what
            the two selects add up to, and how much calendar there is. The
            caution that was here — "closing is not undoable" — is now said in
            the sheet where closing actually happens, which is where somebody
            about to do it will read it. */}
        <span className="text-[0.875rem] text-mute">
          {monthLabel(year, month)} · {count(rows.length)} months opened
          {already ? "" : " · this one is not"}
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
                empty="No month matches the filters in force."
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
/// The row summary comes from the same period list the table drew. The cloud's
/// per-period close checklist is fetched separately and gates the seal action.
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
  const [undoing, setUndoing] = useState(false)
  const [reason, setReason] = useState("")
  const [reopened, setReopened] = useState<string | null>(null)

  const periods = useQuery({
    queryKey: financeKeys.periods(),
    queryFn: ({ signal }) => listPeriods(signal).then((page) => page.rows),
    enabled: id !== null,
  })

  const period = periods.data?.find((row) => periodId(row) === id)
  const closeChecks = useQuery({
    queryKey: financeKeys.closeChecklist(id),
    queryFn: ({ signal }) => periodChecklist(id!, signal),
    enabled: id !== null,
  })

  const events = useQuery({
    queryKey: financeKeys.periodEvents(id),
    queryFn: ({ signal }) => periodEvents(id!, signal),
    enabled: id !== null,
  })

  const reopen = useMutation({
    mutationFn: () => reopenPeriod(period!.year, period!.month, reason.trim()),
    onSuccess: () => {
      const name = monthLabel(period!.year, period!.month)
      setUndoing(false)
      setReason("")
      setSealed(null)
      setReopened(
        `${name} is open again. Close it again when the correction is posted.`
      )
      client.invalidateQueries({ queryKey: financeKeys.periods() })
      client.invalidateQueries({ queryKey: financeKeys.closeChecklist(id) })
    },
  })

  const close = useMutation({
    mutationFn: () => closePeriod(period!.year, period!.month),
    onSuccess: (receipt) => {
      setConfirming(false)
      setReopened(null)
      setSealed(receipt.entries_sealed)
      // Sealing does not move a single figure — it only stops new ones being
      // written into the month — so the calendar is the only stale read.
      client.invalidateQueries({ queryKey: financeKeys.periods() })
      client.invalidateQueries({ queryKey: financeKeys.closeChecklist(id) })
    },
  })

  const isOpen = period?.status?.toUpperCase() === "OPEN"
  const mayClose = isOpen && closeChecks.data?.may_close === true
  const mayUndo = !isOpen && reason.trim() !== ""

  function leaveUndo() {
    setUndoing(false)
    setReason("")
    reopen.reset()
  }

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(next) => {
        if (!next) {
          setConfirming(false)
          setSealed(null)
          setReopened(null)
          leaveUndo()
          onClose()
        }
      }}
      id={id ?? undefined}
      title={period ? monthLabel(period.year, period.month) : "Period"}
      footer={
        period && isOpen ? (
          confirming ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[0.875rem] text-body">
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
                  pending={close.isPending}
                  disabled={!mayClose}
                  onClick={() => close.mutate()}
                >
                  {close.isPending ? "Sealing…" : "Seal"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="danger"
              disabled={!mayClose}
              onClick={() => setConfirming(true)}
            >
              Close this month
            </Button>
          )
        ) : period ? (
          undoing ? (
            <div className="flex flex-col gap-3">
              <Textarea
                rows={2}
                autoFocus
                aria-label="Reason for undoing the closing"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <div className="flex justify-end gap-1.5">
                <Button variant="quiet" onClick={leaveUndo}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  pending={reopen.isPending}
                  disabled={!mayUndo}
                  onClick={() => reopen.mutate()}
                >
                  {reopen.isPending ? "Reopening…" : "Undo closing"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setUndoing(true)}>
              Undo closing
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
              {reopened !== null && (
                <Banner tone="ok" onDismiss={() => setReopened(null)}>
                  {reopened}
                </Banner>
              )}
              {reopen.isError && (
                <Banner tone="bad">
                  {reopen.error instanceof Error
                    ? reopen.error.message
                    : "The closing could not be undone."}
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

              {events.data !== undefined && events.data.length > 0 && (
                <div>
                  <h4 className="mb-2 text-card-title font-semibold text-ink">
                    History
                  </h4>
                  <ul className="flex flex-col gap-1.5 text-[0.875rem] text-body">
                    {events.data.map((event) => (
                      <li key={event.event_id}>
                        {event.event === "REOPEN" ? "Reopened" : "Closed"} by{" "}
                        {event.actor} · {moment(event.at)}
                        {event.reason ? ` — ${event.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {isOpen &&
                closeChecks.data !== undefined &&
                !closeChecks.data.may_close && (
                  <Banner tone="warn">
                    Sealing is blocked by:{" "}
                    {closeChecks.data.blocked_by.join(", ")}.
                  </Banner>
                )}

              <Checklist key={periodId(period)} period={period} />

              <p className="text-[0.875rem] text-body">
                {isOpen
                  ? "Closing seals every entry already posted into this month. A close and a posting cannot interleave — the database serialises them — so the number above is the number that will be sealed."
                  : "This month is sealed. If a transaction has to be entered into it after all, Undo closing opens it again — newest month first, one at a time, with a reason that is kept. Otherwise a correction is posted into an open month, the way a wrong entry is answered by its mirror."}
              </p>
            </div>
          ),
      })}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// The month-end checklist
// ---------------------------------------------------------------------------

/// What is worth being true before a month is sealed.
///
/// # What this checklist is responsible for
///
/// This is a readable work summary, not a second close rule. The sheet asks
/// the cloud's period checklist before enabling Close; the same verdict is
/// checked again when the month is sealed.
///
/// This screen adds the asset-specific preview because the accountant needs
/// to inspect the exact monthly charges before posting them.
///
/// # Why these finance reads share their keys
///
/// These reads use the keys their destination screens use, so following a link
/// finds the same answer. Asset readiness and the close verdict are period
/// specific and come from their own cloud endpoints.
function Checklist({ period }: { period: FiscalPeriod }) {
  const client = useQueryClient()
  const [report, setReport] = useState<DepreciationRun | null>(null)
  const [reportKind, setReportKind] = useState<"preview" | "posted">("preview")

  // The month as two dates. `new Date(year, month, 0)` is the last day of
  // `month` on a 1-based month number, which is the one date arithmetic in
  // this file and the one worth naming.
  const first = isoDay(new Date(period.year, period.month - 1, 1))
  const last = isoDay(new Date(period.year, period.month, 0))

  const readiness = usePostingReadiness()
  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal).then((page) => page.rows),
  })
  // Page in the cache, rows selected — the shape every other reader of this
  // key stores. See the same query on Overview.
  const statements = useQuery({
    queryKey: financeKeys.bankStatements(),
    queryFn: ({ signal }) => listBankStatements(signal),
    select: (page) => page.rows,
  })
  const balance = useQuery({
    queryKey: financeKeys.trialBalance(last, null),
    queryFn: ({ signal }) => trialBalance({ as_of: last }, signal),
  })

  const depreciationStatus = useQuery({
    queryKey: financeKeys.depreciationStatus(period.year, period.month),
    queryFn: ({ signal }) =>
      assetDepreciationStatus(period.year, period.month, signal),
  })

  const rehearsal = useMutation({
    mutationFn: () => previewDepreciation(period.year, period.month),
    onSuccess: (run) => {
      setReport(run)
      setReportKind("preview")
    },
  })

  const depreciate = useMutation({
    // The month this sheet is about, not the calendar's. The cloud records
    // every attempt so the close checklist can distinguish "not run" from
    // "ran and had nothing to charge".
    mutationFn: () => runDepreciation(period.year, period.month),
    onSuccess: (run) => {
      setReport(run)
      setReportKind("posted")
      // Refresh the register, the journal, balances and the server's answer
      // about what this month still owes.
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const gaps = readiness.data === undefined ? null : readiness.data.gaps

  const unpostedBills =
    bills.data === undefined
      ? null
      : bills.data.filter(
          (bill) =>
            bill.status.toUpperCase() !== "POSTED" &&
            bill.invoice_date.slice(0, 10) >= first &&
            bill.invoice_date.slice(0, 10) <= last
        ).length

  // Overlap, not containment: a bank's statement period rarely lines up with a
  // calendar month, and a statement running 25 Aug – 24 Sep carries lines that
  // belong to both months. Missing it because it started in the wrong one is
  // exactly the reconciliation nobody notices.
  const openLines =
    statements.data === undefined
      ? null
      : statements.data
          .filter(
            (row) =>
              row.period_start.slice(0, 10) <= last &&
              row.period_end.slice(0, 10) >= first
          )
          .reduce((sum, row) => sum + (row.line_count - row.matched_count), 0)

  return (
    <div>
      <h4 className="mb-2 text-card-title font-semibold text-ink">
        Before sealing {monthLabel(period.year, period.month)}
      </h4>
      <div className="overflow-hidden rounded-inner border border-hairline">
        <Row
          title="Every role reaches an account"
          state={gaps === null ? "pending" : gaps === 0 ? "ok" : "todo"}
          note={
            gaps === null
              ? "Reading the account links…"
              : gaps === 0
                ? "Every role the posting rules ask for resolves to an account, at every unit."
                : `${count(gaps)} role-and-unit combinations have no account. Every posting that needs one is refused.`
          }
          action={
            <AppLink
              to="/finance/setup/posting-readiness"
              variant="quiet"
              size="sm"
            >
              Posting readiness
            </AppLink>
          }
        />

        <Row
          title="Supplier bills posted"
          state={
            unpostedBills === null
              ? "pending"
              : unpostedBills === 0
                ? "ok"
                : "todo"
          }
          note={
            unpostedBills === null
              ? "Reading the bills…"
              : unpostedBills === 0
                ? "Every bill invoiced in this month is in the books."
                : `${count(unpostedBills)} bills invoiced in this month are recorded but not posted. Holding one on purpose is a legitimate answer.`
          }
          action={
            <AppLink to="/finance/payables/bills" variant="quiet" size="sm">
              Supplier bills
            </AppLink>
          }
        />

        <Row
          title="Bank statements agreed"
          state={
            openLines === null ? "pending" : openLines === 0 ? "ok" : "todo"
          }
          note={
            openLines === null
              ? "Reading the statements…"
              : openLines === 0
                ? "Every line on every statement touching this month has been agreed."
                : `${count(openLines)} lines are unagreed on statements whose period overlaps this month — either still in transit, or never booked.`
          }
          action={
            <AppLink
              to="/finance/cash-bank/bank-reconciliation"
              variant="quiet"
              size="sm"
            >
              Bank
            </AppLink>
          }
        />

        <Row
          title="Depreciation charged"
          state={
            depreciationStatus.data === undefined
              ? "pending"
              : depreciationStatus.data.complete
                ? "ok"
                : "todo"
          }
          note={
            depreciationStatus.data === undefined
              ? "Checking the asset register…"
              : depreciationStatus.data.complete
                ? `${count(depreciationStatus.data.posted_count)} of ${count(depreciationStatus.data.assets_due)} due assets are charged (${money(depreciationStatus.data.posted_total_minor)}).`
                : `${count(depreciationStatus.data.missing.length)} of ${count(depreciationStatus.data.assets_due)} due assets are still waiting: ${depreciationStatus.data.missing
                    .slice(0, 3)
                    .map((asset) => asset.asset_number)
                    .join(
                      ", "
                    )}${depreciationStatus.data.missing.length > 3 ? "…" : ""}.`
          }
          action={
            <div className="flex gap-1.5">
              <Button
                variant="quiet"
                size="sm"
                pending={rehearsal.isPending || depreciate.isPending}
                disabled={period.status.toUpperCase() !== "OPEN"}
                onClick={() => rehearsal.mutate()}
              >
                {rehearsal.isPending ? "Previewing…" : "Preview"}
              </Button>
              {reportKind === "preview" &&
                report !== null &&
                report.blocked_count === 0 &&
                report.posted_count > 0 &&
                depreciationStatus.data?.complete === false &&
                period.status.toUpperCase() === "OPEN" && (
                  <Button
                    variant="quiet"
                    size="sm"
                    pending={depreciate.isPending}
                    onClick={() => depreciate.mutate()}
                  >
                    {depreciate.isPending ? "Posting…" : "Post preview"}
                  </Button>
                )}
            </div>
          }
        />

        <Row
          title="Books balance"
          state={
            balance.data === undefined
              ? "pending"
              : balance.data.balanced
                ? "ok"
                : "bad"
          }
          note={
            balance.data === undefined
              ? "Adding up the books…"
              : balance.data.balanced
                ? `Debits and credits both come to ${money(balance.data.total_debit_minor)} as at ${day(last)}.`
                : `Debits ${money(balance.data.total_debit_minor)} against credits ${money(balance.data.total_credit_minor)}. Every entry is checked at COMMIT, so this means something got past the database.`
          }
          action={
            <AppLink
              to="/finance/accounting/general-ledger"
              variant="quiet"
              size="sm"
            >
              Ledger
            </AppLink>
          }
        />
      </div>

      {depreciate.isError && (
        <Banner tone="bad" className="mt-2">
          {depreciate.error instanceof Error
            ? depreciate.error.message
            : "The depreciation run was refused."}
        </Banner>
      )}

      {rehearsal.isError && (
        <Banner tone="bad" className="mt-2">
          {rehearsal.error instanceof Error
            ? rehearsal.error.message
            : "The depreciation preview could not be prepared."}
        </Banner>
      )}

      {report && (
        <div className="mt-3 rounded-inner border border-hairline p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h5 className="text-[0.875rem] font-semibold text-ink">
              {/* The month the run charged, as a month. The server names it
                  by its first day — `2026-09-01` — and printing that raw put
                  an ISO date under a heading nothing else on this screen dates
                  that way. */}
              {reportKind === "preview" ? "Preview · " : "Posted · "}
              {monthOf(report.period_month)}
            </h5>
            {/* The run wrote one journal entry per asset and the report does
                not say which: `DepreciationLine` carries the asset, the charge
                and the reason it was skipped, and no entry id or number. So
                this is a link to the journal and not to the entries — a link
                per line would have to be invented, and an invented link is
                worse than an honest one that lands a step away.
                A second gap sits behind it: the journal's own window is
                component state rather than a search parameter, so this link
                cannot carry the month either. It lands on the journal's
                default window, which is the open period — usually this one. */}
            <AppLink
              to="/finance/accounting/journal-entries"
              className="text-[0.875rem] font-medium text-accent hover:underline"
            >
              Open the journal
            </AppLink>
          </div>
          <p className="mb-2 text-[0.875rem] text-body">
            {reportKind === "preview"
              ? `${count(report.posted_count)} assets can post ${money(report.posted_total_minor)}. ${count(report.skipped_count)} need no entry.${report.blocked_count > 0 ? ` ${count(report.blocked_count)} are blocked; see each asset line for the reason before posting.` : " Review the lines, then post this preview."}`
              : `${count(report.posted_count)} assets posted ${money(report.posted_total_minor)}. ${count(report.skipped_count)} needed no entry.`}
          </p>
          <MiniTable
            head={[
              "Asset",
              { label: reportKind === "preview" ? "Would Post" : "Charge" },
              {
                label:
                  reportKind === "preview" ? "Not Posted" : "Skipped Because",
              },
            ]}
          >
            {report.lines.map((line) => (
              <tr key={line.asset_id} className="border-t border-hairline">
                <td className="py-2 pr-2">
                  <span className="block text-[0.875rem] text-ink">
                    {line.name}
                  </span>
                  <span className="font-mono text-[0.875rem] text-mute">
                    {line.asset_number}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {line.amount_minor === null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    money(line.amount_minor)
                  )}
                </td>
                <td className="py-2 text-right text-[0.875rem] text-body">
                  {line.blocked_because ?? line.skipped_because ?? "—"}
                </td>
              </tr>
            ))}
          </MiniTable>
        </div>
      )}
    </div>
  )
}

/// One line of the checklist.
///
/// `pending` is its own state and never renders as `ok`: "we have not asked
/// yet" and "there is nothing to do" are the two answers a month-end panel
/// must never confuse. `unknown` is the third — a step the server keeps no
/// record of, which is a different thing again from one that has not been
/// checked.
function Row({
  title,
  state,
  note,
  action,
}: {
  title: React.ReactNode
  state: "ok" | "todo" | "bad" | "pending" | "unknown" | "ran"
  note: React.ReactNode
  action: React.ReactNode
}) {
  const status = {
    ok: { tone: "ok" as const, text: "Clear" },
    todo: { tone: "warn" as const, text: "Open" },
    bad: { tone: "bad" as const, text: "Out of balance" },
    pending: { tone: "neutral" as const, text: "Checking…" },
    unknown: { tone: "neutral" as const, text: "Not recorded" },
    ran: { tone: "info" as const, text: "Ran just now" },
  }[state]

  return (
    <div className="flex items-start gap-2.5 border-b border-hairline px-3 py-2.5 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[0.875rem] font-medium text-ink">{title}</span>
          <Status tone={status.tone}>{status.text}</Status>
        </span>
        <span className="mt-0.5 block text-[0.875rem] text-body">{note}</span>
      </span>
      <span className="shrink-0 pt-0.5">{action}</span>
    </div>
  )
}
