import { Drawer } from "@base-ui/react/drawer"

import { cn } from "@/lib/utils"

/// What a phone draws in place of a centred dialog: a sheet in the Vaul sense.
///
/// It rises from the bottom edge and stops short of the top, carries a grip,
/// and a pull down puts it away — the same shell `Sheet` uses on a phone
/// (`components/ui/sheet.tsx`), so a question asked over a record and the
/// record itself behave alike. A centred card on a 375px screen is a box with
/// nowhere to go: no thumb reaches its corners, and the keyboard covers it.
///
/// `z-50`, one above a sheet's `z-40`, because a confirmation is asked on top of
/// the record it is about. `tall` is for a working surface that should fill the
/// glass (a table, a review); without it the sheet is as tall as its content.
export function PhoneDrawer({
  open,
  onOpenChange,
  tall = false,
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tall?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          <Drawer.Backdrop
            forceRender
            className="fixed inset-0 z-50 bg-[var(--scrim)] opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-(--t-drawer) ease-(--ease-out) data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0 data-[swiping]:transition-none"
          />
          <Drawer.Viewport className="fixed inset-0 z-50 flex items-end pb-[var(--drawer-keyboard-inset,0px)]">
            <Drawer.Popup
              className={cn(
                "sheet-drawer flex w-full flex-col overflow-hidden rounded-t-sheet border-t border-hairline bg-canvas pb-[env(safe-area-inset-bottom)] shadow-float outline-none",
                // Written whole: Tailwind reads class names, it does not run
                // template strings. Up to 12px under the notch, less whatever
                // the keyboard takes.
                tall
                  ? "h-[calc(100dvh-env(safe-area-inset-top,0px)-0.75rem-var(--drawer-keyboard-inset,0px))]"
                  : "max-h-[calc(100dvh-env(safe-area-inset-top,0px)-0.75rem-var(--drawer-keyboard-inset,0px))]",
                "[transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-[translate,transform] duration-(--t-drawer) ease-(--ease-drawer) data-[ending-style]:duration-(--t-exit)",
                "data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full data-[swiping]:transition-none",
                "motion-reduce:data-[ending-style]:translate-none motion-reduce:data-[starting-style]:translate-none",
                className
              )}
            >
              <div aria-hidden className="flex shrink-0 justify-center pt-2">
                <span className="h-1 w-9 rounded-full bg-hairline-strong" />
              </div>
              {children}
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  )
}
