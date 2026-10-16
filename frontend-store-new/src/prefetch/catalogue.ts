import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import {
  catalogueQuery,
  finalPricesQuery,
  offersQuery,
  skuStockQuery,
} from "@/lib/queries"

/// The range: the book, what runs today, the prices a walk-in pays and what
/// the shop holds — the four reads the grid draws from.
export const prefetch: PrefetchMap = {
  "/catalogue": (client) =>
    Promise.all([
      warmQuery(client, catalogueQuery()),
      warmQuery(client, offersQuery()),
      warmQuery(client, finalPricesQuery()),
      warmQuery(client, skuStockQuery()),
    ]),
}

/// The screen opened most after the dashboard, and the biggest answer the
/// node sends.
export const warm = { "/catalogue": 1 }
