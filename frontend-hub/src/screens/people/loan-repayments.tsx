import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Suspense, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import {
  CardButton,
  CardFigure,
  CardName,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { PickOne } from "@/components/ui/pick"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner, EmptyState } from "@/components/ui/states"
import { today } from "@/lib/calendar"
import { day, money, monthYear } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { companyBankAccountsQuery } from "@/lib/queries/finance"
import { currentMonth } from "@/lib/queries/hr-time"
import { allLoansQuery, payKeys, repayLoan } from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { awaiting } from "@/screens/people/awaiting"
import { LoanSheet } from "@/screens/people/loans-page"
import type { LoanRepayment, LoanView } from "@itulah/contract"

/// Loans › Repayments — every repayment of every loan, newest first.
///
/// A loan's balance only drops when a repayment is recorded, so this is the
/// list the balance is made of: a month's instalment off pay once the run is
/// approved, or money Finance received directly. An instalment on a run that
/// is still a draft has not reduced anything yet; it is the figure "On draft
/// payroll" above the list, not a row in it. A row opens the loan, the same
/// record Loans and the employee's own tab open.
///
/// Record repayment files money that came back outside payroll against one
/// loan: the amount, the day, and where it was paid into.

type Repaid = {
  readonly key: string
  readonly loan: LoanView
  readonly repayment: LoanRepayment
}

/// How the money came back, in the words of the person asking.
function how(repayment: LoanRepayment): string {
  switch (repayment.kind) {
    case "PAYROLL":
      return repayment.period === null
        ? "Payroll deduction"
        : `Payroll deduction · ${monthYear(repayment.period)}`
    case "REFUND":
      return "Direct payment"
    case "EXPENSE":
      return "Receipts"
    default:
      return repayment.kind
  }
}

/// Every loan's repayments as one list, the latest first.
function repaid(loans: readonly LoanView[]): Repaid[] {
  return loans
    .flatMap((loan) =>
      loan.repayments.map((repayment, index) => ({
        key: `${loan.advance_id}:${index}`,
        loan,
        repayment,
      }))
    )
    .sort((a, b) => b.repayment.at.localeCompare(a.repayment.at))
}

export function LoanRepayments() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const [openId, setOpenId] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)

  return (
    <PageContent>
      {canWrite && (
        <Fab label="Record repayment" onClick={() => setRecording(true)} />
      )}
      <PageHeader
        title="Loans"
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => setRecording(true)}>
              Record repayment
            </Button>
          )
        }
      />

      {awaiting(allLoansQuery(), {
        loading: "Reading the repayments…",
        render: (loans) => <Repayments loans={loans} onOpen={setOpenId} />,
      })}

      {/* The sheets find their loan in the list, so they read the list
          themselves. */}
      {recording && (
        <Suspense fallback={null}>
          <RepaymentSheet onClose={() => setRecording(false)} />
        </Suspense>
      )}
      {openId !== null && (
        <Suspense fallback={null}>
          <LoanSheet openId={openId} onClose={() => setOpenId(null)} />
        </Suspense>
      )}
    </PageContent>
  )
}

/// A loan money can still come back against: paid out, and something owed.
function owing(loan: LoanView): boolean {
  return (
    (loan.status === "PAID" || loan.status === "PARTIALLY_SETTLED") &&
    loan.outstanding_minor > 0
  )
}

