import { Toaster as Sonner } from "sonner"

/// Something that happened, said once and then gone — the hub's
/// `components/ui/toast.tsx`, set up the same way.
///
/// A toast confirms an action that did not change the screen it was taken on.
/// A page-level failure belongs in a banner, an empty list in an empty state.
///
/// Sonner draws it, unstyled: every class below is this app's own, so a toast
/// is the same card, hairline and shadow as a popover. Sonner moves it with
/// transitions, not keyframes, so a second toast retargets instead of
/// restarting, and it can be swiped away.
export function Toasts() {
  return (
    <Sonner
      position="bottom-right"
      offset={20}
      // On a phone a toast rises above the dock and the home indicator, not
      // over the tabs somebody is about to press.
      mobileOffset={{
        bottom: "calc(9rem + env(safe-area-inset-bottom, 0px))",
        left: 12,
        right: 12,
      }}
      gap={10}
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
