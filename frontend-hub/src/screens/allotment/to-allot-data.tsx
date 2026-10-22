import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useMemo } from "react"

import { EmptyState } from "@/components/ui/states"
import { articleKeys, searchArticles } from "@/lib/queries/articles"
import { colourKeys, listColours } from "@/lib/queries/colours"
import {
  fleetPools,
  inventoryKeys,
  poolAvailability,
  type AvailabilityItem,
} from "@/lib/queries/inventory"
import {
  catalogueVocabulary,
  listPurchaseOrders,
  procurementKeys,
  type PurchaseOrderRow,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { sourcePoolsFor } from "@/screens/inventory/shared"
import { termLabel } from "@/screens/procurement/shared"
import { useSupplierName } from "@/screens/procurement/supplier-name"
import { parseWalk, walkSearch, type SupplierPick } from "./walk"

/// Unallotted: what the warehouse holds that no store has been given yet,
/// under the supplier it came from — the first tab of the Allotments page,
/// and where a New allotment starts.
///
/// An allotment is ONE supplier's goods (the owner, 29 Sep 2026), but articles
/// can be ticked under several suppliers at once (2 Oct 2026): the grid then
/// walks them one supplier at a time. The ticks live in the address (see
/// `walk.ts`), which is also what opens the grid at `/allotment/new`, so Back
/// from the grid finds them still ticked.

/// One article that still has something free to allot.
export interface PickArticle {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly division: string | null
  readonly image: string | null
  readonly divisionName: string
  readonly tagNames: readonly string[]
  readonly free: number
  /// The order numbers it arrived on, so a delivery can be searched for.
  readonly orders: readonly string[]
  /// The colours of its free SKUs, once each, in SKU order; `hex` when the
  /// colour master has a swatch for it.
  readonly colours: readonly { name: string; hex: string | null }[]
  /// The sizes of its free SKUs, once each, in the size book's order.
  readonly sizes: readonly string[]
  /// Whether `sizes` is an unbroken run of the size book ("S – XL").
  readonly sizesRun: boolean
  /// When the article was set up (its record created); null until read.
  readonly setupAt: string | null
  /// Its free SKUs' numbers, in SKU order.
  readonly skuCodes: readonly string[]
}

/// The pages of the article master read, newest first, to find when the
/// articles on screen were set up: unallotted goods are recent, so the first
/// page usually holds them all.
const SETUP_PAGES = 10

/// When each article was set up, by article code — the master has no read by
/// code list, so this walks it newest first until every code is found.
async function setupDates(
  codes: readonly string[],
  signal?: AbortSignal
): Promise<Record<string, string>> {
  const wanted = new Set(codes)
  const found: Record<string, string> = {}
  let cursor: string | undefined
  for (let page = 0; page < SETUP_PAGES && wanted.size > 0; page++) {
    const result = await searchArticles(
      { sort: "newest", limit: 200, cursor },
      signal
    )
    for (const row of result.items)
      if (wanted.delete(row.article_code))
        found[row.article_code] = row.created_at
    if (!result.next_cursor) break
    cursor = result.next_cursor
  }
  return found
}

/// One supplier, and its articles with something free.
export interface PickSupplier {
  readonly id: string
  readonly name: string
  readonly free: number
  readonly articles: readonly PickArticle[]
}

/// The articles ticked, by supplier.
export type Selection = ReadonlyMap<string, ReadonlySet<string>>

/// The ticks that still name something free, supplier by supplier in the
/// list's order — what Make new allotment walks through.
export function pickedOf(
  suppliers: readonly PickSupplier[],
  selection: Selection
): { supplier: PickSupplier; articles: PickArticle[] }[] {
  return suppliers.flatMap((supplier) => {
    const ticked = selection.get(supplier.id)
    const articles = ticked
      ? supplier.articles.filter((one) => ticked.has(one.id))
      : []
    return articles.length === 0 ? [] : [{ supplier, articles }]
  })
}

/// Picks as the walk carries them.
export function asPicks(
  picked: readonly { supplier: PickSupplier; articles: PickArticle[] }[]
): SupplierPick[] {
  return picked.map((one) => ({
    supplier: one.supplier.id,
    articles: one.articles.map((article) => article.id),
  }))
}

/// Where goods that came in on no order are allotted from. Not empty, because
/// it rides in the address as `?supplier=`.
export const NO_SUPPLIER = { id: "none", name: "No supplier" } as const

/// An article's supplier: the supplier of the orders it came in on, named as
/// the company writes it ("Garmen Nusantara, PT") when the supplier book
/// knows it. An article that came on no order is `NO_SUPPLIER`'s.
export function useSupplierOf(orders: readonly PurchaseOrderRow[] | undefined) {
  // An order carries the supplier's code and a bare name; the supplier book
  // turns them into the name the company writes, "Garmen Nusantara, PT".
  const nameOf = useSupplierName()
  const byOrder = useMemo(
    () =>
      new Map(
        (orders ?? []).map((one) => [
          one.purchase_order_id,
          {
            id: one.supplier_id,
            name: legalFormLast(
              nameOf(one.supplier_id, one.supplier_name ?? one.supplier_id)
            ),
          },
        ])
      ),
    [orders, nameOf]
  )
  return useCallback(
    (item: AvailabilityItem): { id: string; name: string } => {
      for (const id of item.purchase_order_ids) {
        const found = byOrder.get(id)
        if (found) return found
      }
      return NO_SUPPLIER
    },
    [byOrder]
  )
}

/// "PT Garmen Nusantara" → "Garmen Nusantara, PT", for a name the supplier
/// book does not know.
function legalFormLast(name: string): string {
  const found = /^(PT|CV|UD)\.?\s+(.+)$/i.exec(name.trim())
  return found ? `${found[2]}, ${found[1].toUpperCase()}` : name
}

/// The ticked articles, read from and written to the address.
///
/// `walk` is the grid's step: the supplier on screen, the ones walked past and
/// the ones still to come. `selection` is all of them together, which is what
/// the list ticks; on the list the first supplier is `current` and the rest
/// are the `queue`.
export function useAllotSelection() {
  const navigate = useNavigate()
  const supplier = useSheet("supplier").value
  const articles = useSheet("articles").value
  const queued = useSheet("queue").value
  const walked = useSheet("before").value
  const { walk, steps, selection } = useMemo(() => {
    const before = parseWalk(walked)
    const current: SupplierPick | null =
      supplier === undefined || articles === undefined
        ? null
        : { supplier, articles: articles.split(",") }
    const queue = parseWalk(queued)
    /// Every supplier of the walk, in the list's order.
    const steps = [...before, ...(current ? [current] : []), ...queue]
    const all = new Map<string, Set<string>>()
    for (const one of steps) {
      const set = all.get(one.supplier) ?? new Set<string>()
      for (const id of one.articles) set.add(id)
      all.set(one.supplier, set)
    }
    return {
      walk: { before, current, queue },
      steps,
      selection: all as Selection,
    }
  }, [supplier, articles, queued, walked])
  /// Writes the ticks back, in the order given (the list's).
  const select = (picks: readonly SupplierPick[]) =>
    void navigate({
      to: ".",
      replace: true,
      viewTransition: false,
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        ...walkSearch([], picks[0], picks.slice(1)),
      })) as never,
    })
  return { walk, steps, selection, select }
}

