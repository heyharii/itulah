import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { CloudOff, Radio } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count, day } from "@/lib/format"
import {
  bootstrapOrigin,
  fleetStatus,
  listNodeHealth,
  listOrigins,
  publishEdgePolicy,
  registerOrigin,
  systemKeys,
  type FleetBlock,
  type FleetNodeHealth,
  type SyncOrigin,
} from "@/lib/queries/system"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { EnrolmentQueue, InstallSheet } from "@/screens/system/enrolments"
import { toneRank } from "@/lib/node-health"
import {
  HealthPill,
  HealthStrip,
  NodeHealthSection,
} from "@/screens/system/node-health"
import { Secret, Section } from "@/screens/system/shared"
import { saying, span } from "@/screens/system/units"

/// The nodes this centre knows about.
///
/// Two reads, one list. `/sync/origins` is the register — who has been issued a
/// key, on which generation — and `/sync/fleet` is where each of them has got
/// to in the downstream command lane. Neither answers the question on its own:
/// the register says a shop exists, the fleet says it stopped listening three
/// days ago, and only together do they say which shop somebody has to ring. So
/// the list is the join, and it sorts by the backlog rather than by the name.
///
/// There is no `GET /sync/origins/{id}`, so the sheet reads the row it was
/// opened from rather than fetching its own detail. That is the one place this
/// module departs from the reference screen, and it is the server's shape
/// rather than a shortcut.

interface NodeRow extends SyncOrigin {
  readonly issued_seq: number | null
  readonly acked_seq: number | null
  readonly pending: number | null
  readonly converged: boolean | null
  readonly last_ack_age_seconds: number | null
  readonly blocked: FleetBlock | null
  /// What the store server last said about itself (heartbeat), or null for a
  /// node that has never sent one — the centre, an old node, a box that is off.
  readonly health: FleetNodeHealth | null
}

/// One word for where a node stands, and the tone that carries it.
///
/// `info` is SKY and means in motion: a node with a backlog is receiving, not
/// failing. Blocked is the only `bad` here, because it is the only state that
/// does not clear itself.
function state(row: NodeRow): {
  tone: "ok" | "bad" | "info" | "neutral"
  text: string
} {
  if (row.blocked) return { tone: "bad", text: "Blocked" }
  if (row.pending === null) return { tone: "neutral", text: "No commands" }
  if (row.pending > 0) return { tone: "info", text: "Behind" }
  return { tone: "ok", text: "Current" }
}

