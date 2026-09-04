import { Async, Panel } from "@/components/bits"
import { StatusPill } from "@/components/status-pill"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { dateTime, longDate, relativeDay } from "@/lib/format"
import { useAnswerOvertime, useOvertimeOrders } from "@/lib/hr/queries"
import { readMinutes } from "@/lib/hr/days"

/// Overtime you have been asked to work.
///
/// Asked, not claimed. PP 35/2021 art. 26(2) wants two written acts — your
/// employer's instruction and your own agreement — which is both why this
/// screen has two buttons and no form, and why nobody else can press either of
/// them. The answer is recorded under a key your supervisor does not hold.
///
/// Declining is a real answer and is offered as plainly as agreeing. It is also
/// final: nobody can reverse it, which is what makes it a refusal rather than a
/// first offer.
///
/// Hours are what was **ordered**. Nothing is authorized until you agree, so an
/// unanswered order shows what was asked for and says so.
export function Overtime() {
  const orders = useOvertimeOrders()
  const answer = useAnswerOvertime()

  return (
    <Panel title="Orders">
      <Async query={orders} empty="No overtime has been ordered.">
        {(list) => (
          <div className="flex flex-col">
            {list.map((order, index) => (
              <div key={order.id}>
                {index > 0 && <Separator className="my-3" />}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">
                        {longDate(order.on_date)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {readMinutes(order.planned_minutes)} ordered ·{" "}
                        {relativeDay(order.on_date)}
                        {order.day_kind !== "WORKING" &&
                          ` · ${order.day_kind === "REST" ? "rest day" : "public holiday"}`}
                      </p>
                    </div>
                    <StatusPill status={order.state} className="ml-auto" />
                  </div>
                  <p className="text-[13px]">{order.ordered_reason}</p>
                  <p className="text-xs text-muted-foreground">
                    Ordered by {order.ordered_by}
                    {order.answered_at !== null &&
                      ` · answered ${dateTime(order.answered_at)}`}
                    {order.authorized_minutes !== null &&
                      ` · ${readMinutes(order.authorized_minutes)} authorized`}
                  </p>
                  {order.state === "AWAITING_CONSENT" && (
                    <div className="mt-1 flex gap-2">
                      <Button
                        size="lg"
                        className="h-11 flex-1"
                        disabled={answer.isPending}
                        onClick={() =>
                          answer.mutate({
                            orderId: order.id,
                            agreed: true,
                            // A phone is the wrong place to demand an essay,
                            // so the act is the reason and it is stated rather
                            // than left blank — the server records one either
                            // way, and a blank is not a reason.
                            reason: "bersedia lembur",
                          })
                        }
                      >
                        Agree
                      </Button>
                      <Button
                        variant="outline"
                        size="lg"
                        className="h-11 flex-1"
                        disabled={answer.isPending}
                        onClick={() =>
                          answer.mutate({
                            orderId: order.id,
                            agreed: false,
                            reason: "tidak bisa lembur",
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
