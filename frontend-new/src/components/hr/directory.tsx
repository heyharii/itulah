import { Icon } from "@/components/dashboard/parts"
import { Avatar, KIND_ICON, StatusDot, TypeChip } from "@/components/hr/parts"
import type { HrEmployee } from "@/components/hr/api"
import {
  type Employee,
  LOCATIONS,
  locationOf,
  tenureLabel,
} from "@/components/hr/data"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

interface ViewProps {
  people: Employee[]
  onOpen: (employee: Employee) => void
}

const DIRECTORY_COLUMNS = "268px 176px 168px 128px 96px minmax(0,1fr)"
const LIVE_DIRECTORY_COLUMNS = "268px 176px 168px 128px 132px minmax(0,1fr)"

const vrule =
  "border-r border-r-[color-mix(in_srgb,var(--line)_78%,transparent)]"

export function DirectoryTable({ people, onOpen }: ViewProps) {
  return (
    <VirtualRows
      rows={people}
      rowKey={(e) => e.id}
      columns={DIRECTORY_COLUMNS}
      rowHeight={54}
      className="min-w-[900px]"
      empty={<></>}
      header={
        <>
          <span className={cn("pl-3.5 text-left", vrule)}>Person</span>
          <span className={cn("text-left", vrule)}>Division</span>
          <span className={cn("text-left", vrule)}>Location</span>
          <span className={cn("text-left", vrule)}>Contract</span>
          <span className={cn("text-right", vrule)}>Tenure</span>
          <span className="pr-3.5 text-left">Status</span>
        </>
      }
      renderRow={(e) => {
        const location = locationOf(e.locationId)
        return (
          <>
            <span role="gridcell" className={cn("pr-3 pl-3.5", vrule)}>
              <button
                type="button"
                onClick={() => onOpen(e)}
                className="group/row flex w-full items-center gap-2.5 text-left"
              >
                <Avatar employee={e} size={30} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink group-hover/row:text-accent-ink">
                    {e.name}
                  </span>
                  <span className="block truncate text-[11px] text-ink-4">
                    {e.role}
                  </span>
                </span>
              </button>
            </span>
            <span role="gridcell" className={cn("px-3 text-xs text-ink-2", vrule)}>
              {e.division}
            </span>
            <span role="gridcell" className={cn("px-3", vrule)}>
              <span className="flex items-center gap-1.5 text-xs text-ink-2">
                <Icon
                  path={KIND_ICON[location?.kind ?? "store"]}
                  size={13}
                  width={1.8}
                  className="shrink-0 text-ink-4"
                />
                <span className="truncate">{location?.name}</span>
              </span>
            </span>
            <span role="gridcell" className={cn("px-3", vrule)}>
              <TypeChip type={e.employmentType} />
            </span>
            <span
              role="gridcell"
              className={cn(
                "px-3 text-right font-mono text-xs text-ink-3 tabular-nums",
                vrule
              )}
            >
              {tenureLabel(e.tenureMonths)}
            </span>
            <span role="gridcell" className="pr-3.5 pl-3 text-xs">
              <StatusDot status={e.status} />
            </span>
          </>
        )
      }}
    />
  )
}

export function DirectoryGrid({ people, onOpen }: ViewProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-2.5 p-3.5">
      {people.map((e) => {
        const location = locationOf(e.locationId)
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onOpen(e)}
            className="group/card flex flex-col items-center gap-2 rounded-panel border border-line-strong bg-surface p-3.5 text-center transition-[border-color,box-shadow] duration-[130ms] hover:border-accent hover:shadow-card"
          >
            <Avatar employee={e} size={52} />
            <span className="w-full min-w-0">
              <span className="block truncate text-[13px] font-semibold text-ink">
                {e.name}
              </span>
              <span className="block truncate text-[11.5px] text-ink-3">
                {e.role}
              </span>
            </span>
            <span className="flex w-full min-w-0 items-center justify-center gap-1.5 text-[11px] text-ink-4">
              <Icon
                path={KIND_ICON[location?.kind ?? "store"]}
                size={12}
                width={1.8}
                className="shrink-0"
              />
              <span className="truncate">{location?.name}</span>
            </span>
            <span className="mt-auto flex w-full items-center justify-between gap-2 border-t border-line pt-2 text-[11px]">
              <StatusDot status={e.status} />
              <span className="font-mono text-ink-4">
                {tenureLabel(e.tenureMonths)}
              </span>
            </span>
          </button>
        )
      })}
      {!people.length && (
        <div className="col-span-full py-14 text-center text-xs text-ink-4">
          Nobody matches this filter.
        </div>
      )}
    </div>
  )
}

interface LiveViewProps {
  people: HrEmployee[]
  onOpen: (employee: HrEmployee) => void
}

const liveHue = (id: string) => {
  const hues = ["#0086fc", "#7b5cfa", "#00c978", "#ff58ae", "#64c6ff"]
  return hues[
    id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) %
      hues.length
  ]
}

