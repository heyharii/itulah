import { Minus, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { Banner, EmptyState } from "@/components/ui/states"
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
import { CardHead, MoneyScreen } from "@/screens/money/parts"
import type { CashCountRow } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// Count the shop's cash box by box, note by note, against what the books say.

const BOX_NAMES: Record<CashMeaning, { name: string; sub: string }> = {
  cash: {
    name: "Cash on hand",
    sub: "Not yet banked",
  },
  petty_cash: { name: "Petty cash", sub: "For small expenses" },
  cashier_float: { name: "Cashier float", sub: "Modal kasir" },
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
const shortDay = (iso: string) => {
  const parsed = new Date(`${iso.slice(0, 10)}T00:00:00`)
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function shortBy(variance: number): string {
  if (variance === 0) return "matched"
  return variance < 0
    ? `short ${money(-variance)}`
    : `over ${money(variance)}`
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
  const [selected, setSelected] = useState<CashMeaning>("cash")
  const [done, setDone] = useState<string | null>(null)

  return (
    <MoneyScreen>
      {queryState(boxes, {
        loading: "Loading…",
        render: (list) => {
          const box = list.find((one) => one.meaning === selected) ?? list[0]
          return (
            <>
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                {list.map((one) => (
                  <BoxCard
                    key={one.meaning}
                    box={one}
                    selected={one.meaning === box?.meaning}
                    onSelect={() => {
                      setSelected(one.meaning)
                      setDone(null)
                    }}
                  />
                ))}
              </div>
              {done !== null && (
                <Banner tone="ok" className="mb-4">
                  {done}
                </Banner>
              )}
              {box !== undefined && (
                <Counter
                  key={box.meaning}
                  box={box}
                  onDone={(said) => setDone(said)}
                />
              )}
              <History boxes={list} query={counts} />
            </>
          )
        },
      })}
    </MoneyScreen>
  )
}

function BoxCard({
  box,
  selected,
  onSelect,
}: {
  box: StoreCashBox
  selected: boolean
  onSelect: () => void
}) {
  const label = BOX_NAMES[box.meaning]
  const last =
    box.last_counted_on === null
      ? "Never counted"
      : `Last counted ${shortDay(box.last_counted_on)}${
          box.last_variance_minor === null
            ? ""
            : ` · ${shortBy(box.last_variance_minor)}`
        }`
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex flex-col gap-1 rounded-card border bg-canvas p-4 text-left shadow-soft transition-colors",
        selected ? "border-accent ring-2 ring-accent/30" : "border-hairline",
      )}
    >
      <span className="text-card-title font-semibold text-ink">
        {label.name}
      </span>
      <span className="text-meta text-mute">{label.sub}</span>
      <span className="mt-2 text-[1.75rem] leading-tight font-semibold text-ink tabular-nums">
        {money(box.books_minor)}
      </span>
      <span className="text-meta text-body">{last}</span>
    </button>
  )
}

