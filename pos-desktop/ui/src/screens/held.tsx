/// Tunda in the item list (client, 25 Oct 2026: "kurangi sheet"). ⇧9 turns the
/// list into the day's held sales; a row opens that sale's pieces in the same
/// list, and from there it is continued, or closed after the Kepala toko has
/// ticked every piece that goes back.
///
/// A Tunda lasts at most 30 minutes. The last five count down on its row; past
/// them the till is locked (`FreezeOverlay`) until the Kepala toko or an Admin
/// opens it and that sale is settled. Only the cashier who held a sale
/// continues it — the Kepala toko's finger, given to open a locked till,
/// stands in for hers.
///
/// What it draws is the sale list's own table and floating foot; what it does
/// is `till.tsx`'s (`onResume`, `onClose`), which owns the node and the finger.

import { useEffect, useState } from "react"

import { Icon } from "@/icons"
import { useListKeys } from "@/list-keys"
import { Act, keepCaret, ListFoot, plain } from "@/list-parts"
import { money } from "@itulah/contract/money"

import "../exchange-d.css"

/// At most 30 minutes; the last five count down. The demo build sets
/// `VITE_HOLD_MAX_MINUTES=6` so the lock can be tried without half an hour's
/// wait — the countdown window stays the last five minutes either way.
const configured = Number(import.meta.env.VITE_HOLD_MAX_MINUTES ?? "")
export const HOLD_MINUTES = Number.isFinite(configured) && configured > 0 ? configured : 30
export const HOLD_MAX = HOLD_MINUTES * 60_000
export const HOLD_WARN = Math.max(0, HOLD_MAX - 5 * 60_000)

export type HeldLine = {
  /// Its place on the sale, to tick it by.
  readonly key: string
  readonly sku: string
  readonly name: string
  readonly quantity: number
  readonly priceMinor: number | null
}

export type HeldRow = {
  readonly id: string
  /// When it was parked, in ms. Null for a hold this counter wrote down before
  /// it kept the time: it never counts down and never locks.
  readonly at: number | null
  /// "10:32".
  readonly time: string
  readonly by: string
  /// Whether the signed-in person is the one who held it.
  readonly mine: boolean
  readonly pcs: number
  readonly totalMinor: number
  readonly member: string | null
  readonly lines: readonly HeldLine[]
}

/// A Tunda that has run past its 30 minutes.
export const heldOver = (row: HeldRow, now: number) => row.at !== null && now - row.at >= HOLD_MAX

/// "3:17".
export const mmss = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/// Every second while a held list is on screen, so the last five minutes tick.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function Status({ row, now }: { row: HeldRow; now: number }) {
  if (row.at === null || now - row.at < HOLD_WARN) {
    return <span className="ds-status ds-status--warn">Tunda</span>
  }
  if (now - row.at >= HOLD_MAX) return <span className="ds-status ds-status--bad">Lewat {HOLD_MINUTES} menit</span>
  return <span className="hold-left">Sisa {mmss(HOLD_MAX - (now - row.at))}</span>
}

export function HeldMode({
  rows,
  open,
  live,
  busy,
  unlocked,
  currency,
  onOpen,
  onBack,
  onResume,
  onClose,
}: {
  rows: readonly HeldRow[]
  /// The sale whose pieces are shown, when one is.
  open: string | null
  /// Nothing is drawn over the list: its keys answer.
  live: boolean
  busy: boolean
  /// The till was opened for the open sale by the Kepala toko.
  unlocked: boolean
  currency: string
  onOpen: (id: string) => void
  /// One step back: from the pieces to the list, from the list to the sale.
  onBack: () => void
  onResume: (row: HeldRow) => void
  /// Every piece is ticked: the Kepala toko's finger closes it.
  onClose: (row: HeldRow) => void
}) {
  const now = useNow()
  const row = open === null ? null : (rows.find((one) => one.id === open) ?? null)
  return row === null ? (
    <HeldList rows={rows} now={now} live={live} currency={currency} onOpen={onOpen} onBack={onBack} />
  ) : (
    <HeldPieces
      key={row.id}
      row={row}
      now={now}
      live={live}
      busy={busy}
      unlocked={unlocked}
      currency={currency}
      onBack={onBack}
      onResume={onResume}
      onClose={onClose}
    />
  )
}

