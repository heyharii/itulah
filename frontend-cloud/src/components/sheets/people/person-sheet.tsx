import { PersonPanel } from "@/components/people/person-panel"
import { SheetShell } from "@/components/sheets/sheet-shell"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { employeeKey, readEmployee, statusLabel } from "@/lib/employment"
import { usePersonSheet } from "@/lib/sheets/people"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"

/// One person's record, opened over the list somebody searched to find them.
///
/// This was `/people/$employeeId`. Reading a record is far commoner than
/// changing one — a supervisor checking whether somebody is still on
/// probation, a buyer working out who raised an order — and as a route each of
/// those readings cost the search that found the name.
///
/// The three tabs stay tabs. They are three views of one record rather than
/// three places, and the sheet does not change that; what it changes is that
/// the personal-data tab's separate grant is now something you can be refused
/// without having left the list.
export function PersonSheet({ rows }: { rows: readonly string[] }) {
  const sheet = usePersonSheet()
  const employeeId = sheet.employeeId
  const employee = useQuery({
    queryKey: employeeKey(employeeId ?? ""),
    queryFn: ({ signal }) => readEmployee(employeeId ?? "", signal),
    enabled: employeeId !== null,
  })
  const person = employee.data

  return (
    <SheetShell
      open={employeeId !== null}
      onClose={sheet.close}
      title={
        person === undefined ? (
          <Skeleton className="h-4 w-24" />
        ) : (
          <span className="font-mono">{person.employee_code}</span>
        )
      }
      subtitle={person === undefined ? undefined : statusLabel(person.status)}
      description="One employment record: the job, the contracts behind it, and the identity documents if you may read them."
      rows={rows}
      current={employeeId}
      onMove={sheet.open}
      className="sm:max-w-2xl"
    >
      {employee.isError ? (
        <div className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-xs text-destructive">
            {employee.error instanceof ApiError
              ? employee.error.message
              : "The record could not be loaded."}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void employee.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : person === undefined ? (
        <p className="p-10 text-center text-xs text-muted-foreground">
          Loading the record…
        </p>
      ) : (
        // Keyed by the person, so moving to the next record opens on
        // Employment rather than on whichever tab the last one was left on —
        // and, more to the point, never carries a personal-data tab from a
        // record you were allowed to read onto one you are not.
        <PersonPanel key={person.employee_id} person={person} />
      )}
    </SheetShell>
  )
}
