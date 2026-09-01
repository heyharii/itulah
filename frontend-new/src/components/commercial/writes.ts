/*
 * Commercial's write boundary — the Go cloud-hub.
 *
 * `api.ts` is the read side and stays read-only. Everything that changes a row
 * goes through here, because the hub's write contract has three rules a bare
 * `api.post` would get wrong:
 *
 *  1. IDs ARE CLIENT-MINTED. `internal/cloud/commercial` validates
 *     `list_id` / `entry_id` / `markdown_id` / `campaign_id` as required on
 *     create and returns `validation failed:` otherwise. Only the pricing-rule
 *     route mints its own id, and only when the field is omitted.
 *  2. PUT REPLACES THE WHOLE ROW. `saveRule` decodes into a fresh
 *     `pricingengine.Rule` and `Update*` in the commercial service overwrites
 *     the stored row wholesale, so a form that sent only its own fields would
 *     blank everything it does not show. Every update here is therefore
 *     read-modify-write.
 *  3. THERE IS NO OPTIMISTIC CONCURRENCY. The hub sends no `ETag` on any of
 *     these routes and no handler reads `If-Match`; the Rust-era integer-ETag
 *     contract does not exist here. Sending one would be theatre, so none is
 *     sent, and the sheets re-read immediately before writing instead.
 *
 * Times on the wire are RFC3339 (`time.Time`), never UNIX milliseconds. There
 * is no DELETE anywhere in the contract: retiring is a status or an active
 * flag, and the screens say so rather than offering a delete the hub refuses.
 */

import { api, getErrorMessage } from "@/lib/api"
import type { DayKey } from "@/lib/day"
import {
  CampaignWire,
  MarkdownWire,
  PriceEntryWire,
  PriceListWire,
  PricingRuleWire,
  VoucherListEnvelope,
} from "./contracts"
import type {
  CampaignStatusWire,
  MarkdownStatusWire,
  VoucherTypeWire,
  VoucherWire,
} from "./contracts"

export type {
  CampaignStatusWire,
  CampaignWire,
  MarkdownStatusWire,
  MarkdownTypeWire,
  MarkdownWire,
  PriceEntryWire,
  PriceListWire,
  PricingRuleWire,
  VoucherTypeWire,
  VoucherWire,
} from "./contracts"

/**
 * The one hook every authoring sheet saves through. Lives in `./mutations`
 * now, built on `useMutation` directly — re-exported here so forms.tsx does
 * not have to change its import.
 */
export { useCommercialWrite } from "./mutations"

const segment = (value: string) => encodeURIComponent(value)

/**
 * A client-minted object id. The commercial routes require one on create, so
 * this names the row rather than leaving the hub to reject the body.
 */
export function mintId(prefix: string): string {
  const source = globalThis.crypto
  const bytes = new Uint8Array(10)
  if (source && typeof source.getRandomValues === "function") {
    source.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  return `${prefix}-${hex}`
}

/** A failed write, already carrying the sentence the sheet should show. */
export class CommercialWriteError extends Error {
  /** The row was refused because something about it clashed with the hub. */
  readonly conflict: boolean

  constructor(message: string, conflict = false) {
    super(message)
    this.name = "CommercialWriteError"
    this.conflict = conflict
  }
}

/** Wrap a write, so a sheet only ever catches one error type. */
async function attempted<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const message = getErrorMessage(error)
    // The commercial service answers a duplicate id with 409 "already exists".
    throw new CommercialWriteError(message, /already exists/i.test(message))
  }
}

/* ── days on the wire ─────────────────────────────────────────── */

/*
 * The whole hub speaks RFC3339, because every date field on it is a Go
 * `time.Time`. The one exception is the voucher route, which projects the
 * table by hand and takes a bare `YYYY-MM-DD` date.
 */

export function dayToRfc3339(day: DayKey | ""): string | null {
  if (!day) return null
  const time = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(time.getTime()) ? null : time.toISOString()
}

export function rfc3339ToDay(value: string | null | undefined): DayKey | "" {
  if (!value || value.startsWith("0001-01-01")) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10)
}

/* ── pricing rules: /v1/pricing-engine/rules ──────────────────── */

