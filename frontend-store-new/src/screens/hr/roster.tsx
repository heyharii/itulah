import { useQuery } from "@tanstack/react-query"
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { RecordCard } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { useParam } from "@/lib/params"
import {
  addDays,
  hrKeys,
  isoDay,
  nameOf,
  planWord,
  readDate,
  readMinutes,
  rosterAt,
  teamAt,
  type StoreScope,
} from "@/lib/queries/hr"
import { cn } from "@/lib/utils"
import { centreState } from "@/screens/hr/centre"
import { HrWorkspace } from "@/screens/hr/workspace"
import type { RosterDayView } from "@itulah/contract"

/// The week, per person.
///
/// `menu-final.md` gives a store manager "Susun roster" — build the rota — and
/// this screen does not do that. It reads. Planning a day is
/// `POST /employees/{id}/roster`, which exists and a store credential may call
/// it, but a rota is built by dragging a fortnight of shifts around a grid and
/// a counter tablet is not where that happens; the console has the screen for
/// it. What a shop needs *here* is the week it is working to, at the counter,
/// where the questions about it are asked.
///
/// Seven days in one read — `GET /api/v1/roster?place&from&to` — rather than
/// seven reads, because the centre already answers a range and a screen that
/// fired one request per day would be seven chances for one of them to fail.
export function HrRoster() {
  return <HrWorkspace>{(scope) => <Roster scope={scope} />}</HrWorkspace>
}

/// Monday. `getDay()` is Sunday-first and a retail week here is not: a rota is
/// read Monday to Sunday, and starting it on Sunday puts the weekend at both
/// ends of the strip.
function mondayOf(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7))
}

function Roster({ scope }: { scope: StoreScope }) {
  const week = useParam("week")
  const from = week.value ?? isoDay(mondayOf(new Date()))
  const days = Array.from({ length: 7 }, (_, index) =>
    isoDay(addDays(new Date(`${from}T00:00:00`), index)),
  )
  const to = days[6] as string
  const today = isoDay(new Date())

  const roster = useQuery({
    queryKey: hrKeys.roster(scope.id, from, to),
    queryFn: ({ signal }) => rosterAt(scope.id, from, to, signal),
  })
  const team = useQuery({
    queryKey: hrKeys.team(scope.id),
    queryFn: ({ signal }) => teamAt(scope.id, signal),
  })

  return (
    <Section
      title={`${readDate(from)} – ${readDate(to)}`}
      action={
        <div className="flex items-center gap-1.5">
          <Button
            size="icon"
            aria-label="The week before"
            onClick={() =>
              week.set(isoDay(addDays(new Date(`${from}T00:00:00`), -7)))
            }
          >
            <ChevronLeft />
          </Button>
          <Button
            size="icon"
            aria-label="The week after"
            onClick={() =>
              week.set(isoDay(addDays(new Date(`${from}T00:00:00`), 7)))
            }
          >
            <ChevronRight />
          </Button>
        </div>
      }
    >
      {centreState(roster, {
        loading: "Reading the week head office holds…",
        render: (rows) => {
          // One card per person, in the order the workforce list gives, so
          // this screen and Team read the same way round. Somebody rostered
          // who is not on that list still gets a row — a posting can move
          // mid-week — and falls to the end under their id.
          const people = [...new Set(rows.map((row) => row.employee_id))].sort(
            (left, right) =>
              nameOf(team.data, left).name.localeCompare(
                nameOf(team.data, right).name,
              ),
          )

          const planned = rows.reduce(
            (total, row) => total + (row.planned_work_minutes ?? 0),
            0,
          )

          return people.length === 0 ? (
            <EmptyState>
              Head office holds no rota for {scope.id} in this week. That is a
              week nobody has planned, not a week the shop is shut.
            </EmptyState>
          ) : (
            <>
              <Banner tone="info" className="mb-4">
                {people.length} rostered, {readMinutes(planned)} of paid time
                planned across the week. What was actually worked is not
                recorded anywhere in this system.
              </Banner>
              <CardList>
                {people.map((employeeId) => {
                  const who = nameOf(team.data, employeeId)
                  const mine = rows.filter(
                    (row) => row.employee_id === employeeId,
                  )
                  const minutes = mine.reduce(
                    (total, row) => total + (row.planned_work_minutes ?? 0),
                    0,
                  )
                  const worked = mine.filter(
                    (row) => row.plan === "SCHEDULED",
                  ).length

                  return (
                    <RecordCard
                      key={employeeId}
                      icon={<CalendarRange />}
                      id={who.name}
                      status={
                        <Pill tone={worked === 0 ? "neutral" : "accent"}>
                          {worked} day{worked === 1 ? "" : "s"}
                        </Pill>
                      }
                    >
                      <div className="grid grid-cols-7 gap-1 px-2 pt-2.5">
                        {days.map((date) => (
                          <DayCell
                            key={date}
                            date={date}
                            today={date === today}
                            day={mine.find((row) => row.on_date === date)}
                          />
                        ))}
                      </div>
                      <div className="px-3.5 pb-1">
                        <KeyValue term={who.code ?? "Badge"}>
                          {readMinutes(minutes)} planned
                        </KeyValue>
                      </div>
                    </RecordCard>
                  )
                })}
              </CardList>
            </>
          )
        },
      })}
    </Section>
  )
}

/// One day of one person's week.
///
/// A day with no row is **not planned**, which is a different thing from a
/// rest day: a rest day is a decision somebody recorded and an unplanned day
/// is a gap. They are drawn differently for that reason, and the empty one
/// says nothing rather than implying the person is free.
function DayCell({
  date,
  today,
  day,
}: {
  date: string
  today: boolean
  day: RosterDayView | undefined
}) {
  const weekday = new Date(`${date}T00:00:00`).toLocaleDateString("id-ID", {
    weekday: "short",
  })
  const working = day?.plan === "SCHEDULED"

  return (
    <div
      className={cn(
        "min-w-0 rounded-inner border px-1 py-1.5 text-center",
        today ? "border-accent/30 bg-accent-bg" : "border-hairline bg-soft",
      )}
    >
      <div className="text-eyebrow font-semibold text-mute uppercase">
        {weekday}
      </div>
      <div className="truncate text-meta tabular-nums">{date.slice(8)}</div>
      <div
        className={cn(
          "mt-0.5 truncate text-meta font-medium",
          working ? "text-ink" : day === undefined ? "text-faint" : "text-mute",
        )}
        title={day === undefined ? "Not planned" : planWord(day.plan)}
      >
        {day === undefined ? "—" : (day.shift_name ?? shortPlan(day.plan))}
      </div>
    </div>
  )
}

/// A seventh of a phone is about four characters wide, so a cell gets a word
/// that fits and the full one goes in the `title`. Truncating "Public holiday"
/// to "Publi…" in seven cells side by side is a row nobody can read at all.
function shortPlan(plan: string): string {
  if (plan === "REST_DAY") return "Rest"
  if (plan === "PUBLIC_HOLIDAY") return "Hol."
  return planWord(plan)
}
