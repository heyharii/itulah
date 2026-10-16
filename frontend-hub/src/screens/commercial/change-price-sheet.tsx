import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { SavedDialog } from "@/components/ui/dialog"
import { Checkbox, Field, Input, Money } from "@/components/ui/field"
import { Choices, type Tile } from "@/components/ui/form"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner, ErrorState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import {
  BookWrittenNotPublished,
  commercialKeys,
  commercialProductsByArticles,
  minorOf,
  NOTHING_TO_PUBLISH,
  writeAndPublish,
  type ArticlePriceRow,
  type ArticlePriceRule,
  type ArticlePriceShop,
  type CommercialChannel,
  type CommercialProduct,
  type CreatePriceBookRequest,
  type MarkdownInput,
  type OfferRuleInput,
  type PricelistShop,
  type PublishReceipt,
} from "@/lib/queries/commercial"
import { cn } from "@/lib/utils"
import { useActor } from "@/screens/commercial/shared"

/// The one "Change price" sheet — a New price or a Markdown, at one article or
/// several, at some or all of the stores that sell them.
///
/// **A new price is always written at the SITE level, one rule per SKU per
/// chosen store — never a company price.** `applies_to` with both `site_id`
/// and `site_ids` null is the company rung, and nothing here is allowed to
/// write that: "All stores" means every store that sells the article gets its
/// own SITE rule, not one rule naming nobody. That is also why "the base
/// price itself never changes" is said on screen rather than merely being
/// true underneath it.
///
/// **A markdown is cut from the store's own normal price** — its own price if
/// it has one, else the base (company) price — which is the first rung in
/// that store's stack that is not itself a markdown. The engine's own stack
/// order is what is read here; nothing is re-derived from a second query.

/// What kind of change this is. The engine has no "change a price" — a book
/// only ever adds a new rung — so this chooses which rung it adds.
type Kind = "price" | "markdown"

/// Which stores the change reaches.
type Applied = "all" | "onbase" | "choose"

/// Whichever of the two amount fields was typed last drives the other.
type Driver = "pct" | "rp"

const CURRENCY = "IDR"
const TAX_CATEGORY = "STANDARD"
const CHANNEL: CommercialChannel = "STORE"

/// A markdown % is rounded DOWN to Rp1.000 — never less off than the % said.
function down1000(x: number): number {
  return Math.floor(x / 1000) * 1000
}
/// A new price % is rounded to the nearest Rp1.000.
function nearest1000(x: number): number {
  return Math.round(x / 1000) * 1000
}

function todayStr(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10)
}
/// A date typed here, as the local midnight instant the server wants.
function dateToInstant(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString()
}

/// A percent typed into the "% off" / "% change" box. A leading minus only
/// means anything for a new price — a markdown is always a cut, never a rise.
function parsePct(text: string, allowNegative: boolean): number | null {
  const negative = allowNegative && /^\s*-/.test(text)
  const digits = text.replace(/\D/g, "")
  if (digits === "") return null
  return negative ? -Number(digits) : Number(digits)
}

function shopOf(
  row: ArticlePriceRow,
  siteId: string
): ArticlePriceShop | undefined {
  return row.shops.find((shop) => shop.site_id === siteId)
}
function soldAt(row: ArticlePriceRow, siteId: string): boolean {
  return shopOf(row, siteId) !== undefined
}
/// What the shelf shows right now — a markdown included, when one is winning.
function chargedAt(row: ArticlePriceRow, siteId: string): number | null {
  return shopOf(row, siteId)?.stack[0]?.min_unit_price_minor ?? null
}
/// The rung a markdown is cut from, or the rung a new price replaces: the
/// first one in the stack that is not itself a markdown.
function normalRuleAt(
  row: ArticlePriceRow,
  siteId: string
): ArticlePriceRule | undefined {
  const shop = shopOf(row, siteId)
  if (shop === undefined) return undefined
  return shop.stack.find((rule) => rule.source !== "MARKDOWN") ?? shop.stack[0]
}
/// A store on `SITE_PRICE` or `SITE_GROUP_PRICE` — its own price, ranked above
/// the company price — as opposed to one still riding the base price.
function hasOwnPriceAt(row: ArticlePriceRow, siteId: string): boolean {
  const source = normalRuleAt(row, siteId)?.source
  return source === "SITE_PRICE" || source === "SITE_GROUP_PRICE"
}

