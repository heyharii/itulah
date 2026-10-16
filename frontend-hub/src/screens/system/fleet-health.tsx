import { ChevronDown } from "lucide-react"
import { useState } from "react"

import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { Banner } from "@/components/ui/states"
import { ago, moment } from "@/lib/format"
import {
  useFleetStatus,
  useFleetStatusOf,
  type FleetColour,
  type FleetComponent,
  type FleetRow,
} from "@/lib/queries/fleet"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import {
  FLEET_BANNER_TONE,
  FleetDayBars,
  FleetDayBarsPlaceholder,
  FleetDot,
  fleetKindWord,
  uptimeWord,
} from "@/screens/system/fleet-shared"

/// System › Store servers › Health — the owner's UptimeRobot-style status
/// page: one banner, one row per store (plus the warehouse and head office),
/// each expanding into its own parts.
///
/// The banner and every row's colour are the server's `state`/`colour`
/// (`backend/src/cloud/postgres/fleet_status.rs`): a row is the worst part
/// that can be judged, grey only when none can. Ninety-day bars are not on
/// the list page (`FleetRowView` carries only `uptime_90d`, one number) —
/// they arrive from `GET /fleet/status/{unit}`, fetched only once a row is
/// opened, which is what `useFleetStatusOf`'s `enabled` is for.
export function FleetHealth() {
  const status = useFleetStatus()
  return (
    <div className="flex flex-col gap-4">
      {queryState(status, {
        loading: "Reading the fleet…",
        render: (page) => {
          const rows = [page.head_office, ...page.stores]
          const worst = rows.reduce<FleetColour>(
            (acc, row) =>
              severity(row.colour) > severity(acc) ? row.colour : acc,
            "green"
          )
          const attention = rows.filter((row) => row.colour !== "green").length
          return (
            <>
              <Banner tone={FLEET_BANNER_TONE[worst]}>
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <b className="font-semibold">
                    {attention === 0
                      ? "All systems operational"
                      : `${attention} ${attention === 1 ? "row needs" : "rows need"} attention`}
                  </b>
                  <span className="text-meta opacity-80">
                    checked {ago(page.generated_at)}
                  </span>
                </span>
              </Banner>

              <Card className="overflow-hidden">
                <ul className="divide-y divide-hairline">
                  {rows.map((row) => (
                    <FleetRowItem key={row.key} row={row} />
                  ))}
                </ul>
              </Card>
            </>
          )
        },
      })}
    </div>
  )
}

const SEVERITY: Readonly<Record<FleetColour, number>> = {
  green: 0,
  grey: 1,
  yellow: 2,
  red: 3,
}
function severity(colour: FleetColour): number {
  return SEVERITY[colour]
}

function FleetRowItem({ row }: { row: FleetRow }) {
  const [expanded, setExpanded] = useState(false)
  const detail = useFleetStatusOf(row.key, expanded)
  const components = detail.data?.row.components ?? row.components

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((was) => !was)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-soft-2"
      >
        <FleetDot colour={row.colour} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <b className="truncate text-[0.9375rem] font-semibold text-ink">
              {row.name}
            </b>
            {row.unit_code && (
              <span className="shrink-0 font-mono text-pill text-mute">
                {row.unit_code}
              </span>
            )}
            <span className="shrink-0 text-meta text-mute">
              {fleetKindWord(row.kind)}
            </span>
          </span>
          <span className="block truncate text-meta text-body">
            {row.headline}
          </span>
        </span>
        <span className="hidden w-14 shrink-0 text-right text-meta text-mute tabular-nums sm:block">
          {uptimeWord(row.uptime_90d)}
        </span>
        {row.open_incidents > 0 && (
          <Pill tone="bad">
            {row.open_incidents}{" "}
            {row.open_incidents === 1 ? "incident" : "incidents"}
          </Pill>
        )}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-line-ico transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-hairline bg-soft px-4 py-3">
          {detail.isPending && components.length === 0 ? (
            <p className="text-meta text-body">Reading its parts…</p>
          ) : detail.isError && components.length === 0 ? (
            <p className="text-meta text-bad">
              Could not read this row&rsquo;s ninety days.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {components.map((component) => (
                <ComponentRow key={component.component} component={component} />
              ))}
            </ul>
          )}
          {row.last_heard_at !== null && (
            <p className="mt-2.5 text-meta text-mute">
              Last heard {ago(row.last_heard_at)}, {moment(row.last_heard_at)}.
            </p>
          )}
        </div>
      )}
    </li>
  )
}

function ComponentRow({ component }: { component: FleetComponent }) {
  return (
    <li className="flex items-start gap-3">
      <FleetDot colour={component.colour} className="mt-1.5" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <b className="text-[0.9375rem] font-medium text-ink">
            {component.label}
          </b>
          {component.days ? (
            <FleetDayBars days={component.days} />
          ) : (
            <FleetDayBarsPlaceholder />
          )}
        </span>
        <span className="block text-meta text-body">{component.sentence}</span>
      </span>
      <span className="w-12 shrink-0 text-right text-meta text-mute tabular-nums">
        {uptimeWord(component.uptime_90d)}
      </span>
    </li>
  )
}
