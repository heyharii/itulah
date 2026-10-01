import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { MiniCell, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { useActiveEmployees } from "@/lib/queries/hr-time"
import { leaveBalances, leaveKeys, readDays } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import {
  AdjustBalanceForm,
  HolidayWorkedForm,
  PayOutForm,
} from "@/screens/people/leave-extras"
import { Quiet } from "@/screens/people/parts"
import { usePeopleAudience } from "@/screens/people/scope"
import type { EmployeeSummary } from "@itulah/contract"

/// Time off › Balances — everyone working here, and what each has left.
///
/// The list is people, because a balance is read about a person. Opening one
/// shows their balances per kind, and — for head office, whose acts they are —
/// the three things done to a balance by hand: correct or grant days, pay days
/// out into a month's payroll, and give a day back for a holiday worked.
export function TimeOffBalances() {
  const { people, team } = useActiveEmployees()
  const [search, setSearch] = useState("")
  const [unit, setUnit] = useState("")
  const [opened, setOpened] = useState<EmployeeSummary | null>(null)

  const units = useMemo(() => {
    const seen = new Map<string, string>()
    for (const one of people) {
      if (one.unit_id !== null) {
        seen.set(one.unit_id, one.unit_name ?? one.unit_id)
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [people])

  const needle = search.trim().toLowerCase()
  const rows = people
    .filter((one) => unit === "" || one.unit_id === unit)
    .filter(
      (one) =>
        needle === "" ||
        (one.full_name ?? "").toLowerCase().includes(needle) ||
        one.employee_code.toLowerCase().includes(needle) ||
        (one.position ?? "").toLowerCase().includes(needle)
    )

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Leave balances"
        sub="What each person has left per kind of leave. Open one to see it, correct it or pay days out."
      />

      <Toolbar>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, code or position"
          className="h-8 w-64"
          aria-label="Search people"
        />
        {units.length > 1 && (
          <Select
            value={unit}
            onChange={setUnit}
            placeholder="Every unit"
            className="h-8 w-52"
          >
            <option value="">Every unit</option>
            {units.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        )}
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(team, {
          loading: "Reading the people…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {people.length === 0
                  ? "Nobody is employed here yet, so there are no balances to read."
                  : "Nobody matches that search."}
              </EmptyState>
            ) : (
              <div className="px-4 pt-3 pb-4">
                <MiniTable
                  head={[
                    "Employee",
                    { label: "Unit", align: "left" },
                    { label: "Position", align: "left" },
                  ]}
                >
                  {rows.map((one) => (
                    <tr
                      key={one.employee_id}
                      tabIndex={0}
                      onClick={() => setOpened(one)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setOpened(one)
                      }}
                      className={cn(
                        "cursor-pointer border-t border-hairline transition-colors hover:bg-soft",
                        opened?.employee_id === one.employee_id && "bg-soft"
                      )}
                    >
                      <MiniCell>
                        <span className="font-medium text-ink">
                          {one.full_name ?? one.employee_code}
                        </span>
                        <span className="block font-mono text-id text-mute">
                          {one.employee_code}
                        </span>
                      </MiniCell>
                      <MiniCell>{one.unit_name ?? one.unit_id ?? "—"}</MiniCell>
                      <MiniCell>{one.position ?? "—"}</MiniCell>
                    </tr>
                  ))}
                </MiniTable>
              </div>
            ),
        })}
      </Card>

      <BalanceSheet person={opened} onClose={() => setOpened(null)} />
    </PageContent>
  )
}

function BalanceSheet({
  person,
  onClose,
}: {
  person: EmployeeSummary | null
  onClose: () => void
}) {
  const employer = usePeopleAudience() === "employer"
  const balances = useQuery({
    queryKey: leaveKeys.balances(person?.employee_id ?? ""),
    queryFn: ({ signal }) => leaveBalances(person?.employee_id ?? "", signal),
    enabled: person !== null,
  })

  if (person === null) return null
  const id = person.employee_id

  const overview = queryState(balances, {
    loading: "Reading the balances…",
    render: (rows) =>
      rows.length === 0 ? (
        <Quiet>
          No balance-backed leave for this person. Sick leave and the like draw
          on nothing, so they never appear here.
        </Quiet>
      ) : (
        <MiniTable
          head={[
            { label: "Kind", align: "left" },
            "Left",
            "Waiting on a decision",
          ]}
        >
          {rows.map((row) => (
            <tr key={row.leave_type} className="border-t border-hairline">
              <MiniCell>{row.name}</MiniCell>
              <MiniCell align="right">{readDays(row.centidays)}</MiniCell>
              <MiniCell align="right">
                {row.pending_centidays === 0
                  ? "—"
                  : readDays(row.pending_centidays)}
              </MiniCell>
            </tr>
          ))}
        </MiniTable>
      ),
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={person.employee_code}
      title={person.full_name ?? person.employee_code}
      caption={[person.position, person.unit_name].filter(Boolean).join(" · ")}
      width={employer ? "wide" : "rail"}
      tabs={
        employer
          ? [
              { value: "balances", label: "Balances", content: overview },
              {
                value: "adjust",
                label: "Adjust balance",
                content: <AdjustBalanceForm key={id} employeeId={id} />,
              },
              {
                value: "payout",
                label: "Pay out days",
                content: <PayOutForm key={id} employeeId={id} />,
              },
              {
                value: "holiday",
                label: "Holiday worked",
                content: <HolidayWorkedForm key={id} employeeId={id} />,
              },
            ]
          : undefined
      }
    >
      {employer ? null : overview}
    </Sheet>
  )
}
