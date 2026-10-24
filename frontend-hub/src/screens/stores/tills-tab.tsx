import { Collapsible } from "@base-ui/react/collapsible"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronRight } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Status } from "@/components/ui/pill"
import { RefreshStrip } from "@/components/ui/refresh-stamp"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { EMPTY, ago, moment, time } from "@/lib/format"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import {
  resumeCashier,
  stopCashier,
  storePos,
  storesKeys,
  type PosStopNote,
  type StorePos,
  type StorePosCashier,
  type StorePosTill,
  type StoreSummary,
} from "@/lib/queries/stores"
import {
  setDeviceStatus,
  systemKeys,
  type DeviceStatus,
} from "@/lib/queries/system"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { Section } from "@/screens/stores/shared"
import { StopDialog } from "@/screens/stores/stop-dialog"
import { saying } from "@/screens/system/units"

/// A till is "online" when its node heard from it inside ten minutes — the
/// same window the store's own figure (`StoreTills.online`) counts.
const ONLINE_MS = 10 * 60_000

/// What head office is asked, one question at a time.
type Asking =
  | { readonly kind: "stop-till"; readonly till: StorePosTill }
  | { readonly kind: "remove-till"; readonly till: StorePosTill }
  | { readonly kind: "stop-person"; readonly cashier: StorePosCashier }

/// The store's tills and the people who sign in at them — the page's Tills tab.
///
/// Head office stops a till (one PC), stops one person at every store, and
/// removes a till for good. Stopping or removing the whole store is on the
/// page's head (`StoreStopActions`); once the store is stopped or removed the
/// rows here only read, because the store's own state already says it all.
/// What the node carries out arrives on its next sync, so a row whose ask is
/// still on its way says "Stopping…", "Resuming…" or "Removing…".
export function TillsTab({ store }: { store: StoreSummary }) {
  const unit = store.unit_id
  const pos = useQuery({
    queryKey: storesKeys.pos(unit),
    queryFn: ({ signal }) => storePos(unit, signal),
  })

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <RefreshStrip queries={[pos]} />
      {queryState(pos, {
        loading: "Reading the POS…",
        render: (data) => <TillsPage store={store} pos={data} />,
      })}
    </div>
  )
}

