import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, dateText, day, money, signed } from "@/lib/format"
import {
  accrualsQuery,
  assetDepreciationStatus,
  bankStatementsQuery,
  closePeriod,
  financeKeys,
  girosQuery,
  goodsInTransit,
  openPeriod,
  periodsQuery,
  reopenPeriod,
  stockVsLedger,
  type AccrualRow,
  type GoodsInTransitRow,
  type StockLedgerUnitRow,
} from "@/lib/queries/finance"
import {
  closeReadinessQuery,
  taxPeriodsQuery,
  taxReconciliationQuery,
} from "@/lib/queries/finance-domains"
import { isoDay, monthLabel, todayIso } from "@/screens/finance/chart"
import { Grid, Td, Th } from "@/screens/finance-final/parts"
import type {
  FinanceCloseCheck,
  FiscalPeriod,
  GiroRow,
  TaxPeriod,
} from "@itulah/contract"

/// Closing Periode Akuntansi — the month's checklist read from the shared
/// books, then the periods themselves, as 7Soft's Missing Menu has them.
///
/// Every row is wired to an endpoint that answers it: the store days, the bank
/// statements and the inter-unit nets come from the close readiness the Period
/// Close sheet already asks; depreciation from the asset register's own status;
/// stock against the ledger from the inventory control; the goods in transit
/// from the warehouse; PPN and PPh 23 from the tax periods. A row the cloud
/// cannot answer yet says `—` and is listed in the report rather than drawn
/// with a plausible number.
///
/// The prototype's two sheets this screen is really about — `repME('tax')` and
/// `repME('stock')` — open from their rows, and the tax sheet's four figures
/// are the period's own, never added up in the browser.

type Tab = "check" | "periods"

/// Which checklist row's sheet is open. A row without one is not clickable.
type SheetKind =
  "acc" | "bank" | "depr" | "giro" | "git" | "period" | "stock" | "tax" | "undo"

interface CheckRow {
  readonly key: string
  /// The prototype's own words for the row.
  readonly title: string
  readonly figure: React.ReactNode
  readonly done: boolean
  /// False for a row the cloud cannot answer yet: it is drawn, says `—`, and
  /// is kept out of Done / To do / Blocking rather than counted as work left.
  readonly known: boolean
  /// "Lock October waits on …" names the blocking rows and only them.
  readonly block?: boolean
  readonly tone?: "bad" | "warn"
  readonly sheet?: SheetKind
}

const dash = <span className="text-faint">—</span>

function sum<T>(rows: readonly T[], value: (row: T) => number): number {
  return rows.reduce((total, row) => total + value(row), 0)
}

/// The readiness check behind a row, as three states rather than two: a check
/// nobody can answer is neither done nor open, and drawing it as either is the
/// one lie a closing checklist must not tell.
function stateOf(check: FinanceCloseCheck | undefined) {
  if (check === undefined || check.status === "UNKNOWN")
    return "unknown" as const
  return check.status === "OK" ? "ok" : "open"
}

function checkFigure(
  check: FinanceCloseCheck | undefined,
  doneWord: string,
  openWord: (check: FinanceCloseCheck) => React.ReactNode
): React.ReactNode {
  const state = stateOf(check)
  if (state === "unknown" || check === undefined) return dash
  return state === "ok" ? doneWord : openWord(check)
}

function Tick({ done }: { done: boolean }) {
  return (
    <span
      className={
        done
          ? "flex size-5 shrink-0 items-center justify-center rounded-full border border-ok-fg/40 bg-ok-bg text-ok-fg"
          : "flex size-5 shrink-0 items-center justify-center rounded-full border border-hairline-strong"
      }
      aria-hidden
    >
      {done && <Check className="size-3" strokeWidth={3} />}
    </span>
  )
}

/// The month a period belongs to, as the prototype prints it: "October 2026".
function periodWord(period: Pick<FiscalPeriod, "year" | "month">): string {
  return monthLabel(period.year, period.month)
}

function statusWord(status: string): string {
  const word = status.toUpperCase()
  return word === "OPEN" ? "Open" : word === "CLOSED" ? "Closed" : status
}

