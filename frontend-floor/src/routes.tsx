import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router"

import { FloorShell } from "@/components/shell/floor-shell"
import { allNavItems } from "@/lib/navigation"
import { validateSearch } from "@/lib/params"
import { screens } from "@/screens"

/// The route tree, built from the navigation registry.
///
/// Every path is declared once, in `lib/navigation.ts`, and the router is
/// generated from it. Two lists drift the week somebody renames a path, and the
/// symptom is a tab that 404s — or a screen nothing leads to. Here they cannot
/// disagree, because there is only one list, and the two assertions below fail at
/// module load rather than in review.

/// The screen state that lives in the URL, declared on the root so it is legal on
/// every route below: Router merges the validated search of every matched route,
/// so a key the root claims survives on all of them.
const rootRoute = createRootRoute({
  component: FloorShell,
  validateSearch,
})

/// A screen registered under a path no nav entry claims would be unreachable.
for (const path of Object.keys(screens)) {
  if (!allNavItems.some((item) => item.path === path)) {
    throw new Error(
      `screens["${path}"] tidak ada di lib/navigation.ts, jadi tidak ada yang menuju ke sana`,
    )
  }
}

/// And the other way round: a nav entry with no screen. There is nothing to stage
/// here — a station that opens on "belum dibuat" while a lorry is on the bay is
/// worse than no station.
for (const item of allNavItems) {
  if (screens[item.path] === undefined) {
    throw new Error(
      `lib/navigation.ts menyebut "${item.path}" tetapi src/screens/index.ts tidak punya layarnya`,
    )
  }
}

const routes = allNavItems.map((item) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: item.path,
    component: screens[item.path],
  }),
)

/// `/` is not a screen. The app opens on the work list.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    // Cast for the same reason `<AppLink>` casts: the tree is generated from the
    // registry, so Router has no literal union to check this against.
    throw redirect({ to: "/tugas" as never })
  },
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, ...routes]),
  defaultPreload: "intent",
  // Query owns freshness, and on this surface a stale answer shown for a moment
  // is the whole design: the list on screen is the one this phone already holds,
  // whether or not the node was reachable this second.
  defaultPreloadStaleTime: 0,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