/**
 * The engine-facing rule row, in full — `internal/pricingengine.Rule`. Every
 * field is carried because PUT replaces the row: the form edits a handful of
 * them and hands the rest back exactly as the hub returned them, so a rule
 * authored elsewhere does not lose its schedule, its exclusions or its
 * loyalty-earn settings by being opened here.
 *
 * `usage_count`, `budget_used` and `earn_budget_used` are runtime counters the
 * store overwrites from its own row; they are round-tripped, never authored.
 *
 * The schema lives in `./contracts` — this file only imports it.
 */

/** A blank rule carrying the engine's own defaults, for the create path. */
export function blankPricingRule(): PricingRuleWire {
  return {
    id: "",
    campaign_id: "",
    name: "",
    status: "draft",
    kind: "price",
    apply_on: "sku",
    skus: [],
    article_ids: [],
    divisions: [],
    tags: [],
    excluded_skus: [],
    store_ids: [],
    store_groups: [],
    channels: [],
    customer_scope: "all",
    tier_ids: [],
    other_apply_on: "",
    other_skus: [],
    other_article_ids: [],
    other_divisions: [],
    other_tags: [],
    min_qty: 0,
    max_qty: 0,
    min_amount: 0,
    max_amount: 0,
    valid_from: null,
    valid_to: null,
    days_of_week: 0,
    time_from: 0,
    time_to: 0,
    coupon_id: "",
    is_cumulative: false,
    advisory: false,
    effect: "",
    percent_bps: 0,
    amount: 0,
    fixed_price: 0,
    margin_bps: 0,
    max_discount: 0,
    compound: false,
    free_sku: "",
    same_item: false,
    free_qty: 0,
    recurse_for: 0,
    recursion_over: 0,
    round_free_qty: false,
    free_item_price: 0,
    priority: 0,
    exclusive: false,
    stack_with_other_rules: false,
    stack_with_voucher: true,
    stack_with_points: false,
    stack_with_employee: false,
    max_uses: 0,
    usage_count: 0,
    budget: 0,
    budget_used: 0,
    per_customer_max: 0,
    earn_mode: "",
    spend_per_point: 0,
    earn_points: 0,
    earn_basis: "",
    exclude_markdown_items: false,
    earn_cap_per_rule: 0,
    earn_cap_per_txn: 0,
    earn_budget_points: 0,
    earn_budget_used: 0,
  }
}

const rulePath = (id: string) => `/v1/pricing-engine/rules/${segment(id)}`

/** The rule as the hub holds it now — the seed for any edit. */
export function loadPricingRule(id: string): Promise<PricingRuleWire> {
  return api.get(rulePath(id), { schema: PricingRuleWire })
}

/**
 * Creates a rule. `POST /rules` mints an id when the field is empty, so an
 * empty `id` is sent deliberately rather than a client-minted one.
 */
export function createPricingRule(
  rule: PricingRuleWire
): Promise<PricingRuleWire> {
  return attempted(() =>
    api.post<PricingRuleWire>("/v1/pricing-engine/rules", {
      ...rule,
      id: rule.id || undefined,
    })
  )
}

/**
 * Re-reads the rule, lays the edited fields over it and replaces the row, so
 * nothing outside the form is lost — `saveRule` decodes into a zero-valued
 * `Rule`, so an omitted field is an erased field.
 */
export async function savePricingRule(
  id: string,
  edit: (current: PricingRuleWire) => PricingRuleWire
): Promise<PricingRuleWire> {
  return attempted(async () => {
    const current = await loadPricingRule(id)
    const next = { ...edit(current), id }
    return api.put<PricingRuleWire>(rulePath(id), next)
  })
}

/** Retire a rule. There is no DELETE; `archived` is the terminal status. */
export function retirePricingRule(id: string): Promise<PricingRuleWire> {
  return savePricingRule(id, (current) => ({ ...current, status: "archived" }))
}

/* ── price lists: /v1/commercial/price-lists ──────────────────── */

/**
 * `commercial.PriceList`. The hub's price list carries NO store or tier scope
 * — the columns do not exist — so nothing here can scope one, and the cascade
 * screens say as much rather than offering a scope the hub would drop. The
 * schema lives in `./contracts`.
 */

export interface PriceListDraft {
  name: string
  description: string
  is_default: boolean
  is_active: boolean
}

