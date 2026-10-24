import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Card } from "@/components/ui/card"
import { CardList } from "@/components/ui/card-list"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { LeadCard } from "@/components/ui/lead-card"
import type { ListColumn } from "@/components/ui/list-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Status } from "@/components/ui/pill"
import { Banner, EmptyState } from "@/components/ui/states"
import { dayTakingsQuery, isoDay, type SalesWindow } from "@/lib/queries"
import {
  stageOf,
  usePeople,
  useSessions,
  type Session,
} from "@/lib/queries/sessions"
import { queryState } from "@/lib/query-state"
import { tenderOf as kindOf } from "@/screens/money/format"
import { MoneyScreen, Rows, TwoLine } from "@/screens/money/parts"
import { ReconSheet } from "@/screens/money/reconciliation-sheet"
import { DayControl } from "@/screens/money/sales-day"
import { ReceiptSheet } from "@/screens/money/sales-session"
import { useSlot } from "@/screens/money/sales-slot"
import { differenceWord, tenderWord } from "@/screens/money/sales-words"
import { money, units } from "@itulah/contract/money"

/// Did the money this shop rang up turn into money this shop holds?
///
/// The owner asked for it in one sentence — *"menu rekonsiliasi penjualan,
/// bedakan rekonsiliasi uang cash dan uang debit/digital, ini dari penjualan
/// ya"* — and the instruction to keep the two apart is the entire design. They
/// are two different questions, answered by two different people, against two
/// different pieces of evidence:
///
///   **Cash** is settled by a person, here, tonight: the drawer against what
///   the cashier counted. It is read session by session — one card for each
///   cashier's shift — and a card opens the session by tender, with the cash
///   traced from the drawer to the safe.
///
///   **Card, QRIS and the rest** are settled by somebody else, days later,
///   somewhere this node cannot see. The till captured them; an acquirer paid
///   them, or did not, net of a fee, into an account this node has never been
///   told about. **There is no settlement file behind this counter.** So this
///   half reports capture and says so, and there is deliberately no "matched"
///   anywhere on it — a green tick this node cannot earn is worse than no tick,
///   because somebody stops chasing.
///
/// **Read-only, by design.** Drops, counts and the close happen where the
/// drawer is. This is the noun to those verbs: what the takings were made of,
/// and which parts of them are confirmed.

type Tab = "cash" | "digital"

