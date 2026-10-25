import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"

import * as api from "@/api"
import { sound } from "@/sound"
import { SIMULATED } from "@/simulation"
import { useScanner } from "@/scanner"
import { EmployeeFinger } from "@/benefit-finger"
import { publish } from "@/customer-link"
import { useApproval, type Approved } from "@/approval"
import {
  device,
  inShell,
  NOT_ON_THAT_LINE,
  NOTHING_HEARD,
  openCustomerDisplay,
  readerProblem,
  readerStatus,
  readRfidPad,
  sentence,
  type Fault,
  type ReaderState,
  type ReaderStatus,
} from "@/edge"
import { isWeb } from "@/edition"
import { Icon, type IconName } from "@/icons"
import {
  BAGS,
  bagName,
  CancelSale,
  ReceiptPreview,
  Sheet,
} from "@/screens/dialogs"
import { KeyBar, type KeyId } from "@/keybar"
import { useShortcuts, viaPointer } from "@/shortcuts"
import {
  enqueue,
  flush,
  resolveRefused,
  useOutbox,
  type OutboxEntry,
  type Swap,
} from "@/outbox"
import { drawerOnSale, peripheralsOf, printReceiptHere, receiptTarget } from "@/peripherals"
import { authorizeVoucher, releaseVoucher } from "@/vouchers"
import {
  authorizeCoupon,
  onTheWire,
  releaseCoupon,
  type CouponHold,
} from "@/coupons"
import { seatNow, useSeat } from "@/seat"
import {
  benefitSaid,
  lookupBenefit,
  returnBenefit,
  spendBenefit,
  type BenefitHolder,
} from "@/benefit"
import {
  askRedeem,
  cancelRedeem,
  confirmRedeemRequest,
  lookupRedeemRequest,
  redeemProgress,
  type ConfirmedRedeemRequest,
} from "@/redeem"
import { useNodeConfig, useSession, type NodeConfig } from "@/session"
import {
  refreshPaymentMethods,
  useEdcMachines,
  usePaymentMethods,
  usePointsOffered,
  type EdcMachine,
  type MethodChoice,
  type MethodTile,
} from "@/payment-methods"
import { articleId, sku as skuText } from "@/sku"
import { Photo, usePhoto } from "@/photo"
import { readScan } from "@epc"
import { money, units as grouped } from "@itulah/contract/money"

import {
  asCount,
  asMap,
  asText,
  creditMethod,
  referenceFor,
  ReturnPick,
  type ExchangeCredit,
  type Receipt,
} from "@/screens/exchange"
import { HeldDialog, type HeldRow } from "@/screens/held"
import { SetoranDialog, TambahModalDialog } from "@/screens/laci"
import { VoidDialog } from "@/screens/void"
import { MemberSheet, memberFromScan } from "@/screens/member"
import "./till-d.css"
import "./pay-d.css"

/// The client's nine divisions (cloud 0382), by the name the floor uses.
const DIVISION_NAME: Readonly<Record<string, string>> = {
  WANITA: "Wanita", PRIA: "Pria", ANAK_LAKI: "Anak Laki-laki", ANAK_PEREMPUAN: "Anak Perempuan",
  PERLENGKAPAN_BAYI: "Perlengkapan Bayi", SANDAL_SEPATU: "Sandal dan Sepatu", TAS: "Tas",
  AKSESORIS: "Aksesoris", NON_DIVISI: "Non Divisi",
}
const divisionName = (code: string | null | undefined) =>
  code ? (DIVISION_NAME[code] ?? code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, " ")) : "—"

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
/// **A tag is what a sale is made of; a piece without one still sells.**
/// `SaleRequest` is `{ epcs, untagged, tenders, … }`: the node is told which
/// tags were sold and prices them itself. A SKU typed off the label, a tag the
/// store does not hold and a Barang tak dikenal go in `untagged`, one entry
/// per piece (docs/unmatched-sales-contract.md): the sale always goes through,
/// the node says which kind each one is, and head office matches it to a real
/// piece later. A barcode alone is still "how much is this" (F2), not a line.
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
  /// The tag. On a piece with no tag (`untagged`) it is a local id that only
  /// names the line on this counter and never goes to the node.
  readonly epc: string
  readonly sku_code: string
  readonly name: string | null
  readonly unitPriceMinor: number | null
  /// Set on a piece sold without a tag: a SKU typed off the label, or a
  /// Barang tak dikenal (then `priced`, with who approved the price and the
  /// node's record of that yes, which rides on the quote and the sale).
  readonly untagged?: {
    readonly priced?: { readonly by: string; readonly approvalId: string }
  }
}

const isUntagged = (unit: Unit) => unit.untagged !== undefined
/// A Barang tak dikenal: no SKU, the price a Kepala toko approved.
const isUnknown = (unit: Unit) => unit.untagged?.priced !== undefined

/// What the node is told about the units on the counter: the tags it reads,
/// and one `untagged` entry for each piece that has none.
function wireOf(units: readonly Unit[]): {
  readonly epcs: string[]
  readonly untagged: api.UntaggedLine[]
} {
  const epcs: string[] = []
  const untagged: api.UntaggedLine[] = []
  for (const unit of units) {
    if (unit.untagged === undefined) epcs.push(unit.epc)
    else if (unit.untagged.priced === undefined) untagged.push({ sku_code: unit.sku_code })
    else {
      untagged.push({
        name: unit.name,
        unit_price_minor: unit.unitPriceMinor,
        approval_id: unit.untagged.priced.approvalId,
      })
    }
  }
  return { epcs, untagged }
}

/// A line's pill (`.id-tag`): where the piece came from, in the till's words.
type IdTag = { readonly text: string; readonly warn: boolean }

/// What the node said about one untagged line, kept by the unit it is about.
type QuoteLabel = {
  readonly kind: api.UntaggedKind
  readonly fromPlace: string | null
  /// What the line comes to after promotions, the node's word.
  readonly lineTotalMinor: number | null
}

function idTagOf(unit: Unit, labels: ReadonlyMap<string, QuoteLabel>): IdTag | null {
  // Only one thing is said in Keterangan about where a piece came from: the
  // store holds none of it, so the sale takes its stock below zero.
  return labels.get(unit.epc)?.kind === "NOT_IN_STOCK" ? { text: "★ Stok minus", warn: true } : null
}

/// The node's answers about the untagged lines, matched to the units that were
/// sent: `index` is the position among the untagged ones, and a tag it turned
/// into one comes back with its `epc`.
function labelsOf(
  units: readonly Unit[],
  entries: readonly api.UntaggedQuoteLine[],
): Map<string, QuoteLabel> {
  const loose = units.filter(isUntagged)
  const tags = new Map(
    units.filter((unit) => !isUntagged(unit)).map((unit) => [unit.epc.toUpperCase(), unit] as const),
  )
  const out = new Map<string, QuoteLabel>()
  for (const entry of entries) {
    const unit =
      typeof entry.index === "number"
        ? loose[entry.index]
        : typeof entry.epc === "string"
          ? tags.get(entry.epc.toUpperCase())
          : undefined
    if (unit === undefined) continue
    out.set(unit.epc, {
      kind: entry.kind,
      fromPlace: entry.from_place ?? null,
      lineTotalMinor: typeof entry.line_total_minor === "number" ? entry.line_total_minor : null,
    })
  }
  return out
}

type Held = {
  readonly id: string
  readonly units: readonly Unit[]
  readonly coupons: readonly string[]
  readonly customerId: string | null
  readonly at: string
  /// What it came to after its discounts, as the node last priced it.
  readonly totalMinor?: number
  /// The bags on its bill, so a resume is the basket exactly as it was parked.
  readonly charges?: readonly api.Charge[]
  readonly member?: api.Member | null
}

type Quote = {
  readonly totalMinor: number | null
  readonly stale: boolean
  readonly problem: string | null
  readonly discountTotalMinor: number
  readonly pointsEarned: number
  readonly promotions: readonly api.PromotionOutcome[]
  readonly grantedLines: readonly api.GrantedLine[]
  /// One per tag, in the order the tags were sent.
  readonly lines: readonly api.QuotedLine[]
  /// Limited coupons the node would not apply without a hold from head office.
  readonly toAuthorize: readonly string[]
  /// The basket this answer prices (`basisOf`). Payment opens only on an
  /// answer for exactly the basket on the counter.
  readonly basis: string | null
  /// Tags the node will not sell from this shop's floor. Taken off the basket
  /// as soon as they are named; payment waits until the answer has none.
  readonly unsellable: readonly api.Unsellable[]
  /// What the node said about each untagged line, by the unit's `epc`.
  readonly labels: ReadonlyMap<string, QuoteLabel>
}

const emptyQuote = (): Quote => ({
  totalMinor: null,
  stale: false,
  problem: null,
  discountTotalMinor: 0,
  pointsEarned: 0,
  promotions: [],
  grantedLines: [],
  lines: [],
  toAuthorize: [],
  basis: null,
  unsellable: [],
  labels: new Map(),
})

/// Everything a quote is asked about, as one string, so "is this answer about
/// the basket on the counter" is one comparison.
function basisOf(
  units: readonly Unit[],
  coupons: readonly string[],
  customerId: string | null,
  charges: readonly api.Charge[],
  holds: readonly CouponHold[],
): string {
  // The untagged lines by what identifies them — never the proof they carry.
  const loose = units
    .filter(isUntagged)
    .map((unit) => (isUnknown(unit) ? [unit.name, unit.unitPriceMinor] : [unit.sku_code]))
  return JSON.stringify([wireOf(units).epcs, loose, coupons, customerId, charges, holds])
}

/// What one scan came to, for a caller that scans many at once (the R3's pad).
type ScanOutcome = "added" | "already" | "other"

/// "Kemeja Oxford · …A1B2C3D4": a unit named the way a cashier finds it — the
/// article, and the end of its tag, which is what tells two of them apart.
function unitName(unit: Unit): string {
  const name = unit.name ?? skuText(unit.sku_code)
  return isUntagged(unit) ? name : `${name} · …${unit.epc.slice(-8)}`
}

/// Why the node will not sell a tag, in the till's plain words with a code
/// (`docs/rfid-status-and-errors.md`, "Tags the node refuses"). Matched on the
/// node's own words, as `quote_basket` and `complete_sale` in
/// `backend/src/edge/sqlite.rs` write them.
type TagRefusal = { readonly code: string; readonly says: string; readonly action: string }

const TAG_REFUSALS: readonly (readonly [RegExp, TagRefusal])[] = [
  [
    /^not in this shop's stock/i,
    {
      code: "TAG-01",
      says: "Sudah terjual, atau belum pernah diterima di toko ini.",
      action: "Taruh di samping dan panggil kepala toko.",
    },
  ],
  [
    /^in the stockroom/i,
    {
      code: "TAG-02",
      says: "Masih di gudang, belum di lantai toko.",
      action: "Minta kepala toko memindahkannya ke lantai toko.",
    },
  ],
  [
    /^set aside as damaged/i,
    {
      code: "TAG-03",
      says: "Dipisahkan karena rusak.",
      action: "Taruh di samping dan panggil kepala toko.",
    },
  ],
  [
    /^marked missing/i,
    {
      code: "TAG-04",
      says: "Ditandai hilang di lantai toko.",
      action: "Minta kepala toko mengeceknya di aplikasi toko.",
    },
  ],
  [
    /^not on the shop floor/i,
    {
      code: "TAG-05",
      says: "Tidak ada di lantai toko ini.",
      action: "Minta kepala toko mengeceknya di aplikasi toko.",
    },
  ],
  [
    /^not found: EPC /i,
    {
      code: "TAG-06",
      says: "Bukan barang toko ini.",
      action: "Taruh di samping dan panggil kepala toko.",
    },
  ],
  [
    /insufficient quantity/i,
    {
      code: "TAG-07",
      says: "Sudah terjual, atau tidak lagi di lantai toko.",
      action: "Selesaikan dengan kepala toko.",
    },
  ],
]

function tagRefusal(reason: string): TagRefusal | null {
  const said = reason.trim()
  return TAG_REFUSALS.find(([pattern]) => pattern.test(said))?.[1] ?? null
}

/// "Already sold, or never received at this shop (TAG-01)" — or the node's
/// own words, when this till does not know them.
function refusalWords(raw: string): string {
  const reason = plainWords(raw)
  const refusal = tagRefusal(reason)
  return refusal === null ? reason : `${refusal.says.replace(/\.$/, "")} (${refusal.code})`
}

/// What the node said about a basket it would not price. A tag it does not
/// know at all is named the way the cashier finds the garment.
/// The node's refusals come as `conflict: …`; the cashier reads what follows.
const plainWords = (words: string) => words.replace(/^conflict:\s*/i, "")

function quoteProblem(raw: string, units: readonly Unit[]): string {
  const problem = plainWords(raw)
  const coupon = /unknown coupon code:\s*(\S+)/i.exec(problem)
  if (coupon !== null) return `Kupon ${coupon[1]} tidak dikenal server toko — hapus kuponnya.`
  const refusal = tagRefusal(problem)
  if (refusal === null) return problem
  const epc = /EPC\s+(\S+)/i.exec(problem)?.[1]?.toUpperCase()
  const unit =
    epc === undefined ? undefined : units.find((one) => one.epc.toUpperCase() === epc)
  const which =
    unit !== undefined ? `${unitName(unit)}: ` : epc !== undefined ? `…${epc.slice(-8)}: ` : ""
  return `${which}${refusal.says} ${refusal.action} (${refusal.code})`
}

/// The R3's state in the words the till shows, and the badge it wears.
const READER_WORDS: Readonly<Record<ReaderState, readonly [string, string]>> = {
  ready: ["Siap", "badge ok"],
  busy: ["Sibuk", "badge plain"],
  attention: ["Perlu dicek", "badge warn"],
  not_connected: ["Tidak terhubung", "badge bad"],
}

/// The R3 in one word — beside its read button and on Till devices. Busy
/// while `busy` (this window is reading) or before the shell has answered.
/// Its title carries the code and the detail, for support; pressing it, when
/// `onCheck` is given, asks the shell again.
export function ReaderChip({
  status,
  busy = false,
  onCheck,
}: {
  status: ReaderStatus | null
  busy?: boolean
  onCheck?: () => void
}) {
  const state: ReaderState = busy || status === null ? "busy" : status.state
  const [words, badge] = READER_WORDS[state]
  const title =
    status === null
      ? "Menanyakan R3…"
      : status.fault !== null
        ? `${sentence(status.fault)} ${status.fault.detail}`
        : status.detail
  return onCheck === undefined ? (
    <span className={badge} title={title}>
      {words}
    </span>
  ) : (
    <button type="button" className={badge} title={title} onClick={onCheck}>
      {words}
    </button>
  )
}

/// A note about one read, in the cashier's words with its code.
const noteOf = (fault: Omit<Fault, "detail">) => sentence({ ...fault, detail: "" })

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
  /// The cash handed over, for the change dialog's "Tunai …" line.
  readonly cashMinor?: number
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

/// The three most recent sales of one shift, newest first — what the cashier
/// sees of the day's receipts, and nothing more: enough to reprint the one just
/// handed over, never a book to browse. Null while unknown, when the node
/// refuses (it does not show a drawer's sales to a CASHIER) and before any
/// answer; a later failure keeps the last list rather than blanking it.
function useLastSales(
  shiftId: string | null,
  refresh: string,
): readonly api.ShiftSale[] | null {
  const [sales, setSales] = useState<readonly api.ShiftSale[] | null>(null)
  const asked = useRef(0)
  useEffect(() => {
    if (shiftId === null) {
      setSales(null)
      return
    }
    const mine = ++asked.current
    void api.shiftSales(shiftId).then((reply) => {
      if (mine !== asked.current) return
      if (reply.ok && Array.isArray(reply.body)) {
        // Newest first by the time they were rung, not by the order they came.
        const newest = [...reply.body].sort(
          (a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at),
        )
        setSales(newest.slice(0, 3))
      } else if (reply.status === 403) setSales(null)
    })
  }, [shiftId, refresh])
  return sales
}

/// What Merchandising calls each article, by SKU, kept as long as this window
/// lives (owner, 24 Oct 2026: "Pria · Koko, Lebaran" under the name). The node
/// is asked once for the SKUs a basket brings that nobody has asked about, in
/// one call; a SKU it does not know is kept as having none, and a call that
/// failed is not kept — those SKUs are asked again with the next change of
/// basket.
const TAGS_OF = new Map<string, readonly string[]>()
const TAGS_ASKING = new Set<string>()

function useTags(skus: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const [, heard] = useState(0)
  const wanted = [...new Set(skus.filter((sku) => sku !== ""))].filter(
    (sku) => !TAGS_OF.has(sku) && !TAGS_ASKING.has(sku),
  )
  const key = wanted.join(",")
  useEffect(() => {
    if (key === "") return
    const asking = key.split(",")
    for (const sku of asking) TAGS_ASKING.add(sku)
    void api.catalogIdentities(asking).then((reply) => {
      for (const sku of asking) TAGS_ASKING.delete(sku)
      if (!reply.ok) return
      const named = new Map((reply.body?.items ?? []).map((one) => [one.sku_code, one.tags] as const))
      for (const sku of asking) TAGS_OF.set(sku, named.get(sku) ?? [])
      heard((was) => was + 1)
    })
  }, [key])
  return TAGS_OF
}

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
    return "Kantor pusat tidak terjangkau — pakai cara bayar lain."
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

/// A piece with no tag, read back from a parked basket. A Barang tak dikenal
/// keeps who approved its price and the node's record of that yes.
function revivePieceOf(raw: Record<string, unknown>): NonNullable<Unit["untagged"]> {
  const priced = raw.priced
  if (typeof priced !== "object" || priced === null) return {}
  const one = priced as Record<string, unknown>
  if (typeof one.by !== "string" || typeof one.approvalId !== "string") return {}
  return { priced: { by: one.by, approvalId: one.approvalId } }
}

/// One held basket read back, from this terminal's storage or from the node's
/// list. A row that cannot be read as a hold is null, never a reason to drop
/// the others.
function reviveHeld(row: unknown, fallbackId: string | null = null): Held | null {
  if (typeof row !== "object" || row === null) return null
  const one = row as Record<string, unknown>
  const id = typeof one.id === "string" ? one.id : fallbackId
  if (id === null || !Array.isArray(one.units)) return null
  const units: Unit[] = []
  for (const unit of one.units) {
    if (typeof unit !== "object" || unit === null) continue
    const u = unit as Record<string, unknown>
    if (typeof u.epc !== "string" || typeof u.sku_code !== "string") continue
    const piece =
      typeof u.untagged === "object" && u.untagged !== null
        ? revivePieceOf(u.untagged as Record<string, unknown>)
        : undefined
    // A piece with no SKU and no approved price is nothing the node can sell.
    if (piece !== undefined && piece.priced === undefined && u.sku_code === "") continue
    units.push({
      epc: u.epc,
      sku_code: u.sku_code,
      name: typeof u.name === "string" ? u.name : null,
      unitPriceMinor: typeof u.unitPriceMinor === "number" ? u.unitPriceMinor : null,
      ...(piece === undefined ? {} : { untagged: piece }),
    })
  }
  return {
    id,
    units,
    coupons: Array.isArray(one.coupons)
      ? one.coupons.filter((code): code is string => typeof code === "string")
      : [],
    customerId: typeof one.customerId === "string" ? one.customerId : null,
    at: typeof one.at === "string" ? one.at : new Date().toISOString(),
    totalMinor: typeof one.totalMinor === "number" ? one.totalMinor : undefined,
    charges: Array.isArray(one.charges) ? (one.charges as api.Charge[]) : [],
    member: typeof one.member === "object" && one.member !== null ? (one.member as api.Member) : null,
  }
}

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
  return parsed.flatMap((row) => reviveHeld(row) ?? [])
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

