import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { MissingList } from "@/screens/inventory/missing-list"

/// Stock the ledger cannot find, by article and pool, oldest first. Found goes
/// back on hand (Move); what will not turn up is written off through a Stock
/// Adjustment.
export function Missing() {
  return (
    <PageContent>
      <PageHeader crumb="Inventory" title="Missing" />
      <MissingList canWriteOff />
    </PageContent>
  )
}
