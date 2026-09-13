import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { CalendarDays, MapPin } from "lucide-react"
import type { CalendarView, CalendarYearsView, HolidayView } from "@itulah/contract"

import { ApiError, api } from "@/lib/api"
import { count, day } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import type { TableSetup } from "@/lib/table"
import { PageHead, Toolbar } from "@/kit/page"
import { Table } from "@/kit/table"
import { Tabs } from "@/kit/tabs"
import { Tag } from "@/kit/tag"
import { Empty, Failed, Loading, NoAccess } from "@/kit/state"
import { BandHead, Line, Quiet } from "@/modules/people/parts"
import { holidayKindLabel, holidayKindTone, weekday } from "@/modules/people/labels"

/// Which days are red, and which of them come out of somebody's annual leave.
///
/// ## Why this is typed in rather than compiled in
///
/// Indonesian public holidays are fixed each year by a joint decree of three
/// ministries. They move: several follow the Hijri calendar and are confirmed
/// only weeks ahead, and *cuti bersama* is routinely added, removed or shifted
/// after the year has started. A table in the code would need a release every
/// time the government changed its mind, and by then somebody has already been
/// marked absent.
///
/// ## Cuti bersama is not an ordinary holiday
///
/// By the same decree that announces it, it is **charged against the employee's
/// annual leave**: the company closes and the days come out of the twelve.
/// Filing it and a national holiday both as "a red day" is how a leave balance
/// ends up wrong by exactly the number of long weekends in the year. So it is
/// the amber row in the list, and `consumes_annual_leave` is the SERVER's
/// answer — a browser re-deriving it from the kind would be a second place the
/// rule lives.
///
/// ## Published once, amended for ever after
///
/// There is no republish. What is stored is the set as first published plus an
/// append-only list of amendments, each with its own authority — which is what
/// makes "the calendar March payroll was settled under" answerable in June. So
/// the amendments are shown beside the calendar rather than folded silently
/// into it, even though the `holidays` array already has them replayed.
///
/// ## A year with no calendar is never REQUESTED
///
/// `GET /holiday-calendars/{year}` answers 404 for a year nobody has published,
/// and that 404 is a real answer rather than a failure — it is why a leave
/// request spanning that year is refused. But it is not an answer worth asking
/// for: this screen reads the published years first and fetches a calendar only
/// for a year that is in that list. A screen that asked anyway would spend a
/// 404 to learn what the list it already has could have told it, and would draw
/// an error state over a fact.
///
/// ## Regional days are the reason there is a place column
///
/// A regional day is a holiday in some shops and a working day in others, so
/// `places` is a list rather than an absence — "everywhere" is a decision the
/// operator stated, and `null` is how they stated it. There is a separate route
/// for asking about one place on one day, and it has no place-free form for the
/// same reason.

