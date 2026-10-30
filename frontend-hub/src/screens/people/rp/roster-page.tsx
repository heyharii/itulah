import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Eraser,
  Moon,
  Pencil,
  Plus,
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

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { useUnits } from "@/lib/queries/organisation"
import {
  defineShift,
  leaveExtraKeys,
  listEmployees,
  listShifts,
  peopleKeys,
  planDay,
  retireShift,
  rosterKeys,
  teamCalendar,
  unitRoster,
} from "@/lib/queries/people"
import { useUnit } from "@/screens/people/parts"
import {
  DOW,
  RpFrame,
  RpSheet,
  SHIFT_COLORS,
  SheetHead,
  StoresStrip,
  addDays,
  colourOf,
  dlabel,
  dnum,
  fmtH,
  initials,
  mondayOfIso,
  saveColour,
  storeTiles,
  todayIso,
  weekDays,
  weekLabel,
  weekdayIndex,
  useRp,
} from "@/screens/people/rp/kit"
import type {
  EmployeeSummary,
  RosterDayView,
  ShiftView,
  TeamLeaveSpan,
} from "@itulah/contract"

/// The weekly minimum a roster is held to. The hub's own rule key is
/// `roster.min_weekly_hours`; until the server hands the number out it is the
/// forty the client asked for.
const MIN_HOURS = 40
/// Said once for every day written from this page: the server refuses a plan
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

export function RosterPage() {
  return (
    <RpFrame>
      <Body />
    </RpFrame>
  )
}