const listPath = (id: string) => `/v1/commercial/price-lists/${segment(id)}`

export function loadPriceList(id: string): Promise<PriceListWire> {
  return api.get(listPath(id), { schema: PriceListWire })
}

/**
 * Creates a list under an id this app mints. `CreatePriceList` rejects an
 * empty `list_id` and forces `is_active` true whatever the body says.
 */
export function createPriceList(
  listId: string,
  draft: PriceListDraft
): Promise<PriceListWire> {
  return attempted(() =>
    api.post<PriceListWire>("/v1/commercial/price-lists", {
      ...draft,
      list_id: listId,
    })
  )
}

/** Replaces a list. `created_at` / `created_by` are preserved by the service. */
export function savePriceList(
  id: string,
  draft: PriceListDraft
): Promise<PriceListWire> {
  return attempted(() => api.put<PriceListWire>(listPath(id), draft))
}

/** Retire a list: an inactive list's entries drop out of the snapshot. */
export async function retirePriceList(id: string): Promise<PriceListWire> {
  return attempted(async () => {
    const current = await loadPriceList(id)
    return api.put<PriceListWire>(listPath(id), {
      name: current.name,
      description: current.description,
      is_default: current.is_default,
      is_active: false,
    })
  })
}

/* ── price entries ────────────────────────────────────────────── */

/**
 * `commercial.PriceEntry`. `base_price` is the cascade price; `sale_price`,
 * when set, is what the engine actually resolves to. The schema lives in
 * `./contracts`.
 */

export interface PriceEntryDraft {
  sku: string
  article_id: string
  base_price: number
  sale_price: number | null
  cost_price: number | null
  start_date: string | null
  end_date: string | null
  priority: number
  is_active: boolean
}

const entryPath = (id: string) => `/v1/commercial/price-entries/${segment(id)}`

export function loadPriceEntry(id: string): Promise<PriceEntryWire> {
  return api.get(entryPath(id), { schema: PriceEntryWire })
}

/**
 * Appends one entry to a list. `CreatePriceEntry` requires a client-minted
 * `entry_id` and a positive `base_price`, and forces `is_active` true.
 */
export function addPriceEntry(
  listId: string,
  entryId: string,
  entry: PriceEntryDraft
): Promise<PriceEntryWire> {
  return attempted(() =>
    api.post<PriceEntryWire>(
      `${listPath(listId)}/entries`,
      { ...entry, entry_id: entryId, list_id: listId }
    )
  )
}

/** Replaces one entry. The id is in the path; `list_id` must ride the body. */
export function savePriceEntry(
  listId: string,
  entryId: string,
  draft: PriceEntryDraft
): Promise<PriceEntryWire> {
  return attempted(() =>
    api.put<PriceEntryWire>(entryPath(entryId), { ...draft, list_id: listId })
  )
}

/** Retire an entry. There is no entry DELETE; inactive is the retirement. */
export async function retirePriceEntry(entryId: string): Promise<PriceEntryWire> {
  return attempted(async () => {
    const current = await loadPriceEntry(entryId)
    return api.put<PriceEntryWire>(entryPath(entryId), {
      list_id: current.list_id,
      sku: current.sku,
      article_id: current.article_id ?? "",
      base_price: current.base_price,
      sale_price: current.sale_price ?? null,
      cost_price: current.cost_price ?? null,
      start_date: current.start_date,
      end_date: current.end_date,
      priority: current.priority,
      is_active: false,
    })
  })
}

/* ── markdowns: /v1/commercial/markdowns ──────────────────────── */

/**
 * `commercial.Markdown`. `markdown_value` is a `decimal.Decimal`: it comes
 * back as a JSON string and is accepted as either a string or a number.
 * `start_date` / `end_date` are plain `time.Time`, not pointers, so they are
 * always sent. The schema (and `MarkdownTypeWire` / `MarkdownStatusWire`)
 * live in `./contracts`.
 */

export type MarkdownDraft = Omit<MarkdownWire, "markdown_id">

const markdownPath = (id: string) => `/v1/commercial/markdowns/${segment(id)}`

export function loadMarkdown(id: string): Promise<MarkdownWire> {
  return api.get(markdownPath(id), { schema: MarkdownWire })
}

