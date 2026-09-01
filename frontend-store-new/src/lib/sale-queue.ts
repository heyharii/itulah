import { useSyncExternalStore } from "react"

import { node } from "@/lib/api"
import { queryClient } from "@/lib/query-client"
import { inventoryKey, salesKey } from "@/lib/queries"
import { ApiError, idempotencyKey } from "@itulah/contract/client"
import type { SaleRequest, SaleResult, SaleTender } from "@itulah/contract"

/// The outbox for money.
///
/// Offline is not a degraded mode for a till, it is the ordinary Tuesday: the
/// node is behind the counter and the shop keeps trading whatever the tunnel to
/// head office is doing. But "the node is in the shop" is not the same as "the
/// browser can always reach it" — the tablet walks out of wifi range, the
/// counter's switch is rebooted, the browser is killed and reopened. A sale
/// that only existed as an in-flight `fetch` is gone in all three cases, and
/// what was lost is money that was already taken from a customer.
///
/// So a completed sale is **written to disk before it is sent**, and the
/// sending is a separate, retrying, resumable job. Three properties follow, and
/// each of them is the reason for a specific line below:
///
///  1. **The idempotency key is minted at enqueue, once, and persisted with the
///     request.** Every attempt — this one, the one after the reload, the one
///     tomorrow morning — carries the same key, so the node's `load_idempotent`
///     recognises the second delivery of one sale and returns the first
///     answer instead of ringing it twice. A key minted inside the request
///     would be a new key per attempt and would defeat the whole mechanism.
///
///  2. **Retrying is the default here, and only here.** Everywhere else in
///     this estate `retry: false` is right: the API answers a refusal with a
///     sentence a person can read, and asking again only delays showing it.
///     A sale is the exception, because the alternative to retrying is not
///     "show the error" — it is "the shop took the money and no record of it
///     exists". See `shouldRetry` for exactly which failures are retried and
///     which are handed to a person.
///
///  3. **Nothing is deleted until the node has acknowledged it.** A settled
///     sale keeps its answer so the receipt can be reopened; a refused one
///     stays until somebody clears it.

const STORAGE_KEY = "till.sales.v1"

/// How many acknowledged sales to keep for reopening a receipt. Small on
/// purpose: the day's trade is a report, read from the node, and this is only
/// the last few minutes at the counter.
const SETTLED_KEPT = 25

export type SaleState =
  /// Written down, not yet acknowledged.
  | "waiting"
  /// A request is in flight right now.
  | "sending"
  /// The node has it. `result` carries what it said.
  | "settled"
  /// The node refused it for a reason retrying cannot fix. Needs a person.
  | "refused"

/// One line as the counter saw it, kept with the sale.
///
/// A quote, not a price: the node prices the basket and `SaleResult.total_minor`
/// is what was charged. This is here so a queued sale can still be *read* —
/// its receipt shown, its basket recognised — on a tablet that has not yet
/// managed to send it and therefore has no answer to show.
export interface QueuedLine {
  readonly epc: string
  readonly sku_code: string
  readonly name: string
  readonly unit_price_minor: number
}

export interface QueuedSale {
  readonly localId: string
  readonly request: SaleRequest
  readonly lines: readonly QueuedLine[]
  readonly currency: string
  /// What the screen said before the node answered. Kept so a difference
  /// between the quote and the receipt is visible rather than silently
  /// overwritten — a promotion the till could not see is exactly that
  /// difference, and it is worth showing a cashier.
  readonly quotedTotalMinor: number
  readonly queuedAt: string
  readonly attempts: number
  readonly lastError: string | null
  readonly state: SaleState
  readonly result: SaleResult | null
  readonly settledAt: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// The store

let queue: readonly QueuedSale[] = load()
const listeners = new Set<() => void>()

function load(): readonly QueuedSale[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // A sale left mid-flight by a killed tab comes back as `sending`, and
    // nothing is going to finish it. It is waiting — and it is safe to say so,
    // because the key it carries makes a second delivery a no-op.
    return parsed.map((entry: QueuedSale) =>
      entry.state === "sending"
        ? { ...entry, state: "waiting" as const }
        : entry,
    )
  } catch {
    // Storage that cannot be read is storage that cannot be trusted, but it is
    // not a reason to refuse to open the till. Start empty and say nothing.
    return []
  }
}

