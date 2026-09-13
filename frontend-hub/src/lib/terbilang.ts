/// Rupiah, in words.
///
/// # Why an engine needs this at all
///
/// Because a bilyet giro and a kas voucher are not valid without it. The
/// figure can be altered with a pen; the words cannot, which is the whole
/// reason both appear on the instrument. An Indonesian bank will reject a giro
/// whose `terbilang` line disagrees with the figure, so this is not decoration
/// — it is part of the document.
///
/// # Why it is written out rather than pulled in
///
/// The rules are small and fixed: units, `belas` for eleven to nineteen,
/// `puluh`, `seratus` and `seribu` for the singular hundred and thousand, then
/// juta, miliar, triliun. A dependency for forty lines that never change is a
/// dependency to keep updated for no reason.

/// Rupiah in the smallest unit, the way every amount crosses this system's
/// wire. Declared here rather than imported from the finance lab's engine: this
/// file moved into `lib/` when a production screen needed it, and a shared
/// helper reaching back into a prototype for a type alias is how the prototype
/// becomes load-bearing.
type Minor = number

const UNITS = [
  "",
  "satu",
  "dua",
  "tiga",
  "empat",
  "lima",
  "enam",
  "tujuh",
  "delapan",
  "sembilan",
  "sepuluh",
  "sebelas",
]

/// The recursive core, on whole rupiah.
///
/// `seratus` and `seribu` rather than `satu ratus` and `satu seribu`: the
/// singular is a real rule of the language, not a nicety, and a voucher that
/// says "satu ratus ribu" reads as machine output to the person signing it.
function words(n: number): string {
  if (n < 12) return UNITS[n]
  if (n < 20) return `${words(n - 10)} belas`
  if (n < 100)
    return `${words(Math.floor(n / 10))} puluh ${words(n % 10)}`.trim()
  if (n < 200) return `seratus ${words(n - 100)}`.trim()
  if (n < 1_000)
    return `${words(Math.floor(n / 100))} ratus ${words(n % 100)}`.trim()
  if (n < 2_000) return `seribu ${words(n - 1_000)}`.trim()
  if (n < 1_000_000)
    return `${words(Math.floor(n / 1_000))} ribu ${words(n % 1_000)}`.trim()
  if (n < 1_000_000_000)
    return `${words(Math.floor(n / 1_000_000))} juta ${words(n % 1_000_000)}`.trim()
  if (n < 1_000_000_000_000)
    return `${words(Math.floor(n / 1_000_000_000))} miliar ${words(n % 1_000_000_000)}`.trim()
  return `${words(Math.floor(n / 1_000_000_000_000))} triliun ${words(n % 1_000_000_000_000)}`.trim()
}

/// `terbilang(12_345_600)` → "Seratus dua puluh tiga ribu empat ratus lima
/// puluh enam rupiah".
///
/// Takes minor units like everything else in this engine, and states the sen
/// only when there are any — a voucher for a round amount should not carry
/// "nol sen".
export function terbilang(minor: Minor): string {
  const negative = minor < 0
  const abs = Math.abs(minor)
  const rupiah = Math.floor(abs / 100)
  const sen = abs % 100

  const parts: string[] = []
  parts.push(rupiah === 0 ? "nol rupiah" : `${words(rupiah)} rupiah`)
  if (sen > 0) parts.push(`${words(sen)} sen`)

  const said = parts.join(" ").replace(/\s+/g, " ").trim()
  const cased = said.charAt(0).toUpperCase() + said.slice(1)
  return negative ? `Minus ${cased.toLowerCase()}` : cased
}
