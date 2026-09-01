import { useMemo, useState } from "react"
import { Link, getRouteApi } from "@tanstack/react-router"
import { z } from "zod"

import { useAppForm, useSheetForm } from "@/shared/form"
import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton, Switch } from "@/components/dashboard/nav-sidebar"
import { currentMonthBounds } from "@/components/hr/month"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { AppHeading } from "@/components/app-switcher"
import { LiveAttendanceView } from "@/components/hr/attendance"
import {
  useHrAttendance,
  useHrEmployee,
  useHrEmployees,
  useHrWorkforceToday,
} from "@/components/hr/api"
import { Benefits } from "@/components/hr/benefits"
import { Documents, LiveDocuments } from "@/components/hr/documents"
import { LiveDirectoryTable } from "@/components/hr/directory"
import { Avatar, KIND_ICON, StatusDot, TypeChip } from "@/components/hr/parts"
import {
  DIVISIONS,
  allEmployees,
  LOCATIONS,
  type Employee,
  employeeOf,
  locationStats,
  tenureLabel,
} from "@/components/hr/data"
import {
  DAY_STATUS,
  LEAVE_ENTITLEMENT,
  addDays,
  mondayOf,
  rupiah,
  shiftHours,
  shiftTime,
  shiftWeek,
  STANDARD_DAY,
  useHr,
  weekLabel,
  type ChangeKind,
  type DayKey,
  type DayStatus,
  type EmployeeDraft,
  type LeaveRequest,
  type PayrollComponent,
  type PeopleRequest,
  type RequestKind,
  type ShiftId,
} from "@/components/hr/store"
import {
  cue,
  readSoundPreference,
  useInteractionSounds,
  writeSoundPreference,
} from "@/components/dashboard/use-interaction-sounds"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"
import { PreviewNotice } from "@/components/backend-status"
import type { HrStoreSearch } from "@/routes/_people/hr-store"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"

const route = getRouteApi("/_people/hr-store")

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const ROSTER_COLUMNS = "220px repeat(7, minmax(0,1fr)) 78px 44px"
const STORE_PAYROLL_COLUMNS = "226px 128px minmax(0,1fr) 132px 44px"

/** How many people a day needs on the floor before it counts as thin. */
const MIN_ON_FLOOR = 3

/** Hours print better without a trailing .0 on every cell. */
const round1 = (value: number) => Math.round(value * 10) / 10

const SUBMISSION_STATE = {
  draft: { label: "Not handed in", hue: "var(--ink-4)" },
  submitted: { label: "With Head Office", hue: "var(--honey)" },
  returned: { label: "Sent back", hue: "var(--ember)" },
  approved: { label: "Approved", hue: "var(--grass)" },
} as const