function TillsPage({ store, pos }: { store: StoreSummary; pos: StorePos }) {
  const client = useQueryClient()
  const unit = store.unit_id
  const nameOf = useNameOfLogin()
  // The question and whether it is open are kept apart, so its words stay
  // while it fades out. A new `asked` is a fresh dialog with a clean write.
  const [asking, setAsking] = useState<Asking | null>(null)
  const [open, setOpen] = useState(false)
  const [asked, setAsked] = useState(0)
  const ask = (next: Asking) => {
    setAsking(next)
    setAsked((count) => count + 1)
    setOpen(true)
  }

  const stopped = store.status === "STOPPED"
  const removed = store.status === "CLOSED"
  // Nothing is switched from here once the store itself is stopped or removed.
  const locked = stopped || removed
  const canManage = pos.can_manage && !locked

  const refresh = () => {
    void client.invalidateQueries({ queryKey: storesKeys.pos(unit) })
    void client.invalidateQueries({ queryKey: systemKeys.devices() })
  }
  const resumeTill = useMutation({
    mutationFn: (till: StorePosTill) =>
      setDeviceStatus(till.device_id, { status: "ACTIVE" }),
    onSuccess: refresh,
  })
  const resumePerson = useMutation({
    mutationFn: (cashier: StorePosCashier) =>
      resumeCashier(unit, cashier.user_id),
    onSuccess: (answer) => client.setQueryData(storesKeys.pos(unit), answer),
  })

  const live = pos.tills.filter((till) => till.status !== "REVOKED")
  const gone = pos.tills.filter((till) => till.status === "REVOKED")
  const now = Date.now()
  const online = live.filter(
    (till) =>
      till.status === "ACTIVE" &&
      till.last_seen_at !== null &&
      now - Date.parse(till.last_seen_at) < ONLINE_MS
  ).length
  const tillsStopped = stopped
    ? live.length
    : live.filter((till) => till.status === "SUSPENDED").length
  const peopleStopped = pos.cashiers.filter(
    (cashier) => cashier.stop !== null
  ).length

  const head = [
    { label: "POS", align: "left" },
    { label: "Machine", align: "left" },
    { label: "Last seen", align: "left" },
    { label: "Shift", align: "left" },
    { label: "Status", align: "left" },
    { label: "", align: "right" },
  ] as const

  const tillRow = (till: StorePosTill) => (
    <TillRow
      key={till.device_id}
      till={till}
      storeStopped={stopped}
      canManage={canManage}
      nameOf={nameOf}
      resuming={
        resumeTill.isPending &&
        resumeTill.variables?.device_id === till.device_id
      }
      onStop={() => ask({ kind: "stop-till", till })}
      onRemove={() => ask({ kind: "remove-till", till })}
      onResume={() => resumeTill.mutate(till)}
    />
  )

  return (
    <>
      <KpiStrip className="mb-0 md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="POS" value={String(live.length)} />
        <Kpi label="Online" value={String(online)} />
        <Kpi label="POS stopped" value={redWhenAny(tillsStopped)} />
        <Kpi label="Cashiers stopped" value={redWhenAny(peopleStopped)} />
      </KpiStrip>

      {resumeTill.isError && (
        <Banner tone="bad">{saying(resumeTill.error)}</Banner>
      )}
      {resumePerson.isError && (
        <Banner tone="bad">{saying(resumePerson.error)}</Banner>
      )}

      <div className="flex flex-col gap-3">
        <Section title="POS">
          <Card className="overflow-clip px-4 pt-3.5 pb-1">
            {live.length === 0 ? (
              <EmptyState>No POS at this store</EmptyState>
            ) : (
              <MiniTable head={head}>{live.map(tillRow)}</MiniTable>
            )}
          </Card>
        </Section>

        {gone.length > 0 && (
          <Collapsible.Root>
            <Collapsible.Trigger className="group flex min-h-tap items-center gap-1.5 text-left text-[0.9375rem] text-mute transition-colors hover:text-ink md:min-h-0">
              <ChevronRight className="size-3.5 text-line-ico transition-transform duration-150 group-data-[panel-open]:rotate-90" />
              Removed · {gone.length}
            </Collapsible.Trigger>
            <Collapsible.Panel className="fold-panel">
              <Card className="mt-3 overflow-clip px-4 pt-3.5 pb-1">
                <MiniTable head={head}>{gone.map(tillRow)}</MiniTable>
              </Card>
            </Collapsible.Panel>
          </Collapsible.Root>
        )}
      </div>

      {!removed && (
        <Section title="Cashiers">
          <Card className="overflow-clip px-4 pt-3.5 pb-1">
            {pos.cashiers.length === 0 ? (
              <EmptyState>No cashier signs in at this store</EmptyState>
            ) : (
              <MiniTable
                head={[
                  { label: "Name", align: "left" },
                  { label: "Role", align: "left" },
                  { label: "Last shift", align: "left" },
                  { label: "POS", align: "left" },
                  { label: "", align: "right" },
                ]}
              >
                {pos.cashiers.map((cashier) => (
                  <CashierRow
                    key={cashier.user_id}
                    cashier={cashier}
                    canManage={canManage}
                    nameOf={nameOf}
                    resuming={
                      resumePerson.isPending &&
                      resumePerson.variables?.user_id === cashier.user_id
                    }
                    onStop={() => ask({ kind: "stop-person", cashier })}
                    onResume={() => resumePerson.mutate(cashier)}
                  />
                ))}
              </MiniTable>
            )}
          </Card>
        </Section>
      )}

      {asking !== null && (
        <AskDialog
          key={asked}
          asking={asking}
          pos={pos}
          unit={unit}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  )
}

/// A figure that is a problem is red; nothing stopped is just a nought.
function redWhenAny(figure: number): React.ReactNode {
  return figure > 0 ? (
    <span className="text-bad-fg">{figure}</span>
  ) : (
    String(figure)
  )
}

/// `Kasir 3`, as the node names it, is `Till 3` in the hub.
function tillName(till: StorePosTill): string {
  return till.label.replace(/^Kasir\b/i, "POS")
}

/// The line under a status: why, by whom and when, in grey.
function noteOf(
  note: PosStopNote | null,
  nameOf: (username: string) => string
): string | null {
  if (note === null) return null
  const who = note.by === "" ? null : nameOf(note.by)
  const by = who === null ? moment(note.at) : `${who}, ${moment(note.at)}`
  return note.reason === "" ? by : `${note.reason} · ${by}`
}

/// A till's ask that has not reached its node yet, as a word.
const ASKED: Record<string, string> = {
  SUSPENDED: "Stopping…",
  ACTIVE: "Resuming…",
  REVOKED: "Removing…",
}

function TillRow({
  till,
  storeStopped,
  canManage,
  nameOf,
  resuming,
  onStop,
  onRemove,
  onResume,
}: {
  till: StorePosTill
  storeStopped: boolean
  canManage: boolean
  nameOf: (username: string) => string
  resuming: boolean
  onStop: () => void
  onRemove: () => void
  onResume: () => void
}) {
  const asked =
    till.requested_status !== null && till.requested_status !== till.status
      ? ASKED[till.requested_status]
      : undefined
  const gone = till.status === "REVOKED"
  // A store that is stopped stops every till that was selling; the till's own
  // word stays under it for the ones head office had stopped before.
  const byStore = storeStopped && till.status === "ACTIVE" && !asked

  let status: React.ReactNode
  let note: string | null = null
  if (asked !== undefined) {
    status = <Status tone="warn">{asked}</Status>
    note =
      till.requested_status === "ACTIVE" ? null : noteOf(till.stop, nameOf)
  } else if (byStore) {
    status = <Status tone="bad">Stopped</Status>
    note = "Store stopped"
  } else if (till.status === "ACTIVE") {
    status = <Status tone="ok">Active</Status>
  } else if (till.status === "SUSPENDED") {
    status = <Status tone="bad">Stopped</Status>
    note = noteOf(till.stop, nameOf)
  } else {
    status = (
      <Status tone="neutral" className="text-mute">
        Removed
      </Status>
    )
    note = noteOf(till.stop, nameOf)
  }

  const act = canManage && till.switchable && asked === undefined && !gone
  const grey = gone ? "text-mute" : undefined

  return (
    <MiniRow>
      <MiniCell className={cn("font-medium", gone ? "text-mute" : "text-ink")}>
        {tillName(till)}
      </MiniCell>
      <MiniCell className={grey}>{till.machine ?? EMPTY}</MiniCell>
      <MiniCell className={grey}>
        {till.last_seen_at === null ? EMPTY : ago(till.last_seen_at)}
      </MiniCell>
      <MiniCell className={grey}>
        {till.open_shift === null
          ? EMPTY
          : `${till.open_shift.name} · ${time(till.open_shift.opened_at)}`}
      </MiniCell>
      <MiniCell>
        {status}
        {note !== null && <span className="block text-mute">{note}</span>}
      </MiniCell>
      <MiniCell align="right" className="whitespace-nowrap">
        {act && till.status === "ACTIVE" && (
          <Button variant="destructive" size="sm" onClick={onStop}>
            Stop
          </Button>
        )}
        {act && till.status === "SUSPENDED" && (
          <span className="inline-flex gap-1.5">
            <Button variant="destructive" size="sm" onClick={onRemove}>
              Remove
            </Button>
            <Button
              variant="primary"
              size="sm"
              pending={resuming}
              onClick={onResume}
            >
              {resuming ? "Resuming…" : "Resume"}
            </Button>
          </span>
        )}
      </MiniCell>
    </MiniRow>
  )
}

function CashierRow({
  cashier,
  canManage,
  nameOf,
  resuming,
  onStop,
  onResume,
}: {
  cashier: StorePosCashier
  canManage: boolean
  nameOf: (username: string) => string
  resuming: boolean
  onStop: () => void
  onResume: () => void
}) {
  const note = noteOf(cashier.stop, nameOf)
  return (
    <MiniRow>
      <MiniCell className="font-medium text-ink">{cashier.name}</MiniCell>
      <MiniCell>{cashier.role}</MiniCell>
      <MiniCell>
        {cashier.last_shift_at === null ? EMPTY : moment(cashier.last_shift_at)}
      </MiniCell>
      <MiniCell>
        {cashier.stop === null ? (
          <Status tone="ok">Allowed</Status>
        ) : (
          <Status tone="bad">Stopped</Status>
        )}
        {note !== null && <span className="block text-mute">{note}</span>}
      </MiniCell>
      <MiniCell align="right" className="whitespace-nowrap">
        {canManage && cashier.stop === null && (
          <Button variant="destructive" size="sm" onClick={onStop}>
            Stop POS
          </Button>
        )}
        {canManage && cashier.stop !== null && (
          <Button
            variant="primary"
            size="sm"
            pending={resuming}
            onClick={onResume}
          >
            {resuming ? "Resuming…" : "Resume POS"}
          </Button>
        )}
      </MiniCell>
    </MiniRow>
  )
}

function AskDialog({
  asking,
  pos,
  unit,
  open,
  onOpenChange,
}: {
  asking: Asking
  pos: StorePos
  unit: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  switch (asking.kind) {
    case "stop-till":
      return (
        <StopTillDialog
          till={asking.till}
          open={open}
          onOpenChange={onOpenChange}
        />
      )
    case "remove-till":
      return (
        <RemoveTillDialog
          till={asking.till}
          open={open}
          onOpenChange={onOpenChange}
        />
      )
    case "stop-person":
      return (
        <StopPersonDialog
          cashier={asking.cashier}
          tills={pos.tills}
          unit={unit}
          open={open}
          onOpenChange={onOpenChange}
        />
      )
  }
}

/// Stop or remove a till: one write on the device, then the tab reads again.
function useSwitchTill(onDone: () => void) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: {
      readonly till: StorePosTill
      readonly status: DeviceStatus
      readonly reason: string
    }) =>
      setDeviceStatus(request.till.device_id, {
        status: request.status,
        reason: request.reason,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: storesKeys.all })
      void client.invalidateQueries({ queryKey: systemKeys.devices() })
      onDone()
    },
  })
}

