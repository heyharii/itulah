import {
  useQueries,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { DockChoice } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, Status } from "@/components/ui/pill"
import { KeyValue, MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { ButtonGroup, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Timeline } from "@/components/ui/timeline"
import {
  count,
  dateRange,
  day,
  label,
  moment,
  monthYear,
  weekday,
} from "@/lib/format"
import {
  listEmployees,
  listShifts,
  listTerminals,
  peopleKeys,
  punchKeys,
  punchReadiness,
  readAttendance,
  readEnrolment,
  readMinutes,
  readToday,
  rosterKeys,
} from "@/lib/queries/people"
import { useActiveEmployees } from "@/lib/queries/hr-time"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { FileCorrectionSheet } from "@/screens/people/attendance-correction-sheet"
import { Quiet, UnitChoice, useUnit } from "@/screens/people/parts"
import type {
  AttendanceDayView,
  PunchRow,
  TerminalRow,
  UnderivableDay,
} from "@itulah/contract"

/// What a day actually amounted to, at one unit.
///
/// # The first field read is `punch_source_connected`, and nothing is drawn
/// # until it has been
///
/// Every figure on this screen is derived from punches. When no station has
/// ever reported, a zero is an **absence of evidence** and not evidence of
/// absence — so the day is not drawn at all. `PEOPLE-BRIEF.md` is explicit
/// about why: "a roster with nobody marked present reads as 'everybody is
/// absent' to anyone who does not know the backend, and that is worse than an
/// empty screen." A manager who is shown fourteen rows of dashes will not read
/// a banner above them; they will read the dashes, and then act on them.
///
/// That rule is extended here beyond the one boolean, and this is the
/// departure from the suggested shape worth justifying. `punch_source_connected`
/// is computed as *a non-revoked station exists at this unit* — so it is true
/// for a unit whose only station is SUSPENDED, and true for one registered
/// this morning that has never delivered anything. Both of those are the same
/// situation the flag exists to prevent being mistaken for an empty day. So
/// the posture is read from the flag **and** from `listTerminals(unit)`
/// together (see `postureOf`), and the grid appears when either something is
/// reporting or there are punches in hand to show. Nothing about the station
/// list is inferred while it is in flight: an unanswered terminals query
/// leaves the server's flag as the only word, which is what it was before.
///
/// # Underivable days are their own section, never a count of absences
///
/// `UnderivableDay` carries a sentence the server wrote — "no policy version
/// covers this date", "the pairing is ambiguous" — and those are statements
/// about the **inputs**, not about the person. Folding them into an absence
/// count would turn head office's unwritten policy into somebody's bad day.
/// They are listed with their reason, per person per date, below the day.
///
/// # Fingerprint is the only way in
///
/// By the owner's decision there is no PIN and no card, so somebody with no
/// enrolled finger cannot clock in at all — and would appear here every single
/// day as somebody who did not come to work. `EnrolmentView.can_clock_in`
/// answers it per person, and that answer is put on the row and named in its
/// own section. `TerminalRow.enrolled_people` is a count, and a count cannot
/// tell a manager *whose* day is about to read as an absence.
///
/// # Two figures on this screen are not about attendance at all
///
/// `punches` carries what the devices reported, and the day's rows are driven
/// by the roster — so a punch from somebody with no roster line appears in one
/// and in neither of the others. Those are surfaced on their own, because a
/// punch counted nowhere is the one an auditor asks about. The month's
/// `punchReadiness` sits beside the stations for the same reason, rendering
/// `null` as "not assessed" and never as `0`: zero is a claim that somebody
/// looked.
///
/// # Why there is no filter bar
///
/// This is one day at one unit — a dozen rows to thirty, read in one look. The
/// two questions asked of it ("who is late", "where is X") are answered by the
/// counters above and by the eye; a clause in a URL is for a list somebody
/// arrives at not knowing what is in it.

// ── calendar arithmetic, in UTC ────────────────────────────────────────────

/// Both of these do their arithmetic in UTC and only ever exchange
/// `YYYY-MM-DD`, because a business date is a **calendar day** and not an
/// instant. Reading a local midnight and printing it with `toISOString()` puts
/// Jakarta's +7 a day behind — the bug `roster.tsx` was fixed for today, and
/// these are its helpers rather than a second set that could drift from them.
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function todayIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10)
}

/// `2026-09-13 08:03` → `08:03`, and a next-day reading keeps its `+1`.
///
/// The date is the column heading, so repeating it in every cell spends the
/// width on the half that does not differ. The `+1` stays: a shift that ends
/// at 00:45 ends on the *next* calendar day and still belongs to this business
/// date, and a bare `00:45` next to a 22:00 start reads as a departure before
/// the arrival.
function clock(stamp: string | null): string {
  if (stamp === null) return "—"
  const space = stamp.indexOf(" ")
  return space === -1 ? stamp : stamp.slice(space + 1)
}

// ── the outcome vocabulary ─────────────────────────────────────────────────

/// The seven codes in the server's words, in English.
///
/// `MISSING_PUNCH` is the one that is not a statement about the person — the
/// backend calls it "a question, not a verdict" — so it is the one code that
/// does not wear a colour saying somebody did something wrong.
function outcome(code: string): { label: string; tone: OutcomeTone } {
  switch (code) {
    case "ON_TIME":
      return { label: "On time", tone: "ok" }
    case "LATE":
      return { label: "Late", tone: "warn" }
    case "EARLY_LEAVE":
      return { label: "Left early", tone: "warn" }
    case "ABSENT":
      return { label: "Absent", tone: "bad" }
    case "MISSING_PUNCH":
      return { label: "Missing punch", tone: "neutral" }
    case "APPROVED_LEAVE":
      return { label: "Approved leave", tone: "info" }
    case "AGREED_OVERTIME":
      return { label: "Agreed overtime", tone: "ok" }
    default:
      // A code this screen has not been taught is shown as the server spelled
      // it. Inventing a friendly name for an unknown outcome is how a new
      // state arrives silently mislabelled.
      return { label: code, tone: "neutral" }
  }
}

