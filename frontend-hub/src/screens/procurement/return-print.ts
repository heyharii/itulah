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
    /// The name under "Hormat kami": the person in charge who sends the goods;
    /// the company where none was named.
    sender: titled(note.pic ?? "") || COMPANY.name,
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
.sign { margin-top: 26px; break-inside: avoid; width: 220px; }
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
  <div>Hormat kami,</div>
  <div class="space"></div>
  <div class="who">( ${e(figures.sender)} )</div>
  <div class="role">Pengirim</div>
</div>
</section></body></html>`
}
