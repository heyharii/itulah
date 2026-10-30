import { useEffect, useRef, useState, type ReactNode } from "react"

import * as api from "@/api"
import { Icon } from "@/icons"
import { viaPointer } from "@/shortcuts"
import { articleId, sku } from "@/sku"
import { money } from "@itulah/contract/money"

/// Four things a cashier does that are neither scanning nor taking money.
///
/// They are gathered here because they share one property: each of them is a
/// moment where the till is about to lose something — a basket, a parked
/// basket, a sheet of paper, or the chance to charge for a bag — and in every
/// one of them the honest move is to say what is about to happen before it
/// does.
///
/// # What none of them do
///
/// **None of them keep state that outlives them.** Everything arrives through
/// props and leaves through a callback, so the counter's basket, its held
/// baskets and its outbox all stay in one place. A dialog that held half the
/// basket would be a second answer to "what is on the counter".
///
/// **None of them name an endpoint.** `@/api` is the only file that spells a
/// path. Where one of these needs the node — only `ReceiptPreview` does — it
/// calls a wrapper and reads what comes back.
///
/// **None of them draw the app shell.** No `#app`, no topbar, no status bar:
/// none of them is handed an actor or a terminal, and a shell drawn without
/// those would have to invent them. They are regions, and `till.tsx` decides
/// where each one sits.

// ── the sheet ───────────────────────────────────────────────────────────

/// A panel drawn OVER the counter: the basket stays visible behind it and
/// Escape (bound by the till) or the × brings the cashier straight back.
export function Sheet({
  title,
  onClose,
  children,
  foot,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  foot?: ReactNode
}) {
  // Focus moves into the sheet so the keyboard and a screen reader land where
  // the eye does; the till puts it back on the scan field when it closes.
  const box = useRef<HTMLElement>(null)
  // Opened by a tap it pops in; opened by its key it is simply there.
  const [enter] = useState(viaPointer)
  useEffect(() => {
    const first = box.current?.querySelector<HTMLElement>(
      ".sheet-body button:not(:disabled), .sheet-body input, .sheet-foot button:not(:disabled)",
    )
    ;(first ?? box.current)?.focus()
  }, [])
  return (
    <div
      className={enter ? "sheet-wrap enter" : "sheet-wrap"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={box}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Tutup">
            <Icon name="x" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {foot !== undefined && <footer className="sheet-foot">{foot}</footer>}
      </section>
    </div>
  )
}

// ── abandoning a basket ─────────────────────────────────────────────────

/// Reasons a basket is abandoned, in the words somebody at a counter uses.
///
/// Offered, never imposed. Nothing is pre-selected, because a reason the till
/// picked is a reason nobody gave — and the whole point of asking is to be able
/// to tell a counter that cancels two baskets a week from one that cancels
/// twenty. The field underneath takes the fifth thing, which happens daily.
const REASONS = [
  "Pelanggan berubah pikiran",
  "Barang salah scan",
  "Harga dipertanyakan",
  "Barang tidak tersedia",
] as const

/// Throwing away a basket, out loud.
///
/// An overlay rather than a page: the basket is still on the counter behind it
/// and the cashier is one press from going back to it, which is exactly what
/// the screen should look like.
///
/// The reason goes out through `onConfirm` and nowhere else. This terminal has
/// no wrapper that files an abandoned basket — the node has
/// `resolve_checkout`, which separates a deliberate walk-away from a checkout
/// that broke, but `api.ts` names no route for it — so this screen promises
/// only that somebody was asked, never that head office was told.
export function CancelSale({
  units,
  totalMinor,
  currency,
  onConfirm,
  onBack,
}: {
  units: number
  totalMinor: number
  currency: string
  onConfirm: (reason: string) => void
  onBack: () => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [typed, setTyped] = useState("")
  const [enter] = useState(viaPointer)

  // Typed beats picked. Somebody who kept typing after tapping a chip has said
  // the more particular thing, and the chip they brushed on the way past is not
  // what should end up written down.
  const reason = typed.trim() !== "" ? typed.trim() : picked

  // The card takes the caret when it opens (⇧7), so 1–4 pick a reason and
  // nothing typed here reaches the scan field behind it.
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    card.current?.focus()
  }, [])

  return (
    <div className={enter ? "overlay enter" : "overlay"}>
      <div
        ref={card}
        tabIndex={-1}
        style={{ outline: "none" }}
        className="overlay-card"
        role="dialog"
        aria-modal="true"
        aria-label="Batalkan transaksi"
        onKeyDown={(event) => {
          const inField = event.target instanceof HTMLInputElement
          const one = REASONS[Number(event.key) - 1]
          if (!inField && one !== undefined && /^[1-4]$/.test(event.key)) {
            event.preventDefault()
            setPicked(picked === one ? null : one)
          } else if (event.key === "Enter" && reason !== null) {
            event.preventDefault()
            onConfirm(reason)
          }
        }}
      >
        <span className="seal warn">
          <Icon name="trash" />
        </span>
        <h3>Batalkan transaksi ini?</h3>
        <p className="muted num" style={{ fontSize: 15 }}>
          {units} barang · {money(totalMinor, currency)}
        </p>
        <div className="chips" style={{ width: "100%" }}>
          {REASONS.map((one, index) => (
            <button
              key={one}
              className={picked === one ? "chip on" : "chip"}
              style={{ fontSize: 15, height: 40 }}
              onClick={() => setPicked(picked === one ? null : one)}
            >
              <span className="kbd">{index + 1}</span>
              {one}
            </button>
          ))}
        </div>
        <label className="field" style={{ width: "100%", textAlign: "left" }}>
          Alasan lain
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Tulis alasan"
            autoComplete="off"
            maxLength={120}
          />
        </label>
        <button
          className="btn danger"
          style={{ width: "100%" }}
          disabled={reason === null}
          onClick={() => reason !== null && onConfirm(reason)}
        >
          Batalkan
        </button>
        <button
          className="btn ghost"
          style={{ width: "100%" }}
          onClick={onBack}
        >
          Lanjutkan transaksi
        </button>
      </div>
    </div>
  )
}

