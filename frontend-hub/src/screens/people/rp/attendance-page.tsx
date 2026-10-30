import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Check, ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo, useState, type CSSProperties } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useUnits } from "@/lib/queries/organisation"
import {
  attendancePeriods,
  closePeriod,
  fileCorrection,
  leaveExtraKeys,
  listCorrections,
  listEmployees,
  listShifts,
  peopleKeys,
  punchKeys,
  readAttendance,
  rosterKeys,
  teamCalendar,
} from "@/lib/queries/people"
import { useFoldPanel } from "@/lib/panel-fold"
import { cn } from "@/lib/utils"
import { useUnit } from "@/screens/people/parts"
import {
  DOW,
  RpFrame,
  RpSheet,
  SheetHead,
  StoresStrip,
  addDays,
  dlabel,
  dnum,
  fmtH,
  initials,
  mondayOfIso,
  monthLabel,
  storeTiles,
  todayIso,
  weekDays,
  weekLabel,
  weekdayIndex,
  useRp,
} from "@/screens/people/rp/kit"
import type { AttendanceDayView, EmployeeSummary } from "@itulah/contract"

/// Attendance, ported from `roster-prototype.html`: a month of letters, a week of
/// clock times, or a day a person a row. A day somebody has not answered for is
/// open, and a month with open days cannot be approved.

type Kind =
  | "leave"
  | "off"
  | "none"
  | "future"
  | "wait"
  | "absent"
  | "noout"
  | "today"
  | "late"
  | "ok"
interface Stat {
  readonly kind: Kind
  readonly day?: AttendanceDayView
  readonly fixed: boolean
}
type Filter = "all" | "late" | "absent" | "noout"
type View = "day" | "week" | "month"

