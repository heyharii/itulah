import type {
  CatalogRow,
  FinalPromotion,
  FinalUnitPrice,
  SkuStockRow,
  StoreOffer,
} from "@itulah/contract"

import { dealsOf, type Deals } from "@/lib/deals"
import { isDown } from "@/lib/prices"
import { type ArticleShape } from "@/lib/variants"
import { parseMoneyToMinor } from "@itulah/contract/money"

/// The Catalogue's data, joined once: each SKU with its colour and size, the
/// price a walk-in pays for it now, its stock and the deals that reach it —
/// and the search and the cards, all decided in the browser
/// over the whole book in hand (see `catalogue.tsx` for why).

export interface Item {
  readonly row: CatalogRow
  /// The article it belongs to — its code, or its own SKU code alone.
  readonly key: string
  readonly colour: string | null
  readonly size: string | null
  /// What one piece costs a walk-in shopper now: the engine's final price
  /// where a promotion brings it down, otherwise the shelf price.
  readonly final: number
  /// The promotions that brought `final` down.
  readonly applied: readonly FinalPromotion[]
  /// `null` while the shop's stock is not known (loading, or a node that
  /// cannot say) — which is not the same as none.
  readonly stock: Pick<SkuStockRow, "floor" | "warehouse" | "total"> | null
  readonly deals: Deals
}

export type Deal = "down" | "promotion" | "voucher" | "members"

export const DEALS: readonly (readonly [Deal, string])[] = [
  ["down", "Price down"],
  ["promotion", "Promotion"],
  ["voucher", "Voucher"],
  ["members", "Members"],
]

export function hasDeal(item: Item, deal: Deal): boolean {
  switch (deal) {
    case "down":
      return isDown(item.row)
    case "promotion":
      return item.applied.length > 0 || item.deals.promotion.length > 0
    case "voucher":
      return item.deals.voucher.length > 0
    case "members":
      return item.deals.members.length > 0
  }
}

export function soldOut(item: Item): boolean {
  return item.stock !== null && item.stock.total <= 0
}

export function itemsOf({
  rows,
  shapes,
  finals,
  stock,
  offers,
}: {
  rows: readonly CatalogRow[]
  shapes: ReadonlyMap<string, ArticleShape>
  finals: ReadonlyMap<string, FinalUnitPrice>
  stock: ReadonlyMap<string, SkuStockRow> | null
  offers: readonly StoreOffer[]
}): Item[] {
  return rows.map((row) => {
    const key = row.article_code ?? row.sku_code
    const variant = shapes.get(key)?.variant.get(row.sku_code)
    const final = finals.get(row.sku_code)
    const held = stock?.get(row.sku_code)
    return {
      row,
      key,
      colour: variant?.colour ?? null,
      size: variant?.size ?? null,
      // Never above the shelf: a final price is the shelf price less what a
      // promotion takes off, and a stale answer from before a markdown must
      // not quote more than the till now charges.
      final: Math.min(
        final?.final_unit_price_minor ?? row.unit_price_minor,
        row.unit_price_minor,
      ),
      applied: final?.promotions ?? [],
      stock:
        stock === null
          ? null
          : held === undefined
            ? { floor: 0, warehouse: 0, total: 0 }
            : held,
      deals: dealsOf(row, offers),
    }
  })
}

// ── search ──────────────────────────────────────────────────────────────────

/// What the one box understands. The Catalogue has no filters: whatever
/// somebody would have narrowed by, they type.
///
///   kaos navy l        words: every one must match the SKU somewhere
///   sold out · habis   none left        in stock · ready   some left
///   promo · diskon     brought down, or a promotion reaches it
///   voucher · member   a code, or a members' price
///   <100k  >150rb  100k-200k           what a walk-in pays
export interface Query {
  readonly words: readonly string[]
  /// `true`: only what is sold out; `false`: only what is left; `null`: both.
  readonly soldOut: boolean | null
  /// Any of them.
  readonly deals: readonly Deal[]
  readonly min: number | null
  readonly max: number | null
}

export function isBlank(query: Query): boolean {
  return (
    query.words.length === 0 &&
    query.soldOut === null &&
    query.deals.length === 0 &&
    query.min === null &&
    query.max === null
  )
}

/// The phrases that are not words, in Indonesian as well: the shop's people
/// type what they say.
const KEYWORDS: readonly (readonly [RegExp, Partial<Query>])[] = [
  [/(sold ?out|habis|kosong)/, { soldOut: true }],
  [/(in ?stock|ready|ada stok|tersedia)/, { soldOut: false }],
  [/(price ?down|markdown|turun harga)/, { deals: ["down"] }],
  [/(promo(tion)?s?|diskon|discount|sale)/, { deals: ["down", "promotion"] }],
  [/(vouchers?|kupon)/, { deals: ["voucher"] }],
  [/(members?)/, { deals: ["members"] }],
]

const AMOUNT = String.raw`(\d[\d.,]*)\s?(k|rb|ribu|jt|juta)?`