/// Record a repayment that did not come off pay: pick the loan, then the
/// amount, the day and the account it was paid into. The server refuses more
/// than what is left after any instalment on a run not yet approved, and says
/// so; nothing on screen moves until it has answered.
function RepaymentSheet({ onClose }: { onClose: () => void }) {
  const client = useQueryClient()
  const loans = useSuspenseQuery(allLoansQuery())
  const banks = useQuery(companyBankAccountsQuery())
  const [advanceId, setAdvanceId] = useState<string | null>(null)
  const [amount, setAmount] = useState("")
  const [on, setOn] = useState(today)
  const [into, setInto] = useState("petty_cash|")
  const [reason, setReason] = useState("")

  const owed = loans.data.filter(owing)
  const loan = owed.find((one) => one.advance_id === advanceId) ?? null
  const amountMinor = Number(amount === "" ? "0" : amount)

  const record = useMutation({
    mutationFn: () => {
      if (loan === null) throw new Error("no loan is picked")
      const [cashKey, qualifier] = into.split("|")
      return repayLoan(loan.advance_id, {
        amount_minor: amountMinor,
        posting_date: on,
        cash_key: cashKey,
        cash_qualifier: qualifier ?? "",
        reason: reason.trim(),
      })
    },
    onSuccess: () => {
      // The prefix of every loans read: the company's list and each
      // employee's own tab. The repayment also moves the advance in Finance.
      void client.invalidateQueries({ queryKey: payKeys.allLoans() })
      void client.invalidateQueries({ queryKey: ["finance", "advances"] })
      onClose()
    },
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Record repayment"
      footer={
        <SheetFooter
          onCancel={onClose}
          primary={{
            label: "Record repayment",
            pending: record.isPending,
            disabled:
              loan === null ||
              amountMinor <= 0 ||
              on === "" ||
              reason.trim() === "",
            onClick: () => record.mutate(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Loan" required>
          <PickOne
            label="Loan"
            required
            choices={owed.map((one) => ({
              value: one.advance_id,
              label: `${one.full_name ?? one.employee_code} · ${one.advance_number} · ${money(one.outstanding_minor)} owed`,
            }))}
            value={advanceId}
            onChange={setAdvanceId}
          />
        </Field>
        {loan !== null && (
          <Facts>
            <Fact term="Still owed">{money(loan.outstanding_minor)}</Fact>
            <Fact term="On draft payroll">{money(loan.pending_minor)}</Fact>
          </Facts>
        )}
        <Field label="Amount" required>
          <Money
            label="Amount"
            prefix="Rp"
            value={amount}
            onChange={setAmount}
          />
        </Field>
        <Field label="Date" required>
          <Day value={on} onChange={setOn} />
        </Field>
        <Field label="Paid into" required>
          <Select value={into} onChange={setInto}>
            <option value="petty_cash|">Unit petty cash</option>
            {(banks.data ?? []).map((bank) => (
              <option
                key={`${bank.ledger_account_code}-${bank.bank_code}`}
                value={`${bank.kind === "SAVINGS" ? "bank_savings" : "bank_giro"}|${bank.bank_code}`}
              >
                {`${bank.bank_code} ${bank.account_no}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {record.error !== null && (
          <Banner tone="bad">{record.error.message}</Banner>
        )}
      </div>
    </Sheet>
  )
}

function Repayments({
  loans,
  onOpen,
}: {
  loans: readonly LoanView[]
  onOpen: (advanceId: string) => void
}) {
  const phone = useLayout() === "phone"
  const rows = repaid(loans)
  const month = currentMonth()
  const owed = loans.reduce((sum, loan) => sum + loan.outstanding_minor, 0)
  const drafted = loans.reduce((sum, loan) => sum + loan.pending_minor, 0)
  const thisMonth = rows
    .filter((row) => row.repayment.at.slice(0, 7) === month)
    .reduce((sum, row) => sum + row.repayment.amount_minor, 0)

  if (loans.length === 0)
    return (
      <Card className="overflow-hidden px-4 py-2 max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
        <EmptyState>No loan has been granted.</EmptyState>
      </Card>
    )

  return (
    <>
      <KpiStrip>
        <Kpi label="Still owed" value={money(owed)} />
        <Kpi label="On draft payroll" value={money(drafted)} />
        <Kpi label="Repaid this month" value={money(thisMonth)} />
      </KpiStrip>

      <Card className="overflow-hidden px-4 py-2 max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
        {rows.length === 0 ? (
          <EmptyState>No repayment has been recorded.</EmptyState>
        ) : phone ? (
          <PhoneCards
            rows={rows}
            onOpen={(row) => onOpen(row.loan.advance_id)}
            rowId={(row) => row.key}
            spec={{
              title: (row) => (
                <CardName
                  name={row.loan.full_name ?? row.loan.employee_code}
                  line={[
                    `${row.loan.advance_number} · ${row.loan.purpose}`,
                    how(row.repayment),
                  ]}
                />
              ),
              lead: (row) => (
                <CardFigure
                  value={money(row.repayment.amount_minor)}
                  caption={day(row.repayment.at)}
                />
              ),
              action: (row) => (
                <CardButton
                  label="Open"
                  ariaLabel={`Open loan ${row.loan.advance_number}`}
                  onClick={() => onOpen(row.loan.advance_id)}
                />
              ),
            }}
          />
        ) : (
          <MiniTable
            head={[
              "Employee",
              { label: "Loan", align: "left" },
              { label: "How", align: "left" },
              { label: "Date", align: "left" },
              "Amount",
            ]}
          >
            {rows.map((row) => (
              <MiniRow key={row.key}>
                <MiniCell>
                  <button
                    type="button"
                    onClick={() => onOpen(row.loan.advance_id)}
                    className="text-left text-[0.9375rem] text-ink hover:underline"
                  >
                    {row.loan.full_name ?? row.loan.employee_code}
                  </button>
                </MiniCell>
                <MiniCell>
                  {row.loan.advance_number} · {row.loan.purpose}
                </MiniCell>
                <MiniCell>{how(row.repayment)}</MiniCell>
                <MiniCell>{day(row.repayment.at)}</MiniCell>
                <MiniCell align="right">
                  {money(row.repayment.amount_minor)}
                </MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
        )}
      </Card>
    </>
  )
}
