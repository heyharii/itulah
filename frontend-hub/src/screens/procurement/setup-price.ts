import { useSyncExternalStore } from "react"

/// The base price set from a New articles card's Set price popup, per
/// delivery line, before the line's form is ever opened. The form starts from
/// it when it has no draft of its own. Kept in this browser.
const KEY = "central.new-articles.prices"

const listeners = new Set<() => void>()
let cache: Record<string, number> | null = null

function all(): Record<string, number> {
  if (cache !== null) return cache
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    cache =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, number>)
        : {}
  } catch {
    cache = {}
  }
  return cache
}

export function readSetupPrice(receiptLineId: string): number | null {
  return all()[receiptLineId] ?? null
}

export function writeSetupPrice(receiptLineId: string, base: number) {
  cache = { ...all(), [receiptLineId]: base }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // Storage denied: kept for this page only.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSetupPrice(receiptLineId: string | null): number | null {
  return useSyncExternalStore(
    subscribe,
    () => (receiptLineId === null ? null : readSetupPrice(receiptLineId)),
    () => null
  )
}
