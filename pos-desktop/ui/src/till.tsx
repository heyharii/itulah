import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import * as api from "@/api"
import { publish } from "@/customer-link"
import { useApproval } from "@/approval"
import { device, inShell, openCustomerDisplay, readRfidSingle } from "@/edge"
import { isWeb } from "@/edition"
import { Icon, type IconName } from "@/icons"
import { useWaitingTills } from "@/joining"
import {
  BagPicker,
  CancelSale,
  HoldList,
  ReceiptPreview,
  Sheet,
} from "@/screens/dialogs"
import { useShortcuts } from "@/shortcuts"
import { enqueue, flush, forget, useOutbox } from "@/outbox"
import { drawerOnSale, printReceiptHere, receiptTarget } from "@/peripherals"
import { authorizeVoucher, releaseVoucher } from "@/vouchers"
import { seatNow, useSeat } from "@/seat"
import { lookupBenefit, returnBenefit, spendBenefit, type BenefitHolder } from "@/benefit"
import { useNodeConfig, useSession } from "@/session"
import { refreshPaymentMethods, usePaymentMethods } from "@/payment-methods"
import { readScan } from "@epc"
import { money } from "@itulah/contract/money"

/// The counter, and everywhere a cashier goes from it.
///
/// The shape is `prototypes/pos` — scanning and the board on the left, the
/// basket and the money on the right, payment as a page of its own rather than
/// a dialog, and a basket that counts tags instead of quantities.
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
}

const emptyQuote = (): Quote => ({
  totalMinor: null,
  stale: false,
  problem: null,
  discountTotalMinor: 0,
  pointsEarned: 0,
  promotions: [],
  grantedLines: [],
})

