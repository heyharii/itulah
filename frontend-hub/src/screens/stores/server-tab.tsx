import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Download, Monitor, RefreshCw, Server, Unplug } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { Card } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Segmented } from "@/components/ui/segmented"
import { Banner } from "@/components/ui/states"
import { ago, count, dayTime, moment, time } from "@/lib/format"
import { useFleetStatusOf } from "@/lib/queries/fleet"
import {
  approveEnrolment,
  listEnrolments,
  refuseEnrolment,
  systemKeys,
} from "@/lib/queries/system"
import {
  disconnectStoreServer,
  dropHeldInstall,
  heldInstallOf,
  holdInstall,
  installStoreServer,
  isTransitionalServerState,
  serverExtras,
  storeDetail,
  storesKeys,
  svgDataUri,
  type FirstData,
  type ServerMachine,
  type StoreServerInstall,
  type StoreSummary,
} from "@/lib/queries/stores"
import { cn } from "@/lib/utils"
import { ServerActionsButton } from "@/screens/stores/actions"
import { ServerDot, serverStateLabel } from "@/screens/stores/shared"
import { saying } from "@/screens/system/units"

/// Install the store's server, watch it connect and fetch its first data, and
/// see it settle into Ready or Offline — the store page's second tab.
///
/// The flow, in the words the screen speaks: an Admin issues an install code
/// (**Waiting for the server**), somebody at the shop types it into the
/// installer, the server connects (a claimed code is approved by itself) and
/// pulls the catalogue, price books, staff, payment methods and promotions
/// (**Getting data**), then it is **Ready**.
///
/// This reads its OWN copy of the store's detail (same `storesKeys.detail`
/// query the page already has) rather than trusting the `store` prop for the
/// server's own state, so it can poll every 5 seconds while that state is on
/// its way somewhere else without making the whole page poll while somebody
/// is reading the checklist on Overview.
export function ServerTab({
  store,
  canManage,
}: {
  store: StoreSummary
  /// An Admin at head office (`StoreDetail.can_manage`) — install and
  /// disconnect are theirs alone; a store's own manager reads this tab's
  /// state but never sees the buttons, and the server would refuse them
  /// either way.
  canManage: boolean
}) {
  const client = useQueryClient()
  const unit = store.unit_id
  const detail = useQuery({
    queryKey: storesKeys.detail(unit),
    queryFn: ({ signal }) => storeDetail(unit, signal),
    refetchInterval: (query) => {
      const state = query.state.data?.store.server.state
      return state && isTransitionalServerState(state) ? 5_000 : false
    },
  })
  const server = serverExtras(detail.data?.store.server ?? store.server)
  // A removed store gets no server again: its own may only be let go.
  const removed = (detail.data?.store.status ?? store.status) === "CLOSED"

  // Held, not read back from anywhere: the code is write-once and no read of
  // the store ever returns it again — same rule as the System › Nodes install
  // sheet. The "Add store" sheet issues the first one and leaves it in
  // `heldInstallOf` for this tab to pick up; a reload loses it.
  const [issued, setIssued] = useState<StoreServerInstall | null>(() =>
    heldInstallOf(unit)
  )
  function keep(install: StoreServerInstall) {
    holdInstall(unit, install)
    setIssued(install)
  }

  // A code that has been used is of no more interest to anybody.
  const state = server.state
  useEffect(() => {
    if (state !== "WAITING_TO_INSTALL" && state !== "NOT_INSTALLED")
      dropHeldInstall(unit)
  }, [state, unit])

  function settle() {
    void client.invalidateQueries({ queryKey: storesKeys.detail(unit) })
    void client.invalidateQueries({ queryKey: storesKeys.list() })
    void client.invalidateQueries({ queryKey: systemKeys.enrolments() })
  }

  const install = useMutation({
    mutationFn: () => installStoreServer(unit),
    onSuccess: (result) => {
      keep(result)
      settle()
    },
  })

  const disconnect = useMutation({
    mutationFn: () => disconnectStoreServer(unit),
    onSuccess: (result) => {
      if (result) keep(result)
      else {
        dropHeldInstall(unit)
        setIssued(null)
      }
      settle()
    },
  })

  const watchingApproval = canManage && state === "WAITING_FOR_APPROVAL"
  const enrolments = useQuery({
    queryKey: systemKeys.enrolments(),
    queryFn: ({ signal }) => listEnrolments(signal),
    // An Admin-only register (`System › Store servers`); a store's own
    // manager cannot approve here anyway (see the `canManage` gate below), so
    // asking for it would only be a 403 nobody reads.
    enabled: watchingApproval,
    refetchInterval: watchingApproval ? 5_000 : false,
  })
  const claim = (enrolments.data ?? []).find(
    (row) => row.enrolment_id === server.enrolment_id
  )

  const approve = useMutation({
    mutationFn: () => approveEnrolment(server.enrolment_id ?? ""),
    onSuccess: settle,
  })
  const refuse = useMutation({
    mutationFn: () => refuseEnrolment(server.enrolment_id ?? ""),
    onSuccess: settle,
  })

  const settled = state === "ONLINE" || state === "OFFLINE"
  // When the data on the store's side last reached head office — the fleet
  // page's own reading of it. Asked only once there is something to read.
  const fleet = useFleetStatusOf(unit, state === "ONLINE")
  const dataUpTo =
    fleet.data?.sync?.up.data_up_to ??
    fleet.data?.sync?.last_heard_at ??
    server.last_seen_at

  const machine = server.machine ?? null
  const disconnectButton = (
    <DisconnectButton
      machine={machine}
      store={store.name}
      removed={removed}
      onDisconnect={() => disconnect.mutateAsync()}
    />
  )
  const machineRow = (
    <MachineRow
      machine={machine}
      connectedAt={server.connected_at ?? null}
      disconnect={canManage ? disconnectButton : null}
    />
  )
  // Where the machine row carries Disconnect; a removed store whose server
  // shows no machine there is offered it on its own.
  const rowShown = machine !== null && (state === "SYNCING" || settled)

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <ServerDot state={state} />
        <b className="text-[0.9375rem] text-ink">
          {removed && state === "NOT_INSTALLED"
            ? "No server"
            : serverStateLabel(state)}
        </b>
        {state === "ONLINE" && dataUpTo && (
          <span className="text-meta text-mute">
            data up to {upTo(dataUpTo)}
          </span>
        )}
        <span className="flex-1" />
        {settled && <ServerActionsButton unit={unit} />}
      </div>

      {removed && canManage && state !== "NOT_INSTALLED" && !rowShown && (
        <div>{disconnectButton}</div>
      )}

      {!removed && state === "NOT_INSTALLED" && (
        <Card className="p-4">
          <p className="mb-3 text-[0.9375rem] text-body">
            {canManage
              ? `Issue an install code for ${store.name}’s server. It is good for 1 hour and works once.`
              : "Not installed yet. Only an Admin at head office may issue its install code."}
          </p>
          {canManage && (
            <>
              {install.isError && (
                <Banner tone="bad" className="mb-3">
                  {saying(install.error)}
                </Banner>
              )}
              <Button
                variant="primary"
                pending={install.isPending}
                onClick={() => install.mutate()}
              >
                {install.isPending ? "Issuing…" : "Install server"}
              </Button>
            </>
          )}
        </Card>
      )}

      {!removed && state === "WAITING_TO_INSTALL" && (
        <>
          {!canManage ? (
            <Banner tone="warn">
              Waiting for the server. Only an Admin at head office may issue or
              reissue its code.
            </Banner>
          ) : issued ? (
            <InstallCard install={issued} />
          ) : (
            <Banner tone="warn">
              Waiting for the server. This page does not keep the code — issue a
              new one; it cancels the old.
            </Banner>
          )}
          {canManage && (
            <>
              {install.isError && (
                <Banner tone="bad">{saying(install.error)}</Banner>
              )}
              <div>
                <Button
                  variant="quiet"
                  pending={install.isPending}
                  onClick={() => install.mutate()}
                >
                  <RefreshCw />
                  {install.isPending ? "Issuing…" : "Issue a new code"}
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {!removed && state === "WAITING_FOR_APPROVAL" && (
        <Card className="p-4">
          {claim ? (
            <div className="flex flex-col gap-3">
              <p className="text-[0.9375rem] text-body">
                {claim.machine?.hostname || "Unnamed machine"}
                {claim.machine?.os ? ` · ${claim.machine.os}` : ""}
                {claim.machine?.version ? ` · v${claim.machine.version}` : ""}{" "}
                · claimed {ago(claim.claimed_at)}
              </p>
              {canManage ? (
                <>
                  {approve.isError && (
                    <Banner tone="bad">{saying(approve.error)}</Banner>
                  )}
                  {refuse.isError && (
                    <Banner tone="bad">{saying(refuse.error)}</Banner>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      pending={approve.isPending || refuse.isPending}
                      onClick={() => approve.mutate()}
                    >
                      {approve.isPending ? "Approving…" : "Approve"}
                    </Button>
                    <Button
                      variant="quiet"
                      pending={approve.isPending || refuse.isPending}
                      onClick={() => refuse.mutate()}
                    >
                      Refuse
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-meta text-body">
                  Only an Admin at head office may approve it.
                </p>
              )}
            </div>
          ) : (
            <p className="text-[0.9375rem] text-body">
              The server has used its code. This fills in the moment it does.
            </p>
          )}
        </Card>
      )}

      {state === "SYNCING" && (
        <Card className="overflow-hidden">
          {machine && machineRow}
          <FirstDataList data={server.first_data ?? null} bordered={!!machine} />
        </Card>
      )}

      {settled && (
        <Card className="overflow-hidden">
          {machine && machineRow}
          <div
            className={cn(
              "grid gap-x-6 gap-y-3.5 p-4 sm:grid-cols-3",
              machine && "border-t border-hairline"
            )}
          >
            <Detail term="Version">
              {machine?.version ? machine.version : "—"}
            </Detail>
            <Detail term="Connected">
              {server.connected_at ? dayTime(server.connected_at) : "—"}
            </Detail>
            <Detail term="Data up to">{dataUpTo ? dayTime(dataUpTo) : "—"}</Detail>
          </div>
          {server.app_address && (
            <StoreApp
              address={server.app_address}
              qr={server.app_qr_svg ?? null}
            />
          )}
        </Card>
      )}

      {disconnect.isError && (
        <Banner tone="bad">{saying(disconnect.error)}</Banner>
      )}

      {state === "OFFLINE" && (
        <Banner tone="bad">
          No heartbeat
          {server.last_seen_at ? ` since ${moment(server.last_seen_at)}` : ""}.
          Check the machine and its network at the store.
        </Banner>
      )}
    </div>
  )
}

/// "09:43" today, "10 Oct 2026, 09:43" any other day.
function upTo(value: string): string {
  const at = new Date(value)
  return at.toDateString() === new Date().toDateString()
    ? time(value)
    : dayTime(value)
}

function Detail({
  term,
  children,
}: {
  term: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="text-[0.9375rem] text-body">{term}</div>
      <div className="mt-1 text-[0.9375rem] text-ink tabular-nums">
        {children}
      </div>
    </div>
  )
}

type MachineKind = "windows" | "linux"

/// The code, how to use it, and a live line saying the page is waiting for the
/// shop. Windows PC or Linux mini PC decides what the shop is given: an
/// installer to download, or one command to paste.
function InstallCard({ install }: { install: StoreServerInstall }) {
  const [kind, setKind] = useState<MachineKind>("windows")
  const command = `sudo ./install-store.sh --code ${install.code} --appliance --lock`
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[0.9375rem] text-body">Install code</div>
          <div className="font-mono text-[2.125rem] leading-[2.75rem] font-semibold tracking-[0.08em] text-ink select-all">
            {install.code}
          </div>
          <div className="text-[0.9375rem] text-mute">Valid for 1 hour · once</div>
        </div>
        <CopyButton text={install.code} />
      </div>

      <div className="flex items-center gap-2.5 rounded-inner bg-soft px-3.5 py-3 text-[0.9375rem] text-body">
        <Spinner />
        Waiting for the server to use this code
      </div>

      <Segmented<MachineKind>
        className="self-start"
        options={[
          { value: "windows", label: "Windows PC" },
          { value: "linux", label: "Linux mini PC" },
        ]}
        value={kind}
        onChange={setKind}
      />

      {kind === "windows" ? (
        <div>
          <a
            href={install.installer_url}
            className={button({ variant: "primary" })}
          >
            <Download />
            Download Central Store Server
          </a>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2.5 rounded-inner bg-[#16181c] py-2.5 pr-2.5 pl-3.5 font-mono text-[0.9375rem] text-[#e6e8eb]">
            <span className="min-w-0 break-all">{command}</span>
            <CopyButton text={command} dark />
          </div>
          <div>
            <a
              href={install.installer_url}
              className={button({ variant: "soft" })}
            >
              <Download />
              Download for Linux
            </a>
          </div>
        </>
      )}
    </Card>
  )
}

/// Copy to the clipboard, and say so for a moment: the button flips to
/// "Copied" and back.
function CopyButton({ text, dark = false }: { text: string; dark?: boolean }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <Button
      variant={dark ? "quiet" : "soft"}
      size={dark ? "sm" : "default"}
      said={copied ? "Copied" : null}
      className={cn(
        dark &&
          "shrink-0 bg-white/10 text-white hover:bg-white/20 hover:text-white [&_svg]:text-white"
      )}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true))
      }}
    >
      Copy
    </Button>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 rounded-full border-2 border-hairline-strong border-t-accent motion-safe:animate-spin"
    />
  )
}

