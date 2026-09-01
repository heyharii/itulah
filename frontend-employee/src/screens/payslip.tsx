import { Link, useParams } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"

import { Async, Empty, Panel, Row } from "@/components/bits"
import { buttonVariants } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { longDate, money, shortDate } from "@/lib/format"
import { usePaySlips } from "@/lib/hr/queries"
import { cn } from "@/lib/utils"

/// One payslip, earnings above deductions.
///
/// The net is repeated at the top and the bottom on purpose: on a phone the
/// lines push the total off the screen, and the total is what is being checked
/// against the bank app in the other hand.
export function Payslip() {
  const { payId } = useParams({ from: "/pay/$payId" })
  const slips = usePaySlips()

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/pay"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "self-start"
        )}
      >
        <ChevronLeft className="size-4" />
        All payslips
      </Link>

      <Async query={slips}>
        {(list) => {
          const slip = list.find((candidate) => candidate.pay_id === payId)
          if (slip === undefined) {
            return <Empty>That payslip is not on your record.</Empty>
          }
          const earnings = slip.lines.filter((line) => line.kind === "EARNING")
          const deductions = slip.lines.filter(
            (line) => line.kind === "DEDUCTION"
          )
          return (
            <>
              <Panel>
                <p className="text-xs text-muted-foreground">
                  {shortDate(slip.period_start)} – {shortDate(slip.period_end)}
                </p>
                <p className="text-3xl font-semibold tabular-nums">
                  {money(slip.net_idr)}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  {slip.paid_on === null
                    ? "Not paid yet"
                    : `Paid ${longDate(slip.paid_on)}`}
                </p>
              </Panel>

              <Panel title="Earnings">
                {earnings.map((line) => (
                  <Row key={line.label} label={line.label}>
                    <span className="tabular-nums">
                      {money(line.amount_idr)}
                    </span>
                  </Row>
                ))}
                <Separator />
                <Row label="Gross">
                  <span className="tabular-nums">{money(slip.gross_idr)}</span>
                </Row>
              </Panel>

              <Panel title="Deductions">
                {deductions.map((line) => (
                  <Row key={line.label} label={line.label}>
                    <span className="tabular-nums">
                      −{money(line.amount_idr)}
                    </span>
                  </Row>
                ))}
                <Separator />
                <Row label="Total deductions">
                  <span className="tabular-nums">
                    −{money(slip.deductions_idr)}
                  </span>
                </Row>
              </Panel>

              <Panel>
                <Row label="Take-home">
                  <span className="text-base tabular-nums">
                    {money(slip.net_idr)}
                  </span>
                </Row>
              </Panel>
            </>
          )
        }}
      </Async>
    </div>
  )
}
