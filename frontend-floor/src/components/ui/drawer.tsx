import { Dialog } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"

/// The hamburger drawer: everything that is not one of the four destinations.
///
/// It slides in from the left over the **white veil**. Nothing in this system
/// darkens — the content behind a drawer washes toward near-white and stays
/// readable as a ghost. `bg-black/50` is the single most recognisable way a
/// screen stops being Cloud Hub, and it is not written anywhere in this app.
export function Drawer({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-[var(--scrim)]" />
        <Dialog.Popup
          className={cn(
            "pt-safe pb-safe fixed inset-y-0 left-0 z-50 flex w-[17.5rem] max-w-[85vw] flex-col",
            "border-r border-hairline bg-canvas shadow-float",
          )}
        >
          <Dialog.Title className="px-4 pt-5 pb-3 text-title font-semibold text-ink">
            {title}
          </Dialog.Title>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">
            {children}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/// One row in the drawer. 48px so it clears the touch floor with room to spare,
/// a pale outline icon, a 14/500 label in sentence case — the sidebar item row
/// from DESIGN.md, at a thumb's scale.
export function DrawerItem({
  icon,
  label,
  detail,
  tone = "normal",
  onClick,
}: {
  icon: React.ReactNode
  label: React.ReactNode
  /// Right-aligned, quiet. A count, a state, a node name.
  detail?: React.ReactNode
  tone?: "normal" | "bad"
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "pressable flex h-12 w-full items-center gap-3 rounded-inner px-3 text-left text-control font-medium",
        tone === "bad" ? "text-bad-fg" : "text-text",
      )}
    >
      <span
        className={cn(
          "shrink-0 [&_svg]:size-[1.125rem]",
          tone === "bad" ? "text-bad" : "text-line-ico",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail !== undefined && (
        <span className="shrink-0 text-meta text-mute tabular-nums">
          {detail}
        </span>
      )}
    </button>
  )
}

/// A soft, sentence-case group label — never uppercase-bold.
export function DrawerSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 mb-1 px-3 text-section font-medium text-mute">
      {children}
    </div>
  )
}
