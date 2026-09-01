import { useState } from "react"
import { Link, getRouteApi } from "@tanstack/react-router"
import { z } from "zod"

import { useAppForm, useSheetForm } from "@/shared/form"
import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton, Switch } from "@/components/dashboard/nav-sidebar"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { AppHeading } from "@/components/app-switcher"
import { Avatar, KIND_ICON, StatusDot, TypeChip } from "@/components/hr/parts"
import { Benefits } from "@/components/hr/benefits"
import { Documents, LiveDocuments } from "@/components/hr/documents"
import { Overview } from "@/components/hr/overview"
import {
  useHrDashboardOverview,
  useHrEmployee,
  useHrEmployees,
  type HrEmployee,
} from "@/components/hr/api"
import {
  LiveDirectoryGrid,
  LiveDirectoryTable,
  LocationFilter,
} from "@/components/hr/directory"
import { Decisions } from "@/components/hr/decisions"
import {
  DIVISIONS,
  allEmployees,
  type Employee,
  employeeOf,
  locationOf,
  tenureLabel,
} from "@/components/hr/data"
import {
  BASIS_LABEL,
  rupiah,
  shiftTime,
  todayKey,
  useHr,
  type ComponentBasis,
  type Holiday,
  type PayrollComponent,
  type ShiftType,
} from "@/components/hr/store"
import {
  cue,
  readSoundPreference,
  useInteractionSounds,
  writeSoundPreference,
} from "@/components/dashboard/use-interaction-sounds"
import { cn } from "@/lib/utils"
import { PreviewNotice } from "@/components/backend-status"
import type { HrHoSearch } from "@/routes/_people/hr-ho"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"

const route = getRouteApi("/_people/hr-ho")

