import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { ButtonGroup, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import {
  useFilterState,
  type Filter,
  type FilterField,
  type FilterParam,
} from "@/lib/filters"
import { count, day, moment } from "@/lib/format"
import {
  edgeAssignmentsPage,
  listOrigins,
  listUsers,
  rfidDevicesPage,
  registerRfidDevice,
  rotateRfidDeviceKey,
  setEdgeAssignmentActive,
  setRfidDeviceActive,
  setRfidDeviceKind,
  systemKeys,
  upsertEdgeAssignment,
  type AccessScope,
  type EdgeAssignment,
  type RfidDevice,
  type RfidKind,
  type SyncOrigin,
} from "@/lib/queries/system"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { Secret } from "@/screens/system/shared"
import { saying, span } from "@/screens/system/units"
import type { Role } from "@itulah/contract"

/// Who may sign in at a node, and which readers it trusts.
///
/// Both lists are the same fact from two ends — they are published to a node in
/// one policy snapshot — but they are different datasets about different
/// things, which is what `<SubTabs>` says and a segment would not.
///
/// Neither list opens a record sheet, and that is a decision rather than an
/// omission: every field a row carries is already a column, so a sheet would
/// cost a click and show nothing new. What a row needs is a decision — suspend,
/// restore, rotate — and those sit in the row. The forms that write are
/// composers, so their state is local: a half-typed password must never be
/// linkable.
///
/// Nothing here ever renders a secret. The server mints a reader's device key
/// and returns it exactly once; this console discards it at the query boundary
/// and says so where it matters, because a key on a screen is a key in a
/// screenshot.

type Tab = "people" | "readers"

const tabs = [
  { value: "people", label: "At the nodes" },
  { value: "readers", label: "Readers" },
] as const

const roles: readonly Role[] = ["CASHIER", "SUPERVISOR", "ADMIN"]

/// Columns are built by a function at module scope rather than closing over the
/// component's props: the handlers are passed in explicitly and the result is
/// memoised, so a cell can never capture a stale render.
function peopleColumns(on: {
  setActive: (row: EdgeAssignment, active: boolean) => void
  rotate: (row: EdgeAssignment) => void
  busy: boolean
}): ColumnDef<TableSetup, EdgeAssignment>[] {
  return [
    {
      accessorKey: "origin_id",
      header: "Node",
      size: 150,
      // "Who may sign in at this shop" is the question this list is opened
      // with — the Node chip, answered by the server.
    },
    {
      accessorKey: "display_name",
      header: "Person",
      size: 190,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-medium text-ink">
          {row.original.display_name}
        </span>
      ),
    },
    {
      accessorKey: "username",
      header: "Username",
      size: 140,
      cell: ({ row }) => (
        <span className="font-mono text-id text-body">
          {row.original.username}
        </span>
      ),
    },
    {
      accessorKey: "role",
      header: "Role here",
      size: 120,
      // The role AT THE NODE, which is not the role at the centre — the whole
      // reason this list exists apart from Account. "Every till administrator"
      // is the clause an audit starts with — the Role chip.
      enableSorting: false,
      cell: ({ row }) => (
        <Tag tone={row.original.role === "ADMIN" ? "accent" : "neutral"}>
          {row.original.role}
        </Tag>
      ),
    },
    {
      accessorKey: "offline_ttl_seconds",
      header: "Offline lease",
      size: 120,
      // In seconds, because that is what the column holds and inventing a
      // friendlier unit here would mean the number somebody types and the
      // number the row carries are two different things. 86400 is the day the
      // cell already marks in amber.
      meta: { align: "right" },
      // The decision metric. A lease is how long a node keeps honouring this
      // person after it stops being able to ask the centre, so the longest
      // ones are the ones worth looking at first.
      cell: ({ row }) => (
        <span
          className={
            row.original.offline_ttl_seconds >= 86_400
              ? "font-medium text-warn-fg"
              : "text-mute"
          }
        >
          {span(row.original.offline_ttl_seconds)}
        </span>
      ),
    },
    {
      id: "state",
      accessorFn: (row) => (row.active ? "Active" : "Suspended"),
      header: "State",
      size: 110,
      enableSorting: false,
      cell: ({ row }) => (
        <Pill tone={row.original.active ? "ok" : "bad"}>
          {row.original.active ? "Active" : "Suspended"}
        </Pill>
      ),
    },
    {
      accessorKey: "updated_at",
      header: "Changed",
      size: 120,
      // "What was granted or suspended since Monday" — the question somebody
      // asks of an access list after an incident: sort by it, newest first.
      meta: { align: "right" },
      cell: ({ row }) => day(row.original.updated_at),
    },
    {
      id: "act",
      header: "",
      size: 170,
      enableSorting: false,
      cell: ({ row }) => (
        <ButtonGroup className="[&>button:disabled]:opacity-50">
          <button
            type="button"
            disabled={on.busy}
            onClick={() => on.rotate(row.original)}
          >
            Rotate password
          </button>
          <button
            type="button"
            disabled={on.busy}
            onClick={() => on.setActive(row.original, !row.original.active)}
          >
            {row.original.active ? "Suspend" : "Restore"}
          </button>
        </ButtonGroup>
      ),
    },
  ]
}

