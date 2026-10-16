import { useLayoutEffect, useState } from "react"

/// Whether THIS component has mounted in the browser.
///
/// Not the same question as the router's `useHydrated()`, which turns true
/// once, for the whole page, when the shell hydrates. A screen section that
/// streams in hydrates later, by which time the page is long "hydrated" — so a
/// section that reads browser state (the dock, a device's stored copy, a feed
/// the shell already fetched) must draw what the server drew for its own
/// hydration, and only then the browser's answer. This turns true right after
/// the component's first commit, before the browser paints, so a component
/// mounted by a client navigation shows no in-between frame.
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useLayoutEffect(() => {
    setMounted(true)
  }, [])
  return mounted
}

/// Runs `run` once the streamed document is finished and hydrated: the router
/// has hydrated and the server's stream has ended (Start removes its
/// `$_TSR` bootstrap then), and React has had an idle moment to hydrate the
/// sections that came last. Returns a cancel for an effect's cleanup.
export function afterStreamedHydration(run: () => void): () => void {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const idle = (next: () => void) =>
    "requestIdleCallback" in window
      ? window.requestIdleCallback(next, { timeout: 2000 })
      : setTimeout(next, 200)
  const check = () => {
    if (cancelled) return
    if ((window as { $_TSR?: unknown }).$_TSR !== undefined) {
      timer = setTimeout(check, 50)
      return
    }
    idle(() => {
      if (!cancelled) run()
    })
  }
  check()
  return () => {
    cancelled = true
    clearTimeout(timer)
  }
}
