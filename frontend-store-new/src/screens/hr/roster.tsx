import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftRight, ChevronLeft, ChevronRight } from "lucide-react"
import { useState } from "react"

import { DockChoice } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { LeadFigure } from "@/components/ui/lead-card"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/states"
import { CENTRAL_KEY_PREFIX } from "@/lib/cloud"
import { dateText } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useParam } from "@/lib/params"
import {
  addDays,
  hrKeys,
  isoDay,
  planDay,
  planWord,
  readDate,
  readMinutes,
  rosterAt,
  shifts,
  type StoreScope,
} from "@/lib/queries/hr"
import { cn } from "@/lib/utils"
import { centreState } from "@/screens/hr/centre"
import { Facts, Heading, Submit } from "@/screens/hr/parts"
import { SwapSheet } from "@/screens/hr/swaps"
import {
  personByLogin,
  personName,
  usePendingSwaps,
  useTeam,
} from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type {
  EmployeeList,
  RosterDayView,
  RosterSwapView,
  ShiftView,
} from "@itulah/contract"

/// The week, per person — the prototype's store Roster.
///
/// "Toko menyusun roster dari jenis shift HO": the shop builds its rota out of
/// head office's shift patterns, and cannot invent one. So a cell here opens a
/// sheet that plans that one day — a shift from the catalogue, a day off, or a
/// public holiday — under `POST /employees/{id}/roster`, which a store head may
/// call for their own people. Every re-plan is kept as a revision and the
/// centre counts them; a day planned more than once is marked, because a rota
/// changed under somebody is a governance signal rather than an edit.
///
/// The two rows under the grid count cover per day, as the prototype's do.
/// Pending shift swaps sit over the grid, where the prototype puts them: they
/// are changes to the very week being read.
///
/// Seven days in one read — `GET /api/v1/roster?place&from&to` — rather than
/// seven, because the centre answers a range and one request per day would be
/// seven chances for one of them to fail.
///
/// # The phone
///
/// A grid of seven columns does not fit a phone and nothing there scrolls
/// sideways, so the same week is one card per person — the name, the hours
/// planned as the figure, and their seven days as rows a thumb can land on —
/// with a last card for the cover. The week is the dock's choice (a sheet of
/// weeks); on a desk it is the arrows over the grid.
export function HrRoster() {
  return <HrWorkspace>{(scope) => <Roster scope={scope} />}</HrWorkspace>
}

/// Monday. A retail week here is read Monday to Sunday; starting it on Sunday
/// puts the weekend at both ends of the strip.
function mondayOf(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7))
}

/// What a planned day is called in a cell a seventh of a desk wide.
function cellWord(day: RosterDayView | undefined): string {
  if (day === undefined) return "—"
  if (day.plan === "REST_DAY") return "Off"
  if (day.plan === "PUBLIC_HOLIDAY") return "Hol"
  return day.shift_name ?? "Shift"
}

/// What a planned day is called in a row of a phone's card: the whole word and
/// the hours.
function dayWord(day: RosterDayView | undefined): string {
  if (day === undefined) return "Not planned"
  if (day.plan !== "SCHEDULED") return planWord(day.plan)
  return `${day.shift_name ?? "Shift"}${day.starts_at === null ? "" : ` ${day.starts_at}–${day.ends_at ?? ""}`}`
}