type OutcomeTone = "ok" | "warn" | "bad" | "info" | "neutral"

// ── one row of the day ─────────────────────────────────────────────────────

const NO_DAYS: readonly AttendanceDayView[] = []
const NO_UNDERIVABLE: readonly UnderivableDay[] = []
const NO_PUNCHES: readonly PunchRow[] = []

/// A derived day with the two things the view deliberately does not carry: the
/// person's name, and whether they can clock in at all.
///
/// Flattened rather than nested so the columns stay accessor-keyed and the
/// table can sort them without a comparator per column.
interface DayRow {
  readonly employeeId: string
  readonly who: string
  readonly plan: string
  readonly arrival: string | null
  readonly departure: string | null
  readonly outcomes: readonly string[]
  readonly lateMinutes: number
  readonly earlyMinutes: number
  readonly overtimeAgreed: number
  readonly overtimeUnagreed: number
  readonly workedMinutes: number
  readonly punchesConsidered: number
  readonly correction: string | null
  readonly policyVersion: number
  /// `false` when nobody has enrolled a finger for them, and `null` when the
  /// enrolment could not be read — which is not the same answer and is not
  /// rendered as though it were.
  readonly canClockIn: boolean | null
}

const columns: ColumnDef<TableSetup, DayRow>[] = [
  {
    id: "who",
    accessorFn: (row) => row.who,
    header: "Who",
    size: 210,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="truncate text-cell text-ink max-md:text-card-title">
        {row.original.who}
      </span>
    ),
  },
  {
    id: "plan",
    accessorFn: (row) => row.plan,
    header: "Planned",
    size: 170,
    meta: { priority: 2, card: "meta" },
  },
  {
    id: "arrival",
    accessorFn: (row) => row.arrival ?? "",
    header: "In",
    size: 95,
    // On a card (`cardLead`; a phone) the arrival is the figure the card leads
    // with, the departure under it where a card's figure keeps its caption —
    // the `max-md:` classes are the card's `CardFigure`, on the one cell the
    // table draws.
    meta: { card: "lead" },
    cell: ({ row }) => (
      <span className="tabular-nums max-md:flex max-md:flex-col max-md:items-end max-md:text-right">
        <span
          className={
            row.original.arrival === null
              ? "max-md:text-[1.5rem] max-md:leading-tight max-md:font-semibold max-md:tracking-tight max-md:text-mute"
              : "max-md:text-[1.5rem] max-md:leading-tight max-md:font-semibold max-md:tracking-tight"
          }
        >
          {clock(row.original.arrival)}
        </span>
        <span className="hidden max-md:block max-md:text-[0.9375rem] max-md:font-normal max-md:text-mute">
          {row.original.departure === null
            ? row.original.arrival === null
              ? "no arrival"
              : "arrived"
            : `out ${clock(row.original.departure)}`}
        </span>
      </span>
    ),
  },
  {
    id: "departure",
    accessorFn: (row) => row.departure ?? "",
    header: "Out",
    size: 95,
    // On a card the departure is the caption under the arrival.
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="tabular-nums">{clock(row.original.departure)}</span>
    ),
  },
  {
    id: "outcomes",
    // Joined into a string so the column carries a sortable value; the cell
    // draws the codes as what they are, which is a set rather than a word.
    accessorFn: (row) => row.outcomes.join(" "),
    header: "Outcome",
    size: 240,
    meta: { card: "foot" },
    cell: ({ row }) =>
      row.original.outcomes.length === 0 ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {row.original.outcomes.map((code) => {
            const read = outcome(code)
            return (
              <Status key={code} tone={read.tone}>
                {read.label}
              </Status>
            )
          })}
        </span>
      ),
  },
  {
    id: "late",
    // `null` for none, so a card leaves the figure out instead of drawing a
    // dash under its label; it still sorts as zero.
    accessorFn: (row) => (row.lateMinutes === 0 ? null : row.lateMinutes),
    header: "Late by",
    size: 100,
    meta: { align: "right", priority: 2, card: "meta" },
    /// The policy's answer, not the arithmetic: the grace is already taken off
    /// by the version named on the row, so an arrival three minutes after the
    /// shift starts is `0` here and that is correct rather than a rounding.
    cell: ({ row }) =>
      row.original.lateMinutes === 0 ? (
        <span className="text-mute">—</span>
      ) : (
        <>
          <span className="hidden max-md:inline">Late by </span>
          {readMinutes(row.original.lateMinutes)}
        </>
      ),
  },
  {
    id: "overtime",
    accessorFn: (row) =>
      row.overtimeAgreed + row.overtimeUnagreed === 0
        ? null
        : row.overtimeAgreed + row.overtimeUnagreed,
    header: "Overtime",
    size: 150,
    meta: { align: "right", priority: 2, card: "meta" },
    /// Agreed and unagreed are never added together. An hour nobody consented
    /// to is not an hour of overtime — PP 35/2021 wants the worker's own
    /// agreement — and a single total would pay it or hide it depending on
    /// which way somebody read the column.
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center justify-end gap-1 max-md:justify-start">
        <span className="hidden max-md:inline">Overtime</span>
        {row.original.overtimeAgreed > 0 && (
          <span className="tabular-nums">
            {readMinutes(row.original.overtimeAgreed)}
          </span>
        )}
        {row.original.overtimeUnagreed > 0 && (
          <span className="text-warn-fg">
            {readMinutes(row.original.overtimeUnagreed)} unagreed
          </span>
        )}
        {row.original.overtimeAgreed === 0 &&
          row.original.overtimeUnagreed === 0 && (
            <span className="text-mute">—</span>
          )}
      </span>
    ),
  },
  {
    id: "worked",
    accessorFn: (row) => (row.workedMinutes === 0 ? null : row.workedMinutes),
    header: "Worked",
    size: 100,
    meta: { align: "right", priority: 3, card: "meta" },
    cell: ({ row }) =>
      row.original.workedMinutes === 0 ? (
        <span className="text-mute">—</span>
      ) : (
        <>
          <span className="hidden max-md:inline">Worked </span>
          {readMinutes(row.original.workedMinutes)}
        </>
      ),
  },
  {
    id: "flags",
    // Empty when there is nothing to note, so a card leaves the line out.
    accessorFn: (row) =>
      row.canClockIn !== true ||
      row.correction !== null ||
      row.punchesConsidered === 0
        ? (row.correction ?? "") + String(row.canClockIn)
        : "",
    header: "Notes",
    size: 210,
    meta: { priority: 2, card: "meta" },
    /// Two facts that change how the rest of the row should be read, and both
    /// of them belong beside it rather than a click away: a corrected day is
    /// not what the device saw, and somebody with no finger on file could not
    /// have punched however early they arrived. One dot and one line, the
    /// worst fact's tone, so the cell stays one row.
    cell: ({ row }) => {
      const day = row.original
      const words = [
        day.canClockIn === false ? "No finger" : null,
        day.canClockIn === null ? "Enrolment unread" : null,
        day.correction !== null ? "Corrected" : null,
        day.punchesConsidered === 0 ? "No punch" : null,
      ].filter((one) => one !== null)
      if (words.length === 0) return null
      const tone =
        day.canClockIn === false
          ? "bad"
          : day.correction !== null
            ? "info"
            : "neutral"
      return <Status tone={tone}>{words.join(" · ")}</Status>
    },
  },
]

