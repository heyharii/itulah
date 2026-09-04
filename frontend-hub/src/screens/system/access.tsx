import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { ButtonGroup } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { count, day, moment } from "@/lib/format"
import {
  listEdgeAssignments,
  listOrigins,
  listRfidDevices,
  listUsers,
  registerRfidDevice,
  rotateRfidDeviceKey,
  setEdgeAssignmentActive,
  setRfidDeviceActive,
  systemKeys,
  upsertEdgeAssignment,
  type EdgeAssignment,
  type RfidDevice,
} from "@/lib/queries/system"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
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
/// composers, so their state is local: a half-typed PIN must never be
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
    { accessorKey: "origin_id", header: "Node", size: 150 },
    {
      accessorKey: "display_name",
      header: "Person",
      size: 190,
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
      meta: { align: "right" },
      cell: ({ row }) => day(row.original.updated_at),
    },
    {
      id: "act",
      header: "",
      size: 170,
      cell: ({ row }) => (
        <ButtonGroup className="[&>button:disabled]:opacity-50">
          <button
            type="button"
            disabled={on.busy}
            onClick={() => on.rotate(row.original)}
          >
            Rotate PIN
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

function readerColumns(on: {
  setActive: (row: RfidDevice, active: boolean) => void
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
    { accessorKey: "origin_id", header: "Node", size: 140 },
    {
      id: "pools",
      accessorFn: (row) => row.pools.join(" "),
      header: "Pools",
      size: 200,
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
      cell: ({ row }) => (
        <Pill tone={row.original.active ? "ok" : "neutral"}>
          {row.original.active ? "Active" : "Off"}
        </Pill>
      ),
    },
    {
      id: "act",
      header: "",
      size: 180,
      cell: ({ row }) => (
        <ButtonGroup className="[&>button:disabled]:opacity-50">
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
  const [said, setSaid] = useState<string | null>(null)
  // Composer state: which record a form is being written FOR, not which record
  // is open for reading. A half-typed PIN must not be linkable.
  const [granting, setGranting] = useState<EdgeAssignment | null | "new">(null)
  const [registering, setRegistering] = useState(false)
  const [rotatingReader, setRotatingReader] = useState<RfidDevice | null>(null)

  const assignments = useQuery({
    queryKey: systemKeys.edgeAssignments(),
    queryFn: ({ signal }) => listEdgeAssignments(signal),
  })
  const devices = useQuery({
    queryKey: systemKeys.rfidDevices(),
    queryFn: ({ signal }) => listRfidDevices(signal),
  })

  const suspendPerson = useMutation({
    mutationFn: (input: { row: EdgeAssignment; active: boolean }) =>
      setEdgeAssignmentActive(input.row.origin_id, input.row.user_id, {
        active: input.active,
      }),
    onSuccess: (done) => {
      setSaid(
        `${done.active ? "Restored" : "Suspended"} at ${done.origin_id}. Policy version ${count(done.policy.version)} is on its way to the node.`
      )
      void client.invalidateQueries({ queryKey: systemKeys.edgeAssignments() })
      void client.invalidateQueries({ queryKey: systemKeys.fleet() })
    },
  })

  const switchReader = useMutation({
    mutationFn: (input: { row: RfidDevice; active: boolean }) =>
      setRfidDeviceActive(input.row.device_id, input.active),
    onSuccess: (done) => {
      setSaid(
        `${done.device_id} is ${done.active ? "on" : "off"}. Policy version ${count(done.policy.version)} is on its way to ${done.origin_id}.`
      )
      void client.invalidateQueries({ queryKey: systemKeys.rfidDevices() })
      void client.invalidateQueries({ queryKey: systemKeys.fleet() })
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
      rotate: (row: RfidDevice) => setRotatingReader(row),
      busy: switchReaderBusy,
    }),
    [switchReaderNow, switchReaderBusy]
  )

  const failure = suspendPerson.error ?? switchReader.error

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
              variant="dark"
              onClick={() =>
                tab === "people" ? setGranting("new") : setRegistering(true)
              }
            >
              {tab === "people" ? "Grant access" : "Register reader"}
            </Button>
          </>
        }
      />

      {said && (
        <Banner tone="ok" className="mb-3" onDismiss={() => setSaid(null)}>
          {said}
        </Banner>
      )}
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
        <PeopleTab
          rows={assignments.data ?? []}
          query={query}
          onQuery={setQuery}
          actions={peopleActions}
          state={assignments}
        />
      ) : (
        <ReadersTab
          rows={devices.data ?? []}
          query={query}
          onQuery={setQuery}
          actions={readerActions}
          state={devices}
        />
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
        onDone={setSaid}
      />
      <RegisterReaderSheet
        open={registering}
        onClose={() => setRegistering(false)}
        onDone={setSaid}
      />
      <RotateReaderSheet
        device={rotatingReader}
        onClose={() => setRotatingReader(null)}
        onDone={setSaid}
      />
    </PageContent>
  )
}

/// The state shape `queryState` needs, without naming Query's own generics.
interface Loadable<T> {
  isPending: boolean
  isError: boolean
  error: unknown
  data: T | undefined
  refetch: () => void
}

function PeopleTab({
  rows,
  query,
  onQuery,
  actions,
  state,
}: {
  rows: readonly EdgeAssignment[]
  query: string
  onQuery: (value: string) => void
  actions: Parameters<typeof peopleColumns>[0]
  state: Loadable<readonly EdgeAssignment[]>
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "offline_ttl_seconds", desc: true },
  ])
  const columns = useMemo(() => peopleColumns(actions), [actions])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as EdgeAssignment[],
        columns,
        getRowId: (row: EdgeAssignment) => `${row.origin_id}/${row.user_id}`,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: onQuery,
      }),
      [rows, columns, query, sorting, onQuery]
    )
  )

  return (
    <Card className="overflow-hidden">
      {queryState(state, {
        loading: "Loading who may sign in where…",
        render: () =>
          rows.length === 0 ? (
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
              Nobody has been given access at a node yet. A centre account does
              not sign anybody in at a till — that is a separate grant, with its
              own credential.
            </EmptyState>
          ) : (
            <DataTable<EdgeAssignment>
              table={table}
              empty="Nobody matches that search."
              className="max-h-[calc(100vh-18rem)]"
            />
          ),
      })}
    </Card>
  )
}

