import { useSyncExternalStore } from "react"

import {
  sell,
  type Charge,
  type CouponAuthorization,
  type EdgeReply,
  type SaleReply,
  type SaleTender,
} from "@/api"

/// The outbox for money.
///
/// A sale is written down **before** it is sent, and the order is the whole
/// point. A till that posted first and recorded second loses the sale the
/// moment the shop's wifi drops mid-request — and by then the cashier has taken
/// the cash, handed over the garment and started on the next customer. Nothing
/// on the node, nothing on the screen, and a drawer that will not balance.
///
/// So `enqueue` runs at the instant of confirmation, before anything touches
/// the wire, and `flush` is a separate job that can be run again in a minute,
/// after the counter's switch is rebooted, or by a window that was closed and
/// reopened overnight.
///
/// # Four properties, and the lines that exist for them
///
/// **The idempotency key is minted once, at enqueue, and persisted with the
/// sale.** Every attempt carries that same one, so the node recognises the
/// second delivery of one sale and returns the first answer instead of ringing
/// it twice. A key minted inside the send would be a new key per attempt, which
/// is precisely the bug idempotency exists to prevent.
///
/// **A refusal and a silence are different things.** A 4xx is an answer: the
/// node read the sale and said no, it will say the same thing tomorrow, so the
/// entry is marked refused and the sentence it gave is kept for a person to
/// read. A transport failure is not an answer — nobody knows whether the sale
/// landed — so the entry stays exactly as it was and the pass stops, because a
/// node that is not answering is not a node to hammer.
///
/// **`flush` reports what was accepted, by name.** The payment screen decides
/// between "Transaksi selesai" and "Tersimpan di terminal" from `sent`, and
/// getting that backwards is the most expensive lie a till can tell. So `sent`
/// is derived from what the node actually said about each entry, never from the
/// pass having finished without complaint.
///
/// **Nothing the node has not acknowledged is ever dropped.** `forget` touches
/// refusals and nothing else; acknowledged sales age out; unsent ones never do.
///
/// # What is deliberately not here
///
/// No timer, no `online` listener, no heartbeat. Waking the pump is a decision
/// about *when*, and it belongs to the screen that knows whether a cashier is
/// standing at the counter — the same division `api.ts` draws when it refuses
/// to retry. `till.tsx` flushes whenever it comes back to rest on the sale
/// screen. This file decides what happens once it is woken.

const STORAGE_KEY = "pos.outbox.v1"

/// How many acknowledged sales to keep. Enough to still hold the one before
/// last when a customer walks back to the counter — not the day's trade, which
/// is a report and belongs to the node.
const KEEP_SENT = 25

/// One sale, as this terminal wrote it down.
///
/// There is no "sending" state and no attempt counter, because neither survives
/// what this file is built for: a window killed mid-request leaves a row that
/// is simply unsent, which is the truth and is safe to act on — the key it
/// carries makes a second delivery a no-op at the node. Three states, read off
/// two fields: `saleId` set means the node has it, `refused` means the node
/// said no, and neither means it is still owed.
export type OutboxEntry = {
  /// This row's name, minted here. A row can be forgotten and a rung sale
  /// cannot, so the two never share an identifier.
  readonly localId: string
  /// The node's name for it, once the node has accepted it. Null until then,
  /// and the only evidence in this file that a sale actually landed.
  readonly saleId: string | null
  /// Minted once, at enqueue, and never again for this sale.
  readonly idempotencyKey: string
  /// When the cashier confirmed, which is when the money changed hands. Not
  /// when it was sent, which may be tomorrow morning.
  readonly takenAt: string
  readonly epcs: readonly string[]
  readonly tenders: readonly SaleTender[]
  readonly actorId: string
  readonly couponCodes: readonly string[]
  /// The holds head office granted for this basket's limited coupons. Sent
  /// with the sale so the node prices it as the screen did, and so head office
  /// can turn each hold into this sale's redemption when the sale reaches it.
  readonly couponAuthorizations: readonly CouponAuthorization[]
  readonly customerId: string | null
  /// Fees on this bill that are not goods — a carrier bag, most often. Carried
  /// with the sale because the node prices them: a bag folded into a garment's
  /// price would earn loyalty points and catch a discount meant for clothes.
  readonly charges: readonly Charge[]
  /// What the screen told the customer before the node answered. Kept so a gap
  /// between the quote and the receipt stays visible rather than being silently
  /// overwritten — a promotion this terminal could not see is exactly that gap.
  readonly quotedTotalMinor: number
  /// The last thing that went wrong, in the node's own words where it gave any.
  readonly problem: string | null
  readonly refused: boolean
}

