/**
 * Owns the opt-in auth gate used by app shells. It keeps loading, anonymous,
 * two-factor, and backend-error states separate so a feature cannot render
 * stale protected data while the session is unresolved.
 */

import type { ReactNode } from "react"

import { useAuth } from "./provider"

export interface AuthBoundaryProps {
  children: ReactNode
  loading?: ReactNode
  unauthenticated?: ReactNode
  challenge?: ReactNode
  error?: (error: Error, retry: () => void) => ReactNode
}

export function AuthBoundary({
  children,
  loading = null,
  unauthenticated = null,
  challenge = null,
  error,
}: AuthBoundaryProps) {
  const auth = useAuth()

  if (auth.status === "loading") return <>{loading}</>
  if (auth.status === "anonymous") return <>{unauthenticated}</>
  if (auth.status === "challenge") return <>{challenge}</>
  if (auth.status === "error") {
    return <>{error?.(auth.error ?? new Error("Authentication failed"), auth.refresh)}</>
  }
  return <>{children}</>
}
