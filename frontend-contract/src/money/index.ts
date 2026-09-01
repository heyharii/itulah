/// Money, formatted the same way wherever it is shown.
///
/// Shared rather than copied for a reason this repository has already paid
/// for: it once ran two tills that priced the same garment differently, and
/// the label on the shirt disagreed with the receipt. Formatting is not
/// pricing, but "IDR has no minor unit" is a fact about the currency, not
/// about a screen — a shop rounding it one way and the centre another would
/// put two different totals on one day's trade.

/// Money as the server sends it: an integer count of the smallest unit.
///
/// Never a float. A rupiah price is `unit_price_minor: 149000`, not `1490.00`
/// — the backend's own comment on `SupplierItem.unit_price_minor` says so, and
/// the till, the label and the purchase order all have to agree on the number
/// to the last unit.
const ZERO_DECIMAL = new Set(["IDR", "JPY", "KRW", "VND"])

/// How many minor units make one major unit of this currency.
function minorPerMajor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100
}

/// A price for a person to read.
///
/// `Intl` is asked for the currency's own conventions rather than the browser's
/// locale defaults, so IDR prints without the two decimal places it does not
/// have and USD keeps them.
export function money(minor: number, currency = "IDR"): string {
  const code = currency.toUpperCase()
  const divisor = minorPerMajor(code)
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: code,
      minimumFractionDigits: divisor === 1 ? 0 : 2,
      maximumFractionDigits: divisor === 1 ? 0 : 2,
    }).format(minor / divisor)
  } catch {
    // An unknown currency code is data, not a crash: show the number and the
    // code the server actually sent.
    return `${code} ${(minor / divisor).toLocaleString("id-ID")}`
  }
}

/// A count of things, grouped for reading.
export function units(value: number): string {
  return value.toLocaleString("id-ID")
}

/// A supplier quote typed into a form, back to the integer the server wants.
///
/// Returns `null` for anything that is not a plain positive amount, so a caller
/// can refuse the line rather than sending `NaN` and having the server say
/// something less useful about it.
export function parseMoneyToMinor(text: string, currency = "IDR"): number | null {
  const cleaned = text.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")
  if (cleaned.trim() === "") return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * minorPerMajor(currency.toUpperCase()))
}

/// A price with the digits a chart axis has room for.
///
/// `Intl`'s compact notation in `id-ID` gives "12 jt", not "12M" — the reader
/// of this screen is in Jakarta and rb/jt/M is the shorthand they already use.
/// Only for axes and totals: a receipt shows every digit.
export function compactMoney(minor: number, currency = "IDR"): string {
  const code = currency.toUpperCase()
  const divisor = ZERO_DECIMAL.has(code) ? 1 : 100
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: code,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(minor / divisor)
  } catch {
    return `${code} ${(minor / divisor).toLocaleString("id-ID")}`
  }
}
