import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { Effect } from "@itulah/contract"
import { ChevronRight, Percent, Store, TrendingDown } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools, type DockStatus } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/field"
import { ListFilters } from "@/components/ui/list-filters"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Thumbnail } from "@/components/ui/thumbnail"
import {
  Banner,
  EmptyState,
  LoadMore,
  type Pageable,
} from "@/components/ui/states"
import {
  ago,
  count,
  day,
  dayMonth,
  money,
  moment,
  percent,
  percentBps,
  sku as skuText,
} from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  articlePrices,
  articlePricesPagesQuery,
  campaignCatalogue,
  commercialKeys,
  commercialProductsByArticles,
  priceScopeFromFilters,
  type ArticlePriceScope,
  describeLevel,
  describeSource,
  listPriceBooks,
  markupBps,
  priceBookDetail,
  priceHistory,
  priceHistoryKeys,
  promotionCatalogue,
  shelfPrices,
  simulate,
  type AppliedRule,
  type RejectedRule,
  type SimulateResult,
  type PricelistShop,
  type ArticlePricePoint,
  type ArticlePriceRow,
  type ArticlePriceRule,
  type ArticlePriceShop,
  type ArticlePrices,
  type CommercialChannel,
  type PriceLevel,
  type PriceScope,
  type PublishReceipt,
} from "@/lib/queries/commercial"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import {
  fleetPools,
  inventoryKeys,
  poolAvailability,
} from "@/lib/queries/inventory"
import { changeKeys, listPriceChanges } from "@/lib/queries/changes"
import { useFilterState, type FilterField } from "@/lib/filters"
import { useLayout } from "@/lib/layout"
import { queryState } from "@/lib/query-state"
import { useSheet, type SheetSearch } from "@/lib/sheets"
import {
  listTerms,
  vocabularyKeys,
  type MasterTerm,
} from "@/lib/queries/vocabulary"
import { useDebounced } from "@/lib/use-debounced"
import { ChangePriceSheet } from "@/screens/commercial/change-price-sheet"
import { ChangesBody } from "@/screens/commercial/changes"
import { Named, Quiet } from "@/screens/commercial/parts"
import {
  CardFigure,
  CardFoot,
  CardName,
  Fig,
  PhoneCard,
  Sentence,
} from "@/components/ui/phone-cards"
import { cellKey, conditionsOf } from "@/screens/commercial/shared"

/// The pricelist — what every article costs at every shop, right now, and why.
///
/// This is the merged reading of the grid: one row per band of sizes that
/// costs the same everywhere, one column per shop, one figure per cell — what
/// the till charges a walk-in shopper *right now*, promotions included. There
/// is no separate "pricelist" reading any more: asking for the shelf price
/// without what a shopper actually pays was always the same question asked one
/// step too early, and keeping both meant every screen that read this file had
/// to say twice which one it meant.
///
///  1. **The column model is data.** `shops[]` comes back from the endpoint —
///     the STORE origins the centre knows about — so the grid's shape changes
///     when the client opens a branch, and nothing here names a shop.
///  2. **A band is a fact about the data, not a rendering choice.** When every
///     SKU of a style shares one signature — the same base price, the same
///     winning rule at every shop, the same final price where that is known —
///     it is one row, "All sizes". When they do not, each group of SKUs that
///     agree gets its own row, labelled by the sizes it covers.
///  3. **Markdown and Promotion never stack.** The engine's own `final_price`
///     is what is drawn; a markdown rung that lost to a promotion (or the
///     reverse) is shown struck through underneath the one that won, because
///     both are real and only one of them is being charged.

/// What the till would charge before any promotion — the best-ranked
/// candidate that is not a markdown. A markdown is measured against this, not
/// against the base price: a store with its own price that then marks down is
/// cutting ITS price, not the company's.
/// Whether a rung prices this SKU. A rung with no breakdown covers everything
/// it won; one with a breakdown covers only the SKUs it names — a markdown on
/// size XL is not a markdown on size M.
function covers(rule: ArticlePriceRule, skuCode: string | null): boolean {
  if (skuCode === null) return true
  const points = pointsOf(rule)
  if (points.length === 1 && points[0].sku_codes.length === 0) return true
  return points.some((point) => point.sku_codes.includes(skuCode))
}

function regularRuleOf(
  shop: ArticlePriceShop | undefined,
  skuCode: string | null = null
): ArticlePriceRule | undefined {
  return shop?.stack.find(
    (rule) => rule.source !== "MARKDOWN" && covers(rule, skuCode)
  )
}

function markdownRuleOf(
  shop: ArticlePriceShop | undefined,
  skuCode: string | null = null
): ArticlePriceRule | undefined {
  return shop?.stack.find(
    (rule) => rule.source === "MARKDOWN" && covers(rule, skuCode)
  )
}

/// What the till charges, before promotions. `undefined` when this shop
/// cannot sell the style at all — absent rather than zero, because no price is
/// not a price.
function winner(
  shop: ArticlePriceShop | undefined
): ArticlePriceRule | undefined {
  return shop?.stack[0]
}

/// The distinct prices one candidate carries, always as a list.
///
/// `points` is the server's own breakdown of the same rung it drew the range
/// from. The fallback is for a rung that arrives without one: a price is never
/// dropped just because the breakdown is missing, and a rung with no
/// breakdown is read as one price covering every SKU it won.
function pointsOf(rule: ArticlePriceRule): readonly ArticlePricePoint[] {
  if (rule.points.length > 0) return rule.points
  return [
    {
      unit_price_minor: rule.min_unit_price_minor,
      sku_codes: [],
      in_force_for: rule.in_force_for,
    },
  ]
}

/// A candidate's prices as one sentence, for prose that has no rows to use.
function amounts(rule: ArticlePriceRule): string {
  return pointsOf(rule)
    .map((point) => money(point.unit_price_minor))
    .join(", ")
}

/// One rule's price for one SKU. `null` when the rule's own breakdown does not
/// mention that SKU at all — a shop whose assortment skips a size prices
/// nothing for it, and that is different from pricing it at the rule's lowest
/// point.
function amountFor(
  rule: ArticlePriceRule | undefined,
  skuCode: string | null
): number | null {
  if (rule === undefined) return null
  const points = pointsOf(rule)
  // No real breakdown — the rung is one price, uniform over everything it won.
  if (points.length === 1 && points[0].sku_codes.length === 0)
    return points[0].unit_price_minor
  if (skuCode === null) return points[0]?.unit_price_minor ?? null
  return (
    points.find((point) => point.sku_codes.includes(skuCode))
      ?.unit_price_minor ?? null
  )
}

/// The key a cell is opened under, and read back from.
function readCellKey(value: string | undefined): {
  articleCode: string
  siteId: string
} | null {
  if (value === undefined) return null
  const at = value.lastIndexOf("@")
  if (at <= 0 || at === value.length - 1) return null
  return { articleCode: value.slice(0, at), siteId: value.slice(at + 1) }
}

/// A date in the merged grid: the house format without the year — "01 Jul –
/// 02 Aug" reads in one glance where a date with a year would not fit a cell.
/// The browser's own local time, not UTC: a markdown published today, WIB,
/// otherwise reads as if it started yesterday.
const shortDay = dayMonth
function shortSpan(from: string, to: string | null): string {
  return to === null
    ? `from ${shortDay(from)}`
    : `${shortDay(from)} – ${shortDay(to)}`
}

/// Signed percentage, the direction stated rather than implied — a markdown is
/// always shown as the cut it is.
function pctVs(amountMinor: number, ofMinor: number): string | null {
  if (ofMinor === 0) return null
  const pct = Math.round(((amountMinor - ofMinor) / ofMinor) * 100)
  if (pct === 0) return null
  return percent(pct, { signed: true })
}

/// The channel this grid is about.
///
/// A constant rather than a picker. The engine takes all three channels and
/// `ONLINE`/`MARKETPLACE` are real, but nothing in this business sells on them
/// yet, so the control offered two answers that were always empty and made the
/// third look like a choice. When a second channel starts trading, this becomes
/// a `Segmented` again.
const CHANNEL: CommercialChannel = "STORE"

/// The ticks in the right-hand panel that keep only articles carrying one of
/// these somewhere. None ticked = every article.
type PriceKind = "promotion" | "markdown" | "store"
const KIND_TICKS: readonly { value: PriceKind; label: string }[] = [
  { value: "promotion", label: "Promotion" },
  { value: "markdown", label: "Markdown" },
  { value: "store", label: "Store price" },
]

/// The two pages of the Pricelist: what everything costs, and the changes that
/// moved or will move it.
type PricelistTab = "prices" | "changes"

