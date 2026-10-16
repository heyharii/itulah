import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"

import { auth, cacheKey, edge, edgeAuth, setEdgeToken } from "@/lib/api"
import { forgetPushOnSignOut } from "@/lib/push"
import type { SectionCode } from "@/lib/queries/invitations"
import { isTenancySignOut, tenancyQueryKey } from "@/lib/tenancy"
import { ApiError, type Identity } from "@itulah/contract/client"

/// Who was signed in when this device last heard from the server.
///
/// Only so that a device with no connection can still open the app: the shell
/// is on the device already (the service worker), and `/auth/me` is the one
/// question it cannot answer by itself. It holds who they are, not how they
/// got in — no password, no token, nothing the server would accept — and it is
/// removed the moment the server says nobody is signed in, or they sign out.
const IDENTITY_KEY = "itulah.identity.v1"

function rememberedIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY)
    return raw === null ? null : (JSON.parse(raw) as Identity)
  } catch {
    return null
  }
}

/// Set when the identity on screen is the remembered one: the server has not
/// been asked yet, so the next connection must ask.
let fromMemory = false

/// Keep the remembered identity in step with the one the app holds, and ask
/// the server again as soon as there is a connection if the app is standing on
/// the remembered one. Called once, from `main.tsx`.
export function watchIdentity(client: QueryClient): void {
  client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.query.queryKey[0] !== "auth") return
    if (event.query.queryKey[1] !== "me") return
    const me = event.query.state.data as Identity | null | undefined
    if (me === undefined) return
    try {
      if (me === null) localStorage.removeItem(IDENTITY_KEY)
      else localStorage.setItem(IDENTITY_KEY, JSON.stringify(me))
    } catch {
      // Private window or a full device: the app works, it just cannot open
      // offline next time.
    }
  })
  window.addEventListener("online", () => {
    if (!fromMemory) return
    void client.invalidateQueries({ queryKey: cacheKey.me() })
  })
}

/// Who is signed in, asked of the server rather than tracked by hand.
///
/// Three answers, not two, and a caller has to keep them apart. `isPending` is
/// "we have not asked yet" and must not put a login box in front of somebody
/// already signed in. `null` is "sign in". An error is a node that could not be
/// reached at all. So a lapsed session resolves to `null` rather than throwing:
/// `needsSignIn` is an answer, and dressing it as a failure puts an error
/// message on the login box about the very thing the box fixes.
/// Asked once and then believed. A session does not lapse because a screen
/// remounted, and re-asking would put a sign-in check in front of somebody
/// half way through writing an order.
///
/// Options rather than only a hook, so the SSR pass can `ensureQueryData`
/// before the first paint (`routes/__root.tsx`): the gate then renders the
/// door — or the shell — directly in HTML instead of a skeleton that flips.
export function identityQueryOptions() {
  return {
    queryKey: cacheKey.me(),
    queryFn: async ({
      signal,
      client,
    }: {
      signal?: AbortSignal
      client: QueryClient
    }): Promise<Identity | null> => {
      try {
        // On the server `auth` carries the request's cookie (`lib/api.ts`);
        // the 401 a stranger gets is the honest "nobody" below.
        const me = await auth.me(signal)
        fromMemory = false
        return me
      } catch (error) {
        if (error instanceof ApiError && error.needsSignIn) return null
        // The server could not be reached (`reach()` says so as a 503) and
        // this device knows who was signed in: open the app as them. Their
        // work is held on the device until there is a line, and the first
        // connection asks properly (`watchIdentity`). The browser-only half
        // (`navigator.onLine`) is guarded: the SSR pass has no navigator and
        // no remembered identity, so it just reports the failure.
        if (
          error instanceof ApiError &&
          error.status === 503 &&
          ((typeof navigator !== "undefined" && !navigator.onLine) ||
            /reach the server/i.test(error.message))
        ) {
          if (typeof window === "undefined") throw error
          const last = rememberedIdentity()
          if (last !== null) {
            fromMemory = true
            return last
          }
        }
        // Sandbox tenancy: nobody has chosen a business yet, or the one this
        // browser was pointed at is gone. Either reads as "sign in again" —
        // `App` shows the door or the chooser, never an error screen — and
        // the tenancy answer is asked again too, since `business_unknown`
        // means the server just cleared the cookie behind this response.
        if (error instanceof ApiError && isTenancySignOut(error)) {
          void client.invalidateQueries({ queryKey: tenancyQueryKey })
          return null
        }
        throw error
      }
    },
    // A second attempt with the same cookie cannot answer differently.
    retry: false,
    staleTime: Infinity,
  }
}

export function useIdentity() {
  const client = useQueryClient()
  return useQuery(identityQueryOptions())
}

