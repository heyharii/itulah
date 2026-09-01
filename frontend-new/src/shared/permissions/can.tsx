/**
 * Render an affordance only when the session may use it.
 *
 * The companion to `useCan`: this one removes the control rather than
 * disabling it, so reach for it when a disabled button would be noise rather
 * than information. Not a security boundary — see `./capability.ts`.
 */

import type { ReactNode } from "react"

import { useCan, type CapabilityMode } from "./use-can"

export interface CanProps {
  /** A permission code, or several. */
  do: string | readonly string[]
  /** How to combine several codes. Default `every`. */
  mode?: CapabilityMode
  children: ReactNode
  /** Rendered instead when the session does not hold it. Default: nothing. */
  fallback?: ReactNode
}

/**
 * ```tsx
 * <Can do="inventory.adjust">
 *   <Button onClick={openAdjustment}>Adjust stock</Button>
 * </Can>
 * ```
 */
export function Can({ do: capability, mode, children, fallback = null }: CanProps) {
  const verdict = useCan(capability, { mode })
  return <>{verdict.allowed ? children : fallback}</>
}
