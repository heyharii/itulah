import { Link, useParams } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"

import { Async, Empty, Panel, Row } from "@/components/bits"
import { button } from "@/components/ui/button-style"
import { money } from "@/lib/format"
import type { AllowanceLine } from "@itulah/contract"
import { readDays, readMinutes } from "@/lib/hr/days"
import { usePaySlips } from "@/lib/hr/queries"

/// One month, as far as this system can honestly state it.
///
/// # Why there is no total at the bottom
///
/// Because there is no total. The server computes nothing statutory — PPh 21
/// brackets and BPJS rates change by regulation, and a number this system
/// invented would be a number somebody files — so what is here is the agreement
/// that was in force and the facts recorded against the month. A "net" line
/// would be the agreement wearing a word it has not earned.
///
/// The banner says so rather than leaving the reader to notice. Somebody
/// checking their pay should find out what this screen does not know from the
/// screen, not from their bank statement.
export function Payslip() {
  const { payId } = useParams({ from: "/pay/$payId" })
  const slips = usePaySlips()

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/pay"
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
          return (
            <>
              <Panel title="Agreed pay">
                <Row label="Base">{money(slip.base_minor)}</Row>
                {slip.fixed_allowances.map((line: AllowanceLine) => (
                  <Row key={line.code} label={line.code}>
                    {money(line.minor)}
                  </Row>
                ))}
                <hr className="border-hairline" />
                <Row label="Base plus fixed allowances">
                  <span className="font-semibold">
                    {money(slip.statutory_base_minor)}
                  </span>
                </Row>
              </Panel>

              <Panel title="This month">
                <Row label="Days rostered">{slip.rostered_days}</Row>
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
                  <p className="rounded-inner bg-warn-bg px-3.5 py-2.5 text-[0.71875rem] leading-relaxed text-warn-fg">
                    No account is on record, so nothing can be paid yet. Tell
                    your manager.
                  </p>
                )}
              </Panel>

              {/* Last, and unmissable. The alternative is somebody reading the
                  figure above as what lands in their account. */}
              <p className="rounded-inner bg-info-bg px-3.5 py-2.5 text-[0.71875rem] leading-relaxed text-info-fg">
                Tax and BPJS are not calculated by this system, so the figures
                above are what was agreed rather than what will be transferred.
                Your employer works the deductions out separately.
              </p>
            </>
          )
        }}
      </Async>
    </div>
  )
}
