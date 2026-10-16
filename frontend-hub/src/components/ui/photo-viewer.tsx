import { X } from "lucide-react"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

/// A photograph, full size, over whatever is on screen.
///
/// Tap it, see it: the thumbnails in this app are 40px, and a buyer deciding
/// whether this is the garment on the order cannot tell from a postage stamp
/// (owner, 2026-10-06). A tap, a click outside, ✕ or Escape puts it away.
export function PhotoViewer({
  url,
  name,
  placeholder,
  onClose,
}: {
  url: string
  name?: string
  /// What is shown, large, when there is no photograph: the painted silhouette,
  /// with the plain words under it — a tap on a picture answers something
  /// rather than nothing.
  placeholder?: React.ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      // The sheets beneath listen for Escape too: this one is on top, and
      // closes alone.
      event.stopPropagation()
      onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name ? `Photo of ${name}` : "Photo"}
      onClick={onClose}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {url === "" && placeholder !== undefined ? (
        <div className="flex flex-col items-center gap-3">
          {placeholder}
          <p className="text-[0.9375rem] text-white/80">No photo yet</p>
        </div>
      ) : (
        <img
          src={url}
          alt={name ?? ""}
          className="max-h-full max-w-full rounded-card object-contain"
        />
      )}
      <button
        type="button"
        aria-label="Close photo"
        onClick={onClose}
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 grid size-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.92]"
      >
        <X className="size-5" />
      </button>
    </div>,
    document.body
  )
}

/// Wraps a thumbnail so a tap opens it full size. With no real photograph
/// (`url` empty) it is the thumbnail and nothing else.
export function ZoomPhoto({
  url,
  name,
  placeholder,
  className,
  children,
}: {
  url: string | null | undefined
  name?: string
  /// Shown large when there is no photograph, so the tap is never dead. Left
  /// out, a thumbnail with no photograph is the thumbnail and nothing else.
  placeholder?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const none = url === null || url === undefined || url === ""
  if (none && placeholder === undefined)
    return <span className={className}>{children}</span>
  return (
    <>
      <button
        type="button"
        aria-label={
          none
            ? name
              ? `View ${name}`
              : "View"
            : name
              ? `View the photo of ${name}`
              : "View the photo"
        }
        onClick={(event) => {
          // A card or a row around it opens its own record on a tap.
          event.stopPropagation()
          setOpen(true)
        }}
        className={cn(
          "block shrink-0 cursor-zoom-in rounded-inner transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.96]",
          className
        )}
      >
        {children}
      </button>
      {open && (
        <PhotoViewer
          url={none ? "" : url}
          name={name}
          placeholder={placeholder}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
