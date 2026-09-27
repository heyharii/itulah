import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { Banner } from "@/components/ui/states"
import { ago, count } from "@/lib/format"
import { useFleetSync, type FleetSyncRow } from "@/lib/queries/fleet"
import { queryState } from "@/lib/query-state"
import { FLEET_PILL_TONE, FleetDot, fleetKindWord } from "@/screens/system/fleet-shared"

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

function SyncRow({ row }: { row: FleetSyncRow }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3.5">
      <div className="flex items-center gap-3">
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
        </span>
        <Pill tone={FLEET_PILL_TONE[row.colour]}>{STATE_WORD[row.state]}</Pill>
      </div>

      <p className="pl-[1.375rem] text-[0.875rem] text-body">{row.sentence}</p>

      {row.sales_complete_up_to_local && (
        <p className="pl-[1.375rem] text-meta text-mute">
          Today&rsquo;s sales complete up to {row.sales_complete_up_to_local}
          {row.sales_complete_today ? "" : " (not yet today)"}.
        </p>
      )}

      {row.down.pending > 0 && (
        <ul className="flex flex-col gap-1 pl-[1.375rem]">
          {row.down.commands.map((command) => (
            <li key={`${command.command_type}-${command.oldest_sent_at}`} className="text-meta text-mute">
              ↓ {count(command.count)} pending: {command.label}, sent{" "}
              {ago(command.oldest_sent_at)}
              {command.expired > 0 && ` · ${command.expired} expired`}
            </li>
          ))}
        </ul>
      )}

      {row.last_outage && (
        <p className="pl-[1.375rem] text-meta text-mute">
          Last outage: {row.last_outage.sentence}
        </p>
      )}

      {row.down.blocked !== null && row.down.blocked !== undefined && (
        <Banner tone="bad" className="ml-[1.375rem]">
          Stuck on a command it will not apply — a developer needs to look.
        </Banner>
      )}
    </li>
  )
}
