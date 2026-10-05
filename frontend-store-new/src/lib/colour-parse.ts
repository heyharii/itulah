/// A colour, read off what somebody typed — "biru tua", "dusty pink", "hijau
/// army", "navy", "#1B2A4A", "rgb(27 42 74)" — as the pixel value a swatch
/// needs and a name the master can hold.
///
/// `day-parse.ts`'s sibling: that one reads a day out of Indonesian and
/// English, this one reads a colour out of the same two. The vocabulary is a
/// table, not a grammar, because the words people use for a garment's colour
/// are a few hundred and a list of them can be checked by eye.
///
/// A phrase is a colour word with optional modifiers either side of it, in
/// either language's order: "dark blue" and "biru tua" are the same thing said
/// two ways. A modifier moves a colour in HSL — darker, lighter, paler, more
/// vivid, more muted — rather than being a table row of its own, so "hijau
/// muda", "light green" and "pale green" all exist without anybody writing
/// them. Where the plain word already stands for a particular shade ("biru
/// tua" is what this country calls navy; "dongker" is navy outright) the table
/// has it, and the table wins over the arithmetic.
///
/// A reading is a guess at a pixel value for a word, never a fact about the
/// garment. It is shown before it is taken, as `readDay` is.
export interface ColourReading {
  /// `#RRGGBB`, upper case — the master's own `hex_code` shape.
  readonly hex: string
  /// What to call it: the words as typed, tidied ("Biru Tua").
  readonly name: string
  /// A master code to offer ("BIRU_TUA"): upper case, letters, digits, `_`.
  readonly code: string
  /// Whether the phrase is a table entry as it stands, rather than a base
  /// colour moved by modifiers.
  readonly exact: boolean
}

// ── the vocabulary ──────────────────────────────────────────────────────────

/// One row: the pixel value, then every name it goes by. The first name is
/// the one to show. Hyphens and runs of spaces are folded before a lookup, so
/// "abu-abu" and "abu abu" are one entry.
type Row = readonly [hex: string, ...names: string[]]

