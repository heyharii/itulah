import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { catalogueQuery, offersQuery } from "@/lib/queries"

/// Every board here reads the one offers answer; Price drops also reads the
/// book, where a markdown is a price.
export const prefetch: PrefetchMap = {
  "/promotions": (client) => warmQuery(client, offersQuery()),
  "/promotions/campaigns": (client) => warmQuery(client, offersQuery()),
  "/promotions/vouchers": (client) => warmQuery(client, offersQuery()),
  "/promotions/price-changes": (client) =>
    Promise.all([
      warmQuery(client, offersQuery()),
      warmQuery(client, catalogueQuery()),
    ]),
}
