import { jsPDF } from "jspdf"

import { count, day } from "@/lib/format"
import { COMPANY } from "@/screens/finance-lab/print"
import {
  NOT_AS_ORDERED_PAPER_ROW,
  UNKNOWN_NOTE,
} from "@/screens/procurement/return-lines"
import { paperShape, type Paper } from "@/screens/procurement/po-print"
import {
  noteFigures,
  type PrintableNote,
} from "@/screens/procurement/return-print"

/// The return delivery note as a PDF FILE, straight to the browser's download
/// (owner, 2026-10-04: print, download and confirm). The same document
/// `supplierReturnHtml` prints, laid out line by line on A4 portrait as the
/// owner drew it (2026-10-08, 2026-10-16), in his words: Surat Jalan Retur,
/// No, Tgl, No PO, Kepada, PIC, Hormat kami, Penerima.

const INK = [29, 31, 26] as const
const MUTE = [91, 97, 88] as const
/// The PO's green stamp ink (`po-pdf.ts`).
const STAMP_OK = [120, 184, 150] as const

/// The page being drawn — set by `buildReturnPdf` from the paper chosen in the
/// Print sheet, as the PO's (owner, 2026-10-18: Return PO prints like PO).
let W = 210
let H = 297
let MARGIN = 16

/// The supplier's copy stamp: the PO stamp's tilt, in the hub's blue.
const STAMP_COPY = [47, 95, 208] as const
/// The items table and what hangs under it span the page, as the print's
/// (owner, 2026-10-16: back to the full width once Keterangan came in).
let TABLE = W - 2 * MARGIN

/// The note as a document, before it is saved: the download saves it, and a
/// preview can show it. Two pages, as the print: the one the Gudang keeps,
/// then the SUPPLIER COPY, stamped; the supplier signs both as Penerima.
export function buildReturnPdf(
  note: PrintableNote,
  paper: Paper = "A4-portrait"
): jsPDF {
  const { size, portrait } = paperShape(paper)
  const long = size === "A4" ? 297 : 210
  const short = size === "A4" ? 210 : 148
  W = portrait ? short : long
  H = portrait ? long : short
  MARGIN = size === "A4" ? 16 : 10
  TABLE = W - 2 * MARGIN
  const doc = new jsPDF({
    orientation: portrait ? "portrait" : "landscape",
    unit: "mm",
    format: size === "A4" ? "a4" : "a5",
  })
  drawNote(doc, note, false)
  doc.addPage()
  drawNote(doc, note, true)
  return doc
}