const TABLE: readonly Row[] = [
  // Black, white and what lies between
  ["#1F2125", "black", "hitam", "noir", "jet black", "hitam pekat"],
  ["#3D4046", "charcoal", "arang", "abu arang", "anthracite", "antrasit"],
  ["#4A4F57", "gunmetal", "graphite", "grafit"],
  ["#6C7A89", "slate", "slate grey", "slate gray", "abu slate"],
  ["#848A91", "smoke", "smoke grey", "asap", "abu asap"],
  ["#8A8D90", "pewter"],
  ["#A9ADB3", "grey", "gray", "abu", "abu abu", "misty grey", "misty gray", "abu keabuan"],
  ["#B6B8BD", "heather", "heather grey", "melange", "grey melange", "abu melange", "marl"],
  ["#C0C3C8", "silver", "perak", "ash grey", "ash gray", "ash"],
  ["#B8B0A2", "stone", "batu", "stone grey"],
  ["#F4F3EF", "white", "putih", "snow", "putih bersih", "optic white", "pure white", "bright white"],
  ["#ECE9E0", "off white", "offwhite", "putih tulang", "putih gading", "ecru", "natural", "alami"],
  ["#F2EEDC", "ivory", "gading"],
  ["#EFE6D2", "cream", "krem", "kream", "krim", "creme"],
  ["#EDE6D6", "eggshell", "cangkang telur", "kulit telur"],
  ["#E3DCCB", "bone", "tulang"],
  ["#EFEDE8", "chalk", "kapur"],
  ["#EAE6DF", "pearl", "mutiara"],
  ["#F1ECE3", "milk", "susu", "putih susu", "milky"],
  ["#D9CFBD", "oatmeal", "oat", "gandum", "tepung"],
  ["#E8D9BD", "champagne", "sampanye", "sampagne"],
  ["#D8B8A0", "nude", "warna kulit", "skin tone"],
  ["#D6C3A1", "sand", "pasir", "sandy"],
  ["#D9C7A7", "beige", "bage", "bej", "krem tua"],
  ["#D8BE98", "biscuit", "biskuit"],
  ["#C3B091", "khaki", "kakhi", "warna kaki"],
  ["#A89A8A", "taupe", "taupe grey", "tope"],
  ["#B8A999", "mushroom", "jamur"],
  ["#C8B098", "latte", "latte beige"],
  ["#C19A6B", "camel", "unta", "kamel"],
  ["#D2B48C", "tan", "sawo muda"],

  // Brown, rust and clay
  ["#7B4A2D", "brown", "coklat", "cokelat", "chocolate brown", "coklat sedang"],
  ["#8A6B55", "mocha", "mocca", "moka", "mokka", "coklat susu"],
  ["#6F4E37", "coffee", "kopi", "coklat kopi", "espresso"],
  ["#4B2E22", "chocolate", "coklat tua", "cokelat tua", "dark brown", "coklat gelap", "dark chocolate", "dark choco"],
  ["#5A3E2B", "walnut", "kenari"],
  ["#8B4A2F", "chestnut", "kastanye"],
  ["#9A4F26", "cognac", "konyak", "tobacco", "tembakau"],
  ["#A54A28", "rust", "karat", "berkarat"],
  ["#B06A45", "copper", "tembaga"],
  ["#A8743F", "bronze", "perunggu"],
  ["#B85F3F", "terracotta", "terakota", "terra cotta", "tanah liat"],
  ["#9C3D2E", "brick", "bata", "merah bata", "brick red"],
  ["#B4745A", "clay", "lempung"],
  ["#A0522D", "sienna", "sepia", "siena"],
  ["#C8A27A", "caramel", "karamel", "toffee"],
  ["#9C6B3F", "hazelnut", "hazel", "kacang hazel"],
  ["#C7A27D", "fawn", "rusa"],
  ["#E4C9A0", "wheat", "gandum muda", "jerami muda"],

  // Reds
  ["#B3382F", "red", "merah", "merah tua"],
  ["#C8281E", "scarlet", "merah menyala", "merah terang", "bright red", "cherry red"],
  ["#A3152B", "crimson", "kirmizi", "merah darah", "blood red"],
  ["#B0182D", "cherry", "ceri", "cherry red"],
  ["#D4402F", "tomato", "tomat", "merah tomat"],
  ["#6E2330", "maroon", "marun", "marone", "merah marun", "merah hati", "dark red"],
  ["#6D1F2F", "burgundy", "burgundi", "bordeaux", "bordo"],
  ["#5E1F2C", "wine", "anggur", "merah anggur", "red wine", "port"],
  ["#4A1520", "oxblood", "ox blood"],
  ["#8D2A3D", "cranberry", "kranberi"],
  ["#A8264C", "raspberry", "rasberi", "frambos"],
  ["#9B1B3B", "ruby", "rubi", "delima"],
  ["#7C2A4D", "berry", "beri"],
  ["#C8566A", "rose", "mawar", "rosy", "rose pink"],
  ["#C4949D", "dusty rose", "mawar debu", "old rose", "mawar tua"],

  // Pinks
  ["#E9A7B8", "pink", "merah muda", "pink muda", "pink soft", "pink pastel"],
  ["#D8A7A7", "dusty pink", "pink debu", "pink kusam", "pink tua", "muted pink", "pink dusty"],
  ["#E8C4C0", "blush", "blush pink", "pink blush", "pink nude"],
  ["#F4C6D0", "baby pink", "pink bayi", "pink baby", "light pink", "pink pucat"],
  ["#E5338B", "hot pink", "pink terang", "pink menyala", "pink neon", "shocking pink", "pink stabilo"],
  ["#C2188C", "fuchsia", "fuksia", "fuchia", "fusia", "fushia"],
  ["#B5136F", "magenta", "magenta pink"],
  ["#E8998A", "salmon", "salem", "salmon pink", "pink salem"],
  ["#EC7063", "coral", "koral", "karang", "coral pink"],
  ["#F2B79A", "peach", "persik", "peach pink", "pink peach"],
  ["#F0B27A", "apricot", "aprikot", "abrikot"],
  ["#F08AA0", "flamingo", "pink flamingo"],
  ["#F5D5CF", "powder pink", "pink bedak", "bedak"],

  // Oranges and yellows
  ["#E07B2A", "orange", "oranye", "orange", "jingga", "orens", "oren"],
  ["#C4571F", "burnt orange", "oranye tua", "orange tua", "oranye gosong", "jingga tua", "orange gelap"],
  ["#F28C28", "tangerine", "tangerin", "jeruk", "oranye jeruk"],
  ["#D98B1D", "amber", "ambar"],
  ["#D9742A", "pumpkin", "labu", "oranye labu"],
  ["#E8C13A", "yellow", "kuning", "kuning cerah"],
  ["#C99A2E", "mustard", "mustar", "kuning mustard", "mustard yellow"],
  ["#D9A521", "turmeric", "kunyit", "kuning kunyit", "saffron", "kesumba"],
  ["#F0E04F", "lemon", "lemon yellow", "kuning lemon"],
  ["#F3E19A", "butter", "mentega", "kuning mentega", "butter yellow"],
  ["#C9A227", "gold", "emas", "keemasan", "golden"],
  ["#F0C01F", "sunflower", "bunga matahari", "kuning bunga matahari"],
  ["#D8A23F", "honey", "madu", "kuning madu"],
  ["#F2E24A", "canary", "kenari muda", "kuning terang"],
  ["#E0D28A", "straw", "jerami", "kuning jerami"],
  ["#F1E6B2", "banana", "pisang", "kuning pisang", "cream yellow", "kuning krem", "kuning muda"],

  // Greens
  ["#4F8A5B", "green", "hijau", "hijau sedang"],
  ["#9FB09A", "sage", "sage green", "hijau sage", "hijau pastel"],
  ["#6B6B3A", "olive", "olif", "zaitun", "hijau zaitun", "olive green", "hijau olif"],
  ["#5B6340", "army", "hijau army", "hijau tentara", "army green", "militer", "military green", "hijau militer", "hijau loreng"],
  ["#7A8450", "moss", "lumut", "hijau lumut", "moss green"],
  ["#2F5A3B", "forest", "forest green", "hijau hutan", "hutan", "hijau tua", "dark green", "hijau gelap"],
  ["#1F8A5B", "emerald", "zamrud", "hijau zamrud"],
  ["#1F4D3A", "bottle green", "hijau botol", "botol"],
  ["#A7C83A", "lime", "limau", "hijau lemon", "hijau stabilo", "lime green", "neon green"],
  ["#A9D6C1", "mint", "mint green", "hijau mint", "mentol", "hijau muda", "light green", "hijau pucat", "pale green"],
  ["#B7D19A", "pistachio", "pistachio green", "hijau pistachio", "pistasio"],
  ["#8A9A4C", "avocado", "alpukat", "hijau alpukat", "alpokat"],
  ["#2A4D3C", "pine", "pinus", "pine green", "hijau pinus"],
  ["#9ED2BD", "seafoam", "sea foam", "busa laut"],
  ["#3F9A7A", "jade", "giok", "hijau giok"],
  ["#4F7942", "fern", "pakis", "hijau pakis"],
  ["#A7B57A", "matcha", "hijau matcha", "teh hijau", "green tea"],

  // Teal and cyan
  ["#2F8A8A", "teal", "tosca", "toska", "hijau tosca", "hijau toska", "biru tosca"],
  ["#3FB8AF", "turquoise", "turkis", "turquoise blue", "biru turkis"],
  ["#6CC5C9", "aqua", "aquamarine", "akua", "aquamarin"],
  ["#28B5C8", "cyan", "sian", "biru sian", "biru muda terang"],
  ["#25566A", "petrol", "petrol blue", "biru petrol"],

  // Blues
  ["#3A6FB0", "blue", "biru", "biru sedang"],
  ["#8FB5D8", "sky", "sky blue", "biru langit", "langit", "biru muda", "light blue", "biru pucat", "pale blue"],
  ["#B5D3EE", "baby blue", "biru bayi", "biru baby", "pastel blue", "biru pastel"],
  ["#CFE3EF", "ice blue", "biru es", "ice", "icy blue", "frost", "frost blue"],
  ["#23324F", "navy", "navi", "navy blue", "biru navy", "biru dongker", "dongker", "biru tua", "dark blue", "biru gelap", "biru kehitaman", "dark navy", "dongker tua"],
  ["#1C2541", "midnight", "midnight blue", "biru malam", "biru tengah malam"],
  ["#2F55A4", "royal blue", "royal", "biru royal", "biru raja", "biru terang", "bright blue", "biru cerah"],
  ["#1F3D7A", "biru benhur", "benhur", "ben hur", "biru benhur"],
  ["#2A52BE", "cobalt", "kobalt", "cobalt blue", "biru kobalt"],
  ["#6F8FB3", "denim", "denim blue", "biru denim", "jeans", "biru jeans", "biru jins", "jins", "washed denim"],
  ["#3F4B7E", "indigo", "nila", "biru nila", "biru indigo"],
  ["#5F7F9F", "steel blue", "biru baja", "baja", "steel"],
  ["#6F8FD0", "cornflower", "cornflower blue", "biru jagung"],
  ["#2F6F9A", "ocean", "ocean blue", "biru laut", "laut", "sea blue", "marine"],
  ["#3F8FD2", "azure", "biru azure", "lazuardi", "biru lazuardi"],
  ["#1F6FFF", "electric blue", "biru elektrik", "biru listrik", "biru stabilo"],
  ["#8FA7BD", "dusty blue", "biru debu", "biru kusam", "muted blue", "powder blue", "biru bedak"],

  // Purples
  ["#7A4F9A", "purple", "ungu", "ungu sedang"],
  ["#C3A6D8", "lilac", "lila", "ungu muda", "light purple", "ungu pucat", "pale purple", "ungu pastel", "pastel purple"],
  ["#B9A7D6", "lavender", "lavendel", "lavender purple"],
  ["#7D4EC8", "violet", "viola", "ungu violet"],
  ["#6A3A5A", "plum", "prem", "plum purple", "ungu plum"],
  ["#B08BA2", "mauve", "mov", "mauve pink"],
  ["#5B3A74", "grape", "anggur ungu", "ungu anggur", "ungu tua", "dark purple", "ungu gelap"],
  ["#4B2D55", "eggplant", "terong", "ungu terong", "aubergine", "aubergin"],
  ["#B66FB8", "orchid", "anggrek", "ungu anggrek"],
  ["#8E6BB0", "amethyst", "kecubung", "ametis"],
  ["#B7A3C9", "taro", "talas", "ungu talas"],

  // Metals and finishes
  ["#B76E79", "rose gold", "rosegold", "emas mawar", "rose emas", "gold rose", "pink gold"],
  ["#D4AF37", "metallic gold", "gold metalik", "emas metalik", "gold metallic"],
  ["#B87333", "metallic copper", "tembaga metalik"],
]

