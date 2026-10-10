import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Clock4 } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { DockChoice } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { ButtonGroup, Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { dayNumber, weekday, weekdayName } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  listEmployees,
  listShifts,
  peopleKeys,
  planDay,
  rosterKeys,
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
import type { RosterDayView, ShiftView } from "@itulah/contract"

/// Next week, per person.
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
      <PageHeader
        crumb="People"
        title="Roster"
        sub={
          unit.choosing
            ? "Head office reads any place's plan, and may revise one. The place that works it builds it."
            : `Next week at ${unit.name ?? "your place"}. A revision keeps the plan it replaced.`
        }
        // On a phone the unit and the day are the chips over the bottom bar.
        actions={
          phone ? undefined : (
            <>
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
                onChange={(next) => setFrom(mondayOf(new Date(next)))}
                className="h-8 w-36"
              />
              {/* Extra hours on a day of this plan — ordering them is a plan
                act, like a shift. A sidebar row until 2026-09-27; the orders
                nobody has answered are on the Overview. */}
              <AppLink to="/people/overtime" variant="ghost">
                <Clock4 />
                Overtime
              </AppLink>
            </>
          )
        }
      />
      {phone && (
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
          No shift pattern is defined, so there is nothing to put anybody on.
          Head office defines them under Setup › Shift patterns.
        </Banner>
      )}

      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <CardHeader>
          <CardTitle>
            {phone ? day(dayOn) : `${day(from)} — ${day(to)}`}
          </CardTitle>
        </CardHeader>

        {/* The tool, in the same card as the thing it acts on: choose what you
            are putting people on, say once why, then click the days. Above the
            grid rather than below it, because it has to be read first. */}
        {live.length > 0 && (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-hairline px-4 pb-3.5 max-md:mb-3 max-md:rounded-card max-md:border max-md:bg-canvas max-md:py-3.5 max-md:shadow-soft">
            <div className="flex flex-col gap-[0.4375rem]">
              <span className="text-[0.875rem] font-medium text-text">
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
                        <span className="text-[0.875rem] text-mute">
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
              hint={
                ready
                  ? "Recorded against every day you click."
                  : "Required — the grid stays locked until it is given."
              }
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
                  title: (person) => (
                    <CardName
                      name={person.full_name ?? person.employee_code}
                      line={
                        person.full_name !== null
                          ? person.employee_code
                          : undefined
                      }
                    />
                  ),
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
                          {person.full_name !== null && (
                            <span className="block truncate text-[0.875rem] text-mute">
                              {person.employee_code}
                            </span>
                          )}
                        </td>
                        {week.map((date) => (
                          <Cell
                            key={date}
                            entry={planned.get(`${person.employee_id}|${date}`)}
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
      {/* The overtime orders are a plan act too; on a phone the link is the
          last thing on the page rather than the first. */}
      <div className="md:hidden">
        <AppLink to="/people/overtime" variant="ghost">
          <Clock4 />
          Overtime
        </AppLink>
      </div>
    </PageContent>
  )
}

/// One person's one day: what is planned, and a click that plans it.
///
/// A cell that already carries a plan is a **revision** when clicked, and the
/// plan it replaces is kept — so the count is on the cell rather than a click
/// away, and the title says which of the two a click is about to do.
function Cell({
  entry,
  ready,
  today,
  onClick,
}: {
  entry: RosterDayView | undefined
  ready: boolean
  today: boolean
  onClick: () => void
}) {
  const label =
    entry === undefined
      ? null
      : entry.plan === "SCHEDULED"
        ? (entry.shift_name ?? entry.shift_id)
        : entry.plan === "REST_DAY"
          ? "Rest"
          : "Holiday"

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
          "flex min-h-[1.875rem] w-full items-center gap-1.5 rounded-inner border px-2 text-left text-cell transition-colors",
          label === null
            ? "border-dashed border-hairline-2 text-mute enabled:hover:border-accent enabled:hover:text-body"
            : "border-hairline bg-soft-2 text-ink enabled:hover:border-accent",
          today && label === null && "border-hairline-strong",
          "disabled:cursor-default"
        )}
      >
        {label === null ? (
          <span aria-hidden>+</span>
        ) : (
          <>
            <span className="truncate">{label}</span>
            {entry !== undefined && entry.revision_count > 1 && (
              <Pill tone="info">×{entry.revision_count}</Pill>
            )}
          </>
        )}
      </button>
    </td>
  )
}
