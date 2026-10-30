import { useEffect, useSyncExternalStore } from "react"

/// A page that wants every pixel asks the shell to fold the screens panel while
/// it is on screen: the month of the roster and the month of attendance are 31
/// columns wide (owner, 26 Oct 2026: "pas per month tutup inner sidebar").
///
/// A count, not a flag, so two pages that overlap during a transition cannot
/// let the first one's cleanup unfold the second one's panel. Asked and released
/// by the page; the shell only reads it. The desk's own open/closed choice is
/// left alone, and the panel comes back by itself when the page lets go.

let asking = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/// Whether some page has asked the screens panel to fold. For the shell.
export function usePanelFolded(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => asking > 0,
    () => false
  )
}

/// Fold the screens panel while `on` is true and this page is mounted.
export function useFoldPanel(on: boolean): void {
  useEffect(() => {
    if (!on) return
    asking += 1
    emit()
    return () => {
      asking -= 1
      emit()
    }
  }, [on])
}