export type Sold = {
  readonly id: string
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
  readonly problem: string | null
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
    return "Kantor pusat tidak terjangkau — pakai metode pembayaran lain."
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
  onSignOut,
  onLock,
  onSeatLost,
}: {
  actorId: string
  terminalId: string
  where: Where
  onGo: (next: Where) => void
  onSignOut: () => void
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
  const [charges, setCharges] = useState<readonly api.Charge[]>([])
  // Panels that open *over* the counter rather than replacing it. Kept here and
  // not in `Where` because leaving them is always "back to this basket" — a
  // cashier who cancelled a bag picker has not gone anywhere.
  const [panel, setPanel] = useState<
    null | "cancel" | "hold" | "bags" | "rfid" | { readonly receipt: string }
  >(null)
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null)
  const [rfidBusy, setRfidBusy] = useState(false)
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

  // Load the resident book immediately so a basket can be drawn while the node
  // is busy. While a basket is open, the poll below refreshes this cached view
  // and asks the node for a fresh quote so a Cloud publication reaches an
  // already-open till without requiring the cashier to rescan an item.
  useEffect(() => {
    void (async () => {
      const reply = await api.catalogue()
      if (reply.ok) setRows(reply.body?.items ?? [])
      else setBookProblem(reply.problem)
    })()
  }, [])

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

  const booked = units.reduce((sum, unit) => sum + (unit.unitPriceMinor ?? 0), 0)
  const unpriced = units.some((unit) => unit.unitPriceMinor === null)
  const chargeTotal = charges.reduce((sum, charge) => sum + charge.amount_minor, 0)
  const total = quote.totalMinor ?? booked + chargeTotal
  const currency = rows[0]?.currency ?? "IDR"

  const askForQuote = useCallback(
    async (markStale: boolean) => {
      const request = ++quoteRequest.current
      if (markStale) setQuote((was) => ({ ...was, stale: true, problem: null }))
      const reply = await api.quote(
        units.map((unit) => unit.epc),
        coupons,
        customerId,
        charges,
      )
      if (request !== quoteRequest.current) return
      setQuote(
        reply.ok
          ? {
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
            }
          : {
              ...emptyQuote(),
              problem: reply.problem,
            },
      )
    },
    [units, coupons, customerId, charges],
  )

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
          const reply = await api.catalogue()
          if (reply.ok && reply.body?.has_price_book) {
            const nextRows = reply.body.items ?? []
            setRows((previous) => {
              const unchanged =
                previous.length === nextRows.length &&
                nextRows.every(
                  (row, index) =>
                    previous[index]?.sku_code === row.sku_code &&
                    previous[index]?.name === row.name &&
                    previous[index]?.unit_price_minor === row.unit_price_minor,
                )
              return unchanged ? previous : nextRows
            })
            const byCode = new Map(
              nextRows.map((row) => [row.sku_code, row] as const),
            )
            setUnits((previous) => {
              let changed = false
              const next = previous.map((unit) => {
                const row = byCode.get(unit.sku_code)
                if (
                  row === undefined ||
                  (row.name === unit.name &&
                    row.unit_price_minor === unit.unitPriceMinor)
                ) {
                  return unit
                }
                changed = true
                return {
                  ...unit,
                  name: row.name,
                  unitPriceMinor: row.unit_price_minor,
                }
              })
              return changed ? next : previous
            })
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
  }, [where, units.length, askForQuote])

  const onScan = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (text === "") return
      setCheck([])

      // A member card held up to the scanner. The member app prints `M1:` +
      // the card number as a Code 128 barcode (`frontend-customer/src/lib/
      // member-card.ts`), so a scan names the shopper instead of a garment —
      // no typing, and no typo crediting somebody else's card.
      const card = memberFromScan(text)
      if (card !== null) {
        setCustomerId(card)
        setNote({ bad: false, text: `Kartu member ${card} terbaca.` })
        return
      }

      const scanned = readScan(text)

      if (scanned.kind === "epc") {
        if (units.some((unit) => unit.epc === scanned.epc)) {
          setNote({
            bad: true,
            text: "Tag itu sudah ada di keranjang. Satu tag adalah satu barang.",
          })
          return
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
        return
      }

      if (scanned.kind === "sku") {
        const row = bySku.get(scanned.sku_code)
        if (row !== undefined) {
          setCheck([row])
          setNote(null)
          return
        }
      }

      const needle = text.toLowerCase()
      const found = rows.filter((row) => row.name.toLowerCase().includes(needle))
      if (found.length > 0) {
        setCheck(found.slice(0, 8))
        setNote(null)
        return
      }
      setNote({
        bad: true,
        text: `Tidak ada yang cocok dengan “${text}”. Pindai tag garmennya, atau ketik sebagian namanya.`,
      })
    },
    [bySku, rows, units],
  )

  const readWithR3 = useCallback(async () => {
    if (rfidBusy) return
    setRfidBusy(true)
    try {
      onScan(await readRfidSingle())
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setNote({ bad: true, text: `Chainway R3: ${detail}` })
    } finally {
      setRfidBusy(false)
      scan.current?.focus()
    }
  }, [onScan, rfidBusy])

  // Back to the scan field whenever the counter is at rest — including after a
  // panel over it closes, so the next tag lands in the basket.
  useEffect(() => {
    if (where === "sale" && sold === null && panel === null && !approval.open) {
      scan.current?.focus()
    }
  }, [where, sold, panel, approval.open])

  function clearBasket() {
    setUnits([])
    setCoupons([])
    setCustomerId(null)
    setCharges([])
    setPanel(null)
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
      F2: () => units.length > 0 && onGo("payment"),
      F3: () => onGo("return"),
      F4: () => setPanel("bags"),
      F6: () => setPanel("rfid"),
      F8: () => units.length > 0 && setPanel("cancel"),
      F9: () => setPanel("hold"),
      F10: () => units.length > 0 && onGo("payment"),
      F12: () => onGo("shift"),
      Escape: () => setPanel(null),
    },
    where === "sale" && sold === null && !approval.open,
  )

  if (sold !== null) {
    return (
      <Sale
        sold={sold}
        currency={currency}
        onNext={() => {
          setSold(null)
          clearBasket()
          onGo("sale")
        }}
      />
    )
  }

  if (where === "payment") {
    return (
      <Payment
        units={units}
        currency={currency}
        totalMinor={total}
        provisional={quote.totalMinor === null}
        basketHasPromotion={quote.promotions.some((one) => one.applied)}
        coupons={coupons}
        customerId={customerId}
        charges={charges}
        actorId={actorId}
        onBack={() => onGo("sale")}
        onSold={setSold}
        onSeatLost={onSeatLost}
      />
    )
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

  return (
    <div id="app" data-screen="sale">
      <Topbar
        terminalId={terminalId}
        actorId={actorId}
        unsent={outbox.unsent}
        waiting={waiting}
        onWaiting={() => onGo("joins")}
        onSignOut={onSignOut}
        onLock={onLock}
        onSetup={() => onGo("setup")}
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
            {outbox.refused} penjualan ditolak node — selesaikan sebelum tutup
            shift.
          </span>
        </div>
      )}
      {/* Each refusal with the node's own sentence and the one thing a cashier
          can do about it here: take it off this till once it has been dealt
          with. `forget` ignores anything that is not a refusal, so a sale the
          node has not answered can never be thrown away from this list. */}
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
              onClick={() => {
                if (
                  window.confirm(
                    "Buang penjualan yang ditolak ini dari terminal? Node tidak " +
                      "pernah mencatatnya, jadi tidak ada yang dibatalkan di sana.",
                  )
                ) {
                  forget(entry.localId)
                }
              }}
            >
              Buang
            </button>
          </div>
        ))}
      <main className="workspace">
        <section className="pane-left">
          <div className="block">
            <form
              className="scan-row"
              onSubmit={(event) => {
                event.preventDefault()
                const field = scan.current
                if (field === null) return
                onScan(field.value)
                field.value = ""
              }}
            >
              <div className="scan-field">
                <Icon name="scan" />
                <input
                  ref={scan}
                  autoFocus
                  autoComplete="off"
                  placeholder="Pindai tag atau cari barang"
                  aria-label="Pindai tag atau cari barang"
                />
                <button className="scan-go" type="submit" aria-label="Tambahkan">
                  <Icon name="arrow" />
                </button>
              </div>
              {/* The R3 is a USB reader bound in the shell — `readRfidSingle`
                  refuses outright with no bridge — so a browser tab never
                  draws a button that can only ever refuse. */}
              {!isWeb && (
                <button
                  className="scan-r3"
                  type="button"
                  onClick={() => void readWithR3()}
                  disabled={!inShell() || rfidBusy}
                  aria-label="Baca satu tag dengan Chainway R3"
                >
                  {rfidBusy ? "Membaca…" : "Baca R3"}
                </button>
              )}
            </form>
            {note !== null && (
              <div
                className={note.bad ? "notice warn" : "notice"}
                style={{ marginTop: 10 }}
                role="status"
              >
                {note.text}
              </div>
            )}
          </div>

          {check.length > 0 && (
            <div className="block">
              <div className="block-head">
                <span className="label">Cek harga</span>
                <button
                  className="icon-btn"
                  aria-label="Tutup cek harga"
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
                      <small className="num">{row.sku_code}</small>
                    </div>
                    <strong className="num">
                      {money(row.unit_price_minor, currency)}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Extras
            coupons={coupons}
            unappliedCoupons={unapplied}
            customerId={customerId}
            onCoupon={(code) =>
              setCoupons((was) =>
                was.includes(code) ? was : [...was, code],
              )
            }
            onDropCoupon={(code) =>
              setCoupons((was) => was.filter((one) => one !== code))
            }
            onCustomer={setCustomerId}
          />

          <div className="spacer" />
          <Board
            held={held.length}
            canHold={units.length > 0}
            onHold={() => {
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
            }}
            onResume={() => setPanel("hold")}
            onBags={() => setPanel("bags")}
            onRfid={() => setPanel("rfid")}
            onGo={onGo}
          />
        </section>

        <section className="pane-right">
          <div className="cart-head">
            <h2>
              Keranjang <span className="badge plain">{units.length} unit</span>
            </h2>
          </div>

          {units.length === 0 ? (
            <div className="empty">
              <Icon name="scan" />
              <h3>Siap untuk transaksi baru</h3>
              <p>Pindai tag pertama untuk memulai.</p>
            </div>
          ) : (
            <div className="cart-list no-bar">
              {units.map((unit) => (
                <div className="cart-row" key={unit.epc}>
                  <div className="cart-main">
                    <div className="cart-copy">
                      <div className="cart-meta">
                        <span className="num">{unit.sku_code}</span>
                        <span className="num">· …{unit.epc.slice(-8)}</span>
                        {unit.unitPriceMinor === null && (
                          <span className="flag manual">TANPA HARGA</span>
                        )}
                      </div>
                      <p>{unit.name ?? "Tidak ada di buku harga"}</p>
                    </div>
                    <span className="cart-total num">
                      {unit.unitPriceMinor === null
                        ? "—"
                        : money(unit.unitPriceMinor, currency)}
                    </span>
                    <button
                      className="icon-btn"
                      aria-label={`Lepas ${unit.name ?? unit.sku_code}`}
                      onClick={() =>
                        approval.ask({
                          action: "EDIT_CART",
                          title: "Hapus barang dari keranjang",
                          detail: `${unit.name ?? unit.sku_code} · …${unit.epc.slice(-8)}${
                            unit.unitPriceMinor === null
                              ? ""
                              : ` · ${money(unit.unitPriceMinor, currency)}`
                          }`,
                          epcs: [unit.epc],
                          amountMinor: unit.unitPriceMinor,
                          onApproved: () =>
                            setUnits((was) =>
                              was.filter((one) => one.epc !== unit.epc),
                            ),
                        })
                      }
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="totals">
            <div className="total-line">
              <span className="muted">Subtotal</span>
              <span className="num">{money(booked, currency)}</span>
            </div>
            {/* A bag is on the bill, not in the basket — so it is shown here,
                where the money is, and not among the tags. A fee the cashier
                cannot see is a fee they cannot take back off. */}
            {charges.map((charge, at) => (
              <div className="total-line" key={`${charge.code}-${at}`}>
                <span className="muted">
                  {charge.description}{" "}
                  <button
                    className="btn ghost"
                    style={{ minHeight: 20, padding: "0 6px", fontSize: 11 }}
                    onClick={() =>
                      setCharges((was) => was.filter((_, index) => index !== at))
                    }
                  >
                    lepas
                  </button>
                </span>
                <span className="num">
                  {money(charge.amount_minor, currency)}
                </span>
              </div>
            ))}
            {!quote.stale &&
              quote.promotions
                .filter((promotion) => promotion.applied)
                .map((promotion) => (
                  <div className="total-line cut" key={promotion.rule_id}>
                    <span>{promotion.name}</span>
                    <span className="num">
                      −{money(promotion.benefit_minor, currency)}
                    </span>
                  </div>
                ))}
            {!quote.stale &&
              quote.grantedLines.map((line, index) => (
                <div
                  className="total-line cut"
                  key={`${line.sku_code}-${index}`}
                >
                  <span>
                    Gratis · {bySku.get(line.sku_code)?.name ?? line.sku_code} ×{" "}
                    {line.quantity}
                  </span>
                  <span className="num">
                    {money(line.value_minor, currency)}
                  </span>
                </div>
              ))}
            {!quote.stale &&
              customerId !== null &&
              quote.pointsEarned > 0 && (
                <div className="total-line">
                  <span className="muted">Perkiraan poin</span>
                  <span className="num">+{quote.pointsEarned}</span>
                </div>
              )}
            <div className="grand">
              <span>TOTAL</span>
              <strong className="num">{money(total, currency)}</strong>
            </div>
            {(quote.problem !== null ||
              unpriced ||
              (units.length > 0 && quote.totalMinor === null)) && (
              <div className="total-line">
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {quote.problem ??
                    (quote.stale ? "Menghitung…" : "Sementara — node belum menjawab")}
                </span>
                {unpriced && <span className="badge warn">Ada unit tanpa harga</span>}
              </div>
            )}
          </div>

          {units.length > 0 && (
            <div className="action-bar">
              <button
                className="btn"
                onClick={() => setPanel("cancel")}
                aria-keyshortcuts="F8"
              >
                <Icon name="x" />
                Batal <kbd aria-hidden="true">F8</kbd>
              </button>
              <button
                className="pay"
                onClick={() => onGo("payment")}
                aria-keyshortcuts="F10"
              >
                <span>
                  <Icon name="cash" />
                  Bayar {money(total, currency)}
                </span>
                <kbd aria-hidden="true">F10</kbd>
              </button>
            </div>
          )}
        </section>
      </main>
      <Statusbar unsent={outbox.unsent} refused={outbox.refused} />

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
              detail: `${units.length} unit · ${money(total, currency)}`,
              reason,
              epcs: units.map((unit) => unit.epc),
              amountMinor: total,
              onApproved: (by) => {
                // The reason is written on the node with the approval
                // (`till_approval.reason`), beside the supervisor who agreed.
                setNote({
                  bad: false,
                  text: `Transaksi dibatalkan — ${reason} · disetujui ${by.username}`,
                })
                clearBasket()
              },
            })
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
              title: "Buang transaksi ditahan",
              detail: `${found.units.length} unit · ditahan ${found.at}`,
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
                    ? `Semua ${skipped} tag sesi itu sudah ada di keranjang.`
                    : "Sesi itu tidak memuat satu tag pun.",
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
                `Ditarik ${fresh.length} tag ke keranjang` +
                (skipped > 0 ? `, ${skipped} dilewati karena sudah ada` : "") +
                (truncated
                  ? ". Sesi itu memuat lebih dari 2000 tag — hanya 2000 pertama yang diambil node"
                  : "") +
                ".",
            })
          }}
        />
      )}

      {panel === "bags" && (
        <BagPicker
          currency={currency}
          onBack={() => setPanel(null)}
          onAdd={(charge) => {
            setCharges((was) => [...was, charge])
            setPanel(null)
          }}
        />
      )}

      {panel !== null && typeof panel === "object" && (
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

export function Topbar({
  terminalId,
  actorId,
  unsent,
  waiting,
  onWaiting,
  onSignOut,
  onLock,
  onSetup,
  onDisplay,
}: {
  terminalId?: string
  actorId?: string
  unsent?: number
  /// Tills waiting for a supervisor at this node. Shown only when some are.
  waiting?: number | null
  onWaiting?: () => void
  onSignOut?: () => void
  onLock?: () => void
  onSetup?: () => void
  onDisplay?: () => void
}) {
  // Every screen wears the same header, so the terminal and the person are read
  // from the one session rather than handed down by whoever drew it.
  const session = useSession()
  const seat = useSeat()
  const terminal = terminalId ?? session.terminalId
  const who =
    actorId ?? session.me?.display_name ?? session.me?.username ?? null
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
            title="Buka Kasir menunggu untuk mencocokkan kode dan menyetujui"
          >
            <Icon name="plug" />
            <span className="badge warn">
              {waiting} kasir menunggu persetujuan
            </span>
          </button>
        )}
        {unsent !== undefined && unsent > 0 && (
          <span className="badge warn">{unsent} belum terkirim</span>
        )}
        {onDisplay !== undefined && (
          <button className="top-tool" onClick={onDisplay}>
            <Icon name="monitor" />
            Layar pelanggan
          </button>
        )}
        {onSetup !== undefined && (
          <button className="top-tool" onClick={onSetup}>
            <Icon name="settings" />
            Setelan
          </button>
        )}
        {onLock !== undefined && (
          <button className="top-tool" onClick={onLock}>
            <Icon name="lock" />
            Kunci
          </button>
        )}
        {(onDisplay !== undefined || onSetup !== undefined || onLock !== undefined) && (
          <span className="top-sep" />
        )}
        {/* Web has no shell to ask, so `inShell()` never returns true there —
            but it still knows its own terminal id (`web.ts` mints one), and
            "Browser" would say less than that. A small marker beside it says
            which edition this tab is, since the two look identical
            otherwise. */}
        {/* The till is the seat the person holds, not the machine: "Kasir 3",
            with the machine kept beside it (web) or as the hover text
            (desktop) for whoever has to find which box it is. */}
        {isWeb ? (
          <>
            {seat !== null && <span className="badge plain">{seat.label}</span>}
            <span
              className="badge plain"
              style={seat !== null ? { marginLeft: 6 } : undefined}
            >
              {terminal}
            </span>
            <span className="badge plain" style={{ marginLeft: 6 }}>
              Web
            </span>
          </>
        ) : (
          <span className="badge plain" title={seat !== null ? terminal : undefined}>
            {seat !== null ? seat.label : inShell() ? terminal : "Browser"}
          </span>
        )}
        {who !== null && (
          <span className="avatar" title={who}>
            {who.slice(0, 2).toUpperCase()}
          </span>
        )}
        {onSignOut !== undefined && (
          <button
            className="icon-btn"
            onClick={onSignOut}
            aria-label="Keluar"
            title="Keluar"
          >
            <Icon name="logout" />
          </button>
        )}
      </div>
    </header>
  )
}

