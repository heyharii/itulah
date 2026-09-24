import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import * as api from "@/api"
import { publish } from "@/customer-link"
import { device, inShell, openCustomerDisplay, readRfidSingle } from "@/edge"
import {
  BagPicker,
  CancelSale,
  HoldList,
  ReceiptPreview,
} from "@/screens/dialogs"
import { useShortcuts } from "@/shortcuts"
import { enqueue, flush, useOutbox } from "@/outbox"
import { authorizeVoucher, releaseVoucher } from "@/vouchers"
import { useNodeConfig } from "@/session"
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

const METHODS = [
  { value: "CASH", label: "Tunai" },
  { value: "CARD", label: "Kartu" },
  { value: "QRIS", label: "QRIS" },
  { value: "VOUCHER", label: "Voucher" },
] as const

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

export function Till({
  actorId,
  terminalId,
  where,
  onGo,
  onSignOut,
}: {
  actorId: string
  terminalId: string
  where: Where
  onGo: (next: Where) => void
  onSignOut: () => void
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
    async (raw: string) => {
      const text = raw.trim()
      if (text === "") return
      setCheck([])
      let scanned = readScan(text)

      // Some readers emit a pre-encoded EPC whose SKU is not in our private
      // A0 format. Ask this shop's own Edge to price the known EPC; the quote
      // is read-only and resolves the SKU from the local unit record, so this
      // still works when the Cloud link is down.
      if (scanned.kind === "unknown" && /^[0-9a-fA-F]{24}$/.test(text)) {
        const resolved = await api.quote([text])
        const skuCode = resolved.ok
          ? resolved.body?.lines?.[0]?.sku_code
          : undefined
        if (skuCode !== undefined && bySku.has(skuCode)) {
          scanned = { kind: "epc", epc: text.toUpperCase(), sku_code: skuCode }
        }
      }

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
      await onScan(await readRfidSingle())
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setNote({ bad: true, text: `Chainway R3: ${detail}` })
    } finally {
      setRfidBusy(false)
      scan.current?.focus()
    }
  }, [onScan, rfidBusy])

  useEffect(() => {
    if (where === "sale" && sold === null) scan.current?.focus()
  }, [where, sold])

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
    {
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
    where === "sale" && sold === null,
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
        coupons={coupons}
        customerId={customerId}
        charges={charges}
        actorId={actorId}
        onBack={() => onGo("sale")}
        onSold={setSold}
      />
    )
  }

  return (
    <div id="app" data-screen="sale">
      <Topbar
        terminalId={terminalId}
        actorId={actorId}
        unsent={outbox.unsent}
        onSignOut={onSignOut}
      />
      {bookProblem !== null && (
        <div className="banner bad">
          <span className="grow">{bookProblem}</span>
        </div>
      )}
      {outbox.refused > 0 && (
        <div className="banner warn">
          <span className="grow">
            {outbox.refused} penjualan ditolak node dan masih tersimpan di
            terminal ini. Selesaikan sebelum tutup shift.
          </span>
        </div>
      )}
      <main className="workspace">
        <section className="pane-left">
          <div className="block">
            <form
              className="scan-row"
              onSubmit={(event) => {
                event.preventDefault()
                const field = scan.current
                if (field === null) return
                void onScan(field.value)
                field.value = ""
              }}
            >
              <div className="scan-field">
                <input
                  ref={scan}
                  autoFocus
                  autoComplete="off"
                  placeholder="Pindai tag RFID, atau ketik nama / barcode…"
                  aria-label="Pindai tag atau cari barang"
                />
                <button className="scan-go" type="submit" aria-label="Tambahkan">
                  →
                </button>
              </div>
              <button
                className="scan-r3"
                type="button"
                onClick={() => void readWithR3()}
                disabled={!inShell() || rfidBusy}
                aria-label="Baca satu tag dengan Chainway R3 tanpa bunyi"
                title="Baca satu tag; buzzer R3 diverifikasi mati sebelum pembacaan"
              >
                {rfidBusy ? "Membaca…" : "Baca R3"}
              </button>
            </form>
            <p className="scan-tip">
              Pindai lewat keyboard atau tekan Baca R3 untuk membaca satu tag
              tanpa bunyi. Barcode dan nama hanya mencari produk; satu barang
              yang terjual tetap harus punya EPC sendiri.
            </p>
          </div>

          {note !== null && (
            <div className="block">
              <div className={note.bad ? "notice warn" : "notice"}>
                {note.text}
              </div>
            </div>
          )}

          {check.length > 0 && (
            <div className="block">
              <div className="block-head">
                <span className="label">Cek harga</span>
                <button className="btn ghost" onClick={() => setCheck([])}>
                  Tutup
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
            unappliedCoupons={
              quote.stale
                ? []
                : coupons.filter(
                    (code) =>
                      !quote.promotions.some(
                        (promotion) =>
                          promotion.applied &&
                          promotion.coupon_code?.toUpperCase() === code,
                      ),
                  )
            }
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
            held={held}
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
            {units.length > 0 && (
              <button
                className="btn ghost"
                onClick={clearBasket}
                style={{ minHeight: 28, padding: "0 8px", fontSize: 11 }}
              >
                Kosongkan
              </button>
            )}
          </div>

          {units.length === 0 ? (
            <div className="empty">
              <h3>Belum ada barang di konter</h3>
              <p>
                Pindai tag pertama untuk memulai. Setiap tag yang terbaca menjadi
                satu unit.
              </p>
            </div>
          ) : (
            <div className="cart-list no-bar">
              {units.map((unit) => (
                <div className="cart-row" key={unit.epc}>
                  <div className="cart-main">
                    <div className="cart-copy">
                      <div className="cart-meta">
                        <span className="num">{unit.sku_code}</span>
                        {unit.unitPriceMinor === null && (
                          <span className="flag manual">TANPA HARGA</span>
                        )}
                      </div>
                      <p>{unit.name ?? "Tidak ada di buku harga toko ini"}</p>
                      <small className="num">…{unit.epc.slice(-8)}</small>
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
                        setUnits((was) =>
                          was.filter((one) => one.epc !== unit.epc),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="totals">
            <div className="total-line">
              <span className="muted">Dari buku harga toko</span>
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
                  <div className="total-line" key={promotion.rule_id}>
                    <span className="muted">{promotion.name}</span>
                    <span className="num">
                      −{money(promotion.benefit_minor, currency)}
                    </span>
                  </div>
                ))}
            {!quote.stale &&
              quote.grantedLines.map((line, index) => (
                <div
                  className="total-line"
                  key={`${line.sku_code}-${index}`}
                >
                  <span className="muted">
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
                  <span className="muted">
                    Perkiraan poin · masuk setelah Cloud menerima penjualan
                  </span>
                  <span className="num">+{quote.pointsEarned}</span>
                </div>
              )}
            <div className="grand">
              <span>TOTAL</span>
              <strong className="num">{money(total, currency)}</strong>
            </div>
            <div className="total-line">
              <span className="muted" style={{ fontSize: 11.5 }}>
                {quote.problem !== null
                  ? quote.problem
                  : quote.stale
                    ? "Menanyakan harga ke node…"
                    : quote.totalMinor !== null
                      ? "Dihitung node, promo dan kupon ikut"
                      : units.length === 0
                        ? "Belum ada yang dihitung"
                        : "Sementara — node belum menjawab"}
              </span>
              {unpriced && <span className="badge warn">Ada unit tanpa harga</span>}
            </div>
          </div>

          {units.length > 0 && (
            <div className="action-bar">
              <button className="btn" onClick={clearBasket}>
                Batal
              </button>
              <button className="pay" onClick={() => onGo("payment")}>
                <span>Bayar {money(total, currency)}</span>
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
            // The reason is shown and then dropped: `POST /store/checkouts/resolve`
            // would carry it to the node, but nothing in `api.ts` names that
            // route yet, and a screen that implied head office had been told
            // would be lying about where the reason went.
            setNote({ bad: false, text: `Transaksi dibatalkan — ${reason}` })
            clearBasket()
          }}
        />
      )}

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
          onDrop={(id) => setHeld((was) => was.filter((one) => one.id !== id))}
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
  onSignOut,
}: {
  terminalId?: string
  actorId?: string
  unsent?: number
  onSignOut?: () => void
}) {
  return (
    <header className="topbar">
      <span className="brand">
        <span className="brand-mark">i.</span>itulah{" "}
        <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
          kasir
        </span>
      </span>
      <div className="top-right">
        {unsent !== undefined && unsent > 0 && (
          <span className="badge warn">{unsent} belum terkirim</span>
        )}
        <span className="badge plain">
          {inShell() ? (terminalId ?? "Terminal") : "Browser — perangkat tidak terjangkau"}
        </span>
        {onSignOut !== undefined && (
          <button className="btn ghost" onClick={onSignOut}>
            Keluar
          </button>
        )}
        <span className="avatar">
          {(actorId ?? "??").slice(0, 2).toUpperCase()}
        </span>
      </div>
    </header>
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
          <input
            className="plain"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Kode kupon…"
            autoComplete="off"
            aria-label="Kode kupon"
          />
        </div>
        <button className="btn" type="submit">
          Tambah
        </button>
      </form>
      {coupons.length > 0 && (
        <div className="chips">
          {coupons.map((code) => (
            <button
              key={code}
              className="chip on"
              onClick={() => onDropCoupon(code)}
            >
              {code} ×
            </button>
          ))}
        </div>
      )}
      {unappliedCoupons.length > 0 && (
        <div className="notice warn" role="status">
          {unappliedCoupons.map((code) => "Kupon " + code).join(", ")}
          {" belum memberi potongan pada keranjang ini."}
        </div>
      )}
      {/* Written onto the sale exactly as typed. This node cannot check it —
          the member directory is central and this terminal addresses only its
          own shop, which is what keeps the till selling when the line to head
          office is down. */}
      <div className="inline-form" style={{ marginTop: 8 }}>
        <div className="field-wrap">
          <input
            className="plain"
            value={customerId ?? ""}
            onChange={(event) =>
              onCustomer(
                event.target.value.trim() === "" ? null : event.target.value,
              )
            }
            placeholder="Nomor member, kalau ada"
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
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Hasil pindai handheld</h1>
            <p>
              Pemindai mengirim bacaannya ke node, bukan ke terminal ini. Pilih
              sesinya untuk menarik tagnya ke keranjang — yang sudah ada di
              keranjang tidak akan dobel.
            </p>
          </div>
          <button className="btn ghost" onClick={onBack}>
            ← Kembali ke konter
          </button>
        </div>

        {items === null && problem === null && (
          <div className="empty">
            <h3>Menanyakan sesi ke node…</h3>
          </div>
        )}

        {problem !== null && <div className="notice warn">{problem}</div>}

        {items !== null && items.length === 0 && (
          <div className="empty">
            <h3>Belum ada sesi pindai</h3>
            <p>
              Tekan tombol kirim di handheld setelah memindai, lalu buka panel
              ini lagi. Bacaannya sudah tersimpan di node sebelum tombol ini
              ditekan.
            </p>
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
                        {" · terakhir "}
                        {new Date(one.last_seen_at).toLocaleTimeString("id-ID")}
                      </>
                    )}
                  </p>
                </div>
                <button
                  className="btn primary"
                  disabled={busy !== null}
                  onClick={() => void pull(one.reader_session_id)}
                >
                  {busy === one.reader_session_id
                    ? "Menarik…"
                    : "Tarik ke keranjang"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/// The board: what a cashier does mid-sale, and what they do twice a day.
///
/// It never moves and never scrolls. At four in the afternoon the interface is
/// muscle memory, and a key that shifted position is a key that has to be read
/// again every time.
function Board({
  held,
  canHold,
  onHold,
  onResume,
  onBags,
  onRfid,
  onGo,
}: {
  held: readonly { readonly id: string; readonly at: string }[]
  canHold: boolean
  onHold: () => void
  onResume: () => void
  onBags: () => void
  onRfid: () => void
  onGo: (next: Where) => void
}) {
  const [devices, setDevices] = useState<
    readonly { readonly what: string; readonly detail: string }[]
  >([])
  const [displayProblem, setDisplayProblem] = useState<string | null>(null)
  useEffect(() => {
    void (async () => {
      const [rfid, fp] = await Promise.all([
        device("rfid_state"),
        device("fingerprint_state"),
      ])
      setDevices([
        { what: "Pembaca RFID", detail: rfid.detail },
        { what: "Sidik jari", detail: fp.detail },
      ])
    })()
  }, [])

  return (
    <div className="utility">
      <div className="utility-row">
        <button className="util" onClick={onHold} disabled={!canHold}>
          Tahan
        </button>
        <button className="util" onClick={onResume} disabled={held.length === 0}>
          Ditahan
          {held.length > 0 && <span className="count">{held.length}</span>}
        </button>
        <button className="util" onClick={onBags}>
          Kantong
        </button>
      </div>
      <div className="utility-row">
        <button className="util" onClick={() => onGo("return")}>
          Retur
        </button>
        <button className="util" onClick={onRfid}>
          Tarik RFID
        </button>
        <button className="util" onClick={() => onGo("void")}>
          Batalkan penjualan
        </button>
        <button className="util" onClick={() => onGo("redeem")}>
          Tukar poin
        </button>
        <button className="util strong" onClick={() => onGo("shift")}>
          Shift &amp; kas
        </button>
        <button className="util" onClick={() => onGo("setup")}>
          Perangkat &amp; node
        </button>
      </div>
      <div className="utility-row two">
        <button
          className="util"
          onClick={() => {
            void openCustomerDisplay().then((problem) => {
              if (problem !== null) setDisplayProblem(problem)
            })
          }}
        >
          Layar pelanggan
        </button>
        {displayProblem !== null && (
          <span className="util" title={displayProblem}>
            Belum terbuka
          </span>
        )}
      </div>
      <div className="utility-row two">
        {devices.map((one) => (
          <span className="util" key={one.what} title={one.detail}>
            {one.what}
          </span>
        ))}
      </div>
    </div>
  )
}

function Statusbar({
  unsent,
  refused,
}: {
  unsent?: number
  refused?: number
}) {
  const syncStatus =
    refused !== undefined && refused > 0
      ? `${refused} penjualan ditolak node; perlu ditangani kasir`
      : unsent !== undefined && unsent > 0
        ? `${unsent} penjualan menunggu terkirim`
        : unsent !== undefined
          ? "Semua penjualan sudah terkirim"
          : "Status sync tidak tersedia"

  return (
    <footer className="statusbar">
      <span>Terminal kasir · satu node toko, banyak terminal</span>
      <span className="right">
        <span>{syncStatus}</span>
      </span>
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
  coupons,
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
  coupons: readonly string[]
  customerId: string | null
  charges: readonly api.Charge[]
  actorId: string
  onBack: () => void
  onSold: (sale: Sold) => void
}) {
  const [method, setMethod] = useState<string>("CASH")
  const [typed, setTyped] = useState("")
  const [reference, setReference] = useState("")
  const [taken, setTaken] = useState<
    readonly {
      method: string
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
  const needsReference = method !== "CASH"
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

  async function takeIt() {
    if (needsReference && reference.trim().length < 4) {
      setProblem("Masukkan referensi pembayaran, minimal 4 karakter.")
      return
    }
    if (needsReference && looksLikeACard) {
      setProblem(
        "Referensi itu menyerupai nomor kartu. Tulis kode approval atau nama acquirer, jangan nomor instrumennya.",
      )
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
        method,
        amountMinor: amount,
        tenderedMinor: offered,
        reference: reference.trim() === "" ? null : reference.trim(),
        voucherAuthorizationId: hold?.id ?? null,
        voucherCheckoutId: hold?.checkout ?? null,
      },
    ])
    setTyped("")
    setReference("")
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
                <h3>Nominal sudah lunas</h3>
                <p>
                  {change > 0
                    ? `Kembalian ${money(change, currency)} — rincian pecahannya di panel kanan.`
                    : "Tidak ada kembalian."}
                </p>
              </div>
            ) : (
              <>
                <div>
                  <span className="label">Metode pembayaran</span>
                  <div className="method-grid" style={{ marginTop: 8 }}>
                    {METHODS.map((one) => (
                      <button
                        key={one.value}
                        className="method"
                        aria-pressed={method === one.value}
                        onClick={() => {
                          setMethod(one.value)
                          setProblem(null)
                        }}
                      >
                        {one.label}
                      </button>
                    ))}
                  </div>
                </div>

                {needsReference && (
                  <label className="field">
                    Referensi
                    <input
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      placeholder="Misalnya: BCA · approval 8842"
                      autoComplete="off"
                    />
                  </label>
                )}

                <div>
                  <span className="label">Nominal</span>
                  <div className="amount-field" style={{ marginTop: 8 }}>
                    <span className="rp">Rp</span>
                    <input
                      value={typed}
                      onChange={(event) => setTyped(event.target.value)}
                      inputMode="numeric"
                      placeholder={String(outstanding)}
                      aria-label="Nominal pembayaran"
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
                {settled
                  ? busy
                    ? "Membukukan…"
                    : "Selesaikan transaksi"
                  : partial
                    ? `Bayar sebagian ${money(entered, currency)}`
                    : `Bayar ${money(offered, currency)}`}
              </button>
            </div>
          </div>
        </section>

        <aside className="pay-side">
          <button className="pay-back" onClick={() => void leavePayment()}>
            ← Kembali ke keranjang
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
                <span className="muted" style={{ fontSize: 11 }}>
                  Sementara — node belum menghitung. Struk yang berlaku.
                </span>
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
                      {METHODS.find((m) => m.value === one.method)?.label ??
                        one.method}
                      {one.reference !== null && (
                        <small className="muted"> {one.reference}</small>
                      )}
                    </span>
                    <strong className="num">
                      {money(one.amountMinor, currency)}
                    </strong>
                  </div>
                ))}
              </>
            )}

            {!settled && taken.length > 0 && (
              <p className="split-hint">
                ← Boleh ganti metode untuk membayar sisa
              </p>
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
      <Statusbar />
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
  const printer = config?.printer_host ?? null
  const [printed, setPrinted] = useState<string | null>(null)
  const asked = useRef(false)

  /// Print once, and do not wait for it.
  ///
  /// A printer out of paper must not hold up the next customer, and the receipt
  /// can be reprinted from the sale at any time. `copy` stamps every print after
  /// the first, so a duplicate can never be mistaken for a second sale.
  const print = useCallback(
    async (copy: boolean) => {
      if (sold.saleId === null || printer === null || config === null) return
      const reply = await api.printReceipt(sold.saleId, {
        printer_host: printer,
        printer_port: config.printer_port,
        paper: config.paper,
        drawer: copy ? "NONE" : "PRINTER_PULSE",
        copy,
      })
      setPrinted(
        reply.ok
          ? copy
            ? "Salinan struk dicetak."
            : "Struk dicetak."
          : reply.problem,
      )
    },
    [config, printer, sold.saleId],
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
        <div className="overlay-card">
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
            <div className="notice warn">
              Node belum menerima penjualan ini, jadi belum ada nomor struk.
              Terminal akan mengirim ulang sendiri.
              {sold.problem !== null && <> {sold.problem}</>}
            </div>
          )}
          <p className="muted num" style={{ fontSize: 11.5 }}>
            {sold.id}
          </p>
          {printer === null ? (
            <p className="muted" style={{ fontSize: 11.5 }}>
              Konter ini belum punya printer struk.
            </p>
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
                Cetak ulang
              </button>
            </>
          )}
          <button
            className="btn primary"
            style={{ width: "100%" }}
            onClick={onNext}
          >
            Transaksi berikutnya
          </button>
        </div>
      </div>
      <Statusbar />
    </div>
  )
}
