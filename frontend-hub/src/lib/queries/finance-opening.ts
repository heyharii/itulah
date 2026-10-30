import { queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type { JournalPage, OpeningCutoverReport } from "@itulah/contract"

/// Reads for Saldo Awal COA: the cutover dates the books were opened on, and
/// the cutover report for one of them.
///
/// Kept apart from `lib/queries/finance.ts` for the reason `finance-reports.ts`
/// is: that file is the whole of Finance's wire already, and this has one
/// screen reading it. The three imports (`POST /finance/opening/balances`,
/// `/stock`, `/subledger`) are deliberately not here: a cutover is brought in
/// from a file by an administrator, and nothing on the screen writes.
///
/// Every key starts with `finance`, so a refresh of the module's queries
/// reaches these too.
export const openingKeys = {
  cutovers: () => ["finance", "opening", "cutovers"] as const,
  report: (cutover: string) =>
    ["finance", "opening", "report", cutover] as const,
}

/// The days an opening entry was posted on, newest first.
///
/// The report is asked of one cutover date and there is no "the" cutover to
/// default to — a phased move has one per wave — so the dates come from the
/// entries themselves: every opening balance is a journal entry whose source
/// kind is `OPENING`, dated the cutover.
export const openingCutoversQuery = () =>
  queryOptions({
    queryKey: openingKeys.cutovers(),
    queryFn: async ({ signal }) => {
      const page = await node.get<JournalPage>(
        "/api/v1/finance/journal?kind=OPENING&limit=500&sort=date&dir=desc",
        { signal }
      )
      return [...new Set(page.rows.map((row) => row.posting_date))]
        .sort()
        .reverse()
    },
    staleTime: 60_000,
  })

/// One page: is every equation balanced, what did not map, and what stock was
/// priced by something other than a purchase. Read under the import's own key,
/// which is the administrator's.
export const openingReportQuery = (cutover: string) =>
  queryOptions({
    queryKey: openingKeys.report(cutover),
    queryFn: ({ signal }) =>
      node.get<OpeningCutoverReport>(
        `/api/v1/finance/opening/report?cutover_date=${encodeURIComponent(cutover)}`,
        { signal }
      ),
    staleTime: 30_000,
  })