function ReadersTab({
  rows,
  query,
  onQuery,
  actions,
  state,
}: {
  rows: readonly RfidDevice[]
  query: string
  onQuery: (value: string) => void
  actions: Parameters<typeof readerColumns>[0]
  state: Loadable<readonly RfidDevice[]>
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "last_seen", desc: false },
  ])
  const columns = useMemo(() => readerColumns(actions), [actions])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as RfidDevice[],
        columns,
        getRowId: (row: RfidDevice) => row.device_id,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: onQuery,
      }),
      [rows, columns, query, sorting, onQuery]
    )
  )

  return (
    <Card className="overflow-hidden">
      {queryState(state, {
        loading: "Loading the readers…",
        render: () =>
          rows.length === 0 ? (
            <EmptyState>
              No reader has been registered. A node will not accept tag reads
              from a device the centre has not vouched for.
            </EmptyState>
          ) : (
            <DataTable<RfidDevice>
              table={table}
              empty="No reader matches that search."
              className="max-h-[calc(100vh-18rem)]"
            />
          ),
      })}
    </Card>
  )
}

/// Granting somebody access at a node, or rotating the PIN they use there.
///
/// One endpoint does both, and it deliberately does NOT restore a suspended
/// assignment: handing out a new PIN and readmitting somebody are two
/// decisions, and a form that silently did both would readmit people nobody
/// meant to. The PIN is separate from their Cloud password by design — the same
/// person signs in at head office with one credential and at a till with
/// another, and the node never receives the Cloud one.
interface GrantDraft {
  originId: string
  userId: string
  role: Role | null
  pin: string
  lease: string
}

