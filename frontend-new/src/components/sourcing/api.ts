/*
 * Sourcing's backend boundary.
 *
 * Internal owns sourcing items, suppliers, named shortlists, and purchase
 * orders. This adapter keeps the browser on those canonical routes and never
 * turns the old in-memory CommerceProvider into a second authority.
 */

import {
  api,
  checkContract,
  qs,
  useDomainQuery,
  type ApiRequestOptions,
} from "@/lib/api"
import {
  listQueryParams,
  type ListQuery,
} from "@/shared/api/list-query"
import { type Product, type Supplier } from "@/components/sourcing/catalogue"
import { sourcingQueries, shortlistQueries } from "./queries"
import {
  ApiDivisionRow,
  ApiLocationRow,
  ApiShortlistSummaryRow,
  ApiSourcingItemRow,
  ApiSupplierRow,
  ApiTagRow,
} from "./contracts"

/* Cache keys. Sourcing and the shortlist are two views of one procurement
 * state, so every shortlist write invalidates both namespaces — that is what
 * keeps the star in Sourcing and the rows in Shortlist from disagreeing.
 *
 * The keys themselves now live in `./queries`; these are kept because
 * `writes.ts`-equivalents here and `po/api.ts` still name a raw key. */
export const sourcingCatalogKey = () => sourcingQueries.catalog().queryKey
export const sourcingShortlistKey = () => shortlistQueries.entries().queryKey

interface ApiSupplier {
  supplier_id?: unknown
  code?: unknown
  name?: unknown
  address?: unknown
  status?: unknown
  primary_division?: unknown
  tags?: unknown
}

interface ApiSourcingItem {
  id?: unknown
  code?: unknown
  name?: unknown
  supplier?: unknown
  supplier_id?: unknown
  supplier_name?: unknown
  division?: unknown
  division_id?: unknown
  division_name?: unknown
  supplier_product_code?: unknown
  color?: unknown
  tags?: unknown
  description?: unknown
  currency?: unknown
  unit_cost?: unknown
  moq?: unknown
  lead_time_days?: unknown
  primary_image?: unknown
  media?: unknown
  status?: unknown
  updated_at?: unknown
}

interface ApiDivision {
  id?: unknown
  name?: unknown
  code?: unknown
  is_active?: unknown
  status?: unknown
}

interface ApiTag {
  id?: unknown
  name?: unknown
  status?: unknown
}

interface ApiLocation {
  location_id?: unknown
  id?: unknown
  code?: unknown
  name?: unknown
  location_type?: unknown
  type?: unknown
  is_active?: unknown
  status?: unknown
}

interface ApiShortlistSummary {
  id?: unknown
  name?: unknown
  item_count?: unknown
  item_ids?: unknown
  created_at?: unknown
  updated_at?: unknown
}

/** One server-filtered page-set of sourcing items. */
export interface SourcingItems {
  products: Product[]
  /** Currency shown for aggregate values; line currency remains authoritative. */
  currency: string
  /** Identifies which bounded-context contract supplied the rows. */
  source: "sourcing_items" | "product_families_compatibility"
  fetchedAt: string
}

/** Master data the screen filters by — independent of the current scope. */
export interface SourcingReference {
  suppliers: Supplier[]
  locations: SourcingLocation[]
  divisions: SourcingDivision[]
  tags: SourcingTag[]
}

export type SourcingCatalog = SourcingItems & SourcingReference

export interface SourcingLocation {
  id: string
  code: string
  name: string
  type: string
  active: boolean
}

export interface SourcingDivision {
  id: string
  name: string
  status: string
}

/** Master tag reference used when authoring a new supplier candidate. */
export interface SourcingTag {
  id: string
  name: string
  status: string
}

export interface SourcingShortlistEntry {
  /** This is the Internal sourcing-item primary key, never the display code. */
  sourcingItemId: string
  shortlistId: string
  shortlistName: string
}

export interface SourcingShortlist {
  supported: boolean
  entries: SourcingShortlistEntry[]
  lists: SourcingShortlistList[]
  /** Present when the configured shortlist route is unavailable. */
  reason?: string
}

