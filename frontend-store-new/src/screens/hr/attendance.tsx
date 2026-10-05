import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner } from "@/components/ui/states"
import { moment } from "@/lib/format"
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
import { RefusedBanner } from "@/screens/hr/refused"
import {
  Decision,
  Facts,
  Heading,
  Person,
  PersonPicker,
  Submit,
} from "@/screens/hr/parts"
import {
  dayStatus,
  outcomeWord,
  personName,
  requestState,
  useTeam,
  usePendingSwaps,
} from "@/screens/hr/words"
import { SwapList } from "@/screens/hr/swaps"
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
export function HrAttendance() {
  const [recording, setRecording] = useState<Prefill | null>(null)
  return (
    <HrWorkspace
      actions={
        <Button variant="primary" onClick={() => setRecording({})}>
          <Plus />
          Record a fix
        </Button>
      }
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

/// What a "Record a fix" sheet opens already filled in — from a `?` cell on the
/// month's sheet, the person and the day.
interface Prefill {
  readonly employeeId?: string
  readonly date?: string
}

type Tab = "today" | "sheet" | "fixes"

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
      {tab === "today" && <Today scope={scope} team={team.data} />}
      {tab === "sheet" && (
        <Sheet
          scope={scope}
          team={team.data}
          onFix={(employeeId, date) => onRecord({ employeeId, date })}
        />
      )}
      {tab === "fixes" && <Fixes scope={scope} team={team.data} />}

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

// ── today ───────────────────────────────────────────────────────────────────

function Today({
  scope,
  team,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
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
    loading: "Loading…",
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
            empty="Nobody rostered or checked in today."
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
                cell: (row) =>
                  row.plan === null
                    ? "Not rostered"
                    : row.plan.plan === "SCHEDULED"
                      ? `${row.plan.shift_name ?? "Shift"} ${row.plan.starts_at ?? ""}–${row.plan.ends_at ?? ""}`
                      : planWord(row.plan.plan),
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
                    <span className="flex flex-wrap gap-1">
                      {extra.map((code) => {
                        const word = outcomeWord(code)
                        return (
                          <Pill key={code} tone={word.tone}>
                            {word.label}
                          </Pill>
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
                  <Pill tone={row.status.tone}>{row.status.label}</Pill>
                ),
              },
            ]}
          />

          {view.underivable.length > 0 && (
            <>
              <Heading count={view.underivable.length}>
                Not assessed
              </Heading>
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

/// One letter per day, the prototype's attendance sheet legend.
function letter(
  day: AttendanceDayView | undefined,
  connected: boolean,
): { code: string; tone: string; title: string } {
  if (day === undefined) {
    return { code: "", tone: "text-faint", title: "Not planned" }
  }
  if (day.plan === "REST_DAY")
    return { code: "L", tone: "bg-soft-2 text-body", title: "Day off" }
  if (day.plan === "PUBLIC_HOLIDAY") {
    return {
      code: "N",
      tone: "bg-warn-bg text-warn-fg",
      title: "Public holiday",
    }
  }
  if (day.outcomes.includes("APPROVED_LEAVE")) {
    return { code: "C", tone: "bg-info-bg text-info-fg", title: "On leave" }
  }
  if (day.arrival !== null) {
    return day.outcomes.includes("LATE")
      ? {
          code: "T",
          tone: "bg-warn-bg text-warn-fg",
          title: `Late by ${day.late_minutes} min`,
        }
      : { code: "H", tone: "bg-ok-bg text-ok-fg", title: "Present" }
  }
  if (!connected) return { code: "·", tone: "text-mute", title: "Not assessed" }
  if (day.outcomes.includes("ABSENT")) {
    return { code: "A", tone: "bg-bad-bg text-bad-fg", title: "Absent" }
  }
  return {
    code: "?",
    tone: "bg-bad-bg text-bad-fg",
    title: "Not recorded",
  }
}

const MONTHS = [
  { value: "this", label: "This month" },
  { value: "last", label: "Last month" },
] as const

function Sheet({
  scope,
  team,
  onFix,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
  onFix: (employeeId: string, date: string) => void
}) {
  const [which, setWhich] = useState<(typeof MONTHS)[number]["value"]>("this")
  const now = new Date()
  const period =
    which === "this"
      ? isoMonth(now)
      : isoMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const { from, to: monthEnd } = monthBounds(period)
  // Up to today, not the month's end: a day that has not happened yet has no
  // attendance, and asking for it only fills the sheet with blanks.
  const today = isoDay(now)
  const to = monthEnd < today ? monthEnd : today
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
      <div className="mb-4 md:max-w-[20rem]">
        <Segmented options={MONTHS} value={which} onChange={setWhich} />
      </div>
      <Heading>{readMonth(period)}</Heading>

      {refused !== undefined && (
        <RefusedBanner error={refused.error} what="this month's attendance" />
      )}

      {people.length === 0 ? (
        <Banner tone="info">Nobody is posted to {scope.label}.</Banner>
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
                      className="h-10 min-w-7 border-b border-hairline bg-soft px-0.5 text-center text-[0.6875rem] font-medium text-body tabular-nums"
                    >
                      {new Date(`${date}T00:00:00`).toLocaleDateString(
                        "id-ID",
                        { weekday: "narrow" },
                      )}
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
                  const all = read?.data?.days ?? []
                  const rostered = all.filter((day) => day.plan === "SCHEDULED")
                  const present = rostered.filter(
                    (day) => day.arrival !== null,
                  ).length
                  const late = rostered.filter((day) =>
                    day.outcomes.includes("LATE"),
                  ).length
                  const unrecorded = connected
                    ? rostered.filter(
                        (day) =>
                          day.arrival === null &&
                          !day.outcomes.includes("APPROVED_LEAVE"),
                      ).length
                    : null
                  return (
                    <tr
                      key={person.employee_id}
                      className="border-b border-hairline last:border-b-0"
                    >
                      <th className="sticky left-0 z-10 max-w-[11rem] truncate bg-canvas px-3 py-1.5 text-left text-cell font-medium text-ink">
                        {person.full_name ?? person.employee_code}
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
                                aria-label={`${person.full_name ?? person.employee_code}, ${readDate(date)}: not recorded`}
                                onClick={() => onFix(person.employee_id, date)}
                                className={cn(
                                  "inline-grid size-6 place-items-center rounded-md text-[0.6875rem] font-semibold pointer-coarse:size-9",
                                  cell.tone,
                                )}
                              >
                                ?
                              </button>
                            ) : (
                              <span
                                title={cell.title}
                                className={cn(
                                  "inline-grid size-6 place-items-center rounded-md text-[0.6875rem] font-semibold",
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
                        {rostered.length}
                      </td>
                      <td className="px-2.5 text-right text-meta tabular-nums">
                        {connected ? present : "—"}
                      </td>
                      <td className="px-2.5 text-right text-meta tabular-nums">
                        {connected ? late : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-2.5 text-right text-meta tabular-nums",
                          unrecorded !== null &&
                            unrecorded > 0 &&
                            "font-semibold text-bad-fg",
                        )}
                      >
                        {unrecorded ?? "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

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
                "inline-grid size-5 place-items-center rounded-md text-[0.625rem] font-semibold",
                tone,
              )}
            >
              {code}
            </span>
            {label}
          </span>
        ))}
      </div>
    </>
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
        loading: "Loading…",
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
            empty="No fixes requested."
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
                  return <Pill tone={state.tone}>{state.label}</Pill>
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

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Attendance fix"
      title={fix.display_name || personName(team, fix.employee_id)}
      sub={`${effectWord(fix)} · ${readDate(fix.business_date, true)}`}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
      foot={
        fix.state === "PENDING" ? (
          <Decision
            placeholder="Reader was down that morning"
            pending={decide.isPending}
            error={decide.error}
            onDecide={(approve, reason) => decide.mutate({ approve, reason })}
          />
        ) : undefined
      }
    >
      <SheetSection title="The ask">
        <Facts
          rows={[
            ["Day", readDate(fix.business_date, true)],
            ["Fix", effectWord(fix)],
            ["Because", fix.reason],
            ["Asked by", `${fix.requested_by} · ${moment(fix.requested_at)}`],
            fix.supersedes !== null && [
              "Replaces",
              "an earlier fix of the same day",
            ],
          ]}
        />
      </SheetSection>
      {fix.decided_by !== null && (
        <SheetSection title="Decision">
          <Facts
            rows={[
              ["By", `${fix.decided_by} · ${moment(fix.decided_at)}`],
              ["Why", fix.decision_reason ?? "—"],
            ]}
          />
        </SheetSection>
      )}
    </PeopleSheet>
  )
}

/// Record a fix — the prototype's *Catat perbaikan*. Filed by the shop, decided
/// by the store head (and never by the same person who filed it).
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

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Attendance"
      title="Record a fix"
      foot={
        <Submit
          label="Send to the store head"
          pending={file.isPending}
          disabled={employeeId === "" || date === "" || reason.trim() === ""}
          error={file.error}
          onSubmit={() => file.mutate()}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <PersonPicker
          team={team}
          value={employeeId}
          onChange={setEmployeeId}
          label="Employee"
        />
        <Field label="Day">
          <Input
            type="date"
            value={date}
            max={isoDay(new Date())}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <Field label="What was missed">
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
            <Field label="Arrived at">
              <Input
                type="time"
                value={arrival}
                onChange={(event) => setArrival(event.target.value)}
              />
            </Field>
          )}
          {effect !== "ARRIVAL" && (
            <Field label="Left at">
              <Input
                type="time"
                value={departure}
                onChange={(event) => setDeparture(event.target.value)}
              />
            </Field>
          )}
        </div>
        <Field label="Reason">
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
