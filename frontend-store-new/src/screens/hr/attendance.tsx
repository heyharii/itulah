import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { CardList } from "@/components/ui/card-list"
import { Field, Input, Select } from "@/components/ui/field"
import { LeadCard } from "@/components/ui/lead-card"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Pill, Status } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner, EmptyState } from "@/components/ui/states"
import { dateText, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  attendanceOf,
  attendanceToday,
  clockOf,
  correctionsAt,
  decideCorrection,
  fileCorrection,
  hrKeys,
  isoDay,
  isoMonth,
  monthBounds,
  planWord,
  readDate,
  readMonth,
  rosterAt,
  type CorrectionEffect,
  type StoreScope,
} from "@/lib/queries/hr"
import { cn } from "@/lib/utils"
import { centreState } from "@/screens/hr/centre"
import {
  dateLead,
  Facts,
  Heading,
  Person,
  personCard,
  Submit,
  useDecision,
} from "@/screens/hr/parts"
import { RefusedBanner } from "@/screens/hr/refused"
import { SwapList } from "@/screens/hr/swaps"
import {
  dayStatus,
  outcomeWord,
  personByLogin,
  personName,
  requestState,
  teamRows,
  usePendingSwaps,
  useTeam,
  type Tone,
} from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type {
  AttendanceDayView,
  CorrectionRow,
  EmployeeList,
} from "@itulah/contract"

/// Attendance at this shop — the prototype's store Attendance: today, the
/// month's sheet, and the fixes.
///
/// # Nothing here is typed in
///
/// Every status below is *derived* at the centre, on every read, from the rota,
/// the punches (a registered reader, or a tap in the employee app inside the
/// shop's radius), the policy in force and the approvals — there is no stored
/// outcome and no column one could go in. So a forgotten check-in is not edited
/// here: it is a **fix**, filed by the shop and decided by somebody else, and
/// the day is derived again with the fix on top. The requester and the decider
/// must be different people, and the centre refuses the same name twice.
///
/// # "Not assessed" is not "absent"
///
/// The centre says whether any punch source has ever reported for this shop.
/// Until one has, every day reads as not assessed rather than as a row of
/// absences — a red cell would be a claim that something looked.
///
/// # The phone
///
/// The three slices are the dock's one chip (`PeopleTabs`); the month is a row
/// of the ⚙ sheet. The monthly sheet of thirty columns is one lead card per
/// person — the days present as the figure, what is wrong in the foot — and a
/// person's month is a sheet that lists the days one under the other, with a
/// "Record a fix" on every day nothing was recorded. The desk keeps the grid.
export function HrAttendance() {
  const [recording, setRecording] = useState<Prefill | null>(null)
  return (
    <HrWorkspace
      primary={{
        label: "New attendance fix",
        onClick: () => setRecording({}),
      }}
    >
      {(scope) => (
        <Attendance
          scope={scope}
          recording={recording}
          onRecord={setRecording}
        />
      )}
    </HrWorkspace>
  )
}

/// What a "New attendance fix" sheet opens already filled in — from a `?` day
/// on the month's sheet, the person and the day.
interface Prefill {
  readonly employeeId?: string
  readonly date?: string
}

type Tab = "today" | "sheet" | "fixes"

/// One person's month, opened: which month it is the sheet's own question.
interface Opened {
  readonly employeeId: string
  readonly period: string
}

