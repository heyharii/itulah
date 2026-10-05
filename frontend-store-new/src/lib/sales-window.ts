import { node } from "@/lib/api"
import type { SalesWindow } from "@/lib/queries"

/// The shop's sales window with its receipts raised to the node's ceiling.
///
/// `fetchWindow` in `queries.ts` takes the node's default of 200 receipts,
/// which is enough for a list and too few to group by hour, weekday or
/// cashier. The node clamps `limit` to 1000 and says when it cut the list
/// (`receipts_truncated`), so the screen can say so too.
export const windowAllKey = (from: string, to: string) =>
  ["sales", "window", from, to, "all"] as const

export function fetchWindowAll(
  span: { from: string; to: string },
  signal?: AbortSignal,
): Promise<SalesWindow> {
  const parameters = new URLSearchParams({
    from: span.from,
    to: span.to,
    limit: "1000",
    // Local days, as everywhere else: a sale at 00:30 belongs to its own day.
    utc_offset_minutes: String(-new Date().getTimezoneOffset()),
  })
  return node.get<SalesWindow>(
    `/api/v1/store/reports/sales/window?${parameters.toString()}`,
    { signal },
  )
}
