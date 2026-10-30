/// ⇧2 · Cek in the item list (client, 25 Oct 2026: "kurangi sheet"): what an
/// article costs and how many the shop holds, or what a coupon, a voucher or a
/// member card holds. Nothing is added to the sale. The search box takes a name,
/// a SKU or a scanned tag as the shopper's garment would be found; Enter on a
/// code that is no article asks the node whether it is a coupon, then head
/// office whether it is a voucher, or a member.

import { useEffect, useMemo, useRef, useState } from "react"

import * as api from "@/api"
import { Icon, type IconName } from "@/icons"
import { useListKeys } from "@/list-keys"
import { ListFoot, plain } from "@/list-parts"
import { sku as skuText } from "@/sku"
import { memberFromScan } from "@/screens/member"
import { readScan } from "@epc"
import { units as grouped } from "@itulah/contract/money"

/// The articles a typed word matches: part of a name, or the SKU — whole, with
/// or without its dot (00000001·104), or any part of it such as the 8-digit
/// article code. The scan field's search and ⇧2 read the book the same way.
export function matchRows(rows: readonly api.CatalogRow[], text: string): api.CatalogRow[] {
  const needle = text.toLowerCase()
  const digits = text.replace(/[·.\s-]/g, "")
  const bySkuPart = /^\d{3,}$/.test(digits)
  return rows.filter(
    (row) => row.name.toLowerCase().includes(needle) || (bySkuPart && row.sku_code.includes(digits)),
  )
}

/// Whether text that matched no item could be a voucher's code: six to thirty-
/// two letters and digits once the spaces and dashes a printed card is read
/// with are taken out (`normalize_code` in `backend/src/cloud/domain/voucher.rs`).
function looksLikeVoucher(text: string): boolean {
  if (!/^[A-Za-z0-9 _-]+$/.test(text)) return false
  const squeezed = text.replace(/[ _-]/g, "")
  return squeezed.length >= 6 && squeezed.length <= 32
}

/// A mobile number, or the card the member app prints (`M1:` and the number).
const looksLikeMember = (text: string) =>
  /^(\+?62|0)8\d{7,11}$/.test(text.replace(/[\s-]/g, "")) || memberFromScan(text) !== null

/// "31 Dec 2026".
function shortDate(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
}

/// "GIFT_CARD" → "Gift card".
const VOUCHER_WORDS: Readonly<Record<string, string>> = {
  GIFT_CARD: "Gift card",
  REFUND: "Refund",
  GOODWILL: "Komplimen",
  SPENT: "Terpakai",
  VOIDED: "Void",
}

