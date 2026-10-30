import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import {
  clearReceiptHeader,
  receiptHeaderKey,
  receiptHeaderQuery,
  saveReceiptHeader,
  type ReceiptHeaderBitmap,
} from "@/lib/queries/stores"
import { toast } from "@/lib/toast"

/// "Receipt picture: Set · Change" on a store's Overview. The picture a store
/// prints at the top of its receipts, in place of CENTRAL, the shop's name and
/// its address (owner, 30 Oct 2026). The person uploads any image; this makes
/// the two paper widths (80 mm = 576 dots, 58 mm = 384) one bit a dot, with
/// dithering, and shows exactly what will print before it is saved.

const WIDE = 576
const NARROW = 384
const MAX_ROWS = { [WIDE]: 400, [NARROW]: 270 } as const

/// Draw `source` at `width` dots across, white behind it, then make it black
/// and white with Floyd–Steinberg so photographs and logos keep their shades.
function toBitmap(
  source: CanvasImageSource & { width: number; height: number },
  width: number
): { bitmap: ReceiptHeaderBitmap; canvas: HTMLCanvasElement } {
  const scale = width / source.width
  const rows = Math.min(
    Math.max(8, Math.round(source.height * scale)),
    MAX_ROWS[width as keyof typeof MAX_ROWS]
  )
  // Rows are padded to a multiple of 8 only in width, which is already one.
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = rows
  const context = canvas.getContext("2d")
  if (context === null) throw new Error("This browser cannot draw the picture.")
  context.fillStyle = "#fff"
  context.fillRect(0, 0, width, rows)
  context.drawImage(source, 0, 0, width, Math.round(source.height * scale))
  const image = context.getImageData(0, 0, width, rows)
  const grey = new Float32Array(width * rows)
  for (let at = 0; at < grey.length; at++) {
    const [r, g, b] = [image.data[at * 4], image.data[at * 4 + 1], image.data[at * 4 + 2]]
    grey[at] = 0.299 * r + 0.587 * g + 0.114 * b
  }
  const bytes = new Uint8Array((width / 8) * rows)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x
      const old = grey[at]
      const black = old < 128
      const error = old - (black ? 0 : 255)
      if (x + 1 < width) grey[at + 1] += (error * 7) / 16
      if (y + 1 < rows) {
        if (x > 0) grey[at + width - 1] += (error * 3) / 16
        grey[at + width] += (error * 5) / 16
        if (x + 1 < width) grey[at + width + 1] += error / 16
      }
      if (black) bytes[y * (width / 8) + (x >> 3)] |= 0x80 >> (x & 7)
      const shade = black ? 0 : 255
      image.data[at * 4] = image.data[at * 4 + 1] = image.data[at * 4 + 2] = shade
      image.data[at * 4 + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  let binary = ""
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return {
    bitmap: { width, height: rows, bits_b64: btoa(binary) },
    canvas,
  }
}

/// A saved bitmap back on a canvas, for the preview.
export function drawBitmap(
  canvas: HTMLCanvasElement,
  bitmap: ReceiptHeaderBitmap
): void {
  const context = canvas.getContext("2d")
  if (context === null) return
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const binary = atob(bitmap.bits_b64)
  const image = context.createImageData(bitmap.width, bitmap.height)
  const rowBytes = bitmap.width / 8
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const black =
        (binary.charCodeAt(y * rowBytes + (x >> 3)) & (0x80 >> (x & 7))) !== 0
      const at = (y * bitmap.width + x) * 4
      image.data[at] = image.data[at + 1] = image.data[at + 2] = black ? 0 : 255
      image.data[at + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
}

function Preview({ bitmap }: { bitmap: ReceiptHeaderBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current !== null) drawBitmap(ref.current, bitmap)
  }, [bitmap])
  return (
    <canvas
      ref={ref}
      className="w-full border border-hairline bg-white"
      style={{ imageRendering: "pixelated" }}
    />
  )
}

