import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { useState, Suspense } from "react"

import type { LoanView } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Status } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { money } from "@/lib/format"
import { listEmployees, peopleKeys, allLoansQuery } from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { GrantLoan, LoanCard } from "@/screens/people/loans"
import {
  CardButton,
  CardFigure,
  CardName,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { awaiting } from "@/screens/people/awaiting"

/// Pay › Loans — every loan in the company, one row each, as Talenta's Loan
/// lays them out: an amount lent, repaid by a fixed deduction every month
/// until nothing is owed. A row opens the loan, where the instalments can be
/// stopped; Grant loan opens the grant form.
function loanStatus(loan: LoanView) {
  if (loan.outstanding_minor === 0) return <Status tone="done">Repaid</Status>
  if (loan.stopped) return <Status tone="warn">Stopped</Status>
  if (loan.status === "APPROVED")
    return <Status tone="info">Not paid out</Status>
  return <Status tone="info">Repaying</Status>
}

export function Loans() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const [granting, setGranting] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <PageContent>
      {canWrite && <Fab label="Grant loan" onClick={() => setGranting(true)} />}
      <PageHeader
        title="Loans"
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
        {awaiting(allLoansQuery(), {
          loading: "Reading the loans…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>No loan has been granted.</EmptyState>
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
                  foot: (loan) => loanStatus(loan),
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
                        className="text-left text-[0.9375rem] text-ink hover:underline"
                      >
                        {loan.full_name ?? loan.employee_code}
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
                    <MiniCell>{loanStatus(loan)}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </Card>

      {granting && <GrantSheet onClose={() => setGranting(false)} />}
      {/* The sheet finds its loan in the list, so it reads the list itself. */}
      {openId !== null && (
        <Suspense fallback={null}>
          <LoanSheet openId={openId} onClose={() => setOpenId(null)} />
        </Suspense>
      )}
    </PageContent>
  )
}

/// One loan in a sheet, found in the list by its id. Shared with Loans ›
/// Repayments, so a repayment opens the very record the loan's row opens.
export function LoanSheet({
  openId,
  onClose,
}: {
  openId: string
  onClose: () => void
}) {
  const loans = useSuspenseQuery(allLoansQuery())
  const open = loans.data.find((row) => row.advance_id === openId) ?? null
  if (open === null) return null
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={open.advance_number}
      title={open.full_name ?? open.employee_code}
    >
      <LoanCard loan={open} employeeId={open.employee_id} />
    </Sheet>
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
