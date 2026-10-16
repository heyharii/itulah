import { Button } from "@/components/ui/button"
import {
  PeopleSheet,
  SheetFoot,
  SheetSection,
} from "@/components/ui/people-sheet"
import { Pill } from "@/components/ui/pill"
import type { DayRow } from "@/lib/queries/attendance"
import { clockOf, isoDay, readDate, readMinutes } from "@/lib/queries/hr"
import { shiftWord, sourceWord } from "@/screens/hr/attendance-words"
import { Facts } from "@/screens/hr/parts"
import { personName } from "@/screens/hr/words"
import type { EmployeeList } from "@itulah/contract"

/// One person's one day, opened from a row of the Day view or a cell of the
/// Week — the way into the correction flow.
///
/// It says what was planned, what the centre derived and what the readings
/// were, then offers the one thing that can be done about a day: a **fix**. An
/// attendance is never edited — the centre derives it again from the rota, the
/// punches and the approvals — so a forgotten check-in is filed as a fix, and
/// somebody other than the person who filed it decides it.

export function PersonDaySheet({
  row,
  team,
  onClose,
  onFix,
  onMonth,
}: {
  row: DayRow
  team: EmployeeList | undefined
  onClose: () => void
  /// Open the fix form on this person and day.
  onFix: (employeeId: string, date: string) => void
  /// Open this person's month.
  onMonth: (employeeId: string, period: string) => void
}) {
  const person = team?.rows.find((one) => one.employee_id === row.employeeId)
  const { day, standing } = row
  const late = day !== null && day.outcomes.includes("LATE")
  const early = day !== null && day.outcomes.includes("EARLY_LEAVE")
  // A fix is for a day that has happened.
  const fixable = row.date <= isoDay(new Date())

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={person?.full_name ? person.employee_code : undefined}
      crumb="Attendance"
      title={personName(team, row.employeeId)}
      sub={readDate(row.date, true)}
      status={<Pill tone={standing.tone}>{standing.label}</Pill>}
      foot={
        <SheetFoot>
          <Button
            variant="quiet"
            onClick={() => onMonth(row.employeeId, row.date.slice(0, 7))}
          >
            Whole month
          </Button>
          {fixable && (
            <Button
              variant="primary"
              onClick={() => onFix(row.employeeId, row.date)}
            >
              New fix
            </Button>
          )}
        </SheetFoot>
      }
    >
      <Facts
        rows={[
          ["Shift", shiftWord(row.rota)],
          standing.note !== null && ["Also", standing.note],
          ["Checked in", clockOf(day?.arrival ?? null)],
          ["Checked out", clockOf(day?.departure ?? null)],
          [
            "Worked",
            day !== null && day.departure !== null
              ? readMinutes(day.net_worked_minutes)
              : "—",
          ],
          late && day !== null && ["Late by", `${day.late_minutes} min`],
          early &&
            day !== null && ["Left early by", `${day.early_leave_minutes} min`],
          day !== null &&
            day.overtime_minutes_agreed > 0 && [
              "Agreed overtime",
              readMinutes(day.overtime_minutes_agreed),
            ],
          day !== null &&
            day.overtime_minutes_unagreed > 0 && [
              "Overtime, not agreed",
              readMinutes(day.overtime_minutes_unagreed),
            ],
          ["Seen by", sourceWord(day?.punch_sources ?? [])],
          day?.applied_correction != null && ["Fix applied", "Yes"],
        ]}
      />

      {row.punches.length > 0 && (
        <SheetSection title="Readings" className="mt-6">
          <ul>
            {row.punches.map((punch) => (
              <li
                key={punch.id}
                className="flex min-h-11 items-center gap-3 border-b border-hairline py-2 text-cell last:border-b-0"
              >
                <span className="w-16 shrink-0 text-ink tabular-nums">
                  {punch.at}
                </span>
                <span className="min-w-0 flex-1 text-body">
                  {punch.direction === "IN"
                    ? "In"
                    : punch.direction === "OUT"
                      ? "Out"
                      : punch.direction}
                </span>
                <span className="shrink-0 text-meta text-mute">
                  {sourceWord([punch.source])}
                </span>
              </li>
            ))}
          </ul>
        </SheetSection>
      )}
    </PeopleSheet>
  )
}
