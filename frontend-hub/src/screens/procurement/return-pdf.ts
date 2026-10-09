import { jsPDF } from "jspdf"

import { count, day } from "@/lib/format"
import { COMPANY } from "@/screens/finance-lab/print"
import { NOT_AS_ORDERED_ROW } from "@/screens/procurement/return-lines"
import {
  noteFigures,
  type PrintableNote,
} from "@/screens/procurement/return-print"

/// The return delivery note as a PDF FILE, straight to the browser's download
/// (owner, 2026-10-04: print, download and confirm). The same document
/// `supplierReturnHtml` prints, laid out line by line on A4 portrait as the
/// owner drew it (2026-10-08), in his words: Surat Jalan Retur, Tgl, No PO,
/// Kepada, Hormat kami.

const INK = [29, 31, 26] as const
const MUTE = [91, 97, 88] as const

const W = 210
const H = 297
const MARGIN = 16

/// The note as a document, before it is saved: the download saves it, and a
/// preview can show it.
export function buildReturnPdf(note: PrintableNote): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const figures = noteFigures(note)
  const right = W - MARGIN
  // Figures stand a little in from the rule, as the printed note's do.
  const edge = right - 4
  let y = MARGIN

  const ink = () => doc.setTextColor(...INK)
  const mute = () => doc.setTextColor(...MUTE)

  // — title and company, date and orders —
  ink()
  doc.setFont("helvetica", "bold").setFontSize(15)
  doc.text("SURAT JALAN RETUR", MARGIN, y + 4)
  doc.setFontSize(10).text(COMPANY.name, MARGIN, y + 10)
  mute()
  doc.setFont("helvetica", "normal").setFontSize(8)
  doc.text(COMPANY.address, MARGIN, y + 14)
  if (COMPANY.phone) doc.text(COMPANY.phone, MARGIN, y + 17.4)

  const meta = right - 62
  const orders = doc.splitTextToSize(figures.orders.join(", ") || "—", 50)
  mute()
  doc.setFontSize(9)
  doc.text("Tgl", meta, y + 4)
  doc.text("No PO", meta, y + 9.5)
  ink()
  doc.setFont("helvetica", "bold")
  doc.text(`: ${day(note.date)}`, meta + 14, y + 4)
  doc.text(`: ${orders[0]}`, meta + 14, y + 9.5)
  orders.slice(1).forEach((more: string, index: number) => {
    doc.text(more, meta + 16.2, y + 13.7 + index * 4.2)
  })
  y += Math.max(21, 15 + orders.length * 4.2)
  doc
    .setDrawColor(...INK)
    .setLineWidth(0.5)
    .line(MARGIN, y, right, y)
  y += 7

  // — kepada: the label on the line of the name, address and telephone under it —
  const kx = MARGIN + 20
  mute()
  doc.setFont("helvetica", "normal").setFontSize(9)
  doc.text("Kepada :", MARGIN, y + 4)
  ink()
  doc.setFont("helvetica", "bold").setFontSize(10)
  doc.text(note.supplier, kx, y + 4)
  y += 4
  doc.setFont("helvetica", "normal").setFontSize(9.5)
  if (note.address) {
    const lines: string[] = doc.splitTextToSize(note.address, 110)
    lines.forEach((line) => {
      y += 4.8
      doc.text(line, kx, y)
    })
  }
  if (note.phone) {
    y += 4.8
    doc.text(`Telp. ${note.phone}`, kx, y)
  }
  y += 9

  // — the items: a boxed table, Item | Quantity, as drawn —
  // One row height, text a fixed way down the row; the unknown row is two lines.
  const ROW = 8.5
  const TWO = ROW + 4.8
  const base = 5.8
  const split = right - 34
  const box = (h: number) => {
    doc
      .setDrawColor(...INK)
      .setLineWidth(0.25)
      .rect(MARGIN, y, right - MARGIN, h)
      .line(split, y, split, y + h)
  }
  const head = () => {
    box(ROW)
    mute()
    doc.setFont("helvetica", "normal").setFontSize(8.5)
    doc.text("Item", MARGIN + 3, y + base)
    doc.text("Quantity", edge, y + base, { align: "right" })
    y += ROW
  }
  const room = (h: number) => {
    if (y + h <= H - MARGIN - 20) return
    doc.addPage()
    y = MARGIN
    head()
  }
  head()
  const lines = [
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
  lines.forEach((line, index) => {
    const h = line.sub ? TWO : ROW
    room(h)
    box(h)
    ink()
    doc.setFont("helvetica", "normal").setFontSize(9.5)
    doc.text(String(index + 1), MARGIN + 3, y + base)
    doc.text(line.name, MARGIN + 11, y + base)
    doc.text(count(line.qty), edge, y + base, { align: "right" })
    if (line.sub) {
      mute()
      doc.setFontSize(9)
      doc.text(line.sub, MARGIN + 11, y + base + 4.6)
    }
    y += h
  })

  // — total —
  room(ROW)
  box(ROW)
  ink()
  doc.setFont("helvetica", "bold").setFontSize(9.5)
  doc.text("Total", split - 4, y + base, { align: "right" })
  doc.text(count(figures.total), edge, y + base, { align: "right" })
  y += ROW + 12

  // — hormat kami —
  if (y + 44 > H - MARGIN) {
    doc.addPage()
    y = MARGIN
  }
  ink()
  doc.setFont("helvetica", "normal").setFontSize(9.5)
  doc.text("Hormat kami,", MARGIN, y)
  doc.setFont("helvetica", "bold")
  doc.text(`( ${figures.sender} )`, MARGIN, y + 26)
  mute()
  doc.setFont("helvetica", "normal").setFontSize(8.5)
  doc.text("Pengirim", MARGIN, y + 31)

  return doc
}

export function downloadReturnPdf(note: PrintableNote): void {
  buildReturnPdf(note).save(
    `surat-jalan-retur-${note.supplier.replace(/[^\w]+/g, "-")}.pdf`
  )
}
