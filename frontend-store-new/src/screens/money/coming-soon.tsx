import { EmptyState } from "@/components/ui/states"
import { MoneyScreen } from "@/screens/money/parts"

/// Money › Reconciliation, parked (owner, 2 Oct 2026). The screen it replaces
/// is kept in `reconciliation.tsx` for when it comes back.
export function ReconciliationSoon() {
  return (
    <MoneyScreen>
      <EmptyState>Coming soon</EmptyState>
    </MoneyScreen>
  )
}
