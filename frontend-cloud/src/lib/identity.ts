import { auth } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"

/// Who is signed in, for the screens that have to put a name on a decision.
///
/// Closing a line short and answering a price amendment both record who did
/// it, and the server takes that as a field rather than reading it from the
/// session — so the screen has to supply it. It supplies the session's own
/// username and never a free-text box: a decision attributed to whoever typed
/// the nicest name is not an audit trail.
export function useIdentity() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: ({ signal }) => auth.me(signal),
    staleTime: 5 * 60_000,
  })
}
