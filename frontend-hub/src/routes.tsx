import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router"

import { AppShell } from "@/components/shell/app-shell"
import { allNavItems, asides, modules } from "@/lib/navigation"
import { validateSheetSearch } from "@/lib/sheets"
import { Placeholder } from "@/screens/placeholder"
import { screens as assistant } from "@/screens/assistant"
import { screens as master } from "@/screens/master"
import { screens as commercial } from "@/screens/commercial"
import { screens as allotment } from "@/screens/allotment"
import { screens as finance } from "@/screens/finance"
import { screens as financeLab } from "@/screens/finance-lab"
import { screens as home } from "@/screens/home"
import { screens as inventory } from "@/screens/inventory"
import { screens as members } from "@/screens/members"
import { screens as operations } from "@/screens/operations"
import { screens as people } from "@/screens/people"
import { screens as procurement } from "@/screens/procurement"
import { screens as reports } from "@/screens/reports"
import { screens as sales } from "@/screens/sales"
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
  ...home,
  ...assistant,
  ...commercial,
  ...master,
  ...inventory,
  ...allotment,
  ...procurement,
  ...sales,
  ...storeops,
  ...operations,
  ...members,
  ...finance,
  ...financeLab,
  ...people,
  ...workplace,
  ...reports,
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

/// `/` is not a screen of its own — it is a redirect into the first module in
/// the registry, which is Home. That indirection is kept rather than routing
/// the brief at `/` directly: the rail, the sidebar and the palette all
/// address screens by the paths in the registry, and a page reachable at two
/// URLs is a page whose nav highlight is right half the time.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: modules[0].home })
  },
})

/// A module whose URL prefix is not itself a screen, sent to the screen it
/// used to be.
///
/// Procurement is the one that has this today: Sourcing moved from
/// `/procurement` to `/procurement/sourcing` so the URL names the page rather
/// than the department, and the bare path is in people's history, in links
/// they have sent each other and in whatever they have bookmarked. A 404 is a
/// worse answer than the screen they wanted.
///
/// Generated from the registry rather than written out, so the next module to
/// separate its `base` from its `home` gets the same treatment without anybody
/// remembering this file exists.
///
/// Not nav entries, for the same reason `/` is not one: they are redirects,
/// and a path with no screen behind it would be a row in ⌘K that opens
/// nothing.
const baseRedirects = [...modules, ...asides]
  .filter((module) => module.base !== undefined && module.base !== module.home)
  .map((module) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: module.base!,
      beforeLoad: () => {
        throw redirect({ to: module.home })
      },
    })
  )

/// The same treatment for a screen that has been absorbed rather than moved.
///
/// Files is the one today: it swallowed Documents on 2026-09-04, so `/documents`
/// lands here. The search parameters survive the redirect — Router carries them
/// unless told otherwise — which is what keeps every `?document=` link anybody
/// has sent opening the record it always did, now in the sheet on Files.
const movedRedirects = [...modules, ...asides].flatMap((module) =>
  (module.moved ?? []).map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      beforeLoad: ({ search }) => {
        throw redirect({ to: module.home, search })
      },
    })
  )
)

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    ...baseRedirects,
    ...movedRedirects,
    ...routes,
  ]),
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