/// Words that move a colour rather than name one, and how. Applied in HSL:
/// `l` pulls lightness toward 0 or 1 by that share, `s` multiplies saturation.
const MODIFIERS: Readonly<Record<string, { l: number; s: number }>> = {
  // darker
  tua: { l: -0.38, s: 1 },
  gelap: { l: -0.38, s: 1 },
  dark: { l: -0.38, s: 1 },
  deep: { l: -0.3, s: 1.05 },
  // lighter
  muda: { l: 0.42, s: 0.95 },
  light: { l: 0.42, s: 0.95 },
  terang: { l: 0.3, s: 1.05 },
  lembut: { l: 0.3, s: 0.8 },
  soft: { l: 0.3, s: 0.8 },
  // paler
  pastel: { l: 0.58, s: 0.7 },
  pale: { l: 0.55, s: 0.55 },
  pucat: { l: 0.55, s: 0.55 },
  // louder
  bright: { l: 0.08, s: 1.35 },
  cerah: { l: 0.08, s: 1.35 },
  menyala: { l: 0.05, s: 1.45 },
  neon: { l: 0.1, s: 1.5 },
  vivid: { l: 0.05, s: 1.4 },
  // quieter
  dusty: { l: 0.12, s: 0.5 },
  debu: { l: 0.12, s: 0.5 },
  muted: { l: 0.1, s: 0.55 },
  kusam: { l: 0.1, s: 0.55 },
}

