/**
 * The one place Tailwind's `lg` is written down in JavaScript.
 *
 * The app shell swaps DOM at this width — the navigation column becomes a
 * modal drawer — so the breakpoint cannot live only in a class name.
 */

import { useSyncExternalStore } from "react"

export const DESKTOP_QUERY = "(min-width: 1024px)"

function subscribe(onChange: () => void) {
  const list = window.matchMedia(DESKTOP_QUERY)
  list.addEventListener("change", onChange)
  return () => list.removeEventListener("change", onChange)
}

function read() {
  return window.matchMedia(DESKTOP_QUERY).matches
}

/** True at `lg` and above. */
export function useIsDesktop() {
  return useSyncExternalStore(subscribe, read, () => true)
}
