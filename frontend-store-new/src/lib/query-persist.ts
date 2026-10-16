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
import type { Identity } from "@itulah/contract/client"

/// The query cache, kept on this device so a reload — or the shop PC switched
/// on in the morning — paints the last answer at once and then asks again.
///
/// The hub's `lib/query-persist.ts`, cut to this app: one node, no tenancy,
/// and the lists the shop opens with.
///
/// ## What is kept, and for whom
///
/// **An allowlist, not a blocklist.** Only the reads named in `PERSISTED` are
/// written down; a query nobody listed is never stored, so a screen added next
/// month cannot leak into IndexedDB by being written carelessly. Never kept,
/// whatever is listed: the session and the node's identity, anything relayed
/// from head office (people, pay, GA, Kabar — every key under `central`), the
/// drawer's cash, a mutation, a query that failed or has not answered. See
/// `NEVER`, which refuses a rule that names one.
///
/// **The store is tied to a person.** The key it is stored under (`busterOf`)
/// is the build, the signed-in username, role and site. A new build, another
/// person on the same counter, or another shop finds a store that is not
/// theirs and starts empty; and every way a session ends — signing out, a
/// lapsed session — ends in the cached identity becoming `null`, which wipes
/// the store (`reconcile`).
///
/// ## How it behaves
///
/// - Never in front of the first paint. The read of IndexedDB starts when this
///   module loads, while `/auth/me` is still in flight; the answer is hydrated
///   into the cache the moment it says who is here — before the screens mount
///   in the normal case. `hydrate` never overwrites an answer newer than the
///   stored one, so losing that race is safe. Nothing waits for storage: a
///   blocked or hung database means the app runs as it always has (reads give
///   up after `READ_GIVES_UP`).
/// - Written rarely: at most once in `THROTTLE` after a query succeeds, plus a
///   last write as the tab is hidden. Each query is its own record and only
///   those whose answer changed are rewritten.
/// - Bounded: `QUERY_CAP` per query (bigger is skipped), `TOTAL_CAP` in all
///   (oldest dropped first), and the newest `keep` of each rule.
/// - Entries older than `MAX_AGE` are not restored. The app's `gcTime` is
///   already a day (`lib/query-client.ts`), so a restored answer stays.
/// - Every storage error is swallowed. A private window, a full disk, a blocked
///   upgrade: persistence switches itself off and the app runs the same.
///
/// `staleTime` is each screen's own, so restored data paints at once and a
/// refetch in the background replaces it when it is older than that.

/// What may be kept. `prefix` is matched against the start of a query key;
/// `keep` is how many of the newest answers under it survive. A more specific
/// rule goes before the broader one it sits under: the first match wins.
interface PersistRule {
  readonly prefix: QueryKey
  readonly keep: number
}

const PERSISTED: readonly PersistRule[] = [
  // Catalogue: the price book, the final prices beside it, what runs today.
  { prefix: ["catalogue", "final-prices"], keep: 1 },
  { prefix: ["catalogue"], keep: 1 },
  { prefix: ["offers"], keep: 1 },
  // Stock: what is on hand, per pool and per SKU, and the ledger's first page.
  { prefix: ["inventory", "pools"], keep: 1 },
  { prefix: ["inventory", "sku-stock"], keep: 1 },
  { prefix: ["inventory", "movements"], keep: 2 },
  // Deliveries on their way here (the Receive list).
  { prefix: ["inbound", "list"], keep: 2 },
  // The dashboard's figures for the last few spans looked at: the chart, and
  // the best sellers — up to 300 receipts read one by one, which is the
  // slowest thing this app does and the one most worth not doing on a reload.
  // Never Money's day (`["sales", "window", ...]`): a drawer's takings.
  { prefix: ["sales", "dashboard", "trade"], keep: 3 },
  { prefix: ["sales", "dashboard", "basket"], keep: 4 },
  { prefix: ["sales", "dashboard", "hours"], keep: 2 },
]

/// First segments no rule may name. A guard against a rule written too wide,
/// not the list of what is allowed.
const NEVER: ReadonlySet<string> = new Set([
  "auth",
  "node",
  // Everything head office answers through the relay (`lib/cloud.ts`),
  // the cash counts among it.
  "central",
  // The drawer: shifts, sessions, drops, and the petty cash tin.
  "till",
  "petty",
])

const MAX_AGE = 24 * 60 * 60 * 1000
const THROTTLE = 1500
const TOTAL_CAP = 30 * 1024 * 1024
/// A shop's whole price book is one answer — 5,000 SKUs — so the cap per query
/// is higher than the hub's.
const QUERY_CAP = 8 * 1024 * 1024
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
      store = createStore("central-store", "query-cache")
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
  fallback: T,
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
      },
    )
  })
}

