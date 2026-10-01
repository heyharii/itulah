import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { useCanWrite } from "@/lib/session"
import { EssModulesList } from "@/screens/people/employee-app"
import { useSheetTarget } from "@/screens/people/settings-hooks"

/// Settings › Employee app: which parts of the employee app the company uses.
export function EmployeeAppSettings() {
  const canWrite = useCanWrite()
  const edit = useSheetTarget<null>()
  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Employee app"
        sub="Which parts of the employee app are switched on."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => edit.show(null)}>
              Edit
            </Button>
          )
        }
      />
      <EssModulesList edit={edit} />
    </PageContent>
  )
}