function Attendance({
  scope,
  recording,
  onRecord,
}: {
  scope: StoreScope
  recording: Prefill | null
  onRecord: (prefill: Prefill | null) => void
}) {
  const [tab, setTab] = useState<Tab>("today")
  const [opened, setOpened] = useState<Opened | null>(null)
  const team = useTeam(scope)
  const pendingFixes = useQuery({
    queryKey: hrKeys.corrections(scope.unit_id, true),
    queryFn: ({ signal }) => correctionsAt(scope.unit_id, true, signal),
  })
  const swaps = usePendingSwaps(scope)
  const waiting =
    (pendingFixes.data?.length ?? 0) + (swaps.data?.rows.length ?? 0)

  return (
    <>
      <PeopleTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "today", label: "Today" },
          { value: "sheet", label: "Monthly sheet" },
          { value: "fixes", label: "Fixes & swaps", count: waiting },
        ]}
      />
      {tab === "today" && (
        <Today
          scope={scope}
          team={team.data}
          onOpen={(employeeId) =>
            setOpened({ employeeId, period: isoMonth(new Date()) })
          }
        />
      )}
      {tab === "sheet" && (
        <MonthlySheet
          scope={scope}
          team={team.data}
          onOpen={(employeeId, period) => setOpened({ employeeId, period })}
          onFix={(employeeId, date) => onRecord({ employeeId, date })}
        />
      )}
      {tab === "fixes" && <Fixes scope={scope} team={team.data} />}

      {opened !== null && (
        <PersonMonth
          key={`${opened.employeeId}-${opened.period}`}
          opened={opened}
          team={team.data}
          onClose={() => setOpened(null)}
          onFix={(employeeId, date) => {
            // One sheet at a time: the fix opens where this one was.
            setOpened(null)
            onRecord({ employeeId, date })
          }}
        />
      )}

      {recording !== null && (
        <RecordFix
          key={`${recording.employeeId ?? ""}-${recording.date ?? ""}`}
          prefill={recording}
          team={team.data}
          onClose={() => onRecord(null)}
          onDone={() => {
            onRecord(null)
            setTab("fixes")
          }}
        />
      )}
    </>
  )
}

/// Where a reading came from, said plainly. A reader witnessed it; a phone tap
/// was witnessed by nothing — and a screen that did not say which would be
/// presenting a person's own claim as a measurement.
function sourceWord(sources: readonly string[]): string {
  if (sources.length === 0) return "—"
  return sources
    .map((source) =>
      source === "TERMINAL"
        ? "Reader"
        : source === "EMPLOYEE_APP"
          ? "App"
          : source,
    )
    .join(" + ")
}

/// A rostered day in a line: `Morning 09:00–17:00`, or what the day is.
function shiftWord(
  plan: {
    plan: string
    shift_name: string | null
    starts_at: string | null
    ends_at: string | null
  } | null,
): string {
  if (plan === null) return "Not rostered"
  return plan.plan === "SCHEDULED"
    ? `${plan.shift_name ?? "Shift"} ${plan.starts_at ?? ""}–${plan.ends_at ?? ""}`
    : planWord(plan.plan)
}

// ── today ───────────────────────────────────────────────────────────────────