/// The mark in the corner of every screen, and on the sign-in card.
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">c.</span>central{" "}
      <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
        kasir
      </span>
    </span>
  )
}

/// A coupon is a code the shopper produced, and a member is a number copied
/// from a card. Neither is priced here — both are handed to the node with the
/// quote and again with the sale, because the engine that grants a discount is
/// the one that has to see the code.
function Extras({
  coupons,
  unappliedCoupons,
  customerId,
  onCoupon,
  onDropCoupon,
  onCustomer,
}: {
  coupons: readonly string[]
  unappliedCoupons: readonly string[]
  customerId: string | null
  onCoupon: (code: string) => void
  onDropCoupon: (code: string) => void
  onCustomer: (id: string | null) => void
}) {
  const [typed, setTyped] = useState("")
  return (
    <div className="block">
      <div className="block-head">
        <span className="label">Kupon &amp; member</span>
      </div>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          const code = typed.trim().toUpperCase()
          if (code === "") return
          onCoupon(code)
          setTyped("")
        }}
      >
        <div className="field-wrap">
          <Icon name="tag" />
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Kode kupon"
            autoComplete="off"
            aria-label="Kode kupon"
          />
        </div>
        <button className="btn" type="submit">
          Pakai
        </button>
      </form>
      {coupons.length > 0 && (
        <div className="chips">
          {coupons.map((code) => (
            <button
              key={code}
              className="chip on"
              onClick={() => onDropCoupon(code)}
              aria-label={`Lepas kupon ${code}`}
            >
              {code}
              <Icon name="x" />
            </button>
          ))}
        </div>
      )}
      {unappliedCoupons.length > 0 && (
        <div className="notice warn" role="status" style={{ marginTop: 8 }}>
          {unappliedCoupons.join(", ")} belum memberi potongan.
        </div>
      )}
      {/* Written onto the sale exactly as typed. This node cannot check it —
          the member directory is central and this terminal addresses only its
          own shop, which is what keeps the till selling when the line to head
          office is down. */}
      <div className="inline-form" style={{ marginTop: 8 }}>
        <div className="field-wrap">
          <Icon name="user" />
          <input
            value={customerId ?? ""}
            onChange={(event) =>
              onCustomer(
                event.target.value.trim() === ""
                  ? null
                  : (memberFromScan(event.target.value) ?? event.target.value),
              )
            }
            placeholder="Nomor member"
            autoComplete="off"
            aria-label="Nomor member"
            maxLength={64}
          />
        </div>
      </div>
    </div>
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
      setProblem("Sesi itu tidak memuat satu tag pun.")
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
          <h3>Belum ada sesi pindai</h3>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <div className="rows">
          {items.map((one) => (
            <div className="row-item" key={one.reader_session_id}>
              <div className="grow">
                <h3>
                  {one.tag_count} tag · {one.device_count} pemindai
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
                {busy === one.reader_session_id ? "Menarik…" : "Tarik"}
              </button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}

/// The board: what a cashier does mid-sale, and what they do twice a day.
///
/// It never moves and never scrolls. At four in the afternoon the interface is
/// muscle memory, and a key that shifted position is a key that has to be read
/// again every time — so it is two fixed rows of four, the sale's own tools
/// above and the counter's below, each with the F-key it answers to.
function Board({
  held,
  canHold,
  onHold,
  onResume,
  onBags,
  onRfid,
  onGo,
}: {
  held: number
  canHold: boolean
  onHold: () => void
  onResume: () => void
  onBags: () => void
  onRfid: () => void
  onGo: (next: Where) => void
}) {
  const tile = (
    icon: IconName,
    label: string,
    onClick: () => void,
    extra?: { key?: string; disabled?: boolean; count?: number },
  ) => (
    <button
      className="util"
      onClick={onClick}
      disabled={extra?.disabled}
      aria-keyshortcuts={extra?.key}
    >
      {extra?.key !== undefined && <kbd aria-hidden="true">{extra.key}</kbd>}
      <Icon name={icon} />
      {label}
      {extra?.count !== undefined && extra.count > 0 && (
        <span className="count">{extra.count}</span>
      )}
    </button>
  )
  return (
    <div className="utility">
      <div className="utility-row">
        {tile("hold", "Tahan", onHold, { disabled: !canHold })}
        {tile("list", "Ditahan", onResume, { key: "F9", disabled: held === 0, count: held })}
        {tile("bag", "Kantong", onBags, { key: "F4" })}
        {tile("rfid", "Dari handheld", onRfid, { key: "F6" })}
      </div>
      <div className="utility-row">
        {tile("return", "Retur", () => onGo("return"), { key: "F3" })}
        {tile("void", "Void", () => onGo("void"))}
        {tile("star", "Tukar poin", () => onGo("redeem"))}
        {tile("wallet", "Shift & kas", () => onGo("shift"), { key: "F12" })}
      </div>
    </div>
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
        { what: "Sidik jari", on: fp.bound, detail: fp.detail },
      ])
    })()
    return () => {
      alive = false
    }
  }, [])

  const sync =
    refused !== undefined && refused > 0
      ? { tone: "warn", text: `${refused} penjualan ditolak node` }
      : unsent !== undefined && unsent > 0
        ? { tone: "warn", text: `${unsent} penjualan menunggu terkirim` }
        : unsent !== undefined
          ? { tone: "on", text: "Semua penjualan terkirim" }
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

