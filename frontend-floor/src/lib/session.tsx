import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { auth, cacheKey, node } from "@/lib/api"
import { ApiError, type Identity } from "@itulah/contract/client"

/// Where the last answer to "who is signed in" is kept.
///
/// **This is what makes a reload in a dead spot survivable.** The session lives
/// in a cookie, and the cookie is still in the browser when the node cannot be
/// reached — but `/auth/me` cannot say so, because asking it is the very thing
/// that failed. Without a note of the last answer, a picker who reloads in a
/// gangway is shown a login box they cannot pass, on top of an outbox full of
/// work they cannot see.
///
/// `localStorage` and not `sessionStorage`, unlike the hub's warehouse token: a
/// phone reloads and is reopened all day, and a tab is not a shift here. It is a
/// name and a role, never a credential.
const REMEMBERED = "floor.identity.v1"

function remember(person: Identity | null): void {
  try {
    if (person === null) localStorage.removeItem(REMEMBERED)
    else localStorage.setItem(REMEMBERED, JSON.stringify(person))
  } catch {
    // A locked-down profile. The app still works for as long as this page lives.
  }
}

function remembered(): Identity | null {
  try {
    const raw = localStorage.getItem(REMEMBERED)
    return raw === null ? null : (JSON.parse(raw) as Identity)
  } catch {
    return null
  }
}

/// Who is signed in, asked of the node rather than tracked by hand.
///
/// Three answers, not two, and a caller has to keep them apart. `isPending` is
/// "we have not asked yet" and must not put a login box in front of somebody
/// already signed in. `null` is "sign in". An error is a node that could not be
/// reached at all. So a lapsed session resolves to `null` rather than throwing:
/// `needsSignIn` is an answer, and dressing it as a failure puts an error
/// message on the login box about the very thing the box fixes.
///
/// The fourth case is this app's own: **the node did not answer at all.** Then
/// the last known person is used, because the cookie that authenticated them has
/// not gone anywhere — and the moment the network returns, `refetchOnReconnect`
/// asks again for real. If that fresh answer is `needsSignIn`, the note is torn
/// up and the login box appears then, with a node that can actually take a
/// password.
export function useIdentity() {
  return useQuery({
    queryKey: cacheKey.me(),
    queryFn: async ({ signal }): Promise<Identity | null> => {
      try {
        const person = await auth.me(signal)
        remember(person)
        return person
      } catch (error) {
        if (error instanceof ApiError && error.needsSignIn) {
          remember(null)
          return null
        }
        const held = remembered()
        if (held !== null) return held
        throw error
      }
    },
    // A second attempt with the same cookie cannot answer differently.
    retry: false,
    // Asked once and then believed. A session does not lapse because a screen
    // remounted, and re-asking would put a sign-in check in front of somebody
    // half way through a count.
    staleTime: Infinity,
    // The one exception, and the reason it is `"always"` rather than `true`:
    // `staleTime: Infinity` would otherwise suppress it, and this is exactly the
    // moment the answer above may have been a guess.
    refetchOnReconnect: "always",
  })
}

/// Which node this phone is talking to, and which site it is standing in.
///
/// Named under the login box as a courtesy — a phone pointed at a shop's till
/// node, or at the centre, should say so plainly rather than offering a Picking
/// tab that will be refused — so failing to fetch it is not a sign-in problem
/// and must not be reported as one, hence `null` on any failure.
export function useNodeIdentity() {
  return useQuery({
    queryKey: cacheKey.identity(),
    queryFn: ({ signal }) => node.identity({ signal }).catch(() => null),
    staleTime: Infinity,
  })
}

/// Who to write on a decision.
///
/// Every write on this surface names an actor, and it is a *person* — the count
/// and the verification of one delivery must be two different ones, and the node
/// enforces it. So this is the signed-in username and nothing else; a fallback
/// of "api" would be a way for two steps of that ceremony to be performed by the
/// same nobody.
///
/// A node with authentication switched off answers everybody, and on such a node
/// there is no person to name. `"floor"` is written instead of an invented name,
/// so the ledger says plainly that this node was not asking — and so that the
/// two halves of the receiving ceremony are visibly one nobody rather than two
/// plausible-looking people.
export function useActor(): string {
  return useIdentity().data?.username ?? "floor"
}

/// Ending the session, from wherever the button is.
///
/// `onSettled` rather than `onSuccess`: whatever the node said — including
/// nothing at all, because the network went away — this browser is done with the
/// session, and leaving somebody signed in because the sign-out request failed
/// is the wrong way round.
export function useSignOut() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => auth.logout(),
    onSettled: () => {
      client.setQueryData<Identity | null>(cacheKey.me(), null)
      remember(null)
      // And every answer fetched under it. Not `client.clear()`, which would
      // throw away the `null` just written and send the login screen off to ask
      // `/auth/me` again; the two session keys are the short list, so everything
      // else goes.
      client.removeQueries({
        predicate: (query) =>
          query.queryKey[0] !== cacheKey.me()[0] &&
          query.queryKey[0] !== cacheKey.identity()[0],
      })
    },
  })
}

/// Changing the password of whoever is signed in.
///
/// **This ends the session.** `edge/http.rs::change_password` answers through
/// `cleared_auth_response`, which clears the session and the CSRF cookie and
/// says so in the body (`signed_out: true`). Treating it as an ordinary write
/// would leave somebody looking at a warehouse they can no longer write to, and
/// the first thing they pressed would be a 403 with no explanation.
///
/// Not on `Auth` in `@itulah/contract` — that client covers login, logout and
/// `me`, and the contract package is generated and must not be edited — so the
/// path is written once here rather than at the call site.
export function useChangePassword() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { current: string; next: string }) =>
      node.post<{ changed: boolean; signed_out: boolean }>(
        "/api/v1/auth/change-password",
        { current_password: input.current, new_password: input.next },
      ),
    onSuccess: (answer) => {
      if (answer.signed_out) {
        client.setQueryData<Identity | null>(cacheKey.me(), null)
        remember(null)
      }
    },
  })
}
