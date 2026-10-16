import type {
  FetchQueryOptions,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query"

import { cacheKey } from "@/lib/api"
import type { Identity } from "@itulah/contract/client"

/// Data a screen needs, asked for before the person gets there.
///
/// The hub's `lib/prefetch.ts` without its server half: this app is files the
/// shop's node serves, so every loader runs in the browser.
///
/// ## The idea
///
/// Opening a screen costs two waits in a row: its code (a lazy chunk) and then
/// its data, which only starts once the code has run. Both can begin earlier.
/// The router already fetches the chunk when a link is hovered, touched or
/// focused (`defaultPreload: "intent"` in `routes.tsx`); every route there also
/// has a `loader` that calls `prefetchRoute` below, so the data starts moving
/// in the same moment — for every link in the app (rail, sidebar, bottom bar,
/// a link inside a screen) without any of them knowing.
///
/// A second path warms the screens the shop opens most while the browser is
/// idle after sign-in (`startPrefetch`).
///
/// ## Adding a screen
///
/// In `src/prefetch/<first path segment>.ts` (one small file per module, its
/// own chunk, so a hover starts the request before the module's screens have
/// loaded):
///
///     export const prefetch: PrefetchMap = {
///       "/stock": (client) => warmQuery(client, poolsQuery()),
///     }
///
/// with the SAME options function the screen's hook uses, so the screen finds
/// the answer warm under the same key, fetched the same way. To be warmed while
/// idle too, add `export const warm = { "/stock": 2 }` (lower goes first) — but
/// only for a screen this node answers itself. A head-office screen is relayed
/// over the shop's line, and warming it spends that line on a page nobody has
/// opened.
///
/// ## What never happens here
///
/// Nothing while offline or on a data saver; never more than what the screen
/// draws first; never a write. A prefetch that fails is dropped without a word
/// — the screen asks again itself, and says why if it fails.

/// Why a prefetcher is being run.
export type PrefetchReason =
  /// A pointer, a finger or the keyboard reached a link to the screen.
  | "intent"
  /// The screen is being navigated to now (the loader of its route).
  | "navigate"
  /// The idle warm-up after sign-in.
  | "warm"

export interface PrefetchContext {
  readonly reason: PrefetchReason
  /// The address-bar search of the destination when it is being navigated to
  /// (`navigate`); empty for intent and warm-up. A screen whose state lives in
  /// the URL prefetches only its default, and nothing when the URL differs.
  readonly search: Readonly<Record<string, unknown>>
}

export type Prefetcher = (
  client: QueryClient,
  context: PrefetchContext,
) => Promise<unknown> | void

/// A screen's path to what it needs first.
export type PrefetchMap = Readonly<Record<string, Prefetcher>>

/// What a module's `prefetch/<segment>.ts` exports.
export interface PrefetchModule {
  readonly prefetch: PrefetchMap
  /// Paths to warm while idle, and their order across the whole app (lower
  /// first). A path absent here is prefetched on intent only.
  readonly warm?: Readonly<Record<string, number>>
}

// ---------------------------------------------------------------------------
// Helpers a prefetcher uses
// ---------------------------------------------------------------------------

/// What happened to a request, for `window.__prefetchStats` (development).
type Outcome = "fetched" | "fresh"

function outcomeOf(client: QueryClient, key: QueryKey, staleTime: unknown) {
  const query = client.getQueryCache().find({ queryKey: key, exact: true })
  if (query === undefined || query.state.data === undefined) return "fetched"
  const time = typeof staleTime === "number" ? staleTime : 0
  return query.isStaleByTime(time) ? "fetched" : "fresh"
}

/// Fetch a query unless it is already fresh, and wait for it. The options are
/// the screen's own.
export function warmQuery<T, K extends QueryKey>(
  client: QueryClient,
  options: FetchQueryOptions<T, Error, T, K>,
): Promise<void> {
  const resolved = client.defaultQueryOptions(options)
  note(outcomeOf(client, options.queryKey, resolved.staleTime))
  return client.prefetchQuery(options)
}

// ---------------------------------------------------------------------------
// Whether to
// ---------------------------------------------------------------------------

interface NetworkInformation {
  readonly saveData?: boolean
}

/// The device, or the person's data plan, says "less": offline or a data
/// saver. Not the connection's speed, as the hub reads it: the node is in the
/// shop, and the browser's guess at the line is a guess at the internet, not
/// at the machine behind the counter.
function frugal(): boolean {
  if (navigator.onLine === false) return true
  const connection = (
    navigator as Navigator & { connection?: NetworkInformation }
  ).connection
  return connection?.saveData === true
}

let client: QueryClient | null = null

function signedIn(): Identity | null {
  return client?.getQueryData<Identity | null>(cacheKey.me()) ?? null
}

// ---------------------------------------------------------------------------
// The registry: one small file per module
// ---------------------------------------------------------------------------

const files = import.meta.glob<PrefetchModule>("../prefetch/*.ts")

/// Every module's file is loaded once, when first needed.
const loaded = new Map<string, Promise<PrefetchModule | undefined>>()

function moduleOf(segment: string): Promise<PrefetchModule | undefined> {
  let found = loaded.get(segment)
  if (found === undefined) {
    const load = files[`../prefetch/${segment}.ts`]
    found = load === undefined ? Promise.resolve(undefined) : load()
    found = found.catch(() => undefined)
    loaded.set(segment, found)
  }
  return found
}

/// A path's file is named by its first segment: `/money/sales` → `money.ts`.
const segmentOf = (path: string) => path.split("/")[1] ?? ""

/// When each path was last run, so a pointer wandering over a menu asks once.
const recent = new Map<string, number>()
const RECENT_MS = 2000

/// Run a screen's prefetcher. Called by the route loader (`routes.tsx`) with
/// `intent` for a hover or touch preload and `navigate` for the real thing.
/// Returns at once; nothing here is awaited by the router.
export function prefetchRoute(
  path: string,
  reason: PrefetchReason,
  search: Readonly<Record<string, unknown>> = {},
): void {
  const qc = client
  if (qc === null || signedIn() === null) return
  if (reason !== "navigate" && frugal()) return
  if (navigator.onLine === false) return
  const now = Date.now()
  const last = recent.get(path)
  if (last !== undefined && now - last < RECENT_MS && reason !== "navigate")
    return
  recent.set(path, now)
  void run(qc, path, { reason, search })
}

async function run(
  qc: QueryClient,
  path: string,
  context: PrefetchContext,
): Promise<void> {
  const mod = await moduleOf(segmentOf(path))
  const prefetcher = mod?.prefetch[path]
  if (prefetcher === undefined) return
  count(path, context.reason)
  try {
    await prefetcher(qc, context)
  } catch {
    // A prefetch is a favour: the screen asks again, and says why if it fails.
  }
}

// ---------------------------------------------------------------------------
// The idle warm-up
// ---------------------------------------------------------------------------

/// How many prefetchers run at once, and the pause before the next starts.
const CONCURRENCY = 2
const SPACING_MS = 600
/// How long the cache must have been quiet — nothing fetching but the
/// warm-up's own requests — before the warm-up may start, and may continue.
/// Not a fixed wait: the first screen lands when it lands, and a poll pushes
/// the warm-up back rather than racing it.
const QUIET_MS = 1500

let warming: { username: string; cancel: () => void } | null = null

/// Fetches the warm-up itself started, subtracted from the client's count so
/// its own traffic never counts as the person's.
let warmFetches = 0

/// Whether anything the warm-up did not start is in flight right now: the
/// person's screen, a poll, a sheet's fetch. The warm-up starts only in the
/// gaps this leaves, and pauses the moment a gap closes.
function busyElsewhere(): boolean {
  return (client?.isFetching() ?? 0) - warmFetches > 0
}

function idle(work: () => void, timeout: number): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(work, { timeout })
    return () => window.cancelIdleCallback(id)
  }
  // Safari has no idle callback.
  const id = window.setTimeout(work, Math.min(timeout, 1000))
  return () => window.clearTimeout(id)
}