function StopTillDialog({
  till,
  open,
  onOpenChange,
}: {
  till: StorePosTill
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const stop = useSwitchTill(() => onOpenChange(false))
  const name = tillName(till)
  return (
    <StopDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Stop ${name}?`}
      facts={[
        { term: "Machine", value: till.machine ?? EMPTY },
        {
          term: "Shift",
          value:
            till.open_shift === null
              ? "None open"
              : `${till.open_shift.name} · ${time(till.open_shift.opened_at)} · closing only`,
        },
      ]}
      reason
      action={`Stop ${name}`}
      pending={stop.isPending}
      error={stop.error}
      onConfirm={(reason) => stop.mutate({ till, status: "SUSPENDED", reason })}
    />
  )
}

function RemoveTillDialog({
  till,
  open,
  onOpenChange,
}: {
  till: StorePosTill
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const remove = useSwitchTill(() => onOpenChange(false))
  const name = tillName(till)
  return (
    <StopDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${name}?`}
      sub="Can’t be undone"
      facts={[
        { term: "Machine", value: till.machine ?? EMPTY },
        {
          term: "Stopped",
          value:
            till.stop === null
              ? EMPTY
              : [moment(till.stop.at), till.stop.reason]
                  .filter((part) => part !== "")
                  .join(" · "),
        },
        { term: "Seat", value: `${name} free for a new PC` },
        { term: "Sales", value: "Kept" },
      ]}
      action={`Remove ${name}`}
      pending={remove.isPending}
      error={remove.error}
      onConfirm={() =>
        remove.mutate({
          till,
          status: "REVOKED",
          reason: till.stop?.reason.trim() || "Removed",
        })
      }
    />
  )
}

