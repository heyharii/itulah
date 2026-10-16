import { countsQuery } from "@/lib/counts"
import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { catalogueQuery, movementsQuery, poolsQuery } from "@/lib/queries"
import { returnsQuery } from "@/lib/returns"
import { LEDGER_LIMIT } from "@/screens/stock/shared"

export const prefetch: PrefetchMap = {
  "/stock": (client) => warmQuery(client, poolsQuery()),
  "/stock/count": (client) => warmQuery(client, countsQuery()),
  "/stock/returns": (client) => warmQuery(client, returnsQuery()),
  // The ledger's first page, and the book its rows are named from.
  "/stock/movements": (client) =>
    Promise.all([
      warmQuery(client, movementsQuery(LEDGER_LIMIT)),
      warmQuery(client, catalogueQuery()),
    ]),
}

export const warm = { "/stock": 2 }