/// The same record, writable — and it is the *same object*, not a copy.
///
/// Entries are updated in place, which is unusual here and is owed to the
/// caller: `till.tsx` holds the entry `enqueue` handed back, awaits `flush`,
/// and then reads `entry.saleId` to put a number on the receipt. Were every
/// change a fresh snapshot, that caller would be left holding a record that
/// never learns its own sale id. React is told separately — `announce` hands
/// out a new view object — so nothing depends on entry identity changing.
type Mutable = { -readonly [K in keyof OutboxEntry]: OutboxEntry[K] }

/// Exactly the argument `sell` takes, borrowed from it rather than spelled
/// again here. The day the sale grows a required field on the Rust side, `wire`
/// below stops compiling instead of quietly sending a short sale for ever.
type SaleRequest = Parameters<typeof sell>[0]

/// What a cashier confirms. Snake-cased where it is the wire's word and
/// camel-cased where it is this app's, which is the same split `api.ts` keeps.
export type SaleDraft = {
  readonly epcs: readonly string[]
  readonly tenders: readonly SaleTender[]
  readonly actor_id: string
  readonly coupon_codes: readonly string[]
  readonly coupon_authorizations?: readonly CouponAuthorization[]
  readonly customer_id: string | null
  readonly charges?: readonly Charge[]
  readonly quotedTotalMinor: number
}

export type FlushOutcome = {
  /// The `localId`s the node accepted, judged one entry at a time. A pass that
  /// reached nobody returns an empty list, never a cheerful one.
  readonly sent: readonly string[]
  /// Why anything is still owed, if anything is.
  readonly problem: string | null
}

export type OutboxView = {
  /// Oldest first — the order they were rung, and the order they are sent in.
  readonly entries: readonly OutboxEntry[]
  /// How many sales the node has not acknowledged. The number a manager wants
  /// before the drawer is counted, and the reason this queue is visible at all.
  readonly unsent: number
  /// How many are waiting on a person rather than on the network.
  readonly refused: number
  readonly flushing: boolean
}

// ── what is on disk ─────────────────────────────────────────────────────

/// Rows that survived the read but not this build's idea of a sale.
///
/// Written back untouched on the next save. Such a row is one of two things: a
/// sale some other build of this file wrote, or true rubbish. Erasing the first
/// would be erasing money in order to tidy up after the second, so neither is
/// erased — they are carried, and kept out of the queue where nothing can
/// mistake them for something sendable.
let salvage: readonly unknown[] = []

/// A key that cannot be minted is a sale that cannot be written down, so the
/// one platform assumption in this file is guarded. `randomUUID` wants a secure
/// context, and the README is blunt that the engine tested here (WKWebView) is
/// never the engine the counter runs (WebView2). The fallback is not a UUID and
/// does not pretend to be one; what matters is that two attempts at one sale
/// share it and two sales never do.
function mintKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function strings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((one) => typeof one === "string")
}

