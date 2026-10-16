import { useQuery } from "@tanstack/react-query"

import { cacheKey, node } from "@/lib/api"

/// Which node this surface is talking to. Named under the login box as a
/// courtesy, so failing to fetch it is not a sign-in problem and must not be
/// reported as one — hence `null` on any failure.
///
/// The node's own answer about itself — `GET /api/v1/health` — as query
/// options rather than a hook, so anything that must read it *without*
/// mounting a component can pull the same one query: the tenancy gate asks
/// `mode` (`single`/`sandbox`) from here instead of spending a round trip on
/// `/api/v1/tenancy` on every open (`lib/tenancy.ts`). One key, one fetch,
/// one answer — the sign-in door's status dot and the gate cannot disagree,
/// and cannot ask twice.
///
/// It lives beside neither of them because both read it: a module of its own
/// is what keeps `session.tsx` and `tenancy.ts` from importing each other.
export function nodeIdentityOptions() {
  return {
    queryKey: cacheKey.identity(),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      node.identity({ signal }).catch(() => null),
    staleTime: Infinity,
  }
}

/// The same, for components.
export function useNodeIdentity() {
  return useQuery(nodeIdentityOptions())
}
