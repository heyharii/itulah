import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { CommercialTabs } from "@/screens/commercial/tabs"

/// Vouchers — value instruments, and the one tab here that is not pricing.
///
/// A voucher carries money. It is **tender**: it sits beside cash, a card and a
/// transfer at the counter, and it is spent rather than applied. The other three
/// tabs all answer "what does this cost"; this one answers "what did they pay
/// with". The engine says so itself, in `pricing-engine/src/lib.rs`: *a voucher
/// carries money. It is tender, not pricing.*
///
/// Keeping the distinction is not pedantry. The system this replaces filed both
/// under one voucher table — `percent_off` and `free_item` beside `stored_value`
/// — and the discount half of it is what this app already calls a **coupon**: a
/// code that unlocks a promotion, which never carries a balance. Only the
/// stored-value half belongs here.
///
/// There is nothing to list yet. No table, no route and no command in the
/// backend holds a voucher; `grep -ri voucher backend/` finds two comments and
/// no schema. So this screen says that plainly rather than showing an empty
/// table, which would imply the feature exists and simply has no rows — the
/// difference between "nobody has issued one" and "one cannot be issued".
export function Vouchers() {
  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Vouchers"
        sub="Value a customer already holds and can pay with. Not a price, and not a discount."
        actions={
          // Present and disabled, not absent. A missing button reads as a
          // screen somebody forgot to finish; a disabled one that says why
          // reads as a decision — and the reason is the whole point, because
          // issuing a voucher creates a liability the ledger has to carry.
          <Button
            variant="dark"
            disabled
            title="Issuing a voucher needs somewhere to record the balance, and the backend has no voucher table, route or command yet."
          >
            New voucher
          </Button>
        }
      />

      <CommercialTabs current="/commercial/vouchers" />

      <Card className="overflow-hidden">
        <EmptyState>
          Vouchers are not built yet. Nothing in the backend stores one — no
          table, no route, no command — so this is nothing to list rather than
          nothing issued, and “New voucher” is disabled rather than missing.
          Building it is three pieces, in this order: somewhere to hold a code
          and a balance, a command that issues one and books the liability, and
          a tender type at the till that redeems against it. The last is why
          this sits apart from the other three tabs — a voucher is paid *with*,
          where a price, a markdown and a promotion all describe what something
          costs.
        </EmptyState>
      </Card>
    </PageContent>
  )
}
