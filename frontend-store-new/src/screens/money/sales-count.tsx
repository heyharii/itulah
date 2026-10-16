import { Input } from "@/components/ui/field"
import { cn } from "@/lib/utils"
import type { CashCount } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// Notes and coins, counted one denomination to a row — the drop sheet's and
/// the drawer count's form.
///
/// Notes on the left, coins on the right, a row per denomination: a quantity,
/// and what that comes to. On a phone each quantity is picked on the number
/// pad like every numeric box in this app.

/// A note or a coin. A 1.000 note and a 1.000 coin are two rows that post as
/// one denomination.
export interface Piece {
  readonly key: string
  readonly value: number
  readonly coin: boolean
}

const NOTES = [100_000, 75_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000]
const COINS = [1_000, 500, 200, 100, 50]

export const NOTE_PIECES: readonly Piece[] = NOTES.map((value) => ({
  key: `n${value}`,
  value,
  coin: false,
}))
export const COIN_PIECES: readonly Piece[] = COINS.map((value) => ({
  key: `c${value}`,
  value,
  coin: true,
}))

/// How many of each, by `Piece.key`.
export type Pieces = Readonly<Record<string, number>>

export function totalOf(pieces: Pieces): number {
  return [...NOTE_PIECES, ...COIN_PIECES].reduce(
    (sum, one) => sum + one.value * (pieces[one.key] ?? 0),
    0,
  )
}

/// The sheet the node takes: one line per denomination, equal values merged.
export function countedOf(pieces: Pieces): CashCount[] {
  const merged = new Map<number, number>()
  for (const one of [...NOTE_PIECES, ...COIN_PIECES]) {
    const n = pieces[one.key] ?? 0
    if (n > 0) merged.set(one.value, (merged.get(one.value) ?? 0) + n)
  }
  return [...merged]
    .map(([value_minor, pieces]) => ({ value_minor, pieces }))
    .sort((a, b) => b.value_minor - a.value_minor)
}

const plain = new Intl.NumberFormat("id-ID")

/// The banknotes' own colours, as a recognisable chip. Domain colours rather
/// than the app's palette: a 50.000 is blue in a drawer whatever the theme.
const NOTE_COLOUR: Readonly<Record<number, string>> = {
  100000: "#e2606f",
  75000: "#c9875a",
  50000: "#4f7fc4",
  20000: "#5fa87a",
  10000: "#9a6cba",
  5000: "#b08a4a",
  2000: "#9aa0a8",
  1000: "#8fae6a",
}

function Chip({ piece }: { piece: Piece }) {
  if (piece.coin) {
    return (
      <span
        aria-hidden
        className={cn(
          "size-5 rounded-full border",
          piece.value >= 500
            ? "border-warn/40 bg-warn-bg"
            : "border-hairline-strong bg-soft-2",
        )}
      />
    )
  }
  return (
    <span
      aria-hidden
      className="h-5 w-8 rounded-[0.25rem] shadow-soft"
      style={{ backgroundColor: NOTE_COLOUR[piece.value] }}
    />
  )
}

/// One half of the count: the notes, or the coins.
export function DenominationTable({
  part,
  pieces,
  onChange,
}: {
  part: "notes" | "coins"
  pieces: Pieces
  onChange: (key: string, quantity: number) => void
}) {
  const rows = part === "notes" ? NOTE_PIECES : COIN_PIECES
  return (
    <div className="overflow-hidden rounded-card border border-hairline">
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_5.5rem_minmax(5.5rem,auto)] items-center gap-x-3 bg-soft px-4 py-2 text-meta font-medium text-body">
        <span />
        <span>{part === "notes" ? "Note" : "Coin"}</span>
        <span className="text-center">Pieces</span>
        <span className="text-right">Amount</span>
      </div>
      {rows.map((one) => {
        const n = pieces[one.key] ?? 0
        const name = `${plain.format(one.value)} ${one.coin ? "coin" : "note"}`
        return (
          <div
            key={one.key}
            className="grid min-h-[3.25rem] grid-cols-[2.5rem_minmax(0,1fr)_5.5rem_minmax(5.5rem,auto)] items-center gap-x-3 border-t border-hairline px-4 py-1"
          >
            <Chip piece={one} />
            <span className="text-[0.9375rem] font-medium text-ink tabular-nums">
              {plain.format(one.value)}
            </span>
            <Input
              aria-label={`Pieces of ${name}`}
              inputMode="numeric"
              placeholder="0"
              padLabel={`How many ${name}`}
              className="h-9 px-1 text-center text-[0.9375rem] tabular-nums"
              value={n === 0 ? "" : String(n)}
              onChange={(event) =>
                onChange(
                  one.key,
                  Math.max(
                    0,
                    Math.floor(Number(event.target.value.replace(/\D/g, ""))) ||
                      0,
                  ),
                )
              }
            />
            <span
              className={cn(
                "text-right text-[0.9375rem] tabular-nums",
                n === 0 ? "text-mute" : "font-medium text-ink",
              )}
            >
              {money(one.value * n)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
