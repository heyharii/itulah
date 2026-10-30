/// The picture this store prints at the top of its receipts (Hari, 30 Oct
/// 2026): set per store in the hub, carried to the shop by the node, drawn
/// here as a PNG for the struk on the screen. One bit a dot, 1 for black.

import { useEffect, useState } from "react"

import { edge } from "@/edge"

type Bitmap = { readonly width: number; readonly height: number; readonly bits_b64: string }

/// `GET /api/v1/store/receipt-header` — `{ wide, narrow }`, each a bitmap or null.
export const receiptHeader = () =>
  edge<{ readonly wide?: Bitmap | null; readonly narrow?: Bitmap | null }>(
    "GET",
    "/api/v1/store/receipt-header",
  )

function toDataUrl(bitmap: Bitmap): string | null {
  try {
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext("2d")
    if (context === null) return null
    const binary = atob(bitmap.bits_b64)
    const rowBytes = bitmap.width / 8
    const image = context.createImageData(bitmap.width, bitmap.height)
    for (let y = 0; y < bitmap.height; y++) {
      for (let x = 0; x < bitmap.width; x++) {
        const black = (binary.charCodeAt(y * rowBytes + (x >> 3)) & (0x80 >> (x & 7))) !== 0
        const at = (y * bitmap.width + x) * 4
        image.data[at] = image.data[at + 1] = image.data[at + 2] = black ? 0 : 255
        image.data[at + 3] = 255
      }
    }
    context.putImageData(image, 0, 0)
    return canvas.toDataURL("image/png")
  } catch {
    return null
  }
}

let known: string | null | undefined

/// The picture as a PNG data URL, asked once while this window lives; null
/// when the store has none (the head is then the words).
export function useReceiptHeaderImage(): string | null {
  const [image, setImage] = useState<string | null>(known ?? null)
  useEffect(() => {
    if (known !== undefined) return
    let alive = true
    void receiptHeader().then((reply) => {
      const bitmap = reply.ok ? (reply.body?.wide ?? null) : null
      const got = bitmap === null ? null : toDataUrl(bitmap)
      if (reply.ok) known = got
      if (alive) setImage(got)
    })
    return () => {
      alive = false
    }
  }, [])
  return image
}