// ── what the unit's stations amount to ─────────────────────────────────────

/// How much this unit's punch source can be believed today.
///
/// `punch_source_connected` answers one question — is a non-revoked station
/// registered here — and four situations hide behind its two values. Naming
/// them is what lets the screen say which one it is in instead of drawing the
/// same empty day for all four.
type Posture =
  /// Nothing is registered. Nobody at this unit can clock in at all.
  | { readonly kind: "UNREGISTERED" }
  /// A station is registered and nothing more is known here, because the
  /// terminals list has not answered. The server's flag is the only word, and
  /// it says yes.
  | { readonly kind: "REGISTERED" }
  /// Registered but every station is suspended, so none of them may attest an
  /// identification.
  | { readonly kind: "SUSPENDED"; readonly stations: number }
  /// Active stations that have never delivered a punch. "One of them will be
  /// unplugged on a Monday" is the owner's own observation, and this is it.
  | { readonly kind: "SILENT"; readonly stations: number }
  | { readonly kind: "REPORTING"; readonly last: string }

function postureOf(
  connected: boolean,
  stations: readonly TerminalRow[] | undefined
): Posture {
  if (!connected) return { kind: "UNREGISTERED" }
  if (stations === undefined || stations.length === 0)
    return { kind: "REGISTERED" }
  const usable = stations.filter((one) => one.status === "ACTIVE")
  if (usable.length === 0)
    return { kind: "SUSPENDED", stations: stations.length }
  const heard = usable
    .map((one) => one.punched_at)
    .filter((at): at is string => at !== null)
    .sort()
  const last = heard.at(-1)
  return last === undefined
    ? { kind: "SILENT", stations: usable.length }
    : { kind: "REPORTING", last }
}

