import { ActivityFold } from "@/components/ui/activity-fold"
import { useForm } from "@tanstack/react-form"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import {
  CircleCheck,
  CirclePause,
  CreditCard,
  Fingerprint,
  Printer,
  Radio,
  Smartphone,
  Store,
} from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { SHEET_ROW } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { ButtonGroup } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import {
  useFilterState,
  useFilters,
  type Filter,
  type FilterField,
} from "@/lib/filters"
import { ago, day, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  deviceHistory,
  listDevices,
  listOrigins,
  registerRfidDevice,
  rfidDevicesPage,
  rotateRfidDeviceKey,
  setDeviceStatus,
  setRfidDeviceActive,
  setRfidDeviceKind,
  systemKeys,
  type AccessScope,
  type DeviceKind,
  type DeviceStatus,
  type RegistryDevice,
  type RfidDevice,
  type RfidKind,
  type SyncOrigin,
} from "@/lib/queries/system"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { DESK_BAR } from "@/components/ui/phone-cards"
import { Section } from "@/screens/system/shared"
import { saying, span } from "@/screens/system/units"

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

const STATUS_TONE: Record<DeviceStatus, "ok" | "bad" | "neutral"> = {
  ACTIVE: "ok",
  SUSPENDED: "bad",
  REVOKED: "neutral",
}

const STATUS_WORD: Record<DeviceStatus, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Stopped",
  REVOKED: "Removed",
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
    // Names, found in the search box: the chip line is for the kind.
    meta: {
      filter: { kind: "option", label: "Site", searchable: true },
      card: "hide",
    },
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
    meta: {
      filter: {
        kind: "option",
        label: "Kind",
        icon: (value) =>
          value === "Till"
            ? Store
            : value === "Handheld"
              ? Smartphone
              : value === "RFID reader"
                ? Radio
                : value === "Printer"
                  ? Printer
                  : value === "EDC"
                    ? CreditCard
                    : value === "Attendance terminal"
                      ? Fingerprint
                      : undefined,
      },
      card: "hide",
    },
    cell: ({ row }) => (
      <Tag>{KIND_LABEL[row.original.kind] ?? row.original.kind}</Tag>
    ),
  },
  {
    accessorKey: "label",
    header: "Label",
    size: 200,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.label}</span>
    ),
  },
  {
    id: "status",
    accessorFn: (row) => STATUS_WORD[row.status],
    header: "Status",
    size: 190,
    meta: { filter: { kind: "option", label: "Status" }, card: "hide" },
    cell: ({ row }) => <StatusPill device={row.original} />,
  },
  {
    id: "last_seen",
    accessorFn: (row) => row.last_seen_at ?? "",
    header: "Last Seen",
    size: 130,
    meta: { card: "hide" },
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
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="font-mono text-meta">{nodeName(row.original)}</span>
    ),
  },

  // Columns that exist only on a phone's card: the machine, what and where it
  // is, when it was last heard, and how it stands.
  {
    id: "head",
    accessorFn: (row) => row.label,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="min-w-0 break-words">{row.original.label}</span>
    ),
  },
  {
    id: "what",
    accessorFn: (row) => row.kind,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) =>
      `${KIND_LABEL[row.original.kind] ?? row.original.kind} · ${
        row.original.site_name ?? row.original.site_id
      }`,
  },
  {
    id: "foot",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) =>
      row.original.last_seen_at
        ? `Seen ${ago(row.original.last_seen_at)}`
        : row.original.source === "EDC_TERMINAL"
          ? nodeName(row.original)
          : "Never seen",
  },
  {
    id: "phone_status",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "status" },
    cell: ({ row }) => <StatusPill device={row.original} />,
  },
]

type Tab = "devices" | "readers"

const TABS: readonly { value: Tab; label: string }[] = [
  { value: "devices", label: "Devices" },
  { value: "readers", label: "Readers" },
]

export function Devices() {
  const [tab, setTab] = useState<Tab>("devices")
  const [registering, setRegistering] = useState(false)
  const phone = useLayout() === "phone"

  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Devices"
        sub="Every till, printer, EDC and reader enrolled to a store server, and the punch stations registered at each site."
        actions={
          // On a phone the one thing this page makes is the round button over
          // the bottom bar.
          tab === "readers" && !phone ? (
            <Button variant="primary" onClick={() => setRegistering(true)}>
              Register reader
            </Button>
          ) : undefined
        }
      />

      {tab === "readers" && (
        <Fab label="Register reader" onClick={() => setRegistering(true)} />
      )}

      <SubTabs
        tabs={TABS}
        value={tab}
        onChange={(next) => setTab(next as Tab)}
      />

      {tab === "devices" ? (
        <DevicesTab />
      ) : (
        <ReadersTab
          registering={registering}
          onRegisteringChange={setRegistering}
        />
      )}
    </PageContent>
  )
}

