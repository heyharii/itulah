import {
  type FetchInfiniteQueryOptions,
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { useEffect } from "react"

import { cacheKey } from "@/lib/api"
import { isHiddenPath, moduleAllowed, screenForPath } from "@/lib/navigation"
import { jobRoleOf, type JobIdentity } from "@/lib/session"
import type { Identity } from "@itulah/contract/client"

/// Data a screen needs, asked for before the person gets there.
///
/// ## The idea
///
/// Opening a screen costs two waits in a row: the code (a lazy chunk) and then
/// the data (a request that only starts once the code has run). Both can begin
/// earlier. TanStack Router already fetches the chunk when a link is hovered or
/// touched (`defaultPreload: "intent"` in `routes.tsx`); every route there also
/// has a `loader` that calls `prefetchRoute` below, so the data starts moving in
/// the same moment — for every link in the app (rail, sub-menu, bottom bar,
/// launcher, ⌘K, a link in a screen) without any of them knowing.
///
/// A second path warms the most-used screens while the browser is idle after
/// sign-in (`startWarmup`).
///
/// ## Adding a screen — three lines
///
/// In `src/screens/<folder>/prefetch.ts` (one small file per department, which
/// is its own chunk, so a hover can start the request before the department's
/// screens have loaded):
///
///     export const prefetch: PrefetchMap = {
///       "/procurement/suppliers": (client) => warmQuery(client, suppliersOptions()),
///     }
///
/// Use the SAME options the screen's hook uses (`queryKey`, `queryFn`,
/// `staleTime`, `initialPageParam`...) so the screen finds the answer warm —
/// best by making the hook and the prefetcher share one options function. To
/// be warmed while idle too, add `export const warm = { "/path": 2 }` (lower
/// goes first). Persisting the answer across reloads is a separate, explicit
/// step: a rule in `lib/query-persist.ts`.
///
/// ## What never happens here
///
/// Never more than the first page of a list; never the slow endpoints
/// (`/inventory/control`, `/time-machine/*`, nothing
/// that exports or streams); nothing while offline, on a data-saver or a slow
/// connection, or for a department the person's role does not hold. A prefetch
/// that fails is dropped without a word — the screen asks again itself.

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
  context: PrefetchContext
) => Promise<unknown> | void

/// A screen's path to what it needs first.
export type PrefetchMap = Readonly<Record<string, Prefetcher>>

/// What a department's `prefetch.ts` exports.
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
  options: FetchQueryOptions<T, Error, T, K>
): Promise<void> {
  const resolved = client.defaultQueryOptions(options)
  note(outcomeOf(client, options.queryKey, resolved.staleTime))
  return client.prefetchQuery(options)
}

/// The same for a list that pages: the first page only.
export function warmInfinite<T, K extends QueryKey, P>(
  client: QueryClient,
  options: FetchInfiniteQueryOptions<T, Error, T, K, P>
): Promise<void> {
  // A list the person has scrolled keeps its pages: asking for "one page" of
  // it again would cut it back to one. The screen refreshes its own.
  const held = client.getQueryData<{ pages?: unknown[] }>(options.queryKey)
  if ((held?.pages?.length ?? 0) > 1) {
    note("fresh")
    return Promise.resolve()
  }
  const resolved = client.defaultQueryOptions(
    options as unknown as FetchQueryOptions
  )
  note(outcomeOf(client, options.queryKey, resolved.staleTime))
  // The options type is a union over both paging conventions (a page count
  // or a `getNextPageParam`), and spreading `pages: 1` over it leaves the
  // spread outside either half. It is the same options with a first-page
  // limit, which is what the server is asked for.
  return client.prefetchInfiniteQuery({
    ...options,
    pages: 1,
  } as unknown as FetchInfiniteQueryOptions<T, Error, T, K, P>)
}

/// An answer already in the cache, or one fetched now (for a prefetcher whose
/// next question depends on it: the Explorer's default period needs the
/// latest sales day). Rejects when the request does.
export function warmData<T, K extends QueryKey>(
  client: QueryClient,
  options: FetchQueryOptions<T, Error, T, K>
): Promise<T> {
  const resolved = client.defaultQueryOptions(options)
  note(outcomeOf(client, options.queryKey, resolved.staleTime))
  return client.ensureQueryData({
    ...options,
    revalidateIfStale: true,
  }) as Promise<T>
}

