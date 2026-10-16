import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Select, Textarea } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { Problem } from "@/components/ui/states"
import {
  cashSalesOf,
  dayOf,
  droppedOf,
  dropsOf,
  toDropOf,
  useCashMovement,
  useCountShift,
  usePeople,
  type Session,
} from "@/lib/queries/sessions"
import {
  DenominationTable,
  countedOf,
  totalOf,
  type Pieces,
} from "@/screens/money/sales-count"
import { FigureStrip } from "@/screens/money/sales-facts"
import { differenceTone, differenceWord } from "@/screens/money/sales-words"
import { dayTitle } from "@/screens/money/format"
import { money } from "@itulah/contract/money"

/// The two things a person does to a drawer by counting it.
///
///  - **Cash drop** — a running drawer hands its takings to the safe. Who
///    received them is chosen by hand and starts empty, because a drop with no
///    name on it cannot be asked about later. The notes and coins are counted
///    into the form and the total is what leaves the drawer.
///  - **Count** — a drawer that ended with nobody having counted it (its holder
///    left the seat to somebody else) is counted by the person doing this, and
///    the node works the difference out against what it expected.
///
/// Both are forms that fit one screen: the figures and the person on top, the
/// notes left and the coins right, the total in the foot with the one button.

/// What a drop did, for the toast that offers to take it back.
export interface Dropped {
  readonly shiftId: string
  readonly amount: number
  readonly by: string
  readonly cashier: string
}

export function DropSheet({
  session,
  open,
  onClose,
  onDropped,
}: {
  session: Session
  open: boolean
  onClose: () => void
  onDropped: (done: Dropped) => void
}) {
  const people = usePeople()
  const drop = useCashMovement()
  const [by, setBy] = useState("")
  const [pieces, setPieces] = useState<Pieces>({})

  const report = session.report
  const cashier = people.nameOf(report.opened_by)
  const total = totalOf(pieces)
  // A drawer cannot hand over more than the node says is in it.
  const inDrawer = report.expected_cash_minor
  const over = total > inDrawer
  const ready = total > 0 && !over && by !== "" && !drop.isPending
  const receivers = people.names.filter((name) => name !== cashier)
  const drops = dropsOf(report).filter((one) => one.kind === "DROP")

  const submit = () =>
    drop.mutate(
      {
        shiftId: report.shift_id,
        kind: "DROP",
        amountMinor: total,
        reason: "Cash drop",
        receiver: by,
        counted: countedOf(pieces),
      },
      {
        onSuccess: () =>
          onDropped({ shiftId: report.shift_id, amount: total, by, cashier }),
      },
    )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      width="wide"
      id={`${cashier} · Session ${session.number}`}
      title="Cash drop"
      footer={
        <div className="flex flex-col gap-2">
          <Problem error={drop.error} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="mr-auto flex flex-col leading-tight tabular-nums">
              <span className="text-meta text-mute">Cash drop</span>
              <b className="text-[1.25rem] tracking-[-0.01em]">
                {money(total)}
              </b>
            </div>
            {over && (
              <span className="text-meta text-bad-fg tabular-nums">
                Only {money(inDrawer)} in the drawer
              </span>
            )}
            <Button
              variant="primary"
              onClick={submit}
              disabled={!ready}
              pending={drop.isPending}
            >
              {drop.isPending
                ? "Dropping…"
                : total > 0
                  ? `Drop ${money(total)}`
                  : "Drop"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <Field label="Received by" required className="w-full max-w-[21rem]">
            <Select aria-label="Received by" value={by} onChange={setBy}>
              <option value="" disabled>
                Choose who received it
              </option>
              {receivers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <FigureStrip
            items={[
              { label: "Cash sales", value: money(cashSalesOf(report)) },
              {
                label: `Dropped · ${drops.length} ${drops.length === 1 ? "drop" : "drops"}`,
                value: money(droppedOf(report)),
              },
              { label: "To drop", value: money(toDropOf(report)) },
            ]}
          />
        </div>
        <div className="grid items-start gap-4 md:grid-cols-2">
          <DenominationTable
            part="notes"
            pieces={pieces}
            onChange={(key, quantity) =>
              setPieces((was) => ({ ...was, [key]: quantity }))
            }
          />
          <DenominationTable
            part="coins"
            pieces={pieces}
            onChange={(key, quantity) =>
              setPieces((was) => ({ ...was, [key]: quantity }))
            }
          />
        </div>
      </div>
    </Sheet>
  )
}

/// Count a drawer nobody counted.
export function CountSheet({
  session,
  open,
  onClose,
  onCounted,
}: {
  session: Session
  open: boolean
  onClose: () => void
  onCounted: (message: string) => void
}) {
  const people = usePeople()
  const count = useCountShift()
  const [pieces, setPieces] = useState<Pieces>({})
  const [why, setWhy] = useState("")

  const report = session.report
  const cashier = people.nameOf(report.opened_by)
  const total = totalOf(pieces)
  const counted = total > 0
  const difference = total - report.expected_cash_minor
  const ready =
    counted && (difference === 0 || why.trim() !== "") && !count.isPending

  const submit = () =>
    count.mutate(
      {
        shiftId: report.shift_id,
        declaredMinor: total,
        counted: countedOf(pieces),
        note: difference === 0 ? "" : why,
      },
      {
        onSuccess: () =>
          onCounted(
            `${cashier} counted ${money(total)} · ${differenceWord(difference)}`,
          ),
      },
    )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      width="wide"
      id={`${dayTitle(dayOf(report))} · Session ${session.number}`}
      title={`Count drawer · ${cashier}`}
      footer={
        <div className="flex flex-col gap-2">
          <Problem error={count.error} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="mr-auto flex flex-col leading-tight tabular-nums">
              <span className="text-meta text-mute">Counted</span>
              <b className="text-[1.25rem] tracking-[-0.01em]">
                {money(total)}
              </b>
            </div>
            {counted && (
              <span
                className={`text-meta font-medium tabular-nums ${differenceTone(difference)}`}
              >
                {difference === 0
                  ? "Even"
                  : `${differenceWord(difference)} ${money(Math.abs(difference))}`}
              </span>
            )}
            {counted && difference !== 0 && why.trim() === "" && (
              <span className="text-meta text-mute">Say why</span>
            )}
            <Button
              variant="primary"
              onClick={submit}
              disabled={!ready}
              pending={count.isPending}
            >
              {count.isPending
                ? "Saving…"
                : counted
                  ? `Count ${money(total)}`
                  : "Count"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <FigureStrip
          items={[
            {
              label: "Opening float",
              value: money(report.opening_float_minor),
            },
            { label: "Cash sales", value: money(cashSalesOf(report)) },
            {
              label: "Cash drops",
              value: `−${money(droppedOf(report))}`,
            },
            { label: "Expected", value: money(report.expected_cash_minor) },
          ]}
        />
        <div className="grid items-start gap-4 md:grid-cols-2">
          <DenominationTable
            part="notes"
            pieces={pieces}
            onChange={(key, quantity) =>
              setPieces((was) => ({ ...was, [key]: quantity }))
            }
          />
          <DenominationTable
            part="coins"
            pieces={pieces}
            onChange={(key, quantity) =>
              setPieces((was) => ({ ...was, [key]: quantity }))
            }
          />
        </div>
        {counted && difference !== 0 && (
          <Field label="Why" required>
            <Textarea
              rows={3}
              placeholder="What happened"
              value={why}
              onChange={(event) => setWhy(event.target.value)}
            />
          </Field>
        )}
      </div>
    </Sheet>
  )
}
