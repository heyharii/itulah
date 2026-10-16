"use client"

import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  HydrationBoundary,
  type DehydratedState,
} from "@tanstack/react-query"
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals"
import { useEffect, useState } from "react"

declare global {
  interface Window {
    __prototypeMetrics?: Array<Record<string, unknown>>
    __prototypeRun?: { scenario?: string; runId?: string; route?: string }
  }
}

const basePath = process.env.NEXT_PUBLIC_ROUTER_BASEPATH ?? ""
const prototypeApi = `${basePath}/api/prototype`

function collectMetric(metric: Metric) {
  const row = {
    name: metric.name,
    value: metric.value,
    delta: metric.delta,
    rating: metric.rating,
    id: metric.id,
    navigationType: metric.navigationType,
    at: Date.now(),
    scenario: window.__prototypeRun?.scenario ?? "unspecified",
    runId: window.__prototypeRun?.runId ?? "unspecified",
    route: window.__prototypeRun?.route ?? window.location.pathname,
  }
  window.__prototypeMetrics ??= []
  window.__prototypeMetrics.push(row)
  window.dispatchEvent(new CustomEvent("prototype:metric", { detail: row }))
  try {
    navigator.sendBeacon(
      `${prototypeApi}/metrics`,
      new Blob([JSON.stringify({ metrics: [row], scenario: row.scenario, runId: row.runId, route: row.route })], { type: "application/json" })
    )
  } catch {
    // Browser restrictions on unload telemetry never affect the screen.
  }
}

function Vitals() {
  useEffect(() => {
    onTTFB(collectMetric)
    onFCP(collectMetric)
    onLCP(collectMetric)
    onCLS(collectMetric, { reportAllChanges: true })
    onINP(collectMetric, { reportAllChanges: true })

    const click = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest("a[href]")
      if (!anchor) return
      const target = anchor.getAttribute("href")
      if (!target?.startsWith("/")) return
      performance.mark("prototype:navigation-start")
    }
    document.addEventListener("click", click, true)
    return () => document.removeEventListener("click", click, true)
  }, [])
  return null
}

export function ClientProviders({
  children,
  state,
}: {
  children: React.ReactNode
  state: DehydratedState
}) {
  const [queryClient] = useState(() => {
    let current: QueryClient | null = null
    const mutationCache = new MutationCache({
      onSuccess: async () => {
        try {
          const response = await fetch(`${prototypeApi}/cache`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "x-prototype-action": "invalidate" },
          })
          if (response.ok) {
            // Warm only the two default, high-traffic screens for this
            // authenticated owner. Keep the work off the save interaction.
            void fetch(`${prototypeApi}/cache`, {
              method: "POST",
              credentials: "same-origin",
              headers: { "x-prototype-action": "warm-popular" },
            }).catch(() => {})
          }
        } catch {
          // Browser-side query invalidation below remains the fallback.
        }
        await Promise.all([
          current?.invalidateQueries({ queryKey: ["procurement"] }),
          current?.invalidateQueries({ queryKey: ["dc"] }),
        ])
      },
    })
    current = new QueryClient({
      mutationCache,
      defaultOptions: {
        queries: {
          staleTime: 1600,
          gcTime: 5 * 60 * 1000,
          refetchOnWindowFocus: false,
          retry: 0,
        },
      },
    })
    return current
  })

  useEffect(() => {
    const target = window as Window & { __prototypeInvalidate?: () => void }
    target.__prototypeInvalidate = () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["procurement"] }),
        queryClient.invalidateQueries({ queryKey: ["dc"] }),
      ])
    }
    return () => { delete target.__prototypeInvalidate }
  }, [queryClient])

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={state}>
        <Vitals />
        {children}
      </HydrationBoundary>
    </QueryClientProvider>
  )
}
