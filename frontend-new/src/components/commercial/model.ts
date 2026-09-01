/*
 * The commercial model, resolved entirely from the Go hub's own commercial and
 * pricing-engine reads. The ordering below is the whole point, and it is the
 * order `internal/pricingengine` itself uses:
 *
 *   1. Price-list cascade: store-exact > store-group > member-tier > global,
 *      falling back to the article's own base price.
 *   2. A markdown REPLACES the resolved price. It is a price source, not a
 *      discount, so it never stacks with the cascade — it wins outright.
 *   3. Pricing rules run AFTER the price is settled. They are offers on top,
 *      never folded into the main price.
 *   4. A campaign is a lifecycle and budget container, not a mechanic.
 *   5. A coupon unlocks a rule; a voucher is value the customer already holds.
 *
 * One thing about this hub has to be said plainly, because it shapes step 1:
 * the engine supports all four cascade levels, but the CLOUD tables only feed
 * the bottom one. `internal/cloud/pricing.fetchPrices` reads every row of
 * `commercial_price_entries` and stamps it `LevelGlobalDefault` — a commercial
 * price list carries no store, store-group or tier scope, and the
 * `/v1/pricemanagement/lists` route that would author one is a stub. So on
 * this deployment every authored price resolves at the global level, and the
 * three levels above it are shown as unsourced rather than filled in locally.
 *
 * Nothing here is synthesized. Where the hub has no row for a level, the level
 * resolves to nothing and says so.
 */

import { todayKey, type DayKey } from "@/lib/day"

import type {
  CommercialArticle,
  CommercialCampaign,
  CommercialCoupon,
  CommercialMarkdown,
  CommercialPriceEntry,
  CommercialPriceList,
  CommercialPricingRule,
  CommercialResource,
  CommercialStore,
  CommercialTier,
} from "@/components/commercial/api"

export const CHANNELS = ["pos", "online"] as const
export type Channel = (typeof CHANNELS)[number]

/**
 * Who is standing at the till: "" is a walk-in, `member` is any member with no
 * tier resolved, and anything else is a tier id from the loyalty programme.
 * The engine's `CustomerScope` reads exactly these three cases.
 */
export type Tier = string

export const ANY_MEMBER: Tier = "member"

export interface PriceContext {
  /** A location id — commercial scopes stores by `location_id`. */
  storeId?: string
  channel: Channel
  tier: Tier
}

/* ── the price-list cascade ──────────────────────────────────── */

export type PriceLevel =
  | "store-exact"
  | "store-group"
  | "member-tier"
  | "global"

export const LEVEL_LABEL: Record<PriceLevel, string> = {
  "store-exact": "Store price",
  "store-group": "Store group price",
  "member-tier": "Tier price",
  global: "Global price",
}

/** Most specific first — the order the resolver walks. */
export const CASCADE: PriceLevel[] = [
  "store-exact",
  "store-group",
  "member-tier",
  "global",
]

/** A price-list entry, carrying the cascade level its list sits at. */
export interface LevelledEntry {
  level: PriceLevel
  list: CommercialPriceList
  entry: CommercialPriceEntry
}

export interface ResolvedPrice {
  price?: number
  source: PriceLevel | "markdown" | "base" | "none"
  /** The price the markdown replaced, when one applied. */
  wasPrice?: number
  entry?: LevelledEntry
  markdown?: CommercialMarkdown
}

export type Mechanic =
  | "percent"
  | "amount"
  | "fixed"
  | "margin"
  | "bogo"
  | "points"
  | "other"

export const MECHANIC_LABEL: Record<Mechanic, string> = {
  percent: "% off",
  amount: "Rp off",
  fixed: "Fixed price",
  margin: "Margin price",
  bogo: "Free item",
  points: "Points",
  other: "Offer",
}

/** One catalogue row: an article, and whether Internal has a master for it. */
export interface CatalogueArticle {
  id: string
  code: string
  name: string
  division: string
  tags: string[]
  skus: string[]
  basePrice?: number
  /** Set when the article is only known as the target of a price-list entry. */
  pricedOnly: boolean
}

const inWindow = (from?: DayKey, to?: DayKey) => {
  const today = todayKey()
  if (from && today < from) return false
  if (to && today > to) return false
  return true
}

/**
 * The level a price list sits at. On this hub there is only one answer:
 * `internal/cloud/pricing.fetchPrices` stamps every `commercial_price_entries`
 * row `LevelGlobalDefault` regardless of which list it belongs to, because the
 * table has no store, group or tier column to stamp anything else from.
 */
function levelOf(_list: CommercialPriceList): PriceLevel {
  return "global"
}

/**
 * A list applies wherever it is active. There is no store scope on the hub's
 * price list to narrow it with — an inactive list is simply not read into the
 * snapshot at all.
 */
function listApplies(list: CommercialPriceList): boolean {
  return list.active
}

function matchesArticle(
  entry: CommercialPriceEntry,
  article: CatalogueArticle
): boolean {
  if (entry.articleId && entry.articleId === article.id) return true
  return article.skus.includes(entry.sku)
}

