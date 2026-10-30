import { warmInfinite, type PrefetchMap } from "@/lib/prefetch"
import { OPENING_SCOPE, supplyBookQuery } from "@/screens/supplies/book-data"

/// What Supplies asks first, before the screen is open
/// (`lib/prefetch.ts`). The register is read with `useSuspenseInfiniteQuery`
/// inside a `<Suspense>`, so the server starts the read too and streams the
/// real page.
export const prefetch: PrefetchMap = {
  // The first page of the Open tab, nothing narrowed. Mirrors
  // `SupplyRegister` in `supplies.tsx`.
  "/supplies": async (client) => {
    await warmInfinite(client, supplyBookQuery(OPENING_SCOPE))
  },
}
