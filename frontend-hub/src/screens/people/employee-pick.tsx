import { PickOne } from "@/components/ui/pick"
import { useEveryEmployee } from "@/lib/queries/hr-employees"

/// Choose somebody on the books, by typing at their name or code.
///
/// The one picker the Employees pages share — Place someone, New change,
/// Start onboarding, Issue letter. `statuses` narrows who is offered (a
/// leaver has nothing to be placed in); `exclude` takes away people the action
/// has already been done for.
export function EmployeePick({
  value,
  onChange,
  statuses,
  exclude,
  label = "Employee",
}: {
  value: string | null
  onChange: (employeeId: string | null) => void
  statuses?: readonly string[]
  exclude?: ReadonlySet<string>
  label?: string
}) {
  const people = useEveryEmployee()
  const choices = (people.data ?? [])
    .filter(
      (person) =>
        (statuses === undefined || statuses.includes(person.status)) &&
        !(exclude?.has(person.employee_id) ?? false)
    )
    .map((person) => ({
      value: person.employee_id,
      label: `${person.full_name ?? person.employee_code} · ${person.employee_code}`,
    }))
  return (
    <PickOne
      label={label}
      placeholder={people.isPending ? "Loading…" : "Choose someone…"}
      choices={choices}
      value={value}
      onChange={onChange}
      required
    />
  )
}
