/*
 * Commercial's read boundary — the Go cloud-hub (github.com/retailos/backbone).
 *
 * Two owners sit behind this adapter and they are deliberately not blurred:
 *
 *   · `/v1/commercial/*` (internal/cloud/commercial) authors price lists,
 *     price entries, markdowns, promotions, campaigns and vouchers;
 *   · `/v1/pricing-engine/*` (internal/cloud/pricing, over internal/pricingengine)
 *     owns the rules, the campaigns' engine-side caps, the coupons and the
 *     snapshot the tills actually run.
 *
 * The catalogue itself is master data: `/v1/masterdata/*`. Nothing here is
 * synthesised — a collection the hub does not publish stays empty and the
 * screen says why.
 *
 * Times on the wire are RFC3339 strings throughout (Go `time.Time`); money is
 * a plain integer rupiah (`money.Money`); `markdown_value` alone arrives as a
 * decimal STRING (shopspring/decimal). None of the Rust-era conventions —
 * integer ETags, `If-Match`, UNIX-millisecond timestamps — exist on this hub.
 */

import {
  api,
  checkContract,
  qs,
  useDomainQuery,
  type ApiRequestOptions,
} from "@/lib/api"
import { dayKey, type DayKey } from "@/lib/day"
import { commercialQueries } from "./queries"
import {
  ArticleRow,
  CampaignRow,
  CouponRow,
  DivisionRow,
  MarkdownRow,
  PriceEntryRow,
  PriceListRow,
  PricingRuleRow,
  PromotionRow,
  ReturnPolicyRow,
  StoreRow,
  TierRow,
  VoucherRow,
} from "./contracts"

type RecordValue = Record<string, unknown>

export type CommercialCampaignStatus =
  "draft" | "scheduled" | "active" | "completed" | "cancelled" | string

/** The KPI block the hub carries on every campaign row. */
export interface CommercialCampaignKpis {
  salesLift: number
  transactions: number
  discountGiven: number
  roas: number
  participationPct: number
}

export interface CommercialCampaign {
  id: string
  name: string
  description: string
  theme: string
  status: CommercialCampaignStatus
  startsOn?: DayKey
  endsOn?: DayKey
  budget?: number
  budgetUsed: number
  storeIds: string[]
  /** `promo_ids` — the hub bundles both promotions and pricing rules here. */
  promotionIds: string[]
  kpis: CommercialCampaignKpis
}

export interface CommercialPromotion {
  id: string
  name: string
  description: string
  status: string
  type: string
  campaignIds: string[]
  priority: number
  stackable: boolean
  storeIds: string[]
  startOn?: DayKey
  endOn?: DayKey
  maxUses?: number
  usageCount: number
  summary: string
}

export interface CommercialCoupon {
  id: string
  code: string
  name: string
  kind: string
  ruleId: string
  campaignId: string
  memberId: string
  startsOn?: DayKey
  endsOn?: DayKey
  maxUses: number
  used: number
  requireOnline: boolean
  status: string
}

export interface CommercialVoucher {
  id: string
  code: string
  /** The normalised kind: percent_off | fixed_amount | free_item | points_exchange. */
  kind: string
  /** The raw column value (`discount_percent`, `discount_amount`, …). */
  rawType: string
  /** Percent off, 0–100 as the hub stores it — not basis points. */
  discountPct: number
  valueIdr: number
  minSpend: number
  pointsValue: number
  redeemableViaLoyalty: boolean
  singleUse: boolean
  redeemedCount: number
  expiresOn?: DayKey
  issuedToCustomerId: string
  issuedToCustomerName: string
  initialValue?: number
  balance?: number
  status: string
}

export interface CommercialPriceEntry {
  id: string
  listId: string
  sku: string
  articleId: string
  /** `base_price` — what the cascade resolves to at this entry's level. */
  price: number
  salePrice?: number
  costPrice?: number
  priority: number
  startsOn?: DayKey
  endsOn?: DayKey
  active: boolean
}

export interface CommercialPriceList {
  id: string
  name: string
  description: string
  isDefault: boolean
  active: boolean
  entries: CommercialPriceEntry[]
}

