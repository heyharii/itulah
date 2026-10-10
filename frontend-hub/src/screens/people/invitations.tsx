import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  LoadingState,
  Problem,
} from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, day, moment } from "@/lib/format"
import { unitLabel, useUnits } from "@/lib/queries/organisation"
import {
  invitationKeys,
  renewInvitation,
  revokeInvitation,
  useInvitations,
  type InvitationRow,
  type InvitationStatus,
} from "@/lib/queries/invitations"
import { useCanWrite } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import {
  CopyLinkButton,
  InviteSheet,
  WhatsAppLinkButton,
} from "@/screens/people/invite-sheet"
import {
  CardButton,
  CardDate,
  CardName,
  PhoneCards,
} from "@/components/ui/phone-cards"

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

const STATUS_TONE: Readonly<
  Record<InvitationStatus, "warn" | "ok" | "neutral" | "bad">
> = {
  PENDING: "warn",
  ACCEPTED: "ok",
  EXPIRED: "neutral",
  REVOKED: "bad",
}

/// `InvitationRow.status` arrives as a bare `string` off the wire; both of
/// these fall back to the raw value for anything this app's own four-way
/// union does not (yet) name, rather than throwing on an index it does not
/// recognise.
function statusTone(status: string): "warn" | "ok" | "neutral" | "bad" {
  return (
    (
      STATUS_TONE as Readonly<Record<string, "warn" | "ok" | "neutral" | "bad">>
    )[status] ?? "neutral"
  )
}

function statusLabel(status: string): string {
  return TABS.find((tab) => tab.value === status)?.label ?? status
}

export function Invitations() {
  const [status, setStatus] = useState<InvitationStatus>("PENDING")
  const [unitId, setUnitId] = useState("")
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const invite = useSheet("invite")
  const client = useQueryClient()
  const units = useUnits()
  const [renewing, setRenewing] = useState<InvitationRow | null>(null)

  const invitations = useInvitations(status, unitId || undefined)
  const rows = invitations.data ?? []

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
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => invite.open(true)}>
              Invite people
            </Button>
          )
        }
      />
      {canWrite && (
        <Fab label="Invite people" onClick={() => invite.open(true)} />
      )}

      <SubTabs
        tabs={TABS}
        value={status}
        onChange={(next) => setStatus(next as InvitationStatus)}
      />

      <Toolbar>
        <Select value={unitId} onChange={setUnitId} className="h-8 w-52">
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

      <Card className="divide-y divide-hairline overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {invitations.isPending ? (
          <LoadingState>Loading invitations…</LoadingState>
        ) : rows.length === 0 ? (
          <EmptyState>
            No {statusLabel(status).toLowerCase()} invitations
            {unitId !== "" ? " for this unit" : ""}.
          </EmptyState>
        ) : phone ? (
          <PhoneCards
            rows={rows}
            onOpen={(row) =>
              row.status === "PENDING" && canWrite
                ? setRenewing(row)
                : undefined
            }
            rowId={(row) => row.invitation_id}
            spec={{
              title: (row) => (
                <CardName
                  name={row.name}
                  line={[
                    row.role_name,
                    row.unit_name,
                    row.position,
                    row.username,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ),
              lead: (row) =>
                row.status === "ACCEPTED" && row.accepted_at ? (
                  <CardDate iso={row.accepted_at} label="accepted" />
                ) : row.status === "REVOKED" && row.revoked_at ? (
                  <CardDate iso={row.revoked_at} label="revoked" tone="quiet" />
                ) : row.status === "PENDING" ? (
                  <CardDate iso={row.expires_at} label="expires" />
                ) : (
                  <CardDate iso={row.created_at} label="sent" tone="quiet" />
                ),
              foot: (row) => (
                <Pill tone={statusTone(row.status)}>
                  {statusLabel(row.status)}
                </Pill>
              ),
              action: (row) =>
                canWrite && row.status === "PENDING" ? (
                  <CardButton
                    label="Renew"
                    ariaLabel={`Renew ${row.name}’s link`}
                    onClick={() => setRenewing(row)}
                  />
                ) : null,
            }}
          />
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
                  <Pill tone={statusTone(row.status)}>
                    {statusLabel(row.status)}
                  </Pill>
                </div>
                <p className="mt-0.5 truncate text-meta text-mute">
                  {row.role_name} · {row.unit_name}
                  {row.position ? ` · ${row.position}` : ""}
                  {row.username ? ` · ${row.username}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-meta text-mute">
                {row.status === "ACCEPTED" && row.accepted_at
                  ? `Accepted ${day(row.accepted_at)}`
                  : row.status === "REVOKED" && row.revoked_at
                    ? `Revoked ${day(row.revoked_at)}${row.revoked_by ? ` by ${row.revoked_by}` : ""}`
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
  const phone = useLayout() === "phone"
  const renew = useMutation({
    mutationFn: () => renewInvitation(row!.invitation_id),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: invitationKeys.all }),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
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
            {/* The row's Revoke, which the card has no room for. */}
            {phone && (
              <Button
                variant="danger"
                className="mr-auto"
                pending={revoke.isPending}
                onClick={() =>
                  row !== null &&
                  revoke.mutate(row.invitation_id, { onSuccess: onClose })
                }
              >
                Revoke
              </Button>
            )}
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
            <WhatsAppLinkButton link={renew.data.link} name={row?.name} />
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