// ---------------------------------------------------------------------------
// Whether to
// ---------------------------------------------------------------------------

interface NetworkInformation {
  readonly saveData?: boolean
  readonly effectiveType?: string
}

/// The device, or the person's data plan, says "less": offline, a data saver,
/// a connection of 3G or slower.
function frugal(): boolean {
  if (typeof navigator === "undefined") return true
  if (navigator.onLine === false) return true
  const connection = (
    navigator as Navigator & { connection?: NetworkInformation }
  ).connection
  if (connection?.saveData === true) return true
  return (
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g" ||
    connection?.effectiveType === "3g"
  )
}

let client: QueryClient | null = null

/// Whether something may be fetched ahead of a person's intent right now:
/// signed in, online, no data saver, no slow connection.
export function intentAllowed(): boolean {
  return client !== null && signedIn() !== null && !frugal()
}

function signedIn(): Identity | null {
  return client?.getQueryData<Identity | null>(cacheKey.me()) ?? null
}

/// Whether this person may be offered the department of a path. The same check
/// as the menu: a hidden department is not warmed.
function allowed(me: Identity, path: string): boolean {
  const screen = screenForPath(path)
  if (screen === undefined || screen.module.soon || screen.soon) return false
  // A department this deployment leaves out of the menu is not warmed either.
  if (isHiddenPath(path)) return false
  const { code } = jobRoleOf(me)
  const wide = me as Identity & Partial<JobIdentity>
  return moduleAllowed(
    screen.module,
    (wide.sections ?? []) as JobIdentity["sections"],
    code === null || code === "OWNER" || code === "ADMIN"
  )
}

// ---------------------------------------------------------------------------
// The registry: one small file per department
// ---------------------------------------------------------------------------

const files = import.meta.glob<PrefetchModule>("../screens/*/prefetch.ts")

/// Every folder's module is loaded once, when first needed.
const loaded = new Map<string, Promise<PrefetchModule | undefined>>()

function moduleOf(folder: string): Promise<PrefetchModule | undefined> {
  let found = loaded.get(folder)
  if (found === undefined) {
    const load = files[`../screens/${folder}/prefetch.ts`]
    found = load === undefined ? Promise.resolve(undefined) : load()
    found = found.catch(() => undefined)
    loaded.set(folder, found)
  }
  return found
}

/// A path belongs to the folder named by its first segment (the same rule as
/// the screens in `routes.tsx`; the few that live elsewhere there have nothing
/// to prefetch).
const folderOf = (path: string) => path.split("/")[1] ?? ""

/// The SSR pass: a screen's own prefetcher, started on the server as the
/// signed-in person (the root route has already asked who that is) and not
/// waited for. The document's first bytes go out at once; each section of the
/// screen reads its query with a suspense hook, so the server streams that
/// section's HTML when its answer lands (`setupRouterSsrQueryIntegration`
/// carries the answer to the browser with it). Starting the queries here,
/// all at once, is what keeps sibling sections from asking one after another.
export async function prefetchOnServer(
  qc: QueryClient,
  path: string,
  search: Readonly<Record<string, unknown>>
): Promise<void> {
  const me = qc.getQueryData<Identity | null>(cacheKey.me()) ?? null
  if (me === null || !allowed(me, path)) return
  const prefetcher = (await moduleOf(folderOf(path)))?.prefetch[path]
  if (prefetcher === undefined) return
  try {
    await prefetcher(qc, { reason: "navigate", search })
  } catch {
    // The section that reads the query asks again, and shows why if it fails.
  }
}

/// When each path was last run, so a pointer wandering over a menu asks once.
const recent = new Map<string, number>()
const RECENT_MS = 2000

