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
import { readDays, readMinutes } from "@/lib/hr/days"
import {
  useAttendance,
  useHolidays,
  useLeaveEntitlements,
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
  const entitlements = useLeaveEntitlements()
  const overtime = useOvertimeOrders()
  const holidays = useHolidays()
  const pay = usePaySlips()

  const days = attendance.data ?? []
  const today = days[days.length - 1]
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

  return (
    <div className="flex flex-col gap-4">
      <div>
        {/* The login's own display name, which is what somebody typed in as
            how they should be addressed. HR holds a legal name, and a greeting
            is not the place for it — the preferred name this used to read is
            not a field the employment record has. */}
        <p className="text-xl font-semibold">
          Hello, {session.identity.display_name}
        </p>
        <p className="text-[13px] text-muted-foreground">
          {/* Both halves are absent until a contract is signed and a posting
              made, and "null · null" is worse than the username. */}
          {[profile.data?.job_title, profile.data?.place_name]
            .filter(Boolean)
            .join(" · ") || session.identity.username}
        </p>
      </div>

      {awaiting.length > 0 && (
        <Panel title="Waiting on you">
          {awaiting.map((order) => (
            <div key={order.id} className="flex flex-col gap-1">
              <p className="text-[13px] font-medium">
                Overtime {relativeDay(order.on_date)} ·{" "}
                {readMinutes(order.planned_minutes)}
              </p>
              <p className="text-[13px] text-muted-foreground">
                {order.ordered_reason}
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
            No kind of leave draws on a balance yet.
          </p>
        ) : (
          <>
            <p className="text-3xl font-semibold tabular-nums">
              {readDays(annual.remainingCentidays ?? 0)}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                left
              </span>
            </p>
            <p className="text-[13px] text-muted-foreground">
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
          {nextHoliday.kind === "JOINT_LEAVE" && (
            <p className="text-[13px] text-muted-foreground">
              Cuti bersama — deducted from your annual leave.
            </p>
          )}
        </Panel>
      )}

      {latestPay !== undefined && (
        <Link to="/pay" className="block">
          <Panel title="Latest payslip">
            <div className="flex items-center gap-2">
              <div>
                {/* Agreed pay, not a net. Nothing here computes tax or BPJS,
                    so a figure labelled "net" would be the agreement wearing a
                    word it has not earned — and this is the card somebody
                    glances at rather than reads. */}
                <p className="text-lg font-semibold tabular-nums">
                  {money(latestPay.statutory_base_minor)}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Agreed pay · {latestPay.run_id}
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
