import type { QueryClient } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"

import type {
  CatalogueVocabulary,
  PaymentTermsBook,
  PurchaseDestination,
  Supplier,
} from "@itulah/contract"

import {
  colourKeys,
  listColours,
  type ColourVocabulary,
} from "@/lib/queries/colours"
import { listUnits, unitKeys, type UnitsBook } from "@/lib/queries/units"
import {
  catalogueVocabulary,
  listSuppliers,
  paymentTermsBook,
  procurementKeys,
  purchaseDestinations,
} from "@/lib/queries/procurement"

/// The reference data the offline surfaces read, kept on the device.
///
/// "Offline" for procurement is one condition: the buyer is standing in a
/// supplier's showroom with no line to head office. Everything they need to
/// *name* a purchase — which suppliers exist, what the divisions and tags are
/// called, where a delivery can land — is small, text-shaped, and cached here.
/// Everything they need to *price* it is deliberately not: the item catalogue
/// and its images stay on the server, and a line typed offline carries the
/// supplier's own code to be matched when the line returns (`offline-basket`
/// is that match).
///
/// localStorage, and deliberately not IndexedDB: the advantages a second
/// storage engine buys — quota, async, blobs — are bought by exactly the data
/// this cache does not hold. `allotment/draft.ts` and the till's outbox are
/// the house pattern this follows.

const KEY = "procurement.reference.v1"

/// Full supplier entities, capped. A thousand rows at roughly a kilobyte each
/// is about a megabyte — inside the quota with room to spare. Past the cap the
/// cache simply stops: the menu says how many it is not holding, and a
/// supplier who did not fit is typed by code at match time.
const SUPPLIER_CAP = 1000

/// A day. The cache is a picker convenience, never authority — the raise
/// re-validates everything server-side and answers a stale supplier with its
/// own sentence — so "too old" only means "worth refreshing when online".
const STALE_AFTER_MS = 24 * 60 * 60 * 1000

export interface ReferenceCache {
  readonly version: 1
  readonly suppliers: readonly Supplier[]
  /// What the book said it holds when the page was taken — the number the
  /// offline Suppliers menu shows beside what it is holding.
  readonly suppliers_total: number
  readonly suppliers_at: string | null
  readonly vocabulary: CatalogueVocabulary | null
  readonly vocabulary_at: string | null
  readonly units: UnitsBook | null
  readonly units_at: string | null
  readonly destinations: readonly PurchaseDestination[]
  readonly destinations_at: string | null
  readonly payment_terms: PaymentTermsBook | null
  readonly payment_terms_at: string | null
  /// The colour master, for the New item form's colour picker.
  readonly colours: ColourVocabulary | null
  readonly colours_at: string | null
}

const EMPTY: ReferenceCache = {
  version: 1,
  suppliers: [],
  suppliers_total: 0,
  suppliers_at: null,
  vocabulary: null,
  vocabulary_at: null,
  units: null,
  units_at: null,
  destinations: [],
  destinations_at: null,
  payment_terms: null,
  payment_terms_at: null,
  colours: null,
  colours_at: null,
}

interface ReferenceState {
  readonly cache: ReferenceCache
  /// A write to localStorage failed — quota, private mode, disabled storage.
  /// Loud, never silent: reference data typed against a device that will not
  /// keep it is a thing a buyer must see, not a console warning.
  readonly trouble: string | null
}

function loadCache(): ReferenceCache {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return EMPTY
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return EMPTY
    const cache = parsed as ReferenceCache
    if (cache.version !== 1) return EMPTY
    return { ...EMPTY, ...cache }
  } catch {
    return EMPTY
  }
}

let state: ReferenceState = { cache: loadCache(), trouble: null }
const listeners = new Set<() => void>()

function announce(): void {
  for (const listener of listeners) listener()
}

/// Merge into what is on disk before writing, so a tab that has been idle
/// cannot write its older snapshot over a fresher one saved beside it — the
/// same discipline the till's outbox learned the hard way.
function saveCache(patch: Partial<ReferenceCache>): void {
  const disk = loadCache()
  const next: ReferenceCache = { ...disk, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
    state = { cache: next, trouble: null }
  } catch (error) {
    // Keep the merged set in memory for this session, and say so.
    state = {
      cache: next,
      trouble:
        error instanceof Error
          ? "Device storage is full or was refused — the reference data will not survive once the page is closed."
          : "Device storage is not available.",
    }
  }
  announce()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener("storage", onOtherTab)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener("storage", onOtherTab)
  }
}

function onOtherTab(): void {
  const disk = loadCache()
  if (disk !== state.cache) {
    state = { cache: disk, trouble: state.trouble }
    announce()
  }
}

function snapshot(): ReferenceState {
  return state
}

/// React's window onto the cache.
export function useReference(): ReferenceState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

function fresh(at: string | null): boolean {
  return at !== null && Date.now() - Date.parse(at) <= STALE_AFTER_MS
}

/// The connection's own opinion, when it offers one. A courtesy for the buyer
/// on phone data, not a promise — the manual refresh ignores it.
function connectionDefersBulk(): boolean {
  const conn = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string }
    }
  ).connection
  if (conn === undefined) return false
  if (conn.saveData === true) return true
  return conn.effectiveType === "slow-2g" || conn.effectiveType === "2g"
}