export interface CommercialMarkdown {
  id: string
  name: string
  sku: string
  articleId: string
  listId: string
  originalPrice: number
  markdownPrice: number
  type: string
  value: number
  startsOn?: DayKey
  endsOn?: DayKey
  storeIds: string[]
  reason: string
  status: string
}

export interface CommercialPricingRule {
  id: string
  campaignId: string
  name: string
  status: string
  kind: string
  applyOn: string
  skus: string[]
  articleIds: string[]
  divisions: string[]
  tags: string[]
  storeIds: string[]
  storeGroups: string[]
  channels: string[]
  customerScope: string
  tierIds: string[]
  minQty: number
  maxQty: number
  minAmount: number
  maxAmount: number
  startsOn?: DayKey
  endsOn?: DayKey
  couponId: string
  effect: string
  percentBps: number
  amount: number
  fixedPrice: number
  freeSku: string
  freeQty: number
  priority: number
  exclusive: boolean
  stackWithOtherRules: boolean
  maxUses: number
  usageCount: number
  budget: number
  budgetUsed: number
}

/**
 * One catalogue row. The hub publishes no article/family master over HTTP on
 * this deployment — `/v1/pricing-engine/coverage` reads `product_families`,
 * which is empty here — so the catalogue is the SKU master itself: one row per
 * sellable item, which is also the key the price engine matches on.
 */
export interface CommercialArticle {
  id: string
  code: string
  name: string
  divisionId: string
  divisionName: string
  status: string
  tags: string[]
  skus: string[]
  imageUrl: string
  /** The item's own selling price, from the hub's default price list. */
  basePrice?: number
}

export interface CommercialStore {
  id: string
  code: string
  name: string
  type: string
  active: boolean
}

export interface CommercialDivision {
  id: string
  name: string
  code: string
}

/** A member tier from the loyalty programme, when the hub has any configured. */
export interface CommercialTier {
  id: string
  name: string
  level: number
}

/** A store group, as the engine expands `store_groups`-scoped rules. */
export interface CommercialStoreGroup {
  id: string
  storeIds: string[]
}

export interface CommercialReturnPolicy {
  id: string
  name: string
  scope: string
  days: number
}

export interface CommercialResource {
  articles: CommercialArticle[]
  stores: CommercialStore[]
  storeGroups: CommercialStoreGroup[]
  divisions: CommercialDivision[]
  tiers: CommercialTier[]
  programName: string
  campaigns: CommercialCampaign[]
  promotions: CommercialPromotion[]
  coupons: CommercialCoupon[]
  vouchers: CommercialVoucher[]
  priceLists: CommercialPriceList[]
  markdowns: CommercialMarkdown[]
  pricingRules: CommercialPricingRule[]
  returnPolicies: CommercialReturnPolicy[]
  fetchedAt: string
}

/* ── wire helpers ─────────────────────────────────────────────── */

function asRecord(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null
    ? (value as RecordValue)
    : undefined
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback
  if (typeof value === "number" || typeof value === "boolean")
    return String(value)
  return fallback
}

/** Go emits money as an integer and `markdown_value` as a decimal string. */
function num(value: unknown, fallback = 0): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function optionalNum(value: unknown): number | undefined {
  const parsed = num(value, Number.NaN)
  return Number.isFinite(parsed) ? parsed : undefined
}

function boolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    if (value.trim().toLowerCase() === "true") return true
    if (value.trim().toLowerCase() === "false") return false
  }
  return fallback
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : []
}

/**
 * An RFC3339 instant, or a bare `YYYY-MM-DD`, as a day key. Go's zero time
 * (`0001-01-01T00:00:00Z`) means "unset" and must not render as a date.
 */
export function dayFromWire(value: unknown): DayKey | undefined {
  const raw = text(value)
  if (!raw || raw.startsWith("0001-01-01")) return undefined
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? undefined : dayKey(date)
}