export function parseQuery(text: string, currency: string): Query {
  let rest = ` ${text.toLowerCase()} `
  let soldOut: boolean | null = null
  const deals = new Set<Deal>()
  let min: number | null = null
  let max: number | null = null

  const amount = (digits: string, unit: string | undefined) => {
    const scale =
      unit === "k" || unit === "rb" || unit === "ribu"
        ? 1_000
        : unit === "jt" || unit === "juta"
          ? 1_000_000
          : 1
    const major = Number(digits.replace(/[.,]/g, "")) * scale
    return parseMoneyToMinor(String(major), currency)
  }
  const take = (pattern: RegExp, on: (match: string[]) => void) => {
    rest = rest.replace(
      new RegExp(String.raw`(?<=\s)${pattern.source}(?=\s)`, "g"),
      (...match: string[]) => {
        on(match)
        return " "
      },
    )
  }

  take(new RegExp(`${AMOUNT}\\s?-\\s?${AMOUNT}`), ([, a, ua, b, ub]) => {
    min = amount(a ?? "", ua)
    max = amount(b ?? "", ub)
  })
  take(new RegExp(`([<>])\\s?${AMOUNT}`), ([, sign, digits, unit]) => {
    if (sign === "<") max = amount(digits ?? "", unit)
    else min = amount(digits ?? "", unit)
  })
  for (const [pattern, effect] of KEYWORDS)
    take(pattern, () => {
      if (effect.soldOut !== undefined) soldOut = effect.soldOut
      for (const deal of effect.deals ?? []) deals.add(deal)
    })

  return {
    words: rest.split(/\s+/).filter((word) => word !== ""),
    soldOut,
    deals: [...deals],
    min,
    max,
  }
}

/// Everything a word can find on one SKU, lower case, in one string.
export function haystackOf(item: Item, divisionName: string): string {
  const { row, deals } = item
  return [
    row.name,
    row.sku_code,
    row.barcode ?? "",
    row.article_code ?? "",
    item.colour ?? "",
    item.size ?? "",
    row.division_code ?? "",
    divisionName,
    ...row.tags,
    ...item.applied.map((one) => one.name),
    ...deals.promotion.map((one) => one.name),
    ...deals.voucher.map((one) => one.coupon_code ?? one.name),
    ...deals.members.map((one) => one.name),
  ]
    .join(" ")
    .toLowerCase()
}

/// Whether one SKU is what was asked for.
///
/// A word that is one of the book's sizes means the size — "kaos l" is the
/// large, not every kaos with an L in its name — unless it stands on its own
/// in the name or the colour.
export function matchesQuery(
  item: Item,
  query: Query,
  haystack: string,
  sizes: ReadonlySet<string>,
): boolean {
  if (query.soldOut !== null && soldOut(item) !== query.soldOut) return false
  if (
    query.deals.length > 0 &&
    !query.deals.some((deal) => hasDeal(item, deal))
  )
    return false
  if (query.min !== null && item.final < query.min) return false
  if (query.max !== null && item.final > query.max) return false
  return query.words.every((word) => {
    if (sizes.has(word))
      return (
        (item.size ?? "").toLowerCase() === word ||
        ` ${item.row.name} ${item.colour ?? ""} `
          .toLowerCase()
          .includes(` ${word} `)
      )
    return haystack.includes(word) || haystack.includes(word.replace(/·/g, ""))
  })
}

// ── cards ───────────────────────────────────────────────────────────────────

/// One tile or one table row: an article and the SKUs of it that matched, or
/// one SKU.
export interface Card {
  readonly key: string
  readonly shape: ArticleShape
  /// The SKU it stands for: the cheapest that matched, or the one SKU.
  readonly lead: Item
  readonly items: readonly Item[]
  /// The matched SKUs are not all the same price.
  readonly from: boolean
  /// Pieces held across the matched SKUs; `null` while stock is unknown.
  readonly stock: Item["stock"]
  readonly soldOut: boolean
}

export function cardsOf(
  matched: readonly Item[],
  shapes: ReadonlyMap<string, ArticleShape>,
  bySku: boolean,
): Card[] {
  const groups = new Map<string, Item[]>()
  for (const item of matched) {
    const key = bySku ? item.row.sku_code : item.key
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [item])
    else group.push(item)
  }
  const cards: Card[] = []
  for (const [key, group] of groups) {
    const first = group[0]
    if (first === undefined) continue
    const shape = shapes.get(first.key)
    if (shape === undefined) continue
    const lead = group.reduce((a, b) => (b.final < a.final ? b : a))
    const known = group.every((item) => item.stock !== null)
    const stock = known
      ? group.reduce(
          (sum, item) => ({
            floor: sum.floor + (item.stock?.floor ?? 0),
            warehouse: sum.warehouse + (item.stock?.warehouse ?? 0),
            total: sum.total + (item.stock?.total ?? 0),
          }),
          { floor: 0, warehouse: 0, total: 0 },
        )
      : null
    cards.push({
      key,
      shape,
      lead,
      items: group,
      from: group.some((item) => item.final !== lead.final),
      stock,
      soldOut: stock !== null && stock.total <= 0,
    })
  }
  return cards
}

