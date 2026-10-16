import { cn } from "@/lib/utils"
import {
  standing,
  sumOf,
  valuesOf,
  type Counted,
} from "@/screens/money/cash-count-model"
import { signed } from "@/screens/money/format"
import { money, units } from "@itulah/contract/money"

/// A count laid out as the paper reads it — the counted detail on the left, the
/// answer on the right — shared by the result of a count just made and the
/// record of one made before.

/// What the banknotes look like, by denomination: the colour of the note in the
/// hand, so a pile is found by eye. A denomination not listed is grey.
const NOTE_COLOUR: Readonly<Record<number, string>> = {
  100_000: "#e2606f",
  75_000: "#c9875a",
  50_000: "#4f7fc4",
  20_000: "#5fa87a",
  10_000: "#9a6cba",
  5_000: "#b08a4a",
  2_000: "#9aa0a8",
  1_000: "#8fae6a",
}

/// A note not listed above.
const NOTE_GREY = "#9aa0a8"

/// A banknote or a coin, drawn small: a swatch of the note's colour with its
/// seal, or a silver disc — gold for the two larger coins.
export function Chip({ value, coin }: { value: number; coin: boolean }) {
  if (coin) {
    return (
      <i
        aria-hidden
        className="ml-1.5 block size-5 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/12%)]"
        style={{
          background:
            value >= 500
              ? "radial-gradient(circle at 35% 30%, #f6ead0, #cfb57a)"
              : "radial-gradient(circle at 35% 30%, #f4f5f7, #c3c7cd)",
        }}
      />
    )
  }
  return (
    <i
      aria-hidden
      className="relative block h-5 w-8 overflow-hidden rounded-[0.25rem] shadow-[inset_0_0_0_1px_rgb(0_0_0/10%)] max-md:h-[1.0625rem] max-md:w-[1.625rem]"
      style={{ background: NOTE_COLOUR[value] ?? NOTE_GREY }}
    >
      <span className="absolute top-1/2 right-[5px] size-[9px] -translate-y-1/2 rounded-full bg-white/45" />
    </i>
  )
}

const ROW =
  "grid grid-cols-[2.5rem_minmax(0,1fr)_6rem_9.5rem] items-center gap-x-3 px-4 max-md:grid-cols-[1.75rem_minmax(0,1fr)_3rem_7.5rem] max-md:gap-x-2 max-md:px-3"

function Head({
  left,
  pieces,
  amount,
}: {
  left: string
  pieces?: string
  amount?: string
}) {
  return (
    <div
      className={cn(
        ROW,
        "min-h-10 border-b border-hairline bg-soft text-[0.875rem] font-medium text-body",
      )}
    >
      <span className="col-span-2">{left}</span>
      <span className="text-center">{pieces}</span>
      <span className="text-right">{amount}</span>
    </div>
  )
}

function Line({
  chip,
  label,
  pieces,
  amount,
}: {
  chip?: React.ReactNode
  label: React.ReactNode
  pieces?: React.ReactNode
  amount: React.ReactNode
}) {
  return (
    <div className={cn(ROW, "min-h-10 border-b border-hairline text-cell")}>
      <span>{chip}</span>
      <span className="min-w-0 break-words">{label}</span>
      <span className="text-center text-body tabular-nums">{pieces}</span>
      <span className="text-right tabular-nums">{amount}</span>
    </div>
  )
}

function Nothing() {
  return (
    <div className={cn(ROW, "min-h-10 border-b border-hairline text-cell")}>
      <span />
      <span className="text-mute">None</span>
    </div>
  )
}

function Subtotal({ label, amount }: { label: string; amount: number }) {
  return (
    <div
      className={cn(
        ROW,
        "min-h-10 border-b border-hairline bg-soft/50 text-cell font-medium text-body",
      )}
    >
      <span />
      <span>{label}</span>
      <span />
      <span className="text-right text-ink tabular-nums">{money(amount)}</span>
    </div>
  )
}

