import { PO_LIFECYCLE, PO_STATUS_META } from "@/components/po/api"

export type StrengthKey = "strong" | "weak" | "veryweak" | "none"

export interface Supplier {
  id: string
  name: string
  /** Canonical masterdata fields. Optional on historical fixture rows. */
  code?: string
  address?: string
  status?: "active" | "inactive" | "blocked" | string
  version?: number
  createdAt?: string
  updatedAt?: string
  tags: string[]
  /** Days since the last interaction; `null` means no contact on record. */
  days: number | null
  strength: StrengthKey
  site: string | null
  notes?: string
  volume: number[]
  /** Supplier list enrichments returned by Internal's relational projection. */
  totalSpend?: number
  totalStock?: number
  unitsSold?: number
  incomingQty?: number
  avgLeadTimeDays?: number | null
  totalRevenue?: number
  totalArticles?: number
  storeSpread?: number
  historyEvents?: number
  primaryDivision?: string
}

/**
 * Four hues instead of ten: categories share a hue with the others in their
 * group — channel, product, sourcing, timing — so colour carries meaning
 * rather than just telling chips apart.
 */
/* The chips describe the record's own state, so the colours carry meaning:
 * red for something wrong, amber for something missing, blue for terms. */
export const TAG_HUE: Record<string, string> = {
  Blocked: "#ff3e00",
  Inactive: "#a9a7a3",
  "No primary contact": "#ffbb26",
}

/** Anything else — contact counts, payment terms — reads as neutral blue. */
export const tagHue = (name: string) => TAG_HUE[name] ?? "#0086fc"

export const ALL_TAGS = Object.keys(TAG_HUE).sort()

export const STRENGTH: Record<
  StrengthKey,
  { label: string; color: string; bars: number; rank: number }
> = {
  strong: { label: "Strong", color: "var(--grass)", bars: 3, rank: 3 },
  weak: { label: "Fair", color: "var(--honey)", bars: 2, rank: 2 },
  veryweak: { label: "At risk", color: "var(--ember)", bars: 1, rank: 1 },
  none: { label: "No contact", color: "var(--ink-4)", bars: 0, rank: 0 },
}

export const STRENGTH_KEYS: StrengthKey[] = [
  "strong",
  "weak",
  "veryweak",
  "none",
]

/** A supplier is worth chasing again once it passes this many days. */
export const STALE_AFTER = 90

export const isStale = (row: Supplier) =>
  row.days === null || row.days >= STALE_AFTER

