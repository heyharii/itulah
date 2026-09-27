import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState, Problem } from "@/components/ui/states"
import { ago } from "@/lib/format"
import {
  listDevices,
  systemKeys,
  type DeviceKind,
  type RegistryDevice,
} from "@/lib/queries/system"
import { testPrint, type StoreTillsStatus } from "@/lib/queries/stores"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"

const KIND_LABEL: Record<DeviceKind, string> = {
  TILL: "Till",
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
/// approval) — head office only watches the count here.
export function DevicesTab({
  siteId,
  tills,
}: {
  siteId: string
  tills: StoreTillsStatus
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

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-4 px-4 py-3 text-[0.875rem] text-body">
        <span>
          <b className="text-ink">{tills.online}</b>/{tills.active} tills
          online
        </span>
        {tills.waiting > 0 && (
          <span className="text-warn-fg">
            {tills.waiting} {tills.waiting === 1 ? "till" : "tills"} waiting
            for a supervisor at the store
          </span>
        )}
      </Card>

      <Card className="overflow-hidden">
        {queryState(devices, {
          loading: "Reading the devices…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No till, printer or reader has reported at this site&rsquo;s
                node yet.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-hairline">
                {rows.map((device) => (
                  <DeviceRow key={device.device_id} device={device} />
                ))}
              </ul>
            ),
        })}
      </Card>
    </div>
  )
}

function DeviceRow({ device }: { device: RegistryDevice }) {
  const client = useQueryClient()
  const print = useMutation({
    mutationFn: () => testPrint(device.device_id),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: systemKeys.devices() }),
  })
  const printable = device.kind === "TILL" || device.kind === "PRINTER"

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          device.last_seen_at && recentlySeen(device.last_seen_at)
            ? "bg-ok"
            : "bg-hairline-strong"
        )}
      />
      <span className="min-w-0 flex-1">
        <b className="block truncate text-ink">{device.label}</b>
        <span className="block truncate text-meta text-mute">
          {KIND_LABEL[device.kind] ?? device.kind}
          {device.last_seen_at
            ? ` · seen ${ago(device.last_seen_at)}`
            : " · never seen"}
        </span>
      </span>
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
          {device.last_test_print_at && !print.isPending && (
            <span
              className={cn(
                "text-meta",
                device.last_test_print_ok ? "text-ok-fg" : "text-bad-fg"
              )}
            >
              {device.last_test_print_ok ? "printed" : "failed"}{" "}
              {ago(device.last_test_print_at)}
            </span>
          )}
        </div>
      )}
      {printable && print.isError && (
        <Problem error={print.error} className="shrink-0" />
      )}
    </li>
  )
}
