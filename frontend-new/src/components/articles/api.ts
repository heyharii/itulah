/*
 * Articles' backend boundary — the article master, which is what WE sell.
 *
 * This is deliberately not the same thing as Sourcing. A sourcing item is what
 * a supplier offers us (buying price, MOQ, lead time, their photograph); an
 * article is our own product: an article code, a division, its colourways and
 * the SKUs underneath them, each with a selling price and its barcodes.
 *
 * There is now ONE link between the two, and it is deliberately narrow: which
 * suppliers may supply an article. The hub carries it on the enriched item row
 * as `suppliers[]` (id + name), resolved through `sourcing_items.family_id`.
 * Nothing else crosses — no photograph, and no cost. A supplier's buying price
 * belongs to that supplier's offer, and an article with three suppliers has
 * three of them, so there is no single cost to put on an article.
 */

import {
  api,
  checkContract,
  qs,
  useDomainQuery,
  type ApiRequestOptions,
} from "@/lib/api"
import { listQueryParams, type ListQuery } from "@/shared/api/list-query"
import { articlesQueries } from "./queries"
import {
  DivisionRow,
  EnrichedItemRow,
  SupplierRow,
  TagRow,
  VariantGroupRow,
} from "./contracts"

/* Go keys the article master as variant groups (122 of them), with the SKUs
 * underneath in the item master. There is no `/v1/articles`; that belonged to
 * the Rust port. */
const GROUPS_ROUTE = "/v1/masterdata/variant-groups"
const ITEMS_ROUTE = "/v1/masterdata/items"
const SUPPLIERS_ROUTE = "/v1/masterdata/suppliers"
const PAGE = 200

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const str = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback

const num = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "string" ? Number(value) : value
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export interface ArticleColor {
  id: string
  name: string
  number: number
  code: string | null
  /** The family's own swatch, when it records one; most do not. */
  hex: string | null
}

/** A size from the shared size master. `order` is what puts XS before XL —
 * the labels sort alphabetically into nonsense on their own. */
export interface ArticleSize {
  code: string
  label: string
  order: number
}

export interface ArticleIdentifier {
  kind: string
  value: string
}

export interface ArticleItem {
  id: string
  sku: string
  colorId: string
  colorName: string
  colorNumber: number
  colorHex: string | null
  sizeCode: string
  sizeLabel: string
  sizeOrder: number
  status: string
  sellingPrice: number
  barcode: string
  identifiers: ArticleIdentifier[]
}

export interface Article {
  id: string
  /** Only set once the item master publishes one; Go has none today. */
  image?: string
  code: string
  name: string
  divisionId: string
  status: string
  tags: string[]
  colorCount: number
  itemCount: number
  /** Every supplier who may supply this article, by the union over its SKUs —
   *  the hub serves the same article-level list on each of them. */
  suppliers: ArticleSupplier[]
  /** The colourways and sizes this article is actually made in, folded up
   * from its SKUs — a card can show the range without opening the row. */
  colors: ArticleColor[]
  sizes: ArticleSize[]
  items?: ArticleItem[]
}

export interface Division {
  id: string
  name: string
  code: string
}

export interface Tag {
  id: string
  name: string
  active: boolean
}

/** A supplier who may supply an article. Not "who we bought from" — that is a
 *  purchase order, a different question with a different answer. */
export interface ArticleSupplier {
  id: string
  name: string
}

/**
 * What the screen is asking the article master for. Multi-valued because a
 * merchandiser looking at Menswear rarely wants only Menswear — the two nav
 * rails are sets, and an empty set means "no filter" rather than "match
 * nothing".
 */
export interface ArticleFilters {
  /** Free text over article name and code. Sent as `q`. */
  query?: string
  /** Division ids, OR'd. Sent as `division_id=a,b`. */
  divisionIds?: string[]
  /** Tag NAMES (what the rail shows), OR'd. Sent as `tag=a,b`. */
  tagNames?: string[]
  /** Supplier IDS, OR'd. Sent as `supplier_id=a,b`. Ids and not names: two
   *  suppliers may share a name, and a label is not a key. */
  supplierIds?: string[]
}

/** How many articles carry a given division id / tag name, counted by the hub
 *  with that facet's own selection excluded — so a rail row keeps its number
 *  after you click it. */
export type ArticleFacetCounts = Record<string, number>

