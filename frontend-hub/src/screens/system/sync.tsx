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
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Textarea } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { PickMany } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadMore } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count, moment } from "@/lib/format"
import {
  commandReach,
  issueCommand,
  deadLettersPage,
  listOrigins,
  reconciliation,
  resetBreaker,
  revokeCommand,
  systemKeys,
  type PoolDiscrepancy,
} from "@/lib/queries/system"
import { queryState } from "@/lib/query-state"
import { useIdentity } from "@/lib/session"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Secret, Section } from "@/screens/system/shared"
import { saying } from "@/screens/system/units"

/// The sync lane, from three angles.
///
/// Upward: facts the centre refused and kept rather than dropped. Downward:
/// commands it issued and where they got to. Sideways: the one place where its
/// own arithmetic and a node's own claim about the same pool disagree. They are
/// three different datasets about one mechanism, which is what `<SubTabs>` is
/// for — a segment would say they were slices of one list, and they are not.
///
/// Which tab is open is deliberately NOT in the URL. The root route validates
/// search against `lib/sheets.ts` and drops anything it does not know, so a
/// `?tab=` would be silently discarded on the first navigation; a shared key
/// would have to be declared centrally first.

type Tab = "reconciliation" | "dead-letters" | "commands"

const tabs = [
  { value: "reconciliation", label: "Reconciliation" },
  { value: "dead-letters", label: "Dead letters" },
  { value: "commands", label: "Commands" },
] as const

const discrepancyColumns: ColumnDef<TableSetup, PoolDiscrepancy>[] = [
  {
    accessorKey: "origin_id",
    header: "Server",
    size: 150,
    // One node disagreeing about forty pools and forty nodes disagreeing about
    // one pool are two different faults, and in a list sorted by the gap they
    // look identical. The clause is what tells them apart.
    meta: { filter: { kind: "option", label: "Server" } },
  },
  {
    accessorKey: "site_id",
    header: "Site",
    size: 120,
    meta: { filter: { kind: "option", label: "Site" } },
  },
  {
    accessorKey: "pool_id",
    header: "Pool",
    size: 150,
    // A fleet out of step on one pool is a different investigation from one
    // out of step on everything it holds.
    meta: { filter: { kind: "option", label: "Pool" } },
    cell: ({ row }) => <Tag>{row.original.pool_id}</Tag>,
  },
  {
    accessorKey: "computed_on_hand",
    header: "Centre Says",
    size: 120,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.computed_on_hand),
  },
  {
    accessorKey: "observed_on_hand",
    header: "Server Says",
    size: 120,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.observed_on_hand),
  },
  {
    id: "gap",
    accessorFn: (row) => Math.abs(row.difference),
    header: "Gap",
    size: 100,
    // Filtered on the magnitude, exactly as it is sorted: "more than ten out"
    // is the threshold somebody sets once the list is long enough that a gap
    // of one is noise. Asking it unsigned is what stops a clause quietly
    // answering for only the half of the fault that reads as a shortage.
    meta: {
      align: "right",
      filter: { kind: "number", label: "Gap", unit: "pcs" },
    },
    // The decision metric. Sorted on its magnitude rather than its sign,
    // because a node claiming 40 too few is exactly as wrong as one claiming
    // 40 too many.
    cell: ({ row }) => (
      <span className="font-medium text-bad-fg">
        {count(row.original.difference)}
      </span>
    ),
  },
  {
    accessorKey: "allotted_difference",
    header: "Allotted Gap",
    size: 120,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.allotted_difference),
  },
  {
    accessorKey: "snapshot_seq",
    header: "Checkpoint",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.snapshot_seq),
  },
]

