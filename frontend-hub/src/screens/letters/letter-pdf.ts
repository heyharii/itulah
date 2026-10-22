import type { JSONContent } from "@tiptap/react"
import { jsPDF } from "jspdf"

import { COMPANY } from "@/screens/finance-lab/print"
import type {
  WrittenFacts,
  WrittenForm,
  WrittenItem,
} from "@/screens/letters/forms"
import { qrModules } from "@/screens/procurement/qr"

/// A written letter as a PDF file, written directly into the downloads — the
/// red "Download PDF" beside the blue Print (blue goes to the printer, red is
/// a file; owner, 2026-10-17). The same paper as the screen draws, laid out in
/// millimetres: the letterhead, the head lines, the prose, the items, the
/// signatures, the QR. One page per copy.

const INK = [29, 29, 31] as const
const MUTE = [110, 110, 115] as const
const RULE = [200, 200, 205] as const
const BAD = [215, 0, 21] as const

interface Paragraph {
  readonly text: string
  readonly bold: boolean
  readonly heading: boolean
  readonly align: "left" | "center" | "right" | "justify"
  readonly rule?: boolean
}

/// The prose, flattened to paragraphs a PDF can set: a list item becomes a
/// paragraph with its bullet or number, a line stays a line.
function paragraphsOf(body: unknown): Paragraph[] {
  const doc = body as JSONContent | null
  if (doc === null || typeof doc !== "object" || !Array.isArray(doc.content))
    return []
  const textOf = (node: JSONContent): { text: string; bold: boolean } => {
    const runs = (node.content ?? []).filter(
      (one) => one.type === "text" || one.type === "hardBreak"
    )
    const text = runs
      .map((one) => (one.type === "hardBreak" ? "\n" : (one.text ?? "")))
      .join("")
    const bold =
      runs.length > 0 &&
      runs.every(
        (one) =>
          one.type !== "text" ||
          (one.marks ?? []).some((mark) => mark.type === "bold")
      )
    return { text, bold }
  }
  const alignOf = (node: JSONContent): Paragraph["align"] => {
    const value = node.attrs?.textAlign
    return value === "center" || value === "right" || value === "justify"
      ? value
      : "left"
  }
  const out: Paragraph[] = []
  for (const node of doc.content) {
    if (node.type === "paragraph" || node.type === "heading") {
      const { text, bold } = textOf(node)
      out.push({
        text,
        bold: bold || node.type === "heading",
        heading: node.type === "heading",
        align: alignOf(node),
      })
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      ;(node.content ?? []).forEach((item, index) => {
        const first = (item.content ?? [])[0]
        if (first === undefined) return
        const { text, bold } = textOf(first)
        const mark = node.type === "bulletList" ? "•" : `${index + 1}.`
        out.push({ text: `${mark}  ${text}`, bold, heading: false, align: "left" })
      })
    } else if (node.type === "horizontalRule") {
      out.push({ text: "", bold: false, heading: false, align: "left", rule: true })
    }
  }
  return out
}

