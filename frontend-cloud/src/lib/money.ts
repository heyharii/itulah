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
