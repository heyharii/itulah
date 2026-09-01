/* Members, their spend and their points. Names, contact details and history
 * are synthesized — nothing here belongs to a real person. Tier, points and
 * lifetime value are derived from the same generated purchases, so the numbers
 * on a card always agree with the history behind it. */

import {
  CODES,
  ARTICLES,
  RATE,
  rupiah,
  type Code,
} from "@/components/commercial/data"
import { STORES } from "@/components/commercial/data"
import { addDays, noise, todayKey, type DayKey } from "@/lib/day"

export type Tier = "none" | "silver" | "gold"

export const TIER_META: Record<
  Tier,
  { label: string; hue: string; from: number }
> = {
  none: { label: "Not a member", hue: "var(--ink-4)", from: 0 },
  silver: { label: "Silver", hue: "var(--sky)", from: 5_000_000 },
  gold: { label: "Gold", hue: "var(--honey)", from: 20_000_000 },
}

/** Points earned per rupiah spent, and what a point is worth back. */
export const POINTS_PER_RUPIAH = 1 / 10_000
export const POINT_VALUE = 1_000

const FIRST = [
  "Adit",
  "Bayu",
  "Citra",
  "Dimas",
  "Eka",
  "Fajar",
  "Gita",
  "Hana",
  "Indra",
  "Joko",
  "Kirana",
  "Laras",
  "Maya",
  "Nanda",
  "Oka",
  "Putri",
  "Rani",
  "Sinta",
  "Tari",
  "Umar",
  "Vina",
  "Wulan",
  "Yudha",
  "Zahra",
]
const LAST = [
  "Anggraini",
  "Firmansyah",
  "Halim",
  "Kusuma",
  "Mahendra",
  "Nugroho",
  "Pratama",
  "Rahman",
  "Santoso",
  "Sitorus",
  "Suryani",
  "Wibowo",
  "Wijaya",
  "Yulianti",
]

export interface Purchase {
  id: string
  at: DayKey
  storeId: string
  articleId: string
  qty: number
  amount: number
  /** Set when the line came back. */
  returned?: boolean
}

export interface PointsEntry {
  id: string
  at: DayKey
  kind: "earn" | "spend" | "expire" | "adjust"
  points: number
  note: string
}

export interface Customer {
  id: string
  name: string
  phone: string
  email: string
  joinedOn: DayKey
  /** The store they shop at most. */
  homeStoreId: string
  hue: string
  purchases: Purchase[]
  points: PointsEntry[]
  /** Optional aggregates supplied by Internal's customer admin list. */
  lifetimeSpend?: number
  pointsBalance?: number
  tierName?: string
  visitCount?: number
  lastSeen?: DayKey
  lastSeenKnown?: boolean
  hasMembership?: boolean
  /** Set to [] when the profile is Internal-backed; undefined means preview data. */
  vouchers?: Code[]
}

const HUES = [
  "#0086fc",
  "#7b5cfa",
  "#ffbb26",
  "#00c978",
  "#ff58ae",
  "#64c6ff",
  "#ff3e00",
]

function build(): Customer[] {
  return Array.from({ length: 240 }, (_, i) => {
    const seed = `cust-${i}`
    const name = `${FIRST[noise(`${seed}-f`) % FIRST.length]} ${LAST[noise(`${seed}-l`) % LAST.length]}`
    const joinedOn = addDays(todayKey(), -(20 + (noise(`${seed}-j`) % 900)))
    const homeStoreId = STORES[noise(`${seed}-s`) % STORES.length].id

    /* how often they come back is what really separates one member from another */
    const visits =
      noise(`${seed}-v`) % 100 < 12
        ? 12 + (noise(`${seed}-vv`) % 20)
        : noise(`${seed}-v`) % 9

    const purchases: Purchase[] = Array.from({ length: visits }, (_, n) => {
      const p = `${seed}-p${n}`
      const article = ARTICLES[noise(p) % ARTICLES.length]
      const qty = 1 + (noise(`${p}-q`) % 3)
      return {
        id: p,
        at: addDays(todayKey(), -(1 + (noise(`${p}-d`) % 700))),
        storeId:
          noise(`${p}-s`) % 100 < 78
            ? homeStoreId
            : STORES[noise(`${p}-ss`) % STORES.length].id,
        articleId: article.id,
        qty,
        amount: Math.round((article.price * RATE * qty) / 1000) * 1000,
        returned: noise(`${p}-r`) % 100 > 93,
      }
    }).sort((a, b) => b.at.localeCompare(a.at))

    /* every kept purchase earns, so the ledger below adds up to the balance */
    const kept = purchases.filter((p) => !p.returned)
    const earned = kept.reduce(
      (sum, p) => sum + Math.floor(p.amount * POINTS_PER_RUPIAH),
      0
    )
    const redeemed =
      noise(`${seed}-rd`) % 100 < 40 ? Math.floor(earned * 0.35) : 0

    const points: PointsEntry[] = [
      ...kept.map((p) => ({
        id: `${p.id}-pt`,
        at: p.at,
        kind: "earn" as const,
        points: Math.floor(p.amount * POINTS_PER_RUPIAH),
        note: `Purchase at ${STORES.find((s) => s.id === p.storeId)?.name ?? "a store"}`,
      })),
      ...(redeemed > 0
        ? [
            {
              id: `${seed}-redeem`,
              at: addDays(todayKey(), -(3 + (noise(`${seed}-rdd`) % 120))),
              kind: "spend" as const,
              points: -redeemed,
              note: `Redeemed for ${rupiah(redeemed * POINT_VALUE)} off`,
            },
          ]
        : []),
    ].sort((a, b) => b.at.localeCompare(a.at))

    return {
      id: `m-${String(i + 1).padStart(4, "0")}`,
      name,
      phone: `08${String(1000000000 + noise(`${seed}-ph`) * 1237).slice(0, 10)}`,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
      joinedOn,
      homeStoreId,
      hue: HUES[i % HUES.length],
      purchases,
      points,
    }
  })
}