/**
 * Pulls the rows out of a hub list envelope. The hub is consistent about
 * `{count, items}` on commercial and pricing-engine collections, but
 * `/v1/masterdata/locations` answers with `locations` and Go marshals an empty
 * slice as `null`, which is a valid empty list rather than a malformed body.
 */
function listFromPayload(
  payload: unknown,
  keys: string[],
  label: string
): RecordValue[] {
  if (Array.isArray(payload)) return payload.filter(asRecord)
  const body = asRecord(payload)
  if (!body) throw new Error(`The hub returned an invalid ${label} response`)
  for (const key of keys) {
    if (Array.isArray(body[key])) return body[key].filter(asRecord)
    if (body[key] === null) return []
  }
  throw new Error(`The hub returned an invalid ${label} response`)
}

/* ── row mappers ──────────────────────────────────────────────── */

function campaignFromApi(raw: RecordValue): CommercialCampaign | null {
  const id = text(raw.campaign_id)
  if (!id) return null
  const kpis = asRecord(raw.kpis)
  return {
    id,
    name: text(raw.name, id),
    description: text(raw.description),
    theme: text(raw.theme),
    status: text(raw.status, "draft"),
    startsOn: dayFromWire(raw.start_date),
    endsOn: dayFromWire(raw.end_date),
    budget: optionalNum(raw.budget),
    budgetUsed: num(raw.budget_used),
    storeIds: stringList(raw.store_ids),
    promotionIds: stringList(raw.promo_ids),
    kpis: {
      salesLift: num(kpis?.sales_lift),
      transactions: num(kpis?.transactions),
      discountGiven: num(kpis?.discount_given),
      roas: num(kpis?.roas),
      participationPct: num(kpis?.participation_pct),
    },
  }
}

function promotionFromApi(raw: RecordValue): CommercialPromotion | null {
  const id = text(raw.promo_id)
  if (!id) return null
  const rules = asRecord(raw.rules)
  // `discount_percent` is money.Bps on this hub, not a whole percent.
  const percentBps = num(rules?.discount_percent)
  const amount = num(rules?.discount_amount)
  const buyQty = num(rules?.buy_qty)
  const getQty = num(rules?.get_qty)
  const included = stringList(rules?.included_skus)
  const summary =
    percentBps > 0
      ? `${(percentBps / 100).toFixed(2)}% off`
      : amount > 0
        ? `Rp ${amount.toLocaleString("id-ID")} off`
        : buyQty > 0 || getQty > 0
          ? `Buy ${buyQty}, get ${getQty}`
          : text(raw.promo_type, "promotion")
  return {
    id,
    name: text(raw.name, id),
    description: text(raw.description),
    status: text(raw.status, "draft"),
    type: text(raw.promo_type, "promotion"),
    campaignIds: [],
    priority: num(raw.priority),
    stackable: boolean(raw.stackable),
    storeIds: stringList(raw.store_ids),
    startOn: dayFromWire(raw.start_date),
    endOn: dayFromWire(raw.end_date),
    maxUses: optionalNum(raw.max_uses),
    usageCount: num(raw.usage_count),
    summary: included.length
      ? `${summary} · ${included.length} SKU${included.length === 1 ? "" : "s"}`
      : summary,
  }
}

function couponFromApi(raw: RecordValue): CommercialCoupon | null {
  const code = text(raw.code)
  if (!code) return null
  return {
    id: code,
    code,
    name: text(raw.name, code),
    kind: text(raw.kind, "promotional"),
    ruleId: text(raw.rule_id),
    campaignId: text(raw.campaign_id),
    memberId: text(raw.member_id),
    startsOn: dayFromWire(raw.valid_from),
    endsOn: dayFromWire(raw.valid_to),
    maxUses: num(raw.max_uses),
    used: num(raw.used),
    requireOnline: boolean(raw.require_online),
    status: text(raw.status, "active"),
  }
}

/* The voucher route is the one camelCase corner of the hub: it projects the
 * `vouchers` table by hand rather than marshalling a Go struct. */
