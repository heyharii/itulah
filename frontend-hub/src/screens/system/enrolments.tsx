import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { ago, moment } from "@/lib/format"
import { gaKeys, gaLocations } from "@/lib/queries/ga"
import {
  approveEnrolment,
  issueEnrolment,
  listEnrolments,
  refuseEnrolment,
  systemKeys,
  type BootstrapReport,
  type Enrolment,
  type IssuedEnrolment,
} from "@/lib/queries/system"
import { saying } from "@/screens/system/units"

/// Machines waiting to become nodes, and codes nobody has used yet.
///
/// The claims come first and loudest: a machine in a shop is sitting on a
/// setup page showing six digits, and somebody there is on the phone. The
/// approval is the person at head office reading the same six digits back —
/// the number is derived from the code and the key the machine minted, so a
/// machine that is not the shop's shows a different one.
export function EnrolmentQueue() {
  const enrolments = useQuery({
    queryKey: systemKeys.enrolments(),
    queryFn: ({ signal }) => listEnrolments(signal),
    // A claim arrives while somebody is looking at this page; nothing else
    // would tell them.
    refetchInterval: 5_000,
  })

  // Held here, not on the row: approving turns the row APPROVED, the next
  // read drops it from this list, and a receipt kept on the row would vanish
  // with it before anybody had read which streams the node was sent.
  const [receipt, setReceipt] = useState<{
    site: string
    saying: string
  } | null>(null)

  const open = useMemo(
    () =>
      (enrolments.data ?? []).filter(
        (row) => row.status === "CLAIMED" || row.status === "ISSUED"
      ),
    [enrolments.data]
  )

  return (
    <>
      {receipt && (
        <Banner tone="ok" className="mb-3" onDismiss={() => setReceipt(null)}>
          {receipt.site} is enrolled. {receipt.saying}
        </Banner>
      )}
      {open.length > 0 && (
        <Card className="mb-3 divide-y divide-hairline">
          {open.map((row) =>
            row.status === "CLAIMED" ? (
              <ClaimRow
                key={row.enrolment_id}
                row={row}
                onApproved={(report) =>
                  setReceipt({
                    site: row.label ?? row.site_name ?? row.site_id,
                    saying: bootstrapSaying(report),
                  })
                }
              />
            ) : (
              <CodeRow key={row.enrolment_id} row={row} />
            )
          )}
        </Card>
      )}
    </>
  )
}

function grouped(verification: string | null) {
  if (!verification) return "—"
  return `${verification.slice(0, 3)} ${verification.slice(3)}`
}

/// What the new node was sent, as one sentence. A stream that failed is named,
/// because the fix is "send it again" and the person needs to know that.
function bootstrapSaying(report: BootstrapReport): string {
  const failed = Object.entries(report)
    .filter(
      ([, value]) =>
        typeof value === "object" && value !== null && "error" in value
    )
    .map(([stream]) => stream.replaceAll("_", " "))
  return failed.length === 0
    ? "Catalogue, prices, users and promotions are on their way to the node."
    : `Sent, except: ${failed.join(", ")}. Open the node and send its initial data again.`
}

function ClaimRow({
  row,
  onApproved,
}: {
  row: Enrolment
  onApproved: (report: BootstrapReport) => void
}) {
  const client = useQueryClient()
  const settle = () => {
    void client.invalidateQueries({ queryKey: systemKeys.enrolments() })
    void client.invalidateQueries({ queryKey: systemKeys.origins() })
    void client.invalidateQueries({ queryKey: systemKeys.fleet() })
  }
  const approve = useMutation({
    mutationFn: () => approveEnrolment(row.enrolment_id),
    onSuccess: (done) => {
      onApproved(done.bootstrap)
      settle()
    },
  })
  const refuse = useMutation({
    mutationFn: () => refuseEnrolment(row.enrolment_id),
    onSuccess: settle,
  })

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Pill tone="info">Waiting for approval</Pill>
            <span className="font-medium text-ink">
              {row.label ?? row.site_name ?? row.site_id}
            </span>
            <span className="text-meta text-mute">{row.node_role}</span>
          </div>
          <p className="mt-1.5 text-meta text-body">
            {row.machine?.hostname || "Unnamed machine"}
            {row.machine?.os ? ` · ${row.machine.os}` : ""}
            {row.machine?.version ? ` · v${row.machine.version}` : ""}
            {row.claimed_from ? ` · from ${row.claimed_from}` : ""} · claimed{" "}
            {ago(row.claimed_at)}
          </p>
        </div>
        <div className="text-right">
          <div className="text-meta text-mute">Verification</div>
          <div className="font-mono text-[1.75rem] leading-tight font-semibold tracking-wider text-ink tabular-nums">
            {grouped(row.verification)}
          </div>
        </div>
      </div>
      <p className="text-meta text-body">
        Ask the shop to read the number on its screen. Approve only if it is
        this one — a different number is a different machine.
      </p>
      {approve.isError && <Banner tone="bad">{saying(approve.error)}</Banner>}
      {refuse.isError && <Banner tone="bad">{saying(refuse.error)}</Banner>}
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={approve.isPending || refuse.isPending}
          onClick={() => approve.mutate()}
        >
          {approve.isPending ? "Approving…" : "The numbers match — approve"}
        </Button>
        <Button
          variant="quiet"
          disabled={approve.isPending || refuse.isPending}
          onClick={() => refuse.mutate()}
        >
          Refuse
        </Button>
      </div>
    </div>
  )
}