/// What each kind of key's machine is called here.
const RFID_KIND_LABEL: Record<RfidKind, string> = {
  RFID_READER: "Fixed reader",
  HANDHELD: "Handheld",
}

function readerColumns(on: {
  setActive: (row: RfidDevice, active: boolean) => void
  setKind: (row: RfidDevice, kind: RfidKind) => void
  rotate: (row: RfidDevice) => void
  busy: boolean
}): ColumnDef<TableSetup, RfidDevice>[] {
  return [
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
      // A key registered before head office asked is a fixed reader until
      // somebody says otherwise, and the list is where they notice.
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
      header: "Node",
      size: 140,
    },
    {
      id: "pools",
      accessorFn: (row) => row.pools.join(" "),
      header: "Pools",
      size: 200,
      enableSorting: false,
      // **Not filterable, and the accessor is why.** The pools are joined into
      // one string for sorting, so `multi` would test the sentence rather than
      // the list and "includes SELLABLE" would match a reader scoped only to
      // `SELLABLE_RESERVED`. A filter that is right most of the time is worse
      // here than none: this list says which readers a node trusts.
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
      header: "Offline lease",
      size: 120,
      meta: { align: "right" },
      cell: ({ row }) => span(row.original.offline_ttl_seconds),
    },
    {
      id: "last_seen",
      accessorFn: (row) =>
        row.last_seen_at === null ? 0 : Date.parse(row.last_seen_at),
      header: "Last seen",
      size: 140,
      // **No filter.** `0` stands for "never heard from", so a date clause
      // would answer for those readers as though they had last reported in
      // 1970: "before last month" would sweep them in silently and "is empty"
      // would miss them. On a list of devices whose keys a node still trusts,
      // a clause that is quietly wrong about the never-seen ones is worse than
      // no clause — they are the rows somebody came here for.
      meta: { align: "right" },
      // The decision metric: a reader nobody has heard from is either broken or
      // gone, and either way its key is still trusted until somebody says
      // otherwise.
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
}

export function Access() {
  const client = useQueryClient()
  const [tab, setTab] = useState<Tab>("people")
  const [query, setQuery] = useState("")
  // Composer state: which record a form is being written FOR, not which record
  // is open for reading. A half-typed password must not be linkable.
  const [granting, setGranting] = useState<EdgeAssignment | null | "new">(null)
  const [registering, setRegistering] = useState(false)
  const [rotatingReader, setRotatingReader] = useState<RfidDevice | null>(null)

  const suspendPerson = useMutation({
    mutationFn: (input: { row: EdgeAssignment; active: boolean }) =>
      setEdgeAssignmentActive(input.row.origin_id, input.row.user_id, {
        active: input.active,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: systemKeys.edgeAssignments() })
      void client.invalidateQueries({ queryKey: systemKeys.fleet() })
    },
  })

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

  // Depending on `mutate` and `isPending` rather than the mutation object:
  // `mutate` is stable across renders, so the column definitions are rebuilt
  // when the busy flag actually flips and not on every keystroke in the search
  // box.
  const suspendPersonNow = suspendPerson.mutate
  const suspendPersonBusy = suspendPerson.isPending
  const switchReaderNow = switchReader.mutate
  const switchReaderBusy = switchReader.isPending
  const kindReaderNow = kindReader.mutate
  const kindReaderBusy = kindReader.isPending

  const peopleActions = useMemo(
    () => ({
      setActive: (row: EdgeAssignment, active: boolean) =>
        suspendPersonNow({ row, active }),
      rotate: (row: EdgeAssignment) => setGranting(row),
      busy: suspendPersonBusy,
    }),
    [suspendPersonNow, suspendPersonBusy]
  )

  const readerActions = useMemo(
    () => ({
      setActive: (row: RfidDevice, active: boolean) =>
        switchReaderNow({ row, active }),
      setKind: (row: RfidDevice, kind: RfidKind) =>
        kindReaderNow({ row, kind }),
      rotate: (row: RfidDevice) => setRotatingReader(row),
      busy: switchReaderBusy || kindReaderBusy,
    }),
    [switchReaderNow, switchReaderBusy, kindReaderNow, kindReaderBusy]
  )

  const failure = suspendPerson.error ?? switchReader.error ?? kindReader.error

  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Access"
        sub="Who may sign in at a node, and which readers that node trusts."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            {/* One black CTA, and what it creates follows the tab: the two
                lists are two datasets, so one "add" for each would be two
                primaries competing on one screen. */}
            <Button
              variant="primary"
              onClick={() =>
                tab === "people" ? setGranting("new") : setRegistering(true)
              }
            >
              {tab === "people" ? "Grant access" : "Register reader"}
            </Button>
          </>
        }
      />

      {failure && (
        <Banner tone="bad" className="mb-3">
          {saying(failure)}
        </Banner>
      )}

      <SubTabs
        tabs={tabs}
        value={tab}
        onChange={(next) => setTab(next as Tab)}
      />

      {tab === "people" ? (
        <PeopleTab query={query} actions={peopleActions} />
      ) : (
        <ReadersTab query={query} actions={readerActions} />
      )}

      <GrantSheet
        // Remounting on the record being written for is what clears the form,
        // rather than an effect racing whatever has already been typed.
        key={
          granting === null || granting === "new"
            ? "new"
            : `${granting.origin_id}/${granting.user_id}`
        }
        assignment={granting}
        onClose={() => setGranting(null)}
      />
      <RegisterReaderSheet
        open={registering}
        onClose={() => setRegistering(false)}
      />
      <RotateReaderSheet
        device={rotatingReader}
        onClose={() => setRotatingReader(null)}
      />
    </PageContent>
  )
}