function DevicesTab() {
  const [query, setQuery] = useState("")
  const device = useSheet("device")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "site", desc: false },
  ])

  // A store server reports once a minute; reading twice as often keeps a
  // switched-off till from looking switched on for long.
  const devices = useQuery({
    queryKey: systemKeys.devices(),
    queryFn: ({ signal }) => listDevices(signal),
    refetchInterval: 30_000,
  })
  const rows = useMemo(() => devices.data ?? [], [devices.data])

  const filters = useFilters(columns)
  const phone = useLayout() === "phone"

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
          // The card's own columns are drawn on a phone and never on a desk.
          columnVisibility: {
            head: phone,
            what: phone,
            foot: phone,
            phone_status: phone,
          },
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting, phone]
    )
  )

  return (
    <>
      <div className={DESK_BAR}>
        <FilterPanel
          model={filters}
          table={table}
          search={{ value: query, onChange: setQuery, label: "Search devices" }}
        />
      </div>

      <DockTools
        search={{ value: query, onChange: setQuery, label: "Search devices" }}
        filter={{
          count: filters.filters.length,
          panel: { model: filters, table },
        }}
        sort={dockSortOf(table)}
      />

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(devices, {
          loading: "Loading the devices…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No store server has reported a device yet, and no punch station
                or EDC is registered. A till appears here once it has joined its
                shop's server and the server has sent its next heartbeat.
              </EmptyState>
            ) : (
              <DataTable<RegistryDevice>
                refresh={[devices]}
                table={table}
                onRowClick={(row) => device.open(row.device_id)}
                isSelected={(row) => row.device_id === device.value}
                empty="No device matches that search."
                className="max-h-[calc(100dvh-14rem)]"
                cardSort={false}
                cardsApart
                cardLead
              />
            ),
        })}
      </Card>

      <DeviceSheet
        device={rows.find((row) => row.device_id === device.value) ?? null}
        open={device.value !== undefined}
        onClose={device.close}
      />
    </>
  )
}

// ── readers ──────────────────────────────────────────────────────────────
//
// Moved here from System › Access on 2026-09-27: an RFID reader is a device
// like a till or a printer, so it is registered, suspended and rotated among
// the rest of them rather than on a screen of its own. This is a different
// register from the one above — that one reads what a server SELF-REPORTS
// seeing; this one is the centre's own key registry, the thing a server
// checks a reader's key against — which is why the two do not share a table.

const RFID_KIND_LABEL: Record<RfidKind, string> = {
  RFID_READER: "Fixed reader",
  HANDHELD: "Handheld",
}

const READER_SORTS: Record<string, string> = {
  origin_id: "origin",
  device_id: "device",
  label: "label",
  last_seen: "last_seen",
  offline_ttl_seconds: "lease",
}

const READER_NODE: FilterField = {
  column: "origin_id",
  label: "Store server",
  spec: {
    kind: "option",
    single: true,
    operators: ["isAnyOf"],
    searchable: true,
  },
}
const READER_STATE: FilterField = {
  column: "state",
  label: "State",
  spec: {
    kind: "option",
    single: true,
    operators: ["isAnyOf"],
    options: [
      { value: "ACTIVE", label: "Active" },
      { value: "OFF", label: "Off" },
    ],
    icon: (value) =>
      value === "ACTIVE"
        ? CircleCheck
        : value === "OFF"
          ? CirclePause
          : undefined,
  },
}
const READER_FIELDS: FilterField[] = [READER_NODE, READER_STATE]

function readerScopeFromFilters(filters: readonly Filter[]): AccessScope {
  const scope: { origin_id?: string; active?: boolean } = {}
  for (const { column, operator, values } of filters) {
    if (values.length === 0 || operator !== "isAnyOf") continue
    if (column === "origin_id") scope.origin_id = values[0]
    else if (column === "state") scope.active = values[0] === "ACTIVE"
  }
  return scope
}

