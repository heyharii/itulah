import { QueryClient } from "@tanstack/react-query"

import { ApiError } from "@itulah/contract/client"

/// One client for the whole app.
///
/// It lives in its own module rather than in `main.tsx` because something other
/// than a component needs it: `lib/outbox.ts` settles a write outside any React
/// tree — after a reload, while the phone is in a pocket, off a timer — and when
/// it does, the queue a station is looking at has changed. An outbox that could
/// not say so would leave a picking screen showing a line somebody already
/// picked.
///
/// The defaults below are the offline posture, and every one of them differs
/// from the hub's for the same reason: this app has to keep working in a gangway
/// where the wifi does not reach.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /// **Short, but not zero.** The hub can refetch on a whim; a phone on a
      /// floor cannot, and thirty seconds is what the warehouse console already
      /// settled on for its own badges. Long enough that walking between two
      /// screens does not re-ask, short enough that the picklist somebody else
      /// just emptied stops being offered.
      staleTime: 30_000,
      /// A day. `gcTime` is what decides whether a cached answer is still there
      /// after a phone has been in a pocket since the morning, and the default
      /// five minutes would throw the work list away exactly when it is needed
      /// most — the floor is offline and the cache is all there is.
      gcTime: 24 * 60 * 60_000,
      /// Cache first, network second, and never a request that hangs forever
      /// because the browser thinks it is offline. `offlineFirst` is what makes
      /// a read serve what it holds instead of sitting in a paused state with a
      /// blank screen behind it.
      networkMode: "offlineFirst",
      refetchOnWindowFocus: true,
      /// A refusal the node reasoned about will say the same thing again, and
      /// retrying only delays showing the sentence. A dropped connection might
      /// not — `worthRetrying` names exactly that difference.
      retry: (failures, error) =>
        error instanceof ApiError
          ? error.worthRetrying && failures < 2
          : failures < 2,
    },
    mutations: {
      /// The app-wide default, and it is right for every write that is a
      /// decision somebody is standing there waiting on: a password change, a
      /// truck departing. If the node refuses, they need the reason, not four
      /// more attempts.
      ///
      /// The exception is every write the floor makes against goods — a count,
      /// a verification, a pick, a pack, a tagging confirmation. Those do not
      /// use this at all: `lib/outbox.ts` takes them over, writes them to disk
      /// with their idempotency key before anything is sent, and retries as a
      /// durable job. See the comment on `shouldRetry` there for why "show the
      /// error" is not an option when the alternative is work done on the floor
      /// that no record exists of.
      retry: false,
      networkMode: "offlineFirst",
    },
  },
})