const columns: ColumnDef<TableSetup, NodeRow>[] = [
  {
    id: "condition",
    // Sorted worst first by default: the page answers "which shop do I ring".
    accessorFn: (row) => toneRank(row.health?.assessment.tone),
    header: "Condition",
    size: 170,
    cell: ({ row }) => <HealthPill health={row.original.health} />,
  },
  {
    id: "node",
    accessorFn: (row) => `${row.label ?? ""} ${row.origin_id}`,
    header: "Node",
    size: 220,
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {row.original.label ?? row.original.origin_id}
      </span>
    ),
  },
  {
    accessorKey: "site_id",
    header: "Site",
    size: 130,
    // A node without a site is the centre itself, so `is empty` separates the
    // fleet from the hub it reports to — which is the first thing somebody
    // reading a register of fifteen wants apart.
    meta: { filter: { kind: "option", label: "Site" } },
    cell: ({ row }) => row.original.site_id ?? "—",
  },
  {
    id: "happening",
    accessorFn: (row) => row.health?.assessment.headline ?? "",
    header: "What is happening",
    size: 320,
    cell: ({ row }) => {
      const health = row.original.health
      if (!health) return <span className="text-mute">—</span>
      return (
        <span className="flex flex-col">
          <span className="text-ink">{health.assessment.headline}</span>
          {health.assessment.needs !== "NOBODY" && (
            <span className="text-meta text-mute">
              {
                {
                  SHOP: "Needs someone at the shop",
                  HEAD_OFFICE: "Needs head office",
                  DEVELOPER: "Needs a developer",
                  NOBODY: "",
                }[health.assessment.needs]
              }
            </span>
          )}
        </span>
      )
    },
  },
  {
    id: "strip",
    header: "Last 4 hours",
    size: 120,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.health ? (
        <HealthStrip strip={row.original.health.strip} />
      ) : null,
  },
  {
    id: "version",
    accessorFn: (row) => row.health?.version ?? "",
    header: "Version",
    size: 90,
    meta: { filter: { kind: "option", label: "Version" } },
    cell: ({ row }) => (
      <span className="font-mono text-meta">
        {row.original.health?.version ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "node_role",
    header: "Role",
    size: 100,
    meta: { filter: { kind: "option", label: "Role" } },
    cell: ({ row }) =>
      row.original.node_role ? (
        <Tag>{row.original.node_role}</Tag>
      ) : (
        <span className="text-mute">—</span>
      ),
  },
  {
    accessorKey: "active_generation",
    header: "Generation",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.active_generation),
  },
  {
    id: "pending",
    accessorFn: (row) => row.pending ?? 0,
    header: "Behind",
    size: 100,
    meta: { align: "right" },
    // The decision metric, and the reason this list sorts by it: a zero is a
    // node that has applied everything the centre issued.
    cell: ({ row }) => {
      const value = row.original.pending
      if (value === null) return <span className="text-mute">—</span>
      return (
        <span className={value > 0 ? "font-medium text-warn-fg" : "text-mute"}>
          {count(value)}
        </span>
      )
    },
  },
  {
    id: "last_ack",
    accessorFn: (row) => row.last_ack_age_seconds ?? 0,
    header: "Last ack",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => span(row.original.last_ack_age_seconds),
  },
  {
    id: "state",
    accessorFn: (row) => state(row).text,
    header: "State",
    size: 130,
    // The four words `state()` can say, asked as a question. Blocked is the
    // one the queue above already shouts about; the useful clause here is the
    // opposite one — "is not Current", the nodes worth a second look on a
    // morning when nothing has failed outright.
    meta: { filter: { kind: "option", label: "State" } },
    cell: ({ row }) => {
      const shown = state(row.original)
      return <Pill tone={shown.tone}>{shown.text}</Pill>
    },
  },
]

