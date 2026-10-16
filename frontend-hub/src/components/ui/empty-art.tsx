import { cn } from "@/lib/utils"

/// The pictures that stand over an empty state's sentence.
///
/// One per kind of thing a list holds (owner, 2026-10-12: "ilustrasi seperti
/// ini be creative jg ya, perbanyak dan rapikan lagi"): an order, a carton, a
/// truck, a price tag, people, a shop, a chart, a calendar, a bell, a return —
/// plus the three every list can say: nothing yet, nothing that matches,
/// nothing left to do. `EmptyState` picks one from its sentence and, failing
/// that, from the department the screen is in, so a screen never has to.
///
/// Lark's taste: a soft pastel disc behind one friendly object, drawn in the
/// same 2px line everywhere, with one solid touch of colour. All on a 160 × 112
/// grid with the object centred on the disc, shown 136px wide.
export type EmptyArt =
  | "empty"
  | "search"
  | "done"
  | "orders"
  | "box"
  | "truck"
  | "tag"
  | "people"
  | "store"
  | "chart"
  | "calendar"
  | "bell"
  | "return"

/// The line every picture is drawn in, and its fills.
const LINE = "#8a93a3"
const PAPER = "#ffffff"
const BLUE = "#2563eb"
const TINT: Record<"blue" | "green" | "orange" | "violet", { disc: string; fill: string; solid: string }> = {
  blue: { disc: "#eef3ff", fill: "#dbe6ff", solid: BLUE },
  green: { disc: "#ecf7f0", fill: "#cdebd8", solid: "#1f8a3c" },
  orange: { disc: "#fff4e8", fill: "#ffe0bf", solid: "#d9731a" },
  violet: { disc: "#f4f0ff", fill: "#e2d8ff", solid: "#6d3ad6" },
}

const TONE_OF: Record<EmptyArt, keyof typeof TINT> = {
  empty: "blue",
  search: "blue",
  done: "green",
  orders: "blue",
  box: "orange",
  truck: "blue",
  tag: "violet",
  people: "blue",
  store: "orange",
  chart: "violet",
  calendar: "blue",
  bell: "orange",
  return: "green",
}

export function EmptyIllustration({
  art,
  className,
}: {
  art: EmptyArt
  className?: string
}) {
  const tone = TINT[TONE_OF[art]]
  const Picture = PICTURES[art]
  return (
    <svg
      viewBox="0 0 160 112"
      role="presentation"
      aria-hidden
      fill="none"
      stroke={LINE}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        // Arrives once, quietly: a short rise and fade, not a loop. The page
        // is already finished loading when this appears, so it should not
        // draw the eye away from the sentence under it.
        "h-auto w-[8.5rem] transition-[opacity,transform] duration-300 ease-[var(--ease-out)] motion-reduce:transition-none starting:translate-y-1.5 starting:opacity-0",
        className
      )}
    >
      <circle cx="80" cy="54" r="44" fill={tone.disc} stroke="none" />
      <ellipse cx="80" cy="101" rx="38" ry="4.5" fill="#e9ebef" stroke="none" />
      <Picture fill={tone.fill} solid={tone.solid} />
      <Sparkles />
    </svg>
  )
}

interface Paint {
  readonly fill: string
  readonly solid: string
}

/// Two small marks that make every picture feel finished: a plus at the top
/// left and a dot at the top right, the same on all of them.
function Sparkles() {
  return (
    <>
      <path d="M30 26v7M26.5 29.5h7" strokeWidth={1.75} />
      <circle cx="131" cy="24" r="3" fill={BLUE} stroke="none" opacity={0.45} />
      <circle cx="136" cy="80" r="2" fill={LINE} stroke="none" opacity={0.5} />
    </>
  )
}

/// Nothing here yet: an open tray, and the outline of what would sit in it.
function Empty({ fill }: Paint) {
  return (
    <>
      <rect x="62" y="22" width="36" height="26" rx="6" fill={PAPER} strokeDasharray="4 4" />
      <path d="M42 62h76l-7 30H49z" fill={fill} />
      <path d="M42 62h76" />
      <path d="M58 74h44" stroke={PAPER} strokeWidth={3} />
    </>
  )
}

