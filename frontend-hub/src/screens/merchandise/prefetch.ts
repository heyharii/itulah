import type { PrefetchMap } from "@/lib/prefetch"
import {
  articles,
  colours,
  names,
  terms,
  units,
} from "@/screens/master/prefetch"

/// What Merchandise asks first, before the screen is open (`lib/prefetch.ts`).
/// Its screens are Master's article screens under other paths (see `index.ts`),
/// so what they read is the same, and so are the prefetchers.
export const prefetch: PrefetchMap = {
  "/merchandise": articles,
  "/merchandise/divisions": terms("divisions"),
  "/merchandise/tags": terms("tags"),
  "/merchandise/sizes": terms("sizes"),
  "/merchandise/colours": colours,
  "/merchandise/name-suggestions": names,
  "/merchandise/units": units,
}