export const CUSTOMERS = build()

export const customerOf = (id: string) => CUSTOMERS.find((c) => c.id === id)

export const spendOf = (customer: Customer) =>
  customer.purchases.length > 0
    ? customer.purchases
        .filter((p) => !p.returned)
        .reduce((sum, p) => sum + p.amount, 0)
    : (customer.lifetimeSpend ?? 0)

export const tierOf = (customer: Customer): Tier => {
  if (customer.tierName) {
    if (customer.tierName === "gold" || customer.tierName === "platinum")
      return "gold"
    if (customer.tierName === "silver") return "silver"
    return "none"
  }
  const spend = spendOf(customer)
  if (spend >= TIER_META.gold.from) return "gold"
  if (spend >= TIER_META.silver.from) return "silver"
  return "none"
}

export const pointsOf = (customer: Customer) =>
  customer.points.length > 0
    ? customer.points.reduce((sum, entry) => sum + entry.points, 0)
    : (customer.pointsBalance ?? 0)

export const lastSeenOf = (customer: Customer) =>
  customer.purchases[0]?.at ?? customer.lastSeen ?? customer.joinedOn

export const hasLastSeen = (customer: Customer) =>
  customer.lastSeenKnown ?? customer.purchases.length > 0

export const returnsOf = (customer: Customer) =>
  customer.purchases.filter((p) => p.returned)

export const visitsOf = (customer: Customer) =>
  customer.purchases.length > 0
    ? customer.purchases.length
    : (customer.visitCount ?? 0)

export const memberOf = (customer: Customer) =>
  customer.hasMembership ?? tierOf(customer) !== "none"

export const tierLabelOf = (customer: Customer) => {
  if (customer.tierName) {
    return (
      customer.tierName.charAt(0).toUpperCase() + customer.tierName.slice(1)
    )
  }
  return TIER_META[tierOf(customer)].label
}

/** Vouchers a member is holding, from the commercial code list. */
export const vouchersOf = (customer: Customer) =>
  customer.vouchers ??
  CODES.filter(
    (code) => code.kind === "voucher" && code.memberId === customer.id
  )

/* ── segments: a rule, not a stored list ─────────────────────── */

export interface Segment {
  id: string
  name: string
  description: string
  holds: (customer: Customer) => boolean
}

const daysSince = (key: DayKey) =>
  Math.round(
    (new Date().setHours(12, 0, 0, 0) - new Date(`${key}T12:00:00`).getTime()) /
      86_400_000
  )

export const SEGMENTS: Segment[] = [
  {
    id: "best",
    name: "Best customers",
    description: "Gold tier, seen in the last 60 days",
    holds: (c) =>
      hasLastSeen(c) && tierOf(c) === "gold" && daysSince(lastSeenOf(c)) <= 60,
  },
  {
    id: "slipping",
    name: "Slipping away",
    description: "Spent over Rp 5jt but nothing in six months",
    holds: (c) =>
      hasLastSeen(c) &&
      spendOf(c) > 5_000_000 &&
      daysSince(lastSeenOf(c)) > 180,
  },
  {
    id: "new",
    name: "New this quarter",
    description: "Joined in the last 90 days",
    holds: (c) => daysSince(c.joinedOn) <= 90,
  },
  {
    id: "one-visit",
    name: "Came once",
    description: "A single purchase, never came back",
    holds: (c) => c.purchases.length === 1,
  },
  {
    id: "returners",
    name: "Returns often",
    description: "More than one line sent back",
    holds: (c) => returnsOf(c).length > 1,
  },
  {
    id: "points-rich",
    name: "Sitting on points",
    description: "Over 500 points never redeemed",
    holds: (c) => pointsOf(c) > 500,
  },
]

/** A one-line description of what a code is, for the customer sheet. */
export const codeLabel = (code: (typeof CODES)[number]) =>
  code.kind === "voucher"
    ? `Valid to ${new Date(`${code.endsOn}T12:00:00`).toLocaleDateString(
        "en-GB",
        {
          day: "numeric",
          month: "short",
          year: "2-digit",
        }
      )}${code.used > 0 ? " · already spent" : ""}`
    : "Coupon"

export { rupiah }

export const shortRupiah = (value: number) => {
  if (Math.abs(value) >= 1_000_000_000)
    return `Rp ${(value / 1_000_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000_000)
    return `Rp ${Math.round(value / 1_000_000)}jt`
  return rupiah(value)
}
