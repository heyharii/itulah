import { useQuery } from "@tanstack/react-query"

import { Card } from "@/components/ui/card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Pill } from "@/components/ui/pill"
import { KeyValue, TotalsLadder } from "@/components/ui/rows"
import { Section } from "@/components/ui/screen"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner, EmptyState } from "@/components/ui/states"
import { moment } from "@/lib/format"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import {
  fetchWindow,
  lastDays,
  windowKey,
  type SalesWindow,
  type TenderTotal,
} from "@/lib/queries"
import { useOpenDrawers, useTillSeats } from "@/lib/queries/reconciliation"
import { signed, spanWords, tenderOf } from "@/screens/money/format"
import {
  CardHead,
  MoneyScreen,
  Note,
  SpanPicker,
  Toolbar,
  TwoLine,
} from "@/screens/money/parts"
import type { CashMovementView, ShiftReport, TillSeat } from "@itulah/contract"
import { money, units } from "@itulah/contract/money"

/// Did the money this shop rang up turn into money this shop holds?
///
/// The owner asked for it in one sentence — *"menu rekonsiliasi penjualan,
/// bedakan rekonsiliasi uang cash dan uang debit/digital, ini dari penjualan
/// ya"* — and the instruction to keep the two apart is the entire design.
/// They are not two views of one list. They are two different questions,
/// answered by two different people, against two different pieces of evidence:
///
///   **Cash** is settled by a person, here, tonight. Float in, cash taken,
///   change out, drops and pay-outs — against banknotes somebody counted. The
///   node does that arithmetic itself and hands back the difference, and that
///   difference is the number this screen exists for.
///
///   **Card, QRIS and the rest** are settled by somebody else, days later,
///   somewhere this node cannot see. The till captured them; an acquirer paid
///   them, or did not, net of a fee, into an account this node has never been
///   told about. **There is no settlement file behind this counter.** So this
///   half reports capture and says so, and there is deliberately no "matched"
///   anywhere on it — a green tick this node cannot earn is worse than no tick,
///   because somebody stops chasing.
///
/// **Read-only, by design.** Opening a drawer, moving cash and the blind count
/// at the close happen at the till, on the POS. This is the noun to that verb:
/// what the takings were made of, and which parts of them are confirmed.
///
/// **Why the two halves carry different spans.** A drawer is counted per
/// *shift*; an acquirer settles a *day's* batch. Forcing one span on both would
/// make one half lie, so the cash half is the shifts the node has open — one
/// drawer per till seat — and the capture half is a calendar window. Each has
/// its own strip of figures, so nobody adds one to the other.
export function Reconciliation() {
  const drawers = useOpenDrawers()
  const span = useParam("span")
  const chosen = spanOf(span.value)
  // Read once per render. `lastDays` reads the clock, and two calls either
  // side of midnight would key the cache on one span and fetch another.
  const range = lastDays(Number(chosen))

  const captured = useQuery({
    queryKey: windowKey(range.from, range.to),
    queryFn: ({ signal }) => fetchWindow(range, signal),
  })

  return (
    <MoneyScreen>
      <Section
        className="mb-8"
        title="Cash"
        action={
          drawers.data !== undefined && drawers.data.length > 0 ? (
            <Pill tone="info">{drawers.data.length} still open</Pill>
          ) : undefined
        }
      >
        {queryState(drawers, {
          loading: "Loading…",
          render: (reports) => <Counter reports={reports} />,
        })}
      </Section>

      <Section title="Card, QRIS and others">
        <Toolbar>
          <SpanPicker
            options={SPANS}
            value={chosen}
            onChange={(next) => span.set(next)}
          />
          <span className="text-meta text-mute tabular-nums">
            {spanWords(range.from, range.to)}
          </span>
        </Toolbar>
        {queryState(captured, {
          loading: "Loading…",
          render: (taken) => <Captured taken={taken} days={chosen} />,
        })}
      </Section>
    </MoneyScreen>
  )
}

