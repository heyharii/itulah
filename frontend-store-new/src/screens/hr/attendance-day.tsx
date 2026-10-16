import { PeopleTable } from "@/components/ui/people-table"
import { Status } from "@/components/ui/pill"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner } from "@/components/ui/states"
import {
  dayRows,
  tallyDay,
  useDay,
  useNow,
  type DayRow,
} from "@/lib/queries/attendance"
import { clockOf, readMinutes, type StoreScope } from "@/lib/queries/hr"
import { cn } from "@/lib/utils"
import { shiftWord, unwitnessed } from "@/screens/hr/attendance-words"
import { centreState } from "@/screens/hr/centre"
import { Heading, Person, personCard } from "@/screens/hr/parts"
import { personName } from "@/screens/hr/words"
import type { EmployeeList } from "@itulah/contract"

/// One day at this shop — the prototype's Attendance: who was due, when they
/// came in and went out, the hours, and how the day stands.
///
/// # Nothing here is typed in
///
/// Every status is *derived* at the centre, on every read, from the rota, the
/// punches (a registered reader, or a tap in the employee app inside the
/// shop's radius), the policy in force and the approvals — there is no stored
/// outcome and no column one could go in. So a forgotten check-in is not edited
/// here: it is a **fix**, filed from the sheet a row opens and decided by
/// somebody else.
///
/// A status is made here, from the derived day and the clock: the centre has no
/// "now", so a shift that has not begun reads as absent exactly as one that
/// ended empty (`standingOf`). Absence is only said of a finished day.
///
/// # "Not assessed" is not "absent"
///
/// The centre says whether any punch source has ever reported for this shop.
/// Until one has, a day with no check-in reads as not assessed rather than as a
/// row of absences — a red word would be a claim that something looked.

export function DayView({
  scope,
  team,
  date,
  onOpen,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
  date: string
  onOpen: (row: DayRow) => void
}) {
  const { rota, derived, live } = useDay(scope, date)
  const now = useNow(live)
  const active = (team?.rows ?? [])
    .filter((person) => person.status === "ACTIVE")
    .map((person) => person.employee_id)

  return centreState(derived, {
    loading: "Reading the day's attendance…",
    what: "this day's attendance",
    render: (view) => {
      const connected = view.punch_source_connected
      const rows = dayRows({
        date,
        rota: rota.data ?? [],
        view,
        active,
        now,
      })
      const sums = tallyDay(rows)

      return (
        <>
          {!connected && (
            <Banner tone="info" className="mb-4">
              No check-in source has reported yet. Not assessed.
            </Banner>
          )}
          <StatStrip>
            <Stat label="Scheduled" value={sums.scheduled} />
            <Stat
              label="In"
              value={sums.arrived}
              sub={live ? `${sums.working} working now` : undefined}
            />
            <Stat
              label="Late"
              value={sums.late}
              tone={sums.late > 0 ? "warn" : undefined}
            />
            <Stat
              label="Absent"
              value={connected ? sums.absent : "—"}
              tone={connected && sums.absent > 0 ? "bad" : undefined}
            />
          </StatStrip>

          <PeopleTable
            rows={rows}
            rowKey={(row) => row.employeeId}
            onRowClick={onOpen}
            empty="Nobody is rostered or checked in."
            card={(row) => {
              const arrival = row.day?.arrival ?? null
              return {
                ...personCard(team, row.employeeId, [shiftWord(row.rota)]),
                // The time they checked in; before that, the time they are
                // due, quieter. A day off has no time to say.
                lead:
                  arrival !== null
                    ? { figure: clockOf(arrival), caption: "checked in" }
                    : row.rota?.plan === "SCHEDULED" &&
                        row.rota.starts_at !== null
                      ? {
                          figure: row.rota.starts_at,
                          caption: "due in",
                          muted: true,
                        }
                      : undefined,
                foot: {
                  info: <Standing row={row} />,
                  action: { label: "Open", onClick: () => onOpen(row) },
                },
              }
            }}
            columns={[
              {
                key: "who",
                header: "Employee",
                cell: (row) => <Person team={team} id={row.employeeId} />,
              },
              {
                key: "shift",
                header: "Shift",
                card: "meta",
                cell: (row) =>
                  row.rota?.plan === "SCHEDULED" ? (
                    <span className="flex flex-col">
                      <span>{row.rota.shift_name ?? "Shift"}</span>
                      <span className="text-meta text-mute tabular-nums">
                        {row.rota.starts_at}–{row.rota.ends_at}
                      </span>
                    </span>
                  ) : (
                    <span className="text-mute">{shiftWord(row.rota)}</span>
                  ),
              },
              {
                key: "in",
                header: "In",
                align: "right",
                card: "hide",
                cell: (row) => <Time row={row} which="arrival" />,
              },
              {
                key: "out",
                header: "Out",
                align: "right",
                card: "hide",
                cell: (row) => <Time row={row} which="departure" />,
              },
              {
                key: "hours",
                header: "Hours",
                align: "right",
                card: "hide",
                cell: (row) =>
                  row.day !== null && row.day.departure !== null ? (
                    readMinutes(row.day.net_worked_minutes)
                  ) : (
                    <span className="text-mute">—</span>
                  ),
              },
              {
                key: "status",
                header: "Status",
                card: "status",
                cell: (row) => <Standing row={row} />,
              },
            ]}
          />

          {view.underivable.length > 0 && (
            <>
              <Heading count={view.underivable.length}>Not assessed</Heading>
              <Banner tone="warn">
                {view.underivable.map((day) => (
                  <span
                    key={`${day.employee_id}-${day.date}`}
                    className="block"
                  >
                    {personName(team, day.employee_id)}: {day.reason}
                  </span>
                ))}
              </Banner>
            </>
          )}
        </>
      )
    },
  })
}

/// A day's status: the dot and the word, and what else is true under it.
function Standing({ row }: { row: DayRow }) {
  const { standing } = row
  return (
    <span className="flex flex-col">
      <Status tone={standing.tone}>{standing.label}</Status>
      {standing.note !== null && (
        <span className="pl-3.5 text-meta text-mute">{standing.note}</span>
      )}
    </span>
  )
}

/// A check-in or a check-out. A late arrival is the time in warning colour;
/// one that only a phone saw says so, small, because nothing witnessed it.
function Time({ row, which }: { row: DayRow; which: "arrival" | "departure" }) {
  const stamp = row.day?.[which] ?? null
  if (stamp === null) return <span className="text-mute">—</span>
  const late = which === "arrival" && row.standing.kind === "late"
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn("tabular-nums", late && "font-medium text-warn-fg")}>
        {clockOf(stamp)}
      </span>
      {row.day !== null && unwitnessed(row.day.punch_sources) && (
        <span className="text-meta font-normal text-mute">App</span>
      )}
    </span>
  )
}
