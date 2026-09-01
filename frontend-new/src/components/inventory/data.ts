/* Inventory view models are shared by the live Internal adapter and the
 * isolated visual preview components. The live inventory screen always passes
 * rows from the adapter in api.ts; the deterministic rows below remain only as
 * reference fixtures for components that are rendered without a backend. */

import {
  PRODUCTS,
  SUPPLIERS,
  type Product,
} from "@/components/sourcing/catalogue"
import { addDays, dayKey, noise, todayKey, type DayKey } from "@/lib/day"

export type BucketKind =
  "sales" | "stock" | "warehouse" | "staging" | "reject" | "missing" | "transit"

export interface Bucket {
  id: string
  name: string
  kind: BucketKind
  /** Outbound work happens in stages; the bucket is the sum of them. */
  stages?: Bucket[]
  /** A truck cannot be counted, so some buckets have no official count. */
  countable?: boolean
}

export interface InvLocation {
  id: string
  name: string
  kind: "dc" | "store" | "transit" | "exception"
  region: string
  buckets: Bucket[]
}

const STORE_BUCKETS: Bucket[] = [
  { id: "sales", name: "Sales Floor", kind: "sales" },
  { id: "stock", name: "Stock Room", kind: "stock" },
  { id: "reject", name: "Reject", kind: "reject" },
]

/* Outbound staging is not one place but three steps of the same work:
 * picked off the shelf, packed into cartons, staged against a shipment. */
const STAGING_STEPS: Bucket[] = [
  { id: "picked", name: "Picked", kind: "staging" },
  { id: "packed", name: "Packed", kind: "staging" },
  { id: "shipment", name: "Shipment", kind: "staging" },
]

const DC_BUCKETS: Bucket[] = [
  { id: "warehouse", name: "Warehouse", kind: "warehouse" },
  {
    id: "staging",
    name: "Outbound Staging",
    kind: "staging",
    stages: STAGING_STEPS,
  },
  { id: "reject", name: "Reject", kind: "reject" },
]

/* Stock that has left one place and not arrived at the next still belongs to
 * somebody. It is observed when a truck is scanned, and never counted. */
const TRANSIT_BUCKETS: Bucket[] = [
  { id: "to-store", name: "DC to stores", kind: "transit", countable: false },
  { id: "to-dc", name: "Returns to DC", kind: "transit", countable: false },
]

export const INV_LOCATIONS: InvLocation[] = [
  {
    id: "dc-ckr",
    name: "Cikarang DC",
    kind: "dc",
    region: "Bekasi",
    buckets: DC_BUCKETS,
  },
  {
    id: "st-kg",
    name: "Kelapa Gading",
    kind: "store",
    region: "Jakarta",
    buckets: STORE_BUCKETS,
  },
  {
    id: "st-pi",
    name: "Pondok Indah",
    kind: "store",
    region: "Jakarta",
    buckets: STORE_BUCKETS,
  },
  {
    id: "st-grand",
    name: "Grand Indonesia",
    kind: "store",
    region: "Jakarta",
    buckets: STORE_BUCKETS,
  },
  {
    id: "st-bdg",
    name: "Paris van Java",
    kind: "store",
    region: "Bandung",
    buckets: STORE_BUCKETS,
  },
  {
    id: "st-sby",
    name: "Tunjungan Plaza",
    kind: "store",
    region: "Surabaya",
    buckets: STORE_BUCKETS,
  },
  {
    id: "transit",
    name: "In Transit",
    kind: "transit",
    region: "On the road",
    buckets: TRANSIT_BUCKETS,
  },
]

/** Buckets and their stages, flattened to the level rows actually sit at. */
export const leavesOf = (bucket: Bucket) => bucket.stages ?? [bucket]

export const bucketOf = (locationId: string, bucketId: string) =>
  locationOf(locationId)?.buckets.find((b) => b.id === bucketId)

export const stageOf = (
  locationId: string,
  bucketId: string,
  stageId: string
) =>
  leavesOf(
    bucketOf(locationId, bucketId) ?? { id: "", name: "", kind: "stock" }
  ).find((s) => s.id === stageId)

export const locationOf = (id: string) => INV_LOCATIONS.find((l) => l.id === id)

export const SIZES = ["XS", "S", "M", "L", "XL"] as const
export type Size = (typeof SIZES)[number]

/** One article number appears twice in the catalogue; inventory needs it once. */
export const ARTICLES: Product[] = PRODUCTS.filter(
  (product, index) => PRODUCTS.findIndex((p) => p.id === product.id) === index
)

