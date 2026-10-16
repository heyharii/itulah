import { useQueryErrorResetBoundary } from "@tanstack/react-query"
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router"
import { useEffect } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, ErrorState } from "@/components/ui/states"

/// What a screen shows when its first data fails.
///
/// A screen reads its first data with a suspense query, so a refusal is thrown
/// to the route rather than drawn by the screen; this is where it lands, in the
/// shell, quoting the server's sentence. "Try again" resets the failed queries
/// and reloads the route, which asks once more.
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter()
  const queries = useQueryErrorResetBoundary()
  useEffect(() => {
    queries.reset()
  }, [queries])
  return (
    <PageContent>
      <ErrorState error={error} onRetry={() => void router.invalidate()} />
    </PageContent>
  )
}

/// An address no screen answers.
export function RouteNotFound() {
  return (
    <PageContent>
      <PageHeader title="Not found" />
      <EmptyState>Nothing lives at this address.</EmptyState>
    </PageContent>
  )
}
