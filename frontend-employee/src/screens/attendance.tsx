import { Link } from "@tanstack/react-router"

import { Async, Empty, Failure, Panel } from "@/components/bits"
import { StatusPill } from "@/components/status-pill"
import { Button, buttonVariants } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  dayOfMonth,
  duration,
  longDate,
  punchClock,
  weekday,
} from "@/lib/format"
import { punchSource } from "@/lib/hr/days"
import { useAttendance, useCorrections, usePunch } from "@/lib/hr/queries"
import { cn } from "@/lib/utils"

/// The fortnight behind you, one row a day, and the button that starts today.
///
/// A fortnight rather than a month because this screen answers one question —
/// "is the day they recorded the day I worked?" — and that question is asked
/// while the shift is still remembered. Anything older is a payroll query and
/// goes through a person.
///
/// # Nothing on this screen is stored, and that is why it can change
///
/// Every day here is **derived on the request** from five things: the plan, the
/// punches, the version of the lateness policy in force on that date, the
/// approvals, and the correction in force. There is no status column anywhere.
/// So a day can legitimately read differently next week — because a correction
/// was approved, or a roster was revised — and that is the system working
/// rather than a figure moving under somebody.
///
/// # Two sources, and the screen says which
///
/// The owner's decision is a fingerprint station in every unit. None has been
/// bought, so today the only way anybody clocks in is the button below, and
/// every row will say it was recorded here. That is stated on each day rather
/// than assumed, because a time shown with no provenance presents somebody's
/// own claim as a measurement — and when the readers do arrive, the months
/// either side of them have to stay tellable apart.
export function Attendance() {
  const fortnight = useAttendance()
  const corrections = useCorrections()
  const punch = usePunch()
  const pending = (corrections.data ?? []).filter(
    (correction) => correction.status === "SUBMITTED"
  )
  const awaitingDecision = new Set(pending.map((one) => one.date))

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Clock">
        {/* Two buttons and no time field. The server stamps its own clock and
            works out which roster day the reading answers — for a shift that
            runs past midnight, that is yesterday — so there is nothing here to
            get wrong and nothing to choose. */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            className="h-12"
            disabled={punch.isPending}
            onClick={() => punch.mutate("IN")}
          >
            Clock in
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-12"
            disabled={punch.isPending}
            onClick={() => punch.mutate("OUT")}
          >
            Clock out
          </Button>
        </div>
        {punch.error !== null && <Failure error={punch.error} />}
        {punch.data !== undefined && punch.error === null && (
          <p className="text-[13px]">
            {punch.data.newly_recorded ? (
              <>
                Recorded {punch.data.direction === "IN" ? "in" : "out"} at{" "}
                <span className="font-medium tabular-nums">
                  {punchClock(punch.data.at)}
                </span>{" "}
                on {longDate(punch.data.business_date)}.
              </>
            ) : (
              // Not an error, and not silence either. The identity collided,
              // which is what makes a double tap safe — and a person who
              // pressed twice deserves to be told why the second one changed
              // nothing.
              <>Already recorded — this minute is on your day once.</>
            )}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          There is no fingerprint reader yet, so this is you recording your own
          day. Your manager sees that it came from the app.
        </p>
      </Panel>

      {pending.length > 0 && (
        <Panel title="Fixes you asked for">
          {pending.map((correction) => (
            <div
              key={correction.correction_id}
              className="flex items-start gap-2"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium">
                  {longDate(correction.date)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {correction.claimed_in ?? "—"} –{" "}
                  {correction.claimed_out ?? "—"} · {correction.reason}
                </p>
              </div>
              <StatusPill status={correction.status} className="ml-auto" />
            </div>
          ))}
        </Panel>
      )}

      <Async query={fortnight}>
        {(range) => (
          <>
            <Panel title="Last 14 days">
              {range.days.length === 0 ? (
                // Not "you were absent". A day with no plan derives to nothing
                // at all, so an empty fortnight means nobody rostered you —
                // which is HR's to fix and not a mark against anybody.
                <Empty>
                  Nothing is rostered in this period, so there is nothing to
                  measure.
                </Empty>
              ) : (
                <div className="flex flex-col">
                  {[...range.days].reverse().map((day, index) => (
                    <div key={day.date}>
                      {index > 0 && <Separator className="my-3" />}
                      <div className="flex items-start gap-3">
                        {/* The date as a block on the left, the way a diary
                            reads. Fixed width so fourteen rows line up rather
                            than shuffling with the length of the weekday. */}
                        <div className="w-9 shrink-0 text-center">
                          <p className="text-[11px] text-muted-foreground uppercase">
                            {weekday(day.date)}
                          </p>
                          <p className="text-base leading-tight font-semibold tabular-nums">
                            {dayOfMonth(day.date)}
                          </p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="mr-auto text-[13px] tabular-nums">
                              {punchClock(day.arrival)} –{" "}
                              {punchClock(day.departure)}
                            </p>
                            {/* Every outcome, not the first one. A day is
                                `LATE` and `AGREED_OVERTIME` at once often
                                enough that showing one would be choosing which
                                half of the evening counted. */}
                            {day.outcomes.map((outcome) => (
                              <StatusPill key={outcome} status={outcome} />
                            ))}
                            {day.outcomes.length === 0 && (
                              <StatusPill status={day.plan} />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {duration(day.net_worked_minutes)}
                            {day.late_minutes > 0 &&
                              ` · ${day.late_minutes} min late`}
                            {day.early_leave_minutes > 0 &&
                              ` · left ${day.early_leave_minutes} min early`}
                            {day.overtime_minutes_agreed > 0 &&
                              ` · ${duration(day.overtime_minutes_agreed)} agreed overtime`}
                          </p>
                          {/* The provenance, on every day that has any reading
                              at all. Muted, but never absent: this is the line
                              that keeps a tap on a phone from reading as
                              something a reader saw. */}
                          <p className="text-xs text-muted-foreground italic">
                            {punchSource(day.punch_sources)}
                            {day.applied_correction !== null &&
                              " · corrected by your manager"}
                          </p>
                          {/* Offered on the days that are actually wrong, and
                              withdrawn once a fix is already waiting: a second
                              request for the same day is noise for whoever has
                              to decide the first. */}
                          {(day.outcomes.includes("MISSING_PUNCH") ||
                            day.outcomes.includes("ABSENT")) &&
                            !awaitingDecision.has(day.date) && (
                              <Link
                                to="/attendance/correction/$date"
                                params={{ date: day.date }}
                                className={cn(
                                  buttonVariants({
                                    variant: "outline",
                                    size: "sm",
                                  }),
                                  "mt-2"
                                )}
                              >
                                Ask for a fix
                              </Link>
                            )}
                          {awaitingDecision.has(day.date) && (
                            <p className="mt-1 text-xs text-muted-foreground italic">
                              A fix is waiting on your manager.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* Days the server would not classify, with the reason it gave.
                Their own panel rather than a row in the list above, because
                they are not statements about the person: "no policy covers this
                date" is head office's to fix, and a day like this shown as an
                outcome would read as something somebody did. */}
            {range.underivable.length > 0 && (
              <Panel title="Days that cannot be worked out yet">
                {range.underivable.map((day) => (
                  <div key={day.date} className="flex flex-col gap-0.5">
                    <p className="text-[13px] font-medium">
                      {longDate(day.date)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {day.reason}
                    </p>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Nothing is wrong with your day. Something upstream of it is
                  missing, and it is not yours to fix.
                </p>
              </Panel>
            )}

            {!range.punch_source_connected && (
              <p className="px-1 text-xs text-muted-foreground">
                Your unit has no fingerprint reader registered, so everything
                above is what you recorded here yourself.
              </p>
            )}
          </>
        )}
      </Async>

      <Link
        to="/overtime"
        className={cn(
          buttonVariants({ variant: "outline", size: "lg" }),
          "h-11"
        )}
      >
        Overtime orders
      </Link>
    </div>
  )
}