/// Which column means which order each endpoint names. A column not in here
/// cannot be sorted — sorting it would sort the loaded pages.
const PEOPLE_SORTS: Record<string, string> = {
  origin_id: "origin",
  username: "username",
  updated_at: "updated",
  offline_ttl_seconds: "lease",
}
const READER_SORTS: Record<string, string> = {
  origin_id: "origin",
  device_id: "device",
  label: "label",
  last_seen: "last_seen",
  offline_ttl_seconds: "lease",
}

const NODE: FilterField = {
  column: "origin_id",
  label: "Node",
  spec: { kind: "option", single: true, operators: ["isAnyOf"] },
}
const ROLE: FilterField = {
  column: "role",
  label: "Role here",
  spec: { kind: "option", single: true, operators: ["isAnyOf"] },
}
const STATE: FilterField = {
  column: "state",
  label: "State",
  spec: {
    kind: "option",
    single: true,
    operators: ["isAnyOf"],
    format: (value) =>
      value === "ACTIVE"
        ? "Active"
        : value === "SUSPENDED"
          ? "Suspended"
          : value,
  },
}
const PEOPLE_FIELDS: FilterField[] = [NODE, ROLE, STATE]
const READER_FIELDS: FilterField[] = [NODE, STATE]

/// The chips as the parameters both endpoints answer. One value each: the
/// routes compare one column to one value, and every field is `single`.
function accessScopeFromFilters(filters: readonly Filter[]): AccessScope {
  const scope: { origin_id?: string; role?: string; active?: boolean } = {}
  for (const { column, operator, values } of filters) {
    if (values.length === 0 || operator !== "isAnyOf") continue
    if (column === "origin_id") scope.origin_id = values[0]
    else if (column === "role") scope.role = values[0]
    else if (column === "state") scope.active = values[0] === "ACTIVE"
  }
  return scope
}