export function SyncLane({
  /// Rendered as the "Sync" tab of "Store servers"
  /// (`screens/system/servers.tsx`) rather than as its own page.
  embedded = false,
}: { embedded?: boolean } = {}) {
  const client = useQueryClient()
  const [tab, setTab] = useState<Tab>("reconciliation")
  const [issuing, setIssuing] = useState(false)
  // A lookup box, not a record sheet: this is what somebody typed, and it is
  // the input to a query rather than the identity of an open panel.
  const [traced, setTraced] = useState("")
  const [breakerSaid, setBreakerSaid] = useState<string | null>(null)

  const breaker = useMutation({
    mutationFn: () => resetBreaker(),
    onSuccess: () => {
      setBreakerSaid(
        "The breaker is closed and the sender was woken. If the cause is still there it will open again."
      )
      // Closing the breaker changes what the lane is doing, so every read about
      // the lane is now suspect — the whole module prefix, and it is meant.
      void client.invalidateQueries({ queryKey: systemKeys.all })
    },
  })

  const actions = (
    <>
      <Button pending={breaker.isPending} onClick={() => breaker.mutate()}>
        {breaker.isPending ? "Resetting…" : "Reset breaker"}
      </Button>
      <Button variant="primary" onClick={() => setIssuing(true)}>
        Issue command
      </Button>
    </>
  )

  const body = (
    <>
      {embedded && (
        <div className="mb-3 flex flex-wrap items-center gap-2">{actions}</div>
      )}

      {breakerSaid && (
        <Banner
          tone="info"
          className="mb-3"
          onDismiss={() => setBreakerSaid(null)}
        >
          {breakerSaid}
        </Banner>
      )}
      {breaker.isError && (
        <Banner tone="bad" className="mb-3">
          {saying(breaker.error)}
        </Banner>
      )}

      <SubTabs
        tabs={tabs}
        value={tab}
        onChange={(next) => setTab(next as Tab)}
      />

      {tab === "reconciliation" && <ReconciliationTab />}
      {tab === "dead-letters" && <DeadLettersTab />}
      {tab === "commands" && (
        // Keyed on what is being traced so issuing a command while this tab is
        // already open reloads the box and the recall form with it.
        <CommandsTab key={traced} traced={traced} onTrace={setTraced} />
      )}

      <IssueSheet
        open={issuing}
        onClose={() => setIssuing(false)}
        onIssued={(commandId) => {
          setIssuing(false)
          setTab("commands")
          setTraced(commandId)
        }}
      />
    </>
  )

  if (embedded) return body

  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Sync"
        sub="What the centre refused, what it issued, and where the two sides disagree."
        actions={actions}
      />
      {body}
    </PageContent>
  )
}

/// Where the centre's arithmetic and a node's own claim disagree.
///
/// An empty list is the ordinary state and the one worth watching for: it means
/// every node the centre has caught up with agrees with the position derived
/// from that node's own facts.
function ReconciliationTab() {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "gap", desc: true },
  ])

  const report = useQuery({
    queryKey: systemKeys.reconciliation(),
    queryFn: ({ signal }) => reconciliation(signal),
  })

  const rows = useMemo(() => report.data?.discrepancies ?? [], [report.data])

  const filters = useFilters(discrepancyColumns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as PoolDiscrepancy[],
        columns: filters.columns,
        getRowId: (row: PoolDiscrepancy) =>
          `${row.origin_id}/${row.site_id}/${row.pool_id}`,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  return (
    <>
      {/* Inside the tab rather than beside the tab strip: the other two tabs
          are a disclosure list and a lookup box, and a filter control standing
          over all three would be a control that does nothing on two of them. */}
      <Toolbar>
        <FilterPanel model={filters} table={table} />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(report, {
          loading: "Reconciling…",
          render: (data) =>
            data.reconciled ? (
              <EmptyState>
                Every node the centre has caught up with agrees with the
                position derived from its own facts.
              </EmptyState>
            ) : (
              <DataTable<PoolDiscrepancy>
                table={table}
                className="max-h-[calc(100dvh-18rem)]"
              />
            ),
        })}
      </Card>
    </>
  )
}