function readerColumns(on: {
  setActive: (row: RfidDevice, active: boolean) => void
  setKind: (row: RfidDevice, kind: RfidKind) => void
  rotate: (row: RfidDevice) => void
  busy: boolean
}): ColumnDef<TableSetup, RfidDevice>[] {
  const desk: ColumnDef<TableSetup, RfidDevice>[] = [
    {
      accessorKey: "device_id",
      header: "Reader",
      size: 170,
      cell: ({ row }) => (
        <span className="font-mono text-id text-body">
          {row.original.device_id}
        </span>
      ),
    },
    {
      accessorKey: "label",
      header: "Label",
      size: 180,
      cell: ({ row }) => (
        <span className="font-medium text-ink">{row.original.label}</span>
      ),
    },
    {
      id: "kind",
      accessorFn: (row) => RFID_KIND_LABEL[row.kind] ?? row.kind,
      header: "Kind",
      size: 120,
      enableSorting: false,
      cell: ({ row }) => (
        <Tag>{RFID_KIND_LABEL[row.original.kind] ?? row.original.kind}</Tag>
      ),
    },
    {
      accessorKey: "origin_id",
      header: "Store Server",
      size: 140,
    },
    {
      id: "pools",
      accessorFn: (row) => row.pools.join(" "),
      header: "Pools",
      size: 200,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex gap-1">
          {row.original.pools.length === 0 ? (
            <span className="text-mute">—</span>
          ) : (
            row.original.pools.map((pool) => <Tag key={pool}>{pool}</Tag>)
          )}
        </span>
      ),
    },
    {
      accessorKey: "offline_ttl_seconds",
      header: "Offline Lease",
      size: 120,
      meta: { align: "right" },
      cell: ({ row }) => span(row.original.offline_ttl_seconds),
    },
    {
      id: "last_seen",
      accessorFn: (row) =>
        row.last_seen_at === null ? 0 : Date.parse(row.last_seen_at),
      header: "Last Seen",
      size: 140,
      meta: { align: "right" },
      cell: ({ row }) =>
        row.original.last_seen_at === null ? (
          <span className="font-medium text-warn-fg">Never</span>
        ) : (
          day(row.original.last_seen_at)
        ),
    },
    {
      id: "state",
      accessorFn: (row) => (row.active ? "Active" : "Off"),
      header: "State",
      size: 100,
      enableSorting: false,
      cell: ({ row }) => (
        <Pill tone={row.original.active ? "ok" : "neutral"}>
          {row.original.active ? "Active" : "Off"}
        </Pill>
      ),
    },
    {
      id: "act",
      header: "",
      size: 300,
      enableSorting: false,
      cell: ({ row }) => (
        <ButtonGroup className="[&>button:disabled]:opacity-50">
          <button
            type="button"
            disabled={on.busy}
            onClick={() =>
              on.setKind(
                row.original,
                row.original.kind === "HANDHELD" ? "RFID_READER" : "HANDHELD"
              )
            }
          >
            {row.original.kind === "HANDHELD" ? "Make fixed" : "Make handheld"}
          </button>
          <button
            type="button"
            disabled={on.busy}
            onClick={() => on.rotate(row.original)}
          >
            Rotate key
          </button>
          <button
            type="button"
            disabled={on.busy}
            onClick={() => on.setActive(row.original, !row.original.active)}
          >
            {row.original.active ? "Turn off" : "Turn on"}
          </button>
        </ButtonGroup>
      ),
    },
  ]
  // On a phone each reader is a card, and the three things that can be done to
  // it are the sheet its tap opens.
  return [
    ...desk.map((column) => ({
      ...column,
      meta: { ...column.meta, card: "hide" as const },
    })),
    {
      id: "head",
      accessorFn: (row) => row.label,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "title" },
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="min-w-0 break-words">{row.original.label}</span>
          <span className="truncate font-mono text-[0.9375rem] font-normal text-mute">
            {row.original.device_id}
          </span>
        </span>
      ),
    },
    {
      id: "what",
      accessorFn: (row) => row.kind,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "meta" },
      cell: ({ row }) =>
        `${RFID_KIND_LABEL[row.original.kind] ?? row.original.kind} · ${row.original.origin_id}`,
    },
    {
      id: "foot",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) =>
        row.original.last_seen_at === null ? (
          <span className="font-medium text-warn-fg">Never seen</span>
        ) : (
          `Seen ${day(row.original.last_seen_at)}`
        ),
    },
    {
      id: "phone_state",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "status" },
      cell: ({ row }) => (
        <Pill tone={row.original.active ? "ok" : "neutral"}>
          {row.original.active ? "Active" : "Off"}
        </Pill>
      ),
    },
  ]
}

