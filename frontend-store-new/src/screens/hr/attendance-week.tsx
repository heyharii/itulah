import { Card } from "@/components/ui/card"
import { LeadFigure } from "@/components/ui/lead-card"
import { Status } from "@/components/ui/pill"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner, LoadingState } from "@/components/ui/states"
import { dayRows, useNow, useWeek, type DayRow } from "@/lib/queries/attendance"
import {
  clockOf,
  readDate,
  readMinutes,
  type StoreScope,
} from "@/lib/queries/hr"
import { useLayout } from "@/lib/layout"
import { dateText } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  cellTone,
  cellWord,
  shiftWord,
  unwitnessed,
  type CellTone,
} from "@/screens/hr/attendance-words"
import { RefusedBanner } from "@/screens/hr/refused"
import { dayName } from "@/screens/hr/schedule-look"
import { personName } from "@/screens/hr/words"
import type { EmployeeList } from "@itulah/contract"

/// One week at this shop — the prototype's Attendance, week matrix: a person a
/// row, a day a column, the time in over the time out in each cell, tinted when
/// the day was late or left early, and red when nobody came.
///
/// The same derivation as the Day view, seven times: each day is the centre's
/// answer for the whole shop, and each status is made from it and the clock
/// (see `standingOf`). A day that has not begun is not asked for.
///
/// A phone gets a card per person — the hours worked as the figure, the seven
/// days under it — because nothing there scrolls sideways.

/// The tint of a cell by how the day stands.
const TINT: Record<CellTone, string> = {
  ok: "bg-ok-bg/40",
  warn: "bg-warn-bg text-warn-fg",
  bad: "bg-bad-bg font-semibold text-bad-fg",
  nil: "text-mute",
}

/// What a person's days add up to: the minutes worked, over finished days.
function workedMinutes(cells: readonly (DayRow | undefined)[]): number {
  return cells.reduce(
    (total, cell) =>
      total +
      (cell?.day != null && cell.day.departure !== null
        ? cell.day.net_worked_minutes
        : 0),
    0,
  )
}