/// What is on disk, as last written: query hash to the answer stored for it
/// and its `dataUpdatedAt`, so a save writes only what changed.
///
/// Changed means a different answer, not a newer stamp. The catalogue refetches
/// every minute while it is open, and an unchanged book comes back as the same
/// object (`fetchCatalogue` returns the resident book; Query keeps an equal
/// answer's reference) — rewriting it each time would put a multi-megabyte
/// structured clone on the main thread once a minute, which is exactly the
/// jank `lib/queries.ts` declines to pay for a reload. The stamp alone is
/// refreshed at most once in `RESTAMP`, so an unchanged book is still young
/// enough to restore tomorrow morning.
const written = new Map<
  string,
  { readonly data: unknown; readonly at: number }
>()
const RESTAMP = 60 * 60 * 1000
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
      use,
    )
    const now = Date.now()
    const queries = records.filter(
      (one): one is DehydratedQueryRecord =>
        one !== undefined &&
        one.state?.data !== undefined &&
        ruleOf(one.queryKey) !== undefined &&
        now - one.state.dataUpdatedAt <= MAX_AGE,
    )
    written.clear()
    for (const one of queries)
      written.set(one.queryHash, {
        data: one.state.data,
        at: one.state.dataUpdatedAt,
      })
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

/// The first read, started with the module: it overlaps the round trip that
/// says who is signed in, and is spent once.
let preread: Promise<PersistedClient | undefined> | null =
  typeof indexedDB === "undefined" || switchedOff()
    ? null
    : within(readAll(), READ_GIVES_UP, undefined)

/// One save: the queries whose answer changed, the list of hashes, and the
/// removal of what is no longer kept. Inside `exclusive`, never on its own.
async function write(next: PersistedClient, use: UseStore): Promise<void> {
  const queries = next.clientState.queries
  const live = new Set(queries.map((one) => one.queryHash))
  const changed = queries.filter((one) => {
    const held = written.get(one.queryHash)
    return (
      held === undefined ||
      held.data !== one.state.data ||
      one.state.dataUpdatedAt - held.at > RESTAMP
    )
  })
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
          [entryKey(one.queryHash), one] as [string, DehydratedQueryRecord],
      ),
      ["meta", meta] as [string, Meta],
    ],
    use,
  )
  if (gone.length > 0) await delMany(gone.map(entryKey), use)
  for (const one of changed)
    written.set(one.queryHash, {
      data: one.state.data,
      at: one.state.dataUpdatedAt,
    })
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
  const trimmed = state.queries.filter(
    (one) => sizeOf(one.state.data) <= QUERY_CAP,
  )
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
/// a day. Counted by the rule each query actually falls under — a broad rule
/// must not count, and drop, the answers a narrower rule before it keeps
/// (`["catalogue"]` would otherwise take `["catalogue", "final-prices"]`).
function prune(client: QueryClient) {
  const cache = client.getQueryCache()
  for (const rule of PERSISTED) {
    const found = cache
      .findAll({ queryKey: rule.prefix })
      .filter(
        (query) =>
          query.state.data !== undefined && ruleOf(query.queryKey) === rule,
      )
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
  const site = "site_id" in me ? (me.site_id ?? "") : ""
  return [BUILD, me.username, me.role, site].join("|")
}

let engine: QueryClient | null = null
let active: string | null = null
let ready = false
let generation = 0
let timer: number | undefined
let lastBytes = 0

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
      use,
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
      ready = true
      schedule()
    })
}

/// Keep the stored cache in step with who is signed in: read it in once there
/// is somebody to give it to, and drop it the moment there is not.
function reconcile(client: QueryClient) {
  const me = client.getQueryData<Identity | null>(cacheKey.me())
  // Signed out (or the session lapsed): nothing of theirs stays on this
  // device for the next person at the counter.
  if (me === null) {
    if (active !== null || written.size > 0 || preread !== null)
      deactivate(true)
    else void persister.removeClient()
    return
  }
  const buster = busterOf(client)
  if (buster === null || buster === active) return
  // A different person in the same tab without a null in between.
  if (active !== null) deactivate(true)
  activate(client, buster)
}

/// Start persisting this client. Called once, from `App`.
export function startPersistence(client: QueryClient): void {
  if (engine !== null) return
  engine = client
  for (const rule of PERSISTED) {
    if (typeof rule.prefix[0] === "string" && NEVER.has(rule.prefix[0])) {
      throw new Error(`query-persist: "${rule.prefix[0]}" may never be stored`)
    }
  }
  if (typeof indexedDB === "undefined" || switchedOff()) return

  client.getQueryCache().subscribe((event) => {
    const key = event.query.queryKey
    if (key[0] === cacheKey.me()[0] && key[1] === cacheKey.me()[1]) {
      if (event.type === "updated") reconcile(client)
      return
    }
    if (active === null) return
    if (event.type === "updated" && event.action.type === "success") {
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
  // Who is signed in may already be in the cache; asked here rather than
  // awaited.
  reconcile(client)
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__persistStats = () => ({
      active,
      ready,
      stored: written.size,
      bytes: lastBytes,
      broken,
    })
  }
}
