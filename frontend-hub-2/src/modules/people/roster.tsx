import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Users } from "lucide-react"
import type {
  EmployeeList,
  EmployeeSummary,
  RosterDayView,
} from "@itulah/contract"

import { ApiError } from "@/lib/api"
import { count, day, today } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { reachesNowhere, useReach, whoseList } from "@/lib/reach"
import type { TableSetup } from "@/lib/table"
import { PageHead, Toolbar } from "@/kit/page"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tabs } from "@/kit/tabs"
import { Tag } from "@/kit/tag"
import { Empty, Failed, Loading, NoAccess } from "@/kit/state"
import { usePlaces } from "@/modules/people/places"
import {
  Fact,
  Facts,
  Line,
  Person,
  Quiet,
  Stepper,
  SubHead,
} from "@/modules/people/parts"
import {
  addDays,
  dayInMonth,
  mondayOf,
  planLabel,
  span,
  weekday,
} from "@/modules/people/labels"

/// The week, per person — what a place intends, before anybody works it.
///
/// ## The grid is the plan, and the plan is upstream of money
///
/// "Absent" only means anything against a scheduled day. What is written here
/// is what a month is later counted against, which is why a revision keeps the
/// plan it replaced and why a closed month refuses a change at all. Both
/// refusals are the server's, with the sentence it uses.
///
/// ## Seven columns, and no scroll sideways
///
/// A week fits; a month does not, and a month grid is a month somebody reads
/// diagonally. The question a manager has is "is Tuesday covered", and seven
/// columns answer it at a glance where thirty would not. Columns leave by
/// priority as the frame narrows — see `kit/table.tsx` — so the days at the
/// far end of the week go before the names do.
///
/// ## Every row is a person, including the ones with nothing planned
///
/// `GET /roster` returns the days that were PLANNED. A grid drawn from that
/// alone would list only the people somebody had already thought about, and the
/// person nobody rostered — the actual finding — would not be on it. So the
/// rows are the place's ACTIVE workforce and the plans are joined onto them; an
/// empty row is the answer, not a missing one.
///
/// Active only. A candidate has not started and somebody who has left is not
/// coming in, and rostering either is a plan that cannot be worked.
///
/// ## Which place, and why there is a strip for head office only
///
/// The route refuses to answer without a `place`, and there is no places
/// endpoint on this surface. See `places.ts` for where the list comes from and
/// why a bounded caller is not offered one.
///
/// ## This screen plans nothing
///
/// `POST /employees/{id}/roster` takes a plan, a date and a REASON, and the
/// reason is recorded as the authority for the day. That is a form, and the
/// module has not written one yet — so this reads, and the old hub's grid is
/// where a day is planned. A button here that only looked as though it planned
/// would be worse than no button.

/// How many of a place's staff the grid asks for.
///
/// Larger than any real shop and smaller than the endpoint's ceiling, so the
/// envelope's `total` can be compared with what arrived and the toolbar can say
/// plainly when a place has outgrown it.
const TEAM = 200

