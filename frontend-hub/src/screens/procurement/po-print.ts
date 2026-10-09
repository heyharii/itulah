import { count, day, money } from "@/lib/format"
import type { PurchaseOrderDetail } from "@/lib/queries/procurement"
import { COMPANY } from "@/screens/finance-lab/print"
import { escapeHtml } from "@/screens/procurement/print"
import {
  DEFAULT_TERMS,
  lineValue,
  receivedTone,
} from "@/screens/procurement/shared"
import { supplierDisplayName } from "@/screens/procurement/supplier-format"
import { lineTotal } from "@/screens/procurement/line-pricing-model"
import type { Supplier } from "@itulah/contract"

/// One purchase order to print, with the supplier's record for its address
/// and telephone; null when that could not be read — the order still prints,
/// with its name.
export interface PrintableOrder {
  readonly order: PurchaseOrderDetail
  readonly supplier: Supplier | null
}

/// Purchase orders as they go to the supplier, on A5, one order a sheet.
///
/// The same way a supplier card prints (`printSuppliers`): one document, a
/// page break between orders, so one order or twenty ticked on the list are
/// the same print job with the same layout. A long order runs onto a second
/// sheet with its column headings repeated.
///
/// In English, as the screens are (owner, 2026-10-04 — "di print itu jangan
/// bahasa indo"): the earlier rule that paper spoke the reader's language
/// stood until today. The same letterhead as every other printed document
/// (`COMPANY`), the order's own figures exactly as the sheet shows them. The
/// discount per piece stands once under the table, not against every row.
/// A login is lower case ("rina"); on paper the name starts with a capital.
export function titled(name: string | null | undefined): string {
  return (name ?? "").replace(
    /(^|\s)(\p{L})/gu,
    (_, gap: string, letter: string) => gap + letter.toUpperCase()
  )
}

/// How the order is paid, as a sentence the supplier reads: "Payment within
/// 30 days of the invoice date, by giro." The terms are the template's name
/// as the screens show it ("30 days"); an order with none prints only the
/// method. Shared with the PDF writer, which lays the same facts out.
export function paymentText(order: PurchaseOrderDetail): string {
  const name = order.payment_terms_name?.trim() ?? ""
  const days = /^(\d+) days$/.exec(name)
  const method =
    order.payment_method === "TRANSFER"
      ? "bank transfer"
      : order.payment_method === "CASH"
        ? "cash"
        : "giro"
  if (days !== null) {
    return `Payment within ${days[1]} days of the invoice date, by ${method}.`
  }
  if (name === "Cash on delivery") {
    return `Payment on delivery, by ${method}.`
  }
  return name === ""
    ? `Payment by ${method}.`
    : `Payment as per ${name}, by ${method}.`
}

/// The paper a purchase order prints on. Landscape is the default, because the
/// order is wide; portrait is offered as well (the owner, 2026-10-04) for the
/// printers loaded with it, and sets the table tighter to fit.
export type Paper = "A5" | "A4" | "A5-portrait" | "A4-portrait"

/// The size and the way up of a paper.
export function paperShape(paper: Paper): {
  readonly size: "A5" | "A4"
  readonly portrait: boolean
} {
  return {
    size: paper.startsWith("A4") ? "A4" : "A5",
    portrait: paper.endsWith("portrait"),
  }
}

/// A date as it is written on paper — the house format, "01 Oct 2026". Shared
/// with the PDF writer, which lays the same document out.
export function paperDate(iso: string): string {
  return day(iso)
}

