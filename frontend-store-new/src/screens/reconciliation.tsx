import { useQuery } from "@tanstack/react-query"
import {
  CreditCard,
  QrCode,
  Ticket,
  Wallet,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { BigNumber } from "@/components/ui/kpi"
import { Pill } from "@/components/ui/pill"
import {
  KeyValue,
  MiniRow,
  MiniTable,
  TotalsLadder,
} from "@/components/ui/rows"
import { Screen, Section } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { moment } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import {
  fetchWindow,
  lastDays,
  windowKey,
  type SalesWindow,
} from "@/lib/queries"
import { useOpenDrawer } from "@/lib/queries/reconciliation"
import type { ShiftReport } from "@itulah/contract"
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
/// **This is not the Shift screen, and must not drift into it.** Shift is a
/// verb: open this drawer, move cash, close it against a blind count, now, by
/// the cashier standing at it. This is a noun: what the takings were made of,
/// and which parts of them are confirmed. Everything here is read-only, and the
/// one action it offers is a way back to Shift, where counting happens.
///
/// **Why the two halves carry different spans.** A drawer is counted per
/// *shift*; an acquirer settles a *day's* batch. Forcing one span on both would
/// make one half lie, so the cash half is the shift the node has open and the
/// capture half is a calendar window. They are not meant to add up, and the
/// screen says so rather than leaving somebody to discover it.
export function Reconciliation() {
  const drawer = useOpenDrawer()
  const span = useParam("span")
  const chosen = spanOf(span.value)
  // Read once per render. `lastDays` reads the clock, and two calls either side
  // of midnight would key the cache on one span and fetch another.
  const range = lastDays(Number(chosen))

  const captured = useQuery({
    queryKey: windowKey(range.from, range.to),
    queryFn: ({ signal }) => fetchWindow(range, signal),
  })

  return (
    <Screen foot="none">
      <Section title="Cash · counted in the drawer">
        {queryState(drawer, {
          loading: "Reading the drawer this shop has open…",
          render: (report) =>
            report === null ? <NoDrawer /> : <Drawer report={report} />,
        })}
      </Section>

      <Section title="Card, QRIS and the rest · settled elsewhere">
        <div className="mb-3">
          <Segmented
            options={SPANS}
            value={chosen}
            onChange={(next) => span.set(next)}
          />
        </div>
        {queryState(captured, {
          loading: "Reading what this terminal captured…",
          render: (taken) => <Captured taken={taken} days={chosen} />,
        })}
      </Section>
    </Screen>
  )
}

/// The spans this half offers.
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
/// There is nothing to soften here: cash reconciles against a count, a count
/// happens at a close, and a close belongs to a shift. The node also keeps no
/// way to walk back through shifts that have ended — `shifts/active` and
/// `shifts/{id}` are the only two doors, and the second needs an id nothing on
/// this node hands out — so a drawer that was counted last night cannot be
/// re-opened from here. Saying that is the honest answer; drawing an empty
/// ladder of zeroes would not be.
function NoDrawer() {
  const go = useGo()
  return (
    <EmptyState
      action={
        <Button variant="primary" onClick={() => go("/till/shift")}>
          <Wallet />
          Go to the drawer
        </Button>
      }
    >
      No drawer is open on this node, so there is no cash position to reconcile.
      Cash is counted against a shift: a float counted in at the start, and a
      count at the close.
    </EmptyState>
  )
}

/// The drawer, and the one number the screen is for.
///
/// Every figure below is the node's own. `expected_cash_minor` is computed in
/// `edge/till.rs::report` and `variance_minor` beside it, and neither is
/// re-derived here — a till that added up the same evening in TypeScript would
/// eventually disagree with the node about a shop's money, and the argument
/// that follows has no referee.
function Drawer({ report }: { report: ShiftReport }) {
  const counted = report.declared_cash_minor
  const variance = report.variance_minor

  return (
    <>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-meta text-mute">
          Till {report.terminal_id} · opened {moment(report.opened_at)} by{" "}
          {report.opened_by}
        </span>
        <Pill tone={report.status === "OPEN" ? "info" : "ok"}>
          {report.status === "OPEN" ? "Still open" : "Closed"}
        </Pill>
      </div>

      {counted === null || variance === null ? (
        <UncountedDrawer expected={report.expected_cash_minor} />
      ) : (
        <>
          <Card className="px-4 py-5">
            <BigNumber
              label={
                variance === 0 ? "It balances" : variance < 0 ? "Short" : "Over"
              }
              value={signed(variance)}
              // `BigNumber` has no `warn`, and that is the right shape here: a
              // drawer that is OVER is not a failure, it is a mis-ring to find,
              // so it is not painted like a loss. The warning tone is carried
              // by the banner underneath, which is where the sentence somebody
              // acts on lives.
              tone={variance === 0 ? "ok" : variance < 0 ? "bad" : "ink"}
              sub={`${money(counted)} counted against ${money(
                report.expected_cash_minor,
              )} expected`}
            />
          </Card>
          <Banner
            tone={variance === 0 ? "ok" : variance < 0 ? "bad" : "warn"}
            className="mt-2.5"
          >
            {variance === 0
              ? `The drawer balances. Counted at the close${
                  report.closed_by === null ? "" : ` by ${report.closed_by}`
                }, ${moment(report.closed_at)}.`
              : variance < 0
                ? "The drawer is short: money this shop rang up and does not hold. Walk the cash in and out below first — a drop or a pay-out recorded for the wrong amount is the common cause — then the receipts, for a sale rung as cash and paid some other way."
                : "The drawer is over. Nothing is missing, but something was rung wrong: change not handed back, or a card sale recorded as cash. It is found the same way a shortage is, and it is worth finding — an over tonight is usually a short somewhere else."}
          </Banner>
        </>
      )}

      <Card className="mt-2.5 px-4 py-3">
        <TotalsLadder
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
      </Card>

      {report.non_cash_minor > 0 && (
        <p className="mt-2.5 text-meta text-mute">
          This shift also took{" "}
          <span className="tabular-nums">{money(report.non_cash_minor)}</span>{" "}
          on cards, QRIS or other tenders. None of it is in the ladder above,
          because none of it is in the drawer — it is the half below.
        </p>
      )}

      {report.movements.length > 0 && (
        <Card className="mt-4">
          <MiniTable head={["CASH IN AND OUT", "WHEN", "AMOUNT"]}>
            {report.movements.map((movement) => (
              <MiniRow key={movement.id}>
                <td>
                  {MOVEMENT_WORD[movement.kind] ?? movement.kind}
                  <span className="block text-meta text-mute">
                    {movement.reason}
                    {movement.approved_by !== null &&
                      ` · signed ${movement.approved_by}`}
                  </span>
                </td>
                <td className="whitespace-nowrap text-mute">
                  {moment(movement.occurred_at)}
                </td>
                <td>
                  <span
                    className={
                      movement.amount_minor < 0 ? "text-bad-fg" : undefined
                    }
                  >
                    {movement.amount_minor < 0
                      ? `−${money(Math.abs(movement.amount_minor))}`
                      : money(movement.amount_minor)}
                  </span>
                </td>
              </MiniRow>
            ))}
          </MiniTable>
        </Card>
      )}

      <Card className="mt-4 px-4 py-1">
        <KeyValue term="Shift">{report.shift_id.slice(0, 8)}</KeyValue>
        <KeyValue term="Sales rung">
          {units(report.sale_count)}
          {report.voided_count > 0 && ` · ${units(report.voided_count)} voided`}
        </KeyValue>
        {report.closed_at !== null && (
          <KeyValue term="Closed">{moment(report.closed_at)}</KeyValue>
        )}
        {report.note !== null && (
          <KeyValue term="Note at the close">{report.note}</KeyValue>
        )}
      </Card>
    </>
  )
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
/// count that meets it is taken on Shift, blind — a cashier shown what the
/// drawer *should* hold counts toward it, and then the count means nothing.
function UncountedDrawer({ expected }: { expected: number }) {
  const go = useGo()
  return (
    <Banner
      tone="info"
      action={<Button onClick={() => go("/till/shift")}>Close it</Button>}
    >
      This drawer has not been counted, so it has no difference yet — on the
      figures below it should be holding{" "}
      <span className="tabular-nums">{money(expected)}</span>. The count is
      taken at the close, blind, on the Shift screen.
    </Banner>
  )
}

/// A difference somebody has to read across a counter, with its direction on
/// it. `−` is U+2212, not a hyphen: at 32px a hyphen reads as a dash.
function signed(minor: number): string {
  if (minor === 0) return money(0)
  return `${minor < 0 ? "−" : "+"}${money(Math.abs(minor))}`
}

const MOVEMENT_WORD: Readonly<Record<string, string>> = {
  OPENING_FLOAT: "Opening float",
  DROP: "To the safe",
  PAYOUT: "Paid out",
  PICKUP: "Added to the drawer",
  CORRECTION: "Correction",
}

// ─────────────────────────────────────────────────────────────────────────────
// Everything that is not cash

/// What each tender is, and who actually settles it.
///
/// The third column is the reason this half is not one list either. A card and
/// a QRIS payment wait on an acquirer; a voucher waits on nobody, because it
/// discharges something this estate issued and was already carrying; `OTHER` is
/// whatever the counter reached for. Grouping all four as "digital" would put a
/// voucher into a bank reconciliation it will never appear in.
const TENDER: Readonly<
  Record<string, { word: string; icon: LucideIcon; settles: string }>
> = {
  CARD: {
    word: "Card / debit",
    icon: CreditCard,
    settles: "paid by the acquirer",
  },
  QRIS: { word: "QRIS", icon: QrCode, settles: "paid by the acquirer" },
  VOUCHER: {
    word: "Voucher",
    icon: Ticket,
    settles: "redeems a voucher this estate issued",
  },
  OTHER: { word: "Other", icon: Wallet, settles: "settled off this node" },
}

function tenderOf(method: string) {
  return (
    TENDER[method] ?? {
      word: method,
      icon: Wallet,
      settles: "settled somewhere this node cannot see",
    }
  )
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

  if (taken.sales.count === 0) {
    return (
      <EmptyState>
        {days === "1"
          ? "Nothing has been rung up today yet, so there is nothing to settle."
          : "This shop recorded no sales in that span."}
      </EmptyState>
    )
  }

  if (nonCash.length === 0) {
    return (
      <EmptyState>
        Every payment this shop took in that span was cash. There is nothing
        here for an acquirer to settle — all of it is counted in the drawer.
      </EmptyState>
    )
  }

  return (
    <>
      <Card>
        <MiniTable head={["HOW IT WAS PAID", "TENDERS", "CAPTURED"]}>
          {nonCash.map((tender) => {
            const kind = tenderOf(tender.method)
            const Glyph = kind.icon
            return (
              <MiniRow key={tender.method}>
                <td>
                  <span className="flex items-center gap-2">
                    <span className="text-line-ico [&_svg]:size-4">
                      <Glyph />
                    </span>
                    {kind.word}
                  </span>
                  <span className="block text-meta text-mute">
                    {kind.settles}
                  </span>
                </td>
                <td className="text-mute">{units(tender.count)}</td>
                <td>{money(tender.amount_minor)}</td>
              </MiniRow>
            )
          })}
          <MiniRow className="[&>td]:border-t [&>td]:border-hairline [&>td]:font-medium">
            <td>Captured by this till</td>
            <td />
            <td>{money(total)}</td>
          </MiniRow>
        </MiniTable>
      </Card>

      <Banner tone="info" className="mt-3">
        This is what the terminal captured, not what the bank paid. The node
        behind this counter has no line to an acquirer and no settlement file:
        it cannot say which of these landed, on what date, or net of what fee.
        That confirmation is done at head office against the bank statement, and
        nothing on this screen should be read as it.
      </Banner>

      <p className="mt-3 text-meta text-mute">
        The till captures an approval code with each card or QRIS tender and
        keeps it on the sale, where it prints on the receipt. These figures are
        grouped by method, which is all this node's report answers — so the
        code-by-code list a bank match needs is read receipt by receipt, on
        Reports.
      </p>

      {cash !== undefined && (
        <p className="mt-2.5 text-meta text-mute">
          Cash taken in this span —{" "}
          <span className="tabular-nums">
            {money(cash.amount_minor)} across {units(cash.count)}{" "}
            {cash.count === 1 ? "tender" : "tenders"}
          </span>{" "}
          — is deliberately not in this table. It is banknotes, and banknotes
          are counted in the drawer above. That half is one shift and this one
          is a calendar span, so the two are not meant to add up.
        </p>
      )}
    </>
  )
}
