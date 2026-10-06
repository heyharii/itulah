import { useId } from "react"

import { findColour } from "@/lib/colour-parse"

/// A drawn garment, for the product that has no photograph yet.
///
/// A silhouette chosen from the name and filled with the colourway's colour —
/// the colour master's hex, handed in as `colours` — or, before a colourway
/// is chosen, the colour the name asks for. When the name says nothing the
/// silhouette's kind comes from the division instead — a woman's article is a
/// blouse, a shoe division's is a shoe — and an article with neither gets a
/// coat hanger. It is a placeholder and reads as one: no stitching, no model,
/// so nobody mistakes it for the product's picture.
///
/// The catalogue is H&M-style English with Indonesian ones mixed in ("Skinny
/// Ankle Denim", "Cora T-shirt", "Kemeja Flanel"), and the kind can be any
/// word of the name, not the first, so the rules look for a whole word
/// anywhere. They run in order and the first match wins, which is why a
/// "shirt dress" is above "shirt" and a "padded jacket" above "pants".
///
/// The colour is `findColour()` from `lib/colour-parse.ts`, the same reader
/// the colour master's hex box uses, so a name draws the colour it would
/// be given there.
///
/// This file and `colour-parse.ts` exist twice, here and in
/// frontend-store-new/src/lib/: the two apps are separate packages. Change
/// both.
const SHAPES = {
  // Tops
  tee: "M31 14 L41 10 Q50 18 59 10 L69 14 L88 29 L80 41 L72 36 L72 90 L28 90 L28 36 L20 41 L12 29 Z",
  longsleeve:
    "M31 12 L41 9 Q50 18 59 9 L69 12 L88 28 L94 80 L84 82 L76 44 L72 46 L72 92 L28 92 L28 46 L24 44 L16 82 L6 80 L12 28 Z",
  polo: "M31 14 L40 10 L46 12 L50 24 L54 12 L60 10 L69 14 L88 29 L80 41 L72 36 L72 90 L28 90 L28 36 L20 41 L12 29 Z",
  tank: "M35 8 L43 8 Q50 26 57 8 L65 8 Q66 28 74 38 L72 92 L28 92 L26 38 Q34 28 35 8 Z",
  shirt:
    "M33 12 L42 9 L50 15 L58 9 L67 12 L84 24 L91 72 L81 74 L74 38 L74 92 L26 92 L26 38 L19 74 L9 72 L16 24 Z",
  blouse:
    "M34 11 L43 9 Q50 17 57 9 L66 11 L80 24 L88 50 L77 52 L72 36 L76 90 Q50 96 24 90 L28 36 L23 52 L12 50 L20 24 Z",
  koko: "M35 8 L50 10 L65 8 L82 20 L90 70 L80 72 L74 36 L74 86 L26 86 L26 36 L20 72 L10 70 L18 20 Z",
  sweater:
    "M32 14 L42 11 Q50 18 58 11 L68 14 L84 26 L91 78 L81 79 L74 40 L74 92 L26 92 L26 40 L19 79 L9 78 L16 26 Z",
  hoodie:
    "M37 17 Q50 1 63 17 L72 19 L86 31 L91 76 L81 78 L74 42 L74 92 L26 92 L26 42 L19 78 L9 76 L14 31 L28 19 Z",
  // Layers
  cardigan:
    "M33 12 L44 9 L48 20 L48 92 L26 92 L26 40 L19 78 L9 76 L15 26 Z M67 12 L56 9 L52 20 L52 92 L74 92 L74 40 L81 78 L91 76 L85 26 Z",
  jacket:
    "M30 12 L40 7 L46 6 L49 10 L49 92 L25 92 L25 42 L18 80 L8 78 L13 24 Z M70 12 L60 7 L54 6 L51 10 L51 92 L75 92 L75 42 L82 80 L92 78 L87 24 Z",
  blazer:
    "M32 11 L42 7 L49 30 L49 82 L25 82 L25 44 L19 78 L9 76 L14 24 Z M68 11 L58 7 L51 30 L51 82 L75 82 L75 44 L81 78 L91 76 L86 24 Z",
  coat: "M31 11 L41 7 L48 20 L49 96 L22 96 L26 40 L18 82 L8 80 L13 24 Z M69 11 L59 7 L52 20 L51 96 L78 96 L74 40 L82 82 L92 80 L87 24 Z",
  vest: "M32 9 L43 8 L48 22 L48 90 L22 90 L23 42 Q33 32 32 9 Z M68 9 L57 8 L52 22 L52 90 L78 90 L77 42 Q67 32 68 9 Z",
  robe: "M34 10 L44 8 L50 36 L56 8 L66 10 L84 24 L90 78 L80 80 L74 40 L74 94 L26 94 L26 40 L20 80 L10 78 L16 24 Z",
  // Dresses and skirts
  dress:
    "M39 8 L44 8 Q50 16 56 8 L61 8 L64 32 L58 36 L81 93 L19 93 L42 36 L36 32 Z",
  maxi: "M38 8 L44 8 Q50 20 56 8 L62 8 L65 34 L58 44 L80 95 L20 95 L42 44 L35 34 Z",
  gamis:
    "M38 9 Q50 14 62 9 L78 20 L88 60 L78 64 L72 38 L82 94 L18 94 L28 38 L22 64 L12 60 L22 20 Z",
  mukena:
    "M50 5 Q68 5 70 24 L70 34 L90 80 L84 94 L16 94 L10 80 L30 34 L30 24 Q32 5 50 5 Z M40 18 Q50 12 60 18 L60 30 Q50 36 40 30 Z",
  hijab:
    "M50 6 Q74 6 76 30 Q78 52 90 92 L10 92 Q22 52 24 30 Q26 6 50 6 Z M38 22 Q50 16 62 22 L62 40 Q50 48 38 40 Z",
  skirt: "M33 16 L67 16 L84 86 L16 86 Z",
  longskirt: "M32 12 L68 12 L78 92 L22 92 Z",
  // Bottoms
  pants: "M29 8 L71 8 L76 93 L58 93 L50 34 L42 93 L24 93 Z",
  wide: "M30 8 L70 8 L84 93 L54 93 L50 36 L46 93 L16 93 Z",
  leggings: "M33 8 L67 8 L64 93 L53 93 L50 30 L47 93 L36 93 Z",
  shorts: "M26 22 L74 22 L81 68 L56 72 L50 46 L44 72 L19 68 Z",
  jumpsuit:
    "M36 6 L42 6 L44 14 L56 14 L58 6 L64 6 L66 30 L70 38 L76 93 L58 93 L50 56 L42 93 L24 93 L30 38 L34 30 Z",
  // Underwear, nightwear, baby
  onesie:
    "M33 10 L42 8 Q50 16 58 8 L67 10 L86 24 L78 36 L70 32 L70 62 L62 82 Q50 92 38 82 L30 62 L30 32 L22 36 L14 24 Z",
  bib: "M30 4 L38 4 L38 14 Q50 20 62 14 L62 4 L70 4 L70 18 Q86 30 84 60 Q82 90 50 94 Q18 90 16 60 Q14 30 30 18 Z",
  bra: "M20 40 Q36 38 48 52 Q44 70 30 70 Q18 66 20 40 Z M80 40 Q64 38 52 52 Q56 70 70 70 Q82 66 80 40 Z M27 12 L32 12 L34 40 L28 42 Z M73 12 L68 12 L66 40 L72 42 Z",
  brief: "M14 26 L86 26 L72 60 Q62 60 56 78 L44 78 Q38 60 28 60 Z",
  swimsuit:
    "M34 8 L42 8 L50 28 L58 8 L66 8 L70 36 L64 52 L74 76 Q60 80 56 92 L44 92 Q40 80 26 76 L36 52 L30 36 Z",
  pyjama:
    "M30 6 L40 4 Q50 10 60 4 L70 6 L84 16 L90 40 L82 42 L72 24 L72 46 L28 46 L28 24 L18 42 L10 40 L16 16 Z M30 52 L70 52 L74 95 L56 95 L50 66 L44 95 L26 95 Z",
  sock: "M40 8 L60 8 L60 60 L79 72 Q86 85 72 89 L46 81 Q37 77 40 66 Z",
  // Headwear
  cap: "M24 60 Q23 28 50 26 Q77 28 76 60 Z M24 60 L93 62 Q92 70 72 68 L24 66 Z",
  beanie: "M20 70 Q18 22 50 20 Q82 22 80 70 Z M18 70 L82 70 L82 82 L18 82 Z",
  hat: "M30 56 Q30 22 50 22 Q70 22 70 56 Z M8 58 Q50 50 92 58 Q92 70 50 70 Q8 70 8 58 Z",
  peci: "M20 74 L27 32 Q50 24 73 32 L80 74 Z",
  hairband: "M10 60 Q50 -10 90 60 L82 66 Q50 8 18 66 Z",
  // Accessories
  sunglasses:
    "M8 38 L44 38 Q46 62 28 64 Q10 62 8 38 Z M56 38 L92 38 Q90 62 72 64 Q54 62 56 38 Z M44 42 Q50 38 56 42 L56 46 Q50 42 44 46 Z",
  belt: "M6 44 L94 44 L94 56 L6 56 Z",
  scarf: "M30 8 L52 8 L55 58 L72 92 L53 95 L42 66 L36 93 L17 90 L31 58 Z",
  glove:
    "M30 92 L28 54 L20 40 Q22 34 28 40 L32 46 L32 18 Q36 12 40 18 L42 40 L44 10 Q48 4 52 10 L52 40 L56 14 Q60 8 64 14 L62 42 L68 24 Q74 20 76 26 L72 56 L70 92 Z",
  tie: "M42 6 L58 6 L54 22 L62 82 L50 94 L38 82 L46 22 Z",
  bowtie:
    "M10 30 L46 46 L10 70 Z M90 30 L54 46 L90 70 Z M44 40 L56 40 L56 56 L44 56 Z",
  watch:
    "M38 4 L62 4 L60 28 L40 28 Z M38 96 L62 96 L60 72 L40 72 Z M26 30 L74 30 L74 70 L26 70 Z",
  bangle:
    "M12 50 A38 38 0 1 0 88 50 A38 38 0 1 0 12 50 Z M26 50 A24 24 0 1 0 74 50 A24 24 0 1 0 26 50 Z",
  necklace:
    "M16 14 Q50 100 84 14 L78 14 Q50 80 22 14 Z M50 58 L57 66 L50 76 L43 66 Z",
  earring:
    "M43 12 A7 7 0 1 0 57 12 A7 7 0 1 0 43 12 Z M48 18 L52 18 L52 28 L48 28 Z M50 26 Q66 46 62 66 Q58 90 50 92 Q42 90 38 66 Q34 46 50 26 Z",
  umbrella:
    "M8 50 Q10 12 50 10 Q90 12 92 50 Q82 42 71 50 Q60 42 50 50 Q40 42 29 50 Q18 42 8 50 Z M48 50 L52 50 L52 84 Q52 94 42 94 Q36 94 36 88 L40 88 Q40 90 43 90 Q48 90 48 84 Z",
  mask: "M8 40 Q28 28 50 38 Q72 28 92 40 Q92 68 72 70 Q58 70 50 60 Q42 70 28 70 Q8 68 8 40 Z",
  bottle: "M42 6 L58 6 L58 16 L64 24 L64 94 L36 94 L36 24 L42 16 Z",
  // Bags
  bag: "M22 40 L78 40 L74 91 L26 91 Z M36 40 Q36 14 50 14 Q64 14 64 40 L60 40 Q60 19 50 19 Q40 19 40 40 Z",
  tote: "M26 34 L74 34 L78 94 L22 94 Z M36 34 Q36 10 42 10 L58 10 Q64 10 64 34 L59 34 Q59 16 56 16 L44 16 Q41 16 41 34 Z",
  backpack: "M30 22 Q30 8 50 8 Q70 8 70 22 L78 30 L78 92 L22 92 L22 30 Z",
  wallet: "M16 30 L84 30 L84 74 L16 74 Z",
  // Shoes
  shoe: "M7 63 Q9 45 23 43 L39 38 Q51 51 66 51 L86 56 Q95 60 93 73 L7 73 Z",
  boot: "M28 8 L54 8 L56 54 L84 62 Q94 66 94 78 L94 88 L22 88 L22 74 L28 56 Z",
  heel: "M12 30 L26 30 Q28 48 44 56 L86 70 Q96 74 94 82 L90 86 L52 76 L32 72 L22 94 L14 94 L22 66 Q10 52 12 30 Z",
  sandal:
    "M10 76 Q8 66 22 64 L84 66 Q94 68 92 76 Q90 82 80 82 L20 82 Q12 82 10 76 Z M32 64 L40 64 L62 44 L54 44 Z M68 64 L60 64 L44 44 L52 44 Z",
  // Nothing to go on
  accessory: "M26 14 L74 14 L92 38 L50 90 L8 38 Z",
  hanger:
    "M44 36 L44 26 Q44 20 52 18 Q58 16 58 11 Q58 7 52 7 Q46 7 46 12 L41 12 Q41 2 52 2 Q64 2 64 11 Q64 20 55 23 L55 36 L94 66 Q99 74 91 78 L9 78 Q1 74 6 66 Z",
} as const