export const articleOf = (id: string) => ARTICLES.find((a) => a.id === id)

export const divisionOf = (product: Product) =>
  SUPPLIERS.find((s) => s.id === product.supplierId)?.division ?? "Unassigned"

export const colourName = (colorwayId: string) => {
  const code = colorwayId.slice(-3)
  const names: Record<string, string> = {
    "001": "Black",
    "002": "Silver",
    "007": "Navy",
    "010": "Grey",
    "014": "Ecru",
    "018": "Olive",
    "025": "Rust",
    "026": "Sand",
    "027": "Ink",
    "034": "Sky",
    "035": "Blush",
    "036": "Cream",
  }
  return names[code] ?? `Colour ${code}`
}

/* ── the grain: one SKU, in one bucket, at one location ───────── */

export interface SkuRow {
  id: string
  locationId: string
  /** The canonical Internal bin backing this pool, when the API provides one. */
  binId?: string
  /** Canonical pool name when this row came from the pool projection. */
  pool?: string
  bucketId: string
  /** The step inside the bucket; equal to bucketId when it has no stages. */
  stageId: string
  productId: string
  colorwayId: string
  size: Size
  /** The item's own name, when the backend states one alongside the SKU. */
  name?: string
  /** What the books say is here. */
  stock: number
  /** What the readers have actually seen. */
  observed: number
  lastObserved: DayKey
  /** Null where an official count is not possible, such as in transit. */
  lastCount: DayKey | null
  /** False when the backend does not expose count history for this row. */
  lastCountKnown?: boolean
}

const pickSizes = (seed: string): Size[] => {
  const count = 2 + (noise(`${seed}-n`) % 3)
  const start = noise(`${seed}-s`) % (SIZES.length - 1)
  return SIZES.slice(start, start + count) as Size[]
}

/* A sweep and a count are operations on a bucket, not on a single SKU —
 * so both dates belong to the bucket and every row inside inherits them. */
export const sweepOf = (locationId: string, bucketId: string) =>
  addDays(todayKey(), -(noise(`${locationId}${bucketId}-sweep`) % 15))

export const countOf = (locationId: string, bucketId: string) =>
  addDays(todayKey(), -(8 + (noise(`${locationId}${bucketId}-count`) % 104)))

function buildRows(): SkuRow[] {
  const rows: SkuRow[] = []

  for (const location of INV_LOCATIONS) {
    for (const bucket of location.buckets) {
      for (const stage of leavesOf(bucket)) {
        const sweep = sweepOf(location.id, stage.id)
        const counted =
          bucket.countable === false ? null : countOf(location.id, stage.id)
        /* a bucket only holds part of the range, and Reject holds very little */
        const share =
          bucket.kind === "reject"
            ? 4
            : bucket.kind === "staging" || bucket.kind === "transit"
              ? 8
              : 18
        const articles = ARTICLES.filter(
          (article) =>
            noise(`${location.id}${stage.id}${article.id}`) % 100 < share * 2
        ).slice(0, share)

        for (const article of articles) {
          for (const colorway of article.colorways) {
            for (const size of pickSizes(
              `${location.id}${stage.id}${colorway.id}`
            )) {
              const seed = `${location.id}${stage.id}${colorway.id}${size}`
              const base =
                bucket.kind === "reject"
                  ? 1 + (noise(seed) % 4)
                  : bucket.kind === "warehouse"
                    ? 20 + (noise(seed) % 90)
                    : 4 + (noise(seed) % 22)

              /* most units are seen; a few slip through every read */
              const missRate = noise(`${seed}-miss`) % 100
              const missing =
                missRate > 88
                  ? 1 + (noise(`${seed}-m`) % 3)
                  : missRate > 74
                    ? 1
                    : 0

              rows.push({
                id: seed,
                locationId: location.id,
                bucketId: bucket.id,
                stageId: stage.id,
                productId: article.id,
                colorwayId: colorway.id,
                size,
                stock: base,
                observed: Math.max(0, base - missing),
                /* a unit is read during the sweep, or was last seen before it */
                lastObserved: missing
                  ? addDays(sweep, -(1 + (noise(`${seed}-o`) % 26)))
                  : sweep,
                lastCount: counted,
              })
            }
          }
        }
      }
    }
  }

  return rows
}

export const SKU_ROWS = buildRows()

/* ── totals, rolled up the same way at every level ───────────── */

