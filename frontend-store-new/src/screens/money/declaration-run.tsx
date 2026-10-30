import { Check, X } from "lucide-react"
import { useState } from "react"
import { createPortal } from "react-dom"

import { useSite } from "@/components/shell/sidebar"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"
import {
  cashColumns,
  cashPartsOf,
  cashTargetOf,
  declareCash,
  machineFor,
  machinesOf,
  paymentsOf,
  saveNote,
  slipsOf,
  useDeclarations,
  useShiftSales,
  type ShiftDeclaration,
} from "@/lib/queries/money-declaration"
import {
  stageOf,
  usePeople,
  useSessions,
  type Session,
} from "@/lib/queries/sessions"
import { useIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"
import {
  CashReceiptsSheet,
  DepositsSheet,
} from "@/screens/money/declaration-cash"
import { DeclareEdcSheet, EdcTransactionsSheet } from "@/screens/money/declaration-edc"
import { Capsule } from "@/screens/money/declaration-parts"
import { rowDay, slips } from "@/screens/money/declaration-words"
import {
  PrintClosing,
  type ClosingFigures,
} from "@/screens/money/declaration-print"
import { clock } from "@/screens/money/sales-words"
import { money, units } from "@itulah/contract/money"

/// One business day's money declaration, full screen: the day's cashiers down
/// the left, one cashier at a time in the middle. A cashier is closed — a
/// green check on the left, a green stamp on the page — the moment the admin's
/// Declare cash and Declare EDC have both gone through. There is no submit:
/// Back and Next only move between cashiers.

const hoursOf = (report: Session["report"]): string =>
  `${clock(report.opened_at)}–${report.closed_at === null ? "Open" : clock(report.closed_at)}`

/// One line of a cashier's page: a name, two figures, and a button.
const LINE =
  "grid min-h-[3.75rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-hairline py-2 tabular-nums md:grid-cols-[minmax(0,1fr)_8.75rem_8.75rem_9.375rem]"

const BARE = "md:grid-cols-[minmax(0,1fr)_8.75rem_8.75rem]"

function Line({
  name,
  sub,
  a,
  b,
  button,
  bare = false,
}: {
  name: React.ReactNode
  sub?: React.ReactNode
  a?: React.ReactNode
  b?: React.ReactNode
  button?: React.ReactNode
  /// No button column: the figures stand at the right edge.
  bare?: boolean
}) {
  return (
    <div className={cn(LINE, bare && BARE)}>
      <div className="min-w-0">
        <div className="text-text">{name}</div>
        {sub !== undefined && (
          <div className="mt-0.5 text-meta whitespace-nowrap text-mute">
            {sub}
          </div>
        )}
      </div>
      <div className="text-right whitespace-nowrap max-md:hidden">{a}</div>
      <div className="text-right whitespace-nowrap">{b}</div>
      {!bare && (
        <div className="flex justify-end max-md:col-span-2 max-md:justify-start">
          {button}
        </div>
      )}
    </div>
  )
}

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-2 text-[0.9375rem] font-semibold text-body">{children}</h3>
)

