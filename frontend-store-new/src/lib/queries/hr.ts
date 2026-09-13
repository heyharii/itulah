import { useQuery } from "@tanstack/react-query"

import { CENTRAL_KEY_PREFIX, cloud, cloudAuth, cloudKey } from "@/lib/cloud"
import { ApiError, type Identity } from "@itulah/contract/client"
import type {
  EmployeeList,
  LeaveRequestView,
  OvertimeOrderView,
  PeriodView,
  ReachView,
  RosterDayView,
} from "@itulah/contract"

/// Everything the HR screens ask head office, and the key each answer is
/// cached under.
///
/// These are the only reads in this app that leave the shop. Every other
/// screen is answered by the node in the next room and keeps working with the
/// line down; nothing here does, and the screens say so out loud rather than
/// drawing an empty rota that reads as "nobody is working today".
///
/// # One place, always
///
/// Every read below takes a `place` and it is always this node's own
/// `site_id`. There is no unit picker on this surface and there is not going
/// to be one: a till is a shop, and the shop it is standing in is the only
/// shop whose rota it has any business showing.
///
/// That the two ids are the same word is not luck. `org_place` (migration
/// 0060) seeded itself from `site` and kept each site's own id — "Sites keep
/// their own ids here, so nothing ever has to translate between the two
/// vocabularies" — so the till's `site_id` *is* the centre's `place_id`, and
/// nothing here maps between them.
///
/// # The server bounds these too, and that is the real control
///
/// A store credential's reach is `Only(place)`, so `/roster` and
/// `/attendance-periods` refuse a place that is not the caller's, and
/// `/employees` narrows to their posting whatever they ask for. Passing the
/// place from here is how the screen says which shop it means; the refusal is
/// what makes it true. Two of these routes take no place at all — see
/// `pendingLeaveAt` — and that is the one gap this file has to close itself.
///
/// # The types are generated
///
/// `RosterDayView`, `PeriodView`, `LeaveRequestView`, `OvertimeOrderView`,
/// `EmployeeList` and `ReachView` all come from the Rust through `ts-rs`, so a
/// field renamed at the centre is a build failure here rather than a column of
/// `undefined` on a manager's screen.

/// The one shop these screens are about.
///
/// Resolved once, by the workspace shell, from this node's own `site_id` — not
/// chosen, not remembered, and not widened. A screen takes it as an argument
/// rather than reading the node identity for itself, so there is exactly one
/// place in this module where "which shop" is decided.
export interface StoreScope {
  /// `org_place.id`, which is this node's `site_id`.
  readonly id: string
  /// What to call it on screen — the centre's name for the place when this
  /// session is posted here, and the id itself when it is not.
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
}

// ─────────────────────────────────────────────────────────────────────────────
// The head-office session

/// Who is signed in **at the centre**, asked of the centre rather than assumed
/// from the presence of a token.
///
/// No token means "not signed in there", and asking would be a round trip whose
/// answer is already known — plus a 401 in the console on every boot of a till
/// whose cashier never opens HR.
export function useCloudIdentity() {
  return useQuery({
    queryKey: cloudKey.me(),
    queryFn: async ({ signal }): Promise<Identity | null> => {
      if (!cloud.hasBearer) return null
      try {
        return await cloudAuth.me(signal)
      } catch (error) {
        if (error instanceof ApiError && error.needsSignIn) return null
        throw error
      }
    },
    retry: false,
    staleTime: Infinity,
  })
}

/// Which centre this till is reading, and whether that centre is running with
/// authentication on.
///
/// Worth asking before a password box is drawn: a cloud node with auth
/// **DISABLED** — a bench, a laptop rig — has nobody to sign in as and its
/// login endpoint has nothing to check. The node says so itself in `/health`,
/// and believing it beats guessing from a 401. A centre that cannot be reached
/// at all resolves to `null` rather than throwing, because an unreachable head
/// office is a fact about the line, not a failure of the till.
export function useCentreNode() {
  return useQuery({
    queryKey: cloudKey.identity(),
    queryFn: ({ signal }) => cloud.identity({ signal }).catch(() => null),
    staleTime: Infinity,
  })
}

/// How far this head-office session reaches, and where it is posted.
///
/// Answered by the server rather than derived here. The rule — head office
/// reaches everywhere, a shop reaches itself, no posting reaches nothing —
/// is enforced on every route; a browser that re-implemented it would be a
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

/// Who works at this shop. `GET /api/v1/employees?place_id=…`
///
/// The list carries `place_id` back with it, which the screen prints: a list
/// that silently showed four people where the shop has eleven would read as a
/// shop of four.
export function teamAt(
  place: string,
  signal?: AbortSignal,
): Promise<EmployeeList> {
  const query = new URLSearchParams({ place_id: place, limit: "200" })
  return cloud.get<EmployeeList>(`/api/v1/employees?${query.toString()}`, {
    signal,
  })
}

/// The rota this shop is working to, between two dates.
/// `GET /api/v1/roster?place=…&from=…&to=…`
export function rosterAt(
  place: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<RosterDayView[]> {
  const query = new URLSearchParams({ place, from, to })
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

function fence<T extends { readonly place_id: string }>(
  rows: readonly T[],
  place: string,
): PlaceQueue<T> {
  const mine = rows.filter((row) => row.place_id === place)
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
/// close. `GET /api/v1/attendance-periods?place=…&period=YYYY-MM`
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
  const query = new URLSearchParams({ place, period })
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

/// `420` → `7j 0m`. Minutes and never hours on the wire: a fractional hour
/// cannot round-trip, so two systems reading the same overtime disagree about
/// it.
export function readMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${hours}j ${rest}m`
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
