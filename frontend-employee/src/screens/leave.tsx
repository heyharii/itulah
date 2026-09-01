import { Link } from "@tanstack/react-router"

import { Async, Empty, Panel } from "@/components/bits"
import { StatusPill } from "@/components/status-pill"
import { Button, buttonVariants } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { dateRange, dateTime, shortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  useCancelLeave,
  useLeaveRequests,
  useLeaveTypes,
} from "@/lib/hr/queries"

/// What is left, what was asked for, and what came of it.
///
/// Balances above requests, because the balance is what somebody came to check
/// and the history is what they scroll to afterwards.
export function Leave() {
  const types = useLeaveTypes()
  const requests = useLeaveRequests()
  const cancel = useCancelLeave()

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Your balance">
        <Async query={types} empty="No leave entitlement on record.">
          {(list) => (
            <div className="flex flex-col gap-3">
              {list.map((type) => (
                <div
                  key={type.leave_type_id}
                  className="flex items-baseline gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">
                      {type.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {type.taken_days} taken
                      {type.pending_days > 0 &&
                        ` · ${type.pending_days} pending`}
                      {type.expires_on !== null &&
                        ` · expires ${shortDate(type.expires_on)}`}
                      {!type.paid && " · unpaid"}
                    </p>
                  </div>
                  <p className="ml-auto shrink-0 text-lg font-semibold tabular-nums">
                    {type.remaining_days}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      / {type.entitled_days}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </Async>
      </Panel>

      {/* Full width and tall: on a phone this is the reason the screen was
          opened, and it should be reachable with the thumb that is already
          holding the device. */}
      <Link
        to="/leave/new"
        className={cn(
          buttonVariants({ size: "lg" }),
          "h-11 w-full md:w-auto md:self-start"
        )}
      >
        Apply for leave
      </Link>

      <Panel title="Your requests">
        <Async query={requests} empty="You have not asked for leave yet.">
          {(list) => (
            <div className="flex flex-col">
              {list.map((request, index) => (
                <div key={request.request_id}>
                  {index > 0 && <Separator className="my-3" />}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">
                          {dateRange(request.from_date, request.to_date)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {request.leave_type_name} ·{" "}
                          {request.days === 1
                            ? "1 day"
                            : `${request.days} days`}
                        </p>
                      </div>
                      <StatusPill status={request.status} className="ml-auto" />
                    </div>
                    <p className="text-[13px]">{request.reason}</p>
                    {request.decision_note !== null && (
                      <p className="text-xs text-muted-foreground italic">
                        {request.decided_by}: {request.decision_note}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Asked {dateTime(request.submitted_at)}
                    </p>
                    {/* Only a request nobody has decided on can be withdrawn.
                        An approved one is a change to a rota somebody else has
                        already worked around, and that is a conversation, not
                        a button. */}
                    {request.status === "SUBMITTED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1 self-start"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(request.request_id)}
                      >
                        Withdraw
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Async>
        {cancel.error !== null && (
          <Empty>Could not withdraw that request. Try again.</Empty>
        )}
      </Panel>
    </div>
  )
}