export function Nodes({
  /// Rendered as one tab of "Store servers" (`screens/system/servers.tsx`)
  /// rather than as its own page: no `PageHeader`, and its actions move into
  /// a plain row above the register instead.
  embedded = false,
}: { embedded?: boolean } = {}) {
  const [query, setQuery] = useState("")
  // A form's visibility is NOT "which record is open": it holds half-typed
  // input, and a URL that reopened it would restore an empty form over
  // somebody's work. Records live in the URL; composers do not.
  const [registering, setRegistering] = useState(false)
  const [installing, setInstalling] = useState(false)
  const origin = useSheet("origin")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "condition", desc: true },
  ])

  const origins = useQuery({
    queryKey: systemKeys.origins(),
    queryFn: ({ signal }) => listOrigins(signal),
  })
  const fleet = useQuery({
    queryKey: systemKeys.fleet(),
    queryFn: ({ signal }) => fleetStatus(signal),
  })
  // A heartbeat arrives once a minute; read half as often as that is written
  // would show a stale "healthy" for up to two minutes.
  const health = useQuery({
    queryKey: systemKeys.nodeHealth(),
    queryFn: ({ signal }) => listNodeHealth(signal),
    refetchInterval: 30_000,
  })

  const rows = useMemo<NodeRow[]>(() => {
    const reached = new Map(
      (fleet.data?.items ?? []).map((item) => [item.origin_id, item])
    )
    const heard = new Map(
      (health.data ?? []).map((item) => [item.origin_id, item])
    )
    return (origins.data ?? []).map((node) => {
      const at = reached.get(node.origin_id)
      return {
        ...node,
        issued_seq: at?.issued_seq ?? null,
        acked_seq: at?.acked_seq ?? null,
        pending: at?.pending ?? null,
        converged: at?.converged ?? null,
        last_ack_age_seconds: at?.last_ack_age_seconds ?? null,
        blocked: at?.blocked ?? null,
        health: heard.get(node.origin_id) ?? null,
      }
    })
  }, [origins.data, fleet.data, health.data])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: NodeRow) => row.origin_id,
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

  /// Exceptions first: a node that stopped applying commands, then one that has
  /// not acknowledged anything for a day. Everything else is ordinary and lives
  /// in the list below.
  const exceptions = useMemo<Exception[]>(
    () =>
      rows
        .filter(
          (row) =>
            row.blocked !== null ||
            (row.last_ack_age_seconds !== null &&
              row.last_ack_age_seconds >= 86_400 &&
              (row.pending ?? 0) > 0)
        )
        .map((row) => ({
          id: row.origin_id,
          title: row.label ?? row.origin_id,
          detail: row.blocked
            ? `Stopped at sequence ${count(row.blocked.seq)}: ${row.blocked.reason ?? "no reason given"}`
            : `Nothing acknowledged for ${span(row.last_ack_age_seconds)}`,
          amount: `${count(row.pending)} behind`,
          severity: row.blocked ? ("high" as const) : ("medium" as const),
          icon: row.blocked ? (
            <CloudOff className="size-4" />
          ) : (
            <Radio className="size-4" />
          ),
          onOpen: () => origin.open(row.origin_id),
        })),
    [rows, origin]
  )

  const actions = (
    <>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search"
        className="h-8 w-48"
      />
      {/* Typing keys is the fallback now; a code the machine claims is
          the way a server joins. */}
      <Button onClick={() => setRegistering(true)}>Register by key</Button>
      <Button variant="primary" onClick={() => setInstalling(true)}>
        Install server
      </Button>
    </>
  )

  const body = (
    <>
      {/* A page-level fact, not a toast: the list is still usable without the
          convergence figures, and it has to say which half is missing. */}
      {fleet.isError && (
        <Banner tone="warn" className="mb-3">
          The register loaded, but the fleet's command positions did not.
          Every server below is shown without how far behind it is.
        </Banner>
      )}

      {embedded && (
        <div className="mb-3 flex flex-wrap items-center gap-2">{actions}</div>
      )}

      <EnrolmentQueue />

      {rows.length > 0 && (
        <ExceptionQueue
          title="Servers needing a person"
          exceptions={exceptions}
          empty="Every registered server is keeping up with the command lane."
        />
      )}

      {/* Below the exception queue, because the two answer different
          questions: the queue is the fleet telling you who to ring, and these
          clauses are you asking the register something it does not volunteer —
          every store server, every server with no site, everything not
          current. */}
      <Toolbar>
        <FilterPanel model={filters} table={table} />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(origins, {
          loading: "Loading the register…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No store server has been registered yet. A server cannot send
                facts to the centre until it has been issued a key here.
              </EmptyState>
            ) : (
              <DataTable<NodeRow>
                table={table}
                onRowClick={(row) => origin.open(row.origin_id)}
                isSelected={(row) => row.origin_id === origin.value}
                empty="No server matches that search."
                className="max-h-[calc(100vh-14rem)]"
              />
            ),
        })}
      </Card>

      <NodeSheet
        node={rows.find((row) => row.origin_id === origin.value) ?? null}
        open={origin.value !== undefined}
        onClose={origin.close}
      />

      <InstallSheet open={installing} onClose={() => setInstalling(false)} />

      <RegisterSheet
        open={registering}
        onClose={() => setRegistering(false)}
        onRegistered={() => setRegistering(false)}
      />
    </>
  )

  if (embedded) return body

  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Store servers"
        sub="Every store server the centre has issued a key to, and how far behind it is."
        actions={actions}
      />
      {body}
    </PageContent>
  )
}