/// Taking the money — a page, not a dialog.
///
/// The rail is on the right: the same column the basket keeps its money in, so
/// the figure a cashier watches does not move across the screen when payment
/// starts. And it carries the basket, because this screen replaced the one that
/// had it, and "what am I taking money for" must not cost a cancelled payment.
function Payment({
  units,
  currency,
  totalMinor,
  provisional,
  basketHasPromotion,
  coupons,
  customerId,
  charges,
  actorId,
  onBack,
  onSold,
  onSeatLost,
}: {
  units: readonly Unit[]
  currency: string
  totalMinor: number
  provisional: boolean
  /// Whether the quote applied any promotion. An employee balance cannot be
  /// spent on such a basket, and the node refuses it too.
  basketHasPromotion: boolean
  coupons: readonly string[]
  customerId: string | null
  charges: readonly api.Charge[]
  actorId: string
  onBack: () => void
  onSold: (sale: Sold) => void
  onSeatLost: (by: string | null) => void
}) {
  const tiles = usePaymentMethods()
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
    setBusy(true)
    setProblem(null)
    // The node attaches a sale to the shift of whoever rings it, so a person
    // whose seat was taken since the last poll would be ringing money into
    // nobody's drawer. Asked once more right before the money is recorded. A
    // node that cannot answer does not stop the sale — the outbox is for that.
    const seat = seatNow()
    if (seat !== null) {
      const mine = await api.myShifts()
      if (
        mine.ok &&
        (mine.body.open === null || mine.body.open.shift_id !== seat.shift_id)
      ) {
        setBusy(false)
        // Back out the way a cashier would, so a voucher hold taken for this
        // basket is given back, then let the counter know.
        await leavePayment()
        onSeatLost(
          mine.body.uncounted.find((one) => one.shift_id === seat.shift_id)
            ?.taken_over_by ?? null,
        )
        return
      }
    }
    // Written to disk, with its key, before a single byte goes on the wire.
    // Everything after this line is the outbox's problem — including the case
    // where this terminal never manages to send it at all.
    const entry = enqueue({
      epcs: units.map((unit) => unit.epc),
      tenders: taken.map((one) => ({
        method: one.method,
        amount_minor: one.amountMinor,
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
      customer_id: customerId,
      charges,
      quotedTotalMinor: totalMinor,
    })
    const outcome = await flush()
    setBusy(false)
    // The entry is updated in place by the outbox, so by here it carries its
    // own outcome — including the node's sale id, which is what a receipt can
    // be printed against and a local id never could be.
    const accepted = outcome.sent.includes(entry.localId)
    onSold({
      id: entry.saleId ?? entry.localId,
      saleId: entry.saleId,
      totalMinor,
      changeMinor: change,
      accepted,
      problem: accepted ? null : outcome.problem,
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
          returnBenefit(one.reference as string, one.amountMinor, "dibatalkan di kasir").catch(
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
          "kasir kembali ke keranjang",
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
      setProblem("Kode saldo karyawan terdiri dari 6 angka.")
      return
    }
    setBusy(true)
    setProblem(null)
    const reply = await lookupBenefit(code)
    setBusy(false)
    if (!reply.ok || reply.body === undefined || reply.body === null) {
      setProblem(benefitRefusal(reply, "Kode tidak dikenali."))
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
    if (basketHasPromotion) {
      setProblem("Saldo karyawan tidak berlaku bersama promo.")
      return
    }
    const amount = Math.min(entered > 0 ? entered : outstanding, outstanding, holder.balance_minor)
    if (amount <= 0) {
      setProblem("Tidak ada saldo yang bisa dipakai.")
      return
    }
    setBusy(true)
    setProblem(null)
    const ref = saleRef.current
    const reply = await spendBenefit(benefitCode.replace(/\D/g, ""), ref, amount, basketHasPromotion)
    setBusy(false)
    if (!reply.ok) {
      setProblem(benefitRefusal(reply, "Saldo tidak bisa dipakai."))
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
    const reply = await returnBenefit(one.reference, one.amountMinor, "dibatalkan di kasir")
    setBusy(false)
    if (!reply.ok) {
      setProblem(benefitRefusal(reply, "Saldo belum bisa dikembalikan."))
      return
    }
    saleRef.current = newCheckoutId()
    setTaken((was) => was.filter((_, index) => index !== at))
  }

  async function takeIt() {
    if (isBenefit) {
      await takeBenefit()
      return
    }
    if (needsBank && choice === null) {
      setProblem("Pilih banknya.")
      return
    }
    if (needsReference && reference.trim().length < 4) {
      setProblem(
        method === "VOUCHER"
          ? "Masukkan kode voucher."
          : "Masukkan kode approval, minimal 4 karakter.",
      )
      return
    }
    if (needsReference && looksLikeACard) {
      setProblem("Itu seperti nomor kartu. Tulis kode approval-nya saja.")
      return
    }
    if (method !== "CASH" && offered > outstanding) {
      setProblem(
        "Hanya tunai yang boleh melebihi sisa — kembalian keluar dari laci, bukan dari kartu.",
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
            `Voucher ${code} tidak bisa ditahan di pusat — periksa kodenya, lalu pastikan sambungan ke kantor pusat hidup.`,
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

  return (
    <div id="app" data-screen="payment">
      <Topbar actorId={actorId} />
      <main className="pay-page">
        <section className="pay-main">
          <div className="pay-main-inner">
            {settled ? (
              <div className="pay-done">
                <span className="seal">
                  <Icon name="check" />
                </span>
                <h3>Lunas</h3>
                <p>
                  {change > 0
                    ? <>Kembalian <strong className="num">{money(change, currency)}</strong></>
                    : "Tanpa kembalian"}
                </p>
              </div>
            ) : (
              <>
                <div>
                  <span className="label">Metode pembayaran</span>
                  <div className="method-grid" style={{ marginTop: 8 }}>
                    {tiles.map((one) => (
                      <button
                        key={one.key}
                        className="method"
                        aria-pressed={chosen.key === one.key}
                        disabled={
                          one.wire === "BENEFIT" &&
                          (basketHasPromotion || benefitTaken)
                        }
                        onClick={() => {
                          setPicked(one.key)
                          setBank(null)
                          setProblem(null)
                        }}
                      >
                        <Icon name={one.icon} />
                        {one.label}
                        {one.wire === "BENEFIT" && basketHasPromotion && (
                          <small className="muted"> Tidak berlaku dengan promo</small>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {needsBank && (
                  <div role="radiogroup" aria-label="Bank">
                    <span className="label">Bank / mesin EDC</span>
                    <div className="bank-grid" style={{ marginTop: 8 }}>
                      {chosen.choices.map((one) => (
                        <button
                          key={one.code ?? one.label}
                          type="button"
                          role="radio"
                          aria-checked={choice === one}
                          onClick={() => {
                            setBank(one.label)
                            setProblem(null)
                          }}
                        >
                          {one.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isBenefit && (
                  <>
                    <label className="field">
                      Kode saldo karyawan
                      <input
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
                        placeholder="6 angka dari ponsel karyawan"
                        autoFocus
                      />
                    </label>
                    {holder !== null && (
                      <div className="kv">
                        <span>{holder.full_name ?? holder.employee_code}</span>
                        <strong className="num">
                          {money(holder.balance_minor, currency)}
                        </strong>
                      </div>
                    )}
                  </>
                )}

                {needsReference && (
                  <label className="field">
                    {method === "VOUCHER"
                      ? "Kode voucher"
                      : method === "QRIS"
                        ? "Nomor referensi QRIS"
                        : method === "EWALLET"
                          ? "Nomor referensi e-wallet"
                          : "Kode approval EDC"}
                    <input
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      onKeyDown={onFieldKey}
                      autoComplete="off"
                    />
                  </label>
                )}

                <div>
                  <span className="label">Nominal</span>
                  <div className="amount-field" style={{ marginTop: 8 }}>
                    <span className="rp">Rp</span>
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
                      aria-label="Nominal pembayaran"
                      autoFocus={!isBenefit}
                    />
                  </div>
                </div>

                {method === "CASH" && (
                  <div className="numpad">
                    {["7","8","9","4","5","6","1","2","3","⌫","0","000"].map(
                      (key) => (
                        <button
                          key={key}
                          className={key === "⌫" ? "del" : undefined}
                          aria-label={key === "⌫" ? "Hapus satu angka" : undefined}
                          onClick={() =>
                            setTyped((was) =>
                              key === "⌫"
                                ? was.slice(0, -1)
                                : String(Number(was + key) || ""),
                            )
                          }
                        >
                          {key}
                        </button>
                      ),
                    )}
                  </div>
                )}

                {presets.length > 0 && (
                  <div className="presets">
                    {presets.map((value) => (
                      <button
                        key={value}
                        className={String(value) === typed ? "on" : undefined}
                        onClick={() => setTyped(String(value))}
                      >
                        {money(value, currency)}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {problem !== null && <p className="error">{problem}</p>}

            <div className="pay-cta">
              <button
                className="btn primary"
                disabled={busy || (!settled && offered <= 0)}
                onClick={() => (settled ? void complete() : takeIt())}
              >
                <Icon name={settled ? "check" : "wallet"} />
                {settled
                  ? busy
                    ? "Membukukan…"
                    : "Selesaikan transaksi"
                  : isBenefit
                    ? holder === null
                      ? "Cek saldo"
                      : `Pakai saldo ${money(
                          Math.min(
                            entered > 0 ? entered : outstanding,
                            outstanding,
                            holder.balance_minor,
                          ),
                          currency,
                        )}`
                  : `${partial ? "Bayar sebagian" : "Bayar"} ${money(
                      partial ? entered : offered,
                      currency,
                    )}${
                      // The EDC the cashier said they will swipe, named on the
                      // button they press — the last look before the wrong
                      // terminal gets used.
                      needsBank && bank !== null ? ` · ${chosen.label} ${bank}` : ""
                    }`}
                <kbd aria-hidden="true">Enter</kbd>
              </button>
            </div>
          </div>
        </section>

        <aside className="pay-side">
          <button className="pay-back" onClick={() => void leavePayment()}>
            <Icon name="back" />
            Kembali ke keranjang
            <kbd aria-hidden="true">Esc</kbd>
          </button>
          <div className="pay-summary">
            <div className="total-line">
              <span className="muted">Item</span>
              <span>{units.length} unit</span>
            </div>
            <div className="grand" style={{ marginTop: 4 }}>
              <span>TOTAL</span>
              <strong className="num">{money(totalMinor, currency)}</strong>
            </div>
            {provisional && (
              <div className="total-line">
                <span className="badge warn">Sementara</span>
              </div>
            )}
          </div>

          <div className="pay-scroll no-bar">
            <span className="label">Barang</span>
            <div className="pay-items">
              {units.map((unit) => (
                <div className="pay-item" key={unit.epc}>
                  <span>{unit.name ?? unit.sku_code}</span>
                  <span className="num">
                    {unit.unitPriceMinor === null
                      ? "—"
                      : money(unit.unitPriceMinor, currency)}
                  </span>
                </div>
              ))}
            </div>

            {coupons.length > 0 && (
              <>
                <span className="label" style={{ marginTop: 4 }}>
                  Kupon
                </span>
                <div className="chips">
                  {coupons.map((code) => (
                    <span className="chip" key={code}>
                      {code}
                    </span>
                  ))}
                </div>
              </>
            )}

            {taken.length > 0 && (
              <>
                <span className="label" style={{ marginTop: 4 }}>
                  Diterima
                </span>
                {taken.map((one, at) => (
                  <div className="recorded" key={at}>
                    <span>
                      <Icon name="check" />
                      {one.label}
                      {one.shown !== null && (
                        <small className="muted"> {one.shown}</small>
                      )}
                    </span>
                    <strong className="num">
                      {money(one.amountMinor, currency)}
                    </strong>
                    {one.method === "BENEFIT" && (
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => void removeBenefit(at)}
                      >
                        Batalkan
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}

          </div>

          <div className={settled ? "pay-due settled" : "pay-due"}>
            {settled ? (
              <>
                <div className="due-line change">
                  <span>Kembalian</span>
                  <strong className="num">{money(change, currency)}</strong>
                </div>
                {change > 0 && (
                  <div className="denoms">
                    <span className="label">Kembalikan</span>
                    {countOut(change).map(([many, denomination]) => (
                      <div className="denom" key={denomination}>
                        <span>
                          {many}× {money(denomination, currency)}
                        </span>
                        <span className="num">
                          {money(many * denomination, currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="due-line rest">
                <span>Sisa</span>
                <strong className="num">{money(outstanding, currency)}</strong>
              </div>
            )}
          </div>
        </aside>
      </main>
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
  onNext: () => void
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
      const done = copy ? "Salinan struk dicetak." : "Struk dicetak."
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

  return (
    <div id="app" data-screen="sale">
      <Topbar />
      <div className="overlay">
        <div
          className="overlay-card"
          role="dialog"
          aria-modal="true"
          aria-label={sold.accepted ? "Transaksi selesai" : "Tersimpan di terminal"}
        >
          <span className={sold.accepted ? "seal" : "seal warn"}>
            <Icon name={sold.accepted ? "check" : "clock"} />
          </span>
          <h3>{sold.accepted ? "Transaksi selesai" : "Tersimpan di terminal"}</h3>
          <p className="overlay-total num">{money(sold.totalMinor, currency)}</p>
          {sold.changeMinor > 0 && (
            <div className="overlay-change">
              <small>Kembalian</small>
              <strong className="num">
                {money(sold.changeMinor, currency)}
              </strong>
            </div>
          )}
          {!sold.accepted && (
            <div className="notice warn" style={{ width: "100%" }}>
              Menunggu terkirim ke node — dikirim ulang otomatis.
              {sold.problem !== null && <> {sold.problem}</>}
            </div>
          )}
          <p className="muted num" style={{ fontSize: 11.5 }}>
            {sold.id}
          </p>
          {printer === null && here === null ? (
            noPrint !== null && (
              <p className="muted" style={{ fontSize: 11.5 }}>
                {noPrint}
              </p>
            )
          ) : (
            <>
              {printed !== null && (
                <p className="muted" style={{ fontSize: 11.5 }}>
                  {printed}
                </p>
              )}
              <button
                className="btn"
                style={{ width: "100%" }}
                disabled={sold.saleId === null}
                onClick={() => void print(true)}
              >
                <Icon name="print" />
                Cetak ulang
              </button>
            </>
          )}
          <button
            className="btn primary"
            style={{ width: "100%" }}
            onClick={onNext}
            autoFocus
          >
            Transaksi berikutnya
          </button>
        </div>
      </div>
    </div>
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
