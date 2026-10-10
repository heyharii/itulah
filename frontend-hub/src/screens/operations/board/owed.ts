import { count } from "@/lib/format"
import {
  flagged,
  shortReasonLabel,
  type DcChange,
  type OwedWork,
  type ShortPick,
} from "@/lib/operations/changes"

/// What the board's cards say about work MD changed and work the picker could
/// not finish, read off `owedWork()` and `shortPicks()`.
///
/// Pure: the board polls the two lists and hands them here, card by card.
/// Nothing in this file moves a piece. A card either says something (a strip,
/// a change row, a stamp) or it does not.
///
///  - **To pick** (an allotment × shop) <- a flagged short pick: amber strip.
///  - **Picked** (a SHOP, however many allotments it gathers) <- the owed items
///    of that destination that still have pieces in the pick area.
///  - **Pack** (one carton) <- the owed lines whose `koli[]` names that carton.

// ── To pick: Short pick ────────────────────────────────────────────────────

/// The card key of a picklist, the same string the sheets open with.
export const pickCardKey = (allotmentId: string, destinationId: string) =>
  `${allotmentId}~${destinationId}`

export interface ShortMark {
  /// How many pieces are still short on this picklist.
  readonly pieces: number
  /// Why, for the strip's tooltip: one sentence per distinct reason.
  readonly title: string
}

/// One mark per picklist that has a flagged short pick (open or lost). A
/// short pick the count found, the picker finished or MD closed no longer
/// marks the card: the flag clears by itself.
export function shortPickMarks(
  items: readonly ShortPick[]
): ReadonlyMap<string, ShortMark> {
  const by = new Map<string, { pieces: number; reasons: Set<string> }>()
  for (const one of items) {
    if (!flagged(one)) continue
    const key = pickCardKey(one.allotment_id, one.destination_id)
    const row = by.get(key) ?? { pieces: 0, reasons: new Set<string>() }
    row.pieces += one.still_short
    row.reasons.add(shortReasonLabel(one.reason))
    by.set(key, row)
  }
  return new Map(
    [...by].map(([key, row]) => [
      key,
      {
        pieces: row.pieces,
        title: `${[...row.reasons].join(" · ")} · ${count(row.pieces)} ${row.pieces === 1 ? "pc" : "pcs"} short`,
      },
    ])
  )
}

// ── Picked and Pack: what MD took out ──────────────────────────────────────

/// Pieces MD no longer wants that are sitting on one card.
export interface Owed {
  /// Every contributing item was a cancel: the card is "CANCELLED". One edit
  /// among them and it is "EDITED".
  readonly kind: OwedWork["kind"]
  /// How many pieces the Gudang has to move back off this card.
  readonly pieces: number
  readonly by: string
  readonly at: string
  readonly reason: string | null
}

export interface OwedIndex {
  /// By destination (shop) id: the Picked card.
  readonly shop: ReadonlyMap<string, Owed>
  /// By carton id: the Pack card.
  readonly koli: ReadonlyMap<string, Owed>
}

function fold(
  into: Map<string, Owed>,
  key: string,
  item: OwedWork,
  pieces: number
) {
  if (pieces <= 0) return
  const was = into.get(key)
  into.set(key, {
    kind:
      was === undefined || was.kind === item.kind ? item.kind : "EDITED",
    pieces: (was?.pieces ?? 0) + pieces,
    by: item.by,
    // The newest change is the one the card is waiting on.
    at: was === undefined || item.at > was.at ? item.at : was.at,
    reason: item.reason ?? was?.reason ?? null,
  })
}

export function indexOwed(items: readonly OwedWork[]): OwedIndex {
  const shop = new Map<string, Owed>()
  const koli = new Map<string, Owed>()
  for (const item of items) {
    fold(
      shop,
      item.destination_id,
      item,
      item.lines.reduce((total, line) => total + line.owed_picked, 0)
    )
    // A carton can hold pieces of several lines of several allotments.
    const inKoli = new Map<string, number>()
    for (const line of item.lines)
      for (const one of line.koli)
        inKoli.set(one.koli_id, (inKoli.get(one.koli_id) ?? 0) + one.quantity)
    for (const [id, pieces] of inKoli) fold(koli, id, item, pieces)
  }
  return { shop, koli }
}

