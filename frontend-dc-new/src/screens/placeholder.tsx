import { useRouterState } from "@tanstack/react-router"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { allNavItems } from "@/lib/navigation"

/// A screen that is routed and navigable but not written yet.
///
/// It exists so the registry can be complete before the screens are: a nav
/// entry pointing at nothing is a broken app, and a nav entry quietly missing
/// is worse — nobody notices the endpoint has no home. This says which it is,
/// in the app, where it cannot be forgotten.
export function Placeholder() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const item = allNavItems.find((candidate) => candidate.path === pathname)

  return (
    <PageContent>
      <PageHeader
        crumb={item?.station.label}
        title={item?.label ?? "Not built yet"}
      />
      <EmptyState>
        This screen is routed but not written yet. It is listed in the
        navigation registry so the endpoints behind it cannot be forgotten.
      </EmptyState>
    </PageContent>
  )
}
