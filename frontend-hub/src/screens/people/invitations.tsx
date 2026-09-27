import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadingState, Problem } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, day, moment } from "@/lib/format"
import { unitLabel, useUnits } from "@/lib/queries/organisation"
import {
  invitationKeys,
  renewInvitation,
  revokeInvitation,
  useInvitations,
  useRoles,
  type InvitationRow,
  type InvitationStatus,
} from "@/lib/queries/invitations"
import { useCanWrite } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { CopyLinkButton, InviteSheet } from "@/screens/people/invite-sheet"

/// Everyone who has been sent a link to set up their own sign-in.
///
/// No pagination and no server-side search: the list this answers with is
/// employees invited, not employees, and a company issuing hundreds of these
/// a day is not the shape this screen is built for. Filtering by status and by
/// unit — both parameters the server itself understands — is enough to find
/// one.

const TABS: readonly { value: InvitationStatus; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "EXPIRED", label: "Expired" },
  { value: "REVOKED", label: "Revoked" },
]

const STATUS_TONE: Readonly<Record<InvitationStatus, "warn" | "ok" | "neutral" | "bad">> = {
  PENDING: "warn",
  ACCEPTED: "ok",
  EXPIRED: "neutral",
  REVOKED: "bad",
}

function statusLabel(status: InvitationStatus): string {
  return TABS.find((tab) => tab.value === status)?.label ?? status
}

export function Invitations() {
  const [status, setStatus] = useState<InvitationStatus>("PENDING")
  const [unitId, setUnitId] = useState("")
  const canWrite = useCanWrite()
  const invite = useSheet("invite")
  const client = useQueryClient()
  const roles = useRoles()
  const units = useUnits()
  const [renewing, setRenewing] = useState<InvitationRow | null>(null)

  const invitations = useInvitations(status)
  const rows = useMemo(
    () =>
      (invitations.data ?? []).filter(
        (row) => unitId === "" || row.unit_id === unitId
      ),
    [invitations.data, unitId]
  )

  const roleName = (code: string) =>
    roles.data?.find((role) => role.code === code)?.name ?? code
  const unitName = (id: string) => {
    const unit = units.data?.find((one) => one.id === id)
    return unit ? unitLabel(unit) : id
  }

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: invitationKeys.all }),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Invitations"
        sub="Everyone who has been sent a link to set up their own sign-in."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => invite.open(true)}>
              Invite people
            </Button>
          )
        }
      />

      <SubTabs
        tabs={TABS}
        value={status}
        onChange={(next) => setStatus(next as InvitationStatus)}
      />

      <Toolbar>
        <Select
          value={unitId}
          onChange={setUnitId}
          placeholder="Every unit"
          className="h-8 w-52"
        >
          <option value="">Every unit</option>
          {(units.data ?? []).map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unitLabel(unit)}
            </option>
          ))}
        </Select>
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute tabular-nums">
          {count(rows.length)} {statusLabel(status).toLowerCase()}
        </span>
      </Toolbar>

      <Problem error={revoke.error} className="mb-3" />

      <Card className="divide-y divide-hairline overflow-hidden">
        {invitations.isPending ? (
          <LoadingState>Loading invitations…</LoadingState>
        ) : rows.length === 0 ? (
          <EmptyState>
            No {statusLabel(status).toLowerCase()} invitations
            {unitId !== "" ? " for this unit" : ""}.
          </EmptyState>
        ) : (
          rows.map((row) => (
            <div
              key={row.invitation_id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <b className="truncate text-cell font-medium text-ink">
                    {row.name}
                  </b>
                  <Pill tone={STATUS_TONE[row.status]}>
                    {statusLabel(row.status)}
                  </Pill>
                </div>
                <p className="mt-0.5 truncate text-meta text-mute">
                  {roleName(row.role_code)} · {unitName(row.unit_id)}
                  {row.username ? ` · ${row.username}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-meta text-mute">
                {row.status === "ACCEPTED" && row.accepted_at
                  ? `Accepted ${day(row.accepted_at)}`
                  : row.status === "PENDING"
                    ? `Expires ${day(row.expires_at)}`
                    : `Sent ${day(row.created_at)}`}
              </span>
              {canWrite && row.status === "PENDING" && (
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" onClick={() => setRenewing(row)}>
                    Renew
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    pending={revoke.isPending}
                    onClick={() => revoke.mutate(row.invitation_id)}
                  >
                    Revoke
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </Card>

      <InviteSheet
        open={invite.isOpen}
        onClose={invite.close}
        defaultUnitId={unitId || undefined}
      />
      <RenewSheet row={renewing} onClose={() => setRenewing(null)} />
    </PageContent>
  )
}

/// Renewing a pending invitation: the old link stops working and this one
/// takes its place, shown once like the link it replaces.
function RenewSheet({
  row,
  onClose,
}: {
  row: InvitationRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const renew = useMutation({
    mutationFn: () => renewInvitation(row!.invitation_id),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: invitationKeys.all }),
  })

  return (
    <Sheet
      open={row !== null}
      onOpenChange={(next) => {
        if (!next) {
          renew.reset()
          onClose()
        }
      }}
      id={row?.invitation_id}
      title={row ? `Renew ${row.name}’s link` : "Renew"}
      footer={
        renew.data ? (
          <div className="flex justify-end">
            <Button
              onClick={() => {
                renew.reset()
                onClose()
              }}
            >
              Done
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              pending={renew.isPending}
              onClick={() => renew.mutate()}
            >
              {renew.isPending ? "Renewing…" : "Renew link"}
            </Button>
          </div>
        )
      }
    >
      {renew.data ? (
        <div className="flex flex-col gap-3.5">
          <Banner tone="warn">
            This link is shown once. Copy it now and send it to{" "}
            {row?.name ?? "them"}.
          </Banner>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-inner bg-soft-2 px-2.5 py-2 font-mono text-id text-body">
              {renew.data.link}
            </code>
            <CopyLinkButton link={renew.data.link} />
          </div>
          <p className="text-meta text-mute">
            Expires {moment(renew.data.expires_at)}.
          </p>
        </div>
      ) : (
        <p className="text-[0.875rem] text-body">
          The old link stops working the moment this one is issued, valid for
          another 72 hours.
        </p>
      )}
      {renew.isError && <Problem error={renew.error} />}
    </Sheet>
  )
}