/// Facts the centre refused, kept rather than dropped.
///
/// Written as a disclosure list rather than a table on purpose. The row is a
/// comparison — which node, which stream, why — but the payload underneath is
/// an arbitrary fact body, and a fact body does not fit in a 38px cell. Native
/// `<details>` means the expansion carries no state at all: nothing to hold,
/// nothing to restore, and it prints and finds-in-page like the rest of the
/// document.
function DeadLettersTab() {
  const letters = useInfiniteQuery({
    queryKey: systemKeys.deadLetters(),
    queryFn: ({ pageParam, signal }) => deadLettersPage(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const total = letters.data?.pages[0]?.total ?? 0

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Refused facts</CardTitle>
        {/* The server's own count of the whole backlog, not the length of
            the page — which was the same number only while the backlog was
            smaller than the request. */}
        {total > 0 && (
          <span className="text-[0.875rem] text-mute tabular-nums">
            {count(total)}
          </span>
        )}
      </CardHeader>
      {queryState(letters, {
        loading: "Loading what was refused…",
        render: (data) =>
          data.pages[0].rows.length === 0 ? (
            <EmptyState>
              Nothing has been refused. Every fact a node has sent was accepted
              into the ledger.
            </EmptyState>
          ) : (
            <div className="border-t border-hairline">
              {data.pages
                .flatMap((page) => page.rows)
                .map((letter) => (
                  <details
                    key={letter.event_id}
                    className="border-b border-hairline last:border-b-0"
                  >
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-2.5 transition-colors hover:bg-soft">
                      <Tag>{letter.origin_id}</Tag>
                      <span className="text-[0.875rem] font-medium text-ink">
                        {letter.event_type}
                      </span>
                      <span className="font-mono text-id text-mute">
                        gen {count(letter.generation)} · seq {count(letter.seq)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[0.875rem] text-bad-fg">
                        {letter.reason}
                      </span>
                      <span className="shrink-0 text-[0.875rem] text-mute tabular-nums">
                        {moment(letter.rejected_at)}
                      </span>
                    </summary>
                    <pre className="mx-4 mb-3 max-h-64 overflow-auto rounded-inner bg-soft p-2.5 font-mono text-[0.875rem] leading-relaxed text-body">
                      {JSON.stringify(letter.payload, null, 2)}
                    </pre>
                  </details>
                ))}
              {/* The page scrolls, not this card — see `<LoadMore>`. */}
              <LoadMore query={letters} />
            </div>
          ),
      })}
    </Card>
  )
}

/// Where one command has reached.
///
/// There is no endpoint that lists commands — only `GET /sync/commands/{id}` —
/// so this is a lookup rather than a list, and it says so instead of showing an
/// empty table that will never fill. Issuing one from this screen drops its id
/// straight into the box.
function CommandsTab({
  traced,
  onTrace,
}: {
  traced: string
  onTrace: (id: string) => void
}) {
  const [typed, setTyped] = useState(traced)
  const [reason, setReason] = useState("")
  const [masterKey, setMasterKey] = useState("")
  const client = useQueryClient()

  const reach = useQuery({
    queryKey: systemKeys.command(traced),
    queryFn: ({ signal }) => commandReach(traced, signal),
    enabled: traced !== "",
  })

  const revoke = useMutation({
    mutationFn: () => revokeCommand(traced, reason.trim(), masterKey),
    onSuccess: () => {
      setReason("")
      setMasterKey("")
      void client.invalidateQueries({ queryKey: systemKeys.command(traced) })
      void client.invalidateQueries({ queryKey: systemKeys.fleet() })
    },
  })

  return (
    <div className="flex flex-col gap-[1.125rem]">
      <Card className="p-4">
        <form
          className="flex flex-wrap items-end gap-2.5"
          onSubmit={(event) => {
            event.preventDefault()
            onTrace(typed.trim())
          }}
        >
          <Field
            label="Trace a command"
            hint="Paste the id from a publish receipt or an issue receipt."
            className="min-w-64 flex-1"
          >
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="font-mono"
              autoComplete="off"
            />
          </Field>
          <Button
            className="mb-[0.1875rem]"
            onClick={() => onTrace(typed.trim())}
          >
            Trace
          </Button>
        </form>
      </Card>

      {traced === "" ? (
        <Card className="overflow-hidden">
          <EmptyState>
            The centre does not keep a browsable list of commands, only their
            reach. Paste an id above to see which nodes have settled it.
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-4">
          {queryState(reach, {
            loading: "Following the command…",
            render: (command) => (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill
                    tone={
                      command.revoked_at
                        ? "bad"
                        : command.converged
                          ? "ok"
                          : "info"
                    }
                  >
                    {command.revoked_at
                      ? "Recalled"
                      : command.converged
                        ? "Everywhere"
                        : "In flight"}
                  </Pill>
                  <Tag>{command.command_type}</Tag>
                  <span className="font-mono text-id text-mute">
                    {command.command_id}
                  </span>
                </div>

                {command.revoked_at && (
                  <Banner tone="warn">
                    Recalled on {moment(command.revoked_at)}:{" "}
                    {command.revoked_reason ?? "no reason given"}. Nodes that
                    had already applied it are unaffected — a recall is not an
                    undo.
                  </Banner>
                )}

                <Section title="Issued">
                  <MiniTable head={["Fact", "Value"]}>
                    <tr className="border-t border-hairline">
                      <td className="py-2 pr-2 text-[0.875rem] text-ink">By</td>
                      <td className="py-2 text-right">{command.issued_by}</td>
                    </tr>
                    <tr className="border-t border-hairline">
                      <td className="py-2 pr-2 text-[0.875rem] text-ink">At</td>
                      <td className="py-2 text-right tabular-nums">
                        {moment(command.issued_at)}
                      </td>
                    </tr>
                    <tr className="border-t border-hairline">
                      <td className="py-2 pr-2 text-[0.875rem] text-ink">
                        Expires
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {command.expires_at
                          ? moment(command.expires_at)
                          : "Never"}
                      </td>
                    </tr>
                  </MiniTable>
                </Section>

                {command.pending.length > 0 && (
                  <Section title="Still owed">
                    <MiniTable head={["Server", "Acked", "Wanted", "Blocked"]}>
                      {command.pending.map((target) => (
                        <tr
                          key={target.origin_id}
                          className="border-t border-hairline"
                        >
                          <td className="py-2 pr-2 text-[0.875rem] text-ink">
                            {target.origin_id}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {count(target.acked_seq)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {count(target.seq)}
                          </td>
                          <td className="py-2 text-right text-[0.875rem] text-bad-fg">
                            {target.blocked_reason ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </MiniTable>
                  </Section>
                )}

                <TotalsLadder
                  rows={[
                    { label: "Settled", value: count(command.settled_count) },
                    {
                      label: "Still owed",
                      value: count(command.pending_count),
                    },
                  ]}
                  total={{
                    label: "Reached everywhere",
                    value: command.converged ? "Yes" : "Not yet",
                  }}
                />

                {!command.revoked_at && (
                  <Section title="Recall">
                    <p className="mb-2.5 text-[0.875rem] text-body">
                      Nodes that have not applied it yet will skip it. Nodes
                      that already applied it keep what it did.
                    </p>
                    <div className="flex flex-col gap-2.5">
                      <Field label="Reason" required hint="Kept on the record.">
                        <Input
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      </Field>
                      <Field
                        label="Master sync key"
                        hint="Only needed when this store server was started with one."
                      >
                        <Secret
                          value={masterKey}
                          onChange={(event) => setMasterKey(event.target.value)}
                        />
                      </Field>
                      {revoke.isError && (
                        <Banner tone="bad">{saying(revoke.error)}</Banner>
                      )}
                      <div>
                        <Button
                          variant="danger"
                          pending={revoke.isPending}
                          disabled={reason.trim() === ""}
                          onClick={() => revoke.mutate()}
                        >
                          {revoke.isPending ? "Recalling…" : "Recall command"}
                        </Button>
                      </div>
                    </div>
                  </Section>
                )}
              </div>
            ),
          })}
        </Card>
      )}
    </div>
  )
}

/// Issuing a command to named nodes, or to the whole registered fleet.
///
/// The payload is parsed here rather than posted as typed: a malformed
/// broadcast refused at the issuing desk is one node's problem, and the same
/// broadcast accepted is thirty shops'. `issued_by` is the signed-in username
/// and is not editable — a decision attributed to whoever typed the nicest name
/// is not an audit trail.
interface CommandDraft {
  commandType: string
  payload: string
  targets: string[]
  masterKey: string
}

/// The payload as JSON, or the parser's own sentence about why it is not.
function parsePayload(text: string): {
  value: unknown
  problem: string | null
} {
  try {
    return { value: JSON.parse(text) as unknown, problem: null }
  } catch (error) {
    return {
      value: null,
      problem: error instanceof Error ? error.message : "Not valid JSON.",
    }
  }
}

function commandReady(draft: CommandDraft): boolean {
  return (
    draft.commandType.trim() !== "" &&
    parsePayload(draft.payload).problem === null
  )
}

function IssueSheet({
  open,
  onClose,
  onIssued,
}: {
  open: boolean
  onClose: () => void
  onIssued: (commandId: string) => void
}) {
  const client = useQueryClient()
  const identity = useIdentity()

  const origins = useQuery({
    queryKey: systemKeys.origins(),
    queryFn: ({ signal }) => listOrigins(signal),
    enabled: open,
  })

  const issue = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: CommandDraft) =>
      issueCommand(
        {
          command_type: draft.commandType.trim(),
          payload: parsePayload(draft.payload).value,
          issued_by: identity.data?.username ?? "",
          targets: draft.targets,
        },
        draft.masterKey
      ),
    onSuccess: (issued) => {
      void client.invalidateQueries({ queryKey: systemKeys.fleet() })
      onIssued(issued.command_id)
      clear()
    },
  })

  const form = useForm({
    defaultValues: {
      commandType: "",
      payload: "{}",
      targets: [],
      masterKey: "",
    } as CommandDraft,
    onSubmit: ({ value }) => issue.mutate(value),
  })

  /// The master key goes with the rest of the draft: it is held for one request
  /// and never stored, so a closed sheet still holding one is a key nobody is
  /// watching.
  function clear() {
    form.reset()
    issue.reset()
  }

  const ready = (draft: CommandDraft) =>
    commandReady(draft) && (identity.data?.username ?? "") !== ""

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          clear()
          onClose()
        }
      }}
      title="Issue a command"
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
          {/* Disabled while in flight rather than keyed for idempotency: the
              cloud node's dedupe table covers the inventory command paths and
              not this one, so an `Idempotency-Key` here would promise a
              guarantee the server does not make. */}
          <form.Subscribe selector={(state) => ready(state.values)}>
            {(can) => (
              <Button
                pending={issue.isPending}
                disabled={!can}
                onClick={() => form.handleSubmit()}
              >
                {issue.isPending ? "Submitting…" : "Submit"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      }
    >
      <form
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress — and a broadcast is
        // the last thing that should go out on a stray return.
        onSubmit={(event) => {
          event.preventDefault()
          if (ready(form.state.values) && !issue.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5"
      >
        <form.Field name="commandType">
          {(field) => (
            <Field
              label="Command type"
              required
              hint="As the store server's handlers name it."
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

        <form.Field name="payload">
          {(field) => (
            <Field
              label="Payload"
              required
              hint="JSON. Checked here before it is sent, because a malformed broadcast blocks every store server it reaches."
              problem={parsePayload(field.state.value).problem}
            >
              <Textarea
                rows={7}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                className="font-mono text-[0.875rem]"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="targets">
          {(field) => (
            <Field
              label="Targets"
              hint="Pick none to send it to the whole registered fleet."
            >
              {/* Several out of a list, so `<PickMany>` rather than the
                  ctrl-click multi-select this used to be — a control almost
                  nobody knows how to add a second node to, and one that gave
                  no reading at all of which three were picked without
                  scrolling the box. */}
              <PickMany
                label="Targets"
                choices={(origins.data ?? []).map((origin) => ({
                  value: origin.origin_id,
                  label: origin.label ?? origin.origin_id,
                }))}
                values={field.state.value}
                onChange={(picked) => field.handleChange([...picked])}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="masterKey">
          {(field) => (
            <Field
              label="Master sync key"
              hint="Only needed when this store server was started with one. Held for this request and never stored."
            >
              <Secret
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <p className="text-[0.875rem] text-mute">
          Issued as {identity.data?.display_name ?? "—"}. The centre records the
          signed-in name, not one typed into a box.
        </p>

        {issue.isError && <Banner tone="bad">{saying(issue.error)}</Banner>}
      </form>
    </Sheet>
  )
}