/// Nothing that matches: a short list, and a lens that found nothing on it.
function Search({ solid }: Paint) {
  return (
    <>
      <rect x="44" y="18" width="58" height="72" rx="9" fill={PAPER} />
      <path d="M56 36h34M56 50h22M56 64h28" stroke="#d5d9e0" strokeWidth={3} />
      <circle cx="104" cy="66" r="16" fill={PAPER} strokeWidth={2.5} />
      <path d="M98 66h12" strokeWidth={2.5} />
      <path d="M116 78l12 12" stroke={solid} strokeWidth={4.5} />
    </>
  )
}

/// Nothing left to do: a settled badge with a tick.
function Done({ fill, solid }: Paint) {
  return (
    <>
      <circle cx="80" cy="56" r="28" fill={fill} />
      <circle cx="80" cy="56" r="20" fill={PAPER} stroke="none" />
      <path d="M70 57l7 7 14-15" stroke={solid} strokeWidth={4} />
      <path d="M48 34l-6-4M112 34l6-4M80 20v-6" strokeWidth={1.75} />
    </>
  )
}

/// Orders: a purchase order on a clipboard, its lines and a stamp.
function Orders({ fill, solid }: Paint) {
  return (
    <>
      <rect x="50" y="20" width="60" height="76" rx="9" fill={PAPER} />
      <rect x="66" y="14" width="28" height="12" rx="4" fill={fill} />
      <path d="M62 42h36M62 54h24M62 66h30" stroke="#d5d9e0" strokeWidth={3} />
      <circle cx="96" cy="80" r="8" fill={solid} stroke="none" />
      <path d="M92.5 80l2.5 2.5 4.5-5" stroke={PAPER} strokeWidth={2} />
    </>
  )
}

/// Stock, counts, picking and packing: an open carton with goods in it.
function Box({ fill, solid }: Paint) {
  return (
    <>
      <path d="M58 30l10-10h24l10 10" fill={PAPER} />
      <rect x="66" y="26" width="12" height="16" rx="3" fill={solid} stroke="none" opacity={0.85} />
      <rect x="80" y="22" width="12" height="20" rx="3" fill={PAPER} />
      <path d="M46 44h68v42a6 6 0 0 1-6 6H52a6 6 0 0 1-6-6z" fill={fill} />
      <path d="M46 44l-6 12h40l6-12M114 44l6 12H80" fill={PAPER} />
      <path d="M68 70h24" stroke={PAPER} strokeWidth={4} />
    </>
  )
}

/// Deliveries, trips and dispatch: a small truck on its way.
function Truck({ fill, solid }: Paint) {
  return (
    <>
      <rect x="34" y="40" width="58" height="40" rx="6" fill={fill} />
      <path d="M92 52h18l12 14v14H92z" fill={PAPER} />
      <path d="M98 58h10l6 8H98z" fill={solid} stroke="none" opacity={0.25} />
      <circle cx="52" cy="84" r="8" fill={PAPER} />
      <circle cx="108" cy="84" r="8" fill={PAPER} />
      <circle cx="52" cy="84" r="2.5" fill={LINE} stroke="none" />
      <circle cx="108" cy="84" r="2.5" fill={LINE} stroke="none" />
      <path d="M22 60h8M18 70h10" strokeWidth={1.75} />
    </>
  )
}

/// Prices, promotions, vouchers and campaigns: a tag with a percent.
function Tag({ fill, solid }: Paint) {
  return (
    <>
      <path d="M52 30h34l30 30-30 30-30-30V36a6 6 0 0 1 6-6z" fill={fill} transform="rotate(-8 80 60)" />
      <circle cx="64" cy="44" r="5" fill={PAPER} />
      <circle cx="78" cy="58" r="3" fill={solid} stroke="none" />
      <circle cx="94" cy="72" r="3" fill={solid} stroke="none" />
      <path d="M96 56l-20 20" stroke={solid} strokeWidth={3} />
    </>
  )
}

/// Members, users, customers: two people side by side.
function People({ fill, solid }: Paint) {
  return (
    <>
      <circle cx="98" cy="42" r="12" fill={PAPER} />
      <path d="M78 88c0-14 9-24 20-24s20 10 20 24z" fill={PAPER} />
      <circle cx="66" cy="46" r="14" fill={fill} />
      <path d="M40 92c0-16 12-28 26-28s26 12 26 28z" fill={fill} />
      <circle cx="122" cy="40" r="5" fill={solid} stroke="none" opacity={0.85} />
    </>
  )
}

