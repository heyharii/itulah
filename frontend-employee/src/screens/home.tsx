import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"

import { Async, Panel, Row } from "@/components/bits"
import { StatusPill } from "@/components/status-pill"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  clockTime,
  duration,
  isUpcoming,
  longDate,
  money,
  relativeDay,
  shortDate,
} from "@/lib/format"
import {
  useAttendance,
  useHolidays,
  useLeaveTypes,
  useOvertimeOrders,
  usePaySlips,
  useProfile,
} from "@/lib/hr/queries"
import { useSession } from "@/lib/session"

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
  const leaveTypes = useLeaveTypes()
  const overtime = useOvertimeOrders()
  const holidays = useHolidays()
  const pay = usePaySlips()

  const days = attendance.data ?? []
  const today = days[days.length - 1]
  const awaiting = (overtime.data ?? []).filter(
    (order) => order.status === "ORDERED"
  )
  const annual = (leaveTypes.data ?? []).find(
    (type) => type.leave_type_id === "annual"
  )
  const nextHoliday = (holidays.data?.days ?? []).find((day) =>
    isUpcoming(day.date)
  )
  const latestPay = (pay.data ?? [])[0]

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xl font-semibold">
          Hello, {profile.data?.preferred_name ?? session.identity.display_name}
        </p>
        <p className="text-[13px] text-muted-foreground">
          {profile.data === undefined
            ? session.identity.username
            : `${profile.data.job_title} · ${profile.data.place_name}`}
        </p>
      </div>

      {awaiting.length > 0 && (
        <Panel title="Waiting on you">
          {awaiting.map((order) => (
            <div key={order.order_id} className="flex flex-col gap-1">
              <p className="text-[13px] font-medium">
                Overtime {relativeDay(order.date)} · {order.planned_from}–
                {order.planned_to}
              </p>
              <p className="text-[13px] text-muted-foreground">
                {order.reason}
              </p>
            </div>
          ))}
          {/* Navigation styled as a button, not a Button that navigates.
              `<Button render={<Link/>}>` looks identical and is wrong
              underneath: Base UI puts `role="button"` on the anchor, so a
              screen reader announces "button" for something that changes the
              page. `buttonVariants` is the appearance without the semantics. */}
          <Link
            to="/overtime"
            className={cn(
              buttonVariants({ size: "lg" }),
              "h-11 w-full md:w-auto md:self-start"
            )}
          >
            Answer
          </Link>
        </Panel>
      )}

      <Panel title="Today">
        <Async query={attendance}>
          {() =>
            today === undefined ? (
              <p className="text-[13px] text-muted-foreground">
                Nothing recorded yet.
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-medium">
                    {longDate(today.date)}
                  </p>
                  <StatusPill status={today.status} className="ml-auto" />
                </div>
                <Row label="Clocked in">{clockTime(today.first_in)}</Row>
                <Row label="Clocked out">{clockTime(today.last_out)}</Row>
                <Row label="Worked">{duration(today.worked_minutes)}</Row>
              </>
            )
          }
        </Async>
      </Panel>

      <Panel
        title="Leave"
        action={
          <Link
            to="/leave/new"
            className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
          >
            Apply
          </Link>
        }
      >
        {annual === undefined ? (
          <p className="text-[13px] text-muted-foreground">
            No entitlement on record.
          </p>
        ) : (
          <>
            <p className="text-3xl font-semibold tabular-nums">
              {annual.remaining_days}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                days left
              </span>
            </p>
            <p className="text-[13px] text-muted-foreground">
              {annual.taken_days} taken
              {annual.pending_days > 0 &&
                `, ${annual.pending_days} awaiting approval`}
              {annual.expires_on !== null &&
                ` · expires ${shortDate(annual.expires_on)}`}
            </p>
          </>
        )}
      </Panel>

      {nextHoliday !== undefined && (
        <Panel title="Next day off">
          <Row label={nextHoliday.name}>
            {shortDate(nextHoliday.date)} · {relativeDay(nextHoliday.date)}
          </Row>
          {nextHoliday.kind === "JOINT_LEAVE" && (
            <p className="text-[13px] text-muted-foreground">
              Cuti bersama — deducted from your annual leave.
            </p>
          )}
        </Panel>
      )}

      {latestPay !== undefined && (
        <Link to="/pay" className="block">
          <Panel title="Last payslip">
            <div className="flex items-center gap-2">
              <div>
                <p className="text-lg font-semibold tabular-nums">
                  {money(latestPay.net_idr)}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  {shortDate(latestPay.period_start)} –{" "}
                  {shortDate(latestPay.period_end)}
                </p>
              </div>
              <ChevronRight className="ml-auto size-5 text-muted-foreground" />
            </div>
          </Panel>
        </Link>
      )}
    </div>
  )
}