/// The supplier book, capped. The light picker route answers it — complete
/// rows and nothing else, without the order tallies, facets and book summary
/// the offline menus never read. It carries every active party (the route has
/// no category of its own; the screens that must see merchandise only already
/// filter), and the rows are sorted by name here so the cap cuts at a stable
/// place rather than at wherever the server's ordering stopped.
async function refreshSuppliers(signal?: AbortSignal): Promise<void> {
  const book = await listSuppliers("ACTIVE", signal)
  const rows = [...book].sort((a, b) => a.name.localeCompare(b.name))
  saveCache({
    suppliers: rows.slice(0, SUPPLIER_CAP),
    // The light route sends no book summary, so the count is what the read
    // actually saw — the honest side of "showing X of Y" when the book has
    // outgrown the cap.
    suppliers_total: rows.length,
    suppliers_at: new Date().toISOString(),
  })
}

/// The four small masters in one pass; each settles on its own, so one
/// refusal never keeps the others from landing.
async function refreshMasters(signal?: AbortSignal): Promise<void> {
  const now = new Date().toISOString()
  const [vocabulary, units, destinations, terms, colours] =
    await Promise.allSettled([
      catalogueVocabulary(signal),
      listUnits(signal),
      purchaseDestinations(signal),
      paymentTermsBook(signal),
      listColours(signal),
    ])
  saveCache({
    ...(vocabulary.status === "fulfilled"
      ? { vocabulary: vocabulary.value, vocabulary_at: now }
      : {}),
    ...(units.status === "fulfilled"
      ? { units: units.value, units_at: now }
      : {}),
    ...(destinations.status === "fulfilled"
      ? { destinations: destinations.value, destinations_at: now }
      : {}),
    ...(terms.status === "fulfilled"
      ? { payment_terms: terms.value, payment_terms_at: now }
      : {}),
    ...(colours.status === "fulfilled"
      ? { colours: colours.value, colours_at: now }
      : {}),
  })
}

let refreshing: Promise<void> | null = null

/// Top the cache up where it is stale. Called from the offline surfaces'
/// effects, so the buyer who opened the app online this morning is carrying
/// today's book by the time they leave.
///
/// Failures are silent by design — an offline buyer must never see a toast
/// about a refresh that could not happen; the cache they have is usable and
/// stamped, and the raise re-validates whatever it is.
export function refreshReference(): Promise<void> {
  if (refreshing !== null) return refreshing
  refreshing = (async () => {
    try {
      const jobs: Promise<void>[] = []
      // An EMPTY set counts as stale even when its stamp is fresh — a first
      // refresh that ran before the data existed (a DC registered later, an
      // empty book) must not lock the cache empty for a day.
      const suppliersWorthKeeping = state.cache.suppliers.length > 0
      if (
        (!fresh(state.cache.suppliers_at) || !suppliersWorthKeeping) &&
        !connectionDefersBulk()
      )
        jobs.push(refreshSuppliers())
      if (
        !fresh(state.cache.vocabulary_at) ||
        !fresh(state.cache.units_at) ||
        state.cache.destinations.length === 0 ||
        !fresh(state.cache.destinations_at) ||
        !fresh(state.cache.payment_terms_at) ||
        !fresh(state.cache.colours_at)
      )
        jobs.push(refreshMasters())
      await Promise.allSettled(jobs)
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/// Puts what the device holds into the query cache, once, as the app starts.
///
/// This is what lets the New PO form open and work with no line: the form
/// reads its suppliers, divisions, units and the rest through the same
/// queries it always did, and with nothing to fetch them from those queries
/// answer from here. Stamped with the day they were taken, so they are stale
/// and read again the moment there is a connection; a query that already has
/// an answer is left alone.
export function hydrateReference(client: QueryClient): void {
  const { cache } = state
  const seed = (
    key: readonly unknown[],
    data: unknown,
    at: string | null
  ): void => {
    if (data === null || data === undefined || at === null) return
    if (client.getQueryData(key) !== undefined) return
    client.setQueryData(key, data, { updatedAt: Date.parse(at) })
  }
  if (cache.suppliers.length > 0)
    seed(procurementKeys.suppliers(), cache.suppliers, cache.suppliers_at)
  seed(procurementKeys.vocabulary(), cache.vocabulary, cache.vocabulary_at)
  seed(unitKeys.book(), cache.units, cache.units_at)
  if (cache.destinations.length > 0)
    seed(
      procurementKeys.destinations(),
      cache.destinations,
      cache.destinations_at
    )
  seed(
    procurementKeys.paymentTerms(),
    cache.payment_terms,
    cache.payment_terms_at
  )
  seed(colourKeys.list(), cache.colours, cache.colours_at)
}

/// Whether the cache has never been filled — the offline surface's way of
/// saying "open this once online" instead of showing an empty picker.
export function referenceIsEmpty(cache: ReferenceCache): boolean {
  return (
    cache.suppliers.length === 0 &&
    cache.vocabulary === null &&
    cache.destinations.length === 0
  )
}

/// Online, as the browser sees it — with the two events that actually fire
/// when the showroom's wifi drops and comes back.
export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener("online", listener)
      window.addEventListener("offline", listener)
      return () => {
        window.removeEventListener("online", listener)
        window.removeEventListener("offline", listener)
      }
    },
    () => navigator.onLine,
    () => true
  )
}
