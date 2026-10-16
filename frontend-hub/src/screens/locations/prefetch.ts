import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { placesQuery } from "@/screens/locations/places-data"

/// What GA's Sites asks first, before the screen is open (`lib/prefetch.ts`).
/// The list is read with `useSuspenseQuery` inside a `<Suspense>`, so the
/// server starts the read too and streams the real page.
export const prefetch: PrefetchMap = {
  // Every place, nothing searched. Mirrors `LocationBook` in `locations.tsx`.
  "/locations": async (client) => {
    await warmQuery(client, placesQuery({}))
  },
}