export function Pricelist() {
  // A phone draws a card per article instead of the grid, and keeps the search
  // and the filters in the drawer over the bottom bar (`DockTools`).
  const phone = useLayout() === "phone"
  /// What was typed. In the URL like every other search box in this app.
  const search = useSheet("q")
  const cell = useSheet("price")
  /// One style across every shop.
  const style = useSheet("article")
  /// One shop's whole shelf, opened from its column heading.
  const shop = useSheet("shop")
  /// The prices, or the price changes behind them. In the URL like the sheets
  /// are, so a link to the changes arrives on them.
  const pageTab = useSheet("price-tab")
  const tab: PricelistTab = pageTab.value ?? "prices"
  const navigate = useNavigate()
  /// Another page: the search and the filters were typed for the one being
  /// left, so they go with it — in one navigation, because two would each
  /// start from the address the other had not finished writing.
  const switchTab = (next: PricelistTab) =>
    navigate({
      to: ".",
      replace: true,
      search: (prev: SheetSearch) => ({
        ...prev,
        "price-tab": next === "prices" ? undefined : next,
        q: undefined,
        f: undefined,
        filters: undefined,
        fields: undefined,
      }),
      viewTransition: false,
    })

  const fields = useMemo<FilterField[]>(
    () => [
      // The three marks a price can carry, answered in the browser over the
      // page loaded. First, because the first short question is the line of
      // chips.
      {
        column: "kind",
        label: "Only articles with",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          options: KIND_TICKS.map((one) => ({
            value: one.value,
            label: one.label,
          })),
          icon: (value) =>
            value === "promotion"
              ? Percent
              : value === "markdown"
                ? TrendingDown
                : value === "store"
                  ? Store
                  : undefined,
        },
      },
      {
        column: "division",
        label: "Division",
        spec: { kind: "option", single: true, operators: ["isAnyOf"] },
      },
      {
        column: "tag",
        label: "Tag",
        spec: { kind: "multi", single: true, operators: ["includesAnyOf"] },
      },
      // The one store being read by article; the shops come with the page.
      {
        column: "store",
        label: "Store",
        spec: { kind: "option", single: true, operators: ["isAnyOf"] },
      },
      {
        column: "price",
        label: "Price",
        spec: {
          kind: "number",
          unit: "Rp",
          operators: ["gte", "lte"],
        },
      },
    ],
    []
  )

  const filters = useFilterState(fields)

  /// By store: a column for every store. By article (the default, owner
  /// 16 Oct): one line for what the article costs now and what it becomes,
  /// the stores that differ opened under it.
  const [by, setBy] = useState<"article" | "store">("article")
  /// By article: the one store being read, or "" for every store.
  const storeId =
    filters.filters.find((clause) => clause.column === "store")?.values[0] ?? ""

  const divisions = useQuery({
    queryKey: vocabularyKeys.list("divisions"),
    queryFn: ({ signal }) => listTerms("divisions", signal),
  })
  const tags = useQuery({
    queryKey: vocabularyKeys.list("tags"),
    queryFn: ({ signal }) => listTerms("tags", signal),
  })

  const typed = (search.value ?? "").trim()
  const needle = useDebounced(typed, 400)
  const narrowed = useMemo<ArticlePriceScope>(
    () => ({
      ...priceScopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
    }),
    [filters.filters, needle]
  )

  /// Always the final price — what the till actually charges a walk-in
  /// shopper, promotions included. There is no other reading any more.
  const scope = useMemo<ArticlePriceScope>(
    () => ({ ...narrowed, final: true }),
    [narrowed]
  )

  const prices = useInfiniteQuery(articlePricesPagesQuery(CHANNEL, scope))

  const page = useMemo(() => {
    const first = prices.data?.pages[0]
    if (first === undefined) return undefined
    return {
      ...first,
      rows: prices.data?.pages.flatMap((one: ArticlePrices) => one.rows) ?? [],
    }
  }, [prices.data])

  const books = useQuery({
    queryKey: commercialKeys.books(),
    queryFn: ({ signal }) => listPriceBooks(signal),
  })

  /// The next book that has not started yet — the same read the "Upcoming"
  /// section of the cell panel uses.
  const upcomingFrom = useMemo(() => {
    if (page === undefined) return null
    const drawnAt = new Date(page.as_of).getTime()
    const future = (books.data ?? [])
      .filter(
        (book) =>
          book.status === "PUBLISHED" &&
          new Date(book.effective_from).getTime() > drawnAt
      )
      .map((book) => book.effective_from)
      .sort()
    return future[0] ?? null
  }, [books.data, page])

  const UPCOMING_CAP = 200
  const upcoming = useQuery({
    queryKey: commercialKeys.articlePrices(CHANNEL, upcomingFrom, narrowed),
    queryFn: ({ signal }) =>
      articlePrices(
        {
          channel: CHANNEL,
          at: upcomingFrom!,
          limit: UPCOMING_CAP,
          ...narrowed,
        },
        signal
      ),
    enabled: upcomingFrom !== null,
  })

  const bookNames = useMemo(() => {
    const map = new Map<number, string>()
    for (const book of books.data ?? []) map.set(book.version, book.name)
    return map
  }, [books.data])

  /// Every published promotion's own window, by name — the merged grid draws
  /// only the promotion's name from `final_price`, and the date line beside it
  /// has to come from somewhere else. The rule's own `effective_from`/`to` wins
  /// over the book's, the same preference `describePeriod` reads by.
  const promoCatalogue = useQuery({
    queryKey: commercialKeys.catalogue(),
    queryFn: ({ signal }) => promotionCatalogue(signal),
  })
  const promoWindows = useMemo(() => {
    const map = new Map<string, string>()
    for (const rule of promoCatalogue.data?.rules ?? []) {
      const conditions = conditionsOf(rule.definition)
      const from = conditions.effective_from ?? rule.book.effective_from
      const to = conditions.effective_to ?? rule.book.effective_to
      if (!map.has(rule.name)) map.set(rule.name, shortSpan(from, to))
    }
    return map
  }, [promoCatalogue.data])
  /// The same promotions by name, with the raw last day and what they do — the
  /// window above is a sentence, and "what the price becomes when it ends"
  /// needs the day itself.
  const promoRuns = useMemo(() => {
    const map = new Map<string, PromoRun>()
    for (const rule of promoCatalogue.data?.rules ?? []) {
      const conditions = conditionsOf(rule.definition)
      const to = conditions.effective_to ?? rule.book.effective_to
      if (!map.has(rule.name))
        map.set(rule.name, { to, effect: rule.definition.effect ?? null })
    }
    return map
  }, [promoCatalogue.data])
  /// The prices of the book that has not started yet, by article — what an
  /// article is about to cost, to set beside what it costs now.
  const ahead = useMemo<Ahead | null>(() => {
    const on = upcomingFrom === null ? null : calendarDay(upcomingFrom)
    if (on === null || upcoming.data === undefined) return null
    return {
      on,
      rows: new Map<string, ArticlePriceRow>(
        upcoming.data.rows.map((one) => [one.article_code, one])
      ),
    }
  }, [upcomingFrom, upcoming.data])
  const priceCtx = useMemo<PriceCtx>(
    () => ({ windows: promoWindows, runs: promoRuns, ahead }),
    [promoWindows, promoRuns, ahead]
  )

  const items = page?.rows ?? []
  const open = readCellKey(cell.value)

  /// Size names for the band rows ("XL", "34, 36") instead of raw SKU codes.
  /// One read for the loaded articles; until it lands the rows say "N SKU".
  const articleCodes = useMemo(
    () => items.map((row) => row.article_code),
    [items]
  )
  const products = useQuery({
    queryKey: commercialKeys.productsByArticles(articleCodes, 2000),
    queryFn: ({ signal }) =>
      commercialProductsByArticles(articleCodes, 2000, signal),
    enabled: articleCodes.length > 0,
  })
  useMemo(() => {
    for (const product of products.data ?? []) {
      if (product.size) SKU_SIZE.set(product.sku_code, product.size)
      const list = ARTICLE_SKUS.get(product.article_code) ?? []
      if (!list.some((one) => one.code === product.sku_code))
        list.push({
          code: product.sku_code,
          size: product.size,
          color: product.color,
        })
      ARTICLE_SKUS.set(product.article_code, list)
    }
  }, [products.data])

  /// "Only articles with" — client-side, over the page already loaded: a row
  /// stays when some shop charges a promotion, a markdown or its own price.
  const wanted = useMemo<ReadonlySet<PriceKind>>(
    () =>
      new Set(
        filters.filters
          .filter((clause) => clause.column === "kind")
          .flatMap((clause) => clause.values as PriceKind[])
      ),
    [filters.filters]
  )

  // ── selection and the "Change price" sheet ────────────────────────────────
  //
  // A selection is article codes, not cells: the new sheet asks "which
  // articles, at which stores" and a row's checkbox answers the first half.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const toggleArticle = (code: string) =>
    setSelected((was) => {
      const next = new Set(was)
      if (!next.delete(code)) next.add(code)
      return next
    })
  const selectVisible = (on: boolean) =>
    setSelected(
      on ? new Set(shown.map((view) => view.row.article_code)) : new Set()
    )

  const [changePrice, setChangePrice] = useState<{
    targets: readonly ArticlePriceRow[]
    presetSites?: readonly string[]
    presetKind?: "price" | "markdown"
  } | null>(null)
  /// The open sheet's key, kept after it closes: re-keying on close remounts
  /// the sheet in the same tick and takes its "… published" dialog with it.
  const [changePriceKey, setChangePriceKey] = useState("empty")
  const openKey =
    changePrice === null
      ? changePriceKey
      : `${changePrice.targets.map((one) => one.article_code).join(",")}|${changePrice.presetSites?.join(",") ?? ""}|${changePrice.presetKind ?? ""}`
  if (openKey !== changePriceKey) setChangePriceKey(openKey)

  /// Every book the last publish wrote. Usually one; more when the batch held
  /// prices starting on different days, which is one book each.
  const [receipt, setReceipt] = useState<readonly PublishReceipt[]>([])

  /// The number a new book has to carry to win.
  const nextVersion =
    (books.data ?? []).reduce(
      (highest, book) => Math.max(highest, book.version),
      0
    ) + 1

  // ── stock, always shown ───────────────────────────────────────────────────
  const pools = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })
  /// Each shop's floor — the only pool a shelf price answers for.
  const floorPoolOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const one of pools.data?.items ?? [])
      if (one.pool_code === "FLOOR" && !map.has(one.site_id))
        map.set(one.site_id, one.id)
    return map
  }, [pools.data])
  const stockQueries = useQueries({
    queries: (page?.shops ?? []).map((shopMeta) => {
      const poolId = floorPoolOf.get(shopMeta.site_id)
      return {
        queryKey: inventoryKeys.poolAvailability(
          poolId ?? `none:${shopMeta.site_id}`
        ),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          poolAvailability(poolId!, {}, signal),
        enabled: poolId !== undefined,
        staleTime: 5 * 60_000,
      }
    }),
  })
  /// Site → SKU → on hand, and site → article → on hand for the rare article
  /// with no per-SKU breakdown anywhere. Built once per answer rather than
  /// searched per cell — the grid asks this map once a band, not once a SKU.
  const stockBySite = useMemo(() => {
    const map = new Map<
      string,
      {
        readonly bySku: Map<string, number>
        readonly byArticle: Map<string, number>
      }
    >()
    ;(page?.shops ?? []).forEach((shopMeta, index) => {
      const data = stockQueries[index]?.data
      if (data === undefined) return
      const bySku = new Map<string, number>()
      const byArticle = new Map<string, number>()
      for (const item of data.items) {
        bySku.set(item.sku_code, item.on_hand_qty)
        byArticle.set(
          item.article_code,
          (byArticle.get(item.article_code) ?? 0) + item.on_hand_qty
        )
      }
      map.set(shopMeta.site_id, { bySku, byArticle })
    })
    return map
  }, [page?.shops, stockQueries])

  /// Every loaded article read once: what each costs at each store, and what
  /// it becomes next. The grid, the By article table, the phone cards and the
  /// figures above all draw from this, so none of them can disagree.
  const views = useMemo(
    () =>
      page === undefined
        ? []
        : page.rows.map((row) => viewOf(row, page.shops, priceCtx)),
    [page, priceCtx]
  )
  /// The ticks of "Only articles with", answered over the page loaded.
  const shown = useMemo(
    () =>
      wanted.size === 0 ? views : views.filter((view) => carries(view, wanted)),
    [views, wanted]
  )
  /// Counted over the page loaded, not over the ticks: a figure that moved
  /// with the ticks would say "0 on promotion" the moment Markdown was ticked.
  const figures = useMemo(
    () => figuresOf(views, page?.shops ?? [], stockBySite),
    [views, page?.shops, stockBySite]
  )

  const divisionLabels = useMemo(
    () =>
      new Map(
        (divisions.data?.terms ?? []).map((term) => [term.code, term.label])
      ),
    [divisions.data]
  )
  const tagLabels = useMemo(
    () =>
      new Map((tags.data?.terms ?? []).map((term) => [term.code, term.label])),
    [tags.data]
  )

  const counted = useCountedFields(
    fields,
    page,
    divisions.data?.terms,
    tags.data?.terms
  )

  /// The two pages, and how many each holds — the tabs on a desk, the status
  /// button in the drawer on a phone.
  const changeList = useQuery({
    queryKey: changeKeys.list(false),
    queryFn: ({ signal }) => listPriceChanges(false, signal),
  })
  const tabStatus: DockStatus = {
    value: tab,
    options: [
      { value: "prices", label: "Prices", count: page?.total },
      {
        value: "changes",
        label: "Price changes",
        count: changeList.data?.length,
      },
    ],
    onChange: (next) => void switchTab(next as PricelistTab),
  }

  const kpis: readonly { readonly label: string; readonly value: string }[] = [
    {
      label: "Articles",
      value: page === undefined ? "—" : count(page.total),
    },
    {
      label: "On promotion",
      value: page === undefined ? "—" : count(figures.promotion),
    },
    {
      label: "On markdown",
      value: page === undefined ? "—" : count(figures.markdown),
    },
    {
      label: "With a store price",
      value: page === undefined ? "—" : count(figures.store),
    },
    {
      label: "With a next price",
      value: page === undefined ? "—" : count(figures.upcoming),
    },
    {
      label: "Stock at a discount",
      value: page === undefined ? "—" : `${count(figures.discounted)} pcs`,
    },
    {
      label: "Below cost",
      value: page === undefined ? "—" : count(figures.belowCost),
    },
  ]

  return (
    <PageContent>
      <PageHeader crumb="Marketing" title="Pricelist" />

      {/* Counted over the page loaded. A phone has its sentence under the list
          instead of a strip of figures. */}
      {!phone && (
        <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
          {kpis.map((kpi) => (
            <Kpi key={kpi.label} label={kpi.label} value={kpi.value} />
          ))}
        </KpiStrip>
      )}

      <SubTabs
        // Hidden on a phone: the page is the status button in the drawer over
        // the bottom bar (`DockTools`), which says the same.
        className="max-md:hidden"
        tabs={tabStatus.options.map((one) => ({
          value: one.value,
          label: (
            <span>
              {one.label}
              {one.count !== undefined && (
                <span className="ml-1.5 text-body tabular-nums">
                  {count(one.count)}
                </span>
              )}
            </span>
          ),
        }))}
        value={tab}
        onChange={(next) => void switchTab(next as PricelistTab)}
      />

      {tab === "changes" ? (
        <ChangesBody tabs={tabStatus} />
      ) : (
        <>
          {/* The bar: how the table is read, and what narrows it, at the left;
              the verb on the right once articles are ticked. The search and
              the filters are the phone's drawer. */}
          {!phone && (
            <div className="mb-4 flex min-h-10 flex-wrap items-center gap-3">
              {selected.size > 0 ? (
                <>
                  <span className="text-[0.9375rem] text-ink">
                    <b className="font-semibold tabular-nums">
                      {count(selected.size)}
                    </b>{" "}
                    {selected.size === 1 ? "article" : "articles"} selected
                  </span>
                  <span aria-hidden className="text-faint">
                    ·
                  </span>
                  <Button
                    variant="quiet"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="primary"
                    className="ml-auto"
                    onClick={() =>
                      setChangePrice({
                        targets: items.filter((row) =>
                          selected.has(row.article_code)
                        ),
                      })
                    }
                  >
                    Change price
                  </Button>
                </>
              ) : (
                <>
                  <Segmented
                    options={[
                      { value: "article", label: "By article" },
                      { value: "store", label: "By store" },
                    ]}
                    value={by}
                    onChange={setBy}
                  />
                  <ListFilters
                    model={{
                      ...filters,
                      fields: counted.filter(
                        (one) => by === "article" || one.column !== "store"
                      ),
                    }}
                    search={{
                      value: typed,
                      onChange: (next) =>
                        next ? search.open(next) : search.close(),
                      label: "Search articles",
                    }}
                  />
                </>
              )}
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            <div
              aria-busy={prices.isPlaceholderData || undefined}
              className="list-swap flex min-h-0 min-w-0 flex-1 flex-col"
            >
              {queryState(prices, {
                loading: "Loading prices…",
                render: () =>
                  page === undefined ? null : (
                    <>
                      {page.shops.length === 0 && (
                        <Banner tone="warn" className="mb-4">
                          No store is registered yet.
                        </Banner>
                      )}

                      {receipt.length > 0 &&
                        (() => {
                          const named = (one: PublishReceipt) =>
                            bookNames.get(one.version) ?? "This price change"
                          const nowhere = receipt.filter(
                            (one) => one.delivered_to.length === 0
                          )
                          if (nowhere.length === 0) return null
                          return (
                            <Banner
                              tone="warn"
                              className="mb-4"
                              onDismiss={() => setReceipt([])}
                            >
                              {nowhere.length === receipt.length ? (
                                <>
                                  {receipt.map(named).join(", ")}{" "}
                                  {receipt.length === 1 ? "was" : "were"}{" "}
                                  published but reached no store.
                                </>
                              ) : (
                                <>
                                  {nowhere.map(named).join(" and ")} reached
                                  nobody.
                                </>
                              )}
                            </Banner>
                          )
                        })()}

                      {phone && (
                        <>
                          {page.shops.some(
                            (one) => one.pending_publication
                          ) && (
                            <Banner tone="warn" className="mb-4">
                              {count(
                                page.shops.filter(
                                  (one) => one.pending_publication
                                ).length
                              )}{" "}
                              of {count(page.shops.length)} stores have not
                              picked up the latest prices yet.
                            </Banner>
                          )}
                          {items.length > 0 && (
                            <Sentence>
                              <Fig>{count(shown.length)}</Fig> of{" "}
                              <Fig>{count(page.total)}</Fig> articles.
                            </Sentence>
                          )}
                        </>
                      )}

                      <Card className="flex flex-col overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                        {items.length === 0 ? (
                          needle === "" && filters.filters.length === 0 ? (
                            <EmptyState>No prices published yet.</EmptyState>
                          ) : (
                            <EmptyState
                              action={
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    search.close()
                                    filters.clear()
                                  }}
                                >
                                  Clear search and filters
                                </Button>
                              }
                            >
                              {needle === ""
                                ? "No articles match these filters."
                                : `No articles match “${needle}”.`}
                            </EmptyState>
                          )
                        ) : shown.length === 0 ? (
                          <EmptyState
                            action={
                              <Button
                                variant="ghost"
                                onClick={() => filters.clear()}
                              >
                                Show every article
                              </Button>
                            }
                          >
                            No articles match.
                          </EmptyState>
                        ) : phone ? (
                          <PhonePrices
                            views={shown}
                            shops={page.shops}
                            stockBySite={stockBySite}
                            divisionLabels={divisionLabels}
                            tagLabels={tagLabels}
                            onOpenArticle={(articleCode) =>
                              style.open(articleCode)
                            }
                            onChange={(row) =>
                              setChangePrice({ targets: [row] })
                            }
                            more={prices}
                          />
                        ) : by === "store" ? (
                          <PriceGrid
                            page={page}
                            views={shown}
                            ctx={priceCtx}
                            openCell={cell.value}
                            onOpenCell={(articleCode, siteId) =>
                              cell.open(cellKey(articleCode, siteId))
                            }
                            onOpenArticle={(articleCode) =>
                              style.open(articleCode)
                            }
                            onOpenShop={(siteId) => shop.open(siteId)}
                            selected={selected}
                            onToggleArticle={toggleArticle}
                            onSelectVisible={selectVisible}
                            stockBySite={stockBySite}
                            divisionLabels={divisionLabels}
                            tagLabels={tagLabels}
                            more={prices}
                          />
                        ) : (
                          <ArticleTable
                            page={page}
                            views={shown}
                            storeId={storeId}
                            onOpenArticle={(articleCode) =>
                              style.open(articleCode)
                            }
                            onOpenCell={(articleCode, siteId) =>
                              cell.open(cellKey(articleCode, siteId))
                            }
                            selected={selected}
                            onToggleArticle={toggleArticle}
                            onSelectVisible={selectVisible}
                            stockBySite={stockBySite}
                            divisionLabels={divisionLabels}
                            tagLabels={tagLabels}
                            more={prices}
                          />
                        )}

                        {items.length > 0 && !phone && (
                          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-hairline-2 px-4 py-3">
                            <span className="text-[0.9375rem] text-mute tabular-nums">
                              {count(shown.length)} of {count(page.total)}{" "}
                              articles
                            </span>
                          </div>
                        )}
                      </Card>
                    </>
                  ),
              })}
            </div>
          </div>

          {/* On a phone the search and the filter live in the drawer over the
              bottom bar, not at the top of the list. */}
          <DockTools
            search={{
              value: typed,
              onChange: (next) =>
                next ? search.replace(next) : search.close(),
              label: "Search articles",
            }}
            filter={{
              count: filters.filters.length,
              panel: {
                model: filters,
                filterModel: { ...filters, fields: counted },
              },
            }}
            status={tabStatus}
          />
        </>
      )}

      <StoreSheet
        siteId={shop.value ?? null}
        label={
          (page?.shops ?? []).find((one) => one.site_id === shop.value)
            ?.label ?? null
        }
        channel={CHANNEL}
        at={null}
        onClose={shop.close}
      />

      <ArticleSheet
        row={
          style.value === undefined
            ? null
            : ((page?.rows ?? []).find(
                (one) => one.article_code === style.value
              ) ?? null)
        }
        shops={page?.shops ?? []}
        promoWindows={promoWindows}
        onClose={style.close}
        // A store's line opens that store's price, not the change form: the
        // detail first, the change from its foot.
        onOpenCell={(siteId) => {
          if (style.value === undefined) return
          cell.swap("article", cellKey(style.value, siteId))
        }}
      />

      <CellSheet
        cell={open}
        channel={CHANNEL}
        at={null}
        bookNames={bookNames}
        shops={page?.shops ?? []}
        upcoming={upcoming.data ?? null}
        upcomingAt={upcomingFrom}
        row={
          open === null
            ? null
            : ((page?.rows ?? []).find(
                (one) => one.article_code === open.articleCode
              ) ?? null)
        }
        onClose={cell.close}
        onChangePrice={(preset) => {
          const row = (page?.rows ?? []).find(
            (one) => one.article_code === open?.articleCode
          )
          if (row === undefined) return
          cell.close()
          setChangePrice({
            targets: [row],
            presetSites: [preset.siteId],
            presetKind: preset.kind,
          })
        }}
      />

      <ChangePriceSheet
        key={openKey}
        open={changePrice !== null}
        targets={changePrice?.targets ?? []}
        shops={page?.shops ?? []}
        presetSites={changePrice?.presetSites}
        presetKind={changePrice?.presetKind}
        nextVersion={nextVersion}
        onClose={() => setChangePrice(null)}
        onPublished={(published) => {
          setReceipt(published)
          setSelected(new Set())
          setChangePrice(null)
        }}
      />
    </PageContent>
  )
}