function Body() {
  const { toast } = useRp()
  const client = useQueryClient()
  const phone = useLayout() === "phone"
  const unit = useUnit()
  const unitId = unit.unitId
  const register = useUnits()
  const today = todayIso()

  const [view, setView] = useState<"week" | "day">("week")
  const [from, setFrom] = useState(() => mondayOfIso(today))
  const [day, setDay] = useState(today)
  const week = useMemo(() => weekDays(from), [from])
  const shownDay = week.includes(day) ? day : week[0]
  const to = addDays(from, 6)

  const plans = useQuery({
    queryKey: rosterKeys.unit(unitId ?? "", from, to),
    queryFn: ({ signal }) => unitRoster(unitId ?? "", from, to, signal),
    enabled: unitId !== null,
  })
  const shiftsQ = useQuery({
    queryKey: rosterKeys.shifts(),
    queryFn: ({ signal }) => listShifts(signal),
  })
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
  const away = useQuery({
    queryKey: leaveExtraKeys.calendar(from, to),
    queryFn: ({ signal }) => teamCalendar(from, to, signal),
  })

  const shifts = useMemo(() => shiftsQ.data ?? [], [shiftsQ.data])
  const people = useMemo(() => team.data ?? [], [team.data])
  const planned = useMemo(() => {
    const map = new Map<string, RosterDayView>()
    for (const entry of plans.data ?? [])
      map.set(`${entry.employee_id}|${entry.on_date}`, entry)
    return map
  }, [plans.data])
  // Approved leave closes the day on this page; one still waiting does not.
  const leaveOn = useMemo(() => {
    const map = new Map<string, TeamLeaveSpan>()
    for (const span of away.data?.leave ?? []) {
      if (span.state !== "APPROVED") continue
      const last = span.to_date > to ? to : span.to_date
      for (
        let at = span.fromdate < from ? from : span.fromdate;
        at <= last;
        at = addDays(at, 1)
      )
        map.set(`${span.employee_id}|${at}`, span)
    }
    return map
  }, [away.data, from, to])

  const shiftOf = useCallback(
    (id: Value) => shifts.find((one) => one.id === id),
    [shifts]
  )
  const colours = useMemo(
    () => new Map(shifts.map((one, i) => [one.id, colourOf(one.id, i)])),
    [shifts]
  )
  const at = useCallback(
    (pid: string, iso: string): Value | "LEAVE" =>
      leaveOn.has(`${pid}|${iso}`) ? "LEAVE" : valueOf(planned.get(`${pid}|${iso}`)),
    [leaveOn, planned]
  )
  const hoursOf = useCallback(
    (pid: string) =>
      week.reduce((sum, iso) => {
        const v = at(pid, iso)
        const sh = v === "" || v === "OFF" || v === "HOLIDAY" || v === "LEAVE" ? undefined : shiftOf(v)
        return sum + (sh ? sh.planned_work_minutes / 60 : 0)
      }, 0),
    [at, shiftOf, week]
  )
  const startedOf = useCallback(
    (pid: string) => week.some((iso) => planned.has(`${pid}|${iso}`)),
    [planned, week]
  )
  const short = useMemo(
    () => people.filter((p) => hoursOf(p.employee_id) < MIN_HOURS),
    [people, hoursOf]
  )

  // ── writing ────────────────────────────────────────────────────────────────
  const write = useMutation({
    mutationFn: async (
      items: readonly { pid: string; iso: string; value: Value }[]
    ) => {
      for (const item of items)
        await planDay(item.pid, {
          onDate: item.iso,
          plan:
            item.value === "OFF"
              ? "REST_DAY"
              : item.value === "HOLIDAY"
                ? "PUBLIC_HOLIDAY"
                : "SCHEDULED",
          shiftId:
            item.value === "OFF" || item.value === "HOLIDAY" ? undefined : item.value,
          reason: REASON,
        })
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: rosterKeys.unit(unitId ?? "", from, to) }),
    onError: (error: Error) => toast(error.message),
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
    const before = items.map((x) => ({ ...x, value: valueOf(planned.get(`${x.pid}|${x.iso}`)) }))
    write.mutate(items)
    const label =
      value === "OFF" ? "Off" : value === "HOLIDAY" ? "Holiday" : (shiftOf(value)?.name ?? "")
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
        const sh = v === "" || v === "OFF" || v === "HOLIDAY" || v === "LEAVE" ? undefined : shiftOf(v)
        return sum + (sh ? sh.planned_work_minutes / 60 : 0)
      }, 0)
      if (after < MIN_HOURS) {
        toast(`${nameOf(pid)} has ${fmtH(after)} in ${weekLabel(from)} — under ${MIN_HOURS} h`, canUndo ? () => write.mutate(before) : undefined)
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
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-cell="${key}"]`)
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
        ])
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
    const anchor = [...(rootRef.current?.querySelectorAll<HTMLElement>(`[data-cell="${last}"]`) ?? [])].find(
      (el) => el.offsetParent !== null
    )
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
        if (at(p.employee_id, iso) === "LEAVE" || planned.has(`${p.employee_id}|${iso}`)) return
        const prev = valueOf(
          (plansLast.data ?? []).find((e) => e.employee_id === p.employee_id && e.on_date === addDays(last, i))
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
  const plansLast = useQuery({
    queryKey: rosterKeys.unit(unitId ?? "", addDays(from, -7), addDays(from, -1)),
    queryFn: ({ signal }) => unitRoster(unitId ?? "", addDays(from, -7), addDays(from, -1), signal),
    enabled: unitId !== null,
  })

  // ── the Shifts sheet ───────────────────────────────────────────────────────
  const [sheet, setSheet] = useState<
    null | { mode: "list" } | { mode: "form"; id: string | null }
  >(null)

  // ── drawing ────────────────────────────────────────────────────────────────
  const tiles = storeTiles(unit.units, register.data)
  const here = tiles.find((t) => t.id === unitId)
  const cell = (p: EmployeeSummary, iso: string) => {
    const key = `${p.employee_id}|${iso}`
    const v = at(p.employee_id, iso)
    const cls = (extra: string) =>
      `cell${extra}${sel.includes(key) ? " sel" : swapFrom === key ? " swapsrc" : ""}`
    if (v === "LEAVE")
      return (
        <div className={cls(" leave")} data-cell={key}>
          <span className="s">Leave</span>
        </div>
      )
    if (v === "OFF" || v === "HOLIDAY")
      return (
        <div className={cls(" off")} data-cell={key}>
          <span className="s">{v === "OFF" ? "Off" : "Holiday"}</span>
        </div>
      )
    const sh = shiftOf(v)
    if (!sh) return <div className={cls(" empty")} data-cell={key} />
    return (
      <div
        className={cls("")}
        data-cell={key}
        style={{ ["--c" as string]: colours.get(sh.id) }}
        title={`${sh.starts_at}–${sh.ends_at}`}
      >
        <span className="s">{sh.name}</span>
      </div>
    )
  }
  const hoursLabel = (p: EmployeeSummary) => {
    if (!startedOf(p.employee_id)) return <span className="mute">—</span>
    const h = hoursOf(p.employee_id)
    return (
      <span className="hh">
        <b className={`num${h < MIN_HOURS ? " bad" : ""}`}>{fmtH(h)}</b>
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
                  {startedOf(p.employee_id) && hoursOf(p.employee_id) < MIN_HOURS ? (
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
    (iso) => people.filter((p) => shiftOf(at(p.employee_id, iso))).length
  )
  const shownList = people

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
      <>
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
                {same(sh.id) ? <Check className="lucide" /> : <span className="mk">{i + 1}</span>}
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
            {same("OFF") ? <Check className="lucide" /> : <span className="mk">0</span>}
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
          <button
            type="button"
            className="mitem phone-only"
            onClick={() => {
              clearSel()
              setSheet({ mode: "form", id: null })
            }}
          >
            <Plus className="lucide mi" />
            <span className="mn">New shift</span>
          </button>
        </div>
      </>
    )
  })()

  const swapName = swapFrom ? nameOf(swapFrom.split("|")[0]) : ""

  return (
    <PageContent>
      <div
        ref={rootRef}
        onPointerDown={onPointerDown}
        style={{ position: "relative" }}
      >
        <StoresStrip
          tiles={tiles}
          value={unitId}
          onChange={(id) => {
            clearSel()
            unit.setUnitId(id)
          }}
        />

        <div className="head">
          <h1>{here?.name ?? unit.name ?? "Roster"}</h1>
          <span className="grow desk-only" />
          <div className="seg" role="tablist">
            <button
              type="button"
              className="desk-only"
              aria-pressed={view === "day"}
              onClick={() => setView("day")}
            >
              By day
            </button>
            <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>
              By week
            </button>
          </div>
          <div className="step">
            <button
              type="button"
              className="icbtn"
              aria-label="Previous week"
              onClick={() => setFrom(addDays(from, -7))}
            >
              <ChevronLeft className="lucide" />
            </button>
            <span className="lbl num">{weekLabel(from)}</span>
            <button
              type="button"
              className="icbtn"
              aria-label="Next week"
              onClick={() => setFrom(addDays(from, 7))}
            >
              <ChevronRight className="lucide" />
            </button>
          </div>
          {view === "week" && (
            <button type="button" className="btn ghost desk-only" onClick={copyLast}>
              <Copy className="lucide" />
              Copy last week
            </button>
          )}
          <button type="button" className="btn green" onClick={() => setSheet({ mode: "list" })}>
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
                    .map((p) => `${personName(p).split(" ")[0]} ${fmtH(hoursOf(p.employee_id))}`)
                    .join(", ")} — everybody needs ${MIN_HOURS} h to publish`
                : "Plans are saved as they are made; publishing the week to everyone's app needs a server step that is not built"
            }
            onClick={() =>
              toast("Plans are saved as you make them — publishing needs a server step that is not built")
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
            <button type="button" className="linkbtn" onClick={() => setSwapFrom(null)}>
              Cancel
            </button>
          </div>
        )}

        {unitId === null && !unit.choosing && (
          <p className="empty-note">You are not posted anywhere, so there is no week to build.</p>
        )}

        {view === "day" ? (
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
                  {people.filter((p) => shiftOf(at(p.employee_id, shownDay))).length} working
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
                          {startedOf(p.employee_id) && hoursOf(p.employee_id) < MIN_HOURS ? (
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
                      <th key={iso} className={iso === today ? "today" : i > 4 ? "wkend" : undefined}>
                        {DOW[i]} {dnum(iso)}
                      </th>
                    ))}
                    <th className="hrs">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {shownList.map((p) => (
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
                  (n, p) => n + week.filter((iso) => at(p.employee_id, iso) === id).length,
                  0
                )
              }
              onEdit={(id) => setSheet({ mode: "form", id })}
              onNew={() => setSheet({ mode: "form", id: null })}
              onClose={() => setSheet(null)}
            />
          )}
          {sheet?.mode === "form" && (
            <ShiftForm
              shift={sheet.id ? shifts.find((s) => s.id === sheet.id) : undefined}
              taken={shifts}
              colour={sheet.id ? colours.get(sheet.id) : undefined}
              onBack={() => setSheet({ mode: "list" })}
              onClose={() => setSheet(null)}
              onDone={(text) => {
                toast(text)
                setSheet({ mode: "list" })
                void client.invalidateQueries({ queryKey: rosterKeys.shifts() })
              }}
            />
          )}
        </RpSheet>
      </div>
    </PageContent>
  )
}

