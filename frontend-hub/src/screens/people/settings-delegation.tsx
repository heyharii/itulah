import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { useCanWrite } from "@/lib/session"
import { DelegationsList } from "@/screens/people/employee-app"
import { useSheetTarget } from "@/screens/people/settings-hooks"

/// Settings › Approval delegation: who is deciding leave, claims and
/// attendance corrections in somebody else's place, and until when.
export function DelegationSettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const handOver = useSheetTarget<null>()
  return (
    <PageContent>
      {canWrite && (
        <Fab label="Hand over approvals" onClick={() => handOver.show(null)} />
      )}
      <PageHeader
        crumb="People"
        title="Approval Delegation"
        sub="Who decides leave, claims and corrections in someone else's place, and for how long."
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => handOver.show(null)}>
              Hand over approvals
            </Button>
          )
        }
      />
      <DelegationsList administrator handOver={handOver} />
    </PageContent>
  )
}
