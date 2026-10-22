import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { useState } from "react"

import { cn } from "@/lib/utils"

/// The photograph's half of the move: up from 0.96 as the window fades in,
/// back to it as it fades out. Reduced motion keeps the fade only.
const RISE =
  "transition-[scale] duration-(--t-panel) ease-(--ease-out) group-data-[ending-style]:scale-[0.96] group-data-[starting-style]:scale-[0.96] motion-reduce:group-data-[ending-style]:scale-100 motion-reduce:group-data-[starting-style]:scale-100"

/// A photograph, full size, over whatever is on screen.
///
/// Tap it, see it: the thumbnails in this app are 40px, and a buyer deciding
/// whether this is the garment on the order cannot tell from a postage stamp
/// (owner, 2026-10-06). A tap, a click outside, ✕ or Escape puts it away.
///
/// A Base UI dialog, so focus stays on it while it is up and goes back to the
/// thumbnail after; opened over a sheet it is that sheet's child, and Escape
/// closes it alone. It moves as a confirmation does (`Dialog`), centred: the
/// black fades in over `t-panel` and the photograph comes up from 0.96 on
/// `ease-out`, and both leave the same way. Nothing flies out of the
/// thumbnail — there are two moves, and this is not a third.
export function PhotoViewer({
  open,
  onOpenChange,
  url,
  name,
  placeholder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  url: string
  name?: string
  /// What is shown, large, when there is no photograph: the painted silhouette,
  /// with the plain words under it — a tap on a picture answers something
  /// rather than nothing.
  placeholder?: React.ReactNode
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          // Drawn over a sheet too: Base UI skips a nested dialog's backdrop
          // by default, and the photograph would stand on the sheet's veil.
          forceRender
          className="fixed inset-0 z-[300] bg-black/90 transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        {/* The whole window, so a tap anywhere — the photograph too — puts it
            away. Not scaled itself: the ✕ is fixed to the window's corner, and
            a scale here would carry it in with the photograph. */}
        <BaseDialog.Popup
          aria-label={name ? `Photo of ${name}` : "Photo"}
          onClick={(event) => {
            // Through the portal a click still bubbles up React's tree, to the
            // row or card the thumbnail sits in — which would open its record.
            event.stopPropagation()
            onOpenChange(false)
          }}
          className="group fixed inset-0 z-[300] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] transition-opacity duration-(--t-panel) ease-(--ease-out) outline-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        >
          {url === "" && placeholder !== undefined ? (
            <div className={cn("flex flex-col items-center gap-3", RISE)}>
              {placeholder}
              <p className="text-[0.9375rem] text-white/80">No photo yet</p>
            </div>
          ) : (
            <img
              src={url}
              alt={name ?? ""}
              className={cn(
                "max-h-full max-w-full rounded-card object-contain",
                RISE
              )}
            />
          )}
          <BaseDialog.Close
            aria-label="Close photo"
            className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 grid size-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.92]"
          >
            <X className="size-5" />
          </BaseDialog.Close>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
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
      {/* Always rendered, so the photograph can leave the way it came: a
          viewer unmounted on close would vanish mid-step. */}
      <PhotoViewer
        open={open}
        onOpenChange={setOpen}
        url={none ? "" : url}
        name={name}
        placeholder={placeholder}
      />
    </>
  )
}