/// "very dark", "sangat tua", "tua banget": said louder, read the same.
const INTENSIFIERS = new Set(["very", "super", "ultra", "sangat", "sekali", "banget", "amat"])

/// The plain hue words, which may stand in front of a particular shade
/// without changing it: "merah maroon" is maroon.
const FAMILIES = new Set([
  "merah", "biru", "hijau", "kuning", "ungu", "coklat", "cokelat", "abu", "pink",
  "oranye", "jingga", "red", "blue", "green", "yellow",
  "purple", "brown", "grey", "gray",
])

const LOOKUP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  for (const [hex, ...names] of TABLE)
    for (const name of names) if (!map.has(fold(name))) map.set(fold(name), hex)
  return map
})()

/// Every name the table knows, folded, longest first — for a caller that wants
/// to offer completions rather than read a phrase.
export const COLOUR_WORDS: readonly string[] = [...LOOKUP.keys()].sort(
  (a, b) => b.length - a.length || a.localeCompare(b)
)

// ── reading ─────────────────────────────────────────────────────────────────

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9# ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function title(words: string): string {
  return words.replace(/\b[a-z]/g, (one) => one.toUpperCase())
}

function codeOf(words: string): string {
  return words.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24)
}

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX6 = /^#?([0-9a-f]{6})$/i
const RGB = /^rgb\(?\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*\)?$/i

