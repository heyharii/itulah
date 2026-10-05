import { jsPDF } from "jspdf"

import { count, day } from "@/lib/format"
import { COMPANY } from "@/screens/finance-lab/print"
import { titled } from "@/screens/procurement/po-print"
import type { PrintableNote } from "@/screens/procurement/return-print"

/// The return delivery note as a PDF FILE, straight to the browser's download
/// (owner, 2026-10-04: print, download and confirm). The same document
/// `supplierReturnHtml` prints, laid out line by line on A4 portrait, in
/// English, with the supplier's signature block.

const INK = [29, 31, 26] as const
const MUTE = [91, 97, 88] as const
const RULE = [217, 219, 214] as const

const W = 210
const H = 297
const MARGIN = 16

/// The note as a document, before it is saved: the download saves it, and a
/// preview can show it.
export function buildReturnPdf(note: PrintableNote): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const right = W - MARGIN
  // Figures stand a little in from the rule, as the printed note's do.
  const figures = right - 4
  let y = MARGIN

  const ink = () => doc.setTextColor(...INK)
  const mute = () => doc.setTextColor(...MUTE)

  // — letterhead —
  ink()
  doc.setFont("helvetica", "bold").setFontSize(11)
  doc.text(COMPANY.name, MARGIN, y + 3)
  mute()
  doc.setFont("helvetica", "normal").setFontSize(8)
  doc.text(COMPANY.address, MARGIN, y + 7)
  if (COMPANY.phone) doc.text(COMPANY.phone, MARGIN, y + 10.4)
  ink()
  doc.setFont("helvetica", "bold").setFontSize(15)
  doc.text("RETURN DELIVERY NOTE", right, y + 4, { align: "right" })
  mute()
  doc.setFont("helvetica", "normal").setFontSize(8)
  doc.text(`Date ${day(note.date)}`, right, y + 9, { align: "right" })
  y += 14
  doc
    .setDrawColor(...INK)
    .setLineWidth(0.5)
    .line(MARGIN, y, right, y)
  y += 6

  // — to —
  mute()
  doc.setFontSize(8).text("To", MARGIN, y + 3)
  ink()
  doc.setFont("helvetica", "bold").setFontSize(10)
  doc.text(note.supplier, MARGIN, y + 8)
  mute()
  doc.setFont("helvetica", "normal").setFontSize(8)
  doc.text("Person in charge", MARGIN + (W - 2 * MARGIN) * 0.58, y + 3)
  ink()
  doc.setFont("helvetica", "bold").setFontSize(10)
  doc.text(
    titled(note.pic ?? "") || "—",
    MARGIN + (W - 2 * MARGIN) * 0.58,
    y + 8
  )
  y += 16

  // — lines, a heading per return —
  // One row height for all of them, text a fixed way down the row and the rule
  // on its foot, so nothing sits on a line.
  const ROW = 8.5
  const base = 5.8
  const head = () => {
    mute()
    doc.setFont("helvetica", "normal").setFontSize(8.5)
    doc.text("No", MARGIN + 2, y + base)
    doc.text("Item", MARGIN + 12, y + base)
    doc.text("Quantity", figures, y + base, { align: "right" })
    doc
      .setDrawColor(...INK)
      .setLineWidth(0.3)
      .line(MARGIN, y + ROW, right, y + ROW)
    y += ROW
  }
  const room = (rows: number) => {
    if (y + rows * ROW <= H - MARGIN - 70) return
    doc.addPage()
    y = MARGIN
    head()
  }
  head()
  let pieces = 0
  note.returns.forEach((one) => {
    room(3)
    doc.setFillColor(244, 245, 242).rect(MARGIN, y, W - 2 * MARGIN, ROW, "F")
    ink()
    doc.setFont("courier", "bold").setFontSize(9)
    const reference = one.reference ?? "No order"
    doc.text(reference, MARGIN + 2, y + base)
    mute()
    doc.setFont("helvetica", "normal").setFontSize(8.5)
    doc.text(
      `· ${one.number} · ${one.reason}`,
      MARGIN + 2 + doc.getTextWidth(reference) + 3,
      y + base
    )
    y += ROW
    let subtotal = 0
    one.lines.forEach((line, index) => {
      room(2)
      ink()
      doc.setFont("helvetica", "normal").setFontSize(9.5)
      doc.text(String(index + 1), MARGIN + 2, y + base)
      doc.text(line.name ?? line.sku, MARGIN + 12, y + base)
      doc.text(count(line.qty), figures, y + base, { align: "right" })
      doc
        .setDrawColor(...RULE)
        .setLineWidth(0.2)
        .line(MARGIN, y + ROW, right, y + ROW)
      subtotal += line.qty
      y += ROW
    })
    pieces += subtotal
    mute()
    doc.setFont("helvetica", "normal").setFontSize(8.5)
    doc.text("Subtotal", MARGIN + 12, y + base)
    ink()
    doc.setFont("helvetica", "bold").setFontSize(9.5)
    doc.text(count(subtotal), figures, y + base, { align: "right" })
    doc
      .setDrawColor(...INK)
      .setLineWidth(0.3)
      .line(MARGIN, y + ROW, right, y + ROW)
    y += ROW + 5
  })

  // — totals —
  y += 1
  ink()
  doc.setFont("helvetica", "normal").setFontSize(9.5)
  doc.text("Total Items", right - 60, y)
  doc.text(
    count(note.returns.reduce((sum, one) => sum + one.lines.length, 0)),
    figures,
    y,
    { align: "right" }
  )
  y += 6
  doc.setFont("helvetica", "bold")
  doc.text("Total Quantity", right - 60, y)
  doc.text(`${count(pieces)} pcs`, figures, y, { align: "right" })
  y += 10
  mute()
  doc.setFont("helvetica", "normal").setFontSize(8.5)
  y += 2

  // — signatures: the supplier's is the point of the note —
  if (y + 56 > H - MARGIN) {
    doc.addPage()
    y = MARGIN
  }
  const boxW = (W - 2 * MARGIN - 10) / 2
  const boxH = 62
  const x = MARGIN + boxW + 10
  doc
    .setDrawColor(...INK)
    .setLineWidth(0.3)
    .roundedRect(x, y, boxW, boxH, 1, 1)
  ink()
  doc
    .setFont("helvetica", "bold")
    .setFontSize(9.5)
    .text(note.supplier, x + 4, y + 6)
  mute()
  doc.setFont("helvetica", "normal").setFontSize(8)
  doc.setDrawColor(...INK).setLineWidth(0.2)
  // The signature and stamp: room above the rule, named below it.
  doc.line(x + 4, y + boxH - 22, x + boxW - 4, y + boxH - 22)
  doc.text("Signature & company stamp", x + 4, y + boxH - 18.4)
  // Name and date, side by side.
  const split = x + 4 + (boxW - 8) * 0.6
  doc.line(x + 4, y + boxH - 5, split - 4, y + boxH - 5)
  doc.text("Name", x + 4, y + boxH - 1.6)
  doc.line(split + 4, y + boxH - 5, x + boxW - 4, y + boxH - 5)
  doc.text("Date", split + 4, y + boxH - 1.6)

  return doc
}

export function downloadReturnPdf(note: PrintableNote): void {
  buildReturnPdf(note).save(
    `return-delivery-note-${note.supplier.replace(/[^\w]+/g, "-")}.pdf`
  )
}
