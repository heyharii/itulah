import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import {
  useFleetStatusOf,
  useFleetSync,
  type FleetDayBar,
  type FleetSyncRow,
} from "@/lib/queries/fleet"
import { queryState } from "@/lib/query-state"
import {
  FLEET_PILL_TONE,
  FleetDot,
  fleetKindWord,
} from "@/screens/system/fleet-shared"
import { cn } from "@/lib/utils"

const STATE_WORD: Readonly<Record<FleetSyncRow["state"], string>> = {
  SYNCED: "Synced",
  BEHIND: "Behind",
  OFFLINE: "Offline",
  NEVER_SEEN: "Never seen",
}

/// System › Store servers › Sync — freshness and queues, never a percentage
/// (owner's rule, `CONTEXT.md`/the fleet brief). Every sentence below is the
/// server's own (`FleetFreshness.sentence`,
/// `backend/src/cloud/postgres/fleet_status.rs::node_freshness`) — this
/// screen orders and labels them, it does not compose new wording, the same
/// discipline `screens/system/health.tsx` documents for the old sync board.
export function FleetSync() {
  const sync = useFleetSync()
  return (
    <div className="flex flex-col gap-4">
      {queryState(sync, {
        loading: "Reading sync…",
        render: (page) => (
          <>
            <div className="flex flex-wrap gap-2 text-meta text-body">
              <Pill tone="ok">{page.summary.synced} synced</Pill>
              {page.summary.behind > 0 && (
                <Pill tone="warn">{page.summary.behind} behind</Pill>
              )}
              {page.summary.offline > 0 && (
                <Pill tone="bad">{page.summary.offline} offline</Pill>
              )}
              {page.summary.never_seen > 0 && (
                <Pill tone="neutral">{page.summary.never_seen} never seen</Pill>
              )}
            </div>

            <Card className="overflow-hidden">
              <div className="hidden grid-cols-[minmax(0,14rem)_minmax(0,1fr)_8rem] gap-4 bg-soft px-4 py-2.5 text-meta text-body md:grid">
                <span>Store server</span>
                <span>Sync, last 90 days</span>
                <span className="text-right">Now</span>
              </div>
              <ul className="divide-y divide-hairline">
                {page.stores.map((row) => (
                  <SyncRow key={row.key} row={row} />
                ))}
              </ul>
            </Card>
          </>
        ),
      })}
    </div>
  )
}

const SYNC_FILL: Readonly<Record<FleetDayBar["colour"], string>> = {
  green: "bg-ok",
  yellow: "bg-warn",
  red: "bg-bad",
  grey: "bg-hairline-strong",
  none: "bg-hairline-2",
}

/// How long a stretch lasted, in the words the tooltip needs.
function lasted(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  return `${Math.round((seconds / 3600) * 10) / 10} h`
}

/// Ninety days of the store's `sync` part, stretched like the Servers
/// board. Said as time behind and time offline, never a percentage.
function SyncBars({ days }: { days: readonly FleetDayBar[] | undefined }) {
  const bars: readonly (FleetDayBar | null)[] =
    days ?? Array.from({ length: 90 }, () => null)
  return (
    <span
      className="flex h-6 items-stretch gap-[2px]"
      role="img"
      aria-label="Sync per day, last 90 days"
    >
      {bars.map((bar, index) => (
        <span
          key={bar?.day ?? index}
          title={
            bar === null
              ? undefined
              : bar.state === "NONE"
                ? `${bar.day} · no history`
                : [
                    bar.day,
                    bar.warn_seconds > 0
                      ? `behind ${lasted(bar.warn_seconds)}`
                      : null,
                    bar.bad_seconds > 0
                      ? `offline ${lasted(bar.bad_seconds)}`
                      : null,
                    bar.warn_seconds === 0 && bar.bad_seconds === 0
                      ? "in sync"
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
          }
          className={cn(
            "min-w-[2px] flex-1 rounded-[1px]",
            SYNC_FILL[bar?.colour ?? "none"]
          )}
        />
      ))}
    </span>
  )
}

function SyncRow({ row }: { row: FleetSyncRow }) {
  const detail = useFleetStatusOf(row.key, true)
  const days = detail.data?.row.components.find(
    (one) => one.kind === "SYNC"
  )?.days
  return (
    <li className="px-4 py-3.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_8rem]">
        <span className="flex min-w-0 items-center gap-2.5">
          <FleetDot colour={row.colour} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">
              {row.name}
            </span>
            <span className="block truncate text-meta text-mute">
              {row.unit_code && (
                <span className="font-mono">{row.unit_code} · </span>
              )}
              {fleetKindWord(row.kind)}
            </span>
          </span>
        </span>
        <span className="col-span-2 md:order-none md:col-span-1">
          <SyncBars days={days} />
        </span>
        <span className="md:text-right">
          <Pill tone={FLEET_PILL_TONE[row.colour]}>
            {STATE_WORD[row.state]}
          </Pill>
        </span>
      </div>
    </li>
  )
}
