import { Link } from "@tanstack/react-router"

import { Async, Empty, List, Panel } from "@/screens/me/ui/bits"
import { StatusPill } from "@/screens/me/ui/status-pill"
import { Button } from "@/screens/me/ui/button"
import { button } from "@/screens/me/ui/button-style"
import { dateRange, dateTime } from "@/screens/me/data/format"
import {
  useLeaveEntitlements,
  useLeaveRequests,
  useProfile,
  useWhosOff,
  useWithdrawLeave,
} from "@/screens/me/data/queries"
import { readDays } from "@/screens/me/data/days"

/// What is left, what was asked for, and what came of it.
///
/// Balances above requests, because the balance is what somebody came to check
/// and the history is what they scroll to afterwards.
export function Leave() {
  const entitlements = useLeaveEntitlements()
  const requests = useLeaveRequests()
  const withdraw = useWithdrawLeave()
  const whosOff = useWhosOff()
  const me = useProfile().data?.employee_id

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Your balance">
        <Async query={entitlements} empty="No kind of leave is defined yet.">
          {(list) => (
            <List>
              {list.map((kind) => (
                <div key={kind.code} className="flex items-baseline gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-cell font-medium text-ink">
                      {kind.name}
                    </p>
                    <p className="text-meta text-body">
                      {/* Sick leave and maternity leave draw on nothing: UU
                          13/2003 gives them for as long as the certificate
                          says. "0 left" beside one would be telling somebody
                          they had run out of something that cannot run out. */}
                      {kind.perOccurrenceCentidays !== null
                        ? `Up to ${readDays(kind.perOccurrenceCentidays)} each time`
                        : !kind.drawsOnBalance
                          ? "No balance — granted as certified"
                          : (kind.pendingCentidays ?? 0) > 0
                            ? `${readDays(kind.pendingCentidays ?? 0)} waiting on a decision`
                            : "Nothing pending"}
                      {kind.requiresEvidence && " · needs a document"}
                    </p>
                  </div>
                  {kind.drawsOnBalance && (
                    <p className="num ml-auto shrink-0 text-kpi font-semibold text-ink">
                      {readDays(kind.remainingCentidays ?? 0)}
                    </p>
                  )}
                </div>
              ))}
            </List>
          )}
        </Async>
      </Panel>

      {/* Full width and tall: on a phone this is the reason the screen was
          opened, and it should be reachable with the thumb that is already
          holding the device. */}
      <Link
        to={"/me/leave/new" as string}
        className={button({
          variant: "primary",
          size: "tap",
          className: "w-full md:h-control md:w-auto md:self-start",
        })}
      >
        Apply for leave
      </Link>

      <Panel title="Your requests">
        <Async query={requests} empty="You have not asked for leave yet.">
          {(list) => (
            <List>
              {list.map((request) => (
                <div key={request.id}>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0">
                        <p className="text-cell font-medium text-ink">
                          {dateRange(request.from_date, request.to_date)}
                        </p>
                        <p className="text-meta text-body">
                          {/* The days actually charged, settled by the server
                              against the holiday calendar on the day this was
                              filed. A holiday inside the span is not one of
                              them, and counting here would get that wrong. */}
                          {request.leave_type_name} ·{" "}
                          {request.chargeable_days === 1
                            ? "1 day"
                            : `${request.chargeable_days} days`}
                        </p>
                      </div>
                      <StatusPill status={request.state} className="ml-auto" />
                    </div>
                    <p className="text-cell text-text">{request.reason}</p>
                    {request.decision_reason !== null && (
                      <p className="text-meta text-body italic">
                        {request.decided_by}: {request.decision_reason}
                      </p>
                    )}
                    <p className="text-meta text-mute">
                      Asked {dateTime(request.created_at)}
                    </p>
                    {/* Only a request nobody has decided on can be withdrawn.
                        An approved one is a change to a rota somebody else has
                        already worked around, and that is a conversation, not
                        a button. */}
                    {request.state === "PENDING" && (
                      <Button
                        className="mt-1 self-start"
                        disabled={withdraw.isPending}
                        onClick={() =>
                          withdraw.mutate({
                            requestId: request.id,
                            // The server records a reason against every
                            // decision, this one included. A phone is the wrong
                            // place to demand an essay, so the act is the
                            // reason and it is stated rather than left blank.
                            reason: "ditarik oleh pemohon",
                          })
                        }
                      >
                        Withdraw
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </List>
          )}
        </Async>
        {withdraw.error !== null && (
          <Empty>Could not withdraw that request. Try again.</Empty>
        )}
      </Panel>

      <Panel title="Who's off · next 2 weeks">
        <Async
          query={whosOff}
          empty="Nobody at your place is off in the next two weeks."
        >
          {(calendar) =>
            calendar.leave.length === 0 ? (
              <Empty>Nobody at your place is off in the next two weeks.</Empty>
            ) : (
              <List>
                {calendar.leave.map((span) => (
                  <div
                    key={`${span.employee_id}-${span.from_date}`}
                    className="flex items-start gap-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-cell font-medium text-ink">
                        {span.full_name ?? span.employee_code}
                        {span.employee_id === me && " (you)"}
                      </p>
                      <p className="text-meta text-body">
                        {dateRange(span.from_date, span.to_date)} ·{" "}
                        {span.leave_name}
                      </p>
                    </div>
                    {span.state === "PENDING" && (
                      <StatusPill status={span.state} className="ml-auto" />
                    )}
                  </div>
                ))}
              </List>
            )
          }
        </Async>
      </Panel>
    </div>
  )
}
