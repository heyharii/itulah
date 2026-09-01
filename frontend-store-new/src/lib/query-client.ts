import { QueryClient } from "@tanstack/react-query"

import { ApiError } from "@itulah/contract/client"

/// One client for the whole till.
///
/// It lives in its own module rather than in `main.tsx` because something other
/// than a component needs it: `lib/sale-queue.ts` settles a sale outside any
/// React tree — after a reload, while the tab is in the background, from a
/// timer — and when it does, the day's takings and the shop's pool balances
/// have both changed. A queue that could not say so would leave the Reports
/// screen quietly a sale behind.
///
/// The defaults below are the offline posture, and every one of them differs
/// from the console's for the same reason: this app has to keep working when
/// the browser cannot reach the node in the next room.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /// **Long, on purpose.** The console refetches because head office data
      /// changes under it; a shop's price book changes when a publication
      /// arrives on the sync lane, which is minutes to days apart. Five minutes
      /// of staleness costs nothing and buys a screen that draws instantly from
      /// cache when the wifi is gone.
      staleTime: 5 * 60_000,
      /// A day. `gcTime` is what decides whether a cached answer is still there
      /// after the tablet has been asleep since lunch, and the default five
      /// minutes would throw away the catalogue exactly when it is needed
      /// most — the shop is offline and the cache is all there is.
      gcTime: 24 * 60 * 60_000,
      /// Cache first, network second, and never a request that hangs forever
      /// because the browser thinks it is offline. `offlineFirst` is what makes
      /// a read serve what it holds instead of sitting in a paused state with a
      /// blank screen behind it.
      networkMode: "offlineFirst",
      refetchOnWindowFocus: false,
      /// A refusal the node reasoned about will say the same thing again, and
      /// retrying only delays showing the sentence. A dropped connection might
      /// not — `worthRetrying` names exactly that difference.
      retry: (failures, error) =>
        error instanceof ApiError
          ? error.worthRetrying && failures < 2
          : failures < 2,
    },
    mutations: {
      /// The app-wide default, and it is the right one for every write except
      /// one. A receipt, a movement, a password change: if the node refuses,
      /// the person standing there needs the reason, not four more attempts.
      ///
      /// The exception is a sale, and it does not use this. `lib/sale-queue.ts`
      /// takes it over completely — a completed sale is written to disk with
      /// its idempotency key before anything is sent, and the retrying is a
      /// durable job rather than a property of a request. See the comment on
      /// `shouldRetry` there for why "show the error" is not an option when the
      /// alternative is money taken with no record of it.
      retry: false,
      networkMode: "offlineFirst",
    },
  },
})
