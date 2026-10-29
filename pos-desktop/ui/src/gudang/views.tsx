/// What Central Gudang draws around and in its item list: the toolbar, the scan
/// row, the line above the list, the list of what is being moved and the
/// floating foot. All of it is the till's own markup and classes (`till.tsx`,
/// `till-d.css`) — the screen is the sale list turned into a stock list — so
/// there is nothing here that is not a sale screen's part with other words.
///
/// Nothing here holds state of its own except the person's menu. The state, the
/// keys and what a scan does are `warehouse.tsx`'s.

import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react"

import { REASONS, type Place, type Reason } from "@/gudang/api"
import type { Item } from "@/gudang/book"
import {
  KEYMAP,
  MODES,
  PLACE,
  dayTime,
  initials,
  pieces,
  routeText,
  type Delivery,
  type Draft,
  type ListId,
  type ModeId,
} from "@/gudang/model"
import { Icon } from "@/icons"
import { sku as skuText } from "@/sku"

// ── small parts ─────────────────────────────────────────────────────────

/// The app mark, drawn as `till.tsx` draws it (its own is not exported).
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
      <ellipse cx="48" cy="84" rx="25" ry="3.4" fill="#0b2466" opacity=".4" filter={`url(#${id}s)`} />
      <path
        d="M64.32 28.88A28.25 28.25 0 1 0 64.32 68.12A7.25 7.25 0 0 0 53.89 58.05A13.75 13.75 0 1 1 53.89 38.95A7.25 7.25 0 0 0 64.32 28.88Z"
        fill={`url(#${id}c)`}
      />
      <circle cx="75.5" cy="48.5" r="8" fill={`url(#${id}d)`} />
    </svg>
  )
}

/// The few lucide marks the till draws that `@/icons` does not have.
const GLYPH = {
  radio: (
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
  ok: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
} as const

function Glyph({ name, size = 16, stroke = 2 }: { name: keyof typeof GLYPH; size?: number; stroke?: number }) {
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
      {GLYPH[name]}
    </svg>
  )
}

/// A click on a row must not take the caret away from the scan field — a
/// barcode scanner types into whatever has it — but a click on the row's own
/// box or button must still land.
export function keepCaret(event: MouseEvent) {
  const target = event.target
  if (target instanceof Element && target.closest("input,button") !== null) return
  event.preventDefault()
}

// ── the toolbar ─────────────────────────────────────────────────────────

