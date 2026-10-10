import { Minus, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { CardList } from "@/components/ui/card-list"
import { Field, Input, Textarea } from "@/components/ui/field"
import { LeadCard } from "@/components/ui/lead-card"
import type { ListColumn } from "@/components/ui/list-table"
import { OpenButton } from "@/components/ui/open-rows"
import { Pill, Status } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import {
  useCashBoxes,
  useCashCounts,
  useRecordCashCount,
  type CashMeaning,
  type CashNoteInput,
  type StoreCashBox,
} from "@/lib/queries/cash-count"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { dayYear } from "@/screens/money/format"
import { MoneyScreen, Rows, SheetSection } from "@/screens/money/parts"
import type { CashCountRow } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// Count the shop's cash box by box, note by note, against what the books say.
///
/// The three boxes are lead cards — what the books say it holds is the figure,
/// when it was last counted is the foot, and "Count" the tint button that opens
/// the count as a sheet. The count is a task, so it is a sheet with its figures
/// pinned in the foot and every quantity entered on the number pad on a phone;
/// the past counts are cards under the boxes, each opening what was counted.

const BOX_NAMES: Record<CashMeaning, { name: string; sub: string }> = {
  cash: {
    name: "Cash on hand",
    sub: "Not yet banked",
  },
  petty_cash: { name: "Petty cash", sub: "For small expenses" },
  cashier_float: { name: "Cashier float", sub: "Starting cash for each till" },
}

/// Notes and coins. Coins are keyed apart from the notes so a 1.000 coin and a
/// 1.000 note get their own rows, then post as the same denomination.
const DENOMINATIONS: readonly {
  key: string
  value: number
  kind: "Note" | "Coin"
}[] = [
  { key: "n100000", value: 100_000, kind: "Note" },
  { key: "n50000", value: 50_000, kind: "Note" },
  { key: "n20000", value: 20_000, kind: "Note" },
  { key: "n10000", value: 10_000, kind: "Note" },
  { key: "n5000", value: 5_000, kind: "Note" },
  { key: "n2000", value: 2_000, kind: "Note" },
  { key: "n1000", value: 1_000, kind: "Note" },
  { key: "c1000", value: 1_000, kind: "Coin" },
  { key: "c500", value: 500, kind: "Coin" },
  { key: "c200", value: 200, kind: "Coin" },
  { key: "c100", value: 100, kind: "Coin" },
]

const plain = new Intl.NumberFormat("id-ID")
const today = () => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function shortBy(variance: number): string {
  if (variance === 0) return "matched"
  return variance < 0 ? `short ${money(-variance)}` : `over ${money(variance)}`
}

/// The difference as a status: matched is settled, short is wrong, over is a
/// mis-ring to find rather than money gone.
function Difference({ variance }: { variance: number }) {
  return (
    <Status tone={variance === 0 ? "ok" : variance < 0 ? "bad" : "warn"}>
      {variance === 0
        ? "Matches"
        : variance < 0
          ? `Short ${money(-variance)}`
          : `Over ${money(variance)}`}
    </Status>
  )
}

function varianceTone(variance: number): string {
  return variance === 0
    ? "text-ok-fg"
    : variance < 0
      ? "text-bad-fg"
      : "text-warn-fg"
}

export function CashCount() {
  const boxes = useCashBoxes()
  const counts = useCashCounts()
  const [counting, setCounting] = useState<CashMeaning | null>(null)
  // Held apart from `counting` so the sheet can play its exit with its form
  // still in it; `session` makes the next count start from nothing.
  const [showing, setShowing] = useState(false)
  const [session, setSession] = useState(0)
  const [done, setDone] = useState<string | null>(null)

  return (
    <MoneyScreen>
      {queryState(boxes, {
        loading: "Reading the cash boxes…",
        render: (list) => {
          const box = list.find((one) => one.meaning === counting)
          return (
            <div className="flex flex-col gap-4">
              {done !== null && (
                <Banner tone="ok" onDismiss={() => setDone(null)}>
                  {done}
                </Banner>
              )}
              <CardList grid>
                {list.map((one) => (
                  <BoxCard
                    key={one.meaning}
                    box={one}
                    onCount={() => {
                      setDone(null)
                      setCounting(one.meaning)
                      setSession((was) => was + 1)
                      setShowing(true)
                    }}
                  />
                ))}
              </CardList>
              <History boxes={list} query={counts} />
              {box !== undefined && (
                <CountSheet
                  key={session}
                  box={box}
                  open={showing}
                  onClose={() => setShowing(false)}
                  onDone={(said) => {
                    setShowing(false)
                    setDone(said)
                  }}
                />
              )}
            </div>
          )
        },
      })}
    </MoneyScreen>
  )
}

function BoxCard({ box, onCount }: { box: StoreCashBox; onCount: () => void }) {
  const label = BOX_NAMES[box.meaning]
  const last =
    box.last_counted_on === null
      ? "Never counted"
      : `Counted ${dayYear(box.last_counted_on)}${
          box.last_variance_minor === null
            ? ""
            : ` · ${shortBy(box.last_variance_minor)}`
        }`
  return (
    <LeadCard
      title={label.name}
      lines={[label.sub]}
      lead={{ figure: money(box.books_minor), caption: "per books" }}
      // A box that came up short last time shows from across the page.
      tone={
        box.last_variance_minor !== null && box.last_variance_minor < 0
          ? "alert"
          : undefined
      }
      foot={{
        info: last,
        action: { label: "Count", onClick: onCount },
      }}
    />
  )
}

/// A count, as a sheet: the notes and coins, the witness and the day — and in
/// the foot, always in view, what has been counted and how it stands against
/// the books.
function CountSheet({
  box,
  open,
  onClose,
  onDone,
}: {
  box: StoreCashBox
  open: boolean
  onClose: () => void
  onDone: (said: string) => void
}) {
  const record = useRecordCashCount()
  const [qty, setQty] = useState<Record<string, number>>({})
  const [witness, setWitness] = useState("")
  const [reason, setReason] = useState("")
  const [date, setDate] = useState(today())

  const total = useMemo(
    () =>
      DENOMINATIONS.reduce(
        (sum, one) => sum + one.value * (qty[one.key] ?? 0),
        0,
      ),
    [qty],
  )
  const difference = total - box.books_minor
  const counted = Object.values(qty).some((n) => n > 0)
  const set = (key: string, next: number) =>
    setQty((was) => ({ ...was, [key]: Math.max(0, Math.floor(next) || 0) }))
  // One more, one fewer: from what is held now, so two quick taps are two.
  const step = (key: string, by: number) =>
    setQty((was) => ({
      ...was,
      [key]: Math.max(0, (was[key] ?? 0) + by),
    }))

  const submit = () => {
    // Equal denominations (a 1.000 note and a 1.000 coin) post as one line.
    const merged = new Map<number, number>()
    for (const one of DENOMINATIONS) {
      const n = qty[one.key] ?? 0
      if (n > 0) merged.set(one.value, (merged.get(one.value) ?? 0) + n)
    }
    const notes: CashNoteInput[] = [...merged].map(
      ([denomination_minor, quantity]) => ({ denomination_minor, quantity }),
    )
    record.mutate(
      {
        meaning: box.meaning,
        countedOn: date,
        witnessedBy: witness.trim(),
        reason: difference === 0 ? "" : reason.trim(),
        notes,
      },
      {
        onSuccess: () =>
          onDone(
            `${BOX_NAMES[box.meaning].name} counted: ${money(total)}, ${shortBy(difference)}.`,
          ),
      },
    )
  }

  const ready =
    !record.isPending && total > 0 && (difference === 0 || reason.trim() !== "")

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={`Count ${BOX_NAMES[box.meaning].name.toLowerCase()}`}
      caption={`Per books ${money(box.books_minor)}`}
      width="wide"
      footer={
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3 text-meta">
            <span className="text-body">
              Counted{" "}
              <b className="font-semibold text-ink tabular-nums">
                {money(total)}
              </b>
            </span>
            <span
              className={cn(
                "font-medium tabular-nums",
                counted ? varianceTone(difference) : "text-mute",
              )}
            >
              {!counted
                ? "Nothing counted"
                : difference === 0
                  ? "Matches"
                  : difference < 0
                    ? `Short ${money(-difference)}`
                    : `Over ${money(difference)}`}
            </span>
          </div>
          {record.error !== null && (
            <Banner tone="bad">{record.error.message}</Banner>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              pending={record.isPending}
              disabled={!ready}
            >
              {record.isPending ? "Creating…" : "Create count"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <SheetSection title="Notes and coins">
          <div className="flex flex-col gap-2">
            {DENOMINATIONS.map((one) => {
              const n = qty[one.key] ?? 0
              const name = `${plain.format(one.value)} ${one.kind.toLowerCase()}`
              return (
                <div
                  key={one.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto_minmax(5.5rem,auto)] items-center gap-x-3"
                >
                  <span className="text-[0.9375rem] font-medium text-ink tabular-nums">
                    {plain.format(one.value)}
                    <span className="ml-1.5 text-meta font-normal text-mute">
                      {one.kind.toLowerCase()}
                    </span>
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      aria-label={`One fewer ${name}`}
                      onClick={() => step(one.key, -1)}
                      disabled={n === 0}
                    >
                      <Minus />
                    </Button>
                    <Input
                      aria-label={`Quantity of ${name}`}
                      inputMode="numeric"
                      className="w-14 px-1 text-center text-[1.125rem] tabular-nums pointer-coarse:h-11"
                      value={n === 0 ? "" : String(n)}
                      placeholder="0"
                      padLabel={`How many ${name}`}
                      onChange={(event) =>
                        set(
                          one.key,
                          Number(event.target.value.replace(/\D/g, "")),
                        )
                      }
                    />
                    <Button
                      size="icon"
                      aria-label={`One more ${name}`}
                      onClick={() => step(one.key, 1)}
                    >
                      <Plus />
                    </Button>
                  </div>
                  <span className="text-right text-[0.9375rem] text-body tabular-nums">
                    {n === 0 ? "" : money(one.value * n)}
                  </span>
                </div>
              )
            })}
          </div>
        </SheetSection>

        <div className="flex flex-col gap-6">
          {difference !== 0 && counted && (
            <Field label="Reason for the difference" required>
              <Textarea
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          )}
          <div className="grid gap-6 md:grid-cols-2">
            <Field label="Witness" hint="Optional">
              <Input
                value={witness}
                onChange={(event) => setWitness(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Date">
              <Input
                type="date"
                value={date}
                max={today()}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

/// The past counts: cards on a phone, the hub's table on a desk — each opening
/// what was counted, note by note.
function History({
  boxes,
  query,
}: {
  boxes: StoreCashBox[]
  query: ReturnType<typeof useCashCounts>
}) {
  const [open, setOpen] = useState<CashCountRow | null>(null)
  const [showing, setShowing] = useState(false)
  const nameOf = (code: string) => {
    const found = boxes.find((one) => one.account_code === code)
    return found === undefined ? code : BOX_NAMES[found.meaning].name
  }
  return (
    <>
      {queryState(query, {
        loading: "Reading the past counts…",
        render: (rows: CashCountRow[]) => {
          const sorted = [...rows].sort((a, b) =>
            a.counted_on === b.counted_on
              ? b.created_at.localeCompare(a.created_at)
              : b.counted_on.localeCompare(a.counted_on),
          )
          const columns: readonly ListColumn<CashCountRow>[] = [
            {
              id: "date",
              header: "Date",
              cell: (row) => (
                <OpenButton
                  id={row.count_id}
                  className="font-medium text-ink tabular-nums"
                >
                  {dayYear(row.counted_on)}
                </OpenButton>
              ),
            },
            {
              id: "box",
              header: "Box",
              cell: (row) => nameOf(row.account_code),
            },
            {
              id: "counted",
              header: "Counted",
              align: "right",
              className: "tabular-nums",
              cell: (row) => money(row.counted_minor),
            },
            {
              id: "books",
              header: "Books",
              align: "right",
              className: "tabular-nums",
              cell: (row) => money(row.per_books_minor),
            },
            {
              id: "difference",
              header: "Difference",
              align: "right",
              cell: (row) => <Difference variance={row.variance_minor} />,
            },
            {
              id: "by",
              header: "Counted by",
              cell: (row) => row.counted_by,
            },
            {
              id: "witness",
              header: "Witness",
              className: "text-body max-lg:hidden",
              cell: (row) => row.witnessed_by,
            },
          ]
          return (
            <>
              <Rows
                title="Past counts"
                rows={sorted}
                columns={columns}
                rowKey={(row) => row.count_id}
                empty="No count yet."
                onOpen={(row) => {
                  setOpen(row)
                  setShowing(true)
                }}
                card={(row) => ({
                  title: nameOf(row.account_code),
                  lines: [dayYear(row.counted_on)],
                  lead: {
                    figure: money(row.counted_minor),
                    caption: "counted",
                  },
                  foot: {
                    info: `Books ${money(row.per_books_minor)}`,
                    status: <Difference variance={row.variance_minor} />,
                  },
                })}
              />
              {open !== null && (
                <CountRecord
                  row={open}
                  box={nameOf(open.account_code)}
                  open={showing}
                  onClose={() => setShowing(false)}
                />
              )}
            </>
          )
        },
      })}
    </>
  )
}

/// One past count, as it was counted: the figures, then every note and coin.
function CountRecord({
  row,
  box,
  open,
  onClose,
}: {
  row: CashCountRow
  box: string
  open: boolean
  onClose: () => void
}) {
  const notes = [...row.notes].sort(
    (a, b) => b.denomination_minor - a.denomination_minor,
  )
  const v = row.variance_minor
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={dayYear(row.counted_on)}
      title={box}
      badge={
        <Pill tone={v === 0 ? "ok" : v < 0 ? "bad" : "warn"}>
          {v === 0 ? "Matches" : v < 0 ? "Short" : "Over"}
        </Pill>
      }
      caption={`Counted by ${row.counted_by}`}
    >
      <Facts>
        <Fact term="Counted">{money(row.counted_minor)}</Fact>
        <Fact term="Per books">{money(row.per_books_minor)}</Fact>
        <Fact term="Difference">
          <span className={cn("font-medium", varianceTone(v))}>
            {v === 0
              ? "Matches"
              : v < 0
                ? `Short ${money(-v)}`
                : `Over ${money(v)}`}
          </span>
        </Fact>
        <Fact term="Witness">
          {row.witnessed_by === "" ? "—" : row.witnessed_by}
        </Fact>
        {row.reason !== "" && (
          <Fact term="Reason" wide>
            {row.reason}
          </Fact>
        )}
      </Facts>
      <div className="mt-6">
        <SheetSection title="Notes and coins">
          {notes.length === 0 ? (
            <p className="text-meta text-mute">No notes recorded.</p>
          ) : (
            <ul className="rounded-card border border-hairline">
              {notes.map((note) => (
                <li
                  key={note.denomination_minor}
                  className="flex items-baseline justify-between gap-3 border-b border-hairline px-3.5 py-2.5 text-cell tabular-nums last:border-b-0"
                >
                  <span className="text-ink">
                    {plain.format(note.denomination_minor)} ×{" "}
                    {plain.format(note.quantity)}
                  </span>
                  <span className="font-medium text-ink">
                    {money(note.denomination_minor * note.quantity)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SheetSection>
      </div>
    </Sheet>
  )
}
