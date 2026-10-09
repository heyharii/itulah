import QRCode from "qrcode"

import { count, day } from "@/lib/format"
import { COMPANY } from "@/screens/finance-lab/print"
import { escapeHtml } from "@/screens/procurement/print"
import { titled } from "@/screens/procurement/po-print"
import { foldLines, NOT_AS_ORDERED_ROW } from "@/screens/procurement/return-lines"

/// One return on the note: its number, the order it came from, and the goods.
export interface PrintableReturn {
  readonly number: string
  readonly reason: string
  /// The order it came from, when it came from one.
  readonly reference: string | null
  readonly lines: readonly {
    readonly sku: string
    readonly name: string | null
    readonly qty: number
    readonly cost: number
    /// Pieces that are not the order's article: nobody can name them.
    readonly unknown?: boolean
  }[]
}

/// One note for one supplier (owner, 2026-10-04: "surat jalan per supplier"):
/// every return going back to them in this hand-over, each under its own number
/// and order.
export interface PrintableNote {
  readonly supplier: string
  /// Where the supplier is and their telephone, as the supplier book has
  /// them; blank where it has neither.
  readonly address?: string | null
  readonly phone?: string | null
  /// The day the note is made.
  readonly date: string
  /// The Gudang's person in charge of this delivery, named when the note is
  /// generated; blank on a note printed without one.
  readonly pic?: string | null
  readonly returns: readonly PrintableReturn[]
  /// The note's public page (`/n/{token}`, made by `useReturnNoteLink`): the
  /// QR carries it when the hub holds it. Not part of the snapshot kept on the
  /// server; a note without it prints the plain-text QR.
  readonly qrUrl?: string
}

/// The QR on the note (owner, 2026-10-10): the note's public page when the hub
/// holds its link (a scan opens the surat jalan, no login); otherwise the
/// return numbers and the order numbers as plain text — a scanner reads that
/// with no network at all.
export function noteQrText(note: PrintableNote): string {
  if (note.qrUrl) return note.qrUrl
  const returns = note.returns.map((one) => one.number).join(",")
  const orders = [
    ...new Set(
      note.returns.flatMap((one) => (one.reference ? [one.reference] : []))
    ),
  ].join(",")
  return orders === "" ? returns : `${returns}\n${orders}`
}

/// The code's modules, row by row: `true` is dark. Drawn by the print as an
/// SVG and by the PDF as filled squares, so neither waits for an image.
export function noteQr(note: PrintableNote): readonly (readonly boolean[])[] {
  // A link is long and printed small: the lowest correction keeps its modules
  // big enough to read from a phone.
  const code = QRCode.create(noteQrText(note), {
    errorCorrectionLevel: note.qrUrl ? "L" : "M",
  })
  const size = code.modules.size
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => code.modules.get(row, col) === 1)
  )
}

/// What the note says, worked out once for the print and the PDF: the orders
/// the goods came from, the items as the orders name them, and the totals.
export function noteFigures(note: PrintableNote) {
  const orders = [
    ...new Set(
      note.returns.flatMap((one) => (one.reference ? [one.reference] : []))
    ),
  ]
  return {
    orders,
    ...foldLines(note.returns.flatMap((one) => one.lines)),
    /// The name under "Hormat kami": the company, as the owner drew it.
    sender: COMPANY.name,
    /// "Notes : Pengirim (...)": the person in charge who sends the goods.
    pic: titled(note.pic ?? ""),
  }
}

