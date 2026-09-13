import type { LucideIcon } from "lucide-react"

import type { Audience } from "@/lib/reach"
import type { Schema } from "@/lib/search-schema"

/// The navigation registry — and the only place a screen's URL is written.
///
/// The router is generated from this (see `src/router.tsx`), so a path cannot
/// drift from the row that points at it: there is no second list to keep in
/// step, and a screen that is not declared here does not exist.
///
/// ## Why a module is not just a list of links
///
/// The shell draws this in two columns and they answer different questions.
/// The rail asks *which part of the business*, the sidebar asks *which screen*.
/// A module is therefore a thing with an icon, a landing screen, and sections —
/// and the sections carry the module's own grouping of its work, which is the
/// difference between six rows you scan and six rows you read.

export interface NavItem {
  /// Absolute path. Must be unique across the whole registry — `src/router.tsx`
  /// asserts it, because two screens at one URL is a bug that shows up as one
  /// of them being unreachable rather than as an error.
  readonly path: string
  readonly label: string
  readonly icon: LucideIcon
  /// The screen, as a COMPONENT rather than a call.
  ///
  /// A component can be `React.lazy`, and a call cannot: `() => <Money />`
  /// forces the module into the entry bundle whether or not anybody opens it.
  /// With sixteen screens that is sixteen screens' worth of code downloaded
  /// before the first row of the first one is drawn.
  readonly screen: React.ComponentType
  /// The search params this screen reads, as a schema.
  ///
  /// Declared beside the screen rather than inside it so the ROUTER can
  /// validate: `validateSearch` runs before the component, normalising a
  /// pasted or stale URL once at the edge instead of leaving each component to
  /// guess what `?dir=sideways` meant. See `lib/search-schema.ts`.
  ///
  /// Omitted for a screen that takes no params — which is most detail screens,
  /// and is a real answer rather than an oversight.
  readonly search?: Schema
  /// Who this row is offered to. Absent means everyone who can see the module.
  ///
  /// A convenience and never a control. The route is generated either way —
  /// `router.tsx` reads every item, not the visible ones — so a caller who
  /// arrives by ⌘K, by a pasted link, or by a stale bookmark gets the SERVER's
  /// refusal, which the screen draws as `NoAccess`. Hiding the row spares
  /// somebody a refusal they were always going to get; it does not decide who
  /// gets it. See `lib/reach.ts`.
  readonly audience?: Audience
  /// Routed and findable, but not a row in the sidebar.
  ///
  /// For a screen its module reaches by a link from another screen rather than
  /// by navigating to it cold. The path still has to be declared — that is
  /// what routes it — but a sidebar lists places somebody sets out for, and
  /// these are places somebody arrives at.
  readonly hidden?: boolean
}

export interface NavSection {
  /// Absent for the first group, which sits directly under the module's own
  /// landing row. A heading there would name the module a second time.
  readonly label?: string
  readonly items: readonly NavItem[]
}

export interface Module {
  readonly id: string
  readonly label: string
  readonly icon: LucideIcon
  /// The URL prefix this module owns. Every one of its paths sits under it,
  /// which is what lets `moduleFor` resolve a pasted URL to the right rail
  /// tile without a second table saying so.
  readonly base: string
  readonly sections: readonly NavSection[]
}

/// Every item in a module, flattened, in declaration order.
export function itemsOf(module: Module): readonly NavItem[] {
  return module.sections.flatMap((section) => section.items)
}

/// The sections a sidebar should draw: the hidden rows filtered out, the rows
/// for another audience left out, and any section left empty by that dropped
/// rather than drawn as a bare heading.
///
/// ## Why `null` hides rather than shows
///
/// `audience` is `null` both for a caller who is not the employer and for the
/// quarter-second before the answer arrives, and both are drawn the same way:
/// the row is absent. That is the one direction that is safe. A menu that
/// draws four extra rows and then takes them away is a menu people learn not
/// to trust — and the person watching it happen has no way to tell a loading
/// state from having just lost access to payroll. Rows appearing is a menu
/// filling in; rows vanishing is a menu that lied.
export function visibleSections(
  module: Module,
  audience: Audience | null,
): readonly NavSection[] {
  return module.sections
    .map((section) => ({
      label: section.label,
      items: section.items.filter(
        (item) =>
          !item.hidden &&
          (item.audience === undefined || item.audience === audience),
      ),
    }))
    .filter((section) => section.items.length > 0)
}

/// Which module owns a path, by longest matching `base`.
///
/// Longest rather than first so a module nested under another's prefix still
/// wins its own screens. Returns `undefined` for a path no module claims —
/// the caller decides what that means, because "not found" and "the home
/// screen" are different answers and this function knows neither.
export function moduleFor(
  modules: readonly Module[],
  pathname: string,
): Module | undefined {
  let best: Module | undefined
  for (const module of modules) {
    const owns =
      pathname === module.base || pathname.startsWith(`${module.base}/`)
    if (!owns) continue
    if (!best || module.base.length > best.base.length) best = module
  }
  return best
}
