import QRCode from "qrcode"

/// A QR code's modules, row by row: `true` is dark. Drawn by a print as an SVG
/// and by a PDF as filled squares, so neither waits for an image.
export function qrModules(text: string): readonly (readonly boolean[])[] {
  // A link is long and printed small: the lowest correction keeps its modules
  // big enough to read from a phone.
  const code = QRCode.create(text, {
    errorCorrectionLevel: text.startsWith("http") ? "L" : "M",
  })
  const size = code.modules.size
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => code.modules.get(row, col) === 1)
  )
}

/// The same code as an inline SVG, in the paper's ink, with its quiet zone.
export function qrSvg(text: string): string {
  const modules = qrModules(text)
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

/// What a PO's QR carries (owner, 2026-10-16): the order's public page,
/// `/p/{token}` (0971), which opens with no login and says whether the order
/// is still active — as the surat jalan's QR opens the note.
export function orderLink(token: string): string {
  return `${window.location.origin}/p/${encodeURIComponent(token)}`
}