export type Order = "range" | "cheapest" | "dearest" | "name" | "stock"

export const ORDERS: readonly (readonly [Order, string])[] = [
  ["range", "Range"],
  ["cheapest", "Cheapest"],
  ["dearest", "Dearest"],
  ["name", "A–Z"],
  ["stock", "Most stock"],
]

export function sortCards(cards: Card[], order: Order): Card[] {
  switch (order) {
    // The order the node sent them in — by SKU code, which is the order the
    // range is numbered in, which is how a shop's own people talk about it.
    case "range":
      return cards
    case "cheapest":
      return [...cards].sort((a, b) => a.lead.final - b.lead.final)
    case "dearest":
      return [...cards].sort((a, b) => b.lead.final - a.lead.final)
    case "name":
      return [...cards].sort((a, b) => a.shape.name.localeCompare(b.shape.name))
    case "stock":
      return [...cards].sort(
        (a, b) => (b.stock?.total ?? 0) - (a.stock?.total ?? 0),
      )
  }
}

/// Pieces held of each size and each colour of an article, across all its
/// SKUs — what strikes a size or a swatch out on a tile — and of each size
/// within each colour, so "Navy is gone in M but there is an L" can be said.
/// `null` while stock is unknown.
export interface Holding {
  readonly sizes: ReadonlyMap<string, number>
  readonly colours: ReadonlyMap<string, number>
  /// Colour (lower case) → size → pieces.
  readonly byColour: ReadonlyMap<string, ReadonlyMap<string, number>>
}

export function holdingsOf(
  items: readonly Item[],
): ReadonlyMap<string, Holding | null> {
  const out = new Map<
    string,
    {
      sizes: Map<string, number>
      colours: Map<string, number>
      byColour: Map<string, Map<string, number>>
    } | null
  >()
  for (const item of items) {
    if (item.stock === null) {
      out.set(item.key, null)
      continue
    }
    let holding = out.get(item.key)
    if (holding === null) continue
    if (holding === undefined) {
      holding = { sizes: new Map(), colours: new Map(), byColour: new Map() }
      out.set(item.key, holding)
    }
    const size = item.size ?? ""
    const colour = (item.colour ?? "").toLowerCase()
    const held = item.stock.total
    holding.sizes.set(size, (holding.sizes.get(size) ?? 0) + held)
    holding.colours.set(colour, (holding.colours.get(colour) ?? 0) + held)
    let sizes = holding.byColour.get(colour)
    if (sizes === undefined) {
      sizes = new Map()
      holding.byColour.set(colour, sizes)
    }
    sizes.set(size, (sizes.get(size) ?? 0) + held)
  }
  return out
}

/// The sizes of one colour still held, in the article's own size order — for
/// a swatch's tooltip and a table's colour dot.
export function sizesLeft(
  holding: Holding,
  colour: string | null,
  order: readonly string[],
): string[] {
  const sizes = holding.byColour.get((colour ?? "").toLowerCase())
  if (sizes === undefined) return []
  return order.filter((size) => (sizes.get(size) ?? 0) > 0)
}

/// Whole percent off, rounded down: "21% off" on something that is 20.6% off
/// is a promise the till will not keep to the rupiah.
export function percentOff(now: number, was: number): number {
  return was > now && was > 0 ? Math.floor(((was - now) / was) * 100) : 0
}

/// The deals on a card, across the SKUs it stands for, each named once.
export interface CardDeals {
  readonly applied: readonly FinalPromotion[]
  readonly promotion: readonly StoreOffer[]
  readonly voucher: readonly StoreOffer[]
  readonly members: readonly StoreOffer[]
}

export function dealsOfCard(items: readonly Item[]): CardDeals {
  const applied = new Map<string, FinalPromotion>()
  const promotion = new Map<string, StoreOffer>()
  const voucher = new Map<string, StoreOffer>()
  const members = new Map<string, StoreOffer>()
  for (const item of items) {
    for (const one of item.applied)
      if (!applied.has(one.rule_id)) applied.set(one.rule_id, one)
    for (const one of item.deals.promotion) promotion.set(one.rule_id, one)
    for (const one of item.deals.voucher) voucher.set(one.rule_id, one)
    for (const one of item.deals.members) members.set(one.rule_id, one)
  }
  return {
    applied: [...applied.values()],
    // An applied promotion is said once, by the name it came off under.
    promotion: [...promotion.values()].filter(
      (offer) => !applied.has(offer.rule_id),
    ),
    voucher: [...voucher.values()],
    members: [...members.values()],
  }
}

/// The deals as words, most useful first: what has come off, what comes off
/// on its own, the codes, then the members' price.
export function dealWords(deals: CardDeals): string[] {
  return [
    ...deals.applied.map((one) => one.name),
    ...deals.promotion.map((one) => one.name),
    ...deals.voucher.map((one) => `Code ${one.coupon_code ?? ""}`),
    // Said as a members' deal unless its own name already says so.
    ...deals.members.map((one) =>
      /member/i.test(one.name) ? one.name : `Members: ${one.name}`,
    ),
  ]
}