/// Which stores one article is touched at, for the level chosen.
function targetSitesOf(
  row: ArticlePriceRow,
  applied: Applied,
  chosenSites: ReadonlySet<string>
): readonly string[] {
  if (applied === "all") return row.shops.map((shop) => shop.site_id)
  if (applied === "onbase")
    return row.shops
      .filter((shop) => !hasOwnPriceAt(row, shop.site_id))
      .map((shop) => shop.site_id)
  return row.shops
    .filter((shop) => chosenSites.has(shop.site_id))
    .map((shop) => shop.site_id)
}

/// The amount one point of a rung carries for one SKU — the rung's own
/// figure when it names no per-SKU breakdown (an unbanded article, which is
/// most of them), else the point that names that SKU.
function pointPriceOf(rule: ArticlePriceRule, skuCode: string): number {
  const point = rule.points.find((one) => one.sku_codes.includes(skuCode))
  return point?.unit_price_minor ?? rule.min_unit_price_minor
}
/// What one SKU is charged right now at one store — the article's current
/// rung, read at that SKU's own point.
function chargedForSku(
  row: ArticlePriceRow,
  siteId: string,
  skuCode: string
): number | null {
  const rule = shopOf(row, siteId)?.stack[0]
  return rule ? pointPriceOf(rule, skuCode) : null
}

/// The normal price the % is measured against, when every targeted store —
/// and every chosen SKU, when sizes are being chosen — shares one. `null`
/// when they differ, be it store to store or size to size: the derived field
/// then shows "varies by store" rather than guess at one.
function refOf(
  row: ArticlePriceRow,
  sites: readonly string[],
  skuCodes: readonly string[] | null
): number | null {
  const values = new Set<number>()
  for (const site of sites) {
    const rule = normalRuleAt(row, site)
    if (rule === undefined) continue
    if (skuCodes === null) values.add(rule.min_unit_price_minor)
    else for (const code of skuCodes) values.add(pointPriceOf(rule, code))
  }
  return values.size === 1 ? [...values][0] : null
}

/// What one store would be asked to charge, under the current fields —
/// article-wide when `skuCode` is `null`, or that one SKU's own point when
/// sizes are being chosen. `null` when there is nothing to compute yet.
function priceFor(
  row: ArticlePriceRow,
  siteId: string,
  skuCode: string | null,
  state: { kind: Kind; driver: Driver; pct: number | null; rp: number | null }
): number | null {
  if (state.driver === "rp") return state.rp
  const rule = normalRuleAt(row, siteId)
  if (rule === undefined || state.pct === null) return null
  const normal =
    skuCode === null ? rule.min_unit_price_minor : pointPriceOf(rule, skuCode)
  return state.kind === "markdown"
    ? down1000(normal * (1 - state.pct / 100))
    : nearest1000(normal * (1 + state.pct / 100))
}

