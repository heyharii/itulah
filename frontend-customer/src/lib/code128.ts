/// Code 128, subset B — the barcode on the back of the member card.
///
/// Why this symbology: every handheld and counter scanner a shop in this
/// estate owns reads Code 128, including the cheapest 1D ones that cannot read
/// a QR code, and subset B covers every character a member number can hold
/// (printable ASCII). The scanner types what it reads followed by Enter, so to
/// the till a scanned card is exactly a cashier typing the number.
///
/// Written here rather than taken from a package because it is a table and a
/// checksum: 107 patterns and one modulo, with nothing to configure.

/// Bar/space widths in modules for symbol values 0–106, starting with a bar.
/// Every symbol is 11 modules wide; STOP (106) is 13.
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
] as const

const START_B = 104
const STOP = 106

/// One bar, as a start position and a width, both in modules.
export interface Bar {
  readonly x: number
  readonly width: number
}

export interface Code128 {
  readonly bars: readonly Bar[]
  /// Total width in modules, excluding the quiet zones either side.
  readonly modules: number
}

/// Encode `text`, or `null` when it holds a character subset B cannot carry.
export function encode128(text: string): Code128 | null {
  const values: number[] = [START_B]
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code < 32 || code > 126) return null
    values.push(code - 32)
  }
  // Weighted sum: the start symbol counts once, each data symbol by its
  // position. Without it a misread bar decodes as a different, valid number.
  let sum = values[0]
  for (let index = 1; index < values.length; index += 1) {
    sum += values[index] * index
  }
  values.push(sum % 103, STOP)

  const bars: Bar[] = []
  let x = 0
  for (const value of values) {
    const pattern = PATTERNS[value]
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index])
      if (index % 2 === 0) bars.push({ x, width })
      x += width
    }
  }
  return { bars, modules: x }
}