function voucherFromApi(raw: RecordValue): CommercialVoucher | null {
  const id = text(raw.id)
  const code = text(raw.code)
  if (!id || !code) return null
  return {
    id,
    code,
    kind: text(raw.type, "fixed_amount"),
    rawType: text(raw.voucherType),
    discountPct: num(raw.discountPct),
    valueIdr: num(raw.valueIdr),
    minSpend: num(raw.minSpend),
    pointsValue: num(raw.pointsValue),
    redeemableViaLoyalty: boolean(raw.redeemableViaLoyalty),
    singleUse: boolean(raw.singleUse),
    redeemedCount: num(raw.redeemedCount),
    expiresOn: dayFromWire(raw.expiryDate),
    issuedToCustomerId: text(raw.issuedToCustomerId),
    issuedToCustomerName: text(raw.issuedToCustomerName),
    initialValue: optionalNum(raw.initialValue),
    balance: optionalNum(raw.balance),
    status: text(raw.status, "active"),
  }
}

function priceEntryFromApi(raw: RecordValue): CommercialPriceEntry | null {
  const id = text(raw.entry_id)
  const sku = text(raw.sku)
  const articleId = text(raw.article_id)
  const price = optionalNum(raw.base_price)
  if (!id || (!sku && !articleId) || price === undefined) return null
  const sale = optionalNum(raw.sale_price)
  return {
    id,
    listId: text(raw.list_id),
    sku,
    articleId,
    // The engine prefers sale_price over base_price when one is set.
    price: sale && sale > 0 ? sale : price,
    salePrice: sale && sale > 0 ? sale : undefined,
    costPrice: optionalNum(raw.cost_price),
    priority: num(raw.priority),
    startsOn: dayFromWire(raw.start_date),
    endsOn: dayFromWire(raw.end_date),
    active: boolean(raw.is_active, true),
  }
}

function priceListFromApi(raw: RecordValue): CommercialPriceList | null {
  const id = text(raw.list_id)
  if (!id) return null
  return {
    id,
    name: text(raw.name, id),
    description: text(raw.description),
    isDefault: boolean(raw.is_default),
    active: boolean(raw.is_active, true),
    entries: [],
  }
}

function markdownFromApi(raw: RecordValue): CommercialMarkdown | null {
  const id = text(raw.markdown_id)
  const sku = text(raw.sku)
  const articleId = text(raw.article_id)
  const markdownPrice = optionalNum(raw.markdown_price)
  if (!id || (!sku && !articleId) || markdownPrice === undefined) return null
  return {
    id,
    name: text(raw.name, id),
    sku,
    articleId,
    listId: text(raw.list_id),
    originalPrice: num(raw.original_price),
    markdownPrice,
    type: text(raw.markdown_type, "fixed"),
    // decimal.Decimal marshals as a JSON string.
    value: num(raw.markdown_value),
    startsOn: dayFromWire(raw.start_date),
    endsOn: dayFromWire(raw.end_date),
    storeIds: stringList(raw.store_ids),
    reason: text(raw.reason),
    status: text(raw.status, "draft"),
  }
}

function pricingRuleFromApi(raw: RecordValue): CommercialPricingRule | null {
  const id = text(raw.id)
  if (!id) return null
  return {
    id,
    campaignId: text(raw.campaign_id),
    name: text(raw.name, id),
    status: text(raw.status, "draft"),
    kind: text(raw.kind, "price"),
    applyOn: text(raw.apply_on, "sku"),
    skus: stringList(raw.skus),
    articleIds: stringList(raw.article_ids),
    divisions: stringList(raw.divisions),
    tags: stringList(raw.tags),
    storeIds: stringList(raw.store_ids),
    storeGroups: stringList(raw.store_groups),
    channels: stringList(raw.channels),
    customerScope: text(raw.customer_scope, "all"),
    tierIds: stringList(raw.tier_ids),
    minQty: num(raw.min_qty),
    maxQty: num(raw.max_qty),
    minAmount: num(raw.min_amount),
    maxAmount: num(raw.max_amount),
    startsOn: dayFromWire(raw.valid_from),
    endsOn: dayFromWire(raw.valid_to),
    couponId: text(raw.coupon_id),
    effect: text(raw.effect),
    percentBps: num(raw.percent_bps),
    amount: num(raw.amount),
    fixedPrice: num(raw.fixed_price),
    freeSku: text(raw.free_sku),
    freeQty: num(raw.free_qty),
    priority: num(raw.priority),
    exclusive: boolean(raw.exclusive),
    stackWithOtherRules: boolean(raw.stack_with_other_rules),
    maxUses: num(raw.max_uses),
    usageCount: num(raw.usage_count),
    budget: num(raw.budget),
    budgetUsed: num(raw.budget_used),
  }
}

