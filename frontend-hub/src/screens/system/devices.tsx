import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Textarea } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { ago, day, moment } from "@/lib/format"
import {
  deviceHistory,
  listDevices,
  setDeviceStatus,
  systemKeys,
  type DeviceKind,
  type DeviceStatus,
  type RegistryDevice,
} from "@/lib/queries/system"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Section } from "@/screens/system/shared"
import { saying } from "@/screens/system/units"

/// Every machine enrolled to a node, per site.
///
/// Read from the nodes' own heartbeats (`backend/src/cloud/postgres/devices.rs`),
/// so the list is only ever as fresh as the last minute a node was heard. A
/// till's or a printer's status is the node's word — that is where a till's
/// signature is checked — and head office's suspend or revoke is shown as
/// "asked" until the node's next heartbeat reports it done.
///
/// Punch stations and EDCs are registered here at head office, against a site,
/// and listed from those registrations with the node that serves their site.
/// They are switched where they are registered, not on this screen.
///
/// Peripherals (the customer display, a USB desk reader, the drawer) are not
/// rows here. They belong to one till and are shown on its sheet.

const KIND_LABEL: Record<DeviceKind, string> = {
  TILL: "Till",
  HANDHELD: "Handheld",
  RFID_READER: "RFID reader",
  PRINTER: "Printer",
  EDC: "EDC",
  ATTENDANCE_TERMINAL: "Attendance terminal",
}

const STATUS_TONE: Record<DeviceStatus, "ok" | "warn" | "bad"> = {
  ACTIVE: "ok",
  SUSPENDED: "warn",
  REVOKED: "bad",
}

const STATUS_WORD: Record<DeviceStatus, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  REVOKED: "Revoked",
}

/// The node a row is listed under, in words.
function nodeName(device: RegistryDevice): string {
  return device.node_label ?? device.origin_id ?? "No node at this site"
}

function StatusPill({ device }: { device: RegistryDevice }) {
  return (
    <span className="flex flex-col gap-1">
      <Pill tone={STATUS_TONE[device.status]}>
        {STATUS_WORD[device.status]}
      </Pill>
      {device.requested_status && (
        <span className="text-meta text-mute">
          {`${STATUS_WORD[device.requested_status]} asked · waiting for the node`}
        </span>
      )}
    </span>
  )
}

const columns: ColumnDef<TableSetup, RegistryDevice>[] = [
  {
    id: "site",
    accessorFn: (row) => row.site_name ?? row.site_id,
    header: "Site",
    size: 150,
    meta: { filter: { kind: "option", label: "Site" } },
    cell: ({ row }) => (
      <span className="text-ink">
        {row.original.site_name ?? row.original.site_id}
      </span>
    ),
  },
  {
    id: "kind",
    accessorFn: (row) => KIND_LABEL[row.kind] ?? row.kind,
    header: "Kind",
    size: 150,
    meta: { filter: { kind: "option", label: "Kind" } },
    cell: ({ row }) => (
      <Tag>{KIND_LABEL[row.original.kind] ?? row.original.kind}</Tag>
    ),
  },
  {
    accessorKey: "label",
    header: "Label",
    size: 200,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.label}</span>
    ),
  },
  {
    id: "status",
    accessorFn: (row) => STATUS_WORD[row.status],
    header: "Status",
    size: 190,
    meta: { filter: { kind: "option", label: "Status" } },
    cell: ({ row }) => <StatusPill device={row.original} />,
  },
  {
    id: "last_seen",
    accessorFn: (row) => row.last_seen_at ?? "",
    header: "Last seen",
    size: 130,
    cell: ({ row }) =>
      row.original.last_seen_at ? (
        ago(row.original.last_seen_at)
      ) : (
        <span className="text-mute">
          {row.original.source === "EDC_TERMINAL" ? "—" : "Never"}
        </span>
      ),
  },
  {
    id: "node",
    accessorFn: (row) => nodeName(row),
    header: "Node",
    size: 170,
    cell: ({ row }) => (
      <span className="font-mono text-meta">{nodeName(row.original)}</span>
    ),
  },
]