/// The filter bar's fields, decorated with the server's own facet counts —
/// pulled out of the render body so the switch's removal does not leave this
/// screen re-computing it under a different name.
function useCountedFields(
  fields: readonly FilterField[],
  page: ArticlePrices | undefined,
  divisionTerms: readonly MasterTerm[] | undefined,
  tagTerms: readonly MasterTerm[] | undefined
): FilterField[] {
  return useMemo(() => {
    const names = (terms: readonly MasterTerm[] | undefined) =>
      new Map((terms ?? []).map((term) => [term.code, term.label]))
    const divisionNames = names(divisionTerms)
    const tagNames = names(tagTerms)
    const facets = page?.facets
    return fields.map((field) => {
      if (field.column === "store")
        return {
          ...field,
          spec: {
            ...field.spec,
            options: (page?.shops ?? []).map((one) => ({
              value: one.site_id,
              label: one.label ?? one.site_id,
            })),
          },
        }
      if (field.column === "division")
        return {
          ...field,
          spec: {
            ...field.spec,
            counted: facets?.divisions,
            format: (code: string) => divisionNames.get(code) ?? code,
          },
        }
      if (field.column === "tag")
        return {
          ...field,
          spec: {
            ...field.spec,
            counted: facets?.tags,
            format: (code: string) => tagNames.get(code) ?? code,
          },
        }
      return field
    })
  }, [fields, page?.facets, divisionTerms, tagTerms])
}

// ── the grid ───────────────────────────────────────────────────────────────

/// One group of SKUs that costs the same at every shop — the base price, every
/// shop's winning rule and (where known) the final price agree for every SKU
/// in it. Almost always every SKU of the article, in which case there is one
/// band and it says "All sizes".
interface Band {
  readonly skuCodes: readonly string[]
  readonly label: string
}

/// Every SKU code any rung on this row mentions. The base for the band split —
/// when nothing mentions one, the article has no real per-SKU breakdown
/// anywhere and there is exactly one band, whatever its size count says.
function skuUniverse(row: ArticlePriceRow): readonly string[] {
  const set = new Set<string>()
  for (const shop of row.shops)
    for (const rule of shop.stack)
      for (const point of rule.points)
        for (const code of point.sku_codes) set.add(code)
  return [...set]
}

/// The common size order this catalogue actually uses, so "S–L" reads in size
/// order rather than in string order (where "L" sorts before "S"). Anything
/// not on the list falls back to numeric, then plain string, order.
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"]
/// SKU code → size, filled once the page's products have been read.
const SKU_SIZE = new Map<string, string>()
/// Article code → its SKUs, from the same read — the rows under an opened
/// article.
interface SkuLine {
  readonly code: string
  readonly size: string | null
  readonly color: string | null
}
const ARTICLE_SKUS = new Map<string, SkuLine[]>()

function sizeRank(size: string | null): number {
  if (size === null) return 999
  const known = SIZE_ORDER.indexOf(size.toUpperCase())
  if (known >= 0) return known
  return /^\d+$/.test(size) ? 100 + Number(size) : 500
}

/// One line per SKU of an article, colour then size order. Falls back to the
/// codes the price rules mention while the product read is in flight.
function skusOf(row: ArticlePriceRow): readonly SkuLine[] {
  const known = ARTICLE_SKUS.get(row.article_code)
  const lines: SkuLine[] =
    known ??
    skuUniverse(row).map((code) => ({
      code,
      size: SKU_SIZE.get(code) ?? null,
      color: null,
    }))
  return lines
    .slice()
    .sort(
      (a, b) =>
        (a.color ?? "").localeCompare(b.color ?? "") ||
        sizeRank(a.size) - sizeRank(b.size) ||
        a.code.localeCompare(b.code)
    )
}
function sizeLabel(codes: readonly string[]): string {
  if (!codes.every((code) => SKU_SIZE.has(code)))
    return `${count(codes.length)} ${codes.length === 1 ? "SKU" : "SKUs"}`
  const suffixes = [...new Set(codes.map((code) => SKU_SIZE.get(code)!))]
  if (suffixes.length === 0)
    return `${count(codes.length)} ${codes.length === 1 ? "SKU" : "SKUs"}`
  const known = suffixes.every((one) => SIZE_ORDER.includes(one.toUpperCase()))
  const numeric = suffixes.every((one) => /^\d+$/.test(one))
  const sorted = suffixes
    .slice()
    .sort((a, b) =>
      known
        ? SIZE_ORDER.indexOf(a.toUpperCase()) -
          SIZE_ORDER.indexOf(b.toUpperCase())
        : numeric
          ? Number(a) - Number(b)
          : a.localeCompare(b)
    )
  if (sorted.length > 6)
    return `${count(codes.length)} ${codes.length === 1 ? "SKU" : "SKUs"}`
  return sorted.length > 2
    ? `${sorted[0]}–${sorted[sorted.length - 1]}`
    : sorted.join(", ")
}

/// The COMPANY_PRICE rung, from whichever shop happens to carry it — it is the
/// one rung meant to be the same everywhere, so any shop's copy of it answers
/// for the whole row.
function companyRuleOf(row: ArticlePriceRow): ArticlePriceRule | undefined {
  for (const shop of row.shops) {
    const found = shop.stack.find((rule) => rule.source === "COMPANY_PRICE")
    if (found !== undefined) return found
  }
  return undefined
}

/// Split one row's SKUs into bands. Two SKUs share a band when the base price,
/// every shop's pre-promotion price and (when the shop's final price is
/// uniform across the whole article) the final price all agree — which is
/// every SKU, almost always.
function bandsOf(
  row: ArticlePriceRow,
  shops: readonly PricelistShop[],
  companyRule: ArticlePriceRule | undefined
): readonly Band[] {
  const codes = skuUniverse(row)
  if (codes.length === 0) return [{ skuCodes: [], label: "All sizes" }]

  const signatureOf = (code: string) => {
    const parts: (number | string | null)[] = [amountFor(companyRule, code)]
    for (const shopMeta of shops) {
      const shop = row.shops.find((one) => one.site_id === shopMeta.site_id)
      const regular = regularRuleOf(shop, code)
      const markdown = markdownRuleOf(shop, code)
      const finalUniform =
        shop?.final_price != null && shop.final_price.distinct <= 1
          ? shop.final_price.min_unit_price_minor
          : null
      parts.push(
        amountFor(regular, code),
        regular?.source ?? null,
        amountFor(markdown, code),
        finalUniform
      )
    }
    return parts.join("|")
  }

  const groups = new Map<string, string[]>()
  for (const code of codes) {
    const key = signatureOf(code)
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [code])
    else list.push(code)
  }
  const list = [...groups.values()]
  if (list.length === 1) return [{ skuCodes: list[0], label: "All sizes" }]
  return list.map((skuCodes) => ({ skuCodes, label: sizeLabel(skuCodes) }))
}

/// What one band's cell actually says: the price, its kind, and the words that
/// go with it. The heavy lifting for the whole merged grid.
interface CellFacts {
  readonly kind: "base" | "store" | "markdown" | "promotion"
  readonly amountMinor: number
  /// The store's normal price for this band — its own price, else the base.
  readonly normalMinor: number
  readonly pct: string | null
  readonly label: string | null
  readonly dateLine: string | null
  readonly loser: { readonly label: string; readonly pct: string | null } | null
  /// The promotions that came off at least one SKU, by name — what the Next
  /// price looks up to know when they run out.
  readonly promotions: readonly string[]
}

function factsFor(
  row: ArticlePriceRow,
  band: Band,
  shopMeta: PricelistShop,
  companyRule: ArticlePriceRule | undefined,
  promoWindows: ReadonlyMap<string, string>
): CellFacts | null {
  const shop = row.shops.find((one) => one.site_id === shopMeta.site_id)
  if (shop === undefined || shop.stack.length === 0) return null
  const sku = band.skuCodes[0] ?? null

  const regularRule = regularRuleOf(shop, sku)
  const markdownRule = markdownRuleOf(shop, sku)
  // Per SKU: a markdown on this size wins, otherwise the size's regular price.
  const winnerRule = markdownRule ?? regularRule
  const baseMinor =
    companyRule === undefined ? null : amountFor(companyRule, sku)
  const regularMinor =
    regularRule === undefined ? baseMinor : amountFor(regularRule, sku)
  const markdownMinor =
    markdownRule === undefined ? null : amountFor(markdownRule, sku)
  const winnerMinor =
    winnerRule === undefined ? null : amountFor(winnerRule, sku)

  if (regularMinor === null && winnerMinor === null) return null

  const final = shop.final_price
  const promotions = final?.promotions ?? []
  let amountMinor: number
  if (final == null || final.distinct > 1)
    amountMinor = winnerMinor ?? regularMinor!
  else amountMinor = final.min_unit_price_minor

  if (baseMinor !== null && amountMinor === baseMinor)
    return {
      kind: "base",
      amountMinor,
      normalMinor: regularMinor ?? amountMinor,
      pct: null,
      label: null,
      dateLine: null,
      loser: null,
      promotions,
    }

  if (
    regularMinor !== null &&
    promotions.length > 0 &&
    amountMinor < regularMinor &&
    (markdownMinor === null || amountMinor <= markdownMinor)
  ) {
    const loser =
      markdownRule !== undefined &&
      markdownMinor !== null &&
      markdownMinor !== amountMinor
        ? { label: "Markdown", pct: pctVs(markdownMinor, regularMinor) }
        : null
    return {
      kind: "promotion",
      amountMinor,
      normalMinor: regularMinor,
      pct: pctVs(amountMinor, regularMinor),
      label: promotions.join(" · "),
      dateLine: promoWindows.get(promotions[0]) ?? null,
      loser,
      promotions,
    }
  }

  if (
    regularMinor !== null &&
    markdownRule !== undefined &&
    markdownMinor !== null &&
    amountMinor === markdownMinor
  ) {
    return {
      kind: "markdown",
      amountMinor,
      normalMinor: regularMinor,
      pct: pctVs(amountMinor, regularMinor),
      label: "Markdown",
      dateLine: shortSpan(
        markdownRule.effective_from,
        markdownRule.effective_to
      ),
      loser:
        promotions.length > 0
          ? { label: promotions.join(" · "), pct: null }
          : null,
      promotions,
    }
  }

  // The store's own price — not the base, and nothing further off it.
  return {
    kind: "store",
    amountMinor,
    normalMinor: amountMinor,
    pct: baseMinor === null ? null : pctVs(amountMinor, baseMinor),
    label: null,
    dateLine:
      regularRule?.effective_from !== undefined
        ? `from ${shortDay(regularRule.effective_from)}`
        : null,
    loser: null,
    promotions,
  }
}

// ── what a price becomes next ──────────────────────────────────────────────
//
// `factsFor` says what a price IS. The pricelist is also read for what it is
// about to be: a markdown that ends on Saturday, a promotion that runs out, a
// book that starts on the first. One function reads all three, so the tag
// ("Next price 1 Nov"), the Ends column and the Next price column of the same
// price cannot disagree.

/// A date from the server as the calendar day it falls on in the browser's own
/// time — the same reading `dayMonth` gives it — at midnight.
function calendarDay(value: string): Date | null {
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const at =
    plain === null
      ? new Date(value)
      : new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3]))
  if (Number.isNaN(at.getTime())) return null
  return new Date(at.getFullYear(), at.getMonth(), at.getDate())
}

/// The day after the last day of something — a rule's `effective_to` is the
/// last day it runs, both days included, so the price changes the day after.
function dayAfter(value: string): Date | null {
  const at = calendarDay(value)
  return at === null
    ? null
    : new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1)
}

function dayBefore(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() - 1)
}

/// A promotion's own run: its last day (none for an open-ended one) and what it
/// does to a price.
interface PromoRun {
  readonly to: string | null
  readonly effect: Effect | null
}

/// What a promotion makes of a regular price, where that is one number — a
/// percentage off, or a fixed unit price. The other effects (buy two get one,
/// an amount off the basket) price a basket and not a piece: `null`, and the
/// caller reads the regular price instead.
function priceUnder(effect: Effect | null, normalMinor: number): number | null {
  if (effect === null) return null
  if (effect.kind === "PERCENT")
    return Math.max(
      0,
      normalMinor - Math.round((normalMinor * effect.bps) / 10_000)
    )
  if (effect.kind === "FIXED_UNIT_PRICE") return effect.unit_price.minor
  return null
}

/// Whether a promotion is still running on a given day.
function runsOn(run: PromoRun, on: Date): boolean {
  if (run.to === null) return true
  const stops = dayAfter(run.to)
  return stops === null || stops.getTime() > on.getTime()
}

/// The next time one price changes: the first day of the new price, what it is
/// and what it comes from.
interface NextChange {
  readonly on: Date
  readonly amountMinor: number
  readonly pct: string | null
  readonly source: string
}