function Today({
  scope,
  team,
  onOpen,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
  onOpen: (employeeId: string) => void
}) {
  const today = isoDay(new Date())
  const roster = useQuery({
    queryKey: hrKeys.roster(scope.unit_id, today, today),
    queryFn: ({ signal }) => rosterAt(scope.unit_id, today, today, signal),
  })
  const attendance = useQuery({
    queryKey: hrKeys.attendanceToday(scope.unit_id, today),
    queryFn: ({ signal }) => attendanceToday(scope.unit_id, today, signal),
  })

  return centreState(attendance, {
    loading: "Reading today's attendance…",
    what: "today's attendance",
    render: (view) => {
      const connected = view.punch_source_connected
      const derived = new Map(view.days.map((day) => [day.employee_id, day]))
      const planned = roster.data ?? []
      // Everybody rostered, plus anybody who punched without being rostered —
      // a person working off the rota is exactly who the month's close asks
      // about.
      const ids = [
        ...new Set([
          ...planned.map((day) => day.employee_id),
          ...view.days.map((day) => day.employee_id),
        ]),
      ]
      const rows = ids.map((employeeId) => {
        const plan =
          planned.find((day) => day.employee_id === employeeId) ?? null
        const day = derived.get(employeeId) ?? null
        return {
          employeeId,
          plan,
          day,
          status: dayStatus({
            plan: plan?.plan ?? null,
            outcomes: day?.outcomes ?? [],
            arrival: day?.arrival ?? null,
            connected,
          }),
        }
      })
      const count = (label: string) =>
        rows.filter((row) => row.status.label === label).length

      return (
        <>
          {!connected && (
            <Banner tone="info" className="mb-4">
              No check-in source has reported yet. Not assessed.
            </Banner>
          )}
          <StatStrip>
            <Stat
              label="Rostered"
              value={planned.filter((day) => day.plan === "SCHEDULED").length}
            />
            <Stat
              label="Present"
              value={connected ? count("Present") : "—"}
              tone={connected ? "ok" : undefined}
            />
            <Stat
              label="Late"
              value={connected ? count("Late") : "—"}
              tone={connected && count("Late") > 0 ? "warn" : undefined}
            />
            <Stat
              label="Not clocked in"
              value={connected ? count("Not clocked in") : "—"}
              tone={
                connected && count("Not clocked in") > 0 ? "bad" : undefined
              }
            />
            <Stat label="On leave" value={count("On leave")} />
          </StatStrip>

          <PeopleTable
            rows={rows}
            rowKey={(row) => row.employeeId}
            onRowClick={(row) => onOpen(row.employeeId)}
            empty="Nobody is rostered or checked in today."
            card={(row) => {
              const arrival = row.day?.arrival ?? null
              return {
                ...personCard(team, row.employeeId, [shiftWord(row.plan)]),
                // The time they checked in; before that, the time they are
                // due, quieter. A day off has no time to say.
                lead:
                  arrival !== null
                    ? { figure: clockOf(arrival), caption: "checked in" }
                    : row.plan?.plan === "SCHEDULED" &&
                        row.plan.starts_at !== null
                      ? {
                          figure: row.plan.starts_at,
                          caption: "due in",
                          muted: true,
                        }
                      : undefined,
                foot: {
                  info: (
                    <Status tone={row.status.tone}>{row.status.label}</Status>
                  ),
                  action: {
                    label: "Open",
                    onClick: () => onOpen(row.employeeId),
                  },
                },
              }
            }}
            columns={[
              {
                key: "who",
                header: "Employee",
                cell: (row) => <Person team={team} id={row.employeeId} />,
              },
              {
                key: "shift",
                header: "Shift",
                card: "meta",
                cell: (row) => shiftWord(row.plan),
              },
              {
                key: "in",
                header: "Check-in",
                align: "right",
                cell: (row) => (
                  <span className="font-mono">
                    {clockOf(row.day?.arrival ?? null)}
                  </span>
                ),
              },
              {
                key: "out",
                header: "Check-out",
                align: "right",
                cell: (row) => (
                  <span className="font-mono">
                    {clockOf(row.day?.departure ?? null)}
                  </span>
                ),
              },
              {
                key: "source",
                header: "Source",
                card: "meta",
                cell: (row) => sourceWord(row.day?.punch_sources ?? []),
              },
              {
                // What else the day was — left early, a missing punch, agreed
                // overtime. The headline status is in the next column; these
                // are the codes it does not say.
                key: "also",
                header: "Also",
                card: "meta",
                cell: (row) => {
                  const extra = (row.day?.outcomes ?? []).filter(
                    (code) =>
                      !["ON_TIME", "LATE", "APPROVED_LEAVE"].includes(code),
                  )
                  return extra.length === 0 ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      {extra.map((code) => {
                        const word = outcomeWord(code)
                        return (
                          <Status key={code} tone={word.tone}>
                            {word.label}
                          </Status>
                        )
                      })}
                    </span>
                  )
                },
              },
              {
                key: "status",
                header: "Status",
                card: "status",
                cell: (row) => (
                  <Status tone={row.status.tone}>{row.status.label}</Status>
                ),
              },
            ]}
          />

          {view.underivable.length > 0 && (
            <>
              <Heading count={view.underivable.length}>Not assessed</Heading>
              <Banner tone="warn">
                {view.underivable.map((day) => (
                  <span
                    key={`${day.employee_id}-${day.date}`}
                    className="block"
                  >
                    {personName(team, day.employee_id)}: {day.reason}
                  </span>
                ))}
              </Banner>
            </>
          )}
        </>
      )
    },
  })
}

// ── the month's sheet ───────────────────────────────────────────────────────

