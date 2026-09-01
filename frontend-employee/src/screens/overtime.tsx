import { Async, Panel } from "@/components/bits"
import { StatusPill } from "@/components/status-pill"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { dateTime, longDate, relativeDay } from "@/lib/format"
import { useAcknowledgeOvertime, useOvertimeOrders } from "@/lib/hr/queries"

/// Overtime you have been asked to work.
///
/// Asked, not claimed. Overtime here is instructed by a supervisor and
/// consented to by the employee — which is both the law and the reason this
/// screen has two buttons and no form. Declining is a real answer and is
/// offered as plainly as accepting.
export function Overtime() {
  const orders = useOvertimeOrders()
  const answer = useAcknowledgeOvertime()

  return (
    <Panel title="Orders">
      <Async query={orders} empty="No overtime has been ordered.">
        {(list) => (
          <div className="flex flex-col">
            {list.map((order, index) => (
              <div key={order.order_id}>
                {index > 0 && <Separator className="my-3" />}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">
                        {longDate(order.date)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {order.planned_from}–{order.planned_to} · {order.hours}{" "}
                        h · {relativeDay(order.date)}
                      </p>
                    </div>
                    <StatusPill status={order.status} className="ml-auto" />
                  </div>
                  <p className="text-[13px]">{order.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    Ordered by {order.ordered_by}
                    {order.acknowledged_at !== null &&
                      ` · answered ${dateTime(order.acknowledged_at)}`}
                  </p>
                  {order.status === "ORDERED" && (
                    <div className="mt-1 flex gap-2">
                      <Button
                        size="lg"
                        className="h-11 flex-1"
                        disabled={answer.isPending}
                        onClick={() =>
                          answer.mutate({
                            orderId: order.order_id,
                            accepted: true,
                          })
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        variant="outline"
                        size="lg"
                        className="h-11 flex-1"
                        disabled={answer.isPending}
                        onClick={() =>
                          answer.mutate({
                            orderId: order.order_id,
                            accepted: false,
                          })
                        }
                      >
                        Decline
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Async>
    </Panel>
  )
}
