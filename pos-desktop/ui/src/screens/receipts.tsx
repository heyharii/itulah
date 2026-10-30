/// Struk in the item list (client, 25 Oct 2026: "kurangi sheet"; 28 Oct 2026:
/// never browsed). ⇧0 and ⇧8 turn the list into one box: a struk is found only by
/// its whole number — typed or scanned, then Enter — and there is no list and no
/// "last three". The receipt's pieces open in the same list, and the foot carries
/// the one thing that can be done with it: Return. There is no Void and no
/// reprint: a paid struk only comes back by Return, and a return's own struk
/// never comes back again.
///
/// The number is asked of the node (`GET /store/receipts/{no}`): it answers only
/// for the whole number (404 for anything less), and says by itself whether the
/// struk can be returned and why not. What Return does is `till.tsx`'s.

import { useEffect, useRef, useState } from "react"

import * as api from "@/api"
import { Icon } from "@/icons"
import { useListKeys } from "@/list-keys"
import { Act, dayClock, ListFoot, plain } from "@/list-parts"
import { asCount, asMap, asText } from "@/screens/exchange"

export type ReceiptPurpose = "view" | "return"

/// "Debit · BCA", "Tunai", "QRIS · Mandiri": a payment as the counter says it.
export function tenderWords(tender: api.SaleTenderRow): string {
  const method =
    tender.method === "CASH"
      ? "Tunai"
      : tender.method === "CARD"
        ? tender.card_kind === "CREDIT"
          ? "EDC Kredit"
          : "EDC Debit"
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

/// One line of a receipt as the node wrote it.
type DocLine = {
  readonly name: string
  readonly quantity: number
  /// The shelf price before a markdown, as the struk prints it.
  readonly priceMinor: number
  /// What was charged for the line after markdowns and promotions.
  readonly totalMinor: number
}

type Doc = {
  readonly lines: readonly DocLine[]
  /// What went back to the shopper in cash.
  readonly changeMinor: number
}

function readDoc(body: unknown): Doc | null {
  const doc = asMap(body)
  if (doc === null || !Array.isArray(doc.lines)) return null
  const lines: DocLine[] = []
  for (const row of doc.lines) {
    const line = asMap(row)
    if (line === null) continue
    // A return's struk has the pieces that came back in minus.
    const raw = asCount(line.quantity) ?? 1
    const quantity = raw === 0 ? 1 : raw
    const unit = asCount(line.unit_price_minor) ?? 0
    const totalMinor = asCount(line.line_total_minor) ?? unit * quantity
    const priceMinor = asCount(line.base_unit_price_minor) ?? unit
    const name = asText(line.name) ?? asText(line.sku_code) ?? "—"
    // The node's receipt lists every tag: the same article at the same price is
    // one line here.
    const same = lines.findIndex(
      (one) => one.name === name && one.priceMinor === priceMinor && Math.sign(one.quantity) === Math.sign(quantity),
    )
    if (same >= 0) {
      lines[same] = {
        ...lines[same],
        quantity: lines[same].quantity + quantity,
        totalMinor: lines[same].totalMinor + totalMinor,
      }
    } else lines.push({ name, quantity, priceMinor, totalMinor })
  }
  return { lines, changeMinor: asCount(doc.change_minor) ?? 0 }
}

function Status({ sale }: { sale: api.ReceiptLookup }) {
  return sale.status === "RETURN" ? (
    <span className="ds-status ds-status--warn">Return</span>
  ) : sale.status === "RETURNED" ? (
    <span className="ds-status ds-status--warn">Di-return</span>
  ) : sale.status === "VOIDED" ? (
    <span className="ds-status ds-status--bad">Batal</span>
  ) : (
    <span className="ds-status ds-status--ok">Lunas</span>
  )
}

const flagOf = (purpose: ReceiptPurpose) =>
  purpose === "return" ? <span className="mode-flag ret">Return</span> : <span className="mode-flag">Struk</span>

export function ReceiptsMode({
  purpose,
  open,
  live,
  busy,
  currency,
  onOpen,
  onBack,
  onReturn,
}: {
  purpose: ReceiptPurpose
  /// The struk whose pieces are shown, when one is.
  open: api.ReceiptLookup | null
  /// Nothing is drawn over the list: its keys answer.
  live: boolean
  busy: boolean
  currency: string
  onOpen: (sale: api.ReceiptLookup) => void
  /// One step back: from the pieces to the box, from the box to the sale.
  onBack: () => void
  onReturn: (sale: api.ReceiptLookup) => void
}) {
  // The typed number outlives opening a receipt and coming back.
  const [q, setQ] = useState("")
  return open === null ? (
    <ReceiptFind purpose={purpose} q={q} setQ={setQ} live={live} currency={currency} onOpen={onOpen} onBack={onBack} />
  ) : (
    <ReceiptPieces
      key={open.return_id ?? open.sale_id ?? "struk"}
      purpose={purpose}
      sale={open}
      live={live}
      busy={busy}
      currency={currency}
      onBack={onBack}
      onReturn={onReturn}
    />
  )
}

function ReceiptFind({
  purpose,
  q,
  setQ,
  live,
  currency,
  onOpen,
  onBack,
}: {
  purpose: ReceiptPurpose
  q: string
  setQ: (text: string) => void
  live: boolean
  currency: string
  onOpen: (sale: api.ReceiptLookup) => void
  onBack: () => void
}) {
  // What the last Enter found: nothing is listed, only said.
  const [said, setSaid] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )

  async function find() {
    const typed = q.trim()
    if (typed === "" || asking) return
    setAsking(true)
    setSaid(null)
    const reply = await api.receiptLookup(typed)
    if (!alive.current) return
    setAsking(false)
    if (reply.ok && reply.body !== undefined) onOpen(reply.body)
    else if (reply.status === 404) setSaid(`Tidak ada struk “${typed}”`)
    else setSaid(reply.problem ?? "Server toko tidak menjawab.")
  }

  useListKeys(live, { back: onBack })

  return (
    <>
      <div className="t-mode">
        {flagOf(purpose)}
        <label className="t-find in-mode">
          <Icon name="search" />
          <input
            value={q}
            onChange={(event) => {
              setSaid(null)
              setQ(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                event.stopPropagation()
                void find()
              } else if (event.key === "Escape" && q !== "") {
                event.stopPropagation()
                setQ("")
                setSaid(null)
              }
            }}
            placeholder="No. struk lengkap"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            aria-label="No. struk"
          />
        </label>
      </div>
      <div className="t-grid">
        <div className="t-empty">
          <p>{asking ? "Mencari struk…" : (said ?? "Ketik atau scan no. struk, lalu Enter")}</p>
        </div>
      </div>
      <ListFoot back="Kembali ke penjualan" onBack={onBack} currency={currency} />
    </>
  )
}

