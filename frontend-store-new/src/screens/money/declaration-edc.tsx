import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import {
  cardFor,
  declareEdc,
  kindFor,
  machineFor,
  machinesOf,
  paymentsOf,
  slipsOf,
  useShiftSales,
  useDeclarations,
  type CardBank,
  type EdcPayment,
} from "@/lib/queries/money-declaration"
import type { Session } from "@/lib/queries/sessions"
import { Checkout, Seg, Tile } from "@/screens/money/declaration-parts"
import { BOX, TD, TH, slips } from "@/screens/money/declaration-words"
import { clock } from "@/screens/money/sales-words"
import { cn } from "@/lib/utils"
import { money } from "@itulah/contract/money"

/// The EDC half of a cashier's declaration: every card and QRIS payment, and
/// the admin puts each on the machine its slip came from.

/// What the cashier's slips say a machine took, when the cashier has counted;
/// else what the POS has.
const slipCount = (session: Session, machine: string, system: number): number =>
  slipsOf(session.report).find(
    (line) => line.machine_id.trim().toUpperCase() === machine,
  )?.slips ?? system

const KINDS = [
  ["Debit", "Debit"],
  ["Credit", "Credit"],
  ["QRIS", "QRIS"],
] as const satisfies readonly (readonly [EdcPayment["kind"], string])[]

const BANKS = [
  ["SAME", "Same bank"],
  ["OTHER", "Other bank"],
] as const satisfies readonly (readonly [CardBank, string])[]

