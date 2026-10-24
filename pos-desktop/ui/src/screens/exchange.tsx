/// F8 · Return — exchange only, no money ever goes back (owner, 23 Oct 2026;
/// the prototype's `openExchange` … `xGo` in pos-classic-prototype.html).
///
/// (1) The receipt first: scanned or typed, or 1–3 from the cashier's last
/// three. (2) "Dikembalikan": each tag read back ticks the exact piece that
/// receipt sold; +/− ticks the next one. (3) "Pengganti": a tag, or a typed
/// SKU that takes a tag of it from the shop floor. Then the Kepala toko's
/// finger, and:
///
/// - the pieces that came back are recorded through the node's own return
///   (`POST /store/returns`, disposition RESALEABLE, refund method OTHER — or
///   CASH where the shop has a payment-method list, see `creditMethod`);
/// - the replacements become the till's basket, and the credit is a tender on
///   that sale for min(pengganti, dikembalikan) with reference "Return <struk>".
///   Dearer: the rest is paid in Bayar. Cheaper or the same: the credit alone
///   settles it, and the difference is not refunded.

import { useEffect, useRef, useState } from "react"

import * as api from "@/api"
import { viaPointer } from "@/shortcuts"
import { Icon } from "@/icons"
import { seatNow } from "@/seat"
import { sound } from "@/sound"
import { readScan } from "@epc"
import { money } from "@itulah/contract/money"

import "../exchange-d.css"
import { SaleKindPill } from "@/sale-kind"

/// What the till carries into Bayar after a Return was recorded.
export type ExchangeCredit = {
  /// `OTHER`, or `CASH` on a shop whose payment-method list leaves OTHER out.
  readonly method: "OTHER" | "CASH"
  /// What came back, as the node recorded the return: the most the credit pays.
  readonly capMinor: number
  /// "Return C11-…", put on the tender.
  readonly reference: string
  readonly receiptNo: string
}

export type ExchangeUnit = {
  readonly epc: string
  readonly sku_code: string
  readonly name: string | null
  readonly unitPriceMinor: number | null
}

export type SoldLine = {
  readonly name: string
  readonly skuCode: string
  readonly quantity: number
  /// What one piece was charged, after markdowns (line total / quantity).
  readonly unitMinor: number
}

export type Receipt = {
  readonly saleId: string
  readonly receiptNo: string
  readonly when: string | null
  readonly totalMinor: number
  readonly stamp: string | null
  readonly lines: readonly SoldLine[]
}

export const asMap = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
export const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null
export const asCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

export function readReceipt(body: unknown, fallbackNo: string): Receipt | null {
  const doc = asMap(body)
  const saleId = doc === null ? null : asText(doc.sale_id)
  if (doc === null || saleId === null) return null
  const lines: SoldLine[] = []
  for (const row of Array.isArray(doc.lines) ? doc.lines : []) {
    const line = asMap(row)
    const skuCode = line === null ? null : asText(line.sku_code)
    if (line === null || skuCode === null) continue
    const quantity = Math.max(1, asCount(line.quantity) ?? 1)
    const total = asCount(line.line_total_minor) ?? (asCount(line.unit_price_minor) ?? 0) * quantity
    const at = lines.findIndex((one) => one.skuCode === skuCode)
    if (at >= 0) {
      const was = lines[at]
      const sum = was.unitMinor * was.quantity + total
      lines[at] = { ...was, quantity: was.quantity + quantity, unitMinor: Math.round(sum / (was.quantity + quantity)) }
    } else {
      lines.push({ name: asText(line.name) ?? skuCode, skuCode, quantity, unitMinor: Math.round(total / quantity) })
    }
  }
  return {
    saleId,
    receiptNo: asText(doc.receipt_no) ?? fallbackNo,
    when: asText(doc.completed_at),
    totalMinor: asCount(doc.total_minor) ?? 0,
    stamp: asText(doc.stamp),
    lines,
  }
}

export const hm = (iso: string | null) =>
  iso === null ? "" : new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
export const skuOf = (epc: string) => {
  const read = readScan(epc)
  return read.kind === "epc" ? read.sku_code : epc.slice(2, 13)
}

/// The tender reference: the node refuses one with twelve or more digits (it
/// looks like a card), so a long receipt number goes by its last part.
export function referenceFor(receiptNo: string): string {
  const whole = `Return ${receiptNo}`
  if (whole.replace(/\D/g, "").length < 12) return whole
  return `Return ${receiptNo.slice(receiptNo.lastIndexOf("-") + 1)}`
}

/// OTHER where the node takes it. A shop with a payment-method list from head
/// office refuses OTHER on a sale (`assert_accepted`: the list has no OTHER),
/// so there both halves go as CASH — refund out, credit in — and the drawer
/// nets to nothing for the credit used.
export async function creditMethod(): Promise<"OTHER" | "CASH"> {
  const reply = await api.paymentMethods()
  return reply.ok && (reply.body ?? []).length > 0 ? "CASH" : "OTHER"
}

