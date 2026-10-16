import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { exceptionsQuery } from "@/lib/queries/exceptions"
import { storesListQuery } from "@/lib/queries/stores"

/// What Stores asks first, before the screen is open (`lib/prefetch.ts`). Both
/// screens read their answer with `useSuspenseQuery` inside a `<Suspense>`, so
/// the server starts the reads too and streams the real page.
export const prefetch: PrefetchMap = {
  // Every store. Mirrors `StoreBook` in `list.tsx`.
  "/stores": async (client) => {
    await warmQuery(client, storesListQuery())
  },

  // The open exceptions of every store, as the screen opens: no store, no
  // kind, state Open. Mirrors `ExceptionList` in `exceptions.tsx`; a store, a
  // kind or a state in the address bar is another question.
  "/stores/exceptions": async (client, { search }) => {
    if (
      ["exceptions-unit", "exceptions-kind", "exceptions-state"].some(
        (name) => search[name] !== undefined
      )
    )
      return
    await warmQuery(client, exceptionsQuery({ state: "open", limit: 200 }))
  },
}