function Counter({
  box,
  onDone,
}: {
  box: StoreCashBox
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
  const set = (key: string, next: number) =>
    setQty((was) => ({ ...was, [key]: Math.max(0, Math.floor(next) || 0) }))

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
        onSuccess: () => {
          setQty({})
          setWitness("")
          setReason("")
          setDate(today())
          onDone(
            `${BOX_NAMES[box.meaning].name} counted: ${money(total)}, ${shortBy(difference)}.`,
          )
        },
      },
    )
  }

  return (
    <Card className="mb-4">
      <CardHead
        title={`Count ${BOX_NAMES[box.meaning].name}`}
      />
      <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-2">
          {DENOMINATIONS.map((one) => {
            const n = qty[one.key] ?? 0
            const name = `${plain.format(one.value)} ${one.kind.toLowerCase()}`
            return (
              <div
                key={one.key}
                className="grid grid-cols-[6.5rem_1fr_6.5rem] items-center gap-3"
              >
                <span className="text-[0.9375rem] font-medium text-ink tabular-nums">
                  {plain.format(one.value)}
                  <span className="ml-1.5 text-meta font-normal text-mute">
                    {one.kind.toLowerCase()}
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    aria-label={`One fewer ${name}`}
                    onClick={() => set(one.key, n - 1)}
                    disabled={n === 0}
                  >
                    <Minus />
                  </Button>
                  <Input
                    aria-label={`Quantity of ${name}`}
                    inputMode="numeric"
                    className="text-center text-[1.125rem] tabular-nums"
                    value={n === 0 ? "" : String(n)}
                    placeholder="0"
                    onChange={(event) =>
                      set(one.key, Number(event.target.value.replace(/\D/g, "")))
                    }
                  />
                  <Button
                    aria-label={`One more ${name}`}
                    onClick={() => set(one.key, n + 1)}
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

        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-[0.9375rem]">
            <dt className="text-body">Counted</dt>
            <dd className="text-right font-semibold text-ink tabular-nums">
              {money(total)}
            </dd>
            <dt className="text-body">Books</dt>
            <dd className="text-right text-ink tabular-nums">
              {money(box.books_minor)}
            </dd>
            <dt className="text-body">Difference</dt>
            <dd
              className={cn(
                "text-right font-semibold tabular-nums",
                varianceTone(difference),
              )}
            >
              {total === 0 && Object.values(qty).every((n) => !n)
                ? ""
                : difference === 0
                ? "Matches"
                : difference < 0
                  ? `Short ${money(-difference)}`
                  : `Over ${money(difference)}`}
            </dd>
          </dl>
          <Field label="Witness (optional)">
            <Input
              value={witness}
              onChange={(event) => setWitness(event.target.value)}
              autoComplete="off"
            />
          </Field>
          {difference !== 0 && (
            <Field
              label="Reason for the difference"
            >
              <textarea
                required
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="w-full rounded-inner border border-transparent bg-soft-2 px-4 py-3 text-[1rem] text-ink outline-none placeholder:text-mute"
              />
            </Field>
          )}
          <Field label="Date">
            <Input
              type="date"
              value={date}
              max={today()}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          {record.error !== null && (
            <Banner tone="bad">{record.error.message}</Banner>
          )}
          <Button
            variant="primary"
            onClick={submit}
            disabled={
              record.isPending ||
              total === 0 ||
              (difference !== 0 && reason.trim() === "")
            }
          >
            {record.isPending ? "Saving…" : "Save count"}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function History({
  boxes,
  query,
}: {
  boxes: StoreCashBox[]
  query: ReturnType<typeof useCashCounts>
}) {
  const nameOf = (code: string) => {
    const found = boxes.find((one) => one.account_code === code)
    return found === undefined ? code : BOX_NAMES[found.meaning].name
  }
  return (
    <Card>
      <CardHead title="Past counts" />
      {queryState(query, {
        loading: "Loading…",
        render: (rows: CashCountRow[]) => {
          if (rows.length === 0) {
            return <EmptyState>No count yet.</EmptyState>
          }
          const sorted = [...rows].sort((a, b) =>
            a.counted_on === b.counted_on
              ? b.created_at.localeCompare(a.created_at)
              : b.counted_on.localeCompare(a.counted_on),
          )
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-[0.9375rem]">
                <thead>
                  <tr className="border-b border-hairline text-left text-meta text-mute">
                    {[
                      "Date",
                      "Box",
                      "Counted",
                      "Books",
                      "Difference",
                      "Counted by",
                      "Witness",
                    ].map((head, i) => (
                      <th
                        key={head}
                        scope="col"
                        className={cn(
                          "px-4 py-2.5 font-medium",
                          i >= 2 && i <= 4 && "text-right",
                        )}
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => (
                    <HistoryRow
                      key={row.count_id}
                      row={row}
                      box={nameOf(row.account_code)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )
        },
      })}
    </Card>
  )
}

function HistoryRow({ row, box }: { row: CashCountRow; box: string }) {
  const [open, setOpen] = useState(false)
  const breakdown = [...row.notes]
    .sort((a, b) => b.denomination_minor - a.denomination_minor)
    .map((n) => `${plain.format(n.denomination_minor)} × ${n.quantity}`)
    .join(", ")
  return (
    <>
      <tr className="border-b border-hairline last:border-0">
        <td className="px-4 py-3 whitespace-nowrap">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
            className="font-medium text-ink underline-offset-2 hover:underline"
          >
            {shortDay(row.counted_on)}
          </button>
        </td>
        <td className="px-4 py-3">{box}</td>
        <td className="px-4 py-3 text-right tabular-nums">
          {money(row.counted_minor)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {money(row.per_books_minor)}
        </td>
        <td
          className={cn(
            "px-4 py-3 text-right font-medium tabular-nums",
            varianceTone(row.variance_minor),
          )}
        >
          {row.variance_minor === 0
            ? "Matches"
            : row.variance_minor < 0
              ? `Short ${money(-row.variance_minor)}`
              : `Over ${money(row.variance_minor)}`}
        </td>
        <td className="px-4 py-3">{row.counted_by}</td>
        <td className="px-4 py-3 text-body">{row.witnessed_by}</td>
      </tr>
      {open && (
        <tr className="border-b border-hairline bg-soft-2">
          <td colSpan={7} className="px-4 py-3 text-meta text-body">
            <p className="tabular-nums">{breakdown || "No notes recorded."}</p>
            {row.reason !== "" && <p className="mt-1">Reason: {row.reason}</p>}
          </td>
        </tr>
      )}
    </>
  )
}
