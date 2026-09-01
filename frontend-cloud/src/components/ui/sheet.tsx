import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"

/// A panel that slides in from an edge, built on the same primitive as
/// `dialog` so focus, escape and scroll locking behave identically.
///
/// # Why this transitions rather than animates
///
/// Base UI keeps a closing popup mounted until its exit finishes, and it learns
/// that from a `transitionend` or `animationend` event. The generated version
/// of this file asked for `animate-out`, which resolved to an `exit` keyframe
/// that moved nothing — so no event ever fired, and the popup *and its
/// backdrop* stayed in the document for the rest of the session. The sheet was
/// invisible and the backdrop was not: `elementFromPoint` at the middle of the
/// screen returned the dead overlay, so every click on the page behind it
/// landed on nothing. A screen that looks fine and answers no clicks is the
/// worst shape a bug can take.
///
/// Transitions driven by `data-starting-style` / `data-ending-style` are Base
/// UI's own mechanism and always fire. `drawer` and `accordion` in this folder
/// already use it.
///
/// The plain `transition` utility rather than `transition-[translate,opacity]`:
/// the arbitrary form emitted nothing here — computed `transition-property`
/// came back `none`, which is the same dead end by another road. Tailwind's
/// default `transition` already covers `translate` and `opacity`, which are
/// the only two properties the styles below move.
///
/// The difference from a dialog is not decoration: a dialog interrupts to ask
/// one question, while a sheet is a place you keep coming back to without
/// leaving the screen behind it. The basket is the second thing — a buyer adds
/// to it while still scanning the range, and sending them to a route would
/// throw away the scroll position and the filters they got there with.

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-[var(--os-scrim,rgba(255,255,255,0.72))] transition-opacity duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0",
        className,
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  overlayClassName,
  float = false,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "right" | "left" | "top" | "bottom"
  showCloseButton?: boolean
  overlayClassName?: string
  /// Inset rounded panel over the white veil — Cloud Hub's record sheet.
  /// The flush full-height column is the deprecated rail; do not use it for records.
  float?: boolean
}) {
  // `data-starting-style` / `data-ending-style` rather than `animate-in` /
  // `animate-out`, and the difference is not taste — see the note above
  // `SheetContent`. Both edges of the transition are named on purpose: Base UI
  // applies the starting style for one frame on the way in and the ending style
  // for the length of the transition on the way out, so one declaration per
  // side covers both directions.
  const edge = float
    ? {
        right:
          "top-[22px] right-[22px] bottom-[22px] left-auto h-auto w-full sm:max-w-lg rounded-[var(--os-r-sheet,16px)] border border-[var(--os-hairline-2,#e6e6ea)] shadow-[var(--os-shadow-float,0_14px_40px_rgba(20,20,25,.13),0_2px_8px_rgba(20,20,25,.05))] data-starting-style:translate-x-6 data-ending-style:translate-x-6 max-sm:inset-0 max-sm:rounded-none max-sm:border-0 max-sm:shadow-none max-sm:max-w-none",
        left:
          "top-[22px] left-[22px] bottom-[22px] right-auto h-auto w-full sm:max-w-lg rounded-[var(--os-r-sheet,16px)] border border-[var(--os-hairline-2,#e6e6ea)] shadow-[var(--os-shadow-float,0_14px_40px_rgba(20,20,25,.13),0_2px_8px_rgba(20,20,25,.05))] data-starting-style:-translate-x-6 data-ending-style:-translate-x-6 max-sm:inset-0 max-sm:rounded-none max-sm:border-0 max-sm:shadow-none max-sm:max-w-none",
        top: "inset-x-[22px] top-[22px] h-auto rounded-[var(--os-r-sheet,16px)] border border-[var(--os-hairline-2,#e6e6ea)] shadow-[var(--os-shadow-float,0_14px_40px_rgba(20,20,25,.13))] data-starting-style:-translate-y-6 data-ending-style:-translate-y-6 max-sm:inset-x-0 max-sm:top-0 max-sm:rounded-none",
        bottom:
          "inset-x-[22px] bottom-[22px] h-auto rounded-[var(--os-r-sheet,16px)] border border-[var(--os-hairline-2,#e6e6ea)] shadow-[var(--os-shadow-float,0_14px_40px_rgba(20,20,25,.13))] data-starting-style:translate-y-6 data-ending-style:translate-y-6 max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-none",
      }[side]
    : {
        right:
          "inset-y-0 right-0 h-full w-full border-l sm:max-w-lg data-starting-style:translate-x-full data-ending-style:translate-x-full",
        left: "inset-y-0 left-0 h-full w-full border-r sm:max-w-lg data-starting-style:-translate-x-full data-ending-style:-translate-x-full",
        top: "inset-x-0 top-0 h-auto border-b data-starting-style:-translate-y-full data-ending-style:-translate-y-full",
        bottom:
          "inset-x-0 bottom-0 h-auto border-t data-starting-style:translate-y-full data-ending-style:translate-y-full",
      }[side]

  return (
    <SheetPrimitive.Portal>
      <SheetOverlay className={overlayClassName} />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "bg-background fixed z-50 flex flex-col gap-0 shadow-lg transition-all duration-200 ease-out outline-none",
          float && "shadow-none",
          edge,
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={<Button variant="ghost" className="absolute top-3 right-3" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex shrink-0 flex-col gap-0.5 border-b px-4 py-3 pr-12", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-[0.9375rem] font-semibold tracking-[-0.015em] text-[var(--os-ink,#1d1d1f)]", className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-[0.75rem] text-[var(--os-body,#74747b)]", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex shrink-0 flex-col gap-2 border-t p-4", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetTitle,
  SheetTrigger,
}