/// Search, chips and order, as one request. Shared by the two tabs, which
/// differ only in which endpoint answers and which orders it names.
function useAccessScope(
  query: string,
  fields: FilterField[],
  sorts: Record<string, string>,
  sorting: SortingState,
  param: FilterParam
) {
  const filters = useFilterState(fields, param)
  // Debounced: every keystroke is a round trip.
  const needle = useDebounced(query.trim(), 400)
  const scope = useMemo<AccessScope>(() => {
    const by = sorting[0]
    return {
      ...accessScopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
      sort: by === undefined ? undefined : sorts[by.id],
      desc: by?.desc === true,
    }
  }, [filters.filters, needle, sorting, sorts])
  const narrowed = needle !== "" || filters.filters.length > 0
  return { filters, scope, narrowed }
}

/// The fields, carrying the server's exact tally for each.
function countedFields(
  fields: FilterField[],
  facets:
    | {
        readonly origins: readonly { value: string; count: number }[]
        readonly states: readonly { value: string; count: number }[]
        readonly roles?: readonly { value: string; count: number }[]
      }
    | undefined
): FilterField[] {
  if (facets === undefined) return fields
  return fields.map((field) => {
    const counted =
      field.column === "origin_id"
        ? facets.origins
        : field.column === "state"
          ? facets.states
          : field.column === "role"
            ? facets.roles
            : undefined
    return counted === undefined
      ? field
      : { ...field, spec: { ...field.spec, counted } }
  })
}

function PeopleTab({
  query,
  actions,
}: {
  query: string
  actions: Parameters<typeof peopleColumns>[0]
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "offline_ttl_seconds", desc: true },
  ])
  const columns = useMemo(() => peopleColumns(actions), [actions])

  /// `?f=`, while the readers below take `?f2=`. Two keys because the two tabs
  /// share column names — Node, State — so one key would let a clause meant
  /// for a person half-apply itself to a device the moment somebody changed
  /// tab. `lib/filters.ts` names this screen as the case the second key exists
  /// for.
  const { filters, scope, narrowed } = useAccessScope(
    query,
    PEOPLE_FIELDS,
    PEOPLE_SORTS,
    sorting,
    "f"
  )

  const assignments = useInfiniteQuery({
    queryKey: systemKeys.edgeAssignments(scope),
    queryFn: ({ pageParam, signal }) =>
      edgeAssignmentsPage({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })
  const rows = useMemo(
    () => assignments.data?.pages.flatMap((page) => page.rows) ?? [],
    [assignments.data]
  )
  const head = assignments.data?.pages[0]
  const model = useMemo(
    () => ({ ...filters, fields: countedFields(PEOPLE_FIELDS, head?.facets) }),
    [filters, head]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: EdgeAssignment) => `${row.origin_id}/${row.user_id}`,
        state: { sorting },
        // The rows arrive in the order the request asked for.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, columns, sorting]
    )
  )

  return (
    <>
      <Toolbar>
        <FilterPanel model={model} />
        <Toolbar.Spacer />
        {head && (
          <span className="text-[0.875rem] text-mute tabular-nums">
            {count(head.total)} grants
          </span>
        )}
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(assignments, {
          loading: "Loading who may sign in where…",
          render: () =>
            rows.length === 0 ? (
              narrowed ? (
                <EmptyState>Nobody matches what you asked for.</EmptyState>
              ) : (
                <EmptyState
                  action={
                    <AppLink
                      to="/system/account"
                      className="text-meta font-medium text-accent hover:underline"
                    >
                      See who has an account
                    </AppLink>
                  }
                >
                  Nobody has been given access at a node yet. A centre account
                  does not sign anybody in at a till — that is a separate grant,
                  with its own credential.
                </EmptyState>
              )
            ) : (
              <DataTable<EdgeAssignment>
                table={table}
                more={assignments}
                className="max-h-[calc(100vh-18rem)]"
              />
            ),
        })}
      </Card>
    </>
  )
}

