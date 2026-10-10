import { PageContent } from "@/components/shell/app-shell"
import { PageFoot } from "@/screens/people/settings-kit"
import { useLayout } from "@/lib/layout"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { useCanWrite } from "@/lib/session"
import { EssModulesList } from "@/screens/people/employee-app"
import { useSheetTarget } from "@/screens/people/settings-hooks"

/// Settings › Employee app: which parts of the employee app the company uses.
export function EmployeeAppSettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const edit = useSheetTarget<null>()
  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Employee App"
        sub="Which parts of the employee app are switched on."
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => edit.show(null)}>
              Edit
            </Button>
          )
        }
      />
      <EssModulesList edit={edit} />
      {canWrite && <PageFoot label="Edit" onClick={() => edit.show(null)} />}
    </PageContent>
  )
}