/// The day, on a phone: tomorrow back to a fortnight ago as the chip over the
/// bottom bar, and whichever day is on screen if it is further away. The desk
/// has its arrows and its calendar.
function DayChoice({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const today = todayIso()
  const days = new Set<string>([value])
  for (let by = 1; by >= -13; by -= 1) days.add(addDays(today, by))
  const named = (iso: string) => weekday(iso, true)
  return (
    <DockChoice
      title="Day"
      value={value}
      onChange={onChange}
      options={[...days]
        .sort()
        .reverse()
        .map((iso) => ({
          value: iso,
          label: iso === today ? `Today · ${named(iso)}` : named(iso),
          short: iso === today ? "Today" : weekday(iso),
        }))}
    />
  )
}

export function AttendanceDays() {
  const phone = useLayout() === "phone"
  const unit = useUnit()
  const unitId = unit.unitId
  const person = useSheet("attendanceOf")
  const [correcting, setCorrecting] = useState(false)
  const [date, setDate] = useState(todayIso)
  const [sorting, setSorting] = useState<SortingState>([
    // Alphabetical, and deliberately not worst-first. A day is read to find one
    // person as often as to scan it, and a table that reorders itself as
    // somebody arrives is one whose row you lose while reaching for it. The
    // exceptions are carried by the counters above and by the pill colour.
    { id: "who", desc: false },
  ])
  const today = todayIso()

  const view = useQuery({
    queryKey: punchKeys.today(unitId ?? "", date),
    queryFn: ({ signal }) => readToday(unitId ?? "", date, signal),
    enabled: unitId !== null,
  })
  const stations = useQuery({
    queryKey: punchKeys.terminals(unitId),
    queryFn: ({ signal }) => listTerminals(unitId ?? undefined, signal),
    enabled: unitId !== null,
  })
  /// The month this day falls in, because the two figures the readiness
  /// carries are the ones a close will be signed against and both of them are
  /// invisible in a single day: a correction still open, and a punch on a day
  /// nobody was rostered.
  const readiness = useQuery({
    queryKey: punchKeys.readiness(unitId ?? "", date.slice(0, 7)),
    queryFn: ({ signal }) =>
      punchReadiness(unitId ?? "", date.slice(0, 7), signal),
    enabled: unitId !== null,
  })
  /// **Bounded to the unit the day is about**, not to the caller — the same
  /// correction `roster.tsx` carries. Head office reaches every unit, so an
  /// unbounded ask would serve the whole company's names against one unit's
  /// day.
  const team = useQuery({
    queryKey: peopleKeys.employees({
      status: "ACTIVE",
      unitId: unitId ?? undefined,
      limit: 1000,
    }),
    queryFn: ({ signal }) =>
      listEmployees(
        { status: "ACTIVE", unitId: unitId ?? undefined, limit: 1000 },
        signal
      ),
    enabled: unitId !== null,
  })
  /// Only so a shift reads as "Pagi 07:00–15:00" rather than as its id.
  /// `AttendanceDayView` carries `shift_id` and no name, because it is a view
  /// of a derivation rather than of a rota.
  const shifts = useQuery({
    queryKey: rosterKeys.shifts(),
    queryFn: ({ signal }) => listShifts(signal),
  })

  const named = useMemo(() => {
    const map = new Map<string, { who: string; code: string }>()
    for (const one of team.data ?? []) {
      map.set(one.employee_id, {
        who: one.full_name ?? one.employee_code,
        code: one.employee_code,
      })
    }
    return map
  }, [team.data])

  const stationNames = useMemo(
    () => new Map((stations.data ?? []).map((one) => [one.id, one.name])),
    [stations.data]
  )

  const shiftName = useMemo(() => {
    const map = new Map<string, string>()
    for (const shift of shifts.data ?? []) {
      map.set(shift.id, `${shift.name} ${shift.starts_at}–${shift.ends_at}`)
    }
    return map
  }, [shifts.data])

  /// One shared empty array per list rather than `?? []` at each site: a fresh
  /// `[]` every render is a new dependency every render, which rebuilds the
  /// table and re-derives the enrolment set while the day is still in flight.
  const days = view.data?.days ?? NO_DAYS
  const underivable = view.data?.underivable ?? NO_UNDERIVABLE
  const punches = view.data?.punches ?? NO_PUNCHES
  const connected = view.data?.punch_source_connected ?? false
  const posture = postureOf(connected, stations.data)

  /// Everybody this day mentions, which is the roster's set rather than the
  /// unit's payroll. It is the bound on the enrolment reads below: a day at one
  /// shop is a dozen people, and asking for the company's would be a request
  /// per employee for an answer nobody on this screen needs.
  const mentioned = useMemo(() => {
    const ids = new Set<string>()
    for (const one of days) ids.add(one.employee_id)
    for (const one of underivable) ids.add(one.employee_id)
    return [...ids]
  }, [days, underivable])

  /// Whether each rostered person could have clocked in at all.
  ///
  /// One request per person because that is the route there is — `/fingerprints`
  /// is per employee, and `TerminalRow.enrolled_people` is a count of the unit
  /// rather than a list of names. A count answers "are we ready"; this screen
  /// has to answer "whose empty row is not an absence", which needs the name.
  ///
  /// Not asked at all when nothing is registered here: with no station the
  /// answer is the same for everybody and the sentence above the day already
  /// says it.
  const enrolment = useQueries({
    queries: mentioned.map((id) => ({
      queryKey: punchKeys.enrolment(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readEnrolment(id, signal),
      enabled: connected,
    })),
    // `combine` rather than a memo over the results: `useQueries` hands back a
    // new array every render, so a memo keyed on it never holds.
    combine: (answers) => {
      const can = new Map<string, boolean>()
      let unread = 0
      answers.forEach((answer, index) => {
        const id = mentioned[index]
        if (id === undefined) return
        if (answer.data !== undefined) can.set(id, answer.data.can_clock_in)
        else if (answer.isError) unread += 1
      })
      return { can, unread }
    },
  })

  const rows = useMemo<DayRow[]>(
    () =>
      days.map((one) => {
        const who = named.get(one.employee_id)
        const planned =
          one.plan === "SCHEDULED"
            ? one.shift_id === null
              ? "Scheduled"
              : (shiftName.get(one.shift_id) ?? one.shift_id)
            : one.plan === "REST_DAY"
              ? "Rest day"
              : "Public holiday"
        return {
          employeeId: one.employee_id,
          who: who?.who ?? one.employee_id,
          plan: planned,
          arrival: one.arrival,
          departure: one.departure,
          outcomes: one.outcomes,
          lateMinutes: one.late_minutes,
          earlyMinutes: one.early_leave_minutes,
          overtimeAgreed: one.overtime_minutes_agreed,
          overtimeUnagreed: one.overtime_minutes_unagreed,
          workedMinutes: one.net_worked_minutes,
          punchesConsidered: one.punches_considered,
          correction: one.applied_correction,
          policyVersion: one.policy_version,
          canClockIn: enrolment.can.get(one.employee_id) ?? null,
        }
      }),
    [days, named, shiftName, enrolment.can]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: DayRow) => row.employeeId,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  /// Punches from somebody with no roster line that day.
  ///
  /// They are in `punches` and in none of the rows, because the day's rows are
  /// driven by the roster — so without this section a punch is counted nowhere
  /// and looks like nothing happened. Which of the two is wrong is not this
  /// screen's to decide: either the plan missed somebody who worked, or
  /// somebody punched who should not have.
  const unrostered = useMemo(() => {
    const rostered = new Set(mentioned)
    return punches.filter((one) => !rostered.has(one.employee_id))
  }, [punches, mentioned])

  const blocked = mentioned.filter((id) => enrolment.can.get(id) === false)
  const arrived = rows.filter((row) => row.arrival !== null).length
  const late = rows.filter((row) => row.outcomes.includes("LATE")).length
  const future = date > today

  /// Draw the day when there is something that could have recorded it, or when
  /// there are punches in hand to show. A suspended or never-heard-from station
  /// with no punches is the same situation as no station at all — the
  /// difference is only which sentence explains it — and drawing a grid of
  /// dashes for either is the thing this screen exists not to do.
  const drawing =
    connected &&
    (punches.length > 0 ||
      posture.kind === "REGISTERED" ||
      posture.kind === "REPORTING")

  return (
    <PageContent>
      <PageHeader
        title="Attendance"
        // On a phone the unit and the day are the chips over the bottom bar and
        // filing a correction is the round +.
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setCorrecting(true)}>
              File correction
            </Button>
          )
        }
      />
      {phone && (
        <>
          <UnitChoice
            unitId={unitId}
            units={unit.units}
            onChange={unit.setUnitId}
          />
          <DayChoice value={date} onChange={setDate} />
          <Fab label="File correction" onClick={() => setCorrecting(true)} />
        </>
      )}

      {/* The counters are drawn from the rows the server sent, and only when
          something reported them. A strip of zeros is the same lie as a grid of
          them, told in larger type.
          "Days accounted for" is the derivation's own count and not a
          headcount: a rest day nobody worked produces no row at all, which is
          the server declining to say anything about a day there is nothing to
          say about. */}
      {drawing && (
        <KpiStrip>
          <Kpi label="Days accounted for" value={count(rows.length)} />
          <Kpi label="Arrived" value={count(arrived)} />
          <Kpi label="Late" value={count(late)} />
          <Kpi
            label={date === today ? "Not arrived yet" : "No arrival recorded"}
            value={count(rows.length - arrived)}
          />
          <Kpi label="Could not be derived" value={count(underivable.length)} />
          <Kpi label="Punches recorded" value={count(punches.length)} />
        </KpiStrip>
      )}

      {!phone && (
        <Toolbar>
          <UnitChoice
            unitId={unitId}
            units={unit.units}
            onChange={unit.setUnitId}
          />
          {/* A day at a time, because attendance is asked about a day. The
          picker stays for the jump to a month back. */}
          <ButtonGroup>
            <Button
              variant="ghost"
              aria-label="Previous day"
              onClick={() => setDate(addDays(date, -1))}
            >
              <ChevronLeft className="size-4 stroke-[1.7]" />
            </Button>
            <Button variant="ghost" onClick={() => setDate(todayIso())}>
              Today
            </Button>
            <Button
              variant="ghost"
              aria-label="Next day"
              onClick={() => setDate(addDays(date, 1))}
            >
              <ChevronRight className="size-4 stroke-[1.7]" />
            </Button>
          </ButtonGroup>
          <Day
            value={date}
            onChange={(next) => {
              // A day-shaped screen has no "any day": there is always a date
              // whose attendance is being read, so cleared is not a state
              // this screen can be in.
              if (next !== "") setDate(next)
            }}
            clearable={false}
            className="h-8 w-36"
          />
        </Toolbar>
      )}

      {unitId === null && !unit.choosing && (
        <Banner tone="warn" className="mb-4">
          You are not posted anywhere, so there is no unit to read.
        </Banner>
      )}

      {future && (
        <Banner tone="info" className="mb-4">
          {day(date)} has not happened yet.
        </Banner>
      )}

      {/* Only once the day has actually answered, and only over a day that is
          drawn: a failed read leaves `punch_source_connected` at its default,
          and posting "no station has ever reported" because a request fell
          over is inventing a fact about a unit out of a network error. When
          nothing is drawn the empty card says the same thing. */}
      {drawing && view.data !== undefined && <Source posture={posture} />}

      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <CardHeader>
          <CardTitle>{weekday(date, true)}</CardTitle>
          {posture.kind === "REPORTING" && (
            <span className="text-meta text-mute">
              last punch delivered {moment(posture.last)}
            </span>
          )}
        </CardHeader>
        {queryState(view, {
          loading: "Deriving the day…",
          refused: <EmptyState>This unit is outside your reach.</EmptyState>,
          render: () =>
            !drawing ? (
              <EmptyState>{unsaid(posture, unit.name)}</EmptyState>
            ) : rows.length === 0 ? (
              <EmptyState>
                Nobody was rostered at {unit.name ?? "this unit"} on {day(date)}
                .
              </EmptyState>
            ) : (
              <DataTable<DayRow>
                refresh={[view]}
                table={table}
                onRowClick={(row) => person.open(row.employeeId)}
                isSelected={(row) => row.employeeId === person.value}
                cardsApart
                cardLead
                cardSort={false}
              />
            ),
        })}
      </Card>

      {underivable.length > 0 && (
        <Underivable rows={underivable} named={named} />
      )}

      {blocked.length > 0 && (
        <CannotClockIn
          ids={blocked}
          named={named}
          unread={enrolment.unread}
          onOpen={(id) => person.open(id)}
        />
      )}

      {unrostered.length > 0 && (
        <Unrostered
          rows={unrostered}
          named={named}
          stationNames={stationNames}
        />
      )}

      <div className="grid gap-[1.125rem] lg:grid-cols-2">
        <Stations query={stations} unit={unit.name} />
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>{monthYear(date)} so far</CardTitle>
          </CardHeader>
          <div className="px-4 pb-4">
            {queryState(readiness, {
              loading: "Recomputing the month…",
              render: (month) => (
                <>
                  {/* Never a number when the server sent `null`. It means this
                      unit has no station, so there was nothing to count — and
                      a `0` there is what lets a month be signed off as clean
                      when half of it was never examined. */}
                  <KeyValue term="Corrections still open">
                    {month.open_corrections === null
                      ? "not assessed"
                      : count(month.open_corrections)}
                  </KeyValue>
                  <KeyValue term="Punch days with nobody rostered">
                    {month.unrostered_punch_days === null
                      ? "not assessed"
                      : count(month.unrostered_punch_days)}
                  </KeyValue>
                </>
              ),
            })}
          </div>
        </Card>
      </div>

      <FileCorrectionSheet
        open={correcting}
        onClose={() => setCorrecting(false)}
        defaultDate={date}
        people={(team.data ?? []).map((one) => ({
          value: one.employee_id,
          label: one.full_name ?? one.employee_code,
        }))}
      />

      <PersonSheet
        employeeId={person.value ?? null}
        who={
          person.value === undefined
            ? null
            : (named.get(person.value)?.who ?? person.value)
        }
        code={
          person.value === undefined
            ? null
            : (named.get(person.value)?.code ?? null)
        }
        date={date}
        punches={punches}
        stationNames={stationNames}
        onClose={person.close}
      />
    </PageContent>
  )
}

