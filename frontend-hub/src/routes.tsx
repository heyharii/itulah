import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router"

import { AppShell } from "@/components/shell/app-shell"
import { allNavItems, asides, landingPath, modules } from "@/lib/navigation"
import { prefetchRoute } from "@/lib/prefetch"
import { validateSheetSearch } from "@/lib/sheets"
import { Placeholder } from "@/screens/placeholder"
import type { ScreenMap } from "@/screens/registry"

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

/// Screens that are written, one module at a time and only when asked for.
///
/// Every module's screen map (`src/screens/<folder>/index.ts`) used to be
/// imported here up front, so the app shipped as one 4.7 MB script: a phone
/// opening Profile to read a payslip downloaded Finance, Marketing and HR
/// first. Now each folder is its own chunk, fetched the first time one of its
/// paths is visited — or a moment before, when a link is hovered or pressed
/// (`defaultPreload: "intent"` below).
///
/// A path belongs to the folder named by its first segment; the four that do
/// not are listed. Anything in the registry without a screen renders
/// `Placeholder`, so adding a screen is still one line and removing a nav
/// entry cannot leave an orphan route.
// `.tsx` as well: Operations wraps its screens in a gate, which is JSX, so its
// map is `index.tsx` — and a `.ts`-only glob routed all fourteen of them to
// `Placeholder`.
const folders = import.meta.glob<{ screens: ScreenMap }>(
  "./screens/*/index.{ts,tsx}"
)
const FOLDER_OF: Readonly<Record<string, string>> = {
  "/apps": "mobile",
  "/chat": "workplace",
  "/discussions": "workplace",
  "/library": "workplace",
}
function loaderFor(path: string) {
  const folder = FOLDER_OF[path] ?? path.split("/")[1]
  return (
    folders[`./screens/${folder}/index.ts`] ??
    folders[`./screens/${folder}/index.tsx`]
  )
}

const routes = allNavItems.map((item) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: item.path,
    // The screen's first data starts moving with its code: on a hover or a
    // touch of any link to it (`intent`, after `defaultPreloadDelay` below)
    // and again when it is really navigated to. Not awaited — the router must
    // never wait for data the screen will ask for itself (`lib/prefetch.ts`).
    loader: ({ preload, location }) => {
      prefetchRoute(
        item.path,
        preload ? "intent" : "navigate",
        location.search as Record<string, unknown>
      )
    },
    component: lazyRouteComponent(async () => {
      const load = loaderFor(item.path)
      const screen = load ? (await load()).screens[item.path] : undefined
      return { default: screen ?? Placeholder }
    }),
  })
)
const routed = new Set(allNavItems.map((item) => item.path))

/// A screen registered under a path no nav entry claims would be unreachable,
/// and one filed in a folder its path does not name would never load — the
/// failures this arrangement exists to prevent. Checked in development, where
/// loading every folder costs nothing; a production build skips the block.
if (import.meta.env.DEV) {
  void Promise.all(
    Object.entries(folders).map(async ([file, load]) => {
      const folder = file.split("/")[2]
      for (const path of Object.keys((await load()).screens)) {
        if (!routed.has(path)) {
          console.error(
            `screens["${path}"] has no entry in lib/navigation.ts, so nothing links to it`
          )
        } else if (loaderFor(path) !== load) {
          console.error(
            `screens["${path}"] is in screens/${folder} but its path names another folder — add it to FOLDER_OF in routes.tsx`
          )
        }
      }
    })
  )
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
    // A phone starts on its launcher (the bottom bar's first tab); a desk on
    // the first module, as it always has. Asked of the window rather than of
    // the layout hook because this runs before anything renders.
    const phone = window.matchMedia("(width < 48rem)").matches
    throw redirect({ to: phone ? "/apps" : landingPath })
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
  // Only when nothing answers at the base already. System is the first
  // module whose prefix IS a screen (`/system` is Nodes, its home is Health):
  // a redirect there would be a second route with the same id, and Router
  // refuses to start on a duplicate rather than picking one.
  .filter((module) => !routed.has(module.base!))
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

/// And the same for a SCREEN that changed modules.
///
/// Suppliers is the one today: it moved from `/master/suppliers` to
/// `/procurement/suppliers` on 2026-09-12. `AppModule.moved` cannot express
/// that — it redirects to the module's `home`, which here is the order book —
/// so the old path is declared on the item and lands on the item's own path,
/// search parameters and all.
const movedItemRedirects = allNavItems.flatMap((item) =>
  (item.moved ?? []).map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      beforeLoad: ({ search }) => {
        throw redirect({ to: item.path, search })
      },
    })
  )
)

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    ...baseRedirects,
    ...movedRedirects,
    ...movedItemRedirects,
    ...routes,
  ]),
  defaultPreload: "intent",
  // A pointer must rest on a link this long before its code and data are asked
  // for (the router's default is 50): a sweep across the menu fetches nothing.
  defaultPreloadDelay: 70,
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
