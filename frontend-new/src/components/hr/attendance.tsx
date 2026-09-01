import { useMemo, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import { Avatar } from "@/components/hr/parts"
import type { HrAttendanceRecord, HrWorkforceToday } from "@/components/hr/api"
import type { Employee } from "@/components/hr/data"
import {
  DAY_STATUS,
  dayKey,
  dayIndex,
  monthDays,
  punchesOn,
  todayKey,
  weekOfDay,
  useHr,
  type DayKey,
  type DayStatus,
} from "@/components/hr/store"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const ATTENDANCE_RECORD_COLUMNS = "124px 160px 148px 142px 116px minmax(0,1fr)"
const YEAR_COLUMNS = "230px repeat(12, minmax(0,1fr)) 74px"

type Range = "day" | "month" | "year"

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]
const WEEKDAY = ["M", "T", "W", "T", "F", "S", "S"]

const BANDS = [
  { label: "Steady", hue: "var(--grass)", holds: (rate: number) => rate >= 95 },
  {
    label: "Slipping",
    hue: "var(--honey)",
    holds: (rate: number) => rate >= 85 && rate < 95,
  },
  { label: "At risk", hue: "var(--ember)", holds: (rate: number) => rate < 85 },
]

/** A rate on the same red-to-green ramp the cells use. */
function rateTint(rate: number | null) {
  if (rate === null)
    return { background: "var(--inset)", color: "var(--ink-4)" }
  const hue = rate >= 50 ? "var(--grass)" : "var(--ember)"
  const strength = rate >= 50 ? (rate - 50) / 50 : (50 - rate) / 50
  return {
    background: `color-mix(in srgb, ${hue} ${8 + strength * 46}%, var(--surface))`,
    color: strength > 0.55 ? "var(--surface)" : "var(--ink)",
  }
}

/**
 * The local attendance view is derived from its roster and approved leave —
 * the optional Internal rollup is displayed separately and never merged into
 * the fixture cells.
 */
