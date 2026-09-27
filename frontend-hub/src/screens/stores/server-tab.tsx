import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Banner } from "@/components/ui/states"
import { ago, moment } from "@/lib/format"
import {
  approveEnrolment,
  listEnrolments,
  refuseEnrolment,
  systemKeys,
} from "@/lib/queries/system"
import {
  installStoreServer,
  isTransitionalServerState,
  storeDetail,
  storesKeys,
  svgDataUri,
  type StoreServer,
  type StoreServerInstall,
  type StoreSummary,
} from "@/lib/queries/stores"
import { ServerDot, serverStateLabel } from "@/screens/stores/shared"
import { saying } from "@/screens/system/units"

/// Install the store's server, watch it get approved, and see it settle into
/// online or offline — the mock's tab 2.
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
  /// An Admin at head office (`StoreDetail.can_manage`) — install and approve
  /// are theirs alone; a store's own manager reads this tab's state but never
  /// sees the buttons, and the server would refuse them either way.
  canManage: boolean
}) {
  const client = useQueryClient()
  const detail = useQuery({
    queryKey: storesKeys.detail(store.unit_id),
    queryFn: ({ signal }) => storeDetail(store.unit_id, signal),
    refetchInterval: (query) => {
      const state = query.state.data?.store.server.state
      return state && isTransitionalServerState(state) ? 5_000 : false
    },
  })
  const server = detail.data?.store.server ?? store.server

  // Held here, not read back from anywhere: the code is write-once and no
  // read of the store ever returns it again — same rule as the System ›
  // Nodes install sheet.
  const [issued, setIssued] = useState<StoreServerInstall | null>(null)

  function settle() {
    void client.invalidateQueries({ queryKey: storesKeys.detail(store.unit_id) })
    void client.invalidateQueries({ queryKey: storesKeys.list() })
    void client.invalidateQueries({ queryKey: systemKeys.enrolments() })
  }

  const install = useMutation({
    mutationFn: () => installStoreServer(store.unit_id),
    onSuccess: (result) => {
      setIssued(result)
      settle()
    },
  })

  const watchingApproval = canManage && server.state === "WAITING_FOR_APPROVAL"
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

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <ServerDot state={server.state} />
        <b className="text-[0.9375rem] text-ink">
          {serverStateLabel(server.state)}
        </b>
        <ServerAge server={server} />
      </div>

      {server.state === "NOT_INSTALLED" && (
        <Card className="p-4">
          <p className="mb-3 text-[0.875rem] text-body">
            {canManage
              ? `Issue an install code for ${store.name}’s back-office PC. The code shows on this page, on an installer link, and as a QR — good for 24 hours or until it is used.`
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

      {server.state === "WAITING_TO_INSTALL" && (
        <Card className="p-4">
          {!canManage ? (
            <Banner tone="warn">
              Waiting to be installed. Only an Admin at head office may issue
              or reissue its code.
            </Banner>
          ) : issued ? (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <div className="rounded-inner border border-dashed border-hairline-2 px-6 py-5 text-center">
                  <div className="text-meta text-mute">Activation code</div>
                  <div className="mt-1 font-mono text-[1.75rem] font-semibold tracking-wider text-ink select-all">
                    {issued.code}
                  </div>
                  <div className="mt-1 text-meta text-mute">
                    valid until {moment(issued.expires_at)}
                  </div>
                </div>
                <img
                  src={svgDataUri(issued.qr_svg)}
                  alt="QR code carrying the install code"
                  className="size-28 shrink-0 rounded-inner border border-hairline-2"
                />
              </div>
              <ol className="mt-3.5 list-decimal space-y-1.5 pl-5 text-[0.875rem] text-body">
                <li>
                  On the store&rsquo;s back-office PC, open{" "}
                  <a
                    href={issued.installer_url}
                    className="font-medium text-accent underline underline-offset-2"
                  >
                    {issued.installer_url}
                  </a>{" "}
                  and run the installer.
                </li>
                <li>Type this code, or scan the QR.</li>
                <li>
                  The server then shows a verification number — approve it
                  below once it matches.
                </li>
              </ol>
            </>
          ) : (
            <Banner tone="warn">
              Waiting to be installed. The code was shown once when it was
              issued and this page does not keep it — issue a new one if it
              was lost; the new code cancels the old.
            </Banner>
          )}
          {canManage && (
            <>
              {install.isError && (
                <Banner tone="bad" className="mt-3">
                  {saying(install.error)}
                </Banner>
              )}
              <div className="mt-3.5">
                <Button
                  variant="quiet"
                  pending={install.isPending}
                  onClick={() => install.mutate()}
                >
                  {install.isPending ? "Issuing…" : "Issue a new code"}
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {server.state === "WAITING_FOR_APPROVAL" && (
        <Card className="p-4">
          {claim ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <p className="text-[0.875rem] text-body">
                  {claim.machine?.hostname || "Unnamed machine"}
                  {claim.machine?.os ? ` · ${claim.machine.os}` : ""}
                  {claim.machine?.version ? ` · v${claim.machine.version}` : ""}{" "}
                  · claimed {ago(claim.claimed_at)}
                </p>
                <div className="text-right">
                  <div className="text-meta text-mute">Verification</div>
                  <div className="font-mono text-[1.75rem] leading-tight font-semibold tracking-wider text-ink tabular-nums">
                    {grouped(claim.verification)}
                  </div>
                </div>
              </div>
              <p className="text-meta text-body">
                {canManage
                  ? "Ask the store to read the number on its screen. Approve only if it is this one — a different number is a different machine."
                  : "Only an Admin at head office may approve it."}
              </p>
              {canManage && (
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
                      {approve.isPending
                        ? "Approving…"
                        : "The numbers match — approve"}
                    </Button>
                    <Button
                      variant="quiet"
                      pending={approve.isPending || refuse.isPending}
                      onClick={() => refuse.mutate()}
                    >
                      Reject
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-[0.875rem] text-body">
              The server has an activation code but has not claimed it yet —
              this fills in the moment it does.
            </p>
          )}
        </Card>
      )}

      {server.state === "SYNCING" && (
        <Banner tone="info">
          Approved. The server is pulling the catalogue, prices, staff and
          schedules — this only takes a moment.
        </Banner>
      )}

      {server.state === "OFFLINE" && (
        <Banner tone="bad">
          No heartbeat
          {server.last_seen_at ? ` since ${moment(server.last_seen_at)}` : ""}
          . Check the machine and its network at the store — the server has
          nothing further to install or approve.
        </Banner>
      )}
    </div>
  )
}

function ServerAge({ server }: { server: StoreServer }) {
  if (server.state === "ONLINE" && server.last_seen_at) {
    return (
      <span className="text-meta text-mute">
        heartbeat {ago(server.last_seen_at)}
      </span>
    )
  }
  return null
}

function grouped(verification: string | null): string {
  if (!verification) return "—"
  return `${verification.slice(0, 3)} ${verification.slice(3)}`
}
