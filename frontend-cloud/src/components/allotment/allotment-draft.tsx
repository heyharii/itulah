import { AppShell, ScreenHeader } from "@/components/app-shell"
import {
  FilterSheet,
  PurchaseOrderSheet,
} from "@/components/allotment/allotment-filters"
import {
  activeFilterCount,
  NO_FILTERS,
  type AllotmentFilters,
} from "@/lib/allotment-filters"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AvailabilityItem, CreateAllotmentLine } from "@/lib/allotments"
import {
  availability,
  createAllotment,
  sourcePoolsFor,
  spread,
} from "@/lib/allotments"
import { useIdentity } from "@/lib/identity"
import { units } from "@/lib/money"
import { listPools, sitesOf } from "@/lib/pools"
import { listPurchaseOrders } from "@/lib/purchase-orders"
import { cn } from "@/lib/utils"
import { useVocabulary } from "@/lib/vocabulary"
import { ApiError } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { ChevronRight, ListFilter, Receipt, Search, X } from "lucide-react"
import { Fragment, useMemo, useRef, useState } from "react"

/// How wide the three columns that never scroll are. Named here because the
/// sticky offsets are the running total of the ones to their left, and a
/// number typed twice is a column that drifts out from under its header.
const ARTICLE_WIDTH = 260
const STOCK_WIDTH = 68
const TOTAL_WIDTH = 68

/// One article, with its SKUs and what the pool holds of them.
interface ArticleRow {
  readonly id: string
  readonly name: string
  readonly image: string | null
  readonly division: string | null
  readonly tags: readonly string[]
  readonly orders: readonly string[]
  readonly skus: readonly AvailabilityItem[]
  readonly on_hand: number
  readonly stock: number
}

/// The DC warehouse is where goods bound for a store come out of. It is not a
/// choice on this screen: every other DC pool is either goods already spoken
/// for or goods not yet identified, and a store allotment out of one of those
/// is refused by the server anyway.
const WAREHOUSE_POOL_CODE = "WAREHOUSE"