type Kind = keyof typeof SHAPES

/// These two draw a hole (a face, a ring) and need the even-odd rule.
const HOLLOW: ReadonlySet<Kind> = new Set<Kind>(["mukena", "hijab", "bangle"])

/// A whole word, anywhere in the name. `\b` stops "tee" matching "teepee" and
/// "top" matching "stop"; the alternatives carry their own plurals.
const word = (alternatives: string) =>
  new RegExp(`\\b(?:${alternatives})\\b`, "i")

const KINDS: readonly (readonly [RegExp, Kind])[] = [
  // Muslim wear: before the plain dress / shirt / scarf it would otherwise be.
  [word("mukena|telekung"), "mukena"],
  [word("hijab|jilbab|kerudung|pashmina|pasmina|khimar|bergo|voal"), "hijab"],
  [word("gamis|abaya|jubah|kaftan|caftan|dress panjang|long dress"), "gamis"],
  [word("koko|baju koko"), "koko"],
  [word("peci|songkok|kopiah"), "peci"],
  [word("sarung|sarong"), "longskirt"],
  // Socks before shoes: "Trainer 3p sock" is a sock.
  [
    word(
      "socks?|kaos kaki|stockings?|overknee|knee[- ]?high|(?:mini)?shaftless|footies"
    ),
    "sock",
  ],
  // Footwear
  [word("heels?|pumps?|stiletto|wedges?|high heel"), "heel"],
  [word("boots?|bot|booties"), "boot"],
  [word("sneakers?|trainers?|kets"), "shoe"],
  [
    word(
      "sandals?|espadrilles?|slides?|flip[- ]?flops?|slippers?|sendal|selop"
    ),
    "sandal",
  ],
  // No bare "oxford": "Kemeja Oxford" is the cloth, a shirt. Oxford shoes
  // still say "shoes".
  [
    word("shoes?|sepatu|loafers?|derby|brogues?|flatshoe|pantofel|slip[- ]?on"),
    "shoe",
  ],
  // Bags
  [word("backpack|ransel|rucksack"), "backpack"],
  [word("shopper|tote|weekend"), "tote"],
  [
    word("wallet|dompet|clutch|pouch|purse|cosmetic bag|cases?|sunglasscase"),
    "wallet",
  ],
  [word("sleep(ing)? bag"), "onesie"],
  [word("bags?|tas|handbag|sling|satchel|crossbody|cross bag"), "bag"],
  // Small accessories
  [
    word("sunglasses|kacamata|glasses|aviator|wrap around|shades"),
    "sunglasses",
  ],
  [word("beanie|kupluk|balaclava"), "beanie"],
  [word("caps?|topi|snapback"), "cap"],
  [word("hats?|fedora|panama|bucket|sunhat"), "hat"],
  [word("belt|ikat pinggang|sabuk|braces|suspenders?"), "belt"],
  [
    word("scarf|scarves|syal|muffler|shawl|selendang|gaiter|gaitor|snood|tube"),
    "scarf",
  ],
  [word("gloves?|sarung tangan|mittens?"), "glove"],
  [word("bow ?tie|bowtie|dasi kupu"), "bowtie"],
  [word("tie(?![- ]?dye)|dasi|necktie"), "tie"],
  [word("watch|jam tangan"), "watch"],
  [word("bracelets?|bangles?|gelang"), "bangle"],
  [word("necklace|kalung|pendant|choker"), "necklace"],
  [word("earrings?|anting|hoops?|studs?|studpk|studs?pk"), "earring"],
  [
    word(
      "hair ?bands?|headbands?|alice ?band|bando|claw|clips?|scrunchie|jepit|hair ring|hair"
    ),
    "hairband",
  ],
  [word("umbrella|payung"), "umbrella"],
  [word("masks?|masker"), "mask"],
  [word("water ?bottle|bottle|tumbler|botol"), "bottle"],
  // Nightwear, swim, underwear
  [word("swim ?suit|bikini|swimwear|baju renang|renang|swim"), "swimsuit"],
  [
    word(
      "pyjamas?|pajamas?|pj|piyama|sleepwear|nightwear|long[- ]?john|lounge ?set|nightshirts?|nightdress|nightgown|nightie"
    ),
    "pyjama",
  ],
  [word("robe|bathrobe|kimono|dressing gown"), "robe"],
  [word("bib|slabber|celemek bayi"), "bib"],
  [word("bra|bras|bralette|softbra|kutang|push[- ]?up bra|bandeau"), "bra"],
  [
    word(
      "briefs?|brazilian|hipsters?|thongs?|panty|panties|cheeky|boxers?|trunks?|celana dalam"
    ),
    "brief",
  ],
  [
    word(
      "tights?|tghts|microtights?|pantyhose|leggings?|jeggings?|treggings?|legging|\\d+ ?den"
    ),
    "leggings",
  ],
  [word("push|triangle"), "bra"],
  [word("string|h-string|tanga"), "brief"],
  // One-piece
  [word("body|bodies|bodysuit|romper|onesie|sleepsuit|babysuit"), "onesie"],
  [word("jumpsuit|overalls?|dungarees?|playsuit|coveralls?|kodok"), "jumpsuit"],
  // Dresses and skirts
  [word("maxi ?dress|maxi"), "maxi"],
  [
    word("shirt ?dress|dress|gaun|terusan|daster|pinafore|jumper dress"),
    "dress",
  ],
  [word("long skirt|maxi skirt|rok panjang"), "longskirt"],
  [word("skirt|skort|rok"), "skirt"],
  // Layers
  [word("blazers?|blz|tuxedo|jas"), "blazer"],
  [word("coats?|parka|mantel|trench|overcoat|duster"), "coat"],
  [
    word(
      "jackets?|jaket|bomber|windbreaker|trucker|softshell|biker|puffer|anorak|varsity|baseball|outer|jkt"
    ),
    "jacket",
  ],
  [word("vest|rompi|gilet"), "vest"],
  [word("cardigans?|kardigan|cardi|bolero|poncho|cape"), "cardigan"],
  // Bottoms
  [
    word(
      "shorts?|shorties?|celana pendek|bermuda|hot ?pants|hotpants|cut[- ]?offs?"
    ),
    "shorts",
  ],
  [word("culottes?|kulot|palazzo|wide[- ]leg"), "wide"],
  [
    word(
      "jeans?|trousers?|trs|pants?|chinos?|joggers?|sweatpants?|jerseypants|bottoms|celana|slacks|cargo"
    ),
    "pants",
  ],
  // Tops
  [word("polo"), "polo"],
  [
    word(
      "t[- ]?shirts?|tshirt|tee|kaos|oblong|henley|r-neck|v-neck|crew|raglan|s\\/s|short ?top|shorttop"
    ),
    "tee",
  ],
  [word("hoodie|hood|hooded|zip hood"), "hoodie"],
  [
    word(
      "sweaters?|sweatshirts?|jumpers?|pullover|knit(wear)?|sweter|rajut|turtle ?neck|roll ?tops?|rollerneck|roll neck|polo neck|fleece|crewneck"
    ),
    "sweater",
  ],
  [word("shirts?|kemeja|flannel|flanel|baju"), "shirt"],
  [word("blouse|blus|tunic|tunik|kebaya|peplum"), "blouse"],
  [word("ss"), "tee"],
  [word("l\\/s|ls|long ?sleeves?|lengan panjang"), "longsleeve"],
  [
    word("tank ?tops?|tanks?|singlet|camisole|cami|sleeveless|strapless|strap"),
    "tank",
  ],
  [word("tops?|atasan"), "tee"],
  // Only when nothing above claimed it: "slim fit shirt" is a shirt, a bare
  // "Skinny Ankle" is jeans.
  [
    word(
      "denim|skinny|superskinny|super skinny|straight|slim|ankle|5 ?pkt|5 ?pocket|bootcut|flare|[hrl]\\.?w"
    ),
    "pants",
  ],
]

