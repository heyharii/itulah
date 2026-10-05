import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { SetupWorkspace } from "@/screens/procurement/setups"

/// New articles — goods that arrived without an identity, named here. The
/// page is the work area: POs on a rail, one card per waiting line
/// beside it, and the form in a sheet a card opens.
export function NewArticles() {
  return (
    <PageContent>
      <PageHeader title="New articles" />
      <SetupWorkspace />
    </PageContent>
  )
}
