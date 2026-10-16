import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { basketQuery, hoursQuery, tradeQuery } from "@/lib/queries/dashboard"
import { DEFAULT_CHOICE, spanOf } from "@/screens/dashboard/range"

/// The span the screen opens on. Not the period before it: the screen asks
/// for that only once this one has answered, so the table never waits behind
/// it, and neither does this.
export const prefetch: PrefetchMap = {
  "/dashboard": (client) => {
    const span = spanOf(DEFAULT_CHOICE)
    return Promise.all([
      warmQuery(client, tradeQuery(span)),
      warmQuery(client, basketQuery(span)),
      span.from === span.to
        ? warmQuery(client, hoursQuery(span.from))
        : undefined,
    ])
  },
}