function liveStatusLabel(status: string) {
  return status
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function liveTypeLabel(type: string) {
  return type
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

/**
 * Renders Internal's employee read model without filling missing metrics from
 * the old demo roster. The backend employee endpoint has no tenure,
 * attendance, or overtime fields, so the table shows the fields it actually
 * owns and the employee's real join date instead.
 */
export function LiveDirectoryTable({ people, onOpen }: LiveViewProps) {
  return (
    <VirtualRows
      rows={people}
      rowKey={(employee) => employee.id}
      columns={LIVE_DIRECTORY_COLUMNS}
      rowHeight={54}
      className="min-w-[900px]"
      empty={
        <p className="py-14 text-center text-xs text-ink-4">
          Internal returned no employees for this filter.
        </p>
      }
      header={
        <>
          <span className={cn("pl-3.5 text-left", vrule)}>Person</span>
          <span className={cn("text-left", vrule)}>Department</span>
          <span className={cn("text-left", vrule)}>Location ID</span>
          <span className={cn("text-left", vrule)}>Employment</span>
          <span className={cn("text-left", vrule)}>Joined</span>
          <span className="pr-3.5 text-left">Status</span>
        </>
      }
      renderRow={(employee) => (
        <>
          <span role="gridcell" className={cn("pr-3 pl-3.5", vrule)}>
            <button
              type="button"
              onClick={() => onOpen(employee)}
              className="group/row flex w-full items-center gap-2.5 text-left"
            >
              <Avatar
                employee={{
                  name: employee.fullName,
                  hue: liveHue(employee.id),
                }}
                size={30}
              />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-ink group-hover/row:text-accent-ink">
                  {employee.fullName}
                </span>
                <span className="block truncate text-[11px] text-ink-4">
                  {employee.position || employee.employeeCode || employee.id}
                </span>
              </span>
            </button>
          </span>
          <span role="gridcell" className={cn("px-3 text-xs text-ink-2", vrule)}>
            {employee.department || "—"}
          </span>
          <span role="gridcell" className={cn("px-3", vrule)}>
            <span className="flex items-center gap-1.5 text-xs text-ink-2">
              <Icon
                path={
                  KIND_ICON[employee.locationType === "ho" ? "ho" : "store"]
                }
                size={13}
                width={1.8}
                className="shrink-0 text-ink-4"
              />
              <span className="truncate">{employee.locationId}</span>
            </span>
          </span>
          <span role="gridcell" className={cn("px-3 text-xs text-ink-2", vrule)}>
            {liveTypeLabel(employee.employmentType) || "—"}
          </span>
          <span
            role="gridcell"
            className={cn("px-3 font-mono text-xs text-ink-3", vrule)}
          >
            {employee.joinDate.slice(0, 10)}
          </span>
          <span role="gridcell" className="pr-3.5 pl-3 text-xs">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  employee.status === "active"
                    ? "bg-grass"
                    : employee.status === "probation"
                      ? "bg-honey"
                      : "bg-ember"
                )}
              />
              {liveStatusLabel(employee.status)}
            </span>
          </span>
        </>
      )}
    />
  )
}

export function LiveDirectoryGrid({ people, onOpen }: LiveViewProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-2.5 p-3.5">
      {people.map((employee) => (
        <button
          key={employee.id}
          type="button"
          onClick={() => onOpen(employee)}
          className="group/card flex flex-col items-center gap-2 rounded-panel border border-line-strong bg-surface p-3.5 text-center transition-[border-color,box-shadow] duration-[130ms] hover:border-accent hover:shadow-card"
        >
          <Avatar
            employee={{ name: employee.fullName, hue: liveHue(employee.id) }}
            size={52}
          />
          <span className="w-full min-w-0">
            <span className="block truncate text-[13px] font-semibold text-ink">
              {employee.fullName}
            </span>
            <span className="block truncate text-[11.5px] text-ink-3">
              {employee.position || employee.department || "—"}
            </span>
          </span>
          <span className="flex w-full min-w-0 items-center justify-center gap-1.5 text-[11px] text-ink-4">
            <Icon
              path={pathsForLiveLocation(employee.locationType)}
              size={12}
              width={1.8}
              className="shrink-0"
            />
            <span className="truncate">{employee.locationId}</span>
          </span>
          <span className="mt-auto flex w-full items-center justify-between gap-2 border-t border-line pt-2 text-[11px]">
            <span className="truncate text-ink-3">
              {liveStatusLabel(employee.status)}
            </span>
            <span className="font-mono text-ink-4">
              {employee.joinDate.slice(0, 10)}
            </span>
          </span>
        </button>
      ))}
      {!people.length && (
        <div className="col-span-full py-14 text-center text-xs text-ink-4">
          Internal returned no employees for this filter.
        </div>
      )}
    </div>
  )
}

function pathsForLiveLocation(locationType: string) {
  return KIND_ICON[locationType === "ho" ? "ho" : "store"]
}

/** The sidebar's location list, doubling as the headcount picture. */
export function LocationFilter({
  value,
  onPick,
}: {
  value: string | null
  onPick: (id: string | null) => void
}) {
  return (
    <>
      {LOCATIONS.map((l) => {
        const on = value === l.id
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => onPick(on ? null : l.id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors duration-[110ms] hover:bg-hover",
              on && "bg-hover"
            )}
          >
            <Icon
              path={KIND_ICON[l.kind]}
              size={15}
              width={1.8}
              className={cn("shrink-0", on ? "text-ink-2" : "text-ink-4")}
            />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-xs",
                  on ? "font-semibold text-ink" : "font-medium text-ink-2"
                )}
              >
                {l.name}
              </span>
              <span className="block truncate text-[10.5px] text-ink-4">
                {l.region}
              </span>
            </span>
          </button>
        )
      })}
    </>
  )
}
