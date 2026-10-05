import { useQuery } from "@tanstack/react-query"

import { CENTRAL_KEY_PREFIX, cloud, relayAccess } from "@/lib/cloud"
import { useIdentity } from "@/lib/session"
import type {
  ApplicantView,
  AttendanceRangeView,
  CalendarView,
  ChangeProposalView,
  CorrectionRow,
  EmployeeList,
  EmployeeView,
  EmploymentProfileView,
  HireProposalView,
  InterviewView,
  LeaveBalanceRow,
  LeaveRequestView,
  LeaveTypeView,
  LifecycleTaskView,
  OvertimeOrderView,
  PayComponentView,
  PayrollAdjustmentRow,
  PerformanceTemplateView,
  PerformanceScoreView,
  PeriodView,
  PolicyView,
  PositionView,
  PunchReadinessView,
  ReachView,
  RosterDayView,
  RosterSwapView,
  ShiftView,
  StaffingPlanView,
  TodayView,
  TrainingProgramView,
  TrainingParticipantView,
  UniformIssuanceView,
} from "@itulah/contract"

/// Everything the HR screens ask head office, and the key each answer is
/// cached under.
///
/// These are the only reads in this app that leave the shop. Every other
/// screen is answered by the node in the next room and keeps working with the
/// line down; nothing here does, and the screens say so out loud rather than
/// drawing an empty rota that reads as "nobody is working today".
///
/// # One unit, always
///
/// HR rows are grouped by `unit_id`, while the till identity supplies a
/// `site_id`. Those identifiers can differ: a premises is not an employment
/// unit. The cloud's relay binding resolves the node's site to its unit and
/// `GET /employees/me/reach` returns that bounded unit. The shell uses the
/// site id only to request that scope; every HR query uses the returned
/// `unit_id`, and no unit picker exists on this surface.
///
/// # The server bounds these too, and that is the real control
///
/// The relay server bounds the caller's reach to the unit behind this node's
/// site. `/roster`, `/attendance-periods` and other unit-filtered routes still
/// check their requested unit against that reach; passing the bounded unit
/// keeps their filters and the client-side queue fences aligned. Routes with
/// no unit parameter remain server-bounded too, and queue rows are fenced by
/// their returned `unit_id`.
///
/// # The types are generated
///
/// `RosterDayView`, `PeriodView`, `LeaveRequestView`, `OvertimeOrderView`,
/// `EmployeeList` and `ReachView` all come from the Rust through `ts-rs`, so a
/// field renamed at the centre is a build failure here rather than a column of
/// `undefined` on a manager's screen.

/// The one HR unit these screens are about.
///
/// Resolved once, by the workspace shell, from the cloud's relay-bounded
/// `ReachView.unit_id` — not chosen, not remembered, and not widened. A screen
/// takes it as an argument rather than resolving its own scope, so there is
/// exactly one place in this module where "which unit" is decided.
export interface StoreScope {
  /// The authoritative, relay-bounded UNIT from `ReachView`; HR queries use
  /// this, never the till's premises id.
  readonly unit_id: string
  /// The centre's name for this unit, or its id when relaying cleared the name
  /// because the signed-in person's own posting is elsewhere.
  readonly label: string
}

export const hrKeys = {
  /// How far this head-office session reaches, and where it is posted.
  reach: () => [CENTRAL_KEY_PREFIX, "hr", "reach"] as const,
  team: (place: string) => [CENTRAL_KEY_PREFIX, "hr", "team", place] as const,
  roster: (place: string, from: string, to: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "roster", place, from, to] as const,
  /// The two decision queues share a prefix because they are one screen and a
  /// decision on either moves both.
  queue: () => [CENTRAL_KEY_PREFIX, "hr", "queue"] as const,
  leave: (place: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "queue", "leave", place] as const,
  overtime: (place: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "queue", "overtime", place] as const,
  period: (place: string, period: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "period", place, period] as const,
  swaps: () => [CENTRAL_KEY_PREFIX, "hr", "swaps"] as const,
  tasks: () => [CENTRAL_KEY_PREFIX, "hr", "tasks"] as const,
  applicants: () => [CENTRAL_KEY_PREFIX, "hr", "applicants"] as const,
  performance: () => [CENTRAL_KEY_PREFIX, "hr", "performance"] as const,
  /// What a day amounted to, and everything that sits on top of one — the
  /// corrections and the readiness counts — under one prefix, because a
  /// decided correction changes all three.
  attendance: () => [CENTRAL_KEY_PREFIX, "hr", "attendance"] as const,
  attendanceToday: (place: string, date: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "attendance", "today", place, date] as const,
  attendanceOf: (employee: string, from: string, to: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "attendance", "of", employee, from, to] as const,
  corrections: (place: string, pending: boolean) =>
    [
      CENTRAL_KEY_PREFIX,
      "hr",
      "attendance",
      "corrections",
      place,
      pending,
    ] as const,
  punchReadiness: (place: string, period: string) =>
    [
      CENTRAL_KEY_PREFIX,
      "hr",
      "attendance",
      "readiness",
      place,
      period,
    ] as const,
  /// One person's leave: what they asked for, and what they have left. Under
  /// the queue's prefix, so a decision in the queue refreshes both.
  leaveOf: (employee: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "queue", "leave-of", employee] as const,
  balancesOf: (employee: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "queue", "balances", employee] as const,
  overtimeOf: (employee: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "queue", "overtime-of", employee] as const,
  leaveTypes: () => [CENTRAL_KEY_PREFIX, "hr", "leave-types"] as const,
  holidays: (year: number) =>
    [CENTRAL_KEY_PREFIX, "hr", "holidays", year] as const,
  claims: () => [CENTRAL_KEY_PREFIX, "hr", "claims"] as const,
  claimsAt: (place: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "claims", "at", place] as const,
  claimTypes: () => [CENTRAL_KEY_PREFIX, "hr", "claims", "types"] as const,
  advancesOf: (employee: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "claims", "advances", employee] as const,
  rules: (group: string) => [CENTRAL_KEY_PREFIX, "hr", "rules", group] as const,
  uniformsOf: (employee: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "uniforms", employee] as const,
  training: () => [CENTRAL_KEY_PREFIX, "hr", "training"] as const,
  trainingParticipants: (programId: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "training", "participants", programId] as const,
  changes: (place: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "changes", place] as const,
  adjustments: (place: string, period: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "adjustments", place, period] as const,
  components: () => [CENTRAL_KEY_PREFIX, "hr", "components"] as const,
  plans: (place: string) => [CENTRAL_KEY_PREFIX, "hr", "plans", place] as const,
  hires: (place: string) => [CENTRAL_KEY_PREFIX, "hr", "hires", place] as const,
  lifecycle: () => [CENTRAL_KEY_PREFIX, "hr", "lifecycle"] as const,
  shifts: () => [CENTRAL_KEY_PREFIX, "hr", "shifts"] as const,
  positions: () => [CENTRAL_KEY_PREFIX, "hr", "positions"] as const,
  interviewsOf: (applicant: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "applicants", applicant, "interviews"] as const,
  employee: (employee: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "employee", employee] as const,
  profile: (employee: string) =>
    [CENTRAL_KEY_PREFIX, "hr", "employee", employee, "profile"] as const,
}