export interface ArticleCatalogue {
  articles: Article[]
  divisions: Division[]
  /** The shared tag vocabulary, not only the tags articles happen to carry. */
  tags: Tag[]
  /** False when the backend serves no per-item tags, so nothing can be
   * filtered by them and the tag filter should stand down. */
  tagsAvailable: boolean
  /** Articles matching the current filter, as the hub counted them. */
  matched: number
  /** Articles in the master with no filter at all — the rail's "All". */
  total: number
  divisionCounts: ArticleFacetCounts
  tagCounts: ArticleFacetCounts
  /** Keyed by supplier id, which is what the filter sends. */
  supplierCounts: ArticleFacetCounts
  /** The supplier master, so the rail can name an id. */
  suppliers: ArticleSupplier[]
}

/** The hub's `facets` shape: `{ division_id: [{ value, count }], … }`. */
function facetCounts(payload: unknown, field: string): ArticleFacetCounts {
  const facets = asRecord(asRecord(payload)?.facets)
  const out: ArticleFacetCounts = {}
  for (const entry of list(facets?.[field])) {
    const row = asRecord(entry)
    const value = str(row?.value)
    if (value) out[value] = num(row?.count)
  }
  return out
}

/**
 * The wire form of the screen's filters.
 *
 * `listQueryParams` is what turns an array into the contract's comma-joined OR
 * (`docs/list-contract.md` §1) and emits `q`; the param names here are the ones
 * `_lib/listquery` parses on `/items/enriched` — `division_id`, `tag` and
 * `supplier_id`.
 */
export function articleListQuery(filters: ArticleFilters): ListQuery {
  return {
    q: filters.query,
    filters: {
      division_id: filters.divisionIds?.length ? filters.divisionIds : undefined,
      tag: filters.tagNames?.length ? filters.tagNames : undefined,
      supplier_id: filters.supplierIds?.length ? filters.supplierIds : undefined,
    },
  }
}

function tagFromApi(raw: unknown): Tag | null {
  const row = asRecord(raw)
  const id = str(row?.id)
  if (!row || !id) return null
  return { id, name: str(row.name, id), active: row.is_active !== false }
}

function supplierFromApi(raw: unknown): ArticleSupplier | null {
  const row = asRecord(raw)
  const id = str(row?.supplier_id) || str(row?.id)
  if (!row || !id) return null
  return { id, name: str(row.name, id) }
}

function divisionFromApi(raw: unknown): Division | null {
  const row = asRecord(raw)
  const id = str(row?.id)
  if (!row || !id) return null
  return { id, name: str(row.name, id), code: str(row.code) }
}

/* Go splits what this screen calls an article across two reads: the variant
 * group carries the name, the item master carries the division, the price and
 * the SKUs. Neither alone can answer "show me every Menswear article", which
 * is why the division filter did nothing when this read groups only.
 *
 * The search and the two rails are applied by the hub, not here. `q`,
 * `division_id` and `tag` go to `/items/enriched`, which now parses them
 * through `_lib/listquery`; the articles this screen shows are the variant
 * groups whose SKUs came back. Filtering the loaded page in the browser
 * instead — which is what this did — searches whatever happened to be
 * downloaded and reports that as the answer.
 *
 * One consequence worth naming: an article's colourways and sizes are folded
 * from the SKUs the hub returned, so a filter that splits a style (a search
 * matching one SKU's digits) shows that article with only its matching SKUs.
 * Its tags and division are not narrowed — the hub serves those per row
 * regardless of the predicate. */
