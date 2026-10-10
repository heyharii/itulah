import { ImagePlus, X } from "lucide-react"
import { useRef, useState } from "react"

import { PhotoImg } from "@/components/ui/photo-img"
import { ZoomPhoto } from "@/components/ui/photo-viewer"
import { asJpeg, PICTURE_TYPES } from "@/lib/image"
import { uploadOrderPhoto } from "@/lib/queries/procurement"
import { toast } from "@/lib/toast"

/// Photographs a variant may carry — the server's own ceiling (0961).
const MAX_PER_VARIANT = 12

/// What one SKU of an order line looks like (the owner, 2026-10-10).
///
/// Optional and many: a variant with none is shown with the item's own picture,
/// so the ordinary row is just a quiet add tile. Each photograph goes up the
/// moment it is picked, so the order only ever carries links; the first of a
/// colour becomes that colourway's photograph in New Articles.
export function VariantPhotos({
  photos,
  onChange,
  name,
}: {
  photos: readonly string[]
  onChange: (next: readonly string[]) => void
  /// "Linen Shirt Khaki XXL" — what the tiles are photographs of.
  name: string
}) {
  /// Photographs still on their way up, shown as waiting tiles.
  const [sending, setSending] = useState(0)
  /// The latest list, so two uploads finishing together both land.
  const latest = useRef(photos)
  latest.current = photos

  const add = async (files: readonly File[]) => {
    const room = MAX_PER_VARIANT - photos.length
    const chosen = files.slice(0, Math.max(0, room))
    if (chosen.length < files.length)
      toast.error(`A variant holds at most ${MAX_PER_VARIANT} photos.`)
    if (chosen.length === 0) return
    setSending((was) => was + chosen.length)
    await Promise.all(
      chosen.map(async (file) => {
        try {
          const url = await uploadOrderPhoto(await asJpeg(file))
          latest.current = [...latest.current, url]
          onChange(latest.current)
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "The photo did not upload."
          )
        } finally {
          setSending((was) => was - 1)
        }
      })
    )
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {photos.map((url, at) => (
        <span key={url} className="relative inline-grid">
          <ZoomPhoto url={url} name={name}>
            <span className="grid size-9 overflow-hidden rounded-inner border border-hairline">
              <PhotoImg url={url} alt={name} className="size-full object-cover" />
            </span>
          </ZoomPhoto>
          <button
            type="button"
            aria-label={`Remove photo ${at + 1} of ${name}`}
            onClick={() => onChange(photos.filter((_, index) => index !== at))}
            className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border border-hairline bg-canvas text-body shadow-soft transition-[scale] duration-(--t-press) ease-(--ease-out) after:absolute after:-inset-2 after:content-[''] active:scale-[0.9]"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {Array.from({ length: sending }, (_, at) => (
        <span
          key={`waiting-${at}`}
          aria-label="Uploading"
          className="size-9 animate-pulse rounded-inner bg-soft-2"
        />
      ))}
      {photos.length + sending < MAX_PER_VARIANT && (
        <label
          title={`Add photos of ${name}`}
          className="grid size-9 cursor-pointer place-items-center rounded-inner border border-dashed border-hairline-strong text-mute transition-[color,scale] duration-(--t-press) ease-(--ease-out) hover:text-ink active:scale-[0.96]"
        >
          <ImagePlus className="size-4" />
          <input
            type="file"
            accept={PICTURE_TYPES}
            multiple
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ""
              void add(files)
            }}
          />
        </label>
      )}
    </span>
  )
}
