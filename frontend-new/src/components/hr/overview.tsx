import { Icon, paths } from "@/components/dashboard/parts"
import {
  Avatar,
  KIND_ICON,
  PlanBar,
  Stat,
  smallIcon,
} from "@/components/hr/parts"
import type { HrDashboardOverview } from "@/components/hr/api"
import {
  allEmployees,
  type Employee,
  LEAVERS,
  LOCATIONS,
  OVERTIME_THRESHOLD,
  locationStats,
} from "@/components/hr/data"
import { cn } from "@/lib/utils"

export function Overview({
  onOpenLocation,
  liveOverview,
}: {
  onOpenLocation: (id: string) => void
  liveOverview?: HrDashboardOverview
}) {
  const stats = LOCATIONS.map((l) => locationStats(l.id))
  const headcount = allEmployees().length
  const plan = LOCATIONS.reduce((sum, l) => sum + l.plan, 0)
  const openPositions = stats.reduce((sum, s) => sum + Math.max(0, s.gap), 0)
  const understaffed = stats.filter((s) => s.gap > 0)
  const overtimePeople = allEmployees().filter(
    (e) => e.overtimeHours > OVERTIME_THRESHOLD
  )
  const onNotice = allEmployees().filter((e) => e.status === "notice")
  const expiring = allEmployees()
    .filter((e) => {
      if (!e.contractEndsOn) return false
      const days = daysUntil(e.contractEndsOn)
      return days <= 60
    })
    .sort((a, b) => daysUntil(a.contractEndsOn!) - daysUntil(b.contractEndsOn!))
    .slice(0, 8)
  const turnover = Math.round((LEAVERS.length / headcount) * 100)

  const rule =
    "border-b border-b-[color-mix(in_srgb,var(--line)_78%,transparent)]"

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {liveOverview && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-inset px-3.5 py-2 text-[11px] text-ink-3">
          <span className="font-semibold text-ink-2">
            Live Internal HR snapshot
          </span>
          <span>
            {liveOverview.headcountTotal} people ·{" "}
            {liveOverview.headcountActive} active ·{" "}
            {liveOverview.headcountInactive} inactive
          </span>
          <span>
            {liveOverview.leavePending} leave request
            {liveOverview.leavePending === 1 ? "" : "s"} pending
          </span>
          <span>
            {liveOverview.overtimePending} overtime request
            {liveOverview.overtimePending === 1 ? "" : "s"} pending
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 border-b border-line-strong lg:grid-cols-5">
        <Stat
          label="Headcount"
          icon={smallIcon(paths.people)}
          value={headcount}
          unit={`of ${plan}`}
          hint={`${LOCATIONS.length} locations`}
        />
        <Stat
          label="Open positions"
          icon={smallIcon(paths.plus)}
          value={openPositions}
          unit="to fill"
          tone={openPositions > 8 ? "warn" : undefined}
          hint={`${understaffed.length} locations short`}
        />
        <Stat
          label="Over on overtime"
          icon={smallIcon(paths.clock)}
          value={overtimePeople.length}
          unit="people"
          tone={
            overtimePeople.length > 12
              ? "bad"
              : overtimePeople.length > 5
                ? "warn"
                : undefined
          }
          hint={`above ${OVERTIME_THRESHOLD}h this month`}
        />
        <Stat
          label="On notice"
          icon={smallIcon(paths.alert)}
          value={onNotice.length}
          unit="leaving"
          tone={onNotice.length > 4 ? "warn" : undefined}
          hint="replacements to plan"
        />
        <Stat
          label="Turnover"
          icon={smallIcon(paths.chart)}
          value={turnover}
          unit="%"
          tone={turnover > 12 ? "warn" : undefined}
          hint="rolling 12 months"
        />
      </div>

      {/* the table HO actually works from: one row per location, exceptions first */}
      <table className="w-full min-w-[820px] table-fixed border-separate border-spacing-0 text-[13px]">
        <colgroup>
          <col style={{ width: 248 }} />
          <col style={{ width: 176 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 108 }} />
          <col style={{ width: 104 }} />
          <col />
        </colgroup>
        <thead>
          <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-5 [&>th]:h-9 [&>th]:border-b [&>th]:border-b-line-strong [&>th]:bg-surface [&>th]:px-3 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-[0.04em] [&>th]:text-ink-3 [&>th]:uppercase">
            <th className="pl-3.5 text-left">Location</th>
            <th className="text-left">Headcount vs plan</th>
            <th className="text-right">Gap</th>
            <th className="text-right">Overtime</th>
            <th className="text-right">Attendance</th>
            <th className="pr-3.5 text-left">Team</th>
          </tr>
        </thead>
        <tbody>
          {[...stats]
            .sort((a, b) => b.gap - a.gap || b.overtime - a.overtime)
            .map((s) => (
              <tr
                key={s.location!.id}
                className="group/row hover:[&>td]:bg-hover"
              >
                <td className={cn("h-[58px] pr-3 pl-3.5 align-middle", rule)}>
                  <button
                    type="button"
                    onClick={() => onOpenLocation(s.location!.id)}
                    className="flex w-full items-center gap-2.5 text-left"
                  >
                    <span className="grid size-[30px] shrink-0 place-items-center rounded-panel bg-inset text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
                      <Icon
                        path={KIND_ICON[s.location!.kind]}
                        size={15}
                        width={1.8}
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink group-hover/row:text-accent-ink">
                        {s.location!.name}
                      </span>
                      <span className="block truncate text-[11px] text-ink-4">
                        {s.location!.region} ·{" "}
                        {s.location!.kind === "ho"
                          ? "Head office"
                          : s.location!.kind === "store"
                            ? "Store"
                            : "Distribution"}
                      </span>
                    </span>
                  </button>
                </td>

                <td className={cn("px-3 align-middle", rule)}>
                  <PlanBar actual={s.headcount} plan={s.plan} />
                </td>

                <td
                  className={cn(
                    "px-3 text-right align-middle font-mono text-[12.5px] tabular-nums",
                    rule
                  )}
                >
                  <span
                    className={cn(
                      s.gap > 2
                        ? "text-ember"
                        : s.gap > 0
                          ? "text-honey"
                          : "text-ink-4"
                    )}
                  >
                    {s.gap > 0 ? `−${s.gap}` : s.gap < 0 ? `+${-s.gap}` : "0"}
                  </span>
                </td>

                <td
                  className={cn(
                    "px-3 text-right align-middle font-mono text-[12.5px] tabular-nums",
                    rule
                  )}
                >
                  <span
                    className={cn(s.overtime > 2 ? "text-honey" : "text-ink-3")}
                  >
                    {s.overtime}
                  </span>
                </td>

                <td
                  className={cn(
                    "px-3 text-right align-middle font-mono text-[12.5px] text-ink-3 tabular-nums",
                    rule
                  )}
                >
                  {s.attendance}%
                </td>

                <td className={cn("pr-3.5 pl-3 align-middle", rule)}>
                  <span className="flex items-center -space-x-2">
                    {s.people.slice(0, 6).map((e) => (
                      <Avatar
                        key={e.id}
                        employee={e}
                        size={24}
                        className="ring-2 ring-surface"
                      />
                    ))}
                    {s.people.length > 6 && (
                      <span className="grid size-6 place-items-center rounded-full bg-inset font-mono text-[10px] text-ink-3 ring-2 ring-surface">
                        +{s.people.length - 6}
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      {/* the lists HO chases this week */}
      <div className="grid gap-3 p-3.5 lg:grid-cols-3">
        <Panel
          title="Leaving soon"
          hint="Plan the replacement before the last day"
          people={onNotice}
          onOpenLocation={onOpenLocation}
          empty="Nobody is on notice."
        />
        <Panel
          title={`Overtime above ${OVERTIME_THRESHOLD}h`}
          hint="Staffing gap showing up as hours"
          people={[...overtimePeople]
            .sort((a, b) => b.overtimeHours - a.overtimeHours)
            .slice(0, 8)}
          onOpenLocation={onOpenLocation}
          metric={(e) => `${e.overtimeHours}h`}
          empty="Overtime is within budget everywhere."
        />
        {/* a contract that lapses unnoticed is somebody working without one */}
        <Panel
          title="Contracts to renew"
          hint="Fixed terms ending within 60 days"
          people={expiring}
          onOpenLocation={onOpenLocation}
          metric={(e) => contractLabel(e.contractEndsOn)}
          empty="No contract ends in the next 60 days."
        />
      </div>
    </div>
  )
}

const daysUntil = (date: string) =>
  Math.round(
    (new Date(`${date}T12:00:00`).getTime() -
      new Date().setHours(12, 0, 0, 0)) /
      86_400_000
  )

const contractLabel = (date?: string) => {
  if (!date) return "—"
  const days = daysUntil(date)
  return days < 0 ? `${Math.abs(days)}d over` : `${days}d`
}

function Panel({
  title,
  hint,
  people,
  metric,
  empty,
  onOpenLocation,
}: {
  title: string
  hint: string
  people: Employee[]
  metric?: (e: Employee) => string
  empty: string
  onOpenLocation: (id: string) => void
}) {
  return (
    <section className="overflow-hidden rounded-panel border border-line-strong">
      <div className="border-b border-line px-3.5 py-2.5">
        <div className="text-[12.5px] font-semibold text-ink">{title}</div>
        <div className="text-[11px] text-ink-4">{hint}</div>
      </div>
      {people.length === 0 ? (
        <div className="px-3.5 py-6 text-center text-[11.5px] text-ink-4">
          {empty}
        </div>
      ) : (
        <ul>
          {people.map((e) => {
            const location = LOCATIONS.find((l) => l.id === e.locationId)
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onOpenLocation(e.locationId)}
                  className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-hover"
                >
                  <Avatar employee={e} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink">
                      {e.name}
                    </span>
                    <span className="block truncate text-[11px] text-ink-4">
                      {e.role} · {location?.name}
                    </span>
                  </span>
                  {metric && (
                    <span className="shrink-0 font-mono text-[11.5px] text-honey tabular-nums">
                      {metric(e)}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
