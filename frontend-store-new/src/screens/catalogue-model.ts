import type {
  CatalogRow,
  FinalPromotion,
  FinalUnitPrice,
  SkuStockRow,
  StoreOffer,
} from "@itulah/contract"

import { dealsOf, type Deals } from "@/lib/deals"
import { isDown } from "@/lib/prices"
import { paintOf, type ArticleShape } from "@/lib/variants"

/// The Catalogue's data, joined once: each SKU with its colour and size, the
/// price a walk-in pays for it now, its stock and the deals that reach it —
/// and the filters, the facet counts and the cards, all decided in the browser
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

// ── filters ─────────────────────────────────────────────────────────────────

export interface Filters {
  readonly division: string | undefined
  /// Colours, lower case.
  readonly colours: readonly string[]
  readonly sizes: readonly string[]
  readonly deals: readonly Deal[]
  readonly tags: readonly string[]
  /// Show the SKUs nothing is left of.
  readonly soldOut: boolean
}

export const NO_FILTERS: Filters = {
  division: undefined,
  colours: [],
  sizes: [],
  deals: [],
  tags: [],
  soldOut: true,
}

type Group = "division" | "colour" | "size" | "deal" | "tag" | "stock"

/// Whether an item survives every filter but `except` — the one whose own
/// counts are being taken, so choosing Navy does not make every other colour
/// read zero and stop being a way to look.
///
/// Within a group the choices widen (Navy or Black); across groups they
/// narrow (Navy, in M, on promotion). Tags narrow within their group too: a
/// row must carry every tag chosen, as before.
export function passes(item: Item, filters: Filters, except?: Group): boolean {
  if (
    except !== "division" &&
    filters.division !== undefined &&
    item.row.division_code !== filters.division
  )
    return false
  if (
    except !== "colour" &&
    filters.colours.length > 0 &&
    !filters.colours.includes((item.colour ?? "").toLowerCase())
  )
    return false
  if (
    except !== "size" &&
    filters.sizes.length > 0 &&
    !filters.sizes.includes(item.size ?? "")
  )
    return false
  if (
    except !== "deal" &&
    filters.deals.length > 0 &&
    !filters.deals.some((deal) => hasDeal(item, deal))
  )
    return false
  if (
    except !== "tag" &&
    filters.tags.length > 0 &&
    !filters.tags.every((tag) => item.row.tags.includes(tag))
  )
    return false
  if (except !== "stock" && !filters.soldOut && soldOut(item)) return false
  return true
}

export function filterCount(filters: Filters): number {
  return (
    filters.colours.length +
    filters.sizes.length +
    filters.deals.length +
    filters.tags.length +
    (filters.soldOut ? 0 : 1)
  )
}

// ── facets ──────────────────────────────────────────────────────────────────

export interface ColourFacet {
  /// Lower case — what the filter holds.
  readonly key: string
  readonly label: string
  readonly paint: readonly string[]
  readonly count: number
}

export interface Facets {
  /// Commonest first.
  readonly divisions: readonly (readonly [string, number])[]
  readonly colours: readonly ColourFacet[]
  /// Smallest first, as the articles' own sizes run.
  readonly sizes: readonly (readonly [string, number])[]
  readonly deals: ReadonlyMap<Deal, number>
  readonly tags: readonly (readonly [string, number])[]
  /// How many units are sold out, every other filter applied.
  readonly soldOut: number
  /// What "Everything" holds: every filter but the division.
  readonly everything: number
}

/// Each facet's counts, in the unit the list is showing — articles or SKUs —
/// so a figure and the cards it narrows to cannot disagree.
export function facetsOf(
  items: readonly Item[],
  filters: Filters,
  unit: (item: Item) => string,
  sizeOrder: (sizes: string[]) => string[],
): Facets {
  const tally = (group: Group, values: (item: Item) => readonly string[]) => {
    const sets = new Map<string, Set<string>>()
    for (const item of items) {
      if (!passes(item, filters, group)) continue
      for (const value of values(item)) {
        const set = sets.get(value)
        if (set === undefined) sets.set(value, new Set([unit(item)]))
        else set.add(unit(item))
      }
    }
    return new Map([...sets].map(([value, set]) => [value, set.size] as const))
  }
  const commonest = (counts: Map<string, number>) =>
    [...counts].sort((a, b) =>
      a[1] === b[1] ? a[0].localeCompare(b[0]) : b[1] - a[1],
    )

  const colourLabels = new Map<string, { label: string; name: string }>()
  for (const item of items)
    if (item.colour !== null && !colourLabels.has(item.colour.toLowerCase()))
      colourLabels.set(item.colour.toLowerCase(), {
        label: item.colour,
        name: item.row.name,
      })

  const sizeCounts = tally("size", (item) =>
    item.size === null ? [] : [item.size],
  )
  const everything = new Set<string>()
  const sold = new Set<string>()
  for (const item of items) {
    if (passes(item, filters, "division")) everything.add(unit(item))
    if (passes(item, filters, "stock") && soldOut(item)) sold.add(unit(item))
  }

  return {
    divisions: commonest(
      tally("division", (item) =>
        item.row.division_code === null || item.row.division_code === ""
          ? []
          : [item.row.division_code],
      ),
    ),
    colours: commonest(
      tally("colour", (item) =>
        item.colour === null ? [] : [item.colour.toLowerCase()],
      ),
    ).map(([key, count]) => {
      const seen = colourLabels.get(key)
      return {
        key,
        label: seen?.label ?? key,
        paint: paintOf(seen?.label ?? key, seen?.name ?? ""),
        count,
      }
    }),
    sizes: sizeOrder([...sizeCounts.keys()]).map(
      (size) => [size, sizeCounts.get(size) ?? 0] as const,
    ),
    deals: new Map(
      [
        ...tally("deal", (item) =>
          DEALS.filter(([deal]) => hasDeal(item, deal)).map(([deal]) => deal),
        ),
      ].map(([deal, howMany]) => [deal as Deal, howMany] as const),
    ),
    tags: commonest(tally("tag", (item) => item.row.tags)),
    soldOut: sold.size,
    everything: everything.size,
  }
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
