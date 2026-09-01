/// Money as the server sends it: an integer count of the smallest unit.
///
/// Never a float. A rupiah price is `unit_price_minor: 149000`, not `1490.00`
/// — the till, the label and this screen all have to agree on the number to
/// the last unit, and a receipt that rounds differently from the one printed
/// at the counter is the kind of disagreement nobody can settle afterwards.
///
/// Kept in step with `frontend-cloud/src/lib/money.ts`. Two copies of one
/// formatter is one copy too many, but the shared package holds wire types and
/// transport, not presentation, and moving this there is a decision for
/// whoever needs it in a third surface.
const ZERO_DECIMAL = new Set(["IDR", "JPY", "KRW", "VND"])

function minorPerMajor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100
}

/// A price for a person to read.
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

/// A price shortened to a headline.
///
/// For the KPI tiles only. A lifetime spend written in full is eleven glyphs
/// ("Rp 3.085.000"); at the 23px a KPI value is set in, two of those side by
/// side on a 375px screen wrap mid-number, and a price broken across two lines
/// is a price nobody can read at a glance. The exact figure is never far — it
/// is the sum of the receipts on the next screen — and every tile carries it
/// in full for a screen reader.
export function moneyShort(minor: number, currency = "IDR"): string {
  const code = currency.toUpperCase()
  const divisor = minorPerMajor(code)
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: code,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(minor / divisor)
  } catch {
    return money(minor, currency)
  }
}
