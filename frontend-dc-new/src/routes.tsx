import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router"

import { AppShell } from "@/components/shell/app-shell"
import { allNavItems, stations } from "@/lib/navigation"
import { validateSheetSearch } from "@/lib/sheets"
import { Placeholder } from "@/screens/placeholder"
import { screens as counting } from "@/screens/counting"
import { screens as despatch } from "@/screens/despatch"
import { screens as intake } from "@/screens/intake"
import { screens as node } from "@/screens/node"
import { screens as packing } from "@/screens/packing"
import { screens as picking } from "@/screens/picking"
import { screens as tagging } from "@/screens/tagging"

/// The route tree, built from the navigation registry.
///
/// Every path is declared once, in the station's own `nav.ts`, and the router
/// is generated from it. That is not tidiness: the two lists drift the week
/// somebody renames a path, and the symptom is a sidebar entry that 404s — or
/// a screen nothing links to. Here they cannot disagree, because there is only
/// one list.
///
/// Routes are code-based rather than file-based: no codegen step, and the tree
/// is derived rather than transcribed.

/// Which sheet is open — and **which round somebody is standing in** — is a
/// search parameter, declared here so it is legal on every route below.
/// Router merges the validated search of every matched route, so a key the
/// root claims survives on all of them.
const rootRoute = createRootRoute({
  component: AppShell,
  validateSearch: validateSheetSearch,
})

/// Screens that are written. Anything in the registry without an entry here
/// renders `Placeholder`, so adding a screen is one line and removing a nav
/// entry cannot leave an orphan route.
const screens: Readonly<Record<string, () => React.ReactNode>> = {
  ...intake,
  ...tagging,
  ...counting,
  ...picking,
  ...packing,
  ...despatch,
  ...node,
}

const routes = allNavItems.map((item) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: item.path,
    component: screens[item.path] ?? Placeholder,
  })
)

/// A screen registered under a path no nav entry claims would be unreachable,
/// which is the failure this whole arrangement exists to prevent. Caught at
/// module load rather than in review.
const routed = new Set(allNavItems.map((item) => item.path))
for (const path of Object.keys(screens)) {
  if (!routed.has(path)) {
    throw new Error(
      `screens["${path}"] has no entry in a station's nav.ts, so nothing links to it`
    )
  }
}

/// `/` is not a screen. Landing somewhere real beats a dashboard nobody asked
/// for, and the first station in the flow — the loading bay — is that
/// somewhere: goods arrive before anything else can happen to them.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: stations[0].home })
  },
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, ...routes]),
  defaultPreload: "intent",
  // The screens read this node's own queues; a stale answer shown for a moment
  // is better than a spinner, and Query owns freshness anyway.
  defaultPreloadStaleTime: 0,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