/// The sentence that stands where the day would have been.
///
/// One per posture, because "no station is registered" and "the station has
/// never delivered anything" are different problems with different people to
/// go and see, and a single "no data" would send both of them nowhere.
function unsaid(posture: Posture, unit: string | null): string {
  const here = unit ?? "this unit"
  switch (posture.kind) {
    case "UNREGISTERED":
      return `No punch station is registered at ${here}, so nobody there can clock in. Register one under System › Devices.`
    case "SUSPENDED":
      return `${posture.stations === 1 ? "The one station" : `All ${posture.stations} stations`} at ${here} ${posture.stations === 1 ? "is" : "are"} suspended, so nothing was punched.`
    case "SILENT":
      return `${posture.stations === 1 ? "A station is" : `${posture.stations} stations are`} registered at ${here}, and ${posture.stations === 1 ? "it has" : "none has"} not delivered a punch yet.`
    default:
      return `Nothing to show for ${here}.`
  }
}

/// What the unit's punch source is, above a day that is drawn anyway.
function Source({ posture }: { posture: Posture }) {
  switch (posture.kind) {
    case "SUSPENDED":
      return (
        <Banner tone="warn" className="mb-4">
          Every station here is suspended, so readings stop at the device.
        </Banner>
      )
    case "SILENT":
      return (
        <Banner tone="warn" className="mb-4">
          A station is registered here but has never delivered a punch.
        </Banner>
      )
    default:
      return null
  }
}

