import { useSyncExternalStore } from "react"

/// Work in progress, kept on the phone's disk.
///
/// Three stations here accumulate before they commit: a picking round, a pack
/// sheet, a stock-take walk. All three are a tally built up over twenty minutes
/// of walking, and all three are held on a device that **sleeps, is killed by
/// the OS, and gets reloaded by somebody who thought the screen had frozen**. In
/// `useState` that tally is gone every time, and what is lost is the walking
/// rather than the typing.
///
/// It is deliberately not in the URL — a tally of forty SKUs is not a link — and
/// deliberately not in the outbox: the outbox is work that has been *committed*
/// and is owed to the node. This is work that has not been committed yet, and the
/// person holding the phone is still allowed to change their mind about it.
///
/// One key per station and per subject (`pick:<pool>`, `pack:<shop>`), so two
/// half-finished cartons for two different shops do not overwrite each other.
///
/// ## Why this is a store rather than `useState` plus an effect
///
/// The obvious shape — state seeded from storage, plus an effect that re-reads
/// when the key changes — has a bug in it as well as a lint error. The bug is the
/// gap: between the key changing and the effect running, the screen shows the
/// *previous* shop's carton. localStorage is an external system, so it is read
/// the way React reads external systems, and there is then no moment at which the
/// screen and the disk disagree.

const PREFIX = "floor.draft."

/// The parsed value per key.
///
/// Not a cache for speed — a cache for **identity**. `useSyncExternalStore`
/// compares snapshots by reference and re-renders forever if handed a fresh
/// object each time, and `JSON.parse` returns a fresh object every call.
const parsed = new Map<string, unknown>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot<T>(storageKey: string, empty: T): T {
  const held = parsed.get(storageKey)
  if (held !== undefined) return held as T
  const fresh = load(storageKey, empty)
  parsed.set(storageKey, fresh)
  return fresh
}

function load<T>(storageKey: string, empty: T): T {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw === null) return empty
    return JSON.parse(raw) as T
  } catch {
    // Storage that cannot be read is storage that cannot be trusted. Start empty
    // and say nothing: a half-parsed tally is worse than none.
    return empty
  }
}

/// A tally that survives the phone.
///
/// Returns what is on disk, a way to change it, and a way to throw it away.
export function useDraft<T>(
  key: string,
  empty: T,
): [T, (next: T | ((current: T) => T)) => void, () => void] {
  const storageKey = PREFIX + key

  const value = useSyncExternalStore(
    subscribe,
    () => snapshot(storageKey, empty),
    () => snapshot(storageKey, empty),
  )

  const put = (next: T | ((current: T) => T)) => {
    // Resolved against the store rather than against a captured value: two taps
    // in one frame both land, and a stale closure cannot undo the first.
    const current = snapshot(storageKey, empty)
    const resolved =
      typeof next === "function" ? (next as (c: T) => T)(current) : next
    parsed.set(storageKey, resolved)
    try {
      localStorage.setItem(storageKey, JSON.stringify(resolved))
    } catch {
      // A full or disabled store. The tally still works for this screen's life;
      // losing durability is bad, and crashing mid-round is worse.
    }
    for (const listener of listeners) listener()
  }

  const clear = () => {
    parsed.set(storageKey, empty)
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // Nothing to do: the value is dropped from the store either way.
    }
    for (const listener of listeners) listener()
  }

  return [value, put, clear]
}

/// The tally shape all three stations use: how many of each SKU.
export type Tally = Readonly<Record<string, number>>

export function tallyTotal(tally: Tally): number {
  return Object.values(tally).reduce((total, each) => total + each, 0)
}

export function tallyLines(
  tally: Tally,
): readonly { readonly sku_code: string; readonly quantity: number }[] {
  return Object.entries(tally)
    .filter(([, quantity]) => quantity > 0)
    .map(([sku_code, quantity]) => ({ sku_code, quantity }))
}