/// Stores, tills and the shop floor: a shopfront with its awning.
function Store({ fill, solid }: Paint) {
  return (
    <>
      <rect x="44" y="44" width="72" height="48" rx="4" fill={PAPER} />
      <path d="M40 30h80l6 16H34z" fill={fill} />
      <path d="M54 30l-4 16M72 30l-2 16M88 30l2 16M106 30l4 16" />
      <rect x="54" y="58" width="22" height="34" rx="3" fill={fill} />
      <rect x="86" y="58" width="20" height="16" rx="3" fill={PAPER} />
      <circle cx="71" cy="76" r="2" fill={solid} stroke="none" />
    </>
  )
}

/// Sales, reports and analysis: a chart with its bars and a line.
function Chart({ fill, solid }: Paint) {
  return (
    <>
      <rect x="40" y="22" width="80" height="70" rx="9" fill={PAPER} />
      <rect x="52" y="62" width="10" height="20" rx="2" fill={fill} stroke="none" />
      <rect x="68" y="52" width="10" height="30" rx="2" fill={fill} stroke="none" />
      <rect x="84" y="58" width="10" height="24" rx="2" fill={fill} stroke="none" />
      <rect x="100" y="42" width="10" height="40" rx="2" fill={fill} stroke="none" />
      <path d="M54 50l16-12 16 8 20-14" stroke={solid} strokeWidth={2.5} />
      <circle cx="106" cy="32" r="3" fill={solid} stroke="none" />
    </>
  )
}

/// Schedules, due dates and periods: a calendar page.
function Calendar({ fill, solid }: Paint) {
  return (
    <>
      <rect x="46" y="24" width="68" height="66" rx="9" fill={PAPER} />
      <path d="M46 42V33a9 9 0 0 1 9-9h50a9 9 0 0 1 9 9v9z" fill={fill} />
      <path d="M62 18v12M98 18v12" strokeWidth={2.5} />
      <g fill="#d5d9e0" stroke="none">
        <rect x="58" y="52" width="9" height="8" rx="2" />
        <rect x="75" y="52" width="9" height="8" rx="2" />
        <rect x="58" y="68" width="9" height="8" rx="2" />
        <rect x="75" y="68" width="9" height="8" rx="2" />
      </g>
      <rect x="92" y="52" width="9" height="8" rx="2" fill={solid} stroke="none" />
    </>
  )
}

/// Notifications and activity: a bell, quiet.
function Bell({ fill, solid }: Paint) {
  return (
    <>
      <path d="M58 76V56a22 22 0 0 1 44 0v20l6 8H52z" fill={fill} />
      <path d="M72 88a8 8 0 0 0 16 0" fill={PAPER} />
      <path d="M80 26v8" strokeWidth={2.5} />
      <path d="M112 44c4 4 6 9 6 14M48 44c-4 4-6 9-6 14" strokeWidth={1.75} />
      <circle cx="98" cy="40" r="6" fill={solid} stroke={PAPER} strokeWidth={2} />
    </>
  )
}

/// Returns and refunds: a parcel with an arrow going back.
function Return({ fill, solid }: Paint) {
  return (
    <>
      <rect x="54" y="40" width="56" height="50" rx="6" fill={fill} />
      <path d="M54 54h56M82 40v14" />
      <path d="M50 30a26 26 0 0 0-14 22" stroke={solid} strokeWidth={3} />
      <path d="M44 26l7 4-4 7" stroke={solid} strokeWidth={3} />
      <rect x="70" y="66" width="24" height="10" rx="3" fill={PAPER} />
    </>
  )
}

const PICTURES: Record<EmptyArt, (paint: Paint) => React.ReactNode> = {
  empty: Empty,
  search: Search,
  done: Done,
  orders: Orders,
  box: Box,
  truck: Truck,
  tag: Tag,
  people: People,
  store: Store,
  chart: Chart,
  calendar: Calendar,
  bell: Bell,
  return: Return,
}