export function Devices() {
  const [query, setQuery] = useState("")
  const device = useSheet("device")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "site", desc: false },
  ])

  // A node reports once a minute; reading twice as often keeps a switched-off
  // till from looking switched on for long.
  const devices = useQuery({
    queryKey: systemKeys.devices(),
    queryFn: ({ signal }) => listDevices(signal),
    refetchInterval: 30_000,
  })
  const rows = useMemo(() => devices.data ?? [], [devices.data])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: RegistryDevice) => row.device_id,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Devices"
        sub="Every till, printer and reader enrolled to a node, as the node last reported it, and the punch stations and EDCs registered at each site."
        actions={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-8 w-48"
          />
        }
      />

      <Toolbar>
        <FilterPanel model={filters} table={table} />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(devices, {
          loading: "Loading the devices…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No node has reported a device yet, and no punch station or EDC
                is registered. A till appears here once it has joined its shop's
                node and the node has sent its next heartbeat.
              </EmptyState>
            ) : (
              <DataTable<RegistryDevice>
                table={table}
                onRowClick={(row) => device.open(row.device_id)}
                isSelected={(row) => row.device_id === device.value}
                empty="No device matches that search."
                className="max-h-[calc(100vh-14rem)]"
              />
            ),
        })}
      </Card>

      <DeviceSheet
        device={rows.find((row) => row.device_id === device.value) ?? null}
        open={device.value !== undefined}
        onClose={device.close}
      />
    </PageContent>
  )
}

/// What the node said is configured, in words. Never a secret: the node sends
/// none, and the registry keeps none.
function ConfigFacts({ device }: { device: RegistryDevice }) {
  const config = device.config
  if (device.kind === "PRINTER") {
    const address = `${String(config.host ?? "—")}:${String(config.port ?? "—")}`
    const purpose = String(config.purpose ?? "LABEL")
    return (
      <>
        <Fact term="Address">{address}</Fact>
        <Fact term="Language">{String(config.language ?? "Node default")}</Fact>
        <Fact term="For">{purpose === "RECEIPT" ? "Receipts" : "Labels"}</Fact>
      </>
    )
  }
  if (device.kind === "TILL") {
    const peripherals =
      config.peripherals && typeof config.peripherals === "object"
        ? Object.keys(config.peripherals as Record<string, unknown>)
        : []
    const machine =
      config.machine && typeof config.machine === "object"
        ? (config.machine as Record<string, unknown>)
        : null
    return (
      <>
        <Fact term="Peripherals">
          {peripherals.length > 0
            ? peripherals.map((name) => name.replace(/_/g, " ")).join(", ")
            : "None reported"}
        </Fact>
        {machine && (
          <Fact term="Machine">
            {[machine.hostname, machine.os, machine.version]
              .filter((part) => typeof part === "string" && part !== "")
              .join(" · ") || "—"}
          </Fact>
        )}
      </>
    )
  }
  if (device.kind === "RFID_READER" || device.kind === "HANDHELD") {
    const pools = Array.isArray(config.pools) ? (config.pools as string[]) : []
    return <Fact term="Pools">{pools.length > 0 ? pools.join(", ") : "—"}</Fact>
  }
  if (device.kind === "EDC") {
    return (
      <>
        <Fact term="Bank">{String(config.bank_code ?? "—")}</Fact>
        <Fact term="Terminal ID">{String(config.terminal_id ?? "—")}</Fact>
      </>
    )
  }
  if (device.kind === "ATTENDANCE_TERMINAL") {
    const synced =
      typeof config.synced_at === "string" ? config.synced_at : null
    const punched =
      typeof config.punched_at === "string" ? config.punched_at : null
    return (
      <>
        <Fact term="Templates taken">{synced ? moment(synced) : "Never"}</Fact>
        <Fact term="Last punch">{punched ? moment(punched) : "Never"}</Fact>
      </>
    )
  }
  return null
}

/// Where a device head office cannot switch from here is switched instead.
function switchedWhere(device: RegistryDevice): string {
  switch (device.kind) {
    case "TILL":
    case "PRINTER":
      return "This node runs a version that cannot take a device decision from head office yet. Switch it at the shop, or update the node."
    case "ATTENDANCE_TERMINAL":
      return "Suspended and revoked in People → Settings → Punch stations, where its authority is kept."
    case "EDC":
      return "Switched on and off in Finance → Sales & banks, where its bank is kept."
    default:
      return "Switched on and off in System → Access, where its key is kept."
  }
}