/// The return delivery note (surat jalan) the Gudang hands over with the goods:
/// one A4 page, laid out as the owner drew it (2026-10-08) — and in the words he
/// wrote, Indonesian, as the supplier reads it. The title and company, the date
/// and the order numbers, "Kepada" the supplier with address and telephone, the
/// items as the order names them (no tags) with a row for pieces that are not
/// as ordered, the total, and "Hormat kami" signed by the person in charge who
/// sends it.
export function supplierReturnHtml(note: PrintableNote): string {
  const e = escapeHtml
  const figures = noteFigures(note)

  const rows = [
    ...figures.items.map((one) => ({
      name: one.name,
      sub: null as string | null,
      qty: one.qty,
    })),
    ...(figures.unknown > 0
      ? [
          {
            name: NOT_AS_ORDERED_ROW.title,
            sub: NOT_AS_ORDERED_ROW.sub as string | null,
            qty: figures.unknown,
          },
        ]
      : []),
  ]
    .map(
      (line, index) => `<tr>
  <td><div class="it"><span class="no">${index + 1}</span><div>${e(line.name)}${
    line.sub ? `<div class="sub">${e(line.sub)}</div>` : ""
  }</div></div></td>
  <td class="num">${count(line.qty)}</td>
</tr>`
    )
    .join("")

  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${e(
    `Surat jalan retur ${note.supplier}`
  )}</title><style>
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
body { font-family: Inter, -apple-system, "Segoe UI", sans-serif; font-size: 13px; color: #1d1f1a; margin: 0; }
.page { padding: 14mm 16mm; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #1d1f1a; padding-bottom: 8px; }
.company { font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.muted { color: #5b6158; }
h1 { font-size: 18px; letter-spacing: .04em; margin: 0 0 6px; }
.meta { border-collapse: collapse; flex-shrink: 0; }
.meta td { padding: 1px 0; vertical-align: top; }
.meta td:first-child { color: #5b6158; padding-right: 10px; }
.meta td:last-child { font-weight: 600; max-width: 62mm; }
.to { margin: 14px 0 12px; display: grid; grid-template-columns: auto 1fr; gap: 0 10px; }
.to .label { color: #5b6158; }
table.lines { width: 100%; border-collapse: collapse; margin-top: 6px; border: 1px solid #1d1f1a; }
table.lines th { text-align: left; font-weight: 500; color: #5b6158; border: 1px solid #1d1f1a; padding: 7px 8px; }
table.lines td { border: 1px solid #1d1f1a; padding: 9px 8px; vertical-align: top; }
table.lines .num, table.lines th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; width: 130px; }
.it { display: flex; gap: 10px; }
.it .no { width: 18px; flex-shrink: 0; }
.it .sub { color: #5b6158; }
table.lines tr.total td { font-weight: 600; padding: 9px 8px; }
table.lines tr.total td:first-child { text-align: right; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
.sign { margin-top: 26px; break-inside: avoid; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
.sign .notes { text-align: right; }
.qr svg { width: 26mm; height: 26mm; display: block; }
.sign .space { height: 70px; }
.sign .who { font-weight: 600; }
.sign .role { color: #5b6158; }
</style></head><body><section class="page">
<div class="head">
  <div>
    <h1>SURAT JALAN RETUR</h1>
    <div class="company">${e(COMPANY.name)}</div>
    <div class="muted">${e(COMPANY.address)}</div>
    ${COMPANY.phone ? `<div class="muted">${e(COMPANY.phone)}</div>` : ""}
  </div>
  <table class="meta">
    <tr><td>Tgl</td><td>: ${e(day(note.date))}</td></tr>
    <tr><td>No PO</td><td>: ${e(figures.orders.join(", ") || "—")}</td></tr>
  </table>
</div>

<div class="to">
  <div class="label">Kepada :</div>
  <div>
    <div><strong>${e(note.supplier)}</strong></div>
    ${note.address ? `<div>${e(note.address)}</div>` : ""}
    ${note.phone ? `<div>Telp. ${e(note.phone)}</div>` : ""}
  </div>
</div>

<table class="lines">
  <thead><tr>
    <th>Item</th><th class="num">Quantity</th>
  </tr></thead>
  <tbody>${rows}
    <tr class="total"><td>Total</td><td class="num">${count(figures.total)}</td></tr>
  </tbody>
</table>

<div class="sign">
  <div>
    <div>Hormat kami,</div>
    <div class="space"></div>
    <div class="who">( ${e(figures.sender)} )</div>
  </div>
  <div class="qr">${qrSvg(note)}</div>
  <div class="notes">
    <div class="role">Notes :</div>
    <div>Pengirim ( <strong>${e(figures.pic || "                    ")}</strong> )</div>
  </div>
</div>
</section></body></html>`
}

/// The note's QR as an inline SVG, in the note's ink.
function qrSvg(note: PrintableNote): string {
  const modules = noteQr(note)
  const n = modules.length
  const squares = modules
    .flatMap((cells, row) =>
      cells.flatMap((dark, col) =>
        dark ? [`<rect x="${col}" y="${row}" width="1" height="1"/>`] : []
      )
    )
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" fill="#1d1f1a" role="img" aria-label="QR">${squares}</svg>`
}