export function ChangePriceSheet({
  open,
  targets,
  shops,
  presetSites,
  presetKind,
  nextVersion,
  onClose,
  onPublished,
}: {
  open: boolean
  /// One or more articles, as the grid has them.
  targets: readonly ArticlePriceRow[]
  shops: readonly PricelistShop[]
  /// Pre-ticks "Choose stores" with these sites (e.g. the cell that was clicked).
  presetSites?: readonly string[]
  presetKind?: "price" | "markdown"
  nextVersion: number
  onClose: () => void
  onPublished: (receipts: readonly PublishReceipt[]) => void
}): React.ReactElement {
  const client = useQueryClient()
  const actor = useActor()

  const single = targets.length === 1 ? targets[0] : null
  const multi = targets.length > 1
  const today = todayStr()

  const [kind, setKind] = useState<Kind>(presetKind ?? "price")
  const [applied, setApplied] = useState<Applied>(
    presetSites && presetSites.length > 0 ? "choose" : "all"
  )
  const [chosenSites, setChosenSites] = useState<ReadonlySet<string>>(
    () => new Set(presetSites ?? [])
  )
  /// Only meaningful with one article — "Sizes" does not even show for
  /// several. `chosenSkus` holds `sku_id`s, the same identity the products
  /// query answers with.
  const [sizesMode, setSizesMode] = useState<"all" | "choose">("all")
  const [chosenSkus, setChosenSkus] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [driver, setDriver] = useState<Driver>(multi ? "pct" : "rp")
  const [pctRaw, setPctRaw] = useState("")
  const [rpDigits, setRpDigits] = useState("")
  const [from, setFrom] = useState(() => todayStr())
  const [until, setUntil] = useState("")

  const labelOf = (id: string) =>
    shops.find((shop) => shop.site_id === id)?.label ?? id

  /// Every store any target article has its own price at — the only reason
  /// "Stores on the base price" is offered at all.
  const storesWithOwnPrice = useMemo(() => {
    const found = new Set<string>()
    for (const row of targets)
      for (const shop of row.shops)
        if (hasOwnPriceAt(row, shop.site_id)) found.add(shop.site_id)
    return found
  }, [targets])
  const showOnBase = kind === "price" && storesWithOwnPrice.size > 0

  function changeKind(next: Kind) {
    setKind(next)
    if (next === "markdown" && applied === "onbase") setApplied("all")
    // A new kind starts from nothing typed — the same field left over from
    // "Markdown" would otherwise be read as a new price nobody chose.
    setPctRaw("")
    setRpDigits("")
    setDriver(multi ? "pct" : "rp")
  }

  function toggleSite(id: string, checked: boolean) {
    setChosenSites((was) => {
      const next = new Set(was)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }
  function toggleSku(id: string, checked: boolean) {
    setChosenSkus((was) => {
      const next = new Set(was)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // ── the SKUs a new price needs, and the SKUs "Choose sizes" offers ──────
  //
  // A markdown names an article and a store — `MarkdownInput` carries no SKU
  // at all, unless sizes are being chosen, where it names a SKU instead of
  // the article. A new price is `commercial_price_rule`, keyed by `sku_id`,
  // so it can only be written once the article's products are resolved.
  // Loaded for a single article regardless of kind — resolving one style's
  // handful of SKUs is cheap, and "Sizes" needs the list either way.
  const articleCodes = useMemo(
    () => targets.map((row) => row.article_code),
    [targets]
  )
  const products = useQuery({
    queryKey: commercialKeys.productsByArticles(articleCodes, 2000),
    queryFn: ({ signal }) =>
      commercialProductsByArticles(articleCodes, 2000, signal),
    enabled:
      open && articleCodes.length > 0 && (kind === "price" || single !== null),
  })
  const productsByArticle = useMemo(() => {
    const map = new Map<string, CommercialProduct[]>()
    for (const product of products.data ?? []) {
      const held = map.get(product.article_code)
      if (held) held.push(product)
      else map.set(product.article_code, [product])
    }
    return map
  }, [products.data])
  const singleProducts = single
    ? (productsByArticle.get(single.article_code) ?? [])
    : []
  const chosenSkuList =
    sizesMode === "choose"
      ? singleProducts.filter((product) => chosenSkus.has(product.sku_id))
      : singleProducts

  // ── the two linked fields ─────────────────────────────────────────────────
  const allowNegative = kind === "price"
  const pctValue = parsePct(pctRaw, allowNegative)
  const rpValue = minorOf(rpDigits)
  /// The normal price the % is read against — for a single article, at the
  /// stores and (when chosen) the sizes it is currently going to. Several
  /// articles never share one Rp field to begin with.
  const ref =
    single === null
      ? null
      : refOf(
          single,
          targetSitesOf(single, applied, chosenSites),
          sizesMode === "choose" ? chosenSkuList.map((p) => p.sku_code) : null
        )

  const pctFieldValue =
    driver === "pct"
      ? pctRaw
      : single !== null && ref !== null && rpValue !== null
        ? String(
            Math.round(
              (kind === "markdown" ? ref - rpValue : rpValue - ref) /
                (ref / 100)
            )
          )
        : ""
  const rpFieldValue =
    driver === "rp"
      ? rpDigits
      : single !== null && ref !== null && pctValue !== null
        ? String(
            kind === "markdown"
              ? down1000(ref * (1 - pctValue / 100))
              : nearest1000(ref * (1 + pctValue / 100))
          )
        : ""

  function handlePctInput(raw: string) {
    setDriver("pct")
    const negative = allowNegative && /^\s*-/.test(raw)
    const digits = raw.replace(/\D/g, "")
    setPctRaw(
      digits === "" ? (negative ? "-" : "") : (negative ? "-" : "") + digits
    )
  }
  function handleRpInput(digits: string) {
    setDriver("rp")
    setRpDigits(digits)
  }

  const quickValues = kind === "markdown" ? [10, 20, 30, 50] : [-10, -5, 5, 10]

  // ── validity ───────────────────────────────────────────────────────────────
  const ready =
    !(applied === "choose" && chosenSites.size === 0) &&
    !(sizesMode === "choose" && chosenSkus.size === 0) &&
    !(kind === "markdown" && until !== "" && until < from) &&
    (driver === "pct"
      ? pctValue !== null &&
        pctValue !== 0 &&
        (kind === "price" || (pctValue > 0 && pctValue < 100))
      : rpValue !== null && rpValue > 0)

  const priceState = { kind, driver, pct: pctValue, rp: rpValue }

  /// Every store any chosen article will actually be written for — the
  /// "Publish to N stores" figure, whether or not the price there changes.
  const allTargetSites = useMemo(() => {
    const found = new Set<string>()
    for (const row of targets)
      for (const site of targetSitesOf(row, applied, chosenSites))
        found.add(site)
    return found
  }, [targets, applied, chosenSites])

  // ── preview: what each store will charge ────────────────────────────────
  interface PreviewRow {
    readonly siteId: string
    readonly label: string
    readonly now: string
    readonly after: string
    readonly changed: boolean
  }
  const { rows: previewRows, changed } = useMemo<{
    rows: readonly PreviewRow[]
    changed: number
  }>(() => {
    let total = 0
    const rows = shops.map((shop) => {
      const now = single ? money(chargedAt(single, shop.site_id)) : "—"
      const selling = targets.filter((row) => soldAt(row, shop.site_id))
      if (selling.length === 0)
        return {
          siteId: shop.site_id,
          label: shop.label ?? shop.site_id,
          now,
          after: "not sold",
          changed: false,
        }
      const targeted = selling.filter((row) =>
        targetSitesOf(row, applied, chosenSites).includes(shop.site_id)
      )
      if (targeted.length === 0)
        return {
          siteId: shop.site_id,
          label: shop.label ?? shop.site_id,
          now,
          after:
            kind === "price" && applied === "onbase"
              ? "keeps its own price"
              : "not included",
          changed: false,
        }
      if (!ready)
        return {
          siteId: shop.site_id,
          label: shop.label ?? shop.site_id,
          now,
          after: "—",
          changed: false,
        }
      let rowChanged = 0
      let sample: number | null = null
      let markdownOver: number | null = null
      // "Choose sizes" prices SKU by SKU — each may have its own normal
      // price — while the default prices the whole article as one figure.
      const bySku = sizesMode === "choose" && chosenSkuList.length > 0
      const itemCount = bySku ? chosenSkuList.length : targeted.length
      for (const row of targeted) {
        const codes =
          row === single && bySku
            ? chosenSkuList.map((p) => p.sku_code)
            : [null]
        for (const code of codes) {
          const computed = priceFor(row, shop.site_id, code, priceState)
          if (computed === null) continue
          // A new price replaces the store's NORMAL price, so it is compared
          // with that — even when a markdown is running on top of it. The
          // markdown keeps winning until it ends, and the preview says so.
          const normalRule = normalRuleAt(row, shop.site_id)
          const before =
            kind === "price"
              ? normalRule === undefined
                ? null
                : code === null
                  ? normalRule.min_unit_price_minor
                  : pointPriceOf(normalRule, code)
              : code === null
                ? chargedAt(row, shop.site_id)
                : chargedForSku(row, shop.site_id, code)
          if (computed !== before) {
            rowChanged += 1
            total += 1
            if (sample === null) sample = computed
            if (
              kind === "price" &&
              markdownOver === null &&
              shopOf(row, shop.site_id)?.stack.some(
                (rule) => rule.source === "MARKDOWN"
              )
            )
              markdownOver = chargedAt(row, shop.site_id)
          }
        }
      }
      return {
        siteId: shop.site_id,
        label: shop.label ?? shop.site_id,
        now,
        after:
          rowChanged === 0
            ? "no change"
            : itemCount === 1
              ? markdownOver !== null
                ? `→ ${money(sample)} · markdown ${money(markdownOver)} stays`
                : `→ ${money(sample)}`
              : `${count(rowChanged)} of ${count(itemCount)} ${
                  bySku ? "size" : "article"
                }${itemCount === 1 ? "" : "s"} change`,
        changed: rowChanged > 0,
      }
    })
    return { rows, changed: total }
    // `priceState` is a fresh object every render; its own fields are the
    // real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    shops,
    targets,
    applied,
    chosenSites,
    kind,
    driver,
    pctValue,
    rpValue,
    ready,
    sizesMode,
    chosenSkuList,
  ])

  const bookName = `${kind === "markdown" ? "Markdown" : "New price"} · ${
    single
      ? (single.article_name ?? single.article_code)
      : `${count(targets.length)} articles`
  }`

  const publish = useMutation({
    mutationFn: async () => {
      const version = nextVersion
      const offerRules: OfferRuleInput[] = []
      const markdowns: MarkdownInput[] = []
      for (const row of targets) {
        // "Choose sizes" only ever names the one targeted article — several
        // articles never share a sizes list to begin with.
        const bySku = row === single && sizesMode === "choose"
        for (const siteId of targetSitesOf(row, applied, chosenSites)) {
          if (kind === "markdown") {
            if (bySku) {
              for (const product of chosenSkuList) {
                const price = priceFor(
                  row,
                  siteId,
                  product.sku_code,
                  priceState
                )
                if (price === null) continue
                markdowns.push({
                  markdown_id: `md-v${version}-${product.sku_code}-${siteId}`,
                  sku_code: product.sku_code,
                  site_id: siteId,
                  replacement_unit_price_minor: price,
                  priority: 0,
                  effective_from: dateToInstant(from),
                  effective_to: until === "" ? null : dateToInstant(until),
                })
              }
            } else {
              const price = priceFor(row, siteId, null, priceState)
              if (price === null) continue
              markdowns.push({
                markdown_id: `md-v${version}-${row.article_code}-${siteId}`,
                article_code: row.article_code,
                site_id: siteId,
                replacement_unit_price_minor: price,
                priority: 0,
                effective_from: dateToInstant(from),
                effective_to: until === "" ? null : dateToInstant(until),
              })
            }
          } else {
            const skuList = bySku
              ? chosenSkuList
              : (productsByArticle.get(row.article_code) ?? [])
            for (const product of skuList) {
              const price = priceFor(
                row,
                siteId,
                bySku ? product.sku_code : null,
                priceState
              )
              if (price === null) continue
              offerRules.push({
                sku_id: product.sku_id,
                // Always a SITE rung, never a group and never the company
                // rung — a new price replaces what ONE store charges, and
                // "All stores" is every store getting its own row, not one
                // row naming none of them.
                site_id: siteId,
                site_ids: null,
                channel: CHANNEL,
                sellable: true,
                currency: CURRENCY,
                unit_price_minor: price,
                tax_category: TAX_CATEGORY,
              })
            }
          }
        }
      }
      const request: CreatePriceBookRequest = {
        ...NOTHING_TO_PUBLISH,
        version,
        name: bookName,
        change_type: kind === "markdown" ? "MARKDOWN" : "REGULAR_PRICE",
        effective_from: dateToInstant(from),
        effective_to: null,
        // A book with no offer rules may carry no tax rule — it would
        // categorise nothing — so a markdown-only book sends none.
        tax_rules:
          kind === "price"
            ? [{ tax_category: TAX_CATEGORY, rate_bps: 0, tax_inclusive: true }]
            : [],
        offer_rules: offerRules,
        markdowns,
        actor_id: actor,
        idempotency_key: crypto.randomUUID(),
      }
      return writeAndPublish(request)
    },
    onError: () => {
      // A `BookWrittenNotPublished` still wrote a draft, so `nextVersion` is
      // now taken — refresh the list so a retry asks for the next one rather
      // than repeating a version the server has already refused once.
      client.invalidateQueries({ queryKey: commercialKeys.books() })
    },
    onSuccess: (receipt) => {
      client.invalidateQueries({ queryKey: commercialKeys.all })
      setPublished({
        title: `“${bookName}” published`,
        note: `Sent to ${count(receipt.delivered_to.length)} store${
          receipt.delivered_to.length === 1 ? "" : "s"
        }.`,
      })
      onPublished([receipt])
      onClose()
    },
  })
  /// The publish this sheet made, held in the receipt dialog until it is
  /// read. The sheet is keyed rather than unmounted, so the state survives
  /// the close its own `onClose` performs.
  const [published, setPublished] = useState<
    | {
        readonly title: string
        readonly note: string
      }
    | null
  >(null)

  const waitingOnProducts =
    (kind === "price" || sizesMode === "choose") &&
    (products.isPending || products.isError)
  const canPublish =
    ready &&
    changed > 0 &&
    actor !== "" &&
    !waitingOnProducts &&
    !publish.isPending

  // ── the two choice questions ─────────────────────────────────────────────
  const kindOptions: readonly Tile<Kind>[] = [
    {
      value: "price",
      label: "New price",
    },
    {
      value: "markdown",
      label: "Markdown",
    },
  ]

  const appliedOptions = useMemo<readonly Tile<Applied>[]>(() => {
    const options: Tile<Applied>[] = [
      {
        value: "all",
        label: "All stores",
      },
    ]
    if (showOnBase) {
      const names = [...storesWithOwnPrice].map(labelOf)
      options.push({
        value: "onbase",
        label: "Stores on the base price",
        note: `Not ${names.join(", ")}`,
      })
    }
    options.push({
      value: "choose",
      label: "Choose stores",
    })
    return options
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, showOnBase, storesWithOwnPrice, shops])

  const sizesOptions: readonly Tile<"all" | "choose">[] = [
    { value: "all", label: "All sizes" },
    { value: "choose", label: "Choose sizes" },
  ]
  /// The store the "Sizes" checklist prices each SKU at — the first store
  /// this change is actually going to, or failing that the first that sells
  /// the article at all, so the list still shows something before a level is
  /// chosen.
  const sizesPreviewSite = single
    ? (targetSitesOf(single, applied, chosenSites)[0] ??
      single.shops[0]?.site_id ??
      null)
    : null

  const pctLabel = kind === "markdown" ? "% off" : "% change"

  const halted =
    publish.error instanceof BookWrittenNotPublished ? publish.error : null

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && onClose()}
      title="Change price"
      id={single ? single.article_code : `${count(targets.length)} articles`}
      width="wide"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              "min-w-0 truncate text-[0.9375rem]",
              actor === "" ? "text-bad" : "text-text"
            )}
          >
            {actor === ""
              ? "Sign in to publish."
              : ready
                ? `${count(changed)} price${changed === 1 ? "" : "s"} change`
                : "Fill in the price."}
          </span>
          <div className="flex items-center gap-3">
            <Button data-cancel variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!canPublish}
              pending={publish.isPending}
              onClick={() => publish.mutate()}
            >
              {`Publish to ${count(allTargetSites.size)} store${
                allTargetSites.size === 1 ? "" : "s"
              }`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-8">
        {halted !== null ? (
          <Banner tone="bad">{halted.message}</Banner>
        ) : publish.isError ? (
          <ErrorState error={publish.error} />
        ) : null}

        <div className="flex flex-col gap-3">
          <span className="text-[0.9375rem] font-medium text-ink">
            What kind of price?
          </span>
          <Choices
            label="What kind of price?"
            columns={1}
            value={kind}
            onChange={changeKind}
            options={kindOptions}
          />
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-[0.9375rem] font-medium text-ink">
            Applied to
          </span>
          <Choices
            label="Applied to"
            columns={1}
            value={applied}
            onChange={setApplied}
            options={appliedOptions}
          />
          {applied === "choose" && (
            <div className="grid grid-cols-1 gap-1 rounded-inner border border-hairline-2 p-1.5 sm:grid-cols-2">
              {shops.map((shop) => {
                const disabled =
                  single !== null && !soldAt(single, shop.site_id)
                return (
                  <Checkbox
                    key={shop.site_id}
                    checked={chosenSites.has(shop.site_id)}
                    onChange={(checked) => toggleSite(shop.site_id, checked)}
                    disabled={disabled}
                    label={shop.label ?? shop.site_id}
                    hint={
                      single === null
                        ? undefined
                        : disabled
                          ? "not sold"
                          : money(chargedAt(single, shop.site_id))
                    }
                    className="w-full rounded-inner px-3 py-2.5 hover:bg-soft"
                  />
                )
              })}
            </div>
          )}
        </div>

        {single && (
          <div className="flex flex-col gap-3">
            <span className="text-[0.9375rem] font-medium text-ink">Sizes</span>
            <Choices
              label="Sizes"
              columns={1}
              value={sizesMode}
              onChange={setSizesMode}
              options={sizesOptions}
            />
            {sizesMode === "choose" &&
              (products.isPending ? (
                <p className="text-[0.9375rem] text-mute">Loading…</p>
              ) : products.isError ? (
                <p className="text-[0.9375rem] text-bad">
                  Could not load sizes.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-1 rounded-inner border border-hairline-2 p-1.5 sm:grid-cols-2">
                  {singleProducts.map((product) => (
                    <Checkbox
                      key={product.sku_id}
                      checked={chosenSkus.has(product.sku_id)}
                      onChange={(checked) => toggleSku(product.sku_id, checked)}
                      label={
                        <span className="flex items-center gap-1.5">
                          <span>
                            {[product.color, product.size]
                              .filter((one) => one !== null)
                              .join(" · ") || product.sku_code}
                          </span>
                          <span className="font-mono text-[0.9375rem] text-mute">
                            {product.sku_code}
                          </span>
                        </span>
                      }
                      hint={
                        sizesPreviewSite === null
                          ? undefined
                          : money(
                              chargedForSku(
                                single,
                                sizesPreviewSite,
                                product.sku_code
                              )
                            )
                      }
                      className="w-full rounded-inner px-3 py-2.5 hover:bg-soft"
                    />
                  ))}
                </div>
              ))}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <span className="text-[0.9375rem] font-medium text-ink">
            {kind === "markdown" ? "Markdown price" : "New price"}
          </span>
          <div className="flex gap-4">
            <Field label={pctLabel} className="w-[8.5rem] shrink-0">
              <span className="relative flex w-full items-center">
                <Input
                  value={pctFieldValue}
                  inputMode="text"
                  onChange={(event) => handlePctInput(event.target.value)}
                  className="pr-7 text-right tabular-nums"
                />
                <span className="pointer-events-none absolute right-3 text-[0.9375rem] text-mute">
                  %
                </span>
              </span>
            </Field>
            <Field label="Price" className="flex-1">
              <Money
                value={rpFieldValue}
                onChange={handleRpInput}
                disabled={multi}
                prefix="Rp"
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            {quickValues.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setDriver("pct")
                  setPctRaw(String(value))
                }}
                className={cn(
                  "h-9 rounded-inner border px-3 text-[0.9375rem] font-medium transition-colors",
                  driver === "pct" && pctValue === value
                    ? "border-accent bg-accent-bg text-accent"
                    : "border-hairline-2 bg-canvas text-body hover:bg-soft"
                )}
              >
                {kind === "markdown"
                  ? `−${value}%`
                  : `${value > 0 ? "+" : "−"}${Math.abs(value)}%`}
              </button>
            ))}
          </div>
          {waitingOnProducts &&
            (products.isError ? (
              <p className="text-[0.9375rem] text-bad">
                Could not load products.
              </p>
            ) : (
              <p className="text-[0.9375rem] text-mute">Loading…</p>
            ))}
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-[0.9375rem] font-medium text-ink">When?</span>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Starts">
              <Input
                type="date"
                value={from}
                min={today}
                onChange={(event) =>
                  setFrom(
                    event.target.value < today ? today : event.target.value
                  )
                }
              />
            </Field>
            {kind === "markdown" && (
              <Field label="Ends" hint="Empty = no end">
                <Input
                  type="date"
                  value={until}
                  min={from}
                  onChange={(event) => setUntil(event.target.value)}
                />
              </Field>
            )}
          </div>
        </div>

        <div>
          <SubHead>
            {sizesMode === "choose"
              ? "After publish, chosen sizes"
              : "After publish"}
          </SubHead>
          <MiniTable
            head={[
              "Store",
              { label: "Now", align: "right" },
              { label: "After", align: "right" },
            ]}
          >
            {previewRows.map((row) => (
              <MiniRow key={row.siteId}>
                <MiniCell className="py-3.5">{row.label}</MiniCell>
                <MiniCell align="right" className="py-3.5">
                  <span className="text-mute tabular-nums">{row.now}</span>
                </MiniCell>
                <MiniCell align="right" className="py-3.5">
                  <span
                    className={cn(
                      "tabular-nums",
                      row.changed ? "font-medium text-ink" : "text-mute"
                    )}
                  >
                    {row.after}
                  </span>
                </MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
        </div>
      </div>
    </Sheet>
      <SavedDialog
        open={published !== null}
        onOpenChange={(next) => {
          if (!next) setPublished(null)
        }}
        title={published?.title ?? ""}
      >
        {published?.note}
      </SavedDialog>
    </>
  )
}