/**
 * Creates a markdown under a client-minted id. `CreateMarkdown` requires the
 * id, a name, a SKU or an article, and a positive `markdown_price`.
 */
export function createMarkdown(
  markdownId: string,
  draft: MarkdownDraft
): Promise<MarkdownWire> {
  return attempted(() =>
    api.post<MarkdownWire>("/v1/commercial/markdowns", {
      ...draft,
      markdown_id: markdownId,
    })
  )
}

export function saveMarkdown(
  id: string,
  draft: MarkdownDraft
): Promise<MarkdownWire> {
  return attempted(() => api.put<MarkdownWire>(markdownPath(id), draft))
}

/**
 * Retire a markdown. Cancelling it hands the price back to the cascade, which
 * is the whole point: a markdown is a price source, so withdrawing it restores
 * whatever level the cascade resolved to underneath.
 */
export async function retireMarkdown(id: string): Promise<MarkdownWire> {
  return attempted(async () => {
    const current = await loadMarkdown(id)
    return api.put<MarkdownWire>(markdownPath(id), {
      name: current.name,
      sku: current.sku,
      article_id: current.article_id ?? "",
      list_id: current.list_id,
      original_price: current.original_price,
      markdown_price: current.markdown_price,
      markdown_type: current.markdown_type,
      markdown_value: current.markdown_value,
      start_date: current.start_date,
      end_date: current.end_date,
      store_ids: current.store_ids ?? [],
      reason: current.reason,
      status: "cancelled" as MarkdownStatusWire,
    })
  })
}

/* ── campaigns: /v1/commercial/campaigns ──────────────────────── */

/**
 * `commercial.Campaign`. `budget` is a `*money.Money` — omitting it leaves the
 * campaign uncapped, which is not the same as capping it at zero. `budget_used`
 * and `kpis` are hub-side projections and are never authored from here. The
 * schema (and `CampaignStatusWire`) lives in `./contracts`.
 */

/** What the campaign sheet collects; `promo_ids` is round-tripped. */
export interface CampaignEdit {
  name: string
  description: string
  theme: string
  start_date: string
  end_date: string
  status: CampaignStatusWire
  store_ids: string[]
  budget: number | null
}

const campaignPath = (id: string) => `/v1/commercial/campaigns/${segment(id)}`

export function loadCampaign(id: string): Promise<CampaignWire> {
  return api.get(campaignPath(id), { schema: CampaignWire })
}

/**
 * Creates a campaign under a client-minted id. `CreateCampaign` requires the
 * id, a name, and both dates; a budget also passes through the marketing
 * budget gate, which can refuse the create outright.
 */
export function createCampaign(
  campaignId: string,
  edit: CampaignEdit
): Promise<CampaignWire> {
  return attempted(() =>
    api.post<CampaignWire>("/v1/commercial/campaigns", {
      ...edit,
      campaign_id: campaignId,
      promo_ids: [],
    })
  )
}

/**
 * Replaces a campaign. `promo_ids` is read back off the current row and
 * returned unchanged: rules are attached to a campaign from the rule side, and
 * PUT would clear anything omitted.
 */
export async function saveCampaign(
  id: string,
  edit: CampaignEdit
): Promise<CampaignWire> {
  return attempted(async () => {
    const current = await loadCampaign(id)
    return api.put<CampaignWire>(campaignPath(id), {
      ...edit,
      promo_ids: current.promo_ids ?? [],
    })
  })
}

/**
 * Retire a campaign. Cancelling closes the container; the rules inside it keep
 * their own status, because a campaign is not a mechanic.
 */
export async function retireCampaign(id: string): Promise<CampaignWire> {
  return attempted(async () => {
    const current = await loadCampaign(id)
    return api.put<CampaignWire>(campaignPath(id), {
      name: current.name,
      description: current.description,
      theme: current.theme,
      start_date: current.start_date,
      end_date: current.end_date,
      status: "cancelled",
      promo_ids: current.promo_ids ?? [],
      store_ids: current.store_ids ?? [],
      budget: current.budget ?? null,
    })
  })
}

/* ── coupons: /v1/pricing-engine/coupons ──────────────────────── */

