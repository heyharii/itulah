import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Pill, Status } from "@/components/ui/pill"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { LoadingState } from "@/components/ui/states"
import { moment } from "@/lib/format"
import {
  advancesOf,
  claimsQuery,
  claimTypes,
  decideClaim,
  fileClaim,
  hrKeys,
  isoDay,
  readDate,
  returnClaim,
  rulesQuery,
  type ClaimRow,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import {
  Facts,
  Person,
  personCard,
  PersonPicker,
  Submit,
  useDecision,
} from "@/screens/hr/parts"
import { RefusedBanner } from "@/screens/hr/refused"
import {
  personByLogin,
  personName,
  requestState,
  useTeam,
  type Tone,
} from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import { money, parseMoneyToMinor } from "@itulah/contract/money"
import type { EmployeeList, PolicyView } from "@itulah/contract"

/// Claims and advances at this shop — the prototype's store Expenses.
///
/// "Karyawan mengajukan, kepala toko menyetujui nilai yang boleh diganti,
/// Finance membukukan dan membayar": the employee asks (in the app, or the
/// shop records it for them), the store head sanctions how much of it may be
/// paid back — line by line, against head office's limits — and Finance books
/// and pays. The decision and its posting share one transaction at the centre,
/// so there is no moment a claim reads approved and the books have not heard.
///
/// Two people, always: whoever filed a claim cannot sanction it, and the centre
/// compares actors rather than keys. A claim the store head records here for a
/// colleague therefore waits for somebody else's decision — which is the rule
/// working, not a fault.
///
/// Advances are read-only here. They are the finance lane's, and every write to
/// one stays behind the finance routes; what a shop needs is to see who is
/// holding company money, and how much of it has come back.
export function HrExpenses() {
  const [recording, setRecording] = useState(false)
  return (
    <HrWorkspace
      primary={{ label: "New claim", onClick: () => setRecording(true) }}
    >
      {(scope) => (
        <Expenses
          scope={scope}
          recording={recording}
          onRecording={setRecording}
        />
      )}
    </HrWorkspace>
  )
}

/// What a claim's state is called: the module's four words, plus the two a
/// claim has of its own. Approved-and-unpaid is money owed — still "in motion"
/// with Finance — so it wears the info tone, and Paid is the settled one; who
/// the claim is waiting on is a fact in the sheet.
function claimState(state: string): { label: string; tone: Tone } {
  switch (state) {
    case "DRAFT":
      return { label: "Draft", tone: "neutral" }
    case "SUBMITTED":
      return requestState("PENDING")
    case "APPROVED":
      return { label: "Approved", tone: "info" }
    case "PAID":
      return { label: "Paid", tone: "ok" }
    default:
      return requestState(state)
  }
}

type Tab = "claims" | "advances"

function Expenses({
  scope,
  recording,
  onRecording,
}: {
  scope: StoreScope
  recording: boolean
  onRecording: (open: boolean) => void
}) {
  const [tab, setTab] = useState<Tab>("claims")
  const team = useTeam(scope)
  const claims = useQuery(claimsQuery(scope.unit_id))
  const limits = useQuery(rulesQuery("claim"))

  return (
    <>
      <PeopleTabs
        value={tab}
        onChange={setTab}
        tabs={[
          {
            value: "claims",
            label: "Claims",
            count: claims.data?.filter((claim) => claim.state === "SUBMITTED")
              .length,
          },
          { value: "advances", label: "Advances" },
        ]}
      />
      {tab === "claims" && (
        <Claims scope={scope} team={team.data} limits={limits.data ?? []} />
      )}
      {tab === "advances" && <Advances team={team} />}

      {recording && (
        <RecordClaim
          team={team.data}
          limits={limits.data ?? []}
          onClose={() => onRecording(false)}
          onDone={() => {
            onRecording(false)
            setTab("claims")
          }}
        />
      )}
    </>
  )
}

/// Head office's money limits, in one quiet line. Read, never restated.
function Limits({
  limits,
  className,
}: {
  limits: readonly PolicyView[]
  className?: string
}) {
  if (limits.length === 0) return null
  return (
    <p className={className ?? "mb-4 text-meta text-body"}>
      {limits
        .map(
          (rule) =>
            `${rule.label}: ${
              rule.unit === "RUPIAH"
                ? money(rule.value)
                : `${rule.value} ${rule.unit.toLowerCase()}`
            }`,
        )
        .join(" · ")}
    </p>
  )
}

// ── claims ──────────────────────────────────────────────────────────────────

function Claims({
  scope,
  team,
  limits,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
  limits: readonly PolicyView[]
}) {
  const claims = useQuery(claimsQuery(scope.unit_id))
  const [open, setOpen] = useState<ClaimRow | null>(null)

  return centreState(claims, {
    loading: "Reading the claims…",
    what: "this shop's claims",
    render: (rows) => {
      const waiting = rows.filter((claim) => claim.state === "SUBMITTED")
      const owed = rows.filter((claim) => claim.state === "APPROVED")
      const sorted = [...rows].sort((left, right) =>
        left.state === "SUBMITTED" && right.state !== "SUBMITTED"
          ? -1
          : right.state === "SUBMITTED" && left.state !== "SUBMITTED"
            ? 1
            : right.posted_on.localeCompare(left.posted_on),
      )
      return (
        <>
          <StatStrip>
            <Stat
              label="Pending"
              value={waiting.length}
              tone={waiting.length > 0 ? "warn" : undefined}
              sub={money(
                waiting.reduce((sum, claim) => sum + claim.claimed_minor, 0),
              )}
            />
            <Stat
              label="Approved, not yet paid"
              value={owed.length}
              sub={money(
                owed.reduce(
                  (sum, claim) => sum + (claim.sanctioned_minor ?? 0),
                  0,
                ),
              )}
            />
            <Stat label="Claims on record" value={rows.length} />
          </StatStrip>
          <Limits limits={limits} />
          <PeopleTable
            rows={sorted}
            rowKey={(claim) => claim.claim_id}
            onRowClick={setOpen}
            empty="No claims."
            card={(claim) => {
              const state = claimState(claim.state)
              const what = claim.lines
                .map((line) => line.description)
                .join(", ")
              return {
                ...personCard(
                  team,
                  claim.employee_id,
                  what === ""
                    ? []
                    : [<span className="line-clamp-2">{what}</span>],
                ),
                // The figure is what was sanctioned once somebody has decided,
                // and what was asked for until then.
                lead:
                  claim.sanctioned_minor === null
                    ? { figure: money(claim.claimed_minor), caption: "claimed" }
                    : {
                        figure: money(claim.sanctioned_minor),
                        caption: "approved",
                      },
                foot: {
                  info: <Status tone={state.tone}>{state.label}</Status>,
                  action: {
                    label: claim.state === "SUBMITTED" ? "Review" : "Open",
                    onClick: () => setOpen(claim),
                  },
                },
              }
            }}
            columns={[
              {
                key: "who",
                header: "Employee",
                cell: (claim) => <Person team={team} id={claim.employee_id} />,
              },
              {
                key: "claim",
                header: "Claim",
                className: "whitespace-normal",
                cell: (claim) => (
                  <span className="flex min-w-0 flex-col">
                    <span className="text-ink">
                      {claim.lines.map((line) => line.description).join(", ") ||
                        "—"}
                    </span>
                    <span className="text-meta text-mute">
                      <span className="font-mono">{claim.claim_number}</span> ·{" "}
                      {readDate(claim.posted_on)}
                    </span>
                  </span>
                ),
              },
              {
                key: "type",
                header: "Kind",
                cell: (claim) =>
                  [...new Set(claim.lines.map((line) => line.type_name))].join(
                    ", ",
                  ),
              },
              {
                key: "claimed",
                header: "Claimed",
                align: "right",
                cell: (claim) => money(claim.claimed_minor),
              },
              {
                key: "sanctioned",
                header: "Approved",
                align: "right",
                cell: (claim) =>
                  claim.sanctioned_minor === null ? (
                    "—"
                  ) : (
                    <span className="flex flex-col items-end">
                      {money(claim.sanctioned_minor)}
                      {claim.sanctioned_minor < claim.claimed_minor && (
                        <span className="text-meta text-warn-fg">
                          −{money(claim.claimed_minor - claim.sanctioned_minor)}{" "}
                          not paid back
                        </span>
                      )}
                    </span>
                  ),
              },
              {
                key: "state",
                header: "Status",
                cell: (claim) => {
                  const state = claimState(claim.state)
                  return <Status tone={state.tone}>{state.label}</Status>
                },
              },
            ]}
          />
          {open !== null && (
            <ClaimSheet
              key={open.claim_id}
              claim={open}
              team={team}
              scope={scope}
              onClose={() => setOpen(null)}
            />
          )}
        </>
      )
    },
  })
}

/// "SENT_BACK" → "Sent back".
function actionWord(action: string): string {
  const spaced = action.toLowerCase().replace(/_/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/// One claim, and the store head's sanction of it — a figure per line.
///
/// Each line starts at what was claimed; the store head brings any line down to
/// what head office's limit allows. The centre refuses a line sanctioned to
/// nothing (a claim worth nothing is rejected or sent back instead) and totals
/// the lines itself rather than trusting this arithmetic.
function ClaimSheet({
  claim,
  team,
  scope,
  onClose,
}: {
  claim: ClaimRow
  team: EmployeeList | undefined
  scope: StoreScope
  onClose: () => void
}) {
  const client = useQueryClient()
  const [figures, setFigures] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      claim.lines.map((line) => [
        line.line_id,
        String(line.sanctioned_minor ?? line.claimed_minor),
      ]),
    ),
  )
  const sanctions = claim.lines.map((line) => ({
    lineId: line.line_id,
    sanctionedMinor: parseMoneyToMinor(figures[line.line_id] ?? "") ?? 0,
  }))
  const invalid = claim.lines.some((line, index) => {
    const value = sanctions[index]?.sanctionedMinor ?? 0
    return value <= 0 || value > line.claimed_minor
  })
  const refresh = () => {
    client.invalidateQueries({ queryKey: hrKeys.claims() })
    onClose()
  }

  const decide = useMutation({
    mutationFn: (input: { approve: boolean; reason: string }) =>
      decideClaim({ claimId: claim.claim_id, sanctions, ...input }),
    onSuccess: refresh,
  })
  const sendBack = useMutation({
    mutationFn: (reason: string) =>
      returnClaim({ claimId: claim.claim_id, reason }),
    onSuccess: refresh,
  })
  const state = claimState(claim.state)
  const deciding = claim.state === "SUBMITTED"
  const decision = useDecision({
    placeholder: "Taxi receipt checked",
    pending: decide.isPending || sendBack.isPending,
    error: decide.error ?? sendBack.error,
    onDecide: (approve, reason) => {
      if (approve && invalid) return
      decide.mutate({ approve, reason })
    },
    // The third way out, between Reject and Approve: the claim goes back to
    // the person to put right rather than being closed.
    extra: (reason) => (
      <Button
        disabled={
          reason.trim() === "" || sendBack.isPending || decide.isPending
        }
        onClick={() => sendBack.mutate(reason)}
      >
        Send back
      </Button>
    ),
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={claim.claim_number}
      crumb="Claim"
      title={claim.employee_name ?? personName(team, claim.employee_id)}
      sub={`${readDate(claim.posted_on)} · ${scope.label}`}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
      foot={deciding ? decision.footer : undefined}
    >
      <Facts
        rows={[
          ["Filed by", personByLogin(team, claim.claimed_by)],
          // Who is being waited on is a fact here, not part of the state's name.
          claim.state === "SUBMITTED" && ["Waiting on", "Store head"],
          claim.state === "APPROVED" && ["Waiting on", "Finance"],
          claim.decided_by !== null && [
            "Decided by",
            personByLogin(team, claim.decided_by),
          ],
          claim.decided_by !== null && ["Decided on", moment(claim.decided_at)],
          claim.decide_reason !== null && ["Why", claim.decide_reason, true],
          claim.paid_at !== null && [
            "Paid by",
            personByLogin(team, claim.paid_by),
          ],
          claim.paid_at !== null && ["Paid on", moment(claim.paid_at)],
        ]}
      />

      <SheetSection title="Lines" className="mt-6">
        <div className="flex flex-col divide-y divide-hairline rounded-inner border border-hairline">
          {claim.lines.map((line) => (
            <div key={line.line_id} className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-cell text-ink">
                  {line.description}
                  <span className="block text-meta text-mute">
                    {line.type_name} · spent {readDate(line.spent_on)}
                  </span>
                </span>
                <span className="text-cell text-ink tabular-nums">
                  {money(line.claimed_minor)}
                </span>
              </div>
              {deciding ? (
                <Field
                  label="Paid back"
                  required
                  problem={
                    (parseMoneyToMinor(figures[line.line_id] ?? "") ?? 0) >
                    line.claimed_minor
                      ? "More than was claimed."
                      : (parseMoneyToMinor(figures[line.line_id] ?? "") ?? 0) <=
                          0
                        ? "Enter an amount, or reject the claim."
                        : undefined
                  }
                >
                  <Input
                    inputMode="numeric"
                    value={figures[line.line_id] ?? ""}
                    onChange={(event) =>
                      setFigures((current) => ({
                        ...current,
                        [line.line_id]: event.target.value.replace(
                          /[^\d]/g,
                          "",
                        ),
                      }))
                    }
                  />
                </Field>
              ) : (
                line.sanctioned_minor !== null && (
                  <div className="flex justify-between text-meta text-body">
                    <span>Paid back</span>
                    <span className="tabular-nums">
                      {money(line.sanctioned_minor)}
                    </span>
                  </div>
                )
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between px-1 text-cell font-semibold text-ink">
          <span>{deciding ? "To approve" : "Approved"}</span>
          <span className="tabular-nums">
            {deciding
              ? money(
                  sanctions.reduce((sum, one) => sum + one.sanctionedMinor, 0),
                )
              : claim.sanctioned_minor === null
                ? "—"
                : money(claim.sanctioned_minor)}
          </span>
        </div>
      </SheetSection>

      {claim.history.length > 0 && (
        <SheetSection title="History">
          <ul className="flex flex-col gap-1.5">
            {claim.history.map((event, index) => (
              <li key={`${event.at}-${index}`} className="text-meta text-body">
                <span className="text-ink">{actionWord(event.action)}</span> ·{" "}
                {personByLogin(team, event.actor)} · {moment(event.at)}
                {event.reason !== null && ` — ${event.reason}`}
              </li>
            ))}
          </ul>
        </SheetSection>
      )}

      {deciding && decision.field}
    </PeopleSheet>
  )
}

/// A new claim for one of this shop's people — the prototype's *Catat klaim*.
/// Filed and sent in at once; decided by somebody other than whoever filed it.
function RecordClaim({
  team,
  limits,
  onClose,
  onDone,
}: {
  team: EmployeeList | undefined
  limits: readonly PolicyView[]
  onClose: () => void
  onDone: () => void
}) {
  const client = useQueryClient()
  const kinds = useQuery({
    queryKey: hrKeys.claimTypes(),
    queryFn: ({ signal }) => claimTypes(signal),
    staleTime: 5 * 60_000,
  })
  const [employeeId, setEmployeeId] = useState("")
  const [typeCode, setTypeCode] = useState("")
  const [description, setDescription] = useState("")
  const [amount, setAmount] = useState("")
  const [spentOn, setSpentOn] = useState(isoDay(new Date()))
  const [reason, setReason] = useState("")
  const minor = parseMoneyToMinor(amount)

  const file = useMutation({
    mutationFn: () =>
      fileClaim({
        employeeId,
        lines: [
          {
            typeCode,
            description,
            spentOn,
            amountMinor: minor ?? 0,
          },
        ],
        reason: reason.trim() === "" ? description : reason,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.claims() })
      onDone()
    },
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="New claim"
      foot={
        <Submit
          label="Create claim"
          pendingLabel="Creating…"
          pending={file.isPending}
          disabled={
            employeeId === "" ||
            typeCode === "" ||
            description.trim() === "" ||
            minor === null ||
            minor <= 0 ||
            spentOn === ""
          }
          error={file.error}
          onSubmit={() => file.mutate()}
          onCancel={onClose}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <PersonPicker
          team={team}
          value={employeeId}
          onChange={setEmployeeId}
          label="Employee"
          required
        />
        <Field label="Kind of expense" required>
          <Select value={typeCode} onChange={setTypeCode}>
            <option value="">Choose…</option>
            {(kinds.data ?? [])
              .filter((kind) => kind.retired_at === null)
              .map((kind) => (
                <option key={kind.code} value={kind.code}>
                  {kind.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="What it was" required>
          <Input
            value={description}
            placeholder="Taxi to the Gudang"
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Amount (Rp)"
            required
            hint={minor === null || minor <= 0 ? undefined : money(minor)}
          >
            <Input
              inputMode="numeric"
              value={amount}
              placeholder="120000"
              onChange={(event) =>
                setAmount(event.target.value.replace(/[^\d]/g, ""))
              }
            />
          </Field>
          <Field label="Spent on" required>
            <Input
              type="date"
              value={spentOn}
              max={isoDay(new Date())}
              onChange={(event) => setSpentOn(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Purpose">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Limits limits={limits} className="text-meta text-body" />
      </div>
    </PeopleSheet>
  )
}

// ── advances ────────────────────────────────────────────────────────────────

/// "OPEN" → "Open", "PART_SETTLED" → "Part settled".
function statusWord(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ")
}

function Advances({ team }: { team: UseQueryResult<EmployeeList> }) {
  const people = (team.data?.rows ?? []).filter(
    (person) => person.status === "ACTIVE",
  )
  const reads = useQueries({
    queries: people.map((person) => ({
      queryKey: hrKeys.advancesOf(person.employee_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        advancesOf(person.employee_id, signal),
    })),
  })
  const refused = reads.find((read) => read.isError)
  const rows = reads.flatMap((read, index) =>
    (read.data ?? []).map((advance) => ({
      ...advance,
      employeeId: people[index]?.employee_id ?? "",
    })),
  )
  const outstanding = rows.reduce((sum, row) => sum + row.outstanding_minor, 0)
  // Nothing has come back yet: say so, rather than "No advances".
  const reading = reads.length > 0 && reads.every((read) => read.isPending)

  return centreState(team, {
    loading: "Reading the advances…",
    what: "this shop's people",
    render: (list) =>
      reading ? (
        <LoadingState>Reading the advances…</LoadingState>
      ) : (
        <>
          {refused !== undefined && (
            <RefusedBanner error={refused.error} what="this shop's advances" />
          )}
          <StatStrip>
            <Stat label="Advances on record" value={rows.length} />
            <Stat
              label="Still out"
              value={money(outstanding)}
              tone={outstanding > 0 ? "warn" : undefined}
            />
          </StatStrip>
          <PeopleTable
            rows={rows}
            rowKey={(row) => row.advance_id}
            empty="No advances."
            card={(row) => ({
              ...personCard(list, row.employeeId, [row.purpose]),
              lead: {
                figure: money(row.outstanding_minor),
                caption: "still out",
                muted: row.outstanding_minor === 0,
              },
              foot: {
                info: (
                  <Status tone={row.outstanding_minor > 0 ? "info" : "ok"}>
                    {statusWord(row.status)}
                  </Status>
                ),
              },
            })}
            columns={[
              {
                key: "who",
                header: "Employee",
                cell: (row) => <Person team={list} id={row.employeeId} />,
              },
              {
                key: "purpose",
                header: "Purpose",
                className: "whitespace-normal",
                cell: (row) => (
                  <span className="flex flex-col">
                    <span className="text-ink">{row.purpose}</span>
                    <span className="text-meta text-mute">
                      <span className="font-mono">{row.advance_number}</span> ·{" "}
                      {moment(row.requested_at)}
                    </span>
                  </span>
                ),
              },
              {
                key: "amount",
                header: "Advance",
                align: "right",
                cell: (row) => money(row.amount_minor),
              },
              {
                key: "settled",
                header: "Receipts",
                align: "right",
                cell: (row) => money(row.settled_minor),
              },
              {
                key: "back",
                header: "Returned",
                align: "right",
                cell: (row) => money(row.refunded_minor + row.recovered_minor),
              },
              {
                key: "left",
                header: "Still out",
                align: "right",
                cell: (row) => (
                  <span
                    className={
                      row.outstanding_minor > 0
                        ? "font-semibold text-warn-fg"
                        : undefined
                    }
                  >
                    {money(row.outstanding_minor)}
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (row) => (
                  <Status tone={row.outstanding_minor > 0 ? "info" : "ok"}>
                    {statusWord(row.status)}
                  </Status>
                ),
              },
            ]}
          />
        </>
      ),
  })
}