/// Promise goods to the shops.
///
/// The screen is a grid: an article per row, a store per column, and a piece
/// count in every cell. That shape is the job — an allocator decides how many
/// of THIS shirt each of thirteen shops gets, in one pass, comparing them —
/// and a form that asked for one destination at a time made that comparison
/// impossible. An empty cell is not an allotment; only what is typed is
/// promised.
///
/// The article column stays put while the stores scroll, because losing which
/// row you are on halfway across the shops is how the wrong shop gets the
/// goods.
export function AllotmentDraft() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const identity = useIdentity()
  const vocabulary = useVocabulary()

  /// Keyed `skuId|storeId`. Per SKU rather than per article because that is
  /// what a line names; the article cells above are sums of these.
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState<AllotmentFilters>(NO_FILTERS)

  // One key per attempt at THIS allotment, held across retries and rotated only
  // once one has actually been raised: the server replays its first answer for
  // a repeated key, so a retry after a timeout cannot promise the goods twice.
  const idempotencyKey = useRef(crypto.randomUUID())

  const pools = useQuery({
    queryKey: ["inventory", "pools"],
    queryFn: ({ signal }) => listPools(signal),
    staleTime: 5 * 60_000,
  })

  const source = useMemo(() => {
    const sources = sourcePoolsFor("TO_STORE", pools.data ?? [])
    return (
      sources.find((pool) => pool.pool_code === WAREHOUSE_POOL_CODE) ?? null
    )
  }, [pools.data])
  const stores = useMemo(() => sitesOf(pools.data ?? [], "STORE"), [pools.data])

  const stock = useQuery({
    queryKey: ["inventory", "availability", source?.id ?? ""],
    queryFn: ({ signal }) => availability(source?.id ?? "", signal),
    enabled: source !== null,
  })

  // Under the same key the sheet reads, so naming the chosen order on the
  // button does not cost a second fetch of the list it came from.
  const orders = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: ({ signal }) => listPurchaseOrders(signal),
    staleTime: 60_000,
  })
  const order = (orders.data ?? []).find(
    (row) => row.purchase_order_id === filters.purchaseOrder
  )

  const articles = useMemo<ArticleRow[]>(() => {
    const byArticle = new Map<string, AvailabilityItem[]>()
    for (const item of stock.data?.items ?? []) {
      const skus = byArticle.get(item.article_id)
      if (skus === undefined) {
        byArticle.set(item.article_id, [item])
      } else {
        skus.push(item)
      }
    }
    return [...byArticle.values()]
      .map((skus) => ({
        id: skus[0].article_id,
        name: skus[0].article_name,
        image: skus[0].image_url,
        division: skus[0].division_code,
        tags: skus[0].tags,
        orders: skus[0].purchase_order_ids,
        skus,
        on_hand: skus.reduce((sum, sku) => sum + sku.on_hand_qty, 0),
        stock: skus.reduce((sum, sku) => sum + sku.stock_qty, 0),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [stock.data])

  /// The divisions and tags actually present, so the filter offers what this
  /// warehouse holds rather than the whole vocabulary. A division nothing is
  /// filed under is a tick that can only ever empty the screen.
  const divisions = useMemo(
    () =>
      [
        ...new Set(
          articles
            .map((article) => article.division)
            .filter((code): code is string => code !== null)
        ),
      ].sort((left, right) =>
        vocabulary.division(left).localeCompare(vocabulary.division(right))
      ),
    [articles, vocabulary]
  )
  const tagCodes = useMemo(
    () =>
      [...new Set(articles.flatMap((article) => article.tags))].sort(
        (left, right) =>
          vocabulary.tag(left).localeCompare(vocabulary.tag(right))
      ),
    [articles, vocabulary]
  )

  const needle = search.trim().toLowerCase()
  /// Search is a different act from filtering, so it is a different control:
  /// searching is looking for one thing you already have in mind, filtering is
  /// cutting the list down to a shape. They compose — a row has to survive
  /// both — but the search stays on the toolbar where it can be typed into
  /// without opening anything.
  const shown = articles.filter((article) => {
    if (needle !== "") {
      const division =
        article.division === null ? "" : vocabulary.division(article.division)
      const tags = article.tags.map((tag) => vocabulary.tag(tag)).join(" ")
      const matched = `${article.name} ${division} ${tags}`
        .toLowerCase()
        .includes(needle)
      if (!matched) return false
    }
    if (
      filters.divisions.length > 0 &&
      (article.division === null ||
        !filters.divisions.includes(article.division))
    ) {
      return false
    }
    // Any of the ticked tags, not all of them: a person ticking Kaos and Jaket
    // is asking for both kinds of thing, not for a garment that is somehow both.
    if (
      filters.tags.length > 0 &&
      !article.tags.some((tag) => filters.tags.includes(tag))
    ) {
      return false
    }
    if (filters.stock === "in" && article.on_hand <= 0) return false
    if (filters.stock === "out" && article.on_hand > 0) return false
    if (
      filters.purchaseOrder !== "" &&
      !article.orders.includes(filters.purchaseOrder)
    ) {
      return false
    }
    return true
  })
  const filterCount = activeFilterCount(filters)

  const quantityOf = (skuId: string, storeId: string) =>
    quantities[`${skuId}|${storeId}`] ?? 0
  const articleQuantity = (article: ArticleRow, storeId: string) =>
    article.skus.reduce((sum, sku) => sum + quantityOf(sku.sku_id, storeId), 0)

  const write = (changes: Record<string, number>) => {
    setQuantities((current) => {
      const next = { ...current }
      for (const [key, quantity] of Object.entries(changes)) {
        if (quantity <= 0) {
          delete next[key]
        } else {
          next[key] = quantity
        }
      }
      return next
    })
  }

  const setSkuQuantity = (skuId: string, storeId: string, quantity: number) =>
    write({ [`${skuId}|${storeId}`]: quantity })

  /// Typing against the article splits the number across its SKUs by what the
  /// pool has of each. Whatever was set by hand on the expanded rows for this
  /// store is replaced — one cell, one answer.
  const setArticleQuantity = (
    article: ArticleRow,
    storeId: string,
    quantity: number
  ) => {
    const given = spread(
      quantity,
      article.skus.map((sku) => sku.on_hand_qty)
    )
    write(
      Object.fromEntries(
        article.skus.map((sku, index) => [
          `${sku.sku_id}|${storeId}`,
          given[index],
        ])
      )
    )
  }

  const toggle = (articleId: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(articleId)) {
        next.delete(articleId)
      } else {
        next.add(articleId)
      }
      return next
    })

  const filled = Object.entries(quantities).filter(
    ([, quantity]) => quantity > 0
  )
  const pieces = filled.reduce((sum, [, quantity]) => sum + quantity, 0)
  const destinations = new Set(filled.map(([key]) => key.split("|")[1]))

  // The count shown here is the centre's projection; the number the server
  // checks against is the warehouse's own, reported by the DC node. They can
  // disagree, so this is a warning and not a block — but a row promising more
  // than the centre thinks exists is the one the DC is most likely to refuse,
  // and that is worth reading before the allotment is raised.
  const overreach = articles.filter((article) => {
    const promised = article.skus.reduce(
      (sum, sku) =>
        sum +
        stores.reduce(
          (row, store) => row + quantityOf(sku.sku_id, store.site_id),
          0
        ),
      0
    )
    return promised > article.on_hand
  })

  const create = useMutation({
    mutationFn: () => {
      if (source === null) {
        throw new Error("no DC warehouse pool")
      }
      const lines: CreateAllotmentLine[] = filled.map(([key, quantity]) => {
        const [skuId, storeId] = key.split("|")
        return {
          source_site_id: source.site_id,
          source_pool_id: source.id,
          destination_type: "STORE" as const,
          destination_id: storeId,
          sku_id: skuId,
          quantity,
        }
      })
      return createAllotment({
        type: "TO_STORE",
        lines,
        notes: null,
        actor_id: identity.data?.username ?? "",
        idempotency_key: idempotencyKey.current,
      })
    },
    onSuccess: (raised) => {
      idempotencyKey.current = crypto.randomUUID()
      void queryClient.invalidateQueries({ queryKey: ["allotments"] })
      // The pool's availability has just changed by exactly what was promised.
      void queryClient.invalidateQueries({ queryKey: ["inventory"] })
      void navigate({
        to: "/allotments/$allotmentId",
        params: { allotmentId: raised.id },
      })
    },
  })

  const problems: string[] = []
  if (source === null && pools.isSuccess) {
    problems.push("The DC has no warehouse pool to promise goods out of.")
  }
  if (filled.length === 0)
    problems.push("Type a quantity against a store to allot it.")

  const stickyLeft = {
    article: 0,
    stock: ARTICLE_WIDTH,
    total: ARTICLE_WIDTH + STOCK_WIDTH,
  }

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title="New allotment"
        subtitle={
          source === null
            ? "DC warehouse"
            : `${source.site_name} · ${source.label}`
        }
      >
        <span className="font-mono text-[11px] text-muted-foreground">
          {units(pieces)} pieces · {destinations.size} store
          {destinations.size === 1 ? "" : "s"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void navigate({ to: "/allotments" })}
        >
          <X className="size-3.5" />
          Discard
        </Button>
      </ScreenHeader>

      {pools.isError && (
        <div className="border-b px-3.5 py-2 text-[11.5px] text-destructive">
          {pools.error instanceof ApiError
            ? pools.error.message
            : "The pools could not be loaded."}
        </div>
      )}
      {create.isError && (
        <div className="border-b px-3.5 py-2 text-[11.5px] text-destructive">
          {create.error instanceof ApiError
            ? create.error.message
            : "The allotment could not be raised."}
        </div>
      )}

      <div className="flex h-11 shrink-0 items-center gap-3 border-b px-3.5">
        <span className="text-xs font-semibold">
          {shown.length} article{shown.length === 1 ? "" : "s"} across{" "}
          {stores.length} store
          {stores.length === 1 ? "" : "s"}
        </span>
        {stock.data !== undefined && (
          <span className="hidden font-mono text-[11px] text-muted-foreground lg:inline">
            {/* The server states this equation in the same response it sends the
                numbers with; repeating it is why On Hand is the column shown. */}
            On hand {units(stock.data.on_hand_qty)} of{" "}
            {units(stock.data.stock_qty)}
          </span>
        )}
        {shown.length !== articles.length && (
          <span className="text-[11px] text-muted-foreground">
            of {articles.length}
          </span>
        )}

        <label className="relative ml-auto">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Article, division or tag…"
            aria-label="Search the catalogue"
            className="h-7 w-56 pl-7 text-xs"
          />
        </label>

        <PurchaseOrderSheet
          selected={filters.purchaseOrder}
          onSelect={(purchaseOrder) =>
            setFilters({ ...filters, purchaseOrder })
          }
        >
          <Button variant="outline" size="sm" className="h-7">
            <Receipt className="size-3.5" />
            {order === undefined ? "Order" : order.po_number}
          </Button>
        </PurchaseOrderSheet>

        <FilterSheet
          filters={filters}
          divisions={divisions}
          tags={tagCodes}
          vocabulary={vocabulary}
          onChange={setFilters}
        >
          <Button variant="outline" size="sm" className="h-7">
            <ListFilter className="size-3.5" />
            Filters
            {filterCount > 0 && (
              <span className="ml-0.5 rounded-full bg-foreground px-1.5 font-mono text-[10px] text-background">
                {filterCount}
              </span>
            )}
          </Button>
        </FilterSheet>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {source === null && pools.isSuccess ? (
          <p className="px-3.5 py-6 text-center text-xs text-muted-foreground">
            No DC warehouse pool exists to promise goods out of.
          </p>
        ) : stock.isPending ? (
          <p className="px-3.5 py-6 text-center text-xs text-muted-foreground">
            Reading what the warehouse holds…
          </p>
        ) : stock.isError ? (
          <p className="px-3.5 py-6 text-center text-xs text-destructive">
            {stock.error instanceof ApiError
              ? stock.error.message
              : "The warehouse's stock could not be read."}
          </p>
        ) : shown.length === 0 ? (
          // Said plainly rather than shown as an empty grid: thirteen columns
          // of blank cells look exactly like a warehouse with nothing in it,
          // and the reason here is a filter the person set.
          <div className="px-3.5 py-10 text-center">
            <p className="text-xs text-muted-foreground">
              {articles.length === 0
                ? "The warehouse holds nothing to promise."
                : "No article matches what you are asking for."}
            </p>
            {articles.length > 0 && (filterCount > 0 || needle !== "") && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setFilters(NO_FILTERS)
                  setSearch("")
                }}
              >
                Show all {articles.length} articles
              </Button>
            )}
          </div>
        ) : (
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th
                  style={{
                    left: stickyLeft.article,
                    width: ARTICLE_WIDTH,
                    minWidth: ARTICLE_WIDTH,
                  }}
                  className="sticky top-0 z-30 border-r border-b bg-muted px-2 py-1.5 text-left text-[11px] font-medium"
                >
                  Article
                </th>
                <th
                  style={{
                    left: stickyLeft.stock,
                    width: STOCK_WIDTH,
                    minWidth: STOCK_WIDTH,
                  }}
                  className="sticky top-0 z-30 border-r border-b bg-muted px-2 py-1.5 text-right text-[11px] font-medium"
                >
                  On hand
                </th>
                <th
                  style={{
                    left: stickyLeft.total,
                    width: TOTAL_WIDTH,
                    minWidth: TOTAL_WIDTH,
                  }}
                  className="sticky top-0 z-30 border-r border-b bg-muted px-2 py-1.5 text-right text-[11px] font-medium"
                >
                  Allot
                </th>
                {stores.map((store) => (
                  <th
                    key={store.site_id}
                    className="sticky top-0 z-20 min-w-[86px] border-r border-b bg-muted px-2 py-1.5 text-center text-[11px] font-medium"
                  >
                    {store.site_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((article) => {
                const open = expanded.has(article.id)
                const promised = stores.reduce(
                  (sum, store) => sum + articleQuantity(article, store.site_id),
                  0
                )
                return (
                  <Fragment key={article.id}>
                    <tr>
                      <td
                        style={{
                          left: stickyLeft.article,
                          width: ARTICLE_WIDTH,
                          minWidth: ARTICLE_WIDTH,
                        }}
                        className="sticky z-10 border-r border-b bg-background p-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggle(article.id)}
                            aria-label={`${open ? "Hide" : "Show"} the colours and sizes of ${article.name}`}
                            aria-expanded={open}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            <ChevronRight
                              className={cn(
                                "size-3.5 transition-transform",
                                open && "rotate-90"
                              )}
                            />
                          </button>
                          <Photo name={article.name} src={article.image} />
                          <div className="min-w-0">
                            <div className="truncate text-[12.5px] leading-tight">
                              {article.name}
                            </div>
                            <div className="flex flex-wrap items-center gap-1 text-[10px] leading-tight text-muted-foreground">
                              {article.division !== null && (
                                <span>
                                  {vocabulary.division(article.division)}
                                </span>
                              )}
                              {article.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded bg-muted px-1 py-px"
                                >
                                  {vocabulary.tag(tag)}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td
                        style={{
                          left: stickyLeft.stock,
                          width: STOCK_WIDTH,
                          minWidth: STOCK_WIDTH,
                        }}
                        className={cn(
                          "sticky z-10 border-r border-b bg-background px-2 text-right font-mono text-[11px] tabular-nums",
                          article.on_hand <= 0 && "text-amber-600"
                        )}
                      >
                        {units(article.on_hand)}
                      </td>
                      <td
                        style={{
                          left: stickyLeft.total,
                          width: TOTAL_WIDTH,
                          minWidth: TOTAL_WIDTH,
                        }}
                        className={cn(
                          "sticky z-10 border-r border-b bg-background px-2 text-right font-mono text-[11px] tabular-nums",
                          promised > 0
                            ? "font-medium"
                            : "text-muted-foreground",
                          promised > article.on_hand && "text-amber-600"
                        )}
                      >
                        {promised === 0 ? "" : units(promised)}
                      </td>
                      {stores.map((store) => (
                        <Cell
                          key={store.site_id}
                          value={articleQuantity(article, store.site_id)}
                          label={`Pieces of ${article.name} for ${store.site_name}`}
                          onChange={(quantity) =>
                            setArticleQuantity(article, store.site_id, quantity)
                          }
                        />
                      ))}
                    </tr>
                    {open &&
                      article.skus.map((sku) => {
                        const line = stores.reduce(
                          (sum, store) =>
                            sum + quantityOf(sku.sku_id, store.site_id),
                          0
                        )
                        return (
                          <tr key={sku.sku_id}>
                            <td
                              style={{
                                left: stickyLeft.article,
                                width: ARTICLE_WIDTH,
                                minWidth: ARTICLE_WIDTH,
                              }}
                              className="sticky z-10 border-r border-b bg-background py-1 pr-2 pl-11 text-[11px] text-muted-foreground"
                            >
                              {[sku.colour, sku.size]
                                .filter((part) => part !== null)
                                .join(" · ")}
                            </td>
                            <td
                              style={{
                                left: stickyLeft.stock,
                                width: STOCK_WIDTH,
                                minWidth: STOCK_WIDTH,
                              }}
                              className={cn(
                                "sticky z-10 border-r border-b bg-background px-2 text-right font-mono text-[11px] text-muted-foreground tabular-nums",
                                sku.on_hand_qty <= 0 && "text-amber-600"
                              )}
                            >
                              {units(sku.on_hand_qty)}
                            </td>
                            <td
                              style={{
                                left: stickyLeft.total,
                                width: TOTAL_WIDTH,
                                minWidth: TOTAL_WIDTH,
                              }}
                              className="sticky z-10 border-r border-b bg-background px-2 text-right font-mono text-[11px] text-muted-foreground tabular-nums"
                            >
                              {line === 0 ? "" : units(line)}
                            </td>
                            {stores.map((store) => (
                              <Cell
                                key={store.site_id}
                                muted
                                value={quantityOf(sku.sku_id, store.site_id)}
                                label={`Pieces of ${sku.sku_code} for ${store.site_name}`}
                                onChange={(quantity) =>
                                  setSkuQuantity(
                                    sku.sku_id,
                                    store.site_id,
                                    quantity
                                  )
                                }
                              />
                            ))}
                          </tr>
                        )
                      })}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td
                  style={{
                    left: stickyLeft.article,
                    width: ARTICLE_WIDTH,
                    minWidth: ARTICLE_WIDTH,
                  }}
                  className="sticky bottom-0 z-30 border-r border-b bg-muted px-2 py-1.5 text-[11px] font-medium"
                >
                  Promised
                </td>
                <td
                  style={{
                    left: stickyLeft.stock,
                    width: STOCK_WIDTH,
                    minWidth: STOCK_WIDTH,
                  }}
                  className="sticky bottom-0 z-30 border-r border-b bg-muted"
                />
                <td
                  style={{
                    left: stickyLeft.total,
                    width: TOTAL_WIDTH,
                    minWidth: TOTAL_WIDTH,
                  }}
                  className="sticky bottom-0 z-30 border-r border-b bg-muted px-2 text-right font-mono text-[11px] font-medium tabular-nums"
                >
                  {pieces === 0 ? "" : units(pieces)}
                </td>
                {stores.map((store) => {
                  const column = articles.reduce(
                    (sum, article) =>
                      sum + articleQuantity(article, store.site_id),
                    0
                  )
                  return (
                    <td
                      key={store.site_id}
                      className="sticky bottom-0 z-20 border-r border-b bg-muted px-2 text-center font-mono text-[11px] tabular-nums"
                    >
                      {column === 0 ? "" : units(column)}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t px-3.5 py-2.5">
        {problems.length > 0 ? (
          <span className="truncate text-[11.5px] text-muted-foreground">
            {problems[0]}
          </span>
        ) : (
          overreach.length > 0 && (
            <span className="truncate text-[11.5px] text-amber-600">
              {overreach.length} article{overreach.length === 1 ? "" : "s"}{" "}
              promise more than the warehouse is thought to hold. The DC's own
              count decides, and may refuse them.
            </span>
          )
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            disabled={problems.length > 0 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Allotting…" : "Raise allotment"}
          </Button>
        </div>
      </div>
    </AppShell>
  )
}

/// One cell of the grid.
///
/// Empty is zero and zero is empty: a screen of thirteen columns full of `0`
/// reads as thirteen decisions, and only the shops with a number against them
/// are being sent anything.
function Cell({
  value,
  label,
  muted = false,
  onChange,
}: {
  value: number
  label: string
  muted?: boolean
  onChange: (quantity: number) => void
}) {
  return (
    <td className={cn("border-r border-b p-0", value > 0 && "bg-muted/40")}>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={value === 0 ? "" : String(value)}
        onChange={(event) =>
          onChange(Math.max(0, Math.floor(Number(event.target.value) || 0)))
        }
        aria-label={label}
        className={cn(
          // The stepper arrows are removed rather than styled: they are a
          // control for nudging one number, and this screen is a grid of
          // hundreds where the only sensible input is typing the figure.
          "h-8 w-full min-w-[86px] appearance-none bg-transparent text-center font-mono text-xs tabular-nums outline-none focus:bg-background focus:ring-1 focus:ring-ring focus:ring-inset [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          value > 0 ? "font-medium" : "text-muted-foreground",
          muted && "text-[11px]"
        )}
      />
    </td>
  )
}

/// The article's photograph, or a legible admission that it has none.
function Photo({ name, src }: { name: string; src: string | null }) {
  if (src === null) {
    return (
      <span
        aria-label={`${name} has no photo`}
        className="grid size-8 shrink-0 place-items-center rounded bg-muted text-[7px] text-muted-foreground"
      >
        no photo
      </span>
    )
  }
  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      className="size-8 shrink-0 rounded bg-muted object-cover"
    />
  )
}