/// `06–12 Oct 2026`, `29 Sep – 05 Oct 2026`: the week that starts on `start`.
function weekRange(start: string): string {
  const first = new Date(`${start}T00:00:00`)
  const last = addDays(first, 6)
  const sameMonth = first.getMonth() === last.getMonth()
  const sameYear = first.getFullYear() === last.getFullYear()
  const from = dateText(first, {
    day: "2-digit",
    ...(sameMonth && sameYear ? {} : { month: "short" }),
    ...(sameYear ? {} : { year: "numeric" }),
  })
  const to = dateText(last, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
  return `${from}${sameMonth && sameYear ? "–" : " – "}${to}`
}

/// The weeks the dock offers: four back, six forward, and the one in the URL
/// when it is none of them.
function weekChoices(from: string, thisWeek: string) {
  const base = new Date(`${thisWeek}T00:00:00`)
  const starts = Array.from({ length: 11 }, (_, index) =>
    isoDay(addDays(base, (index - 4) * 7)),
  )
  if (!starts.includes(from)) starts.push(from)
  starts.sort()
  return starts.map((start) => {
    const away = Math.round(
      (new Date(`${start}T00:00:00`).getTime() - base.getTime()) /
        (7 * 86_400_000),
    )
    const near =
      away === 0
        ? "This week"
        : away === 1
          ? "Next week"
          : away === -1
            ? "Last week"
            : undefined
    return {
      value: start,
      label:
        near === undefined ? weekRange(start) : `${near} · ${weekRange(start)}`,
      short: near ?? weekRange(start),
    }
  })
}

/// `Mon 06`, for a row or a column.
function dayName(date: string): string {
  const parsed = new Date(`${date}T00:00:00`)
  return `${dateText(parsed, { weekday: "short" })} ${date.slice(8)}`
}

interface Target {
  readonly employeeId: string
  readonly date: string
  readonly day: RosterDayView | undefined
}

function Roster({ scope }: { scope: StoreScope }) {
  const phone = useLayout() === "phone"
  const week = useParam("week")
  const thisWeek = isoDay(mondayOf(new Date()))
  const from = week.value ?? thisWeek
  const days = Array.from({ length: 7 }, (_, index) =>
    isoDay(addDays(new Date(`${from}T00:00:00`), index)),
  )
  const to = days[6] as string
  const today = isoDay(new Date())

  const roster = useQuery({
    queryKey: hrKeys.roster(scope.unit_id, from, to),
    queryFn: ({ signal }) => rosterAt(scope.unit_id, from, to, signal),
  })
  const team = useTeam(scope)
  const catalogue = useQuery({
    queryKey: hrKeys.shifts(),
    queryFn: ({ signal }) => shifts(signal),
    staleTime: 5 * 60_000,
  })
  const swaps = usePendingSwaps(scope)
  const [target, setTarget] = useState<Target | null>(null)
  const [swap, setSwap] = useState<RosterSwapView | null>(null)

  const move = (by: number) =>
    week.set(isoDay(addDays(new Date(`${from}T00:00:00`), by)))
  const asked = swaps.data?.rows ?? []

  return (
    <>
      {/* The phone's week: a chip over the bottom bar, a sheet of weeks. */}
      <DockChoice
        title="Week"
        value={from}
        options={weekChoices(from, thisWeek)}
        onChange={(next) => week.set(next === thisWeek ? undefined : next)}
      />

      {asked.length > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-card border border-warn-fg/25 bg-warn-bg/50 px-3.5 py-2">
          <ArrowLeftRight className="mt-3 size-4 shrink-0 text-warn-fg" />
          <ul className="flex min-w-0 flex-1 flex-col">
            {asked.map((one) => (
              <li key={one.id}>
                <button
                  type="button"
                  onClick={() => setSwap(one)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-meta text-warn-fg"
                >
                  <span className="min-w-0">
                    {personName(team.data, one.employee_id)} asks to swap with{" "}
                    {personName(team.data, one.with_employee_id)} ·{" "}
                    {readDate(one.on_date, true)}
                  </span>
                  <span className="shrink-0 font-semibold">Review</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The desk's week: the range, and the arrows. */}
      <div className="max-md:hidden">
        <Heading
          action={
            <div className="flex items-center gap-1.5">
              {from !== thisWeek && (
                <Button variant="quiet" onClick={() => week.set(undefined)}>
                  This week
                </Button>
              )}
              <Button
                size="icon"
                aria-label="The week before"
                onClick={() => move(-7)}
              >
                <ChevronLeft />
              </Button>
              <Button
                size="icon"
                aria-label="The week after"
                onClick={() => move(7)}
              >
                <ChevronRight />
              </Button>
            </div>
          }
        >
          {readDate(from)} – {readDate(to)}
        </Heading>
      </div>

      {centreState(roster, {
        loading: "Reading the rota…",
        what: "this shop's rota",
        render: (rows) => {
          const sheet = weekOf(rows, team.data)
          return sheet.people.length === 0 ? (
            <EmptyState>Nobody is rostered this week.</EmptyState>
          ) : phone ? (
            <Cards
              sheet={sheet}
              days={days}
              today={today}
              team={team.data}
              onPick={setTarget}
            />
          ) : (
            <Grid
              sheet={sheet}
              days={days}
              today={today}
              team={team.data}
              onPick={setTarget}
            />
          )
        },
      })}

      {target !== null && (
        <PlanSheet
          key={`${target.employeeId}-${target.date}`}
          target={target}
          team={team.data}
          catalogue={catalogue.data ?? []}
          onClose={() => setTarget(null)}
        />
      )}
      {swap !== null && (
        <SwapSheet
          key={swap.id}
          swap={swap}
          team={team.data}
          onClose={() => setSwap(null)}
        />
      )}
    </>
  )
}

/// What a week is made of, read once for both of its shapes.
interface WeekSheet {
  readonly people: readonly string[]
  readonly find: (employeeId: string, date: string) => RosterDayView | undefined
  readonly minutesOf: (employeeId: string) => number
  /// How many are on a shift that day — all of them, or the ones on `name`.
  readonly working: (date: string, name?: string) => number
  readonly shiftNames: readonly string[]
}

function weekOf(
  rows: readonly RosterDayView[],
  team: EmployeeList | undefined,
): WeekSheet {
  // Everybody active at this shop, plus anybody rostered who is not on the
  // list (a posting can move mid-week) — so an unplanned person still has a
  // row to plan them in.
  const active = (team?.rows ?? [])
    .filter((person) => person.status === "ACTIVE")
    .map((person) => person.employee_id)
  const people = [
    ...new Set([...active, ...rows.map((row) => row.employee_id)]),
  ]
  return {
    people,
    find: (employeeId, date) =>
      rows.find(
        (row) => row.employee_id === employeeId && row.on_date === date,
      ),
    minutesOf: (employeeId) =>
      rows
        .filter((row) => row.employee_id === employeeId)
        .reduce((total, row) => total + (row.planned_work_minutes ?? 0), 0),
    working: (date, name) =>
      rows.filter(
        (row) =>
          row.on_date === date &&
          row.plan === "SCHEDULED" &&
          (name === undefined || (row.shift_name ?? "Shift") === name),
      ).length,
    shiftNames: [
      ...new Set(
        rows
          .filter((row) => row.plan === "SCHEDULED")
          .map((row) => row.shift_name ?? "Shift"),
      ),
    ].sort(),
  }
}

/// The matrix: a person per row, a day per column, and cover at the foot.
///
/// A matrix and not a list on a desk, because the thing read here is the week
/// *across*. A tablet scrolls it inside its own card; a phone does not draw it
/// at all (see `Cards`).
function Grid({
  sheet,
  days,
  today,
  team,
  onPick,
}: {
  sheet: WeekSheet
  days: readonly string[]
  today: string
  team: EmployeeList | undefined
  onPick: (target: Target) => void
}) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-cell">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 h-10 border-b border-hairline bg-soft px-3.5 text-left text-eyebrow font-medium text-body">
                Employee
              </th>
              {days.map((date) => {
                const parsed = new Date(`${date}T00:00:00`)
                return (
                  <th
                    key={date}
                    className={cn(
                      "h-10 border-b border-hairline px-1 text-center text-eyebrow font-medium text-body",
                      date === today ? "bg-accent-bg text-accent" : "bg-soft",
                    )}
                  >
                    {dateText(parsed, { weekday: "short" })}{" "}
                    <span className="tabular-nums">{date.slice(8)}</span>
                  </th>
                )
              })}
              <th className="h-10 border-b border-hairline bg-soft px-3.5 text-right text-eyebrow font-medium text-body">
                Planned
              </th>
            </tr>
          </thead>
          <tbody>
            {sheet.people.map((employeeId) => (
              <tr key={employeeId} className="border-b border-hairline">
                <th className="sticky left-0 z-10 max-w-[11rem] truncate bg-canvas px-3.5 py-1.5 text-left text-cell font-medium text-ink">
                  {personName(team, employeeId)}
                </th>
                {days.map((date) => {
                  const day = sheet.find(employeeId, date)
                  return (
                    <td key={date} className="px-1 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => onPick({ employeeId, date, day })}
                        title={
                          day === undefined
                            ? "Not planned"
                            : `${planWord(day.plan)}${day.starts_at === null ? "" : ` ${day.starts_at}–${day.ends_at ?? ""}`}${day.revision_count > 1 ? ` · re-planned ${day.revision_count} times` : ""}`
                        }
                        className={cn(
                          "inline-flex h-9 w-full min-w-[3.25rem] items-center justify-center gap-0.5 truncate rounded-inner px-1 text-meta font-medium transition-colors pointer-coarse:h-11",
                          day === undefined &&
                            "border border-dashed border-hairline-2 text-faint hover:bg-soft",
                          day?.plan === "SCHEDULED" &&
                            "bg-accent-bg text-accent hover:brightness-95",
                          day?.plan === "REST_DAY" &&
                            "bg-soft-2 text-body hover:brightness-95",
                          day?.plan === "PUBLIC_HOLIDAY" &&
                            "bg-warn-bg text-warn-fg hover:brightness-95",
                          date === today && "ring-2 ring-accent/40",
                        )}
                      >
                        {cellWord(day)}
                        {day !== undefined && day.revision_count > 1 && (
                          <span aria-label="Re-planned">↻</span>
                        )}
                      </button>
                    </td>
                  )
                })}
                <td className="px-3.5 py-1.5 text-right text-meta whitespace-nowrap text-body tabular-nums">
                  {readMinutes(sheet.minutesOf(employeeId))}
                </td>
              </tr>
            ))}
            {/* Cover, per shift and in all. Red when nobody is on — the
                prototype's minimum is two, but the minimum is head office's
                rule and this build has no route that states it, so the only
                line drawn here is the one nobody could argue with. */}
            {sheet.shiftNames.map((name) => (
              <tr key={name} className="border-b border-hairline bg-soft/60">
                <th className="sticky left-0 z-10 bg-soft px-3.5 py-1.5 text-left text-meta font-medium text-body">
                  {name}
                </th>
                {days.map((date) => {
                  const count = sheet.working(date, name)
                  return (
                    <td
                      key={date}
                      className={cn(
                        "px-1 py-1.5 text-center text-meta tabular-nums",
                        count === 0 ? "font-semibold text-bad-fg" : "text-body",
                      )}
                    >
                      {count}
                    </td>
                  )
                })}
                <td />
              </tr>
            ))}
            <tr className="bg-soft/60">
              <th className="sticky left-0 z-10 bg-soft px-3.5 py-1.5 text-left text-meta font-semibold text-ink">
                On the rota
              </th>
              {days.map((date) => {
                const count = sheet.working(date)
                return (
                  <td
                    key={date}
                    className={cn(
                      "px-1 py-1.5 text-center text-meta font-semibold tabular-nums",
                      count === 0 ? "text-bad-fg" : "text-ink",
                    )}
                  >
                    {count}
                  </td>
                )
              })}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/// The week on a phone: one card per person, the hours planned as the figure,
/// the seven days as rows of 44px — then the cover. Nothing scrolls sideways.
function Cards({
  sheet,
  days,
  today,
  team,
  onPick,
}: {
  sheet: WeekSheet
  days: readonly string[]
  today: string
  team: EmployeeList | undefined
  onPick: (target: Target) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {sheet.people.map((employeeId) => {
        const row = team?.rows.find(
          (person) => person.employee_id === employeeId,
        )
        const minutes = sheet.minutesOf(employeeId)
        return (
          <section
            key={employeeId}
            className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft"
          >
            <div className="flex items-start gap-3 p-4">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h3 className="line-clamp-2 text-card-title font-semibold break-words text-ink">
                  {personName(team, employeeId)}
                </h3>
                {row?.position ? (
                  <p className="text-[0.875rem] text-mute">{row.position}</p>
                ) : null}
              </div>
              <div className="min-w-0 shrink-0">
                <LeadFigure
                  value={minutes === 0 ? "—" : readMinutes(minutes)}
                  caption="planned"
                  muted={minutes === 0}
                />
              </div>
            </div>
            <ul className="border-t border-hairline">
              {days.map((date) => {
                const day = sheet.find(employeeId, date)
                return (
                  <li
                    key={date}
                    className="border-b border-hairline last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => onPick({ employeeId, date, day })}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-(--t-press) ease-(--ease-out) active:bg-soft",
                        date === today && "bg-accent-bg/60",
                      )}
                    >
                      <span
                        className={cn(
                          "w-[4.5rem] shrink-0 text-[0.875rem] tabular-nums",
                          date === today
                            ? "font-semibold text-accent"
                            : "text-body",
                        )}
                      >
                        {dayName(date)}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-cell",
                          day === undefined
                            ? "text-mute"
                            : day.plan === "SCHEDULED"
                              ? "font-medium text-ink"
                              : "text-body",
                        )}
                      >
                        {dayWord(day)}
                      </span>
                      {day !== undefined && day.revision_count > 1 && (
                        <span className="shrink-0 text-[0.875rem] text-warn-fg">
                          Re-planned
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

      {/* Cover: who is on, per day — red when nobody is. */}
      <section className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
        <h3 className="p-4 pb-3 text-card-title font-semibold text-ink">
          On the rota
        </h3>
        <ul className="border-t border-hairline">
          {days.map((date) => {
            const count = sheet.working(date)
            return (
              <li
                key={date}
                className={cn(
                  "flex min-h-11 items-center gap-3 border-b border-hairline px-4 py-2 last:border-b-0",
                  date === today && "bg-accent-bg/60",
                )}
              >
                <span
                  className={cn(
                    "w-[4.5rem] shrink-0 text-[0.875rem] tabular-nums",
                    date === today ? "font-semibold text-accent" : "text-body",
                  )}
                >
                  {dayName(date)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.875rem] text-mute">
                  {sheet.shiftNames
                    .map((name) => `${name} ${sheet.working(date, name)}`)
                    .join(" · ")}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-cell font-semibold tabular-nums",
                    count === 0 ? "text-bad-fg" : "text-ink",
                  )}
                >
                  {count}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

/// Plan one day of one person's week.
function PlanSheet({
  target,
  team,
  catalogue,
  onClose,
}: {
  target: Target
  team: EmployeeList | undefined
  catalogue: readonly ShiftView[]
  onClose: () => void
}) {
  const client = useQueryClient()
  const current = target.day
  const [plan, setPlan] = useState<"SCHEDULED" | "REST_DAY" | "PUBLIC_HOLIDAY">(
    (current?.plan as
      "SCHEDULED" | "REST_DAY" | "PUBLIC_HOLIDAY" | undefined) ?? "SCHEDULED",
  )
  const [shiftId, setShiftId] = useState(current?.shift_id ?? "")
  const [reason, setReason] = useState("")

  const save = useMutation({
    mutationFn: () =>
      planDay({
        employeeId: target.employeeId,
        onDate: target.date,
        plan,
        shiftId: plan === "SCHEDULED" ? shiftId : undefined,
        reason,
      }),
    onSuccess: () => {
      client.invalidateQueries({
        queryKey: [CENTRAL_KEY_PREFIX, "hr", "roster"],
      })
      client.invalidateQueries({ queryKey: hrKeys.attendance() })
      onClose()
    },
  })

  const person = team?.rows.find((one) => one.employee_id === target.employeeId)

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={person?.full_name ? person.employee_code : undefined}
      crumb="Roster"
      title={personName(team, target.employeeId)}
      sub={readDate(target.date, true)}
      status={
        current === undefined ? (
          <Pill tone="neutral">Not planned</Pill>
        ) : (
          <Pill tone={current.plan === "SCHEDULED" ? "accent" : "neutral"}>
            {planWord(current.plan)}
          </Pill>
        )
      }
      foot={
        <Submit
          label={current === undefined ? "Create plan" : "Save changes"}
          pendingLabel={current === undefined ? "Creating…" : "Saving…"}
          pending={save.isPending}
          disabled={
            reason.trim() === "" || (plan === "SCHEDULED" && shiftId === "")
          }
          error={save.error}
          onSubmit={() => save.mutate()}
          onCancel={onClose}
        />
      }
    >
      {current !== undefined && (
        <SheetSection title="As planned">
          <Facts
            rows={[
              ["Plan", planWord(current.plan)],
              current.shift_name !== null && [
                "Shift",
                `${current.shift_name} ${current.starts_at ?? ""}–${current.ends_at ?? ""}${current.crosses_midnight ? " +1" : ""}`,
              ],
              current.planned_work_minutes !== null && [
                "Paid time",
                readMinutes(current.planned_work_minutes),
              ],
              ["Planned by", personByLogin(team, current.planned_by)],
              current.revision_count > 1 && [
                "Re-planned",
                <span className="text-warn-fg">
                  {current.revision_count} times
                </span>,
              ],
            ]}
          />
        </SheetSection>
      )}

      <SheetSection title={current === undefined ? "Plan" : "New plan"}>
        <div className="flex flex-col gap-3">
          <Field label="Day type" required>
            <Select
              value={plan}
              onChange={(value) => setPlan(value as typeof plan)}
            >
              <option value="SCHEDULED">A working day</option>
              <option value="REST_DAY">A day off</option>
              <option value="PUBLIC_HOLIDAY">A public holiday</option>
            </Select>
          </Field>
          {plan === "SCHEDULED" && (
            <Field
              label="Shift"
              required
              hint={
                catalogue.length === 0 ? "No shift patterns yet." : undefined
              }
            >
              <Select value={shiftId} onChange={setShiftId}>
                <option value="">Choose a shift…</option>
                {catalogue.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.name} · {shift.starts_at}–{shift.ends_at}
                    {shift.crosses_midnight ? " +1" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Reason" required>
            <Input
              value={reason}
              placeholder={
                current === undefined ? "Weekly rota" : "Covering for Sari"
              }
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
      </SheetSection>
    </PeopleSheet>
  )
}
