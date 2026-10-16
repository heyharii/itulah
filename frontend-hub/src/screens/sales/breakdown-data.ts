import { queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type { SalesBreakdown } from "@itulah/contract"

import type { By } from "@/screens/sales/breakdown"

/// The question the ten "Sales by …" reports ask of
/// `GET /api/v1/reports/sales/breakdown`. Shared with the prefetcher
/// (`prefetch.ts`) so the server's answer is the screen's own.

export interface BreakdownQuestion {
  readonly by: By
  readonly from: string
  readonly to: string
  readonly unit: string
  readonly division: string
}

/// Query string from what is set; an empty filter is left off.
function salesBreakdown(
  question: BreakdownQuestion,
  signal?: AbortSignal
): Promise<SalesBreakdown> {
  const query = new URLSearchParams({
    by: question.by,
    from: question.from,
    to: question.to,
  })
  if (question.unit !== "") query.set("unit", question.unit)
  if (question.division !== "") query.set("division", question.division)
  return node.get<SalesBreakdown>(
    `/api/v1/reports/sales/breakdown?${query.toString()}`,
    { signal }
  )
}

export const breakdownQuery = (question: BreakdownQuestion) =>
  queryOptions({
    queryKey: [
      "sales",
      "breakdown",
      question.by,
      question.from,
      question.to,
      question.unit || null,
      question.division || null,
    ],
    queryFn: ({ signal }) => salesBreakdown(question, signal),
  })
