import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Screen } from "@/components/ui/screen"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { node } from "@/lib/api"
import { describe } from "@/lib/errors"
import { moment } from "@/lib/format"

/// **Till approvals** — the tills at this node's counter waiting for a
/// supervisor to let them in.
///
/// `PendingJoin` and `ApproveJoinRequest` are declared here rather than
/// imported: `backend/src/edge/devices.rs` marks neither `ts(export)`, so
/// there is no generated contract type to import, only the shape ts-rs would
/// produce if it did — the same way `pos-desktop/ui/src/api.ts` declares
/// them for the till's own screen.
///
/// This screen approves without a finger or a PIN. That is correct for who
/// is signed in here: `approve_join`'s own rule is that the node accepts a
/// signed-in session alone from an Admin, or from a supervisor approving a
/// shop's first till — which is this app's back office, not a second till
/// standing at the counter with nothing but its own trust to offer. A join
/// this session may not approve that way comes back as the node's own
/// sentence, on the row, rather than a client-side guess at the rule.
interface PendingJoin {
  readonly join_id: string
  readonly kind: string
  /// Display form, `7K4-P9Q`.
  readonly code: string
  readonly verification: string
  /// What the till said about itself. Shown, trusted for nothing.
  readonly machine?: {
    readonly hostname?: string
    readonly os?: string
    readonly arch?: string
    readonly version?: string
  } | null
  readonly issued_at: string
  readonly expires_at: string
}

interface ApprovedTill {
  readonly join_id: string
  readonly terminal_id: string
  readonly label: string
  readonly approved_by: string
  readonly approved_via: string
  readonly replaced_terminal_id: string | null
}

const pendingJoinsKey = () => ["devices", "pending-joins"] as const

function fetchPendingJoins(signal?: AbortSignal): Promise<PendingJoin[]> {
  return node
    .get<{ items: PendingJoin[] }>("/api/v1/devices/joins", { signal })
    .then((body) => body.items)
}

const columns: readonly ListColumn<PendingJoin>[] = [
  {
    id: "code",
    header: "Code",
    card: "title",
    cell: (row) => (
      <span className="text-ink font-mono font-medium">{row.code}</span>
    ),
  },
  {
    id: "machine",
    header: "Machine",
    cell: (row) =>
      row.machine?.hostname ??
      (row.machine?.os !== undefined ? row.machine.os : "—"),
  },
  {
    id: "issued",
    header: "Waiting since",
    card: "meta",
    cell: (row) => moment(row.issued_at),
  },
  {
    id: "expires",
    header: "Expires",
    card: "hide",
    className: "max-lg:hidden",
    cell: (row) => moment(row.expires_at),
  },
]

export function TillApprovals() {
  const joins = useQuery({
    queryKey: pendingJoinsKey(),
    queryFn: ({ signal }) => fetchPendingJoins(signal),
    // A cashier is looking at the prompt on their own screen right now; this
    // list has to notice it without anybody pressing reload.
    refetchInterval: 10_000,
  })

  if (joins.isPending) {
    return (
      <Screen>
        <LoadingState>Reading tills waiting to join…</LoadingState>
      </Screen>
    )
  }

  if (joins.isError) {
    return (
      <Screen>
        <Banner tone="bad">{describe(joins.error)}</Banner>
      </Screen>
    )
  }

  const rows = joins.data ?? []

  return (
    <Screen sub="Tills at the counter waiting for a supervisor to let them in.">
      <Card>
        <ListTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.join_id}
          detail={(row) => <JoinDetail join={row} />}
          empty="Nothing waiting. A new till shows its code here the moment it asks to join."
        />
      </Card>
    </Screen>
  )
}

function JoinDetail({ join }: { join: PendingJoin }) {
  const client = useQueryClient()
  const [label, setLabel] = useState("")

  const approve = useMutation({
    mutationFn: () =>
      node.post<ApprovedTill>(
        `/api/v1/devices/joins/${encodeURIComponent(join.join_id)}/approve`,
        { label: label.trim() === "" ? null : label.trim() },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: pendingJoinsKey() })
    },
  })

  const refuse = useMutation({
    mutationFn: () =>
      node.post<unknown>(
        `/api/v1/devices/joins/${encodeURIComponent(join.join_id)}/refuse`,
        {},
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: pendingJoinsKey() })
    },
  })

  return (
    <div className="flex flex-col gap-3">
      <dl className="text-meta grid grid-cols-2 gap-2">
        <div>
          <dt className="text-mute">Verification</dt>
          <dd className="text-ink font-mono">{join.verification}</dd>
        </div>
        <div>
          <dt className="text-mute">Kind</dt>
          <dd className="text-ink">{join.kind}</dd>
        </div>
        {join.machine?.os !== undefined && (
          <div>
            <dt className="text-mute">OS</dt>
            <dd className="text-ink">{join.machine.os}</dd>
          </div>
        )}
        {join.machine?.version !== undefined && (
          <div>
            <dt className="text-mute">Version</dt>
            <dd className="text-ink">{join.machine.version}</dd>
          </div>
        )}
      </dl>

      {approve.isSuccess && approve.data && (
        <Banner tone="ok">
          Joined as {approve.data.label}.
          {approve.data.replaced_terminal_id !== null &&
            " It takes over the till it replaced."}
        </Banner>
      )}
      {(approve.isError || refuse.isError) && (
        <Banner tone="bad">{describe(approve.error ?? refuse.error)}</Banner>
      )}

      <Field label="Label" hint="Leave blank for the next free “Kasir N”.">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Kasir 2"
        />
      </Field>

      <div className="flex gap-2.5">
        <Button
          variant="primary"
          disabled={approve.isPending || refuse.isPending}
          onClick={() => approve.mutate()}
        >
          Let it in
        </Button>
        <Button
          variant="ghost"
          disabled={approve.isPending || refuse.isPending}
          onClick={() => refuse.mutate()}
        >
          Refuse
        </Button>
      </div>
    </div>
  )
}