/// What a row says about the same thing, in words, for the table and the
/// phone's card.
export interface RowMark {
  readonly tone: "warn" | "bad"
  /// The whole sentence: "Edited −50 · 50 pcs to move back".
  readonly text: string
  /// What the card's band says, when it has one: "Edited −50", "Short pick".
  readonly strip?: string
  /// What a card says under its band, so the band's words are not said twice:
  /// "50 pcs to move back", "3 pcs still to pick".
  readonly detail: string
}

/// What a card shows for the pieces owed on it: the props `Tile` takes, and
/// the same facts as a `RowMark` for the table and the phone's card.
export interface CardMark {
  /// A band across the top of a workable card ("Edited −50").
  readonly strip?: { tone: "warn" | "bad"; label: string; title?: string }
  /// "was → now": the card's pieces and what MD still wants of them.
  readonly change?: { from: number; to: number }
  /// The whole card is MD's cancel: stamped, switched off, only Move back.
  readonly stamp?: string
  readonly switchedOff?: boolean
  readonly row: RowMark
  /// Pieces to move back.
  readonly owed: number
}

const minus = (pieces: number) => `−${count(pieces)}`
const pcs = (n: number) => `${count(n)} ${n === 1 ? "pc" : "pcs"}`

/// The mark of a card holding `pieces`, `owed` of which MD took out. `null`
/// when nothing is owed on it.
///
/// A CANCEL that takes the whole card is stamped and switched off. Anything
/// less — an edit, or a cancel that only reaches part of a card that also
/// holds another allotment's pieces — is a red strip over a card that still
/// works: its remaining pieces can be packed and sent.
export function markOf(
  owed: Owed | undefined,
  pieces: number
): CardMark | null {
  if (owed === undefined || owed.pieces <= 0) return null
  const all = owed.kind === "CANCELLED" && owed.pieces >= pieces
  const word = owed.kind === "CANCELLED" ? "Cancelled" : "Edited"
  const detail = `${pcs(owed.pieces)} to move back`
  if (all) {
    return {
      stamp: "CANCELLED",
      switchedOff: true,
      row: { tone: "bad", text: `Cancelled · ${detail}`, detail },
      owed: owed.pieces,
    }
  }
  const label = `${word} ${minus(owed.pieces)}`
  return {
    strip: { tone: "bad", label, title: owed.reason ?? undefined },
    change: { from: pieces, to: Math.max(0, pieces - owed.pieces) },
    row: { tone: "bad", text: `${label} · ${detail}`, strip: label, detail },
    owed: owed.pieces,
  }
}

/// The amber Short pick flag, as a card and as a row say it: a band, and the
/// reason in its tooltip.
export function shortCard(mark: ShortMark): {
  strip: { tone: "warn"; label: string; title: string }
  row: RowMark
} {
  const detail = `${pcs(mark.pieces)} still to pick`
  return {
    strip: { tone: "warn", label: "Short pick", title: mark.title },
    row: {
      tone: "warn",
      text: `Short pick · ${detail}`,
      strip: "Short pick",
      detail,
    },
  }
}

// ── What Move back is asked about ──────────────────────────────────────────

/// Where a Move back starts and where it goes.
///
/// `from` is where the pieces are now: the pick area ("picked", a shop's
/// waiting pieces) or an unsent carton ("packed", `koliId` names it). `to` is
/// where they go: the pick area ("picked", only out of a carton) or back on
/// the picklist ("pick"). Never from a trip, so there is no such `from`.
export interface MoveBackTarget {
  readonly from: "picked" | "packed"
  /// Where they go, when the opener already knows (a drop on a lane). Left
  /// out, the dialog chooses: back to the Pick List when MD took pieces out,
  /// else to Picked.
  readonly to?: "picked" | "pick"
  readonly destinationId: string
  readonly koliId?: string
}

/// How many of each SKU on the source MD already took out, by SKU: what a
/// Move back is prefilled with when the card is owed.
export function owedBySku(
  items: readonly OwedWork[],
  target: MoveBackTarget
): Map<string, number> {
  const out = new Map<string, number>()
  const add = (sku: string, pieces: number) => {
    if (pieces > 0) out.set(sku, (out.get(sku) ?? 0) + pieces)
  }
  for (const item of items) {
    if (target.from === "picked") {
      if (item.destination_id !== target.destinationId) continue
      for (const line of item.lines) add(line.sku_code, line.owed_picked)
    } else {
      for (const line of item.lines)
        for (const one of line.koli)
          if (one.koli_id === target.koliId) add(line.sku_code, one.quantity)
    }
  }
  return out
}