/// Read one row back as strictly as it must be read, and no more strictly.
///
/// The must-haves are what the sale cannot be sent or named without: its two
/// identifiers, its actor, its tags, its tenders. Everything else is given a
/// default, because a row written by a slightly older build is still money and
/// refusing it would be the one failure this file exists to prevent.
function revive(row: unknown): Mutable | null {
  if (typeof row !== "object" || row === null) return null
  const it = row as Record<string, unknown>
  if (typeof it.localId !== "string") return null
  if (typeof it.idempotencyKey !== "string") return null
  if (typeof it.actorId !== "string") return null
  if (!strings(it.epcs)) return null
  // Only that the tenders are a list. What makes a tender valid is the node's
  // judgement, and a malformed one comes back as a refusal a cashier can read,
  // which is a better answer than this file inventing its own.
  if (!Array.isArray(it.tenders)) return null
  return {
    localId: it.localId,
    saleId: typeof it.saleId === "string" ? it.saleId : null,
    idempotencyKey: it.idempotencyKey,
    // A row written before this build knew about fees carries none, which is
    // the truth about it: that sale was rung without a bag on the bill.
    charges: Array.isArray(it.charges) ? (it.charges as Charge[]) : [],
    // An unknown time is shown as an impossible one rather than as now, which
    // would be a lie about when the money was taken.
    takenAt:
      typeof it.takenAt === "string" ? it.takenAt : new Date(0).toISOString(),
    epcs: it.epcs,
    tenders: it.tenders as readonly SaleTender[],
    actorId: it.actorId,
    couponCodes: strings(it.couponCodes) ? it.couponCodes : [],
    // A row written before limited coupons could be held carries none, which
    // is the truth about it.
    couponAuthorizations: Array.isArray(it.couponAuthorizations)
      ? (it.couponAuthorizations as CouponAuthorization[])
      : [],
    customerId: typeof it.customerId === "string" ? it.customerId : null,
    quotedTotalMinor:
      typeof it.quotedTotalMinor === "number" ? it.quotedTotalMinor : 0,
    problem: typeof it.problem === "string" ? it.problem : null,
    refused: it.refused === true,
  }
}

/// Everything on disk, in the order it was rung.
///
/// Storage that cannot be read is not a reason to refuse to open the till: a
/// window that crashes on boot over one bad row is a counter that cannot trade
/// at all, which is strictly worse than a counter that has forgotten something.
function read(): readonly Mutable[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return []
  }
  if (raw === null) return []
  let rows: unknown
  try {
    rows = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(rows)) return []
  const kept: Mutable[] = []
  const odd: unknown[] = []
  for (const row of rows) {
    const entry = revive(row)
    if (entry === null) odd.push(row)
    else kept.push(entry)
  }
  salvage = odd
  return kept
}

// ── the store ───────────────────────────────────────────────────────────

let queue: readonly Mutable[] = read()
/// How many callers are currently waiting on a pass. A count rather than a
/// flag, because two screens may ask at once and the second finishing first
/// must not tell the first that the till has stopped sending.
let passes = 0
const listeners = new Set<() => void>()

const isOwed = (entry: OutboxEntry): boolean =>
  entry.saleId === null && !entry.refused

function compose(): OutboxView {
  let unsent = 0
  let refused = 0
  for (const entry of queue) {
    if (entry.refused) refused += 1
    else if (entry.saleId === null) unsent += 1
  }
  return { entries: queue, unsent, refused, flushing: passes > 0 }
}

/// Recomposed only when something actually changed, and handed out by identity.
/// `useSyncExternalStore` compares snapshots by reference, so a view built
/// afresh on every call would re-render the counter for ever.
let view: OutboxView = compose()

function announce(): void {
  view = compose()
  for (const listener of listeners) listener()
}

/// Put the queue on disk and tell React. `salvage` rides along so a row this
/// build could not read is not erased by the next sale that is rung.
function keep(next: readonly Mutable[]): void {
  queue = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next, ...salvage]))
  } catch {
    // A full or disabled store. The queue still works for this session; losing
    // durability is bad, and refusing to sell in front of a customer is worse.
  }
  announce()
}

/// Change one entry and write the queue back.
///
/// The array is rebuilt even though the entry was edited in place: the entry is
/// shared with whoever holds it, but the list React reads must be a new one, or
/// a memoised consumer would never see that a sale had landed.
function patch(entry: Mutable, change: Partial<OutboxEntry>): void {
  Object.assign(entry, change)
  keep([...queue])
}

