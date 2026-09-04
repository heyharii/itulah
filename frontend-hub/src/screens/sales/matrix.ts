import { BAND_NEUTRAL, BAND_TONES } from "@/lib/chart-bands"
import type {
  SalesSeries,
  SalesSeriesCell,
  SalesSeriesSite,
} from "@/lib/queries/analytics"

/// The server's rows, indexed the two ways this screen reads them.
///
/// The chart wants a row per period with a column per band; the table wants a
/// row per shop with a column per period; the sheet wants one cell. Building
/// all three from one index rather than three passes is not a performance
/// argument — it is so a number cannot appear differently in the chart, in the
/// table, and in the total underneath them.

/// Which number a cell is showing.
///
/// Three measures of the same trade, and they disagree in ways worth being
/// able to see: a shop can take more money on fewer sales (it sold dearer
/// things) or make more sales for less money (it discounted). One chart
/// showing whichever the reader asked for, rather than three axes to re-read.
export type SalesKind = "gross_minor" | "sales_count" | "units_sold"

export const SALES_KINDS: readonly { kind: SalesKind; label: string }[] = [
  { kind: "gross_minor", label: "Takings" },
  { kind: "sales_count", label: "Sales" },
  { kind: "units_sold", label: "Units" },
]

/// How many shops get a hue of their own.
///
/// Five, because the design language carries five categorical colours and
/// stops there — and because eight is the most hues anybody can reliably tell
/// apart, colour-blind or not. This fleet is thirteen shops and grows. So the
/// biggest five are drawn as themselves and the rest are drawn as **Other**,
/// which is a truthful band rather than a sixth, seventh and eighth colour
/// nobody could name.
///
/// The per-shop answer is not lost by that: it is in the table underneath,
/// where every shop has its own row, its own figure and its own comparison.
/// The chart answers "how did the fleet trade"; the table answers "which
/// shop". Trying to make the chart answer both is what produces nineteen
/// pastel bands.
const BANDS = BAND_TONES.length

/// The band the tail of the fleet is drawn as.
export const OTHER = "other"

/// One band of the stack: a shop, or the tail of the fleet.
export interface SalesBand {
  readonly key: string
  readonly label: string
  /// A CSS value, from the design language's categorical five. Never computed
  /// from a hue wheel: a generated palette is how a chart ends up telling two
  /// branches apart by nothing.
  readonly colour: string
  /// The shops this band adds up. One, except for `Other`.
  readonly siteIds: readonly string[]
}

export interface SalesMatrix {
  readonly buckets: readonly string[]
  /// Every shop, one row each, biggest first — the order the table reads them.
  readonly rows: readonly SalesSeriesSite[]
  /// The chart's bands, foot of the stack first.
  readonly bands: readonly SalesBand[]
  /// The colour a shop wears, in the chart and on its own row. `Other`'s grey
  /// for a shop outside the top five, which is what the chart draws it as.
  colourOf(siteId: string): string
  cellOf(siteId: string, bucket: string): SalesSeriesCell | undefined
  siteValue(siteId: string, bucket: string, kind: SalesKind): number
  siteTotal(siteId: string, kind: SalesKind): number
  bucketTotal(bucket: string, kind: SalesKind): number
  grandTotal(kind: SalesKind): number
  /// A band's value in one bucket — one shop's, or the tail's added up.
  bandValue(bandKey: string, bucket: string, kind: SalesKind): number
}

const EMPTY: SalesMatrix = {
  buckets: [],
  rows: [],
  bands: [],
  colourOf: () => BAND_NEUTRAL,
  cellOf: () => undefined,
  siteValue: () => 0,
  siteTotal: () => 0,
  bucketTotal: () => 0,
  grandTotal: () => 0,
  bandValue: () => 0,
}

