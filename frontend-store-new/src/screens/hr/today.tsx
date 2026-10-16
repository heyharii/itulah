import { useQuery } from "@tanstack/react-query"

import { PeopleTable } from "@/components/ui/people-table"
import { Status } from "@/components/ui/pill"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { LoadingState } from "@/components/ui/states"
import { useGo } from "@/lib/go"
import {
  applicantsQuery,
  attendanceTodayQuery,
  claimsQuery,
  clockOf,
  correctionsQuery,
  isoDay,
  monthBefore,
  pendingLeaveQuery,
  pendingSwapsQuery,
  periodQuery,
  planWord,
  readDate,
  readMonth,
  rosterQuery,
  storeTasksQuery,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { dateLead, Heading, Person, personCard } from "@/screens/hr/parts"
import { dayStatus, useTeam, type Tone } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"

/// Today, at this shop — the prototype's store Overview (`pageOverview`, role
/// `s`): who is on, who is in, what is pending with the store head, and what
/// needs somebody's attention.
///
/// # What is pending, and with whom
///
/// The queue is the prototype's *Menunggu kepala toko*: the leave, the
/// attendance fixes, the swaps and the claims a store head decides. Overtime
/// is not in it — an order waits on the *worker's* answer, not the manager's,
/// and PP 35/2021 keeps those two acts apart — so it is counted on the
/// Overtime screen instead of here.
///
/// # "Not clocked in" is only said when something could have seen them
///
/// Every presence figure below is read off the centre's derived day, and the
/// centre says whether any punch source has ever reported for this shop. When
/// none has, the figures read "not assessed" rather than zero, because a zero
/// would be a claim that somebody looked.
///
/// # The phone
///
/// A dashboard: the figures stay, and each of the three lists under them —
/// Pending, Today, Needs attention — is a stack of lead cards (the person, the
/// one date or time that matters, a status and a word to open it). A card is
/// the way to the screen where the thing is dealt with.
export function HrToday() {
  return <HrWorkspace>{(scope) => <Today scope={scope} />}</HrWorkspace>
}

/// One row of the store head's queue.
interface Waiting {
  readonly key: string
  readonly kind: string
  readonly employeeId: string
  /// What it is, without the day: the card's line.
  readonly what: string
  /// The day it is about: the card's one figure.
  readonly date: string
  readonly to: string
}

/// One thing that needs somebody, and where it is dealt with.
interface Exception {
  readonly key: string
  readonly kind: string
  readonly employeeId: string | null
  readonly text: string
  readonly tone: Tone
  readonly to: string
}

function Today({ scope }: { scope: StoreScope }) {
  const go = useGo()
  const today = isoDay(new Date())
  const now = new Date()
  const lastMonth = monthBefore(now)

  const team = useTeam(scope)
  const roster = useQuery(rosterQuery(scope.unit_id, today, today))
  const attendance = useQuery(attendanceTodayQuery(scope.unit_id, today))
  const leave = useQuery(pendingLeaveQuery(scope.unit_id))
  const corrections = useQuery(correctionsQuery(scope.unit_id, true))
  const swaps = useQuery(pendingSwapsQuery(scope.unit_id))
  const claims = useQuery(claimsQuery(scope.unit_id))
  const period = useQuery(periodQuery(scope.unit_id, lastMonth))
  const applicants = useQuery(applicantsQuery(scope.unit_id))
  const tasks = useQuery(storeTasksQuery())

  // ── the store head's queue ────────────────────────────────────────────────
  const waiting: Waiting[] = [
    ...(leave.data?.rows ?? []).map((request) => ({
      key: `leave-${request.id}`,
      kind: "Leave",
      employeeId: request.employee_id,
      what: `${request.leave_type_name} · ${request.chargeable_days} day${request.chargeable_days === 1 ? "" : "s"}${request.to_date === request.from_date ? "" : ` · until ${readDate(request.to_date)}`}`,
      date: request.from_date,
      to: "/hr/leave",
    })),
    ...(corrections.data ?? []).map((fix) => ({
      key: `fix-${fix.id}`,
      kind: "Attendance fix",
      employeeId: fix.employee_id,
      what: fix.reason,
      date: fix.business_date,
      to: "/hr/attendance",
    })),
    ...(swaps.data?.rows ?? []).map((swap) => ({
      key: `swap-${swap.id}`,
      kind: "Shift swap",
      employeeId: swap.employee_id,
      what: swap.reason,
      date: swap.on_date,
      to: "/hr/roster",
    })),
    ...(claims.data ?? [])
      .filter((claim) => claim.state === "SUBMITTED")
      .map((claim) => ({
        key: `claim-${claim.claim_id}`,
        kind: "Claim",
        employeeId: claim.employee_id,
        what: `${claim.claim_number} · ${claim.lines.map((line) => line.description).join(", ")}`,
        date: claim.posted_on,
        to: "/hr/expenses",
      })),
  ]
  const reading = [leave, corrections, swaps, claims].some(
    (query) => query.isPending,
  )

  // ── who is in ─────────────────────────────────────────────────────────────
  const connected = attendance.data?.punch_source_connected ?? false
  const scheduled = (roster.data ?? []).filter(
    (day) => day.plan === "SCHEDULED",
  )
  const derived = attendance.data?.days ?? []
  const present = derived.filter((day) => day.arrival !== null).length
  const missing = scheduled.filter((day) => {
    const seen = derived.find((one) => one.employee_id === day.employee_id)
    return (
      seen === undefined ||
      (seen.arrival === null && !seen.outcomes.includes("APPROVED_LEAVE"))
    )
  }).length
  const active = (team.data?.rows ?? []).filter(
    (person) => person.status === "ACTIVE",
  )

  // ── what needs somebody ───────────────────────────────────────────────────
  const exceptions: Exception[] = []
  for (const person of active) {
    if (person.contract_ends_on !== null) {
      const left = Math.round(
        (new Date(`${person.contract_ends_on}T00:00:00`).getTime() -
          new Date(`${today}T00:00:00`).getTime()) /
          86_400_000,
      )
      if (left <= 45) {
        exceptions.push({
          key: `contract-${person.employee_id}`,
          kind: "Contract",
          employeeId: person.employee_id,
          text:
            left < 0
              ? `Contract ended ${readDate(person.contract_ends_on)}`
              : `Contract ends ${readDate(person.contract_ends_on)} · ${left} days`,
          tone: left <= 14 ? "bad" : "warn",
          to: "/hr/changes",
        })
      }
    }
    if (person.username === null) {
      exceptions.push({
        key: `login-${person.employee_id}`,
        kind: "Access",
        employeeId: person.employee_id,
        text: "No login issued",
        tone: "warn",
        to: "/hr/lifecycle",
      })
    }
  }
  for (const day of attendance.data?.underivable ?? []) {
    exceptions.push({
      key: `underivable-${day.employee_id}-${day.date}`,
      kind: "Attendance",
      employeeId: day.employee_id,
      text: `Not assessed: ${day.reason}`,
      tone: "warn",
      to: "/hr/attendance",
    })
  }
  const openTasks = (tasks.data ?? []).filter(
    (task) => task.owner === "STORE" && task.state === "PENDING",
  )
  if (openTasks.length > 0) {
    exceptions.push({
      key: "tasks",
      kind: "Checklist",
      employeeId: null,
      text: `${openTasks.length} checklist task${openTasks.length === 1 ? "" : "s"} open`,
      tone: "warn",
      to: "/hr/lifecycle",
    })
  }
  if (period.data?.status === "OPEN" && period.data.readiness !== null) {
    exceptions.push({
      key: "period",
      kind: "Period close",
      employeeId: null,
      text: `${readMonth(lastMonth)} attendance not closed`,
      tone: "bad",
      to: "/hr/payroll",
    })
  }

  const interviews = (applicants.data?.rows ?? []).filter(
    (row) => row.stage === "INTERVIEW",
  ).length

  const byEmployee = new Map(derived.map((day) => [day.employee_id, day]))

  return (
    <>
      <StatStrip>
        <Stat
          label="Headcount"
          value={team.data === undefined ? "—" : active.length}
        />
        <Stat
          label="Present"
          value={
            attendance.data === undefined ? "—" : connected ? present : "—"
          }
          sub={
            attendance.data !== undefined && !connected
              ? "not assessed"
              : undefined
          }
        />
        <Stat
          label="Not clocked in"
          value={
            attendance.data === undefined || roster.data === undefined
              ? "—"
              : connected
                ? missing
                : "—"
          }
          sub={
            attendance.data !== undefined && !connected
              ? "no punch source yet"
              : undefined
          }
          tone={connected && missing > 0 ? "bad" : undefined}
        />
        <Stat
          label="Pending"
          value={reading ? "—" : waiting.length}
          tone={waiting.length > 0 ? "warn" : undefined}
        />
        <Stat
          label={`Attendance · ${readMonth(lastMonth)}`}
          value={
            period.data === undefined
              ? "—"
              : period.data.status === "CLOSED"
                ? "Closed"
                : "Open"
          }
          tone={
            period.data === undefined
              ? undefined
              : period.data.status === "CLOSED"
                ? "ok"
                : "warn"
          }
        />
        <Stat
          label="Interviews"
          value={applicants.data === undefined ? "—" : interviews}
        />
      </StatStrip>

      <Heading count={reading ? undefined : waiting.length}>Pending</Heading>
      {reading ? (
        <LoadingState>Reading what is pending…</LoadingState>
      ) : (
        <PeopleTable
          rows={waiting}
          rowKey={(row) => row.key}
          onRowClick={(row) => go(row.to)}
          empty="Nothing is pending."
          card={(row) => ({
            ...personCard(team.data, row.employeeId, [
              `${row.kind} · ${row.what}`,
            ]),
            lead: dateLead(row.date),
            foot: {
              info: <Status tone="warn">Pending</Status>,
              action: { label: "Review", onClick: () => go(row.to) },
            },
          })}
          columns={[
            {
              key: "who",
              header: "Employee",
              cell: (row) => <Person team={team.data} id={row.employeeId} />,
            },
            {
              key: "kind",
              header: "Kind",
              card: "meta",
              cell: (row) => row.kind,
            },
            {
              key: "what",
              header: "Request",
              card: "meta",
              className: "whitespace-normal",
              cell: (row) => row.what,
            },
            {
              key: "date",
              header: "Day",
              card: "meta",
              cell: (row) => readDate(row.date, true),
            },
          ]}
        />
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <Heading>Today</Heading>
          {centreState(roster, {
            loading: "Reading today's rota…",
            what: "today's rota",
            render: (days) => (
              <PeopleTable
                rows={days}
                rowKey={(day) => day.employee_id}
                onRowClick={() => go("/hr/attendance")}
                empty="Nobody is rostered today."
                card={(day) => {
                  const seen = byEmployee.get(day.employee_id)
                  const status = dayStatus({
                    plan: day.plan,
                    outcomes: seen?.outcomes ?? [],
                    arrival: seen?.arrival ?? null,
                    connected,
                  })
                  const arrival = seen?.arrival ?? null
                  return {
                    ...personCard(team.data, day.employee_id, [shiftWord(day)]),
                    // The time they checked in; before that, the time they are
                    // due, quieter. A day off has no time to say.
                    lead:
                      arrival !== null
                        ? { figure: clockOf(arrival), caption: "checked in" }
                        : day.plan === "SCHEDULED" && day.starts_at !== null
                          ? {
                              figure: day.starts_at,
                              caption: "due in",
                              muted: true,
                            }
                          : undefined,
                    foot: {
                      info: <Status tone={status.tone}>{status.label}</Status>,
                      action: {
                        label: "Open",
                        onClick: () => go("/hr/attendance"),
                      },
                    },
                  }
                }}
                columns={[
                  {
                    key: "who",
                    header: "Employee",
                    cell: (day) => (
                      <Person team={team.data} id={day.employee_id} />
                    ),
                  },
                  {
                    key: "shift",
                    header: "Shift",
                    card: "meta",
                    cell: (day) => shiftWord(day),
                  },
                  {
                    key: "status",
                    header: "Status",
                    card: "status",
                    cell: (day) => {
                      const seen = byEmployee.get(day.employee_id)
                      const status = dayStatus({
                        plan: day.plan,
                        outcomes: seen?.outcomes ?? [],
                        arrival: seen?.arrival ?? null,
                        connected,
                      })
                      return <Status tone={status.tone}>{status.label}</Status>
                    },
                  },
                ]}
              />
            ),
          })}
        </div>

        <div className="min-w-0">
          <Heading count={exceptions.length}>Needs attention</Heading>
          <PeopleTable
            rows={exceptions}
            rowKey={(row) => row.key}
            onRowClick={(row) => go(row.to)}
            empty="Nothing needs attention."
            card={(row) => ({
              ...(row.employeeId === null
                ? { title: scope.label, lines: [row.text] }
                : personCard(team.data, row.employeeId, [row.text])),
              foot: {
                info: <Status tone={row.tone}>{row.kind}</Status>,
                action: { label: "Open", onClick: () => go(row.to) },
              },
              tone: row.tone === "bad" ? "alert" : undefined,
            })}
            columns={[
              {
                key: "who",
                header: "Employee",
                cell: (row) =>
                  row.employeeId === null ? (
                    <span className="text-cell font-medium text-ink">
                      {scope.label}
                    </span>
                  ) : (
                    <Person team={team.data} id={row.employeeId} />
                  ),
              },
              {
                key: "text",
                header: "Finding",
                card: "meta",
                className: "whitespace-normal",
                cell: (row) => row.text,
              },
              {
                key: "kind",
                header: "Kind",
                card: "status",
                cell: (row) => <Status tone={row.tone}>{row.kind}</Status>,
              },
            ]}
          />
        </div>
      </div>
    </>
  )
}

/// A rostered day in a line: `Morning 09:00–17:00`, or what the day is.
function shiftWord(day: {
  plan: string
  shift_name: string | null
  starts_at: string | null
  ends_at: string | null
}): string {
  return day.plan === "SCHEDULED" && day.starts_at !== null
    ? `${day.shift_name ?? "Shift"} ${day.starts_at}–${day.ends_at ?? ""}`
    : planWord(day.plan)
}