function ReadersTab({
  registering,
  onRegisteringChange,
}: {
  registering: boolean
  onRegisteringChange: (next: boolean) => void
}) {
  const client = useQueryClient()
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "last_seen", desc: false },
  ])
  const [rotating, setRotating] = useState<RfidDevice | null>(null)
  /// The reader whose actions are open, on a phone: its card's tap.
  const [acting, setActing] = useState<RfidDevice | null>(null)
  const phone = useLayout() === "phone"

  // `f2`, not `f`: the Devices tab already claims `f` for its own columns,
  // some named the same — "State" — as these, and a clause typed on one tab
  // must not half-apply itself the moment somebody switches to the other.
  const filters = useFilterState(READER_FIELDS, "f2")
  // The store servers a reader can sit on, offered by name in the search box.
  const servers = useQuery({
    queryKey: systemKeys.origins(),
    queryFn: ({ signal }) => listOrigins(signal),
  })
  const readerFields = useMemo<FilterField[]>(
    () =>
      READER_FIELDS.map((field) =>
        field.column === "origin_id"
          ? {
              ...field,
              spec: {
                ...field.spec,
                options: (servers.data ?? []).map((one: SyncOrigin) => ({
                  value: one.origin_id,
                  label: one.label ?? one.origin_id,
                })),
              },
            }
          : field
      ),
    [servers.data]
  )
  const needle = useDebounced(query.trim(), 400)
  const scope = useMemo<AccessScope>(() => {
    const by = sorting[0]
    return {
      ...readerScopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
      sort: by === undefined ? undefined : READER_SORTS[by.id],
      desc: by?.desc === true,
    }
  }, [filters.filters, needle, sorting])
  const narrowed = needle !== "" || filters.filters.length > 0

  const devices = useQuery({
    queryKey: systemKeys.rfidDevices(scope),
    queryFn: ({ signal }) => rfidDevicesPage({ ...scope }, signal),
    // Another filter or search: the readers in hand stay, dimmed
    // (`list-swap`), until the next are read.
    placeholderData: keepPreviousData,
  })
  const rows = devices.data?.rows ?? []

  const switchReader = useMutation({
    mutationFn: (input: { row: RfidDevice; active: boolean }) =>
      setRfidDeviceActive(input.row.device_id, input.active),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: systemKeys.rfidDevices() })
      void client.invalidateQueries({ queryKey: systemKeys.fleet() })
    },
  })
  const kindReader = useMutation({
    mutationFn: (input: { row: RfidDevice; kind: RfidKind }) =>
      setRfidDeviceKind(input.row.device_id, input.kind),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: systemKeys.rfidDevices() })
      void client.invalidateQueries({ queryKey: systemKeys.devices() })
    },
  })

  const actions = useMemo(
    () => ({
      setActive: (row: RfidDevice, active: boolean) =>
        switchReader.mutate({ row, active }),
      setKind: (row: RfidDevice, kind: RfidKind) =>
        kindReader.mutate({ row, kind }),
      rotate: (row: RfidDevice) => setRotating(row),
      busy: switchReader.isPending || kindReader.isPending,
    }),
    [switchReader, kindReader]
  )

  const columns = useMemo(() => readerColumns(actions), [actions])
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: RfidDevice) => row.device_id,
        state: {
          sorting,
          // The card's own columns are drawn on a phone and never on a desk.
          columnVisibility: {
            head: phone,
            what: phone,
            foot: phone,
            phone_state: phone,
            act: !phone,
          },
        },
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, columns, sorting, phone]
    )
  )

  const failure = switchReader.error ?? kindReader.error

  return (
    <>
      {failure && (
        <Banner tone="bad" className="mb-3">
          {saying(failure)}
        </Banner>
      )}
      <div className={DESK_BAR}>
        <FilterPanel
          model={{ ...filters, fields: readerFields }}
          search={{ value: query, onChange: setQuery, label: "Search readers" }}
        />
      </div>

      <DockTools
        search={{ value: query, onChange: setQuery, label: "Search readers" }}
        filter={{
          count: filters.filters.length,
          panel: { model: { ...filters, fields: readerFields }, table },
        }}
        sort={dockSortOf(table)}
      />

      <Card
        aria-busy={devices.isPlaceholderData || undefined}
        className="list-swap overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
      >
        {queryState(devices, {
          loading: "Loading the readers…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {narrowed
                  ? "No reader matches what you asked for."
                  : "No reader has been registered. A store server will not accept tag reads from a device the centre has not vouched for."}
              </EmptyState>
            ) : (
              <DataTable<RfidDevice>
                refresh={[devices]}
                table={table}
                className="max-h-[calc(100dvh-18rem)]"
                onRowClick={phone ? setActing : undefined}
                cardSort={false}
                cardsApart
                cardLead
              />
            ),
        })}
      </Card>

      <RegisterReaderSheet
        open={registering}
        onClose={() => onRegisteringChange(false)}
      />
      <RotateReaderSheet device={rotating} onClose={() => setRotating(null)} />
      <BottomSheet
        open={acting !== null}
        onOpenChange={(next) => !next && setActing(null)}
        title={acting?.label ?? "Reader"}
      >
        {acting !== null && (
          <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
            {[
              {
                label:
                  acting.kind === "HANDHELD" ? "Make fixed" : "Make handheld",
                run: () =>
                  actions.setKind(
                    acting,
                    acting.kind === "HANDHELD" ? "RFID_READER" : "HANDHELD"
                  ),
              },
              { label: "Rotate key", run: () => actions.rotate(acting) },
              {
                label: acting.active ? "Turn off" : "Turn on",
                run: () => actions.setActive(acting, !acting.active),
              },
            ].map((one) => (
              <button
                key={one.label}
                type="button"
                disabled={actions.busy}
                onClick={() => {
                  one.run()
                  setActing(null)
                }}
                className={cn(SHEET_ROW, "disabled:opacity-50")}
              >
                {one.label}
              </button>
            ))}
          </div>
        )}
      </BottomSheet>
    </>
  )
}

