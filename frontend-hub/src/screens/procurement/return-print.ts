import { count, day } from "@/lib/format"
import { COMPANY } from "@/screens/finance-lab/print"
import { escapeHtml } from "@/screens/procurement/print"
import { titled } from "@/screens/procurement/po-print"

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
  }[]
}

/// One note for one supplier (owner, 2026-10-04: "surat jalan per supplier"):
/// every return going back to them in this hand-over, each under its own number
/// and order.
export interface PrintableNote {
  readonly supplier: string
  /// The day the note is made.
  readonly date: string
  /// The Gudang's person in charge of this delivery, named when the note is
  /// generated; blank on a note printed without one.
  readonly pic?: string | null
  readonly returns: readonly PrintableReturn[]
}

/// The return delivery note (surat jalan) the Gudang hands over with the goods,
/// and the supplier signs for: one A4 page, in English like every printed
/// document (owner, 2026-10-04). The supplier's signature block is the point of
/// it — name, signature and stamp, and the date they took the goods — because
/// the note is the proof the goods left in the quantities it says.
export function supplierReturnHtml(note: PrintableNote): string {
  const e = escapeHtml
  const pieces = note.returns.reduce(
    (sum, one) => sum + one.lines.reduce((inner, line) => inner + line.qty, 0),
    0
  )

  const items = note.returns.reduce((sum, one) => sum + one.lines.length, 0)

  const rows = note.returns
    .map((one) => {
      const subtotal = one.lines.reduce((sum, line) => sum + line.qty, 0)
      return `<tr class="group"><td colspan="3"><span class="mono">${e(one.reference ?? "No order")}</span> <span class="muted">· ${e(one.number)} · ${e(one.reason)}</span></td></tr>
${one.lines
  .map(
    (line, index) => `<tr>
  <td>${index + 1}</td>
  <td>${e(line.name ?? line.sku)}</td>
  <td class="num">${count(line.qty)}</td>
</tr>`
  )
  .join("")}
<tr class="sum"><td></td><td class="muted">Subtotal</td><td class="num">${count(subtotal)}</td></tr>`
    })
    .join("")

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(
    `Return delivery note ${note.supplier}`
  )}</title><style>
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
body { font-family: Inter, -apple-system, "Segoe UI", sans-serif; font-size: 13px; color: #1d1f1a; margin: 0; }
.page { padding: 14mm 16mm; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #1d1f1a; padding-bottom: 8px; }
.company { font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.muted { color: #5b6158; }
.title { text-align: right; flex-shrink: 0; }
.title h1 { font-size: 18px; letter-spacing: .04em; margin: 0 0 4px; }
.mono { font-family: ui-monospace, Menlo, monospace; }
.parties { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; margin: 12px 0; }
.label { color: #5b6158; margin-bottom: 2px; }
table.lines { width: 100%; border-collapse: collapse; margin-top: 6px; }
table.lines th { text-align: left; font-weight: 500; color: #5b6158; border-bottom: 1px solid #1d1f1a; padding: 6px 4px; }
table.lines td { border-bottom: 1px solid #d9dbd6; padding: 7px 4px; vertical-align: top; }
table.lines .num, table.lines th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
table.lines th:first-child, table.lines td:first-child { width: 34px; }
table.lines th:last-child, table.lines td:last-child { padding-right: 14px; }
table.lines tr.group td { background: #f4f5f2; font-weight: 600; padding-top: 9px; border-bottom: 1px solid #1d1f1a; }
table.lines tr.sum td { border-bottom: 1px solid #1d1f1a; font-weight: 500; }
.sub { color: #5b6158; font-size: 11px; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
.totals { margin-left: auto; width: 240px; margin-top: 8px; border-collapse: collapse; }
.totals td { padding: 3px 4px; font-variant-numeric: tabular-nums; }
.totals td:last-child { text-align: right; padding-right: 14px; }
.totals tr.grand td { border-top: 1px solid #1d1f1a; font-weight: 600; padding-top: 6px; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; justify-items: end; margin-top: 22px; break-inside: avoid; }
.sign .box { grid-column: 2; width: 100%; border: 1px solid #1d1f1a; border-radius: 4px; padding: 10px 12px; height: 190px; display: flex; flex-direction: column; }
.sign .who { font-weight: 600; }
.sign .space { flex: 1; }
.sign .line { border-top: 1px solid #1d1f1a; padding-top: 4px; color: #5b6158; margin-top: 6px; }
.sign .two { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; margin-top: 28px; }
.sign .two .line { margin-top: 0; }
</style></head><body><section class="page">
<div class="head">
  <div>
    <div class="company">${e(COMPANY.name)}</div>
    <div class="muted">${e(COMPANY.address)}</div>
    ${COMPANY.phone ? `<div class="muted">${e(COMPANY.phone)}</div>` : ""}
  </div>
  <div class="title">
    <h1>RETURN DELIVERY NOTE</h1>
    <div class="muted">Date ${e(day(note.date))}</div>
  </div>
</div>

<div class="parties">
  <div>
    <div class="label">To</div>
    <div><strong>${e(note.supplier)}</strong></div>
  </div>
  <div>
    <div class="label">Person in charge</div>
    <div><strong>${e(titled(note.pic ?? "") || "—")}</strong></div>
  </div>
</div>

<table class="lines">
  <thead><tr>
    <th>No</th><th>Item</th><th class="num">Quantity</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>

<table class="totals">
  <tr><td>Total Items</td><td>${count(items)}</td></tr>
  <tr class="grand"><td>Total Quantity</td><td>${count(pieces)} pcs</td></tr>
</table>

<div class="sign">
  <div class="box">
    <div class="who">${e(note.supplier)}</div>
    <div class="space"></div>
    <div class="line">Signature &amp; company stamp</div>
    <div class="two">
      <div class="line">Name</div>
      <div class="line">Date</div>
    </div>
  </div>
</div>
</section></body></html>`
}