/// A written-out value: "#1B2A4A", "1b2a4a", "#abc", "rgb(27, 42, 74)".
function literal(text: string): string | null {
  const raw = text.trim()
  let m = HEX3.exec(raw)
  if (m !== null) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase()
  // A bare six-digit hex has to look like one: "facade" is a word.
  m = HEX6.exec(raw)
  if (m !== null && (raw.startsWith("#") || /\d/.test(m[1])))
    return `#${m[1]}`.toUpperCase()
  m = RGB.exec(raw)
  if (m !== null) {
    const channels = [m[1], m[2], m[3]].map(Number)
    if (channels.some((one) => one > 255)) return null
    return `#${channels.map((one) => one.toString(16).padStart(2, "0")).join("")}`.toUpperCase()
  }
  return null
}

function hslOf(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const high = Math.max(r, g, b)
  const low = Math.min(r, g, b)
  const l = (high + low) / 2
  const span = high - low
  if (span === 0) return [0, 0, l]
  const s = span / (1 - Math.abs(2 * l - 1))
  const h =
    high === r
      ? (60 * (((g - b) / span + 6) % 6)) % 360
      : high === g
        ? 60 * ((b - r) / span + 2)
        : 60 * ((r - g) / span + 4)
  return [h, s, l]
}

function hexOfHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return (
    "#" +
    [r, g, b]
      .map((one) => Math.round((one + m) * 255).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  )
}

function moved(hex: string, modifiers: readonly string[]): string {
  const [h, saturation, lightness] = hslOf(hex)
  let s = saturation
  let l = lightness
  for (const word of modifiers) {
    const one = MODIFIERS[word]
    s = Math.min(1, Math.max(0, s * one.s))
    l = Math.min(0.97, Math.max(0.05, one.l < 0 ? l * (1 + one.l) : l + (1 - l) * one.l))
  }
  return hexOfHsl(h, s, l)
}