function CashierPage({
  day,
  session,
  name,
  admin,
  declaration,
}: {
  day: string
  session: Session
  name: string
  admin: string
  declaration: ShiftDeclaration | undefined
}) {
  const report = session.report
  const sales = useShiftSales(report.shift_id)
  const site = useSite()
  const payments = paymentsOf(sales.data ?? [])
  const machines = machinesOf(session, payments)
  const selling = stageOf(report) === "selling"
  const closed = declaration?.closedAt !== undefined

  const [sheet, setSheet] = useState<
    null | "edc" | "receipts" | "deposits" | "transactions"
  >(null)
  const [txMachine, setTxMachine] = useState<{
    id: string
    name: string
  } | null>(null)
  // A sheet that holds typing is started afresh each time it opens.
  const [generation, setGeneration] = useState(0)
  const show = (next: "edc" | "receipts" | "deposits" | "transactions") => {
    setGeneration((was) => was + 1)
    setSheet(next)
  }
  const hide = () => setSheet(null)

  const columns = cashColumns(report, clock)
  const target = cashTargetOf(report)
  const deposits = columns
    .filter((one) => one.label !== "Closing")
    .reduce((sum, one) => sum + one.amount, 0)
  const closing = columns.find((one) => one.label === "Closing")?.amount ?? null
  const onHand = closing === null ? null : deposits + closing

  // The cash parts, and what the drawer should hold: the node's own
  // expectation (float + every movement + cash taken − change − cash refunds).
  const parts = cashPartsOf(report)
  const should = report.expected_cash_minor
  const counted = report.declared_cash_minor
  const [typed, setTyped] = useState("")
  const typedAmount = Number(typed) || 0
  const level = typed !== "" && typedAmount === should

  const lines = machines.map((machine) => {
    const on = payments.filter(
      (one) => machineFor(one, declaration) === machine.id,
    )
    const counted =
      slipsOf(report).find(
        (line) => line.machine_id.trim().toUpperCase() === machine.id,
      )?.slips ?? null
    return {
      ...machine,
      count: on.length,
      amount: on.reduce((sum, one) => sum + one.amount, 0),
      counted,
    }
  })
  // A machine with no payment on it and no slips handed in has nothing to show.
  const used = lines.filter((one) => one.count > 0 || (one.counted ?? 0) > 0)

  const figures: ClosingFigures = {
    shop: site,
    cashier: name,
    admin,
    opened: new Date(report.opened_at),
    openingFloat: report.opening_float_minor,
    sales: report.sales_total_minor,
    returns: report.cash_refunds_minor + report.non_cash_refunds_minor,
    cash: target,
    edc: used.map((one) => ({ name: one.name, amount: one.amount })),
    deposits,
    closing: closing ?? 0,
    counted: declaration?.cash?.total ?? onHand ?? 0,
    pieces: Object.fromEntries(
      [
        ...new Set(
          columns.flatMap((one) => Object.keys(one.pieces).map(Number)),
        ),
      ].map((value) => [
        value,
        columns.reduce((sum, one) => sum + (one.pieces[value] ?? 0), 0),
      ]),
    ),
    closed,
  }

  return (
    <div className="relative">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink">
            {name}
          </h2>
          <p className="mt-1 text-body tabular-nums">
            {rowDay(day)} · {hoursOf(report)}
          </p>
        </div>
        <PrintClosing figures={figures} />
      </div>
      {closed && declaration !== undefined && (
        <div
          aria-label={`Closed ${declaration.closedAt}`}
          className="stamp-in pointer-events-none absolute top-[5.5rem] right-0 z-[2] flex -rotate-[8deg] flex-col items-center gap-0.5 rounded-[10px] border-[3px] border-double border-ok-fg bg-canvas/85 px-[1.125rem] py-2 text-ok-fg md:right-6"
        >
          <b className="text-[1.5rem] leading-none font-extrabold tracking-[0.14em]">
            CLOSED
          </b>
          <span className="text-meta font-semibold tabular-nums">
            {declaration.closedAt} · {declaration.closedBy}
          </span>
        </div>
      )}

      <section>
        <Heading>Cash</Heading>
        <Line name="Opening float" b={money(report.opening_float_minor)} />
        {parts.added.length > 0 && (
          <Line
            name="Float added"
            sub={parts.added.map((one) => clock(one.at)).join(" · ")}
            b={`+${money(parts.addedTotal)}`}
          />
        )}
        <Line
          name="Cash sales"
          b={money(target)}
          button={<Capsule onClick={() => show("receipts")}>Receipts</Capsule>}
        />
        <Line
          name="Temporary deposits"
          sub={
            parts.drops.length === 0
              ? "None"
              : parts.drops.map((one) => clock(one.at)).join(" · ")
          }
          b={
            parts.drops.length === 0
              ? money(0)
              : `−${money(parts.dropsTotal)}`
          }
          button={
            parts.drops.length === 0 ? undefined : (
              <Capsule onClick={() => show("deposits")}>Deposits</Capsule>
            )
          }
        />
        <div className={cn(LINE, "border-t-2 border-t-ink")}>
          <div className="font-bold text-ink">Should be in the drawer</div>
          <div className="max-md:hidden" />
          <div className="text-right font-bold whitespace-nowrap text-ink">
            {money(should)}
          </div>
          <div className="max-md:hidden" />
        </div>
        <Line
          name="Cashier closing"
          sub={
            counted === null
              ? "Not closed yet"
              : `Counted at ${clock(report.closed_at)}`
          }
          b={
            counted === null ? (
              <span className="text-mute">Cashier still open</span>
            ) : (
              <span className={cn(counted !== should && "text-bad-fg")}>
                {money(counted)}
              </span>
            )
          }
        />
        {declaration?.cash !== undefined ? (
          <Line
            name="Admin count"
            sub={`Declared ${declaration.cash.at} · ${declaration.cash.by ?? admin}`}
            b={<b className="text-ink">{money(declaration.cash.total)}</b>}
          />
        ) : (
          <div className={cn(LINE, "min-h-[4.75rem]")}>
            <div className="font-bold text-ink">Admin count</div>
            <div className="max-md:col-span-2 md:col-span-2">
              <label
                className={cn(
                  "flex h-[2.9375rem] items-center gap-2 rounded-inner border bg-canvas px-3 focus-within:ring-2",
                  typed !== "" && !level
                    ? "border-bad-fg focus-within:ring-bad-fg/25"
                    : "border-hairline-2 focus-within:border-accent focus-within:ring-accent/30",
                )}
              >
                <span className="text-body">Rp</span>
                <input
                  inputMode="numeric"
                  placeholder="0"
                  aria-label="Admin count"
                  disabled={selling || counted === null}
                  value={typed === "" ? "" : units(typedAmount)}
                  onChange={(event) =>
                    setTyped(
                      event.target.value
                        .replace(/\D/g, "")
                        .replace(/^0+/, "")
                        .slice(0, 10),
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && level)
                      declareCash(report.shift_id, typedAmount, admin)
                  }}
                  className="w-full min-w-0 bg-transparent text-right text-[1.25rem] font-bold tabular-nums outline-none"
                />
              </label>
            </div>
            <div className="flex justify-end max-md:col-span-2">
              <Button
                variant="primary"
                className="rounded-full px-4"
                disabled={!level}
                onClick={() => declareCash(report.shift_id, typedAmount, admin)}
              >
                Declare cash
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="mt-10">
        <Heading>EDC</Heading>
        <div className="hidden min-h-9 grid-cols-[minmax(0,1fr)_8.75rem_8.75rem_9.375rem] items-center gap-x-4 border-b border-hairline pb-1.5 text-body md:grid">
          <div />
          <div className="text-right">Cashier slip</div>
          <div className="text-right">In system</div>
          <div />
        </div>
        {used.map((one) => (
          <Line
            key={one.id}
            name={`EDC ${one.name}`}
            sub={money(one.amount)}
            a={
              one.counted === null ? (
                <span className="text-mute">—</span>
              ) : (
                <span
                  className={cn(one.counted !== one.count && "text-bad-fg")}
                >
                  {slips(one.counted)}
                </span>
              )
            }
            b={slips(one.count)}
            button={
              <Capsule
                onClick={() => {
                  setTxMachine({ id: one.id, name: one.name })
                  show("transactions")
                }}
              >
                Transactions
              </Capsule>
            }
          />
        ))}
        {used.length === 0 && (
          <div className="border-b border-hairline py-4 text-mute">
            {sales.isPending
              ? "Reading the Payments…"
              : "No Card or QRIS Payments"}
          </div>
        )}
        <div className="mt-3.5 flex min-h-[1.875rem] items-center justify-end gap-3.5">
          {selling ? null : declaration?.edc !== undefined ? (
            <span className="text-mute">Verified</span>
          ) : (
            <Button
              variant="primary"
              className="rounded-full px-4"
              disabled={!sales.isSuccess}
              onClick={() => show("edc")}
            >
              Declare EDC
            </Button>
          )}
        </div>
      </section>

      <section className="mt-10">
        <Heading>Notes</Heading>
        {closed ? (
          <p className="whitespace-pre-wrap text-text">
            {declaration?.note?.trim() ? (
              declaration.note
            ) : (
              <span className="text-mute">No Notes</span>
            )}
          </p>
        ) : (
          <textarea
            rows={3}
            defaultValue={declaration?.note ?? ""}
            onBlur={(event) => saveNote(report.shift_id, event.target.value)}
            aria-label="Notes"
            className="w-full resize-y rounded-inner border border-hairline-2 bg-canvas px-3 py-2 text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        )}
      </section>

      <CashReceiptsSheet
        session={session}
        name={name}
        open={sheet === "receipts"}
        onClose={hide}
      />
      <DepositsSheet
        session={session}
        name={name}
        open={sheet === "deposits"}
        onClose={hide}
      />
      <EdcTransactionsSheet
        session={session}
        name={name}
        machine={txMachine}
        open={sheet === "transactions"}
        onClose={hide}
      />
      <DeclareEdcSheet
        key={`edc-${generation}`}
        session={session}
        name={name}
        admin={admin}
        open={sheet === "edc"}
        onClose={hide}
      />
    </div>
  )
}

export function MoneyDeclarationRun({
  day,
  onClose,
}: {
  day: string
  onClose: () => void
}) {
  const sessions = useSessions(day)
  const people = usePeople()
  const identity = useIdentity()
  const declarations = useDeclarations()
  const admin = identity.data?.display_name ?? "Admin"
  const list = sessions.data?.sessions ?? []
  const [at, setAt] = useState(0)
  const index = Math.min(at, Math.max(0, list.length - 1))
  const session = list[index]
  const last = index === list.length - 1
  const go = (next: number) => {
    setAt(next)
    document.getElementById("declaration-main")?.scrollTo(0, 0)
  }

  return createPortal(
    <div
      role="dialog"
      aria-label="Money Declaration"
      className="fixed inset-0 z-[35] flex flex-col bg-canvas"
    >
      <header className="flex h-[3.75rem] shrink-0 items-center gap-3 border-b border-hairline px-5">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-10 place-items-center rounded-inner text-ink transition-colors hover:bg-soft-2"
        >
          <X className="size-5" />
        </button>
        <b className="text-title font-semibold">Money Declaration</b>
        <span className="text-mute">{rowDay(day)}</span>
        <span className="flex-1" />
        {list.length > 0 && (
          <span className="text-mute tabular-nums">
            Cashier {index + 1} of {list.length}
          </span>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Cashiers"
          className="hidden w-[18.75rem] shrink-0 flex-col gap-1 overflow-y-auto border-r border-hairline bg-soft p-3.5 md:flex"
        >
          {list.map((one, n) => {
            const done =
              declarations[one.report.shift_id]?.closedAt !== undefined
            const on = n === index
            return (
              <button
                key={one.report.shift_id}
                type="button"
                aria-current={on ? "step" : undefined}
                onClick={() => go(n)}
                className={cn(
                  "flex w-full items-center gap-3.5 rounded-card px-3 py-3 text-left transition-colors duration-(--t-hover)",
                  on
                    ? "bg-canvas shadow-[0_0_0_1.5px_var(--accent),0_2px_8px_rgb(16_24_40/8%)]"
                    : "hover:bg-soft-2",
                )}
              >
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full border-[1.5px] font-semibold tabular-nums",
                    done
                      ? "border-ok-fg bg-ok-fg text-white"
                      : on
                        ? "border-accent bg-accent text-white"
                        : "border-hairline-2 bg-canvas text-body",
                  )}
                >
                  {done ? <Check className="size-4" /> : n + 1}
                </span>
                <span className="truncate font-semibold text-ink">
                  {people.nameOf(one.report.opened_by)}
                </span>
              </button>
            )
          })}
        </nav>
        <div
          id="declaration-main"
          className="flex min-w-0 flex-1 flex-col overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-[47.5rem] flex-1 px-4 pt-6 pb-12 md:px-8 md:pt-10">
            {session === undefined ? (
              <EmptyState>
                {sessions.isPending
                  ? "Reading the Cashiers…"
                  : "No Cashier Opened This Day"}
              </EmptyState>
            ) : (
              <CashierPage
                key={session.report.shift_id}
                day={day}
                session={session}
                name={people.nameOf(session.report.opened_by)}
                admin={admin}
                declaration={declarations[session.report.shift_id]}
              />
            )}
          </div>
          {/* Moving between cashiers is navigation, not an action: white. */}
          <footer className="sticky bottom-0 shrink-0 border-t border-hairline bg-canvas/95 backdrop-blur-[8px]">
            <div className="mx-auto flex max-w-[47.5rem] justify-between gap-3 px-4 py-3.5 md:px-8">
              {index > 0 ? (
                <Button onClick={() => go(index - 1)}>Back</Button>
              ) : (
                <span />
              )}
              {last || list.length === 0 ? (
                <Button onClick={onClose}>Done</Button>
              ) : (
                <Button onClick={() => go(index + 1)}>Next</Button>
              )}
            </div>
          </footer>
        </div>
      </div>
    </div>,
    document.body,
  )
}
