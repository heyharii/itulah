import { unitsQuery } from "@/lib/queries/organisation"
import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { placesQuery } from "@/screens/locations/places-data"

/// What GA's Sites asks first, before the screen is open (`lib/prefetch.ts`).
/// The list is read with `useSuspenseQuery` inside a `<Suspense>`, so the
/// server starts the read too and streams the real page.
export const prefetch: PrefetchMap = {
  // Every place, nothing searched, and the units whose names the rows wear.
  // Mirrors `LocationBook` in `locations.tsx`.
  "/locations": async (client) => {
    await Promise.all([
      warmQuery(client, placesQuery({})),
      warmQuery(client, unitsQuery()),
    ])
  },
}
