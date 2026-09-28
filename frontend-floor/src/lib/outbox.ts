import { useSyncExternalStore } from "react"

import { dc } from "@/lib/api"
import { queryClient } from "@/lib/query-client"
import { keys } from "@/lib/queries"
import { ApiError, idempotencyKey } from "@itulah/contract/client"
import type { PurchaseVerifyDecision } from "@itulah/contract"

/// The outbox for work done on the floor.
///
/// Offline is not a degraded mode here, it is the ordinary Tuesday. The node is
/// in the building and the warehouse keeps working whatever the tunnel to head
/// office is doing — but "the node is in the building" is not the same as "this
/// phone can reach it". A rack aisle is a Faraday cage with steel on both sides,
/// the bay doors are at the far end of the wifi, the phone is locked and pocketed
/// between cartons. A count that only existed as an in-flight `fetch` is gone in
/// every one of those cases, and what was lost is an hour of somebody's counting
/// that nobody will know to redo.
///
/// So work is **written to disk before it is sent**, and the sending is a
/// separate, retrying, resumable job. Three properties follow, and each is the
/// reason for a specific line below:
///
///  1. **Idempotency keys are derived from the job's own id, once.** Every
///     attempt — this one, the one after the reload, the one tomorrow morning —
///     carries the same key, so the node's `load_idempotent` recognises the
///     second delivery of one count and returns the first answer instead of
///     counting it twice. A key minted inside the request would be a new key per
///     attempt and would defeat the whole mechanism.
///
///  2. **Retrying is the default here, and only here.** Everywhere else in this
///     app `retry: false` is right: the node answers a refusal with a sentence a
///     person can read, and asking again only delays showing it. Floor work is
///     the exception, because the alternative to retrying is not "show the
///     error" — it is "the goods were counted and no record of it exists".
///
///  3. **The actor travels with the job, not with the session.** The person who
///     counted is the person the ledger must name, even if the job finally
///     leaves this phone an hour later with somebody else signed in. The
///     receiving ceremony depends on it: the node refuses a verification by the
///     same actor who counted, and an outbox that stamped whoever was signed in
///     at send time would break that check in the one direction nobody would
///     notice — by making two people look like one.
///
/// ## What is in here, and what is not
///
/// Only writes that **record work against goods**: a count, a verification, a
/// tagging job marked printed, a pick round, a pack, stock-take entries. Those
/// are irreplaceable — the carton is already on the trolley, the labels are
/// already out of the printer.
///
/// Document actions are not: opening a shipment, building a dispatch, sealing a
/// carton, sending a truck off the yard. Every one of those is a decision made
/// at a bench by somebody watching the screen, needs the node's answer to do the
/// next thing with, and costs nothing to repeat. Queuing them would mean showing
/// a person a consignment number that does not exist yet.

const STORAGE_KEY = "floor.outbox.v1"

/// How many acknowledged jobs to keep, so somebody can see that what they did
/// landed. Small on purpose: the record of the work is on the node, and this is
/// only the last few minutes on the floor.
const SETTLED_KEPT = 25

export type JobState =
  /// Written down, not yet acknowledged.
  | "waiting"
  /// A request is in flight right now.
  | "sending"
  /// The node has it.
  | "settled"
  /// The node refused it for a reason retrying cannot fix. Needs a person.
  | "refused"