function ReadersTab({
  query,
  actions,
}: {
  query: string
  actions: Parameters<typeof readerColumns>[0]
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "last_seen", desc: false },
  ])
  const columns = useMemo(() => readerColumns(actions), [actions])

  /// `?f2=`, so a clause about a person and a clause about a reader can both
  /// stand while somebody moves between the tabs. See the people tab above.
  const { filters, scope, narrowed } = useAccessScope(
    query,
    READER_FIELDS,
    READER_SORTS,
    sorting,
    "f2"
  )

  const devices = useInfiniteQuery({
    queryKey: systemKeys.rfidDevices(scope),
    queryFn: ({ pageParam, signal }) =>
      rfidDevicesPage({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })
  const rows = useMemo(
    () => devices.data?.pages.flatMap((page) => page.rows) ?? [],
    [devices.data]
  )
  const head = devices.data?.pages[0]
  const model = useMemo(
    () => ({ ...filters, fields: countedFields(READER_FIELDS, head?.facets) }),
    [filters, head]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: RfidDevice) => row.device_id,
        state: { sorting },
        // The rows arrive in the order the request asked for.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, columns, sorting]
    )
  )

  return (
    <>
      <Toolbar>
        <FilterPanel model={model} />
        <Toolbar.Spacer />
        {head && (
          <span className="text-[0.875rem] text-mute tabular-nums">
            {count(head.total)} readers
          </span>
        )}
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(devices, {
          loading: "Loading the readers…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {narrowed
                  ? "No reader matches what you asked for."
                  : "No reader has been registered. A node will not accept tag reads from a device the centre has not vouched for."}
              </EmptyState>
            ) : (
              <DataTable<RfidDevice>
                table={table}
                more={devices}
                className="max-h-[calc(100vh-18rem)]"
              />
            ),
        })}
      </Card>
    </>
  )
}

/// Granting somebody access at a node, changing their role there, or rotating
/// the password they use there.
///
/// One endpoint does all three, and it deliberately does NOT restore a
/// suspended assignment: handing out a new password and readmitting somebody
/// are two decisions, and a form that silently did both would readmit people
/// nobody meant to. The node password is separate from their Cloud password by
/// design — the same person signs in at head office with one credential and at
/// a till with another, and the node never receives the Cloud one.
///
/// At a DC the password is optional: the hub signs people in there with their
/// Cloud session, and a node password only matters for signing in while the
/// Cloud link is down. Left empty on an existing grant, it keeps the one the
/// grant already has.
interface GrantDraft {
  originId: string
  userId: string
  role: Role | null
  edgePassword: string
  lease: string
}

