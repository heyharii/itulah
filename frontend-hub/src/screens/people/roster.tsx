import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { DockChoice } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { ButtonGroup, Segmented, Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { dateRange, day, dayNumber, weekday, weekdayName } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  leaveExtraKeys,
  listEmployees,
  listShifts,
  peopleKeys,
  planDay,
  rosterKeys,
  teamCalendar,
  unitRoster,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { UnitChoice, useUnit } from "@/screens/people/parts"
import {
  CardButton,
  CardFigure,
  CardName,
  PhoneCards,
} from "@/components/ui/phone-cards"
import type { RosterDayView, ShiftView, TeamLeaveSpan } from "@itulah/contract"

/// Next week, per person — with who is away on each day, approved or still
/// waiting, read from the same team calendar the Month view draws so the two
/// agree.
///
/// # The grid is the plan, and the plan is upstream of money
///
/// "Absent" only means something against a scheduled day, so what is written
/// here is what a month is later counted against. That is why a revision keeps
/// the plan it replaced — the count has to stay answerable afterwards — and why
/// a closed month refuses a change at all. Both refusals come from the server,
/// with the sentence it uses.
///
/// # Seven columns, and no scroll
///
/// A week fits. A month does not, and a month grid is a month somebody reads
/// diagonally: the question a manager has is "is Tuesday covered", and seven
/// columns answer it at a glance where thirty would not.

/// The Monday of the week a date falls in. The statutory week is a week, not a
/// rolling seven days, and the roster is read the same way.
/// Both of these do their arithmetic in UTC and only ever exchange `YYYY-MM-DD`
/// with the rest of the app, because a roster date is a **calendar day** and
/// not an instant. Read a local midnight and print it with `toISOString()` and
/// Jakarta's +7 turns it into the previous day: the grid drew seven columns
/// starting on Sunday while its own title said Monday, and asked the server for
/// a week that was a day behind the week it was showing.
function mondayOf(date: Date): string {
  const utc = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  )
  const back = (utc.getUTCDay() + 6) % 7
  utc.setUTCDate(utc.getUTCDate() - back)
  return utc.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/// What one click on a cell will write.
///
/// A shift id, or one of the two plans that name no shift. They share one
/// control because they are one question — *what is this person doing on
/// Tuesday* — and splitting them into "plan kind" then "which shift" is what
/// made the old form four fields long.
type Brush =
  { kind: "SHIFT"; shiftId: string } | { kind: "REST" } | { kind: "HOLIDAY" }

function brushKey(brush: Brush): string {
  return brush.kind === "SHIFT" ? `SHIFT:${brush.shiftId}` : brush.kind
}

function brushFromKey(key: string, shifts: readonly ShiftView[]): Brush | null {
  if (key === "REST") return { kind: "REST" }
  if (key === "HOLIDAY") return { kind: "HOLIDAY" }
  const id = key.startsWith("SHIFT:") ? key.slice("SHIFT:".length) : null
  if (id === null) return null
  return shifts.some((one) => one.id === id)
    ? { kind: "SHIFT", shiftId: id }
    : null
}

/// `Sen 07` — the weekday first, because a week is read by weekday.
///
/// `timeZone: "UTC"` for the reason the arithmetic above is in UTC: the string
/// is a calendar day, and letting the formatter apply Jakarta's +7 to a
/// midnight would print the day before.
function column(iso: string): { weekday: string; date: string } {
  return { weekday: weekdayName(iso), date: dayNumber(iso) }
}

function todayIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10)
}

/// What a day's plan reads as: the shift's name, Rest, Holiday — or nothing.
function planLabel(entry: RosterDayView | undefined): string | null {
  if (entry === undefined) return null
  return entry.plan === "SCHEDULED"
    ? (entry.shift_name ?? entry.shift_id)
    : entry.plan === "REST_DAY"
      ? "Rest"
      : "Holiday"
}

/// What a day of leave reads as in a cell: the kind of leave, and — while it
/// is still waiting on a decision — the word "Waiting" first, so it is the
/// first thing left when the cell is narrow.
function leaveLabel(span: TeamLeaveSpan): string {
  return span.state === "APPROVED"
    ? span.leave_name
    : `Waiting · ${span.leave_name}`
}

/// The day on screen, on a phone: last week, this week and next as the chip
/// over the bottom bar. A phone reads a roster a day at a time — a person per
/// card — rather than as seven columns.
function RosterDayChoice({
  value,
  onChange,
}: {
  value: string
  onChange: (iso: string) => void
}) {
  const start = addDays(mondayOf(new Date()), -7)
  const days = new Set<string>([value])
  for (let by = 0; by < 21; by += 1) days.add(addDays(start, by))
  return (
    <DockChoice
      title="Day"
      value={value}
      onChange={onChange}
      options={[...days].sort().map((iso) => ({
        value: iso,
        label: weekday(iso, true),
        short: iso === todayIso() ? "Today" : weekday(iso, true),
      }))}
    />
  )
}

