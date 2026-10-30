import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Check, ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

import { Banner } from "@/components/ui/states"
import { useGo } from "@/lib/go"
import {
  attendanceOf,
  closePeriod,
  correctionsQuery,
  fileCorrection,
  hrKeys,
  holidays,
  monthBounds,
  periodQuery,
  shiftsQuery,
  type StoreScope,
} from "@/lib/queries/hr"
import { describeCentre } from "@/screens/hr/centre"
import { Fixes, RecordFix, type Prefill } from "@/screens/hr/attendance-fixes"
import { useRp } from "@/screens/hr/rp/context"
import {
  DOW,
  addDays,
  dlabel,
  dnum,
  fmtH,
  initials,
  mondayOfIso,
  monthLabel,
  todayIso,
  weekDays,
  weekLabel,
  weekdayIndex,
} from "@/screens/hr/rp/dates"
import { RpFrame, RpSheet, SheetHead } from "@/screens/hr/rp/kit"
import { teamRows, usePendingSwaps, useTeam } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type { AttendanceDayView, EmployeeSummary } from "@itulah/contract"

/// Attendance — the hub's Records (`frontend-hub/src/screens/people/rp/
/// attendance-page.tsx`, route `/people/attendance-days`) for one shop, with
/// the hub's Corrections as its second tab: the title row with Day / Week /
/// Month, the stepper, Approve month; the filter chips with their counts; the
/// week of clock times, the day a person a row, the month as a square a day;
/// the day's sheet with its correction form; a person's month as a list.
/// The shop is fixed, so the hub's strip of stores is not here — and neither
/// are the parts of the hub's page the shop's relay cannot feed (stations,
/// enrolment, the health of the readers).
///
/// # Nothing here is typed in
///
/// Every status is derived at the centre, on every read, from the rota, the
/// punches, the policy in force and the approvals. A forgotten check-in is not
/// edited: it is a correction, filed by the shop and decided by somebody else,
/// and the day is derived again with it on top. Until a punch source has ever
/// reported for the shop, a rostered day reads as not assessed rather than as
/// an absence — a red square would be a claim that something looked.
///
/// # The month is one read per person
///
/// Day, Week and Month all draw from the same read of the calendar month (a
/// week that crosses a month's edge reads a little further), so stepping
/// between them costs nothing, and "Approve month" always knows every open day
/// in the month, not only the ones on screen.

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
type Tab = "records" | "corrections"