/**
 * `pricingengine.Coupon`. A coupon UNLOCKS A RULE — it carries no value of its
 * own — so `rule_id` is the whole point of the object.
 *
 * The route has no per-code GET and no PUT: `POST /coupons` is an upsert keyed
 * on `code`, and the collection read is a map keyed by the same code. Create,
 * edit and retire are therefore all the same call with a different body.
 */
export interface CouponWire {
  code: string
  name: string
  kind: string
  rule_id: string
  campaign_id: string
  member_id: string
  valid_from: string | null
  valid_to: string | null
  max_uses: number
  used: number
  require_online: boolean
  status: string
}

export function blankCoupon(): CouponWire {
  return {
    code: "",
    name: "",
    kind: "promotional",
    rule_id: "",
    campaign_id: "",
    member_id: "",
    valid_from: null,
    valid_to: null,
    max_uses: 0,
    used: 0,
    require_online: false,
    status: "active",
  }
}

/** Upsert a coupon. `used` is a hub-side counter and is round-tripped only. */
export function saveCoupon(coupon: CouponWire): Promise<CouponWire> {
  return attempted(() =>
    api.post<CouponWire>("/v1/pricing-engine/coupons", coupon)
  )
}

/** Retire a coupon: `expired` stops the engine accepting the code. */
export function retireCoupon(coupon: CouponWire): Promise<CouponWire> {
  return saveCoupon({ ...coupon, status: "expired" })
}

/* ── vouchers: /v1/commercial/vouchers ────────────────────────── */

/**
 * A voucher CARRIES VALUE, so unlike a coupon it names no rule. The route
 * projects the `vouchers` table by hand, which is why this one contract is
 * camelCase and takes a bare `YYYY-MM-DD` expiry rather than RFC3339.
 * `VoucherTypeWire` lives in `./contracts`.
 */

export interface VoucherDraft {
  code: string
  type: VoucherTypeWire
  discountPct: number | null
  valueIdr: number | null
  minSpend: number | null
  expiryDate: string
  redeemableViaLoyalty: boolean
  pointsValue: number | null
}

const voucherPath = (id: string) => `/v1/commercial/vouchers/${segment(id)}`

/**
 * Every voucher mutation on the hub answers by re-rendering the row through
 * `getVoucher`, and that projection scans more columns than its own SELECT
 * returns — so a write that COMMITS can still come back 500. The commit is
 * real: the INSERT/UPDATE has already run when the render fails.
 *
 * Rather than report a failure the hub did not have, a failed voucher write
 * re-reads the collection and looks for the row in the state it was asked
 * for. Success is claimed only when that state is actually visible; anything
 * else is still an error. (The rendering bug is fixed in the hub's own source
 * — this only has to hold until that build is deployed.)
 */
async function confirmedVoucher(
  run: () => Promise<VoucherWire>,
  expected: (row: VoucherWire) => boolean
): Promise<VoucherWire> {
  try {
    return await run()
  } catch (error) {
    let landed: VoucherWire | undefined
    try {
      const payload = await api.get("/v1/commercial/vouchers?limit=200", {
        schema: VoucherListEnvelope,
      })
      landed = (payload.items ?? []).find(expected)
    } catch {
      landed = undefined
    }
    if (landed) return landed
    throw new CommercialWriteError(getErrorMessage(error))
  }
}

/** Issue one voucher. The hub validates the type/value pairing itself. */
export function createVoucher(draft: VoucherDraft): Promise<VoucherWire> {
  return confirmedVoucher(
    () => api.post<VoucherWire>("/v1/commercial/vouchers", draft),
    (row) => row.code === draft.code
  )
}

/** The only edit the hub exposes on an issued voucher: push the expiry out. */
export function extendVoucher(
  id: string,
  expiryDate: string
): Promise<VoucherWire> {
  return confirmedVoucher(
    () =>
      api.post<VoucherWire>(`${voucherPath(id)}/extend`, {
        expiry_date: expiryDate,
      }),
    (row) => row.id === id && row.expiryDate === expiryDate
  )
}

/** Retire a voucher: `void` withdraws the value it was carrying. */
export function cancelVoucher(id: string): Promise<VoucherWire> {
  return confirmedVoucher(
    () => api.post<VoucherWire>(`${voucherPath(id)}/cancel`, {}),
    (row) => row.id === id && row.status === "void"
  )
}
