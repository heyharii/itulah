import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Eraser,
  Moon,
  Pencil,
  Repeat2,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"

import { Banner } from "@/components/ui/states"
import { CENTRAL_KEY_PREFIX } from "@/lib/cloud"
import { useLayout } from "@/lib/layout"
import { useParam } from "@/lib/params"
import {
  hrKeys,
  leaveRequestsOf,
  overtimeOrdersOf,
  planDay,
  rosterQuery,
  shiftsQuery,
  type StoreScope,
} from "@/lib/queries/hr"
import { describeCentre } from "@/screens/hr/centre"
import {
  DOW,
  SHIFT_COLORS,
  addDays,
  colourOf,
  dlabel,
  dnum,
  fmtH,
  initials,
  mondayOfIso,
  saveColour,
  todayIso,
  weekDays,
  weekLabel,
  weekdayIndex,
} from "@/screens/hr/rp/dates"
import { useRp } from "@/screens/hr/rp/context"
import { RpFrame, RpPortal, RpSheet, SheetHead } from "@/screens/hr/rp/kit"
import { teamRows, useTeam } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type {
  EmployeeSummary,
  LeaveRequestView,
  OvertimeOrderView,
  RosterDayView,
  ShiftView,
} from "@itulah/contract"

/// The Schedule — the hub's Roster (`frontend-hub/src/screens/people/rp/
/// roster-page.tsx`, route `/people/roster`), the same page for one shop: the
/// title row with By day / By week, the week stepper, Copy last week, Shifts
/// and Publish week; a bordered grid of people by days with their hours and a
/// Working count at the foot; a press (or a drag) on days opens the menu of
/// shifts, Off, Swap with…; the Shifts sheet; one line at the foot with an
/// Undo. The shop is fixed, so the hub's strip of stores is not here.
///
/// # What this shop cannot do that the hub can
///
///  - **Define or retire a shift.** Shift patterns are head office's, and the
///    relay carries only the read (`GET /attendance-shifts`). The Shifts sheet
///    lists them and lets a shop pick the colour it wears on this device.
///  - **Leave and overtime come one person at a time.** The hub reads the
///    company's team calendar; that call is not on the relay's list, so the
///    shop reads each person's own leave and overtime (both are), and marks
///    approved leave on the day and agreed overtime under the shift.
///  - **Publish.** A plan is in force the moment it is saved, as in the hub,
///    where the button is drawn and says so.
///
/// Every write is `POST /employees/{id}/roster` — one person, one day, with a
/// reason — and a day can be revised, never removed, so Undo is offered only
/// when every day it touched had a plan to go back to.

/// The weekly minimum a roster is held to — the hub's own constant.
const MIN_HOURS = 40
/// Said once for every day written from this page: the centre refuses a plan
/// without a reason, and a click is not the place to ask for one.
const REASON = "Planned in the roster"

type Value = string // a shift id, "OFF", "HOLIDAY", or "" for nothing planned

function valueOf(entry: RosterDayView | undefined): Value {
  if (entry === undefined) return ""
  return entry.plan === "SCHEDULED"
    ? (entry.shift_id ?? "")
    : entry.plan === "REST_DAY"
      ? "OFF"
      : "HOLIDAY"
}