const monthDays = (ym: string) => {
  const [y, m] = ym.split("-").map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from(
    { length: n },
    (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`,
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

function statOf(
  day: AttendanceDayView | undefined,
  iso: string,
  today: string,
  assessed: boolean,
): Stat {
  if (day === undefined) return { kind: "none", fixed: false }
  const fixed = day.applied_correction !== null
  if (day.outcomes.includes("APPROVED_LEAVE"))
    return { kind: "leave", day, fixed }
  if (day.plan !== "SCHEDULED") return { kind: "off", day, fixed }
  if (day.shift_id === null) return { kind: "none", day, fixed }
  if (iso > today) return { kind: "future", day, fixed }
  // No punch source has reported for this shop: the day was not looked at.
  if (!assessed) return { kind: "none", day, fixed }
  // Today is not over: nobody is absent until they have had the day to arrive.
  if (iso === today && day.arrival === null) return { kind: "wait", day, fixed }
  if (day.outcomes.includes("ABSENT")) return { kind: "absent", day, fixed }
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

export function HrAttendance() {
  return (
    <HrWorkspace header={false}>
      {(scope) => (
        <RpFrame>
          <Body scope={scope} />
        </RpFrame>
      )}
    </HrWorkspace>
  )
}

type SheetState =
  | { kind: "person"; emp: string }
  | { kind: "day"; emp: string; date: string; fromPerson: boolean }
  | null

function Body({ scope }: { scope: StoreScope }) {
  const { toast } = useRp()
  const client = useQueryClient()
  const go = useGo()
  const unitId = scope.unit_id
  const today = todayIso()

  const [tab, setTab] = useState<Tab>("records")
  const [recording, setRecording] = useState<Prefill | null>(null)
  const [view, setView] = useState<View>("month")
  const [date, setDate] = useState(today)
  const [filter, setFilter] = useState<Filter>("all")
  const [sheet, setSheet] = useState<SheetState>(null)
  const [form, setForm] = useState({ in: "", out: "", reason: "" })
  const month = date.slice(0, 7)

  const week = useMemo(() => weekDays(mondayOfIso(date)), [date])
  const ds = useMemo(
    () =>
      view === "month" ? monthDays(month) : view === "week" ? week : [date],
    [view, month, week, date],
  )
  // One read covers the month; a week that crosses its edge reads a little
  // further so the week still has every day.
  const bounds = monthBounds(month)
  const from = view === "month" || week[0] > bounds.from ? bounds.from : week[0]
  const to = view === "month" || week[6] < bounds.to ? bounds.to : week[6]

  const team = useTeam(scope)
  const people = useMemo(
    () => teamRows(team.data).filter((person) => person.status === "ACTIVE"),
    [team.data],
  )
  const shiftsQ = useQuery(shiftsQuery())
  const shifts = useMemo(
    () => new Map((shiftsQ.data ?? []).map((s) => [s.id, s])),
    [shiftsQ.data],
  )

  const readings = useQueries({
    queries: people.map((p) => ({
      queryKey: hrKeys.attendanceOf(p.employee_id, from, to),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        attendanceOf(p.employee_id, from, to, signal),
    })),
  })
  const stamp = readings.map((r) => r.dataUpdatedAt).join(",")
  const byKey = useMemo(() => {
    const map = new Map<string, AttendanceDayView>()
    for (const reading of readings)
      for (const day of reading.data?.days ?? [])
        map.set(`${day.employee_id}|${day.date}`, day)
    return map
    // `readings` is a new array every render; its stamps say when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp])
  const loading = readings.some((r) => r.isPending) || team.isPending
  const failed = readings.find((r) => r.isError)
  const assessed = readings.some((r) => r.data?.punch_source_connected === true)

  // The days that are public holidays, for the month's heads. A calendar that
  // cannot be read leaves them untinted.
  const year = Number(month.slice(0, 4))
  const calendar = useQuery({
    queryKey: hrKeys.holidays(year),
    queryFn: ({ signal }) => holidays(year, signal),
    staleTime: 60 * 60_000,
  })
  const holidayOn = useMemo(
    () =>
      new Map(
        (calendar.data?.holidays ?? [])
          .filter((h) => h.units === null || h.units.includes(unitId))
          .map((h) => [h.date, h.name]),
      ),
    [calendar.data, unitId],
  )

  const periodRead = useQuery(periodQuery(unitId, month))
  const period = periodRead.data ?? null
  const approved = period?.status === "CLOSED"

  const pending = useQuery(correctionsQuery(unitId, true))
  const swaps = usePendingSwaps(scope)
  const waitingOn = (pending.data?.length ?? 0) + (swaps.data?.rows.length ?? 0)
  const waiting = useMemo(
    () =>
      new Set(
        (pending.data ?? []).map((c) => `${c.employee_id}|${c.business_date}`),
      ),
    [pending.data],
  )

  const stat = (emp: string, iso: string) =>
    statOf(byKey.get(`${emp}|${iso}`), iso, today, assessed)
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
  // Open days are the whole month's, whichever view is on screen.
  const monthList = monthDays(month)
  const open = people.flatMap((p) =>
    monthList
      .map((iso) => ({ p, iso, s: stat(p.employee_id, iso) }))
      .filter((x) => isOpen(x.s)),
  )
  const readiness = period?.readiness ?? null
  const blocked =
    open.length > 0 || (readiness !== null && !readiness.can_close)
  const why = open.length
    ? `${open
        .slice(0, 4)
        .map((x) => `${name(x.p).split(" ")[0]} ${dlabel(x.iso)}`)
        .join(
          ", ",
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
    mutationFn: () =>
      closePeriod({
        place: unitId,
        period: month,
        reason: "Attendance approved",
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: hrKeys.period(unitId, month) })
      toast(`${scope.label} · ${monthLabel(month)} attendance approved`)
    },
    onError: (e: Error) => toast(describeCentre(e)),
  })

  const file = useMutation({
    mutationFn: async () => {
      if (sheet?.kind !== "day") return
      await fileCorrection({
        employeeId: sheet.emp,
        businessDate: sheet.date,
        effect: "ARRIVAL_AND_DEPARTURE",
        arrival: form.in,
        departure: form.out,
        reason: form.reason.trim(),
      })
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: hrKeys.attendance() })
      const sh = sheet
      toast(
        `${sh?.kind === "day" ? nameOf(sh.emp).split(" ")[0] : ""} · ${sh?.kind === "day" ? dlabel(sh.date) : ""} correction filed — a second person approves it`,
      )
      if (sh?.kind === "day" && sh.fromPerson)
        setSheet({ kind: "person", emp: sh.emp })
      else setSheet(null)
    },
    onError: (e: Error) => toast(describeCentre(e)),
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
          : addDays(date, by),
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
    const fix = s.fixed ? " corrected" : ""
    const ot = otOf(s)
    const hasot = ot ? " hasot" : ""
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
          <div className="acell none" title="Not arrived yet">
            <span>—</span>
          </div>
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
            className={`acell${fix}${hasot}`}
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
            className={`acell${fix}${hasot}`}
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

  /// One day of the month: a coloured square, and what it means on hover.
  const square = (p: EmployeeSummary, iso: string) => {
    const s = stat(p.employee_id, iso)
    const d = s.day
    const clicks = ["ok", "late", "noout", "absent", "today"].includes(s.kind)
    const word: Record<Kind, string> = {
      ok: `Present ${clock(d?.arrival ?? null)} – ${clock(d?.departure ?? null) || "?"}`,
      today: `At work since ${clock(d?.arrival ?? null)}`,
      late: `Late ${clock(d?.arrival ?? null)}`,
      absent: "Absent",
      noout: `No clock-out · in ${clock(d?.arrival ?? null) || "?"}`,
      leave: "Leave",
      off: "Off",
      none: s.day === undefined ? "Not rostered" : "Not assessed",
      future: "Not yet",
      wait: "Not arrived yet",
    }
    // A weekend or a public holiday that nobody was rostered to work is a day
    // off, drawn as one — never a blank square.
    const dayOff =
      s.kind === "none" &&
      (s.day === undefined || s.day.shift_id === null) &&
      (weekdayIndex(iso) > 4 || holidayOn.has(iso))
    const title = `${dayName(iso)} · ${dayOff ? "Off" : word[s.kind]}${s.fixed ? " · corrected" : ""}`
    const look = dayOff
      ? "off"
      : s.kind === "today"
        ? "ok"
        : s.kind === "future" || s.kind === "wait"
          ? "none"
          : s.kind
    const fix = s.fixed ? " corrected" : ""
    return clicks ? (
      <button
        type="button"
        className={`sq ${look}${fix}`}
        title={title}
        aria-label={`${name(p)}, ${title}`}
        onClick={() => openDay(p.employee_id, iso)}
      />
    ) : (
      <div className={`sq ${look}`} title={title} />
    )
  }

  const workedH = (emp: string, list: readonly string[]) =>
    list.reduce(
      (n, iso) => n + (byKey.get(`${emp}|${iso}`)?.net_worked_minutes ?? 0),
      0,
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
  const monthView = () => {
    // Each number is the count of squares of that colour, so the column adds
    // up to what the row shows. A day still waiting for its clock-out is not
    // settled and is in none of them.
    const sums = (p: EmployeeSummary) => {
      const kinds = ds.map((iso) => stat(p.employee_id, iso).kind)
      const count = (...of: Kind[]) =>
        kinds.filter((k) => of.includes(k)).length
      return {
        present: count("ok", "today"),
        late: count("late"),
        absent: count("absent"),
        noout: count("noout"),
        leave: count("leave"),
      }
    }
    const list = shown.map((p) => {
      const t = sums(p)
      const flags = [
        t.absent ? (
          <span key="a" className="bad">
            {t.absent} absent
          </span>
        ) : null,
        t.noout ? <span key="n">{t.noout} no clock-out</span> : null,
        t.late ? <span key="l">{t.late} late</span> : null,
      ].filter(Boolean)
      return (
        <button
          key={p.employee_id}
          type="button"
          className="prow person"
          onClick={() => setSheet({ kind: "person", emp: p.employee_id })}
        >
          <div className="av">{initials(name(p))}</div>
          <div className="who2">
            <span className="n">{name(p)}</span>
            <span className="r num">
              {t.present + t.late} {t.present + t.late === 1 ? "day" : "days"}{" "}
              present
              {flags.map((f, i) => (
                <span key={i}>
                  {" · "}
                  {f}
                </span>
              ))}
            </span>
          </div>
          <ChevronRight className="lucide chev" />
        </button>
      )
    })
    return (
      <>
        <div className="card desk">
          <div className="legend">
            <span>
              <i className="sq ok" /> Present
            </span>
            <span>
              <i className="sq late" /> Late
            </span>
            <span>
              <i className="sq absent" /> Absent
            </span>
            <span>
              <i className="sq noout" /> No clock-out
            </span>
            <span>
              <i className="sq leave" /> Leave
            </span>
            <span>
              <i className="sq off" /> Off
            </span>
            <span>
              <i className="dotb" style={{ marginLeft: 0 }} /> Corrected
            </span>
          </div>
          <div className="mwrap">
            <table
              className="mgrid"
              // 22px a day, so a month never squeezes below a legible square;
              // narrower than that, the box scrolls and the ends stay put.
              style={{ minWidth: 356 + ds.length * 22 }}
            >
              <colgroup>
                <col style={{ width: 200 }} />
                {ds.map((iso) => (
                  <col key={iso} />
                ))}
                <col style={{ width: 156 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="who">Person</th>
                  {ds.map((iso) => {
                    const holiday = holidayOn.get(iso)
                    return (
                      <th
                        key={iso}
                        title={holiday}
                        className={[
                          weekdayIndex(iso) > 4 ? "wkend" : "",
                          holiday !== undefined ? "holiday" : "",
                          iso === today ? "today" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span>{"MTWTFSS"[weekdayIndex(iso)]}</span>
                        <b className="num">{dnum(iso)}</b>
                      </th>
                    )
                  })}
                  <th className="tot">Days</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const t = sums(p)
                  return (
                    <tr key={p.employee_id}>
                      <td className="who">
                        <button
                          type="button"
                          className="person"
                          title={
                            p.position === null
                              ? name(p)
                              : `${name(p)} · ${p.position}`
                          }
                          onClick={() =>
                            setSheet({ kind: "person", emp: p.employee_id })
                          }
                        >
                          <span className="n">{name(p)}</span>
                          <span className="r">{p.position ?? ""}</span>
                        </button>
                      </td>
                      {ds.map((iso) => (
                        <td key={iso}>{square(p, iso)}</td>
                      ))}
                      <td className="tot">
                        <div className="cs">
                          {(
                            [
                              ["ok", "Present", t.present],
                              ["late", "Late", t.late],
                              ["absent", "Absent", t.absent],
                              ["leave", "Leave", t.leave],
                            ] as const
                          ).map(([look, word, n]) => (
                            <span
                              key={look}
                              className={["cc", look, n === 0 ? "zero" : ""]
                                .filter(Boolean)
                                .join(" ")}
                              title={`${word} ${n}`}
                            >
                              {n}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
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
        <div className="plist">{list}</div>
      </>
    )
  }

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
                      stat(p.employee_id, iso).kind,
                    ),
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
        {shown.length === 0 && (
          <div className="empty-note">
            {loading ? "Reading attendance…" : "Nobody has this this week."}
          </div>
        )}
      </div>
      {pills(ds)}
      <div className="plist">{shown.map((p) => personRow(p, date))}</div>
    </>
  )

  const dayView = () => {
    const list = people.filter((p) => wanted(p, [date]))
    const n = people.filter((p) =>
      PRESENT.includes(stat(p.employee_id, date).kind),
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
          {list.length === 0 && (
            <div className="empty-note">
              {loading ? "Reading attendance…" : "Nobody has this on this day."}
            </div>
          )}
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
                  {pillText || (s.kind === "none" ? "Not assessed" : "—")}
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
            <button type="button" className="btn" onClick={() => go("/hr/pay")}>
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
    const w = workedH(emp, monthList)
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
          {monthList.map((iso) => {
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
    <div style={{ position: "relative" }}>
      <div className="head">
        <h1>Attendance</h1>
        <div className="seg ptabs" role="tablist">
          <button
            type="button"
            aria-pressed={tab === "records"}
            onClick={() => setTab("records")}
          >
            Records
          </button>
          <button
            type="button"
            aria-pressed={tab === "corrections"}
            onClick={() => setTab("corrections")}
          >
            Corrections
            {waitingOn > 0 && <span className="cn num"> {waitingOn}</span>}
          </button>
        </div>
        {tab === "records" && (
          <>
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
              disabled={approved || blocked || approve.isPending}
              title={why}
              onClick={() => approve.mutate()}
            >
              {approved ? "Approved" : "Approve month"}
            </button>
          </>
        )}
      </div>

      {tab === "records" ? (
        <>
          {failed !== undefined && (
            <Banner tone="bad" className="mb-4">
              {describeCentre(failed.error, "this shop's attendance")}
            </Banner>
          )}
          {!loading && failed === undefined && !assessed && (
            <Banner tone="info" className="mb-4">
              No punch source has reported for this shop yet, so rostered days
              are not assessed — nobody is marked absent.
            </Banner>
          )}
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
        </>
      ) : (
        <Fixes scope={scope} team={team.data} onNew={() => setRecording({})} />
      )}

      {recording !== null && (
        <RecordFix
          key={`${recording.employeeId ?? ""}-${recording.date ?? ""}`}
          prefill={recording}
          team={team.data}
          onClose={() => setRecording(null)}
          onDone={() => setRecording(null)}
        />
      )}

      <RpSheet open={sheet !== null} onClose={closeSheet}>
        {sheet?.kind === "day" ? daySheet() : personSheet()}
      </RpSheet>
    </div>
  )
}
