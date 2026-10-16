import { useSyncExternalStore } from "react"

import type { PrinterLanguage } from "@itulah/contract"

/// Which label printer is in front of this person.
///
/// Kept on the device rather than on the server because it is a fact about the
/// bench somebody is standing at, and it changes when they walk to another
/// one. Shared between the tagging bench and the carton labels so a warehouse
/// does not have to be told twice where its printer is.
const KEY = "central.dc.printer"

export interface Printer {
  readonly host: string
  readonly port: number
  readonly widthMm: number
  readonly heightMm: number
  /// How far in from the left edge of the liner the die-cut tag starts.
  ///
  /// A reel is not all label. On RFID stock the tag is inset, and ink placed
  /// at x=0 lands on the backing paper — the tag comes out with its left
  /// column missing, which looks like a layout fault and is not one. Held per
  /// bench for the same reason the size is: it is a fact about the reel in
  /// this machine.
  readonly offsetMm: number
  /// How many labels one pass hands over. A smaller chunk is a longer wait
  /// between presses; a larger one is more to reprint when the ribbon jams.
  readonly chunk: number
  /// How hard the head burns, 0-30.
  ///
  /// A fact about the ribbon and the stock in this machine, not about the job:
  /// two people printing to the same printer must get the same tag. It moves
  /// when a reel or a ribbon changes and at no other time.
  ///
  /// What is wanted is not the darkest setting but the MIDDLE of the band that
  /// scans. The head warms over a run and a ribbon thins with use, so a value
  /// that is only just good enough today fails at label two hundred. Too dark
  /// fails more often than too light: the bars spread until the white gaps
  /// between them close, and a barcode is the gaps as much as the bars.
  readonly darkness: number
  /// Inches per second, 2-6 on this class of machine.
  ///
  /// Faster means the head touches each dot for less time, so it prints
  /// lighter — raise this and the darkness usually has to follow. Below a few
  /// hundred labels it buys almost nothing: the difference across the whole
  /// range is seconds on a run of ten, while the cost in sharpness is paid on
  /// every one of them.
  ///
  /// The printer clamps silently to its own maximum. Asking for more than it
  /// has is accepted and ignored, and over a one-way USB queue there is no way
  /// to read back what it settled on — print a configuration label to see.
  readonly speedIps: number
  /// Which language the machine at this bench speaks.
  ///
  /// A Printronix and a Zebra take ZPL; a TSC takes TSPL unless somebody has
  /// switched it into emulation. Getting this wrong does not misprint a tag —
  /// it prints nothing at all, which on a bay looks exactly like a printer
  /// that is switched off, so it is offered here rather than buried in a
  /// node's environment where nobody at the bench can see it.
  readonly language: PrinterLanguage
}

/// 50 × 30 mm: the stock this warehouse runs, and what the node assumes when a
/// request leaves the size out. Not the same as the layout's baseline — the ZPL
/// was tuned by hand against 58 × 40 and every other size scales from it, so the
/// reel can change without the tag being redrawn.
const DEFAULT_PRINTER: Printer = {
  host: "127.0.0.1",
  port: 9100,
  widthMm: 50,
  heightMm: 30,
  // The node's own default, so a bench that has never said otherwise draws
  // and prints the same label.
  offsetMm: 6,
  chunk: 25,
  // Mid-scale, and deliberately not the printer's own stored value: there is
  // no way to read that back, so the app states what it wants rather than
  // inheriting something nobody at the bench can see.
  darkness: 18,
  // The slow end. Sharpness is worth more than seconds at this volume, and a
  // bench that wants the run faster can say so.
  speedIps: 4,
  // Every tag in the field so far was written in ZPL. A bench that has not
  // chosen must not be guessed into the other one.
  language: "ZPL",
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
  /// How far this stock's tag sits from the left edge of what the head sweeps.
  ///
  /// A property of the REEL, not of the layout — so it belongs to the preset
  /// rather than being retyped every time somebody changes stock. Omitted
  /// where the tag starts at the edge; a preset that declares it sets it when
  /// chosen, because picking the wrong inset prints the left column onto the
  /// liner and that is discovered a hundred tags later.
  readonly offsetMm?: number
}[] = [
  { widthMm: 50, heightMm: 30, note: "House stock" },
  { widthMm: 45, heightMm: 18, offsetMm: 2, note: "RFID type 2" },
  { widthMm: 58, heightMm: 40, note: "Tuned by hand" },
  { widthMm: 40, heightMm: 30 },
  { widthMm: 100, heightMm: 50, note: "Koli" },
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