/// One node, and the one thing an administrator does to it from here: send it
/// the complete picture of who may sign in and which readers are trusted.
function NodeSheet({
  node,
  open,
  onClose,
}: {
  node: NodeRow | null
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()

  const publish = useMutation({
    mutationFn: (originId: string) => publishEdgePolicy(originId),
    onSuccess: () => {
      // Publishing issues a command, so this node's position in the lane moved.
      void client.invalidateQueries({ queryKey: systemKeys.fleet() })
    },
  })

  const bootstrap = useMutation({
    mutationFn: (originId: string) => bootstrapOrigin(originId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: systemKeys.fleet() })
    },
  })

  const shown = node ? state(node) : null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          publish.reset()
          bootstrap.reset()
          onClose()
        }
      }}
      id={node?.origin_id}
      title={node?.label ?? node?.origin_id ?? "Node"}
    >
      {node === null ? (
        <p className="text-meta text-body">
          That node is not in the register any more.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {shown && (
            <div>
              <Pill tone={shown.tone}>{shown.text}</Pill>
            </div>
          )}

          {node.blocked && (
            <Banner tone="bad">
              Stopped at sequence {count(node.blocked.seq)}
              {node.blocked.since ? ` on ${day(node.blocked.since)}` : ""}:{" "}
              {node.blocked.reason ?? "no reason given"}
            </Banner>
          )}

          <Facts>
            <Fact term="Site">{node.site_id ?? "—"}</Fact>
            <Fact term="Role">{node.node_role ?? "—"}</Fact>
            <Fact term="Generation">{count(node.active_generation)}</Fact>
            <Fact term="Inventory">
              {node.inventory_enabled ? "Enabled" : "Off"}
            </Fact>
            <Fact term="Registered">{day(node.created_at)}</Fact>
            <Fact term="Key rotated">
              {node.rotated_at ? day(node.rotated_at) : "Never"}
            </Fact>
          </Facts>

          <NodeHealthSection originId={node.origin_id} health={node.health} />

          <Section title="Command lane">
            <MiniTable head={["Position", "Sequence"]}>
              <tr className="border-t border-hairline">
                <td className="py-2 pr-2 text-[0.875rem] text-ink">Issued</td>
                <td className="py-2 text-right tabular-nums">
                  {count(node.issued_seq)}
                </td>
              </tr>
              <tr className="border-t border-hairline">
                <td className="py-2 pr-2 text-[0.875rem] text-ink">
                  Acknowledged
                </td>
                <td className="py-2 text-right tabular-nums">
                  {count(node.acked_seq)}
                </td>
              </tr>
              <tr className="border-t border-hairline">
                <td className="py-2 pr-2 text-[0.875rem] text-ink">
                  Last acknowledgement
                </td>
                <td className="py-2 text-right tabular-nums">
                  {node.last_ack_age_seconds === null
                    ? "—"
                    : `${span(node.last_ack_age_seconds)} ago`}
                </td>
              </tr>
            </MiniTable>

            <TotalsLadder
              className="mt-3"
              rows={[
                {
                  label: "Applied without incident",
                  value: node.blocked ? "No" : "Yes",
                },
              ]}
              total={{ label: "Behind", value: count(node.pending) }}
            />
          </Section>

          <Section title="Access policy">
            <p className="mb-2.5 text-[0.875rem] text-body">
              Every grant, suspension and reader change publishes one already.
              Send it again when a node has been rebuilt and needs the whole
              picture back.
            </p>
            {publish.isError && (
              <Banner tone="bad">{saying(publish.error)}</Banner>
            )}
            <Button
              className="mt-2.5"
              pending={publish.isPending}
              onClick={() => publish.mutate(node.origin_id)}
            >
              {publish.isPending ? "Publishing…" : "Publish access policy"}
            </Button>
          </Section>

          <Section title="Initial data">
            <p className="mb-2.5 text-[0.875rem] text-body">
              What an enrolled node is sent on approval: the catalogue, every
              published price book, users, promotions and campaign switches.
              Send it again when a node has drifted or its first delivery
              reported a failure.
            </p>
            {bootstrap.isError && (
              <Banner tone="bad">{saying(bootstrap.error)}</Banner>
            )}
            {bootstrap.isSuccess && (
              <Banner tone="ok">Queued for {node.origin_id}.</Banner>
            )}
            <Button
              className="mt-2.5"
              pending={bootstrap.isPending}
              onClick={() => bootstrap.mutate(node.origin_id)}
            >
              {bootstrap.isPending ? "Sending…" : "Send initial data again"}
            </Button>
          </Section>
        </div>
      )}
    </Sheet>
  )
}

