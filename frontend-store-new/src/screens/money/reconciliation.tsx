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
import { useOpenDrawer } from "@/lib/queries/reconciliation"
import { signed, spanWords, tenderOf } from "@/screens/money/format"
import {
  CardHead,
  MoneyScreen,
  Note,
  SpanPicker,
  Toolbar,
  TwoLine,
} from "@/screens/money/parts"
import type { CashMovementView, ShiftReport } from "@itulah/contract"
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
/// make one half lie, so the cash half is the shift the node has open and the
/// capture half is a calendar window — each with its own strip of figures, so
/// nobody adds one to the other.
export function Reconciliation() {
  const drawer = useOpenDrawer()
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
    <MoneyScreen sub="Cash is counted in the drawer, tonight. Card and QRIS are settled by an acquirer, days later. Two questions, kept apart.">
      <Section
        className="mb-8"
        title="Cash · counted in the drawer"
        action={
          drawer.data !== undefined && drawer.data !== null ? (
            <Pill tone={drawer.data.status === "OPEN" ? "info" : "ok"}>
              {drawer.data.status === "OPEN" ? "Still open" : "Closed"}
            </Pill>
          ) : undefined
        }
      >
        {queryState(drawer, {
          loading: "Reading the drawer this shop has open…",
          render: (report) =>
            report === null ? <NoDrawer /> : <Drawer report={report} />,
        })}
      </Section>

      <Section title="Card, QRIS and the rest · settled elsewhere">
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
          loading: "Reading what this terminal captured…",
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

/// No shift is open, which is not an error and not an empty screen.
///
/// Cash reconciles against a count, a count happens at a close, and a close
/// belongs to a shift. The node also keeps no way to walk back through shifts
/// that have ended — `shifts/active` and `shifts/{id}` are the only two doors,
/// and the second needs an id nothing on this node hands out — so a drawer
/// counted last night cannot be re-opened from here. Saying that is the honest
/// answer; drawing an empty ladder of zeroes would not be.
function NoDrawer() {
  return (
    <Card>
      <EmptyState>
        No drawer is open on this node, so there is no cash position to
        reconcile. Cash is counted against a shift, opened and closed at the
        till on the POS: a float counted in at the start, and a count at the
        close.
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
        The drawer's figures are withheld from a cashier — the close is
        blind. Sign in as a supervisor to reconcile this shift.
      </Banner>
    )
  }
  const counted = report.declared_cash_minor
  const variance = report.variance_minor
  const uncounted = counted === null || variance === null

  return (
    <>
      <p className="-mt-1 mb-3 text-meta text-mute">
        Till {report.terminal_id} · opened {moment(report.opened_at)} by{" "}
        {report.opened_by}
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
            ? `The drawer balances: ${money(counted)} counted against ${money(report.expected_cash_minor)} expected.`
            : variance < 0
              ? "The drawer is short: money this shop rang up and does not hold. Walk the cash in and out below first — a drop or a pay-out recorded for the wrong amount is the common cause — then the receipts, for a sale rung as cash and paid some other way."
              : "The drawer is over. Nothing is missing, but something was rung wrong: change not handed back, or a card sale recorded as cash. It is found the same way a shortage is, and it is worth finding — an over tonight is usually a short somewhere else."}
        </Banner>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHead title="How the drawer adds up" />
          <div className="px-4 pb-3">
            <TotalsLadder
              className="border-t-0"
              rows={[
                {
                  label: "Opening float, drops and pay-outs",
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
              <KeyValue term="Note at the close">{report.note}</KeyValue>
            )}
          </div>
        </Card>

        <Card className="min-w-0 self-start">
          <CardHead
            title="Cash in and out"
            sub="Everything that moved the drawer apart from a sale."
          />
          <ListTable
            rows={report.movements}
            columns={MOVEMENT_COLUMNS}
            rowKey={(movement) => movement.id}
            empty="Nothing went in or out of this drawer apart from sales."
          />
        </Card>
      </div>

      {report.non_cash_minor > 0 && (
        <Note>
          This shift also took{" "}
          <span className="tabular-nums">{money(report.non_cash_minor)}</span>{" "}
          on cards, QRIS or other tenders. None of it is in the ladder above,
          because none of it is in the drawer — it is the half below.
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
      This drawer has not been counted, so it has no difference yet — on the
      figures below it should be holding{" "}
      <span className="tabular-nums">{money(expected)}</span>. The count is
      taken at the close, blind, at the till.
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
            ? "Nothing has been rung up today yet, so there is nothing to settle."
            : "This shop recorded no sales in that span."}
        </EmptyState>
      </Card>
    )
  }

  if (nonCash.length === 0) {
    return (
      <Card>
        <EmptyState>
          Every payment this shop took in that span was cash. There is nothing
          here for an acquirer to settle — all of it is counted in the drawer.
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
          label="Captured by this till"
          value={money(total)}
          sub="card, QRIS and the rest"
        />
        <Stat
          label="Tenders to settle"
          value={units(count)}
          sub={`across ${units(nonCash.length)} ${nonCash.length === 1 ? "method" : "methods"}`}
        />
        <Stat
          label="Confirmed by the bank"
          value="—"
          sub="checked at head office"
        />
        {cash !== undefined && (
          <Stat
            label="Cash in the same span"
            value={money(cash.amount_minor)}
            sub="counted in the drawer, not here"
          />
        )}
      </StatStrip>

      <Card>
        <CardHead
          title="Captured, by how it was paid"
          sub="What the terminal captured — not what the bank paid."
        />
        <ListTable
          rows={lines}
          columns={CAPTURE_COLUMNS}
          rowKey={(line) => line.key}
          empty="Nothing captured in this span."
        />
      </Card>

      <Banner tone="info" className="mt-4">
        This is what the terminal captured, not what the bank paid. The node
        behind this counter has no line to an acquirer and no settlement file:
        it cannot say which of these landed, on what date, or net of what fee.
        That confirmation is done at head office against the bank statement, and
        nothing on this screen should be read as it.
      </Banner>

      <Note>
        The till captures an approval code with each card or QRIS tender and
        keeps it on the sale, where it prints on the receipt. These figures are
        grouped by method, which is all this node&rsquo;s report answers — so
        the code-by-code list a bank match needs is read receipt by receipt, on
        Reports.
        {cash !== undefined && (
          <>
            {" "}
            Cash taken in this span is deliberately not in the table: it is
            banknotes, counted in the drawer above. That half is one shift and
            this one is a calendar span, so the two are not meant to add up.
          </>
        )}
      </Note>
    </>
  )
}

const CAPTURE_COLUMNS: readonly ListColumn<CaptureLine>[] = [
  {
    id: "method",
    header: "How it was paid",
    className: "min-w-[14rem]",
    cell: (line) => {
      if (line.tender === null) {
        return (
          <span className="font-semibold text-ink">Captured by this till</span>
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
