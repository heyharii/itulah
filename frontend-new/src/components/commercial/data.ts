/* The commercial model, kept deliberately close to the one the real pricing
 * engine uses, because the ordering is the whole point:
 *
 *   1. Price-list cascade: store-exact > store-group > member-tier > global,
 *      falling back to the article's base price.
 *   2. A markdown REPLACES the resolved base price. It is a price source, not
 *      a discount, so it never stacks with the cascade — it wins outright.
 *   3. Pricing rules run AFTER the price is settled. They are offers on top,
 *      never folded into the main price.
 *   4. A campaign is a lifecycle and budget container, not a mechanic.
 *   5. A coupon unlocks a rule; a voucher is value a customer already holds.
 *   6. Return policies resolve most-specific-first, independently of price.
 *
 * Prices, windows and codes are synthesized; the articles and photography come
 * from the catalogue. */

import { PRODUCTS, SUPPLIERS, type Product } from "@/components/sourcing/catalogue"
import { INV_LOCATIONS } from "@/components/inventory/data"
import { addDays, noise, todayKey, type DayKey } from "@/lib/day"

export const ARTICLES: Product[] = PRODUCTS.filter(
  (product, index) => PRODUCTS.findIndex((p) => p.id === product.id) === index
)

export const articleOf = (id: string) => ARTICLES.find((a) => a.id === id)

export const divisionOf = (product: Product) =>
  SUPPLIERS.find((s) => s.id === product.supplierId)?.division ?? "Unassigned"

export const STORES = INV_LOCATIONS.filter((l) => l.kind === "store")

export const CHANNELS = ["pos", "online"] as const
export type Channel = (typeof CHANNELS)[number]

export const TIERS = ["", "silver", "gold"] as const
export type Tier = (typeof TIERS)[number]

/** Catalogue prices are in the buying currency; one stated rate to rupiah. */
export const RATE = 15_000

/* ── the price-list cascade ──────────────────────────────────── */

export type PriceLevel = "store-exact" | "store-group" | "member-tier" | "global"

export const LEVEL_LABEL: Record<PriceLevel, string> = {
  "store-exact": "Store price",
  "store-group": "Store group price",
  "member-tier": "Tier price",
  global: "Global price",
}

/** Most specific first — the order the resolver walks. */
export const CASCADE: PriceLevel[] = ["store-exact", "store-group", "member-tier", "global"]

export interface PriceEntry {
  id: string
  articleId: string
  level: PriceLevel
  /** Set for store-exact. */
  storeId?: string
  /** Set for store-group. */
  storeIds?: string[]
  tier?: Tier
  channel?: Channel
  price: number
  startsOn?: DayKey
  endsOn?: DayKey
}

/** A markdown replaces the resolved price inside its window. */
export interface Markdown {
  id: string
  articleId: string
  storeIds: string[]
  price: number
  startsOn: DayKey
  endsOn: DayKey
}

const JAKARTA = STORES.filter((s) => s.region === "Jakarta").map((s) => s.id)

function buildPrices(): PriceEntry[] {
  const entries: PriceEntry[] = []

  for (const article of ARTICLES) {
    const base = Math.round((article.price * RATE) / 1000) * 1000

    entries.push({
      id: `pe-${article.id}-global`,
      articleId: article.id,
      level: "global",
      price: base,
    })

    /* the Jakarta stores carry a mall premium on part of the range */
    if (noise(`${article.id}-grp`) % 100 < 34) {
      entries.push({
        id: `pe-${article.id}-jkt`,
        articleId: article.id,
        level: "store-group",
        storeIds: JAKARTA,
        price: Math.round((base * 1.08) / 1000) * 1000,
      })
    }

    /* a few articles are priced for one store on its own */
    if (noise(`${article.id}-exact`) % 100 < 22) {
      const store = STORES[noise(`${article.id}-s`) % STORES.length]
      entries.push({
        id: `pe-${article.id}-${store.id}`,
        articleId: article.id,
        level: "store-exact",
        storeId: store.id,
        price: Math.round((base * (0.9 + (noise(`${article.id}-f`) % 25) / 100)) / 1000) * 1000,
      })
    }

    /* gold members hold a standing price on part of the range */
    if (noise(`${article.id}-tier`) % 100 < 26) {
      entries.push({
        id: `pe-${article.id}-gold`,
        articleId: article.id,
        level: "member-tier",
        tier: "gold",
        price: Math.round((base * 0.92) / 1000) * 1000,
      })
    }
  }

  return entries
}

