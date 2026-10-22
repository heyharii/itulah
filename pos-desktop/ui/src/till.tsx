import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import * as api from "@/api"
import { publish } from "@/customer-link"
import { useApproval, type Approved } from "@/approval"
import { device, inShell, openCustomerDisplay, readRfidPad } from "@/edge"
import { isWeb } from "@/edition"
import { Icon, type IconName } from "@/icons"
import { useWaitingTills } from "@/joining"
import {
  BAGS,
  CancelSale,
  HoldList,
  ReceiptPreview,
  Sheet,
} from "@/screens/dialogs"
import { useShortcuts } from "@/shortcuts"
import {
  enqueue,
  flush,
  resolveRefused,
  useOutbox,
  type OutboxEntry,
  type Swap,
} from "@/outbox"
import { drawerOnSale, printReceiptHere, receiptTarget } from "@/peripherals"
import { authorizeVoucher, releaseVoucher } from "@/vouchers"
import {
  authorizeCoupon,
  onTheWire,
  releaseCoupon,
  type CouponHold,
} from "@/coupons"
import { seatNow, useSeat } from "@/seat"
import { lookupBenefit, returnBenefit, spendBenefit, type BenefitHolder } from "@/benefit"
import { useNodeConfig, useSession } from "@/session"
import { refreshPaymentMethods, usePaymentMethods } from "@/payment-methods"
import { articleId, sku as skuText } from "@/sku"
import { readScan } from "@epc"
import { money } from "@itulah/contract/money"

/// The counter, and everywhere a cashier goes from it.
///
/// The shape is the approved Flipped · Labels layout — the basket on the left
/// with one scan field above it, the money on the right (member, coupon, bags,
/// the total, the one blue button), what a cashier does mid-sale in the header,
/// payment as a dialog over the basket, and a basket that counts tags: the same
/// article twice reads "× 2", but each unit is still its own tag.
///
/// Navigation is a `when` over a union rather than a router. Six destinations
/// do not need a graph, and a back stack that could strand somebody two screens
/// from the scan field would be worse than no back stack at all.
///
/// # The rules this screen obeys, and where they come from
///
/// **Only a tag can be sold.** `SaleRequest` is `{ epcs, tenders, … }`: the
/// node is told which tags were sold and prices them itself. There is no field
/// for a line with no tag, so a barcode cannot become a basket line — it
/// answers "how much is this", which is the other question a counter is asked
/// all day.
///
/// **The price on screen is a preview; the receipt is the truth.** Lines are
/// priced from the book this shop was published, so a basket draws instantly
/// and keeps drawing with the line down. The total under it comes from
/// `POST /store/quote` — the same engine the sale runs — so promotions and
/// coupons are the node's arithmetic and never this file's.
///
/// **A sale is written down before it is sent.** `enqueue` first, then flush.
/// A till that posted first and recorded second loses the sale when shop wifi
/// drops mid-request, and by then the cashier has taken the money.

export type Unit = {
  readonly epc: string
  readonly sku_code: string
  readonly name: string | null
  readonly unitPriceMinor: number | null
}

type Held = {
  readonly id: string
  readonly units: readonly Unit[]
  readonly coupons: readonly string[]
  readonly customerId: string | null
  readonly at: string
}

type Quote = {
  readonly totalMinor: number | null
  readonly stale: boolean
  readonly problem: string | null
  readonly discountTotalMinor: number
  readonly pointsEarned: number
  readonly promotions: readonly api.PromotionOutcome[]
  readonly grantedLines: readonly api.GrantedLine[]
  /// Limited coupons the node would not apply without a hold from head office.
  readonly toAuthorize: readonly string[]
  /// The basket this answer prices (`basisOf`). Payment opens only on an
  /// answer for exactly the basket on the counter.
  readonly basis: string | null
  /// Tags the node will not sell from this shop's floor. Taken off the basket
  /// as soon as they are named; payment waits until the answer has none.
  readonly unsellable: readonly api.Unsellable[]
}

const emptyQuote = (): Quote => ({
  totalMinor: null,
  stale: false,
  problem: null,
  discountTotalMinor: 0,
  pointsEarned: 0,
  promotions: [],
  grantedLines: [],
  toAuthorize: [],
  basis: null,
  unsellable: [],
})

/// Everything a quote is asked about, as one string, so "is this answer about
/// the basket on the counter" is one comparison.
function basisOf(
  epcs: readonly string[],
  coupons: readonly string[],
  customerId: string | null,
  charges: readonly api.Charge[],
  holds: readonly CouponHold[],
): string {
  return JSON.stringify([epcs, coupons, customerId, charges, holds])
}

/// What one scan came to, for a caller that scans many at once (the R3's pad).
type ScanOutcome = "added" | "already" | "other"

/// "Kemeja Oxford · …A1B2C3D4": a unit named the way a cashier finds it — the
/// article, and the end of its tag, which is what tells two of them apart.
function unitName(unit: Unit): string {
  return `${unit.name ?? skuText(unit.sku_code)} · …${unit.epc.slice(-8)}`
}

export type Sold = {
  readonly id: string
  /// The outbox row it was written down as — what Resolve opens on a refusal.
  readonly localId: string
  /// The node's own id, once it has one. Null while the sale is still in the
  /// outbox — and a receipt cannot be printed for a sale the node has never
  /// heard of, which is why this is separate from the local id above.
  readonly saleId: string | null
  readonly totalMinor: number
  readonly changeMinor: number
  /// Whether the node has actually taken it, or it is sitting in the outbox
  /// waiting for the line to come back. A receipt that said "done" for a sale
  /// nobody has accepted yet is the most expensive lie a till can tell.
  readonly accepted: boolean
  /// The node read it and said no. Not resent on its own and never discarded:
  /// it waits in the refused list on the sale screen until a supervisor
  /// resolves it (`ResolveSale`) and it goes again.
  readonly refused: boolean
  readonly problem: string | null
  /// The tags it named, as the cashier reads them, for the refusal.
  readonly tags: readonly string[]
  /// Set when the person's seat turned out to be gone as the sale was
  /// written: who took it, or null when it simply ended. Undefined: still
  /// theirs. The sale goes to the node either way; the seat is dealt with
  /// after it.
  readonly seatLost?: string | null
}

// How the shopper pays — the tiles and their banks — now comes from Finance's
// cloud master (Mode of Payment) via `payment-methods.ts`, which also keeps the
// old hard-coded list (cash, debit/credit/QRIS × BCA/Mandiri/BRI/BNI, voucher)
// as the fallback when the master cannot be read.