export async function fetchArticleCatalogue(
  filters: ArticleFilters = {},
  signal?: AbortSignal
): Promise<ArticleCatalogue> {
  const options: ApiRequestOptions | undefined = signal ? { signal } : undefined

  const [groupPayload, divisionPayload, tagPayload, supplierPayload] = await Promise.all([
    api.get<unknown>(`${GROUPS_ROUTE}${qs({ limit: 500 })}`, options),
    api.get<unknown>("/v1/masterdata/divisions", options),
    api.get<unknown>(`/v1/masterdata/tags${qs({ limit: PAGE })}`, options),
    /* The supplier master is read for the rail's LABELS only. The facet
     * answers which suppliers have articles and how many; it returns ids,
     * because that is what the filter takes. */
    api.get<unknown>(`${SUPPLIERS_ROUTE}${qs({ limit: PAGE })}`, options),
  ])

  const wire = listQueryParams(articleListQuery(filters))
  const filtering = Boolean(wire.q ?? wire.division_id ?? wire.tag ?? wire.supplier_id)

  /* The item master is paged; walk it so every matching article sees all its
   * SKUs. `items/enriched` pages with page/page_size (1-based) — it accepts
   * limit/offset as an alias now, but page/page_size is what it has always
   * spoken, so that is what is sent. */
  const items: Record<string, unknown>[] = []
  /* Whether the running backend serves an item's tags at all. Older binaries
   * omit the facet; the tag filter switches itself off when it is missing
   * rather than offering filters that can only ever match nothing. */
  let tagsServed = false
  let matched = 0
  let total = 0
  let divisionCounts: ArticleFacetCounts = {}
  let tagCounts: ArticleFacetCounts = {}
  let supplierCounts: ArticleFacetCounts = {}

  for (let page = 1; page <= 40; page += 1) {
    /* Facets and the article counts are asked for once. They describe the
     * whole filtered set, not the page, so repeating them per page would be
     * three extra aggregate queries for an answer already held. */
    const payload = await api.get<unknown>(
      `${ITEMS_ROUTE}/enriched${qs({
        ...wire,
        page,
        page_size: PAGE,
        facets: page === 1 ? "division_id,tag,supplier_id" : undefined,
      })}`,
      options
    )
    if (page === 1) {
      const body = asRecord(payload)
      matched = num(body?.article_count)
      total = num(body?.article_total)
      divisionCounts = facetCounts(payload, "division_id")
      tagCounts = facetCounts(payload, "tag")
      supplierCounts = facetCounts(payload, "supplier_id")
      /* The tag facet's presence is the signal: a hub that serves it serves
       * item→tag memberships. Reading it off the returned rows instead made
       * the answer depend on the filter, so a search that matched only
       * untagged articles retired the whole rail. */
      tagsServed = asRecord(asRecord(payload)?.facets)?.tag !== undefined
    }
    const batch = list(asRecord(payload)?.items).map(asRecord).filter(Boolean) as Record<
      string,
      unknown
    >[]
    checkContract(EnrichedItemRow, batch, `${ITEMS_ROUTE}/enriched`)
    items.push(...batch)
    if (batch.length < PAGE) break
  }

  /* A style is the SKU without its colour suffix, which is how the variant
   * group's parent_sku is built too. */
  const styleOf = (sku: string) => sku.slice(0, 8)
  const bySt = new Map<string, Record<string, unknown>[]>()
  for (const item of items) {
    const sku = str(item.sku)
    if (!sku) continue
    const key = styleOf(sku)
    bySt.set(key, [...(bySt.get(key) ?? []), item])
  }

  const rawGroups = list(
    asRecord(groupPayload)?.variant_groups ?? asRecord(groupPayload)?.items
  )
  checkContract(VariantGroupRow, rawGroups, GROUPS_ROUTE)

  const articles = rawGroups
    .map((raw) => {
      const row = asRecord(raw)
      const id = str(row?.id)
      if (!row || !id) return null
      const parent = str(row.parent_sku)
      const members = bySt.get(styleOf(parent)) ?? []
      /* With a filter on, an article the hub returned no SKUs for did not
       * match. With none, a group whose SKUs are missing is still an article
       * — it is simply one nothing has been set up under yet. */
      if (filtering && members.length === 0) return null
      const first = members[0]
      /* A photograph belongs to one colourway, and it is rarely the one the
       * group happens to name as its parent — take the first member that
       * actually has one rather than assuming members[0] does. */
      const pictured = members.find((member) => str(member.default_image_url))
      /* An article's tags are the union of its SKUs' tags: the taxonomy is
       * recorded per item, but merchandising reads it per article. */
      const tags = [
        ...new Set(members.flatMap((member) => list(member.tags).map((tag) => str(tag)))),
      ]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
      /* An article's suppliers are article-level already — the hub repeats
       * the same list on each SKU — so this is a de-duplication, not a union
       * of differing sets. Keyed by id: a name is a label, not an identity. */
      const suppliers: ArticleSupplier[] = [
        ...new Map(
          members
            .flatMap((member) => list(member.suppliers))
            .map(supplierFromApi)
            .filter((supplier): supplier is ArticleSupplier => Boolean(supplier))
            .map((supplier) => [supplier.id, supplier] as const)
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name))
      /* A SKU reads family + colour digit + size code, and the enriched read
       * resolves the last two into their labels. Fall back to the digits the
       * SKU itself carries so an article still says something on a backend
       * that has not been rebuilt with those columns. */
      const skuItems: ArticleItem[] = members.map((m) => {
        const sku = str(m.sku)
        const digit = str(m.color_digit) || sku.slice(8, 9)
        const sizeCode = str(m.size_code) || sku.slice(9)
        return {
          id: sku,
          sku,
          colorId: digit,
          colorName: str(m.color_label) || (digit ? `Colour ${digit}` : "—"),
          colorNumber: num(digit),
          colorHex: str(m.color_hex) || null,
          sizeCode,
          sizeLabel: str(m.size_label) || sizeCode || "—",
          sizeOrder: num(m.size_order),
          status: str(m.status, "active"),
          sellingPrice: num(m.sell_price),
          barcode: "",
          identifiers: [],
        }
      })

      /* One entry per colourway and per size the article is made in, in the
       * order the masters keep them — colour digit, then the size master's
       * own sort, which is the only thing that puts XS before XL. */
      const colors: ArticleColor[] = [
        ...new Map(
          skuItems.map((item) => [
            item.colorId || item.colorName,
            {
              id: item.colorId || item.colorName,
              name: item.colorName,
              number: item.colorNumber,
              code: item.colorId || null,
              hex: item.colorHex,
            },
          ])
        ).values(),
      ].sort((a, b) => a.number - b.number || a.name.localeCompare(b.name))

      const sizes: ArticleSize[] = [
        ...new Map(
          skuItems
            .filter((item) => item.sizeCode)
            .map((item) => [
              item.sizeCode,
              { code: item.sizeCode, label: item.sizeLabel, order: item.sizeOrder },
            ])
        ).values(),
      ].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code))

      return {
        id,
        code: parent || id,
        name: str(row.group_name, parent || id),
        divisionId: str(first?.category_id),
        status: str(row.status, "active"),
        tags,
        colorCount: colors.length,
        itemCount: members.length,
        suppliers,
        image: str(pictured?.default_image_url) || undefined,
        colors,
        sizes,
        items: skuItems,
      } as Article
    })
    .filter((article): article is Article => Boolean(article))

  const rawDivisions = list(
    asRecord(divisionPayload)?.divisions ?? asRecord(divisionPayload)?.items
  )
  checkContract(DivisionRow, rawDivisions, "/v1/masterdata/divisions")
  const divisions = rawDivisions
    .map(divisionFromApi)
    .filter((division): division is Division => Boolean(division))

  const rawTags = list(asRecord(tagPayload)?.items)
  checkContract(TagRow, rawTags, "/v1/masterdata/tags")
  const tags = rawTags
    .map(tagFromApi)
    .filter((tag): tag is Tag => Boolean(tag))
    .sort((a, b) => a.name.localeCompare(b.name))

  const rawSuppliers = list(asRecord(supplierPayload)?.items ?? asRecord(supplierPayload)?.suppliers)
  checkContract(SupplierRow, rawSuppliers, SUPPLIERS_ROUTE)
  const suppliers = rawSuppliers
    .map(supplierFromApi)
    .filter((supplier): supplier is ArticleSupplier => Boolean(supplier))
    .sort((a, b) => a.name.localeCompare(b.name))

  /* Serving the vocabulary is not the same as serving the memberships: the
   * filter is only usable once the hub can count articles per tag. */
  const tagsAvailable = tagsServed && Object.keys(tagCounts).length > 0

  return {
    articles,
    divisions,
    tags,
    tagsAvailable,
    /* A hub that does not serve the counts still serves the rows, so fall
     * back to what was actually returned rather than showing a confident 0. */
    matched: matched || articles.length,
    total: total || articles.length,
    divisionCounts,
    tagCounts,
    supplierCounts,
    suppliers,
  }
}

