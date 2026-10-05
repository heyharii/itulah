import { jsPDF } from "jspdf"

import { count, day, money } from "@/lib/format"
import { COMPANY } from "@/screens/finance-lab/print"
import {
  paperDate,
  paymentText,
  titled,
  type Paper,
  type PrintableOrder,
} from "@/screens/procurement/po-print"
import {
  DEFAULT_TERMS,
  lineValue,
  receivedTone,
} from "@/screens/procurement/shared"
import { supplierDisplayName } from "@/screens/procurement/supplier-format"

/// Purchase orders as a PDF FILE, straight to the browser's download —
/// not the print dialog (owner, 2026-10-04: "download pdf harus langsung
/// download pdfnya, jangan buka print"). The same document
/// `purchaseOrdersHtml` prints, laid out line by line rather than shot off
/// a canvas: the figures stay selectable, the file stays small, and a long
/// order breaks to a second page under the same rule the print applies.
///
/// One font (Helvetica), the letterhead `COMPANY` gives every printed
/// document, and English labels, as the print now is.

const INK = [29, 31, 26] as const
const MUTE = [91, 97, 88] as const
const STAMP_OK = [120, 184, 150] as const
const STAMP_BAD = [224, 138, 128] as const
/// The colour of a received figure, as the printed sheet writes it
/// (`.ok` / `.bad` in `po-print`): green once the line is whole, red while it
/// is short.
const OK = [31, 138, 76] as const
const BAD = [192, 57, 43] as const

/// Landscape, like the print: the order is wide, not tall.
const SHEET: Record<Paper, [number, number]> = {
  A5: [210, 148],
  A4: [297, 210],
  "A5-portrait": [148, 210],
  "A4-portrait": [210, 297],
}

const MARGIN = 10
const TOTALS_WIDTH = 78
const BODY = 9
const SMALL = 7.5
const HEAD = 13