export const PRICE_ENTRIES = buildPrices()

export const entriesFor = (articleId: string) =>
  PRICE_ENTRIES.filter((e) => e.articleId === articleId)

function buildMarkdowns(): Markdown[] {
  return ARTICLES.filter((a) => noise(`${a.id}-md`) % 100 < 18).map((article) => {
    const base = Math.round((article.price * RATE) / 1000) * 1000
    const started = -(1 + (noise(`${article.id}-mds`) % 20))
    const everywhere = noise(`${article.id}-mdw`) % 100 < 60
    return {
      id: `md-${article.id}`,
      articleId: article.id,
      storeIds: everywhere ? [] : [STORES[noise(`${article.id}-mdl`) % STORES.length].id],
      price: Math.round((base * (0.6 + (noise(`${article.id}-mdp`) % 20) / 100)) / 1000) * 1000,
      startsOn: addDays(todayKey(), started),
      endsOn: addDays(todayKey(), started + 30),
    }
  })
}

export const MARKDOWNS = buildMarkdowns()

export interface PriceContext {
  storeId?: string
  channel: Channel
  tier: Tier
}

export interface ResolvedPrice {
  price: number
  source: PriceLevel | "markdown" | "base"
  /** The price the markdown replaced, when one applied. */
  wasPrice?: number
  entry?: PriceEntry
  markdown?: Markdown
}

const inWindow = (from: DayKey | undefined, to: DayKey | undefined) => {
  const today = todayKey()
  if (from && today < from) return false
  if (to && today > to) return false
  return true
}

function entryApplies(entry: PriceEntry, ctx: PriceContext) {
  if (!inWindow(entry.startsOn, entry.endsOn)) return false
  if (entry.channel && entry.channel !== ctx.channel) return false
  switch (entry.level) {
    case "store-exact":
      return Boolean(ctx.storeId) && entry.storeId === ctx.storeId
    case "store-group":
      return Boolean(ctx.storeId) && Boolean(entry.storeIds?.includes(ctx.storeId!))
    case "member-tier":
      return Boolean(ctx.tier) && entry.tier === ctx.tier
    case "global":
      return true
  }
}

/** The deterministic main price: cascade first, then a markdown replaces it. */
export function resolvePrice(articleId: string, ctx: PriceContext): ResolvedPrice {
  const article = articleOf(articleId)
  const entries = entriesFor(articleId)

  let winner: PriceEntry | undefined
  for (const level of CASCADE) {
    winner = entries.find((e) => e.level === level && entryApplies(e, ctx))
    if (winner) break
  }

  const base = winner?.price ?? Math.round(((article?.price ?? 0) * RATE) / 1000) * 1000
  const source: ResolvedPrice["source"] = winner?.level ?? "base"

  const markdown = MARKDOWNS.find(
    (m) =>
      m.articleId === articleId &&
      inWindow(m.startsOn, m.endsOn) &&
      (m.storeIds.length === 0 || (ctx.storeId ? m.storeIds.includes(ctx.storeId) : false))
  )

  if (markdown) {
    return { price: markdown.price, source: "markdown", wasPrice: base, entry: winner, markdown }
  }

  return { price: base, source, entry: winner }
}

/* ── offers that run after the price is settled ──────────────── */

export type ApplyOn = "article" | "division" | "tag" | "transaction"
export type Mechanic = "percent" | "amount" | "fixed" | "bogo" | "bundle"

export const MECHANIC_LABEL: Record<Mechanic, string> = {
  percent: "% off",
  amount: "Rp off",
  fixed: "Fixed price",
  bogo: "Buy one get one",
  bundle: "Bundle",
}