function markdownApplies(
  markdown: CommercialMarkdown,
  article: CatalogueArticle,
  ctx: PriceContext
): boolean {
  if (markdown.status !== "active") return false
  if (!inWindow(markdown.startsOn, markdown.endsOn)) return false
  const hits =
    (markdown.articleId && markdown.articleId === article.id) ||
    article.skus.includes(markdown.sku)
  if (!hits) return false
  if (!markdown.storeIds.length) return true
  return Boolean(ctx.storeId && markdown.storeIds.includes(ctx.storeId))
}

/**
 * The mechanic a rule expresses. `kind` decides first: the engine's product
 * rules hand over a free item and carry no price effect at all, so they can
 * never be read off `effect`.
 */
export function ruleMechanic(rule: CommercialPricingRule): Mechanic {
  if (rule.kind === "product") return "bogo"
  if (rule.kind === "loyalty_earn") return "points"
  switch (rule.effect) {
    case "percent":
      return "percent"
    case "amount":
      return "amount"
    case "fixed_price":
      return "fixed"
    case "margin":
      return "margin"
    default:
      return "other"
  }
}

function ruleApplies(
  rule: CommercialPricingRule,
  article: CatalogueArticle,
  ctx: PriceContext,
  storeGroupsOf: (storeId: string) => string[]
): boolean {
  if (rule.status !== "active") return false
  if (!inWindow(rule.startsOn, rule.endsOn)) return false
  if (rule.storeIds.length && !(ctx.storeId && rule.storeIds.includes(ctx.storeId)))
    return false
  if (rule.storeGroups.length) {
    const groups = ctx.storeId ? storeGroupsOf(ctx.storeId) : []
    if (!rule.storeGroups.some((group) => groups.includes(group))) return false
  }
  if (rule.channels.length && !rule.channels.includes(ctx.channel)) return false

  /* CustomerScope, straight from the engine: `all` takes anyone, `member`
   * needs a member at the till, `tiers` needs one of the named tiers. */
  if (rule.customerScope === "member" && !ctx.tier) return false
  if (rule.customerScope === "tiers") {
    if (!ctx.tier || ctx.tier === ANY_MEMBER) return false
    if (rule.tierIds.length && !rule.tierIds.includes(ctx.tier)) return false
  }

  switch (rule.applyOn) {
    case "sku":
      return rule.skus.some((sku) => article.skus.includes(sku))
    case "article":
      return rule.articleIds.includes(article.id)
    case "division":
      return rule.divisions.includes(article.division)
    case "tag":
      return rule.tags.some((tag) => article.tags.includes(tag))
    case "transaction":
      return true
    default:
      return false
  }
}

export interface CommercialModel {
  articles: CatalogueArticle[]
  stores: CommercialStore[]
  tiers: CommercialTier[]
  campaigns: CommercialCampaign[]
  /** Rule ids that a coupon unlocks. A coupon unlocks a rule, never a price. */
  couponedRuleIds: Set<string>
  couponsForRule(ruleId: string): CommercialCoupon[]
  articleById(id: string): CatalogueArticle | undefined
  campaignById(id: string): CommercialCampaign | undefined
  /** Every price-list entry that names this article, with its cascade level. */
  entriesFor(article: CatalogueArticle): LevelledEntry[]
  /** Cascade first, then a markdown replaces whatever it resolved to. */
  resolvePrice(article: CatalogueArticle, ctx: PriceContext): ResolvedPrice
  /** Offers that run after the price is settled, in priority order. */
  offersFor(
    article: CatalogueArticle,
    ctx: PriceContext
  ): CommercialPricingRule[]
}

const EMPTY_MODEL: CommercialModel = {
  articles: [],
  stores: [],
  tiers: [],
  campaigns: [],
  couponedRuleIds: new Set<string>(),
  couponsForRule: () => [],
  articleById: () => undefined,
  campaignById: () => undefined,
  entriesFor: () => [],
  resolvePrice: () => ({ source: "none" }),
  offersFor: () => [],
}

function catalogueFromMaster(article: CommercialArticle): CatalogueArticle {
  return {
    id: article.id,
    code: article.code,
    name: article.name,
    division: article.divisionName,
    tags: article.tags,
    skus: article.skus,
    basePrice: article.basePrice,
    pricedOnly: false,
  }
}

/**
 * Builds the model from one Internal read. Articles are the article master;
 * article ids that only ever appear as price-list or markdown targets are
 * carried too, marked as having no master record, so a priced article is
 * never silently dropped from the catalogue.
 */
