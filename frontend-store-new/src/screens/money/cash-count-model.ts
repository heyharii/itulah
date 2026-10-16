import type { CashNoteInput } from "@/lib/queries/cash-count"
import type { ShopPeople } from "@/lib/queries/shop-people"
import type { CashCountRow } from "@itulah/contract"

/// A petty cash count, as the people who sign the paper see it: notes, coins and
/// the kas bon slips in the box.
///
/// **The node's count is a list of denominations and a reason.** It has no coin
/// apart from a note (a 1.000 coin and a 1.000 note are the same line), no kas
/// bon, and no one who counted but the person signed in. Rather than lose what
/// the paper needs, this file carries it where the node has room, and reads it
/// back:
///
///   - a kas bon slip goes in as a line of its own — its amount, once — so the
///     node's total is cash plus slips, which is what the books hold; its name
///     goes in the first line of the reason: `Kas bon: Maya Rp 150.000; …`;
///   - the 1.000 coins go in the next line of the reason: `Rp 1.000 coins: 12`;
///   - whatever the person wrote follows them.
///
/// Reading it back takes each slip out of the lines again, so the notes and
/// coins on screen are the ones counted. A count made before this (no such
/// lines) reads as notes and coins, with the 1.000 all notes.

/// Banknotes, largest first. 75.000 is the commemorative note, still in tills.
export const NOTES = [
  100_000, 75_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000,
] as const

export const COINS = [1_000, 500, 200, 100, 50] as const

/// How many of each, by denomination.
export type Pieces = Readonly<Record<number, number>>

export interface KasBon {
  readonly who: string
  readonly amountMinor: number
}

/// Everything a count says, drawn or read.
export interface Counted {
  readonly notes: Pieces
  readonly coins: Pieces
  readonly kasbon: readonly KasBon[]
  /// What the person wrote, without the lines above.
  readonly note: string
  readonly countedMinor: number
  /// What the books held when it was counted.
  readonly booksMinor: number
}

/// How a count stands against the books: Even, Short or Over, in its colours.
export function standing(difference: number): {
  readonly word: "Even" | "Short" | "Over"
  readonly tone: "ok" | "bad" | "warn"
} {
  return difference === 0
    ? { word: "Even", tone: "ok" }
    : difference < 0
      ? { word: "Short", tone: "bad" }
      : { word: "Over", tone: "warn" }
}

export function sumOf(pieces: Pieces): number {
  return Object.entries(pieces).reduce(
    (sum, [value, n]) => sum + Number(value) * n,
    0,
  )
}

export function kasbonSum(kasbon: readonly KasBon[]): number {
  return kasbon.reduce((sum, slip) => sum + slip.amountMinor, 0)
}

/// Denominations with something counted, largest first.
export function valuesOf(pieces: Pieces): number[] {
  return Object.entries(pieces)
    .filter(([, n]) => n > 0)
    .map(([value]) => Number(value))
    .sort((a, b) => b - a)
}

const plain = new Intl.NumberFormat("id-ID")

/// `Rp 150.000`, with a plain space — the lines below are parsed back, and the
/// formatter's own non-breaking space is not something a reader of the reason
/// should have to wonder about.
const rupiah = (minor: number) => `Rp ${plain.format(minor)}`

const KAS_BON = /^Kas bon: (.+)$/
const COIN_LINE = /^Rp 1\.000 coins: (\d+)$/
const SLIP = /^(.*) Rp ([\d.]+)$/

/// A slip's name as it travels: no separators, no line breaks.
const cleanName = (who: string) =>
  who
    .replace(/[;\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

/// The lines sent to the node: every note and coin, and each kas bon slip as one
/// piece of its own amount. Equal denominations are one line.
export function noteLines(count: {
  readonly notes: Pieces
  readonly coins: Pieces
  readonly kasbon: readonly KasBon[]
}): CashNoteInput[] {
  const merged = new Map<number, number>()
  const add = (value: number, n: number) => {
    if (n > 0) merged.set(value, (merged.get(value) ?? 0) + n)
  }
  for (const [value, n] of Object.entries(count.notes)) add(Number(value), n)
  for (const [value, n] of Object.entries(count.coins)) add(Number(value), n)
  for (const slip of count.kasbon) add(slip.amountMinor, 1)
  return [...merged]
    .sort((a, b) => b[0] - a[0])
    .map(([denomination_minor, quantity]) => ({
      denomination_minor,
      quantity,
    }))
}

/// The reason sent to the node: the two lines the paper needs, then the note.
export function reasonOf(count: {
  readonly coins: Pieces
  readonly kasbon: readonly KasBon[]
  readonly note: string
}): string {
  const lines: string[] = []
  if (count.kasbon.length > 0)
    lines.push(
      `Kas bon: ${count.kasbon
        .map((slip) => `${cleanName(slip.who)} ${rupiah(slip.amountMinor)}`)
        .join("; ")}`,
    )
  const thousand = count.coins[1_000] ?? 0
  if (thousand > 0) lines.push(`Rp 1.000 coins: ${thousand}`)
  if (count.note.trim() !== "") lines.push(count.note.trim())
  return lines.join("\n")
}

/// A count the node holds, read back into notes, coins, slips and note.
export function readCount(row: CashCountRow): Counted {
  const lines = row.reason.split("\n")
  const kasbon: KasBon[] = []
  let thousandCoins = 0
  let at = 0
  for (; at < lines.length; at += 1) {
    const slips = KAS_BON.exec(lines[at])
    const coin = COIN_LINE.exec(lines[at])
    if (slips !== null && kasbon.length === 0) {
      for (const part of slips[1].split("; ")) {
        const found = SLIP.exec(part)
        if (found !== null)
          kasbon.push({
            who: found[1],
            amountMinor: Number(found[2].replace(/\./g, "")),
          })
      }
    } else if (coin !== null) {
      thousandCoins = Number(coin[1])
    } else {
      break
    }
  }

  // Each slip is one piece of its own amount among the lines; take it out.
  const held = new Map<number, number>(
    row.notes.map((note): [number, number] => [
      note.denomination_minor,
      note.quantity,
    ]),
  )
  for (const slip of kasbon) {
    const left = (held.get(slip.amountMinor) ?? 0) - 1
    if (left > 0) held.set(slip.amountMinor, left)
    else held.delete(slip.amountMinor)
  }

  const notes: Record<number, number> = {}
  const coins: Record<number, number> = {}
  for (const [value, n] of held) {
    if (value === 1_000) {
      const asCoins = Math.min(thousandCoins, n)
      if (asCoins > 0) coins[value] = asCoins
      if (n - asCoins > 0) notes[value] = n - asCoins
    } else if ((COINS as readonly number[]).includes(value)) {
      coins[value] = n
    } else {
      notes[value] = n
    }
  }

  return {
    notes,
    coins,
    kasbon,
    note: lines.slice(at).join("\n").trim(),
    countedMinor: row.counted_minor,
    booksMinor: row.per_books_minor,
  }
}

/// Who held the notes: the witness when the person who recorded the count named
/// someone else (`witnessed_by`), else the person who recorded it.
export function counterOf(
  row: CashCountRow,
  people: ShopPeople,
): { readonly name: string; readonly position: string | null } {
  if (row.witnessed_by !== "") {
    return {
      name: row.witnessed_by,
      position:
        people.people.find((one) => one.name === row.witnessed_by)?.position ??
        null,
    }
  }
  return {
    name: people.nameOf(row.counted_by),
    position:
      people.people.find((one) => one.login === row.counted_by)?.position ??
      null,
  }
}