/// Write the queue, without clobbering what another tab has done to it.
///
/// The `storage` event only fires in the OTHER tab and only after a write, so a
/// tab that has been idle can still be holding a snapshot that predates a sale
/// rung next door. Writing that snapshot back would delete it — and this is
/// money, so this reads what is on disk first and carries through anything it
/// has never seen. Where the two disagree about a sale they both know, this tab
/// wins: it is the one that just did the work.
///
/// `removed` is the part that cannot be inferred. Every write is otherwise
/// additive, so an entry missing from `next` looks exactly like an entry this
/// tab has not heard of — which would resurrect a refusal somebody had just
/// cleared. The two callers that genuinely delete say which ids they meant.
function save(
  next: readonly QueuedSale[],
  removed?: ReadonlySet<string>,
): void {
  const known = new Set(next.map((entry) => entry.localId))
  const theirs = load().filter(
    (entry) =>
      !known.has(entry.localId) && removed?.has(entry.localId) !== true,
  )
  // Oldest first, because `flush` sends in array order and a day's takings
  // read back out of order is a day nobody can follow.
  const merged =
    theirs.length === 0
      ? next
      : [...theirs, ...next].sort((left, right) =>
          left.queuedAt.localeCompare(right.queuedAt),
        )
  queue = merged
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  } catch {
    // A full or disabled store. The queue still works for this session; losing
    // durability is bad, and crashing the till in front of a customer is worse.
  }
  for (const listener of listeners) listener()
}

function patch(localId: string, change: Partial<QueuedSale>): void {
  save(
    queue.map((entry) =>
      entry.localId === localId ? { ...entry, ...change } : entry,
    ),
  )
}

/// React's window onto the queue. `subscribe` and `snapshot` are module-level
/// so React is not handed a new subscription on every render.
export function useSaleQueue(): readonly QueuedSale[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): readonly QueuedSale[] {
  return queue
}

/// How many sales the shop has taken that head office does not know about yet.
/// The number a manager actually cares about at closing time.
export function unsentCount(entries: readonly QueuedSale[]): number {
  return entries.filter(
    (entry) => entry.state === "waiting" || entry.state === "sending",
  ).length
}

export function refusedCount(entries: readonly QueuedSale[]): number {
  return entries.filter((entry) => entry.state === "refused").length
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing a sale down

export interface SaleDraft {
  readonly lines: readonly QueuedLine[]
  readonly tenders: readonly SaleTender[]
  readonly coupon_codes: readonly string[]
  readonly customer_id: string | null
  readonly actor_id: string
  readonly currency: string
  readonly quotedTotalMinor: number
}

/// Commit a sale. Returns the queue entry, already written to disk.
///
/// The key is minted here and nowhere else. Everything after this point — the
/// first attempt, the retry after the wifi comes back, the attempt made by a
/// browser that was restarted in between — sends the same one.
export function enqueueSale(draft: SaleDraft): QueuedSale {
  const entry: QueuedSale = {
    localId: idempotencyKey(),
    request: {
      epcs: draft.lines.map((line) => line.epc),
      tenders: [...draft.tenders],
      actor_id: draft.actor_id,
      idempotency_key: idempotencyKey(),
      coupon_codes: [...draft.coupon_codes],
      customer_id: draft.customer_id,
    },
    lines: draft.lines,
    currency: draft.currency,
    quotedTotalMinor: draft.quotedTotalMinor,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    state: "waiting",
    result: null,
    settledAt: null,
  }
  save([...queue, entry])
  return entry
}

/// Stop waiting for one refused sale.
///
/// Only a refusal can be cleared. A sale still waiting to be sent is money the
/// node has not acknowledged, and a button that could throw one of those away
/// is a button that will eventually be pressed by mistake.
export function dismissRefused(localId: string): void {
  const going = queue.find(
    (entry) => entry.localId === localId && entry.state === "refused",
  )
  if (going === undefined) return
  save(
    queue.filter((entry) => entry.localId !== localId),
    new Set([localId]),
  )
}

/// Put a refused sale back in the queue.
///
/// Same key, so if the node did in fact record it the first time — a refusal
/// that was really a timeout on the way back — this returns the original answer
/// rather than charging twice.
export function retryRefused(localId: string): void {
  patch(localId, { state: "waiting", lastError: null })
  void flush()
}

// ─────────────────────────────────────────────────────────────────────────────
// The pump

let pumping = false
let scheduled: ReturnType<typeof setTimeout> | null = null

/// Which failures deserve another attempt.
///
/// A refusal the node reasoned about — an EPC it has never seen, a tender that
/// does not cover the basket, a coupon already spent — will say the same thing
/// forever, and hammering it only buries the sentence a cashier needs to read.
/// Everything else is the network: a dropped connection, a node restarting, a
/// proxy answering 502. Those are exactly the conditions this queue exists for.
///
/// A lapsed session (401) is retried too, and deliberately: the sale is
/// perfectly good, the browser merely has to sign in again, and discarding
/// money because a cookie expired would be the worst failure on this list.
function shouldRetry(error: unknown): boolean {
  if (error instanceof ApiError) return error.worthRetrying || error.needsSignIn
  // Not an `ApiError` at all: `fetch` rejected before there was a response, so
  // nothing reached the node.
  return true
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "the node could not be reached"
}

/// Send everything that is waiting, oldest first.
///
/// One at a time and in order: a day's takings read back in the order they were
/// rung is a day a manager can follow, and a burst of parallel writes against a
/// SQLite node holding an immediate transaction is contention for nothing.
export async function flush(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    for (;;) {
      const next = queue.find((entry) => entry.state === "waiting")
      if (next === undefined) return

      patch(next.localId, { state: "sending" })
      try {
        const result = await node.post<SaleResult>(
          "/api/v1/store/sales",
          next.request,
          {
            // The same key the body carries, in the header the estate's other
            // writes use. `edge/http.rs::store_sale` reads it from the body —
            // that is the field `load_idempotent` keys on — and the header is
            // what any proxy, gateway or replay of this request would look at.
            // Both, always, and always the same value.
            headers: { "Idempotency-Key": next.request.idempotency_key },
            // A DEADLINE, and it is load-bearing rather than tidy. `fetch` has
            // none of its own, so a half-open socket — a captive portal, a
            // rebooted switch, a frozen node — leaves this promise unsettled
            // forever. That would pin `pumping` true, leave the entry
            // `sending`, and turn every later wake-up into a no-op: the online
            // handler, the heartbeat, and the cashier's own "Try to send now"
            // button. The till would look like it was sending and never send
            // again until the tab was reloaded.
            //
            // A timeout raises `TimeoutError`, which is not an `ApiError`, so
            // `shouldRetry` returns true and the sale goes back to waiting with
            // backoff — carrying the same key, so an attempt the node did in
            // fact receive cannot ring twice.
            signal: AbortSignal.timeout(20_000),
          },
        )
        patch(next.localId, {
          state: "settled",
          result,
          settledAt: new Date().toISOString(),
          lastError: null,
          attempts: next.attempts + 1,
        })
        prune()
        // A sale that has landed changes the day's takings and the shop's
        // stock, and it lands from here rather than from a component — after a
        // reload, in a background tab, off a timer. Nothing else would notice,
        // so the Reports and Stock screens would sit a sale behind until
        // somebody remembered to pull them. Two prefixes because a sale
        // genuinely touches both namespaces whole: every window and every
        // series, every pool and the ledger.
        void queryClient.invalidateQueries({ queryKey: salesKey() })
        void queryClient.invalidateQueries({ queryKey: inventoryKey() })
      } catch (error) {
        const attempts = next.attempts + 1
        if (shouldRetry(error)) {
          patch(next.localId, {
            state: "waiting",
            attempts,
            lastError: describe(error),
          })
          // Back off rather than spin. The retry is scheduled and this pass
          // stops: the entry it just failed on is the oldest, and skipping past
          // it would put the day's sales out of order.
          schedule(Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5)))
          return
        }
        patch(next.localId, {
          state: "refused",
          attempts,
          lastError: describe(error),
        })
      }
    }
  } finally {
    pumping = false
  }
}