/// React's window onto the queue. `subscribe` and `snapshot` are module-level
/// so React is not handed a fresh subscription on every render.
export function useOutbox(): OutboxView {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): OutboxView {
  return view
}

// ── writing a sale down ─────────────────────────────────────────────────

/// Commit a sale. Returns the entry, already on disk.
///
/// The key is minted here and nowhere else. Every attempt after this point —
/// the one in a moment, the one after the wifi returns, the one made by a
/// window that was restarted overnight — sends that same one.
///
/// Sending is deliberately not started here. `enqueue` then `flush` is the
/// ordering this whole file is about, and a caller that can see the two steps
/// is a caller that cannot accidentally collapse them back into one. What comes
/// back is a record, not a receipt: nothing in it has been accepted yet.
export function enqueue(sale: SaleDraft): OutboxEntry {
  const entry: Mutable = {
    localId: mintKey(),
    saleId: null,
    idempotencyKey: mintKey(),
    takenAt: new Date().toISOString(),
    epcs: [...sale.epcs],
    tenders: [...sale.tenders],
    actorId: sale.actor_id,
    couponCodes: [...sale.coupon_codes],
    couponAuthorizations: [...(sale.coupon_authorizations ?? [])],
    customerId: sale.customer_id,
    charges: [...(sale.charges ?? [])],
    quotedTotalMinor: sale.quotedTotalMinor,
    problem: null,
    refused: false,
  }
  keep([...queue, entry])
  return entry
}

/// Stop waiting on one refused sale, once a person has dealt with it.
///
/// Only a refusal can be forgotten. Anything else in this queue is money the
/// node has not acknowledged, and a button that could throw one of those away
/// is a button that gets pressed by mistake on a Saturday afternoon. Asking to
/// forget anything else does nothing, on purpose.
export function forget(localId: string): void {
  const going = queue.find((entry) => entry.localId === localId)
  if (going === undefined || !going.refused) return
  keep(queue.filter((entry) => entry !== going))
}

// ── the pump ────────────────────────────────────────────────────────────

/// Whether this status is the node answering *about this sale*.
///
/// A 4xx it reasoned about — a tag it has never seen, tenders that do not cover
/// the basket, a coupon already spent — is a verdict, and it will be the same
/// verdict tomorrow. Retrying only buries the sentence a cashier needs to read.
///
/// Three of them are not verdicts and are excluded on purpose. 401 is a lapsed
/// session: the sale is perfectly good and the terminal merely has to sign in
/// again, and throwing away takings because a token expired would be the worst
/// failure on this list. 408 and 429 are the node saying "not now" — it never
/// looked at the sale at all. Everything from 500 up is the node broken rather
/// than the node judging, and is likewise left to a later pass.
function isVerdict(status: number): boolean {
  if (status < 400 || status >= 500) return false
  return status !== 401 && status !== 408 && status !== 429
}

/// The entry as the node takes it. Typed as `sell`'s own argument so this is
/// the one place a field could go missing, and it cannot go missing quietly.
function wire(entry: OutboxEntry): SaleRequest {
  return {
    epcs: entry.epcs,
    tenders: entry.tenders,
    actor_id: entry.actorId,
    idempotency_key: entry.idempotencyKey,
    coupon_codes: entry.couponCodes,
    coupon_authorizations: entry.couponAuthorizations,
    customer_id: entry.customerId,
    charges: entry.charges,
  }
}

