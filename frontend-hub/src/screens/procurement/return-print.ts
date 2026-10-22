import { count, day } from "@/lib/format"
import { COMPANY } from "@/screens/finance-lab/print"
import { escapeHtml } from "@/screens/procurement/print"
import { paperShape, titled, type Paper } from "@/screens/procurement/po-print"
import {
  foldLines,
  NOT_AS_ORDERED_PAPER_ROW,
  UNKNOWN_NOTE,
} from "@/screens/procurement/return-lines"

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
  /// A few words per item, by article code (`UNKNOWN_NOTE` for the
  /// not-as-ordered pieces); none required.
  readonly notes?: Readonly<Record<string, string>>
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
  /// The note's own number (0969: "2026-1"), given with its link; printed
  /// above the Tgl. Absent until the link is made.
  readonly number?: string
  /// The stamp a finished return wears, with its day (owner, 2026-10-16):
  /// Completed, or Closed short. Absent while it is still open.
  readonly stamp?: { readonly word: string; readonly at: string | null }
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
    /// Each item's note, the returns' together.
    notes: Object.assign(
      {},
      ...note.returns.map((one) => one.notes ?? {})
    ) as Readonly<Record<string, string>>,
    /// The name under "Hormat kami": the company, as the owner drew it.
    sender: COMPANY.name,
    /// "PIC : ...", under the table: the person in charge who sends the
    /// goods.
    pic: titled(note.pic ?? ""),
  }
}

