import { Plus, type LucideIcon } from "lucide-react"

import { DockPortal, useDock } from "@/components/shell/dock"
import { cn } from "@/lib/utils"

/// The one thing a list screen exists to start — on a phone only, and in the
/// context row over the bottom bar (`components/shell/dock.tsx`), where the
/// thumb is, rather than floating over the last row of the list.
///
/// Beside the status and the search it is a round "+" at the end of the row
/// (owner, 2026-10-05: "Add" and "Add New" both looked worse than the plus): a
/// label does not sit well beside a field you can read, and a screen reader
/// hears "Add New Order" either way. With no tabs there is room, and it
/// takes the whole row and says the specific thing. From 48rem up it is not drawn: the
/// toolbar's own button is there, and a desk does not need a thumb target.
export function Fab({
  label,
  onClick,
  className,
  icon: Icon = Plus,
}: {
  /// What it makes: "New Order", "Add Item".
  label: string
  onClick: () => void
  className?: string
  /// What it draws: a plus for something new, another mark for an act on what
  /// is there ("Mark all read").
  icon?: LucideIcon
}) {
  const dock = useDock()
  const beside = (dock?.claimed.tabs ?? 0) > 0
  // "Add New" says nothing about what, so a screen reader hears it: "Add New
  // Order".
  const spoken = /^(New|Add)\s+/i.test(label)
    ? `Add New ${label.replace(/^(New|Add)\s+/i, "")}`
    : label
  return (
    <DockPortal slot="action">
      <button
        type="button"
        aria-label={beside ? spoken : label}
        title={label}
        onClick={onClick}
        className={cn(
          // 44, the least a thumb is asked to hit (D1): beside the status it is
          // a round 44, and alone it is a 44px bar across the row.
          "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-cta text-[0.9375rem] font-semibold text-cta-fg shadow-soft transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.96]",
          beside ? "size-11" : "dock-wide w-full px-5",
          className
        )}
      >
        {beside ? (
          <Icon className="size-5" />
        ) : (
          <>
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
          </>
        )}
      </button>
    </DockPortal>
  )
}