/// Registering a node, or rotating the key one already has.
///
/// The same endpoint does both, which is why nothing here says "new": posting
/// an origin id that already exists rebinds its key and leaves the rest alone.
/// Two secrets travel through this form and neither is ever read back — the
/// node's own ingest key, and the master key this node demands before it will
/// accept a registration at all.
interface NodeDraft {
  originId: string
  ingestKey: string
  masterKey: string
  label: string
  siteId: string
  nodeRole: string
  generation: string
  inventory: boolean
}

/// The two the server cannot infer. Everything else it will default.
function nodeReady(draft: NodeDraft): boolean {
  return draft.originId.trim() !== "" && draft.ingestKey !== ""
}

function RegisterSheet({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean
  onClose: () => void
  onRegistered: (originId: string) => void
}) {
  const client = useQueryClient()

  const register = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: NodeDraft) =>
      registerOrigin(
        {
          origin_id: draft.originId.trim(),
          ingest_key: draft.ingestKey,
          label: draft.label.trim() || undefined,
          site_id: draft.siteId.trim() || undefined,
          node_role: draft.nodeRole || undefined,
          active_generation: Number(draft.generation) || undefined,
          inventory_enabled: draft.inventory,
        },
        draft.masterKey
      ),
    onSuccess: (done) => {
      void client.invalidateQueries({ queryKey: systemKeys.origins() })
      void client.invalidateQueries({ queryKey: systemKeys.fleet() })
      onRegistered(done.origin_id)
      clear()
    },
  })

  const form = useForm({
    defaultValues: {
      originId: "",
      ingestKey: "",
      masterKey: "",
      label: "",
      siteId: "",
      nodeRole: "STORE",
      generation: "1",
      inventory: true,
    } as NodeDraft,
    onSubmit: ({ value }) => register.mutate(value),
  })

  /// Both secrets go with the rest of the draft: neither is ever read back, so
  /// leaving one in a closed sheet would be a key sitting in a form nobody is
  /// looking at.
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
      title="Register a node"
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
          <form.Subscribe selector={(state) => nodeReady(state.values)}>
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
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (nodeReady(form.state.values) && !register.isPending) {
            form.handleSubmit()
          }
        }}
      >
        <form.Field name="originId">
          {(field) => (
            <Field
              label="Node id"
              required
              hint="What the node signs its facts with. Posting one that already exists rotates its key instead of adding a node."
            >
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                autoComplete="off"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="ingestKey">
          {(field) => (
            <Field
              label="Ingest key"
              required
              hint="Sent once and never returned by any read. Configure the node with the same value."
            >
              <Secret
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="label">
          {(field) => (
            <Field label="Label" hint="What a person calls this node.">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <div className="grid grid-cols-2 gap-3.5">
          <form.Field name="siteId">
            {(field) => (
              <Field label="Site">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  autoComplete="off"
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="nodeRole">
            {(field) => (
              <Field label="Node role">
                <Select
                  value={field.state.value}
                  onChange={(next) => field.handleChange(next)}
                >
                  <option value="STORE">STORE</option>
                  <option value="DC">DC</option>
                </Select>
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="generation">
          {(field) => (
            <Field
              label="Active generation"
              hint="The epoch fence. A rebuilt node comes back on the next generation, and anything stamped with the old one is refused."
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

        <form.Field name="inventory">
          {(field) => (
            <Checkbox
              label="Accepts inventory snapshots"
              checked={field.state.value}
              onChange={(next) => field.handleChange(next)}
            />
          )}
        </form.Field>

        <form.Field name="masterKey">
          {(field) => (
            <Field
              label="Master sync key"
              hint="Only needed when this node was started with one. Held for this request and never stored."
            >
              <Secret
                value={field.state.value}
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