/// Run a screen's prefetcher. Called by the route loader (`routes.tsx`) with
/// `intent` for a hover or touch preload and `navigate` for the real thing.
/// Returns at once; nothing here is awaited by the router.
export function prefetchRoute(
  path: string,
  reason: PrefetchReason,
  search: Readonly<Record<string, unknown>> = {}
): void {
  const qc = client
  if (qc === null || signedIn() === null) return
  if (reason !== "navigate" && frugal()) return
  if (typeof navigator !== "undefined" && navigator.onLine === false) return
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
  context: PrefetchContext
): Promise<void> {
  const mod = await moduleOf(folderOf(path))
  const prefetcher = mod?.prefetch[path]
  if (prefetcher === undefined) return
  count(path, context.reason)
  try {
    await prefetcher(qc, context)
  } catch {
    // A prefetch is a favour: the screen asks again, and says why if it fails.
  }
}

/// ⌘K and anything else that moves by `navigate()` rather than a link: the row
/// under the cursor is preloaded (code and data) once it has rested for a
/// moment.
export function useIntentPreload(path: string | null, delay = 70): void {
  const router = useRouter()
  useEffect(() => {
    if (path === null) return
    const timer = window.setTimeout(() => {
      void router.preloadRoute({ to: path as never }).catch(() => undefined)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [router, path, delay])
}

// ---------------------------------------------------------------------------
// The idle warm-up
// ---------------------------------------------------------------------------

/// How many prefetchers run at once, and the pause before the next starts.
const CONCURRENCY = 2
const SPACING_MS = 600
/// How long the cache must have been quiet — nothing fetching but the
/// warm-up's own requests — before the warm-up may start, and may continue.
/// Not a fixed wait: the first screen lands when it lands, and a poll or a
/// slow export pushes the warm-up back rather than racing it (owner,
/// 2026-10-10: the old fixed 2.5 s wait "slowed the first screen").
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
  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
  ).requestIdleCallback
  if (typeof ric === "function") {
    const id = ric.call(window, work, { timeout })
    return () =>
      (
        window as Window & { cancelIdleCallback?: (id: number) => void }
      ).cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(work, Math.min(timeout, 1000))
  return () => window.clearTimeout(id)
}

async function warmAll(qc: QueryClient, me: Identity, live: () => boolean) {
  // Every department's list of what to warm, merged into one order.
  const modules = await Promise.all(
    Object.keys(files).map((file) => moduleOf(file.split("/")[2]))
  )
  const queue = modules
    .flatMap((mod) =>
      Object.entries(mod?.warm ?? {}).map(([path, order]) => ({
        path,
        order,
        mod,
      }))
    )
    .filter((one) => allowed(me, one.path))
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
/// browser has nothing better to do after sign-in. Called once, from
/// `signed-in.tsx` — the shell's own chunk, because everything here serves
/// screens and nothing here can run before there is a session.
///
/// "When the browser has nothing better to do" is measured, not guessed: the
/// cache reports every change, so the warm-up starts only after at least one
/// screen has ANSWERED since sign-in AND nothing has been fetching for
/// `QUIET_MS` — and its pump re-checks `busyElsewhere()` before every item.
/// A person who starts working resets the clock by existing; the warm-up
/// never costs their requests anything but queue position.
export function startPrefetch(qc: QueryClient): void {
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
      void warmAll(qc, me, () => !stopped && signedIn() !== null)
    }, 500)
    warming = {
      username: me.username,
      cancel: () => {
        stopped = true
        window.clearInterval(check)
      },
    }
  }

  qc.getQueryCache().subscribe((event) => {
    if (busyElsewhere()) {
      quietSince = null
    } else if (quietSince === null) {
      quietSince = Date.now()
    }
    if (
      event.type === "updated" &&
      event.query.state.dataUpdatedAt > 0 &&
      !(
        event.query.queryKey[0] === cacheKey.me()[0] &&
        event.query.queryKey[1] === cacheKey.me()[1]
      )
    ) {
      screenAnswered = true
    }

    if (event.type !== "updated") return
    const key = event.query.queryKey
    if (key[0] !== cacheKey.me()[0] || key[1] !== cacheKey.me()[1]) return
    considerStart()
  })

  // The shell calls this AFTER `/auth/me` has usually answered — a settled
  // answer fires no further event, so the same question is asked once here
  // rather than waiting for a change that may never come.
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