export function MonthEnd() {
  const [tab, setTab] = useState<Tab>("check")
  const [sheet, setSheet] = useState<SheetKind | null>(null)
  const [picked, setPicked] = useState<FiscalPeriod | null>(null)
  const [reason, setReason] = useState("")
  // The lock's own receipt: the calendar is refetched, and until it lands the
  // row would still offer the button that was just pressed.
  const [justLocked, setJustLocked] = useState(false)
  const client = useQueryClient()

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const today = todayIso()
  const name = monthLabel(year, month)
  // "October", the word the checklist and the lock row speak.
  const monthWord = name.split(" ")[0] ?? name
  const first = isoDay(new Date(year, month - 1, 1))
  const last = isoDay(new Date(year, month, 0))
  // The tenth of the month after, as the deadline the prototype prints.
  const deadline = new Date(year, month, 10)
  const daysLeft = Math.round(
    (Date.UTC(deadline.getFullYear(), deadline.getMonth(), deadline.getDate()) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      864e5
  )

  const periods = useQuery(periodsQuery())
  const readiness = useQuery(closeReadinessQuery(year, month))
  const statements = useQuery(bankStatementsQuery())
  const giros = useQuery(girosQuery("DUE", 300))
  const accruals = useQuery(accrualsQuery())
  const depreciation = useQuery({
    queryKey: financeKeys.depreciationStatus(year, month),
    queryFn: ({ signal }) => assetDepreciationStatus(year, month, signal),
  })
  const stock = useQuery({
    queryKey: financeKeys.stockVsLedger(),
    queryFn: ({ signal }) => stockVsLedger(signal),
  })
  const transit = useQuery({
    queryKey: financeKeys.goodsInTransit(),
    queryFn: ({ signal }) => goodsInTransit(signal),
  })
  const taxes = useQuery(taxPeriodsQuery())
  const reconciliation = useQuery(taxReconciliationQuery())

  const lock = useMutation({
    mutationFn: () => closePeriod(year, month),
    onSuccess: () => {
      setJustLocked(true)
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })
  const reopen = useMutation({
    mutationFn: (period: FiscalPeriod) =>
      reopenPeriod(period.year, period.month, reason.trim()),
    onSuccess: (page) => {
      client.setQueryData(financeKeys.periods(), page.rows)
      setReason("")
      setSheet(null)
    },
  })

  const check = (code: string) =>
    readiness.data?.checks.find((row) => row.code === code)

  // ── the figures each row stands on ──────────────────────────────────────

  const monthStatements = (statements.data?.rows ?? []).filter(
    (row) =>
      row.superseded_by === null &&
      row.period_start.slice(0, 10) <= last &&
      row.period_end.slice(0, 10) >= first
  )
  const toMatch = sum(monthStatements, (row) =>
    Math.max(0, row.line_count - row.matched_count)
  )
  const dueGiros = giros.data ?? []
  const openAccruals = (accruals.data ?? []).filter(
    (row) => row.status === "OPEN"
  )
  const allAccruals = accruals.data ?? []
  const stockRows: readonly StockLedgerUnitRow[] = stock.data ?? []
  const stockDiff = sum(stockRows, (row) => row.difference_minor)
  const stockOff = stockRows.filter((row) => row.difference_minor !== 0)
  const inTransit: readonly GoodsInTransitRow[] = transit.data ?? []
  const inTransitValue = sum(inTransit, (row) => row.value_minor)
  const monthTaxes = (taxes.data ?? []).filter(
    (row) => row.period_year === year && row.period_month === month
  )
  const amountOf = (row: TaxPeriod) =>
    row.nature.toUpperCase() === "PAYABLE"
      ? row.obligation_minor
      : row.credit_minor
  const named = (needle: string) =>
    monthTaxes.filter((row) => row.tax_type_name.toLowerCase().includes(needle))
  const keluaran = named("keluaran")
  const masukan = named("masukan")
  const pph23 = monthTaxes.filter((row) =>
    /pph\s*(pasal\s*)?23/.test(row.tax_type_name.toLowerCase())
  )
  const ppnOut = sum(keluaran, amountOf)
  const ppnIn = sum(masukan, amountOf)
  const ppnNet = ppnOut - ppnIn
  const pphTotal = sum(pph23, amountOf)
  const taxCheck = check("TAX")
  const taxDone = stateOf(taxCheck) === "ok"

  const accountOf = (row: TaxPeriod): string | null =>
    reconciliation.data?.find(
      (one) =>
        one.tax_type_code === row.tax_type_code &&
        one.period_year === row.period_year &&
        one.period_month === row.period_month
    )?.account_code ?? null

  const done = (rows: readonly CheckRow[]) => rows.filter((row) => row.done)
  const known = (rows: readonly CheckRow[]) => rows.filter((row) => row.known)
  const openRows = (rows: readonly CheckRow[]) =>
    rows.filter((row) => row.known && !row.done)
  const blocking = (rows: readonly CheckRow[]) =>
    rows.filter((row) => row.known && !row.done && row.block === true)

  const rows: CheckRow[] = [
    {
      key: "days",
      title: "Store days posted",
      figure: checkFigure(
        check("SALE_DAYS"),
        "Posted",
        (one) => `${count(one.count)} to post`
      ),
      done: stateOf(check("SALE_DAYS")) === "ok",
      known: stateOf(check("SALE_DAYS")) !== "unknown",
      block: true,
    },
    {
      key: "bank",
      title: "Bank accounts reconciled",
      figure:
        statements.data === undefined || monthStatements.length === 0
          ? dash
          : toMatch === 0
            ? "Reconciled"
            : `${count(toMatch)} to match`,
      done: monthStatements.length > 0 && toMatch === 0,
      known: monthStatements.length > 0,
      block: true,
      sheet: "bank",
    },
    {
      key: "giro",
      title: "Giro checked",
      figure:
        giros.data === undefined
          ? dash
          : dueGiros.length === 0
            ? "Checked"
            : `${count(dueGiros.length)} giro to check`,
      done: giros.data !== undefined && dueGiros.length === 0,
      known: giros.data !== undefined,
      block: true,
      sheet: "giro",
    },
    {
      // 7Soft's simulated match issue is not kept by the cloud: a bill has a
      // status and no match flag, so this row says what the API can say.
      key: "bills",
      title: "Bills matched",
      figure: dash,
      done: false,
      known: false,
      block: true,
    },
    {
      key: "acc",
      title: "Accruals booked",
      figure:
        accruals.data === undefined
          ? dash
          : `${count(allAccruals.length - openAccruals.length)} of ${count(allAccruals.length)} booked`,
      done: accruals.data !== undefined && openAccruals.length === 0,
      known: accruals.data !== undefined,
      sheet: "acc",
    },
    {
      key: "pre",
      title: "Prepaids amortised",
      figure: checkFigure(
        check("PREPAID"),
        "Amortised",
        (one) => `${count(one.count)} to spread`
      ),
      done: stateOf(check("PREPAID")) === "ok",
      known: stateOf(check("PREPAID")) !== "unknown",
    },
    {
      key: "depr",
      title: "Depreciation charged",
      figure:
        depreciation.data === undefined
          ? dash
          : depreciation.data.complete
            ? money(depreciation.data.posted_total_minor)
            : `${count(depreciation.data.missing.length)} missing`,
      done: depreciation.data?.complete === true,
      known: depreciation.data !== undefined,
      sheet: "depr",
    },
    {
      key: "stock",
      title: "Stock vs ledger",
      figure:
        stock.data === undefined
          ? dash
          : stockDiff === 0
            ? "0"
            : signed(stockDiff),
      done: stock.data !== undefined && stockDiff === 0,
      known: stock.data !== undefined && stockRows.length > 0,
      tone: stock.data === undefined || stockDiff === 0 ? undefined : "bad",
      sheet: "stock",
    },
    {
      key: "git",
      title: "Goods in transit",
      figure: transit.data === undefined ? dash : money(inTransitValue),
      done: transit.data !== undefined && inTransit.length === 0,
      known: transit.data !== undefined,
      sheet: "git",
    },
    {
      key: "units",
      title: "Between units",
      figure: checkFigure(
        check("INTERUNIT_NETS"),
        "Balanced",
        (one) => `${count(one.count)} off`
      ),
      done: stateOf(check("INTERUNIT_NETS")) === "ok",
      known: stateOf(check("INTERUNIT_NETS")) !== "unknown",
      tone: stateOf(check("INTERUNIT_NETS")) === "open" ? "bad" : undefined,
      block: true,
    },
    {
      key: "tax",
      title: "PPN and PPh 23 for Coretax",
      figure: taxDone
        ? "Filed"
        : monthTaxes.length === 0
          ? dash
          : `PPN ${money(ppnNet)}`,
      done: taxDone,
      known: taxCheck !== undefined && stateOf(taxCheck) !== "unknown",
      sheet: "tax",
    },
    {
      key: "points",
      title: "Member points liability",
      figure: dash,
      done: false,
      known: false,
    },
  ]

  const period = periods.data?.find(
    (row) => row.year === year && row.month === month
  )
  const locked =
    justLocked || (period !== undefined && statusWord(period.status) !== "Open")
  const stillOpen = openRows(rows)

  // Create Period offers the month after the newest one opened, as the Periods
  // screen does — one calendar, one rule.
  const newest = (periods.data ?? []).reduce(
    (max, row) => Math.max(max, row.year * 12 + row.month),
    0
  )
  const next =
    newest === 0
      ? { year, month }
      : {
          year: Math.floor(newest / 12),
          month: (newest % 12) + 1,
        }
  const create = useMutation({
    mutationFn: () => openPeriod(next.year, next.month),
    onSuccess: (page) => {
      client.setQueryData(financeKeys.periods(), page.rows)
    },
  })

  const closed = (periods.data ?? []).filter(
    (row) => statusWord(row.status) === "Closed"
  )
  const openPeriods = (periods.data ?? []).filter(
    (row) => statusWord(row.status) === "Open"
  )
  const lastClosed = [...closed].sort(
    (a, b) => b.year * 12 + b.month - (a.year * 12 + a.month)
  )[0]

  // ── the period a sheet is about ─────────────────────────────────────────

  const sheetTitle =
    sheet === "tax"
      ? "PPN and PPh 23 for Coretax"
      : sheet === "stock"
        ? "Stock vs ledger"
        : sheet === "git"
          ? "Goods in transit"
          : sheet === "acc"
            ? "Accruals booked"
            : sheet === "depr"
              ? "Depreciation charged"
              : sheet === "giro"
                ? "Giro checked"
                : sheet === "bank"
                  ? "Bank accounts reconciled"
                  : sheet === "undo"
                    ? `Undo closing · ${picked === null ? name : periodWord(picked)}`
                    : picked === null
                      ? name
                      : periodWord(picked)

  const badge =
    sheet === "tax" ? (
      <Status tone={taxDone ? "ok" : "warn"}>
        {taxDone ? "Filed" : "To file"}
      </Status>
    ) : sheet === "stock" ? (
      <Status tone={stockDiff === 0 ? "ok" : "bad"}>
        {stockDiff === 0 ? "Balanced" : `${signed(stockDiff)} off`}
      </Status>
    ) : sheet === "git" ? (
      <Status tone={inTransit.length === 0 ? "ok" : "warn"}>
        {inTransit.length === 0 ? "Clear" : "In transit"}
      </Status>
    ) : sheet === "acc" ? (
      <Status tone={openAccruals.length === 0 ? "ok" : "warn"}>
        {openAccruals.length === 0
          ? "Booked"
          : `${count(openAccruals.length)} to book`}
      </Status>
    ) : sheet === "depr" ? (
      <Status tone={depreciation.data?.complete === true ? "ok" : "warn"}>
        {depreciation.data?.complete === true ? "Posted" : "To charge"}
      </Status>
    ) : sheet === "giro" ? (
      <Status tone={dueGiros.length === 0 ? "ok" : "warn"}>
        {dueGiros.length === 0
          ? "Checked"
          : `${count(dueGiros.length)} to check`}
      </Status>
    ) : sheet === "bank" ? (
      <Status tone={toMatch === 0 ? "ok" : "warn"}>
        {toMatch === 0 ? "Reconciled" : `${count(toMatch)} to match`}
      </Status>
    ) : sheet === "period" && picked !== null ? (
      <Status tone={statusWord(picked.status) === "Open" ? "info" : "neutral"}>
        {statusWord(picked.status)}
      </Status>
    ) : undefined

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Accounting"
        title="Month end"
        actions={
          tab === "periods" ? (
            <Button
              variant="primary"
              pending={create.isPending}
              onClick={() => create.mutate()}
            >
              Create period
            </Button>
          ) : undefined
        }
      />

      <SubTabs
        value={tab}
        onChange={(next) => setTab(next as Tab)}
        tabs={[
          { value: "check", label: `${monthWord} checklist` },
          { value: "periods", label: "Periods" },
        ]}
      />

      {tab === "check" ? (
        <>
          <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
            <Kpi
              label="Done"
              value={`${count(done(rows).length)} of ${count(known(rows).length)}`}
            />
            <Kpi
              label="To do"
              value={count(stillOpen.length - blocking(rows).length)}
            />
            <Kpi label="Blocking" value={count(blocking(rows).length)} />
            <Kpi
              label="Days to deadline"
              value={`${daysLeft} · ${dateText(deadline, {
                day: "numeric",
                month: "short",
              })}`}
            />
          </KpiStrip>

          {stillOpen.length > 0 && !locked && (
            <Banner tone="warn" className="mb-3">
              Lock {monthWord} waits on{" "}
              {stillOpen.map((row) => row.title).join(" · ")}
            </Banner>
          )}
          {readiness.isError && (
            <Banner tone="bad" className="mb-3">
              The close checklist could not be read, so the rows it answers say
              —.
            </Banner>
          )}
          {lock.isError && (
            <Banner tone="bad" className="mb-3">
              {lock.error instanceof Error
                ? lock.error.message
                : "The month could not be locked."}
            </Banner>
          )}

          <Card className="divide-y divide-hairline overflow-clip">
            {rows.map((row) =>
              row.sheet === undefined ? (
                <div
                  key={row.key}
                  className="flex items-center gap-4 px-5 py-3.5"
                >
                  <Tick done={row.done} />
                  <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink">
                    {row.title}
                  </span>
                  <span
                    className={
                      row.done
                        ? "text-[0.9375rem] text-mute tabular-nums"
                        : row.tone === "bad"
                          ? "text-[0.9375rem] text-bad-fg tabular-nums"
                          : "text-[0.9375rem] text-body tabular-nums"
                    }
                  >
                    {row.figure}
                  </span>
                </div>
              ) : (
                <button
                  key={row.key}
                  type="button"
                  className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-soft"
                  onClick={() => setSheet(row.sheet ?? null)}
                >
                  <Tick done={row.done} />
                  <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink">
                    {row.title}
                  </span>
                  <span
                    className={
                      row.done
                        ? "text-[0.9375rem] text-mute tabular-nums"
                        : row.tone === "bad"
                          ? "text-[0.9375rem] text-bad-fg tabular-nums"
                          : "text-[0.9375rem] text-body tabular-nums"
                    }
                  >
                    {row.figure}
                  </span>
                </button>
              )
            )}

            <div className="flex items-center gap-4 px-5 py-3.5">
              <Tick done={locked} />
              <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink">
                Lock {monthWord}
              </span>
              <span className="text-[0.9375rem] text-mute tabular-nums">
                {locked
                  ? `Locked · ${day(period?.closed_at ?? today)}`
                  : stillOpen.length > 0
                    ? `Waits on ${count(stillOpen.length)}`
                    : "Ready"}
              </span>
              {!locked && (
                <Button
                  variant="primary"
                  size="sm"
                  pending={lock.isPending}
                  disabled={stillOpen.length > 0}
                  onClick={() => lock.mutate()}
                >
                  Lock {monthWord}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-4 px-5 py-3.5">
              <span
                className="flex size-5 shrink-0 rounded-full border border-dashed border-hairline-strong"
                aria-hidden
              />
              <span className="min-w-0 flex-1 text-[0.9375rem] text-mute">
                Year end · closes the year into 3013001002 Laba (Rugi) Ditahan
              </span>
              <span className="text-[0.9375rem] text-mute">December only</span>
            </div>
          </Card>
        </>
      ) : (
        <>
          <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
            <Kpi label="Closed" value={count(closed.length)} />
            <Kpi
              label="Open"
              value={
                openPeriods.length === 0
                  ? "—"
                  : openPeriods.map(periodWord).join(" · ")
              }
            />
            <Kpi
              label="Last closed"
              value={lastClosed === undefined ? "—" : periodWord(lastClosed)}
            />
          </KpiStrip>
          {create.isError && (
            <Banner tone="bad" className="mb-3">
              {create.error instanceof Error
                ? create.error.message
                : "The period could not be opened."}
            </Banner>
          )}
          <Card className="overflow-clip">
            {periods.data === undefined ? (
              <EmptyState>Reading the calendar…</EmptyState>
            ) : periods.data.length === 0 ? (
              <EmptyState>No period has been opened yet.</EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th>Period</Th>
                    <Th width="8rem">From</Th>
                    <Th width="8rem">To</Th>
                    <Th width="9rem">Status</Th>
                    <Th width="12rem">Closed by</Th>
                    <Th width="9rem">Closed on</Th>
                    <Th width="10rem" />
                  </tr>
                </thead>
                <tbody>
                  {[...(periods.data ?? [])]
                    .sort(
                      (a, b) => b.year * 12 + b.month - (a.year * 12 + a.month)
                    )
                    .map((row) => {
                      const isClosed = statusWord(row.status) === "Closed"
                      return (
                        <tr
                          key={`${row.year}-${row.month}`}
                          className={
                            isClosed
                              ? "cursor-pointer hover:bg-soft"
                              : undefined
                          }
                          onClick={() => {
                            if (!isClosed) return
                            setPicked(row)
                            setSheet("period")
                          }}
                        >
                          <Td className="font-medium text-ink">
                            {periodWord(row)}
                          </Td>
                          <Td>
                            {day(isoDay(new Date(row.year, row.month - 1, 1)))}
                          </Td>
                          <Td>
                            {day(isoDay(new Date(row.year, row.month, 0)))}
                          </Td>
                          <Td>
                            <Status
                              tone={
                                statusWord(row.status) === "Open"
                                  ? "info"
                                  : "neutral"
                              }
                            >
                              {statusWord(row.status)}
                            </Status>
                          </Td>
                          <Td>{row.closed_by ?? dash}</Td>
                          <Td>
                            {row.closed_at === null ? dash : day(row.closed_at)}
                          </Td>
                          <Td align="right">
                            {lastClosed !== undefined &&
                              lastClosed.year === row.year &&
                              lastClosed.month === row.month && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setPicked(row)
                                    setReason("")
                                    setSheet("undo")
                                  }}
                                >
                                  Undo closing
                                </Button>
                              )}
                          </Td>
                        </tr>
                      )
                    })}
                </tbody>
              </Grid>
            )}
          </Card>
        </>
      )}

      <Sheet
        open={sheet !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSheet(null)
            setReason("")
          }
        }}
        context="Month end"
        title={sheetTitle}
        badge={badge}
        size={sheet === "period" || sheet === "undo" ? "rail" : "wide"}
        footer={
          sheet === "undo" ? (
            <SheetFooter
              onCancel={() => setSheet(null)}
              note="The reason is kept with who asked and when."
              primary={{
                label: "Undo closing",
                pending: reopen.isPending,
                disabled: reason.trim() === "",
                onClick: () => {
                  if (picked !== null) reopen.mutate(picked)
                },
              }}
            />
          ) : undefined
        }
      >
        {(statements.isError ||
          giros.isError ||
          accruals.isError ||
          depreciation.isError ||
          stock.isError ||
          transit.isError ||
          taxes.isError) && (
          <Banner tone="bad" className="mb-4">
            Some of this month's figures could not be read, so the rows that
            stand on them say —.
          </Banner>
        )}

        {sheet === "tax" && (
          <div className="flex flex-col gap-5">
            <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
              <Kpi label="PPN Keluaran" value={money(ppnOut)} />
              <Kpi label="PPN Masukan" value={money(ppnIn)} />
              <Kpi label="PPN to pay" value={money(ppnNet)} />
              <Kpi label="PPh 23 withheld" value={money(pphTotal)} />
            </KpiStrip>
            {monthTaxes.length === 0 ? (
              <EmptyState>
                No tax period has gathered anything for {name} yet.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Line",
                  { label: "Account", align: "left" },
                  "DPP",
                  "Tax",
                ]}
              >
                <tr className="border-t border-hairline bg-soft">
                  <td
                    colSpan={4}
                    className="py-2 pr-2 pl-3 text-[0.9375rem] font-medium text-ink"
                  >
                    PPN Keluaran
                  </td>
                </tr>
                {keluaran.map((row) => (
                  <MiniRow key={`out-${row.period_id}`}>
                    <MiniCell>
                      <span className="text-ink">{row.tax_type_name}</span>
                    </MiniCell>
                    <MiniCell className="text-mute">
                      {accountOf(row) ?? dash}
                    </MiniCell>
                    <MiniCell align="right">{dash}</MiniCell>
                    <MiniCell align="right">{money(amountOf(row))}</MiniCell>
                  </MiniRow>
                ))}

                <tr className="border-t border-hairline bg-soft">
                  <td
                    colSpan={4}
                    className="py-2 pr-2 pl-3 text-[0.9375rem] font-medium text-ink"
                  >
                    PPN Masukan
                  </td>
                </tr>
                {masukan.map((row) => (
                  <MiniRow key={`in-${row.period_id}`}>
                    <MiniCell>
                      <span className="text-ink">{row.tax_type_name}</span>
                    </MiniCell>
                    <MiniCell className="text-mute">
                      {accountOf(row) ?? dash}
                    </MiniCell>
                    <MiniCell align="right">{dash}</MiniCell>
                    <MiniCell align="right">{money(amountOf(row))}</MiniCell>
                  </MiniRow>
                ))}

                <tr className="border-t border-hairline bg-soft">
                  <td
                    colSpan={4}
                    className="py-2 pr-2 pl-3 text-[0.9375rem] font-medium text-ink"
                  >
                    PPh 23 withheld
                  </td>
                </tr>
                {pph23.map((row) => (
                  <MiniRow key={`pph-${row.period_id}`}>
                    <MiniCell>
                      <span className="text-ink">{row.tax_type_name}</span>
                    </MiniCell>
                    <MiniCell className="text-mute">
                      {accountOf(row) ?? dash}
                    </MiniCell>
                    <MiniCell align="right">{dash}</MiniCell>
                    <MiniCell align="right">{money(amountOf(row))}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            )}
          </div>
        )}

        {sheet === "stock" && (
          <div className="flex flex-col gap-4">
            {stockDiff !== 0 && (
              <Banner tone="bad">
                Stock counts {money(Math.abs(stockDiff))}{" "}
                {stockDiff < 0 ? "less" : "more"} than the ledger at{" "}
                {stockOff.map((row) => row.unit_name).join(", ")}. Book
                adjustment posts it to 8010110006.
              </Banner>
            )}
            {stock.data === undefined ? (
              <EmptyState>Reading the stock against the ledger…</EmptyState>
            ) : stockRows.length === 0 ? (
              <EmptyState>No unit holds stock in the ledger.</EmptyState>
            ) : (
              <MiniTable
                head={["Place", "Stock", "Ledger 1011201001", "Difference"]}
              >
                {stockRows.map((row) => (
                  <MiniRow key={row.unit_id}>
                    <MiniCell>{row.unit_name}</MiniCell>
                    <MiniCell align="right">{money(row.stock_minor)}</MiniCell>
                    <MiniCell align="right">{money(row.ledger_minor)}</MiniCell>
                    <MiniCell align="right">
                      {row.difference_minor === 0 ? (
                        <span className="text-mute">0</span>
                      ) : (
                        <span className="text-bad-fg">
                          {signed(row.difference_minor)}
                        </span>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
                <tr className="border-t border-hairline font-medium">
                  <MiniCell>
                    {count(stockRows.length)}{" "}
                    {stockRows.length === 1 ? "place" : "places"}
                  </MiniCell>
                  <MiniCell align="right">
                    {money(sum(stockRows, (row) => row.stock_minor))}
                  </MiniCell>
                  <MiniCell align="right">
                    {money(sum(stockRows, (row) => row.ledger_minor))}
                  </MiniCell>
                  <MiniCell align="right">{signed(stockDiff)}</MiniCell>
                </tr>
              </MiniTable>
            )}
          </div>
        )}

        {sheet === "git" && (
          <div className="flex flex-col gap-4">
            {transit.data === undefined ? (
              <EmptyState>Reading the goods on the road…</EmptyState>
            ) : inTransit.length === 0 ? (
              <EmptyState>Nothing has been sent and left uncounted.</EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Shop",
                  "Surat jalan",
                  "Sent",
                  "Koli",
                  "Account",
                  "Value",
                ]}
              >
                {inTransit.map((row) => (
                  <MiniRow key={row.allotment_line_id}>
                    <MiniCell>{row.destination_name}</MiniCell>
                    <MiniCell>
                      <span className="text-ink">
                        {row.shipment_reference ?? dash}
                      </span>
                    </MiniCell>
                    <MiniCell>
                      {row.dispatched_on === null
                        ? dash
                        : day(row.dispatched_on)}
                    </MiniCell>
                    <MiniCell align="right">{row.koli_number ?? dash}</MiniCell>
                    <MiniCell className="text-mute">{dash}</MiniCell>
                    <MiniCell align="right">{money(row.value_minor)}</MiniCell>
                  </MiniRow>
                ))}
                <tr className="border-t border-hairline font-medium">
                  <MiniCell colSpan={3}>Barang Dalam Perjalanan</MiniCell>
                  <MiniCell align="right">{dash}</MiniCell>
                  <MiniCell>{null}</MiniCell>
                  <MiniCell align="right">{money(inTransitValue)}</MiniCell>
                </tr>
              </MiniTable>
            )}
          </div>
        )}

        {sheet === "acc" && (
          <div className="flex flex-col gap-4">
            {accruals.data === undefined ? (
              <EmptyState>Reading the accruals…</EmptyState>
            ) : allAccruals.length === 0 ? (
              <EmptyState>No accrual has been booked.</EmptyState>
            ) : (
              <MiniTable
                head={["Accrual", "Debit", "Credit", "Amount", "Status"]}
              >
                {allAccruals.map((row: AccrualRow) => (
                  <MiniRow key={row.entry_id}>
                    <MiniCell>
                      <span className="text-ink">
                        {row.memo ?? row.account_name}
                      </span>
                    </MiniCell>
                    <MiniCell className="font-mono text-mute">
                      {row.account_code}
                    </MiniCell>
                    <MiniCell className="font-mono text-mute">
                      {row.invoice_number ?? dash}
                    </MiniCell>
                    <MiniCell align="right">{money(row.amount_minor)}</MiniCell>
                    <MiniCell>
                      {row.status === "OPEN" ? (
                        <Status tone="warn">To book</Status>
                      ) : (
                        <Status tone="ok">Booked</Status>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
                <tr className="border-t border-hairline font-medium">
                  <MiniCell>
                    {count(allAccruals.length)}{" "}
                    {allAccruals.length === 1 ? "accrual" : "accruals"}
                  </MiniCell>
                  <MiniCell>{null}</MiniCell>
                  <MiniCell>{null}</MiniCell>
                  <MiniCell align="right">
                    {money(sum(allAccruals, (row) => row.amount_minor))}
                  </MiniCell>
                  <MiniCell>{null}</MiniCell>
                </tr>
              </MiniTable>
            )}
          </div>
        )}

        {sheet === "depr" && (
          <div className="flex flex-col gap-4">
            {depreciation.data === undefined ? (
              <EmptyState>Reading the run…</EmptyState>
            ) : (
              <>
                <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
                  <Kpi
                    label={`${monthWord} charge`}
                    value={money(depreciation.data.posted_total_minor)}
                  />
                  <Kpi
                    label="Assets charged"
                    value={count(depreciation.data.posted_count)}
                  />
                  <Kpi
                    label="Assets due"
                    value={count(depreciation.data.assets_due)}
                  />
                  <Kpi
                    label="Still waiting"
                    value={count(depreciation.data.missing.length)}
                  />
                </KpiStrip>
                {depreciation.data.missing.length === 0 ? (
                  <EmptyState>
                    Every asset this month concerns has been charged.
                  </EmptyState>
                ) : (
                  <MiniTable head={["Asset", "Category", "Status"]}>
                    {depreciation.data.missing.map((row) => (
                      <MiniRow key={row.asset_id}>
                        <MiniCell>
                          <span className="block text-ink">{row.name}</span>
                          <span className="font-mono text-[0.9375rem] text-mute">
                            {row.asset_number}
                          </span>
                        </MiniCell>
                        <MiniCell className="text-mute">
                          {row.category_code}
                        </MiniCell>
                        <MiniCell>
                          <Status tone="warn">To charge</Status>
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                )}
              </>
            )}
          </div>
        )}

        {sheet === "giro" && (
          <div className="flex flex-col gap-4">
            {giros.data === undefined ? (
              <EmptyState>Reading the giros…</EmptyState>
            ) : dueGiros.length === 0 ? (
              <EmptyState>No giro to check.</EmptyState>
            ) : (
              <MiniTable
                head={["BG", "Supplier", "BKK", "Due", "Amount", "Status"]}
              >
                {dueGiros.map((row: GiroRow) => (
                  <MiniRow key={row.giro_id}>
                    <MiniCell>
                      <span className="text-ink">{row.number}</span>
                    </MiniCell>
                    <MiniCell>{row.party_name ?? dash}</MiniCell>
                    <MiniCell className="font-mono text-mute">
                      {row.cash_document_number ?? dash}
                    </MiniCell>
                    <MiniCell>
                      <span className="text-bad-fg">{day(row.due_date)}</span>
                    </MiniCell>
                    <MiniCell align="right">{money(row.amount_minor)}</MiniCell>
                    <MiniCell>
                      <Status tone={row.status === "REJECTED" ? "bad" : "warn"}>
                        {row.status === "REJECTED" ? "Rejected" : "Due"}
                      </Status>
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            )}
          </div>
        )}

        {sheet === "bank" && (
          <div className="flex flex-col gap-4">
            {statements.data === undefined ? (
              <EmptyState>Reading the statements…</EmptyState>
            ) : monthStatements.length === 0 ? (
              <EmptyState>No bank statement touches {name} yet.</EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Account",
                  "Statement",
                  "Books",
                  "Bank",
                  "To match",
                  "Status",
                ]}
              >
                {monthStatements.map((row) => {
                  const left = row.line_count - row.matched_count
                  return (
                    <MiniRow key={row.statement_id}>
                      <MiniCell>
                        <span className="block text-ink">
                          {row.account_name}
                        </span>
                        <span className="font-mono text-[0.9375rem] text-mute">
                          {row.account_code}
                        </span>
                      </MiniCell>
                      <MiniCell>{day(row.period_end)}</MiniCell>
                      <MiniCell align="right">{dash}</MiniCell>
                      <MiniCell align="right">
                        {money(row.closing_minor)}
                      </MiniCell>
                      <MiniCell align="right">
                        {left === 0 ? dash : count(left)}
                      </MiniCell>
                      <MiniCell>
                        {left === 0 ? (
                          <Status tone="ok">Reconciled</Status>
                        ) : (
                          <Status tone="warn">To match</Status>
                        )}
                      </MiniCell>
                    </MiniRow>
                  )
                })}
              </MiniTable>
            )}
          </div>
        )}

        {sheet === "period" && picked !== null && (
          <Facts>
            <Fact term="From">
              {day(isoDay(new Date(picked.year, picked.month - 1, 1)))}
            </Fact>
            <Fact term="To">
              {day(isoDay(new Date(picked.year, picked.month, 0)))}
            </Fact>
            <Fact term="Closed by">{picked.closed_by ?? "—"}</Fact>
            <Fact term="Closed on">
              {picked.closed_at === null ? "—" : day(picked.closed_at)}
            </Fact>
            <Fact term="Entries posted">{count(picked.entry_count)}</Fact>
          </Facts>
        )}

        {sheet === "undo" && picked !== null && (
          <div className="flex flex-col gap-4">
            <Banner tone="warn">
              {periodWord(picked)} opens again for posting and its closing
              journal is reversed
            </Banner>
            {reopen.isError && (
              <Banner tone="bad">
                {reopen.error instanceof Error
                  ? reopen.error.message
                  : "The closing could not be undone."}
              </Banner>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-[0.9375rem] font-medium text-ink">
                Reason
              </span>
              <Textarea
                rows={3}
                placeholder="Why it must open again"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </div>
        )}
      </Sheet>
    </PageContent>
  )
}