// ── the Shifts sheet ─────────────────────────────────────────────────────────

function ShiftList({
  shifts,
  colours,
  daysOf,
  onEdit,
  onNew,
  onClose,
}: {
  shifts: readonly ShiftView[]
  colours: Map<string, string>
  daysOf: (id: string) => number
  onEdit: (id: string) => void
  onNew: () => void
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
                {sh.starts_at}–{sh.ends_at} · {fmtH(sh.planned_work_minutes / 60)}
              </span>
            </span>
            <span className="cnt num">
              {daysOf(sh.id)} {daysOf(sh.id) === 1 ? "day" : "days"} this week
            </span>
            <Pencil className="lucide pen" />
          </button>
        ))}
      </div>
      <div className="sfoot">
        <button type="button" className="btn" onClick={onNew}>
          <Plus className="lucide" />
          New shift
        </button>
      </div>
    </>
  )
}

const slug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + m
}

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
  const [name, setName] = useState(shift?.name ?? "")
  const [start, setStart] = useState(shift?.starts_at ?? "08:00")
  const [end, setEnd] = useState(shift?.ends_at ?? "17:00")
  const [chosen, setChosen] = useState(
    colour ?? SHIFT_COLORS.find((c) => !used.has(c)) ?? SHIFT_COLORS[0]
  )
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The server keeps a shift's name and hours as they were first said; a plan
  // already names it. So an existing shift can change its colour (kept in this
  // browser) and be retired; a new one is written whole.
  const fixed = shift !== undefined
  const span = (() => {
    let m = minutes(end) - minutes(start)
    if (m <= 0) m += 1440
    return m
  })()
  const worked = (shift ? shift.planned_work_minutes : span - (span > 360 ? 60 : 0)) / 60
  const valid = name.trim() !== "" && start !== "" && end !== ""

  const save = async () => {
    setBusy(true)
    setFailed(null)
    try {
      if (shift) {
        saveColour(shift.id, chosen)
        onDone(`${shift.name} saved`)
        return
      }
      const id = slug(name)
      await defineShift({
        id,
        name: name.trim(),
        startsAt: start,
        endsAt: end,
        crossesMidnight: minutes(end) <= minutes(start),
        unpaidBreakMinutes: span > 360 ? 60 : 0,
        breakStartsAt: "",
      })
      saveColour(id, chosen)
      onDone(`${name.trim()} saved`)
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!shift) return
    setBusy(true)
    try {
      await retireShift(shift.id)
      onDone(`${shift.name} removed — plans that name it stay as they were`)
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHead title={shift ? shift.name : "New shift"} back={onBack} onClose={onClose} />
      <div className="sbody form roomy">
        <div className="sform">
          <div className="fld">
            <label htmlFor="sName">Name</label>
            <input
              id="sName"
              value={name}
              placeholder="Kantor"
              autoComplete="off"
              disabled={fixed}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="row2">
            <div className="fld">
              <label htmlFor="sStart">Starts</label>
              <input
                id="sStart"
                type="time"
                value={start}
                disabled={fixed}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="fld">
              <label htmlFor="sEnd">Ends</label>
              <input
                id="sEnd"
                type="time"
                value={end}
                disabled={fixed}
                onChange={(e) => setEnd(e.target.value)}
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
          {failed && <p className="anote">{failed}</p>}
        </div>
      </div>
      <div className="sfoot sform">
        <span className="sum num">{fmtH(worked)} of work</span>
        {shift && (
          <button type="button" className="btn red" disabled={busy} onClick={remove}>
            Remove
          </button>
        )}
        <button type="button" className="btn" disabled={!valid || busy} onClick={save}>
          {shift ? "Save" : "Add shift"}
        </button>
      </div>
    </>
  )
}