/// One day, as the prototype's attendance sheet draws it: a letter in a tinted
/// box on a desk, the same day in words (and the tone's dot) in a person's
/// month on a phone.
function letter(
  day: AttendanceDayView | undefined,
  connected: boolean,
): { code: string; tone: string; title: string; dot: Tone } {
  if (day === undefined) {
    return {
      code: "",
      tone: "text-faint",
      title: "Not planned",
      dot: "neutral",
    }
  }
  if (day.plan === "REST_DAY") {
    return {
      code: "L",
      tone: "bg-soft-2 text-body",
      title: "Day off",
      dot: "neutral",
    }
  }
  if (day.plan === "PUBLIC_HOLIDAY") {
    return {
      code: "N",
      tone: "bg-warn-bg text-warn-fg",
      title: "Public holiday",
      dot: "neutral",
    }
  }
  if (day.outcomes.includes("APPROVED_LEAVE")) {
    return {
      code: "C",
      tone: "bg-info-bg text-info-fg",
      title: "On leave",
      dot: "info",
    }
  }
  if (day.arrival !== null) {
    return day.outcomes.includes("LATE")
      ? {
          code: "T",
          tone: "bg-warn-bg text-warn-fg",
          title: `Late by ${day.late_minutes} min`,
          dot: "warn",
        }
      : {
          code: "H",
          tone: "bg-ok-bg text-ok-fg",
          title: "Present",
          dot: "ok",
        }
  }
  if (!connected) {
    return {
      code: "·",
      tone: "text-mute",
      title: "Not assessed",
      dot: "neutral",
    }
  }
  if (day.outcomes.includes("ABSENT")) {
    return {
      code: "A",
      tone: "bg-bad-bg text-bad-fg",
      title: "Absent",
      dot: "bad",
    }
  }
  return {
    code: "?",
    tone: "bg-bad-bg text-bad-fg",
    title: "Not recorded",
    dot: "bad",
  }
}

/// What a person's days add up to. `unrecorded` is `null` — not zero — while no
/// punch source has reported: a zero would say somebody looked.
function tally(days: readonly AttendanceDayView[], connected: boolean) {
  const rostered = days.filter((day) => day.plan === "SCHEDULED")
  return {
    rostered: rostered.length,
    present: rostered.filter((day) => day.arrival !== null).length,
    late: rostered.filter((day) => day.outcomes.includes("LATE")).length,
    unrecorded: connected
      ? rostered.filter(
          (day) =>
            day.arrival === null && !day.outcomes.includes("APPROVED_LEAVE"),
        ).length
      : null,
  }
}

const MONTHS = [
  { value: "this", label: "This month" },
  { value: "last", label: "Last month" },
] as const

type Which = (typeof MONTHS)[number]["value"]

function periodOf(which: Which): string {
  const now = new Date()
  return which === "this"
    ? isoMonth(now)
    : isoMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1))
}

/// The days a month's sheet reads: up to today, not the month's end — a day
/// that has not happened yet has no attendance, and asking for it only fills
/// the sheet with blanks.
function monthWindow(period: string): { from: string; to: string } {
  const { from, to: monthEnd } = monthBounds(period)
  const today = isoDay(new Date())
  return { from, to: monthEnd < today ? monthEnd : today }
}