/// Where a punch was taken: the station's name, or the person's own app.
function sourceOf(
  row: PunchRow,
  stationNames: ReadonlyMap<string, string>
): string {
  if (row.terminal_id === null)
    return row.source === "EMPLOYEE_APP" ? "Employee app" : "—"
  return stationNames.get(row.terminal_id) ?? row.terminal_id
}

/// Days the derivation would not classify, with the sentence the server wrote.
///
/// Its own section, and the point of the whole screen: these are statements
/// about the **inputs** — an uncovered policy date is head office's to fix —
/// and one of them counted as an absence is somebody docked for a rule nobody
/// wrote.
function Underivable({
  rows,
  named,
}: {
  rows: readonly UnderivableDay[]
  named: Map<string, { who: string; code: string }>
}) {
  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader>
        <CardTitle>Days that could not be derived</CardTitle>
        <span className="text-meta text-mute">
          {rows.length === 1 ? "1 day" : `${rows.length} days`}
        </span>
      </CardHeader>
      <div className="px-4 pb-4">
        <MiniTable
          head={[
            "Who",
            { label: "Date", align: "left" },
            { label: "Reason", align: "left" },
          ]}
        >
          {rows.map((row) => (
            <MiniRow key={`${row.employee_id}-${row.date}-${row.reason}`}>
              <MiniCell>
                {named.get(row.employee_id)?.who ?? row.employee_id}
              </MiniCell>
              <MiniCell>{day(row.date)}</MiniCell>
              {/* Quoted, never summarised. The server's sentence names what is
                  missing and who can supply it. */}
              <MiniCell className="text-body">{row.reason}</MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
      </div>
    </Card>
  )
}

/// The people whose empty row is not an absence.
function CannotClockIn({
  ids,
  named,
  unread,
  onOpen,
}: {
  ids: readonly string[]
  named: Map<string, { who: string; code: string }>
  unread: number
  onOpen: (id: string) => void
}) {
  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader>
        <CardTitle>Cannot clock in</CardTitle>
        <span className="text-meta text-mute">
          {ids.length === 1 ? "1 person" : `${ids.length} people`}
        </span>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex flex-wrap gap-2">
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onOpen(id)}
              className="rounded-inner border border-hairline bg-soft-2 px-2.5 py-1 text-cell text-ink hover:border-accent"
            >
              {named.get(id)?.who ?? id}
            </button>
          ))}
        </div>
        {unread > 0 && (
          <p className="text-meta text-mute">
            {unread === 1
              ? "One person's enrolment could not be read."
              : `${unread} people's enrolments could not be read.`}
          </p>
        )}
      </div>
    </Card>
  )
}