export function buildMatrix(
  series: SalesSeries | undefined,
  /// Narrow every total, row and band to one shop. The bands are still worked
  /// out over the WHOLE fleet, so a shop looked at on its own keeps the colour
  /// it had in the stack — otherwise focusing a shop would recolour it and the
  /// reader would have to re-learn the chart they just came from.
  focus?: string | null
): SalesMatrix {
  if (series === undefined) return EMPTY

  const cells = new Map<string, SalesSeriesCell>()
  for (const cell of series.cells) {
    cells.set(`${cell.site_id}|${cell.bucket_start}`, cell)
  }

  const cellOf = (siteId: string, bucket: string) =>
    cells.get(`${siteId}|${bucket}`)

  const siteValue = (siteId: string, bucket: string, kind: SalesKind) =>
    cellOf(siteId, bucket)?.[kind] ?? 0

  const siteTotal = (siteId: string, kind: SalesKind) =>
    series.buckets.reduce(
      (sum, bucket) => sum + siteValue(siteId, bucket, kind),
      0
    )

  // Biggest first, so the bands that carry the column sit at its foot where
  // they share the axis, and the table reads in the same order as the stack.
  const bySize = [...series.sites].sort((left, right) => {
    const difference =
      siteTotal(right.site_id, "gross_minor") -
      siteTotal(left.site_id, "gross_minor")
    return difference !== 0
      ? difference
      : left.site_name.localeCompare(right.site_name)
  })

  const named = bySize.slice(0, BANDS)
  const tail = bySize.slice(BANDS)
  const fleetBands: SalesBand[] = named.map((site, index) => ({
    key: keyOf(site.site_id),
    label: site.site_name,
    colour: BAND_TONES[index],
    siteIds: [site.site_id],
  }))
  // Only when the tail actually traded. A grey band at zero is a legend entry
  // for nothing, and it would sit on the chart every day a small shop was shut.
  if (tail.some((site) => siteTotal(site.site_id, "gross_minor") > 0)) {
    fleetBands.push({
      key: OTHER,
      label: `Other (${tail.length} shops)`,
      colour: BAND_NEUTRAL,
      siteIds: tail.map((site) => site.site_id),
    })
  }

  const colourFor = new Map<string, string>()
  for (const band of fleetBands) {
    for (const siteId of band.siteIds) colourFor.set(siteId, band.colour)
  }

  const focused = focus === undefined || focus === null ? null : focus
  const rows =
    focused === null
      ? bySize
      : bySize.filter((site) => site.site_id === focused)
  const bands =
    focused === null
      ? fleetBands
      : [
          {
            key: keyOf(focused),
            label:
              bySize.find((site) => site.site_id === focused)?.site_name ??
              focused,
            colour: colourFor.get(focused) ?? BAND_TONES[0],
            siteIds: [focused],
          },
        ]

  const bandOf = new Map(bands.map((band) => [band.key, band]))

  return {
    buckets: series.buckets,
    rows,
    bands,
    colourOf: (siteId) => colourFor.get(siteId) ?? BAND_NEUTRAL,
    cellOf,
    siteValue,
    siteTotal,
    bucketTotal: (bucket, kind) =>
      rows.reduce((sum, site) => sum + siteValue(site.site_id, bucket, kind), 0),
    grandTotal: (kind) =>
      rows.reduce((sum, site) => sum + siteTotal(site.site_id, kind), 0),
    bandValue: (bandKey, bucket, kind) => {
      const band = bandOf.get(bandKey)
      if (band === undefined) return 0
      return band.siteIds.reduce(
        (sum, siteId) => sum + siteValue(siteId, bucket, kind),
        0
      )
    },
  }
}

/// A site id as an object key on a chart row.
///
/// recharts addresses a series by a string key on the row, and a site id is
/// `store-01` today and could carry a dot tomorrow. Prefixed so it can never
/// collide with `bucket` or with `OTHER`.
function keyOf(siteId: string): string {
  return `site_${siteId.replace(/[^a-zA-Z0-9]/g, "_")}`
}
