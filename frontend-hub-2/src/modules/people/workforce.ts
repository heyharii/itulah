import { useMemo } from "react"
import type { EmployeeList, EmployeeSummary } from "@itulah/contract"

import { useReport } from "@/lib/list"

/// The workforce as a lookup table, for the queues that carry a foreign key.
///
/// ## Why two screens need this at all
///
/// `LeaveRequestView` and `OvertimeOrderView` both identify somebody by
/// `employee_id` and nothing else — no number, no name. A queue of UUIDs is a
/// queue nobody can triage, so both screens read the workforce alongside and
/// join in the browser.
///
/// It is a stand-in for two fields that should be on the wire, and it is
/// written so its failure is VISIBLE rather than silent: a person this read did
/// not reach keeps their id on the row and `Person` says the name was not
/// found, instead of drawing a blank where a name should be. The real fix is a
/// name and a number on the queue row itself; see `Person` in `parts.tsx`.
///
/// ## Why it is a report and not a page
///
/// `GET /employees` now pages, and paging is the wrong tool here. A page is
/// what somebody reads; this is a dictionary something else is looked up in,
/// and a dictionary that arrives a page at a time would draw a queue whose
/// names fill in row by row. So it asks for the ceiling in one request and
/// reads `rows` off the envelope.
///
/// The cap is the endpoint's own maximum. It is real and it is not concealed:
/// past a thousand employees this lookup starts missing people, and the row it
/// misses says so. Fixing it properly means putting the name on the queue, not
/// raising the number.
const CEILING = 1000

export function useWorkforceIndex() {
  // Deliberately NOT the Directory's cache key. That key carries a search
  // term, a tab, a sort and a page size, so sharing it would make this lookup
  // depend on what somebody last typed into a box on another screen.
  const list = useReport<EmployeeList>({
    key: ["people", "workforce-index"],
    path: "/api/v1/employees",
    params: { limit: CEILING },
  })

  const byId = useMemo(() => {
    const map = new Map<string, EmployeeSummary>()
    for (const person of list.data?.rows ?? [])
      map.set(person.employee_id, person)
    return map
  }, [list.data])

  return byId
}