/// Brand, the keys as the till draws them (a keycap over its word), and the
/// person. A tile is a button too and does what its key does.
export function Header({
  active,
  onKey,
  who,
  device,
  onSignOut,
  onNudge,
  canNudge,
}: {
  active: ModeId | ListId
  onKey: (id: ModeId | ListId) => void
  /// + Tambah and − Kurangi: one more or one less on the picked row.
  onNudge: (by: 1 | -1) => void
  canNudge: boolean
  who: string
  device: string
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = (event: { readonly key: string }) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [open])
  return (
    <header className="t-top">
      <div className="t-brand">
        <BrandMark />
        <b>
          Central<i>.</i>
        </b>
      </div>
      <div className="t-keys7" role="toolbar" aria-label="Tombol">
        {(
          [
            [1, "+", "Tambah", "Add"],
            [-1, "−", "Kurangi", "Subtract"],
          ] as const
        ).map(([by, key, label, code]) => (
          <button
            key={code}
            type="button"
            className="k7"
            disabled={!canNudge}
            aria-keyshortcuts={code}
            onClick={() => onNudge(by)}
          >
            <span className="k7-k" aria-hidden="true">
              {key}
            </span>
            <span className="k7-l">{label}</span>
          </button>
        ))}
        {KEYMAP.map(([key, label, id]) => (
          <Fragment key={id}>
            {(key === "F1" || key === "F9") && <span className="k7-gap" />}
            <button
              type="button"
              className={id === active ? "k7 on" : "k7"}
              aria-keyshortcuts={key}
              aria-pressed={id === active}
              onClick={() => onKey(id)}
            >
              <span className="k7-k" aria-hidden="true">
                {key}
              </span>
              <span className="k7-l">{label}</span>
            </button>
          </Fragment>
        ))}
      </div>
      <span className="sp" />
      <span className="t-popw">
        <button
          type="button"
          className={open ? "t-person on" : "t-person"}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${who}, ${device}`}
          onClick={() => setOpen((was) => !was)}
        >
          <span className="av">{initials(who)}</span>
          <Icon name="down" size={16} />
        </button>
        {open && (
          <>
            <span className="t-popscrim" onMouseDown={() => setOpen(false)} />
            <div className="t-pop r" role="menu">
              <div className="t-who">
                <div className="nm">{who}</div>
                <div className="mt">{device}</div>
              </div>
              <span className="sep" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onSignOut()
                }}
              >
                <Icon name="logout" />
                <span>Keluar</span>
              </button>
            </div>
          </>
        )}
      </span>
    </header>
  )
}

// ── the scan row ────────────────────────────────────────────────────────

/// The R3's chip and the one field. The field takes a SKU, `3*SKU` for a
/// quantity, a tag the reader heard — and, in Terima, the surat jalan number.
/// Pressing the chip reads the pad.
export function ScanRow({
  hint,
  value,
  error,
  reading,
  readerWords,
  readerTone,
  readerTitle,
  canRead,
  inputRef,
  onChange,
  onSubmit,
  onKeyDown,
  onRead,
}: {
  hint: string
  value: string
  error: string | null
  reading: boolean
  readerWords: string
  readerTone: "" | " on" | " warn" | " bad"
  readerTitle: string
  canRead: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onChange: (value: string) => void
  onSubmit: () => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onRead: () => void
}) {
  return (
    <div className="t-scan">
      <button
        type="button"
        className={`t-rfid${readerTone}`}
        onClick={onRead}
        disabled={!canRead || reading}
        aria-live="polite"
        aria-label={`RFID ${readerWords} — baca semua tag di pad Chainway R3`}
        title={readerTitle}
      >
        <span className="t-rfid-dot" />
        <span className="t-rfid-t">
          <b>RFID</b>
          <span>{readerWords}</span>
        </span>
      </button>
      <form
        className={error === null ? "t-scanbox" : "t-scanbox bad"}
        onMouseDown={(event) => {
          // The whole box is the field, as the till's is.
          const target = event.target as HTMLElement
          if (target !== inputRef.current && target.closest("button") === null) {
            event.preventDefault()
            inputRef.current?.focus()
          }
        }}
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={hint}
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="SKU"
        />
        {error !== null && (
          <span className="t-scanerr" role="alert">
            {error}
          </span>
        )}
      </form>
    </div>
  )
}

/// What the list is doing, above it: the move, where it takes from, and the
/// surat jalan in Terima.
export function ModeRow({
  mode,
  from,
  delivery,
  onFrom,
}: {
  mode: ModeId
  from: Place
  delivery: Delivery | null
  onFrom: (place: Place) => void
}) {
  const m = MODES[mode]
  const tone = mode === "reject" ? " bad" : mode === "ho" ? " ret" : mode === "in" ? " held" : ""
  return (
    <div className="t-mode">
      <span className={`mode-flag${tone}`}>{m.flag}</span>
      {m.from.length > 1 && (
        <span className="wh-from">
          <span className="mute">Dari</span>
          <span className="mchips" role="radiogroup" aria-label="Dari">
            {m.from.map((place) => (
              <button
                type="button"
                key={place}
                className={from === place ? "mchip on" : "mchip"}
                role="radio"
                aria-checked={from === place}
                onClick={() => onFrom(place)}
              >
                {PLACE[place]}
              </button>
            ))}
          </span>
        </span>
      )}
      {mode === "in" && delivery !== null && (
        <span className="mute num">
          {delivery.no} · {delivery.from} · {delivery.koli} koli
        </span>
      )}
    </div>
  )
}

// ── the list ────────────────────────────────────────────────────────────

/// What is being moved, a row to a SKU. The quantity is a plain box: Tab from
/// the scan field or a click selects the number, digits replace it, ↑ ↓ go to
/// the row above or below and Enter goes back to the scan field.
export function EntryGrid({
  mode,
  draft,
  from,
  items,
  held,
  inputs,
  onPick,
  onQty,
  onWhy,
  onRemove,
  onQtyKey,
}: {
  mode: ModeId
  draft: Draft
  from: Place
  items: ReadonlyMap<string, Item>
  /// Pieces at the source; Infinity where they are not counted.
  held: (sku: string) => number
  /// The quantity boxes by row, so ↑ ↓ can walk them.
  inputs: RefObject<Map<number, HTMLInputElement>>
  onPick: (index: number) => void
  onQty: (index: number, qty: number) => void
  onWhy: (index: number, reason: Reason) => void
  onRemove: (index: number) => void
  onQtyKey: (event: KeyboardEvent<HTMLInputElement>, index: number) => void
}) {
  const { lines, sel } = draft
  const m = MODES[mode]
  const inbound = mode === "in"
  const body = useRef<HTMLTableSectionElement>(null)
  // A click that focuses a quantity box selects it; the mouse-up that follows
  // must not clear the selection again.
  const fresh = useRef(false)
  // The picked row stays in view as ↑ ↓ walk the list.
  useEffect(() => {
    body.current?.querySelector("tr.sel")?.scrollIntoView({ block: "nearest" })
  }, [sel, lines.length])

  if (lines.length === 0) {
    return (
      <div className="t-grid">
        <div className="t-empty">
          <Glyph name="radio" size={40} stroke={1.5} />
          <p>{inbound ? "Scan surat jalan atau koli" : `Taruh barang di reader · ${routeText(from, m.to)}`}</p>
        </div>
      </div>
    )
  }
  const word = PLACE[from].toLowerCase()
  return (
    <div className="t-grid">
      <table>
        <colgroup>
          <col style={{ width: 170 }} />
          <col />
          {inbound ? (
            <>
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 110 }} />
            </>
          ) : (
            <>
              <col style={{ width: 130 }} />
              <col style={{ width: 120 }} />
              {m.why === true && <col style={{ width: 390 }} />}
            </>
          )}
          <col style={{ width: 48 }} />
        </colgroup>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Barang</th>
            {inbound ? (
              <>
                <th className="c">Dikirim</th>
                <th className="c">Diterima</th>
                <th className="c">Selisih</th>
              </>
            ) : (
              <>
                <th className="c">Stok {word}</th>
                <th className="c">Jumlah</th>
                {m.why === true && <th>Alasan</th>}
              </>
            )}
            <th />
          </tr>
        </thead>
        <tbody ref={body}>
          {lines.map((line, index) => {
            const item = items.get(line.sku)
            const name = item?.name ?? skuText(line.sku)
            const on = index === sel
            const at = held(line.sku)
            const short = !inbound && line.qty > 0 && line.qty > at
            const diff = inbound ? (line.sent === null ? line.qty : line.qty - line.sent) : 0
            const qty = (
              <td className="c">
                <input
                  ref={(el) => {
                    if (el !== null) inputs.current.set(index, el)
                    else inputs.current.delete(index)
                  }}
                  className="wh-qty"
                  inputMode="numeric"
                  autoComplete="off"
                  value={String(line.qty)}
                  aria-label={`Jumlah ${name}`}
                  onMouseDown={(event) => {
                    fresh.current = document.activeElement !== event.currentTarget
                  }}
                  onMouseUp={(event) => {
                    if (!fresh.current) return
                    fresh.current = false
                    event.preventDefault()
                  }}
                  onFocus={(event) => {
                    onPick(index)
                    // Tab or a click selects the number, so digits replace it.
                    const box = event.currentTarget
                    box.select()
                    window.requestAnimationFrame(() => box.select())
                  }}
                  onChange={(event) => onQty(index, Number(event.target.value.replace(/\D/g, "").slice(0, 4) || 0))}
                  onKeyDown={(event) => onQtyKey(event, index)}
                />
              </td>
            )
            return (
              <tr key={line.sku} className={on ? "sel" : undefined} onMouseDown={keepCaret} onClick={() => onPick(index)}>
                <td className="mute num">{skuText(line.sku)}</td>
                <td>
                  <div className="nm-2">
                    <div className="nm-w">
                      <span className="nm-t">{name}</span>
                      {item !== undefined && item.variant !== "" && <span className="nm-v">{item.variant}</span>}
                    </div>
                  </div>
                </td>
                {inbound ? (
                  <>
                    <td className="c num">{line.sent ?? "—"}</td>
                    {qty}
                    <td className={diff === 0 ? "c num" : "c num wh-diff"}>
                      {diff === 0 ? "—" : diff > 0 ? `+${diff}` : String(diff)}
                    </td>
                  </>
                ) : (
                  <>
                    <td className={short ? "c num wh-short" : "c num"}>{at === Infinity ? "—" : at}</td>
                    {qty}
                    {m.why === true && (
                      <td>
                        <span className="wh-why" role="radiogroup" aria-label="Alasan">
                          {REASONS.map((reason) => (
                            <button
                              type="button"
                              key={reason}
                              className={line.why === reason ? "mchip on" : "mchip"}
                              role="radio"
                              aria-checked={line.why === reason}
                              onClick={() => onWhy(index, reason)}
                            >
                              {reason}
                            </button>
                          ))}
                        </span>
                      </td>
                    )}
                  </>
                )}
                <td className="c">
                  {on && (
                    <button type="button" className="t-rm" aria-label={`Hapus ${name}`} onClick={() => onRemove(index)}>
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/// The floating card at the foot: Kosongkan at the left, what is moving and the
/// one save key at the right.
export function EntryFoot({
  mode,
  from,
  draft,
  need,
  busy,
  canSave,
  onClear,
  onSave,
}: {
  mode: ModeId
  from: Place
  draft: Draft
  /// Lines that are short of stock or lack a reason.
  need: number
  busy: boolean
  canSave: boolean
  onClear: () => void
  onSave: () => void
}) {
  const m = MODES[mode]
  return (
    <div className="t-float">
      {draft.lines.length > 0 && (
        <button
          type="button"
          className="ds-btn ds-btn--destructive t-big t-clear"
          disabled={busy}
          aria-keyshortcuts="F6"
          onClick={onClear}
        >
          <Icon name="trash" size={16} />
          <span>Kosongkan</span>
          <span className="kbd">F6</span>
        </button>
      )}
      <span className="sp" />
      <div className="tf-total">
        <span className="tf-k">
          {routeText(from, m.to)}
          {need > 0 && (
            <>
              {" · "}
              <span className="wh-need">{need} perlu dicek</span>
            </>
          )}
        </span>
        <span className="tf-v">
          <b>{pieces(draft.lines).toLocaleString("id-ID")}</b>
          <span className="cur">pcs</span>
        </span>
      </div>
      <button
        type="button"
        className={`ds-btn ${mode === "reject" ? "ds-btn--destructive" : "ds-btn--primary"} t-pay`}
        disabled={!canSave || busy}
        aria-keyshortcuts="F12"
        onClick={onSave}
      >
        <span>
          {mode === "in"
            ? busy
              ? "Menerima…"
              : "Terima"
            : mode === "ho"
              ? busy
                ? "Mengirim…"
                : "Kirim"
              : busy
                ? "Memindahkan…"
                : "Pindahkan"}
        </span>
        <span className="kbd">F12</span>
      </button>
    </div>
  )
}

/// What the screen has to say about the last press, in the till's own strip
/// above the list: a refusal from the node, with its words.
export function Note({ bad, children }: { bad: boolean; children: ReactNode }) {
  return (
    <div className="t-msgs">
      <div className={bad ? "t-msg bad" : "t-msg"} role="status">
        <span className="grow">{children}</span>
      </div>
    </div>
  )
}

// ── toasts and the status strip ─────────────────────────────────────────

export type Toast = {
  readonly id: number
  readonly tone: "ok" | "info" | "bad"
  readonly title: string
  readonly desc?: string
}

export function Toasts({ toasts }: { toasts: readonly Toast[] }) {
  return (
    <div className="wh-toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`wh-toast ${toast.tone}`} key={toast.id}>
          <Glyph name={toast.tone === "ok" ? "ok" : "info"} />
          <div className="wh-toast-text">
            <p className="wh-toast-title">{toast.title}</p>
            {toast.desc !== undefined && <p className="wh-toast-desc">{toast.desc}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

/// The strip along the bottom, on the stone: whether the node answers, then who
/// is working, at which PC of which shop, and the clock.
export function Status({
  online,
  who,
  where,
  now,
}: {
  online: boolean | null
  who: string
  where: string
  now: Date
}) {
  return (
    <footer className="t-status">
      <span className={online === false ? "live warn" : "live"} />
      <span className={online === false ? "t-sync warn" : "t-sync"}>
        {online === false ? "Server toko tidak menjawab" : "Online · semua terkirim"}
      </span>
      <span className="sp" />
      <span>{who}</span>
      <span className="dot">·</span>
      <span>{where}</span>
      <span className="dot">·</span>
      <span className="num">{dayTime(now)}</span>
    </footer>
  )
}
