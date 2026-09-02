import type { LucideIcon } from "lucide-react"

import { analyticsNav } from "@/screens/analytics/nav"
import { articlesNav } from "@/screens/articles/nav"
import { commercialNav } from "@/screens/commercial/nav"
import { financeNav } from "@/screens/finance/nav"
import { inventoryNav } from "@/screens/inventory/nav"
import { peopleNav } from "@/screens/people/nav"
import { procurementNav } from "@/screens/procurement/nav"
import { storeopsNav } from "@/screens/storeops/nav"
import { systemNav } from "@/screens/system/nav"
import { workplaceNav } from "@/screens/workplace/nav"

/// The navigation registry — one declaration the whole app reads.
///
/// The rail draws `modules`, the sidebar draws the active module's `sections`,
/// the command palette flattens the lot, and `routes.tsx` builds its tree from
/// the same array. That single source is the point: this app covers ~147 cloud
/// endpoints, and the way a surface that size goes wrong is a screen that
/// exists but is reachable from nowhere, or a nav entry pointing at a route
/// somebody renamed. Both become impossible when there is one list.
///
/// A module maps to a family of endpoints on the cloud node, so "does every
/// backend function have a home?" is answered by reading this file against
/// `src/cloud/http/mod.rs`.

export interface NavItem {
  /// Absolute path. Must match a route in `routes.tsx` — the router is built
  /// from these, so it cannot drift.
  readonly path: string
  readonly label: string
  readonly icon: LucideIcon
  /// Which tint the count wears. Only read when `useCount` returns a number
  /// above zero — on its own it draws nothing, which is why the modules that
  /// declared it before there was anything to draw are unaffected.
  readonly badge?: "bad" | "warn"
  /// A React hook the sidebar may call to get this item's count.
  ///
  /// A hook and not a number, because the count is live and this file is a
  /// static declaration read by four different things — the rail, the sidebar,
  /// the palette and the router. A number here would mean all four paid for a
  /// fetch; a hook is called by exactly one of them, on exactly the rows that
  /// declare it, and only while its module is the one on screen.
  ///
  /// It must be safe to call on every render and must not throw while its data
  /// is loading. Return `null` for "not asked yet" — distinct from `0`, which
  /// means asked and answered "nothing", and both draw nothing.
  readonly useCount?: () => number | null | undefined
  /// Routed, but not a row in the sidebar.
  ///
  /// For a screen a module reaches by its own in-page tabs. The path still has
  /// to be declared here — that is what makes it exist, and what keeps the
  /// router and the palette from drifting from the screens — but listing it in
  /// the sidebar as well would say the same thing twice, once as a rail item
  /// and once as a tab, with two different highlights fighting over which is
  /// current.
  readonly hidden?: boolean
}

export interface NavSection {
  /// Absent for the first group, which sits directly under the workspace chip.
  readonly label?: string
  readonly items: readonly NavItem[]
}

/// The two stops a rail tile is painted between.
///
/// A Mac app icon is one hue lit from above: a light tint at the top falling to
/// a saturated version of the same colour at the bottom, and nothing else. The
/// earlier tiles here were a three-blob pastel mesh, which is a different
/// tradition — it reads soft and web-ish beside the Dock, and at 30px the three
/// blobs muddle into a single washed colour anyway. Two stops of one hue is
/// what survives being that small.
///
/// Both stops are the SAME hue. A ramp that drifts across hues is the "mesh"
/// look again wearing a linear gradient, and it is the thing that stops a row
/// of tiles reading as one set.
export interface RailTint {
  /// Lit. Roughly the hue at 70% lightness.
  readonly top: string
  /// Saturated. The colour the tile is actually remembered as.
  readonly bottom: string
}

export interface AppModule {
  readonly id: string
  readonly label: string
  readonly icon: LucideIcon
  readonly tint: RailTint
  /// Where the rail tile lands. Always the first item of the first section.
  readonly home: string
  readonly sections: readonly NavSection[]
  /// Drawn desaturated and inert. Honest about what is not built yet, rather
  /// than a live tile that opens an empty screen.
  readonly soon?: boolean
}

/// The rail, left to right. Order is the reading order of the business:
/// what is bought, what is held, what is sold, what it cost, who did it.
export const modules: readonly AppModule[] = [
  commercialNav,
  articlesNav,
  inventoryNav,
  procurementNav,
  storeopsNav,
  financeNav,
  peopleNav,
  workplaceNav,
  analyticsNav,
  systemNav,
]

/// Every nav item, flattened — the command palette's list, and the assertion
/// that a path appears exactly once across the whole registry.
export const allNavItems: readonly (NavItem & { module: AppModule })[] =
  modules.flatMap((module) =>
    module.sections.flatMap((section) =>
      section.items.map((item) => ({ ...item, module }))
    )
  )

/// Which module owns a path, by longest matching `home`. Used by the shell to
/// light the right rail tile and draw the right sidebar for a URL that was
/// pasted in rather than clicked to.
export function moduleForPath(pathname: string): AppModule {
  // Longest matching `home` wins, so a module at `/finance/assets` would beat
  // one at `/finance`. The comparison runs only among modules that actually
  // match: seeding `best` with `modules[0]` and comparing lengths against it
  // meant a short home like `/finance` could never displace a longer
  // non-matching one like `/commercial`, and every finance URL drew the
  // commercial sidebar.
  let best: AppModule | null = null
  for (const module of modules) {
    const matches =
      pathname === module.home || pathname.startsWith(module.home + "/")
    if (!matches) continue
    if (best === null || module.home.length > best.home.length) best = module
  }
  return best ?? modules[0]
}