async function warmAll(qc: QueryClient, live: () => boolean) {
  // Every module's list of what to warm, merged into one order.
  const modules = await Promise.all(
    Object.keys(files).map((file) =>
      moduleOf(file.slice("../prefetch/".length, -".ts".length)),
    ),
  )
  const queue = modules
    .flatMap((mod) =>
      Object.entries(mod?.warm ?? {}).map(([path, order]) => ({
        path,
        order,
        mod,
      })),
    )
    .sort((a, b) => a.order - b.order)

  let running = 0
  let next = 0
  await new Promise<void>((finish) => {
    const pump = () => {
      if (!live()) return finish()
      if (next >= queue.length && running === 0) return finish()
      while (running < CONCURRENCY && next < queue.length) {
        // A hidden tab, a lost connection, a data saver — or, above all, a
        // request of the person's own still in flight — pauses the warm-up
        // rather than competing with it. The queue waits for the next gap.
        if (document.hidden || frugal() || busyElsewhere()) {
          window.setTimeout(pump, 800)
          return
        }
        const { path, mod } = queue[next++]
        const prefetcher = mod?.prefetch[path]
        if (prefetcher === undefined) continue
        running += 1
        warmFetches += 1
        count(path, "warm")
        idle(() => {
          Promise.resolve()
            .then(() => prefetcher(qc, { reason: "warm", search: {} }))
            .catch(() => undefined)
            .finally(() => {
              warmFetches -= 1
              running -= 1
              window.setTimeout(pump, SPACING_MS)
            })
        }, 3000)
      }
    }
    pump()
  })
}