/// Send one sale's receipt where this till prints. The one print path: the
/// receipt step after a sale and a reprint from the last receipts both go
/// through it, so a copy can never come out differently from the original.
///
/// The USB printer on this till: the node renders, this till sends. `usb` is
/// never set in web — there is no peripherals screen there to choose one — but
/// the shell-only send is skipped by edition too, rather than trusted to stay
/// that way. Null when there is nowhere to print.
async function sendReceipt(
  config: NodeConfig | null,
  saleId: string,
  copy: boolean,
): Promise<{ readonly ok: boolean; readonly text: string } | null> {
  if (config === null) return null
  const { target, here: usb } = receiptTarget(config)
  // A reprint never kicks the drawer: the money is already in.
  const drawer = copy ? "NONE" : drawerOnSale(config)
  const done = copy ? "Salinan struk tercetak." : "Struk tercetak."
  if (!isWeb && usb !== null) {
    const printed = await printReceiptHere(saleId, { paper: config.paper, drawer, copy })
    return printed.ok
      ? { ok: true, text: done }
      : { ok: false, text: printed.problem }
  }
  if (target === null) return null
  const reply = await api.printReceipt(saleId, {
    ...target,
    paper: config.paper,
    drawer,
    copy,
  })
  return reply.ok
    ? { ok: true, text: done }
    : { ok: false, text: reply.problem ?? "Struk tidak tercetak." }
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
  | "setup"
  /// What is plugged into this till — an Admin's, opened from the door.
  | "peripherals"
  /// Finding the shop's node and asking head office to let this till in.
  | "join"

/// Return mode (client, 23 Oct 2026): the sale screen itself. The pieces that
/// came back are read by RFID and sit as amber rows; each replacement sits
/// right under the piece it replaces.
type ReturnMode = {
  readonly receipt: Receipt
  /// The tags that receipt sold and has not taken back; null when the
  /// movements do not reach that far (the node still checks every one).
  readonly soldTags: ReadonlySet<string> | null
  readonly back: readonly {
    /// The tag read back; for a piece sold without a tag, a key of the till's.
    readonly epc: string
    readonly sku: string
    readonly name: string
    readonly unitMinor: number
    /// Sold without a tag: it comes back by its SKU (owner, 25 Oct 2026).
    readonly untagged?: boolean
  }[]
  /// The returned piece the next replacement goes under; -1 (the piece clicked
  /// again) means the next scan is "Barang baru", an extra item paid in Bayar.
  readonly sel: number
  /// Replacement unit (its `epc`) -> index into `back`.
  readonly rep: ReadonlyMap<string, number>
}

export function Till({
  actorId,
  terminalId,
  where,
  onGo,
  onLock,
  onMenu,
  onSeatLost,
}: {
  actorId: string
  terminalId: string
  where: Where
  onGo: (next: Where) => void
  onLock: () => void
  /// Back to the menu (Ctrl+M, and the person menu's first item). Left out and
  /// neither the key nor the item exists.
  onMenu?: () => void
  /// The node says the shift this till is selling on is no longer the
  /// person's — somebody took the seat. `by` is who, when the node said.
  onSeatLost: (by: string | null) => void
}) {
  const [rows, setRows] = useState<readonly api.CatalogRow[]>([])
  const [bookProblem, setBookProblem] = useState<string | null>(null)
  const [units, setUnits] = useState<readonly Unit[]>([])
  // F8 Return: which receipt (the picker), then Return mode on this screen
  // (`ret`); the credit a recorded return carries into Bayar for the
  // replacements now in the basket.
  const [exchanging, setExchanging] = useState(false)
  const [ret, setRet] = useState<ReturnMode | null>(null)
  const retRef = useRef(ret)
  retRef.current = ret
  // Bayar asks "Apakah pelanggan member?" once per sale.
  const [asked, setAsked] = useState(false)
  // F3: the drawer menu, and the two dialogs it opens.
  const [laci, setLaci] = useState<null | "menu" | "modal" | "setor">(null)
  // F1 Void: a dialog over the counter, with its own keys (and its own finger
  // sheet), so the counter's keys stand aside.
  const [voiding, setVoiding] = useState(false)
  const [credit, setCredit] = useState<ExchangeCredit | null>(null)
  // The sale as it is now, for work that finishes after a render (a typed SKU).
  const unitsRef = useRef(units)
  unitsRef.current = units
  /// Warna and Ukuran from the catalogue name (owner, 23 Oct 2026): the
  /// store's book carries no colour or size field, but every name is the
  /// article, then the colour, then the size — "GAMIS 119 HITAM ALL SIZE".
  /// The article part is what the article's SKUs share; a size is the last
  /// word (or "ALL SIZE" / "FREE SIZE").
  const variants = useMemo(() => {
    const byArticle = new Map<string, string[][]>()
    for (const row of rows) {
      const words = row.name.trim().split(/\s+/)
      const article = row.sku_code.slice(0, 8)
      byArticle.set(article, [...(byArticle.get(article) ?? []), words])
    }
    const out = new Map<string, { colour: string; size: string }>()
    for (const row of rows) {
      const words = row.name.trim().split(/\s+/)
      const siblings = (byArticle.get(row.sku_code.slice(0, 8)) ?? []).filter(
        (other) => other.join(" ") !== words.join(" "),
      )
      let shared = siblings.length === 0 ? Math.max(0, words.length - 3) : words.length
      for (const other of siblings) {
        let at = 0
        while (at < words.length && at < other.length && words[at] === other[at]) at += 1
        shared = Math.min(shared, at)
      }
      const rest = words.slice(shared)
      let size = ""
      const tail2 = rest.slice(-2).join(" ").toUpperCase()
      if (/^(ALL|FREE) SIZE$/.test(tail2) || /^(EU|UK|US) \d{1,2}([.,]5)?$/.test(tail2)) size = rest.splice(-2).join(" ")
      else if (rest.length > 0 && /^(XXXL|XXL|XL|L|M|S|XS|\d{1,2}([/-]\d{1,2})?)$/i.test(rest[rest.length - 1] ?? "")) {
        size = rest.splice(-1).join(" ")
      }
      out.set(row.name, { colour: rest.join(" "), size })
    }
    return out
  }, [rows])
  // Held sales live on the store node (any cashier continues one, gone at the
  // end of the day). A node without the route keeps them here, on this counter.
  const [held, setHeld] = useState<readonly Held[]>(readHolds)
  const [nodeHeld, setNodeHeld] = useState<readonly api.HeldSale[]>([])
  const [heldOn, setHeldOn] = useState<boolean | null>(null)
  const heldOnNow = useRef(heldOn)
  heldOnNow.current = heldOn
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
    /// "Apakah pelanggan member?", asked once when Bayar is pressed.
    | "ask"
    /// F5: Daftar member, the registration form straight away, with the
    /// optional "No. transaksi" of a sale already rung.
    | "register"
    | "coupon"
    | { readonly receipt: string }
    /// Enter on a picked line (or a click on its photo or name): the item card,
    /// by the line's key.
    | { readonly item: string }
    /// A refused sale being resolved, by its outbox row.
    | { readonly resolve: string }
  >(null)
  // The bag choices open in their row, not in a dialog.
  const [bagPick, setBagPick] = useState(false)
  // Kantong pops in for a pointer; F6 shows it at once.
  const bagEnter = useMemo(() => bagPick && viaPointer(), [bagPick])
  const bagRow = useRef<HTMLDivElement>(null)
  // F2: the next scan or typed word is a price check — a tag is looked up, not
  // sold. Left again by Escape, or by the one check it was for.
  const [checking, setChecking] = useState(false)
  // The line numpad − takes a unit off, picked with ↑ ↓ or a click; null is
  // "the newest", which is where a scan leaves it.
  const [pickedKey, setPickedKey] = useState<string | null>(null)
  // A 1024 screen folds the grid the way the prototype's 1024 frame does: no
  // SKU column, no Warna/Ukuran split, a narrower Keterangan.
  const narrow = useNarrow()
  const [customerId, setCustomerId] = useState<string | null>(null)
  // Who head office says the member is, from F5 or from registering one. Shown
  // in the member row only while it is still the member on the sale; a card
  // scanned at the scan field names a number and has no name here.
  const [memberInfo, setMemberInfo] = useState<api.Member | null>(null)
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null)
  // Whether this shop's node knows pieces with no tag: true once it has
  // answered a quote with `untagged` (or has the unmatched routes), false when
  // it has none of them. Until it is true a typed SKU sells as it always did,
  // from a tag on the floor, and nothing untagged is ever sent — a node that
  // predates unmatched sales would ignore it and ring the sale without it.
  const [untaggedOk, setUntaggedOk] = useState<boolean | null>(null)
  const untaggedOkNow = useRef(untaggedOk)
  untaggedOkNow.current = untaggedOk
  useEffect(() => {
    let alive = true
    void api.unmatchedProbe().then((reply) => {
      if (!alive) return
      if (reply.ok) setUntaggedOk((was) => was ?? true)
      else if (reply.status === 404 || reply.status === 405) setUntaggedOk((was) => was ?? false)
    })
    return () => {
      alive = false
    }
  }, [])
  const [rfidBusy, setRfidBusy] = useState(false)
  // How the R3 stands, as the shell last said, for the chip beside its
  // button and the status bar. Opened once when the counter comes up, then
  // asked every few seconds without touching the reader — an unplugged cable
  // shows without a read — and again after every read.
  const [reader, setReader] = useState<ReaderStatus | null>(null)
  const readingNow = useRef(false)
  useEffect(() => {
    if (isWeb) return
    let alive = true
    let timer: number | undefined
    void readerStatus(true).then((first) => {
      if (!alive) return
      setReader(first)
      timer = window.setInterval(() => {
        if (readingNow.current) return
        void readerStatus(false).then((now) => {
          if (alive && !readingNow.current) setReader(now)
        })
      }, 5_000)
    })
    return () => {
      alive = false
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [])
  // Taking one unit off a line of several: the line's SKU while the cashier
  // reads or picks the exact tag that goes, so the tag handed back is the tag
  // taken off — never whichever of them was scanned last.
  const [removing, setRemoving] = useState<string | null>(null)
  const [check, setCheck] = useState<readonly api.CatalogRow[]>([])
  // The matches are for selling (a search at the scan field), not for F2's
  // read-only price check; and which of them ↑ ↓ points at.
  const [checkSell, setCheckSell] = useState(false)
  const [checkAt, setCheckAt] = useState(0)
  // F2 on a voucher: what head office says it is. Read-only — it never goes
  // into the basket; the request counter drops an answer that came late.
  const [voucher, setVoucher] = useState<api.VoucherCheck | null>(null)
  const voucherAsk = useRef(0)
  const [quote, setQuote] = useState<Quote>(emptyQuote)
  const quoteRequest = useRef(0)
  const [sold, setSold] = useState<Sold | null>(null)
  // Ctrl+P: the last sale this window completed.
  const lastSoldId = useRef<string | null>(null)
  // What Transaksi selesai prints besides the node's receipt — the promotions by
  // name, the member and the points — kept as they were when the sale was rung:
  // the basket under the dialog is priced again until the next customer.
  const soldFor = useRef<{
    readonly id: string
    readonly promos: readonly { readonly name: string; readonly cutMinor: number }[]
    readonly bags: readonly { readonly name: string; readonly quantity: number; readonly priceMinor: number }[]
    readonly member: string | null
    readonly points: number
  } | null>(null)
  if (sold !== null && soldFor.current?.id !== sold.id) {
    soldFor.current = {
      id: sold.id,
      promos: quote.promotions
        .filter((one) => one.applied && one.benefit_minor > 0)
        .map((one) => ({ name: one.name, cutMinor: one.benefit_minor })),
      // The node's receipt carries the goods alone; a bag is on the bill, so
      // the paper adds it as the line it is on the counter.
      bags: BAGS.flatMap((bag) => {
        const quantity = charges.filter((charge) => charge.description === bag.description).length
        return quantity > 0 && bag.amount_minor > 0
          ? [{ name: bagName(bag), quantity, priceMinor: bag.amount_minor }]
          : []
      }),
      member: memberInfo !== null && memberInfo.member_id === customerId ? memberInfo.display_name : null,
      points: quote.pointsEarned,
    }
  }
  const scan = useRef<HTMLInputElement>(null)
  const outbox = useOutbox()
  // Taking something back off the counter needs a second person: a unit
  // lifted out of the basket, or the whole basket abandoned.
  const approval = useApproval()
  // This till's own configuration: its peripherals (the R3's check tag, the
  // receipt printer) and how it reaches its node.
  const { config: shell } = useNodeConfig()
  // The last three receipts of this person's shift, for the column under the
  // money, and which of them Ctrl+P / Print sends to the printer. Asked again
  // after every sale (the sale itself, and the outbox emptying when the node
  // takes it later) and on coming back from Return or Void, which change a
  // receipt's status.
  const session = useSession()
  const seat = useSeat()
  const [voidCount, setVoidCount] = useState(0)
  const lastSales = useLastSales(
    seat?.shift_id ?? null,
    `${sold?.saleId ?? ""}|${outbox.unsent}|${where}|${voidCount}`,
  )
  // Ctrl+P prints this shift's latest receipt again; the status strip names it.
  const pickedSale = lastSales?.[0] ?? null

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
  // Under each name: the article's division, then its tags (S4, 24 Oct 2026).
  const tagsOf = useTags([
    ...units.filter((unit) => !isUnknown(unit)).map((unit) => unit.sku_code),
    ...(ret?.back.map((one) => one.sku) ?? []),
  ])
  const subOf = (sku: string) => {
    const division = bySku.get(sku)?.division_code
    return [division ? divisionName(division) : "", (tagsOf.get(sku) ?? []).join(", ")]
      .filter((word) => word !== "")
      .join(" · ")
  }

  const booked = units.reduce((sum, unit) => sum + (unit.unitPriceMinor ?? 0), 0)
  const unpriced = units.some((unit) => unit.unitPriceMinor === null)
  const chargeTotal = charges.reduce((sum, charge) => sum + charge.amount_minor, 0)
  const total = quote.totalMinor ?? booked + chargeTotal
  const currency = rows[0]?.currency ?? "IDR"

  // What is on the counter now, against what the last answer priced.
  const basis = basisOf(units, coupons, customerId, charges, couponHolds)
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
        ? "Menghitung…"
        : quote.problem !== null
          ? quoteProblem(quote.problem, units)
          : quote.unsellable.length > 0
            ? `Tidak bisa dijual dari toko ini — ${quote.unsellable
                .map((one) => {
                  const unit = units.find(
                    (each) => each.epc.toUpperCase() === one.epc.toUpperCase(),
                  )
                  return `${unit === undefined ? `…${one.epc.slice(-8)}` : unitName(unit)}: ${refusalWords(one.reason)}`
                })
                .join("; ")}. Dikeluarkan dari transaksi.`
            : quote.totalMinor === null
              ? "Sementara — server toko belum punya daftar harga"
              : null

  // One line per article: the same SKU at the same price is "× 3", not three
  // rows. A unit is still its tag — taking one off names that tag's EPC.
  //
  // A line the node could not take from this shop's own stock is a line of its
  // own, with its pill: pieces typed by SKU never join the same SKU's tags, a
  // Barang tak dikenal is always alone, and a tag turned into "Dari Cikupa"
  // stands apart from the same article read here.
  const groups = useMemo(() => {
    const byKey = new Map<
      string,
      {
        key: string
        sku: string
        name: string | null
        price: number | null
        units: Unit[]
        idTag: IdTag | null
        unknown: boolean
        /// Return mode: the returned piece this line replaces.
        repFor: number | undefined
      }
    >()
    for (const unit of units) {
      const idTag = idTagOf(unit, quote.labels)
      const repFor = ret?.rep.get(unit.epc)
      const key = isUnknown(unit)
        ? `unknown:${unit.epc}`
        : `${unit.sku_code}|${unit.unitPriceMinor ?? "none"}${isUntagged(unit) ? "|u" : ""}${
            idTag === null ? "" : `|${idTag.text}`
          }${repFor === undefined ? "" : `|r${repFor}`}`
      const found = byKey.get(key)
      if (found === undefined) {
        byKey.set(key, {
          key,
          sku: unit.sku_code,
          name: unit.name,
          price: unit.unitPriceMinor,
          units: [unit],
          idTag,
          unknown: isUnknown(unit),
          repFor,
        })
      } else {
        found.units.push(unit)
      }
    }
    return [...byKey.values()]
  }, [units, quote.labels, ret])
  // In Return mode each replacement sits right under the piece it replaces.
  const shownGroups = useMemo(() => {
    if (ret === null) return groups
    const under = (at: number) => groups.filter((group) => group.repFor === at)
    return [
      ...ret.back.flatMap((_, at) => under(at)),
      ...groups.filter((group) => group.repFor === undefined || group.repFor >= ret.back.length),
    ]
  }, [groups, ret])
  // The newest tag is marked, never animated: scans are scanner input, a
  // hundred a day, and the line just has to be where the eye lands.
  const newestEpc = units.length > 0 ? units[units.length - 1].epc : null
  // The picked line is the newest until somebody picks another; a scan puts it
  // back on the newest. Kept in view as it moves.
  const pickedRow = useRef<HTMLTableRowElement>(null)
  const unitCount = useRef(units.length)
  useEffect(() => {
    if (units.length > unitCount.current) setPickedKey(null)
    unitCount.current = units.length
  }, [units.length])
  useEffect(() => {
    pickedRow.current?.scrollIntoView({ block: "nearest" })
  }, [units.length, pickedKey])

  const askForQuote = useCallback(
    async (markStale: boolean) => {
      const request = ++quoteRequest.current
      if (markStale) setQuote((was) => ({ ...was, stale: true, problem: null }))
      const asked = basisOf(units, coupons, customerId, charges, couponHolds)
      const sent = wireOf(units)
      const reply = await api.quote(
        sent.epcs,
        coupons,
        customerId,
        charges,
        onTheWire(couponHolds),
        sent.untagged,
      )
      if (request !== quoteRequest.current) return
      if (!reply.ok) {
        // A refresh of the basket that was already priced keeps the figure it
        // had and says why it could not be checked; anything else has no figure.
        const problem =
          reply.problem ?? `Server toko tidak bisa menghitung transaksi ini (HTTP ${reply.status}).`
        setQuote((was) =>
          !was.stale && was.basis === asked && was.problem === null
            ? { ...was, problem }
            : { ...emptyQuote(), problem, basis: asked },
        )
        return
      }
      // The answer says what the node is: it names `untagged` when it knows
      // them; one that was sent some and said nothing about them does not.
      if (Array.isArray(reply.body?.untagged)) setUntaggedOk(true)
      else if (sent.untagged.length > 0) setUntaggedOk(false)
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
        lines: reply.body?.lines ?? [],
        toAuthorize: reply.body?.coupons_to_authorize ?? [],
        basis: asked,
        unsellable,
        labels: labelsOf(units, reply.body?.untagged ?? []),
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
          const reasons = going.map((unit) => why.get(unit.epc.toUpperCase()) ?? "")
          const actions = [
            ...new Set(reasons.flatMap((reason) => tagRefusal(reason)?.action ?? [])),
          ]
          setNote({
            bad: true,
            text:
              `Dikeluarkan dari transaksi — ${going
                .map((unit, at) => `${unitName(unit)}: ${refusalWords(reasons[at])}`)
                .join("; ")}.` + (actions.length > 0 ? ` ${actions.join(" ")}` : ""),
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
            // A Barang tak dikenal is charged the price the Kepala toko gave.
            if (isUnknown(unit)) return unit
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
              `Kupon ${code} tidak bisa ditahan di kantor pusat — cek koneksi ke kantor pusat.`,
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

  // The counter's check tag (`r3_canary_epc`): the shell leaves it out of
  // every read of the pad, and a scan or a handheld pull never adds it.
  const checkTag = peripheralsOf(shell).r3_canary_epc ?? null

  /// What the scan field matches besides a tag (owner, 23 Oct 2026: "bisa
  /// masukin sku dong di search"): part of a name, or the SKU — whole, with or
  /// without its dot (00000001·104), or any part of it such as the 8-digit
  /// article code.
  const matching = useCallback(
    (text: string) => {
      const needle = text.toLowerCase()
      const digits = text.replace(/[·.\s-]/g, "")
      const bySkuPart = /^\d{3,}$/.test(digits)
      return rows.filter(
        (row) =>
          row.name.toLowerCase().includes(needle) ||
          (bySkuPart && row.sku_code.includes(digits)),
      )
    },
    [rows],
  )
  /// A whole SKU that is not in this store's book: said as such.
  const notSold = (text: string) => {
    const digits = text.replace(/[·.\s-]/g, "")
    return /^\d{11}$/.test(digits)
      ? `SKU ${skuText(digits)} tidak dijual di toko ini.`
      : null
  }

  /// One piece of this SKU, sold as if its tag had been scanned (owner, 23 Oct
  /// 2026: a tag that will not read): a tag of it on the shop floor that is
  /// not already in this sale. What a node that predates unmatched sales gets.
  const typedEpcs = useRef(new Set<string>())
  /// In Return mode a replacement goes under the returned piece picked now; with
  /// none picked (-1) it is "Barang baru", under no piece at all.
  const pairReplacement = useCallback((epcs: readonly string[], to?: number) => {
    setRet((was) => {
      if (was === null) return was
      const rep = new Map(was.rep)
      const at = to ?? was.sel
      for (const epc of epcs) {
        if (at < 0) rep.delete(epc)
        else rep.set(epc, at)
      }
      return { ...was, rep }
    })
  }, [])
  const sellFromFloor = useCallback((row: api.CatalogRow) => {
    setCheck([])
    setCheckSell(false)
    setNote({ bad: false, text: `Mencari ${row.name} di lantai jual…` })
    void (async () => {
      const reply = await api.tagMoves()
      const moves = reply.ok ? [...(reply.body?.items ?? [])] : []
      moves.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
      const where = new Map<string, string>()
      for (const move of moves) where.set(move.epc, move.to)
      const inSale = new Set(unitsRef.current.map((unit) => unit.epc))
      const epc = [...where.entries()].find(
        ([tag, place]) =>
          place.endsWith(".floor:on_hand") && tag.slice(2, 13) === row.sku_code && !inSale.has(tag),
      )?.[0]
      if (epc === undefined) {
        setNote({
          bad: true,
          text: reply.ok
            ? `Stok ${row.name} di lantai jual habis.`
            : (reply.problem ?? "Server toko tidak menjawab."),
        })
        return
      }
      typedEpcs.current.add(epc)
      pairReplacement([epc])
      setUnits((was) =>
        was.some((unit) => unit.epc === epc)
          ? was
          : [...was, { epc, sku_code: row.sku_code, name: row.name, unitPriceMinor: row.unit_price_minor ?? null }],
      )
      setNote(null)
    })()
  }, [])

  /// One piece of this SKU, typed off the label (owner, 23 Oct 2026: a tag
  /// that will not read): a line with no tag, "Tanpa tag" when this shop holds
  /// some of it and "Luar toko" when it holds none — the node says which, and
  /// the sale goes through either way (docs/unmatched-sales-contract.md). A
  /// second piece of the same SKU is a second entry.
  const sellNoTag = useCallback((row: api.CatalogRow, to?: number) => {
    setCheck([])
    setCheckSell(false)
    setNote(null)
    const epc = `untagged:${newCheckoutId()}`
    pairReplacement([epc], to)
    setUnits((was) => [
      ...was,
      {
        epc,
        sku_code: row.sku_code,
        name: row.name,
        unitPriceMinor: row.unit_price_minor ?? null,
        untagged: {},
      },
    ])
  }, [pairReplacement])

  /// A typed SKU, the way this shop's node takes it.
  const sellTyped = useCallback(
    (row: api.CatalogRow, many = 1) => {
      // Return mode: a SKU this receipt sold without a tag, and not all of
      // it back yet, is a piece coming back (owner, 25 Oct 2026: "yg penting
      // tau skunya"). Anything else typed is a replacement, once something
      // came back.
      const r = retRef.current
      if (r !== null) {
        const open = r.receipt.untagged.get(row.sku_code) ?? 0
        const picked = r.back.filter((one) => one.untagged === true && one.sku === row.sku_code).length
        const take = Math.min(many, open - picked)
        if (take > 0) {
          const line = r.receipt.lines.find((one) => one.skuCode === row.sku_code)
          const added = Array.from({ length: take }, () => ({
            epc: `untagged-back:${crypto.randomUUID()}`,
            sku: row.sku_code,
            name: line?.name ?? row.name,
            unitMinor: line?.unitMinor ?? row.unit_price_minor ?? 0,
            untagged: true,
          }))
          setCheck([])
          setCheckSell(false)
          setRet({ ...r, back: [...r.back, ...added], sel: r.back.length })
          setNote(null)
          sound.read()
          return
        }
        if (r.back.length === 0) {
          setNote({ bad: true, text: "Scan dulu barang yang dikembalikan" })
          return
        }
      }
      // Stock 0 sells too: the node takes the stock below zero (★ Stok minus).
      if (untaggedOkNow.current === true) {
        for (let n = 0; n < many; n += 1) sellNoTag(row)
      } else sellFromFloor(row)
    },
    [sellNoTag, sellFromFloor],
  )

  const onScan = useCallback(
    (raw: string): ScanOutcome => {
      // "3*SKU" or "SKU*3": how many of a typed SKU (client, 23 Oct 2026).
      const typedMany = (/^(\d{1,3})\s*\*\s*(\S+)$/.exec(raw.trim()) ??
        /^(\S+?)\s*\*\s*(\d{1,3})$/.exec(raw.trim()) ??
        /^(\d[\d·.-]*?)\s*[xX]\s*(\d{1,3})$/.exec(raw.trim()))
      let text = raw.trim()
      let many = 1
      if (typedMany !== null) {
        const leading = /^\d{1,3}$/.test(typedMany[1]) && typedMany[2].replace(/[·.\s-]/g, "").length > 3
        many = Math.max(1, Number(leading ? typedMany[1] : typedMany[2]))
        text = leading ? typedMany[2] : typedMany[1]
      }
      if (text === "") return "other"
      setCheck([])
      setCheckSell(false)
      setVoucher(null)
      voucherAsk.current += 1

      // F2 asked "how much is this": a tag, a barcode or a name is looked up in
      // the price book and nothing goes into the basket. Text that is no item
      // but could be a voucher's code is asked of head office instead.
      if (checking) {
        setChecking(false)
        const tag = readScan(text.replace(/·/g, ""))
        const byTag =
          tag.kind === "epc" || tag.kind === "sku" ? bySku.get(tag.sku_code) : undefined
        const found = byTag !== undefined ? [byTag] : matching(text).slice(0, 8)
        if (found.length > 0) {
          setCheck(found)
          setNote(null)
        } else if (looksLikeVoucher(text)) {
          const ask = voucherAsk.current
          setNote({ bad: false, text: "Mengecek voucher…" })
          void api.checkVoucher(text).then((reply) => {
            if (ask !== voucherAsk.current) return
            if (reply.ok && reply.body) {
              setVoucher(reply.body)
              setNote(null)
            } else {
              setNote({
                bad: true,
                text:
                  reply.status === 404
                    ? `Tidak ada barang atau voucher “${text}”.`
                    : (reply.problem ?? "Kantor pusat tidak menjawab untuk voucher itu."),
              })
            }
          })
        } else {
          setNote({ bad: true, text: notSold(text) ?? `Tidak ada yang cocok dengan “${text}”.` })
        }
        return "other"
      }

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
                ? "Scan tag barang yang mau dihapus."
                : unit === undefined
                  ? "Tag itu tidak ada di transaksi."
                  : "Tag itu ada di baris lain — tekan × di baris itu untuk menghapus.",
          })
          return "other"
        }
        setRemoving(null)
        askRemove([unit])
        return "other"
      }

      // A member is asked at Bayar and nowhere else (client, 24 Oct 2026): a
      // member card held up to the scanner (the member app prints `M1:` + the
      // card number as a Code 128 barcode, `frontend-customer/src/lib/
      // member-card.ts`) or a phone number typed here is not a garment, and
      // is said so rather than taken.
      const phone = text.replace(/[\s-]/g, "")
      if (/^(\+?62|0)8\d{7,11}$/.test(phone) || memberFromScan(text) !== null) {
        setNote({ bad: true, text: "Member dipilih saat Bayar" })
        return "other"
      }

      const scanned = readScan(text.replace(/·/g, ""))

      if (scanned.kind === "epc") {
        // The counter's check tag is part of the counter: never sold.
        if (checkTag !== null && scanned.epc.toUpperCase() === checkTag) {
          setNote({
            bad: true,
            text: "Itu tag cek kasir ini, tidak pernah dijual.",
          })
          return "other"
        }
        if (units.some((unit) => unit.epc === scanned.epc)) {
          setNote({
            bad: true,
            text:
              "Tag itu sudah ada di transaksi. Satu tag satu barang — untuk " +
              "menghapus, tekan × di barisnya.",
          })
          return "already"
        }
        const row = bySku.get(scanned.sku_code)
        if (ret !== null) {
          // A tag this receipt sold is a piece coming back; any other tag is a
          // replacement, under the returned piece picked now.
          const epc = scanned.epc.toUpperCase()
          const at = ret.receipt.lines.findIndex((line) => line.skuCode === scanned.sku_code)
          const sold = ret.soldTags !== null ? ret.soldTags.has(epc) : at >= 0
          if (at >= 0 && sold) {
            if (ret.back.some((one) => one.epc === epc)) {
              setNote({ bad: true, text: "Tag itu sudah dipilih" })
              return "already"
            }
            const line = ret.receipt.lines[at]
            if (ret.back.filter((one) => one.sku === line.skuCode).length >= line.quantity) {
              setNote({ bad: true, text: `Semua ${line.name} di struk ini sudah dipilih` })
              return "other"
            }
            setRet({
              ...ret,
              back: [...ret.back, { epc, sku: line.skuCode, name: line.name, unitMinor: line.unitMinor }],
              sel: ret.back.length,
            })
            setNote(null)
            sound.read()
            return "added"
          }
          if (ret.back.length === 0) {
            setNote({ bad: true, text: "Scan dulu barang yang dikembalikan" })
            return "other"
          }
          pairReplacement([scanned.epc])
        }
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

      // A typed SKU sells one piece of it (owner, 23 Oct 2026: a tag that will
      // not read): a line with no tag, labelled by the node's answer.
      if (scanned.kind === "sku") {
        const row = bySku.get(scanned.sku_code)
        if (row !== undefined) {
          // In Return mode `sellTyped` decides: a piece this receipt sold
          // without a tag comes back; else, once one has, a replacement.
          sellTyped(row, many)
          return "other"
        }
      }

      // Part of a SKU or a name: the matches, up to twelve, to pick from with
      // ↑ ↓, 1–9 or Enter — or a click — each selling one piece with no tag.
      const found = matching(text)
      if (found.length > 0) {
        setCheck(found.slice(0, 12))
        setCheckSell(true)
        setCheckAt(0)
        setNote(null)
        return "other"
      }
      // A coupon the shopper produced, typed or scanned into the one field —
      // "kupon atau nama barang". This till cannot tell a coupon from a word
      // nobody sells; the node can, and the row under the scan field says
      // "tanpa diskon" beside a code it did not apply, with its × to take it off.
      const code = text.toUpperCase()
      if (looksLikeCoupon(code)) {
        if (coupons.includes(code)) {
          setNote({ bad: true, text: `Kupon ${code} sudah ada di transaksi ini.` })
          return "other"
        }
        // Asked of the node before it joins the basket: a code the node does
        // not know fails the whole quote (`reject_unknown_coupon_codes`), and
        // with it every automatic promo. Unknown, it is dropped and said.
        setNote({ bad: false, text: `Mengecek kupon ${code}…` })
        void (async () => {
          const sent = wireOf(unitsRef.current)
          const reply = await api.quote(
            sent.epcs,
            [...couponsNow.current, code],
            customerId,
            charges,
            onTheWire(couponHolds),
            sent.untagged,
          )
          if (!reply.ok && /unknown coupon code/i.test(reply.problem ?? "")) {
            // Nothing by that name either: the same as any search that finds
            // nothing.
            setNote({ bad: true, text: `“${text}” tidak ada di toko ini · minta barcode baru` })
            return
          }
          setCoupons((was) => (was.includes(code) ? was : [...was, code]))
          setNote({ bad: false, text: `Kupon ${code} ditambahkan.` })
        })()
        return "other"
      }
      // Nothing found: this store does not hold it (client, 23 Oct 2026).
      setNote({ bad: true, text: `“${text}” tidak ada di toko ini · minta barcode baru` })
      return "other"
    },
    [bySku, matching, units, removing, checkTag, checking, coupons, customerId, charges, couponHolds, sellTyped, ret, pairReplacement],
  )

  /// Read every garment on the R3's pad at once. Each of this shop's tags goes
  /// through `onScan`, so "already in the basket" and one tag one item are
  /// decided where a single scan decides them; tags that are not this shop's
  /// are counted and left alone. While taking one off a line, that line's tags
  /// on the pad are the ones that go — named, after a second person's yes.
  const readWithR3 = useCallback(async () => {
    if (rfidBusy) return
    setRfidBusy(true)
    readingNow.current = true
    try {
      const read = await readRfidPad()
      const ours: string[] = []
      for (const tag of read.tags) {
        const scanned = readScan(tag.epc)
        if (scanned.kind === "epc") ours.push(scanned.epc)
      }
      const foreign = read.tags.length - ours.length
      // The check tag missing or faint: what was read is still on the pad,
      // and it is added, but something there may not have been heard.
      const attention = read.attention === null ? "" : ` ${sentence(read.attention)}`
      const leftOut =
        (read.too_weak > 0 ? ` ${read.too_weak} terlalu lemah, tidak dipakai.` : "") +
        (read.unreadable > 0 ? ` ${read.unreadable} tidak terbaca.` : "") +
        attention
      if (removing !== null) {
        const going = units.filter(
          (unit) => unit.sku_code === removing && ours.includes(unit.epc),
        )
        if (going.length === 0) {
          setNote({
            bad: true,
            text:
              noteOf(read.tags.length === 0 ? NOTHING_HEARD : NOT_ON_THAT_LINE) + leftOut,
          })
          return
        }
        setRemoving(null)
        askRemove(going)
        return
      }
      if (read.tags.length === 0) {
        setNote({ bad: true, text: `${noteOf(NOTHING_HEARD)}${leftOut}` })
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
        bad: added === 0 || attention !== "",
        text:
          `${added} ditambahkan dari pad` +
          (already > 0 ? `, ${already} sudah ada di transaksi` : "") +
          (foreign > 0 ? `, ${foreign} bukan tag toko ini` : "") +
          `.${leftOut}`,
      })
    } catch (error) {
      setNote({ bad: true, text: readerProblem(error) })
    } finally {
      // The chip says what the shell now holds about the reader, this read
      // included.
      const now = await readerStatus(false)
      readingNow.current = false
      setReader(now)
      setRfidBusy(false)
      scan.current?.focus()
    }
  }, [onScan, rfidBusy, removing, units])

  // Back to the scan field whenever the counter is at rest — including after a
  // panel over it closes, so the next tag lands in the basket. With the bag
  // choices open the caret waits on the first of them instead, so Tab and Enter
  // pick a bag without a mouse; F6 or Escape closes them and comes back here.
  useEffect(() => {
    if (
      where === "sale" &&
      sold === null &&
      panel === null &&
      !approval.open &&
      !exchanging &&
      !voiding &&
      laci === null
    ) {
      if (bagPick) bagRow.current?.querySelector("button")?.focus()
      else scan.current?.focus()
    }
  }, [where, sold, panel, approval.open, bagPick, exchanging, voiding, laci])

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
    setCredit(null)
    setCoupons([])
    setCustomerId(null)
    setCharges([])
    setBagPick(false)
    setPanel(null)
    setRemoving(null)
    setRet(null)
    setAsked(false)
    setCheck([])
    setCheckSell(false)
    if (scan.current !== null) scan.current.value = ""
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

  /// The keys a counter knows by heart: 7Soft's, in the order the toolbar draws
  /// them (`keybar.tsx`). Each tile is a button too and runs the same function,
  /// so a key and its tile can never do two different things.
  ///
  /// They fire while the caret sits in the scan field — which is where it
  /// always sits. A cashier's hands do not leave the scanner to reach for a
  /// mouse, and a shortcut that stopped working because a field had focus would
  /// be a shortcut nobody trusts. The numpad's + and − (New, Remove) and the
  /// ctrl commands are let through the field by `shortcuts.ts`; the main row's
  /// "-" still types.
  const doKeyRaw: Record<KeyId, () => void> = {
    new: addPicked,
    remove: lessPicked,
    void: () => setVoiding(true),
    check: priceCheck,
    drawer: () => setLaci((was) => (was === "menu" ? null : "menu")),
    close: () => void tryFinish(),
    // F5 is Daftar member, the form straight away (24 Oct 2026); who a sale is
    // for is asked at Bayar.
    member: () => setPanel("register"),
    bags: () => setBagPick((was) => !was),
    cancel: () => {
      if (ret !== null) {
        cancelReturn()
        return
      }
      // Straight to the Kepala toko's or an Admin's finger, no reason asked
      // (owner, 25 Oct 2026).
      if (units.length > 0) cancelSale()
    },
    return: () => {
      if (ret !== null) return
      if (units.length > 0) {
        setNote({ bad: true, text: "Selesaikan atau tunda transaksi dulu, lalu Return." })
        return
      }
      setExchanging(true)
    },
    hold: openHeld,
    pay: () => pay(),
  }
  // A status line is about the last thing done: the next key clears it
  // (and sets its own, when it has one to say).
  const doKey = Object.fromEntries(
    Object.entries(doKeyRaw).map(([id, run]) => [
      id,
      () => {
        setNote(null)
        run()
      },
    ]),
  ) as Record<KeyId, () => void>
  // Anything drawn over the counter: while one is up the scan field takes no
  // typing, so a key meant for the dialog never lands in it.
  const overlayOpen =
    panel !== null ||
    approval.open ||
    exchanging ||
    voiding ||
    laci !== null ||
    bagPick ||
    where !== "sale" ||
    sold !== null
  const leavePanel = () => {
    setPanel(null)
    setRemoving(null)
    setChecking(false)
    setBagPick(false)
    setLaci(null)
    scan.current?.focus()
  }
  useShortcuts(
    panel !== null || approval.open
      ? {
          Escape: leavePanel,
        }
      : {
          F1: doKey.void,
          F2: doKey.check,
          F3: doKey.drawer,
          F4: doKey.close,
          F5: doKey.member,
          "shift+F5": doKey.member,
          F6: doKey.bags,
          F7: doKey.cancel,
          F8: doKey.return,
          F9: doKey.hold,
          F12: doKey.pay,
          NumpadAdd: doKey.new,
          NumpadSubtract: doKey.remove,
          "ctrl+p": () => void reprintPicked(),
          "ctrl+l": onLock,
          ...(onMenu !== undefined ? { "ctrl+m": onMenu } : {}),
          Escape: leavePanel,
        },
    where === "sale" &&
      sold === null &&
      !approval.open &&
      !exchanging &&
      !voiding &&
      laci === null,
  )

  /// Payment, only on the node's answer for exactly this basket (`quoteReady`).
  /// Pressed early, it says what it is waiting for instead.
  function pay() {
    if (ret !== null) {
      finishReturn()
      return
    }
    if (units.length === 0) return
    if (!quoteReady) {
      setNote({ bad: true, text: quoteNote ?? "Menghitung…" })
      return
    }
    // Member first (client, 23 Oct 2026): scan the card or type the number,
    // register, or Enter to go on without one.
    if (customerId === null) {
      setPanel("ask")
      return
    }
    onGo("payment")
  }

  /// One key per attempt: a retry of the same return is the same return.
  const returnAttempt = useRef<{ shape: string; key: string } | null>(null)

  /// Return's button — "Bayar selisih" / "Selesaikan return": the Kepala
  /// toko's finger records the pieces that came back, and what came back pays
  /// for the replacements in Bayar (nothing to pay: it settles at once).
  function finishReturn() {
    if (ret === null || ret.back.length === 0 || units.length === 0) return
    if (credit !== null) {
      // Already recorded at the node (Bayar was left with Esc): on to the money.
      onGo("payment")
      return
    }
    if (!quoteReady) {
      setNote({ bad: true, text: quoteNote ?? "Menghitung…" })
      return
    }
    const tags = ret.back.map((one) => one.epc)
    // A piece sold without a tag goes by its SKU (owner, 25 Oct 2026).
    const lines: api.ReturnLine[] = ret.back.map((one) =>
      one.untagged === true
        ? { epc: "", sku_code: one.sku, disposition: "RESALEABLE" }
        : { epc: one.epc, disposition: "RESALEABLE" },
    )
    const receipt = ret.receipt
    const backMinor = ret.back.reduce((sum, one) => sum + one.unitMinor, 0)
    const shape = JSON.stringify([receipt.saleId, tags])
    if (returnAttempt.current?.shape !== shape) {
      returnAttempt.current = { shape, key: crypto.randomUUID() }
    }
    const key = returnAttempt.current.key
    const backPcs = ret.back.length
    const addPcs = units.length
    let given: ExchangeCredit | null = null
    // Next tick: the sheet treats Enter as a press on the sensor, and the
    // Enter that asked must not be that press.
    window.setTimeout(
      () =>
        approval.ask({
          action: "EDIT_CART",
          title: "Return",
          detail: `Return ${backPcs} → ${addPcs} barang · ${receipt.receiptNo}`,
          perform: async (supervisor) => {
            const method = await creditMethod()
            const reply = await api.returnSale({
              sale_id: receipt.saleId,
              lines,
              refund_method: method,
              refund_reference: referenceFor(receipt.receiptNo),
              reason: "Return → tukar barang",
              supervisor,
              actor_id: actorId,
              idempotency_key: key,
            })
            if (!reply.ok) return reply.problem ?? `Server toko menolak (${reply.status})`
            given = {
              method,
              capMinor: asCount(asMap(reply.body)?.refund_minor) ?? backMinor,
              reference: referenceFor(receipt.receiptNo),
              receiptNo: receipt.receiptNo,
            }
            return null
          },
          onApproved: () => {
            if (given === null) return
            setCredit(given)
            onGo("payment")
          },
        }),
      0,
    )
  }

  /// F7 in Return mode: back to an empty counter — unless the pieces are
  /// already recorded at the node, then the money still has to be settled.
  function cancelReturn() {
    if (credit !== null) {
      setNote({ bad: true, text: "Return sudah dicatat — selesaikan pembayarannya." })
      return
    }
    clearBasket()
    setNote({ bad: false, text: "Return dibatalkan" })
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
  const bagOne = (bag: api.Charge) => setCharges((was) => [...was, bag])
  const bagLess = (bag: api.Charge) =>
    setCharges((was) => {
      const at = was.map((one) => one.description).lastIndexOf(bag.description)
      return at < 0 ? was : was.filter((_, index) => index !== at)
    })

  // ── Tunda ───────────────────────────────────────────────────────────

  /// What the node holds for today, any cashier's. A node without the route
  /// answers 404 / 405 and held sales stay on this counter.
  const refreshHeld = useCallback(async (): Promise<number> => {
    const reply = await api.heldSales()
    if (reply.ok) {
      const items = Array.isArray(reply.body?.items) ? reply.body.items : []
      setHeldOn(true)
      setNodeHeld(items)
      return items.length
    }
    if (reply.status === 404 || reply.status === 405) setHeldOn(false)
    return -1
  }, [])
  useEffect(() => {
    if (where !== "sale") return
    void refreshHeld()
    const timer = window.setInterval(() => void refreshHeld(), 10_000)
    return () => window.clearInterval(timer)
  }, [where, refreshHeld])
  const heldCount = heldOn === true ? nodeHeld.length : held.length

  const heldRows: readonly HeldRow[] =
    heldOn === true
      ? nodeHeld.map((one) => {
          const revived = reviveHeld(one.basket, one.id)
          return {
            id: one.id,
            time: hhmm(new Date(one.held_at)),
            by: one.held_by_name,
            pcs: one.pcs,
            totalMinor: one.total_minor,
            member: revived?.member?.display_name ?? null,
          }
        })
      : held.map((one) => ({
          id: one.id,
          time: one.at,
          by: session.me?.display_name ?? session.me?.username ?? "",
          pcs: one.units.length,
          totalMinor:
            one.totalMinor ??
            one.units.reduce((sum, unit) => sum + (unit.unitPriceMinor ?? 0), 0) +
              (one.charges ?? []).reduce((sum, charge) => sum + charge.amount_minor, 0),
          member: one.member?.display_name ?? null,
        }))

  /// Park the basket: on the node when it keeps them, else on this counter.
  /// True when it is parked and the counter is empty.
  async function holdBasket(): Promise<boolean> {
    if (units.length === 0) return false
    const basket = {
      units,
      coupons,
      customerId,
      charges,
      member: memberInfo !== null && memberInfo.member_id === customerId ? memberInfo : null,
    }
    if (heldOnNow.current !== false) {
      const reply = await api.holdSaleOnNode({
        basket,
        total_minor: total,
        pcs: units.length,
        terminal_id: seat?.terminal_id ?? terminalId,
      })
      if (reply.ok) {
        setHeldOn(true)
        forgetPayment()
        clearBasket()
        void refreshHeld()
        return true
      }
      if (reply.status !== 404 && reply.status !== 405) {
        setNote({ bad: true, text: reply.problem ?? "Server toko tidak bisa menyimpan transaksi tunda." })
        return false
      }
      setHeldOn(false)
    }
    setHeld((was) => [
      ...was,
      { id: crypto.randomUUID(), ...basket, at: hhmm(new Date()), totalMinor: total },
    ])
    forgetPayment()
    clearBasket()
    return true
  }

  /// Bring a held basket back onto the counter. What is on it now is parked
  /// first (prototype `resumeHeld`); what was typed into Bayar is not kept.
  async function resumeHeld(id: string) {
    if (ret !== null) {
      setNote({ bad: true, text: "Return tidak bisa ditunda." })
      return
    }
    if (units.length > 0 && !(await holdBasket())) return
    let found: Held | null = null
    if (heldOnNow.current === true) {
      const reply = await api.resumeHeldSale(id)
      if (!reply.ok) {
        setPanel(null)
        setNote({
          bad: true,
          text:
            reply.status === 404 || reply.status === 409
              ? "Transaksi tunda itu sudah tidak ada."
              : (reply.problem ?? "Server toko tidak menjawab."),
        })
        void refreshHeld()
        return
      }
      found = reviveHeld(reply.body?.basket, id)
      void refreshHeld()
    } else {
      found = held.find((one) => one.id === id) ?? null
      if (found !== null) setHeld((was) => was.filter((one) => one.id !== id))
    }
    if (found === null) return
    forgetPayment()
    setUnits(found.units)
    setCoupons(found.coupons)
    setCustomerId(found.customerId)
    setCharges(found.charges ?? [])
    if (found.member) setMemberInfo(found.member)
    setPanel(null)
    setAsked(found.customerId !== null)
    setNote({ bad: false, text: "Transaksi dilanjutkan" })
  }

  /// Hapus: the Kepala toko's finger.
  function dropHeld(id: string) {
    const row = heldRows.find((one) => one.id === id)
    if (row === undefined) return
    setPanel(null)
    const reopen = () => {
      void refreshHeld().then((count) => count !== 0 && setPanel("hold"))
    }
    approval.ask({
      action: "DROP_HOLD",
      title: "Hapus transaksi tunda",
      detail: `${row.pcs} pcs · ditunda ${row.time}`,
      amountMinor: row.totalMinor,
      ...(heldOnNow.current === true
        ? {
            perform: async (supervisor: api.Supervisor) => {
              const reply = await api.dropHeldSale(id, supervisor)
              return reply.ok ? null : (reply.problem ?? "Server toko menolak menghapus.")
            },
            onApproved: reopen,
          }
        : {
            onApproved: () => {
              setHeld((was) => was.filter((one) => one.id !== id))
              setPanel(held.length > 1 ? "hold" : null)
            },
          }),
    })
  }

  /// F9: the day's held sales; any cashier continues one.
  function openHeld() {
    if (ret !== null) {
      setNote({ bad: true, text: "Return tidak bisa ditunda." })
      return
    }
    if (heldCount === 0) return
    setPanel("hold")
  }

  /// F4: closing waits for held sales, and for a basket (prototype `keyAct`).
  async function tryFinish() {
    if (units.length > 0 || ret !== null) {
      setNote({ bad: true, text: "Selesaikan atau tunda transaksi dulu" })
      return
    }
    const count = heldOnNow.current === true ? await refreshHeld() : held.length
    if (count > 0) {
      setNote({ bad: true, text: `Masih ada ${count} transaksi tunda` })
      setPanel("hold")
      return
    }
    onGo("finish")
  }

  /// F2: the next scan or typed word is looked up, not sold.
  function priceCheck() {
    setChecking(true)
    setRemoving(null)
    setBagPick(false)
    setCheck([])
    setVoucher(null)
    voucherAsk.current += 1
    setNote(null)
    scan.current?.focus()
  }

  /// A member found at head office, or one just registered, joins the sale.
  function attachMember(member: api.Member, registered: boolean) {
    setCustomerId(member.member_id)
    setMemberInfo(member)
    setPanel(null)
    if (registered) setNote({ bad: false, text: "Member terdaftar" })
  }

  /// F3. Only the desktop shell could ever open a drawer, and today a drawer is
  /// opened by the receipt printer with a sale — the shell says so itself.
  function openDrawer() {
    if (isWeb) {
      setNote({ bad: false, text: "Kasir ini tidak punya laci." })
      return
    }
    void device("open_drawer").then((state) => {
      setNote(
        state.bound
          ? { bad: false, text: "Laci terbuka." }
          : {
              bad: true,
              text: inShell()
                ? "Laci dibuka printer struk saat ada penjualan."
                : state.detail,
            },
      )
    })
  }

  /// The line numpad − works on: the one picked with ↑ ↓ or a click, else the
  /// newest.
  /// A bag on the bill is a line of the grid too (it is in the prototype), so
  /// it can be picked like an article: − takes one bag off, no approval — a
  /// bag is a charge, not a tag.
  const pickedBag =
    pickedKey !== null && pickedKey.startsWith(BAG_KEY)
      ? (addedBags.find((bag) => bagKey(bag) === pickedKey) ?? null)
      : null
  const pickedGroup =
    pickedBag !== null
      ? null
      : (groups.find((group) => group.key === pickedKey) ??
        groups.find((group) => group.units.some((unit) => unit.epc === newestEpc)) ??
        null)
  const pickedLineKey = pickedBag !== null ? bagKey(pickedBag) : (pickedGroup?.key ?? null)
  const lineKeys = [...shownGroups.map((group) => group.key), ...addedBags.map(bagKey)]
  // The item card follows its line: if the line is gone (its last piece came
  // off), the card goes with it rather than leaving the counter blocked.
  const itemKey = panel !== null && typeof panel === "object" && "item" in panel ? panel.item : null
  const itemGroup = itemKey === null ? null : (groups.find((group) => group.key === itemKey) ?? null)
  useEffect(() => {
    if (itemKey !== null && itemGroup === null) {
      setPanel(null)
      scan.current?.focus()
    }
  }, [itemKey, itemGroup])

  /// ↑ ↓ in the scan field: the line numpad − will take a unit off.
  function movePick(by: 1 | -1) {
    if (lineKeys.length === 0) return
    const at = pickedLineKey === null ? lineKeys.length - 1 : lineKeys.indexOf(pickedLineKey)
    const next = Math.min(lineKeys.length - 1, Math.max(0, at + by))
    setPickedKey(lineKeys[next])
  }

  /// Tambah (numpad +): one more piece of the picked line. A piece typed off
  /// the label — the store's tag count is the reader's business — or one more
  /// bag.
  function addPicked() {
    if (pickedBag !== null) {
      bagOne(pickedBag)
      return
    }
    if (pickedGroup === null) return
    const row = bySku.get(pickedGroup.sku)
    if (row === undefined) {
      setNote({ bad: true, text: `SKU ${skuText(pickedGroup.sku)} tidak dijual di toko ini.` })
      return
    }
    if (untaggedOkNow.current !== true) {
      sellFromFloor(row)
      return
    }
    // A returned piece's replacement gets another under the same piece; a
    // "Barang baru" gets another loose one.
    sellNoTag(row, pickedGroup.repFor ?? -1)
  }

  /// Kurangi (numpad −): one piece off the picked line, with the Kepala
  /// toko's finger.
  function lessPicked() {
    if (pickedBag !== null) {
      bagLess(pickedBag)
      return
    }
    if (pickedGroup === null) return
    // Every piece taken off waits for the Kepala toko's or an Admin's finger,
    // a typed piece too (owner, 25 Oct 2026).
    const loose = pickedGroup.units.filter(isUntagged)
    if (pickedGroup.units.length > 1 && loose.length > 0) {
      askRemove(loose.slice(-1))
      return
    }
    removeFromLine(pickedGroup.sku, pickedGroup.units)
  }

  /// Batalkan transaksi: the whole basket goes once the Kepala toko or an
  /// Admin puts a finger on it.
  function cancelSale() {
    approval.ask({
      action: "CANCEL_BASKET",
      title: "Batalkan transaksi",
      detail: `${units.length} barang · ${money(total, currency)}`,
      epcs: wireOf(units).epcs,
      amountMinor: total,
      onApproved: (by) => {
        setNote({ bad: false, text: `Transaksi dibatalkan — disetujui ${by.name}` })
        clearBasket()
      },
    })
  }

  /// Ctrl+P / Print: this shift's picked receipt again, stamped as a copy.
  async function reprintPicked() {
    // The last sale this session completed, else the shift's latest.
    const mine = lastSoldId.current
    const saleId = mine ?? pickedSale?.sale_id ?? null
    if (saleId === null) {
      setNote({ bad: true, text: "Belum ada struk untuk dicetak." })
      return
    }
    const receiptNo =
      lastSales?.find((one) => one.sale_id === saleId)?.receipt_no ?? (mine === null ? null : "Struk terakhir")
    const sent = await sendReceipt(shell, saleId, true)
    setNote(
      sent === null
        ? {
            bad: true,
            text: receiptTarget(shell).why ?? "Belum ada printer struk untuk kasir ini.",
          }
        : { bad: !sent.ok, text: `${receiptNo ?? "Struk"}: ${sent.text}` },
    )
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
          ? "Hapus barang dari transaksi"
          : `Hapus ${going.length} barang dari transaksi`,
      detail: named.join("; "),
      epcs: wireOf(going).epcs,
      amountMinor: going.some((unit) => unit.unitPriceMinor === null)
        ? null
        : going.reduce((sum, unit) => sum + (unit.unitPriceMinor ?? 0), 0),
      onApproved: (by) => {
        const gone = new Set(going.map((unit) => unit.epc))
        setUnits((was) => was.filter((one) => !gone.has(one.epc)))
        setNote({
          bad: false,
          text: `Dihapus ${going.map(unitName).join("; ")} — disetujui ${by.name}.`,
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
    // Pieces with no tag have none to read back: the last of them goes.
    if (lineUnits.every(isUntagged)) {
      askRemove(lineUnits.slice(-1))
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

  // ── What version D draws (pos-classic-prototype.html, D ★ "Lebar penuh") ──

  // Return mode: what came back pays for the replacements; the screen shows
  // what is left to pay.
  const retBack = ret === null ? 0 : ret.back.reduce((sum, one) => sum + one.unitMinor, 0)
  const shownTotal = ret === null ? total : Math.max(0, total - retBack)
  const payEnabled = ret === null ? quoteReady : quoteReady && ret.back.length > 0
  const totalFigure = figureOf(shownTotal, currency)
  // The node's own words when the figure is not its answer for this basket —
  // above the scan field. "Menghitung…" is a moment, not a problem: it rides in
  // the total's label instead, so the page does not jump on every scan.
  const quoteProblemNote = quoteNote !== null && quoteNote !== "Menghitung…" ? quoteNote : null
  // Return mode, the footer's chip: how many replacements sit under a returned
  // piece, and how many are "Barang baru".
  const replacing =
    ret === null
      ? 0
      : units.filter((unit) => {
          const at = ret.rep.get(unit.epc)
          return at !== undefined && at < ret.back.length
        }).length
  const freshOnes = units.length - replacing
  // A line the node gives away (a "buy two, one free" grant) wears a tag.
  const freeSkus = new Set(quote.grantedLines.map((line) => line.sku_code))
  // A markdown is the one discount a line itself carries: the book's normal
  // price ("Harga normal" on the receipt) above the shelf price.
  const markdownBase = (group: { readonly sku: string; readonly price: number | null }) => {
    const base = bySku.get(group.sku)?.base_unit_price_minor
    return group.price !== null && base !== undefined && base > group.price ? base : null
  }
  // Each line's promotions (pos-discount-types.html, owner 23 Oct 2026): what
  // they took off it, their names as tags under the article, and the pieces a
  // "beli X gratis Y" gave away whole — the cheapest, each shown as a GRATIS
  // row under its line. Only from the node's answer for exactly this basket:
  // while it is being worked out, no discount, never a stale one. Offers on
  // the whole transaction (a coupon) stay out of the lines, in the total.
  const lineCuts = useMemo(() => {
    const out = new Map<
      string,
      { cut: number; tags: readonly string[]; free: { count: number; value: number; epcs: string[] } }
    >()
    if (quote.stale || quote.basis !== basis) return out
    // The engine's basket, in the order the request names it: the tags, then
    // the SKUs typed without one. A Barang tak dikenal is charged its own price
    // outside the promotions, so it has no line there. When the node's count
    // is not that, no promotion is drawn on a line — the figure is still its.
    const at = new Map<string, number>()
    for (const unit of units) if (!isUntagged(unit)) at.set(unit.epc, at.size)
    for (const unit of units) if (isUntagged(unit) && !isUnknown(unit)) at.set(unit.epc, at.size)
    const aligned = quote.lines.length === at.size
    const linePromos = quote.promotions.filter(
      (one) => one.applied && !one.coupon_code && (one.line_benefits?.length ?? 0) > 0,
    )
    // Per tag: what came off it, the offers that touched it, and whether one
    // gave it away whole.
    const price = (index: number) => quote.lines[index]?.unit_price_minor ?? 0
    const cutAt = new Map<number, number>()
    const tagsAt = new Map<number, Set<string>>()
    const freeAt = new Set<number>()
    const take = (index: number, minor: number, name: string) => {
      cutAt.set(index, (cutAt.get(index) ?? 0) + minor)
      const tags = tagsAt.get(index) ?? new Set<string>()
      tags.add(name)
      tagsAt.set(index, tags)
    }
    for (const promo of aligned ? linePromos : []) {
      const hit = (promo.line_benefits ?? []).filter((one) => one.benefit_minor > 0)
      const whole = hit.reduce((sum, one) => sum + one.benefit_minor, 0)
      // A "beli X gratis Y" the engine spread over every piece it touched: the
      // cheapest piece(s) are the gift (owner's model), when the cut is exactly
      // what they cost. Any other offer stays as the engine spread it.
      if (/gratis|free/i.test(promo.name)) {
        const cheapest = [...hit].sort((a, b) => price(a.line) - price(b.line) || a.line - b.line)
        let sum = 0
        const gifts: number[] = []
        for (const one of cheapest) {
          if (sum >= whole) break
          sum += price(one.line)
          gifts.push(one.line)
        }
        if (sum === whole && gifts.length < hit.length) {
          for (const one of hit) {
            if (gifts.includes(one.line)) {
              take(one.line, price(one.line), promo.name)
              freeAt.add(one.line)
            } else {
              const tags = tagsAt.get(one.line) ?? new Set<string>()
              tags.add(promo.name)
              tagsAt.set(one.line, tags)
            }
          }
          continue
        }
      }
      for (const one of hit) {
        take(one.line, one.benefit_minor, promo.name)
        if (price(one.line) > 0 && one.benefit_minor >= price(one.line)) freeAt.add(one.line)
      }
    }
    for (const group of groups) {
      let cut = 0
      const tags = new Set<string>()
      const free = { count: 0, value: 0, epcs: [] as string[] }
      for (const unit of group.units) {
        const index = at.get(unit.epc)
        if (index === undefined) continue
        cut += cutAt.get(index) ?? 0
        for (const name of tagsAt.get(index) ?? []) tags.add(name)
        if (freeAt.has(index)) {
          free.count += 1
          free.value += price(index)
          // Only a tag can be named; a piece with none has no tag to show.
          if (!isUntagged(unit)) free.epcs.push(unit.epc)
        }
      }
      // A typed SKU's own line total is the node's word for what it came to.
      if (!group.unknown && group.units.every(isUntagged)) {
        const totals = group.units.map((unit) => quote.labels.get(unit.epc)?.lineTotalMinor)
        if (totals.every((one): one is number => typeof one === "number")) {
          cut = Math.max(
            0,
            (group.price ?? 0) * group.units.length - totals.reduce((sum, one) => sum + one, 0),
          )
        }
      }
      out.set(group.key, { cut, tags: [...tags], free })
    }
    return out
  }, [quote, basis, units, groups])
  // The Diskon column is drawn only while some line has something taken off it
  // (the prototype's `gridCols`).
  const showDisc = groups.some((group) => (lineCuts.get(group.key)?.cut ?? 0) > 0)

  // The reader chip: reading, the R3's own trouble at the desktop, or how many
  // tags the counter holds.
  const readerTrouble =
    !isWeb && reader !== null && (reader.state === "not_connected" || reader.state === "attention")
      ? reader.state
      : null
  // Tags actually read — a piece with no tag (typed SKU, Barang tak dikenal)
  // is not one.
  const readTags = units.filter(
    (unit) => !isUntagged(unit) && !typedEpcs.current.has(unit.epc),
  ).length
  // Until the shell has answered about the R3, the chip says it is still
  // looking rather than "Siap" (owner, 25 Oct 2026: "Siap" then "Tidak
  // terhubung" read as the reader dropping out).
  const rfidWords = rfidBusy
    ? "Membaca…"
    : !isWeb && reader === null
      ? "Memeriksa…"
      : readerTrouble !== null
      ? READER_WORDS[readerTrouble][0]
      : readTags > 0
        ? `${grouped(readTags)} tag`
        : "Siap"
  const rfidTone = rfidBusy
    ? " on"
    : readerTrouble === "not_connected"
      ? " bad"
      : readerTrouble === "attention"
        ? " warn"
        : ""

  /// One line of the grid, an article or a bag, in 7Soft's columns. The picked
  /// line wears the Keterangan field and the trash.
  function lineRow(line: {
    readonly key: string
    readonly sku: string
    readonly name: string | null
    readonly tag: string | null
    /// Keterangan: "★ Stok minus" when the node takes this line's stock below
    /// zero. The till writes it; nobody types in the column.
    readonly idTag?: IdTag | null
    /// A line with no article to read colour and size from: "—" in both.
    readonly noVariant?: boolean
    /// Under the name: "Pria · Koko, Lebaran", the division then the tags. A
    /// bag has none.
    readonly sub?: string
    /// Return mode: "↳" before the name of a replacement.
    readonly arrow?: boolean
    readonly quantity: number
    /// Null: the article has no price on this shop's book.
    readonly price: string | null
    /// A markdown: the book's normal price, struck through beside the price.
    readonly struck?: string | null
    readonly cut: number | null
    readonly subtotal: string | null
    /// The promotions that hit the line, written in Keterangan.
    readonly tags?: readonly string[]
    /// The pieces a "beli X gratis Y" gave away, as a row under the line.
    readonly free?: { readonly count: number; readonly value: number; readonly epcs: readonly string[] } | null
    /// Return mode: where this line goes ("ganti <barang> ▾", "Barang baru ▾"),
    /// and what ▾ does about it.
    readonly pair?: { readonly label: string; readonly onCycle: () => void } | null
    readonly removeLabel: string
    readonly onRemove: () => void
    /// An article line wears its photograph (a plain square without one); a
    /// bag does not. The stored SKU, not the one written with a dot.
    readonly photoSku?: string
  }) {
    const picked = line.key === pickedLineKey
    const named = line.name ?? line.sku
    const tags = line.tags ?? []
    const idTag = line.idTag ?? null
    const variant = line.noVariant === true ? undefined : variants.get(line.name ?? "")
    const free = line.free !== undefined && line.free !== null && line.free.count > 0 ? line.free : null
    const cut = line.cut !== null && line.cut > 0
    return (
      <Fragment key={line.key}>
      <tr
        key={line.key}
        className={picked ? "sel" : undefined}
        ref={picked ? pickedRow : undefined}
        onClick={() => {
          setPickedKey(line.key)
          // Picking a line leaves the caret where the next scan goes.
          scan.current?.focus()
        }}
      >
        {!narrow && <td className="mute num">{line.sku}</td>}
        <td>
          <div className="nm-r">
            {line.photoSku !== undefined && (
              <button
                type="button"
                className="ph-b"
                tabIndex={-1}
                aria-label={`Lihat ${named}`}
                onClick={(event) => {
                  event.stopPropagation()
                  setPickedKey(line.key)
                  setPanel({ item: line.key })
                }}
              >
                <Photo sku={line.photoSku} has={bySku.get(line.photoSku)?.has_image === true} />
              </button>
            )}
          <div className="nm-2">
            <div className="nm-w">
              {line.arrow === true && <span className="rep-arrow">↳</span>}
              <span
                className={line.name === null ? "nm-t none" : line.photoSku !== undefined ? "nm-t link" : "nm-t"}
                onClick={
                  line.photoSku !== undefined
                    ? (event) => {
                        event.stopPropagation()
                        setPickedKey(line.key)
                        setPanel({ item: line.key })
                      }
                    : undefined
                }
              >
                {line.name ?? "Tidak ada di daftar harga"}
              </span>
              {line.price === null && <span className="t-flag">TANPA HARGA</span>}
            </div>
            {line.sub !== undefined && line.sub !== "" && <span className="nm-sub">{line.sub}</span>}
          </div>
          </div>
        </td>
        {!narrow && (
          <>
            <td className={variant?.colour || line.noVariant ? undefined : "faint"}>
              {variant?.colour || "—"}
            </td>
            <td className={variant?.size || line.noVariant ? undefined : "faint"}>
              {variant?.size || "—"}
            </td>
          </>
        )}
        <td className="c num">{line.quantity}</td>
        {/* One figure per cell: the price before a markdown goes to Keterangan. */}
        <td className={line.price === null ? "r faint" : "r"}>{line.price ?? "—"}</td>
        {showDisc && (
          <td className={cut ? "r disc" : "r faint"}>
            {cut ? `−${plain(line.cut ?? 0, currency)}` : "—"}
          </td>
        )}
        <td className={line.subtotal === null ? "r faint" : "r b"}>{line.subtotal ?? "—"}</td>
        <td className="t-notec">
          {line.pair != null ? (
            <button
              type="button"
              className="rep-pick"
              title="Pindahkan ke barang lain"
              onClick={(event) => {
                event.stopPropagation()
                line.pair?.onCycle()
              }}
            >
              {line.pair.label} ▾
            </button>
          ) : (
            <span className="t-marks">
              {line.struck != null && <s className="t-was">{line.struck}</s>}
              {idTag !== null && <span className={idTag.warn ? "id-tag warn" : "id-tag"}>{idTag.text}</span>}
              {line.tag !== null && <span className="promo-tag">{line.tag}</span>}
              {tags.map((name) => (
                <span className="promo-tag" key={name}>
                  {name}
                </span>
              ))}
              {cut && tags.length === 0 && line.tag === null && <span className="promo-tag">Diskon</span>}
            </span>
          )}
        </td>
        {/* No trash on a line (owner, 25 Oct 2026): a piece comes off with
            − Kurangi, and the Kepala toko's finger, one at a time. */}
        <td className="c" />
      </tr>
      {free !== null && (
        <tr className="t-free" onClick={() => setPickedKey(line.key)}>
          {!narrow && <td />}
          <td>
            <span className="t-free-n">
              ↳ <b>GRATIS</b> · {named}
            </span>
          </td>
          <td />
          {!narrow && (
            <>
              <td />
              <td />
            </>
          )}
          <td className="c num">{free.count}</td>
          <td className="r faint">{plain(free.value / free.count, currency)}</td>
          {showDisc && <td className="r disc">−{plain(free.value, currency)}</td>}
          <td className="r b">0</td>
          <td className="t-notec mute">{free.epcs.map((epc) => `tag …${epc.slice(-4)}`).join(", ")}</td>
          <td />
        </tr>
      )}
      </Fragment>
    )
  }

  /// Return, look D "Tenang" (client, 24 Oct 2026). Clicking a returned piece
  /// picks it: the next scan is its replacement. Clicking it again takes the
  /// pick back: the next scan is a "Barang baru", an extra item paid in Bayar
  /// selisih.
  function pickBack(at: number) {
    setRet((was) => (was === null ? was : { ...was, sel: was.sel === at ? -1 : at }))
    scan.current?.focus()
  }

  /// The trash on the picked returned piece: it is no longer coming back, and
  /// what replaced it is "Barang baru" now.
  function dropBack(at: number) {
    setRet((was) => {
      if (was === null || was.back[at] === undefined) return was
      const rep = new Map<string, number>()
      for (const [epc, to] of was.rep) {
        if (to !== at) rep.set(epc, to > at ? to - 1 : to)
      }
      const back = was.back.filter((_, index) => index !== at)
      return { ...was, back, rep, sel: Math.min(was.sel, back.length - 1) }
    })
    scan.current?.focus()
  }

  /// ▾ on a replacement: on to the next returned piece, then to "Barang baru".
  function cycleReplacement(epcs: readonly string[], now: number | undefined) {
    const next = now === undefined ? 0 : now + 1
    setRet((was) => {
      if (was === null) return was
      const rep = new Map(was.rep)
      for (const epc of epcs) {
        if (next < was.back.length) rep.set(epc, next)
        else rep.delete(epc)
      }
      return { ...was, rep }
    })
    scan.current?.focus()
  }

  /// A returned piece: grey, "−1", its price struck through, Keterangan
  /// "Dikembalikan". The picked one wears the trash.
  function backRow(one: ReturnMode["back"][number], at: number) {
    const picked = ret?.sel === at
    const variant = variants.get(one.name)
    const sub = subOf(one.sku)
    return (
      <tr key={`back:${one.epc}`} className={picked ? "rb-d rsel" : "rb-d"} onClick={() => pickBack(at)}>
        {!narrow && <td className="mute num">{skuText(one.sku)}</td>}
        <td>
          <div className="nm-2">
            <div className="nm-w">
              <span className="nm-t">{one.name}</span>
            </div>
            {sub !== "" && <span className="nm-sub">{sub}</span>}
          </div>
        </td>
        {!narrow && (
          <>
            <td>{variant?.colour || "—"}</td>
            <td>{variant?.size || "—"}</td>
          </>
        )}
        <td className="c num">−1</td>
        <td className="r">{plain(one.unitMinor, currency)}</td>
        {showDisc && <td className="r faint">—</td>}
        <td className="r b rb-sub">−{plain(one.unitMinor, currency)}</td>
        <td className="t-notec">
          <span className="mute">Dikembalikan</span>
        </td>
        <td className="c">
          {picked && (
            <button
              type="button"
              className="t-rm"
              aria-label="Batalkan barang kembali ini"
              onClick={(event) => {
                event.stopPropagation()
                dropBack(at)
              }}
            >
              <Lu name="trash" />
            </button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div id="app" data-screen="sale">
      {/* Version D ★ of pos-classic-prototype.html, "Lebar penuh": the lines
          take the whole page under the key row; the money is the floating card
          below them. Styled by till-d.css, scoped under .tilld so the dialogs
          that open over it keep their own look. */}
      <div className="tilld">
        <SellHeader
          terminalId={terminalId}
          unsent={outbox.unsent}
          held={heldCount}
          hasUnits={units.length > 0}
          bagsOpen={bagPick}
          laciOpen={laci === "menu"}
          returning={ret !== null}
          onKey={(id) => {
            doKey[id]()
            // A click leaves the caret on the tile; the next scan belongs in the
            // scan field. A key that opens a panel moves it there afterwards.
            scan.current?.focus()
          }}
          onMenu={onMenu}
          onFinish={() => void tryFinish()}
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
        <main className={sold === null ? "t-main" : "t-main dim"}>
          {bookProblem !== null && (
            <div className="t-alert bad" role="alert">
              <Lu name="alert" />
              <span>{bookProblem}</span>
            </div>
          )}
          {outbox.refused > 0 && (
            <div className="t-alert" role="alert">
              <Lu name="alert" />
              <span>
                {outbox.refused} penjualan ditolak server toko — selesaikan dulu
                sebelum tutup kasir.
              </span>
            </div>
          )}
          {/* Each refusal with the node's own sentence and the one thing to do
              about it: Resolve, with a store manager. A paid sale is never
              dropped from this till (owner, 21 Oct 2026: "Jangan Discard, wajib
              diselesaikan") — there is no discard here, and none in the outbox. */}
          {outbox.entries
            .filter((entry) => entry.refused)
            .map((entry) => (
              <div className="t-alert" key={entry.localId}>
                <span className="num">
                  {new Date(entry.takenAt).toLocaleString("id-ID")} ·{" "}
                  {money(entry.quotedTotalMinor, "IDR")} · {entry.epcs.length} tag
                  {entry.problem !== null ? ` — ${refusalWords(entry.problem)}` : ""}
                </span>
                <button
                  type="button"
                  className="ds-btn ds-btn--ghost"
                  onClick={() => setPanel({ resolve: entry.localId })}
                >
                  Selesaikan
                </button>
              </div>
            ))}

          <section className="t-page">
            {/* There is no head here (client, 24 Oct 2026): who the sale is for is
                asked at Bayar, the total sits in the floating card at the foot.
                Why that total is not the node's yet, or not sellable, is said
                above the scan field, in the words the node gave. */}
            {(quoteProblemNote !== null || unpriced) && (
              <div className="t-hnote">
                <div className="t-msg warn" role="status">
                  <Lu name="alert" />
                  <span className="grow">
                    {quoteProblemNote ?? "Ada barang tanpa harga"}
                  </span>
                  {quoteProblemNote !== null && unpriced && (
                    <span className="t-flag">Ada barang tanpa harga</span>
                  )}
                </div>
              </div>
            )}

            <div className="t-scan">
              {/* The R3 is a USB reader bound in the shell — `readRfidPad`
                  refuses outright with no bridge — so on the web the chip only
                  says what the counter holds; at the desktop pressing it reads
                  the pad, and its state is the reader's own. */}
              {isWeb ? (
                <div className="t-rfid" role="status" aria-live="polite">
                  <span className="t-rfid-dot" />
                  <span className="t-rfid-t">
                    <b>RFID</b>
                    <span>{rfidWords}</span>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className={`t-rfid${rfidTone}`}
                  onClick={() => void readWithR3()}
                  disabled={!inShell() || rfidBusy}
                  aria-live="polite"
                  aria-label={
                    removing === null
                      ? `RFID ${rfidWords} — baca semua tag di pad Chainway R3`
                      : `RFID ${rfidWords} — baca tag yang mau dihapus di pad Chainway R3`
                  }
                  title={
                    reader === null
                      ? "Menanyakan R3…"
                      : reader.fault !== null
                        ? `${sentence(reader.fault)} ${reader.fault.detail}`
                        : reader.detail
                  }
                >
                  <span className="t-rfid-dot" />
                  <span className="t-rfid-t">
                    <b>RFID</b>
                    <span>{rfidWords}</span>
                  </span>
                </button>
              )}
              <form
                className={checking ? "t-scanbox check" : note?.bad === true ? "t-scanbox bad" : "t-scanbox"}
                onMouseDown={(event) => {
                  // The whole box is the field, as the prototype's label is.
                  const target = event.target as HTMLElement
                  if (target !== scan.current && target.closest("button") === null) {
                    event.preventDefault()
                    scan.current?.focus()
                  }
                }}
                onSubmit={(event) => {
                  event.preventDefault()
                  const field = scan.current
                  if (field === null) return
                  // Enter on an empty field is Bayar, beside F12 (owner, 25 Oct
                  // 2026); a scan always arrives with its code before its Enter.
                  if (field.value.trim() === "") {
                    if (overlayOpen) return
                    // A line picked with ↑ ↓ or a click: Enter shows the item
                    // (owner, 25 Oct 2026). Nothing picked: Bayar, as before.
                    if (pickedKey !== null && !checking && pickedGroup !== null && pickedGroup.key === pickedKey) {
                      setPanel({ item: pickedGroup.key })
                      return
                    }
                    if (units.length > 0 && !checking) doKey.pay()
                    return
                  }
                  onScan(field.value)
                  field.value = ""
                }}
              >
                <Lu name="search" />
                <input
                  ref={scan}
                  readOnly={overlayOpen}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  placeholder={
                    removing !== null
                      ? "Scan tag barang yang mau dihapus"
                      : checking
                        ? "Cek harga: scan tag, ketik SKU atau nama barang"
                        : "SKU (3*SKU untuk jumlah), kupon atau nama barang"
                  }
                  aria-label="SKU, kupon atau nama barang"
                  onKeyDown={(event) => {
                    // The main row's + and = are Tambah, and − and - Kurangi,
                    // while the field is empty (inside a code or a name they
                    // still type). The numpad's are caught by the window.
                    const quantity =
                      overlayOpen ||
                      event.currentTarget.value !== "" ||
                      event.ctrlKey ||
                      event.metaKey ||
                      event.altKey ||
                      event.code === "NumpadAdd" ||
                      event.code === "NumpadSubtract"
                        ? null
                        : event.key === "+" || event.key === "="
                          ? "new"
                          : event.key === "-" || event.key === "−"
                            ? "remove"
                            : null
                    if (quantity !== null) {
                      event.preventDefault()
                      doKey[quantity]()
                      return
                    }
                    // Search matches up: ↑ ↓ point, 1–9 or Enter (field empty)
                    // sell one piece of that SKU.
                    if (checkSell && check.length > 0) {
                      const empty = event.currentTarget.value === ""
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault()
                        setCheckAt((was) =>
                          Math.max(0, Math.min(check.length - 1, was + (event.key === "ArrowDown" ? 1 : -1))),
                        )
                        return
                      }
                      if (empty && /^[1-9]$/.test(event.key) && check[Number(event.key) - 1] !== undefined) {
                        event.preventDefault()
                        sellTyped(check[Number(event.key) - 1])
                        return
                      }
                      if (empty && event.key === "Enter" && check[checkAt] !== undefined) {
                        event.preventDefault()
                        sellTyped(check[checkAt])
                        return
                      }
                    }
                    // The line numpad − will take a unit off.
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault()
                      movePick(event.key === "ArrowDown" ? 1 : -1)
                    }
                    // Escape: close whatever is open over the counter and keep
                    // the caret here; with nothing open it clears the field. The
                    // window hook leaves Escape to a field, so it is read here.
                    if (event.key === "Escape") {
                      event.preventDefault()
                      const open = panel !== null || removing !== null || checking || bagPick
                      leavePanel()
                      if (!open) event.currentTarget.value = ""
                    }
                  }}
                />
                {/* A sweep a handheld already gave the node, pulled onto the
                    counter on purpose. */}
                <button
                  type="button"
                  className="t-sib"
                  onClick={() => setPanel("rfid")}
                  aria-label="Ambil dari handheld"
                  title="Ambil dari handheld"
                >
                  <Lu name="rfid" size={18} />
                </button>
                <span className="kbd" aria-hidden="true">
                  F2
                </span>
              </form>
            </div>

            {/* What the counter is doing, above the table (client, 24 Oct 2026).
                The coupons the shopper handed over ride at the right: they have
                no head to sit in, and each one can be taken off. */}
            <div className="t-mode">
              {ret === null ? (
                <span className="mode-flag">Penjualan</span>
              ) : (
                <>
                  <span className="mode-flag ret">Return</span>
                  <span className="mute num">{ret.receipt.receiptNo}</span>
                </>
              )}
              {coupons.length > 0 && (
                <>
                  <span className="sp" />
                  <span className="t-coupons">
                    <span className="mute">
                      Kupon
                      {unapplied.length > 0 && <span className="warn"> · {unapplied.length} tanpa diskon</span>}
                    </span>
                    {coupons.map((code) => (
                      <span
                        className={unapplied.includes(code) ? "t-code off" : "t-code"}
                        key={code}
                        title={unapplied.includes(code) ? `${code} — tanpa diskon dari server toko` : undefined}
                      >
                        {code}
                        <button
                          type="button"
                          className="t-x"
                          aria-label={`Hapus kupon ${code}`}
                          onClick={() => {
                            dropCoupon(code)
                            scan.current?.focus()
                          }}
                        >
                          <Lu name="x" />
                        </button>
                      </span>
                    ))}
                  </span>
                </>
              )}
            </div>

            {(removing !== null ||
              checking ||
              note !== null ||
              check.length > 0 ||
              voucher !== null) && (
              <div className="t-msgs">
                {/* Taking one off a line of several: the tag handed back is the
                    tag taken off, so the cashier reads it, scans it or picks it
                    here — each named by the end of its EPC. Escape leaves. */}
                {removing !== null && (
                  <div className="t-msg warn col" role="status">
                    <span>
                      Hapus satu{" "}
                      {units.find((unit) => unit.sku_code === removing && !isUntagged(unit))?.name ??
                        skuText(removing)}
                      :{" "}
                      {isWeb
                        ? "scan tagnya, atau pilih di bawah."
                        : "taruh di pad lalu tekan RFID, scan tagnya, atau pilih di bawah."}
                    </span>
                    <span className="t-msg-acts">
                      {units
                        .filter((unit) => unit.sku_code === removing && !isUntagged(unit))
                        .map((unit) => (
                          <button
                            key={unit.epc}
                            type="button"
                            className="ds-btn ds-btn--ghost num"
                            onClick={() => {
                              setRemoving(null)
                              askRemove([unit])
                            }}
                          >
                            …{unit.epc.slice(-8)}
                          </button>
                        ))}
                      <button
                        type="button"
                        className="ds-btn ds-btn--ghost"
                        onClick={() => setRemoving(null)}
                      >
                        Batal
                      </button>
                    </span>
                  </div>
                )}

                {checking && (
                  <div className="t-msg" role="status">
                    <Lu name="search" />
                    <span className="grow">
                      Scan tag, ketik barcode atau nama barang
                    </span>
                  </div>
                )}

                {note !== null && (
                  <div className={note.bad ? "t-msg bad" : "t-msg"} role="status">
                    <span className="grow">{note.text}</span>
                  </div>
                )}

                {check.length > 0 && (
                  <div className="t-card">
                    <div className="t-card-h">
                      <span>{checkSell ? "Pilih barang · ↑↓ 1–9 Enter" : "Cek harga"}</span>
                      <button
                        type="button"
                        className="t-x"
                        aria-label={checkSell ? "Tutup hasil cari" : "Tutup cek harga"}
                        onClick={() => {
                          setCheck([])
                          setCheckSell(false)
                          scan.current?.focus()
                        }}
                      >
                        <Lu name="x" />
                      </button>
                    </div>
                    <div className="t-card-b">
                      {check.map((row, index) =>
                        checkSell ? (
                          <button
                            type="button"
                            className={index === checkAt ? "t-chk t-chk-pick on" : "t-chk t-chk-pick"}
                            key={row.sku_code}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => sellTyped(row)}
                          >
                            <Photo sku={row.sku_code} has={row.has_image === true} className="chk" />
                            <span className="nm">
                              {index < 9 && <span className="kbd">{index + 1}</span>} {row.name}
                            </span>
                            <span className="pr">{money(row.unit_price_minor, currency)}</span>
                            <span className="mt">
                              {articleId(row.article_code, row.sku_code)} · {skuText(row.sku_code)}
                            </span>
                          </button>
                        ) : (
                          <div className="t-chk" key={row.sku_code}>
                            <Photo sku={row.sku_code} has={row.has_image === true} className="chk" />
                            <span className="nm">{row.name}</span>
                            <span className="pr">{money(row.unit_price_minor, currency)}</span>
                            <span className="mt">
                              {articleId(row.article_code, row.sku_code)} · {skuText(row.sku_code)}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}

                {voucher !== null && (
                  <div className="t-card">
                    <div className="t-card-h">
                      <span>Voucher</span>
                      <button
                        type="button"
                        className="t-x"
                        aria-label="Tutup cek voucher"
                        onClick={() => setVoucher(null)}
                      >
                        <Lu name="x" />
                      </button>
                    </div>
                    <div className="t-card-b">
                      <div className="t-pad">
                        <VoucherCard voucher={voucher} currency={currency} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {units.length === 0 && addedBags.length === 0 && (ret === null || ret.back.length === 0) ? (
              <div className="t-grid">
                <div className="t-empty">
                  <Lu name="rfid" size={40} stroke={1.5} />
                  <p>
                    {ret !== null
                      ? ret.receipt.untagged.size > 0
                        ? "Scan tag atau ketik SKU barang yang dikembalikan"
                        : "Scan tag barang yang dikembalikan"
                      : "Taruh barang di reader"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="t-grid">
                <table>
                  <colgroup>
                    {!narrow && <col style={{ width: 156 }} />}
                    <col />
                    {!narrow && (
                      <>
                        <col style={{ width: 132 }} />
                        <col style={{ width: 96 }} />
                      </>
                    )}
                    <col style={{ width: 132 }} />
                    <col style={{ width: 104 }} />
                    {showDisc && <col style={{ width: 112 }} />}
                    <col style={{ width: 116 }} />
                    <col style={{ width: narrow ? 168 : 210 }} />
                    <col style={{ width: 48 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      {!narrow && <th>SKU</th>}
                      <th>Barang</th>
                      {!narrow && (
                        <>
                          <th>Warna</th>
                          <th>Ukuran</th>
                        </>
                      )}
                      <th className="c">Jumlah</th>
                      <th className="r">Harga</th>
                      {showDisc && <th className="r">Diskon</th>}
                      <th className="r">Subtotal</th>
                      <th className="t-noteh">Keterangan</th>
                      <th aria-label="Hapus" />
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const groupRow = (group: (typeof groups)[number]) => {
                        const quantity = group.units.length
                        const base = markdownBase(group)
                        const promo = lineCuts.get(group.key)
                        const paired =
                          ret !== null && group.repFor !== undefined ? ret.back[group.repFor] : undefined
                        return lineRow({
                          key: group.key,
                          sku: skuText(group.sku),
                          name: group.name,
                          tag: freeSkus.has(group.sku) ? "Gratis" : null,
                          idTag: group.idTag,
                          noVariant: group.unknown,
                          sub: subOf(group.sku),
                          arrow: paired !== undefined,
                          quantity,
                          // A markdown is a price, not a discount: the old one
                          // struck through, the new one beside it.
                          price: group.price === null ? null : plain(group.price, currency),
                          struck: base === null ? null : plain(base, currency),
                          cut: promo?.cut ?? null,
                          tags: promo?.tags ?? [],
                          free: promo?.free ?? null,
                          // Under a returned piece it says which ("ganti Andeska
                          // STL"); under none it is "Barang baru".
                          pair:
                            ret === null
                              ? null
                              : {
                                  label:
                                    paired === undefined
                                      ? "Barang baru"
                                      : `ganti ${paired.name.split(" ").slice(0, 2).join(" ")}`,
                                  onCycle: () =>
                                    cycleReplacement(
                                      group.units.map((unit) => unit.epc),
                                      paired === undefined ? undefined : group.repFor,
                                    ),
                                },
                          subtotal:
                            group.price === null
                              ? null
                              : plain(group.price * quantity - (promo?.cut ?? 0), currency),
                          removeLabel: `Hapus satu ${group.name ?? skuText(group.sku)}`,
                          onRemove: () => removeFromLine(group.sku, group.units),
                          photoSku: group.unknown ? undefined : group.sku,
                        })
                      }
                      if (ret === null) return groups.map(groupRow)
                      // Each replacement right under the piece it replaces.
                      return [
                        ...ret.back.flatMap((one, at) => [
                          backRow(one, at),
                          ...groups.filter((group) => group.repFor === at).map(groupRow),
                        ]),
                        ...groups
                          .filter((group) => group.repFor === undefined || group.repFor >= ret.back.length)
                          .map(groupRow),
                      ]
                    })()}
                    {addedBags.map((bag) => {
                      const many = bagCount(bag.description)
                      return lineRow({
                        key: bagKey(bag),
                        sku: "—",
                        name: bagName(bag),
                        tag: null,
                        quantity: many,
                        price: bag.amount_minor === 0 ? "Gratis" : plain(bag.amount_minor, currency),
                        cut: null,
                        subtotal:
                          bag.amount_minor === 0
                            ? "Gratis"
                            : plain(bag.amount_minor * many, currency),
                        removeLabel: `Kurangi satu ${bagName(bag)}`,
                        onRemove: () => bagLess(bag),
                      })
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* One floating card at the foot of the list (client, 23 Oct 2026; foot B,
                24 Oct): Kantong at the left, solid green, and in Return mode the
                chip of what came back; the total and Bayar at the right. A bag is
                on the bill, not in the basket: picked here, it becomes a line of
                the grid. */}
            <div className="t-float">
              <button
                type="button"
                className="ds-btn ds-btn--primary t-big t-bags"
                aria-expanded={bagPick}
                aria-keyshortcuts="F6"
                onClick={() => setBagPick((was) => !was)}
              >
                <Lu name="bag" />
                <span>Kantong</span>
                <span className="kbd">F6</span>
              </button>
              {ret !== null && (
                <span className="tf-chip">
                  <span className="mute">Return</span>
                  <b className="num">{ret.receipt.receiptNo}</b>
                  <span className="id-tag warn">
                    {ret.back.length} kembali · {replacing} pengganti
                    {freshOnes > 0 && ` · ${freshOnes} baru`}
                  </span>
                </span>
              )}
              {/* A Return can be called off from the screen, not only with F7
                  (owner, 25 Oct 2026). */}
              {ret !== null && (
                <button type="button" className="tf-cancel" onClick={() => cancelReturn()}>
                  Batalkan return <span className="kbd">F7</span>
                </button>
              )}
              <span className="sp" />
              <div className="tf-total">
                <span className="tf-k">
                  {ret !== null
                    ? `${shownTotal > 0 ? "Bayar selisih" : "Selisih"}${ret.back.length > 0 ? ` · kembali ${money(retBack, currency)}` : ""}`
                    : "Total"}
                  {ret === null && units.length > 0 && ` · ${grouped(units.length)} pcs`}
                  {ret === null && quote.discountTotalMinor > 0 && (
                    <>
                      {" · "}
                      <span className="ok">−{money(quote.discountTotalMinor, currency)}</span>
                    </>
                  )}
                  {quoteNote === "Menghitung…" && " · Menghitung…"}
                </span>
                <span className="tf-v">
                  <span className="cur">{totalFigure[0]}</span>
                  <b>{totalFigure[1]}</b>
                </span>
              </div>
              <button
                type="button"
                className="ds-btn ds-btn--primary t-pay"
                onClick={pay}
                disabled={!payEnabled}
                aria-keyshortcuts="F12"
              >
                <span>{ret !== null ? (shownTotal > 0 ? "Bayar selisih" : "Selesaikan return") : "Bayar"}</span>
                <span className="kbd">F12</span>
              </button>
            </div>
{/* Kantong is a dialog, not a drop-down (owner, 23 Oct 2026):
    1–4 picks a bag, Esc or F6 closes it. It sits beside the card, not inside
    it: the card is sticky, and a sticky box is a stacking context that would
    keep the dialog's veil under the key row. */}
{bagPick && (
  <div className={bagEnter ? "bag-veil enter" : "bag-veil"} onMouseDown={() => setBagPick(false)}>
    <div
      className="bag-dlg"
      role="dialog"
      aria-label="Kantong belanja"
      ref={bagRow}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        const at = Number(event.key) - 1
        const bag = BAGS[at]
        if (bag !== undefined) {
          event.preventDefault()
          bagOne(bag)
          setBagPick(false)
        } else if (event.key === "Escape") {
          event.preventDefault()
          setBagPick(false)
        }
      }}
    >
      <div className="bag-head">
        <b>Kantong</b>
        <button type="button" className="bag-x" onClick={() => setBagPick(false)}>
          Batal <span className="kbd">Esc</span>
        </button>
      </div>
      {BAGS.map((bag, index) => (
        <button
          type="button"
          key={bag.description}
          className="bag-row"
          aria-label={`Tambah satu ${bagName(bag)}`}
          onClick={() => {
            bagOne(bag)
            setBagPick(false)
          }}
        >
          <span className="kbd">{index + 1}</span>
          <span className="thumb">
            <Icon
              name={/plastic/i.test(bag.description) ? "bag-plastic" : "bag-paper"}
              size={/large/i.test(bag.description) ? 28 : 22}
            />
          </span>
          <span className="bag-n">{bagName(bag)}</span>
          <span className="p">
            {bag.amount_minor === 0 ? "Gratis" : money(bag.amount_minor, currency)}
          </span>
        </button>
      ))}
    </div>
  </div>
)}
          </section>
        </main>
        <Statusbar
          unsent={outbox.unsent}
          refused={outbox.refused}
          reader={reader}
          who={session.me?.display_name ?? session.me?.username ?? null}
          till={seat !== null && seat.label !== "" ? seat.label : kasirLabel(terminalId)}
          receiptNo={pickedSale?.receipt_no ?? null}
        />
      </div>

      {where === "payment" && sold === null && (
        <Payment
          basket={basis}
          units={units}
          currency={currency}
          totalMinor={total}
          provisional={quote.totalMinor === null || !figureRight}
          holdBack={figureRight ? null : (quoteNote ?? "Menghitung…")}
          basketHasPromotion={quote.promotions.some((one) => one.applied)}
          coupons={coupons}
          couponHolds={couponHolds}
          customerId={customerId}
          charges={charges}
          actorId={actorId}
          credit={credit}
          memberName={memberInfo !== null && memberInfo.member_id === customerId ? memberInfo.display_name : null}
          onHold={
            ret === null && credit === null
              ? () => {
                  void holdBasket().then((done) => {
                    if (!done) return
                    onGo("sale")
                    setNote({ bad: false, text: "Transaksi ditunda" })
                  })
                }
              : undefined
          }
          onBack={() => onGo("sale")}
          onSold={(sale) => {
            sound.paid()
            if (sale.saleId !== null) lastSoldId.current = sale.saleId
            setSold(sale)
          }}
        />
      )}

      {sold !== null && (
        <Sale
          sold={sold}
          receiptNo={
            sold.saleId !== null && lastSales?.[0]?.sale_id === sold.saleId
              ? lastSales[0].receipt_no
              : null
          }
          currency={currency}
          hasMember={customerId !== null}
          extra={soldFor.current}
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
              title: "Batalkan transaksi",
              detail: `${units.length} barang · ${money(total, currency)}`,
              reason,
              epcs: wireOf(units).epcs,
              amountMinor: total,
              onApproved: (by) => {
                // The reason is written on the node with the approval
                // (`till_approval.reason`), beside the supervisor who agreed.
                setNote({
                  bad: false,
                  text: `Transaksi dibatalkan — ${reason} · disetujui ${by.name}`,
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

      {exchanging && (
        <ReturnPick
          currency={currency}
          onClose={() => {
            setExchanging(false)
            scan.current?.focus()
          }}
          onPick={(receipt, soldTags) => {
            setExchanging(false)
            setRet({ receipt, soldTags, back: [], sel: 0, rep: new Map() })
            setNote({
              bad: false,
              text: `Return · ${receipt.receiptNo} — scan tag barang yang dikembalikan, lalu barang penggantinya`,
            })
            scan.current?.focus()
          }}
        />
      )}

      {voiding && (
        <VoidDialog
          actorId={actorId}
          currency={currency}
          onClose={() => setVoiding(false)}
          onDone={(text) => {
            setVoiding(false)
            setNote({ bad: false, text })
            // The receipts column and Ctrl+P read the shift again.
            setVoidCount((was) => was + 1)
          }}
        />
      )}

      {panel === "hold" && (
        <HeldDialog
          rows={heldRows}
          currency={currency}
          onClose={() => {
            setPanel(null)
            scan.current?.focus()
          }}
          onResume={(id) => void resumeHeld(id)}
          onDrop={dropHeld}
        />
      )}

      {laci === "menu" && (
        <LaciMenu
          onClose={() => {
            setLaci(null)
            scan.current?.focus()
          }}
          onPick={(what) => {
            if (what === "open") {
              setLaci(null)
              openDrawer()
            } else setLaci(what)
          }}
        />
      )}
      {laci === "modal" && (
        <TambahModalDialog
          actorId={actorId}
          currency={currency}
          onClose={() => setLaci(null)}
          onDone={(text) => {
            setLaci(null)
            setNote({ bad: false, text })
          }}
        />
      )}
      {laci === "setor" && (
        <SetoranDialog
          actorId={actorId}
          currency={currency}
          onClose={() => setLaci(null)}
          onDone={(text) => {
            setLaci(null)
            setNote({ bad: false, text })
          }}
        />
      )}

      {panel === "rfid" && (
        <ReaderSessions
          onBack={() => setPanel(null)}
          onPull={(epcs, truncated) => {
            setPanel(null)
            // A handheld sweeping past the counter hears its check tag too.
            const pulled = epcs.filter((epc) => epc.toUpperCase() !== checkTag)
            const fresh = pulled.filter(
              (epc) => !units.some((unit) => unit.epc === epc),
            )
            const skipped = pulled.length - fresh.length
            if (fresh.length === 0) {
              setNote({
                bad: true,
                text:
                  skipped > 0
                    ? `Semua ${skipped} tag di sesi itu sudah ada di transaksi.`
                    : "Sesi itu tidak punya tag.",
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
                `${fresh.length} tag diambil ke transaksi` +
                (skipped > 0 ? `, ${skipped} dilewati karena sudah ada` : "") +
                (truncated
                  ? ". Sesi itu lebih dari 2000 tag — server toko hanya mengambil 2000 yang pertama"
                  : "") +
                ".",
            })
          }}
        />
      )}

      {/* F5: Daftar member. Registering only registers (who a sale is for is
          asked at Bayar); a struk number typed in the form ties the new member
          to that earlier sale, and the node says what it earned. */}
      {panel === "register" && (
        <MemberSheet
          key="register"
          start="register"
          onRegistered={(member, tied) => {
            setPanel(null)
            setNote({
              bad: false,
              text: `Member terdaftar — ${member.display_name} · ${member.member_id}${
                tied === null ? "" : ` · ${tied.receipt_no} +${grouped(tied.points_earned)} poin`
              }`,
            })
          }}
          onClose={() => setPanel(null)}
        />
      )}

      {itemGroup !== null && (
        <ItemCard
          sku={itemGroup.sku}
          name={itemGroup.name}
          row={bySku.get(itemGroup.sku)}
          division={subOf(itemGroup.sku)}
          tags={tagsOf.get(itemGroup.sku) ?? []}
          quantity={itemGroup.units.length}
          price={itemGroup.price}
          was={markdownBase(itemGroup)}
          marks={[
            ...(itemGroup.idTag !== null ? [itemGroup.idTag.text] : []),
            ...(freeSkus.has(itemGroup.sku) ? ["Gratis"] : []),
            ...(lineCuts.get(itemGroup.key)?.tags ?? []),
          ]}
          currency={currency}
          onClose={leavePanel}
        />
      )}

      {panel === "ask" && (
        <MemberSheet
          key="ask"
          start="find"
          ask="pay"
          onAttach={(member, registered) => {
            attachMember(member, registered)
            setAsked(true)
            onGo("payment")
          }}
          onSkip={() => {
            setPanel(null)
            setAsked(true)
            onGo("payment")
          }}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "coupon" && (
        <AddCode
          title="Kupon"
          label="Kode kupon"
          placeholder="HEMAT50"
          cta="Terapkan"
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
  onFinish,
  onLock,
  onDisplay,
}: {
  terminalId?: string
  actorId?: string
  unsent?: number
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
        {unsent !== undefined && unsent > 0 && (
          <span className="badge warn">{unsent} belum terkirim</span>
        )}
        {onDisplay !== undefined && (
          <button className="top-tool" onClick={onDisplay}>
            <Icon name="monitor" />
            Layar pelanggan
          </button>
        )}
        {onLock !== undefined && (
          <button className="top-tool" onClick={onLock}>
            <Icon name="lock" />
            Kunci
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
            Tutup kasir
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

/// The app mark, Matte · Deep, drawn exactly as the approved prototype's
/// `mark()` draws it (components/brand-mark.tsx in the hub).
function BrandMark() {
  const id = `bm${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4277e6" />
          <stop offset="1" stopColor="#1f4fc0" />
        </linearGradient>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d3e0fa" />
        </linearGradient>
        <linearGradient id={`${id}d`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd766" />
          <stop offset="1" stopColor="#eaa20f" />
        </linearGradient>
        <filter id={`${id}s`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
      </defs>
      <rect width="100" height="100" rx="23.4" fill={`url(#${id}t)`} />
      <ellipse
        cx="48"
        cy="84"
        rx="25"
        ry="3.4"
        fill="#0b2466"
        opacity=".4"
        filter={`url(#${id}s)`}
      />
      <path
        d="M64.32 28.88A28.25 28.25 0 1 0 64.32 68.12A7.25 7.25 0 0 0 53.89 58.05A13.75 13.75 0 1 1 53.89 38.95A7.25 7.25 0 0 0 64.32 28.88Z"
        fill={`url(#${id}c)`}
      />
      <circle cx="75.5" cy="48.5" r="8" fill={`url(#${id}d)`} />
    </svg>
  )
}

/// The prototype's own line icons (lucide, the hub's set): 2px strokes at
/// 16px, where `Icon` draws the older till set at 20px.
const LU = {
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  bag: (
    <>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </>
  ),
  down: <path d="m6 9 6 6 6-6" />,
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </>
  ),
  rfid: (
    <>
      <path d="M2 12C2 6.5 6.5 2 12 2" />
      <path d="M5 12a7 7 0 0 1 7-7" />
      <path d="M8 12a4 4 0 0 1 4-4" />
      <circle cx="12" cy="12" r="1" />
      <path d="M22 12c0 5.5-4.5 10-10 10" />
      <path d="M19 12a7 7 0 0 1-7 7" />
      <path d="M16 12a4 4 0 0 1-4 4" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
} as const

/// Enter on a picked line, or a click on its photo or name: the article as a
/// card over the counter — large photograph, then the facts as label and value.
/// Esc or × closes it (the window's Esc is `leavePanel`).
function ItemCard({
  sku,
  name,
  row,
  division,
  tags,
  quantity,
  price,
  was,
  marks,
  currency,
  onClose,
}: {
  sku: string
  name: string | null
  row: api.CatalogRow | undefined
  /// "Pria · Koko, Lebaran": the division, then the tags, as under the name.
  division: string
  tags: readonly string[]
  quantity: number
  price: number | null
  was: number | null
  marks: readonly string[]
  currency: string
  onClose: () => void
}) {
  const [enter] = useState(viaPointer)
  const photo = usePhoto(sku, row?.has_image === true)
  const facts: Array<readonly [string, string]> = [
    ["SKU", skuText(sku)],
    ["Kode artikel", articleId(row?.article_code, sku)],
    ["Barcode", row?.barcode ?? "—"],
    ["Divisi", division === "" ? "—" : division],
    ["Tag", tags.length === 0 ? "—" : tags.join(", ")],
  ]
  return (
    <div
      className={enter ? "xchd enter" : "xchd"}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="dlg item" role="dialog" aria-modal="true" aria-label={name ?? skuText(sku)}>
        <div className="dlg-head">
          <p className="ttl">{name ?? skuText(sku)}</p>
          <button type="button" className="x-btn" aria-label="Tutup" onClick={onClose}>
            <Lu name="x" />
          </button>
        </div>
        <div className="dlg-body">
          <div className="item-ph">
            {photo === null ? (
              <span className="item-none">{row?.has_image === true ? "" : "Belum ada foto"}</span>
            ) : (
              <img src={photo} alt={name ?? ""} draggable={false} />
            )}
          </div>
          <dl className="item-f">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="num">{value}</dd>
              </div>
            ))}
            <div>
              <dt>Harga</dt>
              <dd className="num">
                {price === null ? "Tanpa harga" : money(price, currency)}
                {was !== null && <s className="item-was">{money(was, currency)}</s>}
              </dd>
            </div>
            <div>
              <dt>Jumlah</dt>
              <dd className="num">{quantity}</dd>
            </div>
            <div>
              <dt>Keterangan</dt>
              <dd>{marks.length === 0 ? "—" : marks.join(" · ")}</dd>
            </div>
          </dl>
        </div>
        <div className="dlg-foot">
          <span className="sp" />
          <button type="button" className="ds-btn ds-btn--ghost" onClick={onClose}>
            <span>Tutup</span>
            <span className="kbd">Esc</span>
          </button>
        </div>
      </section>
    </div>
  )
}

function Lu({
  name,
  size = 16,
  stroke = 2,
}: {
  name: keyof typeof LU
  size?: number
  stroke?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {LU[name]}
    </svg>
  )
}

/// The prototype's 1024 frame, as a window width.
const NARROW = "(max-width: 1199px)"

/// F3 · Laci: Buka laci, Tambah modal kasir, Setoran sementara (prototype
/// `popView` kind 'drawer'). A small menu under the Laci key; 1–3, ↑ ↓ and
/// Enter pick, Esc closes.
function LaciMenu({
  onClose,
  onPick,
}: {
  onClose: () => void
  onPick: (what: "open" | "modal" | "setor") => void
}) {
  const [enter] = useState(viaPointer)
  const [at, setAt] = useState(0)
  const [left, setLeft] = useState(0)
  const rows = [
    ["open", "lock", "Buka laci"],
    ["modal", "plus", "Tambah modal kasir"],
    ["setor", "check", "Setoran sementara"],
  ] as const
  useEffect(() => {
    const tile = document.querySelector<HTMLElement>('.tilld .k7[aria-keyshortcuts="F3"]')
    if (tile !== null) setLeft(Math.max(12, tile.getBoundingClientRect().left))
  }, [])
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.repeat) return
      if (event.key === "Escape" || event.key === "F3") {
        event.preventDefault()
        onClose()
      } else if (event.key === "ArrowDown") {
        event.preventDefault()
        setAt((was) => Math.min(rows.length - 1, was + 1))
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        setAt((was) => Math.max(0, was - 1))
      } else if (/^[1-3]$/.test(event.key)) {
        event.preventDefault()
        onPick(rows[Number(event.key) - 1][0])
      } else if (event.key === "Enter") {
        event.preventDefault()
        onPick(rows[at][0])
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  return (
    <>
      <span className="t-popscrim" onMouseDown={onClose} />
      <div className={enter ? "t-lacipop enter" : "t-lacipop"} style={{ left }} role="menu" aria-label="Laci">
        {rows.map(([id, icon, label], index) => (
          <button
            key={id}
            type="button"
            role="menuitem"
            className={index === at ? "menu-row on" : "menu-row"}
            onMouseEnter={() => setAt(index)}
            onClick={() => onPick(id)}
          >
            <Lu name={icon} />
            <span>{label}</span>
            <span className="kbd">{index + 1}</span>
          </button>
        ))}
      </div>
    </>
  )
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(NARROW).matches,
  )
  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const change = () => setNarrow(query.matches)
    change()
    query.addEventListener("change", change)
    return () => query.removeEventListener("change", change)
  }, [])
  return narrow
}

/// "Rp 1.122.000" → ["Rp", "1.122.000"]: the footer draws the currency small
/// beside the big figure, and the grid shows the figure alone.
function figureOf(minor: number, currency: string): readonly [string, string] {
  const text = money(minor, currency).replace(/\s/g, " ")
  const at = text.search(/\d/)
  return at <= 0 ? ["", text] : [text.slice(0, at).trim(), text.slice(at)]
}

const plain = (minor: number, currency: string) => figureOf(minor, currency)[1]

/// A bag on the bill, as a line of the grid.
const BAG_KEY = "bag:"
const bagKey = (bag: api.Charge) => `${BAG_KEY}${bag.description}`

/// A coupon code as a shopper hands it over: one word of letters and digits,
/// at least one letter, and not the hex of an RFID tag.
function looksLikeCoupon(code: string): boolean {
  return (
    /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code) &&
    /[A-Z]/.test(code) &&
    !/^[0-9A-F]{16,}$/.test(code)
  )
}

/// The sale screen's header: the mark, 7Soft's key row, and the person —
/// version D of the prototype, so the person sits right after F12.
///
/// The row is the whole of what a cashier does mid-sale, one keycap over one
/// word, in keyboard order (`keybar.tsx`); every tile is also a button. The
/// person's menu holds what is done a couple of times a shift — the menu, the
/// lock, the second screen, finishing — and the cashier's name lives in the
/// status bar below, so the button is just a face.
function SellHeader({
  terminalId,
  unsent,
  held,
  hasUnits,
  bagsOpen,
  laciOpen,
  returning,
  onKey,
  onMenu,
  onFinish,
  onLock,
  onDisplay,
}: {
  terminalId?: string
  unsent?: number
  held: number
  hasUnits: boolean
  bagsOpen: boolean
  laciOpen: boolean
  returning: boolean
  onKey: (id: KeyId) => void
  onMenu?: () => void
  onFinish: () => void
  onLock?: () => void
  onDisplay?: () => void
}) {
  const session = useSession()
  const seat = useSeat()
  const terminal = terminalId ?? session.terminalId
  const who = session.me?.display_name ?? session.me?.username ?? null
  const till = seat !== null && seat.label !== "" ? seat.label : kasirLabel(terminal)
  const [open, setOpen] = useState(false)
  const [animate, setAnimate] = useState(false)
  useShortcuts({ Escape: () => setOpen(false) }, open)

  const toggle = () => {
    setAnimate(viaPointer())
    setOpen((was) => !was)
  }
  const pick = (action: () => void) => () => {
    setOpen(false)
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
    <header className="t-top">
      <div className="t-brand">
        <BrandMark />
        <b>
          Central<i>.</i>
        </b>
      </div>
      <KeyBar
        onKey={onKey}
        off={{
          new: !hasUnits,
          remove: !hasUnits,
          cancel: !hasUnits && !returning,
          pay: !hasUnits,
          hold: held === 0,
        }}
        on={{ bags: bagsOpen, drawer: laciOpen }}
        count={{ hold: held }}
      />
      {/* The person always sits at the far right edge (owner, 23 Oct 2026:
          "profile selalu paling kanan"), whatever the key row's width. */}
      <span className="sp" />
      {unsent !== undefined && unsent > 0 && (
        <span className="t-flagbtn">{unsent} belum terkirim</span>
      )}
      <span className="t-popw">
        <button
          type="button"
          className={open ? "t-person on" : "t-person"}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={who === null ? till : `${who}, ${till}`}
          onClick={toggle}
        >
          <span className="av">{initials(who ?? till)}</span>
          <Lu name="down" />
        </button>
        {open && (
          <>
            <span className="t-popscrim" onMouseDown={() => setOpen(false)} />
            <div className={animate ? "t-pop r enter" : "t-pop r"} role="menu">
              <div className="t-who">
                {who !== null && <div className="nm">{who}</div>}
                <div className="mt">{till}</div>
              </div>
              <span className="sep" />
              {onMenu !== undefined && item("list", "Menu", onMenu, "Ctrl+M")}
              {onLock !== undefined && item("lock", "Kunci", onLock, "Ctrl+L")}
              {onDisplay !== undefined && item("monitor", "Layar pelanggan", onDisplay)}
              <span className="sep" />
              {item("logout", "Tutup kasir", onFinish, "F4")}
            </div>
          </>
        )}
      </span>
    </header>
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
      setProblem("Sesi itu tidak punya tag.")
      return
    }
    onPull(reply.body.epcs ?? [], reply.body.truncated === true)
  }

  return (
    <Sheet title="Ambil dari handheld" onClose={onBack}>
      {items === null && problem === null && (
        <p className="muted">Memuat sesi…</p>
      )}

      {problem !== null && <div className="notice warn">{problem}</div>}

      {items !== null && items.length === 0 && (
        <div className="empty">
          <Icon name="rfid" />
          <h3>Belum ada sesi scan</h3>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <div className="rows">
          {items.map((one) => (
            <div className="row-item" key={one.reader_session_id}>
              <div className="grow">
                <h3>
                  {one.tag_count} tag · {one.device_count} scanner
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
                {busy === one.reader_session_id ? "Mengambil…" : "Ambil"}
              </button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}

const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
const two = (n: number) => String(n).padStart(2, "0")
const hhmm = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}`
/// "21 Okt 2026, 10:59", as the prototype's status strip writes it.
const dayTime = (d: Date) => `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${hhmm(d)}`

/// The strip along the bottom, on the stone: whether every sale has reached
/// the node and the counter's hardware on the left — never assumed, each
/// device says for itself — then who is selling, at which till, the last
/// receipt (what Ctrl+P prints again), since when the shift is open, and the
/// clock.
function Statusbar({
  unsent,
  refused,
  reader,
  who,
  till,
  receiptNo,
}: {
  unsent?: number
  refused?: number
  /// The R3 as the counter's chip shows it: one source for both.
  reader: ReaderStatus | null
  /// Whose till this is: the cashier, and the seat they hold.
  who?: string | null
  till?: string
  /// The receipt Ctrl+P would print again: this shift's latest.
  receiptNo: string | null
}) {
  const [fingerprint, setFingerprint] = useState<{
    readonly on: boolean
    readonly detail: string
  } | null>(null)
  useEffect(() => {
    // Both devices are shell-bound — `device()` answers `bound: false` with
    // no shell to ask — and web has neither an RFID reader nor a fingerprint
    // scanner to report on, so it never asks and the strip stays empty of
    // them rather than showing two lights that can only ever be off.
    if (isWeb) return
    let alive = true
    void device("fingerprint_state").then((fp) => {
      if (alive) setFingerprint({ on: fp.bound, detail: fp.detail })
    })
    return () => {
      alive = false
    }
  }, [])

  // When this till's shift was opened, as the node keeps it. Asked again when
  // the seat's shift changes; left out when the node does not say.
  const seat = useSeat()
  const [opened, setOpened] = useState<Date | null>(null)
  useEffect(() => {
    let alive = true
    void api.activeShift().then((reply) => {
      if (!alive) return
      const at = reply.ok ? reply.body?.opened_at : undefined
      const when = at === undefined ? null : new Date(at)
      setOpened(when !== null && !Number.isNaN(when.getTime()) ? when : null)
    })
    return () => {
      alive = false
    }
  }, [seat?.shift_id])

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(timer)
  }, [])

  const devices: readonly {
    readonly what: string
    readonly tone: "on" | "off" | "warn"
    readonly detail: string
  }[] = isWeb
    ? []
    : [
        {
          what: "RFID",
          tone:
            reader === null || reader.state === "busy" || reader.state === "attention"
              ? "warn"
              : reader.state === "ready"
                ? "on"
                : "off",
          detail:
            reader === null
              ? "Menanyakan R3…"
              : reader.fault !== null
                ? sentence(reader.fault)
                : reader.detail,
        },
        ...(fingerprint === null
          ? []
          : [
              {
                what: "Sidik jari",
                tone: fingerprint.on ? ("on" as const) : ("off" as const),
                detail: fingerprint.detail,
              },
            ]),
      ]

  const sync =
    refused !== undefined && refused > 0
      ? { tone: "warn", text: `${refused} penjualan ditolak server toko` }
      : unsent !== undefined && unsent > 0
        ? { tone: "warn", text: `${unsent} penjualan menunggu dikirim` }
        : unsent !== undefined
          ? { tone: "on", text: "Semua penjualan terkirim" }
          : null

  return (
    <footer className="t-status">
      {sync !== null && (
        <>
          <span className={sync.tone === "on" ? "live" : "live warn"} />
          <span className={sync.tone === "on" ? "t-sync" : "t-sync warn"}>{sync.text}</span>
        </>
      )}
      {devices.map((one) => (
        <Fragment key={one.what}>
          <span className="dot">·</span>
          <span className={`t-dev ${one.tone}`} title={one.detail}>
            <i />
            {one.what}
          </span>
        </Fragment>
      ))}
      <span className="sp" />
      {who !== undefined && who !== null && (
        <>
          <span>{who}</span>
          <span className="dot">·</span>
        </>
      )}
      {till !== undefined && till !== "" && (
        <>
          <span>{till}</span>
          <span className="dot">·</span>
        </>
      )}
      {receiptNo !== null && (
        <>
          <span className="num">Struk terakhir {receiptNo}</span>
          <span className="dot">·</span>
        </>
      )}
      {opened !== null && (
        <>
          <span className="num">
            Shift sejak{" "}
            {opened.toDateString() === now.toDateString() ? hhmm(opened) : dayTime(opened)}
          </span>
          <span className="dot">·</span>
        </>
      )}
      <span className="num">{dayTime(now)}</span>
    </footer>
  )
}

/// One payment as the node is sent it — what `enqueue` carries for a tender —
/// and the basket id a voucher's hold was granted under, so it can be given back.
type Tender = {
  readonly method: string
  /// The bank's EDC or QRIS acquirer, upper-cased, for a card or QRIS.
  readonly acquirer: string | null
  /// `DEBIT` or `CREDIT`, for a card only.
  readonly cardKind: "DEBIT" | "CREDIT" | null
  /// The master's Mode of Payment code; null on the fallback list.
  readonly code: string | null
  readonly amountMinor: number
  readonly tenderedMinor: number
  readonly reference: string | null
  /// The hold head office granted against a voucher, for a VOUCHER tender.
  /// Null on every other method, and null is not a spare value: the node
  /// refuses a voucher without one and refuses the field on anything else,
  /// so this is the voucher's own proof that the money was reserved before
  /// it was taken.
  readonly voucherAuthorizationId: string | null
  /// The basket id the hold was granted under, so it can be given back if
  /// this tender is taken off before the sale is completed.
  readonly voucherCheckoutId: string | null
}

/// A Poin ask head office has taken and the shopper has not answered yet. The
/// code the shopper was sent on WhatsApp never comes back here.
type PointsAsk = {
  readonly requestId: string
  readonly points: number
  /// What head office says the points buy — the truth, never `points` itself.
  readonly valueMinor: number
  readonly expiresAt: string
  /// `0812****7890`, where the code went; null when none went and only the
  /// member app can approve.
  readonly sentTo: string | null
  /// Why no code went, in head office's English.
  readonly notSent: string | null
}

/// One row of the Pay dialog — pay look E · Chip EDC of
/// pos-classic-prototype.html: Tunai, an EDC (or more), Voucher, Diskon karyawan
/// and, with a member, Poin. A row is always on the list; it takes an amount
/// only once it knows whose money it is.
type PayLine = {
  readonly id: number
  /// The tile's key (a tender type, or the old tile value on the fallback list).
  readonly tile: string
  /// The method chosen under the tile (`code ?? label`), or null.
  readonly bank: string | null
  /// Cash: what was handed over. Everything else: what it pays.
  readonly amount: number
  /// Filled with the rest rather than typed: shown in blue until it is changed.
  readonly auto: boolean
  /// The voucher's code, or the employee balance code.
  readonly code: string
  /// Who the balance code turned out to be, once looked up.
  readonly holder: BenefitHolder | null
  /// The grant an employee's finger earned at the node: what the balance is
  /// spent by instead of the code (client, 24 Oct 2026).
  readonly finger?: string | null
  /// A voucher held at head office or a balance spent: the tender as it
  /// stands. The line is locked until it is taken off again.
  readonly secured: Tender | null
  /// A card: the machine's own bank (On us) or another bank's card (Off us).
  readonly onus?: "On us" | "Off us" | null
  /// The Poin line (7Soft's REDEEM), offered while a member is on the sale. The
  /// cashier types how many points and asks head office (owner, 25 Oct 2026:
  /// the shopper does not choose); the shopper approves in the member app or
  /// reads back the six digits head office WhatsApps them, and either way head
  /// office confirms it into a voucher, which this line then pays with as the
  /// Voucher line would.
  readonly poin?: boolean
  /// The points the cashier typed, digits. Undefined until they type: the row
  /// then suggests as many as the member has and the bill still needs.
  readonly points?: string
  /// The ask while it waits for the shopper; null before it is made and after.
  readonly ask?: PointsAsk | null
  /// The six digits the shopper read back, typed while the ask waits.
  readonly redeem?: string
  /// What the confirmed ask bought; `code` then holds the voucher's code.
  readonly redeemed?: { readonly points: number | null; readonly value: number } | null
  /// What a voucher's check answered, for the middle of its row: "Komplimen ·
  /// CODE · saldo 50.000". Set once the code is known; it opens the amount.
  readonly info?: string | null
  /// An EDC row only (undefined on every other row): the machine answered —
  /// `EdcMachine.id` — or null while Mesin is still asked.
  readonly edc?: string | null
  /// ... and the Jenis answered, or null while it is still asked.
  readonly kind?: Kind | null
  /// An EDC added with + for a bill split over cards; it goes again when left empty.
  readonly extra?: boolean
  /// The code field is marked red: a voucher no one knows, a wrong points code.
  readonly bad?: boolean
}

const choiceKey = (one: MethodChoice) => one.code ?? one.label

/// What was typed into Bayar, kept when it is closed (Esc) and given back when
/// it opens again for the same basket. A sale, or another basket, forgets it.
let payKept: { readonly basket: string; readonly lines: readonly PayLine[] } | null = null

/// A held sale being resumed starts Bayar empty.
export function forgetPayment() {
  payKept = null
}

/// The method's name, in the counter's words.
function rowName(tile: MethodTile): string {
  switch (tile.wire) {
    case "CASH":
      return "Tunai"
    case "CARD":
      return tile.cardKind === "CREDIT" ? "Kredit" : "Debit"
    case "QRIS":
      return "QRIS"
    case "EWALLET":
      return "E-wallet"
    case "VOUCHER":
      return "Voucher"
    case "BENEFIT":
      return "Diskon karyawan"
  }
}

/// What an EDC row can take, in the order it is asked and keyed: Debit D,
/// Kredit K, QRIS Q. A machine offers only the kinds it has.
const KINDS = [
  ["debit", "Debit", "D"],
  ["credit", "Kredit", "K"],
  ["qris", "QRIS", "Q"],
] as const
type Kind = (typeof KINDS)[number][0]
const KEY_KIND: Readonly<Record<string, Kind>> = { d: "debit", k: "credit", q: "qris" }

/// What a row is waiting for before it takes an amount (`lockOf`). `FIXED` is
/// not a wait: the amount is what the voucher holds (or what is spent), and is
/// not typed.
const NEEDS_CODE = "Kode dulu"
const NEEDS_FINGER = "Jari dulu"
const NEEDS_ANSWER = "Jawab dulu"
const EMPTY_BALANCE = "Saldo kosong"
const FIXED = "fixed"

const WRONG_POINTS_CODE = "Kode salah · minta pelanggan baca ulang dari WhatsApp"

/// A Poin refusal in the counter's words. `null`: head office has no live ask
/// matching the code typed — the wrong code. Head office's own sentences are
/// read first, because a refusal other than the plain ones comes back through
/// the node as a 503 with the sentence inside.
function pointsRefusal(reply: { readonly problem: string | null; readonly status: number }): string | null {
  const said = reply.problem ?? ""
  if (/no live redemption/i.test(said)) return null
  const has = /has ([\d.,]+) points/i.exec(said)
  if (has !== null) return `Poin member hanya ${grouped(Number(has[1].replace(/\D/g, "")))}.`
  if (/blocked/i.test(said)) return "Member ini diblokir."
  if (/not connected/i.test(said)) {
    return "WhatsApp kantor pusat belum tersambung — minta pelanggan setujui di app member."
  }
  if (/\bno member\b/i.test(said)) return "Member tidak ditemukan."
  if (reply.status === 405 || (reply.status === 404 && reply.problem === null)) {
    return "Server toko ini belum bisa tukar poin."
  }
  if (reply.status === 0 || reply.status === 502 || reply.status === 503 || reply.status === 504) {
    return "Kantor pusat tidak terjangkau — coba lagi sebentar."
  }
  if (reply.status === 404 || /not found|no such/i.test(said)) return null
  if (reply.status === 401 || reply.status === 403) return "Server toko menolak tukar poin dari kasir ini."
  return said || `Server toko menolak (${reply.status}).`
}

/// Why head office sent the shopper no WhatsApp code, for the end of the
/// waiting line.
function notSentWords(why: string): string {
  if (/no whatsapp|not connected/i.test(why)) return "WhatsApp kantor pusat belum tersambung"
  if (/not a phone number/i.test(why)) return "Nomor member bukan nomor HP"
  return "Kode WhatsApp tidak terkirim"
}

/// The one line a waiting Poin row says.
const waitWords = (ask: PointsAsk) =>
  ask.sentTo !== null
    ? `Menunggu pelanggan — kode dikirim ke WhatsApp ${ask.sentTo}, atau setujui di app member`
    : `Minta pelanggan menyetujui di app member${ask.notSent === null ? "" : ` · ${notSentWords(ask.notSent)}`}`

/// What the voucher head office hands back does to a Poin row: the voucher pays
/// it, never more than is still owed (`rest`). Points spent cannot be taken
/// back here, so the amount fills at once.
function poinVoucher(
  done: ConfirmedRedeemRequest,
  ask: PointsAsk | null | undefined,
  rest: number,
): Partial<PayLine> {
  const value = done.voucher_value_minor ?? ask?.valueMinor ?? 0
  return {
    code: done.voucher_code ?? "",
    redeemed: { points: done.points_spent ?? ask?.points ?? null, value },
    amount: Math.min(value, rest),
    auto: true,
    bad: false,
    ask: null,
    redeem: "",
  }
}

/// A waiting ask's minutes and seconds, ticking on its own so the dialog does
/// not render once a second for it.
function Countdown({ until }: { readonly until: string }) {
  const left = () => {
    const seconds = Math.ceil((Date.parse(until) - Date.now()) / 1000)
    return Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  }
  const [seconds, setSeconds] = useState(left)
  useEffect(() => {
    setSeconds(left())
    const timer = window.setInterval(() => setSeconds(left()), 1000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until])
  return <span className="num">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>
}

/// The keypad is for touch; the counter types. Hidden until asked for, and the
/// till remembers the choice (client, 24 Oct 2026).
const PAD_KEY = "pos.pad"
const padKept = () => {
  try {
    return localStorage.getItem(PAD_KEY) === "1"
  } catch {
    return false
  }
}

/// Only a voucher carries a code typed in: a card is the machine and On us /
/// Off us, never an approval code (owner, 21 Oct 2026), and the node needs no
/// reference for a card, QRIS or e-wallet (`backend/src/tender.rs`).
const needsCode = (tile: MethodTile) => tile.wire === "VOUCHER"

/// The round amounts above what is due a shopper is likely to hand over:
/// the next 10.000, 50.000 and 100.000 (then 20.000, 200.000, 500.000) above
/// it, no duplicates, ascending — the prototype's `cashQuick`.
function cashQuick(rest: number): number[] {
  const seen = new Set([rest])
  const out: number[] = []
  for (const step of [10_000, 50_000, 100_000, 20_000, 200_000, 500_000]) {
    const value = Math.max(step, Math.ceil(rest / step) * step)
    if (value > rest && !seen.has(value)) {
      seen.add(value)
      out.push(value)
    }
    if (out.length === 3) break
  }
  return out.sort((a, b) => a - b)
}

/// The colour of each note and coin handed back, and whether it is a coin.
const NOTE_LOOK: Readonly<Record<number, readonly [string, boolean]>> = {
  100_000: ["#d0484d", false],
  50_000: ["#2f6fb8", false],
  20_000: ["#2f9461", false],
  10_000: ["#7f55ad", false],
  5_000: ["#a8743a", false],
  2_000: ["#7b7f88", false],
  1_000: ["#5d9a88", false],
  500: ["#cdb36a", true],
  200: ["#c3c6cc", true],
  100: ["#c9cbd0", true],
}

const PAD = ["7", "8", "9", "del", "4", "5", "6", "clr", "1", "2", "3", "000", "0", "00"]

const KIND_WORD: Readonly<Record<string, string>> = {
  GIFT_CARD: "Gift card",
  REFUND: "Refund",
  GOODWILL: "Komplimen",
}

/// Keep the caret where it is: a tile, a key or a quick amount is pressed, not
/// focused, so the next key still reaches the dialog.
const keepFocus = (event: React.MouseEvent) => event.preventDefault()

/// Taking the money — a dialog over the counter, pay look E · Chip EDC of the
/// prototype (client, 24 Oct 2026).
///
/// Every way to pay is a row: Tunai, EDC (one or more), Voucher, Diskon
/// karyawan and, with a member, Poin. A row takes no amount until it is
/// verified — the EDC's three answers, the voucher's code, the employee's
/// finger, the member app's code — and then the amount opens, once, from a
/// blur. Cash is always open. ↑ ↓ move between rows, the keys beside an answer
/// change it, and the right side holds the suggested amounts, the keypad when
/// asked for, Tunda and Pembayaran diterima. That takes every row at once: a
/// voucher is held and a balance spent first, then the sale is written.
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
  memberName = null,
  charges,
  actorId,
  credit = null,
  basket,
  onBack,
  onHold,
  onSold,
}: {
  /// The basket as the quote names it (`basisOf`): what typed lines are kept for.
  basket: string
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
  /// The member's name, beside the pieces in the header.
  memberName?: string | null
  charges: readonly api.Charge[]
  actorId: string
  /// F8 Return: what came back pays for the replacements, up to their total.
  credit?: ExchangeCredit | null
  onBack: () => void
  /// Tunda: park the basket and leave Bayar. Not given for a Return.
  onHold?: () => void
  onSold: (sale: Sold) => void
}) {
  const fullMinor = totalMinor
  const creditMinor = credit === null ? 0 : Math.max(0, Math.min(credit.capMinor, fullMinor))
  totalMinor = fullMinor - creditMinor
  const tiles = usePaymentMethods()
  // The shop's EDC machines: the Mesin the EDC row asks, each with the kinds it takes.
  const machines = useEdcMachines()
  // Head office gives each shop the Poin row or not (0989).
  const pointsOffered = usePointsOffered()
  // The dialog fades in for a pointer; F12 opens it as if it had always been there.
  const [enter] = useState(viaPointer)
  // The dialog holds the caret so digits, arrows and Enter reach it; the code
  // field of the row in focus takes it while a code is typed.
  const dialog = useRef<HTMLElement>(null)
  const code = useRef<HTMLInputElement>(null)
  const nextId = useRef(0)
  const blank = (tile: string, bank: string | null = null, more: Partial<PayLine> = {}): PayLine => ({
    id: nextId.current++,
    tile,
    bank,
    amount: 0,
    auto: false,
    code: "",
    holder: null,
    secured: null,
    ...more,
  })
  // An EDC row names no method until its answers are in; the card tile stands
  // in, so nothing about it can be mistaken for cash.
  const cardTile = tiles.find((one) => one.wire === "CARD") ?? tiles[0]
  const firstBank = (tile: MethodTile) =>
    tile.choices[0] === undefined ? null : choiceKey(tile.choices[0])
  /// The rows of a new payment, in the prototype's order.
  const rowsFor = (): PayLine[] => {
    const out: PayLine[] = []
    const cash = tiles.find((one) => one.wire === "CASH")
    if (cash !== undefined) out.push(blank(cash.key, firstBank(cash)))
    if (machines.length > 0) out.push(blank(cardTile.key, null, { edc: null, kind: null }))
    const voucher = tiles.find((one) => one.wire === "VOUCHER")
    if (voucher !== undefined) out.push(blank(voucher.key, firstBank(voucher)))
    const benefit = tiles.find((one) => one.wire === "BENEFIT")
    if (benefit !== undefined) out.push(blank(benefit.key, firstBank(benefit)))
    if (customerId !== null && pointsOffered && voucher !== undefined) {
      out.push(blank(voucher.key, firstBank(voucher), { poin: true, ask: null, redeem: "", redeemed: null }))
    }
    return out
  }
  const [lines, setLines] = useState<readonly PayLine[]>(() => {
    const starting = rowsFor()
    if (payKept !== null && payKept.basket === basket) {
      const kept = payKept.lines
      // Kept only while the rows are the same rows: every method still on the
      // list, and the Poin row there or not as it was.
      const same =
        kept.every((one) => tiles.some((tile) => tile.key === one.tile)) &&
        kept.some((one) => one.poin === true) === starting.some((one) => one.poin === true) &&
        kept.filter((one) => one.edc === undefined && one.poin !== true).length ===
          starting.filter((one) => one.edc === undefined && one.poin !== true).length
      if (same) {
        nextId.current = Math.max(nextId.current, ...kept.map((one) => one.id + 1))
        return kept
      }
    }
    payKept = null
    return starting
  })
  // The rows as the last change left them, so a key handler or an answer from
  // head office works on what is there now and not on the render it began in.
  const linesRef = useRef(lines)
  function put(next: readonly PayLine[]) {
    linesRef.current = next
    setLines(next)
  }
  function edit(id: number, change: Partial<PayLine>) {
    put(linesRef.current.map((one) => (one.id === id ? { ...one, ...change } : one)))
  }
  const current = (id: number) => linesRef.current.find((one) => one.id === id)
  // The row in focus: ↑ ↓ or a click moves it; digits, the keypad and F1–F4 are for it.
  const [focus, setFocus] = useState(0)
  const focusAt = useRef(0)
  // The next digit replaces the amount rather than extending it.
  const fresh = useRef(true)
  const [busy, setBusy] = useState(false)
  // The voucher row whose whole code is being checked at head office.
  const [voucherBusy, setVoucherBusy] = useState<number | null>(null)
  // Set by the first press of Pembayaran diterima that gets as far as writing the sale.
  const completing = useRef(false)
  const leaving = useRef(false)
  const [problem, setProblem] = useState<string | null>(null)
  // The row the problem is about, or whose open question turns red.
  const [miss, setMiss] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // Diskon karyawan opens by the employee's finger, in its own card
  // (`EmployeeFinger`, client 24 Oct 2026); the phone's six digits only where a
  // finger cannot: the web till, a till with no scanner, a node from before
  // fingers (`fingerless`), or a finger this shop does not know — an employee
  // of another shop (`askCode`).
  const scanner = useScanner()
  const [fingerless, setFingerless] = useState(false)
  const [askCode, setAskCode] = useState(false)
  const [fingerAsk, setFingerAsk] = useState(false)
  // The row whose amount has just been opened by a finger or a code: it comes
  // in once from a blur.
  const [reveal, setReveal] = useState<number | null>(null)
  // F8: the keypad, hidden unless this till last asked for it.
  const [pad, setPad] = useState(padKept)
  // The member's points, for the middle of the Poin row.
  const [memberPoints, setMemberPoints] = useState<number | null>(null)
  const byFinger = !isWeb && (scanner === true || SIMULATED) && !fingerless
  const benefitCode = !byFinger || askCode
  const benefitAsk = byFinger
    ? "Minta karyawan menempelkan jarinya di scanner."
    : "Ketik kode saldo karyawan, lalu Enter."
  // The employee balance's `sale_ref` is minted once per basket and kept — the
  // node allows one spend per ref — and a fresh one is minted whenever the
  // spend has been given back, so a cashier can try again after taking it off.
  const saleRef = useRef<string>(newCheckoutId())

  useEffect(() => {
    if (customerId === null || !pointsOffered) return
    let alive = true
    void api.lookupMember(customerId).then((reply) => {
      if (alive && reply.ok && reply.body) setMemberPoints(reply.body.points_balance)
    })
    return () => {
      alive = false
    }
  }, [customerId, pointsOffered])

  const tileOf = (line: PayLine) =>
    tiles.find((one) => one.key === line.tile) ?? tiles[0]
  // A tile with a single method needs no pick: that one is it.
  const choiceOf = (line: PayLine) => {
    const tile = tileOf(line)
    return (
      tile.choices.find((one) => choiceKey(one) === line.bank) ??
      (tile.choices.length === 1 ? tile.choices[0] : null)
    )
  }
  const isCash = (line: PayLine) => tileOf(line).wire === "CASH"
  const isEdc = (line: PayLine) => line.edc !== undefined
  const isBenefit = (line: PayLine) => tileOf(line).wire === "BENEFIT"
  const isVoucher = (line: PayLine) => tileOf(line).wire === "VOUCHER" && line.poin !== true
  const machineOf = (line: PayLine) =>
    line.edc == null ? null : (machines.find((one) => one.id === line.edc) ?? null)
  /// The machine's bank as the cashier says it: "BCA", "Mandiri" — what
  /// "Kartu BCA?" is asked in.
  const bankOf = (line: PayLine) => machineOf(line)?.bank ?? line.edc ?? "bank mesin"
  /// The question an EDC row is waiting on: Mesin, then Jenis, then Kartu (a
  /// card's bank is the machine's own, On us, or another's, Off us; QRIS is not asked).
  const askOf = (line: PayLine): "bank" | "kind" | "card" | null =>
    line.edc === undefined
      ? null
      : line.edc === null
        ? "bank"
        : line.kind == null
          ? "kind"
          : line.kind !== "qris" && !line.onus
            ? "card"
            : null
  const kindsOf = (machine: EdcMachine | null) =>
    KINDS.filter(([kind]) => machine === null || machine[kind] !== null)
  /// The words under the money while an EDC row with money has an open question.
  const askText = (line: PayLine): string | null => {
    const ask = askOf(line)
    if (ask === "bank") return `Pilih dulu mesin EDC: ${machines.map((one, n) => `${n + 1} ${one.bank}`).join(" · ")}`
    if (ask === "kind") {
      const words = kindsOf(machineOf(line)).map(([, word, key]) => `${word} (${key})`)
      return `Pilih dulu: ${words.length > 1 ? `${words.slice(0, -1).join(", ")} atau ${words[words.length - 1]}` : words[0]}`
    }
    if (ask === "card") return `Jawab dulu: kartu ${bankOf(line)} atau bank lain? (Y / T)`
    return null
  }
  /// The line's title: "Debit · BCA", "QRIS · BCA", "Voucher · CODE".
  const titleOf = (line: PayLine) => {
    const tile = tileOf(line)
    if (line.poin) return "Poin"
    if (tile.wire === "VOUCHER") return line.code.trim() === "" ? "Voucher" : `Voucher · ${line.code.trim().toUpperCase()}`
    if (tile.wire === "BENEFIT") {
      const name = line.holder?.full_name ?? line.holder?.employee_code
      return name === undefined ? "Diskon karyawan" : `Diskon karyawan · ${name}`
    }
    if (tile.wire === "CASH") return "Tunai"
    return `${rowName(tile)} · ${bankOf(line)}`
  }

  const paid = lines.reduce((sum, line) => sum + line.amount, 0)
  const cashIn = lines.filter(isCash).reduce((sum, line) => sum + line.amount, 0)
  const outstanding = Math.max(0, totalMinor - paid)
  const change = Math.max(0, paid - totalMinor)
  // An EDC row with money and a question still open: Pembayaran diterima waits.
  const missing = lines.find((line) => line.amount > 0 && askOf(line) !== null) ?? null
  const ok = paid >= totalMinor && paid > 0 && missing === null
  const canHold = onHold !== undefined && credit === null

  /// What is left of the total once every other line is counted.
  const restIn = (all: readonly PayLine[], line: PayLine) =>
    Math.max(
      0,
      totalMinor - all.reduce((sum, other) => (other.id === line.id ? sum : sum + other.amount), 0),
    )
  /// The most a line may take: cash anything (the rest is change); every other
  /// method only the rest — nothing but cash can be more than is due — and an
  /// employee balance no more than it holds, and nothing on a promotion.
  const capIn = (all: readonly PayLine[], line: PayLine) => {
    const tile = tileOf(line)
    if (tile.wire === "CASH") return Number.POSITIVE_INFINITY
    const rest = restIn(all, line)
    // Poin pays what the confirmed code bought, and nothing before it is confirmed.
    if (line.poin) return line.redeemed ? Math.min(rest, line.redeemed.value) : 0
    if (tile.wire !== "BENEFIT") return rest
    return line.holder === null || basketHasPromotion ? 0 : Math.min(rest, line.holder.balance_minor)
  }
  /// A row takes an amount only once it knows whose money it is (client, 24 Oct
  /// 2026): a voucher its code (and then the voucher sets the amount), Diskon
  /// karyawan the employee's finger, Poin the code from the member app, an EDC
  /// its answers. Null: open. `FIXED`: the amount is not typed.
  const lockOf = (line: PayLine): string | null => {
    if (line.secured !== null) return FIXED
    if (line.poin) return line.redeemed ? null : NEEDS_CODE
    const tile = tileOf(line)
    if (tile.wire === "VOUCHER") return line.info != null ? FIXED : NEEDS_CODE
    if (tile.wire === "BENEFIT") {
      return line.holder === null
        ? NEEDS_FINGER
        : line.holder.balance_minor > 0 && !basketHasPromotion
          ? null
          : EMPTY_BALANCE
    }
    return askOf(line) !== null ? NEEDS_ANSWER : null
  }
  /// Whether the row shows a field in its amount column (Voucher; Poin, first
  /// for the points and then for the shopper's code, which exists only when
  /// head office managed to send one) or its middle (the balance code, where a
  /// finger cannot be used).
  const takesCode = (line: PayLine) => {
    if (line.poin) return lockOf(line) === NEEDS_CODE && (line.ask == null || line.ask.sentTo !== null)
    if (isVoucher(line)) return lockOf(line) === NEEDS_CODE
    return isBenefit(line) && line.holder === null && !basketHasPromotion && benefitCode
  }

  // The row in focus with a code field has the caret in it, so letters type the
  // code; every other row gives the caret back to the dialog. After the render,
  // so the field is the row's own.
  const focused = lines[focus]
  const typesCode = !fingerAsk && focused !== undefined && takesCode(focused)
  // The Poin row swaps its field when the ask is made or ends: the caret follows.
  const askedId = focused?.ask?.requestId ?? null
  useEffect(() => {
    if (fingerAsk) return
    const target = (typesCode ? code.current : null) ?? dialog.current
    if (target !== null && document.activeElement !== target) {
      target.focus()
      // The points suggested are replaced by the first digit typed.
      if (target instanceof HTMLInputElement && focused?.poin === true && askedId === null) target.select()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, focused?.id, typesCode, fingerAsk, askedId])

  const clearSaid = () => {
    setNote(null)
    setProblem(null)
    setMiss(null)
  }

  /// Move the focus to a row. An EDC added with + and left empty goes when the
  /// focus leaves it.
  function focusRow(wanted: number) {
    const all = linesRef.current
    const was = all[focusAt.current]
    let to = wanted
    let next = all
    if (
      was !== undefined &&
      was.extra === true &&
      was.edc === null &&
      was.amount === 0 &&
      to !== focusAt.current
    ) {
      next = all.filter((one) => one.id !== was.id)
      if (to > focusAt.current) to -= 1
      put(next)
    }
    to = Math.max(0, Math.min(next.length - 1, to))
    focusAt.current = to
    setFocus(to)
    fresh.current = true
  }

  /// Set a row's amount; more than it may take is cut to what it may.
  function setAmount(line: PayLine, wanted: number, typed: boolean) {
    const tile = tileOf(line)
    const cap = capIn(linesRef.current, line)
    const first = (memberName ?? "").split(" ")[0]
    let value = wanted
    let said: string | null = null
    if (value > cap) {
      value = cap
      said = line.poin
        ? line.redeemed && cap === line.redeemed.value
          ? `Poin${first === "" ? "" : ` ${first}`} cukup untuk ${money(cap, currency)}`
          : `Poin diisi sisanya, ${money(cap, currency)}`
        : tile.wire !== "BENEFIT"
          ? `${titleOf(line)} diisi sisanya, ${money(cap, currency)}`
          : basketHasPromotion
            ? "Diskon karyawan tidak bisa dipakai bersama promo."
            : line.holder === null
              ? benefitAsk
              : cap === line.holder.balance_minor
                ? `Saldo ${(line.holder.full_name ?? line.holder.employee_code).split(" ")[0]} ${money(cap, currency)} · sisanya bayar dengan cara lain`
                : `Diskon karyawan diisi sisanya, ${money(cap, currency)}`
    }
    edit(line.id, { amount: value, auto: !typed })
    setNote(said)
    setProblem(null)
    setMiss(null)
  }

  /// A row that waits (a code, a finger, an answer) said so instead of taking the digit.
  function locked(line: PayLine, lock: string) {
    setProblem(null)
    if (isEdc(line)) {
      setMiss(line.id)
      return
    }
    if (lock === FIXED) {
      setNote(
        isBenefit(line)
          ? "Saldo sudah dipakai · × untuk mengembalikannya"
          : `Jumlah mengikuti saldo voucher ${line.code.trim().toUpperCase()}`,
      )
      return
    }
    if (line.poin) {
      setNote(
        line.ask == null
          ? "Ketik jumlah poin, lalu Enter"
          : line.ask.sentTo === null
            ? "Menunggu pelanggan menyetujui di app member"
            : "Ketik kode 6 angka dari pelanggan",
      )
      code.current?.focus()
      return
    }
    if (isVoucher(line)) {
      setNote("Ketik kode voucher dulu")
      code.current?.focus()
      return
    }
    if (isBenefit(line)) {
      if (basketHasPromotion) setNote("Diskon karyawan tidak bisa dipakai bersama promo.")
      else if (line.holder !== null) {
        setNote(`Saldo diskon karyawan ${line.holder.full_name ?? line.holder.employee_code} kosong`)
      } else if (byFinger) openFinger()
      else {
        setNote(benefitAsk)
        code.current?.focus()
      }
    }
  }

  function digit(key: string) {
    const line = linesRef.current[focusAt.current]
    if (line === undefined || busy) return
    const lock = lockOf(line)
    // A voucher's amount is the voucher's: Backspace or Delete takes the voucher off.
    if (lock === FIXED && (key === "del" || key === "clr")) {
      void clearRow(line)
      return
    }
    if (lock !== null) {
      locked(line, lock)
      return
    }
    if (key === "del") {
      setAmount(line, Math.floor(line.amount / 10), true)
      fresh.current = false
      return
    }
    if (key === "clr") {
      edit(line.id, { amount: 0, auto: false })
      fresh.current = true
      clearSaid()
      return
    }
    const value = Number(`${fresh.current ? "" : String(line.amount || "")}${key}`)
    if (String(value).length > 11) return
    setAmount(line, value, true)
    fresh.current = false
  }

  /// 7Soft's Ribuan keys: each adds that many thousand to the amount.
  function plus(thousands: number) {
    const line = linesRef.current[focusAt.current]
    if (line === undefined || busy) return
    const lock = lockOf(line)
    if (lock !== null) {
      locked(line, lock)
      return
    }
    setAmount(line, line.amount + thousands, true)
    fresh.current = false
  }

  /// The amounts on F1–F4 for the row in focus. Cash: "Uang pas" — what is
  /// still due — then the round amounts above it, each with the change it
  /// leaves. Every other method: just the rest, since nothing but cash can be
  /// more than is due; a balance or points, all of them when that is the rest.
  const quick: readonly { readonly value: number; readonly word: string }[] = (() => {
    if (focused === undefined || lockOf(focused) !== null) return []
    if (isCash(focused)) {
      const due = restIn(lines, focused)
      if (due <= 0) return []
      return [
        { value: due, word: "Uang pas" },
        ...cashQuick(due).map((value) => ({
          value,
          word: `Kembali ${plain(value - due, currency)}`,
        })),
      ].slice(0, 4)
    }
    const cap = capIn(lines, focused)
    if (cap <= 0) return []
    if (focused.poin) return [{ value: cap, word: cap === focused.redeemed?.value ? "Semua poin" : "Sisa" }]
    if (isBenefit(focused)) {
      return [{ value: cap, word: cap === focused.holder?.balance_minor ? "Semua saldo" : "Sisa" }]
    }
    return [{ value: cap, word: "Sisa" }]
  })()

  /// A quick amount fills the row as if it had been typed.
  function applyQuick(index: number) {
    const one = quick[index]
    const line = linesRef.current[focusAt.current]
    if (busy || one === undefined || line === undefined) return
    setAmount(line, one.value, false)
    fresh.current = true
  }

  // ── EDC: Mesin, then Jenis, then Kartu — one question at a time ──────────
  // Nothing is picked for the cashier. An answer shrinks to the chip picked and
  // its × takes it back with every answer after it; on the row in focus the keys
  // beside the answers change them: ← → another machine, D K Q another kind,
  // Y T the card.

  /// Answered: the rest of the bill goes in, typing replaces it.
  function filled(all: readonly PayLine[], line: PayLine): PayLine {
    const ask = askOf(line)
    if (ask === null) setMiss((was) => (was === line.id ? null : was))
    if (ask !== null || line.amount !== 0) return line
    const rest = restIn(all, line)
    if (rest <= 0) return line
    fresh.current = true
    return { ...line, amount: rest, auto: true }
  }
  /// The line as it now is, answered and filled, back on the list.
  function answered(next: PayLine) {
    const all = linesRef.current
    const done = filled(all, next)
    put(all.map((one) => (one.id === done.id ? done : one)))
  }

  function edcUndo(id: number, from: "bank" | "kind" | "card") {
    const line = current(id)
    if (line === undefined) return
    let next: PayLine = { ...line, onus: null, amount: 0, auto: false }
    if (from === "bank") next = { ...next, edc: null, kind: null, tile: cardTile.key, bank: null }
    if (from === "kind") next = { ...next, kind: null, tile: cardTile.key, bank: null }
    put(linesRef.current.map((one) => (one.id === id ? next : one)))
  }

  function edcSetBank(id: number, machineId: string) {
    const line = current(id)
    const machine = machines.find((one) => one.id === machineId)
    if (line === undefined || machine === undefined) return
    if (line.edc === machineId) {
      edcUndo(id, "bank")
      return
    }
    // The kind stays when the new machine takes it; a machine with no QRIS asks again.
    const was = line.kind ?? null
    const kind = was !== null && machine[was] !== null ? was : null
    const way = kind === null ? null : machine[kind]
    answered({
      ...line,
      edc: machineId,
      kind,
      onus: null,
      tile: way === null ? cardTile.key : way.tile.key,
      bank: way === null ? null : choiceKey(way.choice),
    })
  }

  function edcSetKind(id: number, kind: Kind, byKey: boolean) {
    const line = current(id)
    if (line === undefined) return
    if (line.edc == null) {
      setMiss(id)
      return
    }
    if (line.kind === kind) {
      if (!byKey) edcUndo(id, "kind")
      return
    }
    const way = machineOf(line)?.[kind] ?? null
    if (way === null) return
    answered({
      ...line,
      kind,
      onus: kind === "qris" ? null : line.onus,
      tile: way.tile.key,
      bank: choiceKey(way.choice),
    })
  }

  function edcSetCard(id: number, onus: "On us" | "Off us", byKey: boolean) {
    const line = current(id)
    if (line === undefined) return
    if (line.kind == null) {
      setMiss(id)
      return
    }
    if (line.kind === "qris") return
    if (line.onus === onus) {
      if (!byKey) edcUndo(id, "card")
      return
    }
    answered({ ...line, onus })
  }

  /// Digits pick the machine while it is asked; after that they type the amount.
  function edcDigit(line: PayLine, n: number) {
    if (askOf(line) !== "bank") return false
    const machine = machines[n - 1]
    if (machine !== undefined) edcSetBank(line.id, machine.id)
    else setMiss(line.id)
    return true
  }

  /// One more EDC under this one, for a bill split over cards.
  function edcMore(at: number) {
    const all = linesRef.current
    const more = blank(cardTile.key, null, { edc: null, kind: null, extra: true })
    put([...all.slice(0, at + 1), more, ...all.slice(at + 1)])
    focusRow(at + 1)
  }

  /// + (or =) from any row: an EDC still unasked is the one to answer;
  /// otherwise one more EDC under the last.
  function edcPlus() {
    const all = linesRef.current
    const at = focusAt.current
    const line = all[at]
    if (line === undefined) return
    if (isEdc(line) && askOf(line) !== null) {
      setMiss(line.id)
      return
    }
    if (isEdc(line)) {
      edcMore(at)
      return
    }
    const open = all.findIndex((one) => isEdc(one) && one.edc === null)
    if (open >= 0) {
      focusRow(open)
      return
    }
    let last = -1
    all.forEach((one, n) => {
      if (isEdc(one)) last = n
    })
    if (last >= 0) edcMore(last)
  }

  // ── Voucher ──────────────────────────────────────────────────────────────

  /// The code is typed in the amount column. Once it is whole it is looked up
  /// at once (owner, 23 Oct 2026): the row takes what the voucher holds, never
  /// more than is still owed, and the rest stays for another method — no
  /// surprise at Pembayaran diterima.
  function setVoucherCode(id: number, raw: string) {
    edit(id, { code: raw, info: null, bad: false, amount: 0, auto: false })
    clearSaid()
    const wanted = raw.trim().toUpperCase()
    if (wanted.length < 8) return
    // A whole code (twelve characters) is checked with the field locked and
    // saying so, until head office answers.
    if (wanted.length >= 12) setVoucherBusy(id)
    void api.checkVoucher(wanted).then((reply) => {
      if (wanted.length >= 12) setVoucherBusy((was) => (was === id ? null : was))
      const now = current(id)
      if (now === undefined || now.code.trim().toUpperCase() !== wanted || now.info != null) return
      // An invalid voucher takes nothing: the amount stays empty, the field
      // turns red and the row waits until the code is put right.
      const refuse = (why: string) => {
        setMiss(id)
        setProblem(why)
        setNote(null)
        edit(id, { bad: true })
      }
      if (!reply.ok || !reply.body) {
        // A voucher code is twelve characters; a shorter one may still be coming.
        if (reply.status === 404 && wanted.length >= 12) {
          edit(id, { bad: true })
          setNote(`Voucher ${wanted} tidak dikenal`)
        }
        return
      }
      const v = reply.body
      if (v.status !== "ACTIVE" || v.expired || v.balance_minor <= 0) {
        refuse(`Voucher ${wanted} ${v.expired ? "sudah kedaluwarsa" : v.status === "ACTIVE" ? "saldonya habis" : v.status === "VOIDED" ? "sudah di-void" : "tidak aktif"}.`)
        return
      }
      clearSaid()
      const take = Math.min(v.balance_minor, restIn(linesRef.current, now))
      edit(id, {
        amount: take,
        auto: false,
        bad: false,
        info: `${KIND_WORD[v.kind] ?? "Voucher"} · ${wanted} · saldo ${plain(v.balance_minor, currency)}`,
      })
      setReveal(id)
      fresh.current = true
    })
  }

  /// Take a voucher or a balance off its row — × or Backspace/Delete. A held
  /// voucher goes back to head office and a spent balance to its holder (the
  /// ref is renewed, because the spent one is used up there), and the row opens
  /// again at its code, or its finger.
  async function clearRow(line: PayLine) {
    if (busy) return
    const held = line.secured
    if (held !== null) {
      setBusy(true)
      setProblem(null)
      if (held.method === "BENEFIT") {
        const reply = await returnBenefit(held.reference as string, held.amountMinor, "cancelled at the till")
        setBusy(false)
        if (!reply.ok) {
          setProblem(benefitRefusal(reply, "Saldo belum bisa dikembalikan."))
          return
        }
        saleRef.current = newCheckoutId()
      } else {
        if (held.voucherCheckoutId !== null && held.reference !== null) {
          try {
            await releaseVoucher(held.reference, held.voucherCheckoutId, "payment taken off")
          } catch {
            // The hold lapses by itself in minutes; the cashier is not kept for it.
          }
        }
        setBusy(false)
      }
    }
    if (line.poin) edit(line.id, { secured: null })
    else if (isBenefit(line)) {
      edit(line.id, { holder: null, finger: null, code: "", amount: 0, auto: false, secured: null })
    } else {
      edit(line.id, { code: "", info: null, bad: false, amount: 0, auto: false, secured: null })
    }
    setReveal(null)
    clearSaid()
    const at = linesRef.current.findIndex((one) => one.id === line.id)
    if (at >= 0) focusRow(at)
  }

  // ── Poin ─────────────────────────────────────────────────────────────────
  // The cashier types how many points and asks; the shopper answers in the
  // member app or with the six digits head office sent to their WhatsApp. The
  // row then waits (`follow` asks head office every two seconds) and ends in a
  // voucher, or in a sentence and the points as asked, ready to ask again.

  /// The points the row would ask for: what the cashier typed, or — until they
  /// type — as many as the member has and the bill still needs. 1 point is
  /// Rp 1 today, but that is head office's to say: this only suggests, and the
  /// ask's `value_minor` is what pays.
  const wantedPoints = (all: readonly PayLine[], line: PayLine): number =>
    line.points !== undefined
      ? Number(line.points || 0)
      : Math.max(0, Math.min(memberPoints ?? Number.POSITIVE_INFINITY, restIn(all, line)))

  /// The points field: digits, never more than the member has or the bill
  /// still needs. Nothing is sent by typing.
  function setPoints(id: number, raw: string) {
    const line = current(id)
    if (line === undefined || line.redeemed || line.ask) return
    const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 9)
    const cap = Math.min(memberPoints ?? Number.POSITIVE_INFINITY, restIn(linesRef.current, line))
    let said: string | null = null
    let value = digits
    if (digits !== "" && Number(digits) > cap) {
      value = cap > 0 ? String(cap) : ""
      said =
        cap <= 0
          ? memberPoints === 0
            ? "Member belum punya poin"
            : "Tagihan sudah tertutup oleh cara bayar lain"
          : memberPoints !== null && cap === memberPoints
            ? `Poin member hanya ${grouped(cap)}`
            : `Poin diisi sisanya, ${money(cap, currency)}`
    }
    edit(id, { points: value, bad: false })
    clearSaid()
    if (said !== null) setNote(said)
  }

  /// The shopper's six digits, typed while the ask waits. The sixth confirms.
  function setRedeem(id: number, raw: string) {
    const line = current(id)
    if (line === undefined || line.redeemed || !line.ask) return
    const typed = raw.replace(/\D/g, "").slice(0, 6)
    edit(id, { redeem: typed, bad: false })
    clearSaid()
    if (typed.length === 6) void redeemByCode(id, typed)
  }

  /// The shopper approved — in the app or by the code: the voucher pays the row.
  function takeVoucher(id: number, done: ConfirmedRedeemRequest) {
    const line = current(id)
    if (line === undefined || line.redeemed || done.voucher_code === undefined) return
    const patch = poinVoucher(done, line.ask, restIn(linesRef.current, line))
    edit(id, patch)
    if (done.balance_points !== undefined) setMemberPoints(done.balance_points)
    setReveal(id)
    fresh.current = true
    setProblem(null)
    setMiss(null)
    const points = patch.redeemed?.points ?? null
    setNote(`${points === null ? "Poin" : `${grouped(points)} poin`} ditukar · ${money(patch.redeemed?.value ?? 0, currency)}`)
  }

  /// The ask ended without the shopper approving it: the row opens again with
  /// the points as they were asked, red, and the sentence says why.
  function endAsk(id: number, words: string) {
    const line = current(id)
    if (line === undefined || !line.ask) return
    edit(id, { ask: null, redeem: "", points: String(line.ask.points), bad: true })
    setProblem(words)
    setNote(null)
    setMiss(null)
  }

  /// Enter on the points: ask head office. The shopper is then asked in their
  /// app and on WhatsApp — nothing goes before this.
  async function askPoints(id: number) {
    const line = current(id)
    if (line === undefined || customerId === null || busy || line.redeemed || line.ask) return
    const wanted = wantedPoints(linesRef.current, line)
    if (wanted <= 0) {
      edit(id, { bad: true })
      setProblem("Ketik jumlah poin dulu.")
      setNote(null)
      return
    }
    setBusy(true)
    clearSaid()
    const reply = await askRedeem(customerId, wanted)
    setBusy(false)
    const asked = reply.body
    if (!reply.ok || asked?.request_id === undefined) {
      edit(id, { bad: true })
      setProblem(pointsRefusal(reply) ?? "Member tidak ditemukan.")
      return
    }
    edit(id, {
      ask: {
        requestId: asked.request_id,
        points: asked.points,
        valueMinor: asked.value_minor,
        expiresAt: asked.expires_at,
        sentTo: asked.sent_to,
        notSent: asked.not_sent,
      },
      points: String(asked.points),
      redeem: "",
      bad: false,
    })
  }

  /// Take a waiting ask back. `spent`: the shopper approved it first, so the
  /// points are gone and the voucher — if it could be read — pays this bill.
  /// `failed`: head office could not be reached, so the ask may still be live.
  async function cancelAsk(
    ask: PointsAsk,
  ): Promise<
    | { readonly kind: "cancelled" }
    | { readonly kind: "spent"; readonly voucher: ConfirmedRedeemRequest | null }
    | { readonly kind: "failed"; readonly words: string }
  > {
    const reply = await cancelRedeem(ask.requestId)
    if (reply.ok || reply.status === 404) return { kind: "cancelled" }
    if (reply.status === 409) {
      const seen = await redeemProgress(ask.requestId)
      return { kind: "spent", voucher: seen.ok ? (seen.body?.voucher ?? null) : null }
    }
    return { kind: "failed", words: pointsRefusal(reply) ?? "Permintaan poin belum bisa dibatalkan." }
  }

  /// × on a waiting ask, to change the points or because the shopper pays
  /// another way: the ask is taken back and the points open again.
  async function clearAsk(id: number) {
    const line = current(id)
    const ask = line?.ask
    if (line === undefined || ask == null || busy) return
    setBusy(true)
    clearSaid()
    const out = await cancelAsk(ask)
    setBusy(false)
    if (out.kind === "failed") {
      setProblem(out.words)
      return
    }
    if (out.kind === "spent") {
      // Approved in the same moment: keep the voucher; if it could not be read
      // the next `follow` fetches it.
      if (out.voucher?.voucher_code !== undefined) takeVoucher(id, out.voucher)
      else setNote("Pelanggan sudah menyetujui · poin ditukar")
      return
    }
    edit(id, { ask: null, redeem: "", points: String(ask.points), bad: false })
  }

  /// A waiting ask taken back before the sale is written: the shopper approving
  /// it after the bill is closed would spend points on a bill that never took
  /// them. True when the shopper approved first — the voucher is on the row and
  /// the cashier looks at the figures once more before Pembayaran diterima.
  async function dropWaitingAsk(): Promise<boolean> {
    const waiting = linesRef.current.find((line) => line.poin === true && line.ask != null)
    const ask = waiting?.ask
    if (waiting === undefined || ask == null) return false
    setBusy(true)
    const out = await cancelAsk(ask)
    setBusy(false)
    if (out.kind === "spent") {
      if (out.voucher?.voucher_code !== undefined) takeVoucher(waiting.id, out.voucher)
      else setNote("Pelanggan sudah menyetujui · poin ditukar")
      return true
    }
    // Cancelled — or head office out of reach, and the ask lapses by itself in
    // minutes: the sale is not held up for it.
    if (out.kind === "cancelled") edit(waiting.id, { ask: null, redeem: "", points: String(ask.points) })
    return false
  }

  /// The shopper's six digits, read back: found and confirmed at head office,
  /// the same two calls as ever. The voucher that comes back is the one the
  /// app's Approve would have produced.
  async function redeemByCode(id: number, typed: string) {
    const line = current(id)
    const ask = line?.ask
    if (line === undefined || ask == null || customerId === null || busy || line.redeemed) return
    // `null`: no such live request — the wrong code.
    const refuse = (words: string | null) => {
      setBusy(false)
      if (current(id)?.redeemed) return
      edit(id, { bad: true })
      if (words === null) {
        setNote(WRONG_POINTS_CODE)
        setProblem(null)
      } else {
        setProblem(words)
        setNote(null)
      }
    }
    if (typed.length !== 6) {
      refuse("Kode tukar poin itu 6 angka dari WhatsApp pelanggan.")
      return
    }
    setBusy(true)
    clearSaid()
    const found = await lookupRedeemRequest(customerId, typed)
    // A code that belongs to some other ask (this one was replaced) is not this ask's.
    if (!found.ok || found.body?.request_id === undefined || found.body.request_id !== ask.requestId) {
      refuse(found.ok ? null : pointsRefusal(found))
      return
    }
    const state = found.body.status
    if (state !== undefined && state !== "PENDING") {
      refuse(
        `Kode ${typed} ${state === "CONFIRMED" ? "sudah ditukar" : state === "EXPIRED" ? "sudah kedaluwarsa" : state === "CANCELLED" ? "dibatalkan" : "tidak bisa dipakai"}.`,
      )
      return
    }
    const done = await confirmRedeemRequest(found.body.request_id)
    if (!done.ok || done.body?.voucher_code === undefined) {
      refuse(pointsRefusal(done))
      return
    }
    setBusy(false)
    takeVoucher(id, done.body)
  }

  /// One look at where the waiting ask stands. Bound to the interval below by a
  /// ref, so it always works on this render's figures.
  async function follow(requestId: string) {
    const reply = await redeemProgress(requestId)
    const row = linesRef.current.find((one) => one.poin === true && one.ask?.requestId === requestId)
    if (row === undefined) return
    const voucher = reply.ok ? reply.body?.voucher : null
    if (voucher?.voucher_code !== undefined) {
      takeVoucher(row.id, voucher)
      return
    }
    const status = reply.ok ? reply.body?.request.status : undefined
    if (status === "CANCELLED") endAsk(row.id, "Pelanggan menolak penukaran poin.")
    else if (status === "EXPIRED") endAsk(row.id, "Waktu persetujuan habis — minta lagi.")
    else if (!reply.ok && reply.status === 404) endAsk(row.id, "Permintaan poin tidak ditemukan — minta lagi.")
    // Anything else — the line down for a moment — is looked at again in two seconds.
  }
  const followRef = useRef(follow)
  followRef.current = follow
  const waitingFor = lines.find((one) => one.poin === true && one.ask != null)?.ask?.requestId ?? null
  useEffect(() => {
    if (waitingFor === null) return
    let looking = false
    const timer = window.setInterval(() => {
      if (looking) return
      looking = true
      void followRef.current(waitingFor).finally(() => {
        looking = false
      })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [waitingFor])

  /// The tender a line becomes, built as the till always built it.
  function tenderOf(
    line: PayLine,
    amountMinor: number,
    tenderedMinor: number,
    hold: { readonly id: string; readonly checkout: string } | null,
  ): Tender {
    const tile = tileOf(line)
    const choice = choiceOf(line)
    const typed = line.code.trim()
    return {
      method: tile.wire,
      acquirer: choice?.acquirer ?? null,
      cardKind: tile.cardKind,
      code: choice?.code ?? null,
      amountMinor,
      tenderedMinor,
      // The receipt prints the reference and not the acquirer, so a card,
      // QRIS or e-wallet names its machine there: "BCA · On us". A voucher's
      // reference is its code.
      reference:
        tile.wire === "VOUCHER"
          ? typed === ""
            ? null
            : typed
          : tile.wire === "CARD" || tile.wire === "QRIS" || tile.wire === "EWALLET"
            ? [choice?.acquirer ?? choice?.label ?? null, tile.wire === "CARD" ? (line.onus ?? null) : null]
                .filter((one): one is string => one !== null && one !== "")
                .join(" · ") || null
            : typed === ""
              ? null
              : typed,
      voucherAuthorizationId: hold?.id ?? null,
      voucherCheckoutId: hold?.checkout ?? null,
    }
  }

  /// Pembayaran diterima: every row with money in it, checked, then the
  /// voucher held and the balance spent, then the sale written.
  async function pay() {
    // The reason is already on screen beside the money (`holdBack`).
    if (busy || completing.current || holdBack !== null) return
    // A Poin ask nobody answered is taken back before the bill is closed.
    if (ok && linesRef.current.some((line) => line.poin === true && line.ask != null)) {
      if (await dropWaitingAsk()) return
    }
    const all = linesRef.current
    // An EDC with money and a question still open: the question turns red.
    const open = all.find((line) => line.amount > 0 && askOf(line) !== null)
    if (open !== undefined) {
      setMiss(open.id)
      focusRow(all.indexOf(open))
      return
    }
    if (!ok) return
    const using = all.filter((line) => line.amount > 0)
    /// Say what is wrong; the row is marked, the focus goes to it, and with a
    /// patch the row is put right (a voucher cut to its balance, a finger that
    /// ran out) so its code or amount can be corrected.
    const fail = (line: PayLine | null, words: string, patch?: Partial<PayLine>) => {
      setProblem(words)
      setNote(null)
      setMiss(line?.id ?? null)
      if (line === null) return
      if (patch !== undefined && line.secured === null) edit(line.id, patch)
      const at = linesRef.current.findIndex((one) => one.id === line.id)
      if (at >= 0) focusRow(at)
    }
    if (cashIn < change) {
      fail(null, "Hanya tunai boleh lebih dari tagihan.")
      return
    }
    const cashLine = using.find(isCash)
    if (cashLine !== undefined && cashIn === change) {
      fail(cashLine, "Tagihan sudah lunas tanpa tunai — kosongkan tunainya.")
      return
    }
    for (const line of using) {
      if (line.secured !== null) continue
      const tile = tileOf(line)
      if (tile.needsBank && choiceOf(line) === null) {
        fail(line, `Pilih bank untuk ${rowName(tile)}.`)
        return
      }
      if (tile.wire === "BENEFIT") {
        if (basketHasPromotion) {
          fail(line, "Diskon karyawan tidak bisa dipakai bersama promo.", {})
          return
        }
        if (line.holder === null) {
          fail(line, benefitAsk, {})
          return
        }
        continue
      }
      if (tile.wire === "CARD" && line.amount > 0 && !line.onus) {
        fail(line, `Jawab dulu: kartu ${bankOf(line)} atau bank lain? (Y / T)`, {})
        return
      }
      if (!needsCode(tile)) continue
      if (line.code.trim().length < 4) {
        fail(line, "Ketik kode voucher.", {})
        return
      }
    }

    setBusy(true)
    setProblem(null)
    setMiss(null)
    setNote(null)
    let now = all
    const keep = (line: PayLine, secured: Tender) => {
      now = now.map((one) => (one.id === line.id ? { ...one, secured } : one))
      put(now)
    }
    for (const line of using) {
      if (line.secured !== null) continue
      const tile = tileOf(line)
      if (tile.wire === "VOUCHER") {
        // A voucher is held at head office before a single rupiah of it is
        // taken. Nothing local can answer whether the card still carries this
        // much — the same card may be on another counter's till this minute —
        // so the hold is asked for first and the tender only exists if it
        // comes back.
        const typed = line.code.trim().toUpperCase()
        // Never ask a voucher for more than it holds (owner, 23 Oct 2026): the
        // line is cut to its balance and the rest is left to another method.
        const looked = await api.checkVoucher(typed)
        if (looked.ok && looked.body && looked.body.balance_minor < line.amount) {
          const left = line.amount - looked.body.balance_minor
          setBusy(false)
          fail(
            line,
            `Voucher ${typed} hanya ${plain(looked.body.balance_minor, currency)}. Sisa ${plain(left, currency)} bayar dengan cara lain.`,
            { amount: looked.body.balance_minor, auto: false },
          )
          return
        }
        const checkout = newCheckoutId()
        const reply = await authorizeVoucher(typed, checkout, line.amount)
        if (!reply.ok || reply.body?.authorization_id === undefined) {
          setBusy(false)
          const said = (reply.problem ?? "").toLowerCase()
          fail(
            line,
            said.includes("spent")
              ? `Voucher ${typed} saldonya sudah habis.`
              : said.includes("void")
                ? `Voucher ${typed} sudah di-void.`
                : said.includes("expire")
                  ? `Voucher ${typed} sudah kedaluwarsa.`
                  : said.includes("not found") || reply.status === 404
                    ? `Voucher ${typed} tidak ditemukan.`
                    : said.includes("available") || said.includes("held by another")
                      ? `Voucher ${typed} tidak cukup saldonya untuk jumlah ini.`
                      : `Voucher ${typed} tidak bisa dipakai sekarang. Cek kodenya, atau coba lagi.`,
            line.poin ? { amount: 0, auto: false } : { amount: 0, auto: false, info: null },
          )
          return
        }
        keep(
          line,
          tenderOf(line, line.amount, line.amount, {
            id: reply.body.authorization_id,
            checkout,
          }),
        )
      } else if (tile.wire === "BENEFIT") {
        // Spent before the sale is written, with the `sale_ref` the node
        // checks the tender against.
        const ref = saleRef.current
        const reply = await spendBenefit(
          line.finger ? { finger: line.finger } : { code: line.code.replace(/\D/g, "") },
          ref,
          line.amount,
          basketHasPromotion,
        )
        if (!reply.ok) {
          setBusy(false)
          // The finger's grant ran out (ten minutes) or was spent: the row
          // opens again for the finger.
          if (line.finger && reply.status === 401) {
            fail(line, "Jari karyawan sudah tidak berlaku · tempelkan lagi", {
              holder: null,
              finger: null,
              amount: 0,
              auto: false,
            })
            return
          }
          const said = { ...reply, problem: benefitSaid(reply.problem) }
          fail(line, benefitRefusal(said, "Saldo tidak bisa dipakai."), {})
          return
        }
        keep(line, {
          method: "BENEFIT",
          acquirer: null,
          cardKind: null,
          code: choiceOf(line)?.code ?? null,
          amountMinor: line.amount,
          tenderedMinor: line.amount,
          reference: ref,
          voucherAuthorizationId: null,
          voucherCheckoutId: null,
        })
      }
    }
    // Cash is what was handed over; what it pays is that less the change.
    const tenders = now
      .filter((line) => line.amount > 0)
      .map((line) =>
        line.secured !== null
          ? line.secured
          : tenderOf(line, isCash(line) ? line.amount - change : line.amount, line.amount, null),
      )
    await complete(tenders, change, cashIn)
  }

  async function complete(paidWith: readonly Tender[], changeMinor: number, cashMinor: number) {
    // The reason is already on screen beside the money (`holdBack`).
    if (holdBack !== null) {
      setBusy(false)
      return
    }
    // F8 Return: the credit for what came back is the first tender.
    const tenders: readonly Tender[] =
      credit === null || creditMinor <= 0
        ? paidWith
        : [
            {
              method: credit.method,
              acquirer: null,
              cardKind: null,
              code: null,
              amountMinor: creditMinor,
              tenderedMinor: creditMinor,
              reference: credit.reference,
              voucherAuthorizationId: null,
              voucherCheckoutId: null,
            },
            ...paidWith,
          ]
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
    const sent = wireOf(units)
    const entry = enqueue({
      epcs: sent.epcs,
      // The pieces with no tag, as the quote saw them: the node writes each
      // down for head office to match.
      untagged: sent.untagged,
      tenders: tenders.map((one) => ({
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
      quotedTotalMinor: fullMinor,
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
    payKept = null
    const accepted = outcome.sent.includes(entry.localId)
    const refused = !accepted && entry.refused
    onSold({
      id: entry.saleId ?? entry.localId,
      localId: entry.localId,
      saleId: entry.saleId,
      totalMinor: fullMinor,
      changeMinor,
      cashMinor,
      accepted,
      refused,
      problem: accepted ? null : refused ? entry.problem : outcome.problem,
      tags: units.map(unitName),
      seatLost,
    })
  }

  // F8 Return that the credit covers whole: nothing to pay, so the sale is
  // written the moment the node has priced the replacements.
  useEffect(() => {
    if (credit === null || creditMinor <= 0 || totalMinor > 0) return
    if (provisional || holdBack !== null || busy || completing.current) return
    void complete([], 0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credit, creditMinor, totalMinor, provisional, holdBack, busy])

  /// Give back what this basket took and has not spent: any voucher hold this
  /// basket took — the money was reserved against a basket nobody is going to
  /// pay for, and leaving it held would keep it out of the next shopper's hands
  /// until the hold expires on its own — and the employee balance spent.
  async function giveBack() {
    const all = linesRef.current
    const held = all.flatMap((line) => (line.secured === null ? [] : [line.secured]))
    await Promise.all(
      held
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
    await Promise.all(
      held
        .filter((one) => one.voucherCheckoutId !== null && one.reference !== null)
        .map((one) =>
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
    // A Poin ask nobody has answered is taken back, and not waited for. Should
    // the shopper have approved it in that same moment, the voucher is kept on
    // the row for when Bayar opens again.
    for (const line of all) {
      if (line.poin !== true || line.ask == null) continue
      void cancelAsk(line.ask).then((out) => {
        const kept = payKept
        if (out.kind !== "spent" || out.voucher?.voucher_code === undefined) return
        const voucher = out.voucher
        if (kept === null || kept.basket !== basket) return
        payKept = {
          basket,
          lines: kept.lines.map((one) =>
            one.id === line.id ? { ...one, ...poinVoucher(voucher, line.ask, restIn(kept.lines, one)) } : one,
          ),
        }
      })
    }
    // Kept for this basket; a voucher hold went back above, so those rows open
    // unheld again, and a balance spent is gone from its row with its money.
    payKept = {
      basket,
      lines: all.map((line) =>
        line.poin === true && line.ask != null
          ? { ...line, ask: null, redeem: "", points: String(line.ask.points) }
          : line.secured === null
            ? line
            : tileOf(line).wire === "BENEFIT"
              ? { ...line, holder: null, finger: null, code: "", amount: 0, auto: false, secured: null }
              : { ...line, secured: null },
      ),
    }
  }

  /// Step back to the counter.
  async function leavePayment() {
    if (leaving.current) return
    leaving.current = true
    await giveBack()
    onBack()
  }

  /// Tunda: whatever was held goes back first, then the basket is parked.
  async function hold() {
    if (!canHold || busy || completing.current || leaving.current) return
    leaving.current = true
    await giveBack()
    payKept = null
    onHold?.()
  }

  // ── Diskon karyawan ──────────────────────────────────────────────────────

  /// The balance found — by finger or by code — on the Diskon karyawan row. The
  /// amount box opens empty (client, 24 Oct 2026): the cashier types how much
  /// of it pays, or F1 "Semua saldo".
  function takeHolder(holder: BenefitHolder, grant: string | null) {
    const line = linesRef.current.find(isBenefit)
    if (line === undefined) return
    const name = holder.full_name ?? holder.employee_code
    const said = basketHasPromotion
      ? "Diskon karyawan tidak bisa dipakai bersama promo."
      : holder.balance_minor <= 0
        ? `Saldo diskon karyawan ${name} kosong`
        : null
    edit(line.id, { holder, finger: grant, amount: 0, auto: false })
    setReveal(line.id)
    setNote(said)
    setProblem(null)
    setMiss(null)
    fresh.current = true
  }

  /// The balance code, typed where a finger cannot be used.
  function setBenefitCode(id: number, raw: string) {
    edit(id, { code: raw.replace(/\D/g, "").slice(0, 6), holder: null, finger: null, amount: 0, auto: false })
    if (miss === id) clearSaid()
  }

  /// Look the balance code up: who it is and what is left, without using it up.
  async function findHolder() {
    const line = linesRef.current.find(isBenefit)
    if (line === undefined || busy) return
    const typed = line.code.replace(/\D/g, "")
    if (typed.length !== 6) {
      setProblem("Kode saldo karyawan itu 6 angka.")
      setMiss(line.id)
      return
    }
    setBusy(true)
    setProblem(null)
    setMiss(null)
    const reply = await lookupBenefit(typed)
    setBusy(false)
    if (!reply.ok || reply.body === undefined || reply.body === null) {
      setProblem(benefitRefusal(reply, "Kode tidak dikenal."))
      setMiss(line.id)
      return
    }
    takeHolder(reply.body, null)
  }

  /// Space, a digit or "Jari karyawan" on the Diskon karyawan row opens the
  /// employee's finger card (`EmployeeFinger`).
  function openFinger() {
    const line = linesRef.current.find(isBenefit)
    if (line === undefined || busy || fingerAsk) return
    if (basketHasPromotion) {
      setNote("Diskon karyawan tidak bisa dipakai bersama promo.")
      return
    }
    clearSaid()
    focusRow(linesRef.current.indexOf(line))
    setFingerAsk(true)
  }

  /// The card matched the finger and head office read the balance.
  function fingerFound(found: { readonly holder: BenefitHolder; readonly grant: string }) {
    setFingerAsk(false)
    setAskCode(false)
    takeHolder(found.holder, found.grant)
  }

  /// This till cannot take a finger after all: the phone's code it is.
  function noFinger() {
    setFingerAsk(false)
    setFingerless(true)
    setNote("Jari belum bisa dipakai di kasir ini · ketik kode 6 angka dari HP karyawan")
  }

  /// Enter in a code field: a balance code is looked up, the points are asked
  /// for (or, once asked, the shopper's code confirmed); otherwise the caret
  /// goes back to the dialog and Bayar is tried.
  function fieldEnter() {
    const line = linesRef.current[focusAt.current]
    if (line === undefined) return
    if (isBenefit(line) && line.holder === null) {
      void findHolder()
      return
    }
    if (line.poin && !line.redeemed) {
      if (line.ask == null) void askPoints(line.id)
      else void redeemByCode(line.id, (line.redeem ?? "").replace(/\D/g, ""))
      return
    }
    // Enter on a voucher not yet taken checks it now (owner, 25 Oct 2026:
    // "enter voucher ga terjadi apa apa").
    if (needsCode(tileOf(line)) && line.poin !== true && line.info == null) {
      const typed = line.code.trim()
      if (typed.length < 8) setNote("Ketik kode voucher (12 huruf), lalu Enter.")
      else setVoucherCode(line.id, typed)
      return
    }
    dialog.current?.focus()
    void pay()
  }

  function togglePad() {
    const next = !pad
    setPad(next)
    try {
      localStorage.setItem(PAD_KEY, next ? "1" : "0")
    } catch {
      // No storage: it stays hidden next time.
    }
  }

  // The keys of the dialog, as the prototype's `pay2Key`: ↑ ↓ (or Tab) move
  // between rows; digits type into the row in focus — or, while an EDC asks
  // Mesin, pick the machine; ← → another machine, D K Q another kind and Y T the
  // card on an EDC; + (or =) another EDC; Space asks for the employee's finger;
  // F1–F4 a suggested amount; F8 the keypad; F9 Tunda; Enter takes the money;
  // Esc leaves. A code field keeps its own typing — only Enter, Esc, ↑ ↓, F9,
  // F8 and F1–F4 reach past it. Bound once, reading this render's handler when
  // a key arrives.
  const onKey = (event: KeyboardEvent) => {
    const key = event.key
    const target = event.target
    const field =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    // The employee's finger card has the keys while it is up.
    if (fingerAsk) return
    if (event.repeat && key !== "Backspace" && !/^\d$/.test(key)) return
    if (key === "F9") {
      if (!canHold) return
      event.preventDefault()
      void hold()
      return
    }
    if (key === "F8") {
      event.preventDefault()
      togglePad()
      return
    }
    if (key === "Escape") {
      event.preventDefault()
      if (field) dialog.current?.focus()
      else if (!busy) void leavePayment()
      return
    }
    if (/^F[1-4]$/.test(key)) {
      event.preventDefault()
      applyQuick(Number(key[1]) - 1)
      return
    }
    if (busy) return
    const at = focusAt.current
    if (field) {
      if (key === "Enter") {
        event.preventDefault()
        fieldEnter()
      } else if (key === "ArrowDown" || key === "ArrowUp") {
        const to = Math.max(0, Math.min(linesRef.current.length - 1, at + (key === "ArrowDown" ? 1 : -1)))
        if (to === at) return
        event.preventDefault()
        dialog.current?.focus()
        focusRow(to)
      }
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const line = linesRef.current[at]
    if (line === undefined) return
    if (/^[1-9]$/.test(key) && isEdc(line) && edcDigit(line, Number(key))) {
      // The machine was picked.
    } else if (/^\d$/.test(key)) digit(key)
    // The numpad's "." is 000 (owner, 23 Oct 2026) — even with Num Lock off,
    // when the same key arrives as Delete.
    else if (event.code === "NumpadDecimal" || key === "." || key === ",") digit("000")
    else if (key === "Backspace") {
      // An EDC with no amount: Backspace takes back the last answer.
      if (line.edc != null && line.amount === 0) {
        const ask = askOf(line)
        edcUndo(
          line.id,
          ask === "card" ? "kind" : ask === "kind" ? "bank" : line.kind !== "qris" ? "card" : "kind",
        )
      } else digit("del")
    } else if (key === "Delete") digit("clr")
    else if (key === "ArrowDown" || (key === "Tab" && !event.shiftKey)) focusRow(at + 1)
    else if (key === "ArrowUp" || (key === "Tab" && event.shiftKey)) focusRow(at - 1)
    else if ((key === "ArrowLeft" || key === "ArrowRight") && isEdc(line)) {
      const step = key === "ArrowLeft" ? -1 : 1
      const was = machines.findIndex((one) => one.id === line.edc)
      const to = machines[was < 0 ? (step < 0 ? machines.length - 1 : 0) : (was + step + machines.length) % machines.length]
      // The key of the answer it already is does nothing.
      if (to !== undefined && to.id !== line.edc) edcSetBank(line.id, to.id)
    } else if (isEdc(line) && /^[dkq]$/i.test(key)) edcSetKind(line.id, KEY_KIND[key.toLowerCase()], true)
    else if (isEdc(line) && /^[yt]$/i.test(key)) edcSetCard(line.id, /y/i.test(key) ? "On us" : "Off us", true)
    else if (key === "+" || key === "=") edcPlus()
    // Diskon karyawan takes no amount before a finger: Space asks for one
    // (client, 24 Oct 2026); digits do the same through `locked`.
    else if (key === " " && isBenefit(line) && line.holder === null && byFinger) openFinger()
    else if (key === "Enter") void pay()
    else return
    event.preventDefault()
  }
  const keyRef = useRef(onKey)
  keyRef.current = onKey
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keyRef.current(event)
    window.addEventListener("keydown", listen)
    return () => window.removeEventListener("keydown", listen)
  }, [])

  const anyHeld = lines.some((line) => line.secured !== null)

  // The open question of an EDC row turns red under the money; else the problem
  // in red, the reason no money may be taken, the note.
  const missLine = miss === null ? undefined : lines.find((one) => one.id === miss)
  const question = missLine === undefined ? null : askText(missLine)
  const said =
    question !== null ? (
      <p className="pay-err" role="alert">
        {question}
      </p>
    ) : problem !== null ? (
      <p className="pay-err" role="alert">
        {problem}
      </p>
    ) : holdBack !== null ? (
      <p className="pay-note" role="status">
        {holdBack}
      </p>
    ) : note !== null ? (
      <p className="pay-note" role="status">
        {note}
      </p>
    ) : null

  const quickView =
    quick.length > 0 ? (
      <div className="q2" role="group" aria-label="Jumlah cepat">
        {quick.map((one, index) => (
          <button
            key={one.value}
            type="button"
            tabIndex={-1}
            className="q2b"
            aria-keyshortcuts={`F${index + 1}`}
            disabled={busy}
            onMouseDown={keepFocus}
            onClick={() => applyQuick(index)}
          >
            <span className="k7-k" aria-hidden="true">
              F{index + 1}
            </span>
            <b className="num">{plain(one.value, currency)}</b>
            <span className="q2s">{one.word}</span>
          </button>
        ))}
      </div>
    ) : null

  const padView = (
    <>
      <div className="keys">
        {PAD.map((key) => (
          <button
            key={key}
            type="button"
            tabIndex={-1}
            className={key === "del" || key === "clr" ? "key fn" : "key"}
            aria-label={key === "del" ? "Hapus satu digit" : key === "clr" ? "Kosongkan" : key}
            aria-keyshortcuts={key === "000" ? "." : undefined}
            disabled={busy}
            onMouseDown={keepFocus}
            onClick={() => digit(key)}
          >
            {key === "del" ? (
              <Icon name="del" />
            ) : key === "clr" ? (
              "C"
            ) : key === "000" ? (
              <>
                000<span className="kh" aria-hidden="true">.</span>
              </>
            ) : (
              key
            )}
          </button>
        ))}
      </div>
      {/* 7Soft's Ribuan: each key adds that many thousand to the amount. */}
      <div className="rib" role="group" aria-label="Ribuan">
        <span className="rib-l">Ribuan</span>
        {[500, 100, 50, 10, 5, 1].map((thousands) => (
          <button
            key={thousands}
            type="button"
            tabIndex={-1}
            className="key rib-k"
            aria-label={`Tambah ${thousands} ribu`}
            disabled={busy}
            onMouseDown={keepFocus}
            onClick={() => plus(thousands * 1000)}
          >
            +{thousands}
          </button>
        ))}
      </div>
    </>
  )

  /// The EDC row asks one question at a time (Hari picked "Satu per satu",
  /// 24 Oct 2026): Mesin, then Jenis, then Kartu. An answer shrinks to the chip
  /// picked, and on the row in focus the keys beside it change it.
  const edcMid = (line: PayLine, i: number) => {
    const on = i === focus
    const ask = askOf(line)
    const machine = machineOf(line)
    const bank = machine?.bank ?? line.edc ?? null
    const kinds = kindsOf(machine)
    const label = { bank: "Mesin", kind: "Jenis", card: "Kartu" } as const
    const keys: Readonly<Record<"bank" | "kind" | "card", readonly string[]>> = {
      bank: ["←", "→"],
      kind: kinds.map(([, , key]) => key),
      card: ["Y", "T"],
    }
    const chip = (id: string, selected: boolean, run: () => void, word: string, key: string) => (
      <button
        key={id}
        type="button"
        tabIndex={-1}
        className={`mchip${selected ? " on" : ""}`}
        role="radio"
        aria-checked={selected}
        disabled={busy}
        onMouseDown={keepFocus}
        onClick={(event) => {
          event.stopPropagation()
          run()
          focusRow(i)
        }}
      >
        {word}
        {on && (
          <>
            {" "}
            <span className="kbd">{key}</span>
          </>
        )}
      </button>
    )
    const choices =
      ask === "bank"
        ? machines.map((one, n) =>
            chip(one.id, one.id === line.edc, () => edcSetBank(line.id, one.id), one.bank, String(n + 1)),
          )
        : ask === "kind"
          ? kinds.map(([kind, word, key]) =>
              chip(kind, line.kind === kind, () => edcSetKind(line.id, kind, false), word, key),
            )
          : ask === "card"
            ? [
                chip("on", line.onus === "On us", () => edcSetCard(line.id, "On us", false), bank ?? "Bank mesin", "Y"),
                chip("off", line.onus === "Off us", () => edcSetCard(line.id, "Off us", false), "Bank lain", "T"),
              ]
            : []
    const kindWord = KINDS.find(([kind]) => kind === line.kind)?.[1] ?? ""
    const picked = (q: "bank" | "kind" | "card") =>
      q === "bank" ? (bank ?? "") : q === "kind" ? kindWord : line.onus === "On us" ? `Kartu ${bank ?? ""}` : "Bank lain"
    const answer = (q: "bank" | "kind" | "card") => (
      <>
        <button
          type="button"
          tabIndex={-1}
          className="edc-tok"
          aria-label={`Batalkan ${picked(q)}`}
          disabled={busy}
          onMouseDown={keepFocus}
          onClick={(event) => {
            event.stopPropagation()
            edcUndo(line.id, q)
            focusRow(i)
          }}
        >
          {picked(q)}
          <Icon name="x" />
        </button>
        {on && (
          <span className="edc-keys" aria-hidden="true">
            {keys[q].map((key) => (
              <span key={key} className="kbd">
                {key}
              </span>
            ))}
          </span>
        )}
      </>
    )
    const order: ("bank" | "kind" | "card")[] =
      line.kind === "qris" ? ["bank", "kind"] : ["bank", "kind", "card"]
    const done = order.slice(0, ask === null ? order.length : order.indexOf(ask))
    const asked = (q: "bank" | "kind" | "card", inner: React.ReactNode) => (
      <Fragment key={q}>
        <span className={`edc-k${q === ask ? (miss === line.id ? " bad" : " need") : ""}`}>{label[q]}</span>
        <span className="mchips" role="radiogroup" aria-label={label[q]}>
          {inner}
        </span>
      </Fragment>
    )
    return (
      <div className="edc-grid">
        {done.map((q) => asked(q, answer(q)))}
        {ask !== null && asked(ask, choices)}
        {ask === null && on && (
          <>
            <span />
            <span className="mchips">
              <button
                type="button"
                tabIndex={-1}
                className="ds-btn ds-btn--tint ds-btn--sm"
                disabled={busy}
                onMouseDown={keepFocus}
                onClick={(event) => {
                  event.stopPropagation()
                  edcMore(i)
                }}
              >
                Tambah EDC <span className="kbd">+</span>
              </button>
            </span>
          </>
        )}
      </div>
    )
  }

  /// One row of the left side: its name, what it knows in the middle, and in
  /// the amount column the money — or, until the row is verified, nothing, or
  /// the field its code goes in.
  const rowView = (line: PayLine, i: number) => {
    const on = i === focus
    const tile = tileOf(line)
    const lock = lockOf(line)
    const bad = miss === line.id || line.bad === true
    const take = (event: React.MouseEvent) => event.stopPropagation()
    const cross = (words: string, run: () => void) => (
      <button
        type="button"
        tabIndex={-1}
        className="t-x"
        aria-label={words}
        disabled={busy}
        onMouseDown={keepFocus}
        onClick={(event) => {
          take(event)
          run()
        }}
      >
        <Icon name="x" />
      </button>
    )
    const field = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
      <input
        ref={on ? code : undefined}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={bad || undefined}
        onFocus={() => {
          if (focusAt.current !== i) focusRow(i)
        }}
        {...props}
      />
    )
    const nEdc = isEdc(line) ? lines.slice(0, i + 1).filter(isEdc).length : 0
    const name = isEdc(line)
      ? nEdc > 1
        ? `EDC ${nEdc}`
        : "EDC"
      : line.poin
        ? "Poin"
        : rowName(tile)
    let mid: React.ReactNode = null
    if (isEdc(line)) mid = edcMid(line, i)
    else if (line.poin) {
      // Before the ask the member's balance; while it waits, what was asked
      // and what it buys, with × to take it back; then what the voucher paid.
      const ask = line.ask ?? null
      const words = line.redeemed
        ? `${line.redeemed.points === null ? "" : `${grouped(line.redeemed.points)} poin = `}${money(line.redeemed.value, currency)}`
        : ask !== null
          ? `${grouped(ask.points)} poin = ${money(ask.valueMinor, currency)}`
          : memberPoints === null
            ? ""
            : `Saldo ${grouped(memberPoints)} poin`
      mid = (
        <div className="mmid">
          {words !== "" && <span className="vinfo">{words}</span>}
          {ask !== null && cross("Batalkan permintaan poin", () => void clearAsk(line.id))}
          {ask === null && !line.redeemed && (
            <button
              type="button"
              tabIndex={-1}
              className="ds-btn ds-btn--primary ds-btn--sm"
              disabled={busy}
              onMouseDown={keepFocus}
              onClick={(event) => {
                take(event)
                focusRow(i)
                void askPoints(line.id)
              }}
            >
              Minta persetujuan
              {on && (
                <>
                  {" "}
                  <span className="kbd">Enter</span>
                </>
              )}
            </button>
          )}
        </div>
      )
    } else if (tile.wire === "VOUCHER") {
      // The code goes where the money goes; once it is a voucher, the voucher
      // fills the amount, and × takes it off again.
      mid = (
        <div className="mmid">
          {line.info != null && (
            <>
              <span className="vinfo">{line.info}</span>
              {/* A word, not a faint ×, so it reads as the button it is
                  (owner, 25 Oct 2026). */}
              <button
                type="button"
                tabIndex={-1}
                className="vcancel"
                aria-label={`Batalkan voucher ${line.code.trim().toUpperCase()}`}
                disabled={busy}
                onMouseDown={keepFocus}
                onClick={(event) => {
                  take(event)
                  void clearRow(line)
                }}
              >
                Batalkan
              </button>
            </>
          )}
        </div>
      )
    } else if (tile.wire === "BENEFIT") {
      const holder = line.holder
      mid = (
        <div className="mmid">
          {holder !== null ? (
            <>
              <span className="vinfo">
                {holder.full_name ?? holder.employee_code} · saldo {plain(holder.balance_minor, currency)}
              </span>
              {cross("Ganti karyawan", () => void clearRow(line))}
            </>
          ) : basketHasPromotion ? (
            // Said on the row rather than leaving it blank: the shop's rule,
            // not a missing finger or code.
            <span className="vinfo">Tidak bisa bersama promo</span>
          ) : (
            <>
              {takesCode(line) &&
                field({
                  className: "minput",
                  value: line.code,
                  onChange: (event) => setBenefitCode(line.id, event.target.value),
                  inputMode: "numeric",
                  placeholder: byFinger ? "atau ketik kode 6 angka" : "Kode 6 angka dari HP karyawan",
                  "aria-label": "Kode saldo karyawan",
                })}
            </>
          )}
        </div>
      )
    } else mid = <div className="mmid" />
    let amount: React.ReactNode
    if (lock === NEEDS_CODE && line.poin) {
      // The cashier's points first; once asked, the shopper's six digits —
      // and none of that when no code went, because only the app can approve.
      const points = wantedPoints(lines, line)
      amount =
        line.ask == null ? (
          <label className={`amt amt-pts${bad ? " bad" : ""}`}>
            <span className="cur">Poin</span>
            {field({
              value: points > 0 ? grouped(points) : "",
              onChange: (event) => setPoints(line.id, event.target.value),
              onFocus: (event) => {
                if (focusAt.current !== i) focusRow(i)
                event.currentTarget.select()
              },
              inputMode: "numeric",
              placeholder: "0",
              "aria-label": "Jumlah poin",
            })}
          </label>
        ) : line.ask.sentTo !== null ? (
          field({
            className: "minput amt-code",
            value: line.redeem ?? "",
            onChange: (event) => setRedeem(line.id, event.target.value),
            inputMode: "numeric",
            maxLength: 6,
            placeholder: "Kode 6 angka",
            "aria-label": "Kode dari pelanggan",
          })
        ) : (
          <span className="amt-none" aria-hidden="true" />
        )
    } else if (tile.wire === "BENEFIT" && byFinger && line.holder === null && !basketHasPromotion) {
      // Verifikasi sits where the voucher's code field sits, the same size
      // (owner, 25 Oct 2026 sketch): the employee's finger.
      amount = (
        <button
          type="button"
          tabIndex={-1}
          className="minput amt-code mverify"
          disabled={busy}
          onMouseDown={keepFocus}
          onClick={(event) => {
            take(event)
            openFinger()
          }}
        >
          Verifikasi
          {on && (
            <>
              {" "}
              <span className="kbd">Spasi</span>
            </>
          )}
        </button>
      )
    } else if (lock === NEEDS_CODE) {
      amount = field({
        className: "minput amt-code amt-vcode",
        value: voucherBusy === line.id ? "Memeriksa…" : line.code,
        readOnly: voucherBusy === line.id,
        "aria-busy": voucherBusy === line.id,
        onChange: (event) => setVoucherCode(line.id, event.target.value),
        placeholder: "Kode voucher",
        "aria-label": "Kode voucher",
      })
    } else if (lock !== null && lock !== FIXED) {
      amount = <span className="amt-none" aria-hidden="true" />
    } else {
      amount = (
        <span
          className={`amt${line.amount > 0 ? "" : " zero"}${on && lock === null ? " on" : ""}${line.auto ? " auto" : ""}${lock === FIXED ? " fixed" : ""}${reveal === line.id ? " reveal" : ""}`}
        >
          <span className="cur">{currency === "IDR" ? "Rp" : currency}</span>
          <span className="n">{plain(line.amount, currency)}</span>
        </span>
      )
    }
    return (
      <div
        key={line.id}
        className={`mrow${on ? " on" : ""}${isEdc(line) ? " edc" : ""}`}
        onClick={() => {
          if (focusAt.current !== i) focusRow(i)
        }}
      >
        <span className="ml">{name}</span>
        {mid}
        {amount}
        {line.poin === true && line.ask != null && (
          <p className="pwait">
            <span>{waitWords(line.ask)}</span>
            <Countdown until={line.ask.expiresAt} />
          </p>
        )}
      </div>
    )
  }

  /// The right side: the suggested amounts, the keypad when asked for, Tunda and
  /// Pembayaran diterima.
  const right = (
    <>
      {quickView}
      <button
        type="button"
        tabIndex={-1}
        className="ds-btn ds-btn--tint pad-tog"
        aria-keyshortcuts="F8"
        onMouseDown={keepFocus}
        onClick={togglePad}
      >
        {pad ? "Sembunyikan keypad" : "Tampilkan keypad"} <span className="kbd">F8</span>
      </button>
      {pad && padView}
      <div className="pay-acts">
        {canHold && (
          <button
            type="button"
            className="ds-btn ds-btn--tint hold-red"
            disabled={busy}
            onMouseDown={keepFocus}
            onClick={() => void hold()}
          >
            Tunda <span className="kbd">F9</span>
          </button>
        )}
        <button
          type="button"
          className="ds-btn ds-btn--primary pay-go"
          disabled={busy || holdBack !== null || !ok}
          onMouseDown={keepFocus}
          onClick={() => void pay()}
        >
          <span>{busy ? "Memproses…" : "Pembayaran diterima"}</span>
          <span className="kbd">Enter</span>
        </button>
      </div>
    </>
  )

  return (
    <div
      className={enter ? "payd enter" : "payd"}
      onMouseDown={(event) => {
        // Closing by the scrim is only safe while nothing is held: a voucher
        // hold and an employee balance each go back on leaving.
        if (event.target === event.currentTarget && !busy && !anyHeld) {
          void leavePayment()
        }
      }}
    >
      <section ref={dialog} tabIndex={-1} className="pay" role="dialog" aria-modal="true" aria-label="Bayar">
        <div className="pay-head">
          <div>
            <p className="ttl">Bayar</p>
            <p className="cap num">
              {units.length} pcs{memberName !== null && ` · ${memberName}`}
            </p>
          </div>
          <button
            type="button"
            className="x-btn"
            aria-label="Kembali ke transaksi"
            title="Kembali ke transaksi · Esc"
            disabled={busy}
            onClick={() => void leavePayment()}
          >
            <Icon name="x" />
          </button>
        </div>

        <div className="pay-l">
          <div className="bill">
            {credit !== null && creditMinor > 0 && (
              <>
                <span className="k">Total</span>
                <span className="v">{money(fullMinor, currency)}</span>
                <span className="k">Return</span>
                <span className="v ok">− {money(creditMinor, currency)}</span>
              </>
            )}
            <span className="gk">
              Total bayar
              {provisional && <span className="tag warn">Sementara</span>}
            </span>
            <span className="gv">{money(totalMinor, currency)}</span>
          </div>
          <div className="methods m2">{lines.map(rowView)}</div>
          <div className="paybox">
            <span className="k">Dibayar</span>
            <span className="v">{money(paid, currency)}</span>
            <span className="ck">{paid >= totalMinor && paid > 0 ? "Kembalian" : "Kurang"}</span>
            <span className={paid >= totalMinor && paid > 0 ? "cv" : "cv due"}>
              {money(paid >= totalMinor && paid > 0 ? change : outstanding, currency)}
            </span>
            {said}
          </div>
        </div>

        <div className="pay-r">{right}</div>
      </section>
      {fingerAsk && (
        <EmployeeFinger
          actorId={actorId}
          currency={currency}
          onFound={fingerFound}
          onUnknown={() => setAskCode(true)}
          onFingerless={noFinger}
          onClose={() => setFingerAsk(false)}
        />
      )}
    </div>
  )
}

/// What the struk on Transaksi selesai reads out of the node's receipt: the node
/// says what was sold and how it was paid, and the till adds what that document
/// does not carry (the promotions by name, the member, the points).
type Struk = {
  readonly shop: string | null
  readonly site: string | null
  readonly shopLines: readonly string[]
  readonly no: string | null
  readonly at: Date | null
  readonly cashier: string | null
  /// One per article and price: the node's receipt lists every tag.
  readonly items: readonly { readonly name: string; readonly quantity: number; readonly priceMinor: number }[]
  readonly subtotalMinor: number
  readonly totalMinor: number
  readonly tenders: readonly { readonly word: string; readonly amountMinor: number }[]
  readonly changeMinor: number
}

/// How a tender is named on the paper.
const TENDER_WORDS: Readonly<Record<string, string>> = {
  CASH: "Tunai",
  CARD: "Kartu",
  QRIS: "QRIS",
  EWALLET: "E-Wallet",
  VOUCHER: "Voucher",
  BENEFIT: "Diskon karyawan",
  POINTS: "Poin",
}

function readStruk(body: unknown): Struk | null {
  const doc = asMap(body)
  const total = doc === null ? null : asCount(doc.total_minor)
  if (doc === null || total === null) return null
  const items: { name: string; quantity: number; priceMinor: number }[] = []
  for (const row of Array.isArray(doc.lines) ? doc.lines : []) {
    const line = asMap(row)
    if (line === null) continue
    const quantity = Math.max(1, asCount(line.quantity) ?? 1)
    // The price on the tag; what a markdown or a promotion took off is
    // itemised under the lines, as the prototype's paper does.
    const priceMinor = asCount(line.base_unit_price_minor) ?? asCount(line.unit_price_minor) ?? 0
    const name = asText(line.name) ?? asText(line.sku_code) ?? "—"
    const same = items.findIndex((one) => one.name === name && one.priceMinor === priceMinor)
    if (same >= 0) items[same] = { ...items[same], quantity: items[same].quantity + quantity }
    else items.push({ name, quantity, priceMinor })
  }
  const tenders: { word: string; amountMinor: number }[] = []
  for (const row of Array.isArray(doc.tenders) ? doc.tenders : []) {
    const one = asMap(row)
    const amountMinor = one === null ? null : asCount(one.amount_minor)
    if (one === null || amountMinor === null) continue
    const method = (asText(one.method) ?? "").toUpperCase()
    const credit = /^return\b/i.test(asText(one.reference) ?? "")
    tenders.push({ word: credit ? "Return" : (TENDER_WORDS[method] ?? "Lainnya"), amountMinor })
  }
  const at = new Date(asText(doc.completed_at) ?? "")
  return {
    shop: asText(doc.shop_name),
    site: asText(doc.site_id),
    shopLines: [asText(doc.shop_line_1), asText(doc.shop_line_2)].filter((one): one is string => one !== null),
    no: asText(doc.receipt_no),
    at: Number.isNaN(at.getTime()) ? null : at,
    cashier: asText(doc.cashier),
    items,
    subtotalMinor: asCount(doc.subtotal_minor) ?? items.reduce((sum, one) => sum + one.priceMinor * one.quantity, 0),
    totalMinor: total,
    tenders,
    changeMinor: asCount(doc.change_minor) ?? 0,
  }
}

/// What was sold — or what is waiting to be — as the prototype's change
/// dialog: the struk as the printer prints it on the left, and on the right the
/// transaction number, the change and the notes to hand back, the receipt, the
/// next customer.
///
/// The two are not the same screen with a different word. A sale the node has
/// accepted is finished; a sale sitting in the outbox is money taken for
/// something head office has not been told about, and the cashier has to know
/// which one they are looking at before the next customer steps up. A sale the
/// node has not heard of has no receipt to read, so it has no struk either.
function Sale({
  sold,
  receiptNo,
  currency,
  hasMember,
  extra,
  onNext,
}: {
  sold: Sold
  /// The number the customer reads back, once the node has given it.
  receiptNo: string | null
  currency: string
  /// Whether a member is already on this sale.
  hasMember: boolean
  /// What the struk says that the node's receipt does not: the sale's
  /// promotions by name, its bags (the receipt is the goods alone), its member
  /// and what they earned — as they were when the sale was rung.
  extra: {
    readonly promos: readonly { readonly name: string; readonly cutMinor: number }[]
    readonly bags: readonly { readonly name: string; readonly quantity: number; readonly priceMinor: number }[]
    readonly member: string | null
    readonly points: number
  } | null
  /// On to the next customer — and, for a refusal, straight into resolving it.
  onNext: (resolve: boolean) => void
}) {
  const { config } = useNodeConfig()
  const session = useSession()
  const seat = useSeat()
  // Kembalian pops in after a tap on Bayar; after Enter it is simply there.
  const [enter] = useState(viaPointer)
  // Where the receipt goes is this till's peripheral setting: a printer the
  // node recorded, the address in Setelan terminal, the USB printer this till
  // prints to itself, or nowhere — with the reason, when there is one worth
  // reading (a USB printer nobody chose).
  const { target: printer, here, why: noPrint } = receiptTarget(config)
  const [printed, setPrinted] = useState<{ readonly ok: boolean; readonly text: string } | null>(
    null,
  )
  const asked = useRef(false)
  // The node's receipt for this sale: its number, and the paper on the left.
  // `null` is "not asked yet" for a sale that has an id, and the dialog keeps
  // the struk's width meanwhile; `false` is "it could not be read".
  const [struk, setStruk] = useState<Struk | null | false>(sold.saleId === null ? false : null)
  useEffect(() => {
    if (sold.saleId === null) return
    let alive = true
    void api.receipt(sold.saleId).then((reply) => {
      if (alive) setStruk(reply.ok ? (readStruk(reply.body) ?? false) : false)
    })
    return () => {
      alive = false
    }
  }, [sold.saleId])
  const no = receiptNo ?? (struk === null || struk === false ? null : struk.no)

  /// Print once, and do not wait for it.
  ///
  /// A printer out of paper must not hold up the next customer, and the receipt
  /// can be reprinted from the sale at any time. `copy` stamps every print after
  /// the first, so a duplicate can never be mistaken for a second sale. The
  /// drawer is kicked with the first print only, and only when this till's
  /// drawer is opened by the printer (`sendReceipt`).
  const print = useCallback(
    async (copy: boolean) => {
      if (sold.saleId === null) return
      const sent = await sendReceipt(config, sold.saleId, copy)
      if (sent !== null) setPrinted(sent)
    },
    [config, sold.saleId],
  )

  useEffect(() => {
    if (asked.current) return
    asked.current = true
    void print(false)
  }, [print])

  // Tambah member: F5 opens the member sheet for this sale. A node that cannot
  // add a member to a sale says so here rather than failing silently.
  const [memberOpen, setMemberOpen] = useState(false)
  const [added, setAdded] = useState<{ readonly name: string; readonly points: number | null } | null>(null)
  const [memberProblem, setMemberProblem] = useState<string | null>(null)
  const canMember = !hasMember && added === null && sold.saleId !== null
  const memberRef = useRef({ canMember, memberOpen })
  memberRef.current = { canMember, memberOpen }
  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      if (event.key !== "F5" || event.repeat) return
      if (!memberRef.current.canMember || memberRef.current.memberOpen) return
      event.preventDefault()
      setMemberOpen(true)
    }
    window.addEventListener("keydown", listen)
    return () => window.removeEventListener("keydown", listen)
  }, [])

  async function attach(member: api.Member) {
    setMemberOpen(false)
    if (sold.saleId === null) return
    setMemberProblem(null)
    const reply = await api.addMemberToSale(sold.saleId, member.member_id)
    if (reply.ok) {
      setAdded({ name: member.display_name, points: asCount(asMap(reply.body)?.points_earned) })
      return
    }
    setMemberProblem(
      reply.status === 404 || reply.status === 405
        ? "Server toko ini belum bisa menambah member ke transaksi."
        : (reply.problem ?? "Member belum bisa ditambahkan ke transaksi."),
    )
  }

  // Three different things, and the cashier reads which one before the next
  // customer: taken by the node; refused by it, which waits for a supervisor
  // to resolve it; or not answered yet, which the outbox sends again.
  const heading = sold.accepted
    ? "Transaksi selesai"
    : sold.refused
      ? "Ditolak server toko"
      : "Tersimpan di kasir ini"
  const owed = sold.changeMinor > 0
  const prints = printer !== null || here !== null
  const withStruk = struk !== false
  const memberName = added !== null ? added.name : (extra?.member ?? null)
  const memberPoints = added !== null ? (added.points ?? 0) : (extra?.points ?? 0)

  /// The paper, as the printer prints it: monospace, the store, the number, the
  /// time, who rang it, each item, the sums, how it was paid, the member.
  const paper = (doc: Struk) => {
    const row = (left: string, right: React.ReactNode, bold = false, key?: string) => (
      <div className={bold ? "sk-row sk-b" : "sk-row"} key={key}>
        <span>{left}</span>
        <span>{right}</span>
      </div>
    )
    const promos = (extra?.promos ?? []).filter((one) => one.cutMinor > 0)
    const bags = extra?.bags ?? []
    const items = [...doc.items, ...bags]
    const bagsMinor = bags.reduce((sum, one) => sum + one.priceMinor * one.quantity, 0)
    const subtotalMinor = doc.subtotalMinor + bagsMinor
    const totalMinor = doc.totalMinor + bagsMinor
    // What the lines and the promotions leave of the difference to the total:
    // a markdown, a discount on the whole sale.
    const other = subtotalMinor - promos.reduce((sum, one) => sum + one.cutMinor, 0) - totalMinor
    const who = (session.me?.display_name ?? session.me?.username ?? doc.cashier ?? "").split(/\s+/)[0]
    const till = seat !== null && seat.label !== "" ? seat.label : kasirLabel(session.terminalId)
    return (
      <div className="sk-paper" aria-label={no === null ? "Struk" : `Struk ${no}`}>
        {doc.shop !== null && <p className="sk-c sk-b">{doc.shop}</p>}
        {doc.site !== null && <p className="sk-c">{doc.site}</p>}
        {doc.shopLines.map((text) => (
          <p className="sk-c" key={text}>
            {text}
          </p>
        ))}
        <hr />
        {no !== null && row("No.", <b>{no}</b>)}
        {doc.at !== null && row(`${doc.at.getDate()} ${MON[doc.at.getMonth()]} ${doc.at.getFullYear()}`, hhmm(doc.at))}
        {row("Kasir", `${who} · ${till}`)}
        <hr />
        {items.map((one) => (
          <div className="sk-item" key={`${one.name}|${one.priceMinor}`}>
            <span className="sk-name">{one.name}</span>
            {row(`${one.quantity} × ${plain(one.priceMinor, currency)}`, plain(one.priceMinor * one.quantity, currency))}
          </div>
        ))}
        <hr />
        {row(
          `Subtotal · ${items.reduce((sum, one) => sum + one.quantity, 0)} pcs`,
          plain(subtotalMinor, currency),
        )}
        {promos.map((one) => row(one.name, `−${plain(one.cutMinor, currency)}`, false, one.name))}
        {other > 0 && row("Diskon", `−${plain(other, currency)}`)}
        {row("Total", plain(totalMinor, currency), true)}
        {doc.tenders.map((one, at) => row(one.word, plain(one.amountMinor, currency), false, `${at}`))}
        {row("Kembalian", plain(doc.changeMinor, currency))}
        {memberName !== null && (
          <>
            <hr />
            {row(memberName, memberPoints > 0 ? `+${grouped(memberPoints)} poin` : "")}
          </>
        )}
        <hr />
        <p className="sk-c">Terima kasih</p>
      </div>
    )
  }

  const main = (
    <>
      {sold.accepted ? (
        <p className="chg-k top">{heading}</p>
      ) : (
        <p className={sold.refused ? "chg-flag bad" : "chg-flag"}>
          <Icon name={sold.refused ? "alert" : "clock"} />
          {heading}
        </p>
      )}
      {no !== null && (
        <p className="chg-no">
          No. transaksi <b>{no}</b>
        </p>
      )}
      {owed ? (
        <>
          <p className="chg-k">Kembalian</p>
          <p className="chg-v num">{money(sold.changeMinor, currency)}</p>
          <div className="chg-notes">
            {countOut(sold.changeMinor).map(([many, note]) => {
              const [colour, coin] = NOTE_LOOK[note] ?? ["#c9cbd0", true]
              return (
                <span className="chg-note" key={note}>
                  <i className={coin ? "coin" : undefined} style={{ background: colour }} />
                  <span className="x">{many} ×</span>
                  <b>{plain(note, currency)}</b>
                </span>
              )
            })}
          </div>
        </>
      ) : (
        <p className="chg-k">Uang pas</p>
      )}
      {memberName !== null && memberPoints > 0 && (
        <p className="chg-sub ok">
          +{grouped(memberPoints)} poin · {memberName}
        </p>
      )}
      {sold.refused && (
        <p className="chg-warn">
          Ditolak server toko{sold.problem !== null && `: ${plainWords(sold.problem)}`}
        </p>
      )}
      {prints ? (
        sold.saleId !== null && (
          <p className={printed === null ? "chg-print" : printed.ok ? "chg-print ok" : "chg-print bad"}>
            {printed === null ? (
              <>
                <span className="spin" />
                Mencetak struk…
              </>
            ) : (
              <>
                {printed.ok && <Icon name="check" />}
                {printed.ok && no !== null && printed.text === "Struk tercetak."
                  ? `Struk ${no} tercetak`
                  : printed.text}
              </>
            )}
          </p>
        )
      ) : (
        noPrint !== null && <p className="chg-print">{noPrint}</p>
      )}
      {memberProblem !== null && <p className="chg-warn">{memberProblem}</p>}
      {(prints || sold.refused) && (
        <div className="chg-acts">
          {prints && (
            <button
              type="button"
              className="ds-btn ds-btn--tint"
              disabled={sold.saleId === null}
              onClick={() => void print(true)}
            >
              <Icon name="print" />
              Cetak ulang
            </button>
          )}
          {sold.refused && (
            <button type="button" className="ds-btn ds-btn--tint" onClick={() => onNext(true)}>
              Selesaikan
            </button>
          )}
        </div>
      )}
      <div className="chg-acts final">
        {canMember && (
          <button type="button" className="ds-btn ds-btn--tint" onClick={() => setMemberOpen(true)}>
            Tambah member <span className="kbd">F5</span>
          </button>
        )}
        {added !== null && (
          <span className="chg-added">
            <Icon name="check" />
            Member {added.name} ditambahkan
          </span>
        )}
        <button
          type="button"
          className="ds-btn ds-btn--primary chg-go"
          onClick={() => onNext(false)}
          autoFocus
        >
          <span>Transaksi baru</span>
          <span className="kbd">Enter</span>
        </button>
      </div>
    </>
  )

  return (
    <div className={enter ? "payd top enter" : "payd top"}>
      <div className={withStruk ? "chg with-struk" : "chg"} role="dialog" aria-modal="true" aria-label={heading}>
        {withStruk && <div className="sk-well">{struk !== null && paper(struk)}</div>}
        {withStruk ? <div className="chg-main">{main}</div> : main}
      </div>
      {memberOpen && (
        <MemberSheet
          start="find"
          forReceipt={no ?? undefined}
          onAttach={(member) => void attach(member)}
          onClose={() => setMemberOpen(false)}
        />
      )}
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
      entry.untagged,
    )
    if (!reply.ok) {
      return {
        for: key,
        ok: false,
        problem:
          reply.problem ?? `Server toko tidak bisa menghitung penjualan ini (HTTP ${reply.status}).`,
      }
    }
    return {
      for: key,
      ok: true,
      unsellable: reply.body?.unsellable ?? [],
      dueMinor: reply.body?.amount_due_minor ?? reply.body?.total_minor ?? null,
      // The tags' lines come first; the pieces with no tag follow them.
      skus: (reply.body?.lines ?? []).slice(0, epcs.length).map((line) => line.sku_code),
    }
  } catch (cause) {
    return {
      for: key,
      ok: false,
      problem: `Server toko tidak menjawab: ${
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
  const sale = `Penjualan ditolak ${new Date(entry.takenAt).toLocaleString("id-ID")} · ${money(
    entry.quotedTotalMinor,
    currency,
  )}`
  if (swaps.length === 0) return `${sale} · kirim ulang tanpa perubahan`
  const each = swaps
    .map((one) => `…${one.from.slice(-8)} dengan …${one.to.slice(-8)}`)
    .join(", ")
  const full = `${sale} · ganti ${each} (artikel sama) dan kirim ulang`
  return full.length <= 240
    ? full
    : `${sale} · ganti ${swaps.length} tag (artikel sama) dan kirim ulang`
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
      ? "Mengecek ke server toko…"
      : !current.ok
        ? refusalWords(current.problem)
        : !landed && current.unsellable.length > 0
          ? "Masih ditolak. Ganti tagnya, atau pindahkan stok ke lantai toko di aplikasi toko lalu cek lagi."
          : current.dueMinor === null
            ? "Server toko belum punya harga untuk penjualan ini, jadi uangnya belum bisa dicek."
            : current.dueMinor !== entry.quotedTotalMinor
              ? `Server toko kini menghitung penjualan ini ${money(current.dueMinor, currency)}, tapi yang dibayar ${money(
                  entry.quotedTotalMinor,
                  currency,
                )}. Perubahan harga tidak bisa dilakukan di sini — perlu retur dan transaksi baru.`
              : swaps.some((one) => current.skus[entry.epcs.indexOf(one.from)] !== one.sku)
                ? "Tag pengganti di server toko adalah artikel lain. Perlu retur dan transaksi baru."
                : null

  /// The tag read or scanned, as the real tag for `replacing` — only one of the
  /// same SKU, and only when the node would sell the sale with it.
  async function tryReplace(raw: string) {
    const from = replacing
    if (from === null || busy) return
    setProblem(null)
    const read = readScan(raw.trim().replace(/·/g, ""))
    if (read.kind !== "epc") {
      setProblem("Itu bukan tag barang. Baca di pad, atau scan tagnya langsung.")
      return
    }
    const wanted = skuOf(from)
    if (wanted === null) {
      setProblem("Artikel tag ini tidak diketahui, jadi tidak bisa diganti di sini.")
      return
    }
    if (plan.some((epc) => epc.toUpperCase() === read.epc.toUpperCase())) {
      setProblem("Tag itu sudah ada di penjualan ini.")
      return
    }
    if (read.sku_code !== wanted) {
      setProblem(
        `Itu ${nameOf(read.sku_code)} (${skuText(read.sku_code)}), bukan ${nameOf(
          wanted,
        )} (${skuText(wanted)}). Artikel lain tidak bisa ditukar di sini — ` +
          "perlu retur dan transaksi baru.",
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
      setProblem(
        `…${read.epc.slice(-8)} juga tidak bisa dijual dari toko ini: ${refusalWords(refusal.reason)}.`,
      )
      return
    }
    const at = entry.epcs.indexOf(from)
    if (answer.skus.length === entry.epcs.length && answer.skus[at] !== wanted) {
      setProblem(
        `Di server toko …${read.epc.slice(-8)} adalah ${skuText(answer.skus[at])}, bukan ${skuText(
          wanted,
        )}. Perlu retur dan transaksi baru.`,
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
      setProblem("Artikel tag ini tidak diketahui, jadi tidak bisa diganti di sini.")
      return
    }
    setBusy(true)
    let read: Awaited<ReturnType<typeof readRfidPad>>
    try {
      read = await readRfidPad()
    } catch (error) {
      setBusy(false)
      setProblem(readerProblem(error))
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
        ? `${same.length} tag ${nameOf(wanted)} di pad. Sisakan hanya barang yang dibawa pelanggan.`
        : fresh.length > 0
          ? `Tidak ada tag ${nameOf(wanted)} di pad. Artikel lain tidak bisa ditukar di sini — perlu retur dan transaksi baru.`
          : "Tidak ada tag di pad yang belum ada di penjualan ini.",
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
      title: "Selesaikan penjualan yang ditolak",
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
      setProblem("Penjualan ini tidak lagi menunggu diselesaikan.")
      return
    }
    try {
      await flush()
    } finally {
      setBusy(false)
    }
    if (again.saleId !== null) {
      onDone(`Penjualan yang ditolak sudah terkirim dan tercatat — diselesaikan ${by.name}.`, false)
      return
    }
    if (again.refused) {
      // The node's new sentence is at the top; the plan starts again from the
      // sale as it now stands, its swaps included.
      setSwaps([])
      setReplacing(null)
      setProblem("Server toko menolaknya lagi.")
      void check(again.epcs)
      return
    }
    onDone(
      "Diselesaikan dan tersimpan di kasir ini — dikirim ke server toko begitu server menjawab.",
      true,
    )
  }

  return (
    <Sheet
      title="Selesaikan penjualan yang ditolak"
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
            Cek lagi
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={blocked !== null || busy || replacing !== null}
            onClick={send}
          >
            {busy ? "Mengirim…" : swaps.length > 0 ? "Ganti dan kirim" : "Kirim ulang"}
          </button>
        </>
      }
    >
      <div className="notice warn">
        {new Date(entry.takenAt).toLocaleString("id-ID")} ·{" "}
        <span className="num">{money(entry.quotedTotalMinor, currency)}</span>
        {entry.problem !== null && <> — kata server toko: {refusalWords(entry.problem)}</>}
      </div>
      {landed && (
        <p className="notice">
          Server toko sudah memegang kunci penjualan ini: pengiriman sebelumnya
          sudah sampai, dan tidak ada yang bisa dijual dua kali dengan kunci
          itu. Kirim ulang tanpa perubahan selama {entry.actorId} masuk, supaya
          server toko menjawab dengan yang dipegangnya. Kalau ditolak lagi,
          kantor pusat yang harus mencocokkannya di server toko.
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
                {why !== undefined && <p>{refusalWords(why)}</p>}
              </div>
              {swap !== undefined ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => undo(epc)}
                >
                  Urungkan
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
                  Ganti
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
            Tag asli {nameOf(skuOf(replacing))} untuk …{replacing.slice(-8)}
            <input
              ref={field}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={isWeb ? "Scan tagnya" : "Scan tagnya, atau baca di pad"}
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
                Baca pad
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
              Batal
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

/// Whether text that matched no item could be a voucher's code: six to thirty-
/// two letters and digits once the spaces and dashes a printed card is read
/// with are taken out (`normalize_code` in `backend/src/cloud/domain/voucher.rs`).
function looksLikeVoucher(text: string): boolean {
  if (!/^[A-Za-z0-9 _-]+$/.test(text)) return false
  const squeezed = text.replace(/[ _-]/g, "")
  return squeezed.length >= 6 && squeezed.length <= 32
}

/// "31 Dec 2026".
function shortDate(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
}

/// "GIFT_CARD" → "Gift card".
const VOUCHER_WORDS: Readonly<Record<string, string>> = {
  GIFT_CARD: "Gift card",
  REFUND: "Refund",
  GOODWILL: "Komplimen",
  SPENT: "Terpakai",
  VOIDED: "Void",
}

function wordsOf(code: string): string {
  const known = VOUCHER_WORDS[code.toUpperCase()]
  if (known !== undefined) return known
  const text = code.replace(/_/g, " ").toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/// One voucher as F2 shows it: what it is, what is left, until when, and — when
/// it cannot be spent — why not.
function VoucherCard({
  voucher,
  currency,
}: {
  voucher: api.VoucherCheck
  currency: string
}) {
  const live = voucher.status.toUpperCase() === "ACTIVE" && !voucher.expired
  const standing = voucher.expired
    ? "Kedaluwarsa"
    : voucher.status.toUpperCase() === "ACTIVE"
      ? null
      : wordsOf(voucher.status)
  return (
    <div className="pick-list">
      <div className="pick">
        <div className="grow">
          <strong>
            {wordsOf(voucher.kind)} · <span className="num">{voucher.code}</span>
          </strong>
          <small className="num">
            {voucher.expires_at === null
              ? "Tanpa batas waktu"
              : `${voucher.expired ? "Kedaluwarsa" : "Berlaku s.d."} ${shortDate(voucher.expires_at)}`}
            {voucher.member_name !== null && <> · {voucher.member_name}</>}
          </small>
        </div>
        {standing !== null && <span className="badge bad">{standing}</span>}
        <strong className="num" aria-label={live ? "Saldo" : "Saldo, tidak bisa dipakai"}>
          {money(voucher.balance_minor, currency)}
        </strong>
      </div>
    </div>
  )
}

