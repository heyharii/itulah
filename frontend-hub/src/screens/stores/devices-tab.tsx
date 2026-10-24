import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { ago } from "@/lib/format"
import { useFleetStatusOf, type FleetComponent } from "@/lib/queries/fleet"
import {
  listDevices,
  systemKeys,
  type DeviceKind,
  type RegistryDevice,
} from "@/lib/queries/system"
import {
  setTillSeats,
  storesKeys,
  testPrint,
  type StoreTills,
} from "@/lib/queries/stores"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { DeviceActionsMenu } from "@/screens/stores/actions"
import { FLEET_PILL_TONE, FleetDot } from "@/screens/system/fleet-shared"
import { saying } from "@/screens/system/units"

const KIND_LABEL: Record<DeviceKind, string> = {
  TILL: "POS",
  HANDHELD: "Handheld",
  RFID_READER: "RFID reader",
  PRINTER: "Printer",
  EDC: "EDC",
  ATTENDANCE_TERMINAL: "Attendance terminal",
}

/// A device reported within the last couple of minutes — good enough to draw
/// as "seen" without pretending to be the node's own online/offline verdict,
/// which lives on System › Devices, not here.
function recentlySeen(iso: string): boolean {
  return Date.now() - Date.parse(iso) < 120_000
}

/// The device register, filtered to this store's site, with a test print per
/// till or printer and how many tills are still waiting for a supervisor at
/// the store to approve them — the mock's Devices tab.
///
/// Approving a waiting till happens at the store, in its own Tills screen
/// (CONTEXT.md: a till joins by discovering the node and a supervisor's
/// approval) — head office only watches the count here. What head office does
/// decide is how many seats the counter has (`SeatsCard`).
export function DevicesTab({
  unit,
  siteId,
  tills,
  canManage,
}: {
  unit: string
  siteId: string
  tills: StoreTills
  canManage: boolean
}) {
  const devices = useQuery({
    queryKey: systemKeys.devices(),
    queryFn: ({ signal }) => listDevices(signal),
    refetchInterval: 30_000,
  })
  const rows = useMemo(
    () => (devices.data ?? []).filter((device) => device.site_id === siteId),
    [devices.data, siteId]
  )

  // The fleet page's own read of these same devices (`FleetComponent`, one
  // per `device:<id>`) — its `state`/`sentence` are the alerting system's
  // judgement (battery, silence past a threshold, a fault a heartbeat
  // reported), which this register alone cannot say; `recentlySeen` above
  // stays as the fallback for a device the sweep has not judged yet.
  const fleet = useFleetStatusOf(siteId, true)
  const componentByDevice = useMemo(() => {
    const map = new Map<string, FleetComponent>()
    for (const component of fleet.data?.row.components ?? []) {
      if (component.component.startsWith("device:"))
        map.set(component.component.slice("device:".length), component)
    }
    return map
  }, [fleet.data])

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-4 px-4 py-3 text-[0.9375rem] text-body">
        <span>
          <b className="text-ink">{tills.online}</b>/{tills.active} POS online
        </span>
        {tills.waiting > 0 && (
          <span className="text-warn-fg">
            {tills.waiting} POS waiting for
            a supervisor at the store
          </span>
        )}
      </Card>

      <SeatsCard unit={unit} seats={tills.seats} canManage={canManage} />

      <Card className="overflow-hidden">
        {queryState(devices, {
          loading: "Reading the devices…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No POS, printer or reader has reported at this site&rsquo;s
                node yet.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-hairline">
                {rows.map((device) => (
                  <DeviceRow
                    key={device.device_id}
                    unit={unit}
                    device={device}
                    component={componentByDevice.get(device.device_id)}
                  />
                ))}
              </ul>
            ),
        })}
      </Card>
    </div>
  )
}

