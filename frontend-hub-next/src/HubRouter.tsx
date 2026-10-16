"use client"

import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router"
import { useEffect, useMemo, useRef } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"

import { Receiving } from "@/screens/operations/intake/receiving"
import { purchaseSummaryQuery, purchaseWorkQuery, storeInboundQuery, verifyQueueQuery } from "@/lib/operations/queries"
import { supplierNamesQuery, orderBookQuery } from "@/lib/queries/procurement"
import { PurchaseOrders } from "@/screens/procurement/purchase-orders"

type InitialVersions = {
  versions: Record<string, string>
  cacheStates: Record<string, string>
}

type RouterContext = {
  queryClient: QueryClient
  initialVersions: InitialVersions
}

const basePath = process.env.NEXT_PUBLIC_ROUTER_BASEPATH ?? ""
const prototypeApi = `${basePath}/api/prototype`

async function preloadOrders(queryClient: QueryClient) {
  const scope = { statuses: ["ACTIVE", "PARTIALLY_RECEIVED"], sort: "updated" } as const
  await Promise.all([
    queryClient.prefetchInfiniteQuery(orderBookQuery(scope)),
    queryClient.prefetchQuery(supplierNamesQuery()),
  ])
}

async function preloadReceiving(queryClient: QueryClient) {
  await Promise.all([
    queryClient.prefetchQuery(purchaseWorkQuery()),
    queryClient.prefetchQuery(verifyQueueQuery()),
    queryClient.prefetchQuery(purchaseSummaryQuery()),
    queryClient.prefetchQuery(storeInboundQuery("IN_TRANSIT")),
    queryClient.prefetchQuery(supplierNamesQuery()),
  ])
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: PrototypeShell,
})

function PrototypeShell() {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const { queryClient, initialVersions } = rootRoute.useRouteContext()
  const knownPath = useRef(path)
  const knownVersions = useRef<Record<string, string>>({ ...initialVersions.versions })

  useEffect(() => {
    const target = window as Window & { __prototypeRun?: { scenario?: string; runId?: string; route?: string } }
    target.__prototypeRun ??= {}
    target.__prototypeRun.route = window.location.pathname

    const sameRoute = knownPath.current === path
    knownPath.current = path
    if (!sameRoute) knownVersions.current = {}

    let stopped = false
    let timer = 0
    const poll = async () => {
      try {
        const response = await fetch(`${prototypeApi}/freshness?path=${encodeURIComponent(path)}`, {
          cache: "no-store",
          credentials: "same-origin",
        })
        if (!response.ok) return
        const snapshot = await response.json() as { versions?: Record<string, string>; cacheStates?: Record<string, string> }
        if (stopped) return

        const changed = Object.entries(snapshot.versions ?? {})
          .filter(([key, version]) => knownVersions.current[key] !== undefined && knownVersions.current[key] !== version)
          .map(([key]) => key)
        knownVersions.current = { ...(snapshot.versions ?? {}) }

        if (changed.some((key) => key === "po" || key === "poDetail" || key === "receivingLookup" || key === "receivingDetail")) {
          await queryClient.invalidateQueries({ queryKey: ["procurement"] })
        }
        if (changed.some((key) => key.startsWith("purchase") || key === "verifyQueue" || key === "storeInbound")) {
          await queryClient.invalidateQueries({ queryKey: ["dc"] })
        }
        if (changed.length > 0) {
          window.dispatchEvent(new CustomEvent("prototype:freshness", { detail: { path, changed, cacheStates: snapshot.cacheStates } }))
        }
      } catch {
        // A missed freshness poll never blocks the currently rendered screen.
      }
    }
    void poll()
    timer = window.setInterval(() => { void poll() }, 1800)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [path, queryClient])

  useEffect(() => {
    const start = performance.getEntriesByName("prototype:navigation-start", "mark").at(-1)
    if (!start || start.startTime > performance.now()) return
    requestAnimationFrame(() => {
      const duration = Math.max(0, performance.now() - start.startTime)
      const id = `spa-${crypto.randomUUID()}`
      const row = {
        name: "SPA",
        value: duration,
        delta: duration,
        rating: duration <= 200 ? "good" : duration <= 500 ? "needs-improvement" : "poor",
        id,
        navigationType: "route-change",
        at: Date.now(),
        scenario: window.__prototypeRun?.scenario ?? "unspecified",
        runId: window.__prototypeRun?.runId ?? "unspecified",
        route: window.location.pathname,
      }
      window.__prototypeMetrics ??= []
      window.__prototypeMetrics.push(row)
      const base = process.env.NEXT_PUBLIC_ROUTER_BASEPATH ?? ""
      try {
        navigator.sendBeacon(
          `${base}/api/prototype/metrics`,
          new Blob([JSON.stringify({ metrics: [row], scenario: row.scenario, runId: row.runId, route: row.route })], { type: "application/json" })
        )
      } catch {
        // Route rendering remains independent from optional telemetry.
      }
      performance.clearMarks("prototype:navigation-start")
    })
  }, [path])

  return (
    <div className="min-h-screen bg-[var(--page)] text-[var(--ink)]">
      <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-[100rem] items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-mute">Central Dashboard · Prototype</p>
            <h1 className="text-lg font-semibold">Procurement and Receiving</h1>
          </div>
          <nav aria-label="Prototype navigation" className="flex gap-2 text-sm">
            <Link
              to="/procurement/orders"
              preload="intent"
              className={`rounded-full px-3 py-2 ${path === "/procurement/orders" ? "bg-dark text-on-dark" : "hover:bg-soft-2"}`}
            >Purchase Orders</Link>
            <Link
              to="/operations/intake"
              preload="intent"
              className={`rounded-full px-3 py-2 ${path === "/operations/intake" ? "bg-dark text-on-dark" : "hover:bg-soft-2"}`}
            >Receiving</Link>
          </nav>
        </div>
      </header>
      <main><Outlet /></main>
    </div>
  )
}

// Demo3 is cloud-hosted and every page is already authenticated by the Next
// server route. The full Hub's edge recovery gate is not needed on this
// cloud-only prototype surface.
function OperationsGate({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/procurement/orders",
  loader: ({ context }) => preloadOrders(context.queryClient),
  component: PurchaseOrders,
})
const receivingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/operations/intake",
  loader: ({ context }) => preloadReceiving(context.queryClient),
  component: () => <OperationsGate><Receiving /></OperationsGate>,
})
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: ({ context }) => preloadOrders(context.queryClient),
  component: PurchaseOrders,
})
const routeTree = rootRoute.addChildren([indexRoute, ordersRoute, receivingRoute])

export function HubRouter({
  initialPath,
  initialVersions,
}: {
  initialPath: string
  initialVersions: InitialVersions
}) {
  const queryClient = useQueryClient()
  const versions = useRef(initialVersions)
  const router = useMemo(() => {
    const history = typeof window === "undefined"
      ? createMemoryHistory({ initialEntries: [`${basePath}${initialPath}`] })
      : createBrowserHistory()
    return createRouter({
      routeTree,
      history,
      context: { queryClient, initialVersions: versions.current },
      basepath: basePath,
      defaultPreload: "intent",
      defaultPreloadDelay: 70,
      defaultPreloadStaleTime: 1000,
      defaultPendingMs: 0,
    })
  }, [initialPath, queryClient])

  return <RouterProvider router={router} />
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter<typeof routeTree>>
  }
}
