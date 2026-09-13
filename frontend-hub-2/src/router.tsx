import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  stripSearchParams,
} from "@tanstack/react-router"

import { Suspense } from "react"

import { Boundary } from "@/kit/boundary"
import { Shell } from "@/shell/shell"
import { itemsOf } from "@/lib/nav"
import { defaultsOf, validator } from "@/lib/search-schema"
import { modules } from "@/modules"

/// The router, GENERATED from the navigation registry.
///
/// Not hand-written, and that is the point: a route table beside a nav table is
/// two lists that have to agree, and the version where they do not is the
/// version where a sidebar row 404s or a screen exists that nothing links to.
/// Here a screen is declared once, in `src/modules/*/nav.tsx`, and both the
/// sidebar row and the route come from that declaration.

const root = createRootRoute({ component: Shell })

/// `/` is not a screen. It lands on the first module's first item, which is a
/// real page — rather than an "index" that would be a fourth thing to write and
/// keep meaningful. A redirect rather than a duplicate route so the URL people
/// end up sharing is the screen's own.
const home = createRoute({
  getParentRoute: () => root,
  path: "/",
  beforeLoad: () => {
    const first = itemsOf(modules[0])[0]
    throw redirect({ to: first.path })
  },
  component: () => null,
})

/// One route per declared screen, each in its own chunk and its own boundary.
///
/// The boundary is INSIDE the shell, so a screen that throws takes only itself
/// down and the navigation beside it keeps working — see `kit/boundary.tsx`.
/// `key` on it is the path, which is what makes a broken screen recover simply
/// by navigating away and back: a new key is a new boundary with no error in
/// it.
///
/// `Suspense` has no spinner on purpose. A chunk on the same origin arrives in
/// a few milliseconds, and a flash of "Loading…" that is gone before it is read
/// is worse than a beat of the previous screen — it reads as a fault. A screen
/// that needs longer says so itself, from its own query.
const screens = modules.flatMap((module) =>
  itemsOf(module).map((item) => {
    const Screen = item.screen
    return createRoute({
      getParentRoute: () => root,
      path: item.path,
      // The screen's own search params, validated here rather than in the
      // component — see `lib/search-schema.ts`. A screen that declares none
      // gets the raw object through, which is what the older `useQueryState`
      // readers still expect.
      validateSearch: item.search
        ? validator(item.search)
        : (raw: Record<string, unknown>) => raw,
      // A param equal to its default is stripped from the URL — the screen
      // still gets it, the address bar does not carry it. Without this every
      // link is seven empty parameters long and stops being readable or
      // sendable, which is most of what putting state in the URL was for.
      search: item.search
        ? { middlewares: [stripSearchParams(defaultsOf(item.search))] }
        : undefined,
      component: () => (
        <Boundary key={item.path}>
          <Suspense fallback={null}>
            <Screen />
          </Suspense>
        </Boundary>
      ),
    })
  }),
)

// Two screens at one URL is a bug that presents as one of them being
// unreachable — no error, just a page nobody can get to. Caught here, at
// startup, where it is a stack trace instead of a mystery.
const seen = new Set<string>()
for (const module of modules) {
  for (const item of itemsOf(module)) {
    if (seen.has(item.path)) {
      throw new Error(`Two screens share one path: ${item.path}`)
    }
    seen.add(item.path)
  }
}

export const router = createRouter({
  routeTree: root.addChildren([home, ...screens]),
  defaultPreload: "intent",
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
