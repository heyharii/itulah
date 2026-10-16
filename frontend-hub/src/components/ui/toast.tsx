import { Toaster as Sonner } from "sonner"

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
export function Toasts() {
  return (
    // Bottom left (owner, 2026-10-16): clear of a sheet's foot buttons, which
    // stand at the bottom right.
    <Sonner
      position="bottom-left"
      offset={20}
      // On a phone a toast rises above the bottom bar (3.5rem and the home
      // indicator), not over the tabs somebody is about to press.
      mobileOffset={{
        bottom: "calc(4.25rem + env(safe-area-inset-bottom, 0px))",
        left: 12,
        right: 12,
      }}
      gap={10}
      // Long enough to read a number off, short enough not to sit over the
      // corner of a table somebody is already working in.
      duration={5000}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-start gap-2.5 rounded-card border border-hairline bg-canvas px-3.5 py-3 shadow-pop",
          icon: "mt-px flex size-4 shrink-0 items-center justify-center [&>svg]:size-4",
          content: "flex min-w-0 flex-col gap-0.5",
          title: "text-[0.9375rem] font-medium text-ink",
          description: "text-[0.9375rem] text-body",
          actionButton:
            "ml-auto shrink-0 rounded-full bg-dark px-2.5 py-1 text-[0.9375rem] font-medium text-on-dark",
          closeButton:
            "rounded-full border border-hairline bg-canvas text-line-ico hover:text-ink",
          success: "[&_[data-icon]]:text-ok-fg",
          error: "[&_[data-icon]]:text-bad-fg",
          warning: "[&_[data-icon]]:text-warn-fg",
          info: "[&_[data-icon]]:text-info-fg",
        },
      }}
    />
  )
}
