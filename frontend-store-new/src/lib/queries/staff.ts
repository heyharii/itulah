import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import {
  addDays,
  attendanceToday,
  employeeProfile,
  hireProposalsQuery,
  hrKeys,
  isoDay,
  leaveBalancesOf,
  positions,
  proposeHire,
  rosterQuery,
  type StoreScope,
} from "@/lib/queries/hr"
import type {
  AttendanceDayView,
  EmployeeSummary,
  EmploymentProfileView,
  HireProposalVersionView,
  HireProposalView,
  LeaveBalanceRow,
} from "@itulah/contract"

/// What the Staff screen asks head office, and the one thing it asks of it.
///
/// # The store asks; it never adds
///
/// Nobody at a shop creates an employee. A shop *requests* one from head
/// office (`POST /hire-proposals`), head office decides, and an approval opens
/// a candidate record that head office then employs. The same holds for a
/// promotion, a transfer and a separation (Employment changes). So the only
/// write on this screen is a request, and the only way to see what became of
/// it is to read the requests back.
///
/// # What a proposal can carry, and what it cannot
///
/// The centre's hire proposal is the owner's field list of 13 Sep 2026 and
/// nothing else: the candidate's name, the position, the start date, the
/// contract (with its end for a fixed term), the proposed base pay, how many,
/// and why. There is no NIK, address, date of birth or contact on it — and
/// nowhere for one to go: personal data is a different route with a different
/// grant that the relay refuses a till, so it is entered at head office when
/// the person is employed. The form asks for exactly what the proposal holds.

// ── the week, and the seven days before it ──────────────────────────────────

/// Monday to Sunday of the week `now` falls in. A shop's week starts on Monday.
export function weekOf(now: Date): { from: string; to: string } {
  const monday = addDays(now, -((now.getDay() + 6) % 7))
  return { from: isoDay(monday), to: isoDay(addDays(monday, 6)) }
}

/// The seven whole days before today, oldest first.
///
/// Today is left out on purpose: a day that is not over has people who have
/// not come in yet, and counting them as absent would be a claim nobody has
/// looked into.
export function lastSevenDays(now: Date): string[] {
  return Array.from({ length: 7 }, (_, index) =>
    isoDay(addDays(now, index - 7)),
  )
}

// ── one person's figures ────────────────────────────────────────────────────

/// What the last seven days amounted to for one person.
export interface Recent {
  /// Net minutes worked.
  readonly worked: number
  /// Days they arrived late.
  readonly late: number
  /// Days nothing saw them on a day they were due.
  readonly absent: number
}

/// Whichever balance is the annual leave.
///
/// Leave kinds are head office's list, so there is no code to look for. The
/// one named "annual" (or *tahunan*) is the one the table's *Leave left* means;
/// failing that, a shop whose people draw on a single balance has only one to
/// mean. More than one and none called annual is a column nobody can read, and
/// it is left blank rather than guessed at.
export function annualBalance(
  rows: readonly LeaveBalanceRow[],
): LeaveBalanceRow | null {
  const annual = rows.find((row) =>
    /annual|tahunan/i.test(`${row.leave_type} ${row.name}`),
  )
  if (annual !== undefined) return annual
  return rows.length === 1 ? (rows[0] ?? null) : null
}

function recentOf(days: readonly AttendanceDayView[]): Recent {
  return {
    worked: days.reduce((sum, day) => sum + day.net_worked_minutes, 0),
    late: days.filter((day) => day.outcomes.includes("LATE")).length,
    absent: days.filter((day) => day.outcomes.includes("ABSENT")).length,
  }
}