function ReceiptPieces({
  purpose,
  sale,
  live,
  busy,
  currency,
  onBack,
  onReturn,
}: {
  purpose: ReceiptPurpose
  sale: api.ReceiptLookup
  live: boolean
  busy: boolean
  currency: string
  onBack: () => void
  onReturn: (sale: api.ReceiptLookup) => void
}) {
  // The paper the node wrote comes with the answer: nothing more to ask.
  const doc = readDoc(sale.receipt)
  const head = asMap(sale.receipt)
  const no = asText(head?.receipt_no) ?? ""
  const at = asText(head?.completed_at)
  const cashier = asText(head?.cashier)
  const total = asCount(head?.total_minor) ?? 0
  const tenders = (Array.isArray(head?.tenders) ? head.tenders : []).flatMap((row) => {
    const one = asMap(row)
    const amount = one === null ? null : asCount(one.amount_minor)
    if (one === null || amount === null) return []
    return [
      {
        method: asText(one.method) ?? "",
        amount_minor: amount,
        card_kind: asText(one.card_kind),
        acquirer: asText(one.acquirer),
        reference: asText(one.reference),
      } satisfies api.SaleTenderRow,
    ]
  })

  // Whether it can be returned is the node's word, with its sentence.
  const actable = sale.returnable
  useListKeys(live, {
    back: onBack,
    enter: !actable || busy ? undefined : () => onReturn(sale),
  })

  const pays = tenders
    .map((one) => `${tenderWords(one).replace(" · ", " ")} ${plain(one.amount_minor, currency)}`)
    .join(" · ")
  const by = sale.return_by === null ? null : dayOf(sale.return_by)

  return (
    <>
      <div className="t-mode">
        {flagOf(purpose)}
        <span className="mute num">{no}</span>
      </div>
      <div className="t-grid">
        <div className="hg-band">
          <p className="rg-facts">
            <Status sale={sale} />
            {at !== null && <span>{dayClock(new Date(at))}</span>}
            {cashier !== null && <span>{cashier}</span>}
            {pays !== "" && <span>{pays}</span>}
            {by !== null && <span>Bisa ditukar s/d {by}</span>}
            {sale.returned_in.length > 0 && (
              <span>Return: {sale.returned_in.map((one) => one.receipt_no ?? "—").join(", ")}</span>
            )}
          </p>
          {!actable && sale.refusal !== null && <p className="rg-facts">{sale.refusal}</p>}
        </div>
        {doc === null ? (
          <div className="t-empty">
            <p>{`Struk ${no} tidak terbaca`}</p>
          </div>
        ) : (
          <table>
            <colgroup>
              <col style={{ width: 64 }} />
              <col />
              <col style={{ width: 104 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 150 }} />
            </colgroup>
            <thead>
              <tr>
                <th />
                <th>Barang</th>
                <th className="c">Jumlah</th>
                <th className="r">Harga</th>
                <th className="r">Diskon</th>
                <th className="r">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line, index) => {
                const cut = Math.max(0, line.priceMinor * line.quantity - line.totalMinor)
                return (
                  <tr key={index}>
                    <td className="mute num">{index + 1}</td>
                    <td>
                      <span className="nm-t">{line.name}</span>
                    </td>
                    <td className="c num">{line.quantity}</td>
                    <td className="r">{plain(line.priceMinor, currency)}</td>
                    <td className={cut > 0 ? "r disc" : "r faint"}>{cut > 0 ? `−${plain(cut, currency)}` : "—"}</td>
                    <td className="r b">{plain(line.totalMinor, currency)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <ListFoot
        back="Cari struk"
        onBack={onBack}
        label={`Struk · ${doc === null ? 0 : doc.lines.reduce((sum, one) => sum + Math.abs(one.quantity), 0)} pcs`}
        minor={total}
        currency={currency}
      >
        <Act main label="Return" disabled={!actable || busy} onClick={() => onReturn(sale)} />
      </ListFoot>
    </>
  )
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
/// `2026-11-04` as "4 Nov 2026".
function dayOf(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m === null ? null : `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}