export function downloadOrdersPdf({
  orders,
  phone,
  paper,
}: {
  orders: readonly PrintableOrder[]
  /// The supplier's number as the screens write it.
  phone: (value: string | null | undefined) => string | null
  paper: Paper
}): void {
  const [pageW, pageH] = SHEET[paper]
  const doc = new jsPDF({
    orientation: pageW > pageH ? "landscape" : "portrait",
    unit: "mm",
    format: [pageW, pageH],
  })
  const W = pageW - 2 * MARGIN
  // A5 upright is 128 mm between the margins: the table is set tighter.
  const narrow = W < 150
  let y = MARGIN

  const room = (need: number) => {
    if (y + need <= pageH - MARGIN) return
    doc.addPage()
    y = MARGIN
  }

  const nameOf = ({ order, supplier }: PrintableOrder) =>
    supplier === null
      ? (order.supplier_name ?? "—")
      : supplierDisplayName(supplier)

  const page = (one: PrintableOrder) => {
    const { order, supplier } = one
    y = MARGIN

    // — letterhead —
    doc
      .setTextColor(...INK)
      .setFont("helvetica", "bold")
      .setFontSize(11)
    doc.text(COMPANY.name, MARGIN, y + 3)
    doc
      .setTextColor(...MUTE)
      .setFont("helvetica", "normal")
      .setFontSize(SMALL)
    const headLines = [
      COMPANY.address,
      ...(COMPANY.phone ? [COMPANY.phone] : []),
    ]
    headLines.forEach((line, at) => doc.text(line, MARGIN, y + 6.5 + at * 3.4))
    doc
      .setTextColor(...INK)
      .setFont("helvetica", "bold")
      .setFontSize(HEAD)
    doc.text("PURCHASE ORDER", pageW - MARGIN, y + 3.5, { align: "right" })
    doc.setTextColor(...INK).setFontSize(10)
    doc.text(order.po_number, pageW - MARGIN, y + 8.6, { align: "right" })
    doc
      .setTextColor(...MUTE)
      .setFont("helvetica", "normal")
      .setFontSize(SMALL)
    doc.text(
      `Date ${day(order.issued_at ?? order.created_at)}`,
      pageW - MARGIN,
      y + 12.4,
      {
        align: "right",
      }
    )
    // Clear of the right block as well: its Date line sits at y + 11.4, and a
    // rule drawn at 7 + one address line (10.4) ran through it.
    // — the stamp, where the order's life is over —
    // In the empty middle of the letterhead, between the company and the
    // title: below it, it landed on the table's column heads.
    const completed =
      order.lifecycle === "FULLY_RECEIVED" ||
      order.lifecycle === "SHORT_RECEIVED"
    if (order.lifecycle === "CANCELLED" || completed) {
      const tone: readonly [number, number, number] =
        order.lifecycle === "CANCELLED" ? STAMP_BAD : STAMP_OK
      doc
        .setTextColor(...tone)
        .setFont("helvetica", "bold")
        .setFontSize(narrow ? 14 : 18)
      doc.text(
        order.lifecycle === "CANCELLED" ? "CANCELLED" : "COMPLETED",
        narrow ? pageW / 2 - 6 : pageW / 2 + 4,
        MARGIN + 11,
        { align: "center", angle: 6 }
      )
    }
    y += Math.max(7 + headLines.length * 3.4, 16)
    doc
      .setDrawColor(...INK)
      .setLineWidth(0.5)
      .line(MARGIN, y, pageW - MARGIN, y)
    y += 5

    // — the parties —
    const rightX = MARGIN + W * (narrow ? 0.5 : 0.58)
    doc.setFontSize(SMALL).setTextColor(...MUTE)
    doc.text("To", MARGIN, y + 3)
    doc
      .setFont("helvetica", "bold")
      .setFontSize(BODY)
      .setTextColor(...INK)
    const nameLines = doc.splitTextToSize(nameOf(one), rightX - MARGIN - 6)
    nameLines.forEach((line: string, at: number) =>
      doc.text(line, MARGIN, y + 7.6 + at * 4.2)
    )
    let leftY = y + 7.6 + nameLines.length * 4.2
    doc
      .setFont("helvetica", "normal")
      .setFontSize(SMALL)
      .setTextColor(...MUTE)
    const supplierNumber = supplier?.phone ? phone(supplier.phone) : null
    const addressLines = [
      ...(supplier?.address
        ? doc.splitTextToSize(supplier.address, rightX - MARGIN - 6)
        : []),
      ...(supplierNumber ? [supplierNumber] : []),
    ]
    addressLines.forEach((line) => {
      doc.text(line, MARGIN, leftY)
      leftY += 3.4
    })

    doc.setFontSize(SMALL).setTextColor(...MUTE)
    doc.text("Delivery date", rightX, y + 3)
    doc
      .setFont("helvetica", "bold")
      .setFontSize(BODY)
      .setTextColor(...INK)
    doc.text(day(order.expected_arrival), rightX, y + 7.6)
    doc
      .setFont("helvetica", "normal")
      .setFontSize(SMALL)
      .setTextColor(...MUTE)
    doc.text("Payment", rightX, y + 12.6)
    doc
      .setFont("helvetica", "normal")
      .setFontSize(BODY)
      .setTextColor(...INK)
    const paymentLines = doc.splitTextToSize(
      paymentText(order),
      pageW - MARGIN - rightX
    )
    paymentLines.forEach((line: string, at: number) =>
      doc.text(line, rightX, y + 17.2 + at * 4.2)
    )
    y = Math.max(leftY, y + 17.2 + paymentLines.length * 4.2) + 3

    // — the items —
    const received = order.lines.some((line) => line.received_quantity > 0)
    const receivedW = received ? 24 : 0
    const cols = narrow
      ? { no: 9, quantity: 16, price: 23, total: 27 }
      : { no: 12, quantity: 24, price: 27, total: 30 }
    const itemX = MARGIN + cols.no
    const fromRight = (width: number) => pageW - MARGIN - width
    const quantityX = fromRight(cols.total + cols.price + receivedW)
    const receivedX = fromRight(cols.total + cols.price)
    const priceX = fromRight(cols.total)
    const totalX = fromRight(0)

    const tableHead = () => {
      doc
        .setFont("helvetica", "normal")
        .setFontSize(SMALL)
        .setTextColor(...MUTE)
      doc.text("No", MARGIN + 1, y)
      doc.text("Item", itemX, y)
      doc.text("Quantity", quantityX, y, { align: "right" })
      if (received) doc.text("Received", receivedX, y, { align: "right" })
      doc.text("Price", priceX, y, { align: "right" })
      doc.setTextColor(...INK)
      doc.text("Total", totalX, y, { align: "right" })
      y += 1.6
      doc
        .setDrawColor(...INK)
        .setLineWidth(0.3)
        .line(MARGIN, y, pageW - MARGIN, y)
      y += 4
    }
    tableHead()

    const values = order.lines.map((line) =>
      lineValue(line, received ? line.received_quantity : line.ordered_quantity)
    )

    order.lines.forEach((line, index) => {
      const inUnit =
        line.order_unit_code !== null &&
        line.order_unit_code !== undefined &&
        line.order_unit_quantity !== null &&
        line.order_unit_quantity !== undefined
      const entered =
        inUnit && line.order_unit_code!.toLowerCase() !== "pcs"
          ? `${String(line.order_unit_quantity).replace(".", ",")} ${line.order_unit_code!.toLowerCase()}`
          : null
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
        inUnit &&
        unitPrice !== null &&
        line.order_unit_code!.toLowerCase() !== "pcs"
          ? line.order_unit_code!.toLowerCase()
          : null
      const receipts = (line.receipts ?? []).map(
        (one, at, all) =>
          `Received${all.length > 1 ? ` #${at + 1}` : ""} ${count(one.quantity)} pcs · ${paperDate(one.received_at)}`
      )
      const nameWrapped = doc.splitTextToSize(
        line.article_name,
        quantityX - itemX - 4
      )
      const rowHeight = Math.max(
        9,
        (nameWrapped.length + receipts.length) * 3.6 + 2.2
      )
      room(rowHeight + 4)

      doc
        .setFont("helvetica", "normal")
        .setFontSize(BODY)
        .setTextColor(...INK)
      const baseline = y + 3.6
      doc.text(String(index + 1), MARGIN + 1, baseline)
      nameWrapped.forEach((line: string, at: number) =>
        doc.text(line, itemX, baseline + at * 3.6)
      )
      let subY = baseline + nameWrapped.length * 3.6
      doc.setFontSize(SMALL).setTextColor(...MUTE)
      receipts.forEach((line) => {
        doc.text(line, itemX, subY)
        subY += 3.4
      })
      doc.text(`${count(line.ordered_quantity)} pcs`, quantityX, baseline, {
        align: "right",
      })
      if (entered !== null)
        doc.text(entered, quantityX, baseline + 3.6, { align: "right" })
      if (received) {
        // In the colour of how the line stands against the order, as the
        // printed sheet writes it.
        const lineTone = receivedTone(
          line.ordered_quantity,
          line.received_quantity
        )
        const tone: readonly [number, number, number] =
          lineTone === "bad" ? BAD : lineTone === "ok" ? OK : INK
        doc.setTextColor(...tone)
        doc.text(`${count(line.received_quantity)} pcs`, receivedX, baseline, {
          align: "right",
        })
        doc.setTextColor(...INK)
      }
      doc.text(price, priceX, baseline, { align: "right" })
      if (per !== null)
        doc.text(`/ ${per}`, priceX, baseline + 3.6, { align: "right" })
      doc.setTextColor(...INK)
      doc.text(money(values[index]), totalX, baseline, { align: "right" })
      doc.setDrawColor(217, 219, 214).setLineWidth(0.15)
      doc.line(MARGIN, y + rowHeight - 1.6, pageW - MARGIN, y + rowHeight - 1.6)
      y += rowHeight
    })

    // — the discount per piece, said once under the table —
    const gross = values.reduce((sum, one) => sum + one, 0)
    const pieces = order.lines.reduce(
      (sum, line) => sum + line.ordered_quantity,
      0
    )
    const discount = received
      ? order.gross_minor > 0
        ? Math.round((gross * order.discount_minor) / order.gross_minor)
        : 0
      : order.discount_minor
    if (discount > 0 && pieces > 0) {
      doc
        .setFont("helvetica", "normal")
        .setFontSize(SMALL)
        .setTextColor(...MUTE)
      doc.text(
        `Discount per item: - ${money(Math.floor(discount / pieces))} / pc`,
        MARGIN,
        y + 1
      )
    }
    y += 5

    // — totals —
    const totalsX = pageW - MARGIN - (narrow ? 64 : TOTALS_WIDTH)
    const totalRow = (label: string, value: string, strong = false) => {
      room(5.4)
      doc.setFont("helvetica", strong ? "bold" : "normal").setFontSize(BODY)
      doc.setTextColor(...MUTE)
      doc.text(label, totalsX, y)
      doc.setTextColor(...INK)
      doc.text(value, pageW - MARGIN, y, { align: "right" })
      y += 5.4
    }
    totalRow(
      "Total Quantity",
      received
        ? `${count(order.lines.reduce((sum, line) => sum + line.received_quantity, 0))} of ${count(pieces)} pcs`
        : `${count(pieces)} pcs`
    )
    totalRow("Subtotal", money(gross))
    totalRow("Discount", discount === 0 ? "—" : `- ${money(discount)}`)
    doc.setDrawColor(...INK).setLineWidth(0.4)
    doc.line(totalsX, y - 3.4, pageW - MARGIN, y - 3.4)
    totalRow("Grand Total", money(gross - discount), true)

    // — notes, made by, and the terms at the very foot of the sheet —
    const block = (label: string, text: string) => {
      const wrapped = doc.splitTextToSize(text, W)
      room(6 + wrapped.length * 4.2)
      y += 3
      doc
        .setFont("helvetica", "normal")
        .setFontSize(SMALL)
        .setTextColor(...MUTE)
      doc.text(label, MARGIN, y)
      doc
        .setFont("helvetica", "normal")
        .setFontSize(BODY)
        .setTextColor(...INK)
      wrapped.forEach((line: string, at: number) =>
        doc.text(line, MARGIN, y + 4.4 + at * 4.2)
      )
      y += 4.4 + wrapped.length * 4.2
    }
    const notes = order.notes?.trim()
    if (notes) block("Notes", notes)

    room(12)
    y += 4
    doc
      .setFont("helvetica", "normal")
      .setFontSize(BODY)
      .setTextColor(...INK)
    doc.text("Created by: ", MARGIN, y)
    doc.setFont("helvetica", "bold")
    doc.text(
      titled(order.created_by),
      MARGIN + doc.getTextWidth("Created by: "),
      y
    )
    doc
      .setFont("helvetica", "normal")
      .setFontSize(SMALL)
      .setTextColor(...MUTE)
    doc.text(
      "This document is system-generated and needs no signature.",
      MARGIN,
      y + 3.4
    )
    y += 3.4

    // The terms are the fine print: pinned to the bottom margin, under
    // everything else, however short the order is. When they would not clear
    // what is above them they take a page of their own.
    const terms = doc.splitTextToSize(
      order.terms_and_conditions?.trim() || DEFAULT_TERMS,
      W
    )
    let termsY = pageH - MARGIN - 1 - 4.4 - (terms.length - 1) * 4.2
    if (termsY < y + 5) {
      doc.addPage()
      y = MARGIN
      termsY = Math.max(termsY, MARGIN)
    }
    doc
      .setFont("helvetica", "normal")
      .setFontSize(SMALL)
      .setTextColor(...MUTE)
    doc.text("Terms & conditions", MARGIN, termsY)
    doc
      .setFont("helvetica", "normal")
      .setFontSize(BODY)
      .setTextColor(...INK)
    terms.forEach((line: string, at: number) =>
      doc.text(line, MARGIN, termsY + 4.4 + at * 4.2)
    )
  }

  orders.forEach((one, index) => {
    if (index > 0) doc.addPage()
    page(one)
  })

  const filename =
    orders.length === 1
      ? `${orders[0].order.po_number.replace(/[/\\?%*:|"<>]/g, "-")}.pdf`
      : "purchase-orders.pdf"
  doc.save(filename)
}
