import { count } from "@/lib/format"

/// "1 SKU", "12 SKUs": the number and its noun, agreeing. One place, so every
/// board says a quantity the same way.
export function many(n: number, noun: string, plural = `${noun}s`): string {
  return `${count(n)} ${n === 1 ? noun : plural}`
}

/// Just the noun, for a figure that is printed on its own: "line", "lines".
export function word(n: number, noun: string, plural = `${noun}s`): string {
  return n === 1 ? noun : plural
}

/// A code without its leading zeros: 00000004104 reads 4104, KOLI-0012 stays
/// as it is (owner, 18 Oct 2026, "ga usah ada 0000 nya").
export const bare = (code: string) => code.replace(/^0+(?=\d)/, "")
