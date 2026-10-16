import { Link, useSearch } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"

import { Async, Empty, Panel, Row } from "@/screens/me/ui/bits"
import { button } from "@/screens/me/ui/button-style"
import { money } from "@/screens/me/data/format"
import type { AllowanceLine, SlipLineRow } from "@itulah/contract"
import { readDays, readMinutes } from "@/screens/me/data/days"
import { lockState } from "@/screens/me/data/payslip-lock"
import { usePaySlips, usePayslipTemplate } from "@/screens/me/data/queries"
import { PayslipGate } from "@/screens/me/payslip-gate"

/// One month's payslip, laid out as Talenta lays one out: what you earned,
/// what was taken off, what lands in your account, and what your employer
/// paid on top.
///
/// Since 0800 the server works out PPh 21 and BPJS. A slip it could not work
/// out — no PTKP status on your record, say — shows no take-home pay and says
/// why, rather than a number somebody plans a month around.
export function Payslip() {
  const payId = (useSearch({ strict: false }) as { run?: string }).run ?? ""
  const slips = usePaySlips()
  const template = usePayslipTemplate().data
  const lock = lockState(slips.error)
  if (lock !== null) return <PayslipGate state={lock} />

  return (
    <div className="flex flex-col gap-4">
      <Link
        to={"/me/pay" as string}
        className={button({
          variant: "quiet",
          className: "-ml-2 self-start",
        })}
      >
        <ChevronLeft />
        All payslips
      </Link>

      <Async query={slips}>
        {(list) => {
          const slip = list.find((candidate) => candidate.run_id === payId)
          if (slip === undefined) {
            return <Empty>That payslip is not on your record.</Empty>
          }
          const prorated =
            slip.days_paid !== null &&
            slip.days_in_month !== null &&
            slip.days_paid < slip.days_in_month
          return (
            <>
              {template?.company_name != null && (
                <div>
                  <p className="text-card-title font-semibold text-ink">
                    {template.company_name}
                  </p>
                  {template.company_address !== null && (
                    <p className="text-meta text-mute">
                      {template.company_address}
                    </p>
                  )}
                </div>
              )}
              <Panel title="Take-home pay">
                <p className="num text-[1.5rem] font-semibold text-ink">
                  {slip.net_minor === null
                    ? "Not worked out yet"
                    : money(slip.net_minor)}
                </p>
                {slip.components_incomplete_because !== null && (
                  <p className="rounded-inner bg-warn-bg px-3.5 py-2.5 text-[0.9375rem] leading-relaxed text-warn-fg">
                    {slip.components_incomplete_because}. Ask HR to complete
                    your record.
                  </p>
                )}
              </Panel>

              <Panel title="Earnings">
                <Row
                  label={
                    prorated
                      ? `Base (${slip.days_paid} of ${slip.days_in_month} days)`
                      : "Base"
                  }
                >
                  {money(slip.base_minor)}
                </Row>
                {slip.fixed_allowances.map((line: AllowanceLine) => (
                  <Row key={line.code} label={line.code}>
                    {money(line.minor)}
                  </Row>
                ))}
                {slip.earnings.map((line: SlipLineRow) => (
                  <Row key={line.component_code} label={line.label}>
                    {money(line.amount_minor)}
                  </Row>
                ))}
                <hr className="border-hairline" />
                <Row label="Gross">
                  <span className="font-semibold">
                    {money(slip.gross_minor)}
                  </span>
                </Row>
              </Panel>

              <Panel title="Deductions">
                {slip.deductions.length === 0 ? (
                  <p className="text-[0.9375rem] text-mute">
                    Nothing taken off.
                  </p>
                ) : (
                  slip.deductions.map((line: SlipLineRow) => (
                    <Row key={line.component_code} label={line.label}>
                      {money(line.amount_minor)}
                    </Row>
                  ))
                )}
                {slip.deduction_total_minor !== null && (
                  <>
                    <hr className="border-hairline" />
                    <Row label="Total">
                      <span className="font-semibold">
                        {money(slip.deduction_total_minor)}
                      </span>
                    </Row>
                  </>
                )}
              </Panel>

              {slip.company_contributions.length > 0 && (
                <Panel title="Paid by your employer">
                  {slip.company_contributions.map((line: SlipLineRow) => (
                    <Row key={line.component_code} label={line.label}>
                      {money(line.amount_minor)}
                    </Row>
                  ))}
                  <p className="text-[0.9375rem] text-mute">
                    On top of your pay, not taken from it.
                  </p>
                </Panel>
              )}

              <Panel title="Tax">
                <Row label="PTKP">{slip.ptkp ?? "—"}</Row>
                {slip.ter_category !== null && (
                  <Row label="TER table">{slip.ter_category}</Row>
                )}
                {slip.pph21_minor !== null && (
                  <Row
                    label={
                      slip.final_tax_month === true
                        ? "PPh 21 (year settled)"
                        : "PPh 21"
                    }
                  >
                    {slip.pph21_minor < 0
                      ? `${money(-slip.pph21_minor)} returned`
                      : money(slip.pph21_minor)}
                  </Row>
                )}
              </Panel>

              <Panel title="This month">
                <Row label="Days rostered">{slip.rostered_days}</Row>
                {slip.absent_days !== null && slip.absent_days > 0 && (
                  <Row label="Days absent">{slip.absent_days}</Row>
                )}
                <Row label="Leave taken">
                  {readDays(slip.leave_days_taken * 100)}
                </Row>
                <Row label="Overtime agreed">
                  {readMinutes(slip.overtime_minutes)}
                </Row>
              </Panel>

              <Panel title="Paid to">
                <Row label="Account">{slip.bank_account_masked ?? "—"}</Row>
                {!slip.payable && (
                  <p className="rounded-inner bg-warn-bg px-3.5 py-2.5 text-[0.9375rem] leading-relaxed text-warn-fg">
                    No account is on record, so nothing can be paid yet. Tell
                    your manager.
                  </p>
                )}
              </Panel>

              {template?.footer != null && (
                <p className="text-meta text-mute">{template.footer}</p>
              )}
            </>
          )
        }}
      </Async>
    </div>
  )
}
