import type { ColumnDef } from "@tanstack/react-table"
import { CalendarClock } from "lucide-react"
import type { CloseReadinessView, PeriodView } from "@itulah/contract"

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
  BandHead,
  Fact,
  Facts,
  Line,
  Measure,
  Measures,
  NotAssessed,
  Quiet,
  Stepper,
  SubHead,
} from "@/modules/people/parts"
import { addMonths, monthOf, period } from "@/modules/people/labels"

/// Signing the month off — and being honest about what the signature covers.
///
/// ## The screen's whole job is to say what was NOT checked
///
/// A close records a readiness: what stood in the month's way when somebody put
/// their name to it. Two of those counts come back `null` rather than `0`,
/// because there is no punch source anywhere in the cloud and so nothing was
/// assessed. **A zero would be a claim that somebody looked and found none.**
///
/// So nothing here renders a `null` as a number. `open_corrections` and
/// `unrostered_punch_days` are drawn as an em dash carrying the reason — see
/// `NotAssessed` in `parts.tsx` — and the strip above them says it in a
/// sentence, once, before any figure is read. A tidy row of zeros is exactly
/// how a month gets signed off as clean when half of it was never examined,
/// and `punches_assessed` is the server's own flag for saying so.
///
/// `can_close` is the server's answer and is read rather than re-derived. It
/// is `true` today on a month with unassessed punch checks, which is correct
/// and is precisely why the sentence above it matters: nothing blocks the
/// close, and the close is narrower than it looks.
///
/// ## Two reads, because the route answers two different questions
///
/// `GET /attendance-periods?place=X` returns only the months that have a
/// RECORD — one that has been closed or reopened at least once. A place that
/// has never closed anything answers `[]`, and an unclosed month is the resting
/// state, so that is correct rather than empty.
///
/// Adding `&period=YYYY-MM` answers about one month whether or not it has a
/// record, synthesising an open one with its readiness computed now. That is
/// the read this screen is built on: the question is "can I close September",
/// and September does not exist as a row until somebody has already closed it.
///
/// ## Closing is the place's; reopening is head office's
///
/// A place that could reopen its own sign-off has not signed anything off, so
/// the two acts sit at different rungs — `ATTENDANCE_PERIOD_CLOSE` is a
/// supervisor's and `ATTENDANCE_PERIOD_REOPEN` is head office's. The row
/// therefore carries no `audience`: both faces open this screen, and they are
/// reading it for opposite reasons.
///
/// ## This screen signs nothing
///
/// Both routes refuse a body without a reason, and the reason is recorded as
/// the authority for the close. That is a form the module has not written yet,
/// so this reads and the old hub is where a month is signed. A button that only
/// looked as though it closed a month would be worse than no button — and on
/// this screen, worse than most.