function schedule(delay: number): void {
  if (scheduled !== null) clearTimeout(scheduled)
  scheduled = setTimeout(() => {
    scheduled = null
    void flush()
  }, delay)
}

/// Keep the queue from growing without bound, without ever dropping something
/// the node has not acknowledged.
function prune(): void {
  const settled = queue.filter((entry) => entry.state === "settled")
  if (settled.length <= SETTLED_KEPT) return
  const drop = new Set(
    settled
      .slice()
      .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))
      .slice(0, settled.length - SETTLED_KEPT)
      .map((entry) => entry.localId),
  )
  save(
    queue.filter((entry) => !drop.has(entry.localId)),
    drop,
  )
}

/// Start the pump, and keep it awake.
///
/// Called once from the app root. The three triggers are the three ways a till
/// comes back to life: the network returns, the tab is looked at again, and
/// time passes while it sits on the counter with nobody touching it.
export function startSaleQueue(): () => void {
  const wake = () => void flush()
  const onVisible = () => {
    if (document.visibilityState === "visible") wake()
  }
  window.addEventListener("online", wake)
  document.addEventListener("visibilitychange", onVisible)
  window.addEventListener("storage", onOtherTab)
  // A slow heartbeat, not a poll: everything that matters already wakes the
  // pump, and this only catches the case where nothing ever fires — a captive
  // portal that keeps `navigator.onLine` true while dropping every request.
  const beat = setInterval(wake, 20_000)
  wake()
  return () => {
    window.removeEventListener("online", wake)
    document.removeEventListener("visibilitychange", onVisible)
    window.removeEventListener("storage", onOtherTab)
    clearInterval(beat)
  }
}

/// Another tab wrote the queue.
///
/// A shop tablet ends up with two of these open more often than anyone plans —
/// a restored session, a stray "open in new tab", a second window. Each one
/// held its own snapshot and `save()` wrote that snapshot over the whole key,
/// so a sale rung in one tab was erased by the next sale rung in the other.
/// Duplication was never the risk here (the persisted key makes a second
/// delivery a no-op); loss was, and it is money.
function onOtherTab(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY) return
  queue = load()
  for (const listener of listeners) listener()
  void flush()
}
