import {
  partialMatchKey,
  dehydrate,
  type DehydratedState,
  type Query,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query"
import {
  persistQueryClientRestore,
  type PersistedClient,
  type Persister,
} from "@tanstack/react-query-persist-client"
import {
  clear as clearStore,
  createStore,
  delMany,
  get as getValue,
  getMany,
  setMany,
  type UseStore,
} from "idb-keyval"

import { cacheKey } from "@/lib/api"
import { tenancyQueryKey, type TenancyState } from "@/lib/tenancy"
import type { Identity } from "@itulah/contract/client"

/// The query cache, kept on this device so a reload or a cold start paints the
/// last answer at once and then asks again.
///
/// ## What is kept, and for whom
///
/// **An allowlist, not a blocklist.** Only the list and read queries named in
/// `PERSISTED` below are written down; a query nobody listed is never stored,
/// so a screen added next month cannot leak into IndexedDB by being written
/// carelessly. Never kept, whatever is listed: the session, tenancy and node
/// identity, anything of HR, payroll or people, a mutation, a query that failed
/// or has not answered. See `NEVER`, which refuses a rule that names one.
///
/// **Cost and profit figures are in this cache.** The Sales Explorer's rows
/// carry them for a role that may see cost, and that is the reason the store is
/// tied to a person: the key it is stored under (`busterOf`) is the build, the
/// signed-in username and role, and the sandbox business. A new build, another
/// person or another business finds a store that is not theirs and starts
/// empty, and every way a session ends — signing out, being pushed out by a
/// sign-in elsewhere, tenancy letting go of the business, a lapsed session —
/// ends in the cached identity becoming `null`, which wipes the store
/// (`reconcile`). One rule, so a sign-out path added later is covered too.
///
/// ## How it behaves
///
/// - Never in front of the first paint. The read of IndexedDB starts when this
///   module starts, while `/auth/me` and the tenancy question are still in
///   flight; the answer is hydrated into the cache the moment both have said
///   who is here — before the screens mount in the normal case, and streamed
///   in without blocking when it is slower. `hydrate` never overwrites an
///   answer that is newer than the stored one, so losing that race is safe.
///   Nothing waits for storage: a blocked or hung database means the app runs
///   as it always has (reads give up after `READ_GIVES_UP`).
/// - Written rarely: at most once in `THROTTLE` after a query succeeds, plus a
///   last write as the tab is hidden. Each query is its own record and only
///   those whose answer changed are rewritten.
/// - Bounded: `QUERY_CAP` per query (bigger is skipped), `TOTAL_CAP` in all
///   (oldest dropped first), the newest `keep` of each rule (six Explorer
///   questions, say), and an infinite list keeps its first page — a restored
///   list that remembered forty pages would ask the server for forty on mount.
/// - Entries older than `MAX_AGE` are not restored, and the queries kept have
///   `gcTime` of the same length (`setQueryDefaults` below), or the restored
///   cache would be garbage-collected within five minutes of being read.
/// - Every storage error is swallowed. Private windows, a full disk, a blocked
///   upgrade: persistence switches itself off and the app runs the same.
///
/// `staleTime` is each screen's own, so restored data paints at once and a
/// refetch in the background replaces it when it is older than that.

/// What may be kept. `prefix` is matched against the start of a query key;
/// `keep` is how many of the newest answers under it survive (and stay in
/// memory — see `prune`). Add a screen's list here to have it persisted.
export interface PersistRule {
  readonly prefix: QueryKey
  readonly keep: number
}

export const PERSISTED: readonly PersistRule[] = [
  // Sales Explorer: its options, and the last few questions asked. The rows
  // carry cost and margin for a role that may see them.
  { prefix: ["sales", "explorer", "options"], keep: 1 },
  { prefix: ["sales", "explorer", "rows"], keep: 6 },
  // One block per department, each edited by whoever wires that department.
  // procurement: the order book (one entry per tab) and the supplier book.
  { prefix: ["procurement", "purchase-orders", "page"], keep: 3 },
  { prefix: ["procurement", "suppliers", "scoped"], keep: 3 },
  // operations: the warehouse's lists (the cloud's own, or a DC node's answers
  // to this person — the store is theirs alone, see `busterOf`). A more
  // specific rule goes before the broader one it sits under (the first match
  // wins). Never a sheet's record: a manifest, a pick session, an order.
  { prefix: ["dc", "purchase-work", "summary"], keep: 1 },
  { prefix: ["dc", "purchase-work"], keep: 2 },
  { prefix: ["dc", "purchase-counts"], keep: 1 },
  { prefix: ["dc", "store-inbound", "IN_TRANSIT"], keep: 1 },
  { prefix: ["dc", "picklists-to-pick"], keep: 1 },
  { prefix: ["dc", "picklists"], keep: 1 },
  { prefix: ["dc", "short-picks"], keep: 1 },
  // Every carton, and the ready ones: two filters. `{}` matches any filter but
  // not a carton's manifest (`["dc", "koli", id, "manifest"]`).
  { prefix: ["dc", "koli", {}], keep: 2 },
  { prefix: ["inventory", "fleet-pools"], keep: 1 },
  // inventory: what Stock, Exceptions, Counts, Movements and On Hand open with
  // (the fleet read is kept by the rule above). Reads only: never a count, a
  // pool or an allotment record, and never the whole-catalogue availability the
  // allotment matrix walks (`["inventory", "availability", "whole", ...]`).
  // The movements rule names the screen's page size, so a case sheet's own
  // five-row read of the ledger does not take its place.
  { prefix: ["inventory", "missing", "scoped"], keep: 2 },
  { prefix: ["inventory", "shipments-received"], keep: 1 },
  { prefix: ["inventory", "allotments", "list"], keep: 2 },
  { prefix: ["inventory", "counts", "scoped"], keep: 3 },
  { prefix: ["inventory", "movements", "scoped", { limit: 100 }], keep: 2 },
  { prefix: ["inventory", "availability", "dc.warehouse", ""], keep: 2 },
  // marketing: the pages Promotions, Campaigns, the Pricelist, Changes and
  // History open with, and the small reads whose figures sit in their rows.
  // The pricelist's rows carry cost for a role that may see it (the store is
  // that person's alone, see `busterOf`). Never the Vouchers list: a voucher
  // code is money to whoever holds it, and the rows name members. Never a
  // sheet's record (one campaign, one book, one article's history).
  { prefix: ["commercial", "rules", "pages"], keep: 2 },
  { prefix: ["commercial", "campaigns", "pages"], keep: 2 },
  { prefix: ["commercial", "article-prices", "STORE", null], keep: 2 },
  { prefix: ["commercial", "usage"], keep: 1 },
  { prefix: ["commercial", "activation"], keep: 1 },
  { prefix: ["commercial", "intent", "all"], keep: 1 },
  { prefix: ["commercial", "price-changes"], keep: 2 },
  { prefix: ["commercial", "price-events", "pages"], keep: 2 },
  // master: the catalogue's first page and the words its screens are drawn
  // with, one list each. The vocabulary rules also hold a term's usage count
  // (`["vocabulary", kind, code, "usage"]`), hence a few kept apiece.
  { prefix: ["articles", "list"], keep: 2 },
  { prefix: ["procurement", "catalogue", "vocabulary"], keep: 1 },
  { prefix: ["colours", "list"], keep: 1 },
  { prefix: ["vocabulary", "divisions"], keep: 3 },
  { prefix: ["vocabulary", "tags"], keep: 3 },
  { prefix: ["vocabulary", "sizes"], keep: 3 },
  { prefix: ["name-suggestions", "master"], keep: 1 },
  { prefix: ["procurement", "payment-terms"], keep: 1 },
]

/// First segments no rule may name. A guard against a rule written too wide,
/// not the list of what is allowed.
const NEVER: ReadonlySet<string> = new Set([
  "auth",
  "tenancy",
  "node",
  "edge",
  "hr",
  "people",
  "payroll",
  "pay",
  "employees",
  "employment",
  "setup",
  "assistant",
  "search",
  "push",
])

const MAX_AGE = 24 * 60 * 60 * 1000
const THROTTLE = 1500
const TOTAL_CAP = 20 * 1024 * 1024
const QUERY_CAP = 2 * 1024 * 1024
const READ_GIVES_UP = 2000

declare const __BUILD_ID__: string | undefined
const BUILD = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev"

type DehydratedQueryRecord = DehydratedState["queries"][number]

interface Meta {
  readonly buster: string
  readonly timestamp: number
  readonly hashes: readonly string[]
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/// The database, opened on first use. `null` once storage has failed anywhere:
/// from then on nothing here touches it.
let store: UseStore | null | undefined
let broken = false

function db(): UseStore | null {
  if (broken) return null
  if (store === undefined) {
    try {
      store = createStore("central-hub", "query-cache")
    } catch {
      broken = true
      store = null
    }
  }
  return store ?? null
}

/// Every storage call goes through here: serial (so a wipe cannot be overtaken
/// by a write that was already queued), never throwing, and giving the store
/// up for good on its first failure.
let tail: Promise<unknown> = Promise.resolve()
function exclusive<T>(
  work: (use: UseStore) => Promise<T>,
  fallback: T
): Promise<T> {
  const run = tail.then(async () => {
    const use = db()
    if (use === null) return fallback
    try {
      return await work(use)
    } catch {
      broken = true
      return fallback
    }
  })
  tail = run.catch(() => undefined)
  return run
}

function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms)
    work.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      () => {
        window.clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

/// What is on disk, as last written: query hash to the `dataUpdatedAt` stored
/// for it, so a save writes only what changed.
const written = new Map<string, number>()
const entryKey = (hash: string) => `q:${hash}`

function ruleOf(key: QueryKey): PersistRule | undefined {
  return PERSISTED.find((rule) => partialMatchKey(key, rule.prefix))
}

async function readAll(): Promise<PersistedClient | undefined> {
  return exclusive<PersistedClient | undefined>(async (use) => {
    const meta = await getValue<Meta>("meta", use)
    if (meta === undefined || !Array.isArray(meta.hashes)) return undefined
    const records = await getMany<DehydratedQueryRecord>(
      meta.hashes.map(entryKey),
      use
    )
    const now = Date.now()
    const queries = records.filter(
      (one): one is DehydratedQueryRecord =>
        one !== undefined &&
        one.state?.data !== undefined &&
        ruleOf(one.queryKey) !== undefined &&
        now - one.state.dataUpdatedAt <= MAX_AGE
    )
    written.clear()
    for (const one of queries)
      written.set(one.queryHash, one.state.dataUpdatedAt)
    return {
      timestamp: meta.timestamp,
      buster: meta.buster,
      clientState: { mutations: [], queries },
    }
  }, undefined)
}

/// A switch for support and for measuring a cold start: with
/// `localStorage["itulah.persist.off"] = "1"` nothing is read or written.
function switchedOff(): boolean {
  try {
    return localStorage.getItem("itulah.persist.off") === "1"
  } catch {
    return false
  }
}

/// The first read, started with the module: it overlaps the network round
/// trips that say who is signed in, and is spent once.
let preread: Promise<PersistedClient | undefined> | null =
  typeof indexedDB === "undefined" || switchedOff()
    ? null
    : within(readAll(), READ_GIVES_UP, undefined)

/// One save: the queries whose answer changed, the list of hashes, and the
/// removal of what is no longer kept. Inside `exclusive`, never on its own.
async function write(next: PersistedClient, use: UseStore): Promise<void> {
  const queries = next.clientState.queries
  const live = new Set(queries.map((one) => one.queryHash))
  const changed = queries.filter(
    (one) => written.get(one.queryHash) !== one.state.dataUpdatedAt
  )
  const gone = [...written.keys()].filter((hash) => !live.has(hash))
  const meta: Meta = {
    buster: next.buster,
    timestamp: next.timestamp,
    hashes: queries.map((one) => one.queryHash),
  }
  await setMany(
    [
      ...changed.map(
        (one) =>
          [entryKey(one.queryHash), one] as [string, DehydratedQueryRecord]
      ),
      ["meta", meta] as [string, Meta],
    ],
    use
  )
  if (gone.length > 0) await delMany(gone.map(entryKey), use)
  for (const one of changed) written.set(one.queryHash, one.state.dataUpdatedAt)
  for (const hash of gone) written.delete(hash)
}

const persister: Persister = {
  restoreClient: async () => {
    const early = preread
    preread = null
    return early !== null ? early : within(readAll(), READ_GIVES_UP, undefined)
  },
  persistClient: (next) => exclusive((use) => write(next, use), undefined),
  removeClient: () =>
    exclusive(async (use) => {
      await clearStore(use)
      written.clear()
    }, undefined),
}

// ---------------------------------------------------------------------------
// What a save writes
// ---------------------------------------------------------------------------

const sizes = new WeakMap<object, number>()
function sizeOf(data: unknown): number {
  if (typeof data !== "object" || data === null) return 0
  const known = sizes.get(data)
  if (known !== undefined) return known
  let size = Number.POSITIVE_INFINITY
  try {
    size = JSON.stringify(data).length
  } catch {
    // Not plain data: not stored.
  }
  sizes.set(data, size)
  return size
}

/// An infinite list is kept as its first page.
function firstPage(data: unknown): unknown {
  if (
    typeof data === "object" &&
    data !== null &&
    Array.isArray((data as { pages?: unknown }).pages) &&
    (data as { pages: unknown[] }).pages.length > 1
  ) {
    const infinite = data as { pages: unknown[]; pageParams?: unknown[] }
    return {
      pages: infinite.pages.slice(0, 1),
      pageParams: (infinite.pageParams ?? []).slice(0, 1),
    }
  }
  return data
}

function keepable(query: Query): boolean {
  return (
    query.state.status === "success" &&
    query.state.data !== undefined &&
    query.meta?.persist !== false &&
    ruleOf(query.queryKey) !== undefined
  )
}

/// The cache as a save writes it: allowlisted successes only, each under its
/// size cap, the newest `keep` of each rule, the whole under `TOTAL_CAP`.
function snapshot(client: QueryClient): DehydratedState {
  const state = dehydrate(client, {
    shouldDehydrateQuery: keepable,
    shouldDehydrateMutation: () => false,
  })
  const trimmed: DehydratedQueryRecord[] = []
  for (const one of state.queries) {
    const data = firstPage(one.state.data)
    if (sizeOf(data) > QUERY_CAP) continue
    trimmed.push(
      data === one.state.data
        ? one
        : { ...one, state: { ...one.state, data } as typeof one.state }
    )
  }
  // Newest first, so every cut below drops the oldest.
  trimmed.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
  const perRule = new Map<PersistRule, number>()
  const kept: DehydratedQueryRecord[] = []
  let total = 0
  for (const one of trimmed) {
    const rule = ruleOf(one.queryKey)
    if (rule === undefined) continue
    const seen = perRule.get(rule) ?? 0
    if (seen >= rule.keep) continue
    const size = sizeOf(one.state.data)
    if (total + size > TOTAL_CAP) continue
    perRule.set(rule, seen + 1)
    total += size
    kept.push(one)
  }
  lastBytes = total
  return { mutations: [], queries: kept }
}

/// Inactive answers beyond a rule's `keep` leave memory too: their `gcTime` is
/// a day, and a hundred Explorer questions are a hundred megabytes.
function prune(client: QueryClient) {
  const cache = client.getQueryCache()
  for (const rule of PERSISTED) {
    const found = cache
      .findAll({ queryKey: rule.prefix })
      .filter((query) => query.state.data !== undefined)
    if (found.length <= rule.keep) continue
    found.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
    for (const query of found.slice(rule.keep)) {
      if (query.getObserversCount() === 0) cache.remove(query)
    }
  }
}

// ---------------------------------------------------------------------------
// Whose store it is
// ---------------------------------------------------------------------------

function busterOf(client: QueryClient): string | null {
  const me = client.getQueryData<Identity | null>(cacheKey.me())
  if (me === undefined || me === null) return null
  const tenancy = client.getQueryData<TenancyState>(tenancyQueryKey)
  // Not asked yet: whose business this is cannot be said, so nothing is read.
  if (tenancy === undefined) return null
  const business =
    tenancy.mode === "sandbox" ? (tenancy.business?.slug ?? "none") : "single"
  const wide = me as Identity & { role_code?: string }
  return [BUILD, wide.username, wide.role_code ?? "", business].join("|")
}

let engine: QueryClient | null = null
let active: string | null = null
let ready = false
let generation = 0
let timer: number | undefined
let lastBytes = 0

/// Hashes whose data is the copy read back from this device, until something
/// fetches them again. `RefreshStamp` says so beside the time.
const restored = new Set<string>()

/// True while a query's data is the copy this device restored from its last
/// visit and nothing has fetched it again since: the data is old and the
/// screen should say so.
export function isRestored(queryHash: string): boolean {
  return restored.has(queryHash)
}

function save() {
  if (engine === null || active === null || !ready) return
  window.clearTimeout(timer)
  timer = undefined
  const client = engine
  const buster = active
  const mine = generation
  prune(client)
  // Checked again where the write happens, after anything queued before it:
  // a sign-out in between must not be followed by this save.
  void exclusive(async (use) => {
    if (mine !== generation) return
    await write(
      {
        buster,
        timestamp: Date.now(),
        clientState: snapshot(client),
      },
      use
    )
  }, undefined)
}

function schedule() {
  if (!ready || timer !== undefined) return
  timer = window.setTimeout(() => {
    timer = undefined
    save()
  }, THROTTLE)
}

function deactivate(wipe: boolean) {
  generation += 1
  active = null
  ready = false
  window.clearTimeout(timer)
  timer = undefined
  restored.clear()
  preread = null
  if (wipe) void persister.removeClient()
}

function activate(client: QueryClient, buster: string) {
  generation += 1
  const mine = generation
  active = buster
  ready = false
  persistQueryClientRestore({
    queryClient: client,
    persister,
    buster,
    maxAge: MAX_AGE,
  })
    .catch(() => undefined)
    .then(() => {
      if (mine !== generation) return
      // What came back, so the stamp can say it is old.
      for (const hash of written.keys()) restored.add(hash)
      ready = true
      schedule()
    })
}

/// Keep the stored cache in step with who is signed in: read it in once there
/// is somebody to give it to, and drop it the moment there is not.
function reconcile(client: QueryClient) {
  const me = client.getQueryData<Identity | null>(cacheKey.me())
  // Signed out (or pushed out, or the business is gone): nothing of theirs
  // stays on this device.
  if (me === null) {
    if (active !== null || written.size > 0 || preread !== null)
      deactivate(true)
    else void persister.removeClient()
    return
  }
  const buster = busterOf(client)
  if (buster === null || buster === active) return
  // A different person or business in the same tab without a null in between.
  if (active !== null) deactivate(true)
  activate(client, buster)
}

/// Start persisting this client. Called once, from `App`, after hydration.
export function startPersistence(client: QueryClient): void {
  if (engine !== null) return
  engine = client
  for (const rule of PERSISTED) {
    if (typeof rule.prefix[0] === "string" && NEVER.has(rule.prefix[0])) {
      throw new Error(`query-persist: "${rule.prefix[0]}" may never be stored`)
    }
    // As long as the data may be restored, or the restored cache would be
    // garbage-collected within five minutes of being read.
    client.setQueryDefaults(rule.prefix, { gcTime: MAX_AGE })
  }
  if (typeof indexedDB === "undefined" || switchedOff()) return

  client.getQueryCache().subscribe((event) => {
    const key = event.query.queryKey
    if (key[0] === cacheKey.me()[0] && key[1] === cacheKey.me()[1]) {
      if (event.type === "updated") reconcile(client)
      return
    }
    if (key[0] === tenancyQueryKey[0]) {
      if (event.type === "updated") reconcile(client)
      return
    }
    if (active === null) return
    if (event.type === "updated" && event.action.type === "success") {
      restored.delete(event.query.queryHash)
      if (keepable(event.query)) schedule()
    } else if (event.type === "removed" || event.type === "added") {
      if (ruleOf(key) !== undefined) schedule()
    }
  })
  // The tab going away is the last chance to write what the throttle holds.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save()
  })
  window.addEventListener("pagehide", save)
  // Started after hydration (`App`): who is signed in is already in the
  // cache, so the first reconcile is asked here rather than awaited.
  reconcile(client)
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__persistStats = () => ({
      active,
      ready,
      restored: restored.size,
      stored: written.size,
      bytes: lastBytes,
      broken,
    })
  }
}
