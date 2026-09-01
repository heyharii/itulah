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

/// The WHITE veil.
///
/// Cloud Hub never darkens what is behind an overlay: the list washes toward
/// white and stays readable as a ghost of itself, so the reader keeps their
/// place in it while the sheet is open. `rgba(255,255,255,0.72)` — a dark dim
/// anywhere in this file is a bug, not a taste. (`inventory-prototype.html`
/// still ships `rgba(20,20,25,.28)`; DESIGN.md wins, and the brief rules it.)
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
  // Measured from `inventory-prototype.html`'s `.drawer` and reconciled with
  // DESIGN.md's "Detail rail (right panel)", which wins on geometry:
  //
  //   inset      16 declared → `top-4 right-4 bottom-4`  (prototype ships 22)
  //   radius     `{r.shell}` 18                          (prototype ships 16)
  //   border     `{hairline}` #ececef                    (prototype ships hairline-2)
  //   shadow     `{e.float}` 0 14px 40px rgba(20,20,25,.1) (prototype ships .13)
  //   width      440 declared → `sm:max-w-[27.5rem]`, inside DESIGN.md's 400–520
  //   enter      translateX(18px) → `translate-x-[1.125rem]`, .22s (.32,.72,0,1)
  //
  // Below `sm` it stops floating: DESIGN.md's `sm` row makes the app full-bleed
  // and the detail a *pushed screen*, so the inset, the radius, the border and
  // the shadow all go and the panel slides the full width.
  // `data-starting-style` / `data-ending-style` rather than `animate-in` /
  // `animate-out`, and the difference is not taste — see the note above
  // `SheetContent`. Both edges of the transition are named on purpose: Base UI
  // applies the starting style for one frame on the way in and the ending style
  // for the length of the transition on the way out, so one declaration per
  // side covers both directions.
  const floatShell =
    "rounded-[var(--os-r-shell,1.125rem)] border border-[var(--os-hairline,#ececef)] shadow-[var(--os-shadow-float,0_14px_40px_rgba(20,20,25,.1))] data-starting-style:opacity-0 data-ending-style:opacity-0"
  // The pushed screen below `sm`: every trace of the float comes off.
  const pushed =
    "max-sm:inset-0 max-sm:h-auto max-sm:max-w-none max-sm:rounded-none max-sm:border-0 max-sm:shadow-none"

  const edge = float
    ? {
        right: `top-4 right-4 bottom-4 left-auto h-auto w-full sm:max-w-[27.5rem] ${floatShell} data-starting-style:translate-x-[1.125rem] data-ending-style:translate-x-[1.125rem] ${pushed} max-sm:data-starting-style:translate-x-full max-sm:data-ending-style:translate-x-full`,
        left: `top-4 left-4 bottom-4 right-auto h-auto w-full sm:max-w-[27.5rem] ${floatShell} data-starting-style:-translate-x-[1.125rem] data-ending-style:-translate-x-[1.125rem] ${pushed} max-sm:data-starting-style:-translate-x-full max-sm:data-ending-style:-translate-x-full`,
        top: `inset-x-4 top-4 h-auto ${floatShell} data-starting-style:-translate-y-[1.125rem] data-ending-style:-translate-y-[1.125rem] max-sm:inset-x-0 max-sm:top-0 max-sm:rounded-none max-sm:border-0 max-sm:shadow-none max-sm:data-starting-style:-translate-y-full max-sm:data-ending-style:-translate-y-full`,
        bottom: `inset-x-4 bottom-4 h-auto ${floatShell} data-starting-style:translate-y-[1.125rem] data-ending-style:translate-y-[1.125rem] max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-none max-sm:border-0 max-sm:shadow-none max-sm:data-starting-style:translate-y-full max-sm:data-ending-style:translate-y-full`,
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
        // A sheet portals to `document.body`, which is outside every
        // `data-cloudhub` subtree in the app — so without this attribute the
        // panel resolves *none* of the `--os-*` custom properties and none of
        // the `[data-cloudhub]` component rules. It is not a theming nicety:
        // `.os-card` stops being a card, buttons stop being pills, and the
        // stale `var(--os-…, #fallback)` second arguments scattered through the
        // feature folders are what paints instead. That is exactly why the
        // basket sheet rendered with no cards at all. Set before `...props` so
        // a caller can still opt out, and nothing should.
        data-cloudhub=""
        className={cn(
          "fixed z-50 flex flex-col gap-0 overflow-hidden bg-[var(--os-canvas,#fff)] outline-none",
          // The prototype's own curve and duration; opacity trails it slightly.
          "transition-all duration-200 ease-[cubic-bezier(.32,.72,0,1)]",
          !float && "shadow-lg",
          edge,
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          // `.dclose`: the same 30px ghost circle the `···` overflow uses, so
          // the two header controls match. 15px glyph, `{body}` not black.
          <SheetPrimitive.Close
            data-slot="sheet-close"
            aria-label="Close"
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-[0.9375rem] right-4 z-10 text-[var(--os-body,#74747b)]"
              />
            }
          >
            <XIcon className="size-[0.9375rem]" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  )
}

/// `.drawer-h` — 16/20/14 gutters, 13px between the identity block and the
/// action row, closed by one hairline.
function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        // `pr-12` rather than the 20px gutter: it is exactly `right-4` plus the
        // 2rem close circle, so a bare header never runs under it. A header
        // that draws its own chrome (`SheetShell`) overrides this.
        "flex shrink-0 flex-col items-stretch gap-[0.8125rem] border-b border-[var(--os-hairline,#ececef)] bg-[var(--os-canvas,#fff)] px-5 pt-4 pr-12 pb-[0.875rem]",
        className,
      )}
      {...props}
    />
  )
}

/// `.drawer-b` — the scrolling body, on the measured 20/18 gutters.
///
/// Every sheet that does not bring padding of its own wraps its content in
/// this. A sheet body at `x=0` is the tell that it was skipped.
function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-[1.125rem]", className)}
      {...props}
    />
  )
}

/// `.dh-title` — 17.5/600/-0.02em, the line under the record id.
function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "text-[1.09375rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--os-ink,#1d1d1f)]",
        className,
      )}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-[0.78125rem] text-[var(--os-body,#74747b)]", className)}
      {...props}
    />
  )
}

/// The composer foot — a note, a quantity, the one thing you came to press.
///
/// **Record actions do not live here.** The prototype pins them in the header,
/// two visible plus a `···` overflow, where they are reachable without
/// scrolling a long record; DESIGN.md's "composer at the foot" survives only
/// for the composer itself. A sheet whose foot is a row of record verbs has
/// the wrong shape.
function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "mt-auto flex shrink-0 flex-col gap-2 border-t border-[var(--os-hairline,#ececef)] px-5 py-3",
        className,
      )}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetTitle,
  SheetTrigger,
}