export function purchaseOrdersHtml({
  orders,
  phone,
  paper = "A5",
}: {
  orders: readonly PrintableOrder[]
  divisionLabel: (code: string | null) => string
  /// The supplier's number as the screens write it.
  phone: (value: string | null | undefined) => string | null
  paper?: Paper
}): string {
  const e = (value: string | null | undefined) => escapeHtml(value ?? "")
  const nameOf = ({ order, supplier }: PrintableOrder) =>
    supplier === null
      ? (order.supplier_name ?? "—")
      : supplierDisplayName(supplier)

  const page = (one: PrintableOrder) => {
    const { order, supplier } = one
    const name = nameOf(one)
    // An order that has had goods against it is also the receipt for them
    // (the tanda terima): what arrived stands beside what was ordered, and
    // the amount is worked out on what arrived.
    const received = order.lines.some((line) => line.received_quantity > 0)
    const stamp =
      order.lifecycle === "CANCELLED"
        ? { word: "CANCELLED", tone: "bad" }
        : order.lifecycle === "FULLY_RECEIVED"
          ? { word: "FULLY RECEIVED", tone: "ok" }
          : order.lifecycle === "SHORT_RECEIVED"
            ? { word: "CLOSED SHORT", tone: "ok" }
            : null
    const values = order.lines.map((line) =>
      lineValue(line, received ? line.received_quantity : line.ordered_quantity)
    )
    const gross = values.reduce((sum, one) => sum + one, 0)
    // On what arrived, the discount is the order's, in proportion.
    const discount = received
      ? order.gross_minor > 0
        ? lineTotal(gross, order.discount_minor, order.gross_minor)
        : 0
      : order.discount_minor
    const rows = order.lines
      .map((line, index) => {
        const inUnit =
          line.order_unit_code !== null &&
          line.order_unit_code !== undefined &&
          line.order_unit_quantity !== null &&
          line.order_unit_quantity !== undefined
        // The quantity is always pieces; what was said in dozens or kodi
        // stands under it.
        const entered = inUnit
          ? `${String(line.order_unit_quantity).replace(".", ",")} ${line.order_unit_code!.toLowerCase()}`
          : null
        // The price as it was agreed: per koli / lusin when the line was
        // ordered in one, otherwise the plain price. Never a per-piece line
        // under it (owner, 2 Oct 2026). An order from before the unit price
        // was kept gets it worked out from the piece price and the factor.
        const unitFactor = Number(line.unit_factor ?? 0)
        const unitPrice =
          inUnit && line.order_unit_price_minor != null
            ? line.order_unit_price_minor
            : inUnit && unitFactor > 0
              ? Math.round(line.unit_price_minor * unitFactor)
              : null
        const price =
          inUnit && unitPrice !== null
            ? money(unitPrice)
            : money(line.unit_price_minor)
        const per =
          inUnit && unitPrice !== null
            ? line.order_unit_code!.toLowerCase()
            : null
        const receipts = (line.receipts ?? []).map(
          (one, at, all) =>
            `<div class="sub">Received${all.length > 1 ? ` #${at + 1}` : ""} ${count(one.quantity)} pcs · ${e(paperDate(one.received_at))}</div>`
        )
        // What arrived, in the colour of how it stands against the order:
        // red while a part is still owed, green once the line has all of it.
        const tone = receivedTone(line.ordered_quantity, line.received_quantity)
        return `<tr>
  <td>${index + 1}</td>
  <td>${e(line.article_name)}${receipts.join("")}</td>
  <td class="num">${count(line.ordered_quantity)} pcs${entered === null ? "" : `<div class="sub">${e(entered)}</div>`}</td>
  ${received ? `<td class="num${tone === null ? "" : ` ${tone}`}">${count(line.received_quantity)} pcs</td>` : ""}
  <td class="num">${e(price)}${per === null ? "" : `<div class="sub">/ ${e(per)}</div>`}</td>
  <td class="num">${money(values[index])}</td>
</tr>`
      })
      .join("")

    const pieces = order.lines.reduce(
      (sum, line) => sum + line.ordered_quantity,
      0
    )
    const arrived = order.lines.reduce(
      (sum, line) => sum + line.received_quantity,
      0
    )
    const terms = order.terms_and_conditions?.trim() || DEFAULT_TERMS

    return `<section class="page">
${stamp === null ? "" : `<div class="stamp ${stamp.tone}">${stamp.word}</div>`}
<div class="head">
  <div>
    <div class="company">${e(COMPANY.name)}</div>
    <div class="muted">${e(COMPANY.address)}</div>
    ${COMPANY.phone ? `<div class="muted">${e(COMPANY.phone)}</div>` : ""}
  </div>
  <div class="title">
    <h1>PURCHASE ORDER</h1>
    <div>No. <span class="mono">${e(order.po_number)}</span></div>
    <div class="muted">Date ${e(day(order.issued_at ?? order.created_at))}</div>
  </div>
</div>

<div class="parties">
  <div>
    <div class="label">To</div>
    <div><strong>${e(name)}</strong></div>
    ${supplier?.address ? `<div>${e(supplier.address)}</div>` : ""}
    ${supplier?.phone ? `<div>${e(phone(supplier.phone))}</div>` : ""}
  </div>
  <div>
    <div class="label">Delivery date</div>
    <div><strong>${e(day(order.expected_arrival))}</strong></div>
    <div class="label" style="margin-top:6px">Payment</div>
    <div>${e(paymentText(order))}</div>
  </div>
</div>

<table class="lines">
  <thead><tr>
    <th>No</th><th>Item</th>
    ${
      received
        ? '<th class="num">Ordered</th><th class="num">Received</th>'
        : '<th class="num">Quantity</th>'
    }
    <th class="num">Price</th><th class="num">Total</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>

${discount > 0 && pieces > 0 ? `<div class="sub" style="margin-top:3px">Discount per item: − ${money(Math.round(discount / pieces))} / pc</div>` : ""}

<table class="totals">
  <tr><td>Total Quantity</td><td>${received ? `${count(arrived)} of ${count(pieces)} pcs` : `${count(pieces)} pcs`}</td></tr>
  <tr><td>Subtotal</td><td>${money(gross)}</td></tr>
  <tr><td>Discount</td><td>${discount === 0 ? "—" : money(-discount)}</td></tr>
  <tr class="grand"><td>Grand Total</td><td>${money(gross - discount)}</td></tr>
</table>

${
  order.notes?.trim()
    ? `<div class="notes"><div class="label">Notes</div>${e(order.notes.trim())}</div>`
    : ""
}
<div class="madeby">Created by: <strong>${e(titled(order.created_by))}</strong></div>
<div class="system">This document is system-generated and needs no signature.</div>

<div class="notes terms"><div class="label">Terms &amp; conditions</div>${e(terms)}</div>
</section>`
  }

  const title =
    orders.length === 1
      ? `PO ${orders[0].order.po_number} ${nameOf(orders[0])}`
      : `${orders.length} purchase orders`

  const shape = paperShape(paper)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(
    title
  )}</title><style>