/// Punches with no roster line behind them.
function Unrostered({
  rows,
  named,
  stationNames,
}: {
  rows: readonly PunchRow[]
  named: Map<string, { who: string; code: string }>
  stationNames: ReadonlyMap<string, string>
}) {
  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader>
        <CardTitle>Punched with no roster line</CardTitle>
        <span className="text-meta text-mute">
          {rows.length === 1 ? "1 reading" : `${rows.length} readings`}
        </span>
      </CardHeader>
      <div className="px-4 pb-4">
        <MiniTable
          head={[
            "Who",
            { label: "Direction", align: "left" },
            "At",
            { label: "Source", align: "left" },
            { label: "Received", align: "right" },
          ]}
        >
          {rows.map((row) => (
            <MiniRow key={row.id}>
              <MiniCell>
                {named.get(row.employee_id)?.who ?? row.employee_id}
              </MiniCell>
              <MiniCell>{label(row.direction)}</MiniCell>
              <MiniCell align="right">{row.at}</MiniCell>
              <MiniCell>{sourceOf(row, stationNames)}</MiniCell>
              <MiniCell align="right">{moment(row.received_at)}</MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
      </div>
    </Card>
  )
}

/// The stations themselves, because when the day is empty this is the answer.
///
/// Both instants are shown for the reason `TerminalRow`'s own doc gives: when
/// a station last took its templates, and when it last delivered a punch, are
/// different failures with different fixes.
function Stations({
  query,
  unit,
}: {
  query: UseQueryResult<TerminalRow[]>
  unit: string | null
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Stations</CardTitle>
      </CardHeader>
      <div className="px-4 pb-4">
        {queryState(query, {
          loading: "Reading the stations…",
          render: (rows) =>
            rows.length === 0 ? (
              <Quiet>No station is registered at {unit ?? "this unit"}.</Quiet>
            ) : (
              <MiniTable
                head={[
                  "Station",
                  { label: "Status", align: "left" },
                  "Enrolled",
                  { label: "Templates Taken", align: "right" },
                  { label: "Last Punch", align: "right" },
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.id}>
                    <MiniCell>{row.name}</MiniCell>
                    <MiniCell>
                      <Status
                        tone={
                          row.status === "ACTIVE"
                            ? "ok"
                            : row.status === "SUSPENDED"
                              ? "warn"
                              : "bad"
                        }
                      >
                        {label(row.status)}
                      </Status>
                    </MiniCell>
                    <MiniCell align="right">
                      {count(row.enrolled_people)}
                    </MiniCell>
                    <MiniCell align="right">
                      {row.synced_at === null ? "never" : moment(row.synced_at)}
                    </MiniCell>
                    <MiniCell align="right">
                      {row.punched_at === null
                        ? "never"
                        : moment(row.punched_at)}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </div>
    </Card>
  )
}

/// One person across a month, and the two things that decide how to read it.
///
/// The range rather than the day, because the day is already on the page
/// behind this sheet. What a sheet adds is the pattern: three Mondays late is
/// a conversation and one Monday late is traffic, and neither is visible in a
/// single day's row.
///
/// `attendanceOf` is registered with no record kind, so there is no activity
/// tab and there should not be — a derived day is not a record somebody
/// filed, and its history is the punches and the corrections shown here.
function PersonSheet({
  employeeId,
  who,
  code,
  date,
  punches,
  stationNames,
  onClose,
}: {
  employeeId: string | null
  who: string | null
  code: string | null
  date: string
  punches: readonly PunchRow[]
  stationNames: ReadonlyMap<string, string>
  onClose: () => void
}) {
  const { nameOf } = useActiveEmployees()
  /// Thirty days back from the day being read, not a calendar month: the
  /// question is "what has this person's month looked like", and on the 2nd a
  /// calendar month answers it with two rows.
  const from = addDays(date, -29)

  const range = useQuery({
    queryKey: punchKeys.of(employeeId ?? "", from, date),
    queryFn: ({ signal }) =>
      readAttendance(employeeId ?? "", from, date, signal),
    enabled: employeeId !== null,
  })
  const fingers = useQuery({
    queryKey: punchKeys.enrolment(employeeId ?? ""),
    queryFn: ({ signal }) => readEnrolment(employeeId ?? "", signal),
    enabled: employeeId !== null,
  })

  if (employeeId === null) return null

  const mine = punches.filter((one) => one.employee_id === employeeId)
  const canClockIn = fingers.data?.can_clock_in ?? null

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={code ?? employeeId}
      title={who ?? employeeId}
      caption={dateRange(from, date)}
      badge={
        canClockIn === false ? (
          <Pill tone="bad">No finger enrolled</Pill>
        ) : canClockIn === true ? (
          <Pill tone="ok">Can clock in</Pill>
        ) : undefined
      }
      // `table`, not the rail: six figures a line that only mean anything side
      // by side, thirty lines of them. In a 27.5rem rail each day became a
      // stack a screen tall and a month could not be seen at once.
      width="table"
      tabs={[
        {
          value: "days",
          label: "The month",
          content: (
            <>
              {range.data?.punch_source_connected === false && (
                <Banner tone="warn" className="mb-4">
                  This person's unit has no registered station, so the month is
                  the plan, not what was worked.
                </Banner>
              )}
              {queryState(range, {
                loading: "Deriving the month…",
                render: (view) =>
                  view.days.length === 0 && view.underivable.length === 0 ? (
                    <Quiet>Nothing was rostered in these thirty days.</Quiet>
                  ) : (
                    <div className="flex flex-col gap-5">
                      {view.days.length > 0 && (
                        <MiniTable
                          head={[
                            "Date",
                            "In",
                            "Out",
                            { label: "Outcome", align: "left" },
                            "Late by",
                            "Worked",
                          ]}
                        >
                          {view.days.map((one) => (
                            <MiniRow key={one.date}>
                              <MiniCell>{day(one.date)}</MiniCell>
                              <MiniCell align="right">
                                {clock(one.arrival)}
                              </MiniCell>
                              <MiniCell align="right">
                                {clock(one.departure)}
                              </MiniCell>
                              <MiniCell>
                                <span className="flex flex-wrap gap-x-4 gap-y-1">
                                  {one.outcomes.map((row) => {
                                    const read = outcome(row)
                                    return (
                                      <Status key={row} tone={read.tone}>
                                        {read.label}
                                      </Status>
                                    )
                                  })}
                                </span>
                              </MiniCell>
                              <MiniCell align="right">
                                {one.late_minutes === 0
                                  ? "—"
                                  : readMinutes(one.late_minutes)}
                              </MiniCell>
                              <MiniCell align="right">
                                {one.net_worked_minutes === 0
                                  ? "—"
                                  : readMinutes(one.net_worked_minutes)}
                              </MiniCell>
                            </MiniRow>
                          ))}
                        </MiniTable>
                      )}
                      {/* Below the days and not among them, for the same
                          reason as on the page: these say something about the
                          inputs rather than about the person. */}
                      {view.underivable.length > 0 && (
                        <div>
                          <p className="mb-2 text-eyebrow font-medium text-body uppercase">
                            Could not be derived
                          </p>
                          <MiniTable
                            head={["Date", { label: "Reason", align: "left" }]}
                          >
                            {view.underivable.map((one) => (
                              <MiniRow key={`${one.date}-${one.reason}`}>
                                <MiniCell>{day(one.date)}</MiniCell>
                                <MiniCell className="text-body">
                                  {one.reason}
                                </MiniCell>
                              </MiniRow>
                            ))}
                          </MiniTable>
                        </div>
                      )}
                    </div>
                  ),
              })}
            </>
          ),
        },
        {
          value: "punches",
          label: "What the device saw",
          content:
            mine.length === 0 ? (
              <Quiet>No reading from this person on {day(date)}.</Quiet>
            ) : (
              <MiniTable
                head={[
                  { label: "Direction", align: "left" },
                  "At",
                  { label: "Source", align: "left" },
                  { label: "Clock", align: "left" },
                  { label: "Received", align: "right" },
                ]}
              >
                {mine.map((one) => (
                  <MiniRow key={one.id}>
                    <MiniCell>{label(one.direction)}</MiniCell>
                    <MiniCell align="right">{one.at}</MiniCell>
                    <MiniCell>{sourceOf(one, stationNames)}</MiniCell>
                    {/* The gap between "the device thought it was 08:03" and
                        "it reached us at 17:40" is exactly what is asked about
                        a day a unit was offline, so the quality and the
                        arrival instant are both here rather than folded into
                        one trustworthy-looking time. */}
                    <MiniCell>
                      <Status tone={one.clock_quality === "OK" ? "ok" : "warn"}>
                        {label(one.clock_quality)}
                      </Status>
                    </MiniCell>
                    <MiniCell align="right">{moment(one.received_at)}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        },
        {
          value: "fingers",
          label: "Fingerprints",
          content: queryState(fingers, {
            loading: "Reading the enrolment…",
            render: (view) => (
              <div className="flex flex-col gap-5">
                <Facts>
                  <Fact term="Can clock in">
                    {view.can_clock_in ? "Yes" : "No — no finger on file"}
                  </Fact>
                  <Fact term="Fingers enrolled">
                    {count(view.fingers.length)}
                  </Fact>
                </Facts>
                {!view.can_clock_in && (
                  <Banner tone="warn">
                    Without a finger on file, their rostered days read as
                    absences.
                  </Banner>
                )}
                {view.fingers.length > 0 && (
                  <MiniTable
                    head={[
                      "Finger",
                      { label: "Station", align: "left" },
                      "Quality",
                      { label: "Enrolled", align: "right" },
                    ]}
                  >
                    {view.fingers.map((finger) => (
                      <MiniRow key={`${finger.finger}-${finger.revision}`}>
                        <MiniCell>{label(finger.finger)}</MiniCell>
                        <MiniCell>
                          {finger.terminal_name ?? finger.terminal_id}
                        </MiniCell>
                        {/* `null` is "the device reported none", and the
                            contract says so in as many words: not zero, which
                            would be a claim the capture was worthless. */}
                        <MiniCell align="right">
                          {finger.quality === null
                            ? "not reported"
                            : count(finger.quality)}
                        </MiniCell>
                        <MiniCell align="right">
                          {moment(finger.enrolled_at)}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                )}
                {view.history.length > 0 && (
                  <div>
                    <p className="mb-2 text-eyebrow font-medium text-body uppercase">
                      What happened to them
                    </p>
                    <Timeline
                      events={view.history.map((event, index) => ({
                        id: `${event.kind}-${event.finger}-${index}`,
                        title: `${label(event.kind)} · ${label(event.finger)}`,
                        // `null` actor is the automatic erasure on
                        // termination, which nobody decided — so it is named
                        // as that rather than left blank.
                        detail:
                          event.actor === null
                            ? "automatic, on termination"
                            : `${nameOf(event.actor)}${event.reason === null ? "" : ` · ${event.reason}`}`,
                        at: moment(event.at),
                        state:
                          index === view.history.length - 1
                            ? ("current" as const)
                            : ("done" as const),
                      }))}
                    />
                  </div>
                )}
              </div>
            ),
          }),
        },
      ]}
    >
      {/* The tabs carry everything. `<Sheet>` renders its children only when
          there are no tabs, so this is the `null` every tabbed sheet in the app
          passes rather than a body that would never be drawn. */}
      {null}
    </Sheet>
  )
}
