/**
 * The UI's authorization layer — a courtesy over Go's enforcement.
 *
 * `AuthUser.permissions` has been fetched and read by nothing since the first
 * audit (docs/tanstack-gap-plan.md §Wave 3). This is the half of that gap that
 * can be closed today: `useCan` for a disabled control with a reason, `<Can>`
 * for an affordance that should not be offered.
 *
 * ## What is deliberately missing: `requireCapability()` for `beforeLoad`
 *
 * The plan also asks for a route guard that throws `redirect` on a missing
 * capability, so an unauthorized user never loads the route's chunk. That
 * cannot be built yet, and the reason is structural rather than a matter of
 * effort:
 *
 * `beforeLoad` runs inside the router and can only read `RouterContext`, which
 * holds `queryClient` and nothing else (`routes/__root.tsx`). The session
 * lives in React state inside `AuthProvider`, which is mounted **below**
 * `RouterProvider` — inside the root route's own component. So at the moment
 * `beforeLoad` runs, there is no session for it to consult, and no amount of
 * helper code here changes that.
 *
 * Closing it means one of:
 *
 *   1. Lift `AuthProvider` above `RouterProvider` in `main.tsx` and put the
 *      session on `RouterContext`, or
 *   2. Make the session a Query (`STALE.session` already exists for exactly
 *      this) so `beforeLoad` can read it through `context.queryClient`.
 *
 * (2) fits the estate better — the stale class is already defined and named
 * for it, and it would make the session invalidatable on login/logout/role
 * change the way rule C1 describes. Both are a change to how the app boots,
 * which is not a thing to do unattended.
 *
 * Until then a route cannot be guarded, and gating one on a hand-written
 * capability map would be worse than not gating it: the codes are minted by
 * the hub's permission catalogue and none of them appear anywhere in this
 * codebase, so every one would be a guess that silently allows.
 */

export {
  checkCapability,
  checkEveryCapability,
  checkSomeCapability,
  type CapabilitySet,
  type CapabilityVerdict,
} from "./capability"
export {
  useCan,
  useCapabilities,
  type CapabilityMode,
  type UseCanOptions,
} from "./use-can"
export { Can, type CanProps } from "./can"
