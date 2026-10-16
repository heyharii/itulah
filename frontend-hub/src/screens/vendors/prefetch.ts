import { warmInfinite, type PrefetchMap } from "@/lib/prefetch"
import { vendorBookQuery } from "@/screens/vendors/book-data"

/// What GA's Suppliers asks first, before the screen is open
/// (`lib/prefetch.ts`). The book is read with `useSuspenseInfiniteQuery`
/// inside a `<Suspense>`, so the server starts the read too and streams the
/// real page.
export const prefetch: PrefetchMap = {
  // The operating book, nothing searched: where the screen opens. Mirrors
  // `VendorBook` in `vendors.tsx`.
  "/vendors": async (client) => {
    await warmInfinite(client, vendorBookQuery({ category: "EXPENSE" }))
  },
}