/// The machine that is serving this store, and the one way to let go of it.
function MachineRow({
  machine,
  connectedAt,
  disconnect,
}: {
  machine: ServerMachine | null
  connectedAt: string | null
  /// Disconnect, for an Admin at head office; `null` for anybody else.
  disconnect: React.ReactNode
}) {
  if (machine === null) return null
  const windows = /windows/i.test(machine.os)
  const Icon = windows ? Monitor : Server
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-inner bg-soft-2 text-ink">
        <Icon className="size-[1.125rem]" />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate font-medium text-ink">
          {machine.hostname}
        </b>
        <span className="block truncate text-meta text-mute">
          {machine.os}
          {connectedAt ? ` · connected ${dayTime(connectedAt)}` : ""}
        </span>
      </span>
      {disconnect}
    </div>
  )
}

/// Let go of the store's server: its key stops working. An open store is
/// issued a new install code for the right machine; a removed one is not.
function DisconnectButton({
  machine,
  store,
  removed,
  onDisconnect,
}: {
  machine: ServerMachine | null
  store: string
  removed: boolean
  onDisconnect: () => Promise<unknown>
}) {
  return (
    <ConfirmButton
      label={
        <>
          <Unplug />
          Disconnect
        </>
      }
      variant={removed ? "destructive" : "quiet"}
      tone="danger"
      title={`Disconnect ${machine?.hostname ?? `${store}’s server`}?`}
      description={
        removed
          ? "Its key stops working. Anything it has not sent stays on the machine. No new install code is issued."
          : `It stops receiving ${store}’s data. A new install code is issued for the right machine.`
      }
      confirmLabel="Disconnect"
      cancelLabel="Keep"
      onConfirm={onDisconnect}
    />
  )
}

