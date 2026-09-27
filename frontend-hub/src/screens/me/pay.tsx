import { Link } from "@tanstack/react-router"

import { ChevronRight } from "lucide-react"

import { Async, List, Panel } from "@/screens/me/ui/bits"
import { money } from "@/screens/me/data/format"
import { usePaySlips } from "@/screens/me/data/queries"

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
          <div className="flex flex-col gap-3">
            <p className="text-meta text-body">
              Agreed pay and the days recorded against each month. Tax and BPJS
              are not calculated here.
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
                        {money(slip.statutory_base_minor)}
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
  )
}