// ─────────────────────────────────────────────────────────────────────────────
// Who head office is relaying for

/// The person signed in at this till, as far as head office is concerned.
///
/// There is no second session any more: the node relays for whoever is signed
/// in here (`lib/cloud.ts`). What is left to ask is whether that person is one
/// the node CAN relay for — a head-office account projected onto this node —
/// and that is a property of the till's own identity, already in the cache.
/// `data` is that identity when it can be relayed for and `null` when it
/// cannot; `access` says why not, so a gate can say it in a sentence.
export function useCloudIdentity() {
  const identity = useIdentity()
  const access = relayAccess(identity.data)
  return {
    isPending: identity.isPending,
    error: identity.error,
    access,
    data: access === "ready" ? (identity.data ?? null) : null,
  }
}

/// How far this head-office session reaches, and where it is posted.
///
/// Answered by the server rather than derived here. The rule — the Admin
/// rung reaches everywhere, any posting (head office included) reaches that
/// one place, no posting reaches nothing — is enforced on every route; a browser that re-implemented it would be a
/// second place it is decided, and when the two disagreed the screen would be
/// the one that looked right.
/// `enabled` is the gate's, not a convenience: asking before there is a
/// head-office session is a guaranteed 401, and a 401 on boot is how a
/// perfectly healthy till acquires a red line in the console every morning.
export function useReach(enabled: boolean) {
  return useQuery({
    queryKey: hrKeys.reach(),
    queryFn: ({ signal }) =>
      cloud.get<ReachView>("/api/v1/employees/me/reach", { signal }),
    enabled,
    staleTime: Infinity,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// The reads

/// Who works at this shop. `GET /api/v1/employees?unit_id=…`
///
/// The list carries `unit_id` back with it, which the screen prints: a list
/// that silently showed four people where the shop has eleven would read as a
/// shop of four.
export function teamAt(
  place: string,
  signal?: AbortSignal,
): Promise<EmployeeList> {
  const query = new URLSearchParams({ unit_id: place, limit: "200" })
  return cloud.get<EmployeeList>(`/api/v1/employees?${query.toString()}`, {
    signal,
  })
}

/// The rota this shop is working to, between two dates.
/// `GET /api/v1/roster?unit=…&from=…&to=…`
export function rosterAt(
  place: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<RosterDayView[]> {
  const query = new URLSearchParams({ unit: place, from, to })
  return cloud.get<RosterDayView[]>(`/api/v1/roster?${query.toString()}`, {
    signal,
  })
}

/// A queue the centre scoped by the caller's posting rather than by a
/// parameter, plus how much of it belonged somewhere else.
export interface PlaceQueue<T> {
  readonly rows: readonly T[]
  /// Rows the centre returned for other shops, which this screen dropped.
  ///
  /// **Not decoration.** Zero is the normal answer and means the credential is
  /// the shop's own; anything else means the session signed in here reaches
  /// further than this counter, and the screen has to say so rather than
  /// quietly showing a filtered fleet as if it were a shop.
  readonly elsewhere: number
}

function fence<T extends { readonly unit_id: string }>(
  rows: readonly T[],
  place: string,
): PlaceQueue<T> {
  const mine = rows.filter((row) => row.unit_id === place)
  return { rows: mine, elsewhere: rows.length - mine.length }
}

/// Leave waiting on a decision. `GET /api/v1/leave-requests/pending`
///
/// **This route takes no place.** It bounds itself by the caller's own posting
/// — `reach.sole_place()` — which is exactly right for the store credential
/// this screen is meant for: that caller is posted here, and the centre
/// answers with this shop and nothing else.
///
/// It is wrong for a caller who reaches everywhere, and on a laptop rig with
/// authentication off that is every caller: the centre then answers for the
/// whole fleet. Dropping the foreign rows here is a **fence, not a scope** —
/// the scope is the server's — and the count that comes back with them is what
/// keeps the screen honest about which of the two it is looking at.
export function pendingLeaveAt(
  place: string,
  signal?: AbortSignal,
): Promise<PlaceQueue<LeaveRequestView>> {
  return cloud
    .get<LeaveRequestView[]>("/api/v1/leave-requests/pending", { signal })
    .then((rows) => fence(rows, place))
}

/// Overtime ordered and not yet answered.
/// `GET /api/v1/overtime-orders/awaiting`
///
/// Bounded by the caller's posting exactly as the leave queue is, and fenced
/// here for the same reason.
export function awaitingOvertimeAt(
  place: string,
  signal?: AbortSignal,
): Promise<PlaceQueue<OvertimeOrderView>> {
  return cloud
    .get<OvertimeOrderView[]>("/api/v1/overtime-orders/awaiting", { signal })
    .then((rows) => fence(rows, place))
}

/// One month of this shop's attendance, and what stands between it and a
/// close. `GET /api/v1/attendance-periods?unit=…&period=YYYY-MM`
///
/// Asked for one named month rather than for the list: the route's list form
/// answers only months the shop already has a record for, so a shop closing
/// its first month would get an empty array and a screen with nothing to
/// close. Naming the month makes the centre synthesise the open period.
export function periodAt(
  place: string,
  period: string,
  signal?: AbortSignal,
): Promise<PeriodView> {
  const query = new URLSearchParams({ unit: place, period })
  return cloud
    .get<PeriodView[]>(`/api/v1/attendance-periods?${query.toString()}`, {
      signal,
    })
    .then((rows) => {
      const [only] = rows
      if (only === undefined) {
        throw new Error(`the centre returned no period for ${place} ${period}`)
      }
      return only
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// The two writes a shop makes

/// Approve or reject one leave request.
/// `POST /api/v1/employees/{id}/leave-requests/{request}/{decision}`
///
/// The reason is required by the server, not merely asked for here: a record
/// that says what changed but not why is the half of an audit trail that never
/// helps anybody. The employee id travels in the path because the route is
/// shaped that way; the request id is what actually identifies the decision.
export function decideLeave(input: {
  employeeId: string
  requestId: string
  decision: "approve" | "reject"
  reason: string
}): Promise<LeaveRequestView> {
  return cloud.post<LeaveRequestView>(
    `/api/v1/employees/${encodeURIComponent(input.employeeId)}/leave-requests/${encodeURIComponent(input.requestId)}/${input.decision}`,
    { reason: input.reason },
  )
}

/// Sign this shop's month off.
/// `POST /api/v1/attendance-periods/{place}/{period}/closure`
///
/// The readiness is computed at the centre from stored facts and never sent
/// from here — a client supplying its own zeros could close a month over
/// anything it liked. Reopening is head office's and has no route on this
/// surface: a shop that could reopen its own close has not closed anything.
export function closePeriod(input: {
  place: string
  period: string
  reason: string
}): Promise<PeriodView> {
  return cloud.post<PeriodView>(
    `/api/v1/attendance-periods/${encodeURIComponent(input.place)}/${encodeURIComponent(input.period)}/closure`,
    { reason: input.reason },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the answers out loud

/// `2026-09-13`, in this device's own timezone.
///
/// `toISOString()` is not this: it converts to UTC first, so a manager opening
/// the till at 06:00 in Jakarta would be shown the previous day's rota, every
/// morning, with nothing on screen admitting it.
export function isoDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/// `2026-09`, the month a period is named by.
export function isoMonth(date: Date): string {
  return isoDay(date).slice(0, 7)
}

/// `n` days after `from`, as a date.
export function addDays(from: Date, days: number): Date {
  const moved = new Date(from)
  moved.setDate(moved.getDate() + days)
  return moved
}

/// `13 Sep`, `Sen 14 Sep` — a date read off a wall rather than out of a
/// database.
///
/// The year appears only when it is not this one, and that is not tidiness: a
/// contract ending "05 Jan" is either three weeks away or fifteen months away,
/// and the difference decides whether somebody has to be spoken to this week.
/// Leave and rota dates are all inside the year, so they stay short.
export function readDate(iso: string, withWeekday = false): string {
  const parsed = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleDateString("id-ID", {
    weekday: withWeekday ? "short" : undefined,
    day: "2-digit",
    month: "short",
    year:
      parsed.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  })
}

/// `2026-08` → `Agustus 2026`. A period is named on the wire the way it sorts
/// and read on screen the way it is said; printing the code would put a
/// spreadsheet's spelling of August in front of a shop manager.
export function readMonth(period: string): string {
  const parsed = new Date(`${period}-01T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return period
  return parsed.toLocaleDateString("id-ID", { month: "long", year: "numeric" })
}

/// `420` → `7h`, `450` → `7h 30m`. Minutes and never hours on the wire: a
/// fractional hour cannot round-trip, so two systems reading the same
/// overtime disagree about it.
export function readMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/// What a rostered day is, in a word. The server's three codes are
/// `SCHEDULED`, `REST_DAY` and `PUBLIC_HOLIDAY`, and a code this build has not
/// been taught is shown as itself rather than guessed at.
export function planWord(plan: string): string {
  if (plan === "SCHEDULED") return "Working"
  if (plan === "REST_DAY") return "Rest day"
  if (plan === "PUBLIC_HOLIDAY") return "Public holiday"
  return plan
}

/// The name to print for somebody, from the workforce list.
///
/// A code is unusable on its own and a missing name is not an error: a profile
/// is enrolled after the employment record exists, so a person hired this
/// morning genuinely has a badge number and no name yet.
export function nameOf(
  team: EmployeeList | undefined,
  employeeId: string,
): { name: string; code: string | null } {
  const row = team?.rows.find((person) => person.employee_id === employeeId)
  if (row === undefined) return { name: employeeId, code: null }
  return { name: row.full_name ?? row.employee_code, code: row.employee_code }
}

// ── the next generation ─────────────────────────────────────────────────────
//
// Swaps, the store's checklist rows, the interviews the head conducts, the
// scores the head records, and the overtime this shop orders. Every decision
// route below bounds itself by the caller's posting at the centre, exactly
// like the two queues above; the fences here are the same fence, not a scope.

/// Roster swaps waiting on this shop's decision.
/// `GET /api/v1/roster-swaps/pending`
export function pendingSwapsAt(
  place: string,
  signal?: AbortSignal,
): Promise<PlaceQueue<RosterSwapView>> {
  return cloud
    .get<RosterSwapView[]>("/api/v1/roster-swaps/pending", { signal })
    .then((rows) => fence(rows, place))
}

/// Decide a swap. Approving moves both days on the rota; refusing keeps the
/// request as the record that somebody looked.
export function decideSwap(input: {
  id: string
  approved: boolean
  reason: string
}): Promise<RosterSwapView> {
  return cloud.post<RosterSwapView>(
    `/api/v1/roster-swaps/${encodeURIComponent(input.id)}/decision`,
    { approved: input.approved, reason: input.reason },
  )
}

/// The checklist rows this shop owns.
/// `GET /api/v1/lifecycle/tasks?owner=STORE` — bounded by the caller's reach
/// at the centre, so only this shop's people come back.
export function storeTasks(signal?: AbortSignal): Promise<LifecycleTaskView[]> {
  return cloud.get<LifecycleTaskView[]>("/api/v1/lifecycle/tasks?owner=STORE", {
    signal,
  })
}

/// Close a checklist row this shop owns.
export function completeTask(input: {
  id: string
  reason: string
}): Promise<LifecycleTaskView> {
  return cloud.post<LifecycleTaskView>(
    `/api/v1/lifecycle/tasks/${encodeURIComponent(input.id)}/completion`,
    { reason: input.reason },
  )
}

/// The applicants for this shop's requisitions.
/// `GET /api/v1/recruitment/applicants` — reach-bounded at the centre; the
/// fence here is the same honesty fence the queues use.
export function applicantsAt(
  place: string,
  signal?: AbortSignal,
): Promise<PlaceQueue<ApplicantView>> {
  return cloud
    .get<ApplicantView[]>("/api/v1/recruitment/applicants", { signal })
    .then((rows) => fence(rows, place))
}

/// Put an interview on the calendar.
export function scheduleInterview(input: {
  applicantId: string
  scheduledAt: string
  interviewerEmployeeId: string
  reason: string
}): Promise<unknown> {
  return cloud.post(
    `/api/v1/recruitment/applicants/${encodeURIComponent(input.applicantId)}/interviews`,
    {
      scheduled_at: input.scheduledAt,
      interviewer_employee_id: input.interviewerEmployeeId,
      reason: input.reason,
    },
  )
}

/// Record how the conversation went.
export function recordInterview(input: {
  interviewId: string
  result: "PASS" | "FAIL"
  ratings: Record<string, number>
  note: string
  reason: string
}): Promise<unknown> {
  return cloud.post(
    `/api/v1/recruitment/interviews/${encodeURIComponent(input.interviewId)}/result`,
    {
      result: input.result,
      ratings: input.ratings,
      note: input.note,
      reason: input.reason,
    },
  )
}

/// The templates a position is measured on.
export function performanceTemplates(
  signal?: AbortSignal,
): Promise<PerformanceTemplateView[]> {
  return cloud.get<PerformanceTemplateView[]>("/api/v1/performance/templates", {
    signal,
  })
}

/// Scores recorded for one month.
///
/// Takes the month as `YYYY-MM` and sends the first of it: the centre reads
/// `period` as a date ("period is a date, the first of its month") and refuses
/// the month spelled as a month with a 400.
export function performanceScores(
  period: string,
  signal?: AbortSignal,
): Promise<PerformanceScoreView[]> {
  const first = period.length === 7 ? `${period}-01` : period
  return cloud.get<PerformanceScoreView[]>(
    `/api/v1/performance/scores?period=${encodeURIComponent(first)}`,
    { signal },
  )
}

/// Record one person's month.
export function recordScore(input: {
  employeeId: string
  period: string
  kpiPct: number
  managerScore: number
  reason: string
}): Promise<PerformanceScoreView> {
  return cloud.put<PerformanceScoreView>(
    `/api/v1/employees/${encodeURIComponent(input.employeeId)}/performance/${input.period}`,
    {
      kpi_pct: input.kpiPct,
      manager_score: input.managerScore,
      reason: input.reason,
    },
  )
}

/// Order overtime: the employer's written instruction, the half the worker's
/// consent needs before anything is authorized.
export function orderOvertime(input: {
  employeeId: string
  onDate: string
  dayKind: "WORKING" | "REST" | "HOLIDAY"
  plannedMinutes: number
  reason: string
}): Promise<OvertimeOrderView> {
  return cloud.post<OvertimeOrderView>(
    `/api/v1/employees/${encodeURIComponent(input.employeeId)}/overtime-orders`,
    {
      order_id: `ot_${crypto.randomUUID().replaceAll("-", "")}`,
      on_date: input.onDate,
      day_kind: input.dayKind,
      planned_minutes: input.plannedMinutes,
      reason: input.reason,
    },
  )
}

/// The conversations one applicant has had or has scheduled.
/// `GET /api/v1/recruitment/applicants/{id}/interviews` — reach-bounded.
export function listApplicantInterviews(
  applicantId: string,
  signal?: AbortSignal,
): Promise<InterviewView[]> {
  return cloud.get<InterviewView[]>(
    `/api/v1/recruitment/applicants/${encodeURIComponent(applicantId)}/interviews`,
    { signal },
  )
}

// ── the store's face of the prototype ───────────────────────────────────────
//
// Everything below is what `prototypes/hr-v3/hr.html` gives *HR toko*: the
// day's attendance and the fixes to it, leave balances and the holiday
// calendar, every overtime order rather than only the unanswered ones, claims
// and advances, uniforms, training, the changes a shop asks head office for,
// and the one-off pay figures it files. Every route is bounded at the centre by
// the caller's posting; where one takes a place, the place is this shop's and
// nothing else, exactly as above.

const enc = encodeURIComponent

/// A request id minted here, for the routes that take one from the client.
///
/// Those routes take it because the employee app files from a phone that may be
/// offline — the id has to exist before the centre has heard of the request.
/// A counter filing on somebody's behalf is online, but the route does not
/// know that, and a random id is the same answer for both.
function mint(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`
}

// ── attendance ───────────────────────────────────────────────────────────────

/// One day at this shop: every rostered person's derived day, the days the
/// derivation would not classify, and the raw punches.
/// `GET /api/v1/attendance/today?unit=…&date=…`
///
/// `punch_source_connected` is the field to read FIRST. False means no station
/// and no phone has ever reported for this shop, and every "absent" under it is
/// an absence of evidence rather than evidence of absence.
export function attendanceToday(
  place: string,
  date: string,
  signal?: AbortSignal,
): Promise<TodayView> {
  const query = new URLSearchParams({ unit: place, date })
  return cloud.get<TodayView>(`/api/v1/attendance/today?${query.toString()}`, {
    signal,
  })
}

/// One person's derived days between two dates.
/// `GET /api/v1/employees/{id}/attendance?from=…&to=…`
export function attendanceOf(
  employeeId: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<AttendanceRangeView> {
  const query = new URLSearchParams({ from, to })
  return cloud.get<AttendanceRangeView>(
    `/api/v1/employees/${enc(employeeId)}/attendance?${query.toString()}`,
    { signal },
  )
}

/// The two punch-derived counts a month's close waits on.
/// `GET /api/v1/attendance/punch-readiness?unit=…&period=YYYY-MM`
///
/// `null` is "not assessed" — no station has reported for this shop — and is
/// never drawn as a zero.
export function punchReadinessAt(
  place: string,
  period: string,
  signal?: AbortSignal,
): Promise<PunchReadinessView> {
  const query = new URLSearchParams({ unit: place, period })
  return cloud.get<PunchReadinessView>(
    `/api/v1/attendance/punch-readiness?${query.toString()}`,
    { signal },
  )
}

/// This shop's attendance corrections — the ones waiting (`pending`) or the
/// whole history. `GET /api/v1/attendance-corrections?unit=…&pending=…`
///
/// The route takes a place and the centre refuses one the caller does not
/// reach, so unlike the leave queue this needs no fence.
export function correctionsAt(
  place: string,
  pending: boolean,
  signal?: AbortSignal,
): Promise<CorrectionRow[]> {
  const query = new URLSearchParams({ unit: place, pending: String(pending) })
  return cloud.get<CorrectionRow[]>(
    `/api/v1/attendance-corrections?${query.toString()}`,
    { signal },
  )
}

/// What a correction claims. The server's own vocabulary: a correction states
/// *times* and never an outcome — "late" or "present" is derived from the times
/// by the same policy every other day is judged by.
export type CorrectionEffect = "ARRIVAL" | "DEPARTURE" | "ARRIVAL_AND_DEPARTURE"

/// Record a fix to somebody's day. The shop's act, on a colleague's day, under
/// `people.correction.request`; **deciding it is somebody else's** — the
/// requester and the decider must be different people, and the centre refuses
/// the same name twice.
///
/// Answers with the day's whole chain.
export function fileCorrection(input: {
  employeeId: string
  businessDate: string
  effect: CorrectionEffect
  arrival?: string
  departure?: string
  reason: string
}): Promise<CorrectionRow[]> {
  return cloud.post<CorrectionRow[]>(
    `/api/v1/employees/${enc(input.employeeId)}/attendance-corrections`,
    {
      business_date: input.businessDate,
      effect: input.effect,
      arrival: input.arrival ?? null,
      departure: input.departure ?? null,
      reason: input.reason,
    },
  )
}

/// Approve or refuse one. A refusal is kept: a day whose correction was
/// refused is a day somebody looked at.
export function decideCorrection(input: {
  id: string
  approve: boolean
  reason: string
}): Promise<CorrectionRow[]> {
  return cloud.post<CorrectionRow[]>(
    `/api/v1/attendance-corrections/${enc(input.id)}/decision`,
    { approve: input.approve, reason: input.reason },
  )
}

// ── leave ───────────────────────────────────────────────────────────────────

/// The kinds of leave that exist. Readable by anybody signed in.
export function leaveTypes(signal?: AbortSignal): Promise<LeaveTypeView[]> {
  return cloud.get<LeaveTypeView[]>("/api/v1/leave-types", { signal })
}

/// What one person has left, per kind, folded to today.
/// `GET /api/v1/employees/{id}/leave-balances`
///
/// In **centidays** on the wire — 150 is a day and a half — because half days
/// exist and a float cannot round-trip them.
export function leaveBalancesOf(
  employeeId: string,
  signal?: AbortSignal,
): Promise<LeaveBalanceRow[]> {
  return cloud.get<LeaveBalanceRow[]>(
    `/api/v1/employees/${enc(employeeId)}/leave-balances`,
    { signal },
  )
}

/// Everything one person has asked for, decided or not.
/// `GET /api/v1/employees/{id}/leave-requests`
export function leaveRequestsOf(
  employeeId: string,
  signal?: AbortSignal,
): Promise<LeaveRequestView[]> {
  return cloud.get<LeaveRequestView[]>(
    `/api/v1/employees/${enc(employeeId)}/leave-requests`,
    { signal },
  )
}

/// Record leave on somebody's behalf — *HR toko mencatat cuti*.
/// `POST /api/v1/employees/{id}/leave-requests`
///
/// The rest days are read off the rota and sent, because the centre takes them
/// rather than deriving them: a request that counted a rostered day off as
/// leave would charge somebody's balance for a day they were never due in.
/// Deciding it is still a separate act, and the centre keeps the filer and the
/// decider apart.
export async function fileLeave(input: {
  place: string
  employeeId: string
  leaveType: string
  from: string
  to: string
  reason: string
  evidence?: string
}): Promise<LeaveRequestView> {
  const days = await rosterAt(input.place, input.from, input.to)
  const restDays = days
    .filter(
      (day) => day.employee_id === input.employeeId && day.plan !== "SCHEDULED",
    )
    .map((day) => day.on_date)
  return cloud.post<LeaveRequestView>(
    `/api/v1/employees/${enc(input.employeeId)}/leave-requests`,
    {
      request_id: mint("lv"),
      leave_type: input.leaveType,
      from_date: input.from,
      to_date: input.to,
      rest_days: restDays,
      evidence:
        input.evidence === undefined || input.evidence.trim() === ""
          ? null
          : input.evidence,
      reason: input.reason,
    },
  )
}

/// Which days are red, for one year. Readable by anybody signed in.
/// `GET /api/v1/holiday-calendars/{year}`
export function holidays(
  year: number,
  signal?: AbortSignal,
): Promise<CalendarView> {
  return cloud.get<CalendarView>(`/api/v1/holiday-calendars/${year}`, {
    signal,
  })
}

// ── overtime ────────────────────────────────────────────────────────────────

/// Every order one person has been given, answered or not.
/// `GET /api/v1/employees/{id}/overtime-orders`
export function overtimeOrdersOf(
  employeeId: string,
  signal?: AbortSignal,
): Promise<OvertimeOrderView[]> {
  return cloud.get<OvertimeOrderView[]>(
    `/api/v1/employees/${enc(employeeId)}/overtime-orders`,
    { signal },
  )
}

/// Take an order back before it is answered — the prototype's *Batalkan
/// perintah*. The employer's act, under the ordering key.
export function withdrawOvertime(input: {
  employeeId: string
  orderId: string
  reason: string
}): Promise<OvertimeOrderView> {
  return cloud.post<OvertimeOrderView>(
    `/api/v1/employees/${enc(input.employeeId)}/overtime-orders/${enc(input.orderId)}/withdrawal`,
    { reason: input.reason },
  )
}

// ── claims and advances ─────────────────────────────────────────────────────
//
// Structural rather than generated: the claim views are not in the contract's
// ts-rs export yet (the hub's `lib/queries/people.ts` carries the same shapes
// for the same reason, against `postgres::claims::ClaimView`).

export interface ClaimTypeRow {
  readonly code: string
  readonly name: string
  readonly retired_at: string | null
  readonly created_at: string
}

export interface ClaimLineRow {
  readonly line_id: string
  readonly type_code: string
  readonly type_name: string
  readonly description: string
  readonly spent_on: string
  readonly claimed_minor: number
  /// The decider's figure. Null until decided.
  readonly sanctioned_minor: number | null
  readonly line_number: number
}

export interface ClaimEventRow {
  readonly actor: string
  readonly action: string
  readonly reason: string | null
  readonly at: string
  readonly detail?: string | null
}

export interface ClaimRow {
  readonly claim_id: string
  readonly claim_number: string
  readonly unit_id: string
  readonly unit_name: string | null
  readonly employee_id: string
  readonly employee_code: string | null
  readonly employee_name: string | null
  readonly posted_on: string
  /// `DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED`, `PAID` or `WITHDRAWN`.
  readonly state: string
  readonly claimed_minor: number
  readonly sanctioned_minor: number | null
  readonly claimed_by: string
  readonly decided_by: string | null
  readonly decided_at: string | null
  readonly decide_reason: string | null
  readonly paid_at: string | null
  readonly paid_by: string | null
  readonly lines: readonly ClaimLineRow[]
  readonly history: readonly ClaimEventRow[]
}

/// One advance the finance lane is holding for one person.
export interface EmployeeAdvanceRow {
  readonly advance_id: string
  readonly advance_number: string
  readonly site_id: string
  readonly purpose: string
  readonly amount_minor: number
  readonly settled_minor: number
  readonly refunded_minor: number
  readonly recovered_minor: number
  readonly outstanding_minor: number
  readonly status: string
  readonly requested_at: string
  readonly paid_at: string | null
}

/// The kinds of expense. Readable by anybody signed in.
export function claimTypes(signal?: AbortSignal): Promise<ClaimTypeRow[]> {
  return cloud.get<ClaimTypeRow[]>("/api/v1/expense-claim-types", { signal })
}

/// This shop's claims, every state. `GET /api/v1/expense-claims?unit=…`
///
/// The centre ANDs the caller's reach into the query, so a shop asking for
/// another shop's claims by name gets an empty list rather than a leak.
export function claimsAt(
  place: string,
  signal?: AbortSignal,
): Promise<ClaimRow[]> {
  return cloud.get<ClaimRow[]>(`/api/v1/expense-claims?unit=${enc(place)}`, {
    signal,
  })
}

/// Record a claim on a colleague's behalf, and send it in.
///
/// Two acts at the centre — filing makes a DRAFT, submission puts it in front
/// of a decider — and both are the filer's, so this makes both. A draft left
/// on the counter would be a claim nobody is waiting on and nobody decides.
/// The one who files it cannot sanction it: the centre compares actors.
export async function fileClaim(input: {
  employeeId: string
  lines: readonly {
    typeCode: string
    description: string
    spentOn: string
    amountMinor: number
  }[]
  reason: string
}): Promise<ClaimRow> {
  const draft = await cloud.post<ClaimRow>("/api/v1/expense-claims", {
    employee_id: input.employeeId,
    lines: input.lines.map((line) => ({
      type_code: line.typeCode,
      description: line.description,
      spent_on: line.spentOn,
      claimed_minor: line.amountMinor,
    })),
    reason: input.reason,
  })
  return cloud.post<ClaimRow>(
    `/api/v1/expense-claims/${enc(draft.claim_id)}/submission`,
    { reason: input.reason },
  )
}

/// Sanction a claim, with a figure per line, or refuse it.
///
/// The figures travel with the decision because they *are* the decision —
/// "Rp 120.000 of a Rp 150.000 taxi" is one fact per line, and the centre
/// totals them itself rather than trusting a browser's arithmetic.
export function decideClaim(input: {
  claimId: string
  approve: boolean
  reason: string
  sanctions: readonly { lineId: string; sanctionedMinor: number }[]
}): Promise<ClaimRow> {
  return cloud.post<ClaimRow>(
    `/api/v1/expense-claims/${enc(input.claimId)}/decision`,
    {
      approve: input.approve,
      reason: input.reason,
      lines: input.approve
        ? input.sanctions.map((one) => ({
            line_id: one.lineId,
            sanctioned_minor: one.sanctionedMinor,
          }))
        : [],
    },
  )
}

/// Send a claim back to its filer, to be corrected and sent in again. Not a
/// refusal: it returns to DRAFT with the reason on it.
export function returnClaim(input: {
  claimId: string
  reason: string
}): Promise<ClaimRow> {
  return cloud.post<ClaimRow>(
    `/api/v1/expense-claims/${enc(input.claimId)}/returnal`,
    { reason: input.reason },
  )
}

/// The advances one person is holding. Read-only: advances are the finance
/// lane's, and every write to one stays behind the finance routes.
export function advancesOf(
  employeeId: string,
  signal?: AbortSignal,
): Promise<EmployeeAdvanceRow[]> {
  return cloud.get<EmployeeAdvanceRow[]>(
    `/api/v1/employees/${enc(employeeId)}/advances`,
    { signal },
  )
}

// ── the rule numbers ────────────────────────────────────────────────────────

/// Head office's rule numbers for one group — `claim`, `benefit`,
/// `statutory`, `overtime`, `shift`, `leave`, `pay`. Readable by anybody
/// signed in: a rule kept from the people it governs is a trap.
/// `GET /api/v1/people-policy?group=…`
export function rules(
  group: string,
  signal?: AbortSignal,
): Promise<PolicyView[]> {
  return cloud.get<PolicyView[]>(`/api/v1/people-policy?group=${enc(group)}`, {
    signal,
  })
}

// ── benefits ────────────────────────────────────────────────────────────────

/// One person's uniform ledger. `GET /api/v1/employees/{id}/uniform-issuances`
export function uniformsOf(
  employeeId: string,
  signal?: AbortSignal,
): Promise<UniformIssuanceView[]> {
  return cloud.get<UniformIssuanceView[]>(
    `/api/v1/employees/${enc(employeeId)}/uniform-issuances`,
    { signal },
  )
}

/// Record a handover — the shop's act, because the person standing in the shop
/// is the one who hands the uniform over.
export function recordUniform(input: {
  employeeId: string
  issuedOn: string
  sets: number
  reason: string
}): Promise<UniformIssuanceView[]> {
  return cloud.post<UniformIssuanceView[]>(
    `/api/v1/employees/${enc(input.employeeId)}/uniform-issuances`,
    { issued_on: input.issuedOn, sets: input.sets, reason: input.reason },
  )
}

// ── training ────────────────────────────────────────────────────────────────

/// Head office's programmes. `GET /api/v1/training-programs`
export function trainingPrograms(
  signal?: AbortSignal,
): Promise<TrainingProgramView[]> {
  return cloud.get<TrainingProgramView[]>("/api/v1/training-programs", {
    signal,
  })
}

/// Put one of this shop's people on a programme. The centre refuses a person
/// who is not posted here.
export function nominate(input: {
  programId: string
  employeeId: string
  reason: string
}): Promise<TrainingProgramView> {
  return cloud.post<TrainingProgramView>(
    `/api/v1/training-programs/${enc(input.programId)}/participants`,
    { employee_id: input.employeeId, reason: input.reason },
  )
}

/// The server filters this roster to the current HR unit before it returns
/// employee names or attendance details.
export function trainingParticipants(
  programId: string,
  signal?: AbortSignal,
): Promise<TrainingParticipantView[]> {
  return cloud.get<TrainingParticipantView[]>(
    `/api/v1/training-programs/${enc(programId)}/participants`,
    { signal },
  )
}

/// Record or correct one nominated employee's attendance. Each reason is
/// retained in the participant's attendance history.
export function recordTrainingAttendance(input: {
  programId: string
  employeeId: string
  attended: boolean
  reason: string
}): Promise<TrainingParticipantView> {
  return cloud.post<TrainingParticipantView>(
    `/api/v1/training-programs/${enc(input.programId)}/participants/${enc(input.employeeId)}/attendance`,
    { attended: input.attended, reason: input.reason },
  )
}

// ── employment changes ──────────────────────────────────────────────────────

/// What a shop may ask head office to change about somebody's employment.
export type ChangeKind = "PROMOTION" | "TRANSFER" | "SALARY" | "SEPARATION"

/// The proposals filed about this shop's people, every state.
/// `GET /api/v1/change-proposals?unit_id=…`
export function changeProposalsAt(
  place: string,
  signal?: AbortSignal,
): Promise<ChangeProposalView[]> {
  return cloud.get<ChangeProposalView[]>(
    `/api/v1/change-proposals?unit_id=${enc(place)}`,
    { signal },
  )
}

/// Ask head office to change somebody's employment. The shop asks; deciding
/// it is head office's, and nothing about the person changes until it does.
export function fileChangeProposal(input: {
  employeeId: string
  kind: ChangeKind
  props: readonly { field: string; toText?: string; toMinor?: number }[]
  effectiveOn: string
  reason: string
}): Promise<ChangeProposalView> {
  return cloud.post<ChangeProposalView>(
    `/api/v1/employees/${enc(input.employeeId)}/change-proposals`,
    {
      kind: input.kind,
      props: input.props.map((prop) =>
        prop.toMinor !== undefined
          ? { field: prop.field, to_minor: prop.toMinor }
          : { field: prop.field, to_text: prop.toText ?? "" },
      ),
      effective_on: input.effectiveOn,
      reason: input.reason,
    },
  )
}

/// The pay components head office has defined. Ungated at the centre — a rate
/// that decides what comes out of somebody's wage is owed to them — and read
/// here for the one-off form, which may only file against a component with no
/// standing figure of its own (`PER_OCCASION`).
export function payComponents(
  signal?: AbortSignal,
): Promise<PayComponentView[]> {
  return cloud.get<PayComponentView[]>("/api/v1/payroll/components", {
    signal,
  })
}

/// The one-off figures this shop has filed for one month — an incentive, a
/// *kasbon* instalment. `GET /api/v1/payroll/adjustments?unit=…&period=…`
export function adjustmentsAt(
  place: string,
  period: string,
  signal?: AbortSignal,
): Promise<PayrollAdjustmentRow[]> {
  const query = new URLSearchParams({ unit: place, period })
  return cloud.get<PayrollAdjustmentRow[]>(
    `/api/v1/payroll/adjustments?${query.toString()}`,
    { signal },
  )
}

/// Propose one pay component, + or −, for one person for one month — the
/// store's right in `menu-final.md`. The figure is always positive; which way
/// it points is the component's kind. Head office decides it with the month's
/// batch; there is no second approval.
export function fileAdjustment(input: {
  place: string
  period: string
  employeeId: string
  componentCode: string
  amountMinor: number
  reason: string
}): Promise<PayrollAdjustmentRow[]> {
  return cloud.post<PayrollAdjustmentRow[]>("/api/v1/payroll/adjustments", {
    unit_id: input.place,
    period: input.period,
    employee_id: input.employeeId,
    component_code: input.componentCode,
    amount_minor: input.amountMinor,
    reason: input.reason,
  })
}

/// Take a one-off back while the batch is still the shop's.
export function withdrawAdjustment(input: {
  id: string
  reason: string
}): Promise<PayrollAdjustmentRow[]> {
  return cloud.post<PayrollAdjustmentRow[]>(
    `/api/v1/payroll/adjustments/${enc(input.id)}/withdrawal`,
    { reason: input.reason },
  )
}

// ── recruitment ─────────────────────────────────────────────────────────────

/// The headcount head office planned for this shop.
/// `GET /api/v1/recruitment/plans?unit_id=…`
export function staffingPlansAt(
  place: string,
  signal?: AbortSignal,
): Promise<StaffingPlanView[]> {
  return cloud.get<StaffingPlanView[]>(
    `/api/v1/recruitment/plans?unit_id=${enc(place)}`,
    { signal },
  )
}

/// The people this shop has asked for — *Minta karyawan baru* — and what head
/// office answered. `GET /api/v1/hire-proposals?unit_id=…`
export function hireProposalsAt(
  place: string,
  signal?: AbortSignal,
): Promise<HireProposalView[]> {
  return cloud.get<HireProposalView[]>(
    `/api/v1/hire-proposals?unit_id=${enc(place)}`,
    { signal },
  )
}

/// Ask for somebody. Deciding is head office's, and "approved" is not
/// "working here": an approval opens a candidate, and the hire is a later act.
export function proposeHire(input: {
  place: string
  position: string
  headcount: number
  need: "REPLACEMENT" | "ADDITION"
  candidateName: string
  startOn: string
  contractKind: "PKWT" | "PKWTT"
  contractEndsOn?: string
  basePayMinor: number
  reason: string
}): Promise<HireProposalView> {
  return cloud.post<HireProposalView>("/api/v1/hire-proposals", {
    unit_id: input.place,
    position: input.position,
    headcount: input.headcount,
    need: input.need,
    candidate_name: input.candidateName,
    start_on: input.startOn,
    contract_kind: input.contractKind,
    contract_ends_on:
      input.contractKind === "PKWT" ? (input.contractEndsOn ?? null) : null,
    base_pay_minor: input.basePayMinor,
    reason: input.reason,
  })
}

// ── onboarding and exit ─────────────────────────────────────────────────────

/// Every checklist row for this shop's people, whoever owns it — so a joiner's
/// progress can be counted across the rows the shop does not own as well as
/// the ones it does. `GET /api/v1/lifecycle/tasks` — reach-bounded.
export function lifecycleTasks(
  signal?: AbortSignal,
): Promise<LifecycleTaskView[]> {
  return cloud.get<LifecycleTaskView[]>("/api/v1/lifecycle/tasks", { signal })
}

// ── reading the answers out loud, part two ──────────────────────────────────

/// `150` centidays → `1.5`. A balance is carried in hundredths of a day so a
/// half day round-trips; printing the hundredths would be printing the wire.
export function readCentidays(centidays: number): string {
  const days = centidays / 100
  return Number.isInteger(days) ? String(days) : days.toFixed(1)
}

/// The first and last day of a `YYYY-MM` month, as ISO days.
export function monthBounds(period: string): { from: string; to: string } {
  const [year, month] = period.split("-").map(Number)
  const last = new Date(year as number, month as number, 0).getDate()
  return {
    from: `${period}-01`,
    to: `${period}-${String(last).padStart(2, "0")}`,
  }
}

/// `2026-09-13 08:03` → `08:03`; a next-day reading keeps its `+1`. The date is
/// the row's, so repeating it in every cell spends the width on the half that
/// does not differ.
export function clockOf(stamp: string | null): string {
  if (stamp === null) return "—"
  const space = stamp.indexOf(" ")
  return space === -1 ? stamp : stamp.slice(space + 1)
}

// ── one person ──────────────────────────────────────────────────────────────

/// One person's employment record: where they have been posted, and every
/// transition of their employment. `GET /api/v1/employees/{id}`
export function employeeDetail(
  employeeId: string,
  signal?: AbortSignal,
): Promise<EmployeeView> {
  return cloud.get<EmployeeView>(`/api/v1/employees/${enc(employeeId)}`, {
    signal,
  })
}

/// Who somebody is at work: job, grade, place, the day they joined.
/// `GET /api/v1/employees/{id}/profile` — not their personal data, which is
/// its own route with its own privilege and is never asked from a till.
export function employeeProfile(
  employeeId: string,
  signal?: AbortSignal,
): Promise<EmploymentProfileView> {
  return cloud.get<EmploymentProfileView>(
    `/api/v1/employees/${enc(employeeId)}/profile`,
    { signal },
  )
}

// ── building the rota ───────────────────────────────────────────────────────

/// Head office's shift patterns — what a rostered day may be. A shop builds
/// its rota out of these and cannot invent one: a shop with its own idea of a
/// shift is a shop whose rota means nothing next to the shop beside it.
/// `GET /api/v1/attendance-shifts`
export function shifts(signal?: AbortSignal): Promise<ShiftView[]> {
  return cloud.get<ShiftView[]>("/api/v1/attendance-shifts", { signal })
}

/// Plan one person's day — *Toko menyusun roster*. A day planned twice keeps
/// both revisions, and the centre counts them: a rota changed under somebody
/// is a governance signal, not an edit.
/// `POST /api/v1/employees/{id}/roster`
export function planDay(input: {
  employeeId: string
  onDate: string
  plan: "SCHEDULED" | "REST_DAY" | "PUBLIC_HOLIDAY"
  shiftId?: string
  reason: string
}): Promise<RosterDayView> {
  return cloud.post<RosterDayView>(
    `/api/v1/employees/${enc(input.employeeId)}/roster`,
    {
      on_date: input.onDate,
      plan: input.plan,
      shift_id: input.plan === "SCHEDULED" ? (input.shiftId ?? null) : null,
      reason: input.reason,
    },
  )
}

/// The positions head office has defined — what a shop may ask for.
/// `GET /api/v1/org/positions`
export function positions(signal?: AbortSignal): Promise<PositionView[]> {
  return cloud.get<PositionView[]>("/api/v1/org/positions", { signal })
}