function MonthlySheet({
  scope,
  team,
  onOpen,
  onFix,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
  onOpen: (employeeId: string, period: string) => void
  onFix: (employeeId: string, date: string) => void
}) {
  const phone = useLayout() === "phone"
  const [which, setWhich] = useState<Which>("this")
  const period = periodOf(which)
  const { from, to } = monthWindow(period)
  const dates: string[] = []
  for (
    let day = new Date(`${from}T00:00:00`);
    isoDay(day) <= to;
    day.setDate(day.getDate() + 1)
  ) {
    dates.push(isoDay(day))
  }

  const people = (team?.rows ?? []).filter(
    (person) => person.status === "ACTIVE",
  )
  // One read per person — the route is per person, and a shop is a dozen.
  const reads = useQueries({
    queries: people.map((person) => ({
      queryKey: hrKeys.attendanceOf(person.employee_id, from, to),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        attendanceOf(person.employee_id, from, to, signal),
    })),
  })
  const refused = reads.find((read) => read.isError)
  const connected = reads.some(
    (read) => read.data?.punch_source_connected === true,
  )

  return (
    <>
      {/* The month, a row of the ⚙ sheet on a phone and a switch on a desk. */}
      <DockTools
        views={[
          {
            title: "Month",
            value: which,
            options: MONTHS,
            onChange: (next) => setWhich(next as Which),
          },
        ]}
      />
      <div className="mb-4 max-md:hidden md:max-w-[20rem]">
        <Segmented options={MONTHS} value={which} onChange={setWhich} />
      </div>
      <Heading>{readMonth(period)}</Heading>

      {refused !== undefined && (
        <RefusedBanner error={refused.error} what="this month's attendance" />
      )}

      {people.length === 0 ? (
        <EmptyState>Nobody is posted to {scope.label}.</EmptyState>
      ) : phone ? (
        <CardList>
          {people.map((person, index) => {
            const read = reads[index]
            const sums = tally(read?.data?.days ?? [], connected)
            const state: { word: string; tone: Tone } = read?.isPending
              ? { word: "Reading…", tone: "neutral" }
              : !connected
                ? { word: "Not assessed", tone: "neutral" }
                : (sums.unrecorded ?? 0) > 0
                  ? { word: `${sums.unrecorded} unrecorded`, tone: "bad" }
                  : sums.late > 0
                    ? { word: `${sums.late} late`, tone: "warn" }
                    : sums.rostered === 0
                      ? { word: "Not rostered", tone: "neutral" }
                      : { word: "No issues", tone: "ok" }
            return (
              <LeadCard
                key={person.employee_id}
                {...personCard(team, person.employee_id)}
                lead={{
                  figure: read?.isPending
                    ? "…"
                    : connected
                      ? sums.present
                      : "—",
                  caption: `of ${sums.rostered} rostered`,
                  muted: !connected,
                }}
                foot={{
                  info: <Status tone={state.tone}>{state.word}</Status>,
                  action: {
                    label: "Open",
                    onClick: () => onOpen(person.employee_id, period),
                  },
                }}
                onOpen={() => onOpen(person.employee_id, period)}
              />
            )
          })}
        </CardList>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="border-collapse text-cell">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 h-10 min-w-[9rem] border-b border-hairline bg-soft px-3 text-left text-eyebrow font-medium text-body">
                    Employee
                  </th>
                  {dates.map((date) => (
                    <th
                      key={date}
                      className="h-10 min-w-7 border-b border-hairline bg-soft px-0.5 text-center text-[0.875rem] font-medium text-body tabular-nums"
                    >
                      {dateText(new Date(`${date}T00:00:00`), {
                        weekday: "narrow",
                      })}
                      <br />
                      {Number(date.slice(8))}
                    </th>
                  ))}
                  {["Rostered", "Present", "Late", "Unrecorded"].map(
                    (label) => (
                      <th
                        key={label}
                        className="h-10 border-b border-hairline bg-soft px-2.5 text-right text-eyebrow font-medium whitespace-nowrap text-body"
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {people.map((person, index) => {
                  const read = reads[index]
                  const days = new Map(
                    (read?.data?.days ?? []).map((day) => [day.date, day]),
                  )
                  const sums = tally(read?.data?.days ?? [], connected)
                  const name = person.full_name ?? person.employee_code
                  return (
                    <tr
                      key={person.employee_id}
                      className="border-b border-hairline last:border-b-0"
                    >
                      <th className="sticky left-0 z-10 max-w-[11rem] truncate bg-canvas px-3 py-1.5 text-left text-cell font-medium text-ink">
                        <button
                          type="button"
                          onClick={() => onOpen(person.employee_id, period)}
                          className="max-w-full truncate text-left hover:underline"
                        >
                          {name}
                        </button>
                      </th>
                      {dates.map((date) => {
                        const cell = letter(days.get(date), connected)
                        const fixable = cell.code === "?"
                        return (
                          <td key={date} className="px-0.5 py-1.5 text-center">
                            {fixable ? (
                              <button
                                type="button"
                                title={cell.title}
                                aria-label={`${name}, ${readDate(date)}: not recorded`}
                                onClick={() => onFix(person.employee_id, date)}
                                className={cn(
                                  "inline-grid size-6 place-items-center rounded-md text-[0.875rem] font-semibold pointer-coarse:size-9",
                                  cell.tone,
                                )}
                              >
                                ?
                              </button>
                            ) : (
                              <span
                                title={cell.title}
                                className={cn(
                                  "inline-grid size-6 place-items-center rounded-md text-[0.875rem] font-semibold",
                                  cell.tone,
                                )}
                              >
                                {read?.isPending ? "" : cell.code}
                              </span>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-2.5 text-right text-meta tabular-nums">
                        {sums.rostered}
                      </td>
                      <td className="px-2.5 text-right text-meta tabular-nums">
                        {connected ? sums.present : "—"}
                      </td>
                      <td className="px-2.5 text-right text-meta tabular-nums">
                        {connected ? sums.late : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-2.5 text-right text-meta tabular-nums",
                          sums.unrecorded !== null &&
                            sums.unrecorded > 0 &&
                            "font-semibold text-bad-fg",
                        )}
                      >
                        {sums.unrecorded ?? "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* The key to the letters — a desk's grid is read in them. */}
      {!phone && people.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-body">
          {[
            ["H", "Present", "bg-ok-bg text-ok-fg"],
            ["T", "Late", "bg-warn-bg text-warn-fg"],
            ["C", "Leave", "bg-info-bg text-info-fg"],
            ["A", "Absent", "bg-bad-bg text-bad-fg"],
            ["?", "Not recorded", "bg-bad-bg text-bad-fg"],
            ["L", "Day off", "bg-soft-2 text-body"],
            ["N", "Public holiday", "bg-warn-bg text-warn-fg"],
            ["·", "Not assessed", "text-mute"],
          ].map(([code, label, tone]) => (
            <span key={code} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-grid size-6 place-items-center rounded-md text-[0.875rem] font-semibold",
                  tone,
                )}
              >
                {code}
              </span>
              {label}
            </span>
          ))}
        </div>
      )}
    </>
  )
}

/// One person's month, day by day — the phone's answer to the thirty-column
/// grid, and the desk's too when somebody's name is pressed. Newest day first;
/// a day nothing was recorded on has the way to record it right on it.
function PersonMonth({
  opened,
  team,
  onClose,
  onFix,
}: {
  opened: Opened
  team: EmployeeList | undefined
  onClose: () => void
  onFix: (employeeId: string, date: string) => void
}) {
  const { from, to } = monthWindow(opened.period)
  const read = useQuery({
    queryKey: hrKeys.attendanceOf(opened.employeeId, from, to),
    queryFn: ({ signal }) => attendanceOf(opened.employeeId, from, to, signal),
  })
  const person = team?.rows.find((one) => one.employee_id === opened.employeeId)
  const dates: string[] = []
  for (
    let day = new Date(`${to}T00:00:00`);
    isoDay(day) >= from;
    day.setDate(day.getDate() - 1)
  ) {
    dates.push(isoDay(day))
  }
  const connected = read.data?.punch_source_connected === true
  const days = new Map((read.data?.days ?? []).map((day) => [day.date, day]))
  const sums = tally(read.data?.days ?? [], connected)

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={person?.full_name ? person.employee_code : undefined}
      crumb="Attendance"
      title={personName(team, opened.employeeId)}
      sub={readMonth(opened.period)}
      status={
        (sums.unrecorded ?? 0) > 0 ? (
          <Pill tone="bad">{sums.unrecorded} unrecorded</Pill>
        ) : undefined
      }
    >
      {centreState(read, {
        loading: "Reading the month…",
        what: "this person's attendance",
        render: () => (
          <>
            <Facts
              rows={[
                ["Rostered", `${sums.rostered} days`],
                ["Present", connected ? `${sums.present} days` : "—"],
                ["Late", connected ? `${sums.late} days` : "—"],
                [
                  "Unrecorded",
                  sums.unrecorded === null ? "—" : `${sums.unrecorded} days`,
                ],
              ]}
            />
            <SheetSection title="Days" className="mt-6">
              <ul>
                {dates.map((date) => {
                  const day = days.get(date)
                  const cell = letter(day, connected)
                  const times = day?.arrival
                    ? `${clockOf(day.arrival)}–${clockOf(day.departure)}`
                    : null
                  return (
                    <li
                      key={date}
                      className="flex min-h-14 items-center gap-3 border-b border-hairline py-2 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-cell text-ink">
                          {readDate(date, true)}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 text-[0.875rem] text-mute">
                          <Status tone={cell.dot}>{cell.title}</Status>
                          {times !== null && <span>{times}</span>}
                        </div>
                      </div>
                      {cell.code === "?" && (
                        <Button
                          variant="tint"
                          size="card"
                          onClick={() => onFix(opened.employeeId, date)}
                        >
                          New fix
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </SheetSection>
          </>
        ),
      })}
    </PeopleSheet>
  )
}

// ── fixes ───────────────────────────────────────────────────────────────────

/// What a correction claims, in words.
function effectWord(fix: CorrectionRow): string {
  switch (fix.effect) {
    case "ARRIVAL":
      return `Arrived ${clockOf(fix.corrected_arrival)}`
    case "DEPARTURE":
      return `Left ${clockOf(fix.corrected_departure)}`
    case "ARRIVAL_AND_DEPARTURE":
      return `${clockOf(fix.corrected_arrival)}–${clockOf(fix.corrected_departure)}`
    case "APPROVED_LEAVE":
      return "Was on approved leave"
    default:
      return fix.effect
  }
}

function Fixes({
  scope,
  team,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
}) {
  const history = useQuery({
    queryKey: hrKeys.corrections(scope.unit_id, false),
    queryFn: ({ signal }) => correctionsAt(scope.unit_id, false, signal),
  })
  const [open, setOpen] = useState<CorrectionRow | null>(null)

  return (
    <>
      <Heading
        count={history.data?.filter((fix) => fix.state === "PENDING").length}
      >
        Attendance fixes
      </Heading>
      {centreState(history, {
        loading: "Reading the attendance fixes…",
        what: "this shop's attendance fixes",
        render: (rows) => (
          <PeopleTable
            rows={[...rows].sort((left, right) =>
              left.state === right.state
                ? right.requested_at.localeCompare(left.requested_at)
                : left.state === "PENDING"
                  ? -1
                  : right.state === "PENDING"
                    ? 1
                    : 0,
            )}
            rowKey={(fix) => fix.id}
            onRowClick={setOpen}
            empty="No attendance fixes."
            card={(fix) => {
              const state = requestState(fix.state)
              const known = team?.rows.some(
                (person) => person.employee_id === fix.employee_id,
              )
              const head = personCard(team, fix.employee_id, [effectWord(fix)])
              return {
                ...head,
                // Somebody not on this shop's list any more keeps the name the
                // fix was filed under, not their id.
                title: known
                  ? head.title
                  : fix.display_name || fix.employee_code,
                lead: dateLead(fix.business_date),
                foot: {
                  info: <Status tone={state.tone}>{state.label}</Status>,
                  action: {
                    label: fix.state === "PENDING" ? "Review" : "Open",
                    onClick: () => setOpen(fix),
                  },
                },
              }
            }}
            columns={[
              {
                key: "who",
                header: "Employee",
                cell: (fix) => (
                  <Person
                    team={team}
                    id={fix.employee_id}
                    sub={fix.employee_code}
                  />
                ),
              },
              {
                key: "day",
                header: "Day",
                card: "meta",
                cell: (fix) => readDate(fix.business_date, true),
              },
              {
                key: "what",
                header: "Fix",
                card: "meta",
                cell: (fix) => effectWord(fix),
              },
              {
                key: "why",
                header: "Reason",
                card: "meta",
                className: "whitespace-normal",
                cell: (fix) => fix.reason,
              },
              {
                key: "state",
                header: "Status",
                card: "status",
                cell: (fix) => {
                  const state = requestState(fix.state)
                  return <Status tone={state.tone}>{state.label}</Status>
                },
              },
            ]}
          />
        ),
      })}

      <Heading>Shift swaps</Heading>
      <SwapList scope={scope} team={team} />

      {open !== null && (
        <FixSheet
          key={open.id}
          fix={open}
          team={team}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}

/// One fix, and the store head's decision on it.
function FixSheet({
  fix,
  team,
  onClose,
}: {
  fix: CorrectionRow
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const decide = useMutation({
    mutationFn: (input: { approve: boolean; reason: string }) =>
      decideCorrection({ id: fix.id, ...input }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.attendance() })
      client.invalidateQueries({
        queryKey: hrKeys.period(fix.unit_id, fix.business_date.slice(0, 7)),
      })
      onClose()
    },
  })
  const state = requestState(fix.state)
  const waiting = fix.state === "PENDING"
  const decision = useDecision({
    placeholder: "Reader was down that morning",
    pending: decide.isPending,
    error: decide.error,
    onDecide: (approve, reason) => decide.mutate({ approve, reason }),
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={fix.employee_code}
      crumb="Attendance fix"
      title={fix.display_name || personName(team, fix.employee_id)}
      sub={`${effectWord(fix)} · ${readDate(fix.business_date, true)}`}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
      foot={waiting ? decision.footer : undefined}
    >
      <SheetSection title="The ask">
        <Facts
          rows={[
            ["Day", readDate(fix.business_date, true)],
            ["Fix", effectWord(fix)],
            ["Because", fix.reason, true],
            [
              "Asked by",
              `${personByLogin(team, fix.requested_by)} · ${moment(fix.requested_at)}`,
            ],
            waiting && ["Waiting on", "Store head"],
            fix.supersedes !== null && [
              "Replaces",
              "An earlier fix of the same day",
            ],
          ]}
        />
      </SheetSection>
      {fix.decided_by !== null && (
        <SheetSection title="Decision">
          <Facts
            rows={[
              [
                "By",
                `${personByLogin(team, fix.decided_by)} · ${moment(fix.decided_at)}`,
              ],
              ["Why", fix.decision_reason ?? "—", true],
            ]}
          />
        </SheetSection>
      )}
      {waiting && decision.field}
    </PeopleSheet>
  )
}

/// New attendance fix — the prototype's *Catat perbaikan*. Filed by the shop,
/// decided by the store head (and never by the same person who filed it).
function RecordFix({
  prefill,
  team,
  onClose,
  onDone,
}: {
  prefill: Prefill
  team: EmployeeList | undefined
  onClose: () => void
  onDone: () => void
}) {
  const client = useQueryClient()
  const [employeeId, setEmployeeId] = useState(prefill.employeeId ?? "")
  const [date, setDate] = useState(prefill.date ?? isoDay(new Date()))
  const [effect, setEffect] = useState<CorrectionEffect>(
    prefill.date === undefined ? "ARRIVAL" : "ARRIVAL_AND_DEPARTURE",
  )
  const [arrival, setArrival] = useState("09:00")
  const [departure, setDeparture] = useState("17:00")
  const [reason, setReason] = useState("")

  const file = useMutation({
    mutationFn: () =>
      fileCorrection({
        employeeId,
        businessDate: date,
        effect,
        arrival: effect === "DEPARTURE" ? undefined : arrival,
        departure: effect === "ARRIVAL" ? undefined : departure,
        reason,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.attendance() })
      onDone()
    },
  })

  // Only the active ones: a fix for somebody who has left would be refused.
  const people = teamRows(team).filter((person) => person.status === "ACTIVE")

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Attendance"
      title="New attendance fix"
      foot={
        <Submit
          label="Submit"
          pendingLabel="Submitting…"
          pending={file.isPending}
          disabled={employeeId === "" || date === "" || reason.trim() === ""}
          error={file.error}
          onSubmit={() => file.mutate()}
          onCancel={onClose}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Employee" required>
          <Select value={employeeId} onChange={setEmployeeId}>
            <option value="">Choose a person…</option>
            {people.map((person) => (
              <option key={person.employee_id} value={person.employee_id}>
                {person.full_name ?? person.employee_code}
                {person.position === null ? "" : ` · ${person.position}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Day" required>
          <Input
            type="date"
            value={date}
            max={isoDay(new Date())}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <Field label="What was missed" required>
          <Select
            value={effect}
            onChange={(value) => setEffect(value as CorrectionEffect)}
          >
            <option value="ARRIVAL">The check-in</option>
            <option value="DEPARTURE">The check-out</option>
            <option value="ARRIVAL_AND_DEPARTURE">Both</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {effect !== "DEPARTURE" && (
            <Field label="Arrived at" required>
              <Input
                type="time"
                value={arrival}
                onChange={(event) => setArrival(event.target.value)}
              />
            </Field>
          )}
          {effect !== "ARRIVAL" && (
            <Field label="Left at" required>
              <Input
                type="time"
                value={departure}
                onChange={(event) => setDeparture(event.target.value)}
              />
            </Field>
          )}
        </div>
        <Field label="Reason" required>
          <Input
            value={reason}
            placeholder="The reader was down this morning"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </PeopleSheet>
  )
}