export function downloadLetterPdf({
  number,
  form,
  facts,
  items,
  body,
  author,
  signatures,
  copies,
  paper,
  link,
  voided,
}: {
  number: string
  form: WrittenForm
  facts: WrittenFacts
  items: readonly WrittenItem[]
  body: unknown
  author: string
  signatures: readonly string[]
  /// The copy names, one page each; empty for a single unnamed copy.
  copies: readonly string[]
  paper: "A4" | "A5"
  /// What the QR opens: the letter in the register.
  link: string
  voided: string | null
}): void {
  const doc = new jsPDF({ unit: "mm", format: paper === "A5" ? "a5" : "a4" })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  // A5 is A4 at 0.707: every size follows the sheet.
  const k = pageW / 210
  const MARGIN = 16 * k
  const W = pageW - 2 * MARGIN
  const pt = (size: number) => size * k
  const prose = paragraphsOf(body)
  const rows = items.filter((item) => item.name.trim() !== "")
  let y = MARGIN

  const room = (need: number) => {
    if (y + need <= pageH - MARGIN) return
    doc.addPage()
    y = MARGIN
  }
  const ink = () => doc.setTextColor(...INK)
  const mute = () => doc.setTextColor(...MUTE)

  const page = (copy: string | undefined) => {
    y = MARGIN
    if (copy !== undefined) {
      mute()
      doc.setFont("helvetica", "normal").setFontSize(pt(8))
      doc.text(copy, pageW - MARGIN, MARGIN - 7 * k, { align: "right" })
    }

    // — letterhead —
    ink()
    doc.setFont("helvetica", "bold").setFontSize(pt(14))
    doc.text(COMPANY.name.toUpperCase(), MARGIN, y + 5 * k)
    doc.setFontSize(pt(13))
    doc.text(form.paper.toUpperCase(), pageW - MARGIN, y + 5 * k, {
      align: "right",
    })
    mute()
    doc.setFont("helvetica", "normal").setFontSize(pt(9))
    doc.text(COMPANY.address, MARGIN, y + 10 * k)
    ink()
    doc.setFont("courier", "normal").setFontSize(pt(9.5))
    doc.text(number, pageW - MARGIN, y + 10 * k, { align: "right" })
    y += 13.5 * k
    doc.setDrawColor(...INK).setLineWidth(0.6 * k)
    doc.line(MARGIN, y, pageW - MARGIN, y)
    y += 6 * k

    // — head lines, two columns —
    const colW = (W - 8 * k) / 2
    const lineH = 5 * k
    for (let at = 0; at < form.head.length; at += 2) {
      const pair = form.head.slice(at, at + 2)
      let tallest = lineH
      pair.forEach((line, side) => {
        const x = MARGIN + side * (colW + 8 * k)
        mute()
        doc.setFont("helvetica", "normal").setFontSize(pt(10))
        doc.text(line.label, x, y + 3.6 * k)
        doc.text(":", x + 30 * k, y + 3.6 * k)
        const value = facts[line.key] ?? ""
        if (value === "" && line.blank !== undefined) {
          doc.setDrawColor(...INK).setLineWidth(0.2 * k)
          doc.setLineDashPattern([0.4 * k, 0.8 * k], 0)
          doc.line(x + 33 * k, y + 4.2 * k, x + colW, y + 4.2 * k)
          doc.setLineDashPattern([], 0)
        } else {
          ink()
          doc.setFont("helvetica", "bold")
          const lines = doc.splitTextToSize(value, colW - 33 * k) as string[]
          doc.text(lines, x + 33 * k, y + 3.6 * k)
          tallest = Math.max(tallest, lines.length * lineH)
        }
      })
      y += tallest
    }
    y += 4 * k

    // — prose —
    const paragraph = (one: Paragraph) => {
      if (one.rule) {
        room(4 * k)
        doc.setDrawColor(...RULE).setLineWidth(0.3 * k)
        doc.line(MARGIN, y + 1.5 * k, pageW - MARGIN, y + 1.5 * k)
        y += 4 * k
        return
      }
      ink()
      doc
        .setFont("helvetica", one.bold ? "bold" : "normal")
        .setFontSize(pt(one.heading ? 11 : 10))
      if (one.text === "") {
        y += 4 * k
        return
      }
      const lines = doc.splitTextToSize(one.text, W) as string[]
      const height = lines.length * 5 * k
      room(height)
      const x =
        one.align === "center"
          ? pageW / 2
          : one.align === "right"
            ? pageW - MARGIN
            : MARGIN
      doc.text(
        lines,
        x,
        y + 3.6 * k,
        one.align === "justify"
          ? { align: "justify", maxWidth: W }
          : { align: one.align }
      )
      y += height + 2.2 * k
    }
    prose.forEach(paragraph)

    // — items —
    if (form.items) {
      const cols = [
        { label: "No", w: 9 * k, align: "center" as const },
        { label: "Nama barang", w: 0, align: "left" as const },
        { label: "Jumlah", w: 18 * k, align: "right" as const },
        { label: "Satuan", w: 20 * k, align: "left" as const },
        { label: "Keterangan", w: 38 * k, align: "left" as const },
      ]
      const fixed = cols.reduce((sum, col) => sum + col.w, 0)
      const widths = cols.map((col) => (col.w === 0 ? W - fixed : col.w))
      const xs = widths.map(
        (_, index) =>
          MARGIN + widths.slice(0, index).reduce((sum, w) => sum + w, 0)
      )
      const cell = (text: string, index: number, at: number) => {
        const col = cols[index]!
        const x =
          col.align === "center"
            ? xs[index]! + widths[index]! / 2
            : col.align === "right"
              ? xs[index]! + widths[index]! - 1.5 * k
              : xs[index]! + 1.5 * k
        doc.text(text, x, at, { align: col.align })
      }
      room(14 * k)
      y += 1 * k
      doc.setDrawColor(...INK).setLineWidth(0.4 * k)
      doc.line(MARGIN, y, pageW - MARGIN, y)
      ink()
      doc.setFont("helvetica", "bold").setFontSize(pt(9.5))
      cols.forEach((col, index) => cell(col.label, index, y + 4.4 * k))
      y += 6.5 * k
      doc.line(MARGIN, y, pageW - MARGIN, y)
      doc.setFont("helvetica", "normal")
      rows.forEach((item, index) => {
        const name = doc.splitTextToSize(item.name, widths[1]! - 3 * k) as string[]
        const note = doc.splitTextToSize(item.note, widths[4]! - 3 * k) as string[]
        const height = Math.max(name.length, note.length, 1) * 4.6 * k + 2.2 * k
        room(height)
        ink()
        cell(String(index + 1), 0, y + 4.2 * k)
        doc.text(name, xs[1]! + 1.5 * k, y + 4.2 * k)
        cell(item.quantity, 2, y + 4.2 * k)
        mute()
        cell(item.unit, 3, y + 4.2 * k)
        ink()
        doc.text(note, xs[4]! + 1.5 * k, y + 4.2 * k)
        y += height
        doc.setDrawColor(...RULE).setLineWidth(0.2 * k)
        doc.line(MARGIN, y, pageW - MARGIN, y)
      })
      y += 5 * k
    }

    if (form.closing !== undefined) {
      paragraph({
        text: facts.closing ?? form.closing,
        bold: false,
        heading: false,
        align: "left",
      })
    }

    // — signatures —
    const n = Math.max(form.signs.length, 2)
    const signW = (W - (n - 1) * 8 * k) / n
    room(42 * k)
    y += 6 * k
    form.signs.forEach((sign, index) => {
      const x = MARGIN + index * (signW + 8 * k)
      const mid = x + signW / 2
      const derived =
        sign.name === "author"
          ? author
          : sign.name !== undefined
            ? (facts[sign.name] ?? "")
            : ""
      const name = (signatures[index] ?? "") !== "" ? signatures[index]! : derived
      const role = sign.role !== undefined ? (facts[sign.role] ?? "") : ""
      mute()
      doc.setFont("helvetica", "normal").setFontSize(pt(9.5))
      doc.text(`${sign.caption},`, mid, y + 3.5 * k, { align: "center" })
      doc.setDrawColor(...INK).setLineWidth(0.25 * k)
      doc.line(x, y + 26 * k, x + signW, y + 26 * k)
      ink()
      doc.setFont("helvetica", "bold")
      if (name !== "") doc.text(name, mid, y + 31 * k, { align: "center" })
      if (role !== "") {
        mute()
        doc.setFont("helvetica", "normal").setFontSize(pt(8.5))
        doc.text(role, mid, y + 35.5 * k, { align: "center" })
      }
    })
    y += 40 * k

    // — the QR that tracks it, at the foot —
    const size = 22 * k
    const qrY = Math.max(y + 4 * k, pageH - MARGIN - size)
    if (qrY + size <= pageH - MARGIN + 0.1) {
      const modules = qrModules(link)
      const cellSize = size / modules.length
      doc.setFillColor(...INK)
      modules.forEach((cells, row) =>
        cells.forEach((dark, col) => {
          if (dark)
            doc.rect(
              MARGIN + col * cellSize,
              qrY + row * cellSize,
              cellSize,
              cellSize,
              "F"
            )
        })
      )
      mute()
      doc.setFont("helvetica", "normal").setFontSize(pt(8))
      doc.text(["Scan to track", number], MARGIN + size + 4 * k, qrY + size - 5 * k)
    }

    if (voided !== null) {
      doc.setTextColor(...BAD)
      doc.setFont("helvetica", "bold").setFontSize(pt(10))
      doc.text(
        `SURAT INI DIBATALKAN${voided !== "" ? ` — ${voided}` : ""}`,
        pageW - MARGIN,
        pageH - MARGIN,
        { align: "right" }
      )
    }
  }

  const names = copies.length > 0 ? copies : [undefined]
  names.forEach((copy, index) => {
    if (index > 0) doc.addPage()
    page(copy)
  })

  doc.save(`${number.replaceAll("/", "-")}.pdf`)
}