export interface SourcingShortlistList {
  id: string
  name: string
  itemIds: string[]
}

/** Command payload for the relational sourcing-item aggregate. */
export interface SourcingItemWriteInput {
  supplier_id: string
  supplier_product_code?: string
  name: string
  division_id: string
  color?: string
  description?: string
  currency?: string
  unit_cost?: string
  moq?: number
  lead_time_days?: number
  tag_ids?: string[]
  status?: "active" | "inactive"
  media_url?: string
}

export interface SupplierWriteInput {
  name: string
  code: string
  address: string
  status: "active" | "inactive" | "blocked"
}

interface ApiList<T> {
  items?: T[]
  suppliers?: T[]
  divisions?: T[]
  locations?: T[]
  total?: number
  count?: number
  next_cursor?: string | null
  data?: T[]
}

const SOURCING_PAGE_SIZE = 200
const SHORTLIST_ROUTE = "/v1/sourcing-shortlists"
const HUES = [
  "#7b5cfa",
  "#0086fc",
  "#00c978",
  "#ff58ae",
  "#ffbb26",
  "#64c6ff",
  "#ff3e00",
]

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? fallback
      : String(value)
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function booleanValue(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    if (value.trim().toLowerCase() === "false") return false
    if (value.trim().toLowerCase() === "true") return true
  }
  return fallback
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => stringValue(item)).filter(Boolean)
}

function listFrom<T>(payload: unknown, keys: (keyof ApiList<T>)[]): T[] {
  if (Array.isArray(payload)) return payload as T[]
  const record = asRecord(payload)
  if (!record) return []
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value as T[]
  }
  return []
}

function pageTotal(payload: unknown): number | undefined {
  const record = asRecord(payload)
  if (!record) return undefined
  for (const key of ["total", "count"]) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

async function fetchPagedCollection<T>(
  path: string,
  keys: (keyof ApiList<T>)[],
  signal: AbortSignal | undefined,
  pageSize = SOURCING_PAGE_SIZE,
  /** Filter/sort params sent with *every* page, so paging stays inside one
   *  server-side result set rather than re-narrowing a different one. */
  params: Record<string, string | number | undefined> = {}
): Promise<T[]> {
  const options: ApiRequestOptions | undefined = signal ? { signal } : undefined

  /* Paging is not uniform across Internal: /v1/masterdata/suppliers rejects `offset`
   * with a 400 and pages by cursor, while /v1/sourcing and /v1/files accept
   * offset and never return one. Follow a cursor when it is offered; when the
   * route reports a total instead, fetch the remaining pages at once — walking
   * 1005 styles one page at a time put twenty seconds in front of the screen. */
  const first = await api.get<unknown>(
    `${path}${qs({ ...params, limit: pageSize })}`,
    options
  )
  const out: T[] = [...listFrom<T>(first, keys)]
  const total = pageTotal(first)
  let cursor = stringValue(asRecord(first)?.next_cursor)

  if (!cursor && total !== undefined && total > out.length) {
    const offsets: number[] = []
    for (let at = out.length; at < total; at += pageSize) offsets.push(at)
    const pages = await Promise.all(
      offsets.map((offset) =>
        api.get<unknown>(
          `${path}${qs({ ...params, limit: pageSize, offset })}`,
          options
        )
      )
    )
    for (const page of pages) out.push(...listFrom<T>(page, keys))
    return out
  }

  for (let page = 0; cursor && page < 100; page += 1) {
    const payload = await api.get<unknown>(
      `${path}${qs({ ...params, limit: pageSize, cursor })}`,
      options
    )
    const items = listFrom<T>(payload, keys)
    out.push(...items)
    if (items.length === 0) break
    cursor = stringValue(asRecord(payload)?.next_cursor)
  }

  return out
}

function minutesSince(value: unknown): number {
  const raw = stringValue(value)
  if (!raw) return 0
  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp)) return 0
  return Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
}

