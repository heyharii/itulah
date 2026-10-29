/// F9 Cek stok and F10 Riwayat: the item list turned into a list of what the
/// shop holds, or of what was moved (client, 25 Oct 2026: "kurangi sheet" — no
/// dialog, no sheet). Nothing is added to the move being built. Esc steps back
/// one level, from a move's lines to the list, from the list to the moves.
///
/// Both are the till's own list modes (`screens/check.tsx`, `screens/receipts.tsx`)
/// with other columns: a search at the right of the mode row, the table, and a
/// foot with the way back.

import { useEffect, useMemo, useState } from "react"

import * as api from "@/gudang/api"
import type { Item } from "@/gudang/book"
import { PLACE, dayClock, dayTime, routeText, when } from "@/gudang/model"
import { keepCaret } from "@/gudang/views"
import { Icon } from "@/icons"
import { useListKeys } from "@/list-keys"
import { Act, ListFoot } from "@/list-parts"
import { sku as skuText } from "@/sku"

const POLL_MS = 10_000

const Name = ({ sku, item, fallback }: { sku: string; item: Item | undefined; fallback?: string | null }) => (
  <div className="nm-2">
    <div className="nm-w">
      <span className="nm-t">{item?.name ?? fallback ?? skuText(sku)}</span>
      {item !== undefined && item.variant !== "" && <span className="nm-v">{item.variant}</span>}
    </div>
  </div>
)

// ── F9 ──────────────────────────────────────────────────────────────────

/// Every SKU the shop holds in the three rooms, with the search of the mode
/// row. A SKU with nothing anywhere has no row to show.
export function CheckMode({
  stock,
  items,
  live,
  onBack,
}: {
  stock: ReadonlyMap<string, api.Held> | null
  items: ReadonlyMap<string, Item>
  live: boolean
  onBack: () => void
}) {
  const [q, setQ] = useState("")
  useListKeys(live, { back: onBack })

  const needle = q.trim().toLowerCase().replace(/[·\s]/g, "")
  const rows = useMemo(() => {
    if (stock === null) return null
    const out = [...stock.values()]
      .filter((row) => row.warehouse + row.floor + (row.reject ?? 0) > 0)
      .map((row) => ({ row, item: items.get(row.sku_code) }))
      .filter(
        ({ row, item }) =>
          needle === "" ||
          row.sku_code.includes(needle) ||
          `${item?.name ?? ""}${item?.variant ?? ""}`.toLowerCase().replace(/[·\s]/g, "").includes(needle),
      )
    out.sort((a, b) => (a.item?.name ?? a.row.sku_code).localeCompare(b.item?.name ?? b.row.sku_code) || a.row.sku_code.localeCompare(b.row.sku_code))
    return out.slice(0, 200)
  }, [stock, items, needle])

  return (
    <>
      <div className="t-mode">
        <span className="mode-flag">Cek stok</span>
        <label className="t-find in-mode">
          <Icon name="search" size={16} />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && q !== "") {
                event.stopPropagation()
                setQ("")
              }
            }}
            placeholder="SKU atau nama barang"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            aria-label="Cari stok"
          />
        </label>
      </div>
      {rows === null || rows.length === 0 ? (
        <div className="t-grid">
          <div className="t-empty">
            <p>
              {rows === null
                ? "Memuat stok…"
                : needle !== ""
                  ? `Tidak ada yang cocok dengan “${q.trim()}”`
                  : "Belum ada stok"}
            </p>
          </div>
        </div>
      ) : (
        <div className="t-grid">
          <table>
            <colgroup>
              <col style={{ width: 170 }} />
              <col />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
            </colgroup>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Barang</th>
                <th className="r">Gudang</th>
                <th className="r">Toko</th>
                <th className="r">Reject</th>
                <th className="r">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, item }) => {
                const reject = row.reject ?? 0
                return (
                  <tr key={row.sku_code}>
                    <td className="mute num">{skuText(row.sku_code)}</td>
                    <td>
                      <Name sku={row.sku_code} item={item} />
                    </td>
                    <td className="r num">{row.warehouse}</td>
                    <td className="r num">{row.floor}</td>
                    <td className={reject > 0 ? "r num wh-short" : "r num"}>{reject}</td>
                    <td className="r b">{row.warehouse + row.floor + reject}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <ListFoot back="Kembali" onBack={onBack} currency="IDR" />
    </>
  )
}

