/// F1 · Void — the prototype's `pickView` (mode void) and `voidAsk`: one
/// dialog. Pick from this shift's last three receipts (1–3, ↑ ↓ Enter) or scan
/// or type the receipt number, then the Kepala toko's finger, then done — no
/// extra confirmation (owner, 23 Oct 2026: "simplify, jangan step"). Esc
/// closes.
///
/// The finger's proof is spent by the node's own void
/// (`POST /store/sales/{id}/void`), through the approval sheet's `perform`
/// hook, the way `exchange.tsx` spends it on a return.

import { useEffect, useRef, useState } from "react"

import * as api from "@/api"
import { useApproval } from "@/approval"
import { Icon } from "@/icons"
import { seatNow } from "@/seat"
import { useSession } from "@/session"
import { viaPointer } from "@/shortcuts"
import { sound } from "@/sound"
import { money } from "@itulah/contract/money"

import "../exchange-d.css"
import { SaleKindPill } from "@/sale-kind"

const two = (n: number) => String(n).padStart(2, "0")
/// "10:59" — HH:MM, whatever the locale would write.
export const hhmmOf = (iso: string) => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? "" : `${two(at.getHours())}:${two(at.getMinutes())}`
}

/// "Debit · BCA", "Tunai", "QRIS · Mandiri": a payment as the counter says it.
export function tenderWords(tender: api.ShiftSale["tenders"][number]): string {
  const method =
    tender.method === "CASH"
      ? "Tunai"
      : tender.method === "CARD"
        ? tender.card_kind === "CREDIT"
          ? "Kredit"
          : "Debit"
        : tender.method === "EWALLET"
          ? "E-wallet"
          : tender.method === "VOUCHER"
            ? "Voucher"
            : tender.method === "BENEFIT"
              ? "Diskon karyawan"
              : tender.method === "OTHER"
                ? "Return"
                : tender.method
  const bank = tender.acquirer
  if (bank === null || bank === "") return method
  return `${method} · ${bank.length <= 4 ? bank : bank.charAt(0) + bank.slice(1).toLowerCase()}`
}

