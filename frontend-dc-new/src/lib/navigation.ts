import type { LucideIcon } from "lucide-react"

import type { Waiting } from "@/lib/queries/waiting"
import { intakeNav } from "@/screens/intake/nav"
import { taggingNav } from "@/screens/tagging/nav"
import { countingNav } from "@/screens/counting/nav"
import { pickingNav } from "@/screens/picking/nav"
import { packingNav } from "@/screens/packing/nav"
import { despatchNav } from "@/screens/despatch/nav"
import { nodeNav } from "@/screens/node/nav"

/// The navigation registry — one declaration the whole app reads.
///
/// The rail draws `stations`, the sidebar draws the active station's
/// `sections`, the command palette flattens the lot, and `routes.tsx` builds
/// its tree from the same array. That single source is the point: a nav entry
/// pointing at a route somebody renamed, or a screen nothing links to, both
/// become impossible when there is one list.
///
/// ## The rail carries stations, not modules
///
/// The hub's rail is nine business domains and their order is a reading order.
/// This one is **the order the goods move**: intake → tagging → counting →
/// picking → packing → despatch, and then the node itself. Every endpoint on
/// this edge is a step in one journey a carton makes, so a rail of independent
/// modules would be lying about the work. Somebody who has never used the app
/// can read the rail top to bottom and have described the warehouse.
///
/// ## Badges are counts, not tones
///
/// The hub's badge says *there is something*. On a floor that is not enough:
/// the question is always "how many are waiting for me", and a station with
/// nothing waiting should look finished rather than merely quiet. So an entry
/// names a number out of `useWaiting()` and the shells draw it.

export interface NavItem {
  /// Absolute path. Must match a route in `routes.tsx` — the router is built
  /// from these, so it cannot drift.
  readonly path: string
  readonly label: string
  readonly icon: LucideIcon
  /// How many things are waiting here. Absent means "nothing counts this".
  readonly waiting?: (waiting: Waiting) => number
  /// What a non-zero count means. `warn` is work; `bad` is a problem.
  readonly tone?: "warn" | "bad" | "info"
}

export interface NavSection {
  /// Absent for the first group, which sits directly under the station chip.
  readonly label?: string
  readonly items: readonly NavItem[]
}

/// The pastel mesh that paints a rail tile: three soft blobs over a muted base.
/// A hard two-stop ramp is what the reference deliberately avoids, and it is
/// the difference between "designed" and "a coloured square".
export interface RailMesh {
  readonly c1: string
  readonly c2: string
  readonly c3: string
  readonly base: string
}

export interface Station {
  readonly id: string
  readonly label: string
  /// One line naming what happens here, shown on the station chip. A warehouse
  /// hires people who have never seen the app before lunch.
  readonly does: string
  readonly icon: LucideIcon
  readonly mesh: RailMesh
  /// Where the rail tile lands. Always the first item of the first section.
  readonly home: string
  readonly sections: readonly NavSection[]
  /// The station's own badge — usually the sum of its screens'.
  readonly waiting?: (waiting: Waiting) => number
}

/// The rail, top to bottom, in the order goods move through this building.
export const stations: readonly Station[] = [
  intakeNav,
  taggingNav,
  countingNav,
  pickingNav,
  packingNav,
  despatchNav,
  nodeNav,
]

/// Every nav item, flattened — the command palette's list, and the assertion
/// that a path appears exactly once across the whole registry.
export const allNavItems: readonly (NavItem & { station: Station })[] =
  stations.flatMap((station) =>
    station.sections.flatMap((section) =>
      section.items.map((item) => ({ ...item, station }))
    )
  )

/// Which station owns a path, by longest matching `home`. Used by the shell to
/// light the right rail tile and draw the right sidebar for a URL that was
/// pasted in — or woken up to — rather than clicked.
export function stationForPath(pathname: string): Station {
  // Longest matching `home` wins. The comparison runs only among stations that
  // actually match: seeding `best` with `stations[0]` and comparing lengths
  // against it would mean a short home could never displace a longer
  // non-matching one, and every URL drew the first station's sidebar.
  let best: Station | null = null
  for (const station of stations) {
    const matches =
      pathname === station.home || pathname.startsWith(station.home + "/")
    if (!matches) continue
    if (best === null || station.home.length > best.home.length) best = station
  }
  return best ?? stations[0]
}
