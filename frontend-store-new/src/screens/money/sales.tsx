import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"

import { Card } from "@/components/ui/card"
import { CardList } from "@/components/ui/card-list"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { LeadCard } from "@/components/ui/lead-card"
import { Status } from "@/components/ui/pill"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { dayTakingsQuery, isoDay } from "@/lib/queries"
import {
  dayOf,
  droppedOf,
  newestFirst,
  stageOf,
  toDropOf,
  useCashMovement,
  usePeople,
  useSessions,
  type Session,
} from "@/lib/queries/sessions"
import { queryState } from "@/lib/query-state"
import { dayTitle } from "@/screens/money/format"
import { MoneyScreen } from "@/screens/money/parts"
import { DayControl } from "@/screens/money/sales-day"
import { CountSheet, DropSheet, type Dropped } from "@/screens/money/sales-drop"
import { ReceiptSheet, SessionSheet } from "@/screens/money/sales-session"
import { useSlot } from "@/screens/money/sales-slot"
import { clock, differenceWord } from "@/screens/money/sales-words"
import { money } from "@itulah/contract/money"

/// The day's takings, and the cashier sessions that made them.
///
/// A session is one till shift: a cashier at a seat, from the float counted in
/// to the drawer counted out. The page leads with the day's figures, and under
/// them is ONE full-width card per session — who, which session of that day,
/// and the one number that matters, what it sold. What the foot says follows
/// where the session is:
///
///  - **running** — what has gone to the safe, what is left to send, and the
///    one act this screen has for it: Cash drop.
///  - **ended and counted** — what the cashier declared, and whether the
///    drawer was even, over or short.
///  - **ended, nobody counted it** — Count, for the person who is doing so.
///
/// A card opens its receipts.
///
/// ## What is the node's, and what is not
///
/// Every figure is the node's own (`shifts/*`, `reports/sales/window`). The
/// day's figures count completed sales; a sale that was returned is not netted
/// off them, as everywhere on this node.