function StopPersonDialog({
  cashier,
  tills,
  unit,
  open,
  onOpenChange,
}: {
  cashier: StorePosCashier
  tills: readonly StorePosTill[]
  unit: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const stop = useMutation({
    mutationFn: (reason: string) =>
      stopCashier(unit, cashier.user_id, { reason }),
    onSuccess: (answer) => {
      client.setQueryData(storesKeys.pos(unit), answer)
      onOpenChange(false)
    },
  })
  // The drawer this person has open at one of the store's tills, if any: the
  // shift names the person by full name, or by login when the hub has none.
  const seat = tills.find(
    (till) =>
      till.status !== "REVOKED" &&
      till.open_shift !== null &&
      (till.open_shift.name === cashier.name ||
        till.open_shift.name === cashier.username)
  )
  const shift = seat?.open_shift ?? null
  return (
    <StopDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Stop POS for ${cashier.name}?`}
      facts={[
        { term: "Role", value: cashier.role },
        { term: "POS", value: "Every store" },
        {
          term: "Shift",
          value:
            seat === undefined || shift === null
              ? "None open"
              : `${tillName(seat)} · ${time(shift.opened_at)} · closing only`,
        },
      ]}
      reason
      action="Stop POS"
      pending={stop.isPending}
      error={stop.error}
      onConfirm={(reason) => stop.mutate(reason)}
    />
  )
}
