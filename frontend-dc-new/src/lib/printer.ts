import { useSyncExternalStore } from "react"

/// Which label printer is in front of this person.
///
/// Kept on the device rather than on the server because it is a fact about the
/// bench somebody is standing at, and it changes when they walk to another
/// one. Shared between the tagging bench and the carton labels so a warehouse
/// does not have to be told twice where its printer is.
const KEY = "itulah.dc.printer"

export interface Printer {
  readonly host: string
  readonly port: number
  readonly widthMm: number
  readonly heightMm: number
  /// How many labels one pass hands over. A smaller chunk is a longer wait
  /// between presses; a larger one is more to reprint when the ribbon jams.
  readonly chunk: number
}

/// 58 × 40 mm because that is the tag the ZPL layout was tuned against by
/// hand, and the size the server assumes when a request leaves it out. Other
/// sizes scale from it, so a smaller default here would quietly hand every new
/// bench a tag nobody calibrated.
const DEFAULT_PRINTER: Printer = {
  host: "127.0.0.1",
  port: 9100,
  widthMm: 58,
  heightMm: 40,
  chunk: 25,
}

/// Tag stock a bench can pick without typing two numbers.
///
/// Deliberately NOT a catalogue of what this warehouse buys — nothing in this
/// app knows that, and a list that pretended to would be wrong the first time
/// a reel changed. These are starting points, and the first of them is the
/// only one with any authority: 58 × 40 is what the layout was tuned against
/// by hand and what the node assumes when a request leaves the size out. The
/// rest are ordinary thermal stock, offered so that the common case is a tap
/// rather than a typo. Anything else is typed, and the preview beside these
/// fields is what says whether it actually works.
export const TAG_PRESETS: readonly {
  readonly widthMm: number
  readonly heightMm: number
  readonly note?: string
}[] = [
  { widthMm: 58, heightMm: 40, note: "Tuned by hand" },
  { widthMm: 50, heightMm: 30 },
  { widthMm: 40, heightMm: 30 },
  { widthMm: 100, heightMm: 50, note: "Cartons" },
]

function read(): Printer {
  try {
    const stored = window.localStorage.getItem(KEY)
    return stored === null
      ? DEFAULT_PRINTER
      : { ...DEFAULT_PRINTER, ...(JSON.parse(stored) as Partial<Printer>) }
  } catch {
    // A device that refuses storage still prints. Losing the host between
    // shifts is a nuisance, not a failure worth reporting.
    return DEFAULT_PRINTER
  }
}

let current = typeof window === "undefined" ? DEFAULT_PRINTER : read()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      current = read()
      listener()
    }
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function savePrinter(printer: Printer): void {
  current = printer
  try {
    window.localStorage.setItem(KEY, JSON.stringify(printer))
  } catch {
    // As above.
  }
  for (const listener of listeners) listener()
}

/// The bench's printer, live. A hook rather than a read-on-mount because two
/// panels on the tagging screen show it at once and they must not disagree
/// about which machine the labels are going to.
export function usePrinter(): Printer {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_PRINTER
  )
}

export function loadPrinter(): Printer {
  return current
}
