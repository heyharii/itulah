import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router"

import { AppShell } from "@/components/shell/app-shell"
import { allNavItems, modules } from "@/lib/navigation"
import { validateSheetSearch } from "@/lib/sheets"
import { Placeholder } from "@/screens/placeholder"
import { screens as analytics } from "@/screens/analytics"
import { screens as articles } from "@/screens/articles"
import { screens as commercial } from "@/screens/commercial"
import { screens as finance } from "@/screens/finance"
import { screens as inventory } from "@/screens/inventory"
import { screens as people } from "@/screens/people"
import { screens as procurement } from "@/screens/procurement"
import { screens as storeops } from "@/screens/storeops"
import { screens as system } from "@/screens/system"
import { screens as workplace } from "@/screens/workplace"

/// The route tree, built from the navigation registry.
///
/// Every path is declared once, in `lib/navigation.ts`, and the router is
/// generated from it. That is not tidiness: on a surface covering ~147 cloud
/// endpoints the two lists drift the week somebody renames a path, and the
/// symptom is a sidebar entry that 404s — or a screen nothing links to. Here
/// they cannot disagree, because there is only one list.
///
/// Routes are code-based rather than file-based: no codegen step, and the tree
/// is derived rather than transcribed.

/// Which sheet is open is a search parameter, declared here so it is legal on
/// every route below. Router merges the validated search of every matched
/// route, so a key the root claims survives on all of them, and a route with
/// its own `validateSearch` adds to this rather than replacing it.
const rootRoute = createRootRoute({
  component: AppShell,
  validateSearch: validateSheetSearch,
})

/// Screens that are written. Anything in the registry without an entry here
/// renders `Placeholder`, so adding a screen is one line and removing a nav
/// entry cannot leave an orphan route.
///
/// Keys must be paths that exist in `lib/navigation.ts`; `assertScreensAreRouted`
/// below fails the build if one does not.
const screens: Readonly<Record<string, () => React.ReactNode>> = {
  ...commercial,
  ...articles,
  ...inventory,
  ...procurement,
  ...storeops,
  ...finance,
  ...people,
  ...workplace,
  ...analytics,
  ...system,
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
      `screens["${path}"] has no entry in lib/navigation.ts, so nothing links to it`
    )
  }
}

/// `/` is not a screen. Landing somewhere real beats a dashboard nobody asked
/// for, and the first module in the registry is that somewhere.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: modules[0].home })
  },
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, ...routes]),
  defaultPreload: "intent",
  // The screens read the signed-in user's own data; a stale answer shown for a
  // moment is better than a spinner, and Query owns freshness anyway.
  defaultPreloadStaleTime: 0,
  // Turning a page is a page turn; opening a sheet is not.
  //
  // This hands a navigation to the browser's own view transition, which is why
  // the page turn costs no library and no wrapper component. What it looks
  // like is in `styles/index.css`.
  //
  // The predicate is the reason this is an object rather than `true`. Most
  // No page transition. One was tried — the incoming screen faded up over 4px
  // — and removed once Commercial began navigating itself by tabs: a screen
  // that changes several times a minute reads as considered on the first click
  // and as lag on the tenth. The router commits navigations directly.
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