export interface Position {
  stock: number
  observed: number
  missing: number
  /** The most recent read anywhere in the group. */
  lastObserved: DayKey | null
  /** The oldest official count in the group — the one that ages the fastest. */
  lastCount: DayKey | null
  /** Whether every row in the group supplied count-history metadata. */
  lastCountKnown: boolean
}

export function total(rows: SkuRow[]): Position {
  const stock = rows.reduce((sum, r) => sum + r.stock, 0)
  const observed = rows.reduce((sum, r) => sum + r.observed, 0)
  return {
    stock,
    observed,
    missing: stock - observed,
    lastObserved: rows.reduce<DayKey | null>(
      (latest, r) =>
        !latest || r.lastObserved > latest ? r.lastObserved : latest,
      null
    ),
    lastCount: rows.reduce<DayKey | null>(
      (oldest, r) =>
        r.lastCount && (!oldest || r.lastCount < oldest) ? r.lastCount : oldest,
      null
    ),
    lastCountKnown: rows.every((row) => row.lastCountKnown !== false),
  }
}

export const rowsAt = (
  locationId: string,
  bucketId?: string,
  stageId?: string
) =>
  SKU_ROWS.filter(
    (r) =>
      r.locationId === locationId &&
      (!bucketId || r.bucketId === bucketId) &&
      (!stageId || r.stageId === stageId)
  )

export const percent = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10

/* ── the units that are actually missing ─────────────────────── */

export type MissingStatus = "open" | "found" | "written-off"

export interface MissingEvent {
  at: DayKey
  what: string
  by: string
}

export interface MissingUnit {
  epc: string
  rowId: string
  productId: string
  colorwayId: string
  size: Size
  /** The item's own name, when the backend states one alongside the SKU. */
  name?: string
  locationId: string
  bucketId: string
  stageId: string
  /** The site's name, for locations that are not in the fixture estate. */
  locationName?: string
  /** Where the books expect it to be. */
  expected: string
  lastObserved: DayKey
  status: MissingStatus
  history: MissingEvent[]
}

const READER = "Overhead reader"

function buildMissing(): MissingUnit[] {
  const units: MissingUnit[] = []

  for (const row of SKU_ROWS) {
    const gap = row.stock - row.observed
    for (let n = 0; n < gap; n += 1) {
      const seed = `${row.id}-${n}`
      const wentMissing = addDays(row.lastObserved, 1 + (noise(seed) % 6))
      const bucket = bucketOf(row.locationId, row.bucketId)
      const stage = bucket
        ? leavesOf(bucket).find((x) => x.id === row.stageId)
        : undefined
      const attempts = 1 + (noise(`${seed}-a`) % 3)
      const status: MissingStatus =
        noise(`${seed}-st`) % 100 > 82
          ? "found"
          : noise(`${seed}-st`) % 100 > 76
            ? "written-off"
            : "open"

      const history: MissingEvent[] = [
        {
          at: row.lastObserved,
          what: `Last seen in ${stage?.name ?? "the bucket"}`,
          by: READER,
        },
        {
          at: wentMissing,
          what: "Not read in the daily sweep — opened as missing",
          by: "System",
        },
      ]

      for (let a = 0; a < attempts; a += 1) {
        history.push({
          at: addDays(wentMissing, 2 + a * 3 + (noise(`${seed}-s${a}`) % 3)),
          what: `Searched ${
            [
              "the stock room",
              "the fitting rooms",
              "the back of house",
              "the reject bin",
            ][noise(`${seed}-w${a}`) % 4]
          } — nothing found`,
          by: "Store team",
        })
      }

      if (status === "found") {
        history.push({
          at: addDays(wentMissing, 4 + attempts * 3),
          what: "Found and read back into stock",
          by: "Store team",
        })
      }
      if (status === "written-off") {
        history.push({
          at: addDays(wentMissing, 30),
          what: "Written off after 30 days open",
          by: "Head Office",
        })
      }

      units.push({
        epc: `EPC${row.colorwayId}${String(noise(seed)).padStart(3, "0")}${row.size}`,
        rowId: row.id,
        productId: row.productId,
        colorwayId: row.colorwayId,
        size: row.size,
        locationId: row.locationId,
        bucketId: row.bucketId,
        stageId: row.stageId,
        expected:
          stage && stage.id !== bucket?.id
            ? `${bucket?.name} · ${stage.name}`
            : (bucket?.name ?? "—"),
        lastObserved: row.lastObserved,
        status,
        history: history.sort((a, b) => a.at.localeCompare(b.at)),
      })
    }
  }

  return units
}

export const MISSING_UNITS = buildMissing()