function drawNote(doc: jsPDF, note: PrintableNote, copy: boolean): void {
  const figures = noteFigures(note)
  const right = W - MARGIN
  const tableRight = MARGIN + TABLE
  // Figures stand a little in from the rule, as the printed note's do.
  const edge = tableRight - 4
  const pcs = (n: number) => `${count(n)} pcs`
  let y = MARGIN

  const ink = () => doc.setTextColor(...INK)
  const mute = () => doc.setTextColor(...MUTE)

  // — title and company, number, date and orders —
  ink()
  doc.setFont("helvetica", "bold").setFontSize(15)
  doc.text("SURAT JALAN RETUR", MARGIN, y + 4)
  doc.setFontSize(10).text(COMPANY.name, MARGIN, y + 10)
  mute()
  doc.setFont("helvetica", "normal").setFontSize(8)
  doc.text(COMPANY.address, MARGIN, y + 14)
  if (COMPANY.phone) doc.text(COMPANY.phone, MARGIN, y + 17.4)

  // — the stamp, once the return is finished, with its day —
  if (note.stamp !== undefined) {
    doc
      .setTextColor(...STAMP_OK)
      .setFont("helvetica", "bold")
      .setFontSize(16)
      .text(note.stamp.word, W / 2 + 4, y + 9, { align: "center", angle: 6 })
    if (note.stamp.at !== null)
      doc.setFontSize(10).text(day(note.stamp.at), W / 2 + 4, y + 14, {
        align: "center",
        angle: 6,
      })
  }

  const meta = right - 62
  const orders = doc.splitTextToSize(figures.orders.join(", ") || "—", 50)
  const rows: [string, string][] = [
    ...(note.number ? [["No", note.number] as [string, string]] : []),
    ["Tgl", day(note.date)],
  ]
  doc.setFontSize(9)
  rows.forEach(([label, value], index) => {
    mute()
    doc.setFont("helvetica", "normal")
    doc.text(label, meta, y + 4 + index * 5.5)
    ink()
    doc.setFont("helvetica", "bold")
    doc.text(`: ${value}`, meta + 14, y + 4 + index * 5.5)
  })
  const poY = y + 4 + rows.length * 5.5
  mute()
  doc.setFont("helvetica", "normal")
  doc.text("No PO", meta, poY)
  ink()
  doc.setFont("helvetica", "bold")
  doc.text(`: ${orders[0]}`, meta + 14, poY)
  orders.slice(1).forEach((more: string, index: number) => {
    doc.text(more, meta + 16.2, poY + 4.2 + index * 4.2)
  })
  y = Math.max(y + 21, poY + 2 + orders.length * 4.2)
  doc
    .setDrawColor(...INK)
    .setLineWidth(0.5)
    .line(MARGIN, y, right, y)
  y += 7

  // — the supplier's copy: stamped across, tilted as the PO's stamp, no day —
  if (copy) {
    doc.saveGraphicsState()
    doc.setGState(doc.GState({ opacity: 0.55, "stroke-opacity": 0.55 }))
    doc
      .setTextColor(...STAMP_COPY)
      .setFont("helvetica", "bold")
      .setFontSize(18)
    const word = "SUPPLIER COPY"
    const wide = doc.getTextWidth(word) + 8
    const cx = right - 6 - wide / 2
    const cy = y + 6
    const turn = (12 * Math.PI) / 180
    // The box, turned with the word about the same centre.
    const corner = (dx: number, dy: number): [number, number] => [
      cx + dx * Math.cos(turn) + dy * Math.sin(turn),
      cy - dx * Math.sin(turn) + dy * Math.cos(turn),
    ]
    const [a, b, c, d] = [
      corner(-wide / 2, -5),
      corner(wide / 2, -5),
      corner(wide / 2, 4),
      corner(-wide / 2, 4),
    ]
    doc.setDrawColor(...STAMP_COPY).setLineWidth(0.9)
    doc.line(...a, ...b)
    doc.line(...b, ...c)
    doc.line(...c, ...d)
    doc.line(...d, ...a)
    const [tx, ty] = corner(-wide / 2 + 4, 1.9)
    doc.text(word, tx, ty, { angle: 12 })
    doc.restoreGraphicsState()
  }

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

  // — the items: a boxed table, Item | Keterangan | Quantity, as drawn —
  // One row height, text a fixed way down the row; the unknown row is two lines.
  const ROW = 8.5
  const TWO = ROW + 4.8
  const base = 5.8
  const split = tableRight - 30
  const notesAt = split - 42
  const box = (h: number, notes = true) => {
    doc
      .setDrawColor(...INK)
      .setLineWidth(0.25)
      .rect(MARGIN, y, TABLE, h)
      .line(split, y, split, y + h)
    if (notes) doc.line(notesAt, y, notesAt, y + h)
  }
  const head = () => {
    box(ROW)
    mute()
    doc.setFont("helvetica", "normal").setFontSize(8.5)
    doc.text("Item", MARGIN + 3, y + base)
    doc.text("Keterangan", notesAt + 3, y + base)
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
  lines.forEach((line, index) => {
    const said = doc
      .setFont("helvetica", "normal")
      .setFontSize(9)
      .splitTextToSize(line.note, 36) as string[]
    const h = Math.max(line.sub ? TWO : ROW, ROW + (said.length - 1) * 4.6)
    room(h)
    box(h)
    ink()
    doc.setFont("helvetica", "normal").setFontSize(9.5)
    doc.text(String(index + 1), MARGIN + 3, y + base)
    doc.text(line.name, MARGIN + 11, y + base)
    doc.text(pcs(line.qty), edge, y + base, { align: "right" })
    if (said.length > 0 && line.note !== "") {
      doc.setFontSize(9)
      doc.text(said, notesAt + 3, y + base)
    }
    if (line.sub) {
      mute()
      doc.setFontSize(9)
      doc.text(line.sub, MARGIN + 11, y + base + 4.6)
    }
    y += h
  })

  // — total —
  room(ROW)
  box(ROW, false)
  ink()
  doc.setFont("helvetica", "bold").setFontSize(9.5)
  doc.text("Total", split - 4, y + base, { align: "right" })
  doc.text(pcs(figures.total), edge, y + base, { align: "right" })
  y += ROW + 5

  // — pengirim, under the table —
  mute()
  doc.setFont("helvetica", "normal").setFontSize(9.5)
  doc.text("PIC :", MARGIN, y)
  ink()
  doc.setFont("helvetica", "bold")
  doc.text(figures.pic, MARGIN + doc.getTextWidth("PIC : "), y)
  y += 9

  // — hormat kami beside penerima at the right, two lines lower (owner,
  // 2026-10-18), on both copies —
  y += 10
  // Room to sign: less on A5, so the names stay on the same page.
  const space = H < 200 ? 18 : 26
  if (y + space + 4 > H - MARGIN) {
    doc.addPage()
    y = MARGIN
  }
  const signWidth = 50
  const receiverX = tableRight - signWidth
  const senderX = receiverX - signWidth - 10
  ink()
  doc.setFont("helvetica", "normal").setFontSize(9.5)
  doc.text("Hormat kami,", senderX, y)
  // Penerima flush with the right edge (owner, 2026-10-18).
  doc.text("Penerima,", tableRight, y, { align: "right" })
  doc.setFont("helvetica", "bold")
  doc.text(
    doc.splitTextToSize(`( ${figures.sender} )`, signWidth),
    senderX,
    y + space
  )
  doc.text(
    doc.splitTextToSize(`( ${note.supplier} )`, signWidth),
    tableRight,
    y + space,
    { align: "right" }
  )
}

export function downloadReturnPdf(note: PrintableNote, paper?: Paper): void {
  buildReturnPdf(note, paper).save(
    `surat-jalan-retur-${note.supplier.replace(/[^\w]+/g, "-")}.pdf`
  )
}
