import type { QueryClient } from "@tanstack/react-query"

import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { dayTakingsQuery, isoDay } from "@/lib/queries"
import { cashBoxesQuery, cashCountsQuery } from "@/lib/queries/cash-count"
import { bookQuery, pettyCashQuery } from "@/lib/queries/expenses"
import { sessionsQuery } from "@/lib/queries/sessions"
import { bookFrom } from "@/screens/money/petty-book"

/// Today's drawers and takings, as Sales and Reconciliation open on them.
/// Never warmed while idle: both are never fresh, and a drawer's figures
/// fetched minutes before somebody looks are figures asked for twice.
function today(client: QueryClient) {
  const day = isoDay(new Date())
  return Promise.all([
    warmQuery(client, sessionsQuery(day)),
    warmQuery(client, dayTakingsQuery(day)),
  ])
}

export const prefetch: PrefetchMap = {
  "/money/sales": today,
  "/money/reconciliation": today,
  // The tin, and the book back to the first of the month before last.
  "/money/petty-cash": (client) => {
    const now = new Date()
    return Promise.all([
      warmQuery(client, pettyCashQuery()),
      warmQuery(client, bookQuery(isoDay(bookFrom(now)), isoDay(now))),
    ])
  },
  // Head office's, through the relay: on a hover only.
  "/money/cash-count": (client) =>
    Promise.all([
      warmQuery(client, cashBoxesQuery()),
      warmQuery(client, cashCountsQuery()),
    ]),
}
