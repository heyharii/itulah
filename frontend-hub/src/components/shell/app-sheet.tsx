import { useRouterState } from "@tanstack/react-router"

import { AppIcon } from "@/components/shell/app-icon"
import { DepartmentScreens } from "@/components/shell/nav-column"
import { BottomSheet } from "@/components/ui/picker-sheet"
import type { AppTile } from "@/lib/apps"

/// A department's screens, from the bottom of a phone: what the column lists
/// on a desk, opened from a launcher tile or from the page's own title.
///
/// The rows are the column's own (`DepartmentScreens`) — the department's own
/// rows first, the "Soon" ones greyed, everything else under More, with the
/// same audience rules and counts, 44px under a finger — so the phone cannot
/// disagree with the desk about what a department holds. And it is drawn in
/// the column's charcoal (2026-09-28): on every glass, choosing where to go
/// happens on the same dark material. Any link inside closes the sheet.
export function AppSheet({
  tile,
  open,
  onOpenChange,
}: {
  tile: AppTile | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={tile?.label ?? ""}
      tone="dark"
      icon={
        tile !== null ? (
          <AppIcon id={tile.id} icon={tile.icon} size="sm" />
        ) : undefined
      }
    >
      <div
        className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto overscroll-contain px-3 pt-1 pb-4"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a") !== null)
            onOpenChange(false)
        }}
      >
        {tile !== null && (
          <DepartmentScreens modules={tile.modules} pathname={pathname} touch />
        )}
      </div>
    </BottomSheet>
  )
}