// ── F10 ─────────────────────────────────────────────────────────────────

const byName = (move: api.Moved) => move.actor_name ?? move.actor_id

/// What was moved, newest first; a row opens its lines. `open` is the number
/// of the move shown, kept by the screen so F10 and Esc can step back out of it.
export function HistoryMode({
  open,
  live,
  items,
  printing,
  learn,
  onOpen,
  onBack,
  onPrint,
}: {
  open: string | null
  live: boolean
  items: ReadonlyMap<string, Item>
  printing: boolean
  /// Names for the SKUs a move carries that the book lacks.
  learn: (skus: readonly string[]) => Promise<void>
  onOpen: (number: string) => void
  /// One step back: from the lines to the list, from the list to the moves.
  onBack: () => void
  onPrint: (number: string) => void
}) {
  // The search outlives opening a move and coming back to the list.
  const [q, setQ] = useState("")
  return open === null ? (
    <HistoryList q={q} setQ={setQ} live={live} onOpen={onOpen} onBack={onBack} />
  ) : (
    <HistoryLines
      key={open}
      number={open}
      live={live}
      items={items}
      printing={printing}
      learn={learn}
      onBack={onBack}
      onPrint={onPrint}
    />
  )
}

function HistoryList({
  q,
  setQ,
  live,
  onOpen,
  onBack,
}: {
  q: string
  setQ: (text: string) => void
  live: boolean
  onOpen: (number: string) => void
  onBack: () => void
}) {
  // Null until the node has answered.
  const [loaded, setLoaded] = useState<{ readonly rows: readonly api.Moved[]; readonly problem: string | null } | null>(null)
  // The row ↑ ↓ point at; none until a key moves it.
  const [at, setAt] = useState<number | null>(null)
  const text = q.trim()

  // The node searches (a number, a surat jalan, a SKU, a name); asked again
  // every ten seconds and a beat after the typing stops.
  useEffect(() => {
    let alive = true
    const ask = () =>
      void api.moves(text).then((reply) => {
        if (!alive) return
        if (!reply.ok) {
          setLoaded((was) => ({ rows: was?.rows ?? [], problem: api.said(reply.problem, "Server toko tidak menjawab.") }))
          return
        }
        setLoaded({ rows: reply.body?.items ?? [], problem: null })
      })
    const typed = window.setTimeout(ask, text === "" ? 0 : 250)
    const timer = window.setInterval(ask, POLL_MS)
    return () => {
      alive = false
      window.clearTimeout(typed)
      window.clearInterval(timer)
    }
  }, [text])

  const list = loaded?.rows ?? []
  useListKeys(live, {
    back: onBack,
    enter: () => {
      const one = list[at ?? -1]
      if (one !== undefined) onOpen(one.number)
    },
    move: (by) => setAt((was) => Math.max(0, Math.min(list.length - 1, (was ?? (by === 1 ? -1 : list.length)) + by))),
  })

  return (
    <>
      <div className="t-mode">
        <span className="mode-flag">Riwayat</span>
        <label className="t-find in-mode">
          <Icon name="search" size={16} />
          <input
            value={q}
            onChange={(event) => {
              setAt(null)
              setQ(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                event.stopPropagation()
                const one = list[at ?? 0]
                if (one !== undefined) onOpen(one.number)
              } else if (event.key === "Escape" && q !== "") {
                event.stopPropagation()
                setQ("")
              }
            }}
            placeholder="No., SKU atau nama"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            aria-label="Cari pindahan"
          />
        </label>
      </div>
      {list.length === 0 ? (
        <div className="t-grid">
          <div className="t-empty">
            <p>
              {loaded === null
                ? "Memuat pindahan…"
                : loaded.problem !== null
                  ? loaded.problem
                  : text !== ""
                    ? `Tidak ada “${text}”`
                    : "Belum ada pindahan"}
            </p>
          </div>
        </div>
      ) : (
        <div className="t-grid">
          <table>
            <colgroup>
              <col style={{ width: 150 }} />
              <col style={{ width: 170 }} />
              <col />
              <col />
              <col style={{ width: 110 }} />
            </colgroup>
            <thead>
              <tr>
                <th>No.</th>
                <th>Waktu</th>
                <th>Pindah</th>
                <th>Oleh</th>
                <th className="c">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {list.map((move, index) => (
                <tr
                  key={move.number}
                  className={index === at ? "go at" : "go"}
                  onMouseDown={keepCaret}
                  onClick={() => onOpen(move.number)}
                >
                  <td className="num">{move.number}</td>
                  <td className="num">{when(move.occurred_at, dayClock)}</td>
                  <td>
                    <span className="wh-route">
                      {PLACE[move.from]}
                      <Icon name="arrow" size={16} />
                      {PLACE[move.to]}
                    </span>
                  </td>
                  <td>{byName(move)}</td>
                  <td className="c num">{move.pieces}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ListFoot back="Kembali" onBack={onBack} currency="IDR" />
    </>
  )
}

/// One move opened: its lines, who did it and when, and the surat jalan to
/// print — Enter prints it.
function HistoryLines({
  number,
  live,
  items,
  printing,
  learn,
  onBack,
  onPrint,
}: {
  number: string
  live: boolean
  items: ReadonlyMap<string, Item>
  printing: boolean
  learn: (skus: readonly string[]) => Promise<void>
  onBack: () => void
  onPrint: (number: string) => void
}) {
  const [move, setMove] = useState<api.Moved | string | null>(null)
  useEffect(() => {
    let alive = true
    void api.moveOf(number).then((reply) => {
      if (!alive) return
      const found = reply.ok ? reply.body : null
      if (found === null || found === undefined) {
        // A move that is not there says so in the node's words.
        setMove(api.said(reply.problem, `${number} tidak terbaca`))
        return
      }
      setMove(found)
      void learn((found.lines ?? []).map((line) => line.sku_code))
    })
    return () => {
      alive = false
    }
  }, [number, learn])

  useListKeys(live, {
    back: onBack,
    enter: move === null || typeof move === "string" || printing ? undefined : () => onPrint(number),
  })

  // A receipt of goods says what was sent beside what was counted; every other
  // move says why.
  const received = move !== null && typeof move !== "string" && move.kind === "RECEIVE"
  return (
    <>
      <div className="t-mode">
        <span className="mode-flag">Riwayat</span>
        <span className="mute num">
          {number}
          {move !== null && typeof move !== "string" && ` · ${routeText(move.from, move.to)}`}
        </span>
      </div>
      <div className="t-grid">
        {move === null || typeof move === "string" ? (
          <div className="t-empty">
            <p>{move === null ? "Memuat pindahan…" : move}</p>
          </div>
        ) : (
          <>
            <div className="hg-band">
              <p className="rg-facts">
                <span className="wh-route">
                  {PLACE[move.from]}
                  <Icon name="arrow" size={16} />
                  {PLACE[move.to]}
                </span>
                <span>{when(move.occurred_at, dayTime)}</span>
                <span>{byName(move)}</span>
                {move.reference !== null && <span className="num">{move.reference}</span>}
                {typeof move.approved_by_name === "string" && move.approved_by_name !== "" && (
                  <span>Disetujui {move.approved_by_name}</span>
                )}
              </p>
            </div>
            <table>
              <colgroup>
                <col style={{ width: 64 }} />
                <col style={{ width: 170 }} />
                <col />
                <col style={{ width: 110 }} />
                <col style={{ width: 180 }} />
              </colgroup>
              <thead>
                <tr>
                  <th />
                  <th>SKU</th>
                  <th>Barang</th>
                  <th className="c">Jumlah</th>
                  <th className={received ? "c" : undefined}>{received ? "Dikirim" : "Alasan"}</th>
                </tr>
              </thead>
              <tbody>
                {(move.lines ?? []).map((line, index) => (
                  <tr key={line.line_no}>
                    <td className="mute num">{index + 1}</td>
                    <td className="mute num">{skuText(line.sku_code)}</td>
                    <td>
                      <Name sku={line.sku_code} item={items.get(line.sku_code)} fallback={line.name} />
                    </td>
                    <td className="c num">{line.quantity}</td>
                    {received ? (
                      <td className="c num">{line.sent ?? <span className="faint">—</span>}</td>
                    ) : (
                      <td>{line.reason !== null ? line.reason : <span className="faint">—</span>}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      <ListFoot back="Riwayat" onBack={onBack} currency="IDR">
        <Act
          main
          label={printing ? "Mencetak…" : "Cetak surat jalan"}
          disabled={move === null || typeof move === "string" || printing}
          onClick={() => onPrint(number)}
        />
      </ListFoot>
    </>
  )
}
