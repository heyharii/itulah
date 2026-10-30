import { Toaster as Sonner } from "sonner"

export { toast } from "sonner"

/// Something that happened, said once and then gone.
///
/// The rule this app has written down twice already — in `<Banner>` and in
/// `states.tsx` — is that **a toast confirms an action that did not change the
/// screen**. A page-level failure belongs in a banner, an empty list in an
/// empty state. What is left for a toast is the receipt: an order raised, a
/// price published, a file saved. The screen behind it has already moved on to
/// showing the thing that was made, and a bar pinned above the table saying so
/// is furniture nobody dismisses.
///
/// Sonner draws it, unstyled: every class below is this app's own, so a toast
/// is the same card, the same hairline and the same shadow as a popover — and
/// it follows the theme without sonner knowing there is one.
/// One format for every toast (owner, 2026-10-17 — "format toastnya bisa
/// kita samakan? rada besar"), the one a saved PO has always used:
///
///   title        what and what happened — "PO-171026-001 created"
///   description  one line of facts, joined by " · " — "Supplier · Rp 12.5m"
///
/// No sentences and no full stop. The card is small: 320px, title and facts
/// each at most two lines.
export function Toasts() {
  return (
    // Bottom right (owner, 2026-10-17): every save — a PO first — answers in
    // the same corner, the one the Save button stands in.
    <Sonner
      position="bottom-right"
      offset={20}
      // On a phone a toast rises above the bottom bar (3.5rem and the home
      // indicator), not over the tabs somebody is about to press.
      mobileOffset={{
        bottom: "calc(4.25rem + env(safe-area-inset-bottom, 0px))",
        left: 12,
        right: 12,
      }}
      gap={8}
      style={{ "--width": "20rem" } as React.CSSProperties}
      // Long enough to read a number off, short enough not to sit over the
      // corner of a table somebody is already working in.
      duration={5000}
      // Every toast can be put away by hand (owner, 2026-10-25), not only
      // waited out or swiped.
      closeButton
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-2.5 rounded-xl border border-hairline bg-canvas px-3 py-2.5 shadow-pop",
          icon: "flex size-4 shrink-0 items-center justify-center [&>svg]:size-4",
          content: "flex min-w-0 flex-1 flex-col",
          title:
            "line-clamp-2 text-[0.9375rem] leading-snug font-medium text-ink tabular-nums",
          description:
            "line-clamp-2 text-[0.9375rem] leading-snug text-mute tabular-nums",
          actionButton:
            "shrink-0 rounded-full bg-accent-bg px-2.5 py-0.5 text-[0.9375rem] font-medium text-accent",
          closeButton:
            // Unstyled, sonner leaves it in the row — last, at the right edge.
            "order-last -mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-line-ico transition-colors hover:text-ink [&>svg]:size-3.5",
          success: "[&_[data-icon]]:text-ok-fg",
          error: "[&_[data-icon]]:text-bad-fg",
          warning: "[&_[data-icon]]:text-warn-fg",
          info: "[&_[data-icon]]:text-info-fg",
        },
      }}
    />
  )
}