function supplierFromApi(raw: ApiSupplier, index: number): Supplier | null {
  const id = stringValue(raw.supplier_id)
  const name = stringValue(raw.name)
  if (!id || !name) return null
  return {
    id,
    name,
    /* `master_suppliers` has no `primary_division` column — verified against
     * the live schema, not inferred. The old fallback printed the literal
     * word "Supplier" under every name, which read as data and was not.
     * Undefined when the backend has nothing to say. */
    division: stringValue(raw.primary_division) || undefined,
    // The internal supplier contract deliberately has no country field.
    country: "",
    hue: HUES[index % HUES.length],
  }
}

function divisionFromApi(raw: ApiDivision): SourcingDivision | null {
  const id = stringValue(raw.id)
  const name = stringValue(raw.name, id)
  if (!id || !name) return null
  const active = booleanValue(
    raw.is_active,
    stringValue(raw.status, "active") === "active"
  )
  return { id, name, status: active ? "active" : "inactive" }
}

function locationFromApi(raw: ApiLocation): SourcingLocation | null {
  const id = stringValue(raw.location_id) || stringValue(raw.id)
  const code = stringValue(raw.code, id)
  const name = stringValue(raw.name, code)
  if (!id || !name) return null
  return {
    id,
    code,
    name,
    type: stringValue(raw.location_type) || stringValue(raw.type, "location"),
    active: booleanValue(
      raw.is_active,
      stringValue(raw.status, "active") === "active"
    ),
  }
}

function tagFromApi(raw: ApiTag): SourcingTag | null {
  const id = stringValue(raw.id)
  const name = stringValue(raw.name, id)
  if (!id || !name) return null
  return { id, name, status: stringValue(raw.status, "active") }
}

function statusForApi(value: unknown): Product["status"] {
  switch (stringValue(value).toLocaleLowerCase()) {
    case "draft":
    case "in_markdown":
      return "sampling"
    case "inactive":
    case "archived":
    case "discontinued":
    case "end_of_life":
      return "paused"
    default:
      return "active"
  }
}

/**
 * A `/v1/sourcing` row as the screen's `Product`.
 *
 * The supplier is taken straight off the row — Internal's list projection
 * always carries `supplier: {id, name}` — rather than being looked up in a
 * supplier map. The old name-based fallback existed to recover an id from a
 * display name, and that only worked while the client held every supplier;
 * now that the item list is server-filtered it would resolve against whichever
 * suppliers happened to be loaded, which is exactly the kind of
 * confident-but-wrong join this change is removing.
 */
function sourcingItemFromApi(raw: ApiSourcingItem): Product | null {
  const id = stringValue(raw.id)
  if (!id) return null
  const supplierRecord = asRecord(raw.supplier)
  const supplierID =
    stringValue(raw.supplier_id) || stringValue(supplierRecord?.id)
  const divisionRecord = asRecord(raw.division)
  const divisionID =
    stringValue(raw.division_id) || stringValue(divisionRecord?.id)
  const divisionName =
    stringValue(raw.division_name) || stringValue(divisionRecord?.name)
  const media = Array.isArray(raw.media) ? raw.media : []
  const primaryMedia = media
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .sort((a, b) => numberValue(a.sort_order) - numberValue(b.sort_order))
    .find((entry) => booleanValue(entry.is_primary, false))
  const image = stringValue(raw.primary_image) || stringValue(primaryMedia?.url)
  const unitCost = numberValue(raw.unit_cost)
  const status = statusForApi(raw.status)
  return {
    id,
    name: stringValue(raw.name, id),
    // `code` is a sourcing code, not a sellable SKU. It is shown in the UI but
    // deliberately never copied into a PO line as a master_items.sku.
    sku: stringValue(raw.code, id),
    variantSku: undefined,
    sourcingItemId: id,
    category: divisionName || "Merchandise",
    divisionId: divisionID || undefined,
    verified: false,
    price: unitCost,
    moq: Math.max(0, Math.trunc(numberValue(raw.moq))),
    leadTime: Math.max(0, Math.trunc(numberValue(raw.lead_time_days))),
    supplierId: supplierID,
    tags: stringList(raw.tags),
    status,
    updated: minutesSince(raw.updated_at),
    colorways: [{ id: `${id}-primary`, image }],
    currency: stringValue(raw.currency).toUpperCase() || undefined,
  }
}

