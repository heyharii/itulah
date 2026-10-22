import {
  createRoute,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router"

import screenPreloads from "virtual:screen-preloads"

import { deviceHint } from "@/lib/device"
import { allNavItems, asides, landingPath, modules } from "@/lib/navigation"
import { prefetchOnServer, prefetchRoute } from "@/lib/prefetch"
import { Placeholder } from "@/screens/placeholder"
import { screenOf, type ScreenMap } from "@/screens/registry"
import { RootRoute } from "@/routes/__root"

/// The route tree, built from the navigation registry.
///
/// Every path is declared once, in `lib/navigation.ts`, and the router is
/// generated from it. That is not tidiness: on a surface covering ~147 cloud
/// endpoints the two lists drift the week somebody renames a path, and the
/// symptom is a sidebar entry that 404s — or a screen nothing links to. Here
/// they cannot disagree, because there is only one list.
///
/// Routes are code-based rather than file-based: no codegen step, and the tree
/// is derived rather than transcribed. The tree root is the document route
/// Start owns (`routes/__root.tsx`); `router.tsx` composes the two and owns
/// the router instance (one per SSR request).

/// Every screen renders on the server, with its first data when its
/// department's `prefetch.ts` names it (`prefetchOnServer`). The exceptions
/// are screens whose work belongs to the device: Operations reads the
/// warehouse node with a bearer token that lives in this tab's
/// `sessionStorage`, which no server can see. Those routes are `ssr: false`
/// (Start's selective SSR): the server renders the shell around them, and
/// their loader and screen run in the browser, exactly as the SPA did.
const CLIENT_ONLY_FOLDERS: ReadonlySet<string> = new Set(["operations"])
const clientOnly = (path: string) =>
  CLIENT_ONLY_FOLDERS.has(FOLDER_OF[path] ?? path.split("/")[1])

/// Which sheet is open is a search parameter, declared on the root so it is
/// legal on every route below. Router merges the validated search of every
/// matched route, so a key the root claims survives on all of them, and a
/// route with its own `validateSearch` adds to this rather than replacing it.
/// (The root is `RootRoute` in `routes/__root.tsx`, which validates it.)

/// Screens that are written, one module at a time and only when asked for.
///
/// Every module's screen map (`src/screens/<folder>/index.ts`) used to be
/// imported here up front, so the app shipped as one 4.7 MB script: a phone
/// opening Profile to read a payslip downloaded Finance, Marketing and HR
/// first. Now each folder is its own chunk, fetched the first time one of its
/// paths is visited — or a moment before, when a link is hovered or pressed
/// (`defaultPreload: "intent"` in `router.tsx`).
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
  "/library/papers": "workplace",
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
    getParentRoute: () => RootRoute,
    path: item.path,
    ssr: clientOnly(item.path) ? false : undefined,
    // The screen's own chunks, named in the response so the browser fetches
    // them alongside the entry rather than after it (`vite.screen-preloads.ts`).
    headers: () => screenPreloadHeader(item.path),
    // The screen's first data starts moving with its code: on a hover or a
    // touch of any link to it (`intent`, after `defaultPreloadDelay` in
    // `router.tsx`) and again when it is really navigated to. Not awaited in
    // the browser — the router must never wait for data the screen will ask
    // for itself (`lib/prefetch.ts`) — nor on the server, where the screen's
    // sections stream in as their answers land.
    loader: ({ context, preload, location }) => {
      const search = location.search as Record<string, unknown>
      if (typeof window === "undefined") {
        void prefetchOnServer(context.queryClient, item.path, search)
        return
      }
      prefetchRoute(item.path, preload ? "intent" : "navigate", search)
    },
    component: lazyRouteComponent(async () => {
      const entry = await entryFor(item.path)
      return { default: entry ? await screenOf(entry) : Placeholder }
    }),
  })
)
const routed = new Set(allNavItems.map((item) => item.path))

