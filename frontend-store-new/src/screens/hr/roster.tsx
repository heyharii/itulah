import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftRight, ChevronLeft, ChevronRight } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { Pill } from "@/components/ui/pill"
import { Banner } from "@/components/ui/states"
import { CENTRAL_KEY_PREFIX } from "@/lib/cloud"
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
import { personName, useTeam, usePendingSwaps } from "@/screens/hr/words"
import { SwapSheet } from "@/screens/hr/swaps"
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
export function HrRoster() {
  return (
    <HrWorkspace sub="The shop builds the rota from head office's shift patterns. Tap a day to plan it; the rows at the foot count cover.">
      {(scope) => <Roster scope={scope} />}
    </HrWorkspace>
  )
}

/// Monday. A retail week here is read Monday to Sunday; starting it on Sunday
/// puts the weekend at both ends of the strip.
function mondayOf(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7))
}

/// What a planned day is called in a cell a seventh of a phone wide.
function cellWord(day: RosterDayView | undefined): string {
  if (day === undefined) return "—"
  if (day.plan === "REST_DAY") return "Off"
  if (day.plan === "PUBLIC_HOLIDAY") return "Hol"
  return day.shift_name ?? "Shift"
}

interface Target {
  readonly employeeId: string
  readonly date: string
  readonly day: RosterDayView | undefined
}

function Roster({ scope }: { scope: StoreScope }) {
  const week = useParam("week")
  const from = week.value ?? isoDay(mondayOf(new Date()))
  const days = Array.from({ length: 7 }, (_, index) =>
    isoDay(addDays(new Date(`${from}T00:00:00`), index)),
  )
  const to = days[6] as string
  const today = isoDay(new Date())
  const thisWeek = isoDay(mondayOf(new Date()))

  const roster = useQuery({
    queryKey: hrKeys.roster(scope.id, from, to),
    queryFn: ({ signal }) => rosterAt(scope.id, from, to, signal),
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

  return (
    <>
      {(swaps.data?.rows.length ?? 0) > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-card border border-warn-fg/25 bg-warn-bg/50 px-3.5 py-2.5">
          <ArrowLeftRight className="mt-0.5 size-4 shrink-0 text-warn-fg" />
          <div className="flex min-w-0 flex-col items-start gap-1">
            {swaps.data?.rows.map((one) => (
              <button
                key={one.id}
                type="button"
                onClick={() => setSwap(one)}
                className="text-left text-meta text-warn-fg underline-offset-2 hover:underline pointer-coarse:min-h-11"
              >
                {personName(team.data, one.employee_id)} asks to swap with{" "}
                {personName(team.data, one.with_employee_id)} ·{" "}
                {readDate(one.on_date, true)}
              </button>
            ))}
          </div>
        </div>
      )}

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

      {centreState(roster, {
        loading: "Reading the week head office holds…",
        what: "this shop's rota",
        render: (rows) => (
          <Grid
            rows={rows}
            days={days}
            today={today}
            team={team.data}
            onPick={setTarget}
          />
        ),
      })}

      <p className="mt-3 text-meta text-mute">
        A day with no plan is shown as —: nobody has planned it, which is not
        the same as a day off. A cell marked ↻ has been re-planned.
      </p>

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

/// The matrix: a person per row, a day per column, and cover at the foot.
///
/// A matrix and not a list, so it stays a table on a phone too — it scrolls
/// sideways inside its own card with the names pinned, because the thing read
/// here is the week *across*, and seven cards per person would be a week
/// nobody could see at once.
function Grid({
  rows,
  days,
  today,
  team,
  onPick,
}: {
  rows: readonly RosterDayView[]
  days: readonly string[]
  today: string
  team: EmployeeList | undefined
  onPick: (target: Target) => void
}) {
  // Everybody active at this shop, plus anybody rostered who is not on the
  // list (a posting can move mid-week) — so an unplanned person still has a
  // row to plan them in.
  const active = (team?.rows ?? [])
    .filter((person) => person.status === "ACTIVE")
    .map((person) => person.employee_id)
  const people = [
    ...new Set([...active, ...rows.map((row) => row.employee_id)]),
  ]
  const find = (employeeId: string, date: string) =>
    rows.find((row) => row.employee_id === employeeId && row.on_date === date)

  const working = (date: string) =>
    rows.filter((row) => row.on_date === date && row.plan === "SCHEDULED")
  const shiftNames = [
    ...new Set(
      rows
        .filter((row) => row.plan === "SCHEDULED")
        .map((row) => row.shift_name ?? "Shift"),
    ),
  ].sort()

  if (people.length === 0) {
    return (
      <Banner tone="info">
        Nobody is posted here and nobody is rostered this week. That is a week
        nobody has planned, not a shop that is shut.
      </Banner>
    )
  }

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
                    {parsed.toLocaleDateString("id-ID", { weekday: "short" })}{" "}
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
            {people.map((employeeId) => {
              const mine = rows.filter((row) => row.employee_id === employeeId)
              const minutes = mine.reduce(
                (total, row) => total + (row.planned_work_minutes ?? 0),
                0,
              )
              return (
                <tr key={employeeId} className="border-b border-hairline">
                  <th className="sticky left-0 z-10 max-w-[11rem] truncate bg-canvas px-3.5 py-1.5 text-left text-cell font-medium text-ink">
                    {personName(team, employeeId)}
                  </th>
                  {days.map((date) => {
                    const day = find(employeeId, date)
                    return (
                      <td key={date} className="px-1 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => onPick({ employeeId, date, day })}
                          title={
                            day === undefined
                              ? "Not planned"
                              : `${planWord(day.plan)}${day.starts_at === null ? "" : ` ${day.starts_at}–${day.ends_at ?? ""}`}`
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
                            <span aria-label="re-planned">↻</span>
                          )}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-3.5 py-1.5 text-right text-meta whitespace-nowrap text-body tabular-nums">
                    {readMinutes(minutes)}
                  </td>
                </tr>
              )
            })}
            {/* Cover, per shift and in all. Red when nobody is on — the
                prototype's minimum is two, but the minimum is head office's
                rule and this build has no route that states it, so the only
                line drawn here is the one nobody could argue with. */}
            {shiftNames.map((name) => (
              <tr key={name} className="border-b border-hairline bg-soft/60">
                <th className="sticky left-0 z-10 bg-soft px-3.5 py-1.5 text-left text-meta font-medium text-body">
                  {name}
                </th>
                {days.map((date) => {
                  const count = working(date).filter(
                    (row) => (row.shift_name ?? "Shift") === name,
                  ).length
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
                const count = working(date).length
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

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
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
          label={current === undefined ? "Plan this day" : "Re-plan this day"}
          pending={save.isPending}
          disabled={
            reason.trim() === "" || (plan === "SCHEDULED" && shiftId === "")
          }
          error={save.error}
          onSubmit={() => save.mutate()}
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
              ["Planned by", current.planned_by],
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
          <Field label="The day is">
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
              hint={
                catalogue.length === 0
                  ? "Head office has defined no shift patterns yet."
                  : "Head office's patterns; a shop cannot invent one."
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
          <Field
            label="Why"
            hint="Head office refuses a plan with no reason on it."
          >
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