/**
 * The server-filtered sourcing-item list.
 *
 * `query` becomes `q`, `sort_by`/`sort_dir` and the comma-separated
 * `supplier_id` / `division_id` / `tag_id` IN lists that
 * `internal/cloud/sourcingitem` parses through `_lib/listparams` — the screen
 * no longer narrows anything after the fact.
 *
 * Every page of the *filtered* result is still fetched, because the screen
 * groups, totals and select-alls over the whole scope. The difference from
 * before is that the scope is now the server's, not 715 rows the client had to
 * hold to be able to search them.
 */
export async function fetchSourcingItems(
  query: ListQuery = {},
  signal?: AbortSignal
): Promise<SourcingItems> {
  const rows = await fetchPagedCollection<ApiSourcingItem>(
    "/v1/sourcing",
    ["items", "data"],
    signal,
    SOURCING_PAGE_SIZE,
    listQueryParams(query)
  )
  checkContract(ApiSourcingItemRow, rows, "/v1/sourcing")
  const products = rows
    .map(sourcingItemFromApi)
    .filter((product): product is Product => Boolean(product))
  return {
    products,
    currency: products.find((product) => product.currency)?.currency ?? "",
    source: "sourcing_items",
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * Master data the sourcing screen filters *by*: suppliers, divisions, tags and
 * locations.
 *
 * Separate from the item list because it does not depend on the current scope.
 * Folding it into the filtered query would re-fetch four masterdata routes on
 * every keystroke, and — worse — would rebuild the filter menus out of whatever
 * the current filter happened to return, so choosing one supplier would hide
 * every other supplier from the rail.
 */
export async function fetchSourcingReference(
  signal?: AbortSignal
): Promise<SourcingReference> {
  const options: ApiRequestOptions | undefined = signal ? { signal } : undefined
  // These are the canonical Internal routes. Supplier and division failures
  // remain visible because their IDs are required by sourcing-item writes and
  // PO staging. These resources are owned by the masterdata boundary; there
  // are no top-level /suppliers or /divisions routes in Internal.
  const [suppliersRaw, divisionPayload, locationPayload, tagPayload] =
    await Promise.all([
      // Supplier listing is offset based under masterdata. Request a bounded
      // page; sourcing item IDs must not be inferred from display names.
      api.get<unknown>(
        `/v1/masterdata/suppliers${qs({ limit: SOURCING_PAGE_SIZE })}`,
        options
      ),
      api.get<unknown>("/v1/masterdata/divisions", options),
      api.get<unknown>(
        `/v1/masterdata/locations${qs({ limit: SOURCING_PAGE_SIZE })}`,
        options
      ),
      api.get<unknown>(
        `/v1/masterdata/tags${qs({ limit: SOURCING_PAGE_SIZE, status: "active" })}`,
        options
      ),
    ])

  const supplierRows = listFrom<ApiSupplier>(suppliersRaw, [
    "suppliers",
    "items",
    "data",
  ])
  checkContract(ApiSupplierRow, supplierRows, "/v1/masterdata/suppliers")
  const suppliers = supplierRows
    .map(supplierFromApi)
    .filter((supplier): supplier is Supplier => Boolean(supplier))
  const divisionRows = listFrom<ApiDivision>(divisionPayload, [
    "items",
    "divisions",
    "data",
  ])
  checkContract(ApiDivisionRow, divisionRows, "/v1/masterdata/divisions")
  const divisions = divisionRows
    .map(divisionFromApi)
    .filter((division): division is SourcingDivision =>
      Boolean(division && division.status === "active")
    )
  const locationRows = listFrom<ApiLocation>(locationPayload, [
    "items",
    "locations",
    "data",
  ])
  checkContract(ApiLocationRow, locationRows, "/v1/masterdata/locations")
  const locations = locationRows
    .map(locationFromApi)
    .filter((location): location is SourcingLocation =>
      Boolean(location && location.active)
    )
  const tagRows = listFrom<ApiTag>(tagPayload, ["items", "data"])
  checkContract(ApiTagRow, tagRows, "/v1/masterdata/tags")
  const tags = tagRows
    .map(tagFromApi)
    .filter((tag): tag is SourcingTag => Boolean(tag && tag.status === "active"))

  return { suppliers, locations, divisions, tags }
}

/**
 * The whole, unfiltered catalogue in one object.
 *
 * Kept for `@/components/po/*`, which resolves PO lines against every sourcing
 * item and has no scope of its own. The sourcing screen no longer uses it — it
 * reads `fetchSourcingItems` and `fetchSourcingReference` separately so its
 * filters can reach the server.
 */
export async function fetchSourcingCatalog(
  signal?: AbortSignal
): Promise<SourcingCatalog> {
  const [items, reference] = await Promise.all([
    fetchSourcingItems({}, signal),
    fetchSourcingReference(signal),
  ])
  return {
    products: items.products,
    ...reference,
    currency: items.currency,
    source: items.source,
    fetchedAt: items.fetchedAt,
  }
}

/** Fetches the canonical catalogue; there is deliberately no static fallback. */
export function useSourcingCatalog() {
  return useDomainQuery(sourcingQueries.catalog())
}

/** The scope-independent filter master data. */
export function useSourcingReference() {
  return useDomainQuery(sourcingQueries.reference())
}

/** The server-filtered item list for one scope. */
export function useSourcingItems(query: ListQuery) {
  return useDomainQuery(sourcingQueries.items(query))
}

function shortlistListFromApi(
  raw: ApiShortlistSummary
): SourcingShortlistList | null {
  const id = stringValue(raw.id)
  if (!id) return null
  return {
    id,
    name: stringValue(raw.name, "Untitled shortlist"),
    itemIds: stringList(raw.item_ids),
  }
}

function shortlistListsFromPayload(payload: unknown): SourcingShortlistList[] {
  const rows = listFrom<ApiShortlistSummary>(payload, ["items", "data"])
  // Shared by both `fetchSourcingShortlist` and `shortlistSummaries` below,
  // so the check lives here once rather than at each of their two `api.get`
  // call sites.
  checkContract(ApiShortlistSummaryRow, rows, SHORTLIST_ROUTE)
  return rows
    .map(shortlistListFromApi)
    .filter((list): list is SourcingShortlistList => Boolean(list))
}

function shortlistEntriesFromLists(
  lists: SourcingShortlistList[]
): SourcingShortlistEntry[] {
  const seen = new Set<string>()
  const entries: SourcingShortlistEntry[] = []
  for (const list of lists) {
    for (const sourcingItemId of list.itemIds) {
      // An item may appear in more than one named list. The sourcing screen
      // needs one membership flag, while the list id is retained for a
      // precise mutation and provenance in the shortlist screen.
      if (seen.has(sourcingItemId)) continue
      seen.add(sourcingItemId)
      entries.push({
        sourcingItemId,
        shortlistId: list.id,
        shortlistName: list.name,
      })
    }
  }
  return entries
}

/** Reads the canonical named shortlist collection; no client-side fallback. */
export async function fetchSourcingShortlist(
  signal?: AbortSignal
): Promise<SourcingShortlist> {
  const payload = await api.get<unknown>(
    SHORTLIST_ROUTE,
    signal ? { signal } : undefined
  )
  const lists = shortlistListsFromPayload(payload)
  return {
    supported: true,
    entries: shortlistEntriesFromLists(lists),
    lists,
  }
}

export function useSourcingShortlist() {
  return useDomainQuery(shortlistQueries.entries())
}

function idempotencyKey(prefix: string): string {
  const token =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${token}`
}

async function shortlistSummaries(
  signal?: AbortSignal
): Promise<SourcingShortlistList[]> {
  const payload = await api.get<unknown>(
    SHORTLIST_ROUTE,
    signal ? { signal } : undefined
  )
  return shortlistListsFromPayload(payload)
}

let shortlistCreation: Promise<SourcingShortlistList> | null = null

async function ensureShortlist(
  signal?: AbortSignal
): Promise<SourcingShortlistList> {
  const existing = await shortlistSummaries(signal)
  if (existing[0]) return existing[0]

  if (!shortlistCreation) {
    shortlistCreation = (async () => {
      const created = await api.post<unknown>(
        SHORTLIST_ROUTE,
        { name: "Working shortlist" },
        {
          headers: { "Idempotency-Key": idempotencyKey("shortlist-create") },
          ...(signal ? { signal } : {}),
        }
      )
      const record = asRecord(created)
      const id = stringValue(record?.id)
      if (!id) throw new Error("Internal did not return the new shortlist id")
      return {
        id,
        name: stringValue(record?.name, "Working shortlist"),
        itemIds: [],
      }
    })()
  }
  try {
    return await shortlistCreation
  } finally {
    shortlistCreation = null
  }
}

/** Adds the Internal sourcing-item primary key to the first named shortlist. */
export async function addSourcingShortlistEntry(
  sourcingItemId: string,
  _input: { colorwayId?: string; note?: string } = {},
  signal?: AbortSignal
) {
  // Colorway/note were fields of the predecessor contract; Internal shortlist
  // membership is intentionally keyed only by the sourcing-item UUID.
  void _input
  const shortlist = await ensureShortlist(signal)
  return api.post<unknown>(
    `${SHORTLIST_ROUTE}/${encodeURIComponent(shortlist.id)}/items`,
    {
      sourcing_item_id: sourcingItemId,
    },
    signal ? { signal } : undefined
  )
}

/** Removes a sourcing item from every named shortlist that contains it. */
export async function removeSourcingShortlistEntry(
  sourcingItemId: string,
  signal?: AbortSignal
) {
  const lists = await shortlistSummaries(signal)
  const matches = lists.filter((list) => list.itemIds.includes(sourcingItemId))
  await Promise.all(
    matches.map((list) =>
      api.del<unknown>(
        `${SHORTLIST_ROUTE}/${encodeURIComponent(list.id)}/items/${encodeURIComponent(sourcingItemId)}`,
        signal ? { signal } : undefined
      )
    )
  )
}

/** Clears memberships while retaining the operator's named shortlist lists. */
export async function clearSourcingShortlist(signal?: AbortSignal) {
  const lists = await shortlistSummaries(signal)
  await Promise.all(
    lists.flatMap((list) =>
      list.itemIds.map((sourcingItemId) =>
        api.del<unknown>(
          `${SHORTLIST_ROUTE}/${encodeURIComponent(list.id)}/items/${encodeURIComponent(sourcingItemId)}`,
          signal ? { signal } : undefined
        )
      )
    )
  )
}

/** Creates a supplier-product candidate; no product/SKU or stock is created. */
export async function createSourcingItem(
  input: SourcingItemWriteInput,
  signal?: AbortSignal
) {
  // Internal accepts media_url as part of the sourcing-item command and writes
  // it in the same transaction as the item root. Keeping it in this request
  // prevents a successful item with a lost, non-idempotent follow-up media
  // mutation.
  return api.post<unknown>("/v1/sourcing", input, {
    headers: {
      "Idempotency-Key": idempotencyKey("sourcing-item-create"),
    },
    ...(signal ? { signal } : {}),
  })
}

export function createSourcingSupplier(
  input: SupplierWriteInput,
  signal?: AbortSignal
) {
  return api.post<unknown>("/v1/masterdata/suppliers", input, {
    headers: { "Idempotency-Key": idempotencyKey("supplier-create") },
    ...(signal ? { signal } : {}),
  })
}

/* ------------------------------------------------------------------ writes */

export interface ShortlistAddInput {
  sourcingItemId: string
  colorwayId?: string
  note?: string
}

/**
 * The five sourcing mutations live in `./mutations` now, built on
 * `useMutation` directly — re-exported here so sourcing.tsx and
 * `@/components/po/po-draft.tsx` (a different, unowned domain) do not have to
 * change their import.
 */
export {
  useAddShortlistEntry,
  useClearShortlist,
  useCreateSourcingItem,
  useCreateSourcingSupplier,
  useRemoveShortlistEntry,
} from "./mutations"