export function WeekView({
  scope,
  team,
  days,
  onOpen,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
  days: readonly string[]
  onOpen: (row: DayRow) => void
}) {
  const phone = useLayout() === "phone"
  const { rota, reads, today } = useWeek(scope, days)
  const live = days.includes(today)
  const now = useNow(live)

  const rotaRows = rota.data ?? []
  const active = (team?.rows ?? [])
    .filter((person) => person.status === "ACTIVE")
    .map((person) => person.employee_id)
  // Everybody on the books, plus anybody rostered or checked in who is not.
  const people = [
    ...new Set([
      ...active,
      ...rotaRows.map((row) => row.employee_id),
      ...reads.flatMap((read) =>
        (read.data?.days ?? []).map((day) => day.employee_id),
      ),
    ]),
  ]

  // Each day's rows, by person.
  const byDay = days.map((date, index) => {
    const rows = dayRows({
      date,
      rota: rotaRows.filter((row) => row.on_date === date),
      view: reads[index]?.data,
      active: people,
      now,
    })
    return new Map(rows.map((row) => [row.employeeId, row]))
  })
  const cellsOf = (employeeId: string) =>
    byDay.map((rows) => rows.get(employeeId))

  const failed = reads.find((read) => read.isError)
  const waiting = reads.some(
    (read, index) => (days[index] as string) <= today && read.isPending,
  )
  const connected = reads.some((read) => read.data?.punch_source_connected)
  const all = byDay.flatMap((rows) => [...rows.values()])
  const late = all.filter((row) => row.day?.outcomes.includes("LATE")).length
  const absent = all.filter((row) => row.standing.kind === "absent").length
  const working = all.filter((row) => row.standing.kind === "working").length

  if (waiting && reads.every((read) => read.data === undefined)) {
    return <LoadingState>Reading the week's attendance…</LoadingState>
  }

  return (
    <>
      {failed !== undefined && (
        <RefusedBanner error={failed.error} what="this week's attendance" />
      )}
      {!connected && !waiting && (
        <Banner tone="info" className="mb-4">
          No check-in source has reported yet. Not assessed.
        </Banner>
      )}
      <StatStrip>
        <Stat label="Late" value={late} tone={late > 0 ? "warn" : undefined} />
        <Stat
          label="Absent"
          value={connected ? absent : "—"}
          tone={connected && absent > 0 ? "bad" : undefined}
        />
        {live && <Stat label="Working now" value={working} />}
      </StatStrip>

      {phone ? (
        <div className="flex flex-col gap-3">
          {people.map((employeeId) => {
            const cells = cellsOf(employeeId)
            const minutes = workedMinutes(cells)
            return (
              <section
                key={employeeId}
                className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft"
              >
                <div className="flex items-start gap-3 p-4">
                  <h3 className="line-clamp-2 min-w-0 flex-1 text-card-title font-semibold break-words text-ink">
                    {personName(team, employeeId)}
                  </h3>
                  <LeadFigure
                    value={minutes === 0 ? "—" : readMinutes(minutes)}
                    caption="worked"
                    muted={minutes === 0}
                  />
                </div>
                <ul className="border-t border-hairline">
                  {days.map((date, index) => {
                    const row = cells[index]
                    const tappable =
                      row !== undefined &&
                      date <= today &&
                      row.standing.kind !== "unplanned"
                    return (
                      <li
                        key={date}
                        className="border-b border-hairline last:border-b-0"
                      >
                        <button
                          type="button"
                          disabled={!tappable}
                          onClick={() => row !== undefined && onOpen(row)}
                          className={cn(
                            "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-(--t-press) ease-(--ease-out) enabled:active:bg-soft",
                            date === today && "bg-accent-bg/60",
                          )}
                        >
                          <span
                            className={cn(
                              "w-[4.5rem] shrink-0 text-[0.9375rem] tabular-nums",
                              date === today
                                ? "font-semibold text-accent"
                                : "text-body",
                            )}
                          >
                            {dayName(date)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {row === undefined ? (
                              <span className="text-mute">—</span>
                            ) : (
                              <Status tone={row.standing.tone}>
                                {row.standing.label}
                              </Status>
                            )}
                          </span>
                          {row?.day?.arrival != null && (
                            <span className="shrink-0 text-[0.9375rem] text-body tabular-nums">
                              {clockOf(row.day.arrival)}–
                              {clockOf(row.day.departure)}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      ) : (
        <>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] border-collapse text-cell">
                <colgroup>
                  <col className="w-52" />
                  {days.map((date) => (
                    <col key={date} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 h-10 border-b border-hairline bg-soft px-3.5 text-left text-meta font-medium text-body">
                      Employee
                    </th>
                    {days.map((date) => (
                      <th
                        key={date}
                        className={cn(
                          "h-10 border-b border-hairline px-1 text-center text-meta font-medium",
                          date === today
                            ? "bg-accent-bg text-accent"
                            : "bg-soft text-body",
                        )}
                      >
                        {dateText(new Date(`${date}T00:00:00`), {
                          weekday: "short",
                        })}{" "}
                        <span className="tabular-nums">{date.slice(8)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {people.map((employeeId) => {
                    const cells = cellsOf(employeeId)
                    const minutes = workedMinutes(cells)
                    return (
                      <tr key={employeeId} className="border-b border-hairline">
                        <th className="sticky left-0 z-10 bg-canvas px-3.5 py-2 text-left font-normal">
                          <span className="block truncate text-cell font-medium text-ink">
                            {personName(team, employeeId)}
                          </span>
                          <span className="block text-meta text-mute tabular-nums">
                            {readMinutes(minutes)} this week
                          </span>
                        </th>
                        {days.map((date, index) => {
                          const row = cells[index]
                          return (
                            <td key={date} className="p-1.5 align-middle">
                              <Cell
                                row={row}
                                future={date > today}
                                onOpen={onOpen}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta text-body">
            {(
              [
                ["On time", "bg-ok-bg"],
                ["Late or left early", "bg-warn-bg"],
                ["Absent", "bg-bad-bg"],
              ] as const
            ).map(([label, tone]) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <span className={cn("size-3.5 rounded-[0.25rem]", tone)} />
                {label}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  )
}

/// One person-day: the time in over the time out, or the word that stands in
/// for them. Pressing it opens the day.
function Cell({
  row,
  future,
  onOpen,
}: {
  row: DayRow | undefined
  future: boolean
  onOpen: (row: DayRow) => void
}) {
  if (row === undefined) {
    return <span className="grid min-h-14 place-items-center text-mute">—</span>
  }
  const arrival = row.day?.arrival ?? null
  const tone = cellTone(row.standing.kind)
  const away = future || row.standing.kind === "unplanned"
  return (
    <button
      type="button"
      disabled={away}
      onClick={() => onOpen(row)}
      title={`${row.standing.label} · ${shiftWord(row.rota)}`}
      aria-label={`${row.standing.label}, ${readDate(row.date, true)}`}
      className={cn(
        "flex min-h-14 w-full flex-col items-center justify-center rounded-inner px-1 text-center leading-[1.3] tabular-nums",
        "transition-[scale,filter] duration-(--t-press) ease-(--ease-out) enabled:hover:brightness-95 enabled:active:scale-[0.98]",
        TINT[tone],
      )}
    >
      {arrival !== null ? (
        <>
          <b
            className={cn(
              "font-semibold",
              tone === "warn" ? "text-warn-fg" : "text-ink",
            )}
          >
            {clockOf(arrival)}
            {row.day !== null && unwitnessed(row.day.punch_sources) && (
              <span className="ml-1 font-normal text-mute">App</span>
            )}
          </b>
          <span className="text-mute">
            {row.day?.departure != null
              ? clockOf(row.day.departure)
              : row.standing.kind === "working"
                ? "working"
                : "—"}
          </span>
        </>
      ) : (
        cellWord(row.standing.kind)
      )}
    </button>
  )
}
