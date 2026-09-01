/**
 * Reading the session's capabilities from a screen.
 *
 * `useCan` is for a control that should be **disabled with a reason** — the
 * user can see the action exists and why it is not theirs. For an affordance
 * that should not be offered at all, use `<Can>` in `./can`.
 *
 * Prefer `useCan` when the action is one a colleague could plausibly perform,
 * and `<Can>` when its mere presence would be noise.
 *
 * Neither is a security boundary. See `./capability.ts` for what these can and
 * cannot promise, and why an unknown permission list allows.
 */

import { useMemo } from "react"

import { useAuth } from "@/lib/auth"
import {
  checkCapability,
  checkEveryCapability,
  checkSomeCapability,
  type CapabilitySet,
  type CapabilityVerdict,
} from "./capability"

/** How several codes combine. `every` is an AND, `some` is an OR. */
export type CapabilityMode = "every" | "some"

/** The signed-in session's capabilities, or `null` when nobody is signed in. */
export function useCapabilities(): CapabilitySet | null {
  const { user } = useAuth()

  return useMemo(
    () => (user ? { codes: user.permissions, role: user.role } : null),
    [user]
  )
}

export interface UseCanOptions {
  mode?: CapabilityMode
}

/**
 * Decide a capability for the current session.
 *
 * ```tsx
 * const settle = useCan("finance.settle")
 * <Button disabled={!settle.allowed} title={settle.reason}>Settle</Button>
 * ```
 */
export function useCan(
  capability: string | readonly string[],
  options: UseCanOptions = {}
): CapabilityVerdict {
  const set = useCapabilities()
  const { mode = "every" } = options

  /* `capability` is very often a fresh array literal at the call site, so the
   * dependency is its joined form rather than its identity — otherwise this
   * recomputes on every render of every screen that passes a list inline. */
  const key = Array.isArray(capability) ? capability.join(" ") : capability

  return useMemo(() => {
    if (typeof capability === "string") return checkCapability(set, capability)
    const list = capability as readonly string[]
    return mode === "some"
      ? checkSomeCapability(set, list)
      : checkEveryCapability(set, list)
    // `key` stands in for `capability`'s contents; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, key, mode])
}
