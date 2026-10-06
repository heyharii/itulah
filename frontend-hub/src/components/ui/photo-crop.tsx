import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import Cropper, { type Area } from "react-easy-crop"

import { Button } from "@/components/ui/button"

/// The longest edge a cropped picture is stored at — `lib/image`'s bound.
const LONGEST_EDGE = 1600

/// Cut a photograph square before it is kept (owner, 2026-10-06).
///
/// Drag to move it under the frame, pinch or slide to zoom. The result is the
/// JPEG the image store takes, the part inside the frame and nothing else —
/// a garment shot with a floor and a hand around it, kept as the garment.
export function PhotoCrop({
  file,
  onDone,
  onCancel,
}: {
  file: Blob
  onDone: (cropped: File) => void
  onCancel: () => void
}) {
  // Made once and put away by the handlers below, not by an effect's cleanup:
  // React mounts effects twice in development, and a URL revoked in the first
  // cleanup is dead for the second mount.
  const url = useMemo(() => URL.createObjectURL(file), [file])
  const finish = (after: () => void) => {
    URL.revokeObjectURL(url)
    after()
  }
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      finish(onCancel)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onCancel]) // eslint-disable-line react-hooks/exhaustive-deps

  const use = async () => {
    if (area === null || busy) return
    setBusy(true)
    setFailed(false)
    try {
      const cutOut = await cut(url, area)
      finish(() => onDone(cutOut))
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop the photo"
      className="fixed inset-0 z-[300] flex flex-col bg-black"
    >
      <div className="relative min-h-0 flex-1">
        <Cropper
          image={url}
          crop={crop}
          zoom={zoom}
          aspect={1}
          maxZoom={4}
          showGrid
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, pixels) => setArea(pixels)}
        />
      </div>
      <div className="flex flex-col gap-3 bg-black px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <input
          type="range"
          aria-label="Zoom"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="h-11 w-full accent-white"
        />
        {failed && (
          <p className="text-[0.875rem] text-bad-fg">
            This picture could not be cut. Try another.
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="flex-1 justify-center"
            onClick={() => finish(onCancel)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1 justify-center"
            disabled={area === null || busy}
            onClick={() => void use()}
          >
            Use Photo
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/// The part of the picture inside the frame, as a JPEG within the bound.
async function cut(url: string, area: Area): Promise<File> {
  const image = new Image()
  image.src = url
  await image.decode()
  const scale = Math.min(1, LONGEST_EDGE / Math.max(area.width, area.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(area.width * scale))
  canvas.height = Math.max(1, Math.round(area.height * scale))
  const context = canvas.getContext("2d")
  if (context === null) throw new Error("no canvas")
  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    canvas.width,
    canvas.height
  )
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85)
  )
  if (blob === null) throw new Error("no jpeg")
  return new File([blob], "photo.jpg", { type: "image/jpeg" })
}
