import {
  previousSpanOf,
  SALES_BUCKETS,
  SALES_SPANS,
  spanOf,
  type SalesBucket,
  type SalesRange,
} from "@itulah/contract/reporting"

import { useNavigate } from "@tanstack/react-router"

import { useSheet, type SheetSearch } from "@/lib/sheets"

/// The window a report is read over, held in the URL.
///
/// Every screen that reads a span shares these two parameters on purpose: a
/// reader who set the fleet chart to thirteen weeks and then crossed to Margin
/// is still asking about thirteen weeks, and making them say so twice would be
/// the screen forgetting the question.
///
/// It lives in the Sales module rather than in Store ops because Sales is where
/// the fleet's own trade is now read; Store ops still borrows it for the two
/// screens it kept.
///
/// The calendar itself is `@itulah/contract/reporting`'s — where a week starts,
/// what "the span before this one" means, how a bucket is named. That is shared
/// with the shops for a reason this repository has already paid for: two
/// notions of a week draw the same trade as two different weeks and nothing
/// catches it.

/// The span each resolution opens on.
///
/// Not one number of days for all three. Thirty days at a monthly resolution is
/// one column; a year at a daily resolution is three hundred and sixty-five
/// bars three pixels wide. Each resolution gets a span that is legible AT that
/// resolution.
export const OPENS_ON: Record<SalesBucket, number> = {
  day: 30,
  week: 13,
  month: 12,
}

/// Every span a phone can pick, as one list: how wide a column is and how many
/// of them, in the words "Last 13 weeks". The value is `bucket:buckets`.
export const PERIOD_CHOICES: readonly {
  readonly value: string
  readonly label: string
}[] = SALES_BUCKETS.flatMap((bucket) =>
  SALES_SPANS[bucket].map((buckets) => ({
    value: `${bucket}:${buckets}`,
    label: `Last ${buckets} ${bucket}s`,
  }))
)

export interface Period {
  readonly bucket: SalesBucket
  readonly buckets: number
  readonly range: SalesRange
  /// The span of the same shape immediately before this one — twelve calendar
  /// months, not 365 days, so February is compared against a February.
  readonly before: SalesRange
  readonly options: readonly number[]
  readonly setBucket: (bucket: SalesBucket) => void
  readonly setBuckets: (buckets: number) => void
  /// Both at once, in one navigation: a phone picks "Last 13 weeks" from one
  /// list, and two writes would each start from the URL the other had not
  /// finished writing.
  readonly setSpan: (bucket: SalesBucket, buckets: number) => void
}

export function usePeriod(): Period {
  const navigate = useNavigate()
  const bucketParam = useSheet("bucket")
  const spanParam = useSheet("span")

  const bucket: SalesBucket = bucketParam.value ?? "day"
  const options = SALES_SPANS[bucket]
  // A count the current resolution does not offer is dropped rather than
  // honoured: `?bucket=month&span=90` is ninety months, which is not a report
  // anybody asked for — it is a leftover from the daily view.
  const asked =
    spanParam.value === undefined ? Number.NaN : Number(spanParam.value)
  const buckets = options.includes(asked) ? asked : OPENS_ON[bucket]

  return {
    bucket,
    buckets,
    range: spanOf(bucket, buckets),
    before: previousSpanOf(bucket, buckets),
    options,
    setBucket: (next) => bucketParam.open(next),
    setBuckets: (next) => spanParam.open(String(next)),
    setSpan: (nextBucket, next) =>
      void navigate({
        to: ".",
        search: (prev: SheetSearch) => ({
          ...prev,
          bucket: nextBucket,
          span: String(next),
        }),
        viewTransition: false,
      }),
  }
}
