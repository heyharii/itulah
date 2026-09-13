import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Clock4, Plane } from "lucide-react"

import { Button } from "@/components/ui/button"
import { RecordCard } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import {
  awaitingOvertimeAt,
  decideLeave,
  hrKeys,
  nameOf,
  pendingLeaveAt,
  readDate,
  readMinutes,
  teamAt,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState, describeCentre } from "@/screens/hr/centre"
import { HrWorkspace } from "@/screens/hr/workspace"
import type { EmployeeList, LeaveRequestView } from "@itulah/contract"

/// What is waiting on somebody at this shop.
///
/// One screen for leave and overtime rather than two, which is the console's
/// own ruling on the same queue: "a manager has five minutes and a list of
/// things waiting on them, not a leave task and a correction task and an
/// overtime task — three screens each holding two rows is how all three stop
/// being opened."
///
/// # Only one half of it is a decision
///
/// Leave is decided here. Overtime is **not**, and the difference is statutory
/// rather than a permission we chose: PP 35/2021 art. 26(2) wants two written
/// acts from two different people, so the employer orders and the worker
/// answers, and the centre keeps the two keys deliberately disjoint — "the
/// ordering route and the consent route never accept each other's key". A
/// manager pressing "agree" on somebody's behalf is exactly the thing that
/// rule exists to prevent, so there is no button here that could.
///
/// Ordering overtime is head office's console, not a counter tablet. What a
/// shop needs here is to see what it is waiting on.
export function HrRequests() {
  return <HrWorkspace>{(scope) => <Requests scope={scope} />}</HrWorkspace>
}

function Requests({ scope }: { scope: StoreScope }) {
  const team = useQuery({
    queryKey: hrKeys.team(scope.id),
    queryFn: ({ signal }) => teamAt(scope.id, signal),
  })
  const leave = useQuery({
    queryKey: hrKeys.leave(scope.id),
    queryFn: ({ signal }) => pendingLeaveAt(scope.id, signal),
  })
  const overtime = useQuery({
    queryKey: hrKeys.overtime(scope.id),
    queryFn: ({ signal }) => awaitingOvertimeAt(scope.id, signal),
  })

  return (
    <>
      <Section title="Leave">
        {centreState(leave, {
          loading: "Reading what is waiting on a decision…",
          render: (queue) => (
            <>
              <Fenced dropped={queue.elsewhere} place={scope.id} />
              {queue.rows.length === 0 ? (
                <EmptyState>
                  No leave is waiting on a decision at {scope.id}.
                </EmptyState>
              ) : (
                <CardList>
                  {queue.rows.map((request) => (
                    <LeaveRow
                      key={request.id}
                      request={request}
                      team={team.data}
                    />
                  ))}
                </CardList>
              )}
            </>
          ),
        })}
      </Section>

      <Section title="Overtime waiting on an answer">
        {centreState(overtime, {
          loading: "Reading the overtime orders…",
          render: (queue) => (
            <>
              <Fenced dropped={queue.elsewhere} place={scope.id} />
              {queue.rows.length === 0 ? (
                <EmptyState>
                  No overtime order at {scope.id} is waiting on an answer.
                </EmptyState>
              ) : (
                <>
                  <Banner tone="info" className="mb-4">
                    An order nobody answers authorises nothing — the hours are
                    either worked unpaid or not worked at all. The answer is the
                    person's own and cannot be given here on their behalf.
                  </Banner>
                  <CardList>
                    {queue.rows.map((order) => (
                      <RecordCard
                        key={order.id}
                        icon={<Clock4 />}
                        id={nameOf(team.data, order.employee_id).name}
                        status={<Pill tone="warn">Awaiting consent</Pill>}
                      >
                        <div className="px-3.5 py-1">
                          <KeyValue term="On">
                            {readDate(order.on_date, true)}
                          </KeyValue>
                          <KeyValue term="Ordered">
                            {readMinutes(order.planned_minutes)}
                          </KeyValue>
                          <KeyValue term="Day counts as">
                            {order.day_kind === "WORKING"
                              ? "a working day"
                              : order.day_kind === "REST"
                                ? "a rest day"
                                : "a public holiday"}
                          </KeyValue>
                          <KeyValue term="Ordered by">
                            {order.ordered_by}
                          </KeyValue>
                          <KeyValue term="Because">
                            {order.ordered_reason}
                          </KeyValue>
                          {/* `authorized_minutes` is null in every state but
                              AGREED, and that absence is the whole point: a
                              figure anything downstream may act on does not
                              exist until the person has said yes. */}
                          <KeyValue term="Authorised" tone="bad">
                            nothing yet
                          </KeyValue>
                        </div>
                      </RecordCard>
                    ))}
                  </CardList>
                </>
              )}
            </>
          ),
        })}
      </Section>
    </>
  )
}