/// How many till seats the store has — Till 1 to Till N. Head office decides
/// it; an Admin edits it here, anyone else reads it. Fewer seats never ends a
/// shift (the server keeps a drawer open at a removed seat listed until it is
/// closed), so there is nothing to confirm.
function SeatsCard({
  unit,
  seats,
  canManage,
}: {
  unit: string
  seats: number
  canManage: boolean
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState(String(seats))
  const count = Number(draft)
  const valid = Number.isInteger(count) && count >= 1 && count <= 50

  const save = useMutation({
    mutationFn: () => setTillSeats(unit, count),
    onSuccess: (detail) => {
      client.setQueryData(storesKeys.detail(unit), detail)
      void client.invalidateQueries({ queryKey: storesKeys.list() })
      setDraft(String(detail.store.tills.seats))
    },
  })

  return (
    <Card className="flex flex-col gap-3 px-4 py-3 text-[0.9375rem] text-body">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1">
          POS seats: <b className="text-ink">{seats}</b> — POS 1
          {seats > 1 ? ` to POS ${seats}` : ""}
        </span>
        {canManage && (
          <>
            <Input
              type="number"
              min={1}
              max={50}
              inputMode="numeric"
              aria-label="Number of POS seats"
              className="w-20"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              variant="primary"
              pending={save.isPending}
              disabled={!valid || count === seats}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Submitting…" : "Submit"}
            </Button>
          </>
        )}
      </div>
      <p className="text-meta text-mute">
        Each seat is one drawer. People pick a seat at the POS; machines
        don&rsquo;t add seats.
      </p>
      {save.isError && <Banner tone="bad">{saying(save.error)}</Banner>}
    </Card>
  )
}

function DeviceRow({
  unit,
  device,
  component,
}: {
  unit: string
  device: RegistryDevice
  /// This device's row on the fleet page, once it has loaded — absent while
  /// that fetch is still running, or for a device the sweep has not judged
  /// yet (`device:<id>` is written the first time a heartbeat mentions it).
  component: FleetComponent | undefined
}) {
  const client = useQueryClient()
  const print = useMutation({
    mutationFn: () => testPrint(device.device_id),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: systemKeys.devices() }),
  })
  const printable = device.can_test_print

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {component ? (
        <FleetDot colour={component.colour} />
      ) : (
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            device.last_seen_at && recentlySeen(device.last_seen_at)
              ? "bg-ok"
              : "bg-hairline-strong"
          )}
        />
      )}
      <span className="min-w-0 flex-1">
        <b className="block truncate text-ink">{device.label}</b>
        <span className="block truncate text-meta text-mute">
          {component
            ? component.sentence
            : `${KIND_LABEL[device.kind] ?? device.kind}${
                device.last_seen_at
                  ? ` · seen ${ago(device.last_seen_at)}`
                  : " · never seen"
              }`}
        </span>
      </span>
      {component && (
        <Pill tone={FLEET_PILL_TONE[component.colour]} className="shrink-0">
          {KIND_LABEL[device.kind] ?? device.kind}
        </Pill>
      )}
      {printable && (
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button
            size="sm"
            variant="quiet"
            pending={print.isPending}
            onClick={() => print.mutate()}
          >
            {print.isPending ? "Asking…" : "Test print"}
          </Button>
          {device.test_print_requested_at &&
            !device.last_test_print_at &&
            !print.isPending && (
              <span className="text-meta text-mute">asked, waiting…</span>
            )}
          {device.last_test_print_at && !print.isPending && (
            <span
              className={cn(
                "text-right text-meta",
                device.last_test_print_ok ? "text-ok-fg" : "text-bad-fg"
              )}
            >
              {device.last_test_print_ok
                ? "printed"
                : (device.last_test_print_error ?? "failed")}{" "}
              {ago(device.last_test_print_at)}
            </span>
          )}
        </div>
      )}
      {printable && print.isError && (
        <Problem error={print.error} className="shrink-0" />
      )}
      <DeviceActionsMenu unit={unit} deviceId={device.device_id} />
    </li>
  )
}
