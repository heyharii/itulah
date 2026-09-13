import { Dialog } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

/// The sheet — a floating panel, never a flush column.
///
/// It sits inset 20px from the top, right and bottom with the sheet radius and
/// a deep shadow. That inset is the whole statement: a panel stuck to the edge
/// reads as *a side of the application that has opened*, and a floating one
/// reads as *one document being held* — and the document is what is actually
/// open. A `border-left` on a square full-height column is the shape this
/// replaces.
///
/// It stands on the WHITE veil. Nothing in this system darkens.
///
/// **Its height follows the SCREEN, not its content.** A card that changes
/// height as its tabs change reads as restless, and worse, the button at its
/// foot moves between two clicks. Space left under the content is dealt with by
/// the content — a trailing note carries `mt-auto` — never by shrinking the
/// card.
///
/// Width is per-panel and deliberately not one number. A record is read; a
/// filter list is ticked. Stretching a column of checkboxes to a document's
/// width only moves each label away from its own count.
///
/// ## Why base-ui rather than the hand-written version
///
/// This was hand-rolled first — a backdrop, an Escape listener, a focus loop
/// walking `querySelectorAll` for tabbables — and it worked. It was still the
/// wrong call, because that list is not the whole job: a modal also has to
/// return focus to what opened it, mark the rest of the page `aria-hidden`,
/// stop the page behind it scrolling, and not fight the browser's own
/// top-layer. Every one of those is a separate bug found late, and there are
/// six more panels to build. The library owns the behaviour; the appearance
/// below is entirely ours.
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  width = "panel",
  foot,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  /// `panel` for a list to tick, `record` for something to read.
  width?: "panel" | "record"
  foot?: ReactNode
  children: ReactNode
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-[var(--veil)] backdrop-blur-[2px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          data-motion="travel"
          className={cn(
            "fixed top-5 right-5 bottom-5 z-41 flex flex-col overflow-hidden",
            "rounded-sheet border-line-2 bg-canvas shadow-sheet border",
            "outline-none",
            // The one piece of travel: it comes from the right edge it is
            // inset from, so the movement says where it came from rather than
            // decorating the arrival. Driven by base-ui's own start/end
            // attributes so the exit animates too — a panel that fades in and
            // vanishes is a panel that leaves no trace of where it went.
            // `duration-[240ms]`, not `duration-240`: Tailwind generates duration
            // utilities from a fixed scale and 240 is not on it, so the class
            // compiled to nothing — no transition, therefore no `transitionend`,
            // therefore base-ui never cleared `data-starting-style` and the panel
            // sat off-screen where its entrance had begun. A silent one: the
            // element was in the DOM, focused and scroll-locked, just invisible.
            "transition-[opacity,transform] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
            "data-[starting-style]:translate-x-6 data-[starting-style]:scale-[0.99] data-[starting-style]:opacity-0",
            "data-[ending-style]:translate-x-6 data-[ending-style]:scale-[0.99] data-[ending-style]:opacity-0",
            "motion-reduce:transition-none",
            width === "panel" ? "w-[min(30rem,92vw)]" : "w-[min(54rem,92vw)]",
          )}
        >
          <header className="border-line flex shrink-0 items-start gap-3 border-b px-[18px] py-[15px]">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-metric m-0 font-semibold">
                {title}
              </Dialog.Title>
              {subtitle && (
                <Dialog.Description className="text-label text-ink-3 m-0 mt-px">
                  {subtitle}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="rounded-tag text-ink-4 hover:bg-hover hover:text-ink grid size-[26px] shrink-0 place-items-center transition-colors"
            >
              <X className="size-[15px] stroke-[1.9]" />
            </Dialog.Close>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </div>

          {foot && (
            <footer className="border-line flex shrink-0 items-center gap-2.5 border-t px-[18px] py-3">
              {foot}
            </footer>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
