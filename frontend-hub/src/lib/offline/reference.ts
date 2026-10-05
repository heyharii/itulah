import { useSyncExternalStore } from "react"

import type {
  CatalogueVocabulary,
  PaymentTermsBook,
  PurchaseDestination,
  Supplier,
} from "@itulah/contract"

import { listUnits, type UnitsBook } from "@/lib/queries/units"
import {
  catalogueVocabulary,
  paymentTermsBook,
  purchaseDestinations,
  supplierPage,
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
}

interface ReferenceState {
  readonly cache: ReferenceCache
  /// A write to localStorage failed — quota, private mode, disabled storage.
  /// Loud, never silent: money typed into a capture that the device may forget
  /// is a thing a buyer must see, not a console warning.
  readonly trouble: string | null
}

let state: ReferenceState = { cache: load(), trouble: null }
const listeners = new Set<() => void>()

function load(): ReferenceCache {
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

function announce(): void {
  for (const listener of listeners) listener()
}

/// Merge into what is on disk before writing, so a tab that has been idle
/// cannot write its older snapshot over a fresher one saved beside it — the
/// same discipline the till's outbox learned the hard way.
function save(patch: Partial<ReferenceCache>): void {
  const disk = load()
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
          ? `Penyimpanan perangkat penuh atau ditolak — data referensi tidak akan bertahan setelah halaman ditutup.`
          : "Penyimpanan perangkat tidak tersedia.",
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
  const disk = load()
  if (JSON.stringify(disk) !== JSON.stringify(state.cache)) {
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

function staleAt(at: string | null): boolean {
  if (at === null) return true
  return Date.now() - Date.parse(at) > STALE_AFTER_MS
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

async function refreshSuppliers(signal?: AbortSignal): Promise<void> {
  // The menu is the merchandise book — the same scope Suppliers online reads.
  const rows: Supplier[] = []
  let total = 0
  let cursor: string | undefined
  for (let page = 0; page < 10; page++) {
    const body = await supplierPage(
      {
        category: "MERCHANDISE",
        status: "ACTIVE",
        sort: "name",
        limit: 1000,
        ...(cursor === undefined ? {} : { cursor }),
      },
      signal
    )
    total = body.total
    rows.push(...body.rows)
    if (body.next_cursor === null || rows.length >= SUPPLIER_CAP) break
    cursor = body.next_cursor
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  save({
    suppliers: rows.slice(0, SUPPLIER_CAP),
    suppliers_total: total,
    suppliers_at: new Date().toISOString(),
  })
}

async function refreshMasters(signal?: AbortSignal): Promise<void> {
  const patch: Partial<ReferenceCache> = {}
  const now = new Date().toISOString()
  const settled = await Promise.allSettled([
    catalogueVocabulary(signal),
    listUnits(signal),
    purchaseDestinations(signal),
    paymentTermsBook(signal),
  ])
  const [vocabulary, units, destinations, terms] = settled
  if (vocabulary.status === "fulfilled") {
    patch.vocabulary = vocabulary.value
    patch.vocabulary_at = now
  }
  if (units.status === "fulfilled") {
    patch.units = units.value
    patch.units_at = now
  }
  if (destinations.status === "fulfilled") {
    patch.destinations = destinations.value
    patch.destinations_at = now
  }
  if (terms.status === "fulfilled") {
    patch.payment_terms = terms.value
    patch.payment_terms_at = now
  }
  if (Object.keys(patch).length > 0) save(patch)
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
      if (
        staleAt(state.cache.suppliers_at) &&
        !connectionDefersBulk()
      )
        jobs.push(refreshSuppliers())
      if (
        staleAt(state.cache.vocabulary_at) ||
        staleAt(state.cache.units_at) ||
        staleAt(state.cache.destinations_at) ||
        staleAt(state.cache.payment_terms_at)
      )
        jobs.push(refreshMasters())
      await Promise.allSettled(jobs)
    } finally {
      refreshing = null
    }
  })()
  return refreshing
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