/// What an article is when its name says nothing. The nine divisions, and the
/// six that were retired but still hold articles.
const DIVISION_KINDS: Record<string, Kind> = {
  WANITA: "blouse",
  PRIA: "tee",
  ANAK_LAKI: "tee",
  ANAK_PEREMPUAN: "dress",
  PERLENGKAPAN_BAYI: "onesie",
  SANDAL_SEPATU: "shoe",
  TAS: "bag",
  AKSESORIS: "accessory",
  NON_DIVISI: "hanger",
  MENSWEAR: "tee",
  WOMENSWEAR: "blouse",
  KIDS: "tee",
  FOOTWEAR: "shoe",
  ACCESSORY: "accessory",
  DIVIDED: "tee",
}

/// Which silhouette a name draws, or null when it names none.
export function garmentKind(name: string): Kind | null {
  return KINDS.find(([re]) => re.test(name))?.[1] ?? null
}

/// How light a hex is to the eye, 0–1 (WCAG relative luminance).
function lightness(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const one = parseInt(hex.slice(at, at + 2), 16) / 255
    return one <= 0.03928 ? one / 12.92 : ((one + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function Garment({
  name,
  division,
  colours,
}: {
  name: string
  division?: string | null
  /// The colourway's paint, from `colourwayFill` — the colour master's hex,
  /// or what its label reads as. Two or three draw the garment split on the
  /// diagonal ("Hitam/Putih"). Empty or absent, the name is read for a
  /// colour instead, and with none there, grey.
  colours?: readonly string[]
}) {
  const split = useId()
  const kind: Kind =
    garmentKind(name) ??
    DIVISION_KINDS[(division ?? "").toUpperCase()] ??
    "hanger"
  const paint =
    colours !== undefined && colours.length > 0
      ? colours.slice(0, 3)
      : [findColour(name)?.hex ?? "#C9CCD1"]
  // White, cream and mint vanish into the grey well behind them, so the
  // outline is what draws those — heavier there, quiet everywhere else.
  const pale = Math.max(...paint.map(lightness)) > 0.7
  return (
    <svg viewBox="0 0 100 100" aria-hidden className="size-full p-[6%]">
      {paint.length > 1 && (
        <defs>
          <linearGradient id={split} x1="0" y1="0" x2="1" y2="1">
            {paint.flatMap((hex, at) => [
              <stop
                key={`${at}a`}
                offset={at / paint.length}
                stopColor={hex}
              />,
              <stop
                key={`${at}b`}
                offset={(at + 1) / paint.length}
                stopColor={hex}
              />,
            ])}
          </linearGradient>
        </defs>
      )}
      <path
        d={SHAPES[kind]}
        style={{ fill: paint.length > 1 ? `url("#${split}")` : paint[0] }}
        fillRule={HOLLOW.has(kind) ? "evenodd" : "nonzero"}
        stroke={pale ? "rgb(0 0 0 / .42)" : "rgb(0 0 0 / .25)"}
        strokeWidth="1.2"
        strokeLinejoin="round"
        className="transition-[fill] duration-150 ease-out"
      />
    </svg>
  )
}