export function RosterScreen() {
  const url = useQueryState()
  const places = usePlaces()
  const reach = useReach()
  const nowhere = reachesNowhere(reach.data)

  const place = url.one("place") || places.fallback || ""
  // Snapped to a Monday whatever the URL said. A rota is read as a week, and a
  // grid that began on a Wednesday because somebody pasted a Wednesday would be
  // two half-weeks drawn as one.
  const from = mondayOf(url.one("week") || today())
  const week = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(from, index)),
    [from],
  )
  const to = week[6]
  const openId = url.one("person")

  const plans = useReport<RosterDayView[]>({
    key: ["people", "roster", "place"],
    // Exactly the three the route declares. Its query struct refuses unknown
    // fields, so a stray `limit` would be a 422 rather than an ignored value —
    // which is why this is `useReport` and not `useBoundedList`.
    path: "/api/v1/roster",
    params: { place, from, to },
    enabled: place !== "",
  })

  const team = useReport<EmployeeList>({
    key: ["people", "roster", "team"],
    path: "/api/v1/employees",
    params: { place_id: place, status: "ACTIVE", limit: TEAM },
    enabled: place !== "",
  })

  // Keyed by person and date, so drawing a cell is a lookup rather than a scan
  // of the whole week for every square.
  const planned = useMemo(() => {
    const map = new Map<string, RosterDayView>()
    for (const entry of plans.data ?? [])
      map.set(`${entry.employee_id}|${entry.on_date}`, entry)
    return map
  }, [plans.data])

  const rows = team.data?.rows ?? []

  const columns: ColumnDef<TableSetup, EmployeeSummary>[] = [
    {
      id: "who",
      header: "Who",
      size: 20,
      // No priority: the names are the one column a roster cannot lose.
      meta: { icon: <Users className="size-[15px]" />, min: 160 },
      cell: ({ row }) => (
        <Person
          id={row.original.employee_id}
          code={row.original.employee_code}
          name={row.original.full_name}
        />
      ),
    },
    ...week.map((date, index) => ({
      id: date,
      header: `${weekday(date)} ${dayInMonth(date)}`,
      size: 11.5,
      // The far end of the week goes first when the frame narrows: somebody
      // looking at a rota on a phone is nearly always asking about the next
      // day or two, and Monday is the anchor everything else is counted from.
      meta: { priority: 7 - index, min: 96 },
      cell: ({ row }: { row: { original: EmployeeSummary } }) => (
        <Cell entry={planned.get(`${row.original.employee_id}|${date}`)} />
      ),
    })),
  ]

  const description = whoseList(reach.data, {
    everywhere: `What ${places.nameOf(place)} intends for the week of ${day(from)}.`,
    at: (name) => `What ${name} intends for the week of ${day(from)}.`,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead module="People" title="Roster" description={description} />

      {/* Head office alone: the facet is empty for a bounded caller, who has
          one place and needs no control that cannot change the answer. */}
      {places.all.length > 1 && (
        <Tabs
          label="Place"
          value={place}
          onChange={(value) => url.set({ place: value }, false)}
          tabs={places.all.map((one) => ({
            value: one.value,
            label: one.label,
            count: one.count,
          }))}
        />
      )}

      <Toolbar
        trailing={
          // What arrived against what the place actually has. They are the same
          // number in every real shop; saying so costs nothing and the day they
          // differ is the day a grid would silently be missing somebody.
          team.data === undefined ? (
            "Loading…"
          ) : rows.length < team.data.total ? (
            <span className="text-warn-ink">
              {count(rows.length)} of {count(team.data.total)} rostered staff —
              this grid is not everybody
            </span>
          ) : (
            <>
              {count(rows.length)} {rows.length === 1 ? "person" : "people"}
            </>
          )
        }
      >
        <Stepper
          kind="date"
          label="Week beginning"
          value={from}
          onChange={(value) => url.set({ week: mondayOf(value) })}
          back={addDays(from, -7)}
          forward={addDays(from, 7)}
        />
        <span className="text-ctl text-ink-3">
          {day(from)} — {day(to)}
        </span>
      </Toolbar>

      <Body
        nowhere={nowhere === true}
        place={place}
        ready={places.ready}
        pending={team.isPending || plans.isPending}
        error={team.isError ? team.error : plans.isError ? plans.error : null}
        onRetry={() => {
          void team.refetch()
          void plans.refetch()
        }}
        rows={rows}
        columns={columns}
        planCount={plans.data?.length ?? 0}
        onOpen={(id) => url.set({ person: id }, false)}
        openId={openId}
      />

      <WeekSheet
        person={rows.find((row) => row.employee_id === openId)}
        openId={openId}
        week={week}
        planned={planned}
        onClose={() => url.set({ person: null }, false)}
      />
    </div>
  )
}

/// One square of the grid.
///
/// An unplanned day is a grey dash rather than a blank. A blank cell in a grid
/// of forty reads as a rendering fault; a dash reads as "nothing is planned
/// here", which is the finding somebody opened the screen for.
function Cell({ entry }: { entry: RosterDayView | undefined }) {
  if (entry === undefined) return <Quiet />
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-ink truncate">
        {entry.plan === "SCHEDULED"
          ? (entry.shift_name ?? entry.shift_id ?? "Scheduled")
          : planLabel(entry.plan)}
      </span>
      {/* A day planned more than once is a governance signal, so it is on the
          cell rather than a click away: somebody revising Tuesday four times
          is the thing worth noticing about Tuesday. */}
      {entry.revision_count > 1 && (
        <Tag tone="info" className="h-[19px] px-1.5">
          ×{entry.revision_count}
        </Tag>
      )}
    </span>
  )
}

