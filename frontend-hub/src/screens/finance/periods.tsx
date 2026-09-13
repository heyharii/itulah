import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Select } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { FilterPanel } from "@/components/ui/filter-panel"
import { MiniTable } from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Lifecycle } from "@/components/ui/timeline"
import { count, day, label, money, moment, toneFor } from "@/lib/format"
import {
  accountMap,
  closePeriod,
  financeKeys,
  listBankStatements,
  listBills,
  listPeriods,
  openPeriod,
  runDepreciation,
  trialBalance,
} from "@/lib/queries/finance"
import { useFilters } from "@/lib/filters"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { accountMapGaps } from "@/screens/finance/badges"
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
    meta: { filter: { kind: "option", format: label } },
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
    onSuccess: (list) => {
      client.setQueryData(financeKeys.periods(), list)
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
        crumb="Finance"
        title="Period close"
        sub="Nothing can be posted into a month that has not been opened, and nothing can be posted into one that has been sealed."
        actions={
          <Button
            variant="primary"
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
        {/* Wrapped for the reason `<LocationSelect>` is: `<Select>` draws a
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
        <span className="text-[0.71875rem] text-mute">
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
    queryFn: ({ signal }) => listPeriods(signal).then((page) => page.rows),
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

              <Checklist period={period} />

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

// ---------------------------------------------------------------------------
// The month-end checklist
// ---------------------------------------------------------------------------

/// What is worth being true before a month is sealed.
///
/// # Why it is a checklist and not a gate
///
/// Nothing here blocks the Close button, and that is deliberate. The server
/// enforces what the server enforces — a month cannot be sealed while an entry
/// is mid-flight, and every entry in it balanced at COMMIT or it would not be
/// there. Everything below is *judgement*: an unposted bill in a month you are
/// closing is usually a mistake and occasionally the right answer, and a
/// browser is not the thing that gets to decide which. So this screen says
/// what it can see and lets a person close the month anyway.
///
/// A client-side gate would also be a lie about where the rules live. The one
/// thing worse than a missing check is a check that somebody trusts and that
/// the server does not share.
///
/// # Why every read here is one somebody else already made
///
/// The four queries are the exact keys the four screens they link to use, so
/// opening this panel warms them and following a link finds its answer in
/// hand. Nothing is counted here that is not counted the same way there.
function Checklist({ period }: { period: FiscalPeriod }) {
  const client = useQueryClient()
  const [report, setReport] = useState<DepreciationRun | null>(null)

  // The month as two dates. `new Date(year, month, 0)` is the last day of
  // `month` on a 1-based month number, which is the one date arithmetic in
  // this file and the one worth naming.
  const first = isoDay(new Date(period.year, period.month - 1, 1))
  const last = isoDay(new Date(period.year, period.month, 0))

  const map = useQuery({
    queryKey: financeKeys.accountMap(null),
    queryFn: ({ signal }) => accountMap(undefined, signal),
  })
  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal),
  })
  const statements = useQuery({
    queryKey: financeKeys.bankStatements(),
    queryFn: ({ signal }) =>
      listBankStatements(signal).then((page) => page.rows),
  })
  const balance = useQuery({
    queryKey: financeKeys.trialBalance(last, null),
    queryFn: ({ signal }) => trialBalance({ as_of: last }, signal),
  })

  const depreciate = useMutation({
    // The month this sheet is about, not the calendar's. The old button on the
    // asset register always charged the current month, which is the wrong one
    // for anybody closing August on the third of September.
    mutationFn: () => runDepreciation(period.year, period.month),
    onSuccess: (run) => {
      setReport(run)
      // A run posts one entry per capitalised asset, so the register, the
      // journal and every balance moved with it.
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const gaps = map.data === undefined ? null : accountMapGaps(map.data).pairs

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
          title="Account map complete"
          state={gaps === null ? "pending" : gaps === 0 ? "ok" : "todo"}
          note={
            gaps === null
              ? "Reading the map…"
              : gaps === 0
                ? "Every meaning the posting rules ask for has an account, at every location."
                : `${count(gaps)} meaning-and-location pairs have no account. Every posting that needs one is refused.`
          }
          action={
            <AppLink to="/finance/account-map" variant="quiet" size="sm">
              Account map
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
            <AppLink to="/finance/bills" variant="quiet" size="sm">
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
            <AppLink to="/finance/bank" variant="quiet" size="sm">
              Bank
            </AppLink>
          }
        />

        <Row
          title="Depreciation charged"
          // Never "done". There is no endpoint that says whether a month's
          // depreciation has run: `AssetRow` carries an accumulated total but
          // not the periods it was built from, and `DepreciationRun` is only
          // ever the answer to a POST — nothing on the node reports a past
          // run. Drawing a tick from a guess would be worse than drawing
          // nothing, so the state stays "not recorded" even immediately after
          // a run, and what is shown instead is that run's own receipt.
          //
          // It is safe to press regardless: a unique index on (asset, period)
          // refuses a second charge, so a repeat reports every asset as
          // already done rather than doubling the month.
          state={report === null ? "unknown" : "ran"}
          note={
            report === null
              ? "Nothing on the server records whether this month has been charged, so this cannot be ticked. Running it twice is safe — the second charge is refused per asset, not doubled."
              : `Charged ${count(report.posted_count)} of ${count(report.posted_count + report.skipped_count)} assets, ${money(report.posted_total_minor)} in total. ${
                  report.skipped_count > 0
                    ? `${count(report.skipped_count)} were skipped, each with a reason.`
                    : "Nothing was skipped."
                }`
          }
          action={
            <Button
              variant="quiet"
              size="sm"
              disabled={depreciate.isPending}
              onClick={() => depreciate.mutate()}
            >
              {depreciate.isPending ? "Charging…" : "Run"}
            </Button>
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
            <AppLink to="/finance/ledger" variant="quiet" size="sm">
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

      {report && (
        <div className="mt-3 rounded-inner border border-hairline p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h5 className="text-[0.78125rem] font-semibold text-ink">
              {/* The month the run charged, as a month. The server names it
                  by its first day — `2026-09-01` — and printing that raw put
                  an ISO date under a heading nothing else on this screen dates
                  that way. */}
              Depreciation · {monthOf(report.period_month)}
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
              to="/finance/journal"
              className="text-[0.71875rem] font-medium text-accent hover:underline"
            >
              Open the journal
            </AppLink>
          </div>
          <MiniTable
            head={["Asset", { label: "Charge" }, { label: "Skipped because" }]}
          >
            {report.lines.map((line) => (
              <tr key={line.asset_id} className="border-t border-hairline">
                <td className="py-2 pr-2">
                  <span className="block text-[0.8125rem] text-ink">
                    {line.name}
                  </span>
                  <span className="font-mono text-[0.65625rem] text-mute">
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
                <td className="py-2 text-right text-[0.71875rem] text-body">
                  {line.skipped_because ?? "—"}
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
  const pill = {
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
          <span className="text-[0.8125rem] font-medium text-ink">{title}</span>
          <Pill tone={pill.tone}>{pill.text}</Pill>
        </span>
        <span className="mt-0.5 block text-[0.71875rem] text-body">{note}</span>
      </span>
      <span className="shrink-0 pt-0.5">{action}</span>
    </div>
  )
}
