/// Barang tak dikenal — the prototype's `unknownView` and `unkGo`
/// (pos-classic-prototype.html, step 9): no tag, no SKU, nothing found by name.
/// The cashier types what the thing is and what it costs; the Kepala toko
/// approves the price with a finger; head office identifies it later
/// (docs/unmatched-sales-contract.md, kind UNKNOWN).
///
/// The Kepala toko's proof is spent right here, by the node's own approve call
/// (`POST /store/unmatched/approve`, through the sheet's `perform` hook, as
/// Void and Return use it). The `approval_id` it answers goes back to the
/// counter with the line (`onAdd`) and travels on the quote and the sale. A
/// refusal — a finger that is not a Kepala toko's, a node too old to have the
/// route — stays on the card and nothing is added.

import { useEffect, useRef, useState } from "react"

import * as api from "@/api"
import { useApproval } from "@/approval"
import { Icon } from "@/icons"
import { viaPointer } from "@/shortcuts"
import { units as grouped } from "@itulah/contract/money"

import "../exchange-d.css"

/// What the Kepala toko approved, for the counter to put on a line.
export type UnknownLine = {
  readonly name: string
  /// Rupiah, which is the minor unit of IDR.
  readonly priceMinor: number
  /// The approver's first name — what the line's Keterangan says.
  readonly by: string
  /// The node's record of the Kepala toko's yes, sent with the line.
  readonly approvalId: string
}

export function UnknownDialog({
  name: typed,
  onClose,
  onAdd,
}: {
  /// What the cashier typed when nothing was found: prefilled as the name.
  name: string
  onClose: () => void
  onAdd: (line: UnknownLine) => void
}) {
  const approval = useApproval()
  const [enter] = useState(viaPointer)
  const [name, setName] = useState(typed)
  // Digits only, as typed: "150000". Shown with its dots.
  const [price, setPrice] = useState("")
  const nameBox = useRef<HTMLInputElement>(null)
  const priceBox = useRef<HTMLInputElement>(null)
  const value = Number(price || 0)
  const ready = name.trim() !== "" && value > 0

  // The caret waits on the price (the name is already there), or on the name
  // when there is none; back to it when the finger sheet is dismissed.
  useEffect(() => {
    if (approval.open) return
    ;(name.trim() === "" ? nameBox : priceBox).current?.focus()
    // Only when the sheet opens or closes, never on every letter typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approval.open])

  useEffect(() => {
    if (approval.open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  function go() {
    const clean = name.trim()
    if (clean === "") {
      nameBox.current?.focus()
      return
    }
    if (value <= 0) {
      priceBox.current?.focus()
      return
    }
    if (approval.open) return
    ;(document.activeElement as HTMLElement | null)?.blur()
    const proof: { approved: api.UnmatchedApproval | null } = { approved: null }
    // Next tick: the sheet reads Enter as a press on the sensor, and the
    // Enter that pressed Tambah must not be that press.
    window.setTimeout(
      () =>
        approval.ask({
          action: "EDIT_CART",
          title: "Barang tak dikenal",
          detail: `${clean} · Rp ${grouped(value)}`,
          perform: async (supervisor) => {
            const reply = await api.approveUnmatched({
              name: clean,
              unit_price_minor: value,
              supervisor,
            })
            if (!reply.ok) {
              return reply.status === 401 || reply.status === 403
                ? "Bukan kepala toko"
                : reply.status === 404 || reply.status === 405
                  ? "Server toko ini belum bisa menerima barang tak dikenal."
                  : (reply.problem ?? `Server toko menolak (${reply.status}).`)
            }
            proof.approved = reply.body
            return null
          },
          onApproved: (by) => {
            const approved = proof.approved
            if (approved === null) return
            const who = approved.approved_by_name ?? by.name
            onAdd({
              name: clean,
              priceMinor: value,
              by: who.split(" ")[0] ?? who,
              approvalId: approved.approval_id,
            })
          },
        }),
      0,
    )
  }

  return (
    <div
      className={enter ? "xchd enter" : "xchd"}
      onMouseDown={(event) => event.target === event.currentTarget && !approval.open && onClose()}
    >
      <section className="dlg unk" role="dialog" aria-modal="true" aria-label="Barang tak dikenal">
        <div className="dlg-head">
          <p className="ttl">Barang tak dikenal</p>
          <button type="button" className="x-btn" aria-label="Tutup" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dlg-body">
          <label className="unk-f">
            Nama barang
            <input
              ref={nameBox}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                if (value <= 0) priceBox.current?.focus()
                else go()
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="unk-f">
            Harga
            <span className="unk-amt">
              <span className="cur">Rp</span>
              <input
                ref={priceBox}
                value={value > 0 ? grouped(value) : ""}
                onChange={(event) =>
                  setPrice(event.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    go()
                  } else if (event.key === "." || event.key === "," || event.code === "NumpadDecimal") {
                    // The key that would be the decimal point types 000.
                    event.preventDefault()
                    if (price !== "") setPrice((was) => (was + "000").slice(0, 9))
                  }
                }}
                inputMode="numeric"
                placeholder="0"
                autoComplete="off"
                aria-label="Harga"
              />
            </span>
          </label>
        </div>
        <div className="dlg-foot">
          <span className="sp" />
          <button type="button" className="ds-btn ds-btn--ghost" onClick={onClose}>
            Batal
          </button>
          <button type="button" className="ds-btn ds-btn--primary" disabled={!ready} onClick={go}>
            <span>Tambah</span>
            <span className="kbd">Enter</span>
          </button>
        </div>
      </section>
      {approval.sheet}
    </div>
  )
}
