import { useQuery } from "@tanstack/react-query"

import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { money } from "@/lib/format"
import { allLoans, payKeys } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { AppLink } from "@/components/ui/app-link"

/// Every loan in the company, one row each. A row opens the person, whose
/// Loans tab is where a loan is granted and stopped.
export function AllLoans() {
  const loans = useQuery({
    queryKey: payKeys.allLoans(),
    queryFn: ({ signal }) => allLoans(signal),
  })
  return (
    <Card className="mb-4 overflow-hidden">
      {queryState(loans, {
        loading: "Reading the loans…",
        render: (rows) =>
          rows.length === 0 ? (
            <EmptyState>
              No loan has been granted. A loan is granted on the person&rsquo;s
              Loans tab in Employees.
            </EmptyState>
          ) : (
            <MiniTable
              head={[
                "Employee",
                "For",
                { label: "Lent", align: "right" },
                { label: "Each month", align: "right" },
                { label: "Still owed", align: "right" },
                "",
              ]}
            >
              {rows.map((loan) => (
                <MiniRow key={loan.advance_id}>
                  <MiniCell>
                    <AppLink
                      to="/people"
                      sheet={{ key: "employee", value: loan.employee_id }}
                      className="text-left hover:underline"
                    >
                      <span className="block text-[0.875rem] text-ink">
                        {loan.full_name ?? loan.employee_code}
                      </span>
                      <span className="font-mono text-[0.875rem] text-mute">
                        {loan.advance_number}
                      </span>
                    </AppLink>
                  </MiniCell>
                  <MiniCell>{loan.purpose}</MiniCell>
                  <MiniCell align="right">{money(loan.amount_minor)}</MiniCell>
                  <MiniCell align="right">
                    {money(loan.instalment_minor)}
                  </MiniCell>
                  <MiniCell align="right">
                    {money(loan.outstanding_minor)}
                  </MiniCell>
                  <MiniCell>
                    {loan.outstanding_minor === 0 ? (
                      <Pill tone="ok">Repaid</Pill>
                    ) : loan.stopped ? (
                      <Pill tone="warn">Stopped</Pill>
                    ) : loan.status === "APPROVED" ? (
                      <Pill tone="info">Not paid out</Pill>
                    ) : (
                      <Pill tone="info">Repaying</Pill>
                    )}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          ),
      })}
    </Card>
  )
}
