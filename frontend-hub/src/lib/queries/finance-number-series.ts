import { queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type {
  NumberSeries,
  NumberSeriesList,
  NumberSeriesPatch,
} from "@itulah/contract"

/// How every kind of document is numbered: the pattern (`{YY}`, `{MM}`,
/// `{###}`) and when the count starts over. 7Soft's No Transaksi and Kode No
/// Transaksi, kept per kind of document.
export const numberSeriesKey = ["finance", "number-series"] as const

export const numberSeriesQuery = () =>
  queryOptions({
    queryKey: numberSeriesKey,
    queryFn: ({ signal }) =>
      node.get<NumberSeriesList>("/api/v1/finance/number-series", { signal }),
  })

/// Change how one kind is numbered, from its next document on. Numbers already
/// issued never change.
export function setNumberSeries(
  kind: string,
  patch: NumberSeriesPatch
): Promise<NumberSeries> {
  return node.put<NumberSeries>(
    `/api/v1/finance/number-series/${encodeURIComponent(kind)}`,
    patch
  )
}
