import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { inboundQuery } from "@/screens/stock/inbound"

export const prefetch: PrefetchMap = {
  "/receive": (client) => warmQuery(client, inboundQuery()),
}

export const warm = { "/receive": 3 }