/// One attempt, with a rejected bridge call reported as the same status 0 a
/// dead node gives. `edge.ts` already uses 0 for "nothing reached the node", so
/// folding the two together leaves one shape to reason about below — and leaves
/// no path on which a thrown error strands an entry half-sent.
async function send(entry: OutboxEntry): Promise<EdgeReply<SaleReply>> {
  try {
    return await sell(wire(entry))
  } catch (cause) {
    return {
      ok: false,
      status: 0,
      body: {},
      problem: `Node toko tidak menjawab: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    }
  }
}

/// One pass: everything owed, oldest first, one at a time.
///
/// In order, because a day's takings read back in the order they were rung is a
/// day a manager can follow. One at a time, because the node behind the counter
/// is a single writer and a burst of parallel sales is contention for nothing.
///
/// The pass stops at the first silence. If the node cannot be reached for this
/// sale it cannot be reached for the next one either, and forty attempts
/// against a rebooting switch only cost a battery. A refusal is different: it
/// is that one sale's answer, so it is written down and the pass carries on.
async function run(): Promise<void> {
  for (;;) {
    const next = queue.find(isOwed)
    if (next === undefined) return
    const reply = await send(next)

    if (reply.ok) {
      // The node names every sale it takes — `sale_id` is not optional on the
      // Rust side — so the fallback is for an answer that should not exist. It
      // still counts as accepted, because 2xx *is* acceptance, and re-sending a
      // sale the node holds because its answer was oddly shaped would be a
      // terminal sending on a loop.
      patch(next, { saleId: reply.body.sale_id ?? "—", problem: null })
      ageOut()
      continue
    }

    if (isVerdict(reply.status)) {
      patch(next, {
        refused: true,
        problem:
          reply.problem ??
          `Node menolak penjualan ini (HTTP ${reply.status}) tanpa keterangan.`,
      })
      continue
    }

    // Nobody knows whether this one landed, so it stays exactly where it was:
    // owed, same key, first in line. Reporting it as sent is the one lie this
    // file must never tell, and dropping it is the other.
    patch(next, { problem: reply.problem ?? "Node toko tidak menjawab." })
    return
  }
}

/// Passes run one after another, never at once. `till.tsx` flushes both when it
/// returns to the sale screen and when a cashier confirms, and those two can
/// overlap on a slow line.
let tail: Promise<void> = Promise.resolve()

/// Try to send everything that is owed, and report what the node took.
///
/// A pass is queued *behind* any pass already running rather than joining it: a
/// caller that merely waited on the running one could be told "not accepted"
/// about a sale that pass had already walked past, and that answer is what the
/// cashier reads off the screen.
export async function flush(): Promise<FlushOutcome> {
  // The entries themselves, not their ids. They are updated in place, so these
  // same objects carry their own outcome by the time the pass is done — even
  // when the sending was done by a pass somebody else started.
  const watched = queue.filter(isOwed)
  passes += 1
  announce()
  const mine = (tail = tail.then(run, run))
  try {
    await mine
  } finally {
    passes -= 1
    announce()
  }

  const sent: string[] = []
  const stuck: Mutable[] = []
  for (const entry of watched) {
    if (entry.saleId !== null) sent.push(entry.localId)
    else stuck.push(entry)
  }
  return { sent, problem: stuck.length === 0 ? null : reason(stuck) }
}

/// Why something is still owed, in the words most likely to be about the sale
/// the caller is standing there waiting for.
///
/// The newest entry is that caller's own, so its own refusal is preferred. When
/// it was never attempted — the pass stopped on an older one — the sentence
/// that stopped the pass is the honest answer instead.
function reason(stuck: readonly Mutable[]): string {
  const newest = stuck.at(-1)
  if (newest !== undefined && newest.problem !== null) return newest.problem
  for (const entry of stuck) {
    if (entry.problem !== null) return entry.problem
  }
  return "Penjualan tersimpan di terminal ini, tetapi node belum menerimanya."
}

/// Let acknowledged sales age out, and nothing else.
///
/// The node has these; the queue keeps them only so the last few minutes at the
/// counter can still be read back. Owed and refused rows are never touched here
/// — the queue grows only while the shop is trading and the node is not
/// listening, which is exactly the moment when nothing may be thrown away.
function ageOut(): void {
  const done = queue.filter((entry) => entry.saleId !== null)
  if (done.length <= KEEP_SENT) return
  const going = new Set(done.slice(0, done.length - KEEP_SENT))
  keep(queue.filter((entry) => !going.has(entry)))
}
