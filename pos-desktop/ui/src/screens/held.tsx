/// Transaksi tunda — the prototype's `heldView`: the day's held sales, any
/// cashier may continue one (1–9 or Enter); deleting one is the Kepala toko's
/// finger (the Till asks for it). One line of figures and one of who: the total
/// over the pieces and member, the cashier over the time, then Hapus (red tint)
/// and Lanjutkan, both 104 px wide with no key inside. The number key sits at
/// the row's left; Enter continues the highlighted one, Delete removes it.

import { useEffect, useState } from "react"

import { Icon } from "@/icons"
import { viaPointer } from "@/shortcuts"
import { money } from "@itulah/contract/money"

import "../exchange-d.css"
import "../member-d.css"
import "../held-d.css"

export type HeldRow = {
  readonly id: string
  readonly time: string
  readonly by: string
  readonly pcs: number
  readonly totalMinor: number
  readonly member: string | null
}

export function HeldDialog({
  rows,
  currency,
  onClose,
  onResume,
  onDrop,
}: {
  rows: readonly HeldRow[]
  currency: string
  onClose: () => void
  onResume: (id: string) => void
  onDrop: (id: string) => void
}) {
  const [enter] = useState(viaPointer)
  const [at, setAt] = useState(0)
  const cursor = Math.min(at, Math.max(0, rows.length - 1))

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.repeat) return
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      } else if (event.key === "ArrowDown") {
        event.preventDefault()
        setAt((was) => Math.min(rows.length - 1, was + 1))
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        setAt((was) => Math.max(0, was - 1))
      } else if (/^[1-9]$/.test(event.key) && rows[Number(event.key) - 1] !== undefined) {
        event.preventDefault()
        onResume(rows[Number(event.key) - 1].id)
      } else if (event.key === "Enter" && rows[cursor] !== undefined) {
        // On a focused Hapus or Lanjutkan, Enter is that button's own press.
        if (event.target instanceof HTMLButtonElement) return
        event.preventDefault()
        onResume(rows[cursor].id)
      } else if (event.key === "Delete" && rows[cursor] !== undefined) {
        event.preventDefault()
        onDrop(rows[cursor].id)
      } else if (event.key === "F9") {
        // F9 opened this list, F9 shuts it again.
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <div className={enter ? "xchd enter" : "xchd"} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dlg held-dlg" role="dialog" aria-label="Transaksi tunda">
        <div className="dlg-head">
          <div>
            <p className="ttl">Transaksi tunda</p>
            <p className="cap">{rows.length} transaksi · hari ini</p>
          </div>
          <button type="button" className="x-btn" aria-label="Tutup" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dlg-body">
          {rows.length === 0 ? (
            <p className="t-none">Tidak ada transaksi tunda</p>
          ) : (
            rows.map((one, index) => (
              <div
                key={one.id}
                className={index === cursor ? "held-row on" : "held-row"}
                onMouseEnter={() => setAt(index)}
                onClick={() => onResume(one.id)}
              >
                {index < 9 ? <span className="kbd held-k">{index + 1}</span> : <span />}
                <span className="held-two">
                  <b className="num">{money(one.totalMinor, currency)}</b>
                  <span className="mute">
                    {one.pcs} pcs{one.member !== null ? ` · ${one.member}` : ""}
                  </span>
                </span>
                <span className="held-two r">
                  <span>{one.by}</span>
                  <span className="mute num">{one.time}</span>
                </span>
                <button
                  type="button"
                  className="ds-btn ds-btn--tint-bad ds-btn--sm"
                  onClick={(event) => {
                    event.stopPropagation()
                    onDrop(one.id)
                  }}
                >
                  Hapus
                </button>
                <button
                  type="button"
                  className="ds-btn ds-btn--primary ds-btn--sm"
                  onClick={(event) => {
                    event.stopPropagation()
                    onResume(one.id)
                  }}
                >
                  Lanjutkan
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