export function Attendance({
  team,
  onFixDay,
  liveWorkforce,
}: {
  team: Employee[]
  /** Store-side only: correct what the clock recorded for one day. */
  onFixDay?: (employee: Employee, key: DayKey) => void
  /** Optional read-only rollup from Internal's daily workforce endpoint. */
  liveWorkforce?: HrWorkforceToday
}) {
  const { attendanceOn, monthAttendance, holidayOn, fixOn } = useHr()
  const [range, setRange] = useState<Range>("month")
  const [cursor, setCursor] = useState(() => new Date())
  const [day, setDay] = useState<DayKey>(todayKey)

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const days = useMemo(() => monthDays(year, month), [year, month])

  /* one number per person for the month in view, reused by the bands */
  const scored = useMemo(
    () =>
      team.map((person) => {
        const record = monthAttendance(person.id, year, month)
        const counted = record.present + record.late + record.absent
        return {
          person,
          rate: counted ? ((record.present + record.late) / counted) * 100 : 0,
        }
      }),
    [team, monthAttendance, year, month]
  )

  const step = (by: number) => {
    if (range === "day") {
      const d = new Date(`${day}T12:00:00`)
      d.setDate(d.getDate() + by)
      setDay(dayKey(d))
      return
    }
    const d = new Date(cursor)
    if (range === "month") d.setMonth(d.getMonth() + by)
    else d.setFullYear(d.getFullYear() + by)
    setCursor(d)
  }

  const label =
    range === "day"
      ? new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : range === "month"
        ? `${MONTHS[month]} ${year}`
        : String(year)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {liveWorkforce && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-inset px-3.5 py-2 text-[11px] text-ink-3">
          <span className="font-semibold text-ink-2">
            Live Internal workforce
          </span>
          <span>{liveWorkforce.date}</span>
          <span>
            {liveWorkforce.totals.present}/{liveWorkforce.totals.scheduled}{" "}
            present
          </span>
          <span>{liveWorkforce.totals.late} late</span>
          <span>{liveWorkforce.totals.absent} absent</span>
          <span>{liveWorkforce.totals.onLeave} on leave</span>
          {liveWorkforce.totals.missingClockOut > 0 && (
            <span className="text-honey">
              {liveWorkforce.totals.missingClockOut} missing clock-out
            </span>
          )}
          {liveWorkforce.exceptions.length > 0 && (
            <span className="text-ember">
              {liveWorkforce.exceptions.length} exception
              {liveWorkforce.exceptions.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
      <div className="flex h-11 shrink-0 flex-wrap items-center gap-2 border-b border-line px-3.5">
        <button
          type="button"
          aria-label="Previous"
          onClick={() => step(-1)}
          className="grid size-[26px] place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          <Icon
            path={paths.chevronRight}
            size={14}
            width={2.2}
            className="rotate-180"
          />
        </button>
        <span className="min-w-[150px] text-center font-mono text-[12.5px] font-medium text-ink">
          {label}
        </span>
        <button
          type="button"
          aria-label="Next"
          onClick={() => step(1)}
          className="grid size-[26px] place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          <Icon path={paths.chevronRight} size={14} width={2.2} />
        </button>

        {/* day, month, year — the same data at three depths */}
        <span className="ml-2 flex h-[28px] items-center gap-0.5 rounded-control bg-inset p-0.5 shadow-[inset_0_0_0_1px_var(--line)]">
          {(["day", "month", "year"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              className={cn(
                "h-[24px] rounded-[7px] px-2.5 text-[11.5px] font-medium capitalize transition-colors",
                range === option
                  ? "bg-surface text-ink shadow-btn"
                  : "text-ink-3 hover:text-ink"
              )}
            >
              {option}
            </button>
          ))}
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-2.5">
          {(
            [
              "present",
              "late",
              "absent",
              "missing",
              "leave",
              "holiday",
              "off",
            ] as DayStatus[]
          ).map((status) => (
            <span
              key={status}
              className="flex items-center gap-1.5 text-[10.5px] text-ink-3"
            >
              <span
                style={{ background: DAY_STATUS[status].hue }}
                className="size-2 rounded-[3px]"
              />
              {DAY_STATUS[status].label}
            </span>
          ))}
        </span>
      </div>

      {/* performance, for now, is attendance — said plainly rather than
          dressed up as a score that measures more than it does */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
        <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
          Performance
        </span>
        {BANDS.map((band) => {
          const people = scored.filter((row) => band.holds(row.rate))
          return (
            <span
              key={band.label}
              title={people.map((row) => row.person.name).join(", ")}
              className="inline-flex h-[24px] items-center gap-1.5 rounded-control bg-inset px-2 text-[11px] shadow-[inset_0_0_0_1px_var(--line)]"
            >
              <span
                style={{ background: band.hue }}
                className="size-1.5 rounded-full"
              />
              <span className="text-ink-2">{band.label}</span>
              <span className="font-mono text-ink">{people.length}</span>
            </span>
          )
        })}
        <span className="ml-auto text-[10.5px] text-ink-4">
          Attendance only — nothing else is measured yet
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {range === "day" && (
          <DayView team={team} day={day} onFixDay={onFixDay} />
        )}

        {range === "month" && (
          <table className="border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-6 h-9 w-[210px] border-r border-b border-r-line-strong border-b-line-strong bg-surface pl-3.5 text-left text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
                  {MONTHS[month]}
                </th>
                {days.map((key) => {
                  const date = new Date(`${key}T12:00:00`)
                  const weekend = date.getDay() === 0 || date.getDay() === 6
                  return (
                    <th
                      key={key}
                      title={holidayOn(key)?.label}
                      className={cn(
                        "sticky top-0 z-5 h-9 w-[26px] border-b border-b-line-strong bg-surface text-center align-middle",
                        holidayOn(key) && "text-coral"
                      )}
                    >
                      <span className="block font-mono text-[10.5px] leading-none font-medium text-ink-3">
                        {date.getDate()}
                      </span>
                      <span
                        className={cn(
                          "block pt-0.5 text-[8.5px] leading-none",
                          weekend ? "text-ink-4" : "text-ink-4"
                        )}
                      >
                        {WEEKDAY[(date.getDay() + 6) % 7]}
                      </span>
                    </th>
                  )
                })}
                <th className="sticky top-0 z-5 h-9 w-[54px] border-b border-b-line-strong bg-surface px-2 text-right text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
                  Rate
                </th>
              </tr>
            </thead>
            <tbody>
              {team.map((person) => {
                const record = monthAttendance(person.id, year, month)
                const counted = record.present + record.late + record.absent
                const rate = counted
                  ? Math.round(((record.present + record.late) / counted) * 100)
                  : null
                return (
                  <tr key={person.id} className="group/row">
                    <td className="sticky left-0 z-4 h-[30px] border-r border-b border-r-line-strong border-b-line bg-surface py-1 pr-2 pl-3.5 align-middle group-hover/row:bg-hover">
                      <span className="flex items-center gap-2">
                        <Avatar employee={person} size={20} />
                        <span className="min-w-0">
                          <span className="block truncate text-[11.5px] font-medium text-ink">
                            {person.name}
                          </span>
                        </span>
                      </span>
                    </td>
                    {days.map((key) => {
                      const status = attendanceOn(person.id, key)
                      const fixed = fixOn(person.id, key)
                      return (
                        <td
                          key={key}
                          className="border-b border-b-line p-[1.5px] align-middle group-hover/row:bg-hover"
                        >
                          <Cell
                            status={status}
                            corrected={fixed?.status === "approved"}
                            title={`${person.name} · ${key}`}
                            onClick={
                              onFixDay ? () => onFixDay(person, key) : undefined
                            }
                          />
                        </td>
                      )
                    })}
                    <td className="border-b border-b-line px-1 align-middle group-hover/row:bg-hover">
                      <span
                        style={rateTint(rate)}
                        className="block rounded-[5px] py-1 text-center font-mono text-[10.5px] tabular-nums"
                      >
                        {rate === null ? "—" : `${rate}%`}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {range === "year" && (
          <VirtualRows
            rows={team}
            rowKey={(person) => person.id}
            columns={YEAR_COLUMNS}
            rowHeight={34}
            header={
              <>
                <span className="pl-3.5 text-left">{year}</span>
                {MONTHS.map((m) => (
                  <span key={m} className="text-center">
                    {m}
                  </span>
                ))}
                <span className="px-2 text-right">Year</span>
              </>
            }
            renderRow={(person) => {
              const perMonth = MONTHS.map((_, index) => {
                const record = monthAttendance(person.id, year, index)
                const counted = record.present + record.late + record.absent
                return counted
                  ? Math.round(
                      ((record.present + record.late) / counted) * 100
                    )
                  : null
              })
              const seen = perMonth.filter((r): r is number => r !== null)
              const overall = seen.length
                ? Math.round(
                    seen.reduce((sum, r) => sum + r, 0) / seen.length
                  )
                : null
              return (
                <>
                  <span role="gridcell" className="py-1 pr-2 pl-3.5">
                    <span className="flex items-center gap-2">
                      <Avatar employee={person} size={22} />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-ink">
                          {person.name}
                        </span>
                        <span className="block truncate text-[10.5px] text-ink-4">
                          {person.role}
                        </span>
                      </span>
                    </span>
                  </span>
                  {perMonth.map((rate, index) => (
                    <span role="gridcell" key={MONTHS[index]} className="p-[3px]">
                      <span
                        style={rateTint(rate)}
                        className="block rounded-[5px] py-1.5 text-center font-mono text-[11px] tabular-nums"
                      >
                        {rate === null ? "—" : rate}
                      </span>
                    </span>
                  ))}
                  <span role="gridcell" className="px-2 text-right font-mono text-xs text-ink-2 tabular-nums">
                    {overall === null ? "—" : `${overall}%`}
                  </span>
                </>
              )
            }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The relational attendance read model. It deliberately renders records only
 * — missing rows are not converted into absent/off/leave cells because those
 * conclusions require a schedule and leave join that this endpoint does not
 * return.
 */
export function LiveAttendanceView({
  records,
  total,
  isLoading,
  errorMessage,
}: {
  records?: HrAttendanceRecord[]
  total?: number
  isLoading: boolean
  errorMessage?: string
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3.5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[12.5px] font-semibold text-ink">
          Attendance records
        </h2>
        <span className="text-[11px] text-ink-4">
          Internal relational read model · {total ?? records?.length ?? 0} total
        </span>
      </div>
      {isLoading && (
        <div className="rounded-panel bg-inset px-3 py-3 text-xs text-ink-4">
          Loading attendance from Internal…
        </div>
      )}
      {errorMessage && (
        <div className="rounded-panel bg-red-tint px-3 py-3 text-xs text-red">
          Could not load Internal attendance: {errorMessage}
        </div>
      )}
      {!isLoading && !errorMessage && !(records?.length ?? 0) && (
        <div className="rounded-panel bg-inset px-3 py-3 text-xs text-ink-4">
          Internal returned no attendance records for this period.
        </div>
      )}
      {!!records?.length && (
        <VirtualRows
          rows={records}
          rowKey={(record) => record.id}
          columns={ATTENDANCE_RECORD_COLUMNS}
          rowHeight={34}
          className="min-w-[760px]"
          header={
            <>
              <span className="px-2.5 text-left">Date</span>
              <span className="px-2.5 text-left">Employee ID</span>
              <span className="px-2.5 text-left">Clock in / out</span>
              <span className="px-2.5 text-left">Status</span>
              <span className="px-2.5 text-right">Overtime</span>
              <span className="px-2.5 text-left">Source</span>
            </>
          }
          renderRow={(record) => (
            <>
              <span role="gridcell" className="px-2.5 font-mono text-xs text-ink-2">
                {record.date}
              </span>
              <span role="gridcell" className="px-2.5 font-mono text-xs text-ink-2">
                {record.employeeId}
              </span>
              <span role="gridcell" className="px-2.5 font-mono text-xs text-ink-3">
                {formatClock(record.clockIn)} – {formatClock(record.clockOut)}
              </span>
              <span role="gridcell" className="px-2.5 text-xs text-ink-2">
                {record.status}
              </span>
              <span role="gridcell" className="px-2.5 text-right font-mono text-xs text-ink-2">
                {record.overtimeHours ? `${record.overtimeHours}h` : "—"}
              </span>
              <span role="gridcell" className="px-2.5 text-xs text-ink-3">
                {record.source || "—"}
              </span>
            </>
          )}
        />
      )}
      <p className="pt-3 text-[10.5px] leading-[1.5] text-ink-4">
        This view reports recorded rows from Internal. It does not infer a
        missing punch or roster status from absent records.
      </p>
    </div>
  )
}

function formatClock(value?: string) {
  return value ? value.replace("T", " ").slice(0, 16) : "—"
}

function Cell({
  status,
  title,
  corrected,
  onClick,
}: {
  status: DayStatus
  title: string
  corrected?: boolean
  onClick?: () => void
}) {
  const meta = DAY_STATUS[status]
  const faint = status === "off" || status === "scheduled"
  const style = {
    background: faint
      ? "var(--inset)"
      : `color-mix(in srgb, ${meta.hue} ${status === "present" ? 34 : 62}%, var(--surface))`,
    boxShadow: corrected
      ? "inset 0 0 0 1.5px var(--ink-3)"
      : status === "scheduled"
        ? `inset 0 0 0 1px ${meta.hue}`
        : undefined,
  }
  const label = `${title} — ${meta.label}${corrected ? " (corrected)" : ""}`

  if (!onClick) {
    return (
      <span
        title={label}
        style={style}
        className="block h-[22px] w-[23px] rounded-[4px]"
      />
    )
  }
  return (
    <button
      type="button"
      title={`${label} — click to correct`}
      onClick={onClick}
      style={style}
      className="block h-[22px] w-[23px] rounded-[4px] transition-[filter] hover:brightness-[0.94] focus-visible:shadow-[0_0_0_2px_var(--accent)]"
    />
  )
}

/** One day, read as a list — who is in, who is late, who never came. */
function DayView({
  team,
  day,
  onFixDay,
}: {
  team: Employee[]
  day: DayKey
  onFixDay?: (employee: Employee, key: DayKey) => void
}) {
  const { attendanceOn, holidayOn, shiftMeta, weekOf } = useHr()
  const holiday = holidayOn(day)

  const groups = (
    [
      "missing",
      "absent",
      "late",
      "present",
      "leave",
      "holiday",
      "off",
      "scheduled",
    ] as const
  )
    .map((status) => ({
      status,
      people: team.filter((person) => attendanceOn(person.id, day) === status),
    }))
    .filter((group) => group.people.length > 0)

  return (
    <div className="p-3.5">
      {holiday && (
        <div className="mb-3 rounded-panel bg-[color-mix(in_srgb,var(--coral)_12%,var(--surface))] px-3 py-2.5 text-[11.5px] font-medium text-coral">
          {holiday.label} — a public holiday set by Head Office.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map(({ status, people }) => (
          <section
            key={status}
            className="overflow-hidden rounded-panel border border-line-strong"
          >
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <span
                style={{ background: DAY_STATUS[status].hue }}
                className="size-2 shrink-0 rounded-full"
              />
              <span className="text-[12px] font-semibold text-ink">
                {DAY_STATUS[status].label}
              </span>
              <span className="ml-auto font-mono text-[11px] text-ink-4">
                {people.length}
              </span>
            </div>
            <ul className="max-h-[260px] overflow-auto">
              {people.map((person) => {
                const shift = shiftMeta(
                  weekOf(person.id, weekOfDay(day))[dayIndex(day)]
                )
                const punch = punchesOn(
                  person.id,
                  day,
                  status,
                  shift.start || "09:00"
                )
                return (
                  <li
                    key={person.id}
                    className="flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-b-0"
                  >
                    <Avatar employee={person} size={22} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-medium text-ink">
                        {person.name}
                      </span>
                      <span className="block truncate text-[10.5px] text-ink-4">
                        {person.role}
                      </span>
                    </span>
                    {punch ? (
                      <span className="shrink-0 font-mono text-[10.5px] text-ink-3">
                        {punch.in} – {punch.out}
                      </span>
                    ) : (
                      status === "missing" && (
                        <span className="shrink-0 font-mono text-[10.5px] text-ink-4">
                          no punch
                        </span>
                      )
                    )}
                    {onFixDay &&
                      (status === "missing" ||
                        status === "absent" ||
                        status === "late") && (
                        <button
                          type="button"
                          onClick={() => onFixDay(person, day)}
                          className="shrink-0 rounded-control px-1.5 py-0.5 text-[10.5px] font-medium text-accent-ink transition-colors hover:bg-hover"
                        >
                          Fix
                        </button>
                      )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