export type CampaignStatus = "draft" | "active" | "ended"

export interface Campaign {
  id: string
  name: string
  status: CampaignStatus
  startsOn: DayKey
  endsOn: DayKey
  budget: number
  budgetUsed: number
  /** Stores it runs in; empty means everywhere. */
  storeIds: string[]
}

export interface Rule {
  id: string
  name: string
  campaignId: string
  applyOn: ApplyOn
  /** Article id, division name or tag, depending on applyOn. */
  target: string
  mechanic: Mechanic
  /** Percent points, rupiah off, or the fixed price. */
  value: number
  /** Minimum quantity on the line before it fires. */
  minQty: number
  stackable: boolean
  /** Set when the rule only unlocks with a coupon code. */
  couponOnly: boolean
  priority: number
}

export const CAMPAIGNS: Campaign[] = [
  {
    id: "cmp-eoss",
    name: "End of season sale",
    status: "active",
    startsOn: addDays(todayKey(), -12),
    endsOn: addDays(todayKey(), 18),
    budget: 850_000_000,
    budgetUsed: 372_500_000,
    storeIds: [],
  },
  {
    id: "cmp-jakarta",
    name: "Jakarta mall weekend",
    status: "active",
    startsOn: addDays(todayKey(), -3),
    endsOn: addDays(todayKey(), 4),
    budget: 180_000_000,
    budgetUsed: 96_400_000,
    storeIds: JAKARTA,
  },
  {
    id: "cmp-member",
    name: "Member appreciation",
    status: "draft",
    startsOn: addDays(todayKey(), 10),
    endsOn: addDays(todayKey(), 24),
    budget: 240_000_000,
    budgetUsed: 0,
    storeIds: [],
  },
  {
    id: "cmp-raya",
    name: "Lebaran campaign",
    status: "ended",
    startsOn: addDays(todayKey(), -120),
    endsOn: addDays(todayKey(), -74),
    budget: 1_400_000_000,
    budgetUsed: 1_388_100_000,
    storeIds: [],
  },
]

export const campaignOf = (id: string) => CAMPAIGNS.find((c) => c.id === id)

const DIVISIONS = [...new Set(ARTICLES.map(divisionOf))]

export const RULES: Rule[] = [
  {
    id: "rl-eoss-30",
    name: "30% off end of season",
    campaignId: "cmp-eoss",
    applyOn: "tag",
    target: "mid-price",
    mechanic: "percent",
    value: 30,
    minQty: 1,
    stackable: false,
    couponOnly: false,
    priority: 10,
  },
  {
    id: "rl-eoss-bogo",
    name: "Buy one get one, knitwear",
    campaignId: "cmp-eoss",
    applyOn: "division",
    target: DIVISIONS[0] ?? "Knit Division",
    mechanic: "bogo",
    value: 1,
    minQty: 2,
    stackable: false,
    couponOnly: false,
    priority: 20,
  },
  {
    id: "rl-jkt-bundle",
    name: "Two for Rp 500.000",
    campaignId: "cmp-jakarta",
    applyOn: "division",
    target: DIVISIONS[1] ?? "Woven Division",
    mechanic: "bundle",
    value: 500_000,
    minQty: 2,
    stackable: true,
    couponOnly: false,
    priority: 30,
  },
  {
    id: "rl-jkt-coupon",
    name: "Rp 100.000 off with code",
    campaignId: "cmp-jakarta",
    applyOn: "transaction",
    target: "",
    mechanic: "amount",
    value: 100_000,
    minQty: 1,
    stackable: true,
    couponOnly: true,
    priority: 40,
  },
  {
    id: "rl-member-15",
    name: "15% off for members",
    campaignId: "cmp-member",
    applyOn: "transaction",
    target: "",
    mechanic: "percent",
    value: 15,
    minQty: 1,
    stackable: false,
    couponOnly: false,
    priority: 50,
  },
]

export const rulesOf = (campaignId: string) => RULES.filter((r) => r.campaignId === campaignId)

