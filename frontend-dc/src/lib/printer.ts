/// Which label printer is in front of this person.
///
/// Kept on the device rather than on the server because it is a fact about the
/// bench somebody is standing at, and it changes when they walk to another
/// one. Shared between the tagging screen and the box labels so that a
/// warehouse does not have to be told twice where its printer is.
const STORAGE_KEY = "dc.printer"

export interface Printer {
  host: string
  port: number
  widthMm: number
  heightMm: number
  chunk: number
}

export const DEFAULT_PRINTER: Printer = {
  host: "127.0.0.1",
  port: 9100,
  widthMm: 50,
  heightMm: 30,
  chunk: 25,
}

export function loadPrinter(): Printer {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null
      ? DEFAULT_PRINTER
      : { ...DEFAULT_PRINTER, ...(JSON.parse(stored) as Partial<Printer>) }
  } catch {
    // A device that refuses storage still prints. Losing the host between
    // shifts is a nuisance, not a failure worth reporting.
    return DEFAULT_PRINTER
  }
}

export function savePrinter(printer: Printer): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(printer))
  } catch {
    // As above.
  }
}