/// Hook the prefetcher to this client and warm the most-used screens when the
/// browser has nothing better to do after sign-in. Called once, from `App`.
///
/// "When the browser has nothing better to do" is measured, not guessed: the
/// cache reports every change, so the warm-up starts only after at least one
/// screen has ANSWERED since sign-in AND nothing has been fetching for
/// `QUIET_MS` — and its pump re-checks `busyElsewhere()` before every item.
/// Somebody who starts working resets the clock by existing; the warm-up never
/// costs their requests anything but queue position.
export function startPrefetch(qc: QueryClient): void {
  if (client !== null) return
  client = qc
  if (import.meta.env.DEV) installStats()

  // The quiet clock: when the cache last had nothing fetching but the
  // warm-up's own. `null` means something else is in flight right now.
  let quietSince: number | null = null
  // The first screen's own answers have landed — the gate that stops the
  // warm-up from starting in the instant between "signed in" and "screen
  // mounted", when the cache is briefly, deceptively, empty.
  let screenAnswered = false

  /// Whether a warm-up should be running for whoever is signed in, given the
  /// clocks above. Called on every identity answer, and once at startup.
  const considerStart = () => {
    const me = qc.getQueryData<Identity | null>(cacheKey.me())
    if (me === undefined) return
    if (me === null) {
      warming?.cancel()
      warming = null
      recent.clear()
      return
    }
    if (warming?.username === me.username) return
    warming?.cancel()
    let stopped = false
    const check = window.setInterval(() => {
      if (stopped) return
      if (
        quietSince === null ||
        Date.now() - quietSince < QUIET_MS ||
        !screenAnswered ||
        frugal()
      ) {
        return
      }
      window.clearInterval(check)
      void warmAll(qc, () => !stopped && signedIn() !== null)
    }, 500)
    warming = {
      username: me.username,
      cancel: () => {
        stopped = true
        window.clearInterval(check)
      },
    }
  }

  const isMe = (key: QueryKey) =>
    key[0] === cacheKey.me()[0] && key[1] === cacheKey.me()[1]

  qc.getQueryCache().subscribe((event) => {
    if (busyElsewhere()) {
      quietSince = null
    } else if (quietSince === null) {
      quietSince = Date.now()
    }
    if (
      event.type === "updated" &&
      event.query.state.dataUpdatedAt > 0 &&
      !isMe(event.query.queryKey)
    ) {
      screenAnswered = true
    }
    if (event.type === "updated" && isMe(event.query.queryKey)) considerStart()
  })

  // Usually called after `/auth/me` has answered — a settled answer fires no
  // further event, so the same question is asked once here rather than
  // waiting for a change that may never come.
  considerStart()
}

// ---------------------------------------------------------------------------
// Development statistics: `window.__prefetchStats`
// ---------------------------------------------------------------------------

interface Stats {
  runs: Record<string, number>
  intent: number
  navigate: number
  warm: number
  fetched: number
  fresh: number
}

const stats: Stats = {
  runs: {},
  intent: 0,
  navigate: 0,
  warm: 0,
  fetched: 0,
  fresh: 0,
}

function count(path: string, reason: PrefetchReason) {
  if (!import.meta.env.DEV) return
  stats.runs[path] = (stats.runs[path] ?? 0) + 1
  stats[reason] += 1
}

function note(outcome: Outcome) {
  if (!import.meta.env.DEV) return
  stats[outcome] += 1
}

function installStats() {
  ;(window as unknown as Record<string, unknown>).__prefetchStats = stats
}