/// Said out loud when the head-office session reaches further than this shop.
///
/// The two queues above take no place parameter — they bound themselves by the
/// caller's own posting — so a session that reaches everywhere is answered for
/// the whole fleet and narrowed in this browser. Zero is the normal answer and
/// draws nothing; anything else has to be admitted, because a filtered fleet
/// shown as a shop is a screen that is quietly wrong about which shop it is.
function Fenced({ dropped, place }: { dropped: number; place: string }) {
  if (dropped === 0) return null
  return (
    <Banner tone="warn" className="mb-4">
      Head office answered with {dropped} row{dropped === 1 ? "" : "s"} from
      other shops, because this sign-in is not bounded to one. They are not
      shown: this till only ever shows {place}.
    </Banner>
  )
}

/// One leave request, and the decision on it.
///
/// The reason is a field and not an afterthought because the centre refuses a
/// decision without one. A record that says what changed and not why is the
/// half of an audit trail that never helps anybody — and this one decides
/// whether somebody is paid for two days.
function LeaveRow({
  request,
  team,
}: {
  request: LeaveRequestView
  team: EmployeeList | undefined
}) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")

  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      decideLeave({
        employeeId: request.employee_id,
        requestId: request.id,
        decision,
        reason,
      }),
    onSuccess: () => {
      // Both queues, not just this one: a decision changes what is waiting,
      // and the Today screen counts the same rows.
      client.invalidateQueries({ queryKey: hrKeys.queue() })
    },
  })

  const who = nameOf(team, request.employee_id)

  return (
    <RecordCard
      icon={<Plane />}
      id={who.name}
      status={<Pill tone="warn">{request.leave_type_name}</Pill>}
    >
      <div className="px-3.5 py-1">
        <KeyValue term="Asked for">
          {readDate(request.from_date)} – {readDate(request.to_date)}
        </KeyValue>
        {/* The centre settles this when the request is filed, under the
            holiday calendar in force. A browser counting weekends itself would
            get *cuti bersama* wrong, and would be wrong about somebody's
            balance rather than about a label. */}
        <KeyValue term="Days charged">{request.chargeable_days}</KeyValue>
        <KeyValue term="Badge">{who.code ?? "—"}</KeyValue>
        <KeyValue term="Because">{request.reason}</KeyValue>
        {request.evidence !== null && (
          <KeyValue term="Evidence">{request.evidence}</KeyValue>
        )}
      </div>

      <div className="px-3.5 pt-1 pb-3.5">
        {open ? (
          <div className="flex flex-col gap-3">
            <Field
              label="Why"
              hint="Head office refuses a decision with no reason on it."
            >
              <Input
                autoFocus
                value={reason}
                placeholder="Cover is arranged with Sore"
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            {decide.error !== null && (
              <Banner tone="bad">{describeCentre(decide.error)}</Banner>
            )}
            <div className="flex gap-2">
              <Button
                variant="primary"
                block
                disabled={reason.trim() === "" || decide.isPending}
                onClick={() => decide.mutate("approve")}
              >
                Approve
              </Button>
              <Button
                variant="danger"
                block
                disabled={reason.trim() === "" || decide.isPending}
                onClick={() => decide.mutate("reject")}
              >
                Reject
              </Button>
            </div>
            <Button variant="quiet" block onClick={() => setOpen(false)}>
              Not now
            </Button>
          </div>
        ) : (
          <Button block onClick={() => setOpen(true)}>
            Decide
          </Button>
        )}
      </div>
    </RecordCard>
  )
}
