import { AppIcon } from "@/components/shell/app-icon"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { ModuleScreens } from "@/components/shell/sidebar"
import type { AppTile } from "@/lib/apps"
import { flatDomain } from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// A department's screens, from the bottom of a phone: what the sidebar lists
/// on a desk, opened from a launcher tile or from the page's own title.
///
/// The rows are the sidebar's own (`ModuleScreens`) — same audience rules,
/// same counts, 44px under a finger — so the phone cannot disagree with the
/// desk about what a department holds. Any link inside closes the sheet.
export function AppSheet({
  tile,
  open,
  onOpenChange,
}: {
  tile: AppTile | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // A heading per module only when there is more than one to tell apart —
  // Buying is one module, and "PROCUREMENT" over its rows named it twice.
  const grouped =
    tile !== null && tile.modules.length > 1 && !flatDomain(tile.modules)
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={tile?.label ?? ""}
      icon={
        tile !== null ? (
          <AppIcon id={tile.id} icon={tile.icon} size="sm" />
        ) : undefined
      }
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a") !== null)
            onOpenChange(false)
        }}
      >
        {tile?.modules.map((module, index) => (
          <div key={module.id} className="flex flex-col gap-px">
            {/* The sidebar's hairlines for a flat domain, so the phone groups
                GA the way the desk does. */}
            {!grouped && module.divider && index > 0 && (
              <hr className="mx-[0.5625rem] mt-[0.6875rem] mb-[0.5625rem] border-0 border-t border-hairline" />
            )}
            {grouped && (
              <span
                className={cn(
                  "px-[0.5625rem] pt-4 pb-[0.3125rem] text-section font-semibold tracking-[0.05em] text-mute uppercase"
                )}
              >
                {module.label}
              </span>
            )}
            <ModuleScreens module={module} touch />
          </div>
        ))}
      </div>
    </BottomSheet>
  )
}