/** Which live rules touch one article, in this context. */
export function rulesFor(article: Product, ctx: PriceContext): Rule[] {
  const division = divisionOf(article)
  return RULES.filter((rule) => {
    const campaign = campaignOf(rule.campaignId)
    if (!campaign || campaign.status !== "active") return false
    if (!inWindow(campaign.startsOn, campaign.endsOn)) return false
    if (campaign.storeIds.length && ctx.storeId && !campaign.storeIds.includes(ctx.storeId)) {
      return false
    }
    switch (rule.applyOn) {
      case "article":
        return rule.target === article.id
      case "division":
        return rule.target === division
      case "tag":
        return article.tags.includes(rule.target)
      case "transaction":
        return true
    }
  }).sort((a, b) => a.priority - b.priority)
}

/* ── coupons and vouchers ────────────────────────────────────── */

export type CodeKind = "coupon" | "voucher"

export interface Code {
  id: string
  code: string
  kind: CodeKind
  /** A coupon unlocks a rule; a voucher carries value of its own. */
  ruleId?: string
  value?: number
  campaignId?: string
  startsOn: DayKey
  endsOn: DayKey
  maxUses: number
  used: number
  /** Empty means anyone may use it. */
  memberId?: string
}

export const CODES: Code[] = [
  {
    id: "cd-1",
    code: "WEEKEND100",
    kind: "coupon",
    ruleId: "rl-jkt-coupon",
    campaignId: "cmp-jakarta",
    startsOn: addDays(todayKey(), -3),
    endsOn: addDays(todayKey(), 4),
    maxUses: 2000,
    used: 738,
  },
  {
    id: "cd-2",
    code: "EOSS30",
    kind: "coupon",
    ruleId: "rl-eoss-30",
    campaignId: "cmp-eoss",
    startsOn: addDays(todayKey(), -12),
    endsOn: addDays(todayKey(), 18),
    maxUses: 0,
    used: 4126,
  },
  {
    id: "cd-3",
    code: "GV-250-8814",
    kind: "voucher",
    value: 250_000,
    startsOn: addDays(todayKey(), -40),
    endsOn: addDays(todayKey(), 320),
    maxUses: 1,
    used: 0,
    memberId: "m-0142",
  },
  {
    id: "cd-4",
    code: "GV-500-2207",
    kind: "voucher",
    value: 500_000,
    startsOn: addDays(todayKey(), -90),
    endsOn: addDays(todayKey(), 270),
    maxUses: 1,
    used: 1,
    memberId: "m-0311",
  },
  {
    id: "cd-5",
    code: "GV-100-9930",
    kind: "voucher",
    value: 100_000,
    startsOn: addDays(todayKey(), -200),
    endsOn: addDays(todayKey(), -12),
    maxUses: 1,
    used: 0,
    memberId: "m-0088",
  },
]

export const codeStatus = (code: Code) => {
  const today = todayKey()
  if (code.used >= code.maxUses && code.maxUses > 0) return "spent" as const
  if (today > code.endsOn) return "expired" as const
  if (today < code.startsOn) return "scheduled" as const
  return "live" as const
}

/* ── returns ─────────────────────────────────────────────────── */

export const SETTLEMENTS = [
  "cash_refund",
  "store_credit",
  "same_item_replacement",
  "return_to_points",
] as const
export type Settlement = (typeof SETTLEMENTS)[number]

export const SETTLEMENT_LABEL: Record<Settlement, string> = {
  cash_refund: "Cash refund",
  store_credit: "Store credit",
  same_item_replacement: "Same item replacement",
  return_to_points: "Back to points",
}

export const REASONS = [
  "defect",
  "wrong_size",
  "wrong_item",
  "changed_mind",
  "store_error",
] as const
export type Reason = (typeof REASONS)[number]

export const REASON_LABEL: Record<Reason, string> = {
  defect: "Faulty",
  wrong_size: "Wrong size",
  wrong_item: "Wrong item",
  changed_mind: "Changed their mind",
  store_error: "Store error",
}