export const SUPPLIERS: Supplier[] = [
  {
    id: "alpine",
    name: "Alpine Churn — Zürich",
    tags: ["B2B", "Gelato", "Wholesale"],
    days: 4,
    strength: "strong",
    site: "alpine-churn.example.com",
    volume: [4, 6, 5, 8, 7, 9, 8],
  },
  {
    id: "amber",
    name: "Amber Scoop — Prague",
    tags: ["Gelato", "B2B"],
    days: 400,
    strength: "none",
    site: null,
    volume: [7, 5, 4, 3, 2, 2, 1],
  },
  {
    id: "andes",
    name: "Andes Snow Creamery — Quito",
    tags: ["Gelato", "Catering"],
    days: 700,
    strength: "veryweak",
    site: "andes-snow.example.com",
    volume: [6, 5, 3, 2, 2, 1, 1],
  },
  {
    id: "apricot",
    name: "Apricot Atlas — Algiers",
    tags: ["Sorbet", "Imports"],
    days: 330,
    strength: "veryweak",
    site: "apricot-atlas.example.com",
    volume: [5, 4, 4, 3, 2, 2, 2],
  },
  {
    id: "aurora",
    name: "Aurora Scoops — Reykjavík",
    tags: ["Gelato", "Seasonal"],
    days: 9,
    strength: "strong",
    site: "aurora-scoops.example.com",
    volume: [3, 5, 6, 6, 8, 9, 9],
  },
  {
    id: "baltic",
    name: "Baltic Berry — Tallinn",
    tags: ["Dairy-free", "Seasonal", "B2C"],
    days: 35,
    strength: "weak",
    site: "baltic-berry.example.com",
    volume: [6, 6, 5, 5, 4, 5, 4],
  },
  {
    id: "sesame",
    name: "Black Sesame Social — Bandung",
    tags: ["Vegan", "Cafe", "B2C"],
    days: 9,
    strength: "strong",
    site: "sesame-social.example.com",
    volume: [2, 4, 5, 7, 8, 8, 9],
  },
  {
    id: "bluefig",
    name: "Blue Fig Gelato — Florence",
    tags: ["Gelato", "Cafe"],
    days: 420,
    strength: "veryweak",
    site: "blue-fig.example.com",
    volume: [8, 6, 5, 3, 2, 1, 1],
  },
  {
    id: "boreal",
    name: "Boreal Batch — Yellowknife",
    tags: ["Dairy-free", "Local", "Seasonal"],
    days: 8,
    strength: "strong",
    site: "boreal-batch.example.com",
    volume: [5, 6, 7, 7, 8, 8, 9],
  },
  {
    id: "cacao",
    name: "Cacao Norte — Oaxaca",
    tags: ["B2B", "Local", "Wholesale"],
    days: 730,
    strength: "none",
    site: null,
    volume: [7, 6, 4, 3, 2, 1, 1],
  },
  {
    id: "cape",
    name: "Cape Vanilla Co. — Cape Town",
    tags: ["Wholesale", "Imports"],
    days: 410,
    strength: "veryweak",
    site: "cape-vanilla.example.com",
    volume: [6, 5, 4, 3, 3, 2, 2],
  },
  {
    id: "cedar",
    name: "Cedar Spoon — Beirut",
    tags: ["Cafe", "Local", "Seasonal"],
    days: 6,
    strength: "strong",
    site: "cedar-spoon.example.com",
    volume: [4, 5, 6, 7, 7, 8, 9],
  },
  {
    id: "cloudberry",
    name: "Cloudberry Cone — Helsinki",
    tags: ["Dairy-free", "Seasonal"],
    days: null,
    strength: "none",
    site: null,
    volume: [1, 1, 1, 1, 1, 1, 1],
  },
  {
    id: "coconut",
    name: "Coconut Commons — Manila",
    tags: ["Vegan", "B2C", "Cafe"],
    days: 24,
    strength: "weak",
    site: "coconut-commons.example.com",
    volume: [5, 5, 6, 5, 6, 5, 6],
  },
  {
    id: "copper",
    name: "Copper Cone — Melbourne",
    tags: ["Gelato", "Cafe", "B2C"],
    days: 30,
    strength: "weak",
    site: "copper-cone.example.com",
    volume: [6, 6, 5, 6, 5, 6, 5],
  },
  {
    id: "coral",
    name: "Coral Coast Sorbet — Honolulu",
    tags: ["Sorbet", "Local"],
    days: 9,
    strength: "strong",
    site: "coral-coast.example.com",
    volume: [3, 4, 6, 7, 8, 8, 9],
  },
  {
    id: "crimson",
    name: "Crimson Clover — Brussels",
    tags: ["Gelato", "Wholesale", "Catering"],
    days: 60,
    strength: "weak",
    site: "crimson-clover.example.com",
    volume: [7, 6, 6, 5, 5, 4, 5],
  },
  {
    id: "delta",
    name: "Delta Dairy Works — New Orleans",
    tags: ["B2B", "Wholesale", "Local"],
    days: 2,
    strength: "strong",
    site: "delta-dairy.example.com",
    volume: [5, 6, 7, 8, 8, 9, 9],
  },
  {
    id: "dolomite",
    name: "Dolomite Dairy — Bolzano",
    tags: ["Gelato", "Wholesale"],
    days: 3,
    strength: "strong",
    site: "dolomite-dairy.example.com",
    volume: [6, 7, 7, 8, 8, 9, 9],
  },
  {
    id: "dragonfruit",
    name: "Dragonfruit Dock — Shenzhen",
    tags: ["Sorbet", "B2B", "Wholesale"],
    days: null,
    strength: "none",
    site: null,
    volume: [1, 1, 2, 1, 1, 1, 1],
  },
  {
    id: "ember",
    name: "Ember Cone Company — Seoul",
    tags: ["B2C", "Vegan"],
    days: 15,
    strength: "weak",
    site: "ember-cone.example.com",
    volume: [4, 5, 5, 6, 6, 6, 7],
  },
  {
    id: "fjord",
    name: "Fjord & Cream — Bergen",
    tags: ["Local", "Seasonal", "Dairy-free"],
    days: 12,
    strength: "strong",
    site: "fjord-cream.example.com",
    volume: [5, 5, 6, 7, 7, 8, 8],
  },
  {
    id: "golden",
    name: "Golden Hour Gelato — Lisbon",
    tags: ["Gelato", "Cafe", "Seasonal"],
    days: 90,
    strength: "weak",
    site: "golden-hour.example.com",
    volume: [8, 7, 6, 5, 4, 4, 3],
  },
  {
    id: "harbor",
    name: "Harbor Churn — Halifax",
    tags: ["B2B", "Imports"],
    days: 7,
    strength: "strong",
    site: "harbor-churn.example.com",
    volume: [4, 5, 6, 6, 7, 8, 8],
  },
]