export const missingAt = (locationId?: string, bucketId?: string) =>
  MISSING_UNITS.filter(
    (unit) =>
      (!locationId || unit.locationId === locationId) &&
      (!bucketId || unit.bucketId === bucketId)
  )

/* ── the ledger: every movement, in one place ────────────────── */

export type MoveKind =
  | "receive"
  | "dispatch"
  | "transfer"
  | "sale"
  | "return"
  | "correction"
  | "count"
  | "write-off"

export const MOVE_META: Record<
  MoveKind,
  { label: string; hue: string; sign: 1 | -1 | 0 }
> = {
  receive: { label: "Received", hue: "var(--grass)", sign: 1 },
  dispatch: { label: "Dispatched", hue: "var(--sky)", sign: -1 },
  transfer: { label: "Transferred", hue: "var(--violet)", sign: 0 },
  sale: { label: "Sold", hue: "var(--ink-3)", sign: -1 },
  return: { label: "Returned", hue: "var(--honey)", sign: 1 },
  correction: { label: "Correction", hue: "var(--coral)", sign: 0 },
  count: { label: "Count closed", hue: "var(--accent-base)", sign: 0 },
  "write-off": { label: "Written off", hue: "var(--ember)", sign: -1 },
}

export interface Movement {
  id: string
  at: DayKey
  time: string
  kind: MoveKind
  productId: string
  colorwayId: string
  size: Size
  /** The item's own name, when the backend states one alongside the SKU. */
  name?: string
  qty: number
  /** Where it happened; from/to are only set when it moved between places. */
  locationId: string
  fromId?: string
  toId?: string
  /** Raw canonical pools, present for pool-projection movements. */
  fromPool?: string
  toPool?: string
  bucketId: string
  by: string
  note?: string
  /** A correction says which day it actually applies to. */
  effectiveOn?: DayKey
}

const ACTORS = [
  "Rani P.",
  "Bagus H.",
  "Sinta W.",
  "Oka S.",
  "System",
  "Dimas R.",
]

function buildLedger(): Movement[] {
  const moves: Movement[] = []
  const kinds: MoveKind[] = [
    "sale",
    "sale",
    "sale",
    "receive",
    "dispatch",
    "transfer",
    "return",
    "correction",
    "count",
    "write-off",
  ]

  SKU_ROWS.filter((_, i) => i % 3 === 0).forEach((row, index) => {
    const runs = 1 + (noise(`${row.id}-mv`) % 3)
    for (let n = 0; n < runs; n += 1) {
      const seed = `${row.id}-mv${n}`
      const kind = kinds[noise(seed) % kinds.length]
      const at = addDays(todayKey(), -(noise(`${seed}-d`) % 60))
      const hour = 8 + (noise(`${seed}-h`) % 11)
      const minute = noise(`${seed}-m`) % 60

      moves.push({
        id: `mv-${index}-${n}`,
        at,
        time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        kind,
        productId: row.productId,
        colorwayId: row.colorwayId,
        size: row.size,
        qty:
          kind === "count"
            ? row.observed
            : kind === "write-off"
              ? 1
              : 1 + (noise(`${seed}-q`) % 12),
        locationId: row.locationId,
        fromId:
          kind === "transfer" || kind === "dispatch"
            ? row.locationId
            : undefined,
        toId:
          kind === "transfer"
            ? INV_LOCATIONS[noise(`${seed}-t`) % INV_LOCATIONS.length].id
            : kind === "receive"
              ? row.locationId
              : undefined,
        bucketId: row.bucketId,
        by: ACTORS[noise(`${seed}-by`) % ACTORS.length],
        note:
          kind === "correction"
            ? "Receiving miscount picked up during the cycle count"
            : kind === "write-off"
              ? "Open 30 days, never found"
              : undefined,
        /* a correction lands today but applies to the day it went wrong */
        effectiveOn:
          kind === "correction"
            ? addDays(at, -(3 + (noise(`${seed}-e`) % 12)))
            : undefined,
      })
    }
  })

  return moves.sort((a, b) =>
    `${b.at}${b.time}`.localeCompare(`${a.at}${a.time}`)
  )
}

export const LEDGER = buildLedger()

/** Ages a date for the little "· 12d" suffixes. */
export const ageOf = (key: DayKey | null) =>
  key === null
    ? null
    : Math.round(
        (new Date().setHours(12, 0, 0, 0) -
          new Date(`${key}T12:00:00`).getTime()) /
          86_400_000
      )

export { dayKey, todayKey }
