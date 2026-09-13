import { useQuery } from "@tanstack/react-query"
import { CalendarOff, Clock4, Plane, Sunrise, UserCheck } from "lucide-react"

import { AppLink } from "@/components/ui/app-link"
import { RecordCard } from "@/components/ui/card"
import { Kpi, KpiGrid } from "@/components/ui/kpi"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import {
  awaitingOvertimeAt,
  hrKeys,
  isoDay,
  nameOf,
  pendingLeaveAt,
  planWord,
  readDate,
  readMinutes,
  rosterAt,
  teamAt,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { HrWorkspace } from "@/screens/hr/workspace"

/// Today, at this shop: who is rostered, and what is waiting on an answer.
///
/// This is the screen the owner pointed at — `#/people/overview/today` in
/// `prototypes/hr/` — and it is the module's front door for the same reason
/// the prototype makes it one: a manager opening People has one question
/// before any other, which is what today looks like.
///
/// # It does not say who is *in*, because nothing in this system knows
///
/// There is no attendance punch source anywhere — not at the till, not at the
/// centre. The centre says so itself rather than guessing: a period's
/// readiness answers `open_corrections: null` and `punches_assessed: false`,
/// and its own comment is that "`null` means **not assessed**, not zero … a
/// zero would be a claim that somebody looked and found none".
///
/// So this screen shows the **plan**, and says that is what it is. A row of
/// green ticks derived from a rota would be a claim nobody made, and the first
/// time it was believed it would be believed about somebody's pay.
export function HrToday() {
  return <HrWorkspace>{(scope) => <Today scope={scope} />}</HrWorkspace>
}

function Today({ scope }: { scope: StoreScope }) {
  const today = isoDay(new Date())

  const roster = useQuery({
    queryKey: hrKeys.roster(scope.id, today, today),
    queryFn: ({ signal }) => rosterAt(scope.id, today, today, signal),
  })
  // The names. A rota keyed by `emp_8f3…` is unreadable, and the workforce
  // list is the only route that carries a name — deliberately, because a name
  // is the one thing from a profile that list is allowed to show.
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

  // What touches today, as against what is merely waiting. A manager reading
  // this screen is asking about the shift in front of them; the rest is the
  // Leave & overtime queue's job, and the count below links to it.
  const leaveToday =
    leave.data?.rows.filter(
      (request) => request.from_date <= today && today <= request.to_date,
    ) ?? []
  const overtimeToday =
    overtime.data?.rows.filter((order) => order.on_date === today) ?? []
  const waitingLater =
    (leave.data?.rows.length ?? 0) -
    leaveToday.length +
    ((overtime.data?.rows.length ?? 0) - overtimeToday.length)

  return (
    <>
      <Section title={readDate(today, true)}>
        {centreState(roster, {
          loading: "Reading the rota head office holds…",
          render: (days) => {
            const working = days.filter((day) => day.plan === "SCHEDULED")
            const off = days.length - working.length
            const minutes = working.reduce(
              (total, day) => total + (day.planned_work_minutes ?? 0),
              0,
            )

            return (
              <>
                <KpiGrid className="mb-4">
                  <Kpi
                    icon={<UserCheck />}
                    tone="accent"
                    label="On the rota"
                    value={working.length}
                    sub={off === 0 ? undefined : `${off} off`}
                  />
                  <Kpi
                    icon={<Clock4 />}
                    tone="sky"
                    label="Planned hours"
                    value={readMinutes(minutes)}
                    sub="less unpaid breaks"
                  />
                  <Kpi
                    icon={<Plane />}
                    tone="orange"
                    label="Leave today"
                    value={leaveToday.length}
                    sub="waiting on a decision"
                  />
                  <Kpi
                    icon={<Sunrise />}
                    tone="green"
                    label="In the team"
                    value={team.data?.total ?? "—"}
                    sub={scope.id}
                  />
                </KpiGrid>

                <Banner tone="info" className="mb-4">
                  This is the rota, not the register. Nothing in this system
                  records anybody arriving — there is no punch source, and head
                  office reports the count of unrostered punch days as{" "}
                  <i>not assessed</i> rather than as zero. Who was actually here
                  is still something a person has to know.
                </Banner>

                {days.length === 0 ? (
                  <EmptyState>
                    Head office has no rota for {scope.id} today. That is a rota
                    nobody has built yet, not a shop with nobody in it.
                  </EmptyState>
                ) : (
                  <CardList>
                    {days.map((day) => {
                      const who = nameOf(team.data, day.employee_id)
                      const onLeave = leaveToday.some(
                        (request) => request.employee_id === day.employee_id,
                      )
                      return (
                        <RecordCard
                          key={day.employee_id}
                          icon={
                            day.plan === "SCHEDULED" ? (
                              <UserCheck />
                            ) : (
                              <CalendarOff />
                            )
                          }
                          id={who.name}
                          status={
                            onLeave ? (
                              <Pill tone="warn">Leave asked</Pill>
                            ) : (
                              <Pill
                                tone={
                                  day.plan === "SCHEDULED"
                                    ? "accent"
                                    : "neutral"
                                }
                              >
                                {planWord(day.plan)}
                              </Pill>
                            )
                          }
                        >
                          <div className="px-3.5 py-1">
                            <KeyValue term={who.code ?? "Badge"}>
                              {day.shift_name ?? planWord(day.plan)}
                            </KeyValue>
                            {day.starts_at !== null && day.ends_at !== null && (
                              <KeyValue term="Hours">
                                {day.starts_at}–{day.ends_at}
                                {day.crosses_midnight && " +1"}
                              </KeyValue>
                            )}
                            {day.planned_work_minutes !== null && (
                              <KeyValue term="Paid time">
                                {readMinutes(day.planned_work_minutes)}
                              </KeyValue>
                            )}
                            {/* A day planned more than once is a governance
                                signal, which is why the centre makes it a
                                column rather than something to open a sheet
                                for. It is shown only when it is one. */}
                            {day.revision_count > 1 && (
                              <KeyValue term="Planned" tone="bad">
                                {day.revision_count} times
                              </KeyValue>
                            )}
                          </div>
                        </RecordCard>
                      )
                    })}
                  </CardList>
                )}
              </>
            )
          },
        })}
      </Section>

      <Section title="Waiting on an answer today">
        {centreState(leave, {
          loading: "Reading the leave queue…",
          render: () =>
            leaveToday.length === 0 && overtimeToday.length === 0 ? (
              <EmptyState
                action={
                  waitingLater > 0 ? (
                    <AppLink
                      to="/hr/requests"
                      className="text-meta font-medium text-accent"
                    >
                      {waitingLater} waiting for another day
                    </AppLink>
                  ) : undefined
                }
              >
                Nothing today needs a decision.
              </EmptyState>
            ) : (
              <CardList>
                {leaveToday.map((request) => (
                  <RecordCard
                    key={request.id}
                    icon={<Plane />}
                    id={nameOf(team.data, request.employee_id).name}
                    status={<Pill tone="warn">{request.leave_type_name}</Pill>}
                  >
                    <div className="px-3.5 py-1">
                      <KeyValue term="Asked for">
                        {readDate(request.from_date)} –{" "}
                        {readDate(request.to_date)}
                      </KeyValue>
                      <KeyValue term="Days charged">
                        {request.chargeable_days}
                      </KeyValue>
                      <KeyValue term="Reason">{request.reason}</KeyValue>
                    </div>
                  </RecordCard>
                ))}
                {overtimeToday.map((order) => (
                  <RecordCard
                    key={order.id}
                    icon={<Clock4 />}
                    id={nameOf(team.data, order.employee_id).name}
                    status={<Pill tone="info">Overtime ordered</Pill>}
                  >
                    <div className="px-3.5 py-1">
                      <KeyValue term="Ordered">
                        {readMinutes(order.planned_minutes)}
                      </KeyValue>
                      <KeyValue term="Waiting on">the person, not you</KeyValue>
                    </div>
                  </RecordCard>
                ))}
              </CardList>
            ),
        })}
      </Section>
    </>
  )
}