export function HolidaysScreen() {
  const url = useQueryState()

  const years = useReport<CalendarYearsView>({
    key: ["people", "holiday-years"],
    path: "/api/v1/holiday-calendars",
    params: {},
  })

  const published = years.data?.years ?? []
  // The URL's year when it names one that exists, else the most recent
  // published. Never "this year" as a fallback that gets fetched: a year is
  // asked for only because it is on the list above.
  const asked = url.one("year")
  const chosen =
    published.includes(Number(asked)) && asked !== ""
      ? Number(asked)
      : (published.at(-1) ?? null)

  const calendar = useQuery({
    queryKey: ["people", "holiday-calendar", chosen] as const,
    // The guard that keeps the 404 unrequested. `chosen` is null exactly when
    // nothing has been published, and a year that is not on the list is never
    // what `chosen` holds.
    enabled: chosen !== null,
    queryFn: ({ signal }) =>
      api.get<CalendarView>(`/api/v1/holiday-calendars/${chosen}`, signal),
  })

  const holidays = calendar.data?.holidays ?? []
  const charged = holidays.filter((one) => one.consumes_annual_leave).length

  const columns: ColumnDef<TableSetup, HolidayView>[] = [
    {
      id: "date",
      header: "Date",
      size: 18,
      meta: { icon: <CalendarDays className="size-[15px]" />, min: 140 },
      cell: ({ row }) => (
        <span className="text-ink">
          {day(row.original.date)}
          <span className="text-ink-4"> · {weekday(row.original.date)}</span>
        </span>
      ),
    },
    {
      id: "name",
      header: "Holiday",
      size: 32,
      meta: { min: 190 },
      cell: ({ row }) => (
        <span className="text-ink truncate font-medium" title={row.original.name}>
          {row.original.name}
        </span>
      ),
    },
    {
      id: "kind",
      header: "Kind",
      size: 16,
      meta: { min: 130 },
      cell: ({ row }) => (
        <Tag tone={holidayKindTone(row.original.kind)}>
          {holidayKindLabel(row.original.kind)}
        </Tag>
      ),
    },
    {
      id: "charged",
      header: "Costs annual leave",
      size: 17,
      // No priority. This is the column the screen exists for: it is the
      // difference between a day off and a day off somebody's balance.
      meta: { min: 160 },
      cell: ({ row }) =>
        row.original.consumes_annual_leave ? (
          <span className="text-warn-ink font-medium">
            Yes — comes out of the twelve
          </span>
        ) : (
          <Quiet>No</Quiet>
        ),
    },
    {
      id: "places",
      header: "Observed in",
      size: 17,
      meta: { icon: <MapPin className="size-[15px]" />, priority: 1, min: 140 },
      cell: ({ row }) =>
        row.original.places === null ? (
          // A stated decision, not an absence — see the note above.
          <Quiet>Everywhere</Quiet>
        ) : (
          <span
            className="truncate"
            title={row.original.places.join(", ")}
          >
            {row.original.places.length}{" "}
            {row.original.places.length === 1 ? "place" : "places"}
          </span>
        ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="People"
        title="Holiday calendar"
        description="Which days are red, and which of them come out of somebody's annual leave."
      />

      {published.length > 1 && (
        <Tabs
          label="Year"
          value={String(chosen ?? "")}
          onChange={(value) => url.set({ year: value }, false)}
          tabs={published.map((year) => ({
            value: String(year),
            label: String(year),
          }))}
        />
      )}

      {years.isPending ? (
        <Loading rows={6} cols={columns.length} />
      ) : years.isError ? (
        years.error instanceof ApiError && years.error.status === 403 ? (
          <NoAccess what="the holiday calendar" reach={years.error.detail} />
        ) : (
          <Failed
            what="the published years"
            error={years.error}
            onRetry={() => void years.refetch()}
          />
        )
      ) : chosen === null ? (
        // Nothing published, for any year. Stated as its consequence rather
        // than as an empty table: the calendar is what settles which days a
        // leave request charges, so without one leave cannot be filed at all.
        <Empty
          what="published calendars"
          detail="No year has been published. Leave spanning an unpublished year cannot be filed, because which days it would charge cannot be settled — so this is what blocks a leave request rather than a list that happens to be short."
        />
      ) : calendar.isError ? (
        <Failed
          what={`the ${chosen} calendar`}
          error={calendar.error}
          onRetry={() => void calendar.refetch()}
        />
      ) : calendar.data === undefined ? (
        <Loading rows={6} cols={columns.length} />
      ) : (
        <>
          <Toolbar
            trailing={
              <>
                {count(holidays.length)} red{" "}
                {holidays.length === 1 ? "day" : "days"}
                {charged > 0 && (
                  <span className="text-warn-ink">
                    {" "}
                    · {count(charged)} charged to annual leave
                  </span>
                )}
              </>
            }
          >
            <span className="text-ctl text-ink-3">
              Published {day(calendar.data.published_at)} by{" "}
              <span className="font-mono">{calendar.data.published_by}</span>
              {calendar.data.published_reason !== "" &&
                ` — ${calendar.data.published_reason}`}
            </span>
          </Toolbar>

          {holidays.length === 0 ? (
            <Empty
              what="holidays"
              detail={`${chosen} was published with no red days in it, and every amendment since has been a removal. That is a statement rather than a gap — but it is an unusual one worth checking against the decree.`}
            />
          ) : (
            <Table
              columns={columns}
              rows={holidays}
              rowId={(row) => `${row.date}-${row.name}`}
              caption={`Public holidays in ${chosen}`}
              foot={{
                date: (
                  <>
                    <b className="text-ink">{count(holidays.length)}</b> red{" "}
                    {holidays.length === 1 ? "day" : "days"}
                  </>
                ),
                charged: (
                  <span className={charged > 0 ? "text-warn-ink" : undefined}>
                    {count(charged)} out of the twelve
                  </span>
                ),
              }}
            />
          )}

          {/* Shown even though `holidays` already has them replayed. The set in
              force is one fact; how it got there is another, and the second is
              what answers "what calendar was March settled under". */}
          {calendar.data.amendments.length > 0 && (
            <div className="border-line shrink-0 border-t">
              <BandHead
                trailing={`${count(calendar.data.amendments.length)} since publication`}
              >
                Amendments
              </BandHead>
              <div className="max-h-56 overflow-y-auto">
                {calendar.data.amendments.map((amendment, index) => (
                  <Line
                    key={`${amendment.at}-${index}`}
                    note={`${amendment.actor} — ${amendment.reason}`}
                  >
                    <Tag
                      tone={amendment.change === "ADDED" ? "ok" : "neutral"}
                    >
                      {amendment.change === "ADDED" ? "Added" : "Removed"}
                    </Tag>
                    <span className="text-ink min-w-0 flex-1 truncate">
                      {amendment.holiday.name}
                    </span>
                    <span className="text-ink-3 shrink-0">
                      {day(amendment.holiday.date)}
                    </span>
                  </Line>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