/* The sortable table columns and the sort direction. They live in the URL, so
 * like the view ids they are a closed literal set the route can validate. */
export const SORT_KEYS = ["categories", "history", "status"] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type SortDir = "asc" | "desc"

/* The saved-view ids live in the URL, so they are a closed literal set the
 * route's search schema can validate against. */
export const VIEW_IDS = ["main", "no-contact", "inactive", "blocked"] as const
export type ViewId = (typeof VIEW_IDS)[number]

export interface View {
  id: ViewId
  label: string
  tag: string | null
  hue: string
}

export const VIEWS: View[] = [
  { id: "main", label: "All", tag: null, hue: "var(--ink-4)" },
  {
    id: "no-contact",
    label: "No primary contact",
    tag: "No primary contact",
    hue: "var(--honey)",
  },
  { id: "inactive", label: "Inactive", tag: "Inactive", hue: "var(--ink-4)" },
  { id: "blocked", label: "Blocked", tag: "Blocked", hue: "var(--ember)" },
]

export type NavIcon = "table" | "bag" | "chart"

/* Same reasoning as VIEW_IDS: the current section and the set of unfolded
 * sections are navigation state, so their ids have to be validatable. */
export const SECTION_IDS = ["suppliers", "orders", "reports"] as const
export type SectionId = (typeof SECTION_IDS)[number]

/** The nav leaf that stands for one order status, both ways. */
export const orderLeafId = (status: (typeof PO_LIFECYCLE)[number]) => `orders-${status}`

export interface NavChild {
  id: string
  label: string
  hue: string
  count?: number
}

export interface NavSection {
  id: SectionId
  label: string
  icon: NavIcon
  count?: number
  children?: NavChild[]
}

/**
 * Nav is a two-tier tree: sections that own a set of leaves. Only the section
 * you are in stays open, so the sidebar never becomes a wall.
 */
export const NAV: NavSection[] = [
  {
    id: "suppliers",
    label: "Suppliers",
    icon: "table",
    children: VIEWS.map((v) => ({ id: v.id, label: v.label, hue: v.hue })),
  },
  {
    /* The counts are the live ones the order list reports; the sidebar is
     * handed them at render rather than carrying a number of its own. */
    id: "orders",
    label: "Purchase orders",
    icon: "bag",
    children: PO_LIFECYCLE.map((status) => ({
      id: orderLeafId(status),
      label: PO_STATUS_META[status].label,
      hue: PO_STATUS_META[status].hue,
    })),
  },
  {
    id: "reports",
    label: "Reports",
    icon: "chart",
    children: [
      { id: "rep-revenue", label: "Revenue", hue: "var(--violet)" },
      { id: "rep-quality", label: "Quality", hue: "var(--honey)" },
      { id: "rep-coverage", label: "Coverage", hue: "var(--accent)" },
    ],
  },
]

/* ── time ────────────────────────────────────────────────
 * Both directions work in whole calendar days anchored to midnight, so a
 * value survives a round-trip through the form without drifting by one.
 * ──────────────────────────────────────────────────────── */

const midnightToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** Compact age for the grid column: "4d", "5w", "11mo", "2y". */
export function shortAge(days: number | null) {
  if (days === null) return "—"
  if (days < 7) return `${days}d`
  if (days < 31) return `${Math.round(days / 7)}w`
  if (days < 365) return `${Math.round(days / 30)}mo`
  const years = days / 365
  return `${years < 1.5 ? 1 : Math.round(years)}y`
}

const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"} ago`

/** The prose form, kept for tooltips and the detail panel. */
export function longAge(days: number | null) {
  if (days === null) return "No contact on record"
  if (days === 1) return "Yesterday"
  if (days < 7) return plural(days, "day")
  if (days < 31) return plural(Math.round(days / 7), "week")
  if (days < 365) return plural(Math.round(days / 30), "month")
  const years = days / 365
  return years < 1.5
    ? "About a year ago"
    : `About ${Math.round(years)} years ago`
}

/** Days between a yyyy-mm-dd value and today, or null when empty. */
export function daysFromDate(value: string) {
  if (!value) return null
  const then = new Date(`${value}T00:00:00`)
  if (Number.isNaN(then.getTime())) return null
  return Math.max(
    0,
    Math.round((midnightToday().getTime() - then.getTime()) / 86400000)
  )
}

/** The inverse, so editing a record shows the same date it was given. */
export function dateFromDays(days: number | null | undefined) {
  if (days === null || days === undefined) return ""
  const d = midnightToday()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