/// Getting data: one line per stream, a tick when it is in, a spinner on the
/// one being fetched, and its count as a number.
function FirstDataList({
  data,
  bordered,
}: {
  data: FirstData | null
  bordered: boolean
}) {
  const border = bordered ? "border-t border-hairline" : ""
  if (data === null || data.streams.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center gap-2.5 px-4 py-3.5 text-[0.9375rem] text-body",
          border
        )}
      >
        <Spinner />
        Getting its first data…
      </div>
    )
  }
  const current = data.streams.findIndex((stream) => !stream.done)
  return (
    <div className={border}>
      <div className="flex items-baseline justify-between border-b border-hairline px-4 pt-3.5 pb-2.5">
        <h4 className="text-card-title font-semibold text-ink">Getting data</h4>
        <span className="text-[0.9375rem] text-mute tabular-nums">
          {data.done} of {data.total}
        </span>
      </div>
      <ul className="divide-y divide-hairline">
        {data.streams.map((stream, index) => (
          <li
            key={stream.key}
            className="grid grid-cols-[1.375rem_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-2.5"
          >
            <span
              aria-hidden
              className={cn(
                "grid size-[1.125rem] place-items-center rounded-full border-[1.5px] transition-colors",
                stream.done
                  ? "border-ok bg-ok text-cta-fg"
                  : index === current
                    ? "border-accent border-t-transparent motion-safe:animate-spin"
                    : "border-hairline-strong"
              )}
            >
              {stream.done && <Check className="size-3" strokeWidth={3} />}
            </span>
            <span className="min-w-0 truncate text-ink">{stream.label}</span>
            <span
              className={cn(
                "text-[0.9375rem] tabular-nums",
                stream.done ? "text-ink" : "text-body"
              )}
            >
              {stream.count === null ? "—" : count(stream.count)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/// Where the store app lives on the shop's network, as a QR to scan with a
/// phone and the address to type.
function StoreApp({ address, qr }: { address: string; qr: string | null }) {
  return (
    <div className="flex items-center gap-4 border-t border-hairline px-4 py-3.5">
      {qr && (
        <img
          src={svgDataUri(qr)}
          alt="QR code of the store app’s address"
          className="size-[4.5rem] shrink-0 rounded-inner"
        />
      )}
      <span className="min-w-0 flex-1">
        <b className="block font-medium text-ink">Store app</b>
        <span className="block truncate font-mono text-meta text-mute">
          {address}
        </span>
      </span>
      <CopyButton text={address} />
    </div>
  )
}
