import { useQueries, useQuery } from "@tanstack/react-query"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { CellMoney } from "@/components/ui/rows-switch"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import {
  analyticsKeys,
  dailyReport,
  type DailyReport,
} from "@/lib/queries/analytics"
import {
  accountLedger,
  bankStatementLines,
  financeKeys,
  listBankStatements,
  listCashCounts,
  unitAccounts,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { Grid, Note, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { useSettledWindow } from "@/screens/finance/hooks"
import { SiteSelect, WindowControl } from "@/screens/finance/parts"
import { ReportFilters } from "@/screens/finance/report"
import { ScreenPending } from "@/screens/finance/pending"
import type {
  BankStatementRow,
  CashCountRow,
  GeneralLedger,
  PaymentMethod,
} from "@itulah/contract"

/// The three numbers a shop's trading day produces, and why they disagree.
///
/// 1. What the **till** says was taken, split by tender.
/// 2. What the **drawer** actually held when somebody counted it.
/// 3. What the **bank** says arrived.
///
/// They are three readings of one day and they are almost never equal, which
/// is not a fault — it is the shape of the journey. Cash goes shop → drawer →
/// deposit → bank and can be short at any of those. Card and QRIS go shop →
/// acquirer → bank, a day or more later, **less a fee**, so the amount that
/// lands is by construction not the amount that was taken. A voucher settles a
/// liability and no money moves at all.
///
/// ## Why this is not a matching screen
///
/// The obvious design — pair each sale to a bank line — cannot work and would
/// waste somebody's week proving it. An acquirer sends **one** net settlement
/// against hundreds of till payments, on its own timetable, and the statement
/// line carries the acquirer's narration and nothing that names a receipt. So
/// the model here is the one the chart already has: a **clearing account per
/// kind of money**. The till debits it when the sale happens; the settlement
/// credits it when the bank pays; the fee is its own expense. Whatever is left
/// sitting in that account is exactly *settlements nobody has paid us yet* —
/// one number, checkable, and it needs no pairing at all.
///
/// ## Why the table is ERPNext's, and where ERPNext stops being useful
///
/// The five columns below — mode of payment, opening, expected, closing,
/// difference — are `pos_closing_entry.payment_reconciliation`, field for
/// field. It is the right row shape and it was not worth reinventing.
///
/// What ERPNext does NOT give us is the other half. A POS Closing Entry posts
/// **nothing** to the ledger: its `difference` is computed in the browser,
/// stored on the document, and booked nowhere, and there is no over/short
/// account anywhere in the product. So a shop can be short every night for a
/// year and the books will never say so. Ours does have somewhere to put it —
/// the meaning `cash_variance`, posted by `POST /finance/cash-counts/{id}/post`
/// — and this screen says out loud whether that meaning has been pointed at an
/// account here, because until it has, a short drawer can be observed and
/// cannot be booked.
export function SalesReconciliation() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Receivables"
          title="Sales Reconciliation"
        >
          Reading the calendar…
        </ScreenPending>
      }
    >
      <SalesReconciliationScreen />
    </Suspense>
  )
}