export function useArticleCatalogue(filters: ArticleFilters) {
  return useDomainQuery(articlesQueries.catalogue(filters))
}

/* There is no article-detail read here, and no parsers for one, because Go has
 * no article-detail route: it answers the item master with a bare list, so the
 * "detail" fetch that used to live here could only ever come back empty and
 * leave an opened row saying "Loading SKUs…" forever. The catalogue read above
 * already carries every SKU with its colour and its size, so the screen reads
 * them off the row it is already holding. */

/* ── writing ──────────────────────────────────────────────────
 * Both creates need the CSRF header (the shared client adds it) and an
 * Idempotency-Key, which the hub demands with a 428 when it is missing. */

/* The hub parses this header as a UUID and answers 400 "malformed" for
 * anything else, so the fallback has to be UUID-shaped too. */
const idempotencyKey = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0
    const value = char === "x" ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

export async function createTag(name: string): Promise<Tag> {
  const payload = await api.post<unknown>(
    "/v1/tags",
    { name: name.trim() },
    { headers: { "Idempotency-Key": idempotencyKey() } }
  )
  const tag = tagFromApi(payload)
  if (!tag) throw new Error("The tag was created but came back in a shape we do not understand.")
  return tag
}

export async function createDivision(input: {
  code: string
  name: string
  sortOrder?: number
}): Promise<Division> {
  const payload = await api.post<unknown>(
    "/v1/divisions",
    { code: input.code.trim(), name: input.name.trim(), sort_order: input.sortOrder ?? 0 },
    { headers: { "Idempotency-Key": idempotencyKey() } }
  )
  const division = divisionFromApi(payload)
  if (!division) {
    throw new Error("The division was created but came back in a shape we do not understand.")
  }
  return division
}
