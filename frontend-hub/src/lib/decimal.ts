/// Exact decimal arithmetic for quantities, without floats.
///
/// 9.5 KODI at 20 pieces each is 190 pieces — and in floating point
/// `9.5 * 20` happens to be exact, but `0.1 * 3` is not, and a count that
/// comes out as 189.99999 pieces is a count the node refuses. Quantities and
/// factors are carried as decimal strings (the server's `numeric`), so they
/// are multiplied here as scaled integers.

/// A decimal string as an integer and a power of ten, or null when it is not
/// a plain non-negative decimal. A comma is read as the decimal point.
function scaled(text: string): { value: bigint; scale: number } | null {
  const clean = text.trim().replace(",", ".")
  if (!/^\d+(\.\d+)?$/.test(clean)) return null
  const [whole, fraction = ""] = clean.split(".")
  return { value: BigInt(whole + fraction), scale: fraction.length }
}

/// `quantity × factor` as a whole number, or null when either is not a
/// number or the product is not whole.
export function wholeProduct(quantity: string, factor: string): number | null {
  const a = scaled(quantity)
  const b = scaled(factor)
  if (a === null || b === null) return null
  const product = a.value * b.value
  const divisor = 10n ** BigInt(a.scale + b.scale)
  if (product % divisor !== 0n) return null
  return Number(product / divisor)
}

/// Whether a string reads as a positive decimal.
export function isPositiveDecimal(text: string): boolean {
  const parsed = scaled(text)
  return parsed !== null && parsed.value > 0n
}