interface ReaderDraft {
  deviceId: string
  originId: string
  label: string
  kind: RfidKind
  pools: string
  lease: string
}

function readerReady(draft: ReaderDraft): boolean {
  return (
    draft.deviceId.trim() !== "" &&
    draft.originId !== "" &&
    draft.label.trim() !== "" &&
    draft.pools.trim() !== ""
  )
}

function RegisterReaderSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()

  const origins = useQuery({
    queryKey: systemKeys.origins(),
    queryFn: ({ signal }) => listOrigins(signal),
    enabled: open,
  })

  const register = useMutation({
    mutationFn: (draft: ReaderDraft) =>
      registerRfidDevice({
        device_id: draft.deviceId.trim(),
        origin_id: draft.originId,
        label: draft.label.trim(),
        pools: draft.pools
          .split(",")
          .map((pool) => pool.trim())
          .filter((pool) => pool !== ""),
        offline_ttl_seconds:
          draft.lease.trim() === "" ? null : Number(draft.lease),
        kind: draft.kind,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: systemKeys.rfidDevices() })
      void client.invalidateQueries({ queryKey: systemKeys.fleet() })
      clear()
      onClose()
    },
  })

  const form = useForm({
    defaultValues: {
      deviceId: "",
      originId: "",
      label: "",
      kind: "RFID_READER",
      pools: "",
      lease: "",
    } as ReaderDraft,
    onSubmit: ({ value }) => register.mutate(value),
  })

  function clear() {
    form.reset()
    register.reset()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          clear()
          onClose()
        }
      }}
      title="Register a reader"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            data-cancel
            variant="quiet"
            onClick={() => {
              clear()
              onClose()
            }}
          >
            Cancel
          </Button>
          <form.Subscribe selector={(state) => readerReady(state.values)}>
            {(ready) => (
              <Button
                pending={register.isPending}
                disabled={!ready}
                onClick={() => form.handleSubmit()}
              >
                {register.isPending ? "Registering…" : "Register"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (readerReady(form.state.values) && !register.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5"
      >
        <Banner tone="info">
          The store server creates this reader's key and hands it back once.
          This console does not keep it and will not display it, so finish
          provisioning at the server itself.
        </Banner>

        <form.Field name="deviceId">
          {(field) => (
            <Field
              label="Device id"
              required
              hint="3–96 characters of A–Z, 0–9, '-', '_' or '.'. Upper-cased by the server."
            >
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                autoComplete="off"
                className="font-mono"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="originId">
          {(field) => (
            <Field label="Store server" required>
              <Select
                value={field.state.value}
                onChange={(next) => field.handleChange(next)}
              >
                <option value="">Choose a store server…</option>
                {(origins.data ?? []).map((origin: SyncOrigin) => (
                  <option key={origin.origin_id} value={origin.origin_id}>
                    {origin.label ?? origin.origin_id}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </form.Field>

        <form.Field name="label">
          {(field) => (
            <Field
              label="Label"
              required
              hint="Where on the floor this reader stands."
            >
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="kind">
          {(field) => (
            <Field
              label="Kind"
              required
              hint="A handheld is carried round the floor; a fixed reader stays over a door or a bench. The server reports it under this kind."
            >
              <Select
                value={field.state.value}
                onChange={(next) => field.handleChange(next as RfidKind)}
              >
                <option value="RFID_READER">Fixed reader</option>
                <option value="HANDHELD">Handheld</option>
              </Select>
            </Field>
          )}
        </form.Field>

        <form.Field name="pools">
          {(field) => (
            <Field
              label="Pools"
              required
              hint="Comma separated. The store server refuses any pool it does not own."
            >
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                className="font-mono"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="lease">
          {(field) => (
            <Field
              label="Offline lease, in seconds"
              hint="Leave empty for the default of seven days."
            >
              <Input
                value={field.state.value}
                inputMode="numeric"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        {register.isError && (
          <Banner tone="bad">{saying(register.error)}</Banner>
        )}
      </form>
    </Sheet>
  )
}

function RotateReaderSheet({
  device,
  onClose,
}: {
  device: RfidDevice | null
  onClose: () => void
}) {
  const client = useQueryClient()

  const rotate = useMutation({
    mutationFn: () => rotateRfidDeviceKey(device!.device_id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: systemKeys.rfidDevices() })
      void client.invalidateQueries({ queryKey: systemKeys.fleet() })
      onClose()
    },
  })

  return (
    <Sheet
      open={device !== null}
      onOpenChange={(next) => {
        if (!next) {
          rotate.reset()
          onClose()
        }
      }}
      id={device?.device_id}
      title="Cancel this reader's key"
      footer={
        <div className="flex justify-end gap-2">
          <Button data-cancel variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            pending={rotate.isPending}
            onClick={() => rotate.mutate()}
          >
            {rotate.isPending ? "Rotating…" : "Rotate key"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Banner tone="warn">
          The reader will stop working as soon as the new policy reaches its
          store server, and the new key is not shown in this console. Somebody
          has to be at {device?.origin_id ?? "the store server"} to provision it
          again.
        </Banner>
        <p className="text-[0.9375rem] text-body">
          {device?.label} · last seen{" "}
          {device?.last_seen_at ? moment(device.last_seen_at) : "never"}.
        </p>
        {rotate.isError && <Banner tone="bad">{saying(rotate.error)}</Banner>}
      </div>
    </Sheet>
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
      return "Stopped and removed in People → Settings → Punch stations, where its authority is kept."
    case "EDC":
      return "Switched on and off in Finance → Sales & banks, where its bank is kept."
    default:
      return "Switched on and off in the Readers tab above, where its key is kept."
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
              <p className="mb-2.5 text-[0.9375rem] text-body">
                A stopped till signs nobody in until you resume it. A removed
                one never does again; a replacement takes its name.
              </p>
              <Field label="Why">
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
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
                    variant="destructive"
                    disabled={change.isPending || needsReason}
                    onClick={() => change.mutate("SUSPENDED")}
                  >
                    Stop
                  </Button>
                )}
                {device.status === "SUSPENDED" && (
                  <Button
                    variant="primary"
                    disabled={change.isPending}
                    onClick={() => change.mutate("ACTIVE")}
                  >
                    Resume
                  </Button>
                )}
                <Button
                  variant="destructive"
                  disabled={change.isPending || needsReason}
                  onClick={() => change.mutate("REVOKED")}
                >
                  Remove
                </Button>
              </div>
            </Section>
          ) : (
            device.status !== "REVOKED" && (
              <p className="text-meta text-mute">{switchedWhere(device)}</p>
            )
          )}

          <ActivityFold>
            {queryState(history, {
              loading: "Loading…",
              render: (items) =>
                items.length === 0 ? (
                  <p className="text-[0.9375rem] text-body">
                    Nothing recorded yet.
                  </p>
                ) : (
                  <MiniTable head={["When", "What Happened"]}>
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
          </ActivityFold>
        </div>
      )}
    </Sheet>
  )
}