/// What the floor did, in the shapes the node's routes take.
///
/// A discriminated union rather than a stored URL and body, because two of these
/// are not one request: a count has to find or open the delivery document first,
/// and that resolution can only happen at send time, against whatever documents
/// the node has by then.
export type JobWork =
  | {
      readonly kind: "hitung"
      readonly po_number: string
      readonly supplier_id: string
      readonly lines: readonly {
        readonly po_line_id: string
        readonly article_code: string
        readonly quantity: number
      }[]
    }
  | {
      readonly kind: "periksa"
      readonly po_number: string
      readonly decision: PurchaseVerifyDecision
      readonly note: string | null
      readonly count_ids: readonly string[]
    }
  | {
      readonly kind: "tag"
      readonly job_id: string
      readonly article_code: string
      readonly quantity: number
    }
  | {
      readonly kind: "ambil"
      readonly source_pool_id: string
      readonly note: string | null
      readonly lines: readonly {
        readonly sku_code: string
        readonly quantity: number
      }[]
    }
  | {
      readonly kind: "kemas"
      readonly destination_store_id: string
      readonly seal: boolean
      readonly lines: readonly {
        readonly sku_code: string
        readonly quantity: number
      }[]
    }
  | {
      readonly kind: "opname"
      readonly count_id: string
      readonly entries: readonly {
        readonly epc: string
        readonly sku_code: string
        readonly found_quantity: number
      }[]
    }

export interface Job {
  readonly localId: string
  readonly work: JobWork
  /// Who did the work. See the header: this is not whoever is signed in when the
  /// job finally leaves.
  readonly actor: string
  readonly queuedAt: string
  readonly attempts: number
  readonly lastError: string | null
  readonly state: JobState
  readonly settledAt: string | null
  /// What the node said when it took the work, in a sentence the floor can
  /// read. Kept because most of these jobs land while nobody is looking at the
  /// screen that started them.
  readonly outcome: string | null
  /// The node took the work and did **not** do all of it — a picking round with
  /// SKUs it had no stock for. Not a failure, and not a success either: nothing
  /// will retry it, so somebody has to be told.
  readonly partial: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// The store

let queue: readonly Job[] = load()
const listeners = new Set<() => void>()

function load(): readonly Job[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // A job left mid-flight by a killed tab comes back as `sending`, and nothing
    // is going to finish it. It is waiting — and it is safe to say so, because
    // the keys it carries make a second delivery a no-op.
    return parsed.map((entry: Job) =>
      entry.state === "sending"
        ? { ...entry, state: "waiting" as const }
        : entry,
    )
  } catch {
    // Storage that cannot be read is storage that cannot be trusted, but it is
    // not a reason to refuse to open the app. Start empty and say nothing.
    return []
  }
}

/// Write the queue, without clobbering what another tab has done to it.
///
/// The `storage` event only fires in the OTHER tab and only after a write, so a
/// tab that has been idle can still be holding a snapshot that predates a count
/// saved next door. Writing that snapshot back would delete it. Where the two
/// disagree about a job they both know, this tab wins: it is the one that just
/// did the work.
///
/// `removed` is the part that cannot be inferred. Every write is otherwise
/// additive, so an entry missing from `next` looks exactly like an entry this tab
/// has not heard of — which would resurrect a refusal somebody had just cleared.
function save(next: readonly Job[], removed?: ReadonlySet<string>): void {
  const known = new Set(next.map((entry) => entry.localId))
  const theirs = load().filter(
    (entry) =>
      !known.has(entry.localId) && removed?.has(entry.localId) !== true,
  )
  // Oldest first, because `flush` sends in array order and a day's work read
  // back out of order is a day nobody can follow.
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
    // durability is bad, and crashing the app on a bay is worse.
  }
  for (const listener of listeners) listener()
}

function patch(localId: string, change: Partial<Job>): void {
  save(
    queue.map((entry) =>
      entry.localId === localId ? { ...entry, ...change } : entry,
    ),
  )
}

/// React's window onto the queue. `subscribe` and `snapshot` are module-level so
/// React is not handed a new subscription on every render.
export function useOutbox(): readonly Job[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): readonly Job[] {
  return queue
}

/// How much work this phone is holding that the node has not acknowledged. The
/// number somebody checks before they put the phone down.
export function unsentCount(entries: readonly Job[]): number {
  return entries.filter(
    (entry) => entry.state === "waiting" || entry.state === "sending",
  ).length
}

export function refusedCount(entries: readonly Job[]): number {
  return entries.filter((entry) => entry.state === "refused").length
}

