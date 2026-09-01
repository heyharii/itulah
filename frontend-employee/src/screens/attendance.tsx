import { Link } from "@tanstack/react-router"

import { Async, Panel } from "@/components/bits"
import { StatusPill } from "@/components/status-pill"
import { buttonVariants } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  clockTime,
  dayOfMonth,
  duration,
  longDate,
  weekday,
} from "@/lib/format"
import { useAttendance, useCorrections } from "@/lib/hr/queries"
import { cn } from "@/lib/utils"

/// The fortnight behind you, one row a day.
///
/// A fortnight rather than a month because this screen answers one question —
/// "is the day they recorded the day I worked?" — and that question is asked
/// while the shift is still remembered. Anything older is a payroll query and
/// goes through a person.
export function Attendance() {
  const days = useAttendance()
  const corrections = useCorrections()
  const pending = (corrections.data ?? []).filter(
    (correction) => correction.status === "SUBMITTED"
  )

  return (
    <div className="flex flex-col gap-4">
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

      <Panel title="Last 14 days">
        <Async query={days} empty="Nothing recorded in this period.">
          {(list) => (
            <div className="flex flex-col">
              {[...list].reverse().map((day, index) => (
                <div key={day.date}>
                  {index > 0 && <Separator className="my-3" />}
                  <div className="flex items-start gap-3">
                    {/* The date as a block on the left, the way a diary reads.
                        Fixed width so fourteen rows line up rather than
                        shuffling with the length of the weekday. */}
                    <div className="w-9 shrink-0 text-center">
                      <p className="text-[11px] text-muted-foreground uppercase">
                        {weekday(day.date)}
                      </p>
                      <p className="text-base leading-tight font-semibold tabular-nums">
                        {dayOfMonth(day.date)}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] tabular-nums">
                          {day.status === "REST"
                            ? "—"
                            : `${clockTime(day.first_in)} – ${clockTime(day.last_out)}`}
                        </p>
                        <StatusPill status={day.status} className="ml-auto" />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {day.worked_minutes > 0
                          ? duration(day.worked_minutes)
                          : day.scheduled_from === null
                            ? "No shift"
                            : `Rostered ${day.scheduled_from}–${day.scheduled_to}`}
                        {day.late_minutes > 0 &&
                          ` · ${day.late_minutes} min late`}
                        {day.place_name !== null && ` · ${day.place_name}`}
                      </p>
                      {/* Offered on the days that are actually wrong, and
                          withdrawn once a fix is already waiting: a second
                          request for the same day is noise for whoever has to
                          decide the first. */}
                      {(day.status === "INCOMPLETE" ||
                        day.status === "ABSENT") &&
                        !day.correction_pending && (
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
                      {day.correction_pending && (
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
        </Async>
      </Panel>

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