export function VoidDialog({
  actorId,
  currency,
  onClose,
  onDone,
}: {
  actorId: string
  currency: string
  onClose: () => void
  onDone: (text: string) => void
}) {
  const approval = useApproval()
  const session = useSession()
  const [enter] = useState(viaPointer)
  const [recent, setRecent] = useState<readonly api.ShiftSale[] | null>(null)
  const [pick, setPick] = useState(0)
  const [q, setQ] = useState("")
  const [error, setError] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const shift = seatNow()?.shift_id
    if (shift === undefined || shift === null) {
      setRecent([])
      return
    }
    let alive = true
    void api.shiftSales(shift).then((reply) => {
      if (!alive) return
      const rows = reply.ok ? [...(reply.body ?? [])] : []
      rows.sort((a, b) => b.completed_at.localeCompare(a.completed_at))
      setRecent(rows.slice(0, 3))
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!approval.open) field.current?.focus()
  }, [approval.open])

  const cashierName = (username: string) =>
    session.me?.username === username ? (session.me.display_name ?? username) : username

  function say(text: string | null) {
    setError(text)
    if (text !== null) sound.no()
  }

  /// The receipt typed or scanned: its whole number, or its last digits (four
  /// or more) — only from this shift's last three, as the cashier sees them.
  function matchTyped(): api.ShiftSale | undefined {
    const wanted = q.trim().toUpperCase()
    const digits = wanted.replace(/\D/g, "")
    return (recent ?? []).find(
      (one) =>
        one.receipt_no.toUpperCase() === wanted ||
        (digits.length >= 4 && one.receipt_no.replace(/\D/g, "").endsWith(digits)),
    )
  }

  function go(chosen?: api.ShiftSale) {
    if (approval.open) return
    const typed = q.trim()
    const row = chosen ?? (typed !== "" ? matchTyped() : (recent ?? [])[pick])
    if (row === undefined) {
      if (typed !== "") say(`Struk ${typed} tidak ada di 3 struk terakhir`)
      return
    }
    if (row.status !== "COMPLETED") {
      say(`${row.receipt_no} sudah di-void`)
      return
    }
    say(null)
    ;(document.activeElement as HTMLElement | null)?.blur()
    const key = crypto.randomUUID()
    let voided = false
    // Next tick: the sheet reads Enter as a press on the sensor, and the Enter
    // that picked the receipt must not be that press.
    window.setTimeout(
      () =>
        approval.ask({
          action: "EDIT_CART",
          title: `Void ${row.receipt_no}`,
          detail: `${hhmmOf(row.completed_at)} · ${money(row.total_minor, currency)}`,
          perform: async (supervisor) => {
            const reply = await api.voidSale(row.sale_id, {
              reason: `Void struk ${row.receipt_no} di kasir`,
              supervisor,
              actor_id: actorId,
              idempotency_key: key,
            })
            if (!reply.ok) {
              return reply.status === 401 || reply.status === 403
                ? "Bukan kepala toko"
                : reply.status === 404 || reply.status === 405
                  ? "Server toko ini belum bisa void struk."
                  : (reply.problem ?? `Server toko menolak void (${reply.status}).`)
            }
            voided = true
            return null
          },
          onApproved: (by) => {
            if (voided) onDone(`Struk ${row.receipt_no} di-void — barang kembali ke stok · disetujui ${by.name}.`)
          },
        }),
      0,
    )
  }

  useEffect(() => {
    if (approval.open) return
    function onKey(event: KeyboardEvent) {
      if (event.repeat) return
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      const list = recent ?? []
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setPick((was) => Math.min(Math.max(0, list.length - 1), was + 1))
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        setPick((was) => Math.max(0, was - 1))
      } else if (/^[1-3]$/.test(event.key) && q === "") {
        const row = list[Number(event.key) - 1]
        if (row !== undefined) {
          event.preventDefault()
          go(row)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const hit = q.trim() !== "" ? matchTyped() : undefined
  const list = hit !== undefined ? [hit] : (recent ?? [])

  return (
    <div
      className={enter ? "xchd enter" : "xchd"}
      onMouseDown={(event) => event.target === event.currentTarget && !approval.open && onClose()}
    >
      <section className="dlg xc-find" role="dialog" aria-modal="true" aria-label="Void struk">
        <div className="dlg-head">
          <p className="ttl">Void struk</p>
          <button type="button" className="x-btn" aria-label="Tutup" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dlg-body">
          <label className={error !== null ? "xc-scan bad" : "xc-scan"}>
            <Icon name="search" />
            <input
              ref={field}
              value={q}
              onChange={(event) => {
                setQ(event.target.value)
                setPick(0)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  go()
                }
              }}
              placeholder="Scan atau ketik nomor struk"
              autoComplete="off"
              spellCheck={false}
              aria-label="Nomor struk"
            />
          </label>
          {error !== null && (
            <p className="xc-err" role="alert">
              {error}
            </p>
          )}
          <p className="mem-k">{hit !== undefined ? "Struk" : "Struk terakhir"}</p>
          <div className="mem-list">
            {recent === null ? (
              <p className="t-none">Memuat struk…</p>
            ) : list.length === 0 ? (
              <p className="t-none">Belum ada struk</p>
            ) : (
              list.map((one, index) => (
                <button
                  key={one.sale_id}
                  type="button"
                  className={hit !== undefined || index === pick ? "mem on" : "mem"}
                  onClick={() => go(one)}
                >
                  <span className="kbd">{hit !== undefined ? "↵" : index + 1}</span>
                  <span>
                    <b>{one.receipt_no} <SaleKindPill sale={one} /></b>
                    <span>
                      {hhmmOf(one.completed_at)} · {cashierName(one.cashier)} ·{" "}
                      {one.tenders.map(tenderWords).join(" + ") || "—"}
                    </span>
                  </span>
                  <span className="pts">{money(one.total_minor, currency)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </section>
      {approval.sheet}
    </div>
  )
}
