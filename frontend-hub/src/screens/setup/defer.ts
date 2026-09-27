import { useSyncExternalStore } from "react"

/// "Lanjut nanti" — the wizard put off for this browser session.
///
/// Per session and per browser on purpose: it is a convenience, not a fact
/// about the company. The company's own answer is `finished` on the server;
/// this only says the person at this browser wanted into the app first, and
/// the next session asks again. The home screen's card brings it back sooner.

const KEY = "central.hub.setup-deferred"
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

let memory = read()

export function deferSetup(deferred: boolean): void {
  try {
    if (deferred) sessionStorage.setItem(KEY, "1")
    else sessionStorage.removeItem(KEY)
  } catch {
    // Storage refused (a private window): the choice lasts until reload.
  }
  memory = deferred
  listeners.forEach((listener) => listener())
}

export function useSetupDeferred(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => memory
  )
}
