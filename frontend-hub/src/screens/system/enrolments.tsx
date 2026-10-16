import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, Download } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
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
import { cn } from "@/lib/utils"
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
          pending={approve.isPending || refuse.isPending}
          onClick={() => approve.mutate()}
        >
          {approve.isPending ? "Approving…" : "The numbers match — approve"}
        </Button>
        <Button
          variant="quiet"
          pending={approve.isPending || refuse.isPending}
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
          pending={revoke.isPending}
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
      title={
        issued
          ? `Installing ${label.trim() || issued.site_id}`
          : "Install a server"
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={close}>
            {issued ? "Done" : "Cancel"}
          </Button>
          {!issued && (
            <Button
              variant="primary"
              pending={issue.isPending}
              disabled={siteId === ""}
              onClick={() => issue.mutate()}
            >
              {issue.isPending ? "Submitting…" : "Submit"}
            </Button>
          )}
        </div>
      }
    >
      {issued ? (
        <InstallJourney issued={issued} />
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
                <option value="DC">Warehouse</option>
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
            required
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

/// Where the packages are published. The CI workflow "Store server packages"
/// attaches the MSI and the Linux tarball to every `store-v*` release; a
/// deployment that mirrors them somewhere the shops can reach sets
/// `VITE_STORE_SERVER_DOWNLOADS`.
const DOWNLOADS =
  (import.meta.env.VITE_STORE_SERVER_DOWNLOADS as string | undefined) ??
  "https://github.com/heyharii/itulah/releases?q=store-v&expanded=true"

/// The address a new machine enrols against: head office's public address,
/// else wherever this hub is being served from. Read at call time — a module
/// constant would ask for `window` while the server imports the chunk.
function cloudUrl(): string {
  return (
    (import.meta.env.VITE_CLOUD_PUBLIC_URL as string | undefined) ??
    window.location.origin
  )
}

type Step = "download" | "code" | "match" | "done"
const STEPS: readonly { id: Step; title: string }[] = [
  { id: "download", title: "Get the installer" },
  { id: "code", title: "Give the machine its code" },
  { id: "match", title: "Match the number" },
  { id: "done", title: "Connected" },
]

/// The whole install as one live path: each step lights as the machine gets
/// there, read off the enrolment every few seconds, so nobody at head office
/// has to go looking for the claim in the queue behind the sheet.
function InstallJourney({ issued }: { issued: IssuedEnrolment }) {
  const [os, setOs] = useState<"windows" | "linux">("windows")
  const [approved, setApproved] = useState<string | null>(null)
  const enrolments = useQuery({
    queryKey: systemKeys.enrolments(),
    queryFn: ({ signal }) => listEnrolments(signal),
    refetchInterval: approved === null ? 3_000 : false,
  })
  const row = (enrolments.data ?? []).find(
    (one) => one.enrolment_id === issued.enrolment_id
  )
  const status = row?.status ?? "ISSUED"
  const dead =
    status === "EXPIRED" || status === "REVOKED" || status === "REJECTED"
  const at: Step =
    approved !== null || status === "APPROVED"
      ? "done"
      : status === "CLAIMED"
        ? "match"
        : "code"
  const reached = (step: Step) =>
    STEPS.findIndex((one) => one.id === step) <=
    STEPS.findIndex((one) => one.id === at)

  const command =
    os === "windows"
      ? // PowerShell, in the folder the installer was saved to: the file name
        // carries its version (central-store-server-<version>-x64.msi), so it is found
        // rather than typed.
        `msiexec /i (Get-ChildItem central-store-server-*-x64.msi)[0].FullName /qn ENROLL_CODE=${issued.code}`
      : // From the unpacked tarball (deploy/edge/install-store.sh): installs
        // the service and stages the code, so the node claims it on start.
        `sudo ./install-store.sh --code ${issued.code} --cloud ${cloudUrl()}`

  return (
    <div className="flex flex-col gap-5">
      {dead && (
        <Banner tone="bad">
          This code can no longer be used ({status.toLowerCase()}). Close the
          sheet and issue a new one.
        </Banner>
      )}
      <ol className="flex flex-col">
        {STEPS.map((step, index) => {
          const done = reached(step.id) && step.id !== at
          const here =
            step.id === at || (step.id === "download" && at === "code")
          const last = index === STEPS.length - 1
          return (
            <li
              key={step.id}
              className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3"
            >
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full text-[0.9375rem] font-semibold tabular-nums transition-colors duration-300",
                    done
                      ? "bg-ok text-on-dark"
                      : here
                        ? "bg-cta text-cta-fg ring-4 ring-accent-bg"
                        : "bg-soft text-mute"
                  )}
                >
                  {done ? <Check className="size-4 stroke-[2.5]" /> : index + 1}
                </span>
                {!last && (
                  <span
                    className={cn(
                      "my-1 w-px flex-1 transition-colors duration-300",
                      done ? "bg-ok" : "bg-hairline"
                    )}
                  />
                )}
              </div>
              <div className={cn("min-w-0 pt-1", !last && "pb-6")}>
                <h3
                  className={cn(
                    "text-[0.9375rem] font-semibold",
                    here || done ? "text-ink" : "text-mute"
                  )}
                >
                  {step.title}
                </h3>

                {step.id === "download" && (
                  <div className="mt-2.5 flex flex-col gap-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          ["windows", "Windows", "MSI · the shop PC"],
                          ["linux", "Linux", "tarball · a mini server"],
                        ] as const
                      ).map(([value, name, what]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setOs(value)}
                          aria-pressed={os === value}
                          className={cn(
                            "flex flex-col items-start rounded-inner border px-3.5 py-2.5 text-left transition-colors",
                            os === value
                              ? "border-ink bg-canvas"
                              : "border-hairline hover:border-hairline-strong"
                          )}
                        >
                          <span className="font-medium text-ink">{name}</span>
                          <span className="text-[0.9375rem] text-mute">
                            {what}
                          </span>
                        </button>
                      ))}
                    </div>
                    <a
                      href={DOWNLOADS}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 self-start text-[0.9375rem] font-medium text-accent hover:underline"
                    >
                      <Download className="size-4" />
                      Download the{" "}
                      {os === "windows" ? "Windows installer" : "Linux package"}
                    </a>
                  </div>
                )}

                {step.id === "code" && (
                  <div className="mt-2.5 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-3 rounded-inner border border-dashed border-hairline-strong px-4 py-3">
                      <span className="font-mono text-[1.625rem] font-semibold tracking-[0.12em] text-ink select-all">
                        {issued.code}
                      </span>
                      <CopyButton text={issued.code} />
                    </div>
                    <p className="text-[0.9375rem] text-body">
                      Type it on the machine&rsquo;s setup page,{" "}
                      <span className="font-mono">
                        http://localhost:8082/setup
                      </span>{" "}
                      — or install and enrol in one go
                      {os === "windows"
                        ? ", in PowerShell where the installer was saved:"
                        : ", from the unpacked package:"}
                    </p>
                    <div className="flex items-center gap-2 rounded-inner bg-soft px-3 py-2">
                      <code className="min-w-0 flex-1 truncate font-mono text-[0.9375rem] text-ink">
                        {command}
                      </code>
                      <CopyButton text={command} />
                    </div>
                    <Expiry until={issued.expires_at} />
                  </div>
                )}

                {step.id === "match" &&
                  (at === "match" && row ? (
                    <div className="mt-2.5 overflow-hidden rounded-inner border border-hairline">
                      <ClaimRow
                        row={row}
                        onApproved={(report) =>
                          setApproved(bootstrapSaying(report))
                        }
                      />
                    </div>
                  ) : at === "code" && !dead ? (
                    <p className="mt-1.5 flex items-center gap-2 text-[0.9375rem] text-mute">
                      <span className="relative flex size-2">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
                        <span className="relative inline-flex size-2 rounded-full bg-accent" />
                      </span>
                      Waiting for the machine to use the code…
                    </p>
                  ) : null)}

                {step.id === "done" && at === "done" && (
                  <p className="mt-1.5 text-[0.9375rem] text-body">
                    {approved ??
                      "Enrolled. Catalogue, prices, users and promotions are on their way to the machine."}{" "}
                    It shows up on Servers and Sync within a minute.
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="quiet"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1_500)
        })
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}

/// "Expires in 58 min", counting down, so a code about to die is noticed
/// before the shop types it.
function Expiry({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  const minutes = Math.max(0, Math.round((Date.parse(until) - now) / 60_000))
  return (
    <p
      className={cn(
        "text-[0.9375rem]",
        minutes <= 10 ? "text-warn-fg" : "text-mute"
      )}
    >
      {minutes === 0
        ? "The code has expired."
        : `Expires in ${minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${minutes} min`} · one machine, once. A new code cancels this one.`}
    </p>
  )
}