// ── What MD changed that the Gudang has not acknowledged ──────────────────

/// A small coloured fact on a card: "Added +20", "300 → 330", "Cancelled".
export interface ChangeTag {
  readonly tone: "warn" | "bad"
  readonly label: string
}

/// The tags of the changes a card carries (one allotment × store for a To pick
/// card, every allotment of the shop for a Picked card).
///
/// Every line brand new (was 0): "Added +N". Otherwise the net before and
/// after for the store, "300 → 330". All cancelled: "Cancelled".
export function changeTags(items: readonly DcChange[]): ChangeTag[] {
  if (items.length === 0) return []
  if (items.every((one) => one.cancelled))
    return [{ tone: "bad", label: "Cancelled" }]
  const was = items.reduce((total, one) => total + one.was_total, 0)
  const now = items.reduce((total, one) => total + one.now_total, 0)
  const lines = items.flatMap((one) => one.lines)
  if (lines.length > 0 && lines.every((l) => l.kind === "ADD" && l.was === 0))
    return [{ tone: "warn", label: `Added +${count(now - was)}` }]
  return [{ tone: "warn", label: `${count(was)} → ${count(now)}` }]
}

/// Where each unacknowledged change is drawn on the board. Placed against the
/// WHOLE board (before the search and the store filter), so a filter never
/// turns a change into a standalone card.
export interface ChangePlacement {
  /// On a To pick card, by `pickCardKey`.
  readonly pick: ReadonlyMap<string, readonly DcChange[]>
  /// On a Picked card, by shop.
  readonly shop: ReadonlyMap<string, readonly DcChange[]>
  /// On Packed cards, by carton.
  readonly koli: ReadonlyMap<string, readonly DcChange[]>
  /// No card left anywhere: a card of its own in the To pick lane (a picklist
  /// MD cancelled while it was still on the Pick List must not vanish
  /// unseen, owner 10 Oct 2026).
  readonly alone: readonly DcChange[]
}

/// First home wins: the allotment's own To pick card; else its shop's Picked
/// card; else the cartons that hold its pieces (from the owed list), or any
/// sealed carton of the shop; else alone.
export function placeChanges(
  changes: readonly DcChange[],
  picks: readonly { allotment_id: string; destination_id: string }[],
  pickedShops: ReadonlySet<string>,
  cartons: readonly { koli_id: string; destination_id: string }[],
  owed: readonly OwedWork[]
): ChangePlacement {
  const pick = new Map<string, DcChange[]>()
  const shop = new Map<string, DcChange[]>()
  const koli = new Map<string, DcChange[]>()
  const alone: DcChange[] = []
  const put = (into: Map<string, DcChange[]>, key: string, one: DcChange) =>
    into.set(key, [...(into.get(key) ?? []), one])
  const keyed = new Set(
    picks.map((one) => pickCardKey(one.allotment_id, one.destination_id))
  )
  for (const one of changes) {
    const key = pickCardKey(one.allotment_id, one.destination_id)
    if (keyed.has(key)) {
      put(pick, key, one)
      continue
    }
    if (pickedShops.has(one.destination_id)) {
      put(shop, one.destination_id, one)
      continue
    }
    const mine = cartons.filter((c) => c.destination_id === one.destination_id)
    const linked = new Set(
      owed
        .filter(
          (w) =>
            w.allotment_id === one.allotment_id &&
            w.destination_id === one.destination_id
        )
        .flatMap((w) => w.lines.flatMap((l) => l.koli.map((k) => k.koli_id)))
    )
    const on = mine.filter((c) => linked.has(c.koli_id))
    const homes = on.length > 0 ? on : mine
    if (homes.length === 0) alone.push(one)
    else for (const c of homes) put(koli, c.koli_id, one)
  }
  return { pick, shop, koli, alone }
}

/// What a pending change means for a pick in progress: a cancel takes the
/// whole picklist, a reduce takes the SKUs it names. Either way, pieces the
/// server refuses on those are MD's doing, not a short pick.
export function staleSkus(items: readonly DcChange[]): {
  readonly all: boolean
  readonly skus: ReadonlySet<string>
} {
  const skus = new Set<string>()
  for (const one of items)
    for (const line of one.lines)
      if (line.kind !== "ADD") skus.add(line.sku_code)
  return { all: items.some((one) => one.cancelled), skus }
}
