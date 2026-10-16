import { useEffect, useId, useRef, useSyncExternalStore } from "react"

/// Which desk sheets are open, in the order they opened — so a sheet knows
/// whether another stands over it, and how deep it is itself.
///
/// The layer move (hub-ui-patterns, 14 Oct): a sheet opened over another
/// slides in 12px further in, and the one under it dims IN PLACE with the same
/// veil — the page behind is not dimmed twice. A `swap` sheet is the other
/// move, a mode: it takes the place of the sheet under it (Edit over a
/// record), at the same depth, so it neither moves in nor dims what it covers.
///
/// A rail that stands BESIDE the list on a wide monitor is part of the page,
/// not a layer — but only when it opens on the page itself. Opened from
/// another sheet (an item followed out of an order, owner 14 Oct: "semua bisa
/// di klik"), it is a layer like any other.
interface Entry {
  readonly id: string
  readonly swap: boolean
  /// Beside the list: no veil, no depth.
  readonly flat: boolean
}

let stack: readonly Entry[] = []
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): readonly Entry[] {
  return stack
}

/// The depth of each layer: a swap takes the depth of the sheet it replaces;
/// a sheet beside the list has none (-1).
function depths(entries: readonly Entry[]): number[] {
  let depth = -1
  return entries.map((entry) => {
    if (entry.flat) return -1
    if (!(entry.swap && depth >= 0)) depth += 1
    return depth
  })
}

export interface SheetLayer {
  /// Another sheet stands over this one: it dims where it is.
  readonly under: boolean
  /// This sheet stands over another: it sits 12px further in, and the veil
  /// it brings is clear (the page is already behind one).
  readonly over: boolean
  /// A swap with a sheet under it to take the place of: it fades in where
  /// that one is, with a clear veil. A swap over nothing is a plain sheet.
  readonly replaces: boolean
  /// Stands beside the list (a rail on a wide monitor, opened from the page).
  readonly beside: boolean
}

const NONE: SheetLayer = {
  under: false,
  over: false,
  replaces: false,
  beside: false,
}

/// `besideable`: a rail on a page wide enough to stand it beside the list.
export function useSheetLayer(
  open: boolean,
  swap: boolean,
  besideable = false
): SheetLayer {
  const id = useId()
  const entries = useSyncExternalStore(subscribe, snapshot, snapshot)
  // While it leaves, a sheet keeps the place it had: a swap fades out where
  // it stood, a sheet over another slides out from 12px further in.
  const kept = useRef<SheetLayer>(NONE)
  const found = entries.findIndex((entry) => entry.id === id)
  const before = found < 0 ? entries : entries.slice(0, found)
  // Beside only when nothing but other beside-rails is open under it.
  const flat = besideable && before.every((entry) => entry.flat)
  useEffect(() => {
    if (!open) return
    stack = [...stack, { id, swap, flat }]
    for (const listener of listeners) listener()
    return () => {
      stack = stack.filter((entry) => entry.id !== id)
      for (const listener of listeners) listener()
    }
    // `flat` is decided as it opens and kept while it stays open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, swap, id])
  if (!open) return { ...kept.current, under: false }
  // Before its effect has run — the render that mounts it, whose classes the
  // entrance starts from — a sheet that is opening reads as if already on
  // top, so it slides (or fades) the right way from its first frame.
  const all = found < 0 ? [...entries, { id, swap, flat }] : entries
  const at = found < 0 ? all.length - 1 : found
  const self = all[at]
  const depth = depths(all)
  const layer: SheetLayer = self.flat
    ? { ...NONE, beside: true }
    : {
        under: depth.slice(at + 1).some((later) => later > depth[at]),
        over: depth[at] > 0,
        replaces: swap && depth.slice(0, at).some((one) => one >= 0),
        beside: false,
      }
  kept.current = layer
  return layer
}
