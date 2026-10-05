import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { SetupWorkspace } from "@/screens/procurement/setups"

/// New articles — goods that arrived without an identity, named here. The
/// page is the work area: one ledger of the waiting lines, a supplier at a
/// time, and the form in a sheet a row opens.
export function NewArticles() {
  return (
    <PageContent>
      <PageHeader title="New Articles" small />
      <SetupWorkspace />
    </PageContent>
  )
}