export function PeriodsScreen() {
  const url = useQueryState()
  const places = usePlaces()
  const reach = useReach()
  const nowhere = reachesNowhere(reach.data)

  const place = url.one("place") || places.fallback || ""
  const month = url.one("period") || monthOf(today())
  const openId = url.one("month")

  // The month being asked about, which the route will answer for whether or not
  // it has ever been closed.
  const asked = useReport<PeriodView[]>({
    key: ["people", "periods", "one"],
    path: "/api/v1/attendance-periods",
    params: { place, period: month },
    enabled: place !== "",
  })

  // Every month this place has a record for — the sign-off history.
  const history = useReport<PeriodView[]>({
    key: ["people", "periods", "history"],
    path: "/api/v1/attendance-periods",
    params: { place },
    enabled: place !== "",
  })

  const subject = asked.data?.[0]
  const rows = history.data ?? []

  const columns: ColumnDef<TableSetup, PeriodView>[] = [
    {
      id: "period",
      header: "Month",
      size: 22,
      meta: { icon: <CalendarClock className="size-[15px]" />, min: 150 },
      cell: ({ row }) => (
        <span className="text-ink font-medium">{period(row.original.period)}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      size: 16,
      meta: { min: 120 },
      cell: ({ row }) => (
        <Tag tone={row.original.status === "CLOSED" ? "ok" : "warn"}>
          {row.original.status === "CLOSED" ? "Signed off" : "Open"}
        </Tag>
      ),
    },
    {
      id: "reopens",
      header: "Reopened",
      size: 14,
      // Never dropped. A frequently reopened month is the governance signal
      // this table exists to surface — a place whose sign-off is undone three
      // times has not been signing anything off.
      meta: { align: "right", min: 110 },
      cell: ({ row }) =>
        row.original.reopen_count === 0 ? (
          <Quiet>Never</Quiet>
        ) : (
          <span className="text-warn-ink font-medium tabular-nums">
            ×{row.original.reopen_count}
          </span>
        ),
    },
    {
      id: "last",
      header: "Last decided",
      size: 24,
      meta: { priority: 1, min: 150 },
      cell: ({ row }) => {
        const last = row.original.history.at(-1)
        return last === undefined ? (
          <Quiet />
        ) : (
          <span className="truncate">{day(last.at)}</span>
        )
      },
    },
    {
      id: "by",
      header: "By",
      size: 24,
      meta: { priority: 2, min: 140 },
      cell: ({ row }) => {
        const last = row.original.history.at(-1)
        return last === undefined ? (
          <Quiet />
        ) : (
          <span className="truncate font-mono">{last.actor}</span>
        )
      },
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="People"
        title="Period close"
        description={whoseList(reach.data, {
          everywhere: `What ${places.nameOf(place)} has signed off, and what head office has sent back.`,
          at: (name) =>
            `Signing ${name}'s months off. A close freezes the roster as well as the facts.`,
        })}
      />

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
          history.data === undefined
            ? "Loading…"
            : `${count(rows.length)} ${rows.length === 1 ? "month has" : "months have"} a record`
        }
      >
        <Stepper
          kind="month"
          label="Month"
          value={month}
          onChange={(value) => url.set({ period: monthOf(`${value}-01`) })}
          back={addMonths(month, -1)}
          forward={addMonths(month, 1)}
        />
        <span className="text-ctl text-ink-3">{period(month)}</span>
      </Toolbar>

      {nowhere === true ? (
        <NoAccess
          what="an attendance period"
          reach="You have no open posting, so there is no month of yours to close."
        />
      ) : place === "" && places.ready ? (
        <Empty
          what="places with staff"
          detail="Nothing is posted anywhere you reach, so there is no month to close."
        />
      ) : asked.isError || history.isError ? (
        (asked.error ?? history.error) instanceof ApiError &&
        ((asked.error as ApiError | undefined)?.status === 403 ||
          (history.error as ApiError | undefined)?.status === 403) ? (
          <NoAccess
            what="this place's months"
            reach={(asked.error as ApiError | undefined)?.detail}
          />
        ) : (
          <Failed
            what="the months"
            error={asked.error ?? history.error}
            onRetry={() => {
              void asked.refetch()
              void history.refetch()
            }}
          />
        )
      ) : (
        <>
          <Standing period={subject} pending={asked.isPending} month={month} />

          <BandHead
            trailing={
              rows.length === 0 ? undefined : "Every month with a sign-off on it"
            }
          >
            Sign-off history
          </BandHead>

          {history.isPending ? (
            <Loading rows={5} cols={columns.length} />
          ) : rows.length === 0 ? (
            <Empty
              what="closed months"
              // Not "nothing here". An unclosed month is the resting state —
              // a place with no record has simply never signed one off, which
              // is a fact rather than an absence of data.
              detail="No month has been signed off or reopened here. An open month is the resting state, so there is nothing to list until one is closed."
            />
          ) : (
            <Table
              columns={columns}
              rows={rows}
              rowId={(row) => row.period}
              caption="Months with a sign-off record"
              onRowClick={(row) => url.set({ month: row.period }, false)}
              isOpen={(row) => row.period === openId}
              foot={{
                period: (
                  <>
                    <b className="text-ink">{count(rows.length)}</b>{" "}
                    {rows.length === 1 ? "month" : "months"}
                  </>
                ),
                reopens: (
                  <span className="tabular-nums">
                    {count(rows.reduce((sum, row) => sum + row.reopen_count, 0))}{" "}
                    reopenings
                  </span>
                ),
              }}
            />
          )}
        </>
      )}

      <MonthSheet
        record={rows.find((row) => row.period === openId)}
        openId={openId}
        onClose={() => url.set({ month: null }, false)}
      />
    </div>
  )
}

/// Where the month asked about actually stands.
///
/// Drawn above the history rather than inside it, because it is the question
/// somebody opened the screen with and the history is the context for it.
function Standing({
  period: record,
  pending,
  month,
}: {
  period: PeriodView | undefined
  pending: boolean
  month: string
}) {
  if (pending || record === undefined) {
    return (
      <BandHead>Reading {period(month)}…</BandHead>
    )
  }

  const readiness = record.readiness
  return (
    <>
      <BandHead
        trailing={
          <Tag tone={record.status === "CLOSED" ? "ok" : "warn"}>
            {record.status === "CLOSED" ? "Signed off" : "Open"}
          </Tag>
        }
      >
        {period(record.period)}
      </BandHead>

      {readiness === null ? (
        // The server sends no readiness for a month already closed: what stands
        // between a closed month and a close is not a question anybody is
        // asking. Saying that beats drawing four empty measures.
        <div className="border-line text-ctl text-ink-3 shrink-0 border-b px-4 py-2.5">
          This month is signed off, so there is nothing left standing in its
          way. What was standing in it at the time is on the record below.
        </div>
      ) : (
        <>
          {/* The sentence before the figures, not beside them. Somebody who
              reads four counts and then a caveat has already formed the view
              the caveat was meant to prevent. */}
          {!readiness.punches_assessed && (
            <div className="border-warn/40 bg-warn-wash text-ctl text-warn-ink flex shrink-0 items-center gap-2 border-b px-4 py-2">
              <span>
                <b className="font-medium">
                  No punch source is connected, so nothing here knows what was
                  worked
                </b>{" "}
                — only what was planned, and what leave and overtime were
                decided. A close taken now records that the punch checks were
                not made.
              </span>
            </div>
          )}
          <Readiness readiness={readiness} />
        </>
      )}
    </>
  )
}

/// The four things that stand between a month and its close, two of which
/// nobody measured.
function Readiness({ readiness }: { readiness: CloseReadinessView }) {
  const unmeasured =
    "Not assessed. There is no punch source anywhere in the cloud, so nothing counted these — it is not a count of zero."
  return (
    <Measures>
      <Measure
        label="Leave still undecided"
        tone={readiness.unresolved_leave > 0 ? "warn" : undefined}
        note="Blocks the close"
      >
        {count(readiness.unresolved_leave)}
      </Measure>
      <Measure
        label="Overtime unanswered"
        tone={readiness.unanswered_overtime > 0 ? "warn" : undefined}
        note="Blocks the close"
      >
        {count(readiness.unanswered_overtime)}
      </Measure>
      <Measure label="Attendance corrections open" note="Punch check">
        {readiness.open_corrections === null ? (
          <NotAssessed why={unmeasured} />
        ) : (
          count(readiness.open_corrections)
        )}
      </Measure>
      <Measure label="Days punched, not rostered" note="Punch check">
        {readiness.unrostered_punch_days === null ? (
          <NotAssessed why={unmeasured} />
        ) : (
          count(readiness.unrostered_punch_days)
        )}
      </Measure>
      <Measure
        label="Nobody rostered"
        // Informational, and the server says so: a place may legitimately have
        // staff nobody scheduled. Marking it amber would make a normal month
        // look like a problem every time.
        note="Does not block"
      >
        {count(readiness.employees_without_roster)}
      </Measure>
    </Measures>
  )
}

/// One month's sign-off record, whole.
///
/// The readiness carried on each event is the point: it is what was true when
/// somebody signed, not what is true now, and it is the only way to answer
/// "what did that signature actually cover" afterwards.
function MonthSheet({
  record,
  openId,
  onClose,
}: {
  record: PeriodView | undefined
  openId: string
  onClose: () => void
}) {
  return (
    <Sheet
      open={openId !== ""}
      onClose={onClose}
      width="record"
      title={record === undefined ? "Month" : period(record.period)}
      subtitle={
        record === undefined
          ? undefined
          : record.status === "CLOSED"
            ? "Signed off"
            : "Open"
      }
    >
      {record === undefined ? null : (
        <>
          <Facts>
            <Fact label="Place">
              <span className="font-mono">{record.place_id}</span>
            </Fact>
            <Fact label="Reopened">
              {record.reopen_count === 0 ? (
                <Quiet>Never</Quiet>
              ) : (
                <span className="text-warn-ink tabular-nums">
                  {record.reopen_count} times
                </span>
              )}
            </Fact>
          </Facts>

          <SubHead>What was decided, and by whom</SubHead>
          {record.history.length === 0 ? (
            <Line>
              <Quiet>Nothing has been recorded.</Quiet>
            </Line>
          ) : (
            record.history.map((event, index) => (
              <div key={`${event.event}-${event.at}-${index}`}>
                <Line note={`${event.actor} — ${event.reason}`}>
                  <span className="text-ink min-w-0 flex-1 truncate font-medium">
                    {event.event === "CLOSED" ? "Signed off" : "Reopened"}
                  </span>
                  <span className="text-ink-3 shrink-0">{day(event.at)}</span>
                </Line>
                {event.readiness === null ? (
                  // A reopen is not taken under an assessment — there is
                  // nothing to assess about undoing a signature — so an absent
                  // readiness here is correct rather than missing.
                  <Line>
                    <Quiet>
                      A reopening is not taken under an assessment, so none was
                      recorded.
                    </Quiet>
                  </Line>
                ) : (
                  <Readiness readiness={event.readiness} />
                )}
              </div>
            ))
          )}
        </>
      )}
    </Sheet>
  )
}