function Body({
  nowhere,
  place,
  ready,
  pending,
  error,
  onRetry,
  rows,
  columns,
  planCount,
  onOpen,
  openId,
}: {
  nowhere: boolean
  place: string
  ready: boolean
  pending: boolean
  error: unknown
  onRetry: () => void
  rows: EmployeeSummary[]
  columns: ColumnDef<TableSetup, EmployeeSummary>[]
  planCount: number
  onOpen: (id: string) => void
  openId: string
}) {
  // A caller with no open posting reaches no place at all, and the route would
  // refuse them. Saying so before the refusal lands is the honest order.
  if (nowhere) {
    return (
      <NoAccess
        what="a roster"
        reach="You have no open posting, so there is no place whose week is yours to read."
      />
    )
  }
  if (place === "" && ready) {
    return (
      <Empty
        what="places with staff"
        detail="Nothing is posted anywhere you reach, so there is no week to build."
      />
    )
  }
  if (pending || place === "") return <Loading rows={8} cols={8} />

  if (error !== null) {
    if (error instanceof ApiError && error.status === 403) {
      return <NoAccess what="this place's roster" reach={error.detail} />
    }
    return <Failed what="the roster" error={error} onRetry={onRetry} />
  }

  if (rows.length === 0) {
    return (
      <Empty
        what="people to roster"
        detail="Nobody active is posted here, so there is no week to plan."
      />
    )
  }

  return (
    <Table
      columns={columns}
      rows={rows}
      rowId={(row) => row.employee_id}
      caption="The week, per person"
      onRowClick={(row) => onOpen(row.employee_id)}
      isOpen={(row) => row.employee_id === openId}
      foot={{
        who: (
          <>
            {/* Days planned, not people. A week of seven people is 49 squares,
                and how many of them have been filled is the only summary a
                rota has — a count of the rows would just repeat the toolbar. */}
            <b className="text-ink">{count(planCount)}</b>{" "}
            {planCount === 1 ? "day planned" : "days planned"}
          </>
        ),
      }}
    />
  )
}

/// One person's week, and the authority behind each day of it.
///
/// The grid answers "is Tuesday covered". This answers the question that comes
/// after it — who decided that, and what did it replace. `revisions` is the
/// whole statement of the day, oldest first, and it is the reason a revised
/// roster stays reproducible after the month is settled.
function WeekSheet({
  person,
  openId,
  week,
  planned,
  onClose,
}: {
  person: EmployeeSummary | undefined
  openId: string
  week: readonly string[]
  planned: Map<string, RosterDayView>
  onClose: () => void
}) {
  return (
    <Sheet
      open={openId !== ""}
      onClose={onClose}
      width="record"
      title={person?.full_name ?? person?.employee_code ?? "This week"}
      subtitle={person?.position ?? undefined}
    >
      {week.map((date) => {
        const entry = planned.get(`${openId}|${date}`)
        return (
          <div key={date}>
            <SubHead>
              {weekday(date)} · {day(date)}
            </SubHead>
            {entry === undefined ? (
              <Line>
                <Quiet>Not planned.</Quiet>
              </Line>
            ) : (
              <>
                <Facts>
                  <Fact label="Plan">
                    {entry.plan === "SCHEDULED"
                      ? (entry.shift_name ?? entry.shift_id ?? "Scheduled")
                      : planLabel(entry.plan)}
                  </Fact>
                  <Fact label="Hours">
                    {entry.plan === "SCHEDULED" ? (
                      span(
                        entry.starts_at,
                        entry.ends_at,
                        entry.crosses_midnight,
                      )
                    ) : (
                      <Quiet>Not worked</Quiet>
                    )}
                  </Fact>
                  <Fact label="Paid time">
                    {entry.planned_work_minutes === null ? (
                      <Quiet />
                    ) : (
                      // The server's figure — the span less the unpaid break.
                      // Never recomputed here: two arithmetics for one number
                      // is one number that will eventually disagree with
                      // itself.
                      <span className="tabular-nums">
                        {Math.floor(entry.planned_work_minutes / 60)}h
                        {entry.planned_work_minutes % 60 === 0
                          ? ""
                          : ` ${entry.planned_work_minutes % 60}m`}
                      </span>
                    )}
                  </Fact>
                  <Fact label="Times planned">
                    <span className="tabular-nums">
                      {entry.revision_count}
                    </span>
                  </Fact>
                </Facts>
                {entry.revisions.map((revision, index) => (
                  <Line
                    key={`${revision.at}-${index}`}
                    // The reason is half the audit trail and the half that
                    // helps anybody: "jadwal minggu ini" and "menutup shift
                    // Budi" are different facts about the same change.
                    note={`${revision.actor} — ${revision.reason}`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {revision.plan === "SCHEDULED"
                        ? (revision.shift_id ?? "Scheduled")
                        : planLabel(revision.plan)}
                    </span>
                    <span className="text-ink-3 shrink-0">
                      {index === entry.revisions.length - 1
                        ? "in force"
                        : "replaced"}
                    </span>
                  </Line>
                ))}
              </>
            )}
          </div>
        )
      })}
    </Sheet>
  )
}