function DeviceSheet({
  device,
  open,
  onClose,
}: {
  device: RegistryDevice | null
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")

  const history = useQuery({
    queryKey: systemKeys.deviceHistory(device?.device_id ?? ""),
    queryFn: ({ signal }) => deviceHistory(device?.device_id ?? "", signal),
    enabled: device !== null,
  })

  const change = useMutation({
    mutationFn: (status: DeviceStatus) =>
      setDeviceStatus(device?.device_id ?? "", {
        status,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      setReason("")
      void client.invalidateQueries({ queryKey: systemKeys.devices() })
      if (device) {
        void client.invalidateQueries({
          queryKey: systemKeys.deviceHistory(device.device_id),
        })
      }
    },
  })

  const needsReason = reason.trim() === ""

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          change.reset()
          setReason("")
          onClose()
        }
      }}
      id={device?.device_id}
      title={device?.label ?? "Device"}
    >
      {device === null ? (
        <p className="text-meta text-body">
          That device is not in the register any more.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <StatusPill device={device} />
          </div>

          <Facts>
            <Fact term="Kind">{KIND_LABEL[device.kind] ?? device.kind}</Fact>
            <Fact term="Site">{device.site_name ?? device.site_id}</Fact>
            <Fact term="Node">{nodeName(device)}</Fact>
            <Fact term="Last seen">
              {device.last_seen_at ? moment(device.last_seen_at) : "Never"}
            </Fact>
            <Fact term="Enrolled">
              {device.registered_at
                ? `${day(device.registered_at)}${device.registered_by ? ` by ${device.registered_by}` : ""}`
                : "—"}
            </Fact>
            {device.replaces_device_id && (
              <Fact term="Replaces">{device.replaces_device_id}</Fact>
            )}
            <ConfigFacts device={device} />
          </Facts>

          {device.requested_status && (
            <Banner tone="info">
              {`${device.requested_by ?? "Head office"} asked for ${STATUS_WORD[device.requested_status].toLowerCase()} ${device.requested_at ? ago(device.requested_at) : ""}${device.requested_reason ? ` — ${device.requested_reason}` : ""}. The node carries it out on its next sync and says so in its next heartbeat.`}
            </Banner>
          )}

          {device.switchable ? (
            <Section title="Switch it">
              <p className="mb-2.5 text-[0.875rem] text-body">
                A suspended till cannot sign anybody in or authorise anything
                until it is reactivated. A revoked one never can again — a
                replacement joins as a new till and takes its name.
              </p>
              <Field label="Why">
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Stolen from the counter on Saturday night"
                />
              </Field>
              {change.isError && (
                <Banner tone="bad" className="mt-2.5">
                  {saying(change.error)}
                </Banner>
              )}
              <div className="mt-2.5 flex flex-wrap gap-2">
                {device.status === "ACTIVE" && (
                  <Button
                    disabled={change.isPending || needsReason}
                    onClick={() => change.mutate("SUSPENDED")}
                  >
                    Suspend
                  </Button>
                )}
                {device.status === "SUSPENDED" && (
                  <Button
                    disabled={change.isPending}
                    onClick={() => change.mutate("ACTIVE")}
                  >
                    Reactivate
                  </Button>
                )}
                <Button
                  disabled={change.isPending || needsReason}
                  onClick={() => change.mutate("REVOKED")}
                >
                  Revoke for good
                </Button>
              </div>
            </Section>
          ) : (
            device.status !== "REVOKED" && (
              <p className="text-meta text-mute">{switchedWhere(device)}</p>
            )
          )}

          <Section title="History">
            {queryState(history, {
              loading: "Loading…",
              render: (items) =>
                items.length === 0 ? (
                  <p className="text-[0.875rem] text-body">
                    Nothing recorded yet.
                  </p>
                ) : (
                  <MiniTable head={["When", "What happened"]}>
                    {items.map((event, index) => (
                      <tr key={index} className="border-t border-hairline">
                        <td className="py-2 pr-3 align-top font-mono text-meta whitespace-nowrap text-mute">
                          {moment(event.at)}
                        </td>
                        <td className="py-2">
                          <div className="font-medium text-ink">
                            {event.source === "HUB"
                              ? `${event.actor} asked for ${STATUS_WORD[event.to_status].toLowerCase()}`
                              : event.from_status
                                ? `${STATUS_WORD[event.from_status]} → ${STATUS_WORD[event.to_status]}`
                                : `Enrolled, ${STATUS_WORD[event.to_status].toLowerCase()}`}
                          </div>
                          <div className="mt-1 text-meta text-body">
                            {[
                              event.source === "NODE" ? event.actor : null,
                              event.reason,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </MiniTable>
                ),
            })}
          </Section>
        </div>
      )}
    </Sheet>
  )
}