/// The job role and section grants `/auth/me` carries beyond the rung every
/// `Identity` already has (`role`, CASHIER/SUPERVISOR/ADMIN — a different
/// ladder; see `screens/system/users.tsx`).
///
/// Read off the answer rather than typed onto `Identity` itself: that type is
/// generated from the Rust response (`@itulah/contract`) by a backend change
/// landing alongside this one, so it is widened here instead of edited there.
/// A node that predates the change simply answers without these fields, which
/// is why every reader below treats them as absent rather than as a fault —
/// see the fail-open default on `useSections`.
export interface JobIdentity {
  readonly role_code: string
  readonly role_name: string
  readonly sections: readonly SectionCode[]
  /// GET only: the auditor's. The authoritative signal for `useCanWrite` —
  /// a role's own flag, not this app guessing from its code.
  readonly read_only: boolean
}

/// The job role on an already-fetched identity, or nothing for a node that
/// does not answer with one yet.
export function jobRoleOf(identity: Identity | null | undefined): {
  code: string | null
  name: string | null
} {
  const wide = identity as (Identity & Partial<JobIdentity>) | null | undefined
  return { code: wide?.role_code ?? null, name: wide?.role_name ?? null }
}

/// Whoever's role is not read-only may write. `true` while the signed-in
/// identity has not answered yet, or does not carry a job role at all — a
/// control must not blink into existence disabled and then enable itself
/// once the second request lands, and a node that predates roles never
/// means to lock every button in the app.
export function useCanWrite(): boolean {
  const identity = useIdentity()
  const wide = identity.data as (Identity & Partial<JobIdentity>) | null
  return wide?.read_only !== true
}

/// The sections the signed-in role holds, and whether it is one of the two
/// that hold all of them regardless of what the server lists.
///
/// `bypass` is also true while the identity has not answered, or answers
/// without a job role — the sidebar hides a section it can name a caller
/// does NOT hold; it does not lock the whole menu because a field is not
/// there yet.
export function useSections(): {
  sections: readonly SectionCode[]
  bypass: boolean
} {
  const identity = useIdentity()
  const { code } = jobRoleOf(identity.data)
  const wide = identity.data as (Identity & Partial<JobIdentity>) | null
  return {
    sections: wide?.sections ?? [],
    bypass: code === null || code === "OWNER" || code === "ADMIN",
  }
}

/// The node's own identity — the sign-in door's status dot and the tenancy
/// gate both read it (`lib/node-identity.ts`, where it lives so the two
/// modules that need it do not import each other).
export { useNodeIdentity } from "@/lib/node-identity"

/// Ending the session, from wherever the button is.
///
/// `onSettled` rather than `onSuccess`: whatever the server said — including
/// nothing at all, because the network went away — this browser is done with
/// the session, and leaving somebody signed in because the sign-out request
/// failed is the wrong way round.
export function useSignOut() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      // Revoke the local DC session while its bearer is still available. A
      // disconnected DC must not prevent the Cloud sign-out from completing.
      const edgeLogout = edge.hasBearer
        ? edgeAuth.logout().catch(() => undefined)
        : Promise.resolve()
      // This browser stops being woken for this person, and first — the
      // server only removes a subscription for the session that owns it.
      // Never throws; see `lib/push.ts` for why a shared tablet needs it.
      await forgetPushOnSignOut()
      await Promise.all([auth.logout(), edgeLogout])
    },
    onSettled: () => {
      setEdgeToken(null)
      client.setQueryData<Identity | null>(cacheKey.me(), null)
      // And every answer fetched under it — an order book, a ledger, somebody's
      // employment record — none of which the next person at this desk is
      // entitled to see. Not `client.clear()`, which would throw away the
      // `null` just written and send the login screen off to ask `/auth/me`
      // again; the two session keys are the short list, so everything else goes.
      client.removeQueries({
        predicate: (query) =>
          query.queryKey[0] !== cacheKey.me()[0] &&
          query.queryKey[0] !== cacheKey.identity()[0],
      })
    },
  })
}

/// Why the last session here ended, when it was ended from somewhere else.
///
/// Kept in `sessionStorage` so it survives the reload an operator reaches for
/// when a screen goes blank, and read once by the login box.
const PUSHED_OUT = "itulah.signed-out-elsewhere"

export function markSignedOutElsewhere() {
  try {
    sessionStorage.setItem(PUSHED_OUT, "1")
  } catch {
    // Storage blocked: the login box simply appears without the reason.
  }
}

/// The sentence the login box shows, or null — and forgets it once read by a
/// successful sign-in (`clearSignedOutElsewhere`).
export function signedOutElsewhere(): string | null {
  try {
    return sessionStorage.getItem(PUSHED_OUT) === null
      ? null
      : "You were signed out because this account signed in on another device."
  } catch {
    return null
  }
}

export function clearSignedOutElsewhere() {
  try {
    sessionStorage.removeItem(PUSHED_OUT)
  } catch {
    // Nothing to clear.
  }
}