export interface ReturnPolicy {
  id: string
  name: string
  status: "active" | "draft"
  /** Higher wins when two policies both match. */
  priority: number
  /** Scope — empty array means the axis does not narrow. */
  articleIds: string[]
  divisions: string[]
  tags: string[]
  storeIds: string[]
  /** The gates. */
  returnable: boolean
  maxDays: number
  requireReceipt: boolean
  allowIfDiscounted: boolean
  allowIfVoucherUsed: boolean
  allowedTypes: Settlement[]
  /** Reasons that narrow the settlement further; unlisted reasons are unrestricted. */
  reasonMatrix: Partial<Record<Reason, Settlement[]>>
  creditBasis: "net_paid" | "current_price" | "original_price"
  destination: "stock" | "quarantine" | "dc_return" | "scrap"
}

export const RETURN_POLICIES: ReturnPolicy[] = [
  {
    id: "rp-default",
    name: "Standard 30 days",
    status: "active",
    priority: 0,
    articleIds: [],
    divisions: [],
    tags: [],
    storeIds: [],
    returnable: true,
    maxDays: 30,
    requireReceipt: true,
    allowIfDiscounted: true,
    allowIfVoucherUsed: true,
    allowedTypes: ["cash_refund", "store_credit", "same_item_replacement"],
    reasonMatrix: {
      changed_mind: ["store_credit", "same_item_replacement"],
    },
    creditBasis: "net_paid",
    destination: "stock",
  },
  {
    id: "rp-markdown",
    name: "Sale items, credit only",
    status: "active",
    priority: 10,
    articleIds: [],
    divisions: [],
    tags: ["entry-price"],
    storeIds: [],
    returnable: true,
    maxDays: 14,
    requireReceipt: true,
    allowIfDiscounted: true,
    allowIfVoucherUsed: false,
    allowedTypes: ["store_credit", "same_item_replacement"],
    reasonMatrix: {
      defect: ["cash_refund", "store_credit", "same_item_replacement"],
    },
    creditBasis: "net_paid",
    destination: "quarantine",
  },
  {
    id: "rp-hosiery",
    name: "Hosiery is final sale",
    status: "active",
    priority: 30,
    articleIds: [],
    divisions: [],
    tags: [],
    storeIds: [],
    returnable: false,
    maxDays: 0,
    requireReceipt: true,
    allowIfDiscounted: false,
    allowIfVoucherUsed: false,
    allowedTypes: [],
    reasonMatrix: {
      defect: ["same_item_replacement"],
    },
    creditBasis: "net_paid",
    destination: "scrap",
  },
]

/* Hosiery is scoped by category rather than a tag, so it is filled in here
 * where the article list is available. */
RETURN_POLICIES[2].articleIds = ARTICLES.filter((a) => a.category === "Hosiery").map((a) => a.id)

export interface ReturnDecision {
  policy: ReturnPolicy
  returnable: boolean
  /** Which of the four settlements this article can actually be given back as. */
  settlements: Settlement[]
  /** Why the more specific policies did not win. */
  considered: ReturnPolicy[]
}

/** Most specific policy wins: article > tag/division > store > everything. */
export function resolveReturn(article: Product, storeId?: string): ReturnDecision {
  const division = divisionOf(article)

  const matches = RETURN_POLICIES.filter((policy) => {
    if (policy.status !== "active") return false
    if (policy.articleIds.length && !policy.articleIds.includes(article.id)) return false
    if (policy.divisions.length && !policy.divisions.includes(division)) return false
    if (policy.tags.length && !policy.tags.some((tag) => article.tags.includes(tag))) return false
    if (policy.storeIds.length && (!storeId || !policy.storeIds.includes(storeId))) return false
    return true
  }).sort((a, b) => b.priority - a.priority)

  const policy = matches[0] ?? RETURN_POLICIES[0]

  return {
    policy,
    returnable: policy.returnable,
    settlements: policy.allowedTypes,
    considered: matches,
  }
}

export const rupiah = (value: number) => `Rp ${Math.round(value).toLocaleString("id-ID")}`

export const shortRupiah = (value: number) => {
  if (Math.abs(value) >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000_000) return `Rp ${Math.round(value / 1_000_000)}jt`
  return rupiah(value)
}