@page { size: ${shape.size} ${shape.portrait ? "portrait" : "landscape"}; margin: 0; }
* { box-sizing: border-box; }
body { font-family: Inter, -apple-system, "Segoe UI", sans-serif; font-size: 14px; color: #1d1f1a; margin: 0; }
.page { position: relative; padding: 8mm 10mm; break-after: page; break-inside: avoid; }
.page:last-child { break-after: auto; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #1d1f1a; padding-bottom: 8px; }
.company { font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.muted { color: #5b6158; }
.title { text-align: right; flex-shrink: 0; }
.title h1 { font-size: 18px; letter-spacing: .04em; margin: 0 0 4px; }
.mono { font-family: ui-monospace, Menlo, monospace; }
.parties { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; margin: 8px 0; }
.label { color: #5b6158; margin-bottom: 2px; }
table.lines { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.lines th { text-align: left; font-weight: 500; color: #5b6158; border-bottom: 1px solid #1d1f1a; padding: 5px 4px; }
table.lines td { border-bottom: 1px solid #d9dbd6; padding: 5px 4px; vertical-align: top; }
table.lines .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
table.lines th:first-child, table.lines td:first-child { width: 34px; text-align: left; padding-right: 10px; }
table.lines th.num { text-align: right; }
.sub { color: #5b6158; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
.totals { margin-left: auto; width: 260px; margin-top: 6px; border-collapse: collapse; }
.totals td { padding: 3px 4px; font-variant-numeric: tabular-nums; }
.totals td:last-child { text-align: right; }
.totals tr.grand td { border-top: 1px solid #1d1f1a; font-weight: 600; padding-top: 6px; }
.notes { margin-top: 8px; white-space: pre-wrap; }
.madeby { margin-top: 10px; }
.terms { margin-top: 18px; padding-top: 8px; border-top: 1px solid #d9dbd6; }
.system { margin-top: 3px; color: #5b6158; }
.stamp { position: absolute; top: 22mm; right: 58mm; transform: rotate(-12deg); border: 3px solid; border-radius: 6px; padding: 2px 12px; font-size: 22px; font-weight: 700; letter-spacing: .12em; opacity: .55; pointer-events: none; }
.ok { color: #1f8a4c; }
.bad { color: #c0392b; }

${
  shape.portrait
    ? `body { font-size: 12px; }
.parties { grid-template-columns: 1fr 1fr; }
.title h1 { font-size: 15px; }
.totals { width: 100%; }
.stamp { top: 26mm; right: 14mm; font-size: 16px; }`
    : ""
}
</style></head><body>
${orders.map(page).join("\n")}
</body></html>`
}
