import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { ChevronRight } from "lucide-react"

import { Async, Empty, List, Panel, Row } from "@/screens/me/ui/bits"
import { Button } from "@/screens/me/ui/button"
import { money } from "@/screens/me/data/format"
import { lockState } from "@/screens/me/data/payslip-lock"
import {
  useAnnualTax,
  useLoans,
  usePaySlips,
  usePayslipTemplate,
} from "@/screens/me/data/queries"
import { ChangePayslipPassword, PayslipGate } from "@/screens/me/payslip-gate"
import type { AnnualTaxSlip, LoanView } from "@itulah/contract"

/// What you were paid, month by month.
///
/// # The big number is take-home pay
///
/// Since 0800 the server works out PPh 21 and BPJS, so each month shows what
/// lands in the account. A month it could not work out says so instead of a
/// figure: a screen that showed the agreement under the word "net" would be a
/// screen somebody plans a month around.
export function Pay() {
  const slips = usePaySlips()
  const template = usePayslipTemplate()
  const lock = lockState(slips.error)
  if (lock !== null) return <PayslipGate state={lock} />

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Your pay">
        <Async query={slips} empty="No payslip has been released to you yet.">
          {(list) => (
            <div className="flex flex-col gap-3">
              <p className="text-meta text-body">
                Take-home pay each month, after PPh 21 and BPJS.
              </p>
              <List className="-mx-2">
                {list.map((slip) => (
                  <div key={slip.run_id}>
                    <Link
                      to={"/me/pay/slip" as string}
                      search={{ run: slip.run_id } as never}
                      className="flex items-center gap-3 rounded-inner px-2 py-1 transition-colors hover:bg-soft-2"
                    >
                      <div className="min-w-0">
                        <p className="num text-card-title font-semibold text-ink">
                          {slip.net_minor === null
                            ? "Not worked out yet"
                            : money(slip.net_minor)}
                        </p>
                        <p className="font-mono text-id text-mute">
                          {/* The run id carries the month, which is the only place
                          a period appears on this row — the slip itself has no
                          date range of its own. */}
                          {slip.run_id}
                        </p>
                      </div>
                      <ChevronRight className="ml-auto size-4 shrink-0 text-line-ico" />
                    </Link>
                  </div>
                ))}
              </List>
            </div>
          )}
        </Async>
      </Panel>
      <Loans />
      <AnnualTax />
      {template.data?.password_required === true && <ChangePayslipPassword />}
    </div>
  )
}

/// Bukti potong 1721-A1: the year's tax, as the form your employer files
/// lays it out — what you need for your own SPT Tahunan.
function AnnualTax() {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const slip = useAnnualTax(year)
  return (
    <Panel title={`Tax for ${year} · 1721-A1`}>
      <div className="flex items-center gap-2">
        <Button variant="quiet" onClick={() => setYear(year - 1)}>
          {year - 1}
        </Button>
        <Button
          variant="quiet"
          disabled={year >= new Date().getFullYear()}
          onClick={() => setYear(year + 1)}
        >
          {year + 1}
        </Button>
      </div>
      <Async query={slip}>
        {(form) =>
          form === null ? (
            <Empty>Nothing was paid to you with tax in {year}.</Empty>
          ) : (
            <AnnualTaxRows form={form} />
          )
        }
      </Async>
    </Panel>
  )
}

function AnnualTaxRows({ form }: { form: AnnualTaxSlip }) {
  return (
    <div className="flex flex-col gap-2">
      {!form.settled && (
        <p className="rounded-inner bg-warn-bg px-3.5 py-2.5 text-[0.875rem] leading-relaxed text-warn-fg">
          The year so far. It is settled in December, or the month you leave.
        </p>
      )}
      <Row label="Months">
        {form.from_month}–{form.to_month}
      </Row>
      <Row label="Gross income">{money(form.gross_minor)}</Row>
      <Row label="Biaya jabatan">{money(form.biaya_jabatan_minor)}</Row>
      <Row label="JHT and JP you paid">{money(form.pension_minor)}</Row>
      <Row label="Net income">{money(form.net_minor)}</Row>
      <Row label={`PTKP (${form.ptkp ?? "—"})`}>{money(form.ptkp_minor)}</Row>
      <Row label="Taxable income">{money(form.taxable_income_minor)}</Row>
      <hr className="border-hairline" />
      <Row label="PPh 21 for the year">{money(form.tax_due_minor)}</Row>
      <Row label="PPh 21 withheld">{money(form.tax_withheld_minor)}</Row>
    </div>
  )
}

/// Your loans, as Talenta's: what you borrowed, what has come off your pay,
/// and what is still owed. Shown only when you have one.
function Loans() {
  const loans = useLoans()
  const rows = loans.data ?? []
  if (rows.length === 0) return null
  return (
    <Panel title="Your loans">
      <div className="flex flex-col gap-4">
        {rows.map((loan) => (
          <LoanRows key={loan.advance_id} loan={loan} />
        ))}
      </div>
    </Panel>
  )
}

function LoanRows({ loan }: { loan: LoanView }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-card-title font-semibold text-ink">{loan.purpose}</p>
      <Row label="Borrowed">{money(loan.amount_minor)}</Row>
      <Row label="Each month">{money(loan.instalment_minor)}</Row>
      <Row label="Repaid">{money(loan.repaid_minor)}</Row>
      <Row label="Still owed">{money(loan.outstanding_minor)}</Row>
      {loan.status === "APPROVED" && (
        <p className="text-[0.875rem] text-mute">
          Approved; nothing comes off your pay until it has been paid out to
          you.
        </p>
      )}
    </div>
  )
}
