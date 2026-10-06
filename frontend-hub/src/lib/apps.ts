import type { LucideIcon } from "lucide-react"
import type { Role } from "@itulah/contract"

import {
  shownDomains,
  modulesOfDomain,
  visibleItems,
  type AppModule,
} from "@/lib/navigation"
import { homeNav } from "@/screens/home/nav"
import { reportsNav } from "@/screens/reports/nav"
import { systemNav } from "@/screens/system/nav"
import { libraryNav } from "@/screens/workplace/nav"

/// One tile of the phone's app launcher: a department's screens behind one
/// icon, the way a super-app puts a service behind one.
export interface AppTile {
  readonly id: string
  readonly label: string
  readonly icon: LucideIcon
  readonly modules: readonly AppModule[]
  /// What is waiting inside it, as the department's mark on the desk rail
  /// adds it up (`withRailCount`). A hook, read only by the row that draws
  /// this tile — never in a loop over tiles.
  readonly useCount?: () => number | null | undefined
  /// The tint that count wears: amber by default, red where it is late.
  readonly badge?: "bad" | "warn"
}

/// The screens behind a tile, when there is exactly one of them — a tile that
/// opens a list of one is a tap that asks nothing. `undefined` means the tile
/// opens its sheet.
export function onlyScreen(tile: AppTile): string | undefined {
  const items = tile.modules.flatMap((module) => visibleItems(module))
  return items.length === 1 ? items[0].path : undefined
}

/// Where a tile's row leads: the department's own first screen — the one its
/// desk rail opens on — not a list to choose from first (owner, 2026-10-06).
/// The other screens are the department's bar at the bottom of the phone.
export function landingOf(tile: AppTile): string | undefined {
  const only = onlyScreen(tile)
  if (only !== undefined) return only
  const module = tile.modules.find(
    (one) => !one.hidden && visibleItems(one).length > 0
  )
  return module?.home ?? tile.modules[0]?.home
}

/// The apps a role is offered on the phone's launcher.
///
/// By ROLE for now, on the owner's call (2026-09-25): the per-module answer
/// needs the server to say what each account may open, and until it does, a
/// cashier who signed in was shown the whole office console and refused by
/// the server screen by screen. So:
///
///  - CASHIER — no office apps. Their phone is Messages, Notifications and
///    their Profile; the launcher says so instead of offering ten doors that
///    are locked.
///  - SUPERVISOR — every department.
///  - ADMIN — every department, and System.
///
/// Chat and Discussions are not tiles: they are the Messages tab.
export function appsFor(role: Role | undefined): readonly AppTile[] {
  if (!officeFor(role)) return []
  const departments: AppTile[] = [
    ...(homeNav.hidden
      ? []
      : [
          {
            id: homeNav.id,
            label: homeNav.label,
            icon: homeNav.icon,
            modules: [homeNav],
          },
        ]),
    ...shownDomains.map((domain) => ({
      id: domain.id,
      label: domain.label,
      icon: domain.icon,
      modules: modulesOfDomain(domain),
      useCount: domain.useCount,
      badge: domain.badge,
    })),
    ...[libraryNav, reportsNav].map((module) => ({
      id: module.id,
      label: module.label,
      icon: module.icon,
      modules: [module],
      useCount: module.useCount,
      badge: module.badge,
    })),
  ]
  if (systemFor(role)) {
    departments.push({
      id: systemNav.id,
      label: systemNav.label,
      icon: systemNav.icon,
      modules: [systemNav],
      useCount: systemNav.useCount,
      badge: systemNav.badge,
    })
  }
  return departments.filter((tile) =>
    tile.modules.some((module) => visibleItems(module).length > 0)
  )
}

/// Whether a role is offered the office at all: the departments, Files and
/// Reports. The owner's call above (2026-09-25), asked by the phone's launcher
/// and by the desk's rail alike, so the two cannot disagree about who sees
/// the departments.
///
/// It reached the rail on 2026-09-27. Until then a store admin signed in as a
/// cashier (QA's "Dian", 2026-09-26) saw every domain on a desk — HR and GA
/// among them — and was refused by the server screen by screen. The server's
/// refusal is still the control; this only stops the menu offering doors that
/// are locked.
export function officeFor(role: Role | undefined): boolean {
  return role !== undefined && role !== "CASHIER"
}

/// Whether a role is offered System: head office's administrators alone.
export function systemFor(role: Role | undefined): boolean {
  return role === "ADMIN"
}