/// A run of words as a colour, or null. The table first, whole; then a base
/// colour with modifiers on either side of it.
function phrase(words: readonly string[]): { hex: string; exact: boolean } | null {
  const said = words.filter((one) => !INTENSIFIERS.has(one))
  if (said.length === 0) return null
  const whole = LOOKUP.get(said.join(" "))
  if (whole !== undefined) return { hex: whole, exact: true }

  // "merah maroon", "biru navy", "coklat mocha": the family word first, then
  // the particular shade — the shade is the colour, the family is courtesy.
  if (said.length >= 2 && FAMILIES.has(said[0])) {
    const shade = LOOKUP.get(said.slice(1).join(" "))
    if (shade !== undefined) return { hex: shade, exact: true }
  }

  let from = 0
  while (from < said.length && MODIFIERS[said[from]] !== undefined) from++
  let to = said.length
  while (to > from && MODIFIERS[said[to - 1]] !== undefined) to--
  if (from === 0 && to === said.length) return null
  const base = LOOKUP.get(said.slice(from, to).join(" "))
  if (base === undefined) return null
  return { hex: moved(base, [...said.slice(0, from), ...said.slice(to)]), exact: false }
}

function reading(words: readonly string[], found: { hex: string; exact: boolean }): ColourReading {
  const name = title(words.filter((one) => !INTENSIFIERS.has(one)).join(" "))
  return { hex: found.hex, name, code: codeOf(name), exact: found.exact }
}

/// One colour, as the whole of what was typed. Null when any of it is not a
/// colour word — "navy shirt" is not a colour, "navy" is.
export function readColour(text: string): ColourReading | null {
  const raw = literal(text)
  if (raw !== null) return { hex: raw, name: raw, code: "", exact: true }
  const words = fold(text).split(" ").filter(Boolean)
  const found = phrase(words)
  return found === null ? null : reading(words, found)
}

/// Several colours in one string — "hitam, putih, navy", "black & white",
/// "merah/biru", "navy + khaki", or just "hitam putih". Each part must be a
/// colour or the whole part is dropped, so a stray word never becomes one.
export function readColours(text: string): ColourReading[] {
  const out: ColourReading[] = []
  for (const part of text.split(/\s*(?:,|;|\+|&|\/|\bdan\b|\band\b|\bdengan\b|\bwith\b)\s*/i)) {
    if (part.trim() === "") continue
    const single = readColour(part)
    if (single !== null) {
      out.push(single)
      continue
    }
    // "hitam putih": no such colour, so two. Take the longest colour phrase
    // from the front, then go on from there.
    const words = fold(part).split(" ").filter(Boolean)
    const parts: ColourReading[] = []
    for (let at = 0; at < words.length; ) {
      let took = 0
      for (let end = Math.min(words.length, at + 4); end > at && took === 0; end--) {
        const found = phrase(words.slice(at, end))
        if (found !== null) {
          parts.push(reading(words.slice(at, end), found))
          took = end - at
        }
      }
      if (took === 0) {
        parts.length = 0
        break
      }
      at += took
    }
    out.push(...parts)
  }
  return out
}

/// The first colour named anywhere in a longer text — "Kemeja Flanel Navy",
/// "Dusty Pink Dress", "Cora T-shirt black". Leftmost wins, and at one place
/// the longer phrase does, so "dusty pink" is not read as "pink".
export function findColour(text: string): ColourReading | null {
  const words = fold(text).split(" ").filter(Boolean)
  for (let at = 0; at < words.length; at++)
    for (let end = Math.min(words.length, at + 4); end > at; end--) {
      const found = phrase(words.slice(at, end))
      if (found !== null) return reading(words.slice(at, end), found)
    }
  return null
}