function SalesReconciliationScreen() {
  const range = useSettledWindow()
  // The shop is a SITE — the till and the drawer are the premises' — and
  // its books, bank statements included, are the unit's that owns it. Each
  // read below is asked with the one it takes.
  const [site, setSite] = useState("")
  const scoped = site !== ""
  const register = useUnits()
  const unit =
    register.data?.find((one) => one.sites.some((s) => s.id === site))?.id ?? ""
  // What each role resolves to in that unit's books, as the server resolves
  // it.
  const map = useQuery({
    queryKey: financeKeys.unitAccounts(unit),
    queryFn: ({ signal }) => unitAccounts(unit, signal),
    enabled: unit !== "",
    staleTime: 5 * 60 * 1000,
  })

  const dates = useMemo(
    () => datesIn(range.from, range.to),
    [range.from, range.to]
  )
  // The till's day-by-day answer costs one request per day. Past this the
  // reader is asking for a year and wants a balance, not a calendar.
  const tooWide = dates.length > DAY_LIMIT

  // ---- 1. What the till said ---------------------------------------------
  //
  // One `/reports/sales/daily` per date, each narrowed by the server to this
  // unit and this business day. Under the keys the Sales screen already owns,
  // so a reader arriving from there pays for none of it twice — and the two
  // screens cannot print different takings for the same day.
  const till = useTill(site, scoped && !tooWide ? dates : [])

  // ---- 2. What the drawer held -------------------------------------------
  const counts = useQuery({
    queryKey: financeKeys.cashCounts(null, site),
    queryFn: ({ signal }) => listCashCounts(signal, { site }),
    enabled: scoped,
    staleTime: 60_000,
  })

  // ---- 3. What the bank said ---------------------------------------------
  //
  // The unit's imports, narrowed by the server under the key that carries the
  // unit. What is narrowed here is only *which statement to open*; every
  // figure below comes from that statement's own lines, addressed by id.
  const statements = useQuery({
    queryKey: financeKeys.bankStatements(unit),
    queryFn: ({ signal }) => listBankStatements(signal, { unit }),
    enabled: unit !== "",
    staleTime: 60_000,
  })

  const imports = useMemo(
    () => statementsFor(statements.data?.rows, unit, range.from, range.to),
    [statements.data, unit, range.from, range.to]
  )

  const lines = useQueries({
    queries: imports.kept.map((statement) => ({
      queryKey: financeKeys.bankLines(statement.statement_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        bankStatementLines(statement.statement_id, signal),
      staleTime: 60_000,
    })),
    combine: (results) => ({
      rows: results.flatMap((result) => result.data ?? []),
      pending: results.some((result) => result.isPending),
      error: results.find((result) => result.isError)?.error ?? null,
    }),
  })

  // ---- What the books say, for the accounts this screen is about ---------
  //
  // Read by MEANING and never by account code: the client's chart puts the
  // unit inside the code — `101100100103` is cash at store 03 — and a screen
  // that built such a code itself would be guessing at somebody else's chart.
  // The account links are the only thing entitled to that answer.
  const meanings = useMemo(() => {
    const at = (key: string) =>
      (map.data ?? [])
        .filter((row) => row.role === key)
        .map((row) => row.account_code)
    return {
      drawer: at(DRAWER_MEANING),
      card: CARD_MEANINGS.flatMap(at),
      fee: at(FEE_MEANING),
      variance: at(VARIANCE_MEANING),
    }
  }, [map.data])

  const codes = useMemo(
    () => [...meanings.drawer, ...meanings.card, ...meanings.fee],
    [meanings]
  )

  const ledgers = useQueries({
    queries: (unit !== "" ? codes : []).map((code) => ({
      queryKey: financeKeys.ledger(code, unit, range.from, range.to),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        accountLedger(
          code,
          // The same generous limit the sibling screens send under this key.
          // The three figures this screen wants — opening, closing and what
          // moved — are properties of the WINDOW and are unmoved by paging,
          // but a one-row answer cached here would be read as a whole ledger
          // by the next screen to ask.
          { unit, from: range.from, to: range.to, limit: 500 },
          signal
        ),
      staleTime: 60_000,
    })),
    combine: (results) => ({
      books: new Map(
        results.flatMap((result) =>
          result.data === undefined
            ? []
            : [[result.data.account_code, result.data] as const]
        )
      ),
      pending: results.some((result) => result.isPending),
      error: results.find((result) => result.isError)?.error ?? null,
    }),
  })

  // ---- Everything the page stands on, as one claim ------------------------
  //
  // One loading state and one error state across all four reads. A page that
  // drew the till's side while the bank's was still in flight would say
  // "nothing arrived" about a statement it had not opened yet.
  const pending =
    (scoped && (register.isPending || map.isPending)) ||
    till.pending ||
    counts.isPending ||
    statements.isPending ||
    lines.pending ||
    ledgers.pending
  const failure =
    register.error ??
    map.error ??
    till.error ??
    counts.error ??
    statements.error ??
    lines.error ??
    ledgers.error ??
    null

  const takings = useMemo(() => addUp(till.days), [till.days])

  const counted = useMemo(
    () =>
      (counts.data ?? [])
        .filter(
          (row) => row.counted_on >= range.from && row.counted_on <= range.to
        )
        // Newest first. The server already answers in that order; sorting here
        // means the screen does not depend on it staying that way.
        .sort((a, b) => (a.counted_on < b.counted_on ? 1 : -1)),
    [counts.data, range.from, range.to]
  )

  const bank = useMemo(
    () =>
      lines.rows.filter(
        (row) => row.value_date >= range.from && row.value_date <= range.to
      ),
    [lines.rows, range.from, range.to]
  )

  const books = {
    drawer: combined(meanings.drawer, ledgers.books),
    card: combined(meanings.card, ledgers.books),
    fee: combined(meanings.fee, ledgers.books),
  }

  const bankIn = bank.reduce((sum, row) => sum + row.credit_minor, 0)
  const bankOut = bank.reduce((sum, row) => sum + row.debit_minor, 0)

  return (
    <PageContent>
      <PageHeader crumb="Finance · Receivables" title="Sales Reconciliation" />

      {/* The scope — which store and which days — stands under the head, with
          what is on screen said at its end. A reconciliation is one store's, so
          the store is asked for here; with none chosen the body says why. */}
      <ReportFilters note={scoped ? range.chip : undefined}>
        <SiteSelect
          value={site}
          onChange={setSite}
          emptyLabel="Choose a store"
          className="h-8 w-44"
        />
        <WindowControl range={range} />
      </ReportFilters>

      {!scoped ? (
        <EmptyState>Choose a store.</EmptyState>
      ) : failure !== null ? (
        <ErrorState error={failure} />
      ) : tooWide ? (
        <Note>Choose {DAY_LIMIT} days or fewer.</Note>
      ) : pending ? (
        <LoadingState>
          Reading the till, the drawer, the bank and the books…
        </LoadingState>
      ) : (
        <div className="flex flex-col gap-5">
          <KpiStrip className="mb-0 grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
            <Kpi
              label="Taken"
              value={money(takings.gross)}
              delta={`${count(takings.sales)} sales, till`}
              tone="flat"
            />
            <div title="Tendered, less change and cash refunds">
              <Kpi
                label="Cash into the drawer"
                value={money(takings.cashExpected)}
              />
            </div>
            <Kpi
              label="Owed by the acquirer"
              value={
                <span
                  className={
                    books.card !== null &&
                    books.card.closing_minor === 0 &&
                    cardAndQris(takings) > 0
                      ? "text-bad-fg"
                      : undefined
                  }
                >
                  {books.card === null ? "—" : money(books.card.closing_minor)}
                </span>
              }
              delta={
                books.card === null
                  ? "No card clearing account here"
                  : `Clearing balance at ${day(range.to)}`
              }
              tone="flat"
            />
            <Kpi
              label="Credited by the bank"
              // Absent, not zero. No statement imported and a month in which
              // nothing arrived are different facts and must not render the
              // same — that distinction is the whole reason this module draws
              // a dash.
              value={imports.kept.length === 0 ? "—" : money(bankIn)}
              delta={
                imports.kept.length === 0
                  ? "No statement covers this span"
                  : `${count(bank.length)} lines, ${money(bankOut)} out`
              }
              tone="flat"
            />
          </KpiStrip>

          {/* ── The POS Closing Entry, as a table ─────────────────────────
              Five columns, in ERPNext's order and with its words, because the
              shape of the question is the same one every till in the world
              asks: what was there to start with, what should have been added,
              what was actually there, and how far apart are those. Two of our
              own follow them — what the till took in the span, so a reader can
              check that expected really is opening plus takings, and what this
              screen can honestly say about the gap. */}
          <section className="flex flex-col gap-2">
            <h2 className="text-[0.9375rem] font-semibold text-ink">
              By mode of payment
            </h2>
            <Grid followRows giveUp={[7]}>
              <thead>
                <tr>
                  <Th width="8rem">Mode of payment</Th>
                  <Th align="right" width="9rem">
                    Opening amount
                  </Th>
                  <Th align="right" width="9rem">
                    Expected amount
                  </Th>
                  <Th align="right" width="9rem">
                    Closing amount
                  </Th>
                  <Th align="right" width="9rem">
                    Difference
                  </Th>
                  <Th align="right" width="9rem">
                    Taken in the span
                  </Th>
                  <Th>Standing</Th>
                </tr>
              </thead>
              <tbody>
                {tenderRows({ takings, counted, books, meanings, till }).map(
                  (row) => (
                    <tr key={row.method}>
                      <Td>
                        <span className="font-medium text-ink">
                          {row.label}
                        </span>
                      </Td>
                      <Td align="right">
                        <Amount cell minor={row.opening} />
                      </Td>
                      <Td align="right">
                        <Amount cell minor={row.expected} />
                      </Td>
                      <Td align="right">
                        <Amount cell minor={row.closing} />
                      </Td>
                      <Td align="right">
                        <span
                          className={
                            row.difference !== null && row.difference !== 0
                              ? "font-medium text-bad-fg"
                              : undefined
                          }
                        >
                          <Amount cell minor={row.difference} />
                        </span>
                      </Td>
                      <Td align="right">
                        <Amount cell minor={row.taken} />
                      </Td>
                      <Td>
                        <span className="flex flex-col gap-1">
                          <Pill tone={row.standing.tone}>
                            {row.standing.label}
                          </Pill>
                          <span className="text-[0.9375rem] text-mute">
                            {row.standing.why}
                          </span>
                        </span>
                      </Td>
                    </tr>
                  )
                )}
                <TotalRow>
                  <Td>All tenders</Td>
                  <Td align="right">
                    <Amount minor={openingOf(books)} />
                  </Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td align="right">{money(takings.tendered)}</Td>
                  <Td />
                </TotalRow>
              </tbody>
            </Grid>
          </section>

          {/* ── The three numbers, day by day ────────────────────────────── */}
          <section className="flex flex-col gap-2">
            <h2 className="text-[0.9375rem] font-semibold text-ink">
              Day by day
            </h2>
            <Grid followRows>
              <thead>
                <tr>
                  <Th width="7.5rem">Date</Th>
                  <Th align="right" width="8.5rem">
                    Taken
                  </Th>
                  <Th align="right" width="8.5rem">
                    Cash of it
                  </Th>
                  <Th align="right" width="9rem">
                    Card &amp; QRIS of it
                  </Th>
                  <Th align="right" width="9rem">
                    Drawer counted
                  </Th>
                  <Th align="right" width="9rem">
                    Drawer vs books
                  </Th>
                  <Th align="right" width="8.5rem">
                    Bank in
                  </Th>
                  <Th align="right" width="8.5rem">
                    Bank out
                  </Th>
                </tr>
              </thead>
              <tbody>
                {till.days.map((report) => {
                  const onThisDay = counted.filter(
                    (row) => row.counted_on === report.date
                  )
                  const credited = bank.filter(
                    (row) => row.value_date === report.date
                  )
                  const variance = onThisDay.reduce(
                    (sum, row) => sum + row.variance_minor,
                    0
                  )
                  return (
                    <tr key={report.date}>
                      <Td>{day(report.date)}</Td>
                      <Td align="right">
                        <Amount cell minor={report.sales.gross_minor} />
                      </Td>
                      <Td align="right">
                        <Amount cell minor={report.cash.cash_expected_minor} />
                      </Td>
                      <Td align="right">
                        <Amount cell minor={cardAndQrisOn(report)} />
                      </Td>
                      <Td align="right">
                        {/* Nobody counted is not "nothing was there". */}
                        <Amount
                          cell
                          minor={
                            onThisDay.length === 0
                              ? null
                              : onThisDay.reduce(
                                  (sum, row) => sum + row.counted_minor,
                                  0
                                )
                          }
                        />
                      </Td>
                      <Td align="right">
                        {onThisDay.length === 0 ? (
                          <Amount cell minor={null} />
                        ) : (
                          <span
                            className={
                              variance === 0
                                ? undefined
                                : "font-medium text-bad-fg"
                            }
                          >
                            <CellMoney minor={variance} />
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        <Amount
                          cell
                          minor={
                            imports.kept.length === 0
                              ? null
                              : credited.reduce(
                                  (sum, row) => sum + row.credit_minor,
                                  0
                                )
                          }
                        />
                      </Td>
                      <Td align="right">
                        <Amount
                          cell
                          minor={
                            imports.kept.length === 0
                              ? null
                              : credited.reduce(
                                  (sum, row) => sum + row.debit_minor,
                                  0
                                )
                          }
                        />
                      </Td>
                    </tr>
                  )
                })}
                <TotalRow>
                  <Td>Whole span</Td>
                  <Td align="right">{money(takings.gross)}</Td>
                  <Td align="right">{money(takings.cashExpected)}</Td>
                  <Td align="right">{money(cardAndQris(takings))}</Td>
                  <Td align="right">
                    <Amount
                      minor={
                        counted.length === 0
                          ? null
                          : counted.reduce(
                              (sum, row) => sum + row.counted_minor,
                              0
                            )
                      }
                    />
                  </Td>
                  <Td align="right">
                    <Amount
                      minor={
                        counted.length === 0
                          ? null
                          : counted.reduce(
                              (sum, row) => sum + row.variance_minor,
                              0
                            )
                      }
                    />
                  </Td>
                  <Td align="right">
                    <Amount minor={imports.kept.length === 0 ? null : bankIn} />
                  </Td>
                  <Td align="right">
                    <Amount
                      minor={imports.kept.length === 0 ? null : bankOut}
                    />
                  </Td>
                </TotalRow>
              </tbody>
            </Grid>
          </section>

          {/* ── The differences, named ───────────────────────────────────── */}
          <section className="flex flex-col gap-2">
            <h2 className="text-[0.9375rem] font-semibold text-ink">
              The differences, named
            </h2>
            <Grid followRows>
              <thead>
                <tr>
                  <Th>Difference</Th>
                  <Th align="right" width="10rem">
                    Amount
                  </Th>
                  <Th width="11rem">Standing</Th>
                  <Th>Why</Th>
                </tr>
              </thead>
              <tbody>
                {differences({
                  takings,
                  counted,
                  books,
                  meanings,
                  bankIn,
                  imported: imports.kept.length > 0,
                  to: range.to,
                }).map((row) => (
                  <tr key={row.name}>
                    <Td>
                      <span className="font-medium text-ink">{row.name}</span>
                    </Td>
                    <Td align="right">
                      <span
                        className={
                          row.standing.tone === "bad"
                            ? "font-medium text-bad-fg"
                            : undefined
                        }
                      >
                        <Amount cell minor={row.amount} />
                      </span>
                    </Td>
                    <Td>
                      <Pill tone={row.standing.tone}>{row.standing.label}</Pill>
                    </Td>
                    <Td className="text-[0.9375rem] text-body in-[.grid-compact]:whitespace-normal">
                      {row.standing.why}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Grid>
          </section>

          {imports.dropped > 0 && (
            <Note>
              {count(imports.dropped)} older import
              {imports.dropped === 1 ? " was" : "s were"} left out: the same
              account and period was loaded more than once.
            </Note>
          )}
        </div>
      )}
    </PageContent>
  )
}

/// How wide a span may be before the day-by-day reading stops being drawn.
const DAY_LIMIT = 62

/// The meanings this screen reads, named rather than coded.
///
/// `cash_variance` is here and is not in the account map's `required_keys`,
/// which is the gap this screen reports: the posting rules never demand it, so
/// nobody is ever prompted to map it, and the first person to try to book a
/// short drawer meets a refusal instead of a form.
const DRAWER_MEANING = "cash"
const CARD_MEANINGS = ["card_receivable_credit", "card_receivable_debit"]
const FEE_MEANING = "card_fee"
const VARIANCE_MEANING = "cash_variance"

/// The kinds of money a till can take. The server's own closed list — ours,
/// from `tender.rs` — and deliberately not ERPNext's Mode of Payment, which is
/// a user-maintained doctype with as many rows as somebody has typed.
const TENDERS: readonly {
  readonly method: PaymentMethod
  readonly label: string
}[] = [
  { method: "CASH", label: "Cash" },
  { method: "CARD", label: "Card" },
  { method: "QRIS", label: "QRIS" },
  { method: "EWALLET", label: "E-wallet" },
  { method: "VOUCHER", label: "Voucher" },
  { method: "BENEFIT", label: "Employee benefit" },
  { method: "OTHER", label: "Other" },
]

/// What this screen can honestly say about one gap.
interface Standing {
  readonly tone: "ok" | "warn" | "bad" | "neutral"
  readonly label: string
  readonly why: string
}

/// One `/reports/sales/daily` per date, each narrowed by the server.
function useTill(site: string, dates: readonly string[]) {
  return useQueries({
    queries: dates.map((date) => ({
      queryKey: analyticsKeys.daily(site, date),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        dailyReport({ siteId: site, date }, signal),
      staleTime: 60_000,
    })),
    combine: (results) => ({
      days: results.flatMap((result) =>
        result.data === undefined ? [] : [result.data]
      ),
      // A half-answered span is a wrong total, so nothing is drawn until every
      // day has come back.
      pending: results.some((result) => result.isPending),
      error: results.find((result) => result.isError)?.error ?? null,
    }),
  })
}

/// What the till took over the whole span.
function addUp(days: readonly DailyReport[]) {
  const byTender: Record<string, number> = {}
  let sales = 0
  let gross = 0
  let cashExpected = 0
  let refunds = 0
  for (const report of days) {
    sales += report.sales.count
    gross += report.sales.gross_minor
    cashExpected += report.cash.cash_expected_minor
    refunds += report.returns.refund_total_minor
    for (const tender of report.tenders) {
      byTender[tender.method] =
        (byTender[tender.method] ?? 0) + tender.amount_minor
    }
  }
  return {
    sales,
    gross,
    cashExpected,
    refunds,
    byTender,
    tendered: Object.values(byTender).reduce((a, b) => a + b, 0),
  }
}

type Takings = ReturnType<typeof addUp>

function cardAndQris(takings: Takings): number {
  return (
    (takings.byTender.CARD ?? 0) +
    (takings.byTender.QRIS ?? 0) +
    (takings.byTender.EWALLET ?? 0)
  )
}

function cardAndQrisOn(report: DailyReport): number {
  return report.tenders
    .filter(
      (tender) =>
        tender.method === "CARD" ||
        tender.method === "QRIS" ||
        tender.method === "EWALLET"
    )
    .reduce((sum, tender) => sum + tender.amount_minor, 0)
}

/// Several accounts read as one.
///
/// The chart splits card receivables into credit and debit, because that is
/// how the client's accountant thinks about them. The till does not know the
/// difference — `PaymentMethod::Card` is one bucket — so the two accounts are
/// added before they are compared with anything the till said. Null, not zero,
/// when the meaning is mapped to nothing here: an unmapped account is a
/// question nobody has answered, and a balance of nothing is an answer.
function combined(
  codes: readonly string[],
  books: ReadonlyMap<string, GeneralLedger>
): {
  opening_minor: number
  closing_minor: number
  window_debit_minor: number
  window_credit_minor: number
} | null {
  const found = codes.flatMap((code) => {
    const ledger = books.get(code)
    return ledger === undefined ? [] : [ledger]
  })
  if (found.length === 0) return null
  return {
    opening_minor: found.reduce((sum, one) => sum + one.opening_minor, 0),
    closing_minor: found.reduce((sum, one) => sum + one.closing_minor, 0),
    window_debit_minor: found.reduce(
      (sum, one) => sum + one.window_debit_minor,
      0
    ),
    window_credit_minor: found.reduce(
      (sum, one) => sum + one.window_credit_minor,
      0
    ),
  }
}

type Books = {
  drawer: ReturnType<typeof combined>
  card: ReturnType<typeof combined>
  fee: ReturnType<typeof combined>
}

type Meanings = {
  drawer: readonly string[]
  card: readonly string[]
  fee: readonly string[]
  variance: readonly string[]
}

/// The five ERPNext columns, filled in from what we actually hold.
function tenderRows(input: {
  takings: Takings
  counted: readonly CashCountRow[]
  books: Books
  meanings: Meanings
  till: { days: readonly DailyReport[] }
}): readonly {
  method: PaymentMethod
  label: string
  opening: number | null
  expected: number | null
  closing: number | null
  difference: number | null
  taken: number
  standing: Standing
}[] {
  const { takings, counted, books, meanings, till } = input

  // The last count of the DRAWER in this span, which is the only one whose
  // "closing amount" means anything: a count of petty cash is a count of a
  // different pot with a different job, and holding it against the day's
  // takings would be comparing a shop's float to its sales.
  const lastCount =
    counted.find((row) => meanings.drawer.includes(row.account_code)) ?? null

  // Expected is measured to the MOMENT OF THE COUNT, not to the end of the
  // window. A drawer counted on the second, in a span that runs to the
  // thirtieth, owes nothing for the twenty-eight days after it.
  const cashTo =
    lastCount === null
      ? takings.cashExpected
      : till.days
          .filter((report) => report.date <= lastCount.counted_on)
          .reduce((sum, report) => sum + report.cash.cash_expected_minor, 0)

  const cashOpening = books.drawer?.opening_minor ?? null
  const cashExpected = cashOpening === null ? null : cashOpening + cashTo
  const cashClosing = lastCount?.counted_minor ?? null
  const cashDifference =
    cashClosing === null || cashExpected === null
      ? null
      : cashClosing - cashExpected

  const cardOpening = books.card?.opening_minor ?? null
  const cardTaken = takings.byTender.CARD ?? 0

  return TENDERS.map((tender) => {
    const taken = takings.byTender[tender.method] ?? 0
    switch (tender.method) {
      case "CASH":
        return {
          ...tender,
          opening: cashOpening,
          expected: cashExpected,
          closing: cashClosing,
          difference: cashDifference,
          taken,
          standing: cashStanding(meanings, lastCount, cashDifference),
        }
      case "CARD":
        return {
          ...tender,
          opening: cardOpening,
          expected: cardOpening === null ? null : cardOpening + cardTaken,
          // Nobody counts an acquirer. The observation that would go here is
          // the settlement the bank received, and no line on a statement says
          // which takings it settles.
          closing: null,
          difference: null,
          taken,
          standing:
            cardOpening === null
              ? {
                  tone: "bad",
                  label: "No clearing account",
                  why: "Neither card receivable is mapped here",
                }
              : {
                  tone: "warn",
                  label: "No settlement report",
                  why: "The bank's credits are not labelled by acquirer",
                },
        }
      case "QRIS":
      case "EWALLET":
        return {
          ...tender,
          // QRIS shares the debit-card clearing account. Showing the shared
          // opening balance here as well would double-count it beside CARD.
          opening: null,
          expected: null,
          closing: null,
          difference: null,
          taken,
          standing: {
            tone: taken === 0 ? "neutral" : "warn",
            label: "Debit-card account",
            why: `${tender.label} is posted to the shared Piutang Debit Card account; acquirer detail stays in the settlement ledger`,
          },
        }
      case "VOUCHER":
        return {
          ...tender,
          opening: null,
          expected: null,
          closing: null,
          difference: null,
          taken,
          standing: {
            tone: "neutral",
            label: "No money arrives",
            why: "The money came in when the voucher was sold; this settles that liability",
          },
        }
      default:
        return {
          ...tender,
          opening: null,
          expected: null,
          closing: null,
          difference: null,
          taken,
          standing: {
            tone: taken === 0 ? "neutral" : "warn",
            label: "Unsaid",
            why: "The till has no transfer tender; whatever this was, it did not say",
          },
        }
    }
  })
}

/// What the cash row's difference actually is, said carefully.
///
/// The difference in the table is `counted − expected`, and expected is the
/// books' opening plus what the till says it took. So it holds TWO gaps at
/// once: the drawer against the books, and the takings the books never
/// received. Only the first is a short drawer, and only the first has anywhere
/// to be posted. The count's own `variance_minor` separates them — it is
/// counted against the ledger and nothing else — so when the two figures
/// differ, this says which part is which rather than blaming the cashier for a
/// posting that never happened.
function cashStanding(
  meanings: Meanings,
  lastCount: CashCountRow | null,
  difference: number | null
): Standing {
  if (meanings.drawer.length === 0) {
    return {
      tone: "bad",
      label: "No drawer account",
      why: "`cash` is not mapped here, so the books hold no drawer to compare",
    }
  }
  if (lastCount === null || difference === null) {
    return {
      tone: "warn",
      label: "Not counted",
      why: "Nobody counted this drawer in the span — nothing has contradicted it",
    }
  }
  if (difference === 0) {
    return {
      tone: "ok",
      label: "Agrees",
      why: `Counted on ${day(lastCount.counted_on)}`,
    }
  }
  const drawer = lastCount.variance_minor
  const unposted = difference - drawer
  if (unposted !== 0) {
    return {
      tone: "bad",
      label: "Two gaps, not one",
      why: `${money(drawer)} is the drawer against the books; ${money(unposted)} is takings the cash account never received`,
    }
  }
  if (lastCount.entry_number !== null) {
    return {
      tone: "ok",
      label: "Booked",
      why: `Put in the books as ${lastCount.entry_number}`,
    }
  }
  if (lastCount.reason !== "") {
    return {
      tone: "warn",
      label: "Explained, not booked",
      why: lastCount.reason,
    }
  }
  return {
    tone: "bad",
    label: "Not explained",
    why: "A short drawer with no reason written against it",
  }
}

/// Each gap this screen can see, said in words, with what it thinks of it.
///
/// The order is the money's own journey: the drawer first because it is the
/// only difference here that is a real difference, then the two legs that ask
/// whether the till reaches the book at all, then what is still owed and what
/// it cost.
function differences(input: {
  takings: Takings
  counted: readonly CashCountRow[]
  books: Books
  meanings: Meanings
  bankIn: number
  imported: boolean
  to: string
}): readonly { name: string; amount: number | null; standing: Standing }[] {
  const { takings, counted, books, meanings, bankIn, imported, to } = input
  const rows: { name: string; amount: number | null; standing: Standing }[] = []

  const variance = counted.reduce((sum, row) => sum + row.variance_minor, 0)
  const unexplained = counted.some(
    (row) =>
      row.variance_minor !== 0 && row.reason === "" && row.entry_number === null
  )
  rows.push({
    name: "Drawer against the books",
    amount: counted.length === 0 ? null : variance,
    standing:
      counted.length === 0
        ? {
            tone: "warn",
            label: "Nobody counted",
            why: "An uncounted drawer is one nothing has contradicted",
          }
        : variance === 0
          ? { tone: "ok", label: "Agrees", why: "Counted, and it matched" }
          : unexplained
            ? {
                tone: "bad",
                label: "Not explained",
                why:
                  meanings.variance.length === 0
                    ? "And it cannot be booked: `cash_variance` is mapped to no account here. It is not on the account map's required list either, so nobody is ever prompted to set it"
                    : "Post it from Cash counts, with the reason somebody writes",
              }
            : {
                tone: "warn",
                label: "Explained",
                why: "Somebody wrote down why, or it has already been booked",
              },
  })

  const cashToBooks =
    books.drawer === null
      ? null
      : takings.cashExpected - books.drawer.window_debit_minor
  rows.push({
    name: "Cash the till took that the cash account never received",
    amount: cashToBooks,
    standing:
      books.drawer === null
        ? {
            tone: "bad",
            label: "Nowhere to look",
            why: "`cash` is not mapped at this unit",
          }
        : cashToBooks === 0
          ? {
              tone: "ok",
              label: "Agrees",
              why: "Every rupiah the till took arrived in the ledger",
            }
          : {
              tone: "bad",
              label: "Not explained",
              why: "The cash account did not move by what the till says was taken. Nothing on this screen can say where it went",
            },
  })

  const cardToBooks =
    books.card === null
      ? null
      : (takings.byTender.CARD ?? 0) - books.card.window_debit_minor
  rows.push({
    name: "Card the till took that the clearing account never received",
    amount: cardToBooks,
    standing:
      books.card === null
        ? {
            tone: "bad",
            label: "Nowhere to look",
            why: "Neither card receivable is mapped at this unit",
          }
        : cardToBooks === 0
          ? {
              tone: "ok",
              label: "Agrees",
              why: "Every card sale debited the clearing account",
            }
          : {
              tone: "bad",
              label: "Not explained",
              why: "A card sale should debit the clearing account the moment it happens; these did not",
            },
  })

  const qris = takings.byTender.QRIS ?? 0
  if (qris > 0) {
    rows.push({
      name: "QRIS posted through the debit-card receivable",
      amount: qris,
      standing: {
        tone: "warn",
        label: "Shared clearing account",
        why: "QRIS uses Piutang Debit Card; this amount is included in the shared card clearing balance",
      },
    })
  }

  rows.push({
    name: `Still owed by the acquirer at ${day(to)}`,
    amount: books.card === null ? null : books.card.closing_minor,
    standing:
      books.card === null
        ? {
            tone: "neutral",
            label: "Nowhere to look",
            why: "No card clearing account here",
          }
        : books.card.closing_minor > 0
          ? {
              tone: "warn",
              label: "Explained",
              why: "Settlement is T+1 or later — the last day's cards have not been paid yet",
            }
          : (takings.byTender.CARD ?? 0) > 0
            ? {
                tone: "bad",
                label: "Not explained",
                why: "Cards were taken and the clearing account holds nothing, which is what an account nothing posts to looks like",
              }
            : {
                tone: "ok",
                label: "Nothing owed",
                why: "No card takings in the span",
              },
  })

  rows.push({
    name: "Card fee charged in the span",
    amount: books.fee === null ? null : books.fee.window_debit_minor,
    standing:
      books.fee === null
        ? {
            tone: "neutral",
            label: "Nowhere to look",
            why: "`card_fee` is not mapped at this unit",
          }
        : books.fee.window_debit_minor > 0
          ? {
              tone: "warn",
              label: "Explained",
              why: "The fee is why what lands in the bank is less than what was taken",
            }
          : {
              tone: "neutral",
              label: "Nothing charged",
              why: "No acquirer fee reached this account in the span",
            },
  })

  rows.push({
    name: "Credited by the bank in the span",
    amount: imported ? bankIn : null,
    standing: imported
      ? {
          tone: "neutral",
          label: "Not attributed",
          why: "Deposits, settlements and everything else the bank credited, added together. Telling them apart needs a server-side reconciliation",
        }
      : {
          tone: "warn",
          label: "No statement",
          why: "Nothing has been imported for this unit over this span",
        },
  })

  return rows
}

/// Which statements this unit's window should be read from.
///
/// The same account and period can be imported more than once — it has been,
/// in this very database — and adding both would count a month twice. The
/// newest import of each (account, period) wins, and the ones set aside are
/// counted so the page can say it did that rather than quietly doing it.
function statementsFor(
  rows: readonly BankStatementRow[] | undefined,
  unit: string,
  from: string,
  to: string
) {
  const overlapping = (rows ?? []).filter(
    (row) =>
      row.unit_id === unit && row.period_start <= to && row.period_end >= from
  )
  const newest = new Map<string, (typeof overlapping)[number]>()
  for (const row of overlapping) {
    const key = `${row.account_code}|${row.period_start}|${row.period_end}`
    const held = newest.get(key)
    if (held === undefined || held.imported_at < row.imported_at) {
      newest.set(key, row)
    }
  }
  return {
    kept: [...newest.values()],
    dropped: overlapping.length - newest.size,
  }
}

/// What the drawer and the clearing accounts opened the span holding.
function openingOf(books: Books): number | null {
  const parts = [books.drawer, books.card].flatMap((one) =>
    one === null ? [] : [one.opening_minor]
  )
  if (parts.length === 0) return null
  return parts.reduce((a, b) => a + b, 0)
}

/// Money, with a zero that stays a zero.
///
/// `—` and `Rp 0` are different claims and this screen leans on the
/// difference harder than any other in the module: half its cells are absent
/// because the chart has no account for that kind of money, and drawing those
/// as `Rp 0` would say "settled" about something nothing is tracking. Zero
/// keeps its ink but loses its weight, so the figures that are not zero are
/// the ones the eye lands on.
///
/// `cell`: a row's own figure, which a compact table prints without its "Rp";
/// the figure that closes a table keeps it.
function Amount({ minor, cell }: { minor: number | null; cell?: boolean }) {
  if (minor === null) return <span className="text-faint">—</span>
  return (
    <span className={minor === 0 ? "text-faint" : undefined}>
      {cell === true ? <CellMoney minor={minor} /> : money(minor)}
    </span>
  )
}

/// Every local date from one to the other, inclusive.
///
/// Built from the parts rather than parsed: `new Date("2026-09-01")` is
/// midnight **UTC**, and these name a shop's own business day. The report
/// endpoints take the same `YYYY-MM-DD` and apply WIB themselves, so the
/// string has to survive the round trip unshifted.
function datesIn(from: string, to: string): readonly string[] {
  const start = local(from)
  const end = local(to)
  if (start === null || end === null || start > end) return []
  const dates: string[] = []
  for (
    const cursor = new Date(start);
    cursor <= end;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const month = String(cursor.getMonth() + 1).padStart(2, "0")
    const date = String(cursor.getDate()).padStart(2, "0")
    dates.push(`${cursor.getFullYear()}-${month}-${date}`)
  }
  return dates
}

function local(iso: string): Date | null {
  const parts = iso.split("-").map(Number)
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part)))
    return null
  return new Date(parts[0], parts[1] - 1, parts[2])
}