export function HrHeadOffice() {
  /* what the screen is looking at comes off the URL; only unsaved drafts and
   * chrome below are local */
  const { tab, location, division, query, layout, open } = route.useSearch()
  const navigate = route.useNavigate()

  const dashboardResource = useHrDashboardOverview()
  const {
    requests,
    payroll,
    shifts,
    saveShift,
    removeShift,
    payrollComponents,
    savePayrollComponent,
    removePayrollComponent,
    holidays,
    saveHoliday,
    removeHoliday,
  } = useHr()
  const [shiftDraft, setShiftDraft] = useState<ShiftType | null>(null)
  const [componentDraft, setComponentDraft] = useState<PayrollComponent | null>(
    null
  )
  const [holidayDraft, setHolidayDraft] = useState<Holiday | null>(null)
  const [railHidden, setRailHidden] = useState(false)
  const [soundOn, setSoundOn] = useState(readSoundPreference)

  const employeeResource = useHrEmployees({
    locationId: location,
    department: division,
    search: query || undefined,
    limit: 200,
  })

  /* `open` is one id in the URL. A fixture id resolves against the local
   * registry; anything else is an Internal employee, fetched by id so a
   * pasted link opens the card even before the directory has loaded. */
  const fixtureOpen = open ? (employeeOf(open) ?? null) : null
  const liveOpenResource = useHrEmployee(
    open && !fixtureOpen ? open : undefined
  )
  const liveOpen: HrEmployee | null =
    open && !fixtureOpen ? (liveOpenResource.data ?? null) : null

  /* every filter and tab change is a replace — the Back button should leave
   * the app, not walk back through a dropdown */
  const setSearch = (next: Partial<HrHoSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })
  const setLocation = (next: string | undefined) =>
    setSearch({ location: next })
  const setDivision = (next: string | undefined) =>
    setSearch({ division: next })
  const setQuery = (next: string) => setSearch({ query: next || undefined })
  const setLayout = (next: "table" | "grid") => setSearch({ layout: next })
  const setOpen = (next: string | undefined) => setSearch({ open: next })

  useInteractionSounds(soundOn)

  const waiting =
    requests.filter((r) => r.status === "pending").length +
    payroll.filter((p) => p.status !== "released").length

  const goToLocation = (id: string) =>
    setSearch({
      tab: "directory",
      location: id,
      division: undefined,
      query: undefined,
      open: undefined,
    })

  const navRow =
    "flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] font-medium transition-colors duration-[110ms]"
  const cellRule =
    "border-b border-b-[color-mix(in_srgb,var(--line)_78%,transparent)]"

  return (
    <AppShell
      label="People navigation"
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
            <AppHeading app="hr-ho" />
            <IconButton
              label="Collapse sidebar"
              onClick={() => setRailHidden((v) => !v)}
            >
              <Icon path={paths.panel} size={17} />
            </IconButton>
          </div>

          <nav className="flex-1 overflow-auto px-2 pt-0.5 pb-2">
            {(
              [
                ["overview", "Overview", paths.grid, 0],
                [
                  "directory",
                  "People",
                  paths.people,
                  employeeResource.data?.total ?? 0,
                ],
                ["decisions", "Decisions", paths.check, waiting],
                ["shifts", "Shift types", paths.clock, shifts.length - 1],
                [
                  "components",
                  "Pay components",
                  paths.list,
                  payrollComponents.length,
                ],
                ["calendar", "Calendar", paths.clock, holidays.length],
                ["benefits", "Benefits", paths.tag, 0],
              ] as const
            ).map(([id, label, icon, count]) => {
              const on = tab === id
              return (
                <Link
                  key={id}
                  from="/hr-ho"
                  to="/hr-ho"
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
                    className={cn(
                      "shrink-0 text-ink-4 group-hover/nav:text-ink-2",
                      on && "text-ink-2"
                    )}
                  />
                  {label}
                  {count > 0 && (
                    <span
                      className={cn(
                        "ml-auto font-mono text-[10.5px]",
                        id === "decisions"
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

            <div className="mt-3.5 flex h-7 items-center px-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              Locations
            </div>
            <LocationFilter
              value={location ?? null}
              onPick={(id) =>
                setSearch({
                  location: id ?? undefined,
                  ...(id ? { tab: "directory" as const } : {}),
                })
              }
            />

            <div className="mt-3.5 flex h-7 items-center px-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              Divisions
            </div>
            {DIVISIONS.map((d) => {
              const on = division === d
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() =>
                    setSearch({
                      division: on ? undefined : d,
                      ...(on ? {} : { tab: "directory" as const }),
                    })
                  }
                  className={cn(
                    navRow,
                    "text-ink-2 hover:bg-hover hover:text-ink",
                    on && "bg-hover font-semibold text-ink"
                  )}
                >
                  <span className="truncate">{d}</span>
                  <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                    {allEmployees().filter((e) => e.division === d).length}
                  </span>
                </button>
              )
            })}
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
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface shadow-card">
          <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 pr-2.5 pl-3.5">
            <div className="flex min-w-0 items-baseline gap-2">
              <SidebarTrigger className="-ml-1 self-center" />
              <h1 className="text-sm font-semibold tracking-[-0.01em]">
                {tab === "overview"
                  ? "People overview"
                  : tab === "directory"
                    ? "People"
                    : tab === "shifts"
                      ? "Shift types"
                      : tab === "benefits"
                        ? "Benefits"
                        : tab === "components"
                          ? "Pay components"
                          : tab === "calendar"
                            ? "Calendar"
                            : "Decisions"}
              </h1>
              {tab === "directory" && (
                <span className="font-mono text-[11.5px] text-ink-4">
                  {employeeResource.data?.total ?? "—"}
                </span>
              )}
            </div>

            {tab === "directory" && (
              <div className="flex items-center gap-[7px]">
                <label className="inline-flex h-[30px] items-center gap-[7px] rounded-control bg-field px-[9px] text-ink-4 shadow-[inset_0_0_0_1px_var(--line)] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
                  <Icon path={paths.search} size={14} width={1.9} />
                  <input
                    value={query ?? ""}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Name, role, division…"
                    aria-label="Search people"
                    className="w-[158px] text-xs font-medium placeholder:text-ink-4"
                  />
                </label>
                <div className="flex items-center gap-0.5 rounded-control bg-inset p-0.5">
                  {(
                    [
                      ["table", paths.list, "Table view"],
                      ["grid", paths.grid, "Grid view"],
                    ] as const
                  ).map(([id, icon, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-label={label}
                      aria-pressed={layout === id}
                      onClick={() => setLayout(id)}
                      className={cn(
                        "grid size-[26px] place-items-center rounded-[7px] transition-[background-color,color,box-shadow] duration-[130ms]",
                        layout === id
                          ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line-strong),0_1px_2px_rgb(18_18_18/.05)]"
                          : "text-ink-4 hover:text-ink-2"
                      )}
                    >
                      <Icon path={icon} size={14} width={1.9} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <PreviewNotice
            title={
              dashboardResource.data || employeeResource.data
                ? "Mixed sources"
                : "Preview data"
            }
          >
            The overview counts read Internal&rsquo;s
            `/v1/hr/dashboard/overview`, and the People directory plus employee
            documents read Internal&rsquo;s relational HR endpoints. Attendance,
            leave, shifts, reimbursements, payroll, benefits, and write actions
            remain explicitly preview or read-only until their screen contracts
            are wired.
            {dashboardResource.errorMessage
              ? ` Dashboard unavailable (${dashboardResource.errorMessage}).`
              : ""}
          </PreviewNotice>

          {(location || division) && tab === "directory" && (
            <div className="flex h-10 shrink-0 items-center gap-1.5 border-t border-b border-t-line border-b-line-strong px-3.5">
              <span className="text-[11px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                Filtered
              </span>
              {[
                location && {
                  label: locationOf(location)?.name ?? "",
                  clear: () => setLocation(undefined),
                },
                division && {
                  label: division,
                  clear: () => setDivision(undefined),
                },
              ]
                .filter(Boolean)
                .map((chip) => (
                  <button
                    key={(chip as { label: string }).label}
                    type="button"
                    onClick={(chip as { clear: () => void }).clear}
                    className="inline-flex h-[26px] items-center gap-1.5 rounded-control bg-accent-tint px-2 text-xs font-medium text-accent-ink transition-[filter] hover:brightness-[0.97]"
                  >
                    {(chip as { label: string }).label}
                    <Icon path={paths.close} size={11} width={2.4} />
                  </button>
                ))}
            </div>
          )}

          {tab === "overview" && (
            <Overview
              onOpenLocation={goToLocation}
              liveOverview={dashboardResource.data}
            />
          )}
          {tab === "benefits" && <Benefits scope="ho" />}
          {tab === "calendar" && (
            <div className="min-h-0 flex-1 overflow-auto p-3.5">
              {/* the moving holidays are set by decree each year, so they are
                  typed in rather than guessed at */}
              <div className="mb-3 rounded-panel bg-inset px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
                Public holidays apply to every location. The fixed national
                dates are already here; the ones that move with the lunar
                calendar — Idul Fitri, Nyepi, Waisak — are set by decree each
                year, so add them as they are announced.
              </div>

              <ul className="overflow-hidden rounded-panel border border-line-strong">
                {holidays.map((holiday) => {
                  const date = new Date(`${holiday.date}T12:00:00`)
                  const past = holiday.date < todayKey()
                  return (
                    <li
                      key={holiday.id}
                      className="group/hol flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0"
                    >
                      <span
                        className={cn(
                          "grid size-[34px] shrink-0 place-items-center rounded-panel text-center",
                          past
                            ? "bg-inset text-ink-4"
                            : "bg-[color-mix(in_srgb,var(--coral)_14%,var(--surface))] text-coral"
                        )}
                      >
                        <span className="block font-mono text-[13px] leading-none font-semibold">
                          {date.getDate()}
                        </span>
                        <span className="block text-[8.5px] leading-none tracking-[0.04em] uppercase">
                          {date.toLocaleDateString("en-GB", { month: "short" })}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-[13px] font-medium",
                            past ? "text-ink-3" : "text-ink"
                          )}
                        >
                          {holiday.label}
                        </span>
                        <span className="block truncate text-[11px] text-ink-4">
                          {date.toLocaleDateString("en-GB", {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/hol:opacity-100">
                        <button
                          type="button"
                          onClick={() => setHolidayDraft(holiday)}
                          className="inline-flex h-[26px] items-center rounded-control px-2 text-xs font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${holiday.label}`}
                          onClick={() => removeHoliday(holiday.id)}
                          className="grid size-[26px] place-items-center rounded-control text-ink-4 transition-colors hover:bg-hover-2 hover:text-ember"
                        >
                          <Icon path={paths.trash} size={13} width={1.9} />
                        </button>
                      </span>
                    </li>
                  )
                })}
              </ul>

              <button
                type="button"
                onClick={() =>
                  setHolidayDraft({
                    id: `hol-${Date.now()}`,
                    date: todayKey(),
                    label: "",
                  })
                }
                className="mt-3 inline-flex h-[32px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors hover:bg-hover"
              >
                <Icon path={paths.plus} size={14} width={2.1} />
                Add a holiday
              </button>
            </div>
          )}

          {tab === "components" && (
            <div className="min-h-0 flex-1 overflow-auto p-3.5">
              {/* the payslip is assembled from these; a store only fills in the
                  ones marked manual, everything else the system computes */}
              <div className="mb-3 rounded-panel bg-inset px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
                Every payslip is built from base pay plus these components. Most
                are worked out from the roster and attendance; only the ones on
                a manual basis are typed in by a store.
              </div>

              <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
                <colgroup>
                  <col />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 168 }} />
                  <col style={{ width: 128 }} />
                  <col style={{ width: 178 }} />
                  <col style={{ width: 92 }} />
                </colgroup>
                <thead>
                  <tr className="[&>th]:h-9 [&>th]:border-y [&>th]:border-y-line-strong [&>th]:bg-surface [&>th]:px-2.5 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-[0.04em] [&>th]:text-ink-3 [&>th]:uppercase">
                    <th className="text-left">Component</th>
                    <th className="text-left">Effect</th>
                    <th className="text-left">Basis</th>
                    <th className="text-right">Rate</th>
                    <th className="text-left">Applies to</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {payrollComponents.map((component) => (
                    <tr
                      key={component.id}
                      className="group/row hover:[&>td]:bg-hover"
                    >
                      <td
                        className={cn(
                          "h-row px-2.5 align-middle text-xs font-medium text-ink",
                          cellRule
                        )}
                      >
                        {component.label}
                      </td>
                      <td className={cn("px-2.5 align-middle", cellRule)}>
                        <span
                          className={cn(
                            "inline-flex h-[19px] items-center rounded-chip px-1.5 text-[10.5px] font-medium",
                            component.kind === "earning"
                              ? "bg-green-tint text-green"
                              : "bg-red-tint text-red"
                          )}
                        >
                          {component.kind === "earning"
                            ? "Earning"
                            : "Deduction"}
                        </span>
                      </td>
                      <td
                        className={cn(
                          "px-2.5 align-middle text-[11.5px] text-ink-3",
                          cellRule
                        )}
                      >
                        {BASIS_LABEL[component.basis]}
                      </td>
                      <td
                        className={cn(
                          "px-2.5 text-right align-middle font-mono text-xs text-ink-2 tabular-nums",
                          cellRule
                        )}
                      >
                        {component.basis === "manual"
                          ? "—"
                          : component.basis === "percent-of-base"
                            ? `${component.rate}%`
                            : rupiah(component.rate)}
                      </td>
                      <td
                        className={cn(
                          "px-2.5 align-middle text-[11.5px] text-ink-3",
                          cellRule
                        )}
                      >
                        {component.appliesTo.length === 0
                          ? "Everyone"
                          : component.appliesTo.join(", ")}
                      </td>
                      <td
                        className={cn(
                          "px-2.5 text-right align-middle",
                          cellRule
                        )}
                      >
                        <span className="flex justify-end gap-1 opacity-0 transition-opacity group-hover/row:opacity-100">
                          <button
                            type="button"
                            onClick={() => setComponentDraft(component)}
                            className="inline-flex h-[24px] items-center rounded-control px-2 text-[11px] font-medium text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${component.label}`}
                            onClick={() => removePayrollComponent(component.id)}
                            className="grid size-[24px] place-items-center rounded-control text-ink-4 transition-colors hover:bg-hover-2 hover:text-ember"
                          >
                            <Icon path={paths.trash} size={13} width={1.9} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <button
                type="button"
                onClick={() =>
                  setComponentDraft({
                    id: `pc-${Date.now()}`,
                    label: "",
                    kind: "earning",
                    basis: "fixed",
                    rate: 0,
                    appliesTo: [],
                  })
                }
                className="mt-3 inline-flex h-[32px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors hover:bg-hover"
              >
                <Icon path={paths.plus} size={14} width={2.1} />
                Add a component
              </button>
            </div>
          )}
          {tab === "shifts" && (
            <div className="min-h-0 flex-1 overflow-auto p-3.5">
              {/* stores assign these; only Head Office defines them, so hours
                  stay comparable across every location */}
              <div className="mb-3 rounded-panel bg-inset px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
                Stores build their roster from this list. They choose who works
                which shift — they cannot invent a new one.
              </div>

              <ul className="overflow-hidden rounded-panel border border-line-strong">
                {shifts.map((shift) => (
                  <li
                    key={shift.id}
                    className="group/shift flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0"
                  >
                    <span
                      style={{ background: shift.hue }}
                      className="size-3 shrink-0 rounded-full"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {shift.label}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-ink-4">
                        {shiftTime(shift)}
                      </span>
                    </span>
                    {shift.locked ? (
                      <span className="shrink-0 text-[11px] text-ink-4">
                        Always available
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/shift:opacity-100">
                        <button
                          type="button"
                          onClick={() => setShiftDraft(shift)}
                          className="inline-flex h-[26px] items-center rounded-control px-2 text-xs font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${shift.label}`}
                          onClick={() => removeShift(shift.id)}
                          className="grid size-[26px] place-items-center rounded-control text-ink-4 transition-colors hover:bg-hover-2 hover:text-ember"
                        >
                          <Icon path={paths.trash} size={13} width={1.9} />
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() =>
                  setShiftDraft({
                    id: `shift-${Date.now()}`,
                    label: "",
                    start: "09:00",
                    end: "17:00",
                    hue: "#00c978",
                  })
                }
                className="mt-3 inline-flex h-[32px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors hover:bg-hover"
              >
                <Icon path={paths.plus} size={14} width={2.1} />
                Add a shift type
              </button>
            </div>
          )}
          {tab === "decisions" && <Decisions onOpenLocation={goToLocation} />}
          {tab === "directory" && (
            <div className="min-h-0 flex-1 overflow-auto">
              {employeeResource.isLoading && (
                <div className="p-3.5 text-xs text-ink-4">
                  Loading employees from Internal…
                </div>
              )}
              {employeeResource.errorMessage && (
                <div className="m-3.5 rounded-panel bg-red-tint px-3 py-3 text-xs text-red">
                  Could not load Internal employees:{" "}
                  {employeeResource.errorMessage}
                </div>
              )}
              {!employeeResource.isLoading &&
                !employeeResource.errorMessage &&
                employeeResource.data &&
                (layout === "table" ? (
                  <LiveDirectoryTable
                    people={employeeResource.data.items}
                    onOpen={(e) => setOpen(e.id)}
                  />
                ) : (
                  <LiveDirectoryGrid
                    people={employeeResource.data.items}
                    onOpen={(e) => setOpen(e.id)}
                  />
                ))}
            </div>
          )}
        </div>
      </main>

      <HolidaySheet
        holiday={holidayDraft}
        onClose={() => setHolidayDraft(null)}
        onSave={saveHoliday}
      />

      <PayComponentSheet
        component={componentDraft}
        onClose={() => setComponentDraft(null)}
        onSave={savePayrollComponent}
      />

      <ShiftSheet
        shift={shiftDraft}
        onClose={() => setShiftDraft(null)}
        onSave={saveShift}
      />

      <SheetShell
        open={Boolean(fixtureOpen)}
        eyebrow={fixtureOpen?.division ?? "Person"}
        title={fixtureOpen?.name ?? ""}
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
        {fixtureOpen && (
          <PersonDetail employee={fixtureOpen} onOpenLocation={goToLocation} />
        )}
      </SheetShell>

      <SheetShell
        open={Boolean(open) && !fixtureOpen}
        eyebrow={liveOpen?.department || "Employee"}
        title={liveOpen?.fullName || ""}
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
        {liveOpen ? (
          <LivePersonDetail employee={liveOpen} />
        ) : (
          <div className="px-[18px] py-4 text-xs text-ink-4">
            {liveOpenResource.errorMessage
              ? `Could not load this employee: ${liveOpenResource.errorMessage}`
              : "Loading employee from Internal…"}
          </div>
        )}
      </SheetShell>
    </AppShell>
  )
}

/* ── the three sheets Head Office authors here: holidays, pay components,
 *    shift types. Each is opened with a full draft already in hand — a copy
 *    of the row being edited, or a blank one with a client-minted id for a
 *    new row — so there is no async load to key the form on; the draft's id
 *    is the opening's identity. */

const holidayInput = z.object({
  label: z.string().trim().min(1, "Name the holiday."),
  date: z.string(),
})
type HolidayDraft = z.infer<typeof holidayInput>

function HolidaySheet({
  holiday,
  onClose,
  onSave,
}: {
  holiday: Holiday | null
  onClose: () => void
  onSave: (holiday: Holiday) => void
}) {
  return (
    <SheetShell
      open={Boolean(holiday)}
      eyebrow="Public holiday"
      title={holiday?.label || "New holiday"}
      onRequestClose={onClose}
      footer={null}
    >
      {holiday && (
        <HolidayForm key={holiday.id} holiday={holiday} onClose={onClose} onSave={onSave} />
      )}
    </SheetShell>
  )
}

function HolidayForm({
  holiday,
  onClose,
  onSave,
}: {
  holiday: Holiday
  onClose: () => void
  onSave: (holiday: Holiday) => void
}) {
  const { error, run } = useSheetForm(onClose)

  const form = useAppForm({
    defaultValues: {
      label: holiday.label,
      date: holiday.date,
    } satisfies HolidayDraft,
    validators: { onChange: holidayInput },
    onSubmit: async ({ value }) => {
      await run(async () => {
        onSave({ ...holiday, ...value, label: value.label.trim() })
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
        <form.AppField name="label">
          {(field) => (
            <field.TextField
              label="Name"
              required
              placeholder="Idul Fitri, Nyepi, Waisak…"
            />
          )}
        </form.AppField>
        <form.AppField name="date">
          {(field) => <field.DateField label="Date" />}
        </form.AppField>
        <p className="pt-2 text-[11px] leading-[1.5] text-ink-4">
          Nobody is marked absent on this day, and no store can roster it
          away.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3.5 py-3">
        <span className="flex-1" />
        <button type="button" onClick={onClose} className={sheetButton.secondary}>
          Cancel
        </button>
        <form.SubmitButton label="Save" />
      </div>
    </form>
  )
}

const payComponentInput = z.object({
  label: z.string().trim().min(1, "Name the component."),
  kind: z.enum(["earning", "deduction"]),
  basis: z.custom<ComponentBasis>(),
  rate: z.number(),
  appliesTo: z.array(z.custom<PayrollComponent["appliesTo"][number]>()),
})
type PayComponentDraft = z.infer<typeof payComponentInput>

function PayComponentSheet({
  component,
  onClose,
  onSave,
}: {
  component: PayrollComponent | null
  onClose: () => void
  onSave: (component: PayrollComponent) => void
}) {
  return (
    <SheetShell
      open={Boolean(component)}
      eyebrow="Pay component"
      title={component?.label || "New component"}
      onRequestClose={onClose}
      footer={null}
    >
      {component && (
        <PayComponentForm
          key={component.id}
          component={component}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </SheetShell>
  )
}

function PayComponentForm({
  component,
  onClose,
  onSave,
}: {
  component: PayrollComponent
  onClose: () => void
  onSave: (component: PayrollComponent) => void
}) {
  const { error, run } = useSheetForm(onClose)

  const form = useAppForm({
    defaultValues: {
      label: component.label,
      kind: component.kind,
      basis: component.basis,
      rate: component.rate,
      appliesTo: component.appliesTo,
    } satisfies PayComponentDraft,
    validators: { onChange: payComponentInput },
    onSubmit: async ({ value }) => {
      await run(async () => {
        onSave({ ...component, ...value, label: value.label.trim() })
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
        <form.AppField name="label">
          {(field) => (
            <field.TextField
              label="Name"
              required
              placeholder="Transport allowance, BPJS…"
            />
          )}
        </form.AppField>

        <form.AppField name="kind">
          {(field) => (
            <div className="pb-3.5">
              <span className="block pb-1.5 text-xs font-medium text-ink-2">
                Effect
              </span>
              <div className="flex gap-1.5">
                {(["earning", "deduction"] as const).map((kind) => {
                  const on = field.state.value === kind
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => field.handleChange(kind)}
                      className={cn(
                        "inline-flex h-[32px] flex-1 items-center justify-center rounded-control text-xs font-medium transition-colors",
                        on
                          ? kind === "earning"
                            ? "bg-green-tint text-green shadow-[inset_0_0_0_1.5px_var(--grass)]"
                            : "bg-red-tint text-red shadow-[inset_0_0_0_1.5px_var(--ember)]"
                          : "bg-surface text-ink-2 shadow-btn hover:bg-hover"
                      )}
                    >
                      {kind === "earning" ? "Adds to pay" : "Takes from pay"}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </form.AppField>

        <form.AppField name="basis">
          {(field) => (
            <field.SelectField
              label="Basis"
              options={(Object.keys(BASIS_LABEL) as ComponentBasis[]).map((basis) => ({
                value: basis,
                label: BASIS_LABEL[basis],
              }))}
            />
          )}
        </form.AppField>

        <form.Subscribe selector={(state) => state.values.basis}>
          {(basis) =>
            basis !== "manual" && (
              <form.AppField name="rate">
                {(field) => (
                  <div className="pb-3.5">
                    <field.NumberField
                      label={basis === "percent-of-base" ? "Percent" : "Amount"}
                    />
                    <p className="pt-1 text-right font-mono text-[11px] text-ink-4">
                      {basis === "percent-of-base"
                        ? `${field.state.value ?? 0}% of base`
                        : rupiah(field.state.value ?? 0)}
                    </p>
                  </div>
                )}
              </form.AppField>
            )
          }
        </form.Subscribe>

        <form.AppField name="appliesTo">
          {(field) => (
            <div>
              <span className="block pb-1.5 text-xs font-medium text-ink-2">
                Applies to{" "}
                <span className="font-normal text-ink-4">
                  — none selected means everyone
                </span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {(["permanent", "contract", "part-time", "intern"] as const).map(
                  (type) => {
                    const on = field.state.value.includes(type)
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() =>
                          field.handleChange(
                            on
                              ? field.state.value.filter((t) => t !== type)
                              : [...field.state.value, type]
                          )
                        }
                        className={cn(
                          "inline-flex h-[28px] items-center rounded-control px-2.5 text-[11.5px] font-medium capitalize transition-colors",
                          on
                            ? "bg-accent-tint text-accent-ink shadow-[inset_0_0_0_1.5px_var(--accent)]"
                            : "bg-surface text-ink-2 shadow-btn hover:bg-hover"
                        )}
                      >
                        {type}
                      </button>
                    )
                  }
                )}
              </div>
            </div>
          )}
        </form.AppField>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3.5 py-3">
        <span className="flex-1" />
        <button type="button" onClick={onClose} className={sheetButton.secondary}>
          Cancel
        </button>
        <form.SubmitButton label="Save" />
      </div>
    </form>
  )
}

const shiftInput = z.object({
  label: z.string().trim().min(1, "Name the shift."),
  start: z.string(),
  end: z.string(),
  hue: z.string(),
})
type ShiftDraft = z.infer<typeof shiftInput>

const SHIFT_HUES = [
  "#0086fc",
  "#7b5cfa",
  "#ffbb26",
  "#00c978",
  "#ff58ae",
  "#64c6ff",
  "#ff3e00",
]

function ShiftSheet({
  shift,
  onClose,
  onSave,
}: {
  shift: ShiftType | null
  onClose: () => void
  onSave: (shift: ShiftType) => void
}) {
  return (
    <SheetShell
      open={Boolean(shift)}
      eyebrow="Shift type"
      title={shift?.label || "New shift"}
      onRequestClose={onClose}
      footer={null}
    >
      {shift && (
        <ShiftForm key={shift.id} shift={shift} onClose={onClose} onSave={onSave} />
      )}
    </SheetShell>
  )
}

function ShiftForm({
  shift,
  onClose,
  onSave,
}: {
  shift: ShiftType
  onClose: () => void
  onSave: (shift: ShiftType) => void
}) {
  const { error, run } = useSheetForm(onClose)

  const form = useAppForm({
    defaultValues: {
      label: shift.label,
      start: shift.start,
      end: shift.end,
      hue: shift.hue,
    } satisfies ShiftDraft,
    validators: { onChange: shiftInput },
    onSubmit: async ({ value }) => {
      await run(async () => {
        onSave({ ...shift, ...value, label: value.label.trim() })
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
        <form.AppField name="label">
          {(field) => (
            <field.TextField
              label="Name"
              required
              placeholder="Morning, Split, Weekend…"
            />
          )}
        </form.AppField>

        {/* no TimeField exists in the shared layer, so these stay bound
         * through the raw field API to keep the native time picker */}
        <div className="grid grid-cols-2 gap-2.5 pb-3.5">
          <form.AppField name="start">
            {(field) => (
              <div>
                <label
                  htmlFor={field.name}
                  className="block pb-1.5 text-xs font-medium text-ink-2"
                >
                  Starts
                </label>
                <input
                  id={field.name}
                  type="time"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  className="h-[36px] w-full rounded-control bg-field px-2.5 font-mono text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                />
              </div>
            )}
          </form.AppField>
          <form.AppField name="end">
            {(field) => (
              <div>
                <label
                  htmlFor={field.name}
                  className="block pb-1.5 text-xs font-medium text-ink-2"
                >
                  Ends
                </label>
                <input
                  id={field.name}
                  type="time"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  className="h-[36px] w-full rounded-control bg-field px-2.5 font-mono text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                />
              </div>
            )}
          </form.AppField>
        </div>

        <form.AppField name="hue">
          {(field) => (
            <div>
              <span className="block pb-1.5 text-xs font-medium text-ink-2">
                Colour
              </span>
              <div className="flex flex-wrap gap-1.5">
                {SHIFT_HUES.map((hue) => (
                  <button
                    key={hue}
                    type="button"
                    aria-label={`Use ${hue}`}
                    onClick={() => field.handleChange(hue)}
                    style={{ background: hue }}
                    className={cn(
                      "size-7 rounded-chip transition-[box-shadow,transform] duration-[130ms] hover:scale-105",
                      field.state.value === hue &&
                        "ring-2 ring-accent ring-offset-2 ring-offset-surface"
                    )}
                  />
                ))}
              </div>
            </div>
          )}
        </form.AppField>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3.5 py-3">
        <span className="flex-1" />
        <button type="button" onClick={onClose} className={sheetButton.secondary}>
          Cancel
        </button>
        <form.SubmitButton label="Save" />
      </div>
    </form>
  )
}

function LivePersonDetail({ employee }: { employee: HrEmployee }) {
  return (
    <div className="px-[18px] pt-4 pb-[18px]">
      <div className="flex items-center gap-3 pb-4">
        <Avatar
          employee={{ name: employee.fullName, hue: "#0086fc" }}
          size={52}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {employee.fullName}
          </div>
          <div className="truncate text-xs text-ink-4">
            {employee.position || employee.department || "—"}
          </div>
          <div className="pt-1 text-[11px] text-ink-4">
            {employee.employeeCode || employee.id}
          </div>
        </div>
      </div>

      {[
        { label: "Department", value: employee.department || "—" },
        { label: "Location ID", value: employee.locationId },
        { label: "Employment", value: employee.employmentType || "—" },
        { label: "Status", value: employee.status },
        { label: "Joined", value: employee.joinDate.slice(0, 10) },
        {
          label: "Contract ends",
          value: employee.contractEnd?.slice(0, 10) || "—",
        },
        { label: "Manager ID", value: employee.managerId || "—" },
        { label: "Email", value: employee.email || "—" },
        { label: "Phone", value: employee.phone || "—" },
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
        <LiveDocuments employee={employee} />
      </div>
    </div>
  )
}

function PersonDetail({
  employee,
  onOpenLocation,
}: {
  employee: Employee
  onOpenLocation: (id: string) => void
}) {
  const location = locationOf(employee.locationId)
  const manager = employeeOf(employee.managerId)
  const reports = allEmployees().filter((e) => e.managerId === employee.id)

  return (
    <div className="px-[18px] pt-4 pb-[18px]">
      <div className="flex items-center gap-3 pb-4">
        <Avatar employee={employee} size={52} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{employee.name}</div>
          <div className="truncate text-xs text-ink-4">{employee.role}</div>
          <div className="pt-1">
            <TypeChip type={employee.employmentType} />
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        {[
          { label: "Attendance", value: `${employee.attendance}%` },
          { label: "Overtime", value: `${employee.overtimeHours}h` },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
              {s.label}
            </div>
            <div className="font-mono text-[15px] font-medium text-ink">
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {[
        { label: "Division", value: employee.division },
        { label: "Tenure", value: tenureLabel(employee.tenureMonths) },
        { label: "Status", value: <StatusDot status={employee.status} /> },
        { label: "Manager", value: manager?.name ?? "—" },
        {
          label: "Reports",
          value: reports.length ? `${reports.length} people` : "—",
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

      <button
        type="button"
        onClick={() => onOpenLocation(employee.locationId)}
        className="mt-3 flex w-full items-center gap-2.5 rounded-panel bg-inset px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-hover"
      >
        <Icon
          path={KIND_ICON[location?.kind ?? "store"]}
          size={16}
          width={1.8}
          className="shrink-0 text-ink-3"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-ink">
            {location?.name}
          </span>
          <span className="block truncate text-[11px] text-ink-4">
            {location?.region}
          </span>
        </span>
        <Icon
          path={paths.chevronRight}
          size={14}
          width={2}
          className="shrink-0 text-ink-4"
        />
      </button>

      <div className="pt-4">
        <Documents employee={employee} scope="ho" uploader="People" />
      </div>
    </div>
  )
}