/// The spans the capture half offers.
///
/// `span` is the key Reports and Sales already declare in `lib/params.ts`, so
/// the three screens hand it to each other rather than each inventing one. A
/// value this screen has no button for — `?span=90` carried over from Sales —
/// falls back to today rather than quietly showing a quarter of card takings
/// under a control that reads "Today".
const SPANS = [
  { value: "1", label: "Today" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
] as const

type Span = (typeof SPANS)[number]["value"]

function spanOf(raw: string | undefined): Span {
  return SPANS.some((option) => option.value === raw) ? (raw as Span) : "1"
}

// ─────────────────────────────────────────────────────────────────────────────
// Cash

/// The whole counter: which seats are held, then each open drawer in full.
///
/// A shop has as many till seats as head office set, and a drawer is one
/// person's cash at one seat — so this is a list, and the seat table above it
/// is the glance a manager wants before choosing which ladder to read. The
/// ladders below are the same `Drawer` the single-counter screen drew, one per
/// open shift, in the order the node lists them.
///
/// The seat list is a courtesy, not a dependency: if `tills` fails, the drawers
/// are still the answer to the question the screen asks, and a manager should
/// not lose a cash position over a missing table.
function Counter({ reports }: { reports: readonly ShiftReport[] }) {
  const seats = useTillSeats()
  return (
    <>
      {seats.data !== undefined && seats.data.length > 0 && (
        <Card className="mb-4">
          <CardHead
            title="Tills"
          />
          <ListTable
            rows={seats.data}
            columns={seatColumns(reports)}
            rowKey={(seat) => seat.terminal_id}
            empty="No tills."
          />
        </Card>
      )}
      {reports.length === 0 ? (
        <NoDrawer />
      ) : (
        reports.map((report, index) => (
          <div key={report.shift_id} className={index === 0 ? "" : "mt-8"}>
            <h3 className="mb-2 text-card-title font-semibold text-ink">
              {report.terminal_label}
            </h3>
            <Drawer report={report} />
          </div>
        ))
      )}
    </>
  )
}

/// A store-local calendar day, as a date rather than a moment.
///
/// `business_date` is a day, not an instant: run through `moment` it would
/// grow an hour nobody rang anything at. Parsed at local midnight so a day
/// never slips a day in a timezone behind UTC.
function businessDay(date: string | null): string {
  if (date === null) return "—"
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleDateString("id-ID", { day: "2-digit", month: "short" })
}

/// The seat table's columns. A seat is free when it has no shift; the columns
/// that describe a person or a drawer are then a dash, not a blank, so a free
/// seat reads as an answer rather than a row that failed to load.
function seatColumns(
  reports: readonly ShiftReport[],
): readonly ListColumn<TillSeat>[] {
  const opened = (seat: TillSeat) =>
    reports.find((report) => report.shift_id === seat.shift_id)
  const dash = <span className="text-faint">—</span>
  return [
    {
      id: "seat",
      header: "Seat",
      className: "min-w-[10rem]",
      cell: (seat) => (
        <TwoLine
          top={seat.label}
          under={seat.current ? undefined : "Removed · drawer open"}
        />
      ),
    },
    {
      id: "held",
      header: "Held by",
      cell: (seat) => seat.held_by ?? dash,
    },
    {
      id: "since",
      header: "Since",
      className: "tabular-nums",
      cell: (seat) => (seat.held_since === null ? dash : moment(seat.held_since)),
    },
    {
      id: "day",
      header: "Business date",
      card: "hide",
      className: "tabular-nums max-md:hidden",
      cell: (seat) => {
        const report = opened(seat)
        return report === undefined ? dash : businessDay(report.business_date)
      },
    },
    {
      id: "status",
      header: "Status",
      align: "right",
      card: "status",
      cell: (seat) =>
        seat.shift_id === null ? (
          <Pill tone="neutral">Free</Pill>
        ) : (
          <Pill tone="info">Open</Pill>
        ),
    },
  ]
}

/// No shift is open, which is not an error and not an empty screen.
///
/// Cash reconciles against a count, a count happens at a close, and a close
/// belongs to a shift. The node also keeps no way to walk back through shifts
/// that have ended — `shifts/open` and `shifts/{id}` are the only doors, and
/// the second needs an id nothing on this node hands out — so a drawer
/// counted last night cannot be re-opened from here. Saying that is the honest
/// answer; drawing an empty ladder of zeroes would not be.
function NoDrawer() {
  return (
    <Card>
      <EmptyState>
        No drawer is open.
      </EmptyState>
    </Card>
  )
}

/// The drawer, and the one number the screen is for.
///
/// Every figure below is the node's own. `expected_cash_minor` is computed in
/// `edge/till.rs::report` and `variance_minor` beside it, and neither is
/// re-derived here — a screen that added up the same evening in TypeScript
/// would eventually disagree with the node about a shop's money, and the
/// argument that follows has no referee.
function Drawer({ report: given }: { report: ShiftReport }) {
  const report = whole(given)
  // A cashier is served the report blind (`http.rs::blind_for_cashier`):
  // every figure the expected cash could be worked back from arrives null.
  // Said plainly rather than drawn as zeros — a drawer that "should hold
  // Rp 0" is a sentence somebody would act on.
  if (report === null) {
    return (
      <Banner tone="warn">
        Hidden from cashiers. Sign in as a supervisor.
      </Banner>
    )
  }
  const counted = report.declared_cash_minor
  const variance = report.variance_minor
  const uncounted = counted === null || variance === null

  return (
    <>
      <p className="-mt-1 mb-3 text-meta text-mute">
        Opened {moment(report.opened_at)} by {report.opened_by} · business date{" "}
        {businessDay(report.business_date)}
        {report.taken_over_by !== null &&
          ` · taken over by ${report.taken_over_by}${
            report.counted_at === null ? ", not counted yet" : ""
          }`}
        {report.closed_at !== null &&
          ` · closed ${moment(report.closed_at)}${
            report.closed_by === null ? "" : ` by ${report.closed_by}`
          }`}
      </p>

      <StatStrip>
        <Stat
          label="Difference"
          // Over is not painted as a loss: a drawer that is OVER is a
          // mis-ring to find, not money gone. The banner under the strip is
          // where the sentence somebody acts on lives.
          value={uncounted ? "Not counted" : signed(variance)}
          tone={
            uncounted
              ? undefined
              : variance === 0
                ? "ok"
                : variance < 0
                  ? "bad"
                  : "warn"
          }
          sub={
            uncounted
              ? "counted at the close"
              : variance === 0
                ? "it balances"
                : variance < 0
                  ? "short"
                  : "over"
          }
        />
        <Stat
          label="Counted"
          value={counted === null ? "—" : money(counted)}
          sub={counted === null ? "blind, at the close" : "at the close"}
        />
        <Stat
          label="Should be in the drawer"
          value={money(report.expected_cash_minor)}
          sub="the node's own figure"
        />
        <Stat
          label="Sales rung"
          value={units(report.sale_count)}
          sub={
            report.voided_count > 0
              ? `${units(report.voided_count)} voided`
              : `${money(report.sales_total_minor)} in all`
          }
        />
      </StatStrip>

      {uncounted ? (
        <UncountedDrawer expected={report.expected_cash_minor} />
      ) : (
        <Banner tone={variance === 0 ? "ok" : variance < 0 ? "bad" : "warn"}>
          {variance === 0
            ? `Balanced: ${money(counted)} counted, ${money(report.expected_cash_minor)} expected.`
            : variance < 0
              ? `Short ${money(-variance)}. Check cash in and out, then the receipts.`
              : `Over ${money(variance)}. Check cash in and out, then the receipts.`}
        </Banner>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHead title="Drawer" />
          <div className="px-4 pb-3">
            <TotalsLadder
              className="border-t-0"
              rows={[
                {
                  label: "Float, drops and pay-outs",
                  value: money(report.cash_movements_minor),
                },
                { label: "Cash taken", value: money(report.cash_sales_minor) },
                {
                  label: "Change given",
                  value: `−${money(report.change_given_minor)}`,
                  tone: "bad",
                },
                ...(report.cash_refunds_minor > 0
                  ? [
                      {
                        label: "Refunded in cash",
                        value: `−${money(report.cash_refunds_minor)}`,
                        tone: "bad" as const,
                      },
                    ]
                  : []),
              ]}
              total={{
                label: "Should be in the drawer",
                value: money(report.expected_cash_minor),
              }}
            />
          </div>
          <div className="border-t border-hairline px-4 py-1">
            <KeyValue term="Shift">
              <span className="font-mono text-id">
                {report.shift_id.slice(0, 8)}
              </span>
            </KeyValue>
            {report.note !== null && (
              <KeyValue term="Close note">{report.note}</KeyValue>
            )}
          </div>
        </Card>

        <Card className="min-w-0 self-start">
          <CardHead
            title="Cash in and out"
          />
          <ListTable
            rows={report.movements}
            columns={MOVEMENT_COLUMNS}
            rowKey={(movement) => movement.id}
            empty="No cash in or out."
          />
        </Card>
      </div>

      {report.non_cash_minor > 0 && (
        <Note>
          Non-cash this shift:{" "}
          <span className="tabular-nums">{money(report.non_cash_minor)}</span>
        </Note>
      )}
    </>
  )
}

/// A report whose figures a supervisor may read, narrowed back to numbers.
type WholeReport = ShiftReport & {
  sales_total_minor: number
  cash_sales_minor: number
  non_cash_minor: number
  change_given_minor: number
  cash_refunds_minor: number
  non_cash_refunds_minor: number
  expected_cash_minor: number
}

/// Null when the node withheld the figures — `blind`, or any of them absent.
function whole(report: ShiftReport): WholeReport | null {
  const {
    sales_total_minor,
    cash_sales_minor,
    non_cash_minor,
    change_given_minor,
    cash_refunds_minor,
    non_cash_refunds_minor,
    expected_cash_minor,
  } = report
  if (
    report.blind ||
    sales_total_minor === null ||
    cash_sales_minor === null ||
    non_cash_minor === null ||
    change_given_minor === null ||
    cash_refunds_minor === null ||
    non_cash_refunds_minor === null ||
    expected_cash_minor === null
  ) {
    return null
  }
  return {
    ...report,
    sales_total_minor,
    cash_sales_minor,
    non_cash_minor,
    change_given_minor,
    cash_refunds_minor,
    non_cash_refunds_minor,
    expected_cash_minor,
  }
}

/// A drawer nobody has counted yet.
///
/// The screen refuses to show a variance here, and the refusal is the point: a
/// variance is a count minus an expectation, and with no count there is no
/// variance to have an opinion about. `declared_cash_minor` is written only by
/// `close_shift`, so this is every open drawer, all day.
///
/// The expected figure is shown, because it is the working rather than the
/// answer and this screen's reader is the person chasing the difference. The
/// count that meets it is taken at the till, blind — a cashier shown what the
/// drawer *should* hold counts toward it, and then the count means nothing.
function UncountedDrawer({ expected }: { expected: number }) {
  return (
    <Banner tone="info">
      Not counted yet. Expected{" "}
      <span className="tabular-nums">{money(expected)}</span>.
    </Banner>
  )
}

const MOVEMENT_WORD: Readonly<Record<string, string>> = {
  OPENING_FLOAT: "Opening float",
  DROP: "To the safe",
  PAYOUT: "Paid out",
  PICKUP: "Added to the drawer",
  CORRECTION: "Correction",
}

const MOVEMENT_COLUMNS: readonly ListColumn<CashMovementView>[] = [
  {
    id: "movement",
    header: "Movement",
    className: "min-w-[12rem] whitespace-normal",
    cell: (movement) => (
      <TwoLine
        top={MOVEMENT_WORD[movement.kind] ?? movement.kind}
        under={movement.reason}
      />
    ),
  },
  {
    id: "when",
    header: "When",
    className: "tabular-nums",
    cell: (movement) => moment(movement.occurred_at),
  },
  {
    id: "signed",
    header: "Signed by",
    card: "hide",
    className: "max-lg:hidden",
    cell: (movement) =>
      movement.approved_by === null ? (
        <span className="text-faint">—</span>
      ) : (
        movement.approved_by
      ),
  },
  {
    id: "amount",
    header: "Amount",
    align: "right",
    card: "status",
    cell: (movement) => (
      <span
        className={
          movement.amount_minor < 0
            ? "font-medium text-bad-fg tabular-nums"
            : "font-medium text-ink tabular-nums"
        }
      >
        {movement.amount_minor < 0
          ? `−${money(Math.abs(movement.amount_minor))}`
          : money(movement.amount_minor)}
      </span>
    ),
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Everything that is not cash

/// One row of the capture table: a tender, or the table's foot.
interface CaptureLine {
  readonly key: string
  readonly tender: TenderTotal | null
  readonly count: number
  readonly amount_minor: number
  readonly share: number
}

/// What the terminal captured, and the sentence that keeps it honest.
///
/// Read from `sales/window`, which groups `sale_tender` by method over a
/// calendar span — completed sales only, so a voided card sale is not chased
/// with an acquirer that was never asked for the money.
function Captured({ taken, days }: { taken: SalesWindow; days: Span }) {
  const nonCash = taken.tenders.filter((tender) => tender.method !== "CASH")
  const cash = taken.tenders.find((tender) => tender.method === "CASH")
  const total = nonCash.reduce((sum, tender) => sum + tender.amount_minor, 0)
  const count = nonCash.reduce((sum, tender) => sum + tender.count, 0)

  if (taken.sales.count === 0) {
    return (
      <Card>
        <EmptyState>
          {days === "1"
            ? "No sales today."
            : "No sales in this period."}
        </EmptyState>
      </Card>
    )
  }

  if (nonCash.length === 0) {
    return (
      <Card>
        <EmptyState>
          All payments were cash.
        </EmptyState>
      </Card>
    )
  }

  const lines: readonly CaptureLine[] = [
    ...nonCash.map((tender) => ({
      key: tender.method,
      tender,
      count: tender.count,
      amount_minor: tender.amount_minor,
      share: total === 0 ? 0 : tender.amount_minor / total,
    })),
    { key: "total", tender: null, count, amount_minor: total, share: 1 },
  ]

  return (
    <>
      <StatStrip>
        <Stat
          label="Captured"
          value={money(total)}
        />
        <Stat
          label="Payments"
          value={units(count)}
          sub={`${units(nonCash.length)} ${nonCash.length === 1 ? "method" : "methods"}`}
        />
        <Stat
          label="Bank confirmed"
          value="—"
          sub="At head office"
        />
        {cash !== undefined && (
          <Stat
            label="Cash"
            value={money(cash.amount_minor)}
          />
        )}
      </StatStrip>

      <Card>
        <CardHead
          title="By method"
        />
        <ListTable
          rows={lines}
          columns={CAPTURE_COLUMNS}
          rowKey={(line) => line.key}
          empty="Nothing captured."
        />
      </Card>

    </>
  )
}

const CAPTURE_COLUMNS: readonly ListColumn<CaptureLine>[] = [
  {
    id: "method",
    header: "Method",
    className: "min-w-[14rem]",
    cell: (line) => {
      if (line.tender === null) {
        return (
          <span className="font-semibold text-ink">Total</span>
        )
      }
      const kind = tenderOf(line.tender.method)
      return <TwoLine icon={kind.icon} top={kind.word} under={kind.settles} />
    },
  },
  {
    id: "tenders",
    header: "Tenders",
    align: "right",
    className: "tabular-nums",
    cell: (line) => (
      <span className={line.tender === null ? "font-semibold text-ink" : ""}>
        {units(line.count)} {line.count === 1 ? "tender" : "tenders"}
      </span>
    ),
  },
  {
    id: "share",
    header: "Share",
    align: "right",
    card: "hide",
    className: "tabular-nums max-md:hidden",
    cell: (line) =>
      line.tender === null ? (
        <span className="text-faint">—</span>
      ) : (
        `${Math.round(line.share * 100)}%`
      ),
  },
  {
    id: "captured",
    header: "Captured",
    align: "right",
    card: "status",
    cell: (line) => (
      <span
        className={
          line.tender === null
            ? "font-semibold text-ink tabular-nums"
            : "font-medium text-ink tabular-nums"
        }
      >
        {money(line.amount_minor)}
      </span>
    ),
  },
]
