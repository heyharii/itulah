import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import type { LoanView } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { money } from "@/lib/format"
import {
  allLoans,
  listEmployees,
  payKeys,
  peopleKeys,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { GrantLoan, LoanCard } from "@/screens/people/loans"
import {
  CardButton,
  CardFigure,
  CardName,
  PhoneCards,
} from "@/components/ui/phone-cards"

/// Claims & loans › Loans — every loan in the company, one row each, as
/// Talenta's Loan lays them out: an amount lent, repaid by a fixed deduction
/// every month until nothing is owed. A row opens the loan, where the
/// instalments can be stopped; Grant loan opens the grant form.
function loanPill(loan: LoanView) {
  if (loan.outstanding_minor === 0) return <Pill tone="ok">Repaid</Pill>
  if (loan.stopped) return <Pill tone="warn">Stopped</Pill>
  if (loan.status === "APPROVED") return <Pill tone="info">Not paid out</Pill>
  return <Pill tone="info">Repaying</Pill>
}

export function Loans() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const [granting, setGranting] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const loans = useQuery({
    queryKey: payKeys.allLoans(),
    queryFn: ({ signal }) => allLoans(signal),
  })
  const rows = loans.data ?? []
  const open = rows.find((row) => row.advance_id === openId) ?? null

  return (
    <PageContent>
      {canWrite && <Fab label="Grant loan" onClick={() => setGranting(true)} />}
      <PageHeader
        crumb="People"
        title="Loans"
        sub="Every loan: what was lent, what has come back from pay, and what is still owed."
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => setGranting(true)}>
              Grant loan
            </Button>
          )
        }
      />

      <Card className="overflow-hidden px-4 py-2 max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
        {queryState(loans, {
          loading: "Reading the loans…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No loan has been granted. Use Grant loan to lend someone money
                that is repaid from pay in fixed monthly instalments.
              </EmptyState>
            ) : phone ? (
              <PhoneCards
                rows={rows}
                onOpen={(loan) => setOpenId(loan.advance_id)}
                rowId={(loan) => loan.advance_id}
                spec={{
                  title: (loan) => (
                    <CardName
                      name={loan.full_name ?? loan.employee_code}
                      line={
                        <>
                          <span className="block">
                            {loan.advance_number} · {loan.purpose}
                          </span>
                          <span className="block">
                            Lent {money(loan.amount_minor)} ·{" "}
                            {money(loan.instalment_minor)} a month
                          </span>
                        </>
                      }
                    />
                  ),
                  lead: (loan) => (
                    <CardFigure
                      value={money(loan.outstanding_minor)}
                      caption="still owed"
                      tone={loan.outstanding_minor === 0 ? "quiet" : undefined}
                    />
                  ),
                  foot: (loan) => loanPill(loan),
                  action: (loan) => (
                    <CardButton
                      label="Open"
                      ariaLabel={`Open loan ${loan.advance_number}`}
                      onClick={() => setOpenId(loan.advance_id)}
                    />
                  ),
                }}
              />
            ) : (
              <MiniTable
                head={[
                  "Employee",
                  { label: "For", align: "left" },
                  { label: "Lent", align: "right" },
                  { label: "Each Month", align: "right" },
                  { label: "Still Owed", align: "right" },
                  { label: "State", align: "left" },
                ]}
              >
                {rows.map((loan) => (
                  <MiniRow key={loan.advance_id}>
                    <MiniCell>
                      <button
                        type="button"
                        onClick={() => setOpenId(loan.advance_id)}
                        className="text-left hover:underline"
                      >
                        <span className="block text-[0.875rem] text-ink">
                          {loan.full_name ?? loan.employee_code}
                        </span>
                        <span className="font-mono text-[0.875rem] text-mute">
                          {loan.advance_number}
                        </span>
                      </button>
                    </MiniCell>
                    <MiniCell>{loan.purpose}</MiniCell>
                    <MiniCell align="right">
                      {money(loan.amount_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {money(loan.instalment_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {money(loan.outstanding_minor)}
                    </MiniCell>
                    <MiniCell>{loanPill(loan)}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </Card>

      {granting && <GrantSheet onClose={() => setGranting(false)} />}
      {open !== null && (
        <Sheet
          open
          onOpenChange={(next) => {
            if (!next) setOpenId(null)
          }}
          id={open.advance_number}
          title={open.full_name ?? open.employee_code}
        >
          <LoanCard loan={open} employeeId={open.employee_id} />
        </Sheet>
      )}
    </PageContent>
  )
}

/// Grant a loan: pick the person, then the plan.
function GrantSheet({ onClose }: { onClose: () => void }) {
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Grant loan"
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Employee" required>
          <PickOne
            label="Employee"
            choices={(team.data ?? []).map((one) => ({
              value: one.employee_id,
              label:
                one.full_name === null
                  ? one.employee_code
                  : `${one.full_name} · ${one.employee_code}`,
            }))}
            value={employeeId}
            onChange={setEmployeeId}
          />
        </Field>
        {employeeId !== null && (
          <GrantLoan
            key={employeeId}
            employeeId={employeeId}
            heading={false}
            onGranted={onClose}
          />
        )}
      </div>
    </Sheet>
  )
}