function CodeRow({ row }: { row: Enrolment }) {
  const client = useQueryClient()
  const revoke = useMutation({
    mutationFn: () => refuseEnrolment(row.enrolment_id),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: systemKeys.enrolments() }),
  })
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2">
        <Pill tone="neutral">Code issued</Pill>
        <span className="text-ink">
          {row.label ?? row.site_name ?? row.site_id}
        </span>
        <span className="text-meta text-mute">
          by {row.issued_by} · valid until {moment(row.expires_at)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {revoke.isError && (
          <span className="text-meta text-bad-fg">{saying(revoke.error)}</span>
        )}
        <Button
          size="sm"
          variant="quiet"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate()}
        >
          Revoke
        </Button>
      </div>
    </div>
  )
}

const LIFETIMES = [
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 1440, label: "1 day" },
]

/// Issue a code for a site. The code is shown here once; no read returns it.
export function InstallSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [siteId, setSiteId] = useState("")
  const [role, setRole] = useState("STORE")
  const [label, setLabel] = useState("")
  const [ttl, setTtl] = useState(60)
  const [issued, setIssued] = useState<IssuedEnrolment | null>(null)

  const sites = useQuery({
    queryKey: gaKeys.locations({}),
    queryFn: ({ signal }) => gaLocations({}, signal),
    enabled: open,
  })
  const choices = useMemo(
    () =>
      (sites.data ?? []).filter((site) =>
        role === "STORE"
          ? site.site_kind === "STORE"
          : site.site_kind !== "STORE"
      ),
    [sites.data, role]
  )

  const issue = useMutation({
    mutationFn: () =>
      issueEnrolment({
        site_id: siteId,
        node_role: role,
        label: label.trim() || undefined,
        ttl_minutes: ttl,
      }),
    onSuccess: (done) => {
      setIssued(done)
      void client.invalidateQueries({ queryKey: systemKeys.enrolments() })
    },
  })

  /// The code goes with the sheet: a code left in a closed sheet is a
  /// credential sitting in a form nobody is looking at.
  function close() {
    setIssued(null)
    setSiteId("")
    setLabel("")
    issue.reset()
    onClose()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title="Install a server"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={close}>
            {issued ? "Done" : "Cancel"}
          </Button>
          {!issued && (
            <Button
              variant="primary"
              disabled={siteId === "" || issue.isPending}
              onClick={() => issue.mutate()}
            >
              {issue.isPending ? "Issuing…" : "Issue code"}
            </Button>
          )}
        </div>
      }
    >
      {issued ? (
        <div className="flex flex-col gap-5">
          <div className="rounded-inner border border-dashed border-hairline-2 py-6 text-center">
            <div className="text-meta text-mute">Activation code</div>
            <div className="mt-1 font-mono text-[2rem] font-semibold tracking-wider text-ink select-all">
              {issued.code}
            </div>
            <div className="mt-1 text-meta text-mute">
              valid until {moment(issued.expires_at)} · one machine, once
            </div>
          </div>
          <Facts>
            <Fact term="Site">{issued.site_id}</Fact>
            <Fact term="Role">{issued.node_role}</Fact>
          </Facts>
          <ol className="list-decimal space-y-1.5 pl-5 text-[0.875rem] text-body">
            <li>Install the store server on the shop machine.</li>
            <li>
              On that machine, open{" "}
              <span className="font-mono">http://localhost:8082/setup</span> and
              enter this code.
            </li>
            <li>
              The machine shows a six-digit number. It appears on this page as a
              claim — approve it when the shop reads you the same number.
            </li>
          </ol>
          <Banner tone="warn">
            This code is shown once. Closing the sheet forgets it; issue a new
            one if it is lost — the new code cancels this one.
          </Banner>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Role">
              <Select
                value={role}
                onChange={(next) => {
                  setRole(next)
                  setSiteId("")
                }}
              >
                <option value="STORE">Store</option>
                <option value="DC">Warehouse (DC)</option>
              </Select>
            </Field>
            <Field label="Code valid for">
              <Select
                value={String(ttl)}
                onChange={(next) => setTtl(Number(next))}
              >
                {LIFETIMES.map((choice) => (
                  <option key={choice.minutes} value={choice.minutes}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label="Site"
            hint="A site that already has a server gets a replacement: the old machine is locked out once the new one is approved."
          >
            <Select value={siteId} onChange={setSiteId}>
              <option value="" disabled>
                {sites.isPending ? "Loading sites…" : "Choose a site"}
              </option>
              {choices.map((site) => (
                <option key={site.site_id} value={site.site_id}>
                  {site.site_name} ({site.site_id})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Label"
            hint="What a person calls this server. Optional."
          >
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          {issue.isError && <Banner tone="bad">{saying(issue.error)}</Banner>}
        </div>
      )}
    </Sheet>
  )
}
