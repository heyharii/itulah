import { useQuery } from "@tanstack/react-query"

import { PeopleTable } from "@/components/ui/people-table"
import { Pill } from "@/components/ui/pill"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { useGo } from "@/lib/go"
import {
  applicantsAt,
  attendanceToday,
  claimsAt,
  correctionsAt,
  hrKeys,
  isoDay,
  isoMonth,
  pendingLeaveAt,
  pendingSwapsAt,
  periodAt,
  planWord,
  readDate,
  readMonth,
  rosterAt,
  storeTasks,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { Heading, Person } from "@/screens/hr/parts"
import { dayStatus, useTeam, type Tone } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"

/// Today, at this shop — the prototype's store Overview (`pageOverview`, role
/// `s`): who is on, who is in, what is waiting on the store head, and what
/// needs somebody's attention.
///
/// # What is waiting, and on whom
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
export function HrToday() {
  return (
    <HrWorkspace>
      {(scope) => <Today scope={scope} />}
    </HrWorkspace>
  )
}

/// One row of the store head's queue.
interface Waiting {
  readonly key: string
  readonly kind: string
  readonly employeeId: string
  readonly what: string
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
  const lastMonth = isoMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1))

  const team = useTeam(scope)
  const roster = useQuery({
    queryKey: hrKeys.roster(scope.unit_id, today, today),
    queryFn: ({ signal }) => rosterAt(scope.unit_id, today, today, signal),
  })
  const attendance = useQuery({
    queryKey: hrKeys.attendanceToday(scope.unit_id, today),
    queryFn: ({ signal }) => attendanceToday(scope.unit_id, today, signal),
  })
  const leave = useQuery({
    queryKey: hrKeys.leave(scope.unit_id),
    queryFn: ({ signal }) => pendingLeaveAt(scope.unit_id, signal),
  })
  const corrections = useQuery({
    queryKey: hrKeys.corrections(scope.unit_id, true),
    queryFn: ({ signal }) => correctionsAt(scope.unit_id, true, signal),
  })
  const swaps = useQuery({
    queryKey: hrKeys.swaps(),
    queryFn: ({ signal }) => pendingSwapsAt(scope.unit_id, signal),
  })
  const claims = useQuery({
    queryKey: hrKeys.claimsAt(scope.unit_id),
    queryFn: ({ signal }) => claimsAt(scope.unit_id, signal),
  })
  const period = useQuery({
    queryKey: hrKeys.period(scope.unit_id, lastMonth),
    queryFn: ({ signal }) => periodAt(scope.unit_id, lastMonth, signal),
  })
  const applicants = useQuery({
    queryKey: hrKeys.applicants(),
    queryFn: ({ signal }) => applicantsAt(scope.unit_id, signal),
  })
  const tasks = useQuery({
    queryKey: hrKeys.tasks(),
    queryFn: ({ signal }) => storeTasks(signal),
  })

  // ── the store head's queue ────────────────────────────────────────────────
  const waiting: Waiting[] = [
    ...(leave.data?.rows ?? []).map((request) => ({
      key: `leave-${request.id}`,
      kind: "Leave",
      employeeId: request.employee_id,
      what: `${request.leave_type_name} · ${readDate(request.from_date)}${request.to_date === request.from_date ? "" : ` – ${readDate(request.to_date)}`} · ${request.chargeable_days} day${request.chargeable_days === 1 ? "" : "s"}`,
      to: "/hr/leave",
    })),
    ...(corrections.data ?? []).map((fix) => ({
      key: `fix-${fix.id}`,
      kind: "Attendance fix",
      employeeId: fix.employee_id,
      what: `${readDate(fix.business_date)} · ${fix.reason}`,
      to: "/hr/attendance",
    })),
    ...(swaps.data?.rows ?? []).map((swap) => ({
      key: `swap-${swap.id}`,
      kind: "Shift swap",
      employeeId: swap.employee_id,
      what: `${readDate(swap.on_date)} · ${swap.reason}`,
      to: "/hr/roster",
    })),
    ...(claims.data ?? [])
      .filter((claim) => claim.state === "SUBMITTED")
      .map((claim) => ({
        key: `claim-${claim.claim_id}`,
        kind: "Claim",
        employeeId: claim.employee_id,
        what: `${claim.claim_number} · ${claim.lines.map((line) => line.description).join(", ")}`,
        to: "/hr/expenses",
      })),
  ]

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
          label="Waiting on the store head"
          value={waiting.length}
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
          sub="candidates at interview"
        />
      </StatStrip>

      <Heading count={waiting.length}>Waiting on the store head</Heading>
      <PeopleTable
        rows={waiting}
        rowKey={(row) => row.key}
        onRowClick={(row) => go(row.to)}
        empty="Nothing waiting."
        columns={[
          {
            key: "kind",
            header: "Kind",
            card: "status",
            cell: (row) => <Pill tone="neutral">{row.kind}</Pill>,
          },
          {
            key: "who",
            header: "Employee",
            card: "title",
            cell: (row) => <Person team={team.data} id={row.employeeId} />,
          },
          {
            key: "what",
            header: "Request",
            card: "meta",
            className: "whitespace-normal",
            cell: (row) => row.what,
          },
        ]}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <Heading>Attendance today</Heading>
          {centreState(roster, {
            loading: "Loading…",
            what: "today's rota",
            render: (days) => (
              <PeopleTable
                rows={days}
                rowKey={(day) => day.employee_id}
                onRowClick={() => go("/hr/attendance")}
                empty="No rota for today."
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
                    cell: (day) =>
                      day.plan === "SCHEDULED" && day.starts_at !== null
                        ? `${day.shift_name ?? "Shift"} ${day.starts_at}–${day.ends_at ?? ""}`
                        : planWord(day.plan),
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
                      return <Pill tone={status.tone}>{status.label}</Pill>
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
            columns={[
              {
                key: "kind",
                header: "Kind",
                card: "status",
                cell: (row) => <Pill tone={row.tone}>{row.kind}</Pill>,
              },
              {
                key: "who",
                header: "Employee",
                card: "title",
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
            ]}
          />
        </div>
      </div>
    </>
  )
}