export function ReceiptHeaderValue({
  unit,
  canManage,
}: {
  unit: string
  canManage: boolean
}) {
  const [open, setOpen] = useState(false)
  const header = useQuery(receiptHeaderQuery(unit))
  return (
    <>
      {header.data?.present === true ? "Set" : "Not set"}
      {canManage && (
        <>
          {" · "}
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => setOpen(true)}
          >
            {header.data?.present === true ? "Change" : "Upload"}
          </button>
          <ReceiptHeaderSheet unit={unit} open={open} onOpenChange={setOpen} />
        </>
      )}
    </>
  )
}

function ReceiptHeaderSheet({
  unit,
  open,
  onOpenChange,
}: {
  unit: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const header = useQuery({ ...receiptHeaderQuery(unit), enabled: open })
  const [made, setMade] = useState<{
    wide: ReceiptHeaderBitmap
    narrow: ReceiptHeaderBitmap
  } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setMade(null)
      setProblem(null)
    }
  }, [open])

  const save = useMutation({
    mutationFn: () => {
      if (made === null) throw new Error("Choose a picture first.")
      return saveReceiptHeader(unit, made)
    },
    onSuccess: (view) => {
      client.setQueryData(receiptHeaderKey(unit), view)
      toast.success("Receipt picture saved", {
        description: "It reaches the store's server with its next policy.",
      })
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error("Receipt picture not saved", { description: error.message }),
  })
  const remove = useMutation({
    mutationFn: () => clearReceiptHeader(unit),
    onSuccess: (view) => {
      client.setQueryData(receiptHeaderKey(unit), view)
      toast.success("Receipt picture removed")
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error("Receipt picture not removed", { description: error.message }),
  })

  const choose = async (file: File | undefined) => {
    setProblem(null)
    if (file === undefined) return
    try {
      const image = await createImageBitmap(file)
      const wide = toBitmap(image, WIDE)
      const narrow = toBitmap(image, NARROW)
      setMade({ wide: wide.bitmap, narrow: narrow.bitmap })
    } catch {
      setMade(null)
      setProblem("That file is not a picture this page can read. Use PNG or JPG.")
    }
  }

  const shown = made?.wide ?? header.data?.wide ?? null
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Receipt picture"
      caption="Printed at the top of every receipt, in place of CENTRAL, the shop's name and the address."
      footer={
        <SheetFooter
          onCancel={() => onOpenChange(false)}
          danger={
            header.data?.present === true && made === null ? (
              <Button
                variant="ghost"
                pending={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Remove
              </Button>
            ) : undefined
          }
          primary={{
            label: "Save",
            pending: save.isPending,
            disabled: made === null,
            onClick: () => save.mutate(),
          }}
          note={made === null ? "Choose a picture first." : undefined}
        />
      }
    >
      <div className="flex flex-col gap-4 px-1 pb-4">
        <label className="flex flex-col gap-2 text-[0.9375rem] font-medium text-ink">
          Picture (PNG or JPG)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => void choose(event.target.files?.[0])}
          />
        </label>
        <p className="text-[0.9375rem] text-mute">
          Wide and in black and white prints best: 576 dots across for 80 mm
          paper, at most 400 rows (50 mm) tall. The No Nota and Kasir lines stay
          as text under it.
        </p>
        {problem !== null && (
          <p role="alert" className="text-[0.9375rem] text-bad-fg">
            {problem}
          </p>
        )}
        {shown !== null ? (
          <div className="flex flex-col gap-2">
            <p className="text-[0.9375rem] font-medium text-ink">
              {made !== null ? "What will print" : "Printing now"}
            </p>
            <Preview bitmap={shown} />
            <p className="text-[0.9375rem] text-mute">
              {shown.width} × {shown.height} dots
              {made === null && header.data?.updated_by
                ? ` · set by ${header.data.updated_by}`
                : ""}
            </p>
          </div>
        ) : (
          <p className="text-[0.9375rem] text-mute">
            No picture yet: receipts print the word CENTRAL and the shop's name.
          </p>
        )}
      </div>
    </Sheet>
  )
}