export function buildCommercialModel(
  data: CommercialResource | null | undefined
): CommercialModel {
  if (!data) return EMPTY_MODEL

  const articles = data.articles.map(catalogueFromMaster)
  const knownIds = new Set(articles.map((article) => article.id))
  const knownSkus = new Set(articles.flatMap((article) => article.skus))

  const orphans = new Map<string, Set<string>>()
  const noteOrphan = (articleId: string, sku: string) => {
    if (!articleId && !sku) return
    if (articleId && knownIds.has(articleId)) return
    if (sku && knownSkus.has(sku)) return
    const key = articleId || sku
    const skus = orphans.get(key) ?? new Set<string>()
    if (sku) skus.add(sku)
    orphans.set(key, skus)
  }
  for (const list of data.priceLists) {
    for (const entry of list.entries) noteOrphan(entry.articleId, entry.sku)
  }
  for (const markdown of data.markdowns) {
    noteOrphan(markdown.articleId, markdown.sku)
  }

  for (const [id, skus] of orphans) {
    articles.push({
      id,
      code: id,
      name: id,
      division: "",
      tags: [],
      skus: [...skus],
      basePrice: undefined,
      pricedOnly: true,
    })
  }

  const articleIndex = new Map(articles.map((article) => [article.id, article]))
  const campaignIndex = new Map(
    data.campaigns.map((campaign) => [campaign.id, campaign])
  )
  const couponedRuleIds = new Set(
    data.coupons.map((coupon) => coupon.ruleId).filter(Boolean)
  )
  const couponsByRule = new Map<string, CommercialCoupon[]>()
  for (const coupon of data.coupons) {
    if (!coupon.ruleId) continue
    couponsByRule.set(coupon.ruleId, [
      ...(couponsByRule.get(coupon.ruleId) ?? []),
      coupon,
    ])
  }

  /* The engine matches a rule's `store_groups` against the groups the store is
   * a member of, so the membership map is inverted once here. */
  const groupsByStore = new Map<string, string[]>()
  for (const group of data.storeGroups) {
    for (const storeId of group.storeIds) {
      groupsByStore.set(storeId, [
        ...(groupsByStore.get(storeId) ?? []),
        group.id,
      ])
    }
  }
  const storeGroupsOf = (storeId: string) => groupsByStore.get(storeId) ?? []

  const levelled: LevelledEntry[] = data.priceLists.flatMap((list) => {
    const level = levelOf(list)
    return list.entries.map((entry) => ({ level, list, entry }))
  })

  /* The catalogue is fifteen hundred SKUs against as many price entries, so
   * the entries are indexed by what they name rather than rescanned per row. */
  const entriesByKey = new Map<string, LevelledEntry[]>()
  const indexEntry = (key: string, row: LevelledEntry) => {
    if (!key) return
    entriesByKey.set(key, [...(entriesByKey.get(key) ?? []), row])
  }
  for (const row of levelled) {
    indexEntry(row.entry.sku, row)
    indexEntry(row.entry.articleId, row)
  }

  const entriesFor = (article: CatalogueArticle) => {
    const seen = new Set<LevelledEntry>()
    for (const key of [article.id, ...article.skus]) {
      for (const row of entriesByKey.get(key) ?? []) {
        if (matchesArticle(row.entry, article)) seen.add(row)
      }
    }
    return [...seen]
  }

  const resolvePrice = (
    article: CatalogueArticle,
    ctx: PriceContext
  ): ResolvedPrice => {
    const candidates = entriesFor(article).filter(
      ({ list, entry }) =>
        entry.active && listApplies(list) && inWindow(entry.startsOn, entry.endsOn)
    )

    let winner: LevelledEntry | undefined
    for (const level of CASCADE) {
      const atLevel = candidates.filter((row) => row.level === level)
      if (!atLevel.length) continue
      // Internal orders competing entries inside a level by priority.
      winner = [...atLevel].sort((a, b) => b.entry.priority - a.entry.priority)[0]
      break
    }

    const base = winner?.entry.price ?? article.basePrice
    const source: ResolvedPrice["source"] = winner
      ? winner.level
      : article.basePrice === undefined
        ? "none"
        : "base"

    const markdown = data.markdowns.find((row) =>
      markdownApplies(row, article, ctx)
    )
    if (markdown) {
      return {
        price: markdown.markdownPrice,
        source: "markdown",
        wasPrice: base ?? markdown.originalPrice,
        entry: winner,
        markdown,
      }
    }

    return { price: base, source, entry: winner }
  }

  /* Higher priority wins in the engine, so the strongest offer leads. */
  const offersFor = (article: CatalogueArticle, ctx: PriceContext) =>
    data.pricingRules
      .filter((rule) => ruleApplies(rule, article, ctx, storeGroupsOf))
      .sort((a, b) => b.priority - a.priority)

  return {
    articles,
    stores: data.stores,
    tiers: data.tiers,
    campaigns: data.campaigns,
    couponedRuleIds,
    couponsForRule: (ruleId) => couponsByRule.get(ruleId) ?? [],
    articleById: (id) => articleIndex.get(id),
    campaignById: (id) => campaignIndex.get(id),
    entriesFor,
    resolvePrice,
    offersFor,
  }
}

export const rupiah = (value: number) =>
  `Rp ${Math.round(value).toLocaleString("id-ID")}`

export const shortRupiah = (value: number) => {
  if (Math.abs(value) >= 1_000_000_000)
    return `Rp ${(value / 1_000_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000_000)
    return `Rp ${Math.round(value / 1_000_000)}jt`
  return rupiah(value)
}
