import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { CardList } from "@/components/ui/card-list"
import { Field, Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { LeadCard } from "@/components/ui/lead-card"
import { Pill } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { node } from "@/lib/api"
import { describe } from "@/lib/errors"
import { count, moment } from "@/lib/format"

/// **Till approvals** — the tills at this node's counter waiting for a
/// supervisor to let them in.
///
/// Each pending till is a lead card: the machine's name over what it said about
/// itself, the join code as the one figure (it is what the supervisor matches
/// against the code on the till's own screen), and how long it has waited in the
/// foot, with one tint button — Review. The card opens a sheet with the facts and
/// the label to give the till, and the decision in its footer: Reject (danger)
/// at the left, Approve (primary) at the right, on every width.
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
/// sentence, in the sheet, rather than a client-side guess at the rule.
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

/// What the till calls itself, or what it runs on when it has no name.
const nameOf = (join: PendingJoin): string =>
  join.machine?.hostname ?? join.machine?.os ?? "New till"

export function TillApprovals() {
  const joins = useQuery({
    queryKey: pendingJoinsKey(),
    queryFn: ({ signal }) => fetchPendingJoins(signal),
    // A cashier is looking at the prompt on their own screen right now; this
    // list has to notice it without anybody pressing reload.
    refetchInterval: 10_000,
  })
  const [openId, setOpenId] = useState<string | null>(null)
  // Held apart from `openId` so the sheet can play its exit with its form still
  // in it, rather than emptying the moment it starts to close.
  const [showing, setShowing] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  if (joins.isPending) {
    return (
      <Screen>
        <LoadingState>Reading the waiting tills…</LoadingState>
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
  const open = rows.find((row) => row.join_id === openId)

  return (
    <Screen>
      {done !== null && (
        <Banner tone="ok" className="mb-4" onDismiss={() => setDone(null)}>
          {done}
        </Banner>
      )}

      {rows.length === 0 ? (
        <EmptyState>No tills waiting.</EmptyState>
      ) : (
        <>
          <KpiStrip>
            <Kpi label="Waiting" value={count(rows.length)} />
            <Kpi
              label="Oldest request"
              value={moment(
                rows.map((row) => row.issued_at).sort()[0] ?? null,
              )}
            />
          </KpiStrip>
          <CardList grid>
            {rows.map((row) => (
              <JoinCard
                key={row.join_id}
                join={row}
                onOpen={() => {
                  setDone(null)
                  setOpenId(row.join_id)
                  setShowing(true)
                }}
              />
            ))}
          </CardList>
        </>
      )}

      {open !== undefined && (
        <JoinSheet
          // A different till starts from an empty label.
          key={open.join_id}
          join={open}
          open={showing}
          onClose={() => setShowing(false)}
          onDone={(said) => {
            setShowing(false)
            setDone(said)
          }}
        />
      )}
    </Screen>
  )
}

/// One till waiting. The code it shows on its own screen is the figure; the card
/// opens the decision.
function JoinCard({ join, onOpen }: { join: PendingJoin; onOpen: () => void }) {
  const machine = join.machine
  return (
    <LeadCard
      onOpen={onOpen}
      title={nameOf(join)}
      lines={[
        [machine?.os, machine?.version].filter(Boolean).join(" · "),
        `Verification ${join.verification}`,
      ]}
      lead={{
        figure: <span className="font-mono">{join.code}</span>,
        caption: "join code",
      }}
      foot={{
        info: `Waiting since ${moment(join.issued_at)}`,
        action: { label: "Review", onClick: onOpen },
      }}
    />
  )
}

/// The decision, as a record sheet: who is asking, the label it will carry, and
/// Reject and Approve in the foot.
function JoinSheet({
  join,
  open,
  onClose,
  onDone,
}: {
  join: PendingJoin
  open: boolean
  onClose: () => void
  onDone: (said: string) => void
}) {
  const client = useQueryClient()
  const [label, setLabel] = useState("")

  const approve = useMutation({
    mutationFn: () =>
      node.post<ApprovedTill>(
        `/api/v1/devices/joins/${encodeURIComponent(join.join_id)}/approve`,
        { label: label.trim() === "" ? null : label.trim() },
      ),
    onSuccess: (till) => {
      void client.invalidateQueries({ queryKey: pendingJoinsKey() })
      onDone(
        `Joined as ${till.label}.${
          till.replaced_terminal_id !== null ? " Replaces the old till." : ""
        }`,
      )
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
      onDone("Till rejected.")
    },
  })

  const busy = approve.isPending || refuse.isPending
  const machine = join.machine

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={join.code}
      title={nameOf(join)}
      badge={<Pill tone="warn">Pending</Pill>}
      caption={`Waiting since ${moment(join.issued_at)}`}
      footer={
        <div className="flex flex-col gap-3">
          {(approve.isError || refuse.isError) && (
            <Banner tone="bad">
              {describe(approve.error ?? refuse.error)}
            </Banner>
          )}
          <div className="flex gap-2 md:justify-end max-md:[&>button]:flex-1">
            <Button
              variant="danger"
              disabled={busy}
              pending={refuse.isPending}
              onClick={() => refuse.mutate()}
            >
              {refuse.isPending ? "Rejecting…" : "Reject"}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              pending={approve.isPending}
              onClick={() => approve.mutate()}
            >
              {approve.isPending ? "Approving…" : "Approve"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <Facts>
          <Fact term="Verification">
            <span className="font-mono">{join.verification}</span>
          </Fact>
          <Fact term="Kind">{join.kind}</Fact>
          {machine?.os !== undefined && <Fact term="OS">{machine.os}</Fact>}
          {machine?.version !== undefined && (
            <Fact term="Version">{machine.version}</Fact>
          )}
          <Fact term="Expires">{moment(join.expires_at)}</Fact>
        </Facts>

        <Field label="Label" hint="Optional">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Till 2"
          />
        </Field>
      </div>
    </Sheet>
  )
}
