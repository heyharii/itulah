import { Plus } from "lucide-react"

import { cn } from "@/lib/utils"

/// The one thing a list screen exists to start, as a floating button — on a
/// phone only.
///
/// Below 48rem the toolbar is the search and one options button; the screen's
/// primary action leaves the line (where it cost a third of the width the
/// search needs) and sits at the thumb's corner, above the home bar, over
/// every row — and above the bottom bar (3.5rem), which every phone screen
/// carries (`bottom-bar.tsx`). From 48rem up it is not drawn at all: the toolbar's own button
/// is there, and a desk does not need a thumb target.
export function Fab({
  label,
  onClick,
  className,
}: {
  /// What it does, for the screen reader and the tooltip — the icon alone
  /// says "add", not what is added.
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-30 grid size-12 place-items-center rounded-full bg-cta text-cta-fg shadow-float transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.94] md:hidden",
        className
      )}
    >
      <Plus className="size-5" />
    </button>
  )
}