/// The counted detail: notes, coins and kas bon, and what they came to.
function CountedDetail({ count }: { count: Counted }) {
  const notes = valuesOf(count.notes)
  const coins = valuesOf(count.coins)
  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-hairline">
      <Head left="Notes" pieces="Pieces" amount="Amount" />
      {notes.length === 0 ? (
        <Nothing />
      ) : (
        notes.map((value) => (
          <Line
            key={value}
            chip={<Chip value={value} coin={false} />}
            label={money(value)}
            pieces={units(count.notes[value])}
            amount={money(value * count.notes[value])}
          />
        ))
      )}
      <Subtotal label="Notes total" amount={sumOf(count.notes)} />
      <Head left="Coins" />
      {coins.length === 0 ? (
        <Nothing />
      ) : (
        coins.map((value) => (
          <Line
            key={value}
            chip={<Chip value={value} coin />}
            label={money(value)}
            pieces={units(count.coins[value])}
            amount={money(value * count.coins[value])}
          />
        ))
      )}
      <Subtotal label="Coins total" amount={sumOf(count.coins)} />
      <Head left="Kas bon" />
      {count.kasbon.length === 0 ? (
        <Nothing />
      ) : (
        count.kasbon.map((slip, index) => (
          <Line key={index} label={slip.who} amount={money(slip.amountMinor)} />
        ))
      )}
      <div
        className={cn(
          ROW,
          "min-h-[3.25rem] bg-soft text-card-title font-semibold text-ink",
        )}
      >
        <span />
        <span>Counted</span>
        <span />
        <span className="text-right tabular-nums">
          {money(count.countedMinor)}
        </span>
      </div>
    </div>
  )
}

/// The answer, in a plain card: what was counted, what the books say, how the
/// two stand, and who counted.
function CountedAnswer({
  count,
  by,
}: {
  count: Counted
  /// Who counted, as a full name.
  by: string
}) {
  const difference = count.countedMinor - count.booksMinor
  const { word, tone } = standing(difference)
  return (
    <div className="min-w-0 rounded-card border border-hairline pb-4">
      <div className="px-[1.125rem] pt-3 pb-1.5 text-card-title font-medium text-body">
        Petty cash
      </div>
      <Fact label="Counted">{money(count.countedMinor)}</Fact>
      <Fact label="Petty cash in the books">{money(count.booksMinor)}</Fact>
      <div className="px-[1.125rem] pt-3">
        <div
          className={cn(
            "flex items-baseline justify-between gap-3 rounded-[0.75rem] px-[1.125rem] py-[1.125rem] tabular-nums",
            tone === "ok" && "bg-ok-bg text-ok-fg",
            tone === "bad" && "bg-bad-bg text-bad-fg",
            tone === "warn" && "bg-warn-bg text-warn-fg",
          )}
        >
          <span className="text-control text-body">{word}</span>
          <b className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] whitespace-nowrap">
            {signed(difference)}
          </b>
        </div>
      </div>
      <div className="mx-[1.125rem] mt-3 border-t border-hairline pt-1">
        <Fact label="Counted by" flush>
          {by}
        </Fact>
      </div>
    </div>
  )
}

function Fact({
  label,
  flush = false,
  children,
}: {
  label: string
  /// Without the card's side padding, for a row that has its own margin.
  flush?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex min-h-10 items-center justify-between gap-4 py-1 text-cell tabular-nums",
        !flush && "px-[1.125rem]",
      )}
    >
      <span className="min-w-0 text-body">{label}</span>
      <span className="text-right whitespace-nowrap text-ink">{children}</span>
    </div>
  )
}

/// The detail and the answer side by side, one above the other on a phone.
export function CountReport({
  count,
  by,
}: {
  count: Counted
  /// Who counted, as a full name.
  by: string
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <CountedDetail count={count} />
      <CountedAnswer count={count} by={by} />
    </div>
  )
}