/// Everything the table and the sheet say about the people of one shop, read
/// once and shared.
///
/// One read per person for the job (grade) and one for the leave balances —
/// those are per-person routes — and **seven for the week**, one per day,
/// because the day's attendance is answered for the whole shop at once, which
/// is cheaper than a read per person once a shop has more than seven. Hours
/// this week come from the rota: one read.
///
/// Each answer is a function of the person's id that gives `undefined` while it
/// is still coming, so a cell can draw a dash and fill in when it arrives
/// rather than hold the whole table back for the slowest read.
export function useStaffReads(
  scope: StoreScope,
  people: readonly EmployeeSummary[],
) {
  const now = new Date()
  const week = weekOf(now)
  const recent = lastSevenDays(now)

  const profiles = useQueries({
    queries: people.map((person) => ({
      queryKey: hrKeys.profile(person.employee_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        employeeProfile(person.employee_id, signal),
      // A grade changes by a decision at head office, not by the hour.
      staleTime: 5 * 60_000,
    })),
  })
  const balances = useQueries({
    queries: people.map((person) => ({
      queryKey: hrKeys.balancesOf(person.employee_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        leaveBalancesOf(person.employee_id, signal),
    })),
  })
  const attendance = useQueries({
    queries: recent.map((date) => ({
      queryKey: hrKeys.attendanceToday(scope.unit_id, date),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        attendanceToday(scope.unit_id, date, signal),
    })),
  })
  const rota = useQuery(rosterQuery(scope.unit_id, week.from, week.to))

  const indexOf = (id: string) =>
    people.findIndex((person) => person.employee_id === id)

  // `false` when no reader or phone has ever reported for this shop: then a
  // "late" or "absent" is an absence of evidence, and a zero would read as
  // good news that nobody has checked.
  const answered = attendance.find((read) => read.data !== undefined)?.data
  const assessed = answered?.punch_source_connected

  return {
    /// Who they are at work: job, grade, the day they joined.
    profile: (id: string): EmploymentProfileView | undefined =>
      profiles[indexOf(id)]?.data,
    /// What they have left, per kind of leave.
    balances: (id: string): readonly LeaveBalanceRow[] | undefined =>
      balances[indexOf(id)]?.data,
    /// Minutes the rota has them working this week.
    scheduled: (id: string): number | undefined =>
      rota.data
        ?.filter((day) => day.employee_id === id && day.plan === "SCHEDULED")
        .reduce((sum, day) => sum + (day.planned_work_minutes ?? 0), 0),
    /// The last seven days. `undefined` while it is coming; `null` when this
    /// shop has nothing that could have seen anybody.
    recent: (id: string): Recent | null | undefined => {
      if (assessed === undefined) return undefined
      if (!assessed) return null
      return recentOf(
        attendance.flatMap((read) =>
          (read.data?.days ?? []).filter((day) => day.employee_id === id),
        ),
      )
    },
  }
}

// ── requesting a person ─────────────────────────────────────────────────────

/// The positions head office has defined — what a shop may ask for.
export function usePositions() {
  return useQuery({
    queryKey: hrKeys.positions(),
    queryFn: ({ signal }) => positions(signal),
    staleTime: 5 * 60_000,
  })
}

/// This shop's requests for new people, every state, newest first.
export function useHireRequests(scope: StoreScope) {
  return useQuery(hireProposalsQuery(scope.unit_id))
}

/// The terms in force — the version head office is looking at, or looked at
/// last.
export function currentTerms(
  proposal: HireProposalView,
): HireProposalVersionView | undefined {
  return (
    proposal.versions.find((v) => v.version === proposal.current_version) ??
    proposal.versions[proposal.versions.length - 1]
  )
}

/// Ask head office for one person.
export function useRequestStaff(scope: StoreScope) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      position: string
      need: "ADDITION" | "REPLACEMENT"
      name: string
      startOn: string
      contractKind: "PKWT" | "PKWTT"
      endsOn?: string
      basePayMinor: number
      reason: string
    }) =>
      proposeHire({
        place: scope.unit_id,
        position: input.position,
        // The form names one person, so it asks for one.
        headcount: 1,
        need: input.need,
        candidateName: input.name,
        startOn: input.startOn,
        contractKind: input.contractKind,
        contractEndsOn: input.endsOn,
        basePayMinor: input.basePayMinor,
        reason: input.reason,
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: hrKeys.hires(scope.unit_id) }),
  })
}
