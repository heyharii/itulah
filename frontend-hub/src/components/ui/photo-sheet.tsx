import { Loader2, Scissors, Sparkles, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import Cropper, { type Area } from "react-easy-crop"

import { Button } from "@/components/ui/button"
import { LONGEST_EDGE, QUALITY, tidyPhoto } from "@/lib/image"
import { cn } from "@/lib/utils"

/// Check the Photo (owner, 2026-10-06; option D of `photo-clean-prototype.html`).
///
/// A photograph is never touched on its way in. It is shown here first, as it
/// was taken, and what can be done to it is two buttons, both optional:
///
///  - **Clean Up** takes the background off, lays the garment on white and cuts
///    the picture square round it (the service in `lib/image`). A switch
///    Original | Clean then lets either be looked at.
///  - **Crop** shows a square frame over whichever is on show, and one slider
///    to zoom. Nothing to size, nothing to choose between.
///
/// **Use Photo** keeps what is on show; **Retake** starts again. Skip both
/// buttons and the photo is kept as it was taken. **Done** in the crop keeps
/// the cut picture and closes the sheet, as Use Photo does.
export function PhotoSheet({
  file,
  onUse,
  onRetake,
  onCancel,
}: {
  file: Blob
  onUse: (photo: Blob) => void
  onRetake: () => void
  onCancel: () => void
}) {
  // Each variant is a blob and the URL that shows it. URLs are made in the
  // handlers and put away in `finish`, not by an effect's cleanup: React mounts
  // effects twice in development, and a URL revoked in the first cleanup is
  // dead for the second.
  const first = useMemo(
    () => ({ blob: file, url: URL.createObjectURL(file) }),
    [file]
  )
  const original = first
  const [clean, setClean] = useState<{ blob: Blob; url: string } | null>(null)
  const [pick, setPick] = useState<"original" | "clean">("original")
  const [state, setState] = useState<"idle" | "working" | "failed">("idle")
  const [cropping, setCropping] = useState(false)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<Area | null>(null)
  const [failed, setFailed] = useState(false)

  const shown = pick === "clean" && clean !== null ? clean : original

  const finish = (after: () => void) => {
    URL.revokeObjectURL(original.url)
    if (clean !== null) URL.revokeObjectURL(clean.url)
    after()
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      if (cropping) setCropping(false)
      else finish(onCancel)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  })

  const cleanUp = () => {
    if (state === "working" || clean !== null) return
    setState("working")
    tidyPhoto(original.blob as File).then(
      (blob) => {
        setClean({ blob, url: URL.createObjectURL(blob) })
        setPick("clean")
        setState("idle")
      },
      () => setState("failed")
    )
  }

  const startCrop = () => {
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setArea(null)
    setFailed(false)
    setCropping(true)
  }
  const doneCrop = async () => {
    if (area === null) return
    try {
      const cut = await cutOut(shown.url, area)
      // Done is the end of the edit: the cut picture is the one kept and the
      // sheet closes (owner, 2026-10-06 — it came back up after a crop).
      finish(() => onUse(cut))
    } catch {
      setFailed(true)
    }
  }

  const status =
    state === "failed" ? (
      <span className="text-bad-fg">
        Could not clean this photo. The original is fine to use.
      </span>
    ) : failed ? (
      <span className="text-bad-fg">This picture could not be cut.</span>
    ) : cropping ? null : pick === "clean" && clean !== null ? (
      "Background removed, photo squared."
    ) : (
      "As it was taken."
    )

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Check the photo"
      className="fixed inset-0 z-[300] flex flex-col bg-canvas"
    >
      <div className="flex h-14 shrink-0 items-center pr-2 pl-4">
        <b className="flex-1 text-[1.0625rem] font-semibold">Check the Photo</b>
        <button
          type="button"
          aria-label="Cancel"
          onClick={() => finish(onCancel)}
          className="grid size-11 place-items-center rounded-full text-line-ico"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {clean !== null && !cropping && (
          <div className="flex gap-0.5 rounded-[0.625rem] bg-soft-2 p-0.5">
            {(
              [
                ["original", "Original"],
                ["clean", "Clean"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={pick === value}
                onClick={() => setPick(value)}
                className={cn(
                  "h-10 flex-1 rounded-[0.5rem] text-[0.9375rem] font-medium text-body transition-[background-color,color] duration-150 ease-(--ease-out)",
                  pick === value && "bg-canvas text-ink shadow-soft"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="grid min-h-0 flex-1 place-items-center">
          <div
            className={cn(
              "relative aspect-square max-h-full w-full max-w-full overflow-hidden rounded-card border border-hairline",
              cropping ? "border-0 bg-black" : "bg-soft-2"
            )}
          >
            {cropping ? (
              <Cropper
                image={shown.url}
                crop={crop}
                zoom={zoom}
                aspect={1}
                maxZoom={4}
                showGrid
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setArea(pixels)}
              />
            ) : (
              <>
                <img
                  src={original.url}
                  alt="The photo as it was taken"
                  className={cn(
                    "absolute inset-0 size-full object-contain transition-[opacity,filter] duration-300 ease-(--ease-out) motion-reduce:transition-none",
                    pick === "clean" && clean !== null
                      ? "opacity-0"
                      : "opacity-100",
                    state === "working" && "blur-[1.5px] saturate-75"
                  )}
                />
                {clean !== null && (
                  <img
                    src={clean.url}
                    alt="The photo with its background taken off"
                    className={cn(
                      "absolute inset-0 size-full bg-white object-contain transition-opacity duration-300 ease-(--ease-out) motion-reduce:transition-none",
                      pick === "clean" ? "opacity-100" : "opacity-0"
                    )}
                  />
                )}
                {state === "working" && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 animate-[assistant-shimmer_1.3s_linear_infinite] bg-[linear-gradient(100deg,transparent_30%,rgb(255_255_255/0.55)_50%,transparent_70%)] bg-[length:200%_100%] bg-[position:200%_0] motion-reduce:animate-none"
                  />
                )}
              </>
            )}
          </div>
        </div>

        {cropping ? (
          <>
            <input
              type="range"
              aria-label="Zoom"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="h-11 w-full accent-ink"
            />
            <div className="flex gap-2">
              <Button data-cancel
                size="lg"
                className="h-12 flex-1 justify-center"
                onClick={() => setCropping(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="h-12 flex-1 justify-center"
                disabled={area === null}
                onClick={() => void doneCrop()}
              >
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-2">
              {
                <Button
                  size="lg"
                  className="h-12 flex-1 justify-center"
                  disabled={state === "working" || clean !== null}
                  onClick={cleanUp}
                >
                  {state === "working" ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Cleaning…
                    </>
                  ) : clean !== null ? (
                    "Cleaned"
                  ) : state === "failed" ? (
                    <>
                      <Sparkles />
                      Try Again
                    </>
                  ) : (
                    <>
                      <Sparkles />
                      Clean Up
                    </>
                  )}
                </Button>
              }
              <Button
                size="lg"
                className="h-12 flex-1 justify-center"
                disabled={state === "working"}
                onClick={startCrop}
              >
                <Scissors />
                Crop
              </Button>
            </div>
            <p
              role="status"
              className="min-h-5 text-center text-[0.9375rem] text-body"
            >
              {status}
            </p>
            <div className="flex gap-2">
              <Button
                size="lg"
                className="h-12 flex-1 justify-center"
                onClick={() => finish(onRetake)}
              >
                Retake
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="h-12 flex-1 justify-center"
                disabled={state === "working"}
                onClick={() => finish(() => onUse(shown.blob))}
              >
                Use Photo
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

/// The part of the picture inside the frame, as a JPEG within the bound.
async function cutOut(url: string, area: Area): Promise<File> {
  const image = new Image()
  image.src = url
  await image.decode()
  const scale = Math.min(1, LONGEST_EDGE / Math.max(area.width, area.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(area.width * scale))
  canvas.height = Math.max(1, Math.round(area.height * scale))
  const context = canvas.getContext("2d")
  if (context === null) throw new Error("no canvas")
  // White under it: a cleaned picture is a JPEG on white, and a crop that
  // reaches past its edge should reach into white, not black.
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, canvas.width, canvas.height)
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
    canvas.toBlob(resolve, "image/jpeg", QUALITY)
  )
  if (blob === null) throw new Error("no jpeg")
  return new File([blob], "photo.jpg", { type: "image/jpeg" })
}