function wordsOf(code: string): string {
  const known = VOUCHER_WORDS[code.toUpperCase()]
  if (known !== undefined) return known
  const text = code.replace(/_/g, " ").toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/// What a coupon's code looks like: one word of letters, digits, dashes and
/// underscores, with at least one letter.
const looksLikeCoupon = (text: string) => /^[A-Za-z0-9_-]{3,32}$/.test(text) && /[A-Za-z]/.test(text)

/// How the node answers a code it has no coupon for (a 200, not a 404).
const UNKNOWN_COUPON = "Kupon tidak dikenal di toko ini"

/// "0812 •••• 7788": a phone's middle is not for the shopper behind to read.
const maskPhone = (id: string) => (/^\d{8,}$/.test(id) ? `${id.slice(0, 4)} •••• ${id.slice(-4)}` : id)

type Found =
  | { readonly kind: "asking" }
  | { readonly kind: "coupon"; readonly coupon: api.CouponInfo }
  | { readonly kind: "voucher"; readonly voucher: api.VoucherCheck }
  | { readonly kind: "member"; readonly member: api.Member }
  | { readonly kind: "none"; readonly text: string }

/// What a voucher or a member holds, as a card in the list.
function Card({
  icon,
  title,
  sub,
  figure,
  unit,
}: {
  icon: IconName
  title: string
  sub: string
  figure: string
  unit: string
}) {
  return (
    <div className="chk">
      <span className="chk-ic">
        <Icon name={icon} />
      </span>
      <span className="chk-t">
        <b>{title}</b>
        <span>{sub}</span>
      </span>
      <span className="chk-v">
        {figure}
        <span>{unit}</span>
      </span>
    </div>
  )
}

export function CheckMode({
  rows,
  live,
  currency,
  onBack,
  onAdd,
}: {
  rows: readonly api.CatalogRow[]
  live: boolean
  currency: string
  onBack: () => void
  /// "+" on a row: one piece of it into the basket, as typing its SKU does
  /// (Hari, 30 Oct 2026: no picking the row first).
  onAdd?: (row: api.CatalogRow) => void
}) {
  const [q, setQ] = useState("")
  const [found, setFound] = useState<Found | null>(null)
  const asked = useRef(0)
  // Pieces on the selling floor by SKU; null while unknown or when the node
  // would not say.
  const [stock, setStock] = useState<ReadonlyMap<string, number> | null>(null)
  useEffect(() => {
    let alive = true
    const read = () =>
      void api.skuStock().then((reply) => {
        if (!alive || !reply.ok) return
        setStock(new Map((reply.body?.items ?? []).map((one) => [one.sku_code, one.floor] as const)))
      })
    read()
    const timer = window.setInterval(read, 15_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])
  useListKeys(live, { back: onBack })

  const bySku = useMemo(() => new Map(rows.map((row) => [row.sku_code, row] as const)), [rows])
  const text = q.trim()
  const list = useMemo(() => {
    if (text === "") return rows.slice(0, 50)
    // A tag held up to the reader, or a SKU typed whole, is that one article.
    const tag = readScan(text.replace(/·/g, ""))
    const one = tag.kind === "epc" || tag.kind === "sku" ? bySku.get(tag.sku_code) : undefined
    return one !== undefined ? [one] : matchRows(rows, text).slice(0, 50)
  }, [rows, bySku, text])

  /// Enter on a code that is no article: a member, or a coupon at this store,
  /// or a voucher at head office.
  async function lookup() {
    if (text === "" || (list.length > 0 && !looksLikeMember(text))) return
    const ask = ++asked.current
    const none = (said: string) => ask === asked.current && setFound({ kind: "none", text: said })
    if (looksLikeMember(text)) {
      setFound({ kind: "asking" })
      const reply = await api.lookupMember(memberFromScan(text) ?? text.replace(/[\s-]/g, ""))
      if (ask !== asked.current) return
      if (reply.ok && reply.body) setFound({ kind: "member", member: reply.body })
      else
        none(
          reply.status === 404
            ? `Tidak ada member “${text}”.`
            : (reply.problem ?? "Kantor pusat tidak menjawab untuk member itu."),
        )
      return
    }
    setFound({ kind: "asking" })
    if (looksLikeCoupon(text)) {
      const reply = await api.couponInfo(text)
      if (ask !== asked.current) return
      // An unknown code is a 200 with its own sentence: the code may still be
      // a voucher's.
      if (reply.ok && reply.body && !(reply.body.valid === false && reply.body.reason === UNKNOWN_COUPON)) {
        setFound({ kind: "coupon", coupon: reply.body })
        return
      }
    }
    if (!looksLikeVoucher(text)) {
      none(`Tidak ada yang cocok dengan “${text}”`)
      return
    }
    const reply = await api.checkVoucher(text)
    if (ask !== asked.current) return
    if (reply.ok && reply.body) setFound({ kind: "voucher", voucher: reply.body })
    else
      none(
        reply.status === 404
          ? `Tidak ada barang, kupon atau voucher “${text}”.`
          : (reply.problem ?? "Kantor pusat tidak menjawab untuk voucher itu."),
      )
  }

  const card = (() => {
    if (found === null) return null
    if (found.kind === "member") {
      return (
        <Card
          icon="user"
          title={found.member.display_name}
          sub={`${maskPhone(found.member.member_id)}${found.member.blocked ? " · Diblokir" : ""}`}
          figure={grouped(found.member.points_balance)}
          unit="poin"
        />
      )
    }
    if (found.kind === "coupon") {
      const c = found.coupon
      return (
        <>
          <Card
            icon="tag"
            title={`${c.name} · ${c.code}`}
            sub={c.what}
            figure={c.valid ? "Berlaku" : "Tidak berlaku"}
            unit={c.valid_until === null ? "tanpa batas waktu" : `s.d. ${shortDate(c.valid_until)}`}
          />
          {/* A reason on a valid coupon ("Khusus member") is a note, not a refusal. */}
          {(c.reason ?? "") !== "" && <p className={c.valid ? "hold-warn" : "hold-warn over"}>{c.reason}</p>}
        </>
      )
    }
    if (found.kind === "voucher") {
      const v = found.voucher
      const active = v.status.toUpperCase() === "ACTIVE"
      return (
        <Card
          icon="voucher"
          title={`${wordsOf(v.kind)} · ${v.code}`}
          sub={`${
            v.expires_at === null
              ? "Tanpa batas waktu"
              : `${v.expired ? "Kedaluwarsa" : "Berlaku s.d."} ${shortDate(v.expires_at)}`
          }${v.member_name !== null ? ` · ${v.member_name}` : ""}`}
          figure={plain(v.balance_minor, currency)}
          unit={v.expired ? "Kedaluwarsa" : active ? "saldo" : wordsOf(v.status)}
        />
      )
    }
    return null
  })()

  // What stands in the list when it is no table of articles.
  const said =
    found === null
      ? list.length > 0
        ? null
        : text === ""
          ? "Belum ada daftar harga"
          : /^\d{11}$/.test(text.replace(/[·.\s-]/g, ""))
            ? `SKU ${skuText(text.replace(/[·.\s-]/g, ""))} tidak dijual di toko ini.`
            : `Tidak ada yang cocok dengan “${text}”`
      : found.kind === "asking"
        ? "Mengecek…"
        : found.kind === "none"
          ? found.text
          : null

  return (
    <>
      <div className="t-mode">
        <span className="mode-flag">Cek</span>
        <label className="t-find in-mode">
          <Icon name="search" />
          <input
            value={q}
            onChange={(event) => {
              asked.current += 1
              setFound(null)
              setQ(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                event.stopPropagation()
                void lookup()
              } else if (event.key === "Escape" && q !== "") {
                event.stopPropagation()
                setQ("")
                setFound(null)
              }
            }}
            placeholder="SKU, voucher, kupon atau member"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            aria-label="Cek"
          />
        </label>
      </div>
      {card !== null ? (
        <div className="t-grid">
          <div className="hg-band">{card}</div>
        </div>
      ) : said !== null ? (
        <div className="t-grid">
          <div className="t-empty">
            <p>{said}</p>
          </div>
        </div>
      ) : (
        <div className="t-grid">
          <table>
            <colgroup>
              <col style={{ width: 190 }} />
              <col />
              <col style={{ width: 150 }} />
              <col style={{ width: 120 }} />
              {onAdd !== undefined && <col style={{ width: 72 }} />}
            </colgroup>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Barang</th>
                <th className="r">Harga</th>
                <th className="r">Stok</th>
                {onAdd !== undefined && <th />}
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.sku_code}>
                  <td className="mute num">{skuText(row.sku_code)}</td>
                  <td>
                    <span className="nm-t">{row.name}</span>
                  </td>
                  <td className="r">{row.unit_price_minor > 0 ? plain(row.unit_price_minor, currency) : "Gratis"}</td>
                  <td className="r b">{stock === null ? "—" : (stock.get(row.sku_code) ?? 0)}</td>
                  {onAdd !== undefined && (
                    <td className="c">
                      <button
                        type="button"
                        className="ck-add"
                        aria-label={`Tambah ${row.name}`}
                        onClick={() => onAdd(row)}
                      >
                        +
                      </button>
                    </td>
                  )}
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