/// A path's entry in its folder's screen map, loading the (small) map first.
async function entryFor(path: string) {
  const load = loaderFor(path)
  if (!load) return undefined
  // A map from a build that is gone resolves to nothing once the page is
  // reloading for the new one (`boot-client.ts`): wait for it, don't throw.
  const loaded = await load()
  return loaded === undefined
    ? new Promise<never>(() => {})
    : loaded.screens[path]
}

/// `Link: <…>; rel=modulepreload` for a path's screen and its folder's map,
/// or nothing. Server only in effect: the browser ignores a route's headers.
async function screenPreloadHeader(
  path: string
): Promise<Record<string, string> | undefined> {
  if (typeof window !== "undefined") return undefined
  const folder = FOLDER_OF[path] ?? path.split("/")[1]
  const entry = await entryFor(path)
  const files = new Set([
    ...(screenPreloads[`${folder}/index`] ?? []),
    ...(entry !== undefined && typeof entry !== "function"
      ? (screenPreloads[entry.module] ?? [])
      : []),
  ])
  if (files.size === 0) return undefined
  return {
    Link: [...files].map((file) => `<${file}>; rel=modulepreload`).join(", "),
  }
}

/// A screen registered under a path no nav entry claims would be unreachable,
/// and one filed in a folder its path does not name would never load — the
/// failures this arrangement exists to prevent. Checked in development only,
/// once per tab and when the browser is idle: it loads every screen folder —
/// about a thousand modules through Vite's dev transform — and doing that on
/// every page load is what made the dev server crawl, and left the screen
/// blank after signing in while the shell waited behind it. A production
/// build skips the block. Browser only: the server must never load every
/// screen while rendering.
function checkRegistry() {
  try {
    if (sessionStorage.getItem("registry-checked") !== null) return
    sessionStorage.setItem("registry-checked", "1")
  } catch {
    return
  }
  void Promise.all(
    Object.entries(folders).map(async ([file, load]) => {
      const folder = file.split("/")[2]
      for (const path of Object.keys((await load())?.screens ?? {})) {
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
if (import.meta.env.DEV && typeof window !== "undefined") {
  if ("requestIdleCallback" in window)
    window.requestIdleCallback(checkRegistry, { timeout: 10_000 })
  else setTimeout(checkRegistry, 5000)
}

/// `/` is not a screen of its own — it is a redirect into the first module in
/// the registry, which is Home. That indirection is kept rather than routing
/// the brief at `/` directly: the rail, the sidebar and the palette all
/// address screens by the paths in the registry, and a page reachable at two
/// URLs is a page whose nav highlight is right half the time.
const indexRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/",
  beforeLoad: () => {
    // A phone starts on its launcher (the bottom bar's first tab); a desk on
    // the first module, as it always has. The browser asks the window; the
    // server has only the request's own word for it (`lib/device.ts`).
    const phone =
      typeof window === "undefined"
        ? deviceHint().width < 768
        : window.matchMedia("(width < 48rem)").matches
    throw redirect({ to: phone ? "/apps" : landingPath })
  },
})

/// The public links: an invitation (`/join/{token}`), a Surat Jalan Retur's QR
/// (`/n/{token}`) and a printed PO's QR (`/p/{token}`). `App` reads the token from the router's
/// location and renders the page outside the shell; the routes exist so the
/// server answers them as pages rather than 404s.
const publicRoutes = ["/join/$token", "/n/$token", "/p/$token"].map((path) =>
  createRoute({
    getParentRoute: () => RootRoute,
    path,
    component: () => null,
  })
)

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
      getParentRoute: () => RootRoute,
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
      getParentRoute: () => RootRoute,
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
      getParentRoute: () => RootRoute,
      path,
      beforeLoad: ({ search }) => {
        throw redirect({ to: item.path, search })
      },
    })
  )
)

/// The tree's children, in match order: `/` first, then the redirects, then
/// every registered screen. `router.tsx` hangs these off the document route.
export const hubChildren = [
  indexRoute,
  ...publicRoutes,
  ...baseRedirects,
  ...movedRedirects,
  ...movedItemRedirects,
  ...routes,
]