export function Roster() {
  const phone = useLayout() === "phone"
  const client = useQueryClient()
  const unit = useUnit()
  const unitId = unit.unitId
  const [from, setFrom] = useState(() => mondayOf(new Date()))
  const [reason, setReason] = useState("")
  const [chosen, setChosen] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const today = todayIso()

  const week = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(from, index)),
    [from]
  )
  const to = week[6]
  // The day a phone shows: today while the week holds it, else the week's first.
  const [phoneDay, setPhoneDay] = useState(todayIso)
  const dayOn = week.includes(phoneDay) ? phoneDay : week[0]

  const days = useQuery({
    queryKey: rosterKeys.unit(unitId ?? "", from, to),
    queryFn: ({ signal }) => unitRoster(unitId ?? "", from, to, signal),
    enabled: unitId !== null,
  })
  const shifts = useQuery({
    queryKey: rosterKeys.shifts(),
    queryFn: ({ signal }) => listShifts(signal),
  })
  /// **Bounded to the unit the grid is about**, not to the caller.
  ///
  /// It used to ask for every active employee, which is right by accident for
  /// a store manager — the server bounds them to their own posting — and wrong
  /// for head office, who was served the whole company's names against one
  /// unit's plan. Thirty-three rows of dashes is not a roster.
  const team = useQuery({
    queryKey: peopleKeys.employees({
      status: "ACTIVE",
      unitId: unitId ?? undefined,
      limit: 1000,
    }),
    queryFn: ({ signal }) =>
      listEmployees(
        { status: "ACTIVE", unitId: unitId ?? undefined, limit: 1000 },
        signal
      ),
    enabled: unitId !== null,
  })

  /// Who is away, from the team calendar the Month view reads. Everyone the
  /// caller reaches comes back; a cell only looks up its own person.
  const away = useQuery({
    queryKey: leaveExtraKeys.calendar(from, to),
    queryFn: ({ signal }) => teamCalendar(from, to, signal),
  })

  const live = shifts.data ?? []
  // The first pattern head office defined, until somebody picks another. A
  // palette with nothing selected is a grid where the first click does
  // nothing and says nothing about why.
  const brush =
    brushFromKey(chosen ?? "", live) ??
    (live[0] ? { kind: "SHIFT" as const, shiftId: live[0].id } : null)

  // Keyed by person and date, so a cell is a lookup rather than a scan of the
  // whole week per square.
  const planned = useMemo(() => {
    const map = new Map<string, RosterDayView>()
    for (const entry of days.data ?? []) {
      map.set(`${entry.employee_id}|${entry.on_date}`, entry)
    }
    return map
  }, [days.data])

  // Keyed like `planned`: a person and a date. Where an approved stretch and a
  // waiting one cover the same day, the approved one is what is read.
  const leaveOn = useMemo(() => {
    const map = new Map<string, TeamLeaveSpan>()
    for (const span of away.data?.leave ?? []) {
      const last = span.to_date > to ? to : span.to_date
      for (
        let at = span.from_date < from ? from : span.from_date;
        at <= last;
        at = addDays(at, 1)
      ) {
        const key = `${span.employee_id}|${at}`
        const was = map.get(key)
        if (
          was === undefined ||
          (was.state !== "APPROVED" && span.state === "APPROVED")
        )
          map.set(key, span)
      }
    }
    return map
  }, [away.data, from, to])

  const write = useMutation({
    mutationFn: (cell: { employeeId: string; onDate: string }) => {
      if (brush === null) throw new Error("No shift pattern is defined yet.")
      return planDay(cell.employeeId, {
        onDate: cell.onDate,
        plan:
          brush.kind === "SHIFT"
            ? "SCHEDULED"
            : brush.kind === "REST"
              ? "REST_DAY"
              : "PUBLIC_HOLIDAY",
        shiftId: brush.kind === "SHIFT" ? brush.shiftId : undefined,
        reason: reason.trim(),
      })
    },
    onSuccess: () => {
      setFailed(null)
      void client.invalidateQueries({
        queryKey: rosterKeys.unit(unitId ?? "", from, to),
      })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  // The server refuses a blank reason, and it is right to: a plan is an
  // instruction somebody gave. So the reason is asked ONCE for the sitting
  // rather than once per day, and the grid stays inert until it is given —
  // which is the honest version of a click that would have been a 400.
  const ready = reason.trim() !== "" && brush !== null && unitId !== null

  return (
    <PageContent>
      <PageHeader title="Roster" />
      {phone ? (
        // On a phone the unit and the day are the chips over the bottom bar.
        <>
          <UnitChoice
            unitId={unitId}
            units={unit.units}
            onChange={unit.setUnitId}
          />
          <RosterDayChoice
            value={dayOn}
            onChange={(next) => {
              setPhoneDay(next)
              setFrom(mondayOf(new Date(`${next}T00:00:00Z`)))
            }}
          />
        </>
      ) : (
        <Toolbar>
          <UnitChoice
            unitId={unitId}
            units={unit.units}
            onChange={unit.setUnitId}
          />
          {/* A week at a time, because that is how a roster is built — and
              the date picker stays for the jump to a month away. */}
          <ButtonGroup>
            <Button
              variant="ghost"
              aria-label="Previous week"
              onClick={() => setFrom(addDays(from, -7))}
            >
              <ChevronLeft className="size-4 stroke-[1.7]" />
            </Button>
            <Button
              variant="ghost"
              onClick={() => setFrom(mondayOf(new Date()))}
            >
              This week
            </Button>
            <Button
              variant="ghost"
              aria-label="Next week"
              onClick={() => setFrom(addDays(from, 7))}
            >
              <ChevronRight className="size-4 stroke-[1.7]" />
            </Button>
          </ButtonGroup>
          <Day
            value={from}
            onChange={(next) => {
              // A week is always on screen, so cleared is not a state here.
              if (next !== "") setFrom(mondayOf(new Date(next)))
            }}
            clearable={false}
            className="h-8 w-36"
          />
        </Toolbar>
      )}

      {unitId === null && !unit.choosing && (
        <Banner tone="warn" className="mb-4">
          You are not posted anywhere, so there is no week to build.
        </Banner>
      )}
      {failed !== null && (
        <Banner tone="bad" className="mb-4">
          {failed}
        </Banner>
      )}
      {unitId !== null && live.length === 0 && (
        <Banner tone="warn" className="mb-4">
          No shift pattern is defined, so nobody can be put on one.
        </Banner>
      )}
      {away.isError && (
        <Banner tone="bad" className="mb-4">
          {away.error.message}
        </Banner>
      )}

      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <CardHeader>
          <CardTitle>{phone ? day(dayOn) : dateRange(from, to)}</CardTitle>
        </CardHeader>

        {/* The tool, in the same card as the thing it acts on: choose what you
            are putting people on, say once why, then click the days. Above the
            grid rather than below it, because it has to be read first. */}
        {live.length > 0 && (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-hairline px-4 pb-3.5 max-md:mb-3 max-md:rounded-card max-md:border max-md:bg-canvas max-md:py-3.5 max-md:shadow-soft">
            <div className="flex flex-col gap-[0.4375rem]">
              <span className="text-[0.9375rem] font-medium text-text">
                Put on
              </span>
              <Segmented
                value={brush === null ? "" : brushKey(brush)}
                onChange={(value) => setChosen(value)}
                options={[
                  ...live.map((shift) => ({
                    value: `SHIFT:${shift.id}`,
                    label: (
                      <span className="flex items-baseline gap-1">
                        {shift.name}
                        <span className="text-[0.9375rem] text-mute">
                          {shift.starts_at}–{shift.ends_at}
                        </span>
                      </span>
                    ),
                  })),
                  { value: "REST", label: "Rest" },
                  { value: "HOLIDAY", label: "Public holiday" },
                ]}
              />
            </div>
            <Field
              label="Why"
              aside={ready ? undefined : "unlocks the grid"}
              className="w-60 max-md:w-full"
              required
            >
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="h-8"
              />
            </Field>
          </div>
        )}
        {queryState(days, {
          loading: "Reading the plan…",
          render: () =>
            (team.data ?? []).length === 0 ? (
              <EmptyState>Nobody is posted here to roster.</EmptyState>
            ) : phone ? (
              <PhoneCards
                rows={team.data ?? []}
                rowId={(person) => person.employee_id}
                spec={{
                  title: (person) => {
                    const leave = leaveOn.get(`${person.employee_id}|${dayOn}`)
                    return (
                      <CardName
                        name={person.full_name ?? person.employee_code}
                        line={
                          leave === undefined ? undefined : leaveLabel(leave)
                        }
                      />
                    )
                  },
                  lead: (person) => {
                    const entry = planned.get(`${person.employee_id}|${dayOn}`)
                    const label = planLabel(entry)
                    return (
                      <CardFigure
                        value={label ?? "—"}
                        caption={
                          label === null
                            ? "not planned"
                            : entry !== undefined && entry.revision_count > 1
                              ? `revised ×${entry.revision_count}`
                              : undefined
                        }
                        tone={label === null ? "quiet" : undefined}
                      />
                    )
                  },
                  action: (person) => {
                    const label = planLabel(
                      planned.get(`${person.employee_id}|${dayOn}`)
                    )
                    return (
                      <CardButton
                        label={label === null ? "Plan" : "Revise"}
                        disabled={!ready || write.isPending}
                        ariaLabel={`${label === null ? "Plan" : "Revise"} ${person.full_name ?? person.employee_code} on ${day(dayOn)}`}
                        onClick={() =>
                          write.mutate({
                            employeeId: person.employee_id,
                            onDate: dayOn,
                          })
                        }
                      />
                    )
                  },
                }}
              />
            ) : (
              // Its own scroller: seven columns fit a laptop and not a phone,
              // and the page body must never scroll sideways.
              <div className="overflow-x-auto px-4 pb-4">
                <table className="w-full min-w-[46rem] border-collapse">
                  <thead>
                    <tr>
                      <th className="w-44 pb-2 text-left text-cell font-normal text-body">
                        Who
                      </th>
                      {week.map((date) => {
                        const head = column(date)
                        const now = date === today
                        return (
                          <th
                            key={date}
                            aria-current={now ? "date" : undefined}
                            className={cn(
                              // Equal and fixed: a chip is wider than a `+`,
                              // and without this the day somebody filled first
                              // took the width from the six beside it.
                              "w-[11.5%] pb-2 text-left text-cell font-normal",
                              now ? "text-ink" : "text-body"
                            )}
                          >
                            <span className="flex items-baseline gap-1">
                              {head.weekday}
                              <span
                                className={cn(
                                  now ? "font-medium text-ink" : "text-mute"
                                )}
                              >
                                {head.date}
                              </span>
                            </span>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {(team.data ?? []).map((person) => (
                      <tr
                        key={person.employee_id}
                        className="border-t border-hairline"
                      >
                        <td className="py-1.5 pr-3">
                          <span className="block truncate text-cell text-ink">
                            {person.full_name ?? person.employee_code}
                          </span>
                        </td>
                        {week.map((date) => (
                          <Cell
                            key={date}
                            entry={planned.get(`${person.employee_id}|${date}`)}
                            leave={leaveOn.get(`${person.employee_id}|${date}`)}
                            ready={ready && !write.isPending}
                            today={date === today}
                            onClick={() =>
                              write.mutate({
                                employeeId: person.employee_id,
                                onDate: date,
                              })
                            }
                          />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
        })}
      </Card>
    </PageContent>
  )
}

/// One person's one day: what is planned, and a click that plans it.
///
/// A cell that already carries a plan is a **revision** when clicked, and the
/// plan it replaces is kept — so the count is on the cell rather than a click
/// away, and the title says which of the two a click is about to do.
///
/// A day of leave is a line under the plan, in the same cell: approved leave
/// in the body colour, leave still waiting on a decision in grey and led by
/// "Waiting". Leave does not stop a plan being written — the roster is what the
/// absence is later counted against — so it is read here and never blocks.
function Cell({
  entry,
  leave,
  ready,
  today,
  onClick,
}: {
  entry: RosterDayView | undefined
  leave: TeamLeaveSpan | undefined
  ready: boolean
  today: boolean
  onClick: () => void
}) {
  const label = planLabel(entry)

  return (
    <td className="py-1 pr-2">
      <button
        type="button"
        disabled={!ready}
        onClick={onClick}
        title={
          ready
            ? label === null
              ? "Click to plan this day"
              : "Click to revise — the plan it replaces is kept"
            : "Say why first"
        }
        className={cn(
          // An empty cell is a dashed outline, so it reads as a slot waiting
          // to be filled rather than as a cell with a dash in it. A filled one
          // is a solid chip. Both are the same height, so a row does not jump
          // as it is built.
          "flex min-h-[1.875rem] w-full flex-col justify-center rounded-inner border px-2 py-0.5 text-left text-cell transition-colors",
          label === null
            ? "border-dashed border-hairline-2 text-mute enabled:hover:border-accent enabled:hover:text-body"
            : "border-hairline bg-soft-2 text-ink enabled:hover:border-accent",
          today && label === null && "border-hairline-strong",
          "disabled:cursor-default"
        )}
      >
        {label === null ? (
          leave === undefined && <span aria-hidden>+</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="truncate">{label}</span>
            {entry !== undefined && entry.revision_count > 1 && (
              <span className="text-mute">×{entry.revision_count}</span>
            )}
          </span>
        )}
        {leave !== undefined && (
          <span
            title={leaveLabel(leave)}
            className={cn(
              "truncate",
              leave.state === "APPROVED" ? "text-body" : "text-mute"
            )}
          >
            {leaveLabel(leave)}
          </span>
        )}
      </button>
    </td>
  )
}