/** A store, from the location master. Commercial scopes by `location_id`. */
function storeFromApi(raw: RecordValue): CommercialStore | null {
  const id = text(raw.location_id)
  if (!id) return null
  return {
    id,
    code: text(raw.code, id),
    name: text(raw.name, id),
    type: text(raw.location_type, "store"),
    active: boolean(raw.is_active, true),
  }
}

function divisionFromApi(raw: RecordValue): CommercialDivision | null {
  const id = text(raw.id)
  if (!id) return null
  return { id, name: text(raw.name, id), code: text(raw.id) }
}

function tierFromApi(raw: RecordValue): CommercialTier | null {
  const id = text(raw.tier_id)
  if (!id) return null
  return { id, name: text(raw.name, id), level: num(raw.level) }
}

function returnPolicyFromApi(raw: RecordValue): CommercialReturnPolicy | null {
  const id = text(raw.policy_id) || text(raw.id)
  if (!id) return null
  return {
    id,
    name: text(raw.name, id),
    scope: text(raw.scope, "global"),
    days: num(raw.days),
  }
}

function articleFromApi(
  raw: RecordValue,
  divisionNames: Map<string, string>
): CommercialArticle | null {
  const sku = text(raw.sku)
  if (!sku) return null
  const divisionId = text(raw.category_id) || text(raw.division_id)
  return {
    id: sku,
    code: sku,
    name: text(raw.name, sku),
    divisionId,
    divisionName: divisionNames.get(divisionId) ?? "",
    status: text(raw.status, "active"),
    // The hub joins no per-item tags onto the item list.
    tags: [],
    skus: [sku],
    imageUrl: text(raw.default_image_url),
    basePrice: optionalNum(raw.sell_price),
  }
}

/* ── fetching ─────────────────────────────────────────────────── */

function apiOptions(signal?: AbortSignal): ApiRequestOptions | undefined {
  return signal ? { signal } : undefined
}

/** The commercial and pricing-engine list routes cap `limit` at 200. */
const PAGE_SIZE = 200

/** `/v1/masterdata/items/enriched` pages by page/page_size and caps at 500. */
const CATALOGUE_PAGE = 500

/** Ceiling on catalogue pages, so a runaway `total` cannot spin forever. */
const MAX_PAGES = 40

/**
 * Walks a hub collection that pages by `limit`/`offset` and reports `total`.
 * Every commercial and pricing-engine list route uses this shape; none of them
 * offers a cursor.
 */
async function fetchOffsetPages(
  path: string,
  keys: string[],
  label: string,
  signal?: AbortSignal
): Promise<RecordValue[]> {
  const options = apiOptions(signal)
  const out: RecordValue[] = []

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = await api.get<unknown>(
      `${path}${qs({ limit: PAGE_SIZE, offset: page * PAGE_SIZE })}`,
      options
    )
    const rows = listFromPayload(payload, keys, label)
    out.push(...rows)
    const total = optionalNum(asRecord(payload)?.total)
    if (rows.length < PAGE_SIZE) break
    if (total !== undefined && out.length >= total) break
  }

  return out
}

/** The SKU master, paged the way the enriched item route asks to be paged. */
async function fetchCatalogue(signal?: AbortSignal): Promise<RecordValue[]> {
  const options = apiOptions(signal)
  const out: RecordValue[] = []

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await api.get<unknown>(
      `/v1/masterdata/items/enriched${qs({ page, page_size: CATALOGUE_PAGE })}`,
      options
    )
    const rows = listFromPayload(payload, ["items", "data"], "item list")
    out.push(...rows)
    if (rows.length < CATALOGUE_PAGE) break
  }

  return out
}