export function HrStore() {
  /* which store, which section, which roster week and whose card is open all
   * live in the URL — a manager can send any of these to someone else. Every
   * draft below stays local, because half-typed work is not a destination. */
  const { tab, locationId, week: weekParam, open: openId } = route.useSearch()
  const navigate = route.useNavigate()
  const week = weekParam ?? mondayOf()

  const setSearch = (next: Partial<HrStoreSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })
  const setLocationId = (next: string) =>
    /* a different store is a different roster and a different open card */
    setSearch({ locationId: next, open: undefined })
  /* the current week is the default, so it stays out of the URL */
  const setWeek = (next: string) =>
    setSearch({ week: next === mondayOf() ? undefined : next })
  const setOpen = (next: string | undefined) => setSearch({ open: next })

  const {
    leave,
    decideLeave,
    raiseRequest,
    requests,
    shifts,
    shiftMeta,
    weekOf,
    isInherited,
    setShift,
    setDay,
    clearWeek,
    resetWeek,
    payroll,
    payrollComponents,
    payslipsFor,
    addManualLine,
    removeManualLine,
    submissionFor,
    submitPayroll,
    attendanceOn,
    holidayOn,
    raiseChange,
    fixOn,
    raiseFix,
  } = useHr()
  const workforceResource = useHrWorkforceToday(locationId)
  const liveEmployeesResource = useHrEmployees({ locationId, limit: 200 })
  const attendanceBounds = currentMonthBounds()
  const liveAttendanceResource = useHrAttendance({
    locationId,
    ...attendanceBounds,
    limit: 200,
  })
  const [payFor, setPayFor] = useState<Employee | null>(null)
  const [fixFor, setFixFor] = useState<{
    person: Employee
    key: DayKey
  } | null>(null)
  const [recordFor, setRecordFor] = useState<{
    mode: ChangeKind
    person?: Employee
  } | null>(null)

  const openRecord = (mode: ChangeKind, person?: Employee) => {
    setRecordFor({ mode, person })
  }
  const [asking, setAsking] = useState<RequestKind | null>(null)
  const [editing, setEditing] = useState<{
    employeeId: string
    day: number
    x: number
    y: number
    column?: boolean
  } | null>(null)
  const [railHidden, setRailHidden] = useState(false)
  const [soundOn, setSoundOn] = useState(readSoundPreference)

  useInteractionSounds(soundOn)

  /* one id in the URL covers both cards: a fixture person resolves locally,
   * anything else is an Internal employee fetched by id, so a pasted link
   * opens the card without the directory having loaded first */
  const open = openId ? (employeeOf(openId) ?? null) : null
  const liveEmployeeResource = useHrEmployee(
    openId && !open ? openId : undefined
  )
  const liveEmployee =
    openId && !open ? (liveEmployeeResource.data ?? null) : null

  const stats = locationStats(locationId)
  const team = useMemo(
    () => [...stats.people].sort((a, b) => a.name.localeCompare(b.name)),
    [stats.people]
  )
  const teamIds = new Set(team.map((e) => e.id))
  const myLeave = leave.filter((l) => teamIds.has(l.employeeId))
  const pendingLeave = myLeave.filter((l) => l.status === "pending")
  const myRequests = requests.filter((r) => r.locationId === locationId)
  /* how many rostered days this week are not a standard 8 hours */
  const offStandard = team.reduce(
    (count, e) =>
      count +
      weekOf(e.id, week).filter((id) => {
        const hours = shiftHours(shiftMeta(id))
        return hours > 0 && hours !== STANDARD_DAY
      }).length,
    0
  )

  const slips = payslipsFor(locationId)
  const storeNet = slips.reduce((sum, slip) => sum + slip.net, 0)
  const manualComponents = payrollComponents.filter((c) => c.basis === "manual")
  const openRun = payroll.find((p) => p.status !== "released")
  const submission = submissionFor(openRun?.id ?? "", locationId)
  const submissionMeta = SUBMISSION_STATE[submission.status]
  /** Once payroll has gone up, the store can no longer just fix a day. */
  const payrollClosed =
    submission.status === "submitted" || submission.status === "approved"

  /** Leave taken and still pending, per person. */
  const leaveFor = (employeeId: string) => {
    const mine = leave.filter((l) => l.employeeId === employeeId)
    const taken = mine
      .filter((l) => l.status === "approved")
      .reduce((s, l) => s + l.days, 0)
    const waiting = mine
      .filter((l) => l.status === "pending")
      .reduce((s, l) => s + l.days, 0)
    return { taken, waiting, left: LEAVE_ENTITLEMENT - taken }
  }

  const navRow =
    "flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] font-medium transition-colors duration-[110ms]"

  return (
    <AppShell
      label="Store people navigation"
      railWidth={240}
      cols={
        railHidden
          ? "grid-cols-[0px_minmax(0,1fr)]"
          : "grid-cols-[240px_minmax(0,1fr)]"
      }
    >
      <AppShellSidebar className={cn(railHidden && "invisible")}>
        <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page">
          <div className="flex h-[52px] shrink-0 items-center gap-1.5 pr-2 pl-2.5">
            <AppHeading app="hr-store" />
            <IconButton
              label="Collapse sidebar"
              onClick={() => setRailHidden((v) => !v)}
            >
              <Icon path={paths.panel} size={17} />
            </IconButton>
          </div>

          {/* a store manager sees one location; the picker is here for the demo */}
          <div className="px-2 pb-2">
            <label
              htmlFor="store-pick"
              className="block px-1 pb-1 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase"
            >
              My location
            </label>
            <select
              id="store-pick"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="h-[34px] w-full rounded-control bg-surface px-2 text-[12.5px] font-medium text-ink shadow-btn outline-none focus:shadow-[0_0_0_1px_var(--accent)]"
            >
              {LOCATIONS.filter((l) => l.kind !== "ho").map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <nav className="flex-1 overflow-auto px-2 pb-2">
            {(
              [
                ["roster", "Roster", paths.rows, 0],
                [
                  "team",
                  "My team",
                  paths.people,
                  liveEmployeesResource.data?.total ?? 0,
                ],
                ["attendance", "Attendance", paths.check, 0],
                ["leave", "Leave", paths.clock, pendingLeave.length],
                ["pay", "Payroll", paths.doc, 0],
                ["benefits", "Benefits", paths.tag, 0],
              ] as const
            ).map(([id, label, icon, count]) => {
              const on = tab === id
              return (
                <Link
                  key={id}
                  to="/hr-store"
                  search={(prev) => ({ ...prev, tab: id })}
                  replace
                  data-sound="page"
                  className={cn(
                    navRow,
                    "group/nav relative text-ink-2 hover:bg-hover hover:text-ink",
                    on && "font-semibold text-ink",
                    on &&
                      "before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-[2.5px] before:rounded-r-full before:bg-ink before:content-['']"
                  )}
                >
                  <Icon
                    path={icon}
                    className={cn("shrink-0 text-ink-4", on && "text-ink-2")}
                  />
                  {label}
                  {count > 0 && (
                    <span
                      className={cn(
                        "ml-auto font-mono text-[10.5px]",
                        id === "leave" || id === "pay"
                          ? "rounded-full bg-accent px-1.5 text-white"
                          : "text-ink-4"
                      )}
                    >
                      {count}
                    </span>
                  )}
                </Link>
              )
            })}

            {/* the two things a store must ask Head Office for */}
            <div className="mt-3.5 flex h-7 items-center px-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              Ask Head Office
            </div>
            <button
              type="button"
              onClick={() => setAsking("hire")}
              className={cn(navRow, "text-ink-2 hover:bg-hover hover:text-ink")}
            >
              <Icon path={paths.plus} className="shrink-0 text-ink-4" />
              Request a hire
            </button>
            <button
              type="button"
              onClick={() => setAsking("exit")}
              className={cn(navRow, "text-ink-2 hover:bg-hover hover:text-ink")}
            >
              <Icon path={paths.close} className="shrink-0 text-ink-4" />
              Report a leaver
            </button>

            {myRequests.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 px-1">
                {myRequests.slice(0, 4).map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-1.5 px-1 py-1 text-[11px]"
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        r.status === "pending"
                          ? "bg-honey"
                          : r.status === "approved"
                            ? "bg-grass"
                            : "bg-ember"
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-ink-4">
                      {r.kind === "hire"
                        ? r.role
                        : employeeOf(r.employeeId ?? null)?.name}
                    </span>
                    <span className="shrink-0 text-ink-4">{r.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          <div className="shrink-0 p-2">
            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              data-sound-silent
              onClick={() => {
                const next = !soundOn
                setSoundOn(next)
                writeSoundPreference(next)
                if (next) cue("toggle")
              }}
              className="flex h-[34px] w-full items-center gap-[9px] rounded-control px-2 text-xs font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <Icon path={paths.sound} className="shrink-0 text-ink-4" />
              Interaction sounds
              <Switch on={soundOn} />
            </button>
          </div>
        </aside>
      </AppShellSidebar>

      <main
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-hidden py-2 pr-2 max-lg:pl-2",
          railHidden && "pl-2"
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface shadow-card">
          <PreviewNotice title="Mixed sources">
            Today&rsquo;s workforce summary, My team directory, and employee
            documents read Internal&rsquo;s relational HR endpoints. The roster,
            leave, payroll, benefits, and write actions remain explicitly
            preview or read-only until their screen contracts are wired.
            {workforceResource.errorMessage
              ? ` Workforce summary unavailable (${workforceResource.errorMessage}).`
              : ""}
          </PreviewNotice>
          <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-line pr-2.5 pl-3.5">
            <SidebarTrigger className="-ml-1" />
            <span className="grid size-[30px] shrink-0 place-items-center rounded-panel bg-inset text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
              <Icon
                path={KIND_ICON[stats.location!.kind]}
                size={15}
                width={1.8}
              />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold tracking-[-0.01em]">
                {stats.location!.name}
              </div>
              <div className="truncate text-[11.5px] text-ink-4">
                {stats.headcount} of {stats.plan} filled
                {stats.gap > 0 && ` · ${stats.gap} short`} · {stats.attendance}%
                attendance
              </div>
            </div>
            {stats.gap > 0 && (
              <button
                type="button"
                onClick={() => setAsking("hire")}
                className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-accent px-2.5 text-xs font-medium text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] transition-[filter] hover:brightness-105"
              >
                <Icon path={paths.plus} size={14} width={2.1} />
                Request a hire
              </button>
            )}
          </div>

          {tab === "roster" && (
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3.5">
              <button
                type="button"
                aria-label="Previous week"
                onClick={() => setWeek(shiftWeek(week, -1))}
                className="grid size-[26px] place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink"
              >
                <Icon
                  path={paths.chevronRight}
                  size={14}
                  width={2.2}
                  className="rotate-180"
                />
              </button>
              <span className="min-w-[132px] text-center font-mono text-[12.5px] font-medium text-ink">
                {weekLabel(week)}
              </span>
              <button
                type="button"
                aria-label="Next week"
                onClick={() => setWeek(shiftWeek(week, 1))}
                className="grid size-[26px] place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink"
              >
                <Icon path={paths.chevronRight} size={14} width={2.2} />
              </button>

              {week !== mondayOf() && (
                <button
                  type="button"
                  onClick={() => setWeek(mondayOf())}
                  className="inline-flex h-[26px] items-center rounded-control px-2 text-xs font-medium text-accent-ink transition-colors hover:bg-hover"
                >
                  This week
                </button>
              )}

              {/* every rostered day is meant to be a full 8 hours; anything
                  else is either overtime to pay for or a short day */}
              {offStandard > 0 && (
                <span className="inline-flex h-[22px] items-center gap-1.5 rounded-chip bg-orange-tint px-2 text-[11px] font-medium text-honey">
                  <Icon path={paths.alert} size={11} width={2.2} />
                  {offStandard} shift{offStandard === 1 ? "" : "s"} not a full{" "}
                  {STANDARD_DAY} hours
                </span>
              )}

              {/* a week nobody has touched simply repeats the one before it */}
              {isInherited(week) ? (
                <span className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] text-ink-4">
                  <Icon
                    path={paths.check}
                    size={12}
                    width={2.2}
                    className="text-grass"
                  />
                  Same as last week
                </span>
              ) : (
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-[11.5px] text-honey">
                    Changed for this week
                  </span>
                  <button
                    type="button"
                    onClick={() => resetWeek(week)}
                    className="inline-flex h-[26px] items-center rounded-control px-2 text-xs font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                  >
                    Revert
                  </button>
                </span>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {tab === "roster" && (
              <>
                <VirtualRows
                  rows={team}
                  rowKey={(e) => e.id}
                  columns={ROSTER_COLUMNS}
                  rowHeight={46}
                  className="min-w-[820px]"
                  header={
                    <>
                      <span className="pl-3.5 text-left">This week</span>
                      {DAYS.map((d, day) => (
                        <span key={d} className="text-center">
                          {/* the header sets the whole column at once */}
                          <button
                            type="button"
                            onClick={(e) => {
                              const r = e.currentTarget.getBoundingClientRect()
                              setEditing({
                                employeeId: "",
                                day,
                                x: r.left,
                                y: r.bottom + 4,
                                column: true,
                              })
                            }}
                            title={`Set ${d} for everyone`}
                            className="mx-auto inline-flex h-6 items-center gap-1 rounded-chip px-2 text-[11px] font-semibold tracking-[0.04em] uppercase transition-colors hover:bg-hover hover:text-ink"
                          >
                            {d}
                            <Icon
                              path={paths.chevronDown}
                              size={10}
                              width={2.4}
                              className="text-ink-4"
                            />
                          </button>
                        </span>
                      ))}
                      <span className="text-right">Hours</span>
                      <span />
                    </>
                  }
                  renderRow={(e) => {
                    const days = weekOf(e.id, week)
                    const worked = days.map((id) => shiftHours(shiftMeta(id)))
                    const weekHours = worked.reduce((sum, h) => sum + h, 0)
                    const overtime = worked.reduce(
                      (sum, h) => sum + Math.max(0, h - STANDARD_DAY),
                      0
                    )
                    return (
                      <>
                        <span role="gridcell" className="py-1.5 pr-2 pl-3.5">
                          <button
                            type="button"
                            onClick={() => setOpen(e.id)}
                            className="flex w-full items-center gap-2 text-left"
                          >
                            <Avatar employee={e} size={26} />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-medium text-ink">
                                {e.name}
                              </span>
                              <span className="block truncate text-[10.5px] text-ink-4">
                                {e.role}
                              </span>
                            </span>
                          </button>
                        </span>

                        {days.map((shiftId, day) => {
                          const shift = shiftMeta(shiftId)
                          const off = shiftId === "off"
                          const hours = shiftHours(shift)
                          /* leave and public holidays are not the store's to
                             roster over, so the cell stops being editable */
                          const date = addDays(week, day)
                          const status = attendanceOn(e.id, date)
                          const locked =
                            status === "leave" || status === "holiday"
                          if (locked) {
                            return (
                              <span
                                role="gridcell"
                                key={day}
                                className="px-1 py-1.5"
                              >
                                <span
                                  title={
                                    status === "leave"
                                      ? `${e.name} is on approved leave`
                                      : holidayOn(date)?.label
                                  }
                                  style={
                                    {
                                      "--s": DAY_STATUS[status].hue,
                                    } as React.CSSProperties
                                  }
                                  className="flex h-[34px] w-full flex-col items-center justify-center rounded-chip border border-dashed border-[color-mix(in_srgb,var(--s)_38%,var(--surface))] bg-[color-mix(in_srgb,var(--s)_10%,var(--surface))] text-[10.5px] font-medium text-[color-mix(in_srgb,var(--s)_66%,var(--ink))]"
                                >
                                  {status === "leave" ? "Leave" : "Holiday"}
                                </span>
                              </span>
                            )
                          }
                          return (
                            <span
                              role="gridcell"
                              key={day}
                              className="px-1 py-1.5"
                            >
                              <button
                                type="button"
                                title={
                                  off
                                    ? "Off — click to change"
                                    : `${shift.label} ${shiftTime(shift)} · ${hours}h${
                                        hours === STANDARD_DAY
                                          ? ""
                                          : hours > STANDARD_DAY
                                            ? ` · ${round1(hours - STANDARD_DAY)}h overtime`
                                            : ` · ${round1(STANDARD_DAY - hours)}h short of a full day`
                                      }`
                                }
                                onClick={(ev) => {
                                  const r =
                                    ev.currentTarget.getBoundingClientRect()
                                  setEditing({
                                    employeeId: e.id,
                                    day,
                                    x: r.left,
                                    y: r.bottom + 4,
                                  })
                                }}
                                style={
                                  off
                                    ? undefined
                                    : ({
                                        "--s": shift.hue,
                                      } as React.CSSProperties)
                                }
                                className={cn(
                                  "flex h-[34px] w-full flex-col items-center justify-center rounded-chip text-[10.5px] font-medium transition-[filter,box-shadow] duration-[120ms]",
                                  "hover:brightness-[0.97] focus-visible:shadow-[0_0_0_2px_var(--accent)]",
                                  off
                                    ? "bg-inset text-ink-4"
                                    : "border border-[color-mix(in_srgb,var(--s)_28%,var(--surface))] bg-[color-mix(in_srgb,var(--s)_13%,var(--surface))] text-[color-mix(in_srgb,var(--s)_62%,var(--ink))]",
                                  // a day that is not a standard 8 hours has to be
                                  // deliberate, so it says so on the cell
                                  !off &&
                                    hours !== STANDARD_DAY &&
                                    "ring-1 ring-honey"
                                )}
                              >
                                {shift.label}
                                {!off && (
                                  <span className="font-mono text-[9.5px] opacity-70">
                                    {shift.start}
                                  </span>
                                )}
                              </button>
                            </span>
                          )
                        })}

                        <span role="gridcell" className="px-2 text-right">
                          <span
                            title={`${weekHours} hours rostered this week`}
                            className={cn(
                              "block font-mono text-xs tabular-nums",
                              overtime > 0 ? "text-honey" : "text-ink-3"
                            )}
                          >
                            {round1(weekHours)}h
                          </span>
                          {overtime > 0 && (
                            <span className="block font-mono text-[10px] text-honey tabular-nums">
                              +{round1(overtime)} OT
                            </span>
                          )}
                        </span>

                        <span role="gridcell" className="group/row pr-2 text-center">
                          <button
                            type="button"
                            aria-label={`Clear the week for ${e.name}`}
                            title="Set the whole week to Off"
                            onClick={() => clearWeek(e.id, week)}
                            className="grid size-[24px] place-items-center rounded-chip text-ink-4 opacity-0 transition-colors group-hover/row:opacity-100 hover:bg-hover-2 hover:text-ember"
                          >
                            <Icon path={paths.close} size={13} width={2.2} />
                          </button>
                        </span>
                      </>
                    )
                  }}
                />

                {/* how many people are actually on the floor each day */}
                <div
                  role="row"
                  className="sticky bottom-0 z-4 grid h-[38px] min-w-[820px] items-center border-t border-t-line-strong bg-inset"
                  style={{ gridTemplateColumns: ROSTER_COLUMNS }}
                >
                  <span className="pl-3.5 text-[11px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                    On the floor
                  </span>
                  {DAYS.map((_, day) => {
                    const onFloor = team.filter(
                      (e) => weekOf(e.id, week)[day] !== "off"
                    ).length
                    const thin = onFloor < MIN_ON_FLOOR
                    return (
                      <span key={day} className="px-1 text-center">
                        <span
                          title={
                            thin ? `Below ${MIN_ON_FLOOR} people` : undefined
                          }
                          className={cn(
                            "inline-flex h-[22px] min-w-[30px] items-center justify-center rounded-chip font-mono text-[11.5px] tabular-nums",
                            thin ? "bg-red-tint text-red" : "text-ink-3"
                          )}
                        >
                          {onFloor}
                        </span>
                      </span>
                    )
                  })}
                  <span className="px-2 text-right font-mono text-[11.5px] text-ink-3 tabular-nums">
                    {round1(
                      team.reduce(
                        (sum, e) =>
                          sum +
                          weekOf(e.id, week).reduce(
                            (h, id) => h + shiftHours(shiftMeta(id)),
                            0
                          ),
                        0
                      )
                    )}
                    h
                  </span>
                  <span />
                </div>
              </>
            )}

            {tab === "team" && (
              <div className="flex h-11 items-center gap-2 border-b border-line px-3.5">
                <span className="text-[11.5px] text-ink-3">
                  {liveEmployeesResource.data?.total ?? "—"} people at{" "}
                  {stats.location!.name}
                </span>
                <span className="ml-auto text-[10.5px] text-ink-4">
                  Internal read-only
                </span>
              </div>
            )}

            {tab === "team" && (
              <div className="min-h-0 flex-1 overflow-auto">
                {liveEmployeesResource.isLoading && (
                  <div className="p-3.5 text-xs text-ink-4">
                    Loading employees from Internal…
                  </div>
                )}
                {liveEmployeesResource.errorMessage && (
                  <div className="m-3.5 rounded-panel bg-red-tint px-3 py-3 text-xs text-red">
                    Could not load Internal employees:{" "}
                    {liveEmployeesResource.errorMessage}
                  </div>
                )}
                {!liveEmployeesResource.isLoading &&
                  !liveEmployeesResource.errorMessage &&
                  liveEmployeesResource.data && (
                    <LiveDirectoryTable
                      people={liveEmployeesResource.data.items}
                      onOpen={(e) => setOpen(e.id)}
                    />
                  )}
              </div>
            )}

            {tab === "attendance" && (
              <LiveAttendanceView
                records={liveAttendanceResource.data?.items}
                total={liveAttendanceResource.data?.total}
                isLoading={liveAttendanceResource.isLoading}
                errorMessage={liveAttendanceResource.errorMessage}
              />
            )}

            {tab === "benefits" && (
              <Benefits scope="store" locationId={locationId} />
            )}

            {tab === "pay" && (
              <div className="p-3.5">
                {/* the store does not type a payroll — it checks the one the
                    system worked out, adds what only it knows, and hands it in */}
                <div className="mb-3 flex flex-wrap items-center gap-3 rounded-panel border border-line-strong px-3.5 py-3">
                  <span>
                    <span className="block text-[12.5px] font-semibold text-ink">
                      {openRun?.period ?? "This month"}
                    </span>
                    <span className="block text-[11px] text-ink-4">
                      Worked out from base pay, the roster and this
                      month&rsquo;s attendance
                    </span>
                  </span>

                  <span className="ml-auto flex items-center gap-4">
                    <span className="text-right">
                      <span className="block text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                        Net
                      </span>
                      <span className="block font-mono text-[15px] font-medium text-ink tabular-nums">
                        {rupiah(storeNet)}
                      </span>
                    </span>
                    <span
                      style={{ color: submissionMeta.hue }}
                      className="flex items-center gap-1.5 text-[11.5px] font-medium"
                    >
                      <span
                        style={{ background: submissionMeta.hue }}
                        className="size-1.5 rounded-full"
                      />
                      {submissionMeta.label}
                    </span>
                    <button
                      type="button"
                      disabled={
                        submission.status === "submitted" ||
                        submission.status === "approved"
                      }
                      onClick={() =>
                        submitPayroll(
                          openRun?.id ?? "",
                          locationId,
                          stats.location!.name
                        )
                      }
                      className="inline-flex h-[32px] items-center gap-1.5 rounded-control bg-ink px-2.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Icon path={paths.check} size={14} width={2.2} />
                      Hand in to Head Office
                    </button>
                  </span>
                </div>

                {submission.status === "returned" && submission.note && (
                  <div className="mb-3 rounded-panel bg-red-tint px-3 py-2.5 text-[11.5px] leading-[1.5] text-red">
                    Head Office sent this back: {submission.note}
                  </div>
                )}

                <VirtualRows
                  rows={slips}
                  rowKey={(slip) => slip.employeeId}
                  columns={STORE_PAYROLL_COLUMNS}
                  rowHeight={52}
                  className="min-w-[760px]"
                  header={
                    <>
                      <span className="pl-3.5 text-left">Person</span>
                      <span className="text-right">Base</span>
                      <span className="text-left">Earnings and deductions</span>
                      <span className="text-right">Net</span>
                      <span />
                    </>
                  }
                  renderRow={(slip) => {
                    const person = employeeOf(slip.employeeId)!
                    return (
                      <>
                        <span role="gridcell" className="pr-3 pl-3.5">
                          <span className="flex items-center gap-2.5">
                            <Avatar employee={person} size={26} />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-medium text-ink">
                                {person.name}
                              </span>
                              <span className="block truncate text-[11px] text-ink-4">
                                {person.role}
                              </span>
                            </span>
                          </span>
                        </span>
                        <span
                          role="gridcell"
                          className="px-3 text-right font-mono text-xs text-ink-4 tabular-nums"
                        >
                          {rupiah(slip.base)}
                        </span>
                        <span role="gridcell" className="px-3">
                          <span className="flex flex-wrap gap-1">
                            {slip.lines.map((line) => (
                              <span
                                key={line.id}
                                title={line.detail}
                                className={cn(
                                  "inline-flex h-[21px] items-center gap-1 rounded-[6px] pl-1.5 text-[11px] font-medium",
                                  line.manual ? "pr-0.5" : "pr-1.5",
                                  line.kind === "earning"
                                    ? "bg-green-tint text-green"
                                    : "bg-red-tint text-red"
                                )}
                              >
                                {line.label}{" "}
                                {line.kind === "earning" ? "+" : "−"}
                                {Math.round(line.amount / 1000)}k
                                {line.manual && (
                                  <button
                                    type="button"
                                    aria-label={`Remove ${line.label}`}
                                    onClick={() => removeManualLine(line.id)}
                                    className="grid size-[14px] shrink-0 place-items-center rounded-full transition-colors hover:bg-hover-2"
                                  >
                                    <Icon
                                      path={paths.close}
                                      size={9}
                                      width={3}
                                    />
                                  </button>
                                )}
                              </span>
                            ))}
                          </span>
                        </span>
                        <span role="gridcell" className="px-3 text-right">
                          <span className="block font-mono text-[12.5px] font-medium text-ink tabular-nums">
                            {rupiah(slip.net)}
                          </span>
                          <span className="block font-mono text-[10.5px] text-ink-4 tabular-nums">
                            −{rupiah(slip.deductions)}
                          </span>
                        </span>
                        <span role="gridcell" className="group/row pr-3.5 text-center">
                          <button
                            type="button"
                            aria-label={`Add a line for ${person.name}`}
                            title="Add a line the system cannot know"
                            onClick={() => setPayFor(person)}
                            className="grid size-[26px] place-items-center rounded-control text-ink-4 opacity-0 transition-[opacity,background-color] group-hover/row:opacity-100 hover:bg-hover-2 hover:text-ink"
                          >
                            <Icon path={paths.plus} size={14} width={2.1} />
                          </button>
                        </span>
                      </>
                    )
                  }}
                />
              </div>
            )}

            {tab === "leave" && (
              <div className="p-3.5">
                <div className="mb-3 overflow-hidden rounded-panel border border-line-strong">
                  <div className="border-b border-line px-3.5 py-2.5">
                    <div className="text-[12.5px] font-semibold text-ink">
                      Balances
                    </div>
                    <div className="text-[11px] text-ink-4">
                      {LEAVE_ENTITLEMENT} days a year, per person
                    </div>
                  </div>
                  <ul className="max-h-[210px] overflow-auto">
                    {team.map((e) => {
                      const b = leaveFor(e.id)
                      return (
                        <li
                          key={e.id}
                          className="flex items-center gap-2.5 border-b border-line px-3 py-1.5 last:border-b-0"
                        >
                          <Avatar employee={e} size={24} />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                            {e.name}
                          </span>
                          <span className="flex shrink-0 items-center gap-3 font-mono text-[11px] tabular-nums">
                            <span className="text-ink-4">{b.taken} taken</span>
                            {b.waiting > 0 && (
                              <span className="text-honey">
                                {b.waiting} pending
                              </span>
                            )}
                            <span
                              className={cn(
                                b.left <= 2 ? "text-ember" : "text-ink-2"
                              )}
                            >
                              {b.left} left
                            </span>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>

                {myLeave.length === 0 ? (
                  <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-ink-4">
                    <span className="grid size-[34px] place-items-center rounded-panel bg-inset shadow-[inset_0_0_0_1px_var(--line-strong)]">
                      <Icon path={paths.clock} size={17} width={1.8} />
                    </span>
                    <span className="text-xs">
                      No leave requests from this team.
                    </span>
                  </div>
                ) : (
                  <ul className="overflow-hidden rounded-panel border border-line-strong">
                    {myLeave.map((l) => (
                      <LeaveRow key={l.id} leave={l} onDecide={decideLeave} />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* the shift picker floats above the sheet, so a cell near the edge
          of the scroll area still shows its whole menu */}
      {editing && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={() => setEditing(null)}
          />
          <div
            style={{ left: editing.x, top: editing.y }}
            className="fixed z-51 w-[188px] animate-pop rounded-panel bg-surface p-1 shadow-[0_0_0_1px_var(--line-strong),var(--shadow-overlay)]"
          >
            <div className="px-2 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              {editing.column
                ? `${DAYS[editing.day]} — everyone`
                : DAYS[editing.day]}
            </div>
            {shifts.map((shift) => (
              <button
                key={shift.id}
                type="button"
                onClick={() => {
                  if (editing.column)
                    setDay(
                      team.map((e) => e.id),
                      week,
                      editing.day,
                      shift.id as ShiftId
                    )
                  else
                    setShift(
                      editing.employeeId,
                      week,
                      editing.day,
                      shift.id as ShiftId
                    )
                  setEditing(null)
                }}
                className="flex w-full items-center gap-2.5 rounded-chip px-2 py-1.5 text-left transition-colors hover:bg-hover"
              >
                <span
                  style={{
                    background:
                      shift.id === "off" ? "var(--line-strong)" : shift.hue,
                  }}
                  className="size-2.5 shrink-0 rounded-full"
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                  {shift.label}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] text-ink-4">
                  {shiftTime(shift)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* the only thing a store types: a line against a component Head
          Office marked as manual */}
      <PayLineSheet
        employee={payFor}
        manualComponents={manualComponents}
        initialComponentId={manualComponents[0]?.id ?? ""}
        onClose={() => setPayFor(null)}
        onSave={(line) => addManualLine({ ...line, raisedBy: stats.location!.name })}
      />

      <RecordSheet
        target={recordFor}
        divisions={DIVISIONS}
        onClose={() => setRecordFor(null)}
        onSave={(change) =>
          raiseChange({ ...change, raisedBy: stats.location!.name, locationId })
        }
      />

      <FixSheet
        target={fixFor}
        attendanceOn={attendanceOn}
        alreadyFixed={fixFor ? Boolean(fixOn(fixFor.person.id, fixFor.key)) : false}
        payrollClosed={payrollClosed}
        onClose={() => setFixFor(null)}
        onSave={(fix) => raiseFix({ ...fix, raisedBy: stats.location!.name }, !payrollClosed)}
      />

      <AskSheet
        kind={asking}
        team={team}
        locationName={stats.location!.name}
        headcount={stats.headcount}
        plan={stats.plan}
        gap={stats.gap}
        onClose={() => setAsking(null)}
        onSave={(request) => {
          raiseRequest({ ...request, locationId, raisedBy: team[0]?.name ?? "Store manager" })
          cue("success")
        }}
      />

      <SheetShell
        open={Boolean(open)}
        eyebrow={open?.role ?? "Person"}
        title={open?.name ?? ""}
        onRequestClose={() => setOpen(undefined)}
        footer={
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setOpen(undefined)}
              className={sheetButton.secondary}
            >
              Close
            </button>
          </>
        }
      >
        {open && (
          <div className="px-[18px] pt-4 pb-[18px]">
            <div className="flex items-center gap-3 pb-4">
              <Avatar employee={open} size={52} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {open.name}
                </div>
                <div className="truncate text-xs text-ink-4">{open.role}</div>
                <div className="pt-1">
                  <TypeChip type={open.employmentType} />
                </div>
              </div>
            </div>

            <div className="mb-3 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              This week
            </div>
            <div className="mb-4 grid grid-cols-7 gap-1">
              {DAYS.map((d, i) => {
                const shift = shiftMeta(weekOf(open.id, week)[i])
                const off = shift.id === "off"
                return (
                  <div key={d} className="text-center">
                    <div className="pb-1 text-[10px] text-ink-4">{d}</div>
                    <div
                      style={
                        off
                          ? undefined
                          : ({ "--s": shift.hue } as React.CSSProperties)
                      }
                      className={cn(
                        "grid h-[34px] place-items-center rounded-chip text-[10.5px] font-medium",
                        off
                          ? "bg-inset text-ink-4"
                          : "border border-[color-mix(in_srgb,var(--s)_28%,var(--surface))] bg-[color-mix(in_srgb,var(--s)_13%,var(--surface))] text-[color-mix(in_srgb,var(--s)_62%,var(--ink))]"
                      )}
                    >
                      {shift.label}
                    </div>
                  </div>
                )
              })}
            </div>

            {[
              { label: "Attendance", value: `${open.attendance}%` },
              { label: "Overtime", value: `${open.overtimeHours}h this month` },
              { label: "Tenure", value: tenureLabel(open.tenureMonths) },
              { label: "Status", value: <StatusDot status={open.status} /> },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-start gap-3 border-t border-line py-[9px]"
              >
                <span className="w-[92px] shrink-0 pt-px text-xs text-ink-4">
                  {row.label}
                </span>
                <span className="min-w-0 flex-1 text-xs font-medium text-ink-2">
                  {row.value}
                </span>
              </div>
            ))}

            <div className="pt-4">
              <Documents
                employee={open}
                scope="store"
                uploader={stats.location!.name}
              />
            </div>

            <button
              type="button"
              onClick={() => {
                openRecord("edit", open)
                setOpen(undefined)
              }}
              className="mt-4 inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors hover:bg-hover"
            >
              <Icon path={paths.edit} size={13} width={1.9} />
              Correct this record
            </button>
          </div>
        )}
      </SheetShell>

      <SheetShell
        open={Boolean(openId) && !open}
        eyebrow={liveEmployee?.department || "Employee"}
        title={liveEmployee?.fullName || ""}
        onRequestClose={() => setOpen(undefined)}
        footer={
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setOpen(undefined)}
              className={sheetButton.secondary}
            >
              Close
            </button>
          </>
        }
      >
        {liveEmployee && (
          <div className="px-[18px] pt-4 pb-[18px]">
            <div className="flex items-center gap-3 pb-4">
              <Avatar
                employee={{ name: liveEmployee.fullName, hue: "#0086fc" }}
                size={52}
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {liveEmployee.fullName}
                </div>
                <div className="truncate text-xs text-ink-4">
                  {liveEmployee.position || liveEmployee.department || "—"}
                </div>
                <div className="pt-1 text-[11px] text-ink-4">
                  {liveEmployee.employeeCode || liveEmployee.id}
                </div>
              </div>
            </div>
            {[
              { label: "Department", value: liveEmployee.department || "—" },
              { label: "Location ID", value: liveEmployee.locationId },
              {
                label: "Employment",
                value: liveEmployee.employmentType || "—",
              },
              { label: "Status", value: liveEmployee.status },
              { label: "Joined", value: liveEmployee.joinDate.slice(0, 10) },
              {
                label: "Contract ends",
                value: liveEmployee.contractEnd?.slice(0, 10) || "—",
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-start gap-3 border-t border-line py-[9px]"
              >
                <span className="w-[92px] shrink-0 pt-px text-xs text-ink-4">
                  {row.label}
                </span>
                <span className="min-w-0 flex-1 text-xs font-medium text-ink-2">
                  {row.value}
                </span>
              </div>
            ))}
            <div className="pt-4">
              <LiveDocuments employee={liveEmployee} />
            </div>
          </div>
        )}
        {openId && !open && !liveEmployee && (
          <div className="px-[18px] py-4 text-xs text-ink-4">
            {liveEmployeeResource.errorMessage
              ? `Could not load this employee: ${liveEmployeeResource.errorMessage}`
              : "Loading employee from Internal…"}
          </div>
        )}
      </SheetShell>
    </AppShell>
  )
}

/* ── the sheets a store fills in ──────────────────────────────── */

const payLineInput = z
  .object({
    componentId: z.string(),
    amount: z.union([z.number(), z.undefined()]),
    note: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.componentId.trim()) {
      ctx.addIssue({ code: "custom", path: ["componentId"], message: "Choose a component." })
    }
    if (!((v.amount ?? 0) > 0)) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter an amount above zero." })
    }
  })
type PayLineDraft = { componentId: string; amount: number | undefined; note: string }

/** the only thing a store types: a line against a component Head Office
 *  marked as manual */
function PayLineSheet({
  employee,
  manualComponents,
  initialComponentId,
  onClose,
  onSave,
}: {
  employee: Employee | null
  manualComponents: PayrollComponent[]
  initialComponentId: string
  onClose: () => void
  onSave: (line: {
    employeeId: string
    componentId: string
    amount: number
    note?: string
  }) => void
}) {
  return (
    <SheetShell
      open={Boolean(employee)}
      eyebrow="Payroll line"
      title={employee?.name ?? ""}
      onRequestClose={onClose}
      footer={null}
    >
      {employee && (
        <PayLineForm
          key={employee.id}
          employee={employee}
          manualComponents={manualComponents}
          initialComponentId={initialComponentId}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </SheetShell>
  )
}

function PayLineForm({
  employee,
  manualComponents,
  initialComponentId,
  onClose,
  onSave,
}: {
  employee: Employee
  manualComponents: PayrollComponent[]
  initialComponentId: string
  onClose: () => void
  onSave: (line: {
    employeeId: string
    componentId: string
    amount: number
    note?: string
  }) => void
}) {
  const { error, run } = useSheetForm(onClose)

  const form = useAppForm({
    defaultValues: {
      componentId: initialComponentId,
      amount: undefined as number | undefined,
      note: "",
    } satisfies PayLineDraft,
    validators: { onChange: payLineInput },
    onSubmit: async ({ value }) => {
      await run(async () => {
        onSave({
          employeeId: employee.id,
          componentId: value.componentId,
          amount: value.amount ?? 0,
          note: value.note.trim() || undefined,
        })
      })
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className="flex min-h-full flex-col"
    >
      <div className="flex-1 px-[18px] pt-4 pb-[18px]">
        <form.FormError message={error} />
        <div className="mb-4 rounded-panel bg-inset px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
          Everything else on this payslip is worked out for you. These are the
          components Head Office lets a store fill in by hand.
        </div>

        <form.AppField name="componentId">
          {(field) => (
            <div className="pb-3.5">
              <span className="block pb-1.5 text-xs font-medium text-ink-2">
                Component
              </span>
              <div className="flex flex-wrap gap-1.5">
                {manualComponents.map((component) => {
                  const on = field.state.value === component.id
                  return (
                    <button
                      key={component.id}
                      type="button"
                      onClick={() => field.handleChange(component.id)}
                      className={cn(
                        "inline-flex h-[30px] items-center gap-1.5 rounded-control px-2.5 text-xs font-medium transition-colors",
                        on
                          ? component.kind === "earning"
                            ? "bg-green-tint text-green shadow-[inset_0_0_0_1.5px_var(--grass)]"
                            : "bg-red-tint text-red shadow-[inset_0_0_0_1.5px_var(--ember)]"
                          : "bg-surface text-ink-2 shadow-btn hover:bg-hover"
                      )}
                    >
                      {component.kind === "earning" ? "+" : "−"} {component.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </form.AppField>

        <form.AppField name="amount">
          {(field) => <field.MoneyField label="Amount" required />}
        </form.AppField>

        <form.AppField name="note">
          {(field) => (
            <field.TextAreaField
              label="Why"
              placeholder="Head Office reads this when the payroll is checked."
            />
          )}
        </form.AppField>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3.5 py-3">
        <span className="flex-1" />
        <button type="button" onClick={onClose} className={sheetButton.secondary}>
          Cancel
        </button>
        <form.SubmitButton label="Add line" />
      </div>
    </form>
  )
}

const recordInput = z.object({
  name: z.string().trim().min(1, "Enter the full name."),
  role: z.string().trim().min(1, "Enter the role."),
  division: z.string(),
  employmentType: z.enum(["permanent", "contract", "part-time", "intern"]),
  contractEndsOn: z.string(),
  reason: z.string().trim().min(1, "Say why."),
})
type RecordDraft = z.infer<typeof recordInput>

export type RecordSheetTarget = { mode: ChangeKind; person?: Employee }

/** the store fills the record in; Head Office is what makes it true */
function RecordSheet({
  target,
  divisions,
  onClose,
  onSave,
}: {
  target: RecordSheetTarget | null
  divisions: readonly string[]
  onClose: () => void
  onSave: (change: { kind: ChangeKind; employeeId?: string; draft: EmployeeDraft; reason: string }) => void
}) {
  return (
    <SheetShell
      open={Boolean(target)}
      eyebrow={target?.mode === "add" ? "New joiner" : "Correct a record"}
      title={target?.person?.name ?? "New employee"}
      onRequestClose={onClose}
      footer={null}
    >
      {target && (
        <RecordForm
          key={`${target.mode}-${target.person?.id ?? "new"}`}
          target={target}
          divisions={divisions}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </SheetShell>
  )
}

function RecordForm({
  target,
  divisions,
  onClose,
  onSave,
}: {
  target: RecordSheetTarget
  divisions: readonly string[]
  onClose: () => void
  onSave: (change: { kind: ChangeKind; employeeId?: string; draft: EmployeeDraft; reason: string }) => void
}) {
  const { error, run } = useSheetForm(onClose)
  const person = target.person

  const form = useAppForm({
    defaultValues: {
      name: person?.name ?? "",
      role: person?.role ?? "Sales Associate",
      division: person?.division ?? "Store Ops",
      employmentType: person?.employmentType ?? "contract",
      contractEndsOn: person?.contractEndsOn ?? "",
      reason: "",
    } satisfies RecordDraft,
    validators: { onChange: recordInput },
    onSubmit: async ({ value }) => {
      await run(async () => {
        onSave({
          kind: target.mode,
          employeeId: person?.id,
          draft: {
            name: value.name.trim(),
            role: value.role.trim(),
            division: value.division,
            locationId: person?.locationId ?? "",
            employmentType: value.employmentType,
            contractEndsOn: value.contractEndsOn || undefined,
          },
          reason: value.reason.trim(),
        })
      })
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className="flex min-h-full flex-col"
    >
      <div className="flex-1 px-[18px] pt-4 pb-[18px]">
        <form.FormError message={error} />
        <form.AppField name="name">
          {(field) => (
            <field.TextField label="Full name" required placeholder="As written on the KTP" />
          )}
        </form.AppField>

        <div className="grid grid-cols-2 gap-2.5">
          <form.AppField name="role">
            {(field) => <field.TextField label="Role" required />}
          </form.AppField>
          <form.AppField name="division">
            {(field) => (
              <field.SelectField
                label="Division"
                options={divisions.map((division) => ({ value: division, label: division }))}
              />
            )}
          </form.AppField>
        </div>

        <form.AppField name="employmentType">
          {(field) => (
            <div className="pb-3.5">
              <span className="block pb-1.5 text-xs font-medium text-ink-2">Employment</span>
              <div className="flex flex-wrap gap-1.5">
                {(["permanent", "contract", "part-time", "intern"] as const).map((type) => {
                  const on = field.state.value === type
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => field.handleChange(type)}
                      className={cn(
                        "inline-flex h-[30px] items-center rounded-control px-2.5 text-[11.5px] font-medium capitalize transition-colors",
                        on
                          ? "bg-accent-tint text-accent-ink shadow-[inset_0_0_0_1.5px_var(--accent)]"
                          : "bg-surface text-ink-2 shadow-btn hover:bg-hover"
                      )}
                    >
                      {type}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </form.AppField>

        <form.Subscribe selector={(state) => state.values.employmentType}>
          {(employmentType) =>
            employmentType !== "permanent" && (
              <form.AppField name="contractEndsOn">
                {(field) => <field.DateField label="Contract ends" />}
              </form.AppField>
            )
          }
        </form.Subscribe>

        <form.AppField name="reason">
          {(field) => (
            <field.TextAreaField
              label="Why"
              required
              placeholder={
                target.mode === "add"
                  ? "Replacing the associate whose exit was approved last month."
                  : "Passed the review, moving from contract to permanent."
              }
            />
          )}
        </form.AppField>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3.5 py-3">
        <span className="flex-1 truncate text-[11px] text-ink-4">
          Head Office writes this in once it agrees
        </span>
        <button type="button" onClick={onClose} className={sheetButton.secondary}>
          Cancel
        </button>
        <form.SubmitButton label="Send for verification" />
      </div>
    </form>
  )
}

const fixInput = z.object({
  claim: z.enum(["present", "late", "absent"]),
  note: z.string().trim().min(1, "Say why."),
})
type FixDraft = z.infer<typeof fixInput>

export type FixSheetTarget = { person: Employee; key: DayKey }

/** a forgotten punch is fixed here while payroll is still in the store;
 *  after it has gone up, the same fix becomes a request */
function FixSheet({
  target,
  attendanceOn,
  alreadyFixed,
  payrollClosed,
  onClose,
  onSave,
}: {
  target: FixSheetTarget | null
  attendanceOn: (employeeId: string, key: DayKey) => DayStatus
  alreadyFixed: boolean
  payrollClosed: boolean
  onClose: () => void
  onSave: (fix: {
    employeeId: string
    date: DayKey
    claim: "present" | "late" | "absent"
    note: string
  }) => void
}) {
  return (
    <SheetShell
      open={Boolean(target)}
      eyebrow="Attendance correction"
      title={target?.person.name ?? ""}
      onRequestClose={onClose}
      footer={null}
    >
      {target && (
        <FixForm
          key={`${target.person.id}-${target.key}`}
          target={target}
          status={attendanceOn(target.person.id, target.key)}
          alreadyFixed={alreadyFixed}
          payrollClosed={payrollClosed}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </SheetShell>
  )
}

function FixForm({
  target,
  status,
  alreadyFixed,
  payrollClosed,
  onClose,
  onSave,
}: {
  target: FixSheetTarget
  status: DayStatus
  alreadyFixed: boolean
  payrollClosed: boolean
  onClose: () => void
  onSave: (fix: {
    employeeId: string
    date: DayKey
    claim: "present" | "late" | "absent"
    note: string
  }) => void
}) {
  const { error, run } = useSheetForm(onClose)

  const form = useAppForm({
    defaultValues: {
      claim: "present" as "present" | "late" | "absent",
      note: "",
    } satisfies FixDraft,
    validators: { onChange: fixInput },
    onSubmit: async ({ value }) => {
      await run(async () => {
        onSave({
          employeeId: target.person.id,
          date: target.key,
          claim: value.claim,
          note: value.note.trim(),
        })
      })
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className="flex min-h-full flex-col"
    >
      <div className="flex-1 px-[18px] pt-4 pb-[18px]">
        <form.FormError message={error} />
        <div className="mb-4 flex items-center gap-2.5 rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
          <span className="text-[11.5px] text-ink-3">
            {new Date(`${target.key}T12:00:00`).toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-[11.5px] font-medium">
            <span
              style={{ background: DAY_STATUS[status].hue }}
              className="size-2 rounded-full"
            />
            {DAY_STATUS[status].label}
          </span>
        </div>

        {alreadyFixed && (
          <div className="mb-4 rounded-panel bg-orange-tint px-3 py-2.5 text-[11.5px] leading-[1.5] text-honey">
            This day has already been corrected once.
          </div>
        )}

        <form.AppField name="claim">
          {(field) => (
            <div className="pb-3.5">
              <span className="block pb-1.5 text-xs font-medium text-ink-2">
                What really happened
              </span>
              <div className="flex gap-1.5">
                {(["present", "late", "absent"] as const).map((claim) => {
                  const on = field.state.value === claim
                  return (
                    <button
                      key={claim}
                      type="button"
                      onClick={() => field.handleChange(claim)}
                      className={cn(
                        "inline-flex h-[32px] flex-1 items-center justify-center gap-1.5 rounded-control text-xs font-medium transition-colors",
                        on
                          ? "bg-accent-tint text-accent-ink shadow-[inset_0_0_0_1.5px_var(--accent)]"
                          : "bg-surface text-ink-2 shadow-btn hover:bg-hover"
                      )}
                    >
                      <span
                        style={{ background: DAY_STATUS[claim].hue }}
                        className="size-2 rounded-full"
                      />
                      {DAY_STATUS[claim].label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </form.AppField>

        <form.AppField name="note">
          {(field) => (
            <field.TextAreaField
              label="Why"
              required
              placeholder="Worked the full close, forgot to tap out."
            />
          )}
        </form.AppField>
        <p className="pt-2 text-[11px] leading-[1.5] text-ink-4">
          Corrections change what the payroll deducts, so every one of them
          keeps its reason.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3.5 py-3">
        <span className="flex-1 truncate text-[11px] text-ink-4">
          {payrollClosed
            ? "Payroll is with Head Office — this goes up for approval"
            : "Applies straight away, before payroll is handed in"}
        </span>
        <button type="button" onClick={onClose} className={sheetButton.secondary}>
          Cancel
        </button>
        <form.SubmitButton
          label={payrollClosed ? "Send to Head Office" : "Correct the day"}
        />
      </div>
    </form>
  )
}

const HIRE_ROLES = [
  "Sales Associate",
  "Cashier",
  "Stock Associate",
  "Assistant Store Manager",
  "Picker",
]

function askInput(kind: RequestKind) {
  return z.object({
    role: z.string(),
    who: z.string(),
    reason: z.string(),
  }).superRefine((value, ctx) => {
    if (kind === "exit" && !value.who) {
      ctx.addIssue({ code: "custom", path: ["who"], message: "Choose who is leaving." })
    }
  })
}
type AskDraft = { role: string; who: string; reason: string }

/** one request, with the staffing picture behind it */
function AskSheet({
  kind,
  team,
  locationName,
  headcount,
  plan,
  gap,
  onClose,
  onSave,
}: {
  kind: RequestKind | null
  team: Employee[]
  locationName: string
  headcount: number
  plan: number
  gap: number
  onClose: () => void
  onSave: (request: Omit<PeopleRequest, "id" | "status" | "age" | "locationId" | "raisedBy">) => void
}) {
  return (
    <SheetShell
      open={kind !== null}
      eyebrow="Ask Head Office"
      title={kind === "hire" ? "Request a hire" : "Report a leaver"}
      onRequestClose={onClose}
      footer={null}
    >
      {kind && (
        <AskForm
          key={kind}
          kind={kind}
          team={team}
          locationName={locationName}
          headcount={headcount}
          plan={plan}
          gap={gap}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </SheetShell>
  )
}

function AskForm({
  kind,
  team,
  locationName,
  headcount,
  plan,
  gap,
  onClose,
  onSave,
}: {
  kind: RequestKind
  team: Employee[]
  locationName: string
  headcount: number
  plan: number
  gap: number
  onClose: () => void
  onSave: (request: Omit<PeopleRequest, "id" | "status" | "age" | "locationId" | "raisedBy">) => void
}) {
  const { error, run } = useSheetForm(onClose)
  const schema = useMemo(() => askInput(kind), [kind])

  const form = useAppForm({
    defaultValues: {
      role: HIRE_ROLES[0],
      who: "",
      reason: "",
    } satisfies AskDraft,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      await run(async () => {
        onSave({
          kind,
          employeeId: kind === "exit" ? value.who || undefined : undefined,
          role: kind === "hire" ? value.role : undefined,
          reason: value.reason.trim() || "No reason given.",
        })
      })
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className="flex min-h-full flex-col"
    >
      <div className="flex-1 px-[18px] pt-4 pb-[18px]">
        <form.FormError message={error} />
        <div className="mb-4 rounded-panel bg-inset px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
          {locationName} · {headcount} of {plan} filled
          {gap > 0 && ` · ${gap} short of plan`}
        </div>

        {kind === "hire" ? (
          <form.AppField name="role">
            {(field) => (
              <field.SelectField
                label="Role"
                options={HIRE_ROLES.map((role) => ({ value: role, label: role }))}
              />
            )}
          </form.AppField>
        ) : (
          <form.AppField name="who">
            {(field) => (
              <field.SelectField
                label="Who is leaving"
                required
                placeholder="Pick someone…"
                options={team.map((e) => ({ value: e.id, label: `${e.name} — ${e.role}` }))}
              />
            )}
          </form.AppField>
        )}

        <form.AppField name="reason">
          {(field) => (
            <field.TextAreaField
              label="Reason"
              placeholder={
                kind === "hire"
                  ? "Why the store needs this person…"
                  : "Resignation, end of contract, or something else…"
              }
            />
          )}
        </form.AppField>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3.5 py-3">
        <span className="flex-1" />
        <button type="button" onClick={onClose} className={sheetButton.secondary}>
          Cancel
        </button>
        <form.SubmitButton label="Send to Head Office" />
      </div>
    </form>
  )
}

function LeaveRow({
  leave,
  onDecide,
}: {
  leave: LeaveRequest
  onDecide: (id: string, status: LeaveRequest["status"]) => void
}) {
  const person = allEmployees().find((e) => e.id === leave.employeeId)
  if (!person) return null

  return (
    <li className="flex items-start gap-2.5 border-b border-line px-3 py-2.5 last:border-b-0">
      <Avatar employee={person} size={30} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-ink">
          {person.name}
        </span>
        <span className="block truncate text-[11px] text-ink-4">
          {leave.days} day{leave.days === 1 ? "" : "s"} {leave.kind} · starts in{" "}
          {leave.startsIn}d
        </span>
        {leave.note && (
          <span className="mt-0.5 block truncate text-[11px] text-ink-3">
            {leave.note}
          </span>
        )}
      </span>

      {leave.status === "pending" ? (
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onDecide(leave.id, "declined")}
            className="inline-flex h-[26px] items-center rounded-control px-2 text-[11.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ember"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => onDecide(leave.id, "approved")}
            className="inline-flex h-[26px] items-center gap-1 rounded-control bg-accent px-2 text-[11.5px] font-medium text-white transition-[filter] hover:brightness-105"
          >
            <Icon path={paths.check} size={12} width={2.4} />
            Approve
          </button>
        </span>
      ) : (
        <span
          className={cn(
            "shrink-0 text-[11px] font-medium",
            leave.status === "approved" ? "text-grass" : "text-ember"
          )}
        >
          {leave.status === "approved" ? "Approved" : "Declined"}
        </span>
      )}
    </li>
  )
}
