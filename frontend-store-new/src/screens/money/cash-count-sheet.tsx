import { Plus, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { isoDay } from "@/lib/queries"
import { useRecordCashCount, type StoreCashBox } from "@/lib/queries/cash-count"
import type { ShopPeople } from "@/lib/queries/shop-people"
import { cn } from "@/lib/utils"
import {
  COINS,
  NOTES,
  kasbonSum,
  noteLines,
  reasonOf,
  standing,
  sumOf,
  type Counted,
  type KasBon,
} from "@/screens/money/cash-count-model"
import { Chip, CountReport } from "@/screens/money/cash-count-report"
import { dayYear, minorFrom } from "@/screens/money/format"
import { money } from "@itulah/contract/money"

/// Count the petty cash: notes and coins, the kas bon slips in the box, and who
/// counted — on one wide sheet that fits one screen.
///
/// **The count is blind.** While the notes are being counted the books' figure
/// is nowhere on the sheet; "Done counting" turns the sheet over to the answer,
/// and the only way back is Recount, which empties it. A count that could be
/// nudged until it matched would not be a count. The answer says Even, Short or
/// Over, and a count that is not even cannot be submitted without saying why.
///
/// Who counted is chosen first and is the person who held the notes — not
/// necessarily the person signed in. The node records the person signed in as
/// the one who counted, so a different counter is sent as the witness
/// (`witnessed_by`); how the rest travels is `cash-count-model.ts`.
///
/// On a phone it is one column, and every quantity is entered on the number pad.

interface Slip {
  readonly uid: string
  readonly who: string
  /// Digits, as the `<Money>` field gives them.
  readonly amount: string
}

export function CountSheet({
  box,
  shop,
  people,
  open,
  onClose,
  onDone,
}: {
  box: StoreCashBox
  shop: string
  people: ShopPeople
  open: boolean
  onClose: () => void
  onDone: (said: string) => void
}) {
  const record = useRecordCashCount()
  const [phase, setPhase] = useState<"count" | "result">("count")
  const [by, setBy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<number, number>>({})
  const [coins, setCoins] = useState<Record<number, number>>({})
  const [slips, setSlips] = useState<readonly Slip[]>([])
  const [note, setNote] = useState("")
  const [tried, setTried] = useState(false)

  // The answer opens at its top, whatever the count was scrolled to: the
  // sheet's body is the scroller around this one.
  const frame = useRef<HTMLDivElement>(null)
  useEffect(() => {
    frame.current?.closest(".overflow-y-auto")?.scrollTo({ top: 0 })
  }, [phase])

  const counter =
    people.people.find((one) => one.key === (by ?? people.me?.key)) ?? people.me
  const kasbon: KasBon[] = slips
    .map((slip) => ({
      who: slip.who.trim(),
      amountMinor: minorFrom(slip.amount) ?? 0,
    }))
    .filter((slip) => slip.amountMinor > 0)
  const total = sumOf(notes) + sumOf(coins) + kasbonSum(kasbon)
  const unnamed = kasbon.some((slip) => slip.who === "")
  const difference = total - box.books_minor
  const mustSay = difference !== 0 && note.trim() === ""

  const counted: Counted = {
    notes,
    coins,
    kasbon,
    note: note.trim(),
    countedMinor: total,
    booksMinor: box.books_minor,
  }

  const piece = (set: typeof setNotes, value: number, n: number) =>
    set((was) => ({ ...was, [value]: n }))

  const recount = () => {
    // Emptied, not edited: the answer has been seen.
    setNotes({})
    setCoins({})
    setSlips([])
    setNote("")
    setTried(false)
    record.reset()
    setPhase("count")
  }

  const submit = () => {
    if (mustSay || record.isPending) return
    record.mutate(
      {
        meaning: "petty_cash",
        countedOn: isoDay(new Date()),
        // The node writes the person signed in as the counter; someone else who
        // held the notes goes where it has room for a second name.
        witnessedBy:
          counter !== null &&
          people.me !== null &&
          counter.key !== people.me.key
            ? counter.name
            : "",
        reason: reasonOf({ coins, kasbon, note }),
        notes: noteLines({ notes, coins, kasbon }),
      },
      {
        onSuccess: () => {
          const { word } = standing(difference)
          onDone(
            `Petty cash counted: ${money(total)}${
              difference === 0
                ? ", even"
                : `, ${word.toLowerCase()} ${money(Math.abs(difference))}`
            }.`,
          )
        },
      },
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={`${shop} · ${dayYear(isoDay(new Date()))}`}
      title="Cash count"
      width="wide"
      className="md:w-[min(73.75rem,calc(100vw-2.5rem))]"
      footer={
        phase === "count" ? (
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-col leading-tight tabular-nums">
              <span className="text-[0.875rem] text-mute">Counted</span>
              <b className="text-[1.25rem] font-semibold tracking-[-0.01em] whitespace-nowrap text-ink">
                {money(total)}
              </b>
            </div>
            <span className="flex-1" />
            <Button
              variant="primary"
              disabled={total === 0}
              onClick={() => {
                setTried(true)
                if (!unnamed) setPhase("result")
              }}
            >
              Done counting
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {record.error !== null && (
              <Banner tone="bad">{record.error.message}</Banner>
            )}
            <div className="flex items-center justify-end gap-2.5">
              {mustSay && (
                <span className="mr-1 text-meta text-mute">Say why</span>
              )}
              <Button onClick={recount} disabled={record.isPending}>
                Recount
              </Button>
              <Button
                variant="primary"
                pending={record.isPending}
                disabled={mustSay}
                onClick={submit}
              >
                {record.isPending ? "Submitting…" : "Submit"}
              </Button>
            </div>
          </div>
        )
      }
    >
      <div ref={frame}>
        {phase === "count" ? (
          <div className="flex flex-col gap-4">
            <Field label="Counted by" className="max-w-[22.5rem]">
              <Select
                value={counter?.key ?? ""}
                onChange={setBy}
                aria-label="Counted by"
              >
                {people.people.map((one) => (
                  <option key={one.key} value={one.key}>
                    {one.name}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
              <Denominations
                title="Note"
                values={NOTES}
                coin={false}
                pieces={notes}
                onChange={(value, n) => piece(setNotes, value, n)}
              />
              <Denominations
                title="Coin"
                values={COINS}
                coin
                pieces={coins}
                onChange={(value, n) => piece(setCoins, value, n)}
              />
            </div>

            <div className="rounded-card border border-hairline pb-2">
              <div className="border-b border-hairline px-4 pt-3 pb-2.5 text-card-title font-semibold text-ink">
                Kas bon
              </div>
              {slips.map((slip) => {
                const owed = (minorFrom(slip.amount) ?? 0) > 0
                return (
                  <div
                    key={slip.uid}
                    className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2.5 px-4 pt-2 md:grid-cols-[minmax(0,1fr)_11rem_2.75rem]"
                  >
                    <Input
                      aria-label="Name"
                      placeholder="Name"
                      className="h-11"
                      value={slip.who}
                      invalid={tried && owed && slip.who.trim() === ""}
                      onChange={(event) =>
                        setSlips((was) =>
                          was.map((one) =>
                            one.uid === slip.uid
                              ? { ...one, who: event.target.value }
                              : one,
                          ),
                        )
                      }
                    />
                    <div className="max-md:col-span-2 max-md:row-start-2 md:col-start-2">
                      <Money
                        label="Kas bon amount"
                        prefix="Rp"
                        className="h-11 text-right tabular-nums"
                        value={slip.amount}
                        onChange={(next) =>
                          setSlips((was) =>
                            was.map((one) =>
                              one.uid === slip.uid
                                ? { ...one, amount: next }
                                : one,
                            ),
                          )
                        }
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="quiet"
                      aria-label="Remove kas bon"
                      className="max-md:col-start-2 max-md:row-start-1 md:col-start-3"
                      onClick={() =>
                        setSlips((was) =>
                          was.filter((one) => one.uid !== slip.uid),
                        )
                      }
                    >
                      <X />
                    </Button>
                  </div>
                )
              })}
              <Button
                size="sm"
                variant="quiet"
                className="mt-1.5 ml-2.5"
                onClick={() =>
                  setSlips((was) => [
                    ...was,
                    { uid: crypto.randomUUID(), who: "", amount: "" },
                  ])
                }
              >
                <Plus />
                Add kas bon
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col gap-5 transition-[opacity,translate] duration-200 ease-(--ease-out)",
              "motion-reduce:transition-none starting:translate-y-1.5 starting:opacity-0",
            )}
          >
            <CountReport count={counted} by={counter?.name ?? "—"} />
            <div className="flex flex-col gap-2.5">
              <h3 className="text-card-title font-semibold text-ink">Notes</h3>
              <Textarea
                rows={3}
                aria-label="Notes"
                value={note}
                placeholder={
                  difference !== 0 ? "What happened" : "Anything to note"
                }
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}

/// One table of the count: a row per denomination, the quantity typed in the
/// middle and what it comes to at the end.
function Denominations({
  title,
  values,
  coin,
  pieces,
  onChange,
}: {
  title: string
  values: readonly number[]
  coin: boolean
  pieces: Readonly<Record<number, number>>
  onChange: (value: number, n: number) => void
}) {
  const row =
    "grid grid-cols-[2.75rem_minmax(0,1fr)_6.5rem_8.5rem] items-center gap-x-3.5 px-4 max-md:grid-cols-[2rem_minmax(0,1fr)_5.5rem_6.5rem] max-md:gap-x-2.5 max-md:px-3"
  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-hairline">
      <div
        className={cn(
          row,
          "min-h-10 border-b border-hairline bg-soft text-[0.875rem] font-medium text-body",
        )}
      >
        <span className="col-span-2">{title}</span>
        <span className="text-center">Pieces</span>
        <span className="text-right">Amount</span>
      </div>
      {values.map((value) => {
        const n = pieces[value] ?? 0
        const name = `${coin ? "coins" : "notes"} of ${money(value)}`
        return (
          <div
            key={value}
            className={cn(
              row,
              "min-h-12 border-b border-hairline py-1 last:border-b-0",
              coin && "bg-soft/40",
            )}
          >
            <Chip value={value} coin={coin} />
            <span className="text-control font-medium text-ink tabular-nums">
              {money(value)}
            </span>
            <Input
              aria-label={`Pieces of ${name}`}
              padLabel={`How many ${name}`}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              className="h-11 px-2 text-center font-semibold tabular-nums"
              value={n === 0 ? "" : String(n)}
              onChange={(event) =>
                onChange(
                  value,
                  Number(event.target.value.replace(/\D/g, "")) || 0,
                )
              }
            />
            <span
              className={cn(
                "text-right tabular-nums",
                n === 0 ? "text-mute" : "font-medium text-ink",
              )}
            >
              {money(value * n)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
