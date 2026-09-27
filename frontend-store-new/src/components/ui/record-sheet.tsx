import { Dialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { X } from "lucide-react"

import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"

/// The hub's record sheet (`frontend-hub/src/components/ui/sheet.tsx`), cut
/// down to what a shop's screens need: a record opened over its list, and a
/// form that is a task rather than a record.
///
/// On a desk it is the hub's floating rail — inset 20px from the top, right
/// and bottom with the shell's corners and the float shadow, over the white
/// veil (never a dark dim). On a phone it rises from the bottom edge and stops
/// short of the top, so the list it came from still shows above it, and a
/// pull down puts it away — Base UI's Drawer, with the keyboard kept below the
/// foot so a form's button rides above it.
///
/// What it leaves behind is the hub's machinery a till has no use for: the
/// beside-the-list column on a monitor (this shell reserves no space for it),
/// the section tabs, and the record's comment panel.
export function RecordSheet({
  open,
  onOpenChange,
  title,
  id,
  caption,
  badge,
  footer,
  width = "rail",
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  /// The record's own identifier, in mono above the title.
  id?: React.ReactNode
  /// One quiet line under the title: where the record came from, and when.
  caption?: React.ReactNode
  /// What the record IS, beside its name — a status pill.
  badge?: React.ReactNode
  /// The form's buttons, pinned under the body.
  footer?: React.ReactNode
  /// `rail` for a record, `wide` for a form somebody writes a sentence into.
  width?: "rail" | "wide"
  children: React.ReactNode
}) {
  const phone = useLayout() === "phone"

  const body = (Parts: {
    Title: React.ElementType
    Close: React.ElementType
  }) => (
    <>
      <div className="flex shrink-0 items-center gap-4 border-b border-hairline px-4 py-3 md:px-7 md:py-3.5">
        <div className="min-w-0 flex-1">
          {id !== undefined && (
            <div className="mb-0.5 truncate font-mono text-id text-body">
              {id}
            </div>
          )}
          <div className="flex min-w-0 items-center gap-2.5">
            <Parts.Title className="truncate text-[1.125rem] leading-[1.5625rem] font-semibold tracking-[-0.02em] text-ink">
              {title}
            </Parts.Title>
            {badge}
          </div>
          {caption !== undefined && (
            <div className="mt-0.5 truncate text-meta text-mute">{caption}</div>
          )}
        </div>
        <Parts.Close
          aria-label="Close"
          className="grid size-8 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:size-tap"
        >
          <X className="size-4" />
        </Parts.Close>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 md:px-7 md:py-6">
        {children}
      </div>
      {footer !== undefined && (
        <div className="shrink-0 border-t border-hairline px-4 py-3 md:px-7 md:py-3.5">
          {footer}
        </div>
      )}
    </>
  )

  if (phone) {
    return (
      <Drawer.Root open={open} onOpenChange={onOpenChange}>
        <Drawer.VirtualKeyboardProvider>
          <Drawer.Portal>
            <Drawer.Backdrop
              forceRender
              className="fixed inset-0 z-40 bg-[var(--scrim)] opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-(--t-drawer) ease-(--ease-out) data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0 data-[swiping]:transition-none"
            />
            <Drawer.Viewport className="fixed inset-0 z-40 flex items-end pb-[var(--drawer-keyboard-inset,0px)]">
              <Drawer.Popup
                className={cn(
                  "flex w-full flex-col overflow-hidden rounded-t-sheet border-t border-hairline bg-canvas pb-[env(safe-area-inset-bottom)] shadow-float outline-none",
                  "h-[calc(100dvh-env(safe-area-inset-top,0px)-0.75rem-var(--drawer-keyboard-inset,0px))]",
                  "[transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-[translate,transform] duration-(--t-drawer) ease-(--ease-drawer) data-[ending-style]:duration-(--t-exit)",
                  "data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full data-[swiping]:transition-none",
                  "motion-reduce:data-[ending-style]:translate-none motion-reduce:data-[starting-style]:translate-none",
                )}
              >
                <div aria-hidden className="flex shrink-0 justify-center pt-2">
                  <span className="h-1 w-9 rounded-full bg-hairline-strong" />
                </div>
                {body(Drawer)}
              </Drawer.Popup>
            </Drawer.Viewport>
          </Drawer.Portal>
        </Drawer.VirtualKeyboardProvider>
      </Drawer.Root>
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-[var(--scrim)] transition-opacity duration-(--t-sheet) ease-(--ease-out) data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            "fixed top-5 right-5 bottom-5 z-40 flex max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-shell border border-hairline bg-canvas shadow-float outline-none",
            // From the edge it lives on, and back there on the way out —
            // translate only, faster leaving than arriving. Reduced motion
            // keeps a fade and drops the travel.
            "transition-[translate,opacity] duration-(--t-sheet) ease-(--ease-drawer) data-[ending-style]:duration-(--t-exit)",
            "data-[ending-style]:translate-x-[calc(100%+1.25rem)] data-[starting-style]:translate-x-[calc(100%+1.25rem)]",
            "motion-reduce:data-[ending-style]:translate-none motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:translate-none motion-reduce:data-[starting-style]:opacity-0",
            width === "wide"
              ? "w-[clamp(27.5rem,72vw,46rem)]"
              : "w-[clamp(27.5rem,62vw,40rem)]",
          )}
        >
          {body(Dialog)}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
