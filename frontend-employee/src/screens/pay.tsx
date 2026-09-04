import { Link } from "@tanstack/react-router"

import { Async, Panel } from "@/components/bits"
import { Separator } from "@/components/ui/separator"
import { money } from "@/lib/format"
import { usePaySlips } from "@/lib/hr/queries"

/// What you were paid, month by month.
///
/// # The big number is the agreement, not the net
///
/// There is no net here, because nothing computes one. PPh 21 and the BPJS
/// contributions are statutory arithmetic whose brackets change by regulation,
/// and a figure this system calculated would be a figure somebody files with
/// the tax office. So what a slip shows is the agreement that was in force —
/// base plus fixed allowances — and the facts recorded against the month.
///
/// Saying that plainly is the point. A screen that showed the agreement under
/// the word "net" would be a screen somebody plans a month around.
export function Pay() {
  const slips = usePaySlips()

  return (
    <Panel title="Your pay">
      <Async query={slips} empty="No payslip has been released to you yet.">
        {(list) => (
          <div className="flex flex-col">
            <p className="mb-3 text-xs text-muted-foreground">
              Agreed pay and the days recorded against each month. Tax and BPJS
              are not calculated here.
            </p>
            {list.map((slip, index) => (
              <div key={slip.run_id}>
                {index > 0 && <Separator className="my-3" />}
                <Link
                  to="/pay/$payId"
                  params={{ payId: slip.run_id }}
                  className="flex items-baseline gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-lg font-semibold tabular-nums">
                      {money(slip.statutory_base_minor)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {/* The run id carries the month, which is the only place
                          a period appears on this row — the slip itself has no
                          date range of its own. */}
                      {slip.run_id}
                    </p>
                  </div>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    View
                  </span>
                </Link>
              </div>
            ))}
          </div>
        )}
      </Async>
    </Panel>
  )
}