export function DeclareEdcSheet({
  session,
  name,
  admin,
  open,
  onClose,
}: {
  session: Session
  name: string
  admin: string
  open: boolean
  onClose: () => void
}) {
  const sales = useShiftSales(session.report.shift_id)
  const payments = useMemo(
    () =>
      [...paymentsOf(sales.data ?? [])].sort((a, b) =>
        a.at.localeCompare(b.at),
      ),
    [sales.data],
  )
  const machines = machinesOf(session, payments)

  // A machine whose slips come to what the POS has starts filled with the
  // POS's machine. One that does not starts empty for all its payments: there
  // is no telling which is the odd one, so the admin picks each from the slip.
  const level = (machine: string) => {
    const system = payments.filter((one) => one.machine === machine).length
    return slipCount(session, machine, system) === system
  }
  const [picked, setPicked] = useState<Record<string, string>>({})
  const current = (payment: EdcPayment): string | null =>
    picked[payment.key] ?? (level(payment.machine) ? payment.machine : null)

  // Type and Card fixes stay in this draft until Submit (the node has no
  // endpoint to change a payment's kind or bank yet).
  const [kinds, setKinds] = useState<Record<string, EdcPayment["kind"]>>({})
  const [cards, setCards] = useState<Record<string, CardBank>>({})
  const kindOf = (payment: EdcPayment) => kinds[payment.key] ?? payment.kind
  const [filter, setFilter] = useState<string | null>(null)
  const shown =
    filter === null
      ? payments
      : payments.filter(
          (one) => one.machine === filter || current(one) === filter,
        )

  const tally = machines.map((machine) => {
    const on = payments.filter((one) => current(one) === machine.id)
    const system = payments.filter((one) => one.machine === machine.id).length
    const want = slipCount(session, machine.id, system)
    return {
      ...machine,
      got: on.length,
      want,
      amount: on.reduce((sum, one) => sum + one.amount, 0),
    }
  })
  // The switch offers only the machines in play — one the POS put a payment
  // on, or one the cashier handed slips in for. A payment moved onto any other
  // machine could never come level, so offering it is only noise.
  const inPlay = machines.filter((machine) =>
    tally.some(
      (one) =>
        one.id === machine.id &&
        (one.want > 0 || payments.some((p) => p.machine === machine.id)),
    ),
  )
  const ready =
    sales.isSuccess &&
    payments.every((one) => current(one) !== null) &&
    tally.every((one) => one.got === one.want)

  const submit = () => {
    declareEdc(
      session.report.shift_id,
      Object.fromEntries(
        payments.map((one) => [one.key, current(one) ?? one.machine]),
      ),
      admin,
      { kinds, cards },
    )
    onClose()
  }

  const total = shown.reduce((sum, one) => sum + one.amount, 0)
  const closedAt = session.report.closed_at
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Declare EDC"
      caption={`${name} · ${clock(session.report.opened_at)}–${closedAt === null ? "Open" : clock(closedAt)}`}
      className="md:w-[clamp(27.5rem,96vw,82rem)]"
    >
      <Checkout
        table={
          <div className={BOX}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>Time</th>
                  <th className={TH}>Receipt</th>
                  <th className={TH}>EDC</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Card</th>
                  <th className={cn(TH, "text-right")}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((payment) => (
                  <tr key={payment.key}>
                    <td className={TD}>{clock(payment.at)}</td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      {payment.receipt}
                    </td>
                    <td className={TD}>
                      <Seg
                        label="EDC"
                        options={inPlay.map((one) => [one.id, one.name] as const)}
                        current={current(payment) ?? undefined}
                        was={payment.machine}
                        onPick={(id) =>
                          setPicked((was) => ({ ...was, [payment.key]: id }))
                        }
                      />
                    </td>
                    <td className={TD}>
                      <Seg
                        label="Type"
                        options={KINDS}
                        current={kindOf(payment)}
                        was={payment.kind}
                        onPick={(kind) => {
                          setKinds((was) => ({ ...was, [payment.key]: kind }))
                          if (kind === "QRIS")
                            setCards((was) =>
                              Object.fromEntries(
                                Object.entries(was).filter(
                                  ([key]) => key !== payment.key,
                                ),
                              ),
                            )
                        }}
                      />
                    </td>
                    <td className={TD}>
                      {kindOf(payment) === "QRIS" ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <Seg
                          label="Card"
                          options={BANKS}
                          current={cards[payment.key]}
                          was={undefined}
                          onPick={(bank) =>
                            setCards((was) => ({ ...was, [payment.key]: bank }))
                          }
                        />
                      )}
                    </td>
                    <td className={cn(TD, "text-right")}>
                      {money(payment.amount)}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className={cn(TD, "text-center text-mute")}>
                      {sales.isPending
                        ? "Reading the Payments…"
                        : "No Card or QRIS Payments"}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td className={cn(TD, "border-b-0 font-semibold text-ink")}>
                    Total
                  </td>
                  <td className={cn(TD, "border-b-0 text-mute")}>
                    {slips(shown.length)}
                  </td>
                  <td colSpan={4} className={cn(TD, "border-b-0")} />
                  <td
                    className={cn(
                      TD,
                      "border-b-0 text-right font-semibold text-ink",
                    )}
                  >
                    {money(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        }
        rail={
          <>
            {/* A machine with nothing on it and nothing on its slips has
                nothing to check: it keeps its place in the switch, not a tile. */}
            {tally
              .filter((one) => one.want > 0 || one.got > 0 || filter === one.id)
              .map((one) => (
                <Tile
                  key={one.id}
                  label={one.name}
                  figure={`${one.got}/${one.want}`}
                  sub={money(one.amount)}
                  bad={one.got !== one.want}
                  pressed={filter === one.id}
                  onClick={() => setFilter(filter === one.id ? null : one.id)}
                />
              ))}
            <Button
              variant="primary"
              size="lg"
              block
              disabled={!ready}
              onClick={submit}
            >
              Submit
            </Button>
          </>
        }
      />
    </Sheet>
  )
}

/// One machine's payments, as declared: the machine, type and bank the admin
/// set, else what the cashier rang.
export function EdcTransactionsSheet({
  session,
  name,
  machine,
  open,
  onClose,
}: {
  session: Session
  name: string
  machine: { id: string; name: string } | null
  open: boolean
  onClose: () => void
}) {
  const sales = useShiftSales(session.report.shift_id)
  const declaration = useDeclarations()[session.report.shift_id]
  const rows = [...paymentsOf(sales.data ?? [])]
    .filter(
      (one) => machine !== null && machineFor(one, declaration) === machine.id,
    )
    .sort((a, b) => a.at.localeCompare(b.at))
  const total = rows.reduce((sum, one) => sum + one.amount, 0)
  const closedAt = session.report.closed_at
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={`${name} · EDC ${machine?.name ?? ""}`}
      caption={`${clock(session.report.opened_at)}–${closedAt === null ? "Open" : clock(closedAt)}`}
      width="wide"
    >
      <div className={BOX}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>Time</th>
              <th className={TH}>Receipt</th>
              <th className={TH}>Type</th>
              <th className={TH}>Card</th>
              <th className={cn(TH, "text-right")}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((payment) => {
              const kind = kindFor(payment, declaration)
              const bank = cardFor(payment, declaration)
              return (
                <tr key={payment.key}>
                  <td className={TD}>{clock(payment.at)}</td>
                  <td className={TD}>{payment.receipt}</td>
                  <td className={TD}>{kind}</td>
                  <td className={TD}>
                    {kind === "QRIS" || bank === undefined ? (
                      <span className="text-faint">—</span>
                    ) : bank === "SAME" ? (
                      "Same bank"
                    ) : (
                      "Other bank"
                    )}
                  </td>
                  <td className={cn(TD, "text-right")}>
                    {money(payment.amount)}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className={cn(TD, "text-center text-mute")}>
                  {sales.isPending ? "Reading the Payments…" : "No Payments"}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className={cn(TD, "border-b-0 font-semibold text-ink")}>
                Total
              </td>
              <td className={cn(TD, "border-b-0 text-mute")}>
                {slips(rows.length)}
              </td>
              <td colSpan={2} className={cn(TD, "border-b-0")} />
              <td
                className={cn(
                  TD,
                  "border-b-0 text-right font-semibold text-ink",
                )}
              >
                {money(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Sheet>
  )
}