/// Where each tag is now, and which tags a sale sold (and has not yet taken
/// back), from the store's latest movements.
export async function readMoves(): Promise<{
  readonly ok: boolean
  readonly problem: string | null
  readonly where: Map<string, string>
  readonly sold: (saleId: string) => Set<string>
}> {
  const reply = await api.tagMoves()
  const items = reply.ok ? [...((reply.body?.items ?? []) as readonly Record<string, unknown>[])] : []
  items.sort((a, b) => String(a.occurred_at ?? "").localeCompare(String(b.occurred_at ?? "")))
  const where = new Map<string, string>()
  for (const move of items) {
    const epc = asText(move.epc)
    const to = asText(move.to)
    if (epc !== null && to !== null) where.set(epc.toUpperCase(), to)
  }
  return {
    ok: reply.ok,
    problem: reply.ok ? null : (reply.problem ?? "Server toko tidak menjawab."),
    where,
    sold: (saleId) => {
      const out = new Set<string>()
      for (const move of items) {
        const epc = asText(move.epc)?.toUpperCase()
        if (epc === undefined || move.reference_id !== saleId) continue
        if (move.reference_type === "SALE") out.add(epc)
        else if (move.reference_type === "SALE_RETURN" || move.reference_type === "SALE_VOID") out.delete(epc)
      }
      return out
    },
  }
}

/// F8 · Return, step one: which receipt. Scanned or typed, or 1–3 of the last
/// three. What happens next is on the sale screen itself, in Return mode
/// (`till.tsx`): the pieces that came back are read there, then the
/// replacements, then the Kepala toko's finger.
export function ReturnPick({
  currency,
  onClose,
  onPick,
}: {
  currency: string
  onClose: () => void
  onPick: (receipt: Receipt, soldTags: ReadonlySet<string> | null) => void
}) {
  const [enter] = useState(viaPointer)
  const [recent, setRecent] = useState<readonly api.ShiftSale[]>([])
  const [pick, setPick] = useState(0)
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const shift = seatNow()?.shift_id
    if (shift === undefined || shift === null) return
    let alive = true
    void api.shiftSales(shift).then((reply) => {
      if (!alive || !reply.ok) return
      const rows = [...(reply.body ?? [])]
      rows.sort((a, b) => b.completed_at.localeCompare(a.completed_at))
      setRecent(rows.slice(0, 3))
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    field.current?.focus()
  }, [])

  function say(text: string | null) {
    setError(text)
    if (text !== null) sound.no()
  }

  async function open(chosen?: api.ShiftSale) {
    const typed = q.trim()
    let row = chosen
    if (row === undefined && typed !== "") {
      const wanted = typed.toUpperCase()
      row = recent.find((one) => one.receipt_no.toUpperCase() === wanted)
    }
    if (row === undefined && typed === "") row = recent[pick]
    const saleId = row?.sale_id ?? typed
    if (saleId === "") return
    if (row !== undefined && row.status !== "COMPLETED") {
      say(`${row.receipt_no} sudah di-void`)
      return
    }
    setBusy(true)
    say(null)
    const [reply, moves] = await Promise.all([api.receipt(saleId), readMoves()])
    setBusy(false)
    const read = reply.ok ? readReceipt(reply.body, row?.receipt_no ?? typed) : null
    if (read === null) {
      say(row === undefined ? `Struk ${typed} tidak ada di 3 struk terakhir` : (reply.problem ?? `Struk ${row.receipt_no} tidak terbaca`))
      return
    }
    const sold = moves.sold(read.saleId)
    onPick(read, sold.size > 0 ? sold : null)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.repeat) return
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      } else if (event.key === "ArrowDown") {
        event.preventDefault()
        setPick((was) => Math.min(Math.max(0, recent.length - 1), was + 1))
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        setPick((was) => Math.max(0, was - 1))
      } else if (/^[1-3]$/.test(event.key) && q === "") {
        const row = recent[Number(event.key) - 1]
        if (row !== undefined) {
          event.preventDefault()
          void open(row)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <div className={enter ? "xchd enter" : "xchd"} onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="dlg xc-find" role="dialog" aria-label="Return">
        <div className="dlg-head">
          <p className="ttl">Return</p>
          <button type="button" className="x-btn" aria-label="Tutup" onClick={onClose} disabled={busy}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dlg-body">
          <label className={error !== null ? "xc-scan bad" : "xc-scan"}>
            <Icon name="search" />
            <input
              ref={field}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void open()
                }
              }}
              placeholder="Scan atau ketik nomor struk"
              autoComplete="off"
              spellCheck={false}
              aria-label="Nomor struk"
            />
          </label>
          {error !== null && <p className="xc-err" role="alert">{error}</p>}
          <p className="mem-k">Struk terakhir</p>
          <div className="mem-list">
            {recent.length === 0 ? (
              <p className="t-none">Belum ada struk</p>
            ) : (
              recent.map((one, index) => (
                <button
                  key={one.sale_id}
                  type="button"
                  className={index === pick ? "mem on" : "mem"}
                  disabled={busy}
                  onClick={() => void open(one)}
                >
                  <span className="kbd">{index + 1}</span>
                  <span>
                    <b>{one.receipt_no} <SaleKindPill sale={one} /></b>
                    <span>
                      {hm(one.completed_at)} · {one.tenders.map((t) => t.method).join(" + ") || "—"}
                    </span>
                  </span>
                  <span className="pts">{money(one.total_minor, currency)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