// ── the parked baskets ──────────────────────────────────────────────────

/// Which parked basket to bring back.
///
/// Held baskets live in this terminal's memory and nowhere else: nothing was
/// sent to the node when one was parked, so the shop has no record of them and
/// a terminal that is restarted comes back with none. The screen says that
/// rather than letting a cashier park a basket at four o'clock and look for it
/// at five.
///
/// There is no currency here, and that is deliberate rather than missing: a
/// parked basket is this counter's own arithmetic, and this counter holds the
/// notes of the country it stands in. `money` defaults to IDR, the same way
/// the receipt screens in `returns.tsx` read a document that carries no code.
export function HoldList({
  held,
  canResume,
  onResume,
  onDrop,
  onBack,
}: {
  held: readonly {
    id: string
    at: string
    units: number
    totalMinor: number
    customerId: string | null
  }[]
  canResume: boolean
  onResume: (id: string) => void
  onDrop: (id: string) => void
  onBack: () => void
}) {
  // Which row has been asked about. Dropping a parked basket cannot be undone
  // and there is nothing on the node to recover it from, so the second press
  // happens on the row itself — a dialog over a dialog would be one more thing
  // to dismiss with somebody waiting.
  const [dropping, setDropping] = useState<string | null>(null)
  // The caret starts on row 1's Lanjutkan, so Enter brings it back; Hapus is
  // only ever its own button. (This runs after the Sheet's own focus.)
  const firstResume = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    firstResume.current?.focus()
  }, [])
  // 1–9 brings that one back, no mouse needed.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const one = held[Number(event.key) - 1]
      if (event.target instanceof HTMLInputElement) return
      if (one === undefined || !canResume || !/^[1-9]$/.test(event.key)) return
      event.preventDefault()
      onResume(one.id)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <Sheet title="Transaksi ditunda" onClose={onBack}>
        {!canResume && held.length > 0 && (
          <div className="notice warn">
            Selesaikan atau tunda dulu transaksi yang sedang berjalan.
          </div>
        )}

        {held.length === 0 ? (
          <div className="empty">
            <Icon name="hold" />
            <h3>Tidak ada transaksi ditunda</h3>
          </div>
        ) : (
          <div className="rows">
            {held.map((one, index) => (
              <div className="row-item" key={one.id}>
                <div className="grow">
                  <h3>
                    <span className="num">
                      {index + 1} · {one.units} barang · {money(one.totalMinor)}
                    </span>
                  </h3>
                  <p>
                    Ditunda {one.at}
                    {one.customerId !== null && (
                      <> · member {one.customerId}</>
                    )}
                  </p>
                </div>
                {dropping === one.id ? (
                  <>
                    <button
                      className="btn ghost"
                      onClick={() => setDropping(null)}
                    >
                      Batal
                    </button>
                    <button
                      className="btn danger"
                      onClick={() => {
                        setDropping(null)
                        onDrop(one.id)
                      }}
                    >
                      Ya, hapus
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn ghost"
                      onClick={() => setDropping(one.id)}
                    >
                      Hapus
                    </button>
                    <button
                      ref={index === 0 ? firstResume : undefined}
                      className="btn primary"
                      disabled={!canResume}
                      onClick={() => onResume(one.id)}
                    >
                      Lanjutkan
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
    </Sheet>
  )
}

// ── reading what the node sent back ─────────────────────────────────────

/// `receipt()` answers a map, so it is read as one. Four readers that take a
/// field if it is there and say null if it is not — which is also what happens
/// when the node answered with something that is not a receipt at all. They
/// mirror the ones in `returns.tsx`; neither file casts an unchecked body into
/// a generated struct, because that would be asserting a shape nobody looked
/// at.
const asMap = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null

const asCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const asList = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : []

/// Every key this screen knows how to draw, from `ReceiptDocument` in
/// `backend/src/edge/escpos.rs`. Anything on the document that is not in one of
/// these three sets is shown raw at the foot rather than dropped: a field the
/// node started sending is a field somebody added on purpose, and a preview
/// that silently ignored it would be a preview that stops matching the paper
/// without anybody noticing.
const DOCUMENT_KEYS = new Set([
  "shop_name",
  "shop_line_1",
  "shop_line_2",
  "site_id",
  "sale_id",
  "receipt_no",
  "completed_at",
  "cashier",
  "lines",
  "subtotal_minor",
  "discount_minor",
  "total_minor",
  "tenders",
  "paid_minor",
  "change_minor",
  "points_earned",
  "footer",
  "stamp",
])

const LINE_KEYS = new Set([
  "name",
  "sku_code",
  "quantity",
  "unit_price_minor",
  "line_total_minor",
  "base_unit_price_minor",
])

const TENDER_KEYS = new Set(["method", "amount_minor", "reference"])

type Line = {
  readonly name: string | null
  readonly skuCode: string | null
  readonly quantity: number | null
  readonly unitPriceMinor: number | null
  readonly lineTotalMinor: number | null
  readonly baseUnitPriceMinor: number | null
}

type Tender = {
  readonly method: string | null
  readonly amountMinor: number | null
  readonly reference: string | null
}

type Document = {
  readonly shopName: string | null
  readonly shopLines: readonly string[]
  readonly siteId: string | null
  readonly saleId: string | null
  readonly receiptNo: string | null
  readonly completedAt: string | null
  readonly cashier: string | null
  readonly lines: readonly Line[]
  /// Entries of `lines` or `tenders` that were not objects at all. Counted
  /// rather than skipped, so a cashier is never shown four lines out of five
  /// with nothing to say the fifth existed.
  readonly unreadable: number
  readonly subtotalMinor: number | null
  readonly discountMinor: number | null
  readonly totalMinor: number | null
  readonly tenders: readonly Tender[]
  readonly paidMinor: number | null
  readonly changeMinor: number | null
  readonly pointsEarned: number | null
  readonly footer: string | null
  readonly stamp: string | null
  /// Keys the node sent that this screen has no drawing for, with a short look
  /// at what was in them.
  readonly strange: readonly (readonly [string, string])[]
}

/// A value shown to somebody who is going to ask "what is that". Short, because
/// the point is to prove the field arrived, not to render it.
function glimpse(value: unknown): string {
  const text =
    typeof value === "string" ? value : String(JSON.stringify(value))
  return text.length > 48 ? `${text.slice(0, 48)}…` : text
}

function readDocument(body: unknown): Document | null {
  const doc = asMap(body)
  if (doc === null) return null

  const strange: [string, string][] = []
  for (const [key, value] of Object.entries(doc)) {
    if (!DOCUMENT_KEYS.has(key)) strange.push([key, glimpse(value)])
  }

  let unreadable = 0
  const lines: Line[] = []
  for (const row of asList(doc.lines)) {
    const line = asMap(row)
    if (line === null) {
      unreadable += 1
      continue
    }
    for (const [key, value] of Object.entries(line)) {
      if (!LINE_KEYS.has(key)) strange.push([`lines[].${key}`, glimpse(value)])
    }
    lines.push({
      name: asText(line.name),
      skuCode: asText(line.sku_code),
      quantity: asCount(line.quantity),
      unitPriceMinor: asCount(line.unit_price_minor),
      lineTotalMinor: asCount(line.line_total_minor),
      baseUnitPriceMinor: asCount(line.base_unit_price_minor),
    })
  }

  const tenders: Tender[] = []
  for (const row of asList(doc.tenders)) {
    const tender = asMap(row)
    if (tender === null) {
      unreadable += 1
      continue
    }
    for (const [key, value] of Object.entries(tender)) {
      if (!TENDER_KEYS.has(key)) {
        strange.push([`tenders[].${key}`, glimpse(value)])
      }
    }
    tenders.push({
      method: asText(tender.method),
      amountMinor: asCount(tender.amount_minor),
      reference: asText(tender.reference),
    })
  }

  // One row per key, not per occurrence: twenty lines carrying the same unknown
  // field is one thing to be told about, not twenty.
  const seen = new Set<string>()
  const once = strange.filter(([key]) => {
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    shopName: asText(doc.shop_name),
    shopLines: [asText(doc.shop_line_1), asText(doc.shop_line_2)].filter(
      (one): one is string => one !== null,
    ),
    siteId: asText(doc.site_id),
    saleId: asText(doc.sale_id),
    receiptNo: asText(doc.receipt_no),
    completedAt: asText(doc.completed_at),
    cashier: asText(doc.cashier),
    lines,
    unreadable,
    subtotalMinor: asCount(doc.subtotal_minor),
    discountMinor: asCount(doc.discount_minor),
    totalMinor: asCount(doc.total_minor),
    tenders,
    paidMinor: asCount(doc.paid_minor),
    changeMinor: asCount(doc.change_minor),
    pointsEarned: asCount(doc.points_earned),
    footer: asText(doc.footer),
    stamp: asText(doc.stamp),
    strange: once,
  }
}

/// What the node said, or the plain fact that it said nothing. Never a sentence
/// this file invented to fill the space.
function refusal(reply: api.EdgeReply<unknown>): string {
  return (
    reply.problem ??
    `Server toko menolak dengan status ${reply.status} tanpa alasan.`
  )
}

/// A field the node did not send, said as that rather than drawn as a dash.
function Missing() {
  return <span className="muted">—</span>
}

function Text({ value }: { value: string | null }) {
  return value === null ? <Missing /> : <>{value}</>
}

function Money({ value, currency }: { value: number | null; currency: string }) {
  return value === null ? <Missing /> : <>{money(value, currency)}</>
}

// ── the receipt, before paper is spent ──────────────────────────────────

/// What the node says the sale was.
///
/// **This screen renders no receipt.** The node does that — it holds the
/// database the sale is in, it is the party on the printer's LAN, and it turns
/// the same `ReceiptDocument` shown below into ESC/POS. A layout composed here
/// out of basket state would be a second implementation of the paper, and the
/// day the two drifted apart the copy a customer took home would disagree with
/// the copy the shop reprints. So this is a reading of the node's answer, field
/// by field, and where the answer has no field it says so.
///
/// It is deliberately not drawn to look like paper either. `.slip` exists in
/// the stylesheet and is not used here: a monospaced 58mm column would invite
/// somebody to check the paper against this screen, and this screen is not the
/// paper — it is the document the paper will be rendered from.
///
/// # Two things the document cannot tell you
///
/// **It carries no currency code.** Every figure is an integer count of the
/// smallest unit and nothing says of what, so they are read with the currency
/// this terminal was given, and that is said on screen rather than assumed
/// quietly.
///
/// **It carries no charges.** `ReceiptDocument` has lines, tenders and totals;
/// the fees written to `sale_charge` — a bag, a delivery — are on the bill and
/// on none of them, and `total_minor` is the goods alone. When paid less change
/// does not come to the total, that gap is shown as a gap, because the one
/// thing this screen must not do is invent the line that would explain it.
export function ReceiptPreview({
  saleId,
  currency,
  onPrint,
  onBack,
}: {
  saleId: string
  currency: string
  onPrint: () => void
  onBack: () => void
}) {
  const [doc, setDoc] = useState<Document | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [asking, setAsking] = useState(true)

  useEffect(() => {
    let live = true
    setAsking(true)
    setTrouble(null)
    void (async () => {
      const reply = await api.receipt(saleId)
      // The sale id can change under a mounted screen; a late answer to the old
      // one must not draw somebody else's sale over this one.
      if (!live) return
      setAsking(false)
      if (!reply.ok) {
        setDoc(null)
        setTrouble(refusal(reply))
        return
      }
      const read = readDocument(reply.body)
      if (read === null) {
        setDoc(null)
        setTrouble(
          "Server toko menjawab, tapi bukan dokumen struk. Cek ID penjualan.",
        )
        return
      }
      setDoc(read)
    })()
    return () => {
      live = false
    }
  }, [saleId])

  // Paid, less change, against the total. All three are the node's own figures
  // and this is the only arithmetic on this screen — a check, never a number to
  // print. See the note on this component for what the gap usually is.
  const gap =
    doc !== null &&
    doc.paidMinor !== null &&
    doc.changeMinor !== null &&
    doc.totalMinor !== null
      ? doc.paidMinor - doc.changeMinor - doc.totalMinor
      : null

  return (
    <Sheet
      title="Pratinjau struk"
      onClose={onBack}
      foot={
        <>
          <button className="btn" onClick={onBack}>
            Tutup
          </button>
          <button className="btn primary" disabled={doc === null} onClick={onPrint}>
            <Icon name="print" />
            Cetak
          </button>
        </>
      }
    >
        {asking && (
          <div className="empty">
            <h3>Memuat struk…</h3>
            <p className="num">{saleId}</p>
          </div>
        )}

        {trouble !== null && (
          <>
            <p className="error">{trouble}</p>
          </>
        )}

        {doc !== null && (
          <>
            {doc.stamp !== null && (
              <div className="notice warn">
                Bertanda <strong>{doc.stamp}</strong>
              </div>
            )}

            <div>
              <div className="kv">
                <span className="muted">Toko</span>
                <span>
                  <Text value={doc.shopName} />
                  {doc.shopLines.length > 0 && (
                    <small className="muted"> · {doc.shopLines.join(" · ")}</small>
                  )}
                </span>
              </div>
              <div className="kv">
                <span className="muted">Site</span>
                <span className="num">
                  <Text value={doc.siteId} />
                </span>
              </div>
              <div className="kv">
                <span className="muted">Nomor struk</span>
                <strong className="num">
                  <Text value={doc.receiptNo} />
                </strong>
              </div>
              <div className="kv">
                <span className="muted">ID penjualan</span>
                <span className="num">
                  <Text value={doc.saleId} />
                </span>
              </div>
              {/* Ditampilkan persis seperti yang disimpan node. Node mengubahnya
                  ke waktu lokal saat mencetak; mengubahnya di sini juga berarti
                  dua tempat yang memformat satu waktu. */}
              <div className="kv">
                <span className="muted">Waktu</span>
                <span className="num">
                  <Text value={doc.completedAt} />
                </span>
              </div>
              <div className="kv">
                <span className="muted">Kasir</span>
                <span>
                  <Text value={doc.cashier} />
                </span>
              </div>
            </div>

            <div>
              <span className="label">Barang</span>
              {doc.lines.length === 0 ? (
                <p className="muted">Tidak ada baris barang.</p>
              ) : (
                <div className="receipt-lines" style={{ marginTop: 10 }}>
                  {doc.lines.map((line, at) => (
                    <div className="receipt-line" key={`${line.skuCode}-${at}`}>
                      <span>
                        {line.name ??
                          (line.skuCode === null
                            ? "Tanpa nama di struk"
                            : sku(line.skuCode))}{" "}
                        <small className="num muted">
                          {line.skuCode === null
                            ? "tanpa SKU"
                            : `${articleId(null, line.skuCode)} · ${sku(line.skuCode)}`}
                        </small>
                        {line.quantity !== null && line.quantity !== 1 && (
                          <small className="num muted">
                            {" "}
                            · {line.quantity}×
                          </small>
                        )}
                        {/* Keduanya keluar dari kolom yang sama di node hari
                            ini, jadi baris ini tidak pernah tergambar. Ia ada
                            supaya layar menampilkan dua angka kalau suatu saat
                            keduanya berbeda, bukan diam-diam memilih satu. */}
                        {line.unitPriceMinor !== null &&
                          line.unitPriceMinor !== line.lineTotalMinor && (
                            <small className="num muted">
                              {" "}
                              · per pcs {money(line.unitPriceMinor, currency)}
                            </small>
                          )}
                        {line.baseUnitPriceMinor !== null &&
                          line.baseUnitPriceMinor !== line.lineTotalMinor && (
                            <small className="muted">
                              {" "}
                              · harga normal{" "}
                              {money(line.baseUnitPriceMinor, currency)}
                            </small>
                          )}
                      </span>
                      <strong className="num">
                        <Money value={line.lineTotalMinor} currency={currency} />
                      </strong>
                    </div>
                  ))}
                </div>
              )}
              {doc.unreadable > 0 && (
                <p className="error">
                  {doc.unreadable} baris tidak bisa dibaca.
                </p>
              )}
            </div>

            <div className="divider" />

            <div>
              <div className="kv">
                <span className="muted">Subtotal</span>
                <span className="num">
                  <Money value={doc.subtotalMinor} currency={currency} />
                </span>
              </div>
              <div className="kv">
                <span className="muted">Diskon</span>
                <span className="num">
                  <Money value={doc.discountMinor} currency={currency} />
                </span>
              </div>
              <div className="kv">
                <span className="muted">Total barang</span>
                <strong className="num">
                  <Money value={doc.totalMinor} currency={currency} />
                </strong>
              </div>
              <div className="kv">
                <span className="muted">Dibayar</span>
                <span className="num">
                  <Money value={doc.paidMinor} currency={currency} />
                </span>
              </div>
              <div className="kv">
                <span className="muted">Kembali</span>
                <span className="num">
                  <Money value={doc.changeMinor} currency={currency} />
                </span>
              </div>
              <div className="kv">
                <span className="muted">Poin</span>
                <span className="num">
                  {doc.pointsEarned === null ? (
                    <Missing />
                  ) : (
                    doc.pointsEarned.toLocaleString("id-ID")
                  )}
                </span>
              </div>
            </div>

            {/* Bukan kesimpulan layar ini: `receipt_document` menulis
                `points_earned: 0` tanpa syarat, padahal poin per baris sudah
                dihitung mesin harga dan tersimpan di penjualan. Angka 0 itu
                tetap ditampilkan apa adanya — yang ditambahkan di sini hanya
                keterangan bahwa 0 pada struk tidak berarti nol poin. */}

            <div>
              <span className="label">Pembayaran</span>
              {doc.tenders.length === 0 ? (
                <p className="muted">Tidak ada data pembayaran.</p>
              ) : (
                <div className="receipt-lines" style={{ marginTop: 10 }}>
                  {doc.tenders.map((one, at) => (
                    <div className="receipt-line" key={`${one.method}-${at}`}>
                      <span>
                        <Text value={one.method} />
                        {one.reference !== null && (
                          <small className="muted"> · {one.reference}</small>
                        )}
                      </span>
                      <strong className="num">
                        <Money value={one.amountMinor} currency={currency} />
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {gap !== null && gap !== 0 && (
              <div className="notice warn">
                Selisih <strong className="num">{money(gap, currency)}</strong>{" "}
                (biaya seperti kantong tidak tercantum di struk)
              </div>
            )}

            {doc.footer !== null && (
              <p className="muted">Footer struk: {doc.footer}</p>
            )}

            {doc.strange.length > 0 && (
              <div>
                <span className="label">Data lain</span>
                <div className="chips">
                  {doc.strange.map(([key, value]) => (
                    <span className="chip" key={key}>
                      <span className="num">{key}</span>
                      <small className="muted">{value}</small>
                    </span>
                  ))}
                </div>
              </div>
            )}

          </>
        )}
    </Sheet>
  )
}

// ── the bag ─────────────────────────────────────────────────────────────

/// A fee on the bill. Mirrors `Charge` in
/// `backend/crates/pricing-engine/src/lib.rs:116`, field for field and in the
/// wire's own spelling, because that struct is what the node deserialises.
type Charge = {
  code: string
  description: string
  amount_minor: number
  tax_category: string
}

/// The bags this counter hands out, and what each one costs.
///
/// Written here rather than read from the price book, and that is what a charge
/// is: the book prices garments, and no book has an opinion about how one
/// shopper carries theirs home. When the shop changes what a bag costs, this
/// list is the one place it changes.
///
/// `PACKAGING` is the code `Charge`'s own documentation names. `STANDARD` is
/// the tax category every published book in this system carries; a category the
/// book does not mention is charged untaxed and reported as such, so the worst
/// case is honest rather than wrong. A free bag is a charge of nought on
/// purpose — a decision somebody made, which a report can see — and not an
/// absent line.
///
/// What is deliberately not on this list: a tote sold as merchandise. That is
/// goods, it carries a tag, and selling it as a fee would take it off the
/// counter without taking it out of stock.
export const BAGS: readonly Charge[] = [
  {
    code: "PACKAGING",
    description: "Small paper bag",
    amount_minor: 0,
    tax_category: "STANDARD",
  },
  {
    code: "PACKAGING",
    description: "Large paper bag",
    amount_minor: 0,
    tax_category: "STANDARD",
  },
  {
    code: "PACKAGING",
    description: "Small plastic bag",
    amount_minor: 500,
    tax_category: "STANDARD",
  },
  {
    code: "PACKAGING",
    description: "Large plastic bag",
    amount_minor: 1_000,
    tax_category: "STANDARD",
  },
]

/// What the counter reads for a bag. `description` above is what is written onto
/// the sale and printed, so it stays as it is; this is only what the screen says.
const BAG_WORDS: Readonly<Record<string, string>> = {
  "Small paper bag": "Tas kertas kecil",
  "Large paper bag": "Tas kertas besar",
  "Small plastic bag": "Kantong plastik kecil",
  "Large plastic bag": "Kantong plastik besar",
}

export const bagName = (bag: { readonly description: string }): string =>
  BAG_WORDS[bag.description] ?? bag.description

/// Charging for a bag.
///
/// A bag is not a basket line and cannot be made into one. The basket holds
/// RFID tags and `SaleRequest` is `{ epcs, … }` — a bag has no tag, so there is
/// no field on the wire for it. It IS a `Charge`, which rides on the bill
/// beside the goods: kept out of the promotions, out of the minimum-spend
/// thresholds and out of the points on purpose, because a shopper who reached
/// "belanja Rp500.000" by paying for a carrier bag reached a threshold the shop
/// never agreed to.
///
/// This screen exists to stop a cashier hunting the counter for a bag to scan.
export function BagPicker({
  currency,
  onAdd,
  onBack,
}: {
  currency: string
  onAdd: (charge: Charge) => void
  onBack: () => void
}) {
  return (
    <Sheet title="Kantong belanja" onClose={onBack}>
        <div className="pick-list">
          {BAGS.map((bag) => (
            <button
              className="pick"
              key={bag.description}
              onClick={() => onAdd(bag)}
            >
              <Icon name="bag" />
              <div className="grow">
                <strong>{bagName(bag)}</strong>
              </div>
              {bag.amount_minor === 0 ? (
                <span className="badge ok">Gratis</span>
              ) : (
                <strong className="num">
                  {money(bag.amount_minor, currency)}
                </strong>
              )}
            </button>
          ))}
        </div>
    </Sheet>
  )
}
