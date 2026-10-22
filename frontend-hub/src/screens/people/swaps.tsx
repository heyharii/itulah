import { useQuery } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { CardButton, CardName, PhoneCards } from "@/components/ui/phone-cards"
import { Status } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { nameOf, useEveryEmployee } from "@/lib/queries/hr-employees"
import { monthBounds, monthTitle } from "@/lib/queries/hr-time"
import { listSwaps, nextKeys, type RosterSwapView } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { statusWord } from "@/lib/words"
import { HrScope, useHrMonth, useUnitFilter } from "@/screens/people/parts"
import {
  SwapSheet,
  decisionTone,
  useUnitName,
  type SwapRow,
} from "@/screens/people/requests"

/// Schedules › Swaps — the day-swaps of one month, one row each: who asks, who
/// they would swap with, which day, why, and what became of it.
///
/// Every state is here (`GET /api/v1/roster-swaps`, inside the caller's
/// reach), the waiting ones first and then the earliest day: a swap that has
/// been decided is still the answer to who agreed to it. A row opens the same
/// sheet as the inbox's, with the decision on it.
///
/// Nothing here files a swap. It is the employee's act, from their own app,
/// over their own day.

const NO_SWAPS: RosterSwapView[] = []

/// A person's name by employee id, out of the workforce list the other HR
/// pages hold under the same key. Somebody the list does not carry is shown by
/// id rather than not shown.
function useEmployeeName(): (employeeId: string) => string {
  const people = useEveryEmployee()
  return (employeeId) => nameOf(people.data, employeeId)
}

/// The swaps with both people named: the waiting ones first, then the
/// earliest day (the server sends the newest day first).
function named(
  swaps: readonly RosterSwapView[],
  nameOfEmployee: (employeeId: string) => string
): SwapRow[] {
  return swaps
    .map((row) => ({
      ...row,
      name: nameOfEmployee(row.employee_id),
      withName: nameOfEmployee(row.with_employee_id),
    }))
    .sort(
      (a, b) =>
        Number(b.state === "PENDING") - Number(a.state === "PENDING") ||
        a.on_date.localeCompare(b.on_date)
    )
}

export function Swaps() {
  const phone = useLayout() === "phone"
  const swap = useSheet("request")
  const filter = useUnitFilter()
  const month = useHrMonth()
  const unitName = useUnitName()
  const nameOfEmployee = useEmployeeName()

  const { from, to } = monthBounds(month[0])
  const params = { unit: filter.unitId ?? undefined, from, to }
  const swaps = useQuery({
    queryKey: nextKeys.swapList(params),
    queryFn: ({ signal }) => listSwaps(params, signal),
  })
  const rows = named(swaps.data ?? NO_SWAPS, nameOfEmployee)

  const nothing = `No swap${
    filter.unitId === null ? "" : ` at ${unitName(filter.unitId)}`
  } in ${monthTitle(month[0])}.`
  const open = (row: SwapRow) => swap.open(row.id)

  return (
    <PageContent>
      <PageHeader title="Swaps" />

      <HrScope unit={filter} month={month} />

      <Card className="overflow-hidden px-4 py-2 max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
        {queryState(swaps, {
          loading: "Reading the swaps…",
          render: () => {
            if (rows.length === 0) return <EmptyState>{nothing}</EmptyState>
            return phone ? (
              <PhoneCards
                rows={rows}
                onOpen={open}
                rowId={(row) => row.id}
                spec={{
                  title: (row) => (
                    <CardName
                      name={row.name}
                      line={[
                        `With ${row.withName}`,
                        `${day(row.on_date)} · ${unitName(row.unit_id)}`,
                      ]}
                    />
                  ),
                  foot: (row) => (
                    <Status tone={decisionTone(row.state)}>
                      {statusWord(row.state)}
                    </Status>
                  ),
                  action: (row) => (
                    <CardButton
                      label={row.state === "PENDING" ? "Decide" : "Open"}
                      ariaLabel={`Open ${row.name}’s swap`}
                      onClick={() => open(row)}
                    />
                  ),
                }}
              />
            ) : (
              <MiniTable
                head={[
                  "Employee",
                  { label: "Swaps with", align: "left" },
                  { label: "Unit", align: "left" },
                  { label: "Day", align: "left" },
                  { label: "Reason", align: "left" },
                  { label: "State", align: "left" },
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.id}>
                    <MiniCell>
                      <button
                        type="button"
                        onClick={() => open(row)}
                        className="text-left text-[0.9375rem] font-medium text-ink hover:underline"
                      >
                        {row.name}
                      </button>
                    </MiniCell>
                    <MiniCell>{row.withName}</MiniCell>
                    <MiniCell>{unitName(row.unit_id)}</MiniCell>
                    <MiniCell>{day(row.on_date)}</MiniCell>
                    <MiniCell>{row.reason}</MiniCell>
                    <MiniCell>
                      <Status tone={decisionTone(row.state)}>
                        {statusWord(row.state)}
                      </Status>
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            )
          },
        })}
      </Card>

      {swap.value !== undefined && (
        <SwapSheet
          key={swap.value}
          swap={rows.find((row) => row.id === swap.value) ?? null}
          onClose={swap.close}
        />
      )}
    </PageContent>
  )
}