/// For a new grant: who, where, and a password unless the node is a DC. For an
/// existing one: something to change.
function grantReady(
  draft: GrantDraft,
  rotating: boolean,
  atDc: boolean
): boolean {
  if (rotating) return draft.edgePassword !== "" || draft.role !== null
  return (
    draft.originId !== "" &&
    draft.userId !== "" &&
    (atDc || draft.edgePassword !== "")
  )
}

/// Whether a node signs people in with their Cloud session. Only a DC does.
function isDc(origins: readonly SyncOrigin[] | undefined, originId: string) {
  return (
    origins?.find((origin) => origin.origin_id === originId)?.node_role === "DC"
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

/// Everything but the lease, which has a default the node applies itself.
function readerReady(draft: ReaderDraft): boolean {
  return (
    draft.deviceId.trim() !== "" &&
    draft.originId !== "" &&
    draft.label.trim() !== "" &&
    draft.pools.trim() !== ""
  )
}

function GrantSheet({
  assignment,
  onClose,
}: {
  assignment: EdgeAssignment | null | "new"
  onClose: () => void
}) {
  const client = useQueryClient()
  const existing =
    assignment !== null && assignment !== "new" ? assignment : null
  const open = assignment !== null

  const origins = useQuery({
    queryKey: systemKeys.origins(),
    queryFn: ({ signal }) => listOrigins(signal),
    enabled: open,
  })
  const users = useQuery({
    queryKey: systemKeys.users(),
    queryFn: ({ signal }) => listUsers(signal),
    enabled: open,
  })

  const grant = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: GrantDraft) =>
      upsertEdgeAssignment({
        origin_id: existing?.origin_id ?? draft.originId,
        user_id: existing?.user_id ?? draft.userId,
        role: draft.role ?? existing?.role ?? "CASHIER",
        edge_password: draft.edgePassword === "" ? null : draft.edgePassword,
        offline_ttl_seconds:
          draft.lease.trim() === "" ? null : Number(draft.lease),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: systemKeys.edgeAssignments() })
      void client.invalidateQueries({ queryKey: systemKeys.fleet() })
      clear()
      onClose()
    },
  })

  const form = useForm({
    defaultValues: {
      originId: "",
      userId: "",
      // `null` means "not touched": rotating a password keeps the role the
      // assignment already carries unless somebody deliberately changes it.
      // The sheet is reused across assignments, so a default read from the
      // record at mount would be the previous one's.
      role: null,
      edgePassword: "",
      lease: "",
    } as GrantDraft,
    onSubmit: ({ value }) => grant.mutate(value),
  })

  const atDc = (values: GrantDraft) =>
    isDc(origins.data, existing?.origin_id ?? values.originId)

  /// The password goes with the rest of the draft: it is never read back by anything,
  /// so a closed sheet still holding one is a credential nobody is watching.
  function clear() {
    form.reset()
    grant.reset()
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
      id={existing?.origin_id}
      title={
        existing
          ? `Change ${existing.display_name}'s node access`
          : "Grant access at a node"
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="quiet"
            onClick={() => {
              clear()
              onClose()
            }}
          >
            Cancel
          </Button>
          <form.Subscribe
            selector={(state) =>
              grantReady(state.values, existing !== null, atDc(state.values))
            }
          >
            {(ready) => (
              <Button
                pending={grant.isPending}
                disabled={!ready}
                onClick={() => form.handleSubmit()}
              >
                {grant.isPending ? "Saving…" : existing ? "Save" : "Grant"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      }
    >
      <form
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress.
        onSubmit={(event) => {
          event.preventDefault()
          if (
            grantReady(
              form.state.values,
              existing !== null,
              atDc(form.state.values)
            ) &&
            !grant.isPending
          ) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5"
      >
        {existing ? (
          <Banner tone="info">
            Changing a role or a password does not restore a suspended
            assignment. Those are two decisions, and this form only makes one of
            them.
          </Banner>
        ) : null}

        {!existing && (
          <>
            <form.Field name="originId">
              {(field) => (
                <Field label="Node" required>
                  <Select
                    value={field.state.value}
                    onChange={(next) => field.handleChange(next)}
                  >
                    <option value="">Choose a node…</option>
                    {(origins.data ?? []).map((origin) => (
                      <option key={origin.origin_id} value={origin.origin_id}>
                        {origin.label ?? origin.origin_id}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </form.Field>
            <form.Field name="userId">
              {(field) => (
                <Field label="Person" required>
                  <Select
                    value={field.state.value}
                    onChange={(next) => field.handleChange(next)}
                  >
                    <option value="">Choose somebody…</option>
                    {(users.data?.rows ?? []).map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.display_name} · {user.username}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </form.Field>
          </>
        )}

        <form.Field name="role">
          {(field) => (
            <Field
              label="Role at this node"
              hint="Not their role at the centre. A supervisor at head office can be an ordinary cashier at the till."
            >
              <Select
                value={field.state.value ?? existing?.role ?? "CASHIER"}
                onChange={(next) => field.handleChange(next as Role)}
              >
                {roles.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => atDc(state.values)}>
          {(dc) => (
            <form.Field name="edgePassword">
              {(field) => (
                <Field
                  label={
                    dc ? "Offline password at this DC" : "Password at this node"
                  }
                  required={!dc && !existing}
                  hint={
                    dc
                      ? "Not needed to sign in: the hub uses their Central Dashboard account. Set one only for signing in while the DC cannot reach the centre. Hashed on arrival and never shown again."
                      : existing
                        ? "Leave empty to keep the current one. Separate from the Cloud password; hashed on arrival and never shown again."
                        : "Used to sign in at the till, separately from the Cloud password. Hashed on arrival and never shown again."
                  }
                >
                  <Secret
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
          )}
        </form.Subscribe>

        <form.Field name="lease">
          {(field) => (
            <Field
              label="Offline lease, in seconds"
              hint="How long the node keeps honouring this person while it cannot reach the centre. Leave empty for the default; supervisors and admins cannot exceed 24 hours."
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

        {grant.isError && <Banner tone="bad">{saying(grant.error)}</Banner>}
      </form>
    </Sheet>
  )
}

/// Registering a reader on a node's floor.
///
/// The server mints a device key and returns it exactly once. This console does
/// not receive it — the query layer drops it — so provisioning the reader is
/// done at the node.
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
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
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
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress.
        onSubmit={(event) => {
          event.preventDefault()
          if (readerReady(form.state.values) && !register.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5"
      >
        <Banner tone="info">
          The node mints this reader's key and hands it back once. This console
          does not keep it and will not display it, so finish provisioning at
          the node itself.
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
            <Field label="Node" required>
              <Select
                value={field.state.value}
                onChange={(next) => field.handleChange(next)}
              >
                <option value="">Choose a node…</option>
                {(origins.data ?? []).map((origin) => (
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
              hint="A handheld is carried round the floor; a fixed reader stays over a door or a bench. The node reports it under this kind."
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
              hint="Comma separated. The node refuses any pool it does not own."
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

/// Retiring a reader's key.
///
/// This is the answer to a key that leaked, and it is not free: the old key
/// stops working the moment the new policy reaches the node, and the new one is
/// shown nowhere. So the reader has to be provisioned again at the node
/// afterwards, and this asks before it does that rather than after.
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
          <Button variant="quiet" onClick={onClose}>
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
          node, and the new key is not shown in this console. Somebody has to be
          at {device?.origin_id ?? "the node"} to provision it again.
        </Banner>
        <p className="text-[0.875rem] text-body">
          {device?.label} · last seen{" "}
          {device?.last_seen_at ? moment(device.last_seen_at) : "never"}.
        </p>
        {rotate.isError && <Banner tone="bad">{saying(rotate.error)}</Banner>}
      </div>
    </Sheet>
  )
}