/// The book that has not started yet, with its page of prices by article.
interface Ahead {
  readonly on: Date
  readonly rows: ReadonlyMap<string, ArticlePriceRow>
}

/// Everything besides the row itself that a price's next change is read from.
interface PriceCtx {
  readonly windows: ReadonlyMap<string, string>
  readonly runs: ReadonlyMap<string, PromoRun>
  readonly ahead: Ahead | null
}

const NO_WINDOWS: ReadonlyMap<string, string> = new Map()

/// What a price falls back to when what is on top of it ends: the regular
/// price, said as what it is.
function regularFrom(
  on: Date,
  facts: CellFacts,
  baseMinor: number | null
): NextChange {
  const atBase = baseMinor === null || facts.normalMinor === baseMinor
  return {
    on,
    amountMinor: facts.normalMinor,
    pct: atBase ? null : pctVs(facts.normalMinor, baseMinor),
    source: baseMinor !== null && atBase ? "Base price" : "Store price",
  }
}

/// The earliest change coming to one price, or null when it stays as it is.
/// Three things move a price: its markdown running out (back to the regular
/// price, or to a promotion that still runs), its promotion running out (to a
/// markdown that still runs, else the regular price), and a published book
/// that has not started yet pricing the article differently.
function nextOf(
  row: ArticlePriceRow,
  band: Band,
  shopMeta: PricelistShop,
  companyRule: ArticlePriceRule | undefined,
  facts: CellFacts,
  ctx: PriceCtx
): NextChange | null {
  const shop = row.shops.find((one) => one.site_id === shopMeta.site_id)
  const sku = band.skuCodes[0] ?? null
  const baseMinor =
    companyRule === undefined ? null : amountFor(companyRule, sku)
  const found: NextChange[] = []

  if (facts.kind === "markdown") {
    const rule = markdownRuleOf(shop, sku)
    const on = rule?.effective_to ? dayAfter(rule.effective_to) : null
    if (on !== null) {
      const name = facts.promotions[0]
      const run = name === undefined ? undefined : ctx.runs.get(name)
      const promoted =
        run !== undefined && runsOn(run, on)
          ? priceUnder(run.effect, facts.normalMinor)
          : null
      found.push(
        promoted !== null && name !== undefined && promoted < facts.normalMinor
          ? {
              on,
              amountMinor: promoted,
              pct: pctVs(promoted, facts.normalMinor),
              source: name,
            }
          : regularFrom(on, facts, baseMinor)
      )
    }
  } else if (facts.kind === "promotion") {
    const name = facts.promotions[0]
    const run = name === undefined ? undefined : ctx.runs.get(name)
    const on = run?.to ? dayAfter(run.to) : null
    if (on !== null) {
      const rule = markdownRuleOf(shop, sku)
      const cut = rule === undefined ? null : amountFor(rule, sku)
      const alive =
        rule !== undefined &&
        (rule.effective_to === null ||
          (dayAfter(rule.effective_to)?.getTime() ?? 0) > on.getTime())
      found.push(
        alive && cut !== null && cut < facts.normalMinor
          ? {
              on,
              amountMinor: cut,
              pct: pctVs(cut, facts.normalMinor),
              source: "Markdown",
            }
          : regularFrom(on, facts, baseMinor)
      )
    }
  }

  // The next book, priced the way the till would price it that day. Its page
  // is read without the promotions, so a promotion now is compared by the
  // regular price underneath it.
  const later =
    ctx.ahead === null ? undefined : ctx.ahead.rows.get(row.article_code)
  if (ctx.ahead !== null && later !== undefined) {
    const then = factsFor(
      later,
      band,
      shopMeta,
      companyRuleOf(later),
      NO_WINDOWS
    )
    const now =
      facts.kind === "promotion" ? facts.normalMinor : facts.amountMinor
    if (then !== null && then.amountMinor !== now)
      found.push({
        on: ctx.ahead.on,
        amountMinor: then.amountMinor,
        pct: then.pct,
        source:
          then.kind === "markdown"
            ? "Markdown"
            : then.kind === "store"
              ? "Store price"
              : "Base price",
      })
  }

  return found.sort((a, b) => a.on.getTime() - b.on.getTime())[0] ?? null
}

/// Where a price comes from, in the words the sheets use.
function sourceOf(facts: CellFacts): string {
  switch (facts.kind) {
    case "promotion":
      return facts.label ?? "Promotion"
    case "markdown":
      return "Markdown"
    case "store":
      return "Store price"
    default:
      return "Base price"
  }
}

// ── one article, read once ─────────────────────────────────────────────────

/// One band of one article at one store: what it costs and what it becomes.
interface Piece {
  readonly facts: CellFacts | null
  readonly next: NextChange | null
}

function pieceOf(
  ctx: PriceCtx,
  row: ArticlePriceRow,
  band: Band,
  shopMeta: PricelistShop,
  companyRule: ArticlePriceRule | undefined
): Piece {
  const facts = factsFor(row, band, shopMeta, companyRule, ctx.windows)
  return {
    facts,
    next:
      facts === null
        ? null
        : nextOf(row, band, shopMeta, companyRule, facts, ctx),
  }
}

/// One article at one store, all its bands folded together — the unit a store
/// column and the By article table are drawn from.
interface Slot {
  readonly facts: CellFacts | null
  readonly next: NextChange | null
  /// How many different prices the size bands come to here. More than one:
  /// the cell says so and the article opens to its SKUs.
  readonly prices: number
  /// What two stores must share to be one group — kind, amount and next
  /// change. Empty when the store does not sell the article.
  readonly sig: string
}

/// A store that does not sell the article.
const NOT_SOLD: Slot = { facts: null, next: null, prices: 0, sig: "" }

function slotOf(pieces: readonly Piece[]): Slot {
  const sold = pieces.filter((one) => one.facts !== null)
  if (sold.length === 0) return NOT_SOLD
  const amounts = new Set(pieces.map((one) => one.facts?.amountMinor ?? null))
  if (amounts.size > 1)
    return {
      facts: sold[0].facts,
      next: null,
      prices: amounts.size,
      sig: `varies|${[...amounts].join(",")}`,
    }
  const facts = pieces[0].facts
  if (facts === null) return NOT_SOLD
  const next = pieces.reduce<NextChange | null>(
    (soonest, one) =>
      one.next !== null &&
      (soonest === null || one.next.on.getTime() < soonest.on.getTime())
        ? one.next
        : soonest,
    null
  )
  return {
    facts,
    next,
    prices: 1,
    sig: [
      facts.kind,
      facts.amountMinor,
      next?.on.getTime() ?? "",
      next?.amountMinor ?? "",
    ].join("|"),
  }
}

/// A loaded article, read once: its bands, and for each band at each store what
/// it costs and what it becomes. `grid` is `[band][store]`, `slots` `[store]`.
interface RowView {
  readonly row: ArticlePriceRow
  readonly companyRule: ArticlePriceRule | undefined
  readonly bands: readonly Band[]
  readonly grid: readonly (readonly Piece[])[]
  readonly slots: readonly Slot[]
}

function viewOf(
  row: ArticlePriceRow,
  shops: readonly PricelistShop[],
  ctx: PriceCtx
): RowView {
  const companyRule = companyRuleOf(row)
  const bands = bandsOf(row, shops, companyRule)
  const grid = bands.map((band) =>
    shops.map((shopMeta) => pieceOf(ctx, row, band, shopMeta, companyRule))
  )
  const slots = shops.map((_, index) =>
    slotOf(grid.map((pieces) => pieces[index]))
  )
  return { row, companyRule, bands, grid, slots }
}

/// "Only articles with": some store, in some band, charges that kind of price.
function carries(view: RowView, kinds: ReadonlySet<PriceKind>): boolean {
  return view.grid.some((pieces) =>
    pieces.some((piece) => {
      const kind = piece.facts?.kind
      return kind !== undefined && kind !== "base" && kinds.has(kind)
    })
  )
}

/// The group of stores that charge the same, largest first: the price "All
/// stores" shows. The first of equals wins, so the order is stable.
function mainOf(slots: readonly Slot[]): {
  readonly sig: string
  readonly slot: Slot | null
} {
  const tally = new Map<string, number>()
  for (const slot of slots)
    if (slot.sig !== "") tally.set(slot.sig, (tally.get(slot.sig) ?? 0) + 1)
  let sig = ""
  let most = 0
  for (const [one, size] of tally)
    if (size > most) {
      sig = one
      most = size
    }
  return {
    sig,
    slot: sig === "" ? null : (slots.find((slot) => slot.sig === sig) ?? null),
  }
}

/// A piece count for a group of stores, or null while no store's stock is known.
function totalStock(
  slots: readonly Slot[],
  stocks: readonly (number | null)[]
): number | null {
  let total = 0
  let any = false
  slots.forEach((slot, index) => {
    const stock = stocks[index]
    if (slot.sig !== "" && stock !== null) {
      total += stock
      any = true
    }
  })
  return any ? total : null
}

/// The whole article, for the stock of an article with no SKU breakdown.
const WHOLE: Band = { skuCodes: [], label: "" }

type StockMap = ReadonlyMap<
  string,
  {
    readonly bySku: ReadonlyMap<string, number>
    readonly byArticle: ReadonlyMap<string, number>
  }
>

/// Pieces on hand at one store for one band; null while it is not known (the
/// store's stock has not loaded, or it has no floor pool).
function stockOf(
  stock: StockMap,
  siteId: string,
  band: Band,
  row: ArticlePriceRow
): number | null {
  const at = stock.get(siteId)
  if (at === undefined) return null
  // No per-SKU breakdown anywhere for this article — the article total is the
  // whole answer, since there is only ever one band in that case.
  if (band.skuCodes.length === 0)
    return at.byArticle.get(row.article_code) ?? null
  let total = 0
  let any = false
  for (const code of band.skuCodes) {
    const qty = at.bySku.get(code)
    if (qty !== undefined) {
      total += qty
      any = true
    }
  }
  return any ? total : null
}

/// The figures above the list, counted over the articles loaded.
function figuresOf(
  views: readonly RowView[],
  shops: readonly PricelistShop[],
  stock: StockMap
) {
  const total = {
    promotion: 0,
    markdown: 0,
    store: 0,
    upcoming: 0,
    belowCost: 0,
    discounted: 0,
  }
  for (const view of views) {
    const cost = view.row.unit_cost_minor
    const has = {
      promotion: false,
      markdown: false,
      store: false,
      upcoming: false,
      belowCost: false,
    }
    view.grid.forEach((pieces, bandIndex) =>
      pieces.forEach((piece, shopIndex) => {
        const { facts } = piece
        if (facts === null) return
        if (facts.kind === "promotion") has.promotion = true
        if (facts.kind === "markdown") has.markdown = true
        if (facts.kind === "store") has.store = true
        if (piece.next !== null) has.upcoming = true
        if (cost != null && cost > 0 && facts.amountMinor < cost)
          has.belowCost = true
        if (facts.kind === "promotion" || facts.kind === "markdown")
          total.discounted +=
            stockOf(
              stock,
              shops[shopIndex].site_id,
              view.bands[bandIndex],
              view.row
            ) ?? 0
      })
    )
    if (has.promotion) total.promotion += 1
    if (has.markdown) total.markdown += 1
    if (has.store) total.store += 1
    if (has.upcoming) total.upcoming += 1
    if (has.belowCost) total.belowCost += 1
  }
  return total
}

// ── the small tags a price carries ─────────────────────────────────────────

type TagKind = "promo" | "markdown" | "below" | "changes"

interface PriceTag {
  readonly kind: TagKind
  readonly label: string
}

/// What is worth saying about a price besides the figure: where it comes from,
/// that it is a problem, that it is about to change.
function tagsOf(slot: Slot, costMinor: number | null | undefined): PriceTag[] {
  const { facts, next } = slot
  if (facts === null || slot.prices > 1) return []
  const found: PriceTag[] = []
  if (facts.kind === "promotion")
    found.push({ kind: "promo", label: "Promotion" })
  if (facts.kind === "markdown")
    found.push({ kind: "markdown", label: "Markdown" })
  if (costMinor != null && costMinor > 0 && facts.amountMinor < costMinor)
    found.push({ kind: "below", label: "Below cost" })
  if (next !== null)
    found.push({ kind: "changes", label: `Next price ${dayMonth(next.on)}` })
  return found
}

/// The same colours as words, for the pcs line of a desk cell.
const TAG_TEXT: Record<TagKind, string> = {
  promo: "text-[#0d7469]",
  markdown: "text-[#b2386a]",
  below: "text-[#c4271b]",
  changes: "text-[#2459c9]",
}

/// The pieces and, after them, what the price is — "4 pcs · Promotion" — on one
/// line: the tags as coloured words rather than chips, so a row with a promo
/// is as tall as one without (owner, 16 Oct).
function PiecesAndTags({
  stock,
  tags,
}: {
  stock: number | null
  tags: readonly PriceTag[]
}) {
  if (stock === null && tags.length === 0) return null
  return (
    <span className="mt-0.5 flex flex-wrap justify-end gap-x-1.5">
      {stock !== null && <Pieces stock={stock} />}
      {tags.map((tag, index) => (
        <span key={tag.kind} className="whitespace-nowrap">
          {(stock !== null || index > 0) && (
            <span className="mr-1.5 text-mute">·</span>
          )}
          <span className={TAG_TEXT[tag.kind]}>{tag.label}</span>
        </span>
      ))}
    </span>
  )
}

/// The only colour in the table lives here.
const TAG_TONE: Record<TagKind, string> = {
  promo: "bg-[#e3f3f0] text-[#0d7469]",
  markdown: "bg-[#fbe9f1] text-[#b2386a]",
  below: "bg-[#fdeceb] text-[#c4271b]",
  changes: "bg-[#eef3fd] text-[#2459c9]",
}

function PriceTags({
  tags,
  className,
}: {
  tags: readonly PriceTag[]
  className?: string
}) {
  if (tags.length === 0) return null
  return (
    <span
      className={cn(
        "mt-1.5 flex max-w-full flex-wrap justify-end gap-1",
        className
      )}
    >
      {tags.map((tag) => (
        <span
          key={tag.kind}
          className={cn(
            "inline-flex h-6 items-center rounded-[6px] px-[7px] text-[0.9375rem] font-medium whitespace-nowrap",
            TAG_TONE[tag.kind]
          )}
        >
          {tag.label}
        </span>
      ))}
    </span>
  )
}

/// A price and, after it in grey, how far it is from the regular one. Grey
/// when it is the price everything else is measured from; ink when it is not.
function Figure({
  amountMinor,
  pct,
  grey = false,
  faded = false,
}: {
  amountMinor: number
  pct: string | null
  grey?: boolean
  faded?: boolean
}) {
  return (
    <span className={cn("tabular-nums", faded && "opacity-[0.55]")}>
      <span className={grey ? "text-line-ico" : "text-ink"}>
        {money(amountMinor)}
      </span>
      {pct !== null && <span className="ml-1.5 text-mute">{pct}</span>}
    </span>
  )
}

/// Pieces, in the quiet colour; none at all in the quieter.
function Pieces({ stock }: { stock: number | null }) {
  if (stock === null) return null
  return (
    <span className={stock === 0 ? "text-line-ico" : "text-mute"}>
      {count(stock)} pcs
    </span>
  )
}