/// A PIN, and — when the assignment does not already say — who and where.
function grantReady(draft: GrantDraft, rotating: boolean): boolean {
  return (
    draft.pin !== "" &&
    (rotating || (draft.originId !== "" && draft.userId !== ""))
  )
}

interface ReaderDraft {
  deviceId: string
  originId: string
  label: string
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
  onDone,
}: {
  assignment: EdgeAssignment | null | "new"
  onClose: () => void
  onDone: (said: string) => void
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
        edge_password: draft.pin,
        offline_ttl_seconds:
          draft.lease.trim() === "" ? null : Number(draft.lease),
      }),
    onSuccess: (done) => {
      onDone(
        `${existing ? "Rotated the PIN" : "Granted access"} at ${done.origin_id}. Policy version ${count(done.policy.version)} is on its way to the node.`
      )
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
      // `null` means "not touched": rotating a PIN keeps the role the
      // assignment already carries unless somebody deliberately changes it.
      // The sheet is reused across assignments, so a default read from the
      // record at mount would be the previous one's.
      role: null,
      pin: "",
      lease: "",
    } as GrantDraft,
    onSubmit: ({ value }) => grant.mutate(value),
  })

  /// The PIN goes with the rest of the draft: it is never read back by anything,
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
          ? `Rotate ${existing.display_name}'s PIN`
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
            selector={(state) => grantReady(state.values, existing !== null)}
          >
            {(ready) => (
              <Button
                disabled={!ready || grant.isPending}
                onClick={() => form.handleSubmit()}
              >
                {grant.isPending
                  ? "Saving…"
                  : existing
                    ? "Rotate PIN"
                    : "Grant"}
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
            grantReady(form.state.values, existing !== null) &&
            !grant.isPending
          ) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5"
      >
        {existing ? (
          <Banner tone="info">
            Rotating a PIN does not restore a suspended assignment. Those are
            two decisions, and this form only makes one of them.
          </Banner>
        ) : null}

        {!existing && (
          <>
            <form.Field name="originId">
              {(field) => (
                <Field label="Node">
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
                <Field label="Person">
                  <Select
                    value={field.state.value}
                    onChange={(next) => field.handleChange(next)}
                  >
                    <option value="">Choose somebody…</option>
                    {(users.data ?? []).map((user) => (
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

        <form.Field name="pin">
          {(field) => (
            <Field
              label="PIN at this node"
              hint="Hashed the moment it arrives. Never stored in the clear, never sent to the node, and never shown again."
            >
              <Secret
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

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
/// done at the node, and the banner says so rather than pretending the job is
/// finished here.
function RegisterReaderSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: (said: string) => void
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
      }),
    onSuccess: (done) => {
      onDone(
        `${done.device_id} is registered at ${done.origin_id}, policy version ${count(done.policy.version)}. Its key was issued once and is not shown here — provision the reader from the node.`
      )
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
                disabled={!ready || register.isPending}
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
            <Field label="Node">
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
            <Field label="Label" hint="Where on the floor this reader stands.">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="pools">
          {(field) => (
            <Field
              label="Pools"
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
  onDone,
}: {
  device: RfidDevice | null
  onClose: () => void
  onDone: (said: string) => void
}) {
  const client = useQueryClient()

  const rotate = useMutation({
    mutationFn: () => rotateRfidDeviceKey(device!.device_id),
    onSuccess: (done) => {
      onDone(
        `${done.device_id} has a new key, policy version ${count(done.policy.version)}. The old one stops working when that reaches ${done.origin_id} — provision the reader again from the node.`
      )
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
      title="Retire this reader's key"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={rotate.isPending}
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
        <p className="text-[0.78125rem] text-body">
          {device?.label} · last seen{" "}
          {device?.last_seen_at ? moment(device.last_seen_at) : "never"}.
        </p>
        {rotate.isError && <Banner tone="bad">{saying(rotate.error)}</Banner>}
      </div>
    </Sheet>
  )
}