export function Reconciliation() {
  const [tab, setTab] = useState<Tab>("cash")
  const [day, setDay] = useState(() => isoDay(new Date()))
  const sessions = useSessions(day)
  const captured = useQuery({
    ...dayTakingsQuery(day),
    refetchInterval: 30_000,
  })
  const people = usePeople()
  const opened = useSlot<string>()
  const receipt = useSlot<string>()

  const all = sessions.data?.sessions ?? []
  const sheet =
    opened.value === null
      ? undefined
      : all.find((one) => one.report.shift_id === opened.value)
  const digital = (captured.data?.tenders ?? []).filter(
    (one) => one.method !== "CASH",
  )

  return (
    <MoneyScreen actions={<DayControl day={day} onChange={setDay} />}>
      <PeopleTabs<Tab>
        value={tab}
        onChange={setTab}
        title="Show"
        tabs={[
          { value: "cash", label: "Cash", count: all.length },
          {
            value: "digital",
            label: "Card & QRIS",
            count: digital.reduce((sum, one) => sum + one.count, 0),
          },
        ]}
      />

      {tab === "cash"
        ? queryState(sessions, {
            loading: "Reading the sessions…",
            render: (data) =>
              data.blind ? (
                <Banner tone="warn">
                  Hidden from cashiers. Sign in as a supervisor.
                </Banner>
              ) : data.sessions.length === 0 ? (
                <Card>
                  <EmptyState>
                    {day === isoDay(new Date())
                      ? "No POS opened today."
                      : "No POS opened this day."}
                  </EmptyState>
                </Card>
              ) : (
                <CardList>
                  {data.sessions.map((session) => (
                    <SessionCard
                      key={session.report.shift_id}
                      session={session}
                      name={people.nameOf(session.report.opened_by)}
                      onOpen={() => opened.show(session.report.shift_id)}
                    />
                  ))}
                </CardList>
              ),
          })
        : queryState(captured, {
            loading: "Reading the payments…",
            render: (taken) => (
              <Captured taken={taken} today={isoDay(new Date()) === day} />
            ),
          })}

      {sheet !== undefined && (
        <ReconSheet
          session={sheet}
          open={opened.open}
          onClose={opened.hide}
          onOpenReceipt={receipt.show}
        />
      )}
      <ReceiptSheet
        saleId={receipt.value}
        open={receipt.open}
        onClose={receipt.hide}
      />
    </MoneyScreen>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Cash

/// One session: whose, which of the day, what it sold — and where the drawer
/// stands against what its cashier counted.
function SessionCard({
  session,
  name,
  onOpen,
}: {
  session: Session
  name: string
  onOpen: () => void
}) {
  const report = session.report
  const stage = stageOf(report)
  const difference = report.variance_minor ?? 0
  return (
    <LeadCard
      title={name}
      lines={[`Session ${session.number} · ${report.terminal_label}`]}
      lead={{ figure: money(report.sales_total_minor), caption: "Total sales" }}
      foot={{
        info:
          stage === "counted"
            ? `Declared ${money(report.declared_cash_minor ?? 0)}`
            : undefined,
        status:
          stage === "selling" ? (
            <Status tone="info">Selling</Status>
          ) : stage === "undeclared" ? (
            <Status tone="warn">Not declared</Status>
          ) : difference === 0 ? (
            <Status tone="ok">Even</Status>
          ) : (
            <Status tone={difference < 0 ? "bad" : "warn"}>
              {differenceWord(difference)} {money(Math.abs(difference))}
            </Status>
          ),
      }}
      onOpen={onOpen}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Everything that is not cash

/// One row of the capture table: a tender.
interface CaptureLine {
  readonly method: string
  readonly count: number
  readonly amount_minor: number
  readonly share: number
}

/// What the terminal captured, and nothing it cannot know.
///
/// Read from `sales/window`, which groups `sale_tender` by method over the day —
/// completed sales only, so a voided card sale is not chased with an acquirer
/// that was never asked for the money.
function Captured({ taken, today }: { taken: SalesWindow; today: boolean }) {
  const nonCash = taken.tenders.filter((tender) => tender.method !== "CASH")
  const total = nonCash.reduce((sum, tender) => sum + tender.amount_minor, 0)
  const count = nonCash.reduce((sum, tender) => sum + tender.count, 0)

  if (taken.sales.count === 0) {
    return (
      <Card>
        <EmptyState>
          {today ? "No sales today." : "No sales this day."}
        </EmptyState>
      </Card>
    )
  }
  if (nonCash.length === 0) {
    return (
      <Card>
        <EmptyState>
          {today
            ? "No card or QRIS payment today."
            : "No card or QRIS payment this day."}
        </EmptyState>
      </Card>
    )
  }

  const lines: readonly CaptureLine[] = nonCash.map((tender) => ({
    method: tender.method,
    count: tender.count,
    amount_minor: tender.amount_minor,
    share: total === 0 ? 0 : tender.amount_minor / total,
  }))

  return (
    <>
      <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
        <Kpi
          label="Card & QRIS"
          value={money(total)}
          delta={`${units(count)} ${count === 1 ? "payment" : "payments"}`}
        />
        {lines.slice(0, 3).map((line) => (
          <Kpi
            key={line.method}
            label={tenderWord(line.method)}
            value={money(line.amount_minor)}
            delta={`${units(line.count)} ${line.count === 1 ? "payment" : "payments"}`}
          />
        ))}
      </KpiStrip>
      <Rows
        title="By method"
        rows={lines}
        columns={CAPTURE_COLUMNS}
        rowKey={(line) => line.method}
        empty="Nothing captured."
        card={(line) => ({
          title: tenderWord(line.method),
          lead: {
            figure: money(line.amount_minor),
            caption: `${Math.round(line.share * 100)}%`,
          },
          foot: {
            info: `${units(line.count)} ${line.count === 1 ? "payment" : "payments"}`,
          },
        })}
      />
    </>
  )
}

const CAPTURE_COLUMNS: readonly ListColumn<CaptureLine>[] = [
  {
    id: "method",
    header: "Paid by",
    className: "min-w-[12rem]",
    cell: (line) => (
      <TwoLine icon={kindOf(line.method).icon} top={tenderWord(line.method)} />
    ),
  },
  {
    id: "payments",
    header: "Payments",
    align: "right",
    className: "tabular-nums",
    cell: (line) => units(line.count),
  },
  {
    id: "share",
    header: "Share",
    align: "right",
    className: "tabular-nums max-md:hidden",
    cell: (line) => `${Math.round(line.share * 100)}%`,
  },
  {
    id: "captured",
    header: "Amount",
    align: "right",
    cell: (line) => (
      <span className="font-medium text-ink tabular-nums">
        {money(line.amount_minor)}
      </span>
    ),
  },
]