/** A read that is allowed to come back empty rather than fail the whole page. */
async function optional<T>(
  work: Promise<T>,
  fallback: T,
  signal?: AbortSignal
): Promise<T> {
  try {
    return await work
  } catch (error) {
    if (signal?.aborted) throw error
    return fallback
  }
}

/** Reads every commercial collection the Go hub publishes, in one pass. */
export async function fetchCommercialResource(
  signal?: AbortSignal
): Promise<CommercialResource> {
  const options = apiOptions(signal)
  const [
    campaignRows,
    promotionRows,
    couponMap,
    voucherRows,
    priceListRows,
    markdownRows,
    ruleRows,
    itemRows,
    locationsRaw,
    divisionsRaw,
    programRaw,
    storeGroupsRaw,
    returnPoliciesRaw,
  ] = await Promise.all([
    fetchOffsetPages(
      "/v1/commercial/campaigns",
      ["items"],
      "campaign list",
      signal
    ),
    fetchOffsetPages(
      "/v1/commercial/promotions",
      ["items"],
      "promotion list",
      signal
    ),
    // Coupons come back as a map keyed by code, not as a list envelope.
    optional(
      api.get<unknown>("/v1/pricing-engine/coupons", options),
      {},
      signal
    ),
    fetchOffsetPages(
      "/v1/commercial/vouchers",
      ["items"],
      "voucher list",
      signal
    ),
    // The price-list route is unpaged and answers with the whole collection.
    api.get<unknown>("/v1/commercial/price-lists", options),
    api.get<unknown>(`/v1/commercial/markdowns${qs({ limit: 500 })}`, options),
    fetchOffsetPages(
      "/v1/pricing-engine/rules",
      ["items"],
      "pricing-rule list",
      signal
    ),
    fetchCatalogue(signal),
    api.get<unknown>(`/v1/masterdata/locations${qs({ limit: 500 })}`, options),
    api.get<unknown>("/v1/masterdata/divisions", options),
    optional(
      api.get<unknown>("/v1/commercial/member-program/config", options),
      {},
      signal
    ),
    optional(
      api.get<unknown>("/v1/pricing-engine/store-groups", options),
      {},
      signal
    ),
    optional(api.get<unknown>("/v1/return-policies", options), {}, signal),
  ])

  checkContract(CampaignRow, campaignRows, "/v1/commercial/campaigns")
  const campaigns = campaignRows
    .map(campaignFromApi)
    .filter((campaign): campaign is CommercialCampaign => Boolean(campaign))
  checkContract(PromotionRow, promotionRows, "/v1/commercial/promotions")
  const promotions = promotionRows
    .map(promotionFromApi)
    .filter((promotion): promotion is CommercialPromotion => Boolean(promotion))
  const couponRows = Object.values(asRecord(couponMap) ?? {})
    .map((row) => asRecord(row))
    .filter((row): row is RecordValue => Boolean(row))
  checkContract(CouponRow, couponRows, "/v1/pricing-engine/coupons")
  const coupons = couponRows
    .map(couponFromApi)
    .filter((coupon): coupon is CommercialCoupon => Boolean(coupon))
  checkContract(VoucherRow, voucherRows, "/v1/commercial/vouchers")
  const vouchers = voucherRows
    .map(voucherFromApi)
    .filter((voucher): voucher is CommercialVoucher => Boolean(voucher))
  const markdownList = listFromPayload(markdownRows, ["items"], "markdown list")
  checkContract(MarkdownRow, markdownList, "/v1/commercial/markdowns")
  const markdowns = markdownList
    .map(markdownFromApi)
    .filter((markdown): markdown is CommercialMarkdown => Boolean(markdown))
  checkContract(PricingRuleRow, ruleRows, "/v1/pricing-engine/rules")
  const pricingRules = ruleRows
    .map(pricingRuleFromApi)
    .filter((rule): rule is CommercialPricingRule => Boolean(rule))

  const priceListRowsUnwrapped = listFromPayload(
    priceListRows,
    ["items"],
    "price-list list"
  )
  checkContract(PriceListRow, priceListRowsUnwrapped, "/v1/commercial/price-lists")
  const priceLists = priceListRowsUnwrapped
    .map(priceListFromApi)
    .filter((list): list is CommercialPriceList => Boolean(list))

  /* Entries live under their own list, one request each. The hub returns a
   * list's whole entry set — there is no paging on that route. */
  await Promise.all(
    priceLists.map(async (list) => {
      const payload = await api.get<unknown>(
        `/v1/commercial/price-lists/${encodeURIComponent(list.id)}/entries`,
        options
      )
      const entryRows = listFromPayload(payload, ["items"], "price-entry list")
      checkContract(
        PriceEntryRow,
        entryRows,
        `/v1/commercial/price-lists/${list.id}/entries`
      )
      list.entries = entryRows
        .map(priceEntryFromApi)
        .filter((entry): entry is CommercialPriceEntry => Boolean(entry))
    })
  )

  const divisionRows = listFromPayload(divisionsRaw, ["items"], "division list")
  checkContract(DivisionRow, divisionRows, "/v1/masterdata/divisions")
  const divisions = divisionRows
    .map(divisionFromApi)
    .filter((division): division is CommercialDivision => Boolean(division))
  const divisionNames = new Map(
    divisions.map((division) => [division.id, division.name])
  )

  const storeRows = listFromPayload(
    locationsRaw,
    ["locations", "items"],
    "location list"
  )
  checkContract(StoreRow, storeRows, "/v1/masterdata/locations")
  const stores = storeRows
    .map(storeFromApi)
    .filter((store): store is CommercialStore => Boolean(store))
    .filter((store) => store.type.toLowerCase() === "store" && store.active)

  const storeGroups = Object.entries(asRecord(storeGroupsRaw) ?? {}).map(
    ([id, members]) => ({ id, storeIds: stringList(members) })
  )

  const program = asRecord(programRaw)
  const tierRows = (Array.isArray(program?.tiers) ? program.tiers : [])
    .filter(asRecord)
  checkContract(
    TierRow,
    tierRows,
    "/v1/commercial/member-program/config#tiers"
  )
  const tiers = tierRows
    .map(tierFromApi)
    .filter((tier): tier is CommercialTier => Boolean(tier))
    .sort((a, b) => a.level - b.level)

  const returnPolicyRows = listFromPayload(
    returnPoliciesRaw,
    ["policies", "items"],
    "return-policy list"
  )
  checkContract(ReturnPolicyRow, returnPolicyRows, "/v1/return-policies")
  const returnPolicies = returnPolicyRows
    .map(returnPolicyFromApi)
    .filter((policy): policy is CommercialReturnPolicy => Boolean(policy))

  checkContract(ArticleRow, itemRows, "/v1/masterdata/items/enriched")
  const articles = itemRows
    .map((row) => articleFromApi(row, divisionNames))
    .filter((article): article is CommercialArticle => Boolean(article))

  /* `promo_ids` on a campaign is the only link between the two owners: it
   * names promotions and pricing rules alike. */
  const campaignByPromotion = new Map<string, string[]>()
  for (const campaign of campaigns) {
    for (const promotionId of campaign.promotionIds) {
      const current = campaignByPromotion.get(promotionId) ?? []
      current.push(campaign.id)
      campaignByPromotion.set(promotionId, current)
    }
  }
  for (const promotion of promotions) {
    promotion.campaignIds = campaignByPromotion.get(promotion.id) ?? []
  }

  return {
    articles,
    stores,
    storeGroups,
    divisions,
    tiers,
    programName: text(program?.program_name),
    campaigns,
    promotions,
    coupons,
    vouchers,
    priceLists,
    markdowns,
    pricingRules,
    returnPolicies,
    fetchedAt: new Date().toISOString(),
  }
}


export function useCommercialResource() {
  return useDomainQuery(commercialQueries.snapshot())
}