function HeldList({
  rows,
  now,
  live,
  currency,
  onOpen,
  onBack,
}: {
  rows: readonly HeldRow[]
  now: number
  live: boolean
  currency: string
  onOpen: (id: string) => void
  onBack: () => void
}) {
  // The row ↑ ↓ point at; none until a key moves it.
  const [at, setAt] = useState<number | null>(null)
  useListKeys(live, {
    back: onBack,
    enter: () => {
      const one = rows[at ?? (rows.length === 1 ? 0 : -1)]
      if (one !== undefined) onOpen(one.id)
    },
    move: (by) => setAt((was) => Math.max(0, Math.min(rows.length - 1, (was ?? (by === 1 ? -1 : rows.length)) + by))),
  })
  return (
    <>
      <div className="t-mode">
        <span className="mode-flag held">Tunda</span>
        <span className="mute">{rows.length} transaksi</span>
      </div>
      {rows.length === 0 ? (
        <div className="t-grid">
          <div className="t-empty">
            <p>Tidak ada transaksi tunda</p>
          </div>
        </div>
      ) : (
        <div className="t-grid">
          <table>
            <colgroup>
              <col style={{ width: 64 }} />
              <col style={{ width: 120 }} />
              <col />
              <col />
              <col style={{ width: 104 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 190 }} />
            </colgroup>
            <thead>
              <tr>
                <th />
                <th>Ditunda</th>
                <th>Kasir</th>
                <th>Member</th>
                <th className="c">Jumlah</th>
                <th className="r">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((one, index) => (
                <tr
                  key={one.id}
                  className={index === at ? "go at" : "go"}
                  onMouseDown={keepCaret}
                  onClick={() => onOpen(one.id)}
                >
                  <td className="mute num">{index + 1}</td>
                  <td className="num">{one.time}</td>
                  <td>{one.by}</td>
                  <td>{one.member ?? <span className="faint">—</span>}</td>
                  <td className="c num">{one.pcs}</td>
                  <td className="r b">{plain(one.totalMinor, currency)}</td>
                  <td className="r">
                    <Status row={one} now={now} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ListFoot back="Kembali ke penjualan" onBack={onBack} currency={currency} />
    </>
  )
}

function HeldPieces({
  row,
  now,
  live,
  busy,
  unlocked,
  currency,
  onBack,
  onResume,
  onClose,
}: {
  row: HeldRow
  now: number
  live: boolean
  busy: boolean
  unlocked: boolean
  currency: string
  onBack: () => void
  onResume: (row: HeldRow) => void
  onClose: (row: HeldRow) => void
}) {
  // Closing: the pieces ticked so far, and the one ↑ ↓ Space is on. Null when
  // the sale is only being looked at.
  const [ticks, setTicks] = useState<ReadonlySet<string> | null>(null)
  const [at, setAt] = useState(0)
  const checking = ticks !== null
  const all = ticks !== null && ticks.size === row.lines.length
  const can = row.mine || unlocked
  const age = row.at === null ? 0 : now - row.at

  const toggle = (key: string) =>
    setTicks((was) => {
      if (was === null) return was
      const next = new Set(was)
      if (!next.delete(key)) next.add(key)
      return next
    })

  useListKeys(live, {
    back: () => (checking ? setTicks(null) : onBack()),
    enter: () => {
      if (checking) {
        if (all && !busy) onClose(row)
      } else if (can && !busy) onResume(row)
    },
    move: checking ? (by) => setAt((was) => Math.max(0, Math.min(row.lines.length - 1, was + by))) : undefined,
    space: checking ? () => row.lines[at] !== undefined && toggle(row.lines[at].key) : undefined,
  })

  const warn =
    age >= HOLD_MAX ? (
      <p className="hold-warn over">Lewat {HOLD_MINUTES} menit · selesaikan tunda ini dulu</p>
    ) : age >= HOLD_WARN ? (
      <p className="hold-warn">
        Sisa <b>{mmss(HOLD_MAX - age)}</b> · lewat {HOLD_MINUTES} menit kasir terkunci
      </p>
    ) : null
  const band = checking ? (
    <p className="hp-sup">Supervisor wajib cek barang sebagai berikut, barang yang akan dibatalkan:</p>
  ) : null
  const note = !checking && !can ? <p className="hp-note">Hanya {row.by} yang bisa melanjutkan tunda ini.</p> : null

  return (
    <>
      <div className="t-mode">
        <span className="mode-flag held">Tunda</span>
        <span className="mute">
          {row.time} · {row.by}
        </span>
      </div>
      <div className="t-grid">
        {(warn !== null || band !== null || note !== null) && (
          <div className="hg-band">
            {warn}
            {band}
            {note}
          </div>
        )}
        <table>
          <colgroup>
            <col style={{ width: 64 }} />
            <col />
            <col style={{ width: 104 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 150 }} />
          </colgroup>
          <thead>
            <tr>
              <th />
              <th>Barang</th>
              <th className="c">Jumlah</th>
              <th className="r">Harga</th>
              <th className="r">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {row.lines.map((line, index) => {
              const on = ticks !== null && ticks.has(line.key)
              return (
                <tr
                  key={line.key}
                  className={`${checking ? "go" : ""}${on ? " sel" : ""}${checking && index === at ? " at" : ""}`.trim() || undefined}
                  onMouseDown={keepCaret}
                  onClick={
                    checking
                      ? () => {
                          setAt(index)
                          toggle(line.key)
                        }
                      : undefined
                  }
                >
                  {checking ? (
                    <td className="c">
                      <span className="hp-box">{on && <Icon name="check" size={14} />}</span>
                    </td>
                  ) : (
                    <td className="mute num">{index + 1}</td>
                  )}
                  <td>
                    <span className="nm-t">{line.name}</span>
                  </td>
                  <td className="c num">{line.quantity}</td>
                  <td className="r">{line.priceMinor === null ? "—" : plain(line.priceMinor, currency)}</td>
                  <td className="r b">
                    {line.priceMinor === null ? "—" : plain(line.priceMinor * line.quantity, currency)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ListFoot
        back={checking ? "Kembali" : "Daftar tunda"}
        onBack={() => (checking ? setTicks(null) : onBack())}
        label={`Tunda · ${row.pcs} pcs`}
        minor={row.totalMinor}
        currency={currency}
      >
        {checking ? (
          <Act
            tone="bad"
            main
            label={`Tutup tunda · ${ticks.size}/${row.lines.length}`}
            disabled={!all || busy}
            onClick={() => onClose(row)}
          />
        ) : (
          <>
            <Act tone="bad" label="Tutup tunda" onClick={() => setTicks(new Set())} />
            <Act main label="Lanjutkan" disabled={!can || busy} onClick={() => onResume(row)} />
          </>
        )}
      </ListFoot>
    </>
  )
}

/// The till locked by a Tunda past 30 minutes: only the Kepala toko or an Admin
/// opens it, and then that sale is settled before anything else.
export function FreezeOverlay({
  row,
  currency,
  onOpen,
}: {
  row: HeldRow
  currency: string
  onOpen: () => void
}) {
  return (
    <div className="xchd freeze enter">
      <section className="dlg freeze-dlg" role="alertdialog" aria-modal="true" aria-label="Kasir terkunci">
        <div className="dlg-body">
          <span className="fz-seal">
            <Icon name="lock" size={22} />
          </span>
          <p className="ttl">Kasir terkunci</p>
          <p className="cap">
            Tunda {row.by} · {row.time} · {money(row.totalMinor, currency)} sudah lewat {HOLD_MINUTES} menit.
            <br />
            Kepala toko atau admin membuka kasir dan menyelesaikan tunda ini dulu.
          </p>
          <button type="button" className="ds-btn ds-btn--primary" autoFocus onClick={onOpen}>
            Buka · kepala toko
          </button>
        </div>
      </section>
    </div>
  )
}