export function HrRoster() {
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

function Body({ scope }: { scope: StoreScope }) {
  const { toast } = useRp()
  const client = useQueryClient()
  const phone = useLayout() === "phone"
  const unitId = scope.unit_id
  const today = todayIso()

  const [view, setView] = useState<"week" | "day">("week")
  const weekParam = useParam("week")
  const from = mondayOfIso(weekParam.value ?? today)
  const [day, setDay] = useState(today)
  const week = useMemo(() => weekDays(from), [from])
  const shownDay = week.includes(day) ? day : week[0]
  const to = addDays(from, 6)
  const goWeek = (next: string) =>
    weekParam.set(next === mondayOfIso(today) ? undefined : next)

  const plans = useQuery(rosterQuery(unitId, from, to))
  const plansLast = useQuery(
    rosterQuery(unitId, addDays(from, -7), addDays(from, -1)),
  )
  const shiftsQ = useQuery(shiftsQuery())
  const team = useTeam(scope)

  const shifts = useMemo(() => shiftsQ.data ?? [], [shiftsQ.data])
  const people = useMemo(
    () => teamRows(team.data).filter((person) => person.status === "ACTIVE"),
    [team.data],
  )

  // Leave and agreed overtime, one person at a time: the company's team
  // calendar is not something a shop's node may ask for. A person whose read
  // fails is drawn from the plan alone.
  const leaves = useQueries({
    queries: people.map((person) => ({
      queryKey: hrKeys.leaveOf(person.employee_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        leaveRequestsOf(person.employee_id, signal),
    })),
  })
  const overtimes = useQueries({
    queries: people.map((person) => ({
      queryKey: hrKeys.overtimeOf(person.employee_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        overtimeOrdersOf(person.employee_id, signal),
    })),
  })

  const planned = useMemo(() => {
    const map = new Map<string, RosterDayView>()
    for (const entry of plans.data ?? [])
      map.set(`${entry.employee_id}|${entry.on_date}`, entry)
    return map
  }, [plans.data])

  // Approved leave closes the day on this page; one still waiting does not.
  const leaveStamp = leaves.map((read) => read.dataUpdatedAt).join(",")
  const leaveOn = useMemo(() => {
    const map = new Map<string, LeaveRequestView>()
    for (const read of leaves)
      for (const span of read.data ?? []) {
        if (span.state !== "APPROVED") continue
        const last = span.to_date > to ? to : span.to_date
        for (
          let at = span.from_date < from ? from : span.from_date;
          at <= last;
          at = addDays(at, 1)
        )
          map.set(`${span.employee_id}|${at}`, span)
      }
    return map
    // `leaves` is a new array every render; its stamps say when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveStamp, from, to])

  const overtimeStamp = overtimes.map((read) => read.dataUpdatedAt).join(",")
  const overtimeOn = useMemo(() => {
    const map = new Map<string, number>()
    for (const read of overtimes)
      for (const order of read.data ?? []) {
        if (order.state !== "AGREED") continue
        if (order.on_date < from || order.on_date > to) continue
        const minutes = minutesOf(order)
        const key = `${order.employee_id}|${order.on_date}`
        map.set(key, (map.get(key) ?? 0) + minutes)
      }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overtimeStamp, from, to])

  const shiftOf = useCallback(
    (id: Value) => shifts.find((one) => one.id === id),
    [shifts],
  )
  // A colour picked in the Shifts sheet is kept in this browser; `painted`
  // says it changed, so the grid draws it at once.
  const [painted, setPainted] = useState(0)
  const colours = useMemo(
    () => new Map(shifts.map((one, i) => [one.id, colourOf(one.id, i)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shifts, painted],
  )
  const at = useCallback(
    (pid: string, iso: string): Value | "LEAVE" =>
      leaveOn.has(`${pid}|${iso}`)
        ? "LEAVE"
        : valueOf(planned.get(`${pid}|${iso}`)),
    [leaveOn, planned],
  )
  const hoursOf = useCallback(
    (pid: string) =>
      week.reduce((sum, iso) => {
        const v = at(pid, iso)
        const sh =
          v === "" || v === "OFF" || v === "HOLIDAY" || v === "LEAVE"
            ? undefined
            : shiftOf(v)
        return sum + (sh ? sh.planned_work_minutes / 60 : 0)
      }, 0),
    [at, shiftOf, week],
  )
  const startedOf = useCallback(
    (pid: string) => week.some((iso) => planned.has(`${pid}|${iso}`)),
    [planned, week],
  )
  const short = useMemo(
    () => people.filter((p) => hoursOf(p.employee_id) < MIN_HOURS),
    [people, hoursOf],
  )

  // ── writing ────────────────────────────────────────────────────────────────
  const write = useMutation({
    mutationFn: async (
      items: readonly { pid: string; iso: string; value: Value }[],
    ) => {
      for (const item of items)
        await planDay({
          employeeId: item.pid,
          onDate: item.iso,
          plan:
            item.value === "OFF"
              ? "REST_DAY"
              : item.value === "HOLIDAY"
                ? "PUBLIC_HOLIDAY"
                : "SCHEDULED",
          shiftId:
            item.value === "OFF" || item.value === "HOLIDAY"
              ? undefined
              : item.value,
          reason: REASON,
        })
    },
    onSettled: () =>
      client.invalidateQueries({
        queryKey: [CENTRAL_KEY_PREFIX, "hr", "roster"],
      }),
    onError: (error: Error) => toast(describeCentre(error)),
  })
  const nameOf = (pid: string) =>
    (people.find((p) => p.employee_id === pid)?.full_name ?? pid).split(" ")[0]

  /// Put one thing on every picked day, and say so, with an Undo when every
  /// day had a plan to go back to (a plan is revised, never taken away).
  const apply = (keys: readonly string[], value: Value) => {
    const items = keys
      .map((k) => {
        const [pid, iso] = k.split("|")
        return { pid, iso, value }
      })
      .filter((x) => at(x.pid, x.iso) !== "LEAVE" && at(x.pid, x.iso) !== value)
    if (items.length === 0) return
    const before = items.map((x) => ({
      ...x,
      value: valueOf(planned.get(`${x.pid}|${x.iso}`)),
    }))
    write.mutate(items)
    const label =
      value === "OFF"
        ? "Off"
        : value === "HOLIDAY"
          ? "Holiday"
          : (shiftOf(value)?.name ?? "")
    const canUndo = before.every((x) => x.value !== "")
    const text =
      items.length > 1
        ? `${label} · ${items.length} days`
        : `${nameOf(items[0].pid)} · ${dlabel(items[0].iso)} · ${label}`
    toast(text, canUndo ? () => write.mutate(before) : undefined)
    // A change that leaves somebody under the weekly minimum says so at once.
    const touched = new Set(items.map((x) => x.pid))
    for (const pid of touched) {
      const after = week.reduce((sum, iso) => {
        const inItems = items.find((x) => x.pid === pid && x.iso === iso)
        const v = inItems ? inItems.value : at(pid, iso)
        const sh =
          v === "" || v === "OFF" || v === "HOLIDAY" || v === "LEAVE"
            ? undefined
            : shiftOf(v)
        return sum + (sh ? sh.planned_work_minutes / 60 : 0)
      }, 0)
      if (after < MIN_HOURS) {
        toast(
          `${nameOf(pid)} has ${fmtH(after)} in ${weekLabel(from)} — under ${MIN_HOURS} h`,
          canUndo ? () => write.mutate(before) : undefined,
        )
        break
      }
    }
  }

  // ── picking days ───────────────────────────────────────────────────────────
  const [sel, setSel] = useState<string[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [swapFrom, setSwapFrom] = useState<string | null>(null)
  const drag = useRef<{ touch: boolean } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<CSSProperties>({})

  const cellKey = (el: Element | null): string | null => {
    const cell = el?.closest<HTMLElement>("[data-cell]")
    return cell ? (cell.dataset.cell ?? null) : null
  }
  const shake = (key: string) => {
    const el = rootRef.current?.querySelector<HTMLElement>(
      `[data-cell="${key}"]`,
    )
    if (!el) return
    el.classList.remove("no")
    void el.offsetWidth
    el.classList.add("no")
  }
  const pick = (key: string) => {
    const [pid, iso] = key.split("|")
    if (at(pid, iso) === "LEAVE") {
      shake(key)
      return
    }
    setSel((now) => (now.includes(key) ? now : [...now, key]))
  }

  const closeMenu = () => setMenuOpen(false)
  const clearSel = () => {
    setSel([])
    closeMenu()
  }
  const startSwap = () => {
    setSwapFrom(sel[0] ?? null)
    clearSel()
  }
  const doSwap = (key: string) => {
    if (swapFrom === null) return
    if (key === swapFrom) {
      setSwapFrom(null)
      return
    }
    const [p1, d1] = swapFrom.split("|")
    const [p2, d2] = key.split("|")
    if (at(p2, d2) === "LEAVE") {
      shake(key)
      toast("On leave — that day can't take a shift")
      return
    }
    const a = valueOf(planned.get(swapFrom))
    const b = valueOf(planned.get(key))
    if (a === "" || b === "") {
      toast("Both days need a plan to swap")
      setSwapFrom(null)
      return
    }
    const now = [
      { pid: p1, iso: d1, value: b },
      { pid: p2, iso: d2, value: a },
    ]
    write.mutate(now)
    setSwapFrom(null)
    toast(
      p1 === p2
        ? `${nameOf(p1)} · ${dlabel(d1)} ⇄ ${dlabel(d2)}`
        : `${nameOf(p1)} ⇄ ${nameOf(p2)} · ${dlabel(d1)}${d1 === d2 ? "" : ` / ${dlabel(d2)}`} swapped`,
      () =>
        write.mutate([
          { pid: p1, iso: d1, value: a },
          { pid: p2, iso: d2, value: b },
        ]),
    )
  }

  const onPointerDown = (event: React.PointerEvent) => {
    const target = event.target as Element
    if (target.closest(".menu, .sheet, .swapbar")) return
    const key = cellKey(target)
    if (swapFrom !== null) {
      event.preventDefault()
      if (key) doSwap(key)
      else setSwapFrom(null)
      return
    }
    if (key === null || event.button > 0) {
      if (sel.length > 0) clearSel()
      return
    }
    event.preventDefault()
    setSel([])
    setMenuOpen(false)
    drag.current = { touch: event.pointerType !== "mouse" }
    pick(key)
    const move = (e: PointerEvent) => {
      if (!drag.current || drag.current.touch) return
      const k = cellKey(document.elementFromPoint(e.clientX, e.clientY))
      if (k) pick(k)
    }
    const up = () => {
      document.removeEventListener("pointermove", move)
      document.removeEventListener("pointerup", up)
      if (drag.current) {
        drag.current = null
        setMenuOpen(true)
      }
    }
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", up)
  }

  // The menu opens beside the last day picked, or rises from the bottom on a phone.
  useLayoutEffect(() => {
    if (!menuOpen || sel.length === 0 || phone) return
    const last = sel[sel.length - 1]
    const anchor = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>(
        `[data-cell="${last}"]`,
      ) ?? []),
    ].find((el) => el.offsetParent !== null)
    const menu = menuRef.current
    if (!anchor || !menu) return
    const r = anchor.getBoundingClientRect()
    const w = menu.offsetWidth
    const h = menu.offsetHeight
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8))
    const below = r.bottom + 6 + h <= window.innerHeight - 8
    setMenuPos({
      left,
      top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - h),
      ["--origin" as string]: `${r.left - left + 24}px ${below ? "top" : "bottom"}`,
    })
  }, [menuOpen, sel, phone])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (swapFrom !== null) setSwapFrom(null)
        else if (sel.length > 0) clearSel()
        return
      }
      if (!menuOpen || sel.length === 0) return
      if ((e.target as Element | null)?.closest?.("input")) return
      if (/^[1-9]$/.test(e.key) && shifts[Number(e.key) - 1]) {
        apply(sel, shifts[Number(e.key) - 1].id)
        clearSel()
      }
      if (e.key === "0") {
        apply(sel, "OFF")
        clearSel()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, sel, swapFrom, shifts])

  // ── copy last week ─────────────────────────────────────────────────────────
  const copyLast = () => {
    const last = addDays(from, -7)
    const items: { pid: string; iso: string; value: Value }[] = []
    for (const p of people)
      week.forEach((iso, i) => {
        if (
          at(p.employee_id, iso) === "LEAVE" ||
          planned.has(`${p.employee_id}|${iso}`)
        )
          return
        const prev = valueOf(
          (plansLast.data ?? []).find(
            (e) =>
              e.employee_id === p.employee_id && e.on_date === addDays(last, i),
          ),
        )
        if (prev !== "") items.push({ pid: p.employee_id, iso, value: prev })
      })
    if (items.length === 0) {
      toast("Nothing empty to fill")
      return
    }
    write.mutate(items)
    toast(`${items.length} days copied from ${weekLabel(last)}`)
  }

  // ── the Shifts sheet ───────────────────────────────────────────────────────
  const [sheet, setSheet] = useState<
    null | { mode: "list" } | { mode: "form"; id: string }
  >(null)

  // ── drawing ────────────────────────────────────────────────────────────────
  const cell = (p: EmployeeSummary, iso: string) => {
    const key = `${p.employee_id}|${iso}`
    const v = at(p.employee_id, iso)
    const mark = sel.includes(key) ? "sel" : swapFrom === key ? "swapsrc" : ""
    const cls = (look: string) => ["cell", look, mark].filter(Boolean).join(" ")
    const extra = overtimeOn.get(key)
    const ot =
      extra === undefined ? null : (
        <span
          className="t ot num"
          title={`Agreed overtime ${fmtH(extra / 60)}`}
        >
          +{fmtH(extra / 60)} OT
        </span>
      )
    if (v === "LEAVE")
      return (
        <div
          className={cls("leave")}
          data-cell={key}
          title={leaveOn.get(key)?.leave_type_name}
        >
          <span className="s">Leave</span>
        </div>
      )
    if (v === "OFF" || v === "HOLIDAY")
      return (
        <div className={cls("off")} data-cell={key}>
          <span className="s">{v === "OFF" ? "Off" : "Holiday"}</span>
          {ot}
        </div>
      )
    const sh = shiftOf(v)
    if (!sh) return <div className={cls("empty")} data-cell={key} />
    return (
      <div
        className={cls("")}
        data-cell={key}
        style={{ ["--c" as string]: colours.get(sh.id) }}
        title={`${sh.starts_at}–${sh.ends_at}`}
      >
        <span className="s">{sh.name}</span>
        {ot}
      </div>
    )
  }
  const hoursLabel = (p: EmployeeSummary) => {
    if (!startedOf(p.employee_id)) return <span className="mute">—</span>
    const h = hoursOf(p.employee_id)
    const low = h < MIN_HOURS ? " bad" : ""
    return (
      <span className="hh">
        <b className={`num${low}`}>{fmtH(h)}</b>
      </span>
    )
  }
  const personName = (p: EmployeeSummary) => p.full_name ?? p.employee_code
  const cards = (
    <>
      <div className="days">
        {week.map((iso, i) => (
          <button
            key={iso}
            type="button"
            className={iso === today ? "today" : undefined}
            aria-pressed={iso === shownDay}
            onClick={() => setDay(iso)}
          >
            {DOW[i]}
            <b className="num">{dnum(iso)}</b>
          </button>
        ))}
      </div>
      <div className="plist">
        {people.map((p) => (
          <div className="prow" key={p.employee_id}>
            <div className="person">
              <div className="av">{initials(personName(p))}</div>
              <div className="who2">
                <span className="n">{personName(p)}</span>
                <span className="r num">
                  {startedOf(p.employee_id) &&
                  hoursOf(p.employee_id) < MIN_HOURS ? (
                    <span className="bad">{fmtH(hoursOf(p.employee_id))}</span>
                  ) : (
                    fmtH(hoursOf(p.employee_id))
                  )}{" "}
                  this week
                </span>
              </div>
            </div>
            {cell(p, shownDay)}
          </div>
        ))}
      </div>
    </>
  )

  const working = week.map(
    (iso) => people.filter((p) => shiftOf(at(p.employee_id, iso))).length,
  )

  // The menu's rows.
  const menu = (() => {
    if (!menuOpen || sel.length === 0) return null
    const cells = sel.map((k) => k.split("|"))
    const values = cells.map(([p, d]) => at(p, d))
    const same = (v: Value) => values.every((x) => x === v)
    const who =
      cells.length === 1
        ? `${nameOf(cells[0][0])} · ${DOW[weekdayIndex(cells[0][1])]} ${dnum(cells[0][1])}`
        : `${cells.length} days`
    return (
      <RpPortal>
        <div className="menu-scrim" hidden={!phone} onPointerDown={clearSel} />
        <div ref={menuRef} className="menu" style={menuPos} role="menu">
          <div className="mhead">{who}</div>
          {shifts.map((sh, i) => (
            <div className="mrow" key={sh.id}>
              <button
                type="button"
                className="mitem"
                style={{ ["--c" as string]: colours.get(sh.id) }}
                onClick={() => {
                  apply(sel, sh.id)
                  clearSel()
                }}
              >
                <span className="dot" />
                <span className="mn">{sh.name}</span>
                <span className="mt num">
                  {sh.starts_at}–{sh.ends_at}
                </span>
                {same(sh.id) ? (
                  <Check className="lucide" />
                ) : (
                  <span className="mk">{i + 1}</span>
                )}
              </button>
              <button
                type="button"
                className="medit phone-only"
                aria-label={`Edit ${sh.name}`}
                onClick={() => {
                  clearSel()
                  setSheet({ mode: "form", id: sh.id })
                }}
              >
                <Pencil className="lucide" />
              </button>
            </div>
          ))}
          <div className="mrule" />
          <button
            type="button"
            className="mitem"
            style={{ ["--c" as string]: "var(--line-ico)" }}
            onClick={() => {
              apply(sel, "OFF")
              clearSel()
            }}
          >
            <Moon className="lucide mi" />
            <span className="mn">Off</span>
            {same("OFF") ? (
              <Check className="lucide" />
            ) : (
              <span className="mk">0</span>
            )}
          </button>
          <button
            type="button"
            className="mitem"
            style={{ ["--c" as string]: "var(--line-ico)" }}
            disabled
            title="A plan is revised, not taken away — clearing a day needs a server step that is not built"
          >
            <Eraser className="lucide mi" />
            <span className="mn">Clear</span>
          </button>
          {cells.length === 1 && values[0] !== "" && (
            <button
              type="button"
              className="mitem"
              style={{ ["--c" as string]: "var(--line-ico)" }}
              onClick={startSwap}
            >
              <Repeat2 className="lucide mi" />
              <span className="mn">Swap with…</span>
            </button>
          )}
        </div>
      </RpPortal>
    )
  })()

  const swapName = swapFrom ? nameOf(swapFrom.split("|")[0]) : ""
  const reading = plans.isPending || team.isPending

  return (
    <div
      ref={rootRef}
      onPointerDown={onPointerDown}
      style={{ position: "relative" }}
    >
      <div className="head">
        <h1>Roster</h1>
        <span className="desk-only grow" />
        <div className="seg" role="tablist">
          <button
            type="button"
            className="desk-only"
            aria-pressed={view === "day"}
            onClick={() => setView("day")}
          >
            By day
          </button>
          <button
            type="button"
            aria-pressed={view === "week"}
            onClick={() => setView("week")}
          >
            By week
          </button>
        </div>
        <div className="step">
          <button
            type="button"
            className="icbtn"
            aria-label="Previous week"
            onClick={() => goWeek(addDays(from, -7))}
          >
            <ChevronLeft className="lucide" />
          </button>
          <span className="lbl num">{weekLabel(from)}</span>
          <button
            type="button"
            className="icbtn"
            aria-label="Next week"
            onClick={() => goWeek(addDays(from, 7))}
          >
            <ChevronRight className="lucide" />
          </button>
        </div>
        {view === "week" && (
          <button
            type="button"
            className="btn ghost desk-only"
            onClick={copyLast}
          >
            <Copy className="lucide" />
            Copy last week
          </button>
        )}
        <button
          type="button"
          className="btn green"
          onClick={() => setSheet({ mode: "list" })}
        >
          <Clock className="lucide" />
          Shifts
        </button>
        <button
          type="button"
          className="btn publish"
          disabled={short.length > 0}
          title={
            short.length > 0
              ? `${short
                  .slice(0, 4)
                  .map(
                    (p) =>
                      `${personName(p).split(" ")[0]} ${fmtH(hoursOf(p.employee_id))}`,
                  )
                  .join(", ")} — everybody needs ${MIN_HOURS} h to publish`
              : "Plans are saved as they are made; publishing the week to everyone's app needs a server step that is not built"
          }
          onClick={() =>
            toast(
              "Plans are saved as you make them — publishing needs a server step that is not built",
            )
          }
        >
          Publish week
        </button>
      </div>

      {swapFrom !== null && (
        <div className="swapbar" role="status">
          <Repeat2 className="lucide" />
          <span>
            Swapping{" "}
            <b>
              {swapName} · {dlabel(swapFrom.split("|")[1])}
            </b>{" "}
            — press the day to trade with
          </span>
          <button
            type="button"
            className="linkbtn"
            onClick={() => setSwapFrom(null)}
          >
            Cancel
          </button>
        </div>
      )}

      {plans.isError && (
        <Banner tone="bad" className="mb-4">
          {describeCentre(plans.error, "this shop's roster")}
        </Banner>
      )}

      {reading && !plans.isError ? (
        <p className="empty-note">Reading the roster…</p>
      ) : people.length === 0 ? (
        <p className="empty-note">Nobody is posted here to roster.</p>
      ) : view === "day" ? (
        <div className="dayview">
          <div className="days">
            {week.map((iso, i) => (
              <button
                key={iso}
                type="button"
                className={iso === today ? "today" : undefined}
                aria-pressed={iso === shownDay}
                onClick={() => setDay(iso)}
              >
                {DOW[i]}
                <b className="num">{dnum(iso)}</b>
              </button>
            ))}
          </div>
          <div className="card">
            <div className="dayhead">
              <span>
                {DOW[weekdayIndex(shownDay)]} {dlabel(shownDay)}
              </span>
              <span className="mute num">
                {
                  people.filter((p) => shiftOf(at(p.employee_id, shownDay)))
                    .length
                }{" "}
                working
              </span>
            </div>
            <div className="plist">
              {people.map((p) => (
                <div className="prow" key={p.employee_id}>
                  <div className="person">
                    <div className="av">{initials(personName(p))}</div>
                    <div className="who2">
                      <span className="n">{personName(p)}</span>
                      <span className="r num">
                        {startedOf(p.employee_id) &&
                        hoursOf(p.employee_id) < MIN_HOURS ? (
                          <span className="bad">
                            {fmtH(hoursOf(p.employee_id))}
                          </span>
                        ) : (
                          fmtH(hoursOf(p.employee_id))
                        )}{" "}
                        this week
                      </span>
                    </div>
                  </div>
                  {cell(p, shownDay)}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="card desk">
            <table className="rgrid">
              <colgroup>
                <col className="who" />
                {week.map((iso) => (
                  <col key={iso} />
                ))}
                <col style={{ width: 84 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Person</th>
                  {week.map((iso, i) => (
                    <th
                      key={iso}
                      className={
                        iso === today ? "today" : i > 4 ? "wkend" : undefined
                      }
                    >
                      {DOW[i]} {dnum(iso)}
                    </th>
                  ))}
                  <th className="hrs">Hours</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.employee_id}>
                    <td className="who">
                      <div className="person">
                        <div className="av">{initials(personName(p))}</div>
                        <div className="who2">
                          <span className="n">{personName(p)}</span>
                          <span className="r">{p.position ?? ""}</span>
                        </div>
                      </div>
                    </td>
                    {week.map((iso) => (
                      <td key={iso}>{cell(p, iso)}</td>
                    ))}
                    <td className="hrs">{hoursLabel(p)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Working</td>
                  {working.map((n, i) => (
                    <td key={week[i]} className="num">
                      {n}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {cards}
        </>
      )}

      {menu}

      <RpSheet open={sheet !== null} onClose={() => setSheet(null)}>
        {sheet?.mode === "list" && (
          <ShiftList
            shifts={shifts}
            colours={colours}
            daysOf={(id) =>
              people.reduce(
                (n, p) =>
                  n +
                  week.filter((iso) => at(p.employee_id, iso) === id).length,
                0,
              )
            }
            onEdit={(id) => setSheet({ mode: "form", id })}
            onClose={() => setSheet(null)}
          />
        )}
        {sheet?.mode === "form" && (
          <ShiftForm
            shift={shifts.find((s) => s.id === sheet.id)}
            taken={shifts}
            colour={colours.get(sheet.id)}
            onBack={() => setSheet({ mode: "list" })}
            onClose={() => setSheet(null)}
            onDone={(text) => {
              toast(text)
              setPainted((n) => n + 1)
              setSheet({ mode: "list" })
            }}
          />
        )}
      </RpSheet>
    </div>
  )
}

/// Minutes of overtime an order carries: what the person agreed to, else what
/// was planned.
function minutesOf(order: OvertimeOrderView): number {
  return order.authorized_minutes ?? order.planned_minutes
}

// ── the Shifts sheet ─────────────────────────────────────────────────────────

function ShiftList({
  shifts,
  colours,
  daysOf,
  onEdit,
  onClose,
}: {
  shifts: readonly ShiftView[]
  colours: Map<string, string>
  daysOf: (id: string) => number
  onEdit: (id: string) => void
  onClose: () => void
}) {
  return (
    <>
      <SheetHead title="Shifts" onClose={onClose} />
      <div className="sbody">
        {shifts.map((sh) => (
          <button
            key={sh.id}
            type="button"
            className="srow"
            style={{ ["--c" as string]: colours.get(sh.id) }}
            onClick={() => onEdit(sh.id)}
          >
            <span className="tile">
              <i />
            </span>
            <span className="who2">
              <span className="n">{sh.name}</span>
              <span className="r num">
                {sh.starts_at}–{sh.ends_at} ·{" "}
                {fmtH(sh.planned_work_minutes / 60)}
              </span>
            </span>
            <span className="cnt num">
              {daysOf(sh.id)} {daysOf(sh.id) === 1 ? "day" : "days"} this week
            </span>
            <Pencil className="lucide pen" />
          </button>
        ))}
        {shifts.length === 0 && (
          <p className="empty-note">Head office has not defined a shift yet.</p>
        )}
      </div>
    </>
  )
}

/// A shift, as head office defined it. A shop cannot change its name or hours
/// (and a plan already names it), so the one thing here is the colour it wears
/// on this device.
function ShiftForm({
  shift,
  taken,
  colour,
  onBack,
  onClose,
  onDone,
}: {
  shift: ShiftView | undefined
  taken: readonly ShiftView[]
  colour: string | undefined
  onBack: () => void
  onClose: () => void
  onDone: (text: string) => void
}) {
  const used = new Set(taken.map((s, i) => colourOf(s.id, i)))
  const [chosen, setChosen] = useState(
    colour ?? SHIFT_COLORS.find((c) => !used.has(c)) ?? SHIFT_COLORS[0],
  )
  if (shift === undefined) return null

  return (
    <>
      <SheetHead title={shift.name} back={onBack} onClose={onClose} />
      <div className="sbody form roomy">
        <div className="sform">
          <div className="fld">
            <label htmlFor="sName">Name</label>
            <input id="sName" value={shift.name} disabled readOnly />
          </div>
          <div className="row2">
            <div className="fld">
              <label htmlFor="sStart">Starts</label>
              <input
                id="sStart"
                type="time"
                value={shift.starts_at}
                disabled
                readOnly
              />
            </div>
            <div className="fld">
              <label htmlFor="sEnd">Ends</label>
              <input
                id="sEnd"
                type="time"
                value={shift.ends_at}
                disabled
                readOnly
              />
            </div>
          </div>
          <div className="fld">
            <label>Colour</label>
            <div className="swatches">
              {SHIFT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  style={{ ["--c" as string]: c }}
                  aria-label="Colour"
                  aria-pressed={c === chosen}
                  onClick={() => setChosen(c)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="sfoot sform">
        <span className="sum num">
          {fmtH(shift.planned_work_minutes / 60)} of work
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => {
            saveColour(shift.id, chosen)
            onDone(`${shift.name} saved`)
          }}
        >
          Save
        </button>
      </div>
    </>
  )
}
