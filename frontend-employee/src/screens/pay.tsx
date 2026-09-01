import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"

import { Async, Panel } from "@/components/bits"
import { Separator } from "@/components/ui/separator"
import { money, shortDate } from "@/lib/format"
import { usePaySlips } from "@/lib/hr/queries"

/// Payslips, newest first, showing the only number anybody remembers.
export function Pay() {
  const slips = usePaySlips()

  return (
    <Panel title="Payslips">
      <Async query={slips} empty="No payslip has been released to you yet.">
        {(list) => (
          <div className="flex flex-col">
            {list.map((slip, index) => (
              <div key={slip.pay_id}>
                {index > 0 && <Separator className="my-1" />}
                <Link
                  to="/pay/$payId"
                  params={{ payId: slip.pay_id }}
                  // A whole row is the target, not the text in it: this is
                  // tapped with a thumb, and `-mx-2 px-2` lets the highlight
                  // reach the card's edge without the text moving.
                  className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/60"
                >
                  <div className="min-w-0">
                    <p className="text-base font-semibold tabular-nums">
                      {money(slip.net_idr)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {shortDate(slip.period_start)} –{" "}
                      {shortDate(slip.period_end)}
                      {slip.paid_on !== null &&
                        ` · paid ${shortDate(slip.paid_on)}`}
                    </p>
                  </div>
                  <ChevronRight className="ml-auto size-5 shrink-0 text-muted-foreground" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </Async>
    </Panel>
  )
}