const monthDays = (ym: string) => {
  const [y, m] = ym.split("-").map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from(
    { length: n },
    (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`
  )
}
const addMonths = (ym: string, n: number) =>
  new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1))
    .toISOString()
    .slice(0, 7)
const dayName = (iso: string) => `${DOW[weekdayIndex(iso)]} ${dlabel(iso)}`
/// `2026-09-13 08:03` → `08:03`; a next-day `02:00+1` keeps its `+1`.
const clock = (stamp: string | null) =>
  stamp === null
    ? ""
    : stamp.includes(" ")
      ? stamp.slice(stamp.indexOf(" ") + 1)
      : stamp
const hoursOfMin = (m: number) => Math.round((m / 60) * 10) / 10
/// `Mon 03 Nov`: the day as a square's tooltip says it.
const dayTip = (iso: string) =>
  `${DOW[weekdayIndex(iso)]} ${iso.slice(8, 10)} ${dlabel(iso).split(" ")[1]}`

function statOf(
  day: AttendanceDayView | undefined,
  iso: string,
  today: string
): Stat {
  if (day === undefined) return { kind: "none", fixed: false }
  const fixed = day.applied_correction !== null
  if (day.outcomes.includes("APPROVED_LEAVE"))
    return { kind: "leave", day, fixed }
  if (day.plan !== "SCHEDULED") return { kind: "off", day, fixed }
  if (day.shift_id === null) return { kind: "none", day, fixed }
  if (iso > today) return { kind: "future", day, fixed }
  if (day.outcomes.includes("ABSENT")) {
    // Today is not over: "absent" is a verdict about a finished day, and nobody
    // has arrived yet for a day that is only starting.
    if (iso === today && day.arrival === null)
      return { kind: "wait", day, fixed }
    return { kind: "absent", day, fixed }
  }
  if (day.arrival !== null && day.departure === null && iso === today)
    return { kind: "today", day, fixed }
  if (
    day.outcomes.includes("MISSING_PUNCH") ||
    (day.arrival !== null && day.departure === null)
  )
    return { kind: "noout", day, fixed }
  if (day.outcomes.includes("LATE")) return { kind: "late", day, fixed }
  return { kind: "ok", day, fixed }
}
const isOpen = (s: Stat) =>
  (s.kind === "absent" || s.kind === "noout") && !s.fixed
const otOf = (s: Stat) =>
  s.kind === "ok" || s.kind === "late"
    ? hoursOfMin(s.day?.overtime_minutes_agreed ?? 0)
    : 0
const PRESENT: readonly Kind[] = ["ok", "late", "noout", "today"]

/// The month is a grid of colour: one small square a day, and the words are in
/// its tooltip and in the legend. Today (arrived, not out yet) is Present; a
/// day not yet over with nobody in, a day not yet come and a day nobody planned
/// are all the same faint outline, because none of them says "absent".
type Square = "present" | "late" | "absent" | "leave" | "off" | "noout" | "none"
const SQUARE_OF: Record<Kind, Square> = {
  ok: "present",
  today: "present",
  late: "late",
  absent: "absent",
  leave: "leave",
  off: "off",
  noout: "noout",
  none: "none",
  future: "none",
  wait: "none",
}
const LEGEND: readonly (readonly [Square, string])[] = [
  ["present", "Present"],
  ["late", "Late"],
  ["absent", "Absent"],
  ["leave", "Leave"],
  ["off", "Off"],
  ["noout", "No clock-out"],
  ["none", "Not rostered / not yet"],
]

export function AttendancePage() {
  return (
    <RpFrame>
      <Body />
    </RpFrame>
  )
}

type SheetState =
  | { kind: "person"; emp: string }
  | { kind: "day"; emp: string; date: string; fromPerson: boolean }
  | null

function Body() {
  const { toast } = useRp()
  const client = useQueryClient()
  const navigate = useNavigate()
  const unit = useUnit()
  const unitId = unit.unitId
  const register = useUnits()
  const tiles = storeTiles(unit.units, register.data)
  const here = tiles.find((t) => t.id === unitId)
  const today = todayIso()

  const [view, setView] = useState<View>("month")
  const [date, setDate] = useState(today)
  const [filter, setFilter] = useState<Filter>("all")
  const [sheet, setSheet] = useState<SheetState>(null)
  const [form, setForm] = useState({ in: "", out: "", reason: "" })
  const month = date.slice(0, 7)
  // The month is 31 columns wide: the screens panel steps aside while it is on.
  useFoldPanel(view === "month")

  const week = useMemo(() => weekDays(mondayOfIso(date)), [date])
  const ds = useMemo(
    () =>
      view === "month" ? monthDays(month) : view === "week" ? week : [date],
    [view, month, week, date]
  )
  const from = view === "month" ? `${month}-01` : week[0]
  const to = view === "month" ? ds[ds.length - 1] : week[6]

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
  const people = useMemo(() => team.data ?? [], [team.data])
  const shiftsQ = useQuery({
    queryKey: rosterKeys.shifts(),
    queryFn: ({ signal }) => listShifts(signal),
  })
  const shifts = useMemo(
    () => new Map((shiftsQ.data ?? []).map((s) => [s.id, s])),
    [shiftsQ.data]
  )

  const readings = useQueries({
    queries: people.map((p) => ({
      queryKey: punchKeys.of(p.employee_id, from, to),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readAttendance(p.employee_id, from, to, signal),
    })),
  })
  const stamp = readings.map((r) => r.dataUpdatedAt).join(",")
  const byKey = useMemo(() => {
    const map = new Map<string, AttendanceDayView>()
    for (const reading of readings)
      for (const day of reading.data?.days ?? [])
        map.set(`${day.employee_id}|${day.date}`, day)
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp])
  const loading = readings.some((r) => r.isPending) || team.isPending

  const periods = useQuery({
    queryKey: rosterKeys.periods(unitId ?? ""),
    queryFn: ({ signal }) => attendancePeriods(unitId ?? "", signal),
    enabled: unitId !== null,
  })
  const period = (periods.data ?? []).find((p) => p.period === month) ?? null
  const approved = period?.status === "CLOSED"

  const pending = useQuery({
    queryKey: punchKeys.corrections(unitId, true),
    queryFn: ({ signal }) =>
      listCorrections({ unit: unitId ?? undefined, pending: true }, signal),
    enabled: unitId !== null,
  })
  const waiting = useMemo(
    () =>
      new Set(
        (pending.data ?? []).map((c) => `${c.employee_id}|${c.business_date}`)
      ),
    [pending.data]
  )

  // Public holidays tint their column in the month. The company's calendar
  // names them; a day any person's plan calls a holiday counts too.
  const calendar = useQuery({
    queryKey: leaveExtraKeys.calendar(from, to),
    queryFn: ({ signal }) => teamCalendar(from, to, signal),
    enabled: view === "month",
  })
  const holidays = useMemo(() => {
    const map = new Map<string, string>(calendar.data?.holidays ?? [])
    for (const day of byKey.values())
      if (day.plan === "PUBLIC_HOLIDAY" && !map.has(day.date))
        map.set(day.date, "Public holiday")
    return map
  }, [calendar.data, byKey])

  const stat = (emp: string, iso: string) =>
    statOf(byKey.get(`${emp}|${iso}`), iso, today)
  const name = (p: EmployeeSummary) => p.full_name ?? p.employee_code
  const nameOf = (emp: string) => {
    const p = people.find((x) => x.employee_id === emp)
    return p ? name(p) : emp
  }
  const wanted = (p: EmployeeSummary, list: readonly string[]) =>
    filter === "all" ||
    list.some((iso) => stat(p.employee_id, iso).kind === filter)
  const shown = people.filter((p) => wanted(p, ds))

  const counts = { late: 0, absent: 0, noout: 0 }
  for (const p of people)
    for (const iso of ds) {
      const k = stat(p.employee_id, iso).kind
      if (k === "late" || k === "absent" || k === "noout") counts[k]++
    }
  const open = people.flatMap((p) =>
    ds
      .map((iso) => ({ p, iso, s: stat(p.employee_id, iso) }))
      .filter((x) => isOpen(x.s))
  )
  const readiness = period?.readiness ?? null
  const blocked =
    open.length > 0 || (readiness !== null && !readiness.can_close)
  const why = open.length
    ? `${open
        .slice(0, 4)
        .map((x) => `${name(x.p).split(" ")[0]} ${dlabel(x.iso)}`)
        .join(
          ", "
        )}${open.length > 4 ? ` and ${open.length - 4} more` : ""} still to fix`
    : readiness !== null && !readiness.can_close
      ? [
          readiness.unresolved_leave
            ? `${readiness.unresolved_leave} leave to decide`
            : "",
          readiness.unanswered_overtime
            ? `${readiness.unanswered_overtime} overtime to answer`
            : "",
          readiness.open_corrections
            ? `${readiness.open_corrections} corrections waiting`
            : "",
        ]
          .filter(Boolean)
          .join(", ") || "The month is not ready to close"
      : ""

  const approve = useMutation({
    mutationFn: () => closePeriod(unitId ?? "", month, "Attendance approved"),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: rosterKeys.periods(unitId ?? ""),
      })
      toast(
        `${here?.name ?? "Store"} · ${monthLabel(month)} attendance approved`
      )
    },
    onError: (e: Error) => toast(e.message),
  })

  const file = useMutation({
    mutationFn: async () => {
      if (sheet?.kind !== "day") return
      await fileCorrection(sheet.emp, {
        businessDate: sheet.date,
        effect: "ARRIVAL_AND_DEPARTURE",
        arrival: form.in,
        departure: form.out,
        departureDayOffset: form.out < form.in ? 1 : 0,
        reason: form.reason.trim(),
      })
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: punchKeys.all })
      const sh = sheet
      toast(
        `${sh?.kind === "day" ? nameOf(sh.emp).split(" ")[0] : ""} · ${sh?.kind === "day" ? dlabel(sh.date) : ""} correction filed — a second person approves it`
      )
      if (sh?.kind === "day" && sh.fromPerson)
        setSheet({ kind: "person", emp: sh.emp })
      else setSheet(null)
    },
    onError: (e: Error) => toast(e.message),
  })

  const openDay = (emp: string, iso: string, fromPerson = false) => {
    const d = byKey.get(`${emp}|${iso}`)
    setForm({
      in: clock(d?.arrival ?? null).slice(0, 5),
      out: clock(d?.departure ?? null).slice(0, 5),
      reason: "",
    })
    setSheet({ kind: "day", emp, date: iso, fromPerson })
  }

  const step = (by: -1 | 1) =>
    setDate(
      view === "month"
        ? `${addMonths(month, by)}-01`
        : view === "week"
          ? addDays(date, 7 * by)
          : addDays(date, by)
    )
  const stepLabel =
    view === "month"
      ? monthLabel(month)
      : view === "week"
        ? weekLabel(mondayOfIso(date))
        : dayName(date)

  // ── cells ────────────────────────────────────────────────────────────────
  const aCell = (emp: string, iso: string) => {
    const s = stat(emp, iso)
    const fix = s.fixed ? " fixed" : ""
    const ot = otOf(s)
    const om = ot ? <span className="otm num">+{fmtH(ot)}</span> : null
    const click = () => openDay(emp, iso)
    const d = s.day
    switch (s.kind) {
      case "leave":
        return (
          <div className="acell leave">
            <span>Leave</span>
          </div>
        )
      case "off":
        return (
          <div className="acell off">
            <span>Off</span>
          </div>
        )
      case "none":
      case "future":
        return (
          <div className="acell none">
            <span>—</span>
          </div>
        )
      case "wait":
        return (
          <button type="button" className="acell none" onClick={click}>
            <span>Not in yet</span>
          </button>
        )
      case "absent":
        return (
          <button
            type="button"
            className={`acell absent${fix}`}
            onClick={click}
          >
            <span>Absent</span>
          </button>
        )
      case "noout":
        return (
          <button type="button" className={`acell noout${fix}`} onClick={click}>
            <span className="num">{clock(d?.arrival ?? null) || "?"} – ?</span>
          </button>
        )
      case "today":
        return (
          <button type="button" className="acell now" onClick={click}>
            <span className="num">{clock(d?.arrival ?? null)} – …</span>
          </button>
        )
      case "late":
        return (
          <button
            type="button"
            className={cn("acell", s.fixed && "fixed", ot > 0 && "hasot")}
            onClick={click}
          >
            <span className="num">
              <b className="lt">{clock(d?.arrival ?? null)}</b> –{" "}
              {clock(d?.departure ?? null)}
            </span>
            {om}
          </button>
        )
      default:
        return (
          <button
            type="button"
            className={cn("acell", s.fixed && "fixed", ot > 0 && "hasot")}
            onClick={click}
          >
            <span className="num">
              {clock(d?.arrival ?? null)} – {clock(d?.departure ?? null)}
            </span>
            {om}
          </button>
        )
    }
  }

  /// What a square says when it is pointed at, after the date.
  const squareWords = (s: Stat) => {
    const d = s.day
    const inn = clock(d?.arrival ?? null)
    const out = clock(d?.departure ?? null)
    const span = inn ? (out ? `${inn} – ${out}` : inn) : ""
    const ot = otOf(s)
    const main: Record<Kind, string> = {
      ok: span ? `Present ${span}` : "Present",
      late: span ? `Late ${span}` : "Late",
      today: `In since ${inn}`,
      noout: inn ? `No clock-out · in ${inn}` : "No clock-out",
      absent: "Absent",
      leave: "Leave",
      off: "Off",
      wait: "Not arrived yet",
      future: "Not yet",
      none: "Not rostered",
    }
    return [
      main[s.kind],
      ot ? `Overtime +${fmtH(ot)}` : "",
      s.fixed ? "Corrected" : "",
    ]
      .filter(Boolean)
      .join(" · ")
  }

  /// A rest column: Saturday, Sunday or a public holiday.
  const isRest = (iso: string) => weekdayIndex(iso) > 4 || holidays.has(iso)

  const aSquare = (p: EmployeeSummary, iso: string) => {
    const s = stat(p.employee_id, iso)
    // A rest day nobody was planned for is an Off square, never an empty one;
    // anyone who worked it keeps the colour of the day they had.
    const rest = s.kind === "none" && isRest(iso)
    const words = rest
      ? holidays.has(iso)
        ? `Off · ${holidays.get(iso)}`
        : "Off"
      : squareWords(s)
    const title = `${dayTip(iso)} · ${words}`
    const label = `${name(p)}, ${title}`
    const cls = `sq ${rest ? "off" : SQUARE_OF[s.kind]}`
    // Leave, off and nothing have no day to open; every other square opens the
    // day, as the cell did.
    if (
      s.kind === "leave" ||
      s.kind === "off" ||
      s.kind === "none" ||
      s.kind === "future"
    )
      return (
        <span role="img" className={cls} title={title} aria-label={label} />
      )
    return (
      <button
        type="button"
        className={cls}
        title={title}
        aria-label={label}
        onClick={() => openDay(p.employee_id, iso)}
      />
    )
  }

  const workedH = (emp: string, list: readonly string[]) =>
    list.reduce(
      (n, iso) => n + (byKey.get(`${emp}|${iso}`)?.net_worked_minutes ?? 0),
      0
    ) / 60
  const personRow = (p: EmployeeSummary, iso: string) => (
    <div className="prow" key={p.employee_id}>
      <button
        type="button"
        className="person"
        onClick={() => setSheet({ kind: "person", emp: p.employee_id })}
      >
        <div className="av">{initials(name(p))}</div>
        <div className="who2">
          <span className="n">{name(p)}</span>
          <span className="r">{p.position ?? ""}</span>
        </div>
      </button>
      {aCell(p.employee_id, iso)}
    </div>
  )
  const pills = (list: readonly string[]) => (
    <div className="days">
      {list.map((iso, i) => (
        <button
          key={iso}
          type="button"
          aria-pressed={iso === date}
          className={iso === today ? "today" : ""}
          onClick={() => setDate(iso)}
        >
          {DOW[i]}
          <b className="num">{dnum(iso)}</b>
        </button>
      ))}
    </div>
  )
  const presentOn = (list: readonly EmployeeSummary[], iso: string) =>
    iso > today
      ? ""
      : list.filter((p) => PRESENT.includes(stat(p.employee_id, iso).kind))
          .length
  // ── the three views ──────────────────────────────────────────────────────
  /// One count at the right of a row: a small chip in the colour of its state,
  /// the figure darker than the tint. A zero is faint. The words are the title.
  const chip = (state: Square, label: string, value: number) => (
    <span
      key={state}
      className={cn("chip", state, value === 0 && "zero")}
      title={`${label} ${value}`}
    >
      {value}
    </span>
  )

  const monthView = () => (
    <>
      <div className="legend">
        {LEGEND.map(([sq, label]) => (
          <span key={sq}>
            <i className={`sw ${sq}`} />
            {label}
          </span>
        ))}
      </div>
      <div className="card mcard">
        <div className="mbox">
          <table
            className="rgrid month"
            style={{ "--n": ds.length } as CSSProperties}
          >
            <colgroup>
              <col className="who" />
              {ds.map((iso) => (
                <col key={iso} className="day" />
              ))}
              <col className="sumc" />
              <col className="hrc" />
              <col className="otc" />
            </colgroup>
            <thead>
              <tr>
                <th>Person</th>
                {ds.map((iso) => {
                  const hol = holidays.get(iso)
                  return (
                    <th
                      key={iso}
                      title={
                        hol === undefined
                          ? dayTip(iso)
                          : `${dayTip(iso)} · ${hol}`
                      }
                      className={cn(
                        "am-h",
                        isRest(iso) && "rest",
                        iso === today && "today"
                      )}
                    >
                      <span>{"MTWTFSS"[weekdayIndex(iso)]}</span>
                      <b className="num">{dnum(iso)}</b>
                    </th>
                  )
                })}
                <th className="sumh">Days</th>
                <th className="hrh">Worked</th>
                <th className="oth">Overtime</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const kinds = ds.map((iso) => stat(p.employee_id, iso))
                const count = (...of: Kind[]) =>
                  kinds.filter((x) => of.includes(x.kind)).length
                const otSum = kinds.reduce((n, x) => n + otOf(x), 0)
                const worked = Math.round(workedH(p.employee_id, ds))
                return (
                  <tr key={p.employee_id}>
                    <td className="who">
                      <button
                        type="button"
                        className="person pl"
                        title={
                          p.position ? `${name(p)} · ${p.position}` : name(p)
                        }
                        onClick={() =>
                          setSheet({ kind: "person", emp: p.employee_id })
                        }
                      >
                        <span className="n">{name(p)}</span>{" "}
                        {p.position && <span className="r">{p.position}</span>}
                      </button>
                    </td>
                    {ds.map((iso) => (
                      <td key={iso} className="amc">
                        {aSquare(p, iso)}
                      </td>
                    ))}
                    <td className="sumc">
                      <div className="chips">
                        {chip("present", "Present", count("ok", "today"))}
                        {chip("late", "Late", count("late"))}
                        {chip("absent", "Absent", count("absent"))}
                        {chip("leave", "Leave", count("leave"))}
                      </div>
                    </td>
                    <td
                      className={cn("hrc num", worked === 0 && "zero")}
                      title={`Worked ${fmtH(worked)}`}
                    >
                      {fmtH(worked)}
                    </td>
                    <td
                      className={cn("otc num", otSum === 0 && "zero")}
                      title={`Overtime ${otSum ? "+" : ""}${fmtH(otSum)}`}
                    >
                      {otSum ? "+" : ""}
                      {fmtH(otSum)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Present</td>
                {ds.map((iso) => (
                  <td key={iso} className="amc num">
                    {presentOn(people, iso)}
                  </td>
                ))}
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
        {shown.length === 0 && (
          <div className="empty-note">
            {loading
              ? "Reading attendance…"
              : `Nobody has this in ${monthLabel(month)}.`}
          </div>
        )}
      </div>
    </>
  )

  const weekView = () => (
    <>
      <div className="card desk">
        <table className="rgrid">
          <colgroup>
            <col className="who" />
            {ds.map((iso) => (
              <col key={iso} />
            ))}
            <col style={{ width: 84 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Person</th>
              {ds.map((iso, i) => (
                <th
                  key={iso}
                  className={iso === today ? "today" : i > 4 ? "wkend" : ""}
                >
                  {DOW[i]} {dnum(iso)}
                </th>
              ))}
              <th className="hrs">Worked</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.employee_id}>
                <td className="who">
                  <button
                    type="button"
                    className="person"
                    onClick={() =>
                      setSheet({ kind: "person", emp: p.employee_id })
                    }
                  >
                    <div className="av">{initials(name(p))}</div>
                    <div className="who2">
                      <span className="n">{name(p)}</span>
                      <span className="r">{p.position ?? ""}</span>
                    </div>
                  </button>
                </td>
                {ds.map((iso) => (
                  <td key={iso}>{aCell(p.employee_id, iso)}</td>
                ))}
                <td className="hrs">
                  {ds.some((iso) =>
                    ["ok", "late", "noout", "absent", "today"].includes(
                      stat(p.employee_id, iso).kind
                    )
                  ) ? (
                    <b className="num">
                      {fmtH(Math.round(workedH(p.employee_id, ds)))}
                    </b>
                  ) : (
                    <span className="mute">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Present</td>
              {ds.map((iso) => (
                <td key={iso} className="num">
                  {presentOn(shown, iso)}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {pills(ds)}
      <div className="plist">{shown.map((p) => personRow(p, date))}</div>
    </>
  )

  const dayView = () => {
    const list = people.filter((p) => wanted(p, [date]))
    const n = people.filter((p) =>
      PRESENT.includes(stat(p.employee_id, date).kind)
    ).length
    return (
      <div className="dayview">
        {pills(week)}
        <div className="card">
          <div className="dayhead">
            <span>{dayName(date)}</span>
            <span className="mute num">{n} present</span>
          </div>
          <div className="plist">{list.map((p) => personRow(p, date))}</div>
        </div>
      </div>
    )
  }

  // ── the sheets ───────────────────────────────────────────────────────────
  const closeSheet = () => setSheet(null)
  const daySheet = () => {
    if (sheet?.kind !== "day") return null
    const { emp, date: iso, fromPerson } = sheet
    const s = stat(emp, iso)
    const d = s.day
    const sh = d?.shift_id ? shifts.get(d.shift_id) : undefined
    const pill: Record<string, [string, string]> = {
      ok: ["On time", "ok"],
      late: [`Late ${d?.late_minutes ?? 0} min`, "warn"],
      absent: ["Absent", "bad"],
      noout: ["No clock-out", "warn"],
      today: ["In progress", "mute"],
      wait: ["Not arrived yet", "mute"],
    }
    const [pillText, pillCls] = pill[s.kind] ?? ["", "mute"]
    const ot = hoursOfMin(d?.overtime_minutes_agreed ?? 0)
    const first = nameOf(emp).split(" ")[0]
    const queued = waiting.has(`${emp}|${iso}`)
    const ready =
      form.reason.trim() !== "" &&
      form.in !== "" &&
      form.out !== "" &&
      !file.isPending
    return (
      <>
        <SheetHead
          title={nameOf(emp)}
          sub={dayName(iso)}
          back={
            fromPerson ? () => setSheet({ kind: "person", emp }) : undefined
          }
          onClose={closeSheet}
        />
        <div className="sbody form">
          <div className="sform">
            <div className="afacts">
              <div>
                <span className="l">Planned</span>
                <span className="v num">
                  {sh
                    ? `${sh.name} · ${sh.starts_at.slice(0, 5)}–${sh.ends_at.slice(0, 5)}`
                    : "—"}
                </span>
              </div>
              <div>
                <span className="l">Clocked</span>
                <span className="v num">
                  {d?.arrival
                    ? `${clock(d.arrival)} – ${clock(d.departure) || "?"}`
                    : "No punch"}
                </span>
              </div>
              <div>
                <span className="l">Status</span>
                <span className={`v ${pillCls}`}>
                  {pillText}
                  {s.fixed ? " · corrected" : ""}
                </span>
              </div>
              <div>
                <span className="l">Source</span>
                <span className="v">
                  {d?.punch_sources.length ? d.punch_sources.join(", ") : "—"}
                </span>
              </div>
              {ot > 0 && (
                <div>
                  <span className="l">Overtime</span>
                  <span className="v num" style={{ color: "var(--accent)" }}>
                    +{fmtH(ot)} · agreed in the app
                  </span>
                </div>
              )}
            </div>
            {queued && (
              <p className="anote">
                A correction is waiting for a second person to approve it.
              </p>
            )}
            {approved ? (
              <p className="anote">
                This month is approved, so the day is closed. If it was wrong,
                add an adjustment to {first}'s pay.
              </p>
            ) : (
              <>
                <div className="sub">Correct this day</div>
                <div className="row2">
                  <div className="fld">
                    <label htmlFor="aIn">In</label>
                    <input
                      id="aIn"
                      type="time"
                      value={form.in}
                      onChange={(e) => setForm({ ...form, in: e.target.value })}
                    />
                  </div>
                  <div className="fld">
                    <label htmlFor="aOut">Out</label>
                    <input
                      id="aOut"
                      type="time"
                      value={form.out}
                      onChange={(e) =>
                        setForm({ ...form, out: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="fld">
                  <label htmlFor="aReason">Reason</label>
                  <input
                    id="aReason"
                    placeholder="Fingerprint would not read"
                    value={form.reason}
                    onChange={(e) =>
                      setForm({ ...form, reason: e.target.value })
                    }
                  />
                </div>
              </>
            )}
          </div>
        </div>
        <div className="sfoot sform">
          {approved ? (
            <button
              type="button"
              className="btn"
              onClick={() => void navigate({ to: "/people/payroll" })}
            >
              Add adjustment
            </button>
          ) : (
            <>
              <span className="sum num" />
              <button
                type="button"
                className="btn red"
                disabled
                title="A correction states times; marking a day absent needs a server step that is not built"
              >
                Mark absent
              </button>
              <button
                type="button"
                className="btn"
                disabled={!ready}
                onClick={() => file.mutate()}
              >
                Save correction
              </button>
            </>
          )}
        </div>
      </>
    )
  }

  const personSheet = () => {
    if (sheet?.kind !== "person") return null
    const emp = sheet.emp
    const w = workedH(emp, monthDays(month))
    const label: Partial<Record<Kind, string>> = {
      late: "Late",
      absent: "Absent",
      noout: "No clock-out",
      today: "In progress",
      wait: "Not arrived yet",
      leave: "Leave",
      off: "Off",
    }
    return (
      <>
        <SheetHead
          title={nameOf(emp)}
          sub={`${monthLabel(month)} · ${fmtH(Math.round(w))} worked`}
          onClose={closeSheet}
        />
        <div className="sbody">
          {monthDays(month).map((iso) => {
            const s = stat(emp, iso)
            if (s.kind === "none" || s.kind === "future") return null
            const clickable =
              s.kind !== "leave" && s.kind !== "off" && s.day !== undefined
            const times =
              s.kind === "absent"
                ? "—"
                : s.day?.arrival
                  ? `${clock(s.day.arrival)} – ${clock(s.day.departure) || "?"}`
                  : ""
            const inner = (
              <>
                <span className="dn">
                  {DOW[weekdayIndex(iso)]} {dnum(iso)}
                </span>
                <span className="dt num">{times}</span>
                <span className={`st ${s.kind}`}>
                  {label[s.kind] ?? ""}
                  {s.fixed && <i className="dotb" />}
                </span>
              </>
            )
            return clickable ? (
              <button
                key={iso}
                type="button"
                className="drow click"
                onClick={() => openDay(emp, iso, true)}
              >
                {inner}
              </button>
            ) : (
              <div key={iso} className="drow">
                {inner}
              </div>
            )
          })}
        </div>
      </>
    )
  }

  return (
    <PageContent>
      <div style={{ position: "relative" }}>
        <StoresStrip
          tiles={tiles}
          value={unitId}
          onChange={(id) => unit.setUnitId(id)}
        />

        <div className="head">
          <h1>{here?.name ?? unit.name ?? "Attendance"}</h1>
          {approved && (
            <span className="pubmark">
              <Check className="lucide" />
              Approved
            </span>
          )}
          <span className="desk-only grow" />
          <div className="seg" role="tablist">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div className="step">
            <button
              type="button"
              className="icbtn"
              aria-label="Previous"
              onClick={() => step(-1)}
            >
              <ChevronLeft className="lucide" />
            </button>
            <span className="lbl num">{stepLabel}</span>
            <button
              type="button"
              className="icbtn"
              aria-label="Next"
              onClick={() => step(1)}
            >
              <ChevronRight className="lucide" />
            </button>
          </div>
          <button
            type="button"
            className="btn publish"
            disabled={
              approved || blocked || approve.isPending || unitId === null
            }
            title={why}
            onClick={() => approve.mutate()}
          >
            {approved ? "Approved" : "Approve month"}
          </button>
        </div>
        <div className="afilters">
          <div className="seg">
            <button
              type="button"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            {(
              [
                ["late", "Late"],
                ["absent", "Absent"],
                ["noout", "No clock-out"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={filter === v}
                onClick={() => setFilter(v)}
              >
                {label} <span className="cn num">{counts[v]}</span>
              </button>
            ))}
          </div>
          {!approved && open.length > 0 && (
            <span className="open bad">
              {open.length} to fix before the month can be approved
            </span>
          )}
        </div>

        {view === "month"
          ? monthView()
          : view === "week"
            ? weekView()
            : dayView()}
      </div>

      <RpSheet open={sheet !== null} onClose={closeSheet}>
        {sheet?.kind === "day" ? daySheet() : personSheet()}
      </RpSheet>
    </PageContent>
  )
}
