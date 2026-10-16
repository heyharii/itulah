import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { KeyValue, SubHead } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { day, money, monthYear } from "@/lib/format"
import {
  employeeLoans,
  grantLoan,
  payKeys,
  stopLoan,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import type { LoanView } from "@itulah/contract"

/// Pinjaman karyawan, as Talenta's Loan: an amount lent, repaid by a fixed
/// deduction every month until nothing is owed.
///
/// A loan is a kasbon with a plan. Granting it approves an advance that
/// Finance pays out from Advances; once paid, payroll files the month's
/// instalment on every draft run by itself, and approving the run settles it.
/// The last instalment is only what is left.
export function LoansPanel({ employeeId }: { employeeId: string }) {
  const loans = useQuery({
    queryKey: payKeys.loans(employeeId),
    queryFn: ({ signal }) => employeeLoans(employeeId, signal),
  })
  return (
    <div className="flex flex-col gap-4">
      {queryState(loans, {
        loading: "Reading the loans…",
        render: (rows) =>
          rows.length === 0 ? (
            <EmptyState>No loan.</EmptyState>
          ) : (
            <div className="flex flex-col gap-4">
              {rows.map((loan) => (
                <LoanCard
                  key={loan.advance_id}
                  loan={loan}
                  employeeId={employeeId}
                />
              ))}
            </div>
          ),
      })}
      <GrantLoan employeeId={employeeId} />
    </div>
  )
}

function loanState(loan: LoanView): {
  tone: "ok" | "warn" | "info"
  label: string
} {
  if (loan.outstanding_minor === 0) return { tone: "ok", label: "Repaid" }
  if (loan.stopped) return { tone: "warn", label: "Instalments stopped" }
  if (loan.status === "APPROVED")
    return { tone: "info", label: "Waiting on Finance to pay it out" }
  return { tone: "info", label: "Repaying" }
}

/// One loan, in full: the plan, what has come back, and — while it is still
/// running — the way to stop the instalments.
export function LoanCard({
  loan,
  employeeId,
}: {
  loan: LoanView
  employeeId: string
}) {
  const client = useQueryClient()
  const [why, setWhy] = useState("")
  const stop = useMutation({
    mutationFn: () => stopLoan(loan.advance_id, why.trim()),
    onSuccess: () => {
      setWhy("")
      void client.invalidateQueries({ queryKey: payKeys.loans(employeeId) })
      void client.invalidateQueries({ queryKey: payKeys.allLoans() })
    },
  })
  const state = loanState(loan)
  const running = !loan.stopped && loan.outstanding_minor > 0

  return (
    <div className="rounded-card border border-hairline p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-card-title font-semibold text-ink">
          {loan.purpose}
        </span>
        <Pill tone={state.tone}>{state.label}</Pill>
      </div>
      <KeyValue term="Lent">
        {money(loan.amount_minor)} · {loan.advance_number}
        {loan.paid_at !== null && ` · paid out ${day(loan.paid_at)}`}
      </KeyValue>
      <KeyValue term="Instalment">
        {money(loan.instalment_minor)} a month from{" "}
        {monthYear(loan.first_period)}
      </KeyValue>
      <KeyValue term="Repaid">{money(loan.repaid_minor)}</KeyValue>
      {loan.pending_minor > 0 && (
        <KeyValue term="On runs not yet approved">
          {money(loan.pending_minor)}
        </KeyValue>
      )}
      <KeyValue term="Still owed">
        {money(loan.outstanding_minor)}
        {running &&
          loan.instalments_left > 0 &&
          ` · ${loan.instalments_left} instalment${loan.instalments_left === 1 ? "" : "s"} to go`}
      </KeyValue>
      <KeyValue term="Granted by">{loan.granted_by}</KeyValue>

      {loan.repayments.length > 0 && (
        <div className="mt-3">
          <SubHead>Repayments</SubHead>
          {loan.repayments.map((repayment, index) => (
            <KeyValue
              key={`${repayment.at}-${index}`}
              term={
                repayment.kind === "PAYROLL"
                  ? `Payroll ${monthYear(repayment.period)}`
                  : repayment.kind === "REFUND"
                    ? `Cash ${day(repayment.at)}`
                    : `Receipts ${day(repayment.at)}`
              }
            >
              {money(repayment.amount_minor)}
            </KeyValue>
          ))}
        </div>
      )}

      {running && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Why stop the instalments">
            <Input
              value={why}
              onChange={(event) => setWhy(event.target.value)}
            />
          </Field>
          <Button
            variant="danger"
            pending={stop.isPending}
            disabled={why.trim() === ""}
            onClick={() => stop.mutate()}
          >
            Stop instalments
          </Button>
        </div>
      )}
      {stop.error !== null && (
        <Banner tone="bad" className="mt-2">
          {stop.error.message}
        </Banner>
      )}
    </div>
  )
}

function nextMonth(): string {
  const now = new Date()
  now.setDate(1)
  now.setMonth(now.getMonth() + 1)
  return now.toISOString().slice(0, 7)
}

/// The grant form for one person. `onGranted` lets a sheet close itself once
/// the loan exists; `heading` is off where the sheet's own title says it.
export function GrantLoan({
  employeeId,
  onGranted,
  heading = true,
}: {
  employeeId: string
  onGranted?: () => void
  heading?: boolean
}) {
  const client = useQueryClient()
  const [amount, setAmount] = useState("")
  const [months, setMonths] = useState("")
  const [first, setFirst] = useState(nextMonth)
  const [purpose, setPurpose] = useState("")
  const [reason, setReason] = useState("")
  const amountMinor = Number(amount.replace(/\D/g, "") || "0")
  const count = Number(months.replace(/\D/g, "") || "0")
  const instalment = count > 0 ? Math.ceil(amountMinor / count) : 0
  const ready =
    amountMinor > 0 &&
    count > 0 &&
    /^\d{4}-\d{2}$/.test(first) &&
    purpose.trim() !== "" &&
    reason.trim() !== ""

  const grant = useMutation({
    mutationFn: () =>
      grantLoan(employeeId, {
        amount_minor: amountMinor,
        instalment_minor: instalment,
        first_period: first,
        purpose: purpose.trim(),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setAmount("")
      setMonths("")
      setPurpose("")
      setReason("")
      void client.invalidateQueries({ queryKey: payKeys.loans(employeeId) })
      void client.invalidateQueries({ queryKey: payKeys.allLoans() })
      onGranted?.()
    },
  })

  return (
    <div>
      {heading && <SubHead>Grant a loan</SubHead>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Amount" required>
          <Input
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field
          label="Instalments"
          aside={instalment > 0 ? `${money(instalment)} a month` : "months"}
          required
        >
          <Input
            inputMode="numeric"
            value={months}
            onChange={(event) => setMonths(event.target.value)}
          />
        </Field>
        <Field label="First month off pay" required>
          <Input
            type="month"
            value={first}
            onChange={(event) => setFirst(event.target.value)}
          />
        </Field>
        <Field label="For" required>
          <Input
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </Field>
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
      {grant.error !== null && (
        <Banner tone="bad" className="mt-2">
          {grant.error.message}
        </Banner>
      )}
      <div className="mt-3">
        <Button
          variant="primary"
          pending={grant.isPending}
          disabled={!ready}
          onClick={() => grant.mutate()}
        >
          Grant loan
        </Button>
      </div>
    </div>
  )
}
