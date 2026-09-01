import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/* One MediaQueryList for the whole app rather than one per calling component.
 * The list is the store; every subscriber reads the same `matches`. */
let mediaQuery: MediaQueryList | undefined

function query(): MediaQueryList | undefined {
  if (typeof window === "undefined") return undefined
  mediaQuery ??= window.matchMedia(QUERY)
  return mediaQuery
}

function subscribe(onChange: () => void): () => void {
  const list = query()
  if (!list) return () => {}
  list.addEventListener("change", onChange)
  return () => list.removeEventListener("change", onChange)
}

const getSnapshot = () => query()?.matches ?? false

/* Server render has no viewport to measure; desktop is the safer assumption for
 * an ERP whose floor apps are the exception rather than the rule. */
const getServerSnapshot = () => false

/**
 * Whether the viewport is below the mobile breakpoint.
 *
 * Reads the media query synchronously through `useSyncExternalStore` rather
 * than writing it into state from an effect. The effect version rendered once
 * as `undefined` — reported as desktop — and then re-rendered with the real
 * answer, so a phone got one frame of the desktop layout on every mount and
 * the compiler had to bail out of the component that called it.
 */
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