export function Sales() {
  const [day, setDay] = useState(() => isoDay(new Date()))
  const sessions = useSessions(day)
  const takings = useQuery({
    ...dayTakingsQuery(day),
    refetchInterval: 30_000,
  })
  const people = usePeople()
  const undo = useCashMovement()

  // One slot per sheet, each by the shift (or sale) it is open on.
  const opened = useSlot<string>()
  const receipt = useSlot<string>()
  const drop = useSlot<string>()
  const count = useSlot<string>()

  const all = sessions.data?.sessions ?? []
  const byId = (id: string | null) =>
    id === null ? undefined : all.find((one) => one.report.shift_id === id)
  const sheet = byId(opened.value)
  const dropping = byId(drop.value)
  const counting = byId(count.value)

  // One toast for this screen: a second save replaces the first and starts
  // the clock again. An Undo stays ten seconds, a plain confirmation five.
  const said = (message: string, undoIt?: () => void) =>
    toast.success(message, {
      id: "money-sales",
      duration: undoIt === undefined ? 5_000 : 10_000,
      action:
        undoIt === undefined ? undefined : { label: "Undo", onClick: undoIt },
    })

  const dropped = (done: Dropped) => {
    drop.hide()
    opened.hide()
    said(`${money(done.amount)} dropped · ${firstName(done.cashier)}`, () =>
      undo.mutate({
        shiftId: done.shiftId,
        kind: "PICKUP",
        amountMinor: done.amount,
        reason: `Cash drop undone · ${done.by}`,
      }),
    )
  }

  const sale = takings.data
  const tender = (method: string) =>
    sale?.tenders.find((one) => one.method === method)
  const payments = (method: string) => {
    const n = tender(method)?.count ?? 0
    return n === 0 ? undefined : `${n} ${n === 1 ? "payment" : "payments"}`
  }

  return (
    <MoneyScreen actions={<DayControl day={day} onChange={setDay} />}>
      <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
        <Kpi
          label="Takings"
          value={sale === undefined ? "—" : money(sale.sales.gross_minor)}
          delta={
            sale === undefined
              ? undefined
              : sale.sales.count === 0
                ? "No sales"
                : `${plural(all.length, "session")} · ${plural(sale.sales.count, "sale")}`
          }
        />
        <Kpi
          label="Cash"
          value={sale === undefined ? "—" : money(sale.cash_expected_minor)}
          delta={payments("CASH")}
        />
        <Kpi
          label="Card"
          value={money(tender("CARD")?.amount_minor ?? 0)}
          delta={payments("CARD")}
        />
        <Kpi
          label="QRIS"
          value={money(tender("QRIS")?.amount_minor ?? 0)}
          delta={payments("QRIS")}
        />
      </KpiStrip>

      <Problem error={undo.error} className="mb-4" />

      {queryState(sessions, {
        loading: "Reading the sessions…",
        render: (data) =>
          data.blind ? (
            <Banner tone="warn">
              Hidden from cashiers. Sign in as a supervisor.
            </Banner>
          ) : data.sessions.length === 0 ? (
            <Card>
              <EmptyState>
                {(sale?.sales.count ?? 0) > 0
                  ? "No session found for this day."
                  : day === isoDay(new Date())
                    ? "No sales today."
                    : "No sales this day."}
              </EmptyState>
            </Card>
          ) : (
            <CardList>
              {newestFirst(data.sessions).map((session) => (
                <SessionCard
                  key={session.report.shift_id}
                  session={session}
                  name={people.nameOf(session.report.opened_by)}
                  onOpen={() => opened.show(session.report.shift_id)}
                  onDrop={() => drop.show(session.report.shift_id)}
                  onCount={() => count.show(session.report.shift_id)}
                />
              ))}
            </CardList>
          ),
      })}

      {sheet !== undefined && (
        <SessionSheet
          session={sheet}
          open={opened.open}
          onClose={opened.hide}
          onOpenReceipt={receipt.show}
          onDrop={() => drop.show(sheet.report.shift_id)}
          onCount={() => count.show(sheet.report.shift_id)}
        />
      )}
      <ReceiptSheet
        saleId={receipt.value}
        open={receipt.open}
        onClose={receipt.hide}
      />
      {dropping !== undefined && (
        <DropSheet
          key={drop.generation}
          session={dropping}
          open={drop.open}
          onClose={drop.hide}
          onDropped={dropped}
        />
      )}
      {counting !== undefined && (
        <CountSheet
          key={count.generation}
          session={counting}
          open={count.open}
          onClose={count.hide}
          onCounted={(message) => {
            count.hide()
            opened.hide()
            said(message)
          }}
        />
      )}
    </MoneyScreen>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

const firstName = (name: string) => name.split(" ")[0] ?? name

/// What a card's foot says, as figures: a name, then its number.
function Tend({ items }: { items: readonly [string, string][] }) {
  return (
    <span className="flex flex-wrap gap-x-5 gap-y-1 tabular-nums">
      {items.map(([label, value]) => (
        <span key={label} className="whitespace-nowrap">
          {label}
          <b className="ml-1.5 font-medium text-ink">{value}</b>
        </span>
      ))}
    </span>
  )
}

function SessionCard({
  session,
  name,
  onOpen,
  onDrop,
  onCount,
}: {
  session: Session
  name: string
  onOpen: () => void
  onDrop: () => void
  onCount: () => void
}) {
  const report = session.report
  const stage = stageOf(report)
  const difference = report.variance_minor ?? 0

  const foot =
    stage === "selling"
      ? {
          info: (
            <Tend
              items={[
                ["Dropped", money(droppedOf(report))],
                ["To drop", money(toDropOf(report))],
              ]}
            />
          ),
          action: { label: "Cash drop", onClick: onDrop },
        }
      : stage === "undeclared"
        ? {
            info: (
              <span>
                Ended {clock(report.closed_at)} ·{" "}
                <span className="text-warn-fg">not declared</span>
              </span>
            ),
            action: { label: "Count", onClick: onCount },
          }
        : {
            info: (
              <Tend
                items={[
                  ["Ended", clock(report.closed_at)],
                  ["Declared", money(report.declared_cash_minor ?? 0)],
                ]}
              />
            ),
            status:
              difference === 0 ? (
                <Status tone="ok">Even</Status>
              ) : (
                <Status tone={difference < 0 ? "bad" : "warn"}>
                  {differenceWord(difference)} {money(Math.abs(difference))}
                </Status>
              ),
          }

  return (
    <LeadCard
      title={name}
      lines={[`${dayTitle(dayOf(report))} · Session ${session.number}`]}
      lead={{ figure: money(report.sales_total_minor), caption: "Total sales" }}
      foot={foot}
      onOpen={onOpen}
    />
  )
}