/// One price in the store matrix: the figure, the pieces behind it, and the
/// tags. "All stores" is the price most stores share; a store that charges the
/// same is grey and says no more; one that differs is ink and carries its tags.
function PriceCell({
  slot,
  mode,
  stock,
  costMinor,
  open,
  picked,
  rule,
  onOpen,
  onHover,
}: {
  slot: Slot
  mode: "all" | "same" | "differs"
  stock: number | null
  costMinor: number | null | undefined
  open: boolean
  picked: boolean
  /// The border colour under the cell.
  rule: string
  onOpen: () => void
  onHover?: (element: HTMLElement | null) => void
}) {
  const facts = slot.facts
  if (facts === null) return null
  const zero = stock === 0
  const grey = mode === "same" || (mode === "all" && facts.kind === "base")
  const sticky = mode === "all"
  return (
    <td
      className={cn(
        "border-b p-0 align-top",
        rule,
        sticky && "sticky left-[22.5rem] z-20 border-r",
        picked ? "bg-accent-bg" : sticky && "bg-canvas",
        open ? "bg-soft-2" : "hover:bg-soft"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        onMouseEnter={
          onHover === undefined
            ? undefined
            : (event) => onHover(event.currentTarget)
        }
        onMouseLeave={onHover === undefined ? undefined : () => onHover(null)}
        aria-label={
          slot.prices > 1
            ? `${count(slot.prices)} prices`
            : `${money(facts.amountMinor)} · ${sourceOf(facts)}`
        }
        className="flex w-full flex-col items-end px-3.5 py-3.5 text-right"
      >
        {slot.prices > 1 ? (
          <span className="text-mute">{count(slot.prices)} prices</span>
        ) : (
          <Figure
            amountMinor={facts.amountMinor}
            pct={mode === "same" ? null : facts.pct}
            grey={grey}
            faded={zero}
          />
        )}
        <PiecesAndTags
          stock={stock}
          tags={mode === "same" ? [] : tagsOf(slot, costMinor)}
        />
      </button>
    </td>
  )
}

/// The division and the tags, apart — the desk's Article cell gives each its
/// own line (owner, 16 Oct: name / id · division / tags).
function articleKind(
  row: ArticlePriceRow,
  divisionLabels: ReadonlyMap<string, string>,
  tagLabels: ReadonlyMap<string, string>
): { division: string | null; tags: string } {
  return {
    division:
      row.division_code === null
        ? null
        : (divisionLabels.get(row.division_code) ?? row.division_code),
    tags: row.tags.map((code) => tagLabels.get(code) ?? code).join(", "),
  }
}

/// "Division · tag, tag" — what kind of article it is, in the words the master
/// uses.
function articleLine(
  row: ArticlePriceRow,
  divisionLabels: ReadonlyMap<string, string>,
  tagLabels: ReadonlyMap<string, string>
): string {
  const division =
    row.division_code === null
      ? null
      : (divisionLabels.get(row.division_code) ?? row.division_code)
  const tags = row.tags.map((code) => tagLabels.get(code) ?? code)
  return [division, tags.length > 0 ? tags.join(", ") : null]
    .filter((one): one is string => one !== null)
    .join(" · ")
}

/// A column heading of either table: it stays at the top as the rows scroll.
const HEAD =
  "sticky top-0 z-20 border-b border-hairline-2 bg-canvas px-3.5 py-3 text-left text-cell font-normal text-body"

/// By store: one row per article, "All stores" for the price most stores share
/// and a column for every store, each showing whether it follows it.
function PriceGrid({
  page,
  views,
  ctx,
  openCell,
  onOpenCell,
  onOpenArticle,
  onOpenShop,
  selected,
  onToggleArticle,
  onSelectVisible,
  stockBySite,
  divisionLabels,
  tagLabels,
  more,
}: {
  page: ArticlePrices
  views: readonly RowView[]
  ctx: PriceCtx
  openCell: string | undefined
  onOpenCell: (articleCode: string, siteId: string) => void
  onOpenArticle: (articleCode: string) => void
  onOpenShop: (siteId: string) => void
  selected: ReadonlySet<string>
  onToggleArticle: (articleCode: string) => void
  onSelectVisible: (on: boolean) => void
  stockBySite: StockMap
  divisionLabels: ReadonlyMap<string, string>
  tagLabels: ReadonlyMap<string, string>
  more: Pageable
}) {
  const shops = page.shops
  const allOn =
    views.length > 0 &&
    views.every((view) => selected.has(view.row.article_code))
  const someOn = views.some((view) => selected.has(view.row.article_code))
  /// The cell under the pointer, and where it is on screen — the hover card
  /// is drawn fixed so the grid's own scrolling box cannot clip it.
  const [hover, setHover] = useState<HoverInfo | null>(null)
  /// Articles opened to their SKU lines.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggleExpanded = (code: string) =>
    setExpanded((was) => {
      const next = new Set(was)
      if (!next.delete(code)) next.add(code)
      return next
    })

  /// The price cells of one line: the article's, or one of its SKUs'.
  const lineCells = (
    view: RowView,
    slots: readonly Slot[],
    band: Band | null,
    picked: boolean,
    rule: string
  ) => {
    const { row } = view
    const stocks = shops.map((shopMeta) =>
      stockOf(stockBySite, shopMeta.site_id, band ?? WHOLE, row)
    )
    const { sig, slot: main } = mainOf(slots)
    return (
      <>
        {main === null ? (
          <td
            className={cn(
              "sticky left-[22.5rem] z-20 border-r border-b px-3.5 py-3.5 text-right align-top text-line-ico",
              rule,
              picked ? "bg-accent-bg" : "bg-canvas"
            )}
          >
            Not sold
          </td>
        ) : (
          <PriceCell
            slot={main}
            mode="all"
            stock={totalStock(slots, stocks)}
            costMinor={row.unit_cost_minor}
            open={false}
            picked={picked}
            rule={rule}
            onOpen={() =>
              main.prices > 1
                ? toggleExpanded(row.article_code)
                : onOpenArticle(row.article_code)
            }
          />
        )}
        {shops.map((shopMeta, index) => {
          const slot = slots[index]
          if (slot.facts === null)
            return (
              <td
                key={shopMeta.site_id}
                className={cn(
                  "border-b px-3.5 py-3.5 text-right align-top text-line-ico",
                  rule
                )}
              >
                Not sold
              </td>
            )
          return (
            <PriceCell
              key={shopMeta.site_id}
              slot={slot}
              mode={slot.sig === sig ? "same" : "differs"}
              stock={stocks[index]}
              costMinor={row.unit_cost_minor}
              open={
                band === null &&
                openCell === cellKey(row.article_code, shopMeta.site_id)
              }
              picked={picked}
              rule={rule}
              onOpen={() => {
                setHover(null)
                if (slot.prices > 1) toggleExpanded(row.article_code)
                else onOpenCell(row.article_code, shopMeta.site_id)
              }}
              onHover={(element) =>
                setHover(
                  element === null || slot.facts === null || slot.prices > 1
                    ? null
                    : {
                        rect: element.getBoundingClientRect(),
                        article: row.article_name ?? row.article_code,
                        store: shopMeta.label ?? shopMeta.site_id,
                        sizes: band?.label ?? null,
                        baseMinor: amountFor(
                          view.companyRule,
                          band?.skuCodes[0] ?? null
                        ),
                        facts: slot.facts,
                        stock: stocks[index],
                        waiting: shopMeta.pending_publication?.name ?? null,
                      }
                )
              }
            />
          )
        })}
      </>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-separate border-spacing-0 text-cell">
        <colgroup>
          <col className="w-12" />
          <col className="w-[19.5rem]" />
          <col className="w-[14rem]" />
          {shops.map((shopMeta) => (
            <col key={shopMeta.site_id} className="w-[10rem]" />
          ))}
        </colgroup>

        <thead>
          <tr>
            <th scope="col" className={cn(HEAD, "left-0 z-30")}>
              <Checkbox
                checked={allOn}
                indeterminate={someOn && !allOn}
                onChange={onSelectVisible}
                label={
                  <span className="sr-only">
                    {allOn
                      ? "Clear the selection"
                      : "Select every loaded article"}
                  </span>
                }
              />
            </th>
            <th scope="col" className={cn(HEAD, "left-12 z-30")}>
              Article
            </th>
            <th
              scope="col"
              className={cn(HEAD, "left-[22.5rem] z-30 border-r text-right")}
            >
              Most stores
            </th>
            {shops.map((shopMeta) => (
              <th
                key={shopMeta.site_id}
                scope="col"
                className={cn(HEAD, "truncate text-right align-top")}
              >
                <button
                  type="button"
                  onClick={() => onOpenShop(shopMeta.site_id)}
                  className="rounded-inner text-right underline-offset-2 hover:underline focus:bg-soft focus-visible:outline-none"
                >
                  {shopMeta.label ?? shopMeta.site_id}
                </button>
                {/* The grid shows what head office published; a till that has
                    not picked it up yet still charges the older book. Said
                    on the column, not on every cell: it is the store that is
                    behind, not the price. */}
                {shopMeta.pending_publication && (
                  <span
                    className="mt-0.5 flex items-center justify-end gap-1.5 text-[0.9375rem] text-warn-fg"
                    title={`${shopMeta.pending_publication.name} — published ${ago(shopMeta.pending_publication.published_at)}, not yet at the POS`}
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-warn" />
                    Behind
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {views.flatMap((view) => {
            const { row } = view
            const code = row.article_code
            const name = row.article_name ?? code
            const picked = selected.has(code)
            const skus = skusOf(row)
            const opened = expanded.has(code)
            const rule = opened ? "border-hairline" : "border-hairline-strong"
            const ground = picked ? "bg-accent-bg" : "bg-canvas"
            return [
              <tr key={code}>
                <td
                  className={cn(
                    "sticky left-0 z-20 border-b px-3.5 py-3.5 align-top",
                    rule,
                    ground
                  )}
                >
                  <span className="flex h-11 items-center">
                    <Checkbox
                      checked={picked}
                      onChange={() => onToggleArticle(code)}
                      label={<span className="sr-only">Select {name}</span>}
                    />
                  </span>
                </td>
                <th
                  scope="row"
                  className={cn(
                    "sticky left-12 z-20 max-w-0 border-b p-0 text-left align-top font-normal",
                    rule,
                    ground
                  )}
                >
                  <ArticleCell
                    row={row}
                    {...articleKind(row, divisionLabels, tagLabels)}
                    expand={{
                      can: skus.length > 1,
                      opened,
                      onToggle: () => toggleExpanded(code),
                    }}
                    onOpen={() => onOpenArticle(code)}
                  />
                </th>
                {lineCells(view, view.slots, null, picked, rule)}
              </tr>,
              ...(opened
                ? skus.map((sku, index) => {
                    const band: Band = {
                      skuCodes: [sku.code],
                      label: skuLabel(sku),
                    }
                    const slots = shops.map((shopMeta) =>
                      slotOf([
                        pieceOf(ctx, row, band, shopMeta, view.companyRule),
                      ])
                    )
                    const lineRule =
                      index === skus.length - 1
                        ? "border-hairline-strong"
                        : "border-hairline"
                    return (
                      <tr key={`${code}:${sku.code}`}>
                        <td
                          className={cn(
                            "sticky left-0 z-20 border-b bg-canvas",
                            lineRule
                          )}
                        />
                        <th
                          scope="row"
                          className={cn(
                            "sticky left-12 z-20 max-w-0 border-b bg-canvas py-3.5 pr-3.5 pl-[6.25rem] text-left align-top font-normal",
                            lineRule
                          )}
                        >
                          <span className="block truncate text-ink">
                            {skuLabel(sku)}
                          </span>
                          <span className="block truncate font-mono text-id text-mute">
                            {skuText(sku.code)}
                          </span>
                        </th>
                        {lineCells(view, slots, band, false, lineRule)}
                      </tr>
                    )
                  })
                : []),
            ]
          })}
        </tbody>
      </table>
      <LoadMore query={more} className="py-3" />
      {hover !== null && <HoverCard info={hover} />}
    </div>
  )
}

/// The pricelist on a phone: a card per article, in place of a grid of shops
/// that is wider than the glass.
///
/// A card says what the first columns of the grid say — the article, what it
/// costs at most stores, how many pieces there are — and the tags that say
/// where that price comes from or that it is about to change. Which store
/// charges what is one tap on the card away (the article's sheet, which lists
/// every store), and Change opens the same price sheet the grid's cells do.
/// Nothing here is a second reading of the prices: it draws the same view the
/// grid draws.
function PhonePrices({
  views,
  shops,
  stockBySite,
  divisionLabels,
  tagLabels,
  onOpenArticle,
  onChange,
  more,
}: {
  views: readonly RowView[]
  shops: readonly PricelistShop[]
  stockBySite: StockMap
  divisionLabels: ReadonlyMap<string, string>
  tagLabels: ReadonlyMap<string, string>
  onOpenArticle: (articleCode: string) => void
  onChange: (row: ArticlePriceRow) => void
  more: Pageable
}) {
  return (
    <div className="min-h-0">
      <ul className="flex flex-col gap-2.5">
        {views.map((view) => {
          const { row } = view
          const name = row.article_name ?? row.article_code
          const { slot: main } = mainOf(view.slots)
          // The one price the card leads with; none when the sizes disagree.
          const figure =
            main !== null && main.facts !== null && main.prices <= 1
              ? main.facts
              : null
          const total = totalStock(
            view.slots,
            shops.map((shopMeta) =>
              stockOf(stockBySite, shopMeta.site_id, WHOLE, row)
            )
          )
          const cost = row.unit_cost_minor
          const markup =
            figure === null ? null : markupBps(figure.amountMinor, cost)
          return (
            <PhoneCard
              key={row.article_code}
              onOpen={() => onOpenArticle(row.article_code)}
              head={
                <div className="flex items-start gap-3">
                  <Thumbnail
                    url={row.image_url}
                    name={name}
                    division={row.division_code}
                    className="size-12 shrink-0 rounded-inner"
                  />
                  <CardName
                    name={name}
                    code={`${row.article_code} · ${count(row.sku_count)} ${row.sku_count === 1 ? "SKU" : "SKUs"}`}
                    line={articleLine(row, divisionLabels, tagLabels)}
                  />
                </div>
              }
              lead={
                <CardFigure
                  value={
                    main === null
                      ? "—"
                      : figure === null
                        ? `${count(main.prices)} prices`
                        : money(figure.amountMinor)
                  }
                  caption={figure === null ? undefined : sourceOf(figure)}
                  tone={figure === null ? "quiet" : undefined}
                />
              }
              foot={
                <CardFoot>
                  {total !== null && (
                    <span className="block">{count(total)} pcs</span>
                  )}
                  {cost != null && cost > 0 && (
                    <span className="block">
                      Cost {money(cost)}
                      {markup !== null && ` · Markup ${percentBps(markup)}`}
                    </span>
                  )}
                  {main !== null && (
                    <PriceTags
                      tags={tagsOf(main, cost)}
                      className="justify-start"
                    />
                  )}
                </CardFoot>
              }
              action={
                <Button
                  variant="tint"
                  size="card"
                  aria-label={`Change the price of ${name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onChange(row)
                  }}
                >
                  Change
                </Button>
              }
            />
          )
        })}
      </ul>
      <LoadMore query={more} className="py-3" />
    </div>
  )
}

interface HoverInfo {
  readonly rect: DOMRect
  readonly article: string
  readonly store: string
  readonly sizes: string | null
  readonly baseMinor: number | null
  readonly facts: CellFacts
  readonly stock: number | null
  readonly waiting: string | null
}

/// What a cell's price is made of, on hover: base, the store's own price, the
/// markdown or promotion on top with its dates, and anything not charged yet.
/// Clicking the cell is the way to change it.
function HoverCard({ info }: { info: HoverInfo }) {
  const { facts } = info
  const width = 288
  const left = Math.min(
    Math.max(8, info.rect.right - width),
    window.innerWidth - width - 8
  )
  const below = info.rect.bottom + 6
  const top = below + 220 > window.innerHeight ? info.rect.top - 6 : below
  const lift = below + 220 > window.innerHeight
  const line = (
    label: React.ReactNode,
    value: React.ReactNode,
    strong = false
  ) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className={strong ? "font-medium text-ink" : "text-body"}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          strong ? "font-semibold text-ink" : "text-text"
        )}
      >
        {value}
      </span>
    </div>
  )
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 flex flex-col gap-2 rounded-card bg-canvas p-4 text-[0.9375rem] shadow-pop ring-1 ring-hairline"
      style={{
        left,
        top,
        width,
        transform: lift ? "translateY(-100%)" : undefined,
      }}
    >
      <div className="mb-0.5">
        <div className="font-medium text-ink">{info.article}</div>
        <div className="text-mute">
          {info.store}
          {info.sizes !== null ? ` · sizes ${info.sizes}` : ""}
        </div>
      </div>
      {info.baseMinor !== null && line("Base price", money(info.baseMinor))}
      {info.baseMinor !== null &&
        facts.normalMinor !== info.baseMinor &&
        line("Store price", money(facts.normalMinor))}
      {(facts.kind === "markdown" || facts.kind === "promotion") && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-body">
            {facts.label} {facts.pct}
            {facts.dateLine !== null && (
              <span className="block text-mute">{facts.dateLine}</span>
            )}
          </span>
          <span className="text-text tabular-nums">
            {money(facts.amountMinor)}
          </span>
        </div>
      )}
      {facts.loser !== null && (
        <div className="text-mute line-through decoration-faint">
          {facts.loser.label} {facts.loser.pct ?? ""}
        </div>
      )}
      <div className="mt-0.5 border-t border-hairline pt-1.5">
        {line("Price now", money(facts.amountMinor), true)}
      </div>
      {info.stock !== null && line("Stock", count(info.stock))}
      {info.waiting !== null && (
        <div className="text-warn-fg">
          {info.store} is behind · {info.waiting}
        </div>
      )}
    </div>
  )
}

/// The frozen left-hand square: what the style IS — its photograph, its name
/// and code, and what kind of article it is. The checkbox that adds it to a
/// batch price change has a column of its own.
function ArticleCell({
  row,
  division,
  tags,
  expand,
  onOpen,
}: {
  row: ArticlePriceRow
  division: string | null
  /// "tag, tag" — its own third line.
  tags: string
  /// The chevron that opens the article to its SKU lines; left out where the
  /// table has no lines to open.
  expand?: { can: boolean; opened: boolean; onToggle: () => void }
  onOpen: () => void
}) {
  const name = row.article_name ?? row.article_code
  return (
    <span className="flex items-start gap-3 py-3.5 pr-3.5 pl-2">
      {expand !== undefined &&
        (expand.can ? (
          <button
            type="button"
            onClick={expand.onToggle}
            aria-expanded={expand.opened}
            aria-label={`${expand.opened ? "Hide" : "Show"} the SKUs of ${name}`}
            className="mt-3 grid size-6 shrink-0 place-items-center rounded-inner text-mute hover:bg-soft hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <ChevronRight
              className={cn(
                "size-4 transition-transform duration-150",
                expand.opened && "rotate-90"
              )}
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        ))}
      <Thumbnail
        url={row.image_url}
        name={name}
        division={row.division_code}
        className="size-12 shrink-0 rounded-[8px]"
      />
      <button
        type="button"
        onClick={onOpen}
        title={`Compare ${name} across every store`}
        className="group/name min-w-0 flex-1 rounded-inner text-left focus:bg-soft focus-visible:outline-none"
      >
        {/* Three lines, one font (owner, 16 Oct): the name; the article id and
            division; the tags. */}
        <span className="block truncate font-medium text-ink group-hover/name:underline group-hover/name:underline-offset-2">
          {row.article_name ?? "—"}
        </span>
        <span className="mt-0.5 block truncate text-mute tabular-nums">
          {row.article_code}
          {division !== null && ` · ${division}`}
        </span>
        {tags !== "" && (
          <span className="mt-0.5 block truncate text-mute">{tags}</span>
        )}
      </button>
    </span>
  )
}

/// "M / Black" — the SKU's size and colour, else its code.
function skuLabel(sku: SkuLine): string {
  const parts = [sku.size, sku.color].filter((one): one is string => !!one)
  return parts.length === 0 ? skuText(sku.code) : parts.join(" · ")
}

// ── By article ─────────────────────────────────────────────────────────────

const CELL = "px-3.5 py-3.5 align-top"

/// What it costs now and where that comes from.
function NowCell({ slot }: { slot: Slot }) {
  const { facts } = slot
  return (
    <td className={cn(CELL, "text-right")}>
      {facts === null ? (
        <span className="text-line-ico">Not sold here</span>
      ) : slot.prices > 1 ? (
        <span className="text-mute">{count(slot.prices)} prices</span>
      ) : (
        <>
          <Figure
            amountMinor={facts.amountMinor}
            pct={facts.pct}
            grey={facts.kind === "base"}
          />
          <span className="block text-mute">{sourceOf(facts)}</span>
        </>
      )}
    </td>
  )
}

/// The last day of the price it costs now.
function EndsCell({ slot }: { slot: Slot }) {
  return (
    <td className={CELL}>
      {slot.next === null ? (
        <span className="text-line-ico">—</span>
      ) : (
        dayMonth(dayBefore(slot.next.on))
      )}
    </td>
  )
}

/// What it costs after that, and what that comes from.
function NextCell({ slot }: { slot: Slot }) {
  const { next } = slot
  return (
    <td className={cn(CELL, "text-right")}>
      {next === null ? (
        <span className="text-line-ico">—</span>
      ) : (
        <>
          <Figure
            amountMinor={next.amountMinor}
            pct={next.pct}
            grey={next.source === "Base price"}
          />
          <span className="block text-mute">{next.source}</span>
        </>
      )}
    </td>
  )
}

function StockCell({ stock }: { stock: number | null }) {
  return (
    <td className={cn(CELL, "text-right tabular-nums")}>
      {stock === null ? null : (
        <span className={stock === 0 ? "text-line-ico" : "text-ink"}>
          {count(stock)}
        </span>
      )}
    </td>
  )
}

/// A click on a row that did not land on one of its own controls.
function onRow(open: () => void) {
  return (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, a, label, input")) return
    open()
  }
}

/// By article: one line per article for what it costs now, until when, and what
/// it costs next — and which stores differ, opened under it. With one store
/// chosen the same columns read that store alone.
function ArticleTable({
  page,
  views,
  storeId,
  onOpenArticle,
  onOpenCell,
  selected,
  onToggleArticle,
  onSelectVisible,
  stockBySite,
  divisionLabels,
  tagLabels,
  more,
}: {
  page: ArticlePrices
  views: readonly RowView[]
  /// The one store being read, or "" for every store.
  storeId: string
  onOpenArticle: (articleCode: string) => void
  onOpenCell: (articleCode: string, siteId: string) => void
  selected: ReadonlySet<string>
  onToggleArticle: (articleCode: string) => void
  onSelectVisible: (on: boolean) => void
  stockBySite: StockMap
  divisionLabels: ReadonlyMap<string, string>
  tagLabels: ReadonlyMap<string, string>
  more: Pageable
}) {
  const shops = page.shops
  const oneIndex = shops.findIndex((one) => one.site_id === storeId)
  const byStore = oneIndex >= 0
  const allOn =
    views.length > 0 &&
    views.every((view) => selected.has(view.row.article_code))
  const someOn = views.some((view) => selected.has(view.row.article_code))
  /// Articles whose differing stores are opened under them.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (code: string) =>
    setOpened((was) => {
      const next = new Set(was)
      if (!next.delete(code)) next.add(code)
      return next
    })
  const nameOf = (index: number) => shops[index].label ?? shops[index].site_id

  return (
    <div className="overflow-x-auto">
      {/* The article keeps at least 18rem; past that the table scrolls
          sideways rather than squeezing names letter by letter. */}
      <table className="w-full min-w-[62rem] table-fixed border-separate border-spacing-0 text-cell">
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-[11rem]" />
          <col className="w-[6rem]" />
          <col className="w-[9rem]" />
          <col className="w-[5.5rem]" />
          {!byStore && <col className="w-[9rem]" />}
        </colgroup>

        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              <Checkbox
                checked={allOn}
                indeterminate={someOn && !allOn}
                onChange={onSelectVisible}
                label={
                  <span className="sr-only">
                    {allOn
                      ? "Clear the selection"
                      : "Select every loaded article"}
                  </span>
                }
              />
            </th>
            <th scope="col" className={HEAD}>
              Article
            </th>
            <th scope="col" className={cn(HEAD, "text-right")}>
              Price now
            </th>
            <th scope="col" className={HEAD}>
              Ends
            </th>
            <th scope="col" className={cn(HEAD, "text-right")}>
              Next price
            </th>
            <th scope="col" className={cn(HEAD, "text-right")}>
              Stock
            </th>
            {!byStore && (
              <th scope="col" className={HEAD}>
                Store exceptions
              </th>
            )}
          </tr>
        </thead>

        <tbody>
          {views.flatMap((view) => {
            const { row } = view
            const code = row.article_code
            const name = row.article_name ?? code
            const picked = selected.has(code)
            const stocks = shops.map((shopMeta) =>
              stockOf(stockBySite, shopMeta.site_id, WHOLE, row)
            )
            const ground = picked ? "bg-accent-bg" : "hover:bg-soft"
            const box = (
              <td className={CELL}>
                <span className="flex h-11 items-center">
                  <Checkbox
                    checked={picked}
                    onChange={() => onToggleArticle(code)}
                    label={<span className="sr-only">Select {name}</span>}
                  />
                </span>
              </td>
            )
            const article = (
              <td className="p-0 align-top">
                <ArticleCell
                  row={row}
                  {...articleKind(row, divisionLabels, tagLabels)}
                  onOpen={() => onOpenArticle(code)}
                />
              </td>
            )

            // One store: that store's values and nothing else.
            if (byStore) {
              const slot = view.slots[oneIndex]
              return [
                <tr
                  key={code}
                  onClick={onRow(() =>
                    onOpenCell(code, shops[oneIndex].site_id)
                  )}
                  className={cn(
                    "cursor-pointer [&>td]:border-b [&>td]:border-hairline-strong",
                    ground
                  )}
                >
                  {box}
                  {article}
                  <NowCell slot={slot} />
                  <EndsCell slot={slot} />
                  <NextCell slot={slot} />
                  <StockCell stock={stocks[oneIndex]} />
                </tr>,
              ]
            }

            const { sig, slot: main } = mainOf(view.slots)
            const differ = view.slots
              .map((slot, index) => ({ slot, index }))
              .filter(
                (entry) => entry.slot.sig !== "" && entry.slot.sig !== sig
              )
            const away = view.slots
              .map((slot, index) => ({ slot, index }))
              .filter((entry) => entry.slot.sig === "")
            const open = opened.has(code)
            const names = (list: readonly { readonly index: number }[]) =>
              list.length <= 2
                ? list.map((entry) => nameOf(entry.index)).join(", ")
                : `${count(list.length)} stores`
            const lead = main ?? view.slots[0] ?? NOT_SOLD
            return [
              <tr
                key={code}
                onClick={onRow(() => onOpenArticle(code))}
                className={cn(
                  "cursor-pointer [&>td]:border-b [&>td]:border-hairline-strong",
                  ground,
                  open && "[&>td]:border-hairline"
                )}
              >
                {box}
                {article}
                <NowCell slot={lead} />
                <EndsCell slot={lead} />
                <NextCell slot={lead} />
                <StockCell stock={totalStock(view.slots, stocks)} />
                <td className={CELL}>
                  {differ.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => toggle(code)}
                      aria-expanded={open}
                      className="inline-flex items-center gap-1 text-left text-ink hover:text-accent"
                    >
                      Different at {names(differ)}
                      <ChevronRight
                        className={cn(
                          "size-4 shrink-0 transition-transform duration-150",
                          open && "rotate-90"
                        )}
                      />
                    </button>
                  ) : (
                    <span className="text-mute">
                      {away.length > 0 ? `Not at ${names(away)}` : "All stores"}
                    </span>
                  )}
                </td>
              </tr>,
              ...(open
                ? differ.map(({ slot, index }) => (
                    <tr
                      key={`${code}@${shops[index].site_id}`}
                      onClick={onRow(() =>
                        onOpenCell(code, shops[index].site_id)
                      )}
                      className="cursor-pointer hover:bg-soft [&>td]:border-b [&>td]:border-hairline"
                    >
                      <td className={CELL} />
                      <td className={cn(CELL, "pl-12 text-ink")}>
                        {nameOf(index)}
                      </td>
                      <NowCell slot={slot} />
                      <EndsCell slot={slot} />
                      <NextCell slot={slot} />
                      <StockCell stock={stocks[index]} />
                      <td className={CELL} />
                    </tr>
                  ))
                : []),
            ]
          })}
        </tbody>
      </table>
      <LoadMore query={more} className="py-3" />
    </div>
  )
}

// ── the drill-down ─────────────────────────────────────────────────────────

/// One cell, opened: what the till takes for it, why the shelf price is what
/// it is, how it got there, and which stores have it in service.
function CellSheet({
  cell,
  row,
  channel,
  at,
  bookNames,
  shops,
  upcoming,
  upcomingAt,
  onClose,
  onChangePrice,
}: {
  cell: { articleCode: string; siteId: string } | null
  row: ArticlePriceRow | null
  channel: CommercialChannel
  at: string | null
  bookNames: ReadonlyMap<number, string>
  /// Every column of the matrix — the "Upcoming" section reads a shop's
  /// `pending_publication`, which lives here and not on `ArticlePriceShop`.
  shops: readonly PricelistShop[]
  /// The same capped answer the grid's "falling to" markers used to read —
  /// now read only here, for the one cell somebody actually opened.
  upcoming: ArticlePrices | null
  upcomingAt: string | null
  onClose: () => void
  onChangePrice: (preset: {
    siteId: string
    kind: "price" | "markdown"
  }) => void
}) {
  const scope: PriceScope = useMemo(
    () => ({
      siteId: cell?.siteId ?? "",
      channel,
      at: at ?? undefined,
    }),
    [cell?.siteId, channel, at]
  )

  const shopRow =
    cell === null || row === null
      ? undefined
      : row.shops.find((one) => one.site_id === cell.siteId)
  const top = winner(shopRow)
  /// Who a rung was written for, with a store's name rather than its code.
  const placeOf = (level: PriceLevel): string => {
    if (level.level !== "SITE") return describeLevel(level)
    const siteId = level.site_id
    return shops.find((one) => one.site_id === siteId)?.label ?? siteId
  }
  const shopMeta =
    cell === null ? undefined : shops.find((one) => one.site_id === cell.siteId)

  const laterRow = upcoming?.rows.find(
    (one) => one.article_code === cell?.articleCode
  )
  const laterShop = laterRow?.shops.find((one) => one.site_id === cell?.siteId)
  const laterTop = winner(laterShop)
  const laterDiffers =
    laterTop !== undefined &&
    (top === undefined ||
      laterTop.min_unit_price_minor !== top.min_unit_price_minor)

  const products = useQuery({
    queryKey: commercialKeys.prices(scope),
    queryFn: ({ signal }) => shelfPrices(scope, signal),
    enabled: cell !== null && scope.siteId !== "",
  })

  const lines = useMemo(
    () =>
      (products.data?.items ?? []).filter(
        (item) => item.article_code === cell?.articleCode
      ),
    [products.data, cell?.articleCode]
  )

  return (
    <Sheet
      open={cell !== null}
      onOpenChange={(open) => !open && onClose()}
      id={cell?.articleCode}
      title={row?.article_name ?? "Price"}
      footer={
        cell === null ? null : (
          <SheetFooter
            primary={{
              label: "Change price",
              onClick: () =>
                onChangePrice({
                  siteId: cell.siteId,
                  kind: top?.source === "MARKDOWN" ? "markdown" : "price",
                }),
            }}
          />
        )
      }
    >
      {cell === null ? null : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Store">{shopRow?.label ?? cell.siteId}</Fact>
            <Fact term="SKUs">{count(row?.sku_count)}</Fact>
            <Fact term="Shelf price">
              {top === undefined ? "—" : amounts(top)}
            </Fact>
            <Fact term="Comes from">
              {top === undefined
                ? "—"
                : `${describeSource(top.source)} · ${bookNames.get(top.publication_version) ?? `v${top.publication_version}`}`}
            </Fact>
          </Facts>

          {shopRow === undefined || shopRow.stack.length === 0 ? (
            <Quiet>This store does not sell this article.</Quiet>
          ) : (
            <>
              <div>
                <SubHead>At the POS</SubHead>
                {queryState(products, {
                  loading: "Loading…",
                  render: () =>
                    lines.length === 0 ? (
                      <Quiet>No SKU to price here.</Quiet>
                    ) : (
                      <TillCheck
                        skuCodes={lines.map((line) => line.sku_code)}
                        siteId={cell.siteId}
                        channel={channel}
                        costMinor={row?.unit_cost_minor ?? null}
                      />
                    ),
                })}
              </div>

              <div>
                <SubHead>Why this price</SubHead>
                <MiniTable
                  head={[
                    "Comes from",
                    { label: "Stores", align: "left" },
                    "SKUs",
                    "Price",
                  ]}
                >
                  {shopRow.stack.flatMap((rule, index) =>
                    pointsOf(rule).map((point, within) => (
                      <MiniRow
                        key={`${rule.source}-${rule.publication_version}-${index}-${point.unit_price_minor}`}
                      >
                        <MiniCell className="py-3.5">
                          {within === 0 && (
                            <>
                              <span
                                className={
                                  index === 0 ? "text-ink" : "text-mute"
                                }
                              >
                                {describeSource(rule.source)}
                              </span>
                              <span className="block text-[0.9375rem] text-mute">
                                {bookNames.get(rule.publication_version) ?? "—"}
                              </span>
                            </>
                          )}
                        </MiniCell>
                        <MiniCell className="py-3.5">
                          {within === 0 && (
                            <span
                              className={
                                index === 0
                                  ? "text-[0.9375rem] text-body"
                                  : "text-[0.9375rem] text-mute"
                              }
                            >
                              {placeOf(rule.applies_to)}
                            </span>
                          )}
                        </MiniCell>
                        <MiniCell align="right" className="py-3.5">
                          <span
                            className={index === 0 ? "text-text" : "text-mute"}
                          >
                            {count(point.in_force_for)} of{" "}
                            {count(rule.sku_count)}
                          </span>
                        </MiniCell>
                        <MiniCell align="right" className="py-3.5">
                          <span
                            className={
                              index === 0 ? "font-medium text-ink" : "text-mute"
                            }
                          >
                            {money(point.unit_price_minor)}
                          </span>
                        </MiniCell>
                      </MiniRow>
                    ))
                  )}
                </MiniTable>
              </div>

              {(shopMeta?.pending_publication !== null &&
                shopMeta !== undefined) ||
              laterDiffers ? (
                <div>
                  <SubHead>Next price</SubHead>
                  <div className="flex flex-col gap-3">
                    {shopMeta?.pending_publication != null && (
                      <p className="text-[0.9375rem] text-body">
                        {shopMeta.label ?? cell.siteId} is behind ·{" "}
                        {shopMeta.pending_publication.name} · from{" "}
                        {day(shopMeta.pending_publication.effective_from)}
                      </p>
                    )}
                    {laterDiffers && upcomingAt !== null && (
                      <p className="text-[0.9375rem] text-body">
                        {day(upcomingAt)} · {amounts(laterTop!)}
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </>
          )}

          {lines.length > 0 && (
            <PriceHistorySection
              skuCode={lines[0].sku_code}
              siteId={cell.siteId}
              channel={channel}
              skuCount={lines.length}
            />
          )}

          {top !== undefined && (
            <InService version={top.publication_version} shops={shops} />
          )}
        </div>
      )}
    </Sheet>
  )
}

/// How many SKUs of one article "At the till" prices. Each is a basket of its
/// own, asked twice (walk-in and member), so this is a count of requests — an
/// article with more SKUs than this is priced on the first few and says so.
const TILL_CAP = 8

/// Offers that matched this article and still did not come off.
///
/// Only the reasons the engine decides AFTER it has matched the basket. It
/// gates every promotion on its window, its stores, its audience and its
/// coupon first, so "members only" is said of a promotion on trousers as
/// readily as of one on this shirt — listing those would bury the few that
/// are about this article under every promotion the business runs.
const NEAR_MISSES: ReadonlySet<string> = new Set([
  "QUANTITY_TOO_LOW",
  "AMOUNT_TOO_LOW",
  "ADVISORY_ONLY",
  "MARKDOWN_EXCLUDED",
  "OUTBID_BY_BETTER_OFFER",
  "DISPLACED_BY_EXCLUSIVE_RULE",
])

/// The member "At the till" prices for. `CustomerScope::Members` asks only
/// that a customer is named, so a placeholder answers "what does a member
/// pay" without borrowing a real member — whose own usage would make the
/// answer theirs rather than the shelf's.
const MEMBER_PREVIEW = "price-check-member"

/// One SKU's two answers.
interface TillAnswer {
  readonly skuCode: string
  readonly walkIn: SimulateResult
  readonly member: SimulateResult
}

/// What a receipt prints, as one string: SKUs whose receipts would read the
/// same share one, which is every SKU of most articles.
function receiptKey(answer: TillAnswer): string {
  const side = (result: SimulateResult) =>
    [
      result.lines[0]?.base_unit_price_minor,
      result.lines[0]?.unit_price_minor,
      result.amount_due_minor,
      ...result.applied_rules.map(
        (rule) => `${rule.rule_id}:${rule.benefit_minor}`
      ),
      ...result.free_lines.map((free) => `${free.sku_code}:${free.quantity}`),
    ].join("|")
  return `${side(answer.walkIn)}/${side(answer.member)}`
}

/// What one piece of this article costs at the till — the pricelist, the sale
/// price, every promotion and campaign — for a walk-in shopper and a member.
///
/// Asked of the engine a till runs (`/commercial/simulate`), one SKU per
/// basket of one: a basket holding every size at once would be a multi-buy
/// and trip offers nobody buying one shirt gets.
function TillCheck({
  skuCodes,
  siteId,
  channel,
  costMinor,
}: {
  skuCodes: readonly string[]
  siteId: string
  channel: CommercialChannel
  costMinor: number | null
}) {
  const priced = skuCodes.slice(0, TILL_CAP)
  const asked = useQueries({
    queries: priced.flatMap((skuCode) =>
      [false, true].map((member) => ({
        queryKey: commercialKeys.tillCheck(siteId, channel, skuCode, member),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          simulate(
            {
              site_id: siteId,
              channel,
              lines: [{ sku_code: skuCode, quantity: 1 }],
              customer_id: member ? MEMBER_PREVIEW : null,
            },
            signal
          ),
      }))
    ),
  })

  const campaigns = useQuery({
    queryKey: commercialKeys.campaigns(),
    queryFn: ({ signal }) => campaignCatalogue(signal),
  })
  const campaignName = useMemo(() => {
    const map = new Map<string, string>()
    for (const one of campaigns.data ?? [])
      map.set(one.campaign.campaign_id, one.campaign.name)
    return map
  }, [campaigns.data])

  if (asked.some((query) => query.isPending)) return <Quiet>Loading…</Quiet>

  const answers: TillAnswer[] = []
  const failed: string[] = []
  priced.forEach((skuCode, index) => {
    const walkIn = asked[index * 2]
    const member = asked[index * 2 + 1]
    if (walkIn.data !== undefined && member.data !== undefined)
      answers.push({ skuCode, walkIn: walkIn.data, member: member.data })
    else {
      const error = walkIn.error ?? member.error
      failed.push(error instanceof Error ? error.message : "no answer")
    }
  })

  if (answers.length === 0)
    return <Quiet>No price available{failed[0] ? `: ${failed[0]}` : ""}.</Quiet>

  const groups: { skuCodes: string[]; answer: TillAnswer }[] = []
  const byKey = new Map<string, { skuCodes: string[]; answer: TillAnswer }>()
  for (const answer of answers) {
    const key = receiptKey(answer)
    const held = byKey.get(key)
    if (held !== undefined) held.skuCodes.push(answer.skuCode)
    else {
      const group = { skuCodes: [answer.skuCode], answer }
      byKey.set(key, group)
      groups.push(group)
    }
  }

  const misses = new Map<string, RejectedRule>()
  for (const answer of answers)
    for (const rule of answer.walkIn.rejected_rules)
      if (NEAR_MISSES.has(rule.reason) && !misses.has(rule.rule_id))
        misses.set(rule.rule_id, rule)

  const named = (rule: AppliedRule) => {
    const campaign =
      rule.campaign_id === null ? undefined : campaignName.get(rule.campaign_id)
    return campaign === undefined || campaign === rule.name
      ? rule.name
      : `${rule.name} · ${campaign}`
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <Receipt
          key={group.skuCodes.join(",")}
          // Named only when the SKUs disagree. One receipt for every SKU is
          // the common case, and a heading saying so would be noise.
          label={groups.length > 1 ? group.skuCodes.join(", ") : null}
          answer={group.answer}
          costMinor={costMinor}
          named={named}
        />
      ))}

      {failed.length > 0 && (
        <p className="text-[0.9375rem] text-warn-fg">
          {count(failed.length)} SKU{failed.length === 1 ? "" : "s"} could not
          be priced: {failed[0]}
        </p>
      )}

      {misses.size > 0 && (
        <div>
          <p className="mb-2 text-[0.9375rem] text-body">Not applied</p>
          {[...misses.values()].map((rule) => (
            <div
              key={rule.rule_id}
              className="flex items-baseline justify-between gap-3 border-t border-hairline py-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-ink">{rule.name}</span>
                <span className="block text-[0.9375rem] text-mute">
                  {rule.explanation.charAt(0).toUpperCase() +
                    rule.explanation.slice(1)}
                </span>
              </span>
              {rule.would_have_saved_minor !== null && (
                <span className="shrink-0 text-[0.9375rem] text-mute tabular-nums">
                  saves {money(rule.would_have_saved_minor)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {skuCodes.length > TILL_CAP && (
        <p className="text-[0.9375rem] text-mute">
          First {count(TILL_CAP)} of {count(skuCodes.length)} SKUs
        </p>
      )}
    </div>
  )
}

/// One receipt: the pricelist, the sale price, what each promotion took off,
/// and what a walk-in shopper and a member pay.
function Receipt({
  label,
  answer,
  costMinor,
  named,
}: {
  label: string | null
  answer: TillAnswer
  costMinor: number | null
  named: (rule: AppliedRule) => string
}) {
  const walkIn = answer.walkIn
  const member = answer.member
  const line = walkIn.lines[0]
  const memberOnly = member.applied_rules.filter(
    (rule) => !walkIn.applied_rules.some((one) => one.rule_id === rule.rule_id)
  )
  /// Tax the book adds on top. Nought for a tax-inclusive book, which is the
  /// usual case; drawn only when it is not.
  const taxOnTop = walkIn.amount_due_minor - walkIn.total_minor
  const markup = markupBps(walkIn.total_minor, costMinor)
  return (
    <div>
      {label !== null && (
        <p className="mb-2 truncate font-mono text-id text-mute">{label}</p>
      )}
      <dl className="flex flex-col">
        <ReceiptRow
          term="Base price"
          amount={money(line?.base_unit_price_minor ?? null)}
        />
        {line !== undefined &&
          line.unit_price_minor < line.base_unit_price_minor && (
            <ReceiptRow
              term="Markdown price"
              amount={money(line.unit_price_minor)}
            />
          )}
        {walkIn.applied_rules.map((rule) => (
          <ReceiptRow
            key={rule.rule_id}
            term={named(rule)}
            amount={money(-rule.benefit_minor)}
          />
        ))}
        {walkIn.free_lines.map((free) => (
          <ReceiptRow
            key={`${free.sku_code}-${free.granted_by_rule_id}`}
            term={`Free ${skuText(free.sku_code)} × ${count(free.quantity)}`}
            amount={money(free.value_minor)}
          />
        ))}
        {taxOnTop !== 0 && (
          <ReceiptRow term="Tax on top" amount={money(taxOnTop)} />
        )}
        <ReceiptRow
          term="Non-member pays"
          note={markup === null ? undefined : `${percentBps(markup)} markup`}
          amount={money(walkIn.amount_due_minor)}
          strong
        />
        <ReceiptRow
          term="Member pays"
          note={
            memberOnly.length === 0
              ? undefined
              : memberOnly.map(named).join(", ")
          }
          amount={money(member.amount_due_minor)}
          strong
        />
      </dl>
    </div>
  )
}

function ReceiptRow({
  term,
  note,
  amount,
  strong = false,
}: {
  term: string
  note?: string
  amount: string
  strong?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 border-t py-3 first:border-t-0",
        strong ? "border-hairline-strong" : "border-hairline"
      )}
    >
      <dt className="min-w-0">
        <span
          className={cn(
            "block truncate",
            strong ? "font-medium text-ink" : "text-body"
          )}
        >
          {term}
        </span>
        {note !== undefined && (
          <span className="block truncate text-[0.9375rem] text-mute">
            {note}
          </span>
        )}
      </dt>
      <dd
        className={cn(
          "shrink-0 tabular-nums",
          strong ? "font-medium text-ink" : "text-body"
        )}
      >
        {amount}
      </dd>
    </div>
  )
}

/// Which shops have actually put the book this price came from into service.
///
/// "Published" and "in force" are different things, and this is the difference
/// — the reason the fleet screen existed and the reason it did not need to be a
/// screen. The gap between the shop's clock (`activated_at`) and the centre's
/// (`reported_at`) is the number to watch: a shop that switched an hour before
/// the centre heard is priced correctly and reporting late, which is a
/// different fault from a shop that never switched at all.
function InService({
  version,
  shops,
}: {
  version: number
  shops: readonly PricelistShop[]
}) {
  const books = useQuery({
    queryKey: commercialKeys.books(),
    queryFn: ({ signal }) => listPriceBooks(signal),
  })

  const book = (books.data ?? []).find((one) => one.version === version)

  const detail = useQuery({
    queryKey: commercialKeys.book(book?.id ?? ""),
    queryFn: ({ signal }) => priceBookDetail(book!.id, signal),
    enabled: book !== undefined,
  })

  if (book === undefined) return null

  return (
    <div>
      <SubHead aside={book.name}>At the stores</SubHead>
      {detail.data === undefined ? (
        <Quiet>Loading…</Quiet>
      ) : detail.data.activated_by.length === 0 ? (
        <Quiet>Not applied at any store yet.</Quiet>
      ) : (
        <MiniTable
          head={["Store", { label: "Applied", align: "left" }, "Rules loaded"]}
        >
          {detail.data.activated_by.map((activation) => (
            <MiniRow key={activation.origin_id}>
              <MiniCell className="py-3.5">
                <Named
                  name={
                    activation.site_id === null
                      ? "Unsited"
                      : (shops.find((one) => one.site_id === activation.site_id)
                          ?.label ?? activation.site_id)
                  }
                  code={activation.origin_id}
                />
              </MiniCell>
              <MiniCell className="py-3.5">
                <span className="text-[0.9375rem] text-body">
                  {moment(activation.activated_at)}
                </span>
                <span className="block text-[0.9375rem] text-mute">
                  told us {moment(activation.reported_at)}
                </span>
              </MiniCell>
              <MiniCell align="right" className="py-3.5">
                {count(activation.price_rule_count)}
              </MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
      )}
    </div>
  )
}

/// Every price this store has charged for one SKU, oldest first.
///
/// # Why one SKU and not the article
///
/// A history is a question about a thing with a price, and a style does not
/// have one — it has as many as it has sizes and colourways, which may have
/// moved on different days for different reasons. Showing the first product and
/// naming it is honest; averaging them would invent a price that was never on a
/// shelf edge.
///
/// # Why the book and the person are on every row
///
/// "The price went up on the third" is a fact somebody already has — they are
/// looking at this screen because of it. "Ramadan Pricing v21, published by
/// Andi on the second" is the answer, and it is the difference between a chart
/// and something a person can act on.
function PriceHistorySection({
  skuCode,
  siteId,
  channel,
  skuCount,
}: {
  skuCode: string
  siteId: string
  channel: CommercialChannel
  skuCount: number
}) {
  const nameOf = useNameOfLogin()
  const history = useQuery({
    queryKey: priceHistoryKeys.of(skuCode, siteId, channel),
    queryFn: ({ signal }) => priceHistory(skuCode, siteId, channel, signal),
  })

  const periods = history.data?.periods ?? []

  return (
    <div>
      <SubHead
        aside={skuCount > 1 ? `${skuCode}, 1 of ${count(skuCount)}` : skuCode}
      >
        How it got here
      </SubHead>
      {queryState(history, {
        loading: "Loading…",
        render: (data) =>
          data.never_priced || periods.length === 0 ? (
            <Quiet>No history.</Quiet>
          ) : periods.length === 1 ? (
            <Quiet>Not changed since it was set.</Quiet>
          ) : (
            <MiniTable
              head={[
                "Dates",
                { label: "Comes from", align: "left" },
                "Difference",
                "Price",
              ]}
            >
              {periods.map((period) => (
                <MiniRow key={`${period.from}-${period.publication_version}`}>
                  <MiniCell className="py-3.5">
                    <span className="text-ink">{day(period.from)}</span>
                    <span className="block text-[0.9375rem] text-mute">
                      {period.until === null
                        ? "still in force"
                        : `until ${day(period.until)}`}
                    </span>
                  </MiniCell>
                  <MiniCell className="py-3.5">
                    <span className="text-ink">
                      {describeSource(period.source)}
                    </span>
                    <span className="block text-[0.9375rem] text-mute">
                      {period.publication_name ??
                        `v${period.publication_version}`}
                      {period.published_by !== null &&
                        ` · ${nameOf(period.published_by)}`}
                    </span>
                  </MiniCell>
                  <MiniCell align="right" className="py-3.5 tabular-nums">
                    {/* The first period has nothing to have moved from, and
                        drawing it as a rise from nought would report a price
                        being set as a price going up. */}
                    {period.change_minor === null ? (
                      <span className="text-mute">—</span>
                    ) : (
                      <span
                        className={
                          period.change_minor < 0 ? "text-ok" : "text-warn"
                        }
                      >
                        {period.change_minor > 0 ? "+" : ""}
                        {money(period.change_minor)}
                      </span>
                    )}
                  </MiniCell>
                  <MiniCell
                    align="right"
                    className="py-3.5 text-ink tabular-nums"
                  >
                    {money(period.unit_price_minor)}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          ),
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------

/// One style, priced at every shop — UI-001 §4's second drill-down.
///
/// **No fetch.** Every figure here is already on the row the grid drew: the
/// matrix asked for the whole cascade at every shop and this reads the same
/// answer down a column instead of across a row. Asking the server again would
/// be a second opinion about a question already answered, and two opinions
/// about one price is the failure this module exists to end.
///
/// ## Regular and Markdown are read off the stack, never recomputed
///
/// The stack arrives in the engine's own order — rank 0 is what the till
/// charges. **Regular** is the best-ranked candidate that is not a markdown;
/// **Markdown** is the markdown rung when there is one. So a shop with a
/// clearance shows both and the difference between them is visible, and a shop
/// without one shows the same number in the price column and nothing beside it.
/// Deriving "regular" by undoing a percentage would be inventing a figure no
/// book contains.
///
/// A shop absent from `shops` is not priced here, and says so. It is NOT shown
/// as zero and not filled in from the company price — §3's last row again.
function ArticleSheet({
  row,
  shops,
  promoWindows,
  onClose,
  onOpenCell,
}: {
  row: ArticlePriceRow | null
  /// Every column of the grid, so a store that does not sell it still says so.
  shops: readonly PricelistShop[]
  promoWindows: ReadonlyMap<string, string>
  onClose: () => void
  onOpenCell: (siteId: string) => void
}) {
  const companyRule = row === null ? undefined : companyRuleOf(row)
  const bands = row === null ? [] : bandsOf(row, shops, companyRule)
  return (
    <Sheet
      open={row !== null}
      onOpenChange={(next) => !next && onClose()}
      id={row?.article_code}
      title={row?.article_name ?? "Article"}
      width="wide"
    >
      {row === null ? null : (
        <div className="flex flex-col gap-8">
          {bands.map((band) => {
            const baseMinor =
              companyRule === undefined
                ? null
                : amountFor(companyRule, band.skuCodes[0] ?? null)
            return (
              <div key={band.skuCodes.join(",") || "all"}>
                <SubHead
                  aside={
                    baseMinor === null
                      ? undefined
                      : `Base price ${money(baseMinor)}`
                  }
                >
                  {bands.length === 1 ? "All stores" : `Sizes ${band.label}`}
                </SubHead>
                <MiniTable
                  head={[
                    "Store",
                    { label: "Price now", align: "right" },
                    "Comes from",
                    "Dates",
                  ]}
                >
                  {shops.map((shopMeta) => {
                    const facts = factsFor(
                      row,
                      band,
                      shopMeta,
                      companyRule,
                      promoWindows
                    )
                    const name = shopMeta.label ?? shopMeta.site_id
                    if (facts === null)
                      return (
                        <MiniRow key={shopMeta.site_id}>
                          <MiniCell className="py-3.5">{name}</MiniCell>
                          <MiniCell align="right" className="py-3.5">
                            <span className="text-faint">Not sold</span>
                          </MiniCell>
                          <MiniCell className="py-3.5">{null}</MiniCell>
                          <MiniCell className="py-3.5">{null}</MiniCell>
                        </MiniRow>
                      )
                    return (
                      <MiniRow key={shopMeta.site_id}>
                        <MiniCell className="py-3.5">
                          <button
                            type="button"
                            onClick={() => onOpenCell(shopMeta.site_id)}
                            title="Open the price at this store"
                            className="text-left text-ink underline-offset-2 hover:underline"
                          >
                            {name}
                          </button>
                        </MiniCell>
                        <MiniCell align="right" className="py-3.5">
                          <span className="inline-flex items-center gap-1.5">
                            <Figure
                              amountMinor={facts.amountMinor}
                              pct={facts.pct}
                              grey={facts.kind === "base"}
                            />
                          </span>
                        </MiniCell>
                        <MiniCell className="py-3.5">
                          <span className="text-[0.9375rem] text-body">
                            {facts.kind === "base"
                              ? "Base price"
                              : facts.kind === "store"
                                ? "Store price"
                                : facts.label}
                          </span>
                          {facts.loser !== null && (
                            <span className="block text-[0.9375rem] text-mute line-through decoration-faint">
                              {facts.loser.label}
                              {facts.loser.pct !== null
                                ? ` ${facts.loser.pct}`
                                : ""}
                            </span>
                          )}
                        </MiniCell>
                        <MiniCell className="py-3.5">
                          <span className="text-[0.9375rem] text-mute">
                            {facts.dateLine ?? ""}
                          </span>
                        </MiniCell>
                      </MiniRow>
                    )
                  })}
                </MiniTable>
              </div>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

/// One shop's whole shelf — UI-001 §4's first drill-down.
///
/// **This one does fetch**, and it is the only drill-down that has to. The
/// matrix holds a page of styles; this question is about a SHOP, and answering
/// it from the loaded page would report "Toko Medan prices twenty styles"
/// because twenty is how many the grid happened to have. `/commercial/offers`
/// is the same read the shop's own till makes, which is why the answer here and
/// the answer at the counter cannot drift.
///
/// ## Grouped back into styles, because the column heading is a style column
///
/// The endpoint answers in products; §4 asks for `Article | Regular | Markdown
/// | Harga sebelum promo`. So the SKUs are folded per article and each figure
/// becomes a range when the sizes disagree — never a representative SKU, which
/// §4 forbids by name.
///
/// **Promotions is absent from the columns**, and that is a gap rather than a
/// decision: a promotion is a statement about a basket, `/commercial/offers`
/// carries none, and inventing a column that is empty on every row would say
/// this shop runs no offers when what is true is that this read cannot see
/// them. The cell explanation next door does show them.
function StoreSheet({
  siteId,
  label,
  channel,
  at,
  onClose,
}: {
  siteId: string | null
  label: string | null
  channel: CommercialChannel
  at: string | null
  onClose: () => void
}) {
  const scope: PriceScope = useMemo(
    () => ({ siteId: siteId ?? "", channel, at: at ?? undefined }),
    [siteId, channel, at]
  )

  const shelf = useQuery({
    queryKey: commercialKeys.prices(scope),
    queryFn: ({ signal }) => shelfPrices(scope, signal),
    enabled: siteId !== null,
  })

  const styles = useMemo(() => {
    const by = new Map<
      string,
      {
        code: string
        name: string
        charged: number[]
        regular: number[]
        markdowns: number
        skus: number
      }
    >()
    for (const item of shelf.data?.items ?? []) {
      const held = by.get(item.article_code) ?? {
        code: item.article_code,
        name: item.article_name,
        charged: [],
        regular: [],
        markdowns: 0,
        skus: 0,
      }
      held.charged.push(item.unit_price_minor)
      held.regular.push(item.base_unit_price_minor)
      if (item.markdown_id !== null) held.markdowns += 1
      held.skus += 1
      by.set(item.article_code, held)
    }
    return [...by.values()].sort((a, b) => a.code.localeCompare(b.code))
  }, [shelf.data])

  /// A set of amounts as one figure, or as the range it actually is.
  ///
  /// Never a representative SKU — §2: "tidak memilih representative SKU
  /// sebagai harga Article". Two sizes at different prices is a fact about the
  /// style, and picking one of them to print is how a shelf edge comes to
  /// disagree with the till for half the sizes on the rail.
  const span = (amounts: readonly number[]): string => {
    if (amounts.length === 0) return "—"
    const low = Math.min(...amounts)
    const high = Math.max(...amounts)
    return low === high ? money(low) : `${money(low)} – ${money(high)}`
  }

  return (
    <Sheet
      open={siteId !== null}
      onOpenChange={(next) => !next && onClose()}
      id={siteId ?? undefined}
      title={label ?? siteId ?? "Store"}
      // Five hundred styles by four columns. This is a table with a sheet
      // around it.
      width="table"
    >
      {queryState(shelf, {
        loading: "Loading…",
        render: (data) =>
          data.items.length === 0 ? (
            <EmptyState>No prices in service.</EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              <div>
                <SubHead
                  aside={`${count(data.item_count)} SKUs · ${count(styles.length)} articles`}
                >
                  On the shelf
                </SubHead>
                <MiniTable
                  head={[
                    "Article",
                    { label: "Base price", align: "right" },
                    { label: "On markdown", align: "right" },
                    { label: "Shelf price", align: "right" },
                  ]}
                >
                  {styles.map((style) => (
                    <MiniRow key={style.code}>
                      <MiniCell className="py-3.5">
                        <span className="block truncate text-ink">
                          {style.name}
                        </span>
                        <span className="block truncate font-mono text-[0.9375rem] text-mute">
                          {style.code} · {count(style.skus)} SKU
                        </span>
                      </MiniCell>
                      <MiniCell align="right" className="py-3.5">
                        <span className="text-body tabular-nums">
                          {span(style.regular)}
                        </span>
                      </MiniCell>
                      <MiniCell align="right" className="py-3.5">
                        {/* The markdown column says how many PRODUCTS are cut,
                            not an amount: a style where two sizes are cleared
                            and four are not has no single markdown price, and
                            printing the cut one would claim the rail is on
                            sale. The amount is in the charged column, which is
                            where the till's number belongs. */}
                        {style.markdowns === 0 ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <span className="text-accent tabular-nums">
                            {count(style.markdowns)} of {count(style.skus)}
                          </span>
                        )}
                      </MiniCell>
                      <MiniCell align="right" className="py-3.5">
                        <span className="font-medium text-ink tabular-nums">
                          {span(style.charged)}
                        </span>
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              </div>
            </div>
          ),
      })}
    </Sheet>
  )
}
