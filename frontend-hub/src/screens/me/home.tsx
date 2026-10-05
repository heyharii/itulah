import { useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"

import { isHiddenPath } from "@/lib/navigation"
import { Async, Panel, Row } from "@/screens/me/ui/bits"
import { Button } from "@/screens/me/ui/button"
import { StatusPill } from "@/screens/me/ui/status-pill"
import { button } from "@/screens/me/ui/button-style"
import {
  duration,
  isUpcoming,
  longDate,
  money,
  punchClock,
  relativeDay,
  shortDate,
} from "@/screens/me/data/format"
import {
  punchSource,
  readDays,
  readMinutes,
  settledOutcomes,
} from "@/screens/me/data/days"
import {
  attendanceWindow,
  useAttendance,
  useCompleteOwnTask,
  useHolidays,
  useLeaveEntitlements,
  useMyLifecycleTasks,
  useOvertimeOrders,
  usePaySlips,
  useProfile,
} from "@/screens/me/data/queries"

import { useSession } from "@/screens/me/data/session"

/// The one screen somebody opens without a question in mind.
///
/// Ordered by what is owed rather than by what is interesting: anything
/// waiting on this person comes first, then today, then the numbers they check
/// out of habit. An overtime order they have not answered is the only thing on
/// here that somebody else is blocked on.
export function Home() {
  const session = useSession()
  const profile = useProfile()
  const attendance = useAttendance()
  const entitlements = useLeaveEntitlements()
  const overtime = useOvertimeOrders()
  const holidays = useHolidays()
  const pay = usePaySlips()

  // Today, by its date, rather than "the last day in the range". The range is
  // the *roster*, so its last entry is the last day somebody was scheduled —
  // which on a rest day is Saturday, and showing Saturday's hours under a
  // heading that says Today is the kind of small lie nobody ever reports.
  const today = (attendance.data?.days ?? []).find(
    (day) => day.date === attendanceWindow().to
  )
  // Waiting on *them*, specifically. An order nobody has answered authorizes
  // nothing, so this is the one card on this screen that is a task rather than
  // a fact.
  const awaiting = (overtime.data ?? []).filter(
    (order) => order.state === "AWAITING_CONSENT"
  )
  // The first kind that actually draws on a balance, rather than one named
  // `annual`: the kinds are the operator's to define and their codes are their
  // own — `CUTI_TAHUNAN` here, something else at the next company — so a card
  // keyed to a hardcoded id is a card that is blank wherever it was not
  // written.
  const annual = entitlements.data.find((kind) => kind.drawsOnBalance)
  const nextHoliday = (holidays.data?.days ?? []).find((day) =>
    isUpcoming(day.date)
  )
  const latestPay = (pay.data ?? [])[0]
  const isManager =
    session.identity.role === "ADMIN" || session.identity.role === "SUPERVISOR"
  // A new joiner's checklist: the tasks whose owner is the employee. Empty
  // for everybody who has finished onboarding, which is why it sits above
  // Today and renders nothing at all once it is done.
  const tasks = useMyLifecycleTasks()
  // Only what is theirs to tick: the store's, IT's and head office's tasks
  // are on the same checklist but are not a button on this phone.
  const openTasks = (tasks.data ?? []).filter(
    (task) => task.state === "PENDING" && task.owner === "EMPLOYEE"
  )
  const client = useQueryClient()
  const completeTask = useCompleteOwnTask()
  void client

  return (
    <div className="flex flex-col gap-4">
      <div>
        {/* The login's own display name, which is what somebody typed in as
            how they should be addressed. HR holds a legal name, and a greeting
            is not the place for it — the preferred name this used to read is
            not a field the employment record has. */}
        <p className="text-hero font-semibold text-ink">
          Hello, {session.identity.display_name}
        </p>
        <p className="text-meta text-body">
          {/* Both halves are absent until a contract is signed and a posting
              made, and "null · null" is worse than the username. */}
          {[profile.data?.job_title, profile.data?.unit_name]
            .filter(Boolean)
            .join(" · ") || session.identity.username}
        </p>
      </div>

      {/* The store head's desk, one tap away — and only for a store head.
          The rung rides the session; the server re-checks every decision
          against reach and the record anyway. */}
      {isManager && !isHiddenPath("/people/overview") && (
        <Link
          to={"/people/overview" as string}
          className={button({
            size: "tap",
            className: "w-full justify-between md:h-control",
          })}
        >
          Team queue
          <ChevronRight className="size-4" />
        </Link>
      )}

      {openTasks.length > 0 && (
        <Panel title={`Checklist (${openTasks.length})`}>
          <div className="flex flex-col gap-3">
            {openTasks.map((task) => (
              <div key={task.id} className="flex flex-col gap-1">
                <p className="text-cell font-medium text-ink">{task.label}</p>
                <Button
                  variant="primary"
                  size="tap"
                  disabled={completeTask.isPending}
                  onClick={() =>
                    // The server records a reason against every act; on a
                    // phone the act is the reason, stated rather than asked.
                    completeTask.mutate({
                      templateId: task.template_id,
                      reason: "ditandai selesai oleh karyawan",
                    })
                  }
                >
                  Mark done
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {awaiting.length > 0 && (
        <Panel title="Waiting on you">
          {awaiting.map((order) => (
            <div key={order.id} className="flex flex-col gap-1">
              <p className="text-cell font-medium text-ink">
                Overtime {relativeDay(order.on_date)} ·{" "}
                {readMinutes(order.planned_minutes)}
              </p>
              <p className="text-cell text-body">{order.ordered_reason}</p>
            </div>
          ))}
          {/* Navigation styled as a button, not a Button that navigates.
              `<Button render={<Link/>}>` looks identical and is wrong
              underneath: Base UI puts `role="button"` on the anchor, so a
              screen reader announces "button" for something that changes the
              page. `button` is the appearance without the semantics. */}
          <Link
            to={"/me/overtime" as string}
            className={button({
              variant: "primary",
              size: "tap",
              className: "w-full md:h-control md:w-auto md:self-start",
            })}
          >
            Answer
          </Link>
        </Panel>
      )}

      <Panel title="Today">
        <Async query={attendance}>
          {() =>
            today === undefined ? (
              // Deliberately not "absent". Today derives to nothing until
              // somebody has rostered it, and a home screen is the last place
              // to tell a person they did not turn up.
              <p className="text-cell text-body">Nothing recorded yet today.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="mr-auto text-cell font-medium text-ink">
                    {longDate(today.date)}
                  </p>
                  {settledOutcomes(today, today.date).map((outcome) => (
                    <StatusPill key={outcome} status={outcome} />
                  ))}
                  {settledOutcomes(today, today.date).length === 0 && (
                    <StatusPill status={today.plan} />
                  )}
                </div>
                <Row label="Clocked in">{punchClock(today.arrival)}</Row>
                <Row label="Clocked out">{punchClock(today.departure)}</Row>
                <Row label="Worked">{duration(today.net_worked_minutes)}</Row>
                {/* Where the two times above came from. A reader witnessed an
                    arrival; this app witnessed a button. Both are on the same
                    screen now, so the row that tells them apart belongs here
                    too and not only on the Attendance list. */}
                <Row label="Recorded by">
                  {punchSource(today.punch_sources)}
                </Row>
              </>
            )
          }
        </Async>
      </Panel>

      <Panel
        title="Leave"
        action={
          <Link
            to={"/me/leave/new" as string}
            className={button({ size: "sm" })}
          >
            Apply
          </Link>
        }
      >
        {annual === undefined ? (
          <p className="text-cell text-body">
            No kind of leave draws on a balance yet.
          </p>
        ) : (
          <>
            <p className="num text-kpi font-semibold text-ink">
              {readDays(annual.remainingCentidays ?? 0)}
              <span className="ml-1.5 text-cell font-normal text-mute">
                left
              </span>
            </p>
            <p className="text-cell text-body">
              {annual.name}
              {(annual.pendingCentidays ?? 0) > 0 &&
                ` · ${readDays(annual.pendingCentidays ?? 0)} awaiting a decision`}
            </p>
          </>
        )}
      </Panel>

      {nextHoliday !== undefined && (
        <Panel title="Next day off">
          <Row label={nextHoliday.name}>
            {shortDate(nextHoliday.date)} · {relativeDay(nextHoliday.date)}
          </Row>
          {nextHoliday.consumes_annual_leave && (
            <p className="text-cell text-body">
              Cuti bersama — deducted from your annual leave.
            </p>
          )}
        </Panel>
      )}

      {latestPay !== undefined && (
        <Link
          to={"/me/pay" as string}
          className="block rounded-card transition-shadow hover:shadow-pop"
        >
          <Panel title="Latest payslip">
            <div className="flex items-center gap-2">
              <div>
                {/* Take-home pay since 0800. A month the server could not
                    work out says so rather than showing the agreement under a
                    word it has not earned — this is the card somebody glances
                    at rather than reads. */}
                <p className="num text-kpi font-semibold text-ink">
                  {latestPay.net_minor === null
                    ? "Not worked out yet"
                    : money(latestPay.net_minor)}
                </p>
                <p className="text-cell text-body">
                  Take-home pay · {latestPay.run_id}
                </p>
              </div>
              <ChevronRight className="ml-auto size-5 text-line-ico" />
            </div>
          </Panel>
        </Link>
      )}
    </div>
  )
}