/// The return delivery note (surat jalan) the Gudang hands over with the goods:
/// laid out as the owner drew it (2026-10-08, 2026-10-16) — and in the words he
/// wrote, Indonesian, as the supplier reads it. The title and company, the
/// note's number, the date and the order numbers, "Kepada" the supplier with
/// address and telephone, the items as the order names them (no tags) with a
/// row for pieces that are not as ordered, in pieces, the total, the person in
/// charge who sends it, and "Hormat kami" beside "Penerima".
///
/// Two A4 pages, both signed by the supplier as Penerima: the one the Gudang
/// keeps, then the SUPPLIER COPY, stamped across like the PO's stamp, which
/// the supplier takes away.
export function supplierReturnHtml(
  note: PrintableNote,
  paper: Paper = "A4-portrait"
): string {
  const { size, portrait } = paperShape(paper)
  const small = size === "A5"
  const e = escapeHtml
  const figures = noteFigures(note)
  const pcs = (n: number) => `${count(n)} pcs`

  const rows = [
    ...figures.items.map((one) => ({
      name: one.name,
      sub: one.sku as string | null,
      note: figures.notes[one.sku] ?? "",
      qty: one.qty,
    })),
    ...(figures.unknown > 0
      ? [
          {
            name: NOT_AS_ORDERED_PAPER_ROW.title,
            sub: NOT_AS_ORDERED_PAPER_ROW.sub as string | null,
            note: figures.notes[UNKNOWN_NOTE] ?? "",
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
  <td class="nt">${e(line.note)}</td>
  <td class="num">${pcs(line.qty)}</td>
</tr>`
    )
    .join("")

  const page = (copy: boolean) => `<section class="page">
${note.stamp === undefined ? "" : `<div class="stamp">${e(note.stamp.word)}${note.stamp.at === null ? "" : `<span>${e(day(note.stamp.at))}</span>`}</div>`}
${copy ? `<div class="copy">SUPPLIER COPY</div>` : ""}
<div class="head">
  <div>
    <h1>SURAT JALAN RETUR</h1>
    <div class="company">${e(COMPANY.name)}</div>
    <div class="muted">${e(COMPANY.address)}</div>
    ${COMPANY.phone ? `<div class="muted">${e(COMPANY.phone)}</div>` : ""}
  </div>
  <table class="meta">
    ${note.number ? `<tr><td>No</td><td>: ${e(note.number)}</td></tr>` : ""}
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
    <th>Item</th><th class="nt">Keterangan</th><th class="num">Quantity</th>
  </tr></thead>
  <tbody>${rows}
    <tr class="total"><td colspan="2">Total</td><td class="num">${pcs(figures.total)}</td></tr>
  </tbody>
</table>
<div class="sender"><span class="muted">PIC :</span> <strong>${e(figures.pic)}</strong></div>

<div class="sign">
  <div class="pair">
    <div>
      <div>Hormat kami,</div>
      <div class="space"></div>
      <div class="who">( ${e(figures.sender)} )</div>
    </div>
    <div>
      <div>Penerima,</div>
      <div class="space"></div>
      <div class="who">( ${e(note.supplier)} )</div>
    </div>
  </div>
</div>
</section>`

  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${e(
    `Surat jalan retur ${note.supplier}`
  )}</title><style>
@page { size: ${size} ${portrait ? "portrait" : "landscape"}; margin: 0; }
* { box-sizing: border-box; }
body { font-family: Inter, -apple-system, "Segoe UI", sans-serif; font-size: ${small ? (portrait ? 11 : 10) : 13}px; color: #1d1f1a; margin: 0; }
.page { padding: ${small ? "9mm 10mm" : "14mm 16mm"}; position: relative; break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
.stamp { position: absolute; top: 16mm; left: 50%; transform: translateX(-30%) rotate(-6deg); border: 3px solid #78b896; color: #78b896; border-radius: 6px; padding: 2px 12px; font-size: 20px; font-weight: 700; letter-spacing: .12em; text-align: center; opacity: .8; pointer-events: none; }
.stamp span { display: block; font-size: 13px; letter-spacing: .04em; }
/* The supplier's copy, stamped across as the PO's stamp is: tilted, no day. */
.copy { position: absolute; top: 33mm; right: 22mm; transform: rotate(-12deg); border: 3px solid #2f5fd0; color: #2f5fd0; border-radius: 6px; padding: 2px 12px; font-size: 22px; font-weight: 700; letter-spacing: .12em; opacity: .55; pointer-events: none; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #1d1f1a; padding-bottom: 8px; }
.company { font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.muted { color: #5b6158; }
h1 { font-size: ${small ? 15 : 18}px; letter-spacing: .04em; margin: 0 0 6px; }
.meta { border-collapse: collapse; flex-shrink: 0; }
.meta td { padding: 1px 0; vertical-align: top; }
.meta td:first-child { color: #5b6158; padding-right: 10px; }
.meta td:last-child { font-weight: 600; max-width: 62mm; }
.to { margin: 14px 0 12px; display: grid; grid-template-columns: auto 1fr; gap: 0 10px; }
.to .label { color: #5b6158; }
table.lines { width: 100%; border-collapse: collapse; margin-top: 6px; border: 1px solid #1d1f1a; }
table.lines th { text-align: left; font-weight: 500; color: #5b6158; border: 1px solid #1d1f1a; padding: 7px 8px; }
table.lines td { border: 1px solid #1d1f1a; padding: ${small ? 5 : 9}px 8px; vertical-align: top; }
table.lines .num, table.lines th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; width: 30mm; }
.it { display: flex; gap: 10px; }
.it .no { width: 18px; flex-shrink: 0; }
.it .sub { color: #5b6158; }
table.lines .nt { width: 42mm; color: #1d1f1a; }
table.lines tr.total td { font-weight: 600; padding: 9px 8px; }
table.lines tr.total td:first-child { text-align: right; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
.sender { margin-top: 10px; }
.sign { margin-top: calc(${small ? 8 : 22}px + 2.6em); break-inside: avoid; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
/* Hormat kami beside Penerima at the right, two lines lower (owner, 2026-10-18). */
.sign .pair { display: flex; justify-content: flex-end; gap: 10mm; width: 100%; }
.sign .pair > div { width: 50mm; }
.sign .pair > div:last-child { text-align: right; }
.sign .space { height: ${small ? 34 : 70}px; }
.sign .who { font-weight: 600; }
</style></head><body>
${page(false)}
${page(true)}
</body></html>`
}
