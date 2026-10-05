import { createElement, createContext, useContext, useMemo } from "react"
import type { ReactNode } from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query"

import { cacheKey, node } from "@/lib/api"
import { ApiError } from "@itulah/contract/client"

/// A sandbox server's one business: a slug for the URL and a cookie, a name
/// for the screen. Nothing else about it is this app's business before
/// somebody has signed in to it.
export interface TenancyBusiness {
  readonly slug: string
  readonly name: string
}

/// `GET /api/v1/tenancy`'s own shape. Anything that does not answer with
/// `mode: "sandbox"` — a 401, a 404, a normal server's `{}` — is read as "this
/// is not a sandbox at all" by `getTenancy` below, never as a fault.
interface TenancyAnswer {
  readonly mode: string
  readonly business: TenancyBusiness | null
  readonly invite_required: boolean
}

/// What every screen in this app needs to know about tenancy, boiled down to
/// two shapes. A production, single-business server has none of this
/// machinery — `mode: "single"` is the whole answer, and the rest of the hub
/// runs exactly as it always has.
export type TenancyState =
  | { readonly mode: "single" }
  | {
      readonly mode: "sandbox"
      readonly business: TenancyBusiness | null
      readonly inviteRequired: boolean
    }

const SINGLE: TenancyState = { mode: "single" }

/// One key, read by the provider below and by anything that needs to force a
/// refetch after a select/create/leave — `useLeaveBusiness` and the business
/// link in the address bar (`App.tsx`).
export const tenancyQueryKey = ["tenancy"] as const

/// `GET /api/v1/tenancy`, normalised: anything that is not a 2xx answer with
/// `mode: "sandbox"` reads as `{ mode: "single" }` rather than as a fault —
/// see `TenancyAnswer` above for why.
export async function getTenancy(signal?: AbortSignal): Promise<TenancyState> {
  try {
    const answer = await node.get<TenancyAnswer>("/api/v1/tenancy", { signal })
    if (answer.mode !== "sandbox") return SINGLE
    return {
      mode: "sandbox",
      business: answer.business,
      inviteRequired: answer.invite_required,
    }
  } catch {
    // Non-2xx — 401 or 404 on a normal server that has never heard of this
    // route — or the node being unreachable altogether. Every one of those
    // means "behave as today", not "something is wrong": a sandbox is opt-in
    // infrastructure and its absence is the default, not a failure.
    return SINGLE
  }
}

/// Whether an `/api/*` refusal is sandbox tenancy saying "sign in again", not
/// an ordinary failure. Two codes: `business_required` (nobody has chosen a
/// business yet) and `business_unknown` (the one that was chosen is gone —
/// the server also clears the cookie when it answers this). Either way the
/// right response is the same as a lapsed session: drop back to the door.
export function isTenancySignOut(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "business_required" || error.code === "business_unknown")
  )
}

export interface CreateBusinessRequest {
  readonly business_name: string
  readonly owner_name: string
  readonly username: string
  readonly password: string
  readonly invite_code: string | null
}

/// Creates a new business on a sandbox server. Takes a few seconds — it
/// creates a database — and the response also sets the business cookie, so
/// the very next request (the ordinary sign-in call) already lands inside it.
export function createBusiness(
  request: CreateBusinessRequest,
  signal?: AbortSignal
): Promise<TenancyBusiness> {
  return node.post<TenancyBusiness>("/api/v1/tenancy/businesses", request, {
    signal,
  })
}

/// Points this browser at an existing business by its code. Ends whatever
/// session was open — a business is a different set of users entirely — so
/// the caller always follows this with the ordinary sign-in screen.
export function selectBusiness(
  slug: string,
  signal?: AbortSignal
): Promise<TenancyBusiness> {
  return node.post<TenancyBusiness>(
    "/api/v1/tenancy/select",
    { slug },
    { signal }
  )
}

/// Clears the business cookie and ends the session, if any. The caller always
/// follows this with the door — either shows it directly, or (`useLeaveBusiness`)
/// drops the local session cache first so the shell does not linger.
export function leaveBusiness(signal?: AbortSignal): Promise<void> {
  return node.post<void>("/api/v1/tenancy/leave", {}, { signal })
}

/// "Switch business" — from the door or from the signed-in shell alike. The
/// server clears both the cookie and the session in one response, so the
/// local cache is dropped to match rather than waited on: a stale `me` would
/// keep the shell up for one more paint after the browser is no longer
/// pointed at any business at all.
export function useLeaveBusiness(): UseMutationResult<void, ApiError, void> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => leaveBusiness(),
    onSuccess: () => {
      client.setQueryData(cacheKey.me(), null)
      void client.invalidateQueries({ queryKey: tenancyQueryKey })
    },
  })
}

// An intersection, not `interface ... extends TenancyState`: an interface
// cannot extend a union, and `TenancyState` is one.
type TenancyContextValue = TenancyState & {
  readonly isPending: boolean
  readonly refresh: () => Promise<void>
}

const TenancyContext = createContext<TenancyContextValue | null>(null)

/// Fetched once, at the root, and shared — asked about the way `useIdentity`
/// asks about a session, and believed the same way, until something (create,
/// select, leave) changes the answer.
export function TenancyProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: tenancyQueryKey,
    queryFn: ({ signal }) => getTenancy(signal),
    staleTime: Infinity,
    retry: false,
  })

  const state = query.data ?? SINGLE
  const value = useMemo<TenancyContextValue>(() => {
    const isPending = query.isPending
    const refresh = () =>
      client.invalidateQueries({ queryKey: tenancyQueryKey })
    // Built per-branch rather than `{...state, isPending, refresh}`: a spread
    // of a union widens `mode` to `string`, which is exactly the literal type
    // every caller below switches on.
    return state.mode === "sandbox"
      ? {
          mode: "sandbox",
          business: state.business,
          inviteRequired: state.inviteRequired,
          isPending,
          refresh,
        }
      : { mode: "single", isPending, refresh }
  }, [state, query.isPending, client])

  // Not JSX: this file stays `.ts` so it can sit beside the fetchers it
  // provides rather than forcing every caller through a `.tsx` import for what
  // is, underneath, one `useQuery`.
  return createElement(TenancyContext.Provider, { value }, children)
}

export function useTenancy(): TenancyContextValue {
  const value = useContext(TenancyContext)
  if (value === null) {
    throw new Error("useTenancy must be used within a TenancyProvider")
  }
  return value
}