/// Work the node took but did not do all of — see `Job.partial`. Counted apart
/// from refusals because nothing is going to retry it and nothing is wrong with
/// the phone: somebody simply has to hear that three SKUs did not come off the
/// rack, and then say they have heard it.
export function partialCount(entries: readonly Job[]): number {
  return entries.filter((entry) => entry.state === "settled" && entry.partial)
    .length
}

/// "I have read that." Leaves the job and its sentence in the list, and stops it
/// asking for attention.
export function acknowledge(localId: string): void {
  patch(localId, { partial: false })
}

/// Work of one kind that has not landed yet — what a station screen shows above
/// its own list, so a picker who has just saved a round is not told the round is
/// missing.
export function pendingOf(
  entries: readonly Job[],
  kind: JobWork["kind"],
): readonly Job[] {
  return entries.filter(
    (entry) =>
      entry.work.kind === kind &&
      (entry.state === "waiting" ||
        entry.state === "sending" ||
        entry.state === "refused"),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing work down

/// Commit a piece of work. Returns the job, already written to disk.
export function enqueue(work: JobWork, actor: string): Job {
  const entry: Job = {
    localId: idempotencyKey(),
    work,
    actor,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    state: "waiting",
    settledAt: null,
    outcome: null,
    partial: false,
  }
  save([...queue, entry])
  void flush()
  return entry
}

/// Stop waiting for one refused job.
///
/// Only a refusal can be cleared. A job still waiting to be sent is work the node
/// has not acknowledged, and a button that could throw one of those away is a
/// button that will eventually be pressed by mistake.
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

/// Put a refused job back in the queue.
///
/// Same keys, so if the node did in fact record it the first time — a refusal
/// that was really a timeout on the way back — this returns the original answer
/// rather than counting twice.
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
/// A refusal the node reasoned about — a PO line it has never seen, a delivery
/// somebody closed, a verification by the same person who counted — will say the
/// same thing forever, and hammering it only buries the sentence somebody needs
/// to read. Everything else is the network: a dropped connection, a node
/// restarting, a proxy answering 502.
///
/// A lapsed session (401) is retried too, and deliberately: the work is
/// perfectly good, the browser merely has to sign in again, and discarding an
/// hour of counting because a cookie expired would be the worst failure here.
function shouldRetry(error: unknown): boolean {
  if (error instanceof ApiError) return error.worthRetrying || error.needsSignIn
  // Not an `ApiError` at all: `fetch` rejected before there was a response, so
  // nothing reached the node.
  return true
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "node tidak bisa dihubungi"
}

/// A DEADLINE for every attempt, and it is load-bearing rather than tidy.
///
/// `fetch` has none of its own, so a half-open socket — a captive portal, a
/// rebooted switch, a frozen node — leaves the promise unsettled forever. That
/// would pin `pumping` true, leave the job `sending`, and turn every later
/// wake-up into a no-op: the online handler, the heartbeat, and the button
/// somebody presses in the queue screen. The app would look like it was sending
/// and never send again until the tab was reloaded.
function deadline(): AbortSignal {
  return AbortSignal.timeout(20_000)
}

/// What the node made of one job.
interface Outcome {
  /// A sentence for the person who did the work.
  readonly said: string
  /// Whether some of it was declined. See `Job.partial`.
  readonly partial: boolean
}

/// Perform one job against the node.
///
/// Sequential inside a job, never parallel: the counts on one delivery land in
/// the same movement group, and a handful of them racing is a handful of chances
/// to be told the document is not there yet.
async function perform(job: Job): Promise<Outcome> {
  const key = (suffix: string) => `${job.localId}:${suffix}`
  const work = job.work

  switch (work.kind) {
    case "hitung": {
      // The delivery document, resolved at send time. It cannot be resolved at
      // enqueue time — the phone may have been in a gangway then — and it must
      // be an OPEN one: `edge/sqlite.rs` refuses a count into a delivery that has
      // been settled, and it is right to.
      const receipts = await dc.goodsReceipts(deadline())
      const open = receipts.find(
        (row) => row.supplier_id === work.supplier_id && row.status === "OPEN",
      )
      const receiptId =
        open?.receipt_id ??
        (
          await dc.openGoodsReceipt(
            {
              supplier_id: work.supplier_id,
              // Null means now. Nobody on a bay types the time the lorry came in
              // while it is still being unloaded.
              arrived_at: null,
              actor_id: job.actor,
              idempotency_key: key("receipt"),
            },
            deadline(),
          )
        ).receipt_id
      for (const line of work.lines) {
        await dc.countPurchase(
          {
            receipt_id: receiptId,
            po_line_id: line.po_line_id,
            counted_quantity: line.quantity,
            actor_id: job.actor,
            idempotency_key: key(`count:${line.po_line_id}`),
          },
          deadline(),
        )
      }
      return {
        said: `${work.lines.length} baris tercatat, menunggu diperiksa orang lain.`,
        partial: false,
      }
    }
    case "periksa": {
      for (const countId of work.count_ids) {
        await dc.verifyPurchase(
          {
            count_id: countId,
            verifier_actor_id: job.actor,
            decision: work.decision,
            note: work.note,
            // Never typed on a phone. The invoice's own total is recorded once,
            // on the delivery, by whoever holds the paper.
            invoiced_price_minor: null,
            idempotency_key: key(countId),
          },
          deadline(),
        )
      }
      return {
        said:
          work.decision === "Accept"
            ? `${work.count_ids.length} baris diterima dan jadi stok.`
            : `${work.count_ids.length} baris dikembalikan untuk dihitung ulang.`,
        partial: false,
      }
    }
    case "tag": {
      // The response's `tagged_units` counts labels printed, not stock moved —
      // these units were already stock in this warehouse from the moment the
      // job arrived (owner, 28 Sep 2026). This call only takes the job off the
      // print list.
      await dc.confirmTagging(
        {
          job_id: work.job_id,
          actor_id: job.actor,
          idempotency_key: key("tag"),
        },
        deadline(),
      )
      return {
        said: `Label ${work.quantity} potong ${work.article_code} ditandai sudah dicetak.`,
        partial: false,
      }
    }
    case "ambil": {
      const result = await dc.createPicklist(
        {
          source_pool_id: work.source_pool_id,
          lines: work.lines.map((line) => ({
            sku_code: line.sku_code,
            quantity: line.quantity,
          })),
          actor_id: job.actor,
          note: work.note,
          idempotency_key: key("picklist"),
        },
        deadline(),
      )
      // **A picklist can be accepted and still not be fully done, two ways.**
      //
      // A line the racks cannot answer at all comes back in `refused` rather
      // than failing the request. A line they can only half answer is not
      // reported at all: `pick_stock` takes what it finds, because "asked for
      // 300, found 200" is a statement about the racks rather than an error.
      // Both are right, and both are invisible to somebody whose phone was in a
      // pocket when the round landed — so the difference between what was typed
      // and what was taken is worked out here and said out loud.
      const refused = result.refused
      const asked = work.lines.reduce((total, line) => total + line.quantity, 0)
      const took = result.summary.total_picked
      const short = asked - took
      return {
        said:
          refused.length > 0
            ? `${took} potong diambil · ${refused.length} SKU tidak ada di rak (${refused[0]!.reason}).`
            : short > 0
              ? `${took} potong diambil dari ${asked} yang diketik — ${short} tidak ada di rak.`
              : `${took} potong tercatat diambil.`,
        partial: refused.length > 0 || short > 0,
      }
    }
    case "kemas": {
      const manifest = await dc.pack(
        {
          destination_store_id: work.destination_store_id,
          lines: work.lines.map((line) => ({
            sku_code: line.sku_code,
            quantity: line.quantity,
          })),
          actor_id: job.actor,
          idempotency_key: key("pack"),
          seal: work.seal,
        },
        deadline(),
      )
      return {
        said: `Koli ${manifest.koli.koli_number} · ${manifest.koli.unit_count} potong${work.seal ? ", tersegel" : ""}.`,
        partial: false,
      }
    }
    case "opname": {
      await dc.recordCountEntries(
        work.count_id,
        {
          entries: work.entries.map((entry) => ({
            epc: entry.epc,
            sku_code: entry.sku_code,
            found_quantity: entry.found_quantity,
          })),
          actor_id: job.actor,
          idempotency_key: key("entries"),
        },
        deadline(),
      )
      return {
        said: `${work.entries.length} baris opname tercatat.`,
        partial: false,
      }
    }
  }
}

/// Send everything that is waiting, oldest first.
///
/// One at a time and in order: the floor's work read back in the order it was
/// done is work a supervisor can follow, and a burst of parallel writes against a
/// SQLite node holding an immediate transaction is contention for nothing.
///
/// **One tab at a time, too.** `pumping` only guards this tab. Two tabs on one
/// phone share the queue through `localStorage`, so a job saved in one wakes the
/// other (`onOtherTab`) and both sent it at once. The node is meant to make the
/// second delivery a no-op; on 2026-09-26 a picklist delivered twice together
/// came back as two rounds, and the answer the phone kept said two garments
/// "were not on the rack" that were in fact on the trolley. The lock makes the
/// second tab wait its turn, and it reads the queue again once it has the lock,
/// so what the first tab settled is not sent a second time.
export async function flush(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks
    if (locks === undefined) {
      await pump()
    } else {
      await locks.request(PUMP_LOCK, async () => {
        const stored = load()
        if (stored.length > 0) {
          queue = stored
          for (const listener of listeners) listener()
        }
        await pump()
      })
    }
  } finally {
    pumping = false
  }
}

const PUMP_LOCK = "floor.outbox.pump"

async function pump(): Promise<void> {
  for (;;) {
    const next = queue.find((entry) => entry.state === "waiting")
    if (next === undefined) return

    patch(next.localId, { state: "sending" })
    try {
      const outcome = await perform(next)
      patch(next.localId, {
        state: "settled",
        settledAt: new Date().toISOString(),
        lastError: null,
        attempts: next.attempts + 1,
        outcome: outcome.said,
        partial: outcome.partial,
      })
      prune()
      // Work that has landed changes several stations at once, and it lands
      // from here rather than from a component — after a reload, in a
      // backgrounded tab, off a timer. Nothing else would notice, so a picking
      // screen would go on offering a line somebody already picked. The whole
      // `dc` prefix, because that is the truth: one write here genuinely moves
      // the queues on every other station's screen.
      void queryClient.invalidateQueries({ queryKey: keys.dc.all })
      void queryClient.invalidateQueries({ queryKey: keys.pools() })
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
        // it would put the floor's work out of order.
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
}

function schedule(delay: number): void {
  if (scheduled !== null) clearTimeout(scheduled)
  scheduled = setTimeout(() => {
    scheduled = null
    void flush()
  }, delay)
}

/// Keep the queue from growing without bound, without ever dropping something the
/// node has not acknowledged.
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
/// Called once from the app root. The triggers are the ways a phone on a floor
/// comes back to life: the network returns, the screen is looked at again, and
/// time passes while it sits in an apron pocket.
export function startOutbox(): () => void {
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
/// Two of these open on one phone happens more often than anyone plans — a
/// restored session, a stray link, a second window. Each held its own snapshot
/// and `save()` wrote that snapshot over the whole key, so a count saved in one
/// tab was erased by the next pack saved in the other. Duplication was never the
/// risk (the derived keys make a second delivery a no-op); loss was.
function onOtherTab(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY) return
  queue = load()
  for (const listener of listeners) listener()
  void flush()
}