/// The basket's own id, for the one call that needs an identity before the sale
/// has one.
///
/// A voucher hold is keyed at head office on (card, checkout), so the ask has to
/// name the basket it is holding FOR — and this basket has no row anywhere yet,
/// by design: it is terminal-local until it is sold. Minted here rather than
/// taken from the sale's idempotency key because the hold happens first: the
/// cashier is holding a card, not yet finishing a sale.
function newCheckoutId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `checkout-${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

/// What to tell the cashier when head office would not answer for an employee
/// balance: the node's own sentence when it gave one, and a plain "head office
/// cannot be reached" when nothing got through (status 0, or the node's 502-504
/// for a relay that failed).
function benefitRefusal(reply: api.EdgeReply<unknown>, fallback: string): string {
  if (reply.status === 0 || reply.status === 502 || reply.status === 503 || reply.status === 504) {
    return "Head office can't be reached — use another payment method."
  }
  return reply.problem ?? fallback
}

/// Where parked baskets outlive this window.
///
/// A held basket is the unsold basket, and the unsold basket is the one state
/// the shell is allowed to keep (`README.md`) — so it is kept the same way the
/// outbox is: this terminal's own storage, written on every change, read back
/// on mount. The garments a hold names are physically sitting in a drawer
/// because the list said so; a restart that ate the list would leave the shop
/// looking for clothes that its own terminal denied ever seeing. Salvaged the
/// same way too: a row that cannot be read as a hold is skipped, never a
/// reason to drop the others.
const HOLDS_KEY = "pos.holds.v1"

function readHolds(): readonly Held[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(HOLDS_KEY)
  } catch {
    return []
  }
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const holds: Held[] = []
  for (const row of parsed) {
    if (typeof row !== "object" || row === null) continue
    const one = row as Record<string, unknown>
    if (typeof one.id !== "string" || !Array.isArray(one.units)) continue
    const units: Unit[] = []
    for (const unit of one.units) {
      if (typeof unit !== "object" || unit === null) continue
      const u = unit as Record<string, unknown>
      if (typeof u.epc !== "string" || typeof u.sku_code !== "string") continue
      units.push({
        epc: u.epc,
        sku_code: u.sku_code,
        name: typeof u.name === "string" ? u.name : null,
        unitPriceMinor:
          typeof u.unitPriceMinor === "number" ? u.unitPriceMinor : null,
      })
    }
    holds.push({
      id: one.id,
      units,
      coupons: Array.isArray(one.coupons)
        ? one.coupons.filter((code): code is string => typeof code === "string")
        : [],
      customerId: typeof one.customerId === "string" ? one.customerId : null,
      at: typeof one.at === "string" ? one.at : new Date().toISOString(),
    })
  }
  return holds
}

/// Rupiah below 100 is not issued, so change is never counted into a note
/// nobody can hand over.
const NOTES = [
  100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
]

function countOut(amount: number): readonly (readonly [number, number])[] {
  const out: [number, number][] = []
  let rest = Math.round(amount)
  for (const note of NOTES) {
    const many = Math.floor(rest / note)
    if (many > 0) {
      out.push([many, note])
      rest -= many * note
    }
  }
  return out
}

export type Where =
  | "sale"
  | "payment"
  | "shift"
  /// The shift screen, straight at counting the drawer — what the header's
  /// Finish shift button opens.
  | "finish"
  | "return"
  | "void"
  | "redeem"
  | "setup"
  /// What is plugged into this till — reachable before signing in, like setup.
  | "peripherals"
  /// Finding the shop's node and asking it to let this till in.
  | "join"
  /// The tills waiting to join, approved from here with a supervisor's finger
  /// or PIN. Signed in only.
  | "joins"

export function Till({
  actorId,
  terminalId,
  where,
  onGo,
  onLock,
  onSeatLost,
}: {
  actorId: string
  terminalId: string
  where: Where
  onGo: (next: Where) => void
  onLock: () => void
  /// The node says the shift this till is selling on is no longer the
  /// person's — somebody took the seat. `by` is who, when the node said.
  onSeatLost: (by: string | null) => void
}) {
  const [rows, setRows] = useState<readonly api.CatalogRow[]>([])
  const [bookProblem, setBookProblem] = useState<string | null>(null)
  const [units, setUnits] = useState<readonly Unit[]>([])
  const [held, setHeld] = useState<readonly Held[]>(readHolds)
  const [coupons, setCoupons] = useState<readonly string[]>([])
  // Head office's holds on this basket's limited coupons (`coupons.ts`). Asked
  // for when the quote names a coupon in `coupons_to_authorize`, carried on
  // every quote and on the sale, and given back when the basket is abandoned.
  const [couponHolds, setCouponHolds] = useState<readonly CouponHold[]>([])
  // How often each code has been asked about for this basket. Twice at most:
  // once, and once more if that hold lapsed while the basket stood open — a
  // refusal is not asked again on every quote.
  const couponAsks = useRef(new Map<string, number>())
  const couponsNow = useRef<readonly string[]>(coupons)
  couponsNow.current = coupons
  const [charges, setCharges] = useState<readonly api.Charge[]>([])
  // Panels that open *over* the counter rather than replacing it. Kept here and
  // not in `Where` because leaving them is always "back to this basket" — a
  // cashier who cancelled a bag picker has not gone anywhere.
  const [panel, setPanel] = useState<
    | null
    | "cancel"
    | "hold"
    | "rfid"
    | "member"
    | "coupon"
    | { readonly receipt: string }
    /// A refused sale being resolved, by its outbox row.
    | { readonly resolve: string }
  >(null)
  // The bag choices open in their row, not in a dialog.
  const [bagPick, setBagPick] = useState(false)
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null)
  const [rfidBusy, setRfidBusy] = useState(false)
  // Taking one unit off a line of several: the line's SKU while the cashier
  // reads or picks the exact tag that goes, so the tag handed back is the tag
  // taken off — never whichever of them was scanned last.
  const [removing, setRemoving] = useState<string | null>(null)
  const [check, setCheck] = useState<readonly api.CatalogRow[]>([])
  const [quote, setQuote] = useState<Quote>(emptyQuote)
  const quoteRequest = useRef(0)
  const [sold, setSold] = useState<Sold | null>(null)
  const scan = useRef<HTMLInputElement>(null)
  const outbox = useOutbox()
  // Taking something back off the counter needs a second person: a unit
  // lifted out of the basket, or the whole basket abandoned.
  const approval = useApproval()
  // Another till asking to join this shop's node. Asked only by a till that
  // belongs to the node — one with its own credential there — because that is
  // the till a supervisor's finger can approve from.
  const { config: shell } = useNodeConfig()
  const waiting = useWaitingTills(
    shell?.pairing_id !== null && shell?.pairing_id !== undefined,
  )

  // Finance's payment methods, read once per sign-in (the till mounts after
  // the shift gate) and again whenever a shift is opened (`screens/shift.tsx`).
  useEffect(() => {
    void refreshPaymentMethods()
  }, [])

  // The price book as last walked: the catalogue generation it was read under
  // (null when unknown, or when the walk failed), when a walk last started, and
  // whether one is running. The poll below compares the generation; the quote
  // compares the prices (`askForQuote`).
  const bookKey = useRef<string | null>(null)
  const bookWalkedAt = useRef(0)
  const bookWalking = useRef(false)
  const bookNow = useRef<ReadonlyMap<string, api.CatalogRow>>(new Map())
  // Read by the quote's answer without making every screen change a new quote.
  const whereNow = useRef(where)
  whereNow.current = where

  /// Walk the whole price book — every page, not the first hundred rows — and
  /// put it on the counter; the lines already in the basket take their names
  /// and prices from it. One walk at a time. A walk that fails keeps the last
  /// good book and says why.
  const loadBook = useCallback(async () => {
    if (bookWalking.current) return
    bookWalking.current = true
    bookWalkedAt.current = Date.now()
    try {
      // The generation first: a catalogue swapped during the walk then no
      // longer matches it, and the next look walks again.
      const state = await api.catalogueState()
      const walked = await api.wholeCatalogue()
      if (!walked.ok) {
        bookKey.current = null
        setBookProblem(walked.problem)
        return
      }
      bookKey.current =
        state.ok && state.body
          ? `${state.body.generation}:${state.body.content_hash}`
          : null
      setBookProblem(null)
      // A node that answers with no book at all keeps the last good one here,
      // as the refresh always has.
      if (!walked.hasPriceBook && bookNow.current.size > 0) return
      setRows(walked.rows)
      const byCode = new Map(walked.rows.map((row) => [row.sku_code, row] as const))
      setUnits((previous) => {
        let changed = false
        const next = previous.map((unit) => {
          const row = byCode.get(unit.sku_code)
          if (
            row === undefined ||
            (row.name === unit.name && row.unit_price_minor === unit.unitPriceMinor)
          ) {
            return unit
          }
          changed = true
          return { ...unit, name: row.name, unitPriceMinor: row.unit_price_minor }
        })
        return changed ? next : previous
      })
    } finally {
      bookWalking.current = false
    }
  }, [])

  // Load the resident book immediately so a basket can be drawn while the node
  // is busy. While a basket is open, the poll below looks for a new catalogue
  // and asks the node for a fresh quote, so a Cloud publication reaches an
  // already-open till without requiring the cashier to rescan an item.
  useEffect(() => {
    void loadBook()
  }, [loadBook])

  // Parked baskets survive this window: written on every change, so a crash —
  // or the app being closed between two customers — still finds them in the
  // Ditahan list afterwards. Storage refusing is not a fault worth a banner:
  // the in-memory list still works, it just stops promising to survive.
  useEffect(() => {
    try {
      if (held.length === 0) localStorage.removeItem(HOLDS_KEY)
      else localStorage.setItem(HOLDS_KEY, JSON.stringify(held))
    } catch {
      // Nowhere to write. Nothing to read either, next time.
    }
  }, [held])

  // Anything sitting in the outbox is tried again whenever this screen comes
  // back to rest — a shop's wifi returns while somebody is scanning, not while
  // they are staring at an error.
  useEffect(() => {
    if (where === "sale") void flush()
  }, [where])

  const bySku = useMemo(() => {
    const index = new Map<string, api.CatalogRow>()
    for (const row of rows) index.set(row.sku_code, row)
    return index
  }, [rows])
  bookNow.current = bySku

  const booked = units.reduce((sum, unit) => sum + (unit.unitPriceMinor ?? 0), 0)
  const unpriced = units.some((unit) => unit.unitPriceMinor === null)
  const chargeTotal = charges.reduce((sum, charge) => sum + charge.amount_minor, 0)
  const total = quote.totalMinor ?? booked + chargeTotal
  const currency = rows[0]?.currency ?? "IDR"

  // What is on the counter now, against what the last answer priced.
  const basis = basisOf(
    units.map((unit) => unit.epc),
    coupons,
    customerId,
    charges,
    couponHolds,
  )
  // The figure on screen is the node's for exactly this basket: not one still
  // on its way, not one for the basket as it stood a scan ago, and not one that
  // named a tag this shop cannot sell. A total the node could not give (no
  // price book) is still the honest figure, as it always was.
  const figureRight =
    !quote.stale &&
    quote.basis === basis &&
    quote.unsellable.length === 0 &&
    (quote.totalMinor !== null || quote.problem === null)
  // Payment opens only on that, and only while the node is answering: a basket
  // the node cannot price now is a basket it may refuse after the money.
  const quoteReady = units.length > 0 && figureRight && quote.problem === null
  // Why it is not, in the words under the total.
  const quoteNote =
    units.length === 0
      ? null
      : quote.stale || quote.basis !== basis
        ? "Calculating…"
        : quote.problem !== null
          ? quote.problem
          : quote.unsellable.length > 0
            ? `Can't be sold from this shop — ${quote.unsellable
                .map((one) => {
                  const unit = units.find(
                    (each) => each.epc.toUpperCase() === one.epc.toUpperCase(),
                  )
                  return `${unit === undefined ? `…${one.epc.slice(-8)}` : unitName(unit)}: ${one.reason}`
                })
                .join("; ")}. It comes off at the basket.`
            : quote.totalMinor === null
              ? "Provisional — the node has no price book"
              : null

  // One line per article: the same SKU at the same price is "× 3", not three
  // rows. A unit is still its tag — taking one off names that tag's EPC.
  const groups = useMemo(() => {
    const byKey = new Map<
      string,
      { key: string; sku: string; name: string | null; price: number | null; units: Unit[] }
    >()
    for (const unit of units) {
      const key = `${unit.sku_code}|${unit.unitPriceMinor ?? "none"}`
      const found = byKey.get(key)
      if (found === undefined) {
        byKey.set(key, {
          key,
          sku: unit.sku_code,
          name: unit.name,
          price: unit.unitPriceMinor,
          units: [unit],
        })
      } else {
        found.units.push(unit)
      }
    }
    return [...byKey.values()]
  }, [units])
  // The newest tag is marked, never animated: scans are scanner input, a
  // hundred a day, and the line just has to be where the eye lands.
  const newestEpc = units.length > 0 ? units[units.length - 1].epc : null
  const newestRow = useRef<HTMLDivElement>(null)
  useEffect(() => {
    newestRow.current?.scrollIntoView({ block: "nearest" })
  }, [units.length])

  const askForQuote = useCallback(
    async (markStale: boolean) => {
      const request = ++quoteRequest.current
      if (markStale) setQuote((was) => ({ ...was, stale: true, problem: null }))
      const asked = basisOf(
        units.map((unit) => unit.epc),
        coupons,
        customerId,
        charges,
        couponHolds,
      )
      const reply = await api.quote(
        units.map((unit) => unit.epc),
        coupons,
        customerId,
        charges,
        onTheWire(couponHolds),
      )
      if (request !== quoteRequest.current) return
      if (!reply.ok) {
        // A refresh of the basket that was already priced keeps the figure it
        // had and says why it could not be checked; anything else has no figure.
        const problem =
          reply.problem ?? `The node did not price this basket (HTTP ${reply.status}).`
        setQuote((was) =>
          !was.stale && was.basis === asked && was.problem === null
            ? { ...was, problem }
            : { ...emptyQuote(), problem, basis: asked },
        )
        return
      }
      const unsellable = reply.body?.unsellable ?? []
      setQuote({
        totalMinor:
          reply.body?.amount_due_minor ??
          reply.body?.total_minor ??
          null,
        stale: false,
        problem: null,
        discountTotalMinor: reply.body?.discount_total_minor ?? 0,
        pointsEarned: reply.body?.points_earned ?? 0,
        promotions: reply.body?.promotions ?? [],
        grantedLines: reply.body?.granted_lines ?? [],
        toAuthorize: reply.body?.coupons_to_authorize ?? [],
        basis: asked,
        unsellable,
      })

      // A tag the node will not sell from this floor — sold already, in the
      // stockroom, set aside — comes off at once, named, before any money.
      // Not under the payment dialog, where it would vanish unseen: there the
      // answer holds the payment back (`figureRight`) and names the tag, and
      // it comes off once the cashier is back at the basket.
      if (unsellable.length > 0 && whereNow.current !== "payment") {
        const why = new Map(
          unsellable.map((one) => [one.epc.toUpperCase(), one.reason] as const),
        )
        const going = units.filter((unit) => why.has(unit.epc.toUpperCase()))
        setUnits((previous) =>
          previous.filter((unit) => !why.has(unit.epc.toUpperCase())),
        )
        if (going.length > 0) {
          setNote({
            bad: true,
            text: `Taken off the basket — ${going
              .map((unit) => `${unitName(unit)}: ${why.get(unit.epc.toUpperCase())}`)
              .join("; ")}.`,
          })
        }
      }

      // The shelf price of every line, this minute, from the engine the sale
      // runs: the lines on screen follow it. A price the book on this till does
      // not have means the book is out of date, so it is walked again — at
      // most once a minute, since a book walk is every page of the range.
      const shelf = new Map<string, number>()
      for (const line of reply.body?.lines ?? []) {
        if (typeof line?.sku_code === "string" && typeof line.unit_price_minor === "number") {
          shelf.set(line.sku_code, line.unit_price_minor)
        }
      }
      if (shelf.size > 0) {
        setUnits((previous) => {
          let changed = false
          const next = previous.map((unit) => {
            const price = shelf.get(unit.sku_code)
            if (price === undefined || price === unit.unitPriceMinor) return unit
            changed = true
            return { ...unit, unitPriceMinor: price }
          })
          return changed ? next : previous
        })
        const book = bookNow.current
        const behind = [...shelf].some(
          ([sku, price]) => book.get(sku)?.unit_price_minor !== price,
        )
        if (behind && Date.now() - bookWalkedAt.current > 60_000) void loadBook()
      }
    },
    [units, coupons, customerId, charges, couponHolds, loadBook],
  )

  /// Hold a limited coupon at head office, the moment the node says it needs
  /// one. The node relays the ask with its own credential; when the line is
  /// down it says so in a sentence, and the coupon simply does not apply — a
  /// use reserved only at this counter is the hundredth use given away twice.
  /// A new hold re-prices the basket (`askForQuote` depends on the holds).
  useEffect(() => {
    if (quote.stale || quote.toAuthorize.length === 0) return
    for (const wanted of quote.toAuthorize) {
      const code = wanted.toUpperCase()
      if (!couponsNow.current.includes(code)) continue
      const asked = couponAsks.current.get(code) ?? 0
      if (asked >= 2) continue
      couponAsks.current.set(code, asked + 1)
      void (async () => {
        const checkout = newCheckoutId()
        const reply = await authorizeCoupon(code, checkout, customerId)
        const id = reply.body?.authorization_id
        if (!reply.ok || id === undefined) {
          setNote({
            bad: true,
            text:
              reply.problem ??
              `Coupon ${code} could not be held at head office — check the connection to head office.`,
          })
          return
        }
        const hold = { code, authorizationId: id, checkoutId: checkout }
        // The coupon may have been lifted while head office was answering.
        if (!couponsNow.current.includes(code)) {
          void releaseCoupon(hold, "coupon released").catch(() => undefined)
          return
        }
        setCouponHolds((was) => [
          ...was.filter((one) => one.code !== code),
          hold,
        ])
      })()
    }
  }, [quote, customerId])

  /// Ask the node what this basket comes to.
  ///
  /// Debounced, because a cashier sweeping a rack produces tags faster than any
  /// server should be asked to price them, and the only figure that matters is
  /// the one after the last tag. Coupons and the member go with it, because a
  /// preview that priced the goods and not the coupon is a preview the sale
  /// will not honour.
  useEffect(() => {
    if (units.length === 0) {
      quoteRequest.current += 1
      setQuote(emptyQuote())
      return
    }
    setQuote((was) => ({ ...was, stale: true }))
    const timer = setTimeout(() => {
      void askForQuote(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [units, askForQuote])

  // Marketing and price books can arrive while a cashier is looking at a
  // basket. Refresh the local display prices and quote from the node while the
  // till or its payment page remains open. The node is local, so this remains
  // useful when the Cloud link is down; failures keep the last good catalogue
  // and let askForQuote surface the node's actual quote status.
  //
  // The book is not downloaded every two seconds: the poll asks for the
  // catalogue's generation (one small row) and walks every page again only
  // when it moved. Prices move without it — a price book, a markdown's hour —
  // and those reach the basket through the quote, whose lines carry this
  // minute's shelf price and walk the book again when it has fallen behind.
  useEffect(() => {
    if (
      units.length === 0 ||
      (where !== "sale" && where !== "payment")
    ) {
      return
    }

    let inFlight = false
    const timer = window.setInterval(() => {
      if (inFlight) return
      inFlight = true
      void (async () => {
        try {
          const state = await api.catalogueState()
          if (state.ok && state.body) {
            const key = `${state.body.generation}:${state.body.content_hash}`
            const moved = bookKey.current !== null && key !== bookKey.current
            // Never walked to the end yet: tried again, twice a minute at most.
            const owed =
              bookKey.current === null && Date.now() - bookWalkedAt.current > 30_000
            if (moved || owed) void loadBook()
          }
          await askForQuote(false)
        } finally {
          inFlight = false
        }
      })()
    // The cloud-to-edge sender runs every 5s. Poll the till more frequently so
    // a live basket picks up a newly applied book promptly instead of adding
    // another full sender interval to the customer's wait.
    }, 2_000)

    return () => window.clearInterval(timer)
  }, [where, units.length, askForQuote, loadBook])

  const onScan = useCallback(
    (raw: string): ScanOutcome => {
      const text = raw.trim()
      if (text === "") return "other"
      setCheck([])

      // Taking one off a line of several: the tag scanned is the tag that
      // goes, after the same second person every removal needs.
      if (removing !== null) {
        const tag = readScan(text.replace(/·/g, ""))
        const unit =
          tag.kind === "epc" ? units.find((one) => one.epc === tag.epc) : undefined
        if (unit === undefined || unit.sku_code !== removing) {
          setNote({
            bad: true,
            text:
              tag.kind !== "epc"
                ? "Scan the tag of the garment to take off."
                : unit === undefined
                  ? "That tag is not in the basket."
                  : "That tag is on another line — press × on that line to take it off.",
          })
          return "other"
        }
        setRemoving(null)
        askRemove([unit])
        return "other"
      }

      // A member card held up to the scanner. The member app prints `M1:` +
      // the card number as a Code 128 barcode (`frontend-customer/src/lib/
      // member-card.ts`), so a scan names the shopper instead of a garment —
      // no typing, and no typo crediting somebody else's card.
      const card = memberFromScan(text)
      if (card !== null) {
        setCustomerId(card)
        setNote({ bad: false, text: `Member card ${card} read.` })
        return "other"
      }

      const scanned = readScan(text.replace(/·/g, ""))

      if (scanned.kind === "epc") {
        if (units.some((unit) => unit.epc === scanned.epc)) {
          setNote({
            bad: true,
            text:
              "That tag is already in the basket. One tag is one item — to take " +
              "it off, press × on its line.",
          })
          return "already"
        }
        const row = bySku.get(scanned.sku_code)
        setUnits((was) => [
          ...was,
          {
            epc: scanned.epc,
            sku_code: scanned.sku_code,
            name: row?.name ?? null,
            unitPriceMinor: row?.unit_price_minor ?? null,
          },
        ])
        setNote(null)
        return "added"
      }

      if (scanned.kind === "sku") {
        const row = bySku.get(scanned.sku_code)
        if (row !== undefined) {
          setCheck([row])
          setNote(null)
          return "other"
        }
      }

      const needle = text.toLowerCase()
      const found = rows.filter((row) => row.name.toLowerCase().includes(needle))
      if (found.length > 0) {
        setCheck(found.slice(0, 8))
        setNote(null)
        return "other"
      }
      setNote({
        bad: true,
        text: `Nothing matches “${text}”. Scan the garment's tag, or type part of its name.`,
      })
      return "other"
    },
    [bySku, rows, units, removing],
  )

  /// Read every garment on the R3's pad at once. Each of this shop's tags goes
  /// through `onScan`, so "already in the basket" and one tag one item are
  /// decided where a single scan decides them; tags that are not this shop's
  /// are counted and left alone. While taking one off a line, that line's tags
  /// on the pad are the ones that go — named, after a second person's yes.
  const readWithR3 = useCallback(async () => {
    if (rfidBusy) return
    setRfidBusy(true)
    try {
      const read = await readRfidPad()
      const ours: string[] = []
      for (const tag of read.tags) {
        const scanned = readScan(tag.epc)
        if (scanned.kind === "epc") ours.push(scanned.epc)
      }
      const foreign = read.tags.length - ours.length
      const leftOut =
        (read.too_weak > 0 ? ` ${read.too_weak} too faint to be on the pad, left out.` : "") +
        (read.unreadable > 0 ? ` ${read.unreadable} unreadable.` : "")
      if (removing !== null) {
        const going = units.filter(
          (unit) => unit.sku_code === removing && ours.includes(unit.epc),
        )
        if (going.length === 0) {
          setNote({
            bad: true,
            text:
              (read.tags.length === 0
                ? "No tag on the pad."
                : "None of the tags on the pad is on that line.") + leftOut,
          })
          return
        }
        setRemoving(null)
        askRemove(going)
        return
      }
      if (read.tags.length === 0) {
        setNote({ bad: true, text: `No tag on the pad.${leftOut}` })
        return
      }
      let added = 0
      let already = 0
      for (const epc of ours) {
        const outcome = onScan(epc)
        if (outcome === "added") added += 1
        else if (outcome === "already") already += 1
      }
      setNote({
        bad: added === 0,
        text:
          `${added} added from the pad` +
          (already > 0 ? `, ${already} already in the basket` : "") +
          (foreign > 0 ? `, ${foreign} not this shop's tags` : "") +
          `.${leftOut}`,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setNote({ bad: true, text: `Chainway R3: ${detail}` })
    } finally {
      setRfidBusy(false)
      scan.current?.focus()
    }
  }, [onScan, rfidBusy, removing, units])

  // Back to the scan field whenever the counter is at rest — including after a
  // panel over it closes, so the next tag lands in the basket.
  useEffect(() => {
    if (where === "sale" && sold === null && panel === null && !approval.open) {
      scan.current?.focus()
    }
  }, [where, sold, panel, approval.open, bagPick])

  /// Empty the counter. The coupon holds go back to head office unless the
  /// basket was SOLD — then the sale carries them, and head office commits
  /// them when it lands; releasing one first would undo the shopper's coupon.
  /// A hold the sold basket did not use is still given back.
  function clearBasket(afterSale = false) {
    const used = new Set(
      afterSale
        ? quote.promotions
            .filter((one) => one.applied && one.coupon_authorization_id)
            .map((one) => one.coupon_authorization_id as string)
        : [],
    )
    for (const hold of couponHolds) {
      if (used.has(hold.authorizationId)) continue
      void releaseCoupon(hold, afterSale ? "not used" : "basket cancelled").catch(
        () => {
          // It lapses at head office on its own within minutes.
        },
      )
    }
    setCouponHolds([])
    couponAsks.current.clear()
    setUnits([])
    setCoupons([])
    setCustomerId(null)
    setCharges([])
    setBagPick(false)
    setPanel(null)
    setRemoving(null)
  }

  // What the shopper's screen shows, if one is open. Published on every change
  // and deliberately also when the counter goes quiet: a display left holding
  // the last basket is a display that tells the next customer what the previous
  // one bought.
  useEffect(() => {
    if (where !== "sale" || sold !== null) return
    if (units.length === 0) {
      publish({ stage: "idle", shopName: null, currency })
      return
    }
    publish({
      stage: "basket",
      shopName: null,
      currency,
      lines: units.map((unit) => ({
        name: unit.name,
        priceMinor: unit.unitPriceMinor,
      })),
      totalMinor: total,
      provisional: quote.totalMinor === null,
    })
  }, [where, sold, units, total, quote.totalMinor, currency])

  useEffect(() => {
    if (sold === null) return
    publish({
      stage: "change",
      shopName: null,
      currency,
      totalMinor: sold.totalMinor,
      changeMinor: sold.changeMinor,
    })
  }, [sold, currency])

  /// The keys a counter knows by heart.
  ///
  /// F-keys only, and they fire while the caret sits in the scan field — which
  /// is where it always sits. A cashier's hands do not leave the scanner to
  /// reach for a mouse, and a shortcut that stopped working because a field had
  /// focus would be a shortcut nobody trusts.
  useShortcuts(
    panel !== null || approval.open
      ? { Escape: () => setPanel(null) }
      : {
      F1: () => scan.current?.focus(),
      F2: () => pay(),
      F3: () => onGo("return"),
      F4: () => setBagPick((was) => !was),
      F6: () => setPanel("rfid"),
      F8: () => units.length > 0 && setPanel("cancel"),
      F9: () => setPanel("hold"),
      F10: () => pay(),
      F12: () => onGo("shift"),
      Escape: () => {
        setPanel(null)
        setRemoving(null)
      },
    },
    where === "sale" && sold === null && !approval.open,
  )

  /// Payment, only on the node's answer for exactly this basket (`quoteReady`).
  /// Pressed early, it says what it is waiting for instead.
  function pay() {
    if (units.length === 0) return
    if (quoteReady) {
      onGo("payment")
      return
    }
    setNote({ bad: true, text: quoteNote ?? "Calculating…" })
  }

  function dropCoupon(code: string) {
    setCoupons((was) => was.filter((one) => one !== code))
    // Its hold goes back: this basket will not use it.
    for (const hold of couponHolds.filter((one) => one.code === code)) {
      void releaseCoupon(hold, "coupon released").catch(() => undefined)
    }
    setCouponHolds((was) => was.filter((one) => one.code !== code))
    couponAsks.current.delete(code)
  }

  const unapplied = quote.stale
    ? []
    : coupons.filter(
        (code) =>
          !quote.promotions.some(
            (promotion) =>
              promotion.applied &&
              promotion.coupon_code?.toUpperCase() === code,
          ),
      )

  const bagCount = (description: string) =>
    charges.filter((charge) => charge.description === description).length
  const addedBags = BAGS.filter((bag) => bagCount(bag.description) > 0)
  // A free bag is a decision (it is on the bill at nought) but not a figure:
  // only the ones that cost something are totalled below.
  const billedBags = addedBags.filter((bag) => bag.amount_minor > 0)
  const bagOne = (bag: api.Charge) => setCharges((was) => [...was, bag])
  const bagLess = (bag: api.Charge) =>
    setCharges((was) => {
      const at = was.map((one) => one.description).lastIndexOf(bag.description)
      return at < 0 ? was : was.filter((_, index) => index !== at)
    })

  function holdBasket() {
    setHeld((was) => [
      ...was,
      {
        id: crypto.randomUUID(),
        units,
        coupons,
        customerId,
        at: new Date().toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    ])
    clearBasket()
  }

  /// Taking units off needs a second person, and names each tag it takes off:
  /// the exact tags read, scanned or picked, never "one of these".
  function askRemove(going: readonly Unit[]) {
    if (going.length === 0) return
    const named = going.map(
      (unit) =>
        `${unitName(unit)}${
          unit.unitPriceMinor === null
            ? ""
            : ` · ${money(unit.unitPriceMinor, currency)}`
        }`,
    )
    approval.ask({
      action: "EDIT_CART",
      title:
        going.length === 1
          ? "Remove item from basket"
          : `Remove ${going.length} items from basket`,
      detail: named.join("; "),
      epcs: going.map((unit) => unit.epc),
      amountMinor: going.some((unit) => unit.unitPriceMinor === null)
        ? null
        : going.reduce((sum, unit) => sum + (unit.unitPriceMinor ?? 0), 0),
      onApproved: (by) => {
        const gone = new Set(going.map((unit) => unit.epc))
        setUnits((was) => was.filter((one) => !gone.has(one.epc)))
        setNote({
          bad: false,
          text: `Removed ${going.map(unitName).join("; ")} — approved by ${by.username}.`,
        })
      },
    })
  }

  /// The × on a line. One unit is that unit; of several, the cashier reads or
  /// picks the exact tag being handed back.
  function removeFromLine(sku: string, lineUnits: readonly Unit[]) {
    if (lineUnits.length === 1) {
      askRemove(lineUnits)
      return
    }
    setRemoving(sku)
    setNote(null)
    scan.current?.focus()
  }

  // The refused sale being resolved. Found by its row, refused or not: while
  // it is being sent it is neither, and the sheet stays to say how it went.
  const resolving =
    panel !== null && typeof panel === "object" && "resolve" in panel
      ? (outbox.entries.find((entry) => entry.localId === panel.resolve) ?? null)
      : null

  return (
    <div id="app" data-screen="sale">
      <SellHeader
        terminalId={terminalId}
        unsent={outbox.unsent}
        waiting={waiting}
        onWaiting={() => onGo("joins")}
        held={held.length}
        hasUnits={units.length > 0}
        onHold={holdBasket}
        onHeld={() => setPanel("hold")}
        onReturn={() => onGo("return")}
        onVoid={() => onGo("void")}
        onRedeem={() => onGo("redeem")}
        onCancel={() => setPanel("cancel")}
        onShift={() => onGo("shift")}
        onFinish={() => onGo("finish")}
        onLock={onLock}
        // The second window is a Tauri window `openCustomerDisplay` opens on
        // this machine — nothing a browser tab can do — so web never gets the
        // button that would call it.
        onDisplay={
          isWeb
            ? undefined
            : () => {
                void openCustomerDisplay().then((problem) => {
                  if (problem !== null) setNote({ bad: true, text: problem })
                })
              }
        }
      />
      {bookProblem !== null && (
        <div className="banner bad">
          <Icon name="alert" />
          <span className="grow">{bookProblem}</span>
        </div>
      )}
      {outbox.refused > 0 && (
        <div className="banner warn">
          <Icon name="alert" />
          <span className="grow">
            {outbox.refused} sales refused by the node — resolve them before finishing
            the shift.
          </span>
        </div>
      )}
      {/* Each refusal with the node's own sentence and the one thing to do
          about it: Resolve, with a store manager. A paid sale is never dropped
          from this till (owner, 21 Oct 2026: "Jangan Discard, wajib
          diselesaikan") — there is no discard here, and none in the outbox. */}
      {outbox.entries
        .filter((entry) => entry.refused)
        .map((entry) => (
          <div className="banner warn" key={entry.localId}>
            <span className="grow">
              {new Date(entry.takenAt).toLocaleString("id-ID")} ·{" "}
              {money(entry.quotedTotalMinor, "IDR")} · {entry.epcs.length} tag
              {entry.problem !== null ? ` — ${entry.problem}` : ""}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => setPanel({ resolve: entry.localId })}
            >
              Resolve
            </button>
          </div>
        ))}
      <main className={sold === null ? "t-main" : "t-main dim"}>
        {/* The basket, on the left: what is on the counter is what the eye is on. */}
        <section className="t-card t-basket">
          <div className="t-scan">
            <form
              className="t-scanfield"
              onSubmit={(event) => {
                event.preventDefault()
                const field = scan.current
                if (field === null) return
                onScan(field.value)
                field.value = ""
              }}
            >
              <Icon name="scan" />
              <input
                ref={scan}
                autoFocus
                autoComplete="off"
                placeholder={
                  removing === null
                    ? "Scan a tag, member card or item name"
                    : "Scan the tag of the one to take off"
                }
                aria-label="Scan a tag, member card or item name"
              />
              {/* The R3 is a USB reader bound in the shell — `readRfidPad`
                  refuses outright with no bridge — so a browser tab never
                  draws a button that can only ever refuse. */}
              {!isWeb && (
                <button
                  className="t-ib"
                  type="button"
                  onClick={() => void readWithR3()}
                  disabled={!inShell() || rfidBusy}
                  aria-label={
                    removing === null
                      ? "Read every tag on the Chainway R3's pad"
                      : "Read the one to take off on the Chainway R3's pad"
                  }
                  title={
                    removing === null
                      ? "Read every tag on the Chainway R3's pad"
                      : "Read the one to take off on the Chainway R3's pad"
                  }
                >
                  <Icon name="plug" />
                </button>
              )}
              <button
                className="t-ib"
                type="button"
                onClick={() => setPanel("rfid")}
                aria-label="Pull from handheld"
                title="From handheld · F6"
              >
                <Icon name="rfid" />
              </button>
            </form>
          </div>

          {/* Taking one off a line of several: the tag handed back is the tag
              taken off, so the cashier reads it, scans it or picks it here —
              each named by the end of its EPC. Escape leaves. */}
          {removing !== null && (
            <div className="notice warn t-flash" role="status">
              <p style={{ margin: 0 }}>
                Take one{" "}
                {units.find((unit) => unit.sku_code === removing)?.name ?? skuText(removing)}{" "}
                off:{" "}
                {isWeb
                  ? "scan its tag, or pick it below."
                  : "put it on the pad and press the reader button, scan its tag, or pick it below."}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {units
                  .filter((unit) => unit.sku_code === removing)
                  .map((unit) => (
                    <button
                      key={unit.epc}
                      type="button"
                      className="btn num"
                      onClick={() => {
                        setRemoving(null)
                        askRemove([unit])
                      }}
                    >
                      …{unit.epc.slice(-8)}
                    </button>
                  ))}
                <button type="button" className="btn ghost" onClick={() => setRemoving(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {note !== null && (
            <div
              className={note.bad ? "notice warn t-flash" : "notice t-flash"}
              role="status"
            >
              {note.text}
            </div>
          )}

          {check.length > 0 && (
            <div className="t-check">
              <div className="block-head">
                <span className="label">Price check</span>
                <button
                  className="t-ib sm"
                  aria-label="Close price check"
                  onClick={() => setCheck([])}
                >
                  <Icon name="x" />
                </button>
              </div>
              <div className="pick-list">
                {check.map((row) => (
                  <div className="pick" key={row.sku_code}>
                    <div className="grow">
                      <strong>{row.name}</strong>
                      <small className="num">
                        {articleId(row.article_code, row.sku_code)} · {skuText(row.sku_code)}
                      </small>
                    </div>
                    <strong className="num">
                      {money(row.unit_price_minor, currency)}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {units.length === 0 ? (
            <div className="t-empty">
              <Icon name="scan" />
              <h3>Ready for a new sale</h3>
              <p>Scan the first tag.</p>
            </div>
          ) : (
            <div className="t-lines no-bar">
              {groups.map((group) => {
                const quantity = group.units.length
                const newest = group.units.some((unit) => unit.epc === newestEpc)
                const last = group.units[quantity - 1]
                return (
                  <div
                    className={newest ? "t-ln last" : "t-ln"}
                    key={group.key}
                    ref={newest ? newestRow : undefined}
                  >
                    <div className="t-it">
                      <p className="t-nm">{group.name ?? "Not in the price book"}</p>
                      <p className="t-mt num">
                        {articleId(bySku.get(group.sku)?.article_code, group.sku)} · {skuText(group.sku)}
                        {quantity === 1 && <> · …{last.epc.slice(-8)}</>}
                        {group.price === null && (
                          <span className="flag manual">NO PRICE</span>
                        )}
                      </p>
                    </div>
                    <span className="t-q num">
                      {quantity > 1 ? `× ${quantity}` : ""}
                    </span>
                    <div className="t-pr num">
                      {group.price === null
                        ? "—"
                        : money(group.price * quantity, currency)}
                      {quantity > 1 && group.price !== null && (
                        <p className="t-mt">{money(group.price, currency)} each</p>
                      )}
                    </div>
                    <button
                      className="t-ib"
                      aria-label={`Remove one ${group.name ?? skuText(group.sku)}`}
                      onClick={() => removeFromLine(group.sku, group.units)}
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* The money, on the right: the figure a cashier watches does not move
            when payment starts — the dialog opens over this column. */}
        <aside className="t-card t-money">
          <div className="t-scroll">
            <div className="t-rows">
              {/* Written onto the sale exactly as typed. This node cannot check
                  it — the member directory is central and this terminal
                  addresses only its own shop, which is what keeps the till
                  selling when the line to head office is down. */}
              <div className="t-row">
                <Icon name="user" />
                <span className="k">Member</span>
                {customerId === null ? (
                  <button className="t-link" onClick={() => setPanel("member")}>
                    Add
                  </button>
                ) : (
                  <>
                    <span className="v num">{customerId}</span>
                    <button
                      className="t-ib sm"
                      aria-label="Remove member"
                      onClick={() => setCustomerId(null)}
                    >
                      <Icon name="x" />
                    </button>
                  </>
                )}
              </div>

              {/* A coupon is a code the shopper produced. It is not priced here:
                  it is handed to the node with the quote and again with the
                  sale, because the engine that grants a discount is the one
                  that has to see the code. */}
              <div className="t-row">
                <Icon name="tag" />
                <span className="k">Coupon</span>
                {coupons.length > 0 && (
                  <span className="v">
                    {coupons.map((code) => (
                      <span className="t-code" key={code}>
                        {code}
                        <button
                          className="t-ib sm"
                          aria-label={`Remove coupon ${code}`}
                          onClick={() => dropCoupon(code)}
                        >
                          <Icon name="x" />
                        </button>
                      </span>
                    ))}
                  </span>
                )}
                <button
                  className={coupons.length === 0 ? "t-link" : "t-link push"}
                  onClick={() => setPanel("coupon")}
                >
                  Add
                </button>
              </div>

              {/* A bag is on the bill, not in the basket. It is picked in the
                  row itself — no dialog — and only the bags added show. */}
              <div className="t-row">
                <Icon name="bag" />
                <span className="k">Bags</span>
                <button
                  className="t-link"
                  aria-expanded={bagPick}
                  onClick={() => setBagPick((was) => !was)}
                >
                  {bagPick ? "Done" : "Add"}
                </button>
              </div>
              {bagPick && (
                <div className="t-bagpk" aria-label="Shopping bags">
                  {BAGS.map((bag) => (
                    <button
                      key={bag.description}
                      className="t-bpk"
                      aria-label={`Add one ${bag.description}`}
                      onClick={() => {
                        bagOne(bag)
                        setBagPick(false)
                      }}
                    >
                      <BagTile bag={bag} />
                      <span className="tx">
                        <span className="nm">{bagShort(bag)}</span>
                        <span className="mt">
                          {bag.amount_minor === 0
                            ? "Free"
                            : money(bag.amount_minor, currency)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {addedBags.length > 0 && (
                <div className="t-bagsub">
                  {addedBags.map((bag) => {
                    const many = bagCount(bag.description)
                    return (
                      <div className="t-bgr" key={bag.description}>
                        <BagTile bag={bag} />
                        <span className="tx">
                          <span className="nm">{bagShort(bag)}</span>
                          <span className="mt num">
                            {bag.amount_minor === 0
                              ? "Free"
                              : money(bag.amount_minor * many, currency)}
                          </span>
                        </span>
                        <span className="t-ctl">
                          <button
                            className="t-round"
                            aria-label={`One ${bag.description} less`}
                            onClick={() => bagLess(bag)}
                          >
                            <Icon name="minus" />
                          </button>
                          <b className="num">{many}</b>
                          <button
                            className="t-round"
                            aria-label={`One ${bag.description} more`}
                            onClick={() => bagOne(bag)}
                          >
                            <Icon name="plus" />
                          </button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="t-tot">
            <div className="t-totals">
              <div className="t-tl">
                <span>
                  Subtotal · {units.length} {units.length === 1 ? "item" : "items"}
                </span>
                <span className="v num">{money(booked, currency)}</span>
              </div>
              {billedBags.map((bag) => (
                <div className="t-tl" key={bag.description}>
                  <span>
                    {bag.description} × {bagCount(bag.description)}
                  </span>
                  <span className="v num">
                    {money(bag.amount_minor * bagCount(bag.description), currency)}
                  </span>
                </div>
              ))}
              {!quote.stale &&
                quote.promotions
                  .filter((promotion) => promotion.applied)
                  .map((promotion) => (
                    <div className="t-tl cut" key={promotion.rule_id}>
                      <span>{promotion.name}</span>
                      <span className="v num">
                        −{money(promotion.benefit_minor, currency)}
                      </span>
                    </div>
                  ))}
              {!quote.stale &&
                quote.grantedLines.map((line, index) => (
                  <div
                    className="t-tl cut"
                    key={`${line.sku_code}-${index}`}
                  >
                    <span>
                      Free · {bySku.get(line.sku_code)?.name ?? skuText(line.sku_code)} ×{" "}
                      {line.quantity}
                    </span>
                    <span className="v num">
                      {money(line.value_minor, currency)}
                    </span>
                  </div>
                ))}
              {unapplied.map((code) => (
                <div className="t-tl warn" key={code}>
                  <span>{code}</span>
                  <span className="v">No discount</span>
                </div>
              ))}
              <div className="t-gt">
                <span>Total</span>
                <strong className="num">{money(total, currency)}</strong>
              </div>
              {(quoteNote !== null || unpriced) && (
                <div className="t-tl">
                  <span className="muted">{quoteNote}</span>
                  {unpriced && (
                    <span className="badge warn">Some items have no price</span>
                  )}
                </div>
              )}
            </div>
            <button
              className="t-paybtn"
              onClick={pay}
              disabled={!quoteReady}
              aria-keyshortcuts="F10"
            >
              <span>Pay</span>
              <kbd aria-hidden="true">F10</kbd>
            </button>
          </div>
        </aside>
      </main>
      <Statusbar unsent={outbox.unsent} refused={outbox.refused} />

      {where === "payment" && sold === null && (
        <Payment
          units={units}
          currency={currency}
          totalMinor={total}
          provisional={quote.totalMinor === null || !figureRight}
          holdBack={figureRight ? null : (quoteNote ?? "Calculating…")}
          basketHasPromotion={quote.promotions.some((one) => one.applied)}
          coupons={coupons}
          couponHolds={couponHolds}
          customerId={customerId}
          charges={charges}
          actorId={actorId}
          onBack={() => onGo("sale")}
          onSold={setSold}
        />
      )}

      {sold !== null && (
        <Sale
          sold={sold}
          currency={currency}
          onNext={(resolveIt) => {
            const lost = sold.seatLost
            setSold(null)
            clearBasket(true)
            onGo("sale")
            // The seat went while this sale was being written down. The sale
            // is kept; the seat is dealt with now that the customer is served.
            if (lost !== undefined) onSeatLost(lost)
            // A refusal, resolved at once: the garment is still on the
            // counter, so its real tag can be read now.
            else if (resolveIt) setPanel({ resolve: sold.localId })
          }}
        />
      )}

      {panel === "cancel" && (
        <CancelSale
          units={units.length}
          totalMinor={total}
          currency={currency}
          onBack={() => setPanel(null)}
          onConfirm={(reason) => {
            setPanel(null)
            approval.ask({
              action: "CANCEL_BASKET",
              title: "Cancel sale",
              detail: `${units.length} unit · ${money(total, currency)}`,
              reason,
              epcs: units.map((unit) => unit.epc),
              amountMinor: total,
              onApproved: (by) => {
                // The reason is written on the node with the approval
                // (`till_approval.reason`), beside the supervisor who agreed.
                setNote({
                  bad: false,
                  text: `Sale cancelled — ${reason} · approved by ${by.username}`,
                })
                clearBasket()
              },
            })
          }}
        />
      )}

      {/* Before the approval sheet, so the store manager's yes opens over it
          and the sheet is still there, with the outcome, afterwards. */}
      {resolving !== null && (
        <ResolveSale
          key={resolving.localId}
          entry={resolving}
          bySku={bySku}
          currency={currency}
          ask={approval.ask}
          onClose={() => setPanel(null)}
          onDone={(text, bad) => {
            setPanel(null)
            setNote({ bad, text })
          }}
        />
      )}

      {approval.sheet}

      {panel === "hold" && (
        <HoldList
          held={held.map((one) => ({
            id: one.id,
            at: one.at,
            units: one.units.length,
            totalMinor: one.units.reduce(
              (sum, unit) => sum + (unit.unitPriceMinor ?? 0),
              0,
            ),
            customerId: one.customerId,
          }))}
          canResume={units.length === 0}
          onBack={() => setPanel(null)}
          onDrop={(id) => {
            const found = held.find((one) => one.id === id)
            if (found === undefined) return
            setPanel(null)
            approval.ask({
              action: "DROP_HOLD",
              title: "Discard held sale",
              detail: `${found.units.length} ${found.units.length === 1 ? "item" : "items"} · held ${found.at}`,
              epcs: found.units.map((unit) => unit.epc),
              amountMinor: found.units.reduce(
                (sum, unit) => sum + (unit.unitPriceMinor ?? 0),
                0,
              ),
              onApproved: () =>
                setHeld((was) => was.filter((one) => one.id !== id)),
            })
          }}
          onResume={(id) => {
            const found = held.find((one) => one.id === id)
            if (found === undefined) return
            setUnits(found.units)
            setCoupons(found.coupons)
            setCustomerId(found.customerId)
            setHeld((was) => was.filter((one) => one.id !== id))
            setPanel(null)
          }}
        />
      )}

      {panel === "rfid" && (
        <ReaderSessions
          onBack={() => setPanel(null)}
          onPull={(epcs, truncated) => {
            setPanel(null)
            const fresh = epcs.filter(
              (epc) => !units.some((unit) => unit.epc === epc),
            )
            const skipped = epcs.length - fresh.length
            if (fresh.length === 0) {
              setNote({
                bad: true,
                text:
                  skipped > 0
                    ? `All ${skipped} tags in that session are already in the basket.`
                    : "That session has no tags.",
              })
              return
            }
            setUnits((was) => [
              ...was,
              ...fresh.map((epc) => {
                // The same decode the scan field runs, so a tag pulled from a
                // sweep lands exactly as a tag scanned at the counter would —
                // same name from the price book, same "tanpa harga" honesty
                // when the shop has not priced that article yet.
                const scanned = readScan(epc)
                const sku = scanned.kind === "epc" ? scanned.sku_code : epc
                const row = bySku.get(sku)
                return {
                  epc,
                  sku_code: sku,
                  name: row?.name ?? null,
                  unitPriceMinor: row?.unit_price_minor ?? null,
                }
              }),
            ])
            setNote({
              bad: false,
              text:
                `Pulled ${fresh.length} tags into the basket` +
                (skipped > 0 ? `, ${skipped} skipped as already there` : "") +
                (truncated
                  ? ". That session has more than 2000 tags — the node took only the first 2000"
                  : "") +
                ".",
            })
          }}
        />
      )}

      {panel === "member" && (
        <AddCode
          title="Member"
          label="Member number"
          placeholder="0812 3456 7788"
          cta="Add"
          onClose={() => setPanel(null)}
          onSubmit={(code) => {
            setCustomerId(memberFromScan(code) ?? code)
            setPanel(null)
          }}
        />
      )}

      {panel === "coupon" && (
        <AddCode
          title="Coupon"
          label="Coupon code"
          placeholder="HEMAT50"
          cta="Apply"
          upper
          onClose={() => setPanel(null)}
          onSubmit={(code) => {
            setCoupons((was) => (was.includes(code) ? was : [...was, code]))
            setPanel(null)
          }}
        />
      )}

      {panel !== null && typeof panel === "object" && "receipt" in panel && (
        <ReceiptPreview
          saleId={panel.receipt}
          currency={currency}
          onBack={() => setPanel(null)}
          onPrint={() => setPanel(null)}
        />
      )}
    </div>
  )
}

/// "KASIR-3" → "Kasir 3". A till installed as a kasir is named by its seat;
/// anything else (a desktop till with its own terminal name) is shown as is.
export function kasirLabel(terminalId: string): string {
  const seat = /^KASIR-(\d+)$/.exec(terminalId)
  return seat === null ? terminalId : `Kasir ${seat[1]}`
}

export function Topbar({
  terminalId,
  actorId,
  unsent,
  waiting,
  onWaiting,
  onFinish,
  onLock,
  onDisplay,
}: {
  terminalId?: string
  actorId?: string
  unsent?: number
  /// Tills waiting for a supervisor at this node. Shown only when some are.
  waiting?: number | null
  onWaiting?: () => void
  /// Finish the shift. The one way out: there is no sign-out button, because a
  /// person leaves a till by counting their drawer, not by walking away from it.
  onFinish?: () => void
  onLock?: () => void
  onDisplay?: () => void
}) {
  // Every screen wears the same header, so the terminal and the person are read
  // from the one session rather than handed down by whoever drew it.
  const session = useSession()
  const seat = useSeat()
  const terminal = terminalId ?? session.terminalId
  const who =
    session.me?.display_name ?? session.me?.username ?? actorId ?? null
  return (
    <header className="topbar">
      <Brand />
      <div className="top-right">
        {/* Another till is asking to join: somebody is standing at it with
            a code on the screen, waiting for a supervisor to notice. */}
        {waiting !== undefined && waiting !== null && waiting > 0 && (
          <button
            className="top-tool"
            onClick={onWaiting}
            disabled={onWaiting === undefined}
            title="Open the waiting tills to match the code and approve"
          >
            <Icon name="plug" />
            <span className="badge warn">
              {waiting} waiting for approval
            </span>
          </button>
        )}
        {unsent !== undefined && unsent > 0 && (
          <span className="badge warn">{unsent} not sent</span>
        )}
        {onDisplay !== undefined && (
          <button className="top-tool" onClick={onDisplay}>
            <Icon name="monitor" />
            Customer display
          </button>
        )}
        {onLock !== undefined && (
          <button className="top-tool" onClick={onLock}>
            <Icon name="lock" />
            Lock
          </button>
        )}
        {(onDisplay !== undefined || onLock !== undefined) && (
          <span className="top-sep" />
        )}
        {/* The till is the kasir it is installed as — "Kasir 1" — and nothing
            else: no terminal id, no edition. */}
        <span className="badge plain">
          {seat !== null ? seat.label : kasirLabel(terminal)}
        </span>
        {who !== null && (
          <span className="top-who">
            <span className="avatar" aria-hidden="true">
              {initials(who)}
            </span>
            {who}
          </span>
        )}
        {onFinish !== undefined && (
          <button className="btn primary lg" onClick={onFinish}>
            Finish shift
          </button>
        )}
      </div>
    </header>
  )
}

/// Two letters for an avatar: the first of the first two names ("Dian
/// Pertiwi" → "DP"), or the first two of a single one ("maya" → "MA").
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== "")
  if (words.length === 0) return ""
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/// The mark in the corner of every screen, and on the sign-in card.
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">c.</span>central
    </span>
  )
}

/// Whether the last thing the person did was point at the screen. Motion is for
/// a mouse or a finger: F10, Enter and Esc are pressed hundreds of times a day
/// and get none, and a scanner types its tag as keys, so it gets none either.
let viaPointer = false
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    () => {
      viaPointer = true
    },
    true,
  )
  window.addEventListener(
    "keydown",
    () => {
      viaPointer = false
    },
    true,
  )
}

/// The mark on its own, the way the hub's rail wears it.
function Mark() {
  return (
    <svg className="t-mark" viewBox="0 0 32 32" aria-label="Central" role="img">
      <rect width="32" height="32" rx="7.5" fill="#111214" />
      <rect x=".5" y=".5" width="31" height="31" rx="7" fill="none" stroke="rgb(255 255 255 / 10%)" />
      <path
        d="M18.2 11.6A6.5 6.5 0 1 0 18.2 20.4"
        fill="none"
        stroke="#fff"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <circle cx="23.4" cy="16" r="2.2" fill="#2563eb" />
    </svg>
  )
}

/// The sale screen's header: the mark, what a cashier does mid-sale, and the
/// person. Everything that used to be a button on the left pane lives here or
/// in the two menus, each button named, none of them a tile.
///
/// Held shows only when something is held. Return and Void are two supervisor
/// flows under one button. The person's menu holds what is done a couple of
/// times a shift: the drawer, points, lock, finishing.
function SellHeader({
  terminalId,
  unsent,
  waiting,
  onWaiting,
  held,
  hasUnits,
  onHold,
  onHeld,
  onReturn,
  onVoid,
  onRedeem,
  onCancel,
  onShift,
  onFinish,
  onLock,
  onDisplay,
}: {
  terminalId?: string
  unsent?: number
  /// Tills waiting for a supervisor at this node. Shown only when some are.
  waiting?: number | null
  onWaiting?: () => void
  held: number
  hasUnits: boolean
  onHold: () => void
  onHeld: () => void
  onReturn: () => void
  onVoid: () => void
  onRedeem: () => void
  onCancel: () => void
  onShift: () => void
  onFinish: () => void
  onLock?: () => void
  onDisplay?: () => void
}) {
  const session = useSession()
  const seat = useSeat()
  const terminal = terminalId ?? session.terminalId
  const who = session.me?.display_name ?? session.me?.username ?? null
  const till = seat !== null && seat.label !== "" ? seat.label : kasirLabel(terminal)
  const [open, setOpen] = useState<null | "ret" | "me">(null)
  const [animate, setAnimate] = useState(false)
  useShortcuts({ Escape: () => setOpen(null) }, open !== null)

  const toggle = (menu: "ret" | "me") => {
    setAnimate(viaPointer)
    setOpen((was) => (was === menu ? null : menu))
  }
  const pick = (action: () => void) => () => {
    setOpen(null)
    action()
  }
  const item = (
    icon: IconName,
    label: string,
    action: () => void,
    key?: string,
  ) => (
    <button role="menuitem" onClick={pick(action)}>
      <Icon name={icon} />
      <span>{label}</span>
      {key !== undefined && <kbd aria-hidden="true">{key}</kbd>}
    </button>
  )

  return (
    <header className="t-hdr">
      <Mark />
      <nav className="t-bar" aria-label="Sale">
        <button className="t-tb" onClick={onHold} disabled={!hasUnits} title="Hold the basket">
          <Icon name="hold" />
          <span className="tbl">Hold</span>
        </button>
        {held > 0 && (
          <button className="t-tb" onClick={onHeld} title="Held baskets · F9">
            <Icon name="list" />
            <span className="tbl">Held</span>
            <span className="t-count">{held}</span>
          </button>
        )}
        <span className="t-popw">
          <button
            className={open === "ret" ? "t-tb on" : "t-tb"}
            aria-haspopup="menu"
            aria-expanded={open === "ret"}
            onClick={() => toggle("ret")}
            title="Return · F3"
          >
            <Icon name="return" />
            <span className="tbl">Return</span>
            <span className="car">
              <Icon name="down" />
            </span>
          </button>
          {open === "ret" && (
            <>
              <span className="t-popscrim" onMouseDown={() => setOpen(null)} />
              <div className={animate ? "t-pop l enter" : "t-pop l"} role="menu">
                {item("return", "Return items", onReturn, "F3")}
                {item("void", "Void a sale", onVoid)}
              </div>
            </>
          )}
        </span>
      </nav>
      <span className="grow" />
      {/* Another till is asking to join: somebody is standing at it with a code
          on the screen, waiting for a supervisor to notice. */}
      {waiting !== undefined && waiting !== null && waiting > 0 && (
        <button
          className="t-tb"
          onClick={onWaiting}
          disabled={onWaiting === undefined}
          title="Open the waiting tills to match the code and approve"
        >
          <Icon name="plug" />
          <span className="badge warn">{waiting} waiting for approval</span>
        </button>
      )}
      {unsent !== undefined && unsent > 0 && (
        <span className="badge warn">{unsent} not sent</span>
      )}
      {hasUnits && (
        <button className="t-tb bad" onClick={onCancel} title="Cancel the sale · F8">
          <Icon name="x" />
          <span className="tbl">Cancel sale</span>
        </button>
      )}
      <span className="t-popw">
        <button
          className={open === "me" ? "t-me on" : "t-me"}
          aria-haspopup="menu"
          aria-expanded={open === "me"}
          aria-label={who === null ? till : `${who}, ${till}`}
          onClick={() => toggle("me")}
        >
          <span className="av">{initials(who ?? till)}</span>
          {/* The name is read, not decoded: whoever stands at the counter
              should see it is their own session at a glance. */}
          <span className="t-meid">
            {who !== null && <span className="nm">{who}</span>}
            <span className="mt">{till}</span>
          </span>
          <span className="car">
            <Icon name="down" />
          </span>
        </button>
        {open === "me" && (
          <>
            <span className="t-popscrim" onMouseDown={() => setOpen(null)} />
            <div className={animate ? "t-pop r enter" : "t-pop r"} role="menu">
              <div className="t-who">
                {who !== null && <div className="nm">{who}</div>}
                <div className="mt">{till}</div>
              </div>
              <span className="sep" />
              {onLock !== undefined && item("lock", "Lock", onLock)}
              {item("wallet", "Shift & cash", onShift, "F12")}
              {item("star", "Redeem points", onRedeem)}
              {onDisplay !== undefined && item("monitor", "Customer display", onDisplay)}
              <span className="sep" />
              {item("logout", "Finish shift", onFinish)}
            </div>
          </>
        )}
      </span>
    </header>
  )
}

/// "Small paper bag" → "Small paper": the row already says Bags.
function bagShort(bag: api.Charge): string {
  return bag.description.replace(/ bag$/i, "")
}

/// A bag's icon tile: paper or plastic, drawn larger for a large one.
function BagTile({ bag }: { bag: api.Charge }) {
  const plastic = /plastic/i.test(bag.description)
  const large = /large/i.test(bag.description)
  return (
    <span className="t-bico">
      <Icon name={plastic ? "bag-plastic" : "bag-paper"} size={large ? 28 : 22} />
    </span>
  )
}

/// A coupon code or a member number, typed once. Written onto the sale exactly
/// as typed — the node is the one that knows what it is worth.
function AddCode({
  title,
  label,
  placeholder,
  cta,
  upper,
  onSubmit,
  onClose,
}: {
  title: string
  label: string
  placeholder: string
  cta: string
  upper?: boolean
  onSubmit: (code: string) => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState("")
  const go = () => {
    const code = typed.trim()
    if (code === "") return
    onSubmit(upper === true ? code.toUpperCase() : code)
  }
  return (
    <Sheet
      title={title}
      onClose={onClose}
      foot={
        <button className="btn primary" onClick={go} disabled={typed.trim() === ""}>
          {cta}
        </button>
      }
    >
      <label className="field">
        {label}
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            go()
          }}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={64}
          autoFocus
        />
      </label>
    </Sheet>
  )
}

/// A sweep a handheld already gave the node, listed so the counter can pull it.
///
/// The reader's lane ends at the node: the handheld signs its batch and posts
/// it to `/api/v1/rfid/observations`, and the node files the reads under a
/// session name. What becomes merchandise is the cashier's decision, made
/// here — a pull, asked for once, not a feed that keeps adding tags while
/// somebody is looking the other way. The tags land exactly as a scan at the
/// counter lands, because the caller runs them through the same `readScan`.
function ReaderSessions({
  onBack,
  onPull,
}: {
  onBack: () => void
  onPull: (epcs: readonly string[], truncated: boolean) => void
}) {
  const [items, setItems] = useState<
    readonly api.RfidSessionBrief[] | null
  >(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const reply = await api.rfidSessions()
      if (!alive) return
      if (!reply.ok) {
        setProblem(reply.problem)
        return
      }
      setItems(reply.body?.items ?? [])
    })()
    return () => {
      alive = false
    }
  }, [])

  async function pull(readerSessionId: string) {
    setBusy(readerSessionId)
    setProblem(null)
    const reply = await api.rfidSession(readerSessionId)
    setBusy(null)
    if (!reply.ok) {
      setProblem(reply.problem)
      return
    }
    if ((reply.body.epcs?.length ?? 0) === 0) {
      setProblem("That session has no tags.")
      return
    }
    onPull(reply.body.epcs ?? [], reply.body.truncated === true)
  }

  return (
    <Sheet title="Pull from handheld" onClose={onBack}>
      {items === null && problem === null && (
        <p className="muted">Loading sessions…</p>
      )}

      {problem !== null && <div className="notice warn">{problem}</div>}

      {items !== null && items.length === 0 && (
        <div className="empty">
          <Icon name="rfid" />
          <h3>No scan sessions yet</h3>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <div className="rows">
          {items.map((one) => (
            <div className="row-item" key={one.reader_session_id}>
              <div className="grow">
                <h3>
                  {one.tag_count} tags · {one.device_count} scanners
                </h3>
                <p>
                  {one.reader_session_id}
                  {one.last_seen_at !== null && (
                    <>
                      {" · "}
                      {new Date(one.last_seen_at).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </>
                  )}
                </p>
              </div>
              <button
                className="btn primary"
                disabled={busy !== null}
                onClick={() => void pull(one.reader_session_id)}
              >
                {busy === one.reader_session_id ? "Pulling…" : "Pull"}
              </button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}

/// The strip along the bottom: the counter's hardware, and whether every sale
/// has reached the node. Never assumed — each device says for itself.
function Statusbar({
  unsent,
  refused,
}: {
  unsent?: number
  refused?: number
}) {
  const [devices, setDevices] = useState<
    readonly { readonly what: string; readonly on: boolean; readonly detail: string }[]
  >([])
  useEffect(() => {
    // Both devices are shell-bound — `device()` answers `bound: false` with
    // no shell to ask — and web has neither an RFID reader nor a fingerprint
    // scanner to report on, so it never asks and the strip stays empty of
    // them rather than showing two lights that can only ever be off.
    if (isWeb) return
    let alive = true
    void (async () => {
      const [rfid, fp] = await Promise.all([
        device("rfid_state"),
        device("fingerprint_state"),
      ])
      if (!alive) return
      setDevices([
        { what: "RFID", on: rfid.bound, detail: rfid.detail },
        { what: "Fingerprint", on: fp.bound, detail: fp.detail },
      ])
    })()
    return () => {
      alive = false
    }
  }, [])

  const sync =
    refused !== undefined && refused > 0
      ? { tone: "warn", text: `${refused} sales refused by the node` }
      : unsent !== undefined && unsent > 0
        ? { tone: "warn", text: `${unsent} sales waiting to be sent` }
        : unsent !== undefined
          ? { tone: "on", text: "All sales sent" }
          : null

  return (
    <footer className="statusbar">
      {devices.map((one) => (
        <span
          className={one.on ? "dev on" : "dev off"}
          key={one.what}
          title={one.detail}
        >
          <i className="dot" />
          {one.what}
        </span>
      ))}
      {sync !== null && (
        <span className="right">
          <span className={`dev ${sync.tone}`}>
            <i className="dot" />
            {sync.text}
          </span>
        </span>
      )}
    </footer>
  )
}

/// Taking the money — a dialog over the counter.
///
/// The basket stays behind it, dimmed, because "what am I taking money for"
/// must not cost a cancelled payment. Methods, amount and keypad are on the
/// left; only the money — what is due, or what has been taken — is on the
/// right, in the column the basket keeps its own total in.
function Payment({
  units,
  currency,
  totalMinor,
  provisional,
  holdBack,
  basketHasPromotion,
  coupons,
  couponHolds,
  customerId,
  charges,
  actorId,
  onBack,
  onSold,
}: {
  units: readonly Unit[]
  currency: string
  totalMinor: number
  provisional: boolean
  /// Why no money may be taken this moment — the figure is being worked out
  /// again, or names a tag this shop cannot sell — or null when it may. A node
  /// that stopped answering after the figure was given does not hold the sale
  /// back: that figure stands, and the outbox carries the sale to the node.
  holdBack: string | null
  /// Whether the quote applied any promotion. An employee balance cannot be
  /// spent on such a basket, and the node refuses it too.
  basketHasPromotion: boolean
  coupons: readonly string[]
  /// Head office's holds on the limited coupons the quote applied.
  couponHolds: readonly CouponHold[]
  customerId: string | null
  charges: readonly api.Charge[]
  actorId: string
  onBack: () => void
  onSold: (sale: Sold) => void
}) {
  const tiles = usePaymentMethods()
  // The dialog fades in for a pointer; F10 opens it as if it had always been there.
  const [enter] = useState(viaPointer)
  // Once the sale is settled the caret has nowhere to be: the finishing button
  // takes it, so the Enter its label promises really finishes the sale.
  const finish = useRef<HTMLButtonElement>(null)
  // The tile's key (a tender type, or the old tile value on the fallback list).
  const [picked, setPicked] = useState<string>("CASH")
  const [typed, setTyped] = useState("")
  const [reference, setReference] = useState("")
  const [bank, setBank] = useState<string | null>(null)
  const [taken, setTaken] = useState<
    readonly {
      method: string
      label: string
      /// What the cashier typed — the approval code, or the voucher's code —
      /// shown on the row without the bank the label already names.
      shown: string | null
      /// The bank's EDC or QRIS acquirer, upper-cased, for a card or QRIS.
      acquirer: string | null
      /// `DEBIT` or `CREDIT`, for a card only.
      cardKind: "DEBIT" | "CREDIT" | null
      /// The master's Mode of Payment code; null on the fallback list.
      code: string | null
      amountMinor: number
      tenderedMinor: number
      reference: string | null
      /// The hold head office granted against a voucher, for a VOUCHER tender.
      /// Null on every other method, and null is not a spare value: the node
      /// refuses a voucher without one and refuses the field on anything else,
      /// so this is the voucher's own proof that the money was reserved before
      /// it was taken.
      voucherAuthorizationId: string | null
      /// The basket id the hold was granted under, so it can be given back if
      /// this tender is taken off before the sale is completed.
      voucherCheckoutId: string | null
    }[]
  >([])
  const [busy, setBusy] = useState(false)
  // Set by the first press of "Complete sale"; this dialog closes on the sale.
  const completing = useRef(false)
  const [problem, setProblem] = useState<string | null>(null)
  // The employee balance: the code the holder showed, and who it turned out to
  // be once looked up. The `sale_ref` is minted once per basket and kept — the
  // node allows one spend per ref — and a fresh one is minted whenever the
  // spend has been given back, so a cashier can try again after taking it off.
  const [benefitCode, setBenefitCode] = useState("")
  const [holder, setHolder] = useState<BenefitHolder | null>(null)
  const saleRef = useRef<string>(newCheckoutId())

  const paid = taken.reduce((sum, one) => sum + one.amountMinor, 0)
  const outstanding = Math.max(0, totalMinor - paid)
  const change = taken
    .filter((one) => one.method === "CASH")
    .reduce(
      (sum, one) => sum + Math.max(0, one.tenderedMinor - one.amountMinor),
      0,
    )
  const entered = Number(typed.replace(/\D/g, "")) || 0
  const offered = entered > 0 ? entered : outstanding
  const settled = outstanding === 0 && taken.length > 0
  const partial = !settled && entered > 0 && entered < outstanding
  const chosen = tiles.find((one) => one.key === picked) ?? tiles[0]
  // What the node calls it (`CASH`, `CARD`, `QRIS`, `EWALLET`, `VOUCHER`).
  const method = chosen.wire
  const needsBank = chosen.needsBank
  // A tile with a single method needs no pick: that one is it.
  const choice =
    chosen.choices.find((one) => one.label === bank) ??
    (chosen.choices.length === 1 ? chosen.choices[0] : null)
  const isBenefit = method === "BENEFIT"
  const benefitTaken = taken.some((one) => one.method === "BENEFIT")
  const needsReference = method !== "CASH" && !isBenefit
  // The node refuses a reference with twelve or more digits in it: a card
  // number that reaches a database is a card number that has to be erased from
  // backups. Said here so a cashier is told before the sale is rung.
  const looksLikeACard = reference.replace(/\D/g, "").length >= 12

  const presets = useMemo(() => {
    if (method !== "CASH" || outstanding <= 0) return []
    return [
      outstanding,
      Math.ceil(outstanding / 50_000) * 50_000,
      Math.ceil(outstanding / 100_000) * 100_000,
      500_000,
    ].filter((v, at, all) => all.indexOf(v) === at && v >= outstanding)
  }, [method, outstanding])

  async function complete() {
    // The reason is already on screen beside the money (`holdBack`).
    if (holdBack !== null) return
    // One sale per press: the write below comes first now, so a second press
    // landing before the button greys out would write the sale twice.
    if (completing.current) return
    completing.current = true
    setBusy(true)
    setProblem(null)
    // Written to disk, with its key, before anything else: before a single
    // byte goes on the wire, and before the seat is asked about below. Until
    // this line the tenders exist only in this window, and a node slow to
    // answer must not be what keeps them there.
    // Everything after this line is the outbox's problem — including the case
    // where this terminal never manages to send it at all.
    // Cash is sent as handed over, not as applied: the node works the change
    // out and prints it on the receipt. Sending the applied amount told it no
    // change was given, while the drawer paid some out.
    const entry = enqueue({
      epcs: units.map((unit) => unit.epc),
      tenders: taken.map((one) => ({
        method: one.method,
        amount_minor:
          one.method === "CASH"
            ? Math.max(one.tenderedMinor, one.amountMinor)
            : one.amountMinor,
        reference: one.reference,
        // The hold head office granted, on the voucher that needed one. It is
        // carried on the tender because head office commits it against THIS
        // sale when the sale reaches it — the till does not call commit at all.
        voucher_authorization_id: one.voucherAuthorizationId,
        acquirer: one.acquirer,
        card_kind: one.cardKind,
        payment_method_code: one.code,
      })),
      actor_id: actorId,
      coupon_codes: coupons,
      // The holds go with the sale: the node prices it as the screen did, and
      // head office commits each one against this sale when it lands — the
      // till never calls commit, as with a voucher.
      coupon_authorizations: onTheWire(couponHolds),
      customer_id: customerId,
      charges,
      quotedTotalMinor: totalMinor,
    })
    // The node attaches a sale to the shift of whoever rings it, so the seat
    // is asked about once more — beside the send now, not before the write.
    // The sale stands whatever the answer: it is written, and its voucher
    // holds and employee balance are what it spends, so nothing is given
    // back. A seat that went is dealt with once the customer has their change
    // (`Sale`). A node that cannot answer does not stop the sale — the outbox
    // is for that.
    const seat = seatNow()
    const [outcome, mine] = await Promise.all([
      flush(),
      seat === null ? Promise.resolve(null) : api.myShifts().catch(() => null),
    ])
    setBusy(false)
    const seatLost =
      seat !== null &&
      mine !== null &&
      mine.ok &&
      (mine.body.open === null || mine.body.open.shift_id !== seat.shift_id)
        ? (mine.body.uncounted.find((one) => one.shift_id === seat.shift_id)
            ?.taken_over_by ?? null)
        : undefined
    // The entry is updated in place by the outbox, so by here it carries its
    // own outcome — including the node's sale id, which is what a receipt can
    // be printed against and a local id never could be — and whether the node
    // refused it, in which case it waits for a supervisor to resolve it
    // (`ResolveSale`) before it is sent again.
    const accepted = outcome.sent.includes(entry.localId)
    const refused = !accepted && entry.refused
    onSold({
      id: entry.saleId ?? entry.localId,
      localId: entry.localId,
      saleId: entry.saleId,
      totalMinor,
      changeMinor: change,
      accepted,
      refused,
      problem: accepted ? null : refused ? entry.problem : outcome.problem,
      tags: units.map(unitName),
      seatLost,
    })
  }

  /// Step back to the counter. Any voucher hold this basket took and has not
  /// spent is given back first: the money was reserved against a basket nobody
  /// is going to pay for, and leaving it held would keep it out of the next
  /// shopper's hands until the hold expires on its own.
  async function leavePayment() {
    // The employee balance spent for this basket goes back the same way.
    await Promise.all(
      taken
        .filter((one) => one.method === "BENEFIT" && one.reference !== null)
        .map((one) =>
          returnBenefit(one.reference as string, one.amountMinor, "cancelled at the till").catch(
            () => {
              // Head office can be asked again from the returns screen; the
              // cashier is not held at the counter for it.
            },
          ),
        ),
    )
    const unspent = taken.filter(
      (one) => one.voucherCheckoutId !== null && one.reference !== null,
    )
    await Promise.all(
      unspent.map((one) =>
        releaseVoucher(
          one.reference as string,
          one.voucherCheckoutId as string,
          "till back to basket",
        ).catch(() => {
          // Nothing to do about it here: the hold lapses by itself in minutes,
          // and refusing to let the cashier leave would be worse than the wait.
        }),
      ),
    )
    onBack()
  }

  /// Enter takes the money (or finishes a settled sale), Escape goes back to
  /// the basket — from the amount or reference field, where the caret sits.
  function onFieldKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (busy) return
    if (event.key === "Enter") {
      event.preventDefault()
      if (settled) void complete()
      else if (offered > 0) void takeIt()
    } else if (event.key === "Escape") {
      event.preventDefault()
      void leavePayment()
    }
  }

  // Escape also works with the caret nowhere in particular.
  useShortcuts({ Escape: () => !busy && void leavePayment() })

  /// Look the code up: who it is and what is left, without using it up.
  async function findHolder() {
    const code = benefitCode.replace(/\D/g, "")
    if (code.length !== 6) {
      setProblem("An employee balance code is 6 digits.")
      return
    }
    setBusy(true)
    setProblem(null)
    const reply = await lookupBenefit(code)
    setBusy(false)
    if (!reply.ok || reply.body === undefined || reply.body === null) {
      setProblem(benefitRefusal(reply, "Code not recognised."))
      return
    }
    setHolder(reply.body)
    setTyped("")
  }

  /// Spend part of the holder's balance on this basket, then record it as a
  /// tender carrying the `sale_ref`, which is what the node checks it against.
  async function takeBenefit() {
    if (holder === null) {
      await findHolder()
      return
    }
    // The reason is already on screen beside the money (`holdBack`).
    if (holdBack !== null) return
    if (basketHasPromotion) {
      setProblem("Employee balance can't be used with a promotion.")
      return
    }
    const amount = Math.min(entered > 0 ? entered : outstanding, outstanding, holder.balance_minor)
    if (amount <= 0) {
      setProblem("There is no balance to use.")
      return
    }
    setBusy(true)
    setProblem(null)
    const ref = saleRef.current
    const reply = await spendBenefit(benefitCode.replace(/\D/g, ""), ref, amount, basketHasPromotion)
    setBusy(false)
    if (!reply.ok) {
      setProblem(benefitRefusal(reply, "The balance can't be used."))
      return
    }
    setTaken((was) => [
      ...was,
      {
        method: "BENEFIT",
        label: chosen.label,
        shown: holder.full_name ?? holder.employee_code,
        amountMinor: amount,
        tenderedMinor: amount,
        reference: ref,
        acquirer: null,
        cardKind: null,
        code: choice?.code ?? null,
        voucherAuthorizationId: null,
        voucherCheckoutId: null,
      },
    ])
    setBenefitCode("")
    setHolder(null)
    setTyped("")
    setProblem(null)
  }

  /// Take a balance tender off and give its money back to the holder. The ref
  /// is renewed because the spent one is used up at head office.
  async function removeBenefit(at: number) {
    const one = taken[at]
    if (one === undefined || one.method !== "BENEFIT" || one.reference === null) return
    setBusy(true)
    setProblem(null)
    const reply = await returnBenefit(one.reference, one.amountMinor, "cancelled at the till")
    setBusy(false)
    if (!reply.ok) {
      setProblem(benefitRefusal(reply, "The balance can't be returned yet."))
      return
    }
    saleRef.current = newCheckoutId()
    setTaken((was) => was.filter((_, index) => index !== at))
  }

  /// Take any tender back off. A balance goes back to its holder and a voucher's
  /// hold goes back to head office; the rest is only the cashier's own entry.
  async function removeTender(at: number) {
    const one = taken[at]
    if (one === undefined) return
    if (one.method === "BENEFIT") {
      await removeBenefit(at)
      return
    }
    if (one.voucherCheckoutId !== null && one.reference !== null) {
      setBusy(true)
      setProblem(null)
      try {
        await releaseVoucher(one.reference, one.voucherCheckoutId, "payment taken off")
      } catch {
        // The hold lapses by itself in minutes; the cashier is not kept for it.
      }
      setBusy(false)
    }
    setTaken((was) => was.filter((_, index) => index !== at))
  }

  async function takeIt() {
    if (isBenefit) {
      await takeBenefit()
      return
    }
    // Nothing is taken against a figure that is being worked out again; why
    // is already on screen beside the money (`holdBack`).
    if (holdBack !== null) return
    if (needsBank && choice === null) {
      setProblem("Choose the bank.")
      return
    }
    if (needsReference && reference.trim().length < 4) {
      setProblem(
        method === "VOUCHER"
          ? "Enter the voucher code."
          : "Enter the approval code, at least 4 characters.",
      )
      return
    }
    if (needsReference && looksLikeACard) {
      setProblem("That looks like a card number. Enter only the approval code.")
      return
    }
    if (method !== "CASH" && offered > outstanding) {
      setProblem(
        "Only cash may exceed the balance due — change comes out of the drawer, not the card.",
      )
      return
    }
    const amount = partial ? entered : outstanding
    // A voucher is held at head office before a single rupiah of it is taken.
    // Nothing local can answer whether the card still carries this much — the
    // same card may be on another counter's till this minute — so the hold is
    // asked for first and the tender only exists if it comes back.
    let hold: { id: string; checkout: string } | null = null
    if (method === "VOUCHER") {
      const code = reference.trim().toUpperCase()
      setBusy(true)
      setProblem(null)
      const checkout = newCheckoutId()
      const reply = await authorizeVoucher(code, checkout, amount)
      setBusy(false)
      if (!reply.ok || reply.body?.authorization_id === undefined) {
        setProblem(
          reply.problem ??
            `Voucher ${code} could not be held at head office — check the code, then check the connection to head office.`,
        )
        return
      }
      hold = { id: reply.body.authorization_id, checkout }
    }
    setTaken((was) => [
      ...was,
      {
        method: chosen.wire,
        // A master method is named whole ("Debit BCA"); the fallback list
        // names the tile and the bank apart.
        label:
          choice?.code != null
            ? choice.label
            : needsBank
              ? `${chosen.label} ${choice?.label ?? ""}`
              : chosen.label,
        shown: reference.trim() === "" ? null : reference.trim(),
        amountMinor: amount,
        tenderedMinor: offered,
        // The bank rides in the reference too, because the receipt prints the
        // reference and not the acquirer: "Kartu BCA · 884213" on paper.
        reference:
          choice?.acquirer != null
            ? `${choice.acquirer} · ${reference.trim()}`
            : reference.trim() === ""
              ? null
              : reference.trim(),
        acquirer: choice?.acquirer ?? null,
        cardKind: chosen.cardKind,
        code: choice?.code ?? null,
        voucherAuthorizationId: hold?.id ?? null,
        voucherCheckoutId: hold?.checkout ?? null,
      },
    ])
    setTyped("")
    setReference("")
    setBank(null)
    setProblem(null)
  }

  useEffect(() => {
    if (settled) finish.current?.focus()
  }, [settled])

  const referenceLabel =
    method === "VOUCHER"
      ? "Voucher code"
      : method === "QRIS"
        ? "QRIS reference number"
        : method === "EWALLET"
          ? "E-wallet reference number"
          : "EDC approval code"

  // The cash figure the cashier is changing: what they typed, or the balance.
  const cashChange =
    method === "CASH" && !settled && offered > outstanding
      ? offered - outstanding
      : 0

  return (
    <div
      className={enter ? "t-scrim enter" : "t-scrim"}
      onMouseDown={(event) => {
        // Closing by the scrim is only safe while nothing has been taken: a
        // card, a voucher hold and an employee balance each go back on leaving.
        if (event.target === event.currentTarget && !busy && taken.length === 0) {
          void leavePayment()
        }
      }}
    >
      <section
        className={enter ? "t-paydlg enter" : "t-paydlg"}
        role="dialog"
        aria-modal="true"
        aria-label="Payment"
      >
        <button
          className="t-ib t-x"
          aria-label="Back to basket"
          title="Back to basket · Esc"
          disabled={busy}
          onClick={() => void leavePayment()}
        >
          <Icon name="x" />
        </button>

        {/* The same skeleton for every method — methods, amount, one slot,
            the keypad, the button — so switching method never moves a thing. */}
        <div className="t-pd-main">
          {settled ? (
            <div className="t-done">
              <span className="seal">
                <Icon name="check" />
              </span>
              <h3>Paid in full</h3>
              <p>
                {change > 0 ? (
                  <>
                    Change <strong className="num">{money(change, currency)}</strong>
                  </>
                ) : (
                  "No change"
                )}
              </p>
            </div>
          ) : (
            <>
              <div
                className="t-meth"
                role="group"
                aria-label="Payment method"
                style={{
                  gridTemplateColumns: `repeat(${
                    tiles.length <= 5 ? tiles.length : Math.ceil(tiles.length / 2)
                  },minmax(0,1fr))`,
                }}
              >
                {tiles.map((one) => (
                  <button
                    key={one.key}
                    aria-pressed={chosen.key === one.key}
                    disabled={
                      one.wire === "BENEFIT" && (basketHasPromotion || benefitTaken)
                    }
                    title={
                      one.wire === "BENEFIT" && basketHasPromotion
                        ? "Not valid with a promotion"
                        : undefined
                    }
                    onClick={() => {
                      setPicked(one.key)
                      setBank(null)
                      setProblem(null)
                    }}
                  >
                    <Icon name={one.icon} />
                    {one.label}
                  </button>
                ))}
              </div>

              <div>
                <div className="t-lbl">
                  <span>{method === "CASH" ? "Received" : "Amount"}</span>
                  {cashChange > 0 && (
                    <span className="chg num">
                      Change {money(cashChange, currency)}
                    </span>
                  )}
                </div>
                <label className="t-amt">
                  <span>Rp</span>
                  <input
                    value={entered > 0 ? entered.toLocaleString("id-ID") : ""}
                    onChange={(event) =>
                      setTyped(event.target.value.replace(/\D/g, ""))
                    }
                    onKeyDown={onFieldKey}
                    inputMode="numeric"
                    placeholder={(isBenefit && holder !== null
                      ? Math.min(outstanding, holder.balance_minor)
                      : outstanding
                    ).toLocaleString("id-ID")}
                    aria-label="Payment amount"
                    autoFocus={!isBenefit}
                  />
                </label>
              </div>

              {/* One slot, one height, whatever the method. */}
              {method === "CASH" ? (
                <div className="t-slot pre">
                  {presets.map((value) => (
                    <button
                      key={value}
                      className={String(value) === typed ? "on" : undefined}
                      onClick={() => setTyped(String(value))}
                    >
                      {value === outstanding
                        ? "Exact"
                        : value.toLocaleString("id-ID")}
                    </button>
                  ))}
                </div>
              ) : isBenefit ? (
                <div className="t-slot">
                  <input
                    className="t-in"
                    value={benefitCode}
                    onChange={(event) => {
                      setBenefitCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                      setHolder(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || busy) return
                      event.preventDefault()
                      if (holder === null) void findHolder()
                      else void takeBenefit()
                    }}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="6-digit code from the employee's phone"
                    aria-label="Employee balance code"
                    autoFocus
                  />
                </div>
              ) : (
                <div className="t-slot" role={needsBank ? "radiogroup" : undefined} aria-label={needsBank ? "Bank" : undefined}>
                  {needsBank &&
                    chosen.choices.map((one) => (
                      <button
                        key={one.code ?? one.label}
                        type="button"
                        role="radio"
                        aria-checked={choice === one}
                        className={choice === one ? "t-chip on" : "t-chip"}
                        onClick={() => {
                          setBank(one.label)
                          setProblem(null)
                        }}
                      >
                        {one.label}
                      </button>
                    ))}
                  <input
                    className="t-in"
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    onKeyDown={onFieldKey}
                    autoComplete="off"
                    placeholder={needsBank ? "Approval code" : referenceLabel}
                    aria-label={referenceLabel}
                  />
                </div>
              )}

              <div className="t-np">
                {["7", "8", "9", "4", "5", "6", "1", "2", "3", "000", "0", "⌫"].map(
                  (key) => (
                    <button
                      key={key}
                      aria-label={key === "⌫" ? "Delete one digit" : key}
                      onClick={() =>
                        setTyped((was) =>
                          key === "⌫"
                            ? was.slice(0, -1)
                            : String(Number(was + key) || ""),
                        )
                      }
                    >
                      {key === "⌫" ? <Icon name="del" /> : key}
                    </button>
                  ),
                )}
              </div>
            </>
          )}

          <span className="grow" />
          <button
            ref={finish}
            className="t-paybtn"
            disabled={busy || holdBack !== null || (!settled && offered <= 0)}
            onClick={() => (settled ? void complete() : takeIt())}
          >
            <span>
              {settled
                ? busy
                  ? "Saving…"
                  : "Complete sale"
                : isBenefit
                  ? holder === null
                    ? "Check balance"
                    : `Use balance ${money(
                        Math.min(
                          entered > 0 ? entered : outstanding,
                          outstanding,
                          holder.balance_minor,
                        ),
                        currency,
                      )}`
                  : `${partial ? "Part payment" : "Pay"} ${money(
                      partial ? entered : offered,
                      currency,
                    )}${
                      // The EDC the cashier said they will swipe, named on the
                      // button they press — the last look before the wrong
                      // terminal gets used.
                      needsBank && bank !== null ? ` · ${chosen.label} ${bank}` : ""
                    }`}
            </span>
            <kbd aria-hidden="true">Enter</kbd>
          </button>
        </div>

        {/* Only the money, on the right: what is due, or the ledger of what has
            been taken. Total and methods are never mixed in one column. */}
        <div className="t-pd-side">
          {taken.length === 0 ? (
            <div className="t-due">
              <div className="t-lbl">Due</div>
              <div className="t-duev num">{money(outstanding, currency)}</div>
              {provisional && <span className="badge warn">Provisional</span>}
            </div>
          ) : (
            <div className="t-led">
              <div className="t-ltl">
                <span>Total</span>
                <span className="v num">{money(totalMinor, currency)}</span>
                <span />
              </div>
              {taken.map((one, at) => (
                <div className="t-ltl pd" key={at}>
                  <span>
                    <Icon name="check" />
                    {one.label}
                    {one.shown !== null && (
                      <small className="muted"> {one.shown}</small>
                    )}
                  </span>
                  <span className="v num">−{money(one.amountMinor, currency)}</span>
                  <button
                    className="t-ib sm"
                    aria-label={`Remove ${one.label} payment`}
                    disabled={busy}
                    onClick={() => void removeTender(at)}
                  >
                    <Icon name="x" />
                  </button>
                </div>
              ))}
              <div className="t-lgt">
                {settled ? (
                  <>
                    <span>Change</span>
                    <strong className="num ok">{money(change, currency)}</strong>
                  </>
                ) : (
                  <>
                    <span>Still due</span>
                    <strong className="num">{money(outstanding, currency)}</strong>
                  </>
                )}
              </div>
            </div>
          )}

          {isBenefit && holder !== null && !settled && (
            <div className="t-kv">
              <span>{holder.full_name ?? holder.employee_code}</span>
              <strong className="num">{money(holder.balance_minor, currency)}</strong>
            </div>
          )}

          {settled && change > 0 && (
            <div className="t-denoms">
              <div className="t-lbl">Hand back</div>
              {countOut(change).map(([many, denomination]) => (
                <div className="t-denom" key={denomination}>
                  <span>
                    {many}× {money(denomination, currency)}
                  </span>
                  <span className="num">{money(many * denomination, currency)}</span>
                </div>
              ))}
            </div>
          )}

          {holdBack !== null && <p className="muted">{holdBack}</p>}
          {problem !== null && <p className="error">{problem}</p>}
        </div>
      </section>
    </div>
  )
}

/// What was sold — or what is waiting to be.
///
/// The two are not the same screen with a different word. A sale the node has
/// accepted is finished; a sale sitting in the outbox is money taken for
/// something head office has not been told about, and the cashier has to know
/// which one they are looking at before the next customer steps up.
function Sale({
  sold,
  currency,
  onNext,
}: {
  sold: Sold
  currency: string
  /// On to the next customer — and, for a refusal, straight into resolving it.
  onNext: (resolve: boolean) => void
}) {
  const { config } = useNodeConfig()
  // Where the receipt goes is this till's peripheral setting: a printer the
  // node recorded, the address in Setelan terminal, the USB printer this till
  // prints to itself, or nowhere — with the reason, when there is one worth
  // reading (a USB printer nobody chose).
  const { target: printer, here, why: noPrint } = receiptTarget(config)
  const [printed, setPrinted] = useState<string | null>(null)
  const asked = useRef(false)

  /// Print once, and do not wait for it.
  ///
  /// A printer out of paper must not hold up the next customer, and the receipt
  /// can be reprinted from the sale at any time. `copy` stamps every print after
  /// the first, so a duplicate can never be mistaken for a second sale. The
  /// drawer is kicked with the first print only, and only when this till's
  /// drawer is opened by the printer.
  const print = useCallback(
    async (copy: boolean) => {
      const { target, here: usb } = receiptTarget(config)
      if (sold.saleId === null || config === null) return
      const drawer = copy ? "NONE" : drawerOnSale(config)
      const done = copy ? "Receipt copy printed." : "Receipt printed."
      // The USB printer on this till: the node renders, this till sends.
      // `usb` is never set in web — there is no peripherals screen there to
      // choose one — but the shell-only send is skipped by edition too,
      // rather than trusted to stay that way.
      if (!isWeb && usb !== null) {
        const printed = await printReceiptHere(sold.saleId, {
          paper: config.paper,
          drawer,
          copy,
        })
        setPrinted(printed.ok ? done : printed.problem)
        return
      }
      if (target === null) return
      const reply = await api.printReceipt(sold.saleId, {
        ...target,
        paper: config.paper,
        drawer,
        copy,
      })
      setPrinted(reply.ok ? done : reply.problem)
    },
    [config, sold.saleId],
  )

  useEffect(() => {
    if (asked.current) return
    asked.current = true
    void print(false)
  }, [print])

  // Three different things, and the cashier reads which one before the next
  // customer: taken by the node; refused by it, which waits for a supervisor
  // to resolve it; or not answered yet, which the outbox sends again.
  const heading = sold.accepted
    ? "Sale complete"
    : sold.refused
      ? "Refused by the node"
      : "Saved on this terminal"

  return (
    <div className="overlay">
      <div
        className="overlay-card"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
      >
        <span className={sold.accepted ? "seal" : "seal warn"}>
          <Icon name={sold.accepted ? "check" : sold.refused ? "alert" : "clock"} />
        </span>
        <h3>{heading}</h3>
        <p className="overlay-total num">{money(sold.totalMinor, currency)}</p>
        {sold.changeMinor > 0 && (
          <div className="overlay-change">
            <small>Change</small>
            <strong className="num">{money(sold.changeMinor, currency)}</strong>
          </div>
        )}
        {!sold.accepted && !sold.refused && (
          <div className="notice warn" style={{ width: "100%" }}>
            Waiting to be sent to the node — it is resent automatically.
            {sold.problem !== null && <> {sold.problem}</>}
          </div>
        )}
        {sold.refused && (
          <div className="notice warn" style={{ width: "100%" }}>
            The node refused this sale, so it is not recorded yet.
            {sold.problem !== null && <> The node said: {sold.problem}</>}
            <br />
            Tags: {sold.tags.join("; ")}.
            <br />
            A store manager resolves it — now, or from the sale screen —
            before the shift can be finished.
          </div>
        )}
        {sold.seatLost !== undefined && (
          <div className="notice warn" style={{ width: "100%" }}>
            {sold.seatLost === null
              ? "Your shift on this till ended while this sale was being paid."
              : `Your shift on this till was taken over by ${sold.seatLost} while this sale was being paid.`}
            {!sold.refused && " The sale is kept under your name."}
          </div>
        )}
        <p className="muted num">{sold.id}</p>
        {printer === null && here === null ? (
          noPrint !== null && <p className="muted">{noPrint}</p>
        ) : (
          <>
            {printed !== null && <p className="muted">{printed}</p>}
            <button
              className="t-link"
              disabled={sold.saleId === null}
              onClick={() => void print(true)}
            >
              <Icon name="print" />
              Reprint
            </button>
          </>
        )}
        {sold.refused && (
          <button
            className="btn"
            style={{ width: "100%" }}
            onClick={() => onNext(true)}
          >
            Resolve
          </button>
        )}
        <button
          className="btn primary lg"
          style={{ width: "100%" }}
          onClick={() => onNext(false)}
          autoFocus
        >
          Next sale
        </button>
      </div>
    </div>
  )
}

/// What the node says a refused sale comes to, if it went now with these tags.
type Verdict =
  | { readonly for: string; readonly ok: false; readonly problem: string }
  | {
      readonly for: string
      readonly ok: true
      /// Tags it will not sell from this shop's floor, and why.
      readonly unsellable: readonly api.Unsellable[]
      /// What the tenders settle against — the figure the customer paid at the
      /// counter (`quotedTotalMinor`). Null when the node has no price for it.
      readonly dueMinor: number | null
      /// The article of each tag, in the order sent: one line per tag.
      readonly skus: readonly string[]
    }

/// Ask the node what a refused sale comes to with these tags: the counter's own
/// quote, with the sale's coupons and their holds, member and fees, so it is
/// priced exactly as it will be sold.
async function priceFor(
  entry: OutboxEntry,
  epcs: readonly string[],
): Promise<Verdict> {
  const key = epcs.join(",")
  try {
    const reply = await api.quote(
      epcs,
      entry.couponCodes,
      entry.customerId,
      entry.charges,
      entry.couponAuthorizations,
    )
    if (!reply.ok) {
      return {
        for: key,
        ok: false,
        problem:
          reply.problem ?? `The node did not price this sale (HTTP ${reply.status}).`,
      }
    }
    return {
      for: key,
      ok: true,
      unsellable: reply.body?.unsellable ?? [],
      dueMinor: reply.body?.amount_due_minor ?? reply.body?.total_minor ?? null,
      skus: (reply.body?.lines ?? []).map((line) => line.sku_code),
    }
  } catch (cause) {
    return {
      for: key,
      ok: false,
      problem: `The store node did not answer: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    }
  }
}

/// What the store manager is shown, and what the node writes beside their name
/// (`till_approval.detail`, under 240 characters): the sale, and exactly what
/// is done to it.
function resolveDetail(
  entry: OutboxEntry,
  swaps: readonly Swap[],
  currency: string,
): string {
  const sale = `Refused sale ${new Date(entry.takenAt).toLocaleString("id-ID")} · ${money(
    entry.quotedTotalMinor,
    currency,
  )}`
  if (swaps.length === 0) return `${sale} · send again unchanged`
  const each = swaps
    .map((one) => `…${one.from.slice(-8)} with …${one.to.slice(-8)}`)
    .join(", ")
  const full = `${sale} · replace ${each} (same article) and send again`
  return full.length <= 240
    ? full
    : `${sale} · replace ${swaps.length} tags (same article) and send again`
}

/// A sale the node refused after the money was taken, put right.
///
/// Owner, 21 Oct 2026: "Jangan Discard, wajib diselesaikan". A paid sale is
/// never dropped from the till; it is resolved, so the money, the goods and an
/// employee's benefit stay matched. Two ways, both behind a store manager's yes
/// (`useApproval`), and both send the sale's own tenders — a BENEFIT one
/// included — exactly as they were taken:
///
/// - **Replace** a tag the node will not sell with the garment's real tag, read
///   on the pad or scanned. Only a tag of the same SKU, so the money taken is
///   still right, and only one the node quotes as sellable.
/// - **Send again** unchanged, once the reason is gone — the stock moved to the
///   shop floor in the store app, say. "Check again" asks the node.
///
/// Either way the node prices the sale first, and it goes only when that comes
/// to what was paid. A different article or a different price is not a
/// resolve: it needs a return and a new sale, and the sheet says so.
///
/// The yes is asked for at the moment of sending, for exactly what is sent, so
/// the node's record of it (`till_approval`: who, when, which tags) names the
/// swap. The node has no approval action of its own for this; it is filed as
/// `EDIT_CART` — the basket's tags edited — with the detail saying what. The
/// sale goes under its own idempotency key: `resolveRefused` says why.
function ResolveSale({
  entry,
  bySku,
  currency,
  ask,
  onClose,
  onDone,
}: {
  entry: OutboxEntry
  bySku: ReadonlyMap<string, api.CatalogRow>
  currency: string
  ask: ReturnType<typeof useApproval>["ask"]
  onClose: () => void
  /// Sent, or saved to go: the sheet closes with this said at the counter.
  onDone: (text: string, bad: boolean) => void
}) {
  // The swaps planned so far, each with the article both of its tags are.
  const [swaps, setSwaps] = useState<readonly (Swap & { readonly sku: string })[]>([])
  // The tag whose real one is being read or scanned.
  const [replacing, setReplacing] = useState<string | null>(null)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const asked = useRef(0)
  const field = useRef<HTMLInputElement>(null)

  const planOf = (list: readonly Swap[]) =>
    entry.epcs.map((epc) => list.find((one) => one.from === epc)?.to ?? epc)
  const plan = planOf(swaps)
  // Only an answer about the sale as it would go now counts.
  const current = verdict !== null && verdict.for === plan.join(",") ? verdict : null
  const named = new Map<string, api.Unsellable>()
  if (current !== null && current.ok) {
    for (const one of current.unsellable) named.set(one.epc.toUpperCase(), one)
  }

  /// The article a tag is: the node's word for it when it named the tag —
  /// that is what the customer was charged for — else the tag's own encoding.
  const skuOf = (epc: string): string | null => {
    const node = named.get(epc.toUpperCase())?.sku_code
    if (node !== undefined) return node
    const read = readScan(epc)
    return read.kind === "epc" ? read.sku_code : null
  }
  const nameOf = (sku: string | null) =>
    (sku === null ? undefined : bySku.get(sku)?.name) ?? skuText(sku)
  // The node's own idempotency conflict ("conflict: idempotency key was
  // already used…"): it already holds this sale's key. Today's node stores a
  // key only with a sale (`resolveRefused`), so an earlier send landed while
  // its answer was lost. Under that key the node prices and sells nothing new,
  // so the one move is to send it again unchanged, which lets it answer with
  // what it holds. No tag is swapped — the tags it holds are the ones sent —
  // and the stock check below does not apply: those tags read "sold already",
  // sold by this very sale. The price check still does, in case the key is
  // somehow no longer there and the node would price the sale afresh.
  const landed = /idempotency key/i.test(entry.problem ?? "")

  const check = useCallback(
    async (epcs: readonly string[]) => {
      const request = ++asked.current
      setVerdict(null)
      const answer = await priceFor(entry, epcs)
      if (request === asked.current) setVerdict(answer)
    },
    [entry],
  )

  // What the node says now about the sale as it was rung: which tags, and why.
  useEffect(() => {
    void check(entry.epcs)
  }, [check, entry])

  // Why it cannot go yet, or null when it can.
  const blocked: string | null =
    current === null
      ? "Checking with the node…"
      : !current.ok
        ? current.problem
        : !landed && current.unsellable.length > 0
          ? "Still refused. Replace the tag, or move the stock to the shop floor in the store app and check again."
          : current.dueMinor === null
            ? "The node has no price for this sale now, so the money can't be checked."
            : current.dueMinor !== entry.quotedTotalMinor
              ? `The node now prices this sale at ${money(current.dueMinor, currency)}, but ${money(
                  entry.quotedTotalMinor,
                  currency,
                )} was paid. A price change can't be made here — it needs a return and a new sale.`
              : swaps.some((one) => current.skus[entry.epcs.indexOf(one.from)] !== one.sku)
                ? "The node has a replacement tag as another article. That needs a return and a new sale."
                : null

  /// The tag read or scanned, as the real tag for `replacing` — only one of the
  /// same SKU, and only when the node would sell the sale with it.
  async function tryReplace(raw: string) {
    const from = replacing
    if (from === null || busy) return
    setProblem(null)
    const read = readScan(raw.trim().replace(/·/g, ""))
    if (read.kind !== "epc") {
      setProblem("That is not a garment's tag. Read it on the pad, or scan the tag itself.")
      return
    }
    const wanted = skuOf(from)
    if (wanted === null) {
      setProblem("This tag's article can't be told, so it can't be replaced here.")
      return
    }
    if (plan.some((epc) => epc.toUpperCase() === read.epc.toUpperCase())) {
      setProblem("That tag is already on this sale.")
      return
    }
    if (read.sku_code !== wanted) {
      setProblem(
        `That is ${nameOf(read.sku_code)} (${skuText(read.sku_code)}), not ${nameOf(
          wanted,
        )} (${skuText(wanted)}). A different article can't be swapped in here — ` +
          "it needs a return and a new sale.",
      )
      return
    }
    const next = [...swaps, { from, to: read.epc, sku: wanted }]
    setBusy(true)
    const answer = await priceFor(entry, planOf(next))
    setBusy(false)
    if (!answer.ok) {
      setProblem(answer.problem)
      return
    }
    const refusal = answer.unsellable.find(
      (one) => one.epc.toUpperCase() === read.epc.toUpperCase(),
    )
    if (refusal !== undefined) {
      setProblem(`…${read.epc.slice(-8)} can't be sold from this shop either: ${refusal.reason}.`)
      return
    }
    const at = entry.epcs.indexOf(from)
    if (answer.skus.length === entry.epcs.length && answer.skus[at] !== wanted) {
      setProblem(
        `The node has …${read.epc.slice(-8)} as ${skuText(answer.skus[at])}, not ${skuText(
          wanted,
        )}. That needs a return and a new sale.`,
      )
      return
    }
    // Whatever was still being asked is about the sale before this swap.
    asked.current += 1
    setSwaps(next)
    setVerdict(answer)
    setReplacing(null)
  }

  /// The garment alone on the R3's pad: the one tag there of the same SKU that
  /// is not on the sale already. Two of them, and it is not guessed.
  async function fromPad() {
    const from = replacing
    if (from === null || busy) return
    setProblem(null)
    const wanted = skuOf(from)
    if (wanted === null) {
      setProblem("This tag's article can't be told, so it can't be replaced here.")
      return
    }
    setBusy(true)
    let read: Awaited<ReturnType<typeof readRfidPad>>
    try {
      read = await readRfidPad()
    } catch (error) {
      setBusy(false)
      setProblem(`Chainway R3: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    setBusy(false)
    const fresh: { readonly epc: string; readonly sku: string }[] = []
    for (const tag of read.tags) {
      const one = readScan(tag.epc)
      if (one.kind !== "epc") continue
      if (plan.some((epc) => epc.toUpperCase() === one.epc.toUpperCase())) continue
      fresh.push({ epc: one.epc, sku: one.sku_code })
    }
    const same = fresh.filter((one) => one.sku === wanted)
    if (same.length === 1) {
      await tryReplace(same[0].epc)
      return
    }
    setProblem(
      same.length > 1
        ? `${same.length} tags of ${nameOf(wanted)} on the pad. Leave only the garment the customer took.`
        : fresh.length > 0
          ? `No tag of ${nameOf(wanted)} on the pad. A different article can't be swapped in here — it needs a return and a new sale.`
          : "No tag on the pad that isn't on this sale already.",
    )
  }

  function undo(from: string) {
    const next = swaps.filter((one) => one.from !== from)
    setSwaps(next)
    setProblem(null)
    void check(planOf(next))
  }

  /// A store manager's yes for exactly this, then the resolve.
  function send() {
    if (blocked !== null || busy || replacing !== null) return
    const planned: readonly Swap[] = swaps.map(({ from, to }) => ({ from, to }))
    ask({
      action: "EDIT_CART",
      title: "Resolve refused sale",
      detail: resolveDetail(entry, planned, currency),
      reason: entry.problem,
      epcs:
        planned.length === 0 ? entry.epcs : planned.flatMap((one) => [one.from, one.to]),
      amountMinor: entry.quotedTotalMinor,
      onApproved: (by) => void go(by, planned),
    })
  }

  /// Written down first — who, when, which tags — and then sent.
  async function go(by: Approved, planned: readonly Swap[]) {
    setBusy(true)
    setProblem(null)
    const again = resolveRefused(entry.localId, {
      at: new Date().toISOString(),
      by: by.username,
      approvalId: by.approvalId,
      replaced: planned,
      refusal: entry.problem,
    })
    if (again === null) {
      setBusy(false)
      setProblem("This sale is no longer waiting to be resolved.")
      return
    }
    try {
      await flush()
    } finally {
      setBusy(false)
    }
    if (again.saleId !== null) {
      onDone(`Refused sale sent and recorded — resolved by ${by.username}.`, false)
      return
    }
    if (again.refused) {
      // The node's new sentence is at the top; the plan starts again from the
      // sale as it now stands, its swaps included.
      setSwaps([])
      setReplacing(null)
      setProblem("The node refused it again.")
      void check(again.epcs)
      return
    }
    onDone(
      "Resolved and saved on this terminal — it goes to the node as soon as the node answers.",
      true,
    )
  }

  return (
    <Sheet
      title="Resolve refused sale"
      onClose={() => {
        if (!busy) onClose()
      }}
      foot={
        <>
          <button
            type="button"
            className="btn"
            disabled={busy || current === null}
            onClick={() => {
              setProblem(null)
              void check(plan)
            }}
          >
            Check again
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={blocked !== null || busy || replacing !== null}
            onClick={send}
          >
            {busy ? "Sending…" : swaps.length > 0 ? "Replace and send" : "Send again"}
          </button>
        </>
      }
    >
      <div className="notice warn">
        {new Date(entry.takenAt).toLocaleString("id-ID")} ·{" "}
        <span className="num">{money(entry.quotedTotalMinor, currency)}</span>
        {entry.problem !== null && <> — the node said: {entry.problem}</>}
      </div>
      {landed && (
        <p className="notice">
          The node already holds this sale&apos;s own key: an earlier send reached
          it, and nothing can be sold twice under that key. Send it again
          unchanged while {entry.actorId} is signed in, so the node can answer
          with what it holds. Refused again, head office has to match it on the
          node.
        </p>
      )}

      <div className="rows">
        {entry.epcs.map((epc) => {
          const swap = swaps.find((one) => one.from === epc)
          const sku = swap?.sku ?? skuOf(epc)
          const why = named.get((swap?.to ?? epc).toUpperCase())?.reason
          // Offered for a tag the node names, or for every tag when the node
          // could not answer about the sale at all.
          const canReplace =
            !landed &&
            swap === undefined &&
            current !== null &&
            (!current.ok || named.has(epc.toUpperCase()))
          return (
            <div className="row-item" key={epc}>
              <div className="grow">
                <h3>{nameOf(sku)}</h3>
                <p className="num">
                  {skuText(sku)} · …{epc.slice(-8)}
                  {swap !== undefined && <> → …{swap.to.slice(-8)}</>}
                </p>
                {why !== undefined && <p>{why}</p>}
              </div>
              {swap !== undefined ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => undo(epc)}
                >
                  Undo
                </button>
              ) : canReplace ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy || replacing === epc}
                  onClick={() => {
                    setReplacing(epc)
                    setProblem(null)
                  }}
                >
                  Replace
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      {replacing !== null && (
        <form
          key={replacing}
          className="rows"
          onSubmit={(event) => {
            event.preventDefault()
            const input = field.current
            if (input === null) return
            const value = input.value
            input.value = ""
            void tryReplace(value)
          }}
        >
          <label className="field">
            Real tag of the {nameOf(skuOf(replacing))} for …{replacing.slice(-8)}
            <input
              ref={field}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={isWeb ? "Scan the tag" : "Scan the tag, or read it on the pad"}
            />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {!isWeb && (
              <button
                type="button"
                className="btn"
                disabled={!inShell() || busy}
                onClick={() => void fromPad()}
              >
                Read the pad
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => {
                setReplacing(null)
                setProblem(null)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {problem !== null ? (
        <p className="error">{problem}</p>
      ) : (
        blocked !== null && <p className="muted">{blocked}</p>
      )}
    </Sheet>
  )
}

/// The card number inside a scanned member barcode, or null when the scan is
/// not one. `M1:` is the member app's payload version; anything else is left
/// to `readScan`, which knows tags and SKUs.
function memberFromScan(raw: string): string | null {
  const text = raw.trim()
  if (!text.toUpperCase().startsWith("M1:")) return null
  const id = text.slice(3).trim()
  return id === "" ? null : id
}