/// Into the grid and back out of it: the screens panel slides away and the
/// page widens over the space it left (`focus` in index.css), instead of the
/// panel vanishing and the page jumping 232px in one frame (owner, 17 Oct
/// 2026: "transisi … allot all itu ga rapi"). Only where the browser can scope
/// a transition by type — without it the router would cross-fade the whole
/// screen, so there the cut stays a cut.
export function focusTransition() {
  return typeof window !== "undefined" &&
    window.CSS?.supports?.("selector(:active-view-transition-type(a))")
    ? { types: ["focus"] }
    : false
}

/// Opens the grid on the first supplier, the others queued behind it.
export function useMakeAllotment() {
  const navigate = useNavigate()
  return (picks: readonly SupplierPick[]) => {
    if (picks.length === 0) return
    void navigate({
      to: "/allotment/new" as never,
      search: walkSearch([], picks[0], picks.slice(1)) as never,
      viewTransition: focusTransition(),
    })
  }
}

/// Everything the Unallotted tab draws, read the same way the grid reads it
/// (the warehouse pool, `held=true`), so the two never disagree about what is
/// free.
export function useToAllot(enabled = true) {
  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
    enabled,
  })
  const source = useMemo(() => {
    const pools = sourcePoolsFor("TO_STORE", fleet.data?.items ?? [])
    return (
      pools.find((one) => one.pool_code === "WAREHOUSE")?.id ??
      pools[0]?.id ??
      ""
    )
  }, [fleet.data])
  const stock = useQuery({
    queryKey: inventoryKeys.poolAvailability(source, true),
    queryFn: ({ signal }) => poolAvailability(source, { held: true }, signal),
    enabled: enabled && source !== "",
  })
  const orders = useQuery({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders({}, signal),
    staleTime: 5 * 60 * 1000,
    enabled,
  })
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
    enabled,
  })
  const colourBook = useQuery({
    queryKey: colourKeys.list(),
    queryFn: ({ signal }) => listColours(signal),
    staleTime: 30 * 60 * 1000,
    enabled,
  })
  const supplierOf = useSupplierOf(orders.data)

  /// Every article code with something free, sorted so the key is stable.
  const codes = useMemo(
    () =>
      [
        ...new Set(
          (stock.data?.items ?? [])
            .filter((item) => item.stock_qty > 0 && item.on_hand_qty > 0)
            .map((item) => item.article_code)
        ),
      ].sort(),
    [stock.data]
  )
  const setup = useQuery({
    queryKey: [...articleKeys.all, "setup-dates", codes] as const,
    queryFn: ({ signal }) => setupDates(codes, signal),
    staleTime: 10 * 60 * 1000,
    enabled: enabled && codes.length > 0,
  })

  const suppliers = useMemo<PickSupplier[]>(() => {
    const numberOf = new Map(
      (orders.data ?? []).map((one) => [one.purchase_order_id, one.po_number])
    )
    /// A colour's swatch, by its name or its code.
    const hexOf = new Map<string, string | null>()
    for (const one of colourBook.data?.colours ?? []) {
      hexOf.set(one.label.toLowerCase(), one.hex_code)
      hexOf.set(one.code.toLowerCase(), one.hex_code)
    }
    /// A size's place in the size book, by its label or its code.
    const rankOf = new Map<string, number>()
    for (const [index, one] of (vocabulary.data?.sizes ?? []).entries()) {
      rankOf.set(one.label.toLowerCase(), index)
      rankOf.set(one.code.toLowerCase(), index)
    }
    const rank = (size: string) =>
      rankOf.get(size.toLowerCase()) ?? Number.MAX_SAFE_INTEGER
    const bySupplier = new Map<
      string,
      { name: string; articles: Map<string, AvailabilityItem[]> }
    >()
    for (const item of stock.data?.items ?? []) {
      if (item.stock_qty <= 0 || item.on_hand_qty <= 0) continue
      const who = supplierOf(item)
      const entry = bySupplier.get(who.id) ?? {
        name: who.name,
        articles: new Map<string, AvailabilityItem[]>(),
      }
      const skus = entry.articles.get(item.article_id) ?? []
      skus.push(item)
      entry.articles.set(item.article_id, skus)
      bySupplier.set(who.id, entry)
    }
    return [...bySupplier.entries()]
      .map(([id, entry]) => {
        const articles = [...entry.articles.values()]
          .map((unsorted) => {
            const skus = [...unsorted].sort((left, right) =>
              left.sku_code.localeCompare(right.sku_code)
            )
            const first = skus[0]
            const colourNames = [
              ...new Set(
                skus.flatMap((one) => (one.colour ? [one.colour] : []))
              ),
            ]
            const sizes = [
              ...new Set(skus.flatMap((one) => (one.size ? [one.size] : []))),
            ].sort((left, right) => rank(left) - rank(right))
            const ranks = sizes.map(rank)
            return {
              id: first.article_id,
              code: first.article_code,
              name: first.article_name,
              division: first.division_code,
              image: first.image_url,
              divisionName: first.division_code
                ? termLabel(vocabulary.data?.divisions, first.division_code)
                : "",
              tagNames: first.tags.map((tag) =>
                termLabel(vocabulary.data?.tags, tag)
              ),
              free: skus.reduce((total, one) => total + one.on_hand_qty, 0),
              skuCodes: skus.map((one) => one.sku_code),
              orders: [
                ...new Set(
                  skus.flatMap((one) =>
                    one.purchase_order_ids.map((po) => numberOf.get(po) ?? "")
                  )
                ),
              ].filter(Boolean),
              colours: colourNames.map((name) => ({
                name,
                hex: hexOf.get(name.toLowerCase()) ?? null,
              })),
              sizes,
              sizesRun:
                sizes.length >= 3 &&
                ranks.every(
                  (value, index) =>
                    value !== Number.MAX_SAFE_INTEGER &&
                    (index === 0 || value === ranks[index - 1] + 1)
                ),
              setupAt: setup.data?.[first.article_code] ?? null,
            } satisfies PickArticle
          })
          .sort((left, right) => left.name.localeCompare(right.name))
        return {
          id,
          name: entry.name,
          free: articles.reduce((total, one) => total + one.free, 0),
          articles,
        }
      })
      .sort((left, right) =>
        left.id === NO_SUPPLIER.id
          ? 1
          : right.id === NO_SUPPLIER.id
            ? -1
            : left.name.localeCompare(right.name)
      )
  }, [
    stock.data,
    orders.data,
    vocabulary.data,
    colourBook.data,
    setup.data,
    supplierOf,
  ])

  const status =
    stock.data === undefined || orders.isPending
      ? queryState(stock, {
          loading: "Reading everything the pool holds…",
          render: () => (
            <EmptyState>
              Reading which supplier each article is from…
            </EmptyState>
          ),
        })
      : null

  return {
    suppliers,
    status,
    /// How many articles have something to allot, for the tab's count.
    articles: suppliers.reduce((total, one) => total + one.articles.length, 0),
    /// Pieces the DC holds free to allot, for the In stock figure.
    pieces: suppliers.reduce((total, one) => total + one.free, 0),
  }
}
