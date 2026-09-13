import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import * as api from "@/api"
import { publish } from "@/customer-link"
import { device, inShell, openCustomerDisplay } from "@/edge"
import {
  BagPicker,
  CancelSale,
  HoldList,
  ReceiptPreview,
} from "@/screens/dialogs"
import { useShortcuts } from "@/shortcuts"
import { enqueue, flush, useOutbox } from "@/outbox"
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
}

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

export type Where = "sale" | "payment" | "shift" | "return" | "void" | "setup"

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
  const [held, setHeld] = useState<readonly Held[]>([])
  const [coupons, setCoupons] = useState<readonly string[]>([])
  const [charges, setCharges] = useState<readonly api.Charge[]>([])
  // Panels that open *over* the counter rather than replacing it. Kept here and
  // not in `Where` because leaving them is always "back to this basket" — a
  // cashier who cancelled a bag picker has not gone anywhere.
  const [panel, setPanel] = useState<
    null | "cancel" | "hold" | "bags" | { readonly receipt: string }
  >(null)
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null)
  const [check, setCheck] = useState<readonly api.CatalogRow[]>([])
  const [quote, setQuote] = useState<Quote>({
    totalMinor: null,
    stale: false,
    problem: null,
  })
  const [sold, setSold] = useState<Sold | null>(null)
  const scan = useRef<HTMLInputElement>(null)
  const outbox = useOutbox()

  // The shop's price book, read once and held. This is the read that lets a
  // basket be drawn and priced while the line to the node is unsteady.
  useEffect(() => {
    void (async () => {
      const reply = await api.catalogue()
      if (reply.ok) setRows(reply.body?.items ?? [])
      else setBookProblem(reply.problem)
    })()
  }, [])

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
  const total = quote.totalMinor ?? booked
  const currency = rows[0]?.currency ?? "IDR"

  /// Ask the node what this basket comes to.
  ///
  /// Debounced, because a cashier sweeping a rack produces tags faster than any
  /// server should be asked to price them, and the only figure that matters is
  /// the one after the last tag. Coupons and the member go with it, because a
  /// preview that priced the goods and not the coupon is a preview the sale
  /// will not honour.
  useEffect(() => {
    if (units.length === 0) {
      setQuote({ totalMinor: null, stale: false, problem: null })
      return
    }
    setQuote((was) => ({ ...was, stale: true }))
    const epcs = units.map((unit) => unit.epc)
    const timer = setTimeout(() => {
      void (async () => {
        const reply = await api.quote(epcs, coupons, customerId, charges)
        setQuote(
          reply.ok
            ? {
                totalMinor: reply.body?.total_minor ?? null,
                stale: false,
                problem: null,
              }
            : { totalMinor: null, stale: false, problem: reply.problem },
        )
      })()
    }, 250)
    return () => clearTimeout(timer)
  }, [units, coupons, customerId, charges])

  const onScan = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (text === "") return
      setCheck([])
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
                onScan(field.value)
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
            </form>
            <p className="scan-tip">
              Tag masuk ke keranjang. Barcode dan nama menjawab “ini berapa” —
              satu barang yang terjual adalah satu tag, dan sebuah barcode tidak
              memberi tahu yang mana.
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
      <Statusbar unsent={outbox.unsent} />

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
  customerId,
  onCoupon,
  onDropCoupon,
  onCustomer,
}: {
  coupons: readonly string[]
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
  onGo,
}: {
  held: readonly { readonly id: string; readonly at: string }[]
  canHold: boolean
  onHold: () => void
  onResume: () => void
  onBags: () => void
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
        <button className="util" onClick={() => onGo("void")}>
          Batalkan penjualan
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

function Statusbar({ unsent }: { unsent?: number }) {
  return (
    <footer className="statusbar">
      <span>Terminal kasir · satu node toko, banyak terminal</span>
      <span className="right">
        <span>
          {unsent !== undefined && unsent > 0
            ? `${unsent} penjualan menunggu terkirim`
            : "Semua penjualan sudah terkirim"}
        </span>
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

  function takeIt() {
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
    setTaken((was) => [
      ...was,
      {
        method,
        amountMinor: partial ? entered : outstanding,
        tenderedMinor: offered,
        reference: reference.trim() === "" ? null : reference.trim(),
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
          <button className="pay-back" onClick={onBack}>
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
