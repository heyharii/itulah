import { warmInfinite, warmQuery, type PrefetchMap } from "@/lib/prefetch"
import {
  memberDirectoryQuery,
  MEMBERS_PAGE,
  memberSegmentsQuery,
  savedSegmentsQuery,
} from "@/lib/queries/members"
import { pointsAccountsQuery, pointsLedgerQuery } from "@/lib/queries/points"

/// What Members asks first, before the screen is open (`lib/prefetch.ts`). The
/// options are the screens' own (`lib/queries/members.ts`, `points.ts`).

export const prefetch: PrefetchMap = {
  // The directory opens on everyone, in the server's house order (spend, most
  // first), with the segment book beside it for the two window lengths its
  // labels are written in. Its search (`q`), segment (`segment`,
  // `segmentId`) and filter chips (`f`) live in the address bar; a link that
  // carries one asks for exactly that, and the screen does so itself.
  "/members": async (client, { search }) => {
    if (
      search.q !== undefined ||
      search.segment !== undefined ||
      search.segmentId !== undefined ||
      search.f !== undefined
    )
      return
    await Promise.all([
      warmQuery(client, memberSegmentsQuery()),
      warmInfinite(
        client,
        memberDirectoryQuery({
          filters: [],
          limit: MEMBERS_PAGE,
        })
      ),
    ])
  },
  // The six segments with their counts, and the ones somebody wrote.
  "/members/segments": async (client) => {
    await Promise.all([
      warmQuery(client, memberSegmentsQuery()),
      warmQuery(client, savedSegmentsQuery()),
    ])
  },
  "/members/points": (client) => warmInfinite(client, pointsAccountsQuery()),
  // Every member's movements; one member's (`customer`) is asked by the
  // screen itself.
  "/members/points-ledger": (client, { search }) => {
    if (search.customer !== undefined) return
    return warmInfinite(client, pointsLedgerQuery(null))
  },
}
