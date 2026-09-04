import { Link, useParams } from "@tanstack/react-router"

import { Async, Empty, Panel, Row } from "@/components/bits"
import { buttonVariants } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { money } from "@/lib/format"
import type { AllowanceLine } from "@itulah/contract"
import { readDays, readMinutes } from "@/lib/hr/days"
import { usePaySlips } from "@/lib/hr/queries"
import { cn } from "@/lib/utils"

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
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
      >
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
                <Row label="Base">
                  <span className="tabular-nums">{money(slip.base_minor)}</span>
                </Row>
                {slip.fixed_allowances.map((line: AllowanceLine) => (
                  <Row key={line.code} label={line.code}>
                    <span className="tabular-nums">{money(line.minor)}</span>
                  </Row>
                ))}
                <Separator className="my-2" />
                <Row label="Base plus fixed allowances">
                  <span className="font-semibold tabular-nums">
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
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    No account is on record, so nothing can be paid yet. Tell
                    your manager.
                  </p>
                )}
              </Panel>

              {/* Last, and unmissable. The alternative is somebody reading the
                  figure above as what lands in their account. */}
              <p className="text-[13px] text-muted-foreground">
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
