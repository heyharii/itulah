import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { day } from "@/lib/format"
import type { Tone } from "@/lib/format"
import {
  decideChangeProposal,
  fileChangeProposal,
  listChangeProposals,
  listEmployees,
  nextKeys,
  peopleKeys,
  useReach,
  type ChangeProposalView,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

/// Employment changes: the four decisions that rewrite who somebody is.
///
/// The shop files — the manager who can see the gap is the one who asks for
/// it — and head office answers, because a promotion, a transfer, a salary and
/// a separation are the employer's acts. On approval the server applies the
/// change through the kernels that already own the writes: assignments move,
/// contracts and pay gain an effective-dated row, a separation runs the
/// employment machine and opens the exit checklist. Nothing here duplicates a
/// kernel, and nothing is applied on the day it is filed — the proposal
/// carries the date it takes effect.
///
/// # One pending per person
///
/// The server refuses a second PENDING proposal for the same person, which is
/// what keeps "what happens to them on the 1st" a question with one answer.

const KINDS = ["PROMOTION", "TRANSFER", "SALARY", "SEPARATION"] as const
const KIND_LABEL: Record<(typeof KINDS)[number], string> = {
  PROMOTION: "Promotion / demotion",
  TRANSFER: "Transfer",
  SALARY: "Salary change",
  SEPARATION: "Separation",
}
const STATE_LABEL: Record<ChangeProposalView["state"], string> = {
  PENDING: "Waiting",
  APPROVED: "Applied",
  REJECTED: "Refused",
  WITHDRAWN: "Withdrawn",
}
const STATE_TONE: Record<ChangeProposalView["state"], Tone> = {
  PENDING: "warn",
  APPROVED: "ok",
  REJECTED: "bad",
  WITHDRAWN: "neutral",
}

export function Changes() {
  const client = useQueryClient()
  const reach = useReach()
  const [tab, setTab] = useState("pending")
  const [filing, setFiling] = useState(false)

  const pending = useQuery({
    queryKey: nextKeys.changes("PENDING"),
    queryFn: ({ signal }) => listChangeProposals({ state: "PENDING" }, signal),
  })
  const all = useQuery({
    queryKey: nextKeys.changes(),
    queryFn: ({ signal }) => listChangeProposals({}, signal),
  })
  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) => listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  const people = (team.data ?? []).map((person) => ({ id: person.employee_id, name: person.full_name ?? person.employee_code ?? person.employee_id }))
  const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? id

  const decided = (all.data ?? []).filter((row) => row.state !== "PENDING")
  const rows = tab === "pending" ? (pending.data ?? []) : decided
  const shown = tab === "pending" ? pending : all

  // The deciding half of the screen is the employer's; the server refuses
  // the filer and the rung again, so this is convenience, not the control.
  const employer = reach.data?.role === "ADMIN"

  return (
    <PageContent>
      <PageHeader
        crumb="People · Talent"
        title="Employment changes"
        sub="The shop asks, head office answers, and an approved change is applied to the record on the day it takes effect — not the day it was filed."
        actions={
          <Button variant="ghost" onClick={() => setFiling(true)}>
            File a change
          </Button>
        }
      />

      <SubTabs
        tabs={[
          { value: "pending", label: `Waiting (${pending.data?.length ?? 0})` },
          { value: "history", label: `Decided (${decided.length})` },
        ]}
        value={tab}
        onChange={setTab}
      />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>
            {tab === "pending" ? "Proposals waiting on head office" : "Decided proposals"}
          </CardTitle>
        </CardHeader>
        {queryState(shown, {
          loading: "Reading the proposals…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {tab === "pending"
                  ? "Nothing is waiting on head office."
                  : "No proposal has been decided yet."}
              </EmptyState>
            ) : (
              <div className="divide-y">
                {rows.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <Pill tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</Pill>
                        <span className="font-medium text-ink">
                          {nameOf(row.employee_id)}
                        </span>
                        <span className="text-meta text-body">
                          {KIND_LABEL[row.kind]} · from {day(row.effective_on)}
                        </span>
                      </div>
                      {row.props.length > 0 && (
                        <p className="mt-0.5 text-body">
                          {row.props
                            .map((p) => `${p.field}: ${p.from} → ${p.to}`)
                            .join(" · ")}
                        </p>
                      )}
                      <p className="text-meta text-mute">
                        {row.reason} — filed by {row.filed_by}
                        {row.decided_by ? ` · decided by ${row.decided_by}` : ""}
                      </p>
                    </div>
                    {tab === "pending" && employer ? (
                      <DecideControls
                        id={row.id}
                        onDone={() =>
                          client.invalidateQueries({ queryKey: nextKeys.changes() })
                        }
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            ),
        })}
      </Card>

      <FileSheet open={filing} onClose={() => setFiling(false)} />
    </PageContent>
  )
}

function DecideControls({ id, onDone }: { id: string; onDone: () => void }) {
  const [deciding, setDeciding] = useState<null | "approve" | "reject">(null)
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const decide = useMutation({
    mutationFn: (approved: boolean) => decideChangeProposal(id, { approved, reason }),
    onSuccess: () => {
      setDeciding(null)
      setReason("")
      onDone()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (deciding === null) {
    return (
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="primary" onClick={() => setDeciding("approve")}>
          Approve
        </Button>
        <Button size="sm" variant="danger" onClick={() => setDeciding("reject")}>
          Refuse
        </Button>
      </div>
    )
  }
  return (
    <div className="w-full space-y-2">
      <Field label={deciding === "approve" ? "Why it is approved" : "Why it is refused"}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {failed ? <Banner tone="bad">{failed}</Banner> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={reason.trim() === "" || decide.isPending}
          onClick={() => decide.mutate(deciding === "approve")}
        >
          Record the decision
        </Button>
        <Button size="sm" variant="quiet" onClick={() => setDeciding(null)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function FileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient()
  const [employeeId, setEmployeeId] = useState("")
  const [kind, setKind] = useState<(typeof KINDS)[number]>("PROMOTION")
  const [field, setField] = useState("position")
  const [toText, setToText] = useState("")
  const [toMinor, setToMinor] = useState("")
  const [effectiveOn, setEffectiveOn] = useState("")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) => listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  const people = (team.data ?? []).map((person) => ({
    id: person.employee_id,
    name: person.full_name ?? person.employee_code ?? person.employee_id,
  }))

  const file = useMutation({
    mutationFn: () =>
      fileChangeProposal(employeeId, {
        kind,
        props:
          kind === "SALARY"
            ? [{ field: "base_minor", to_minor: Number(toMinor) }]
            : kind === "TRANSFER"
              ? [{ field: "place_id", to_text: toText }]
              : [{ field, to_text: toText }],
        effective_on: effectiveOn,
        reason,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: nextKeys.changes() })
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (!open) return null
  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title="File a change"
      caption="Head office decides; nothing moves until it does."
    >
      <div className="space-y-3">
        <Field label="Who">
          <Select value={employeeId} onChange={setEmployeeId}>
            <option value="">Choose a person…</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What kind">
          <Select value={kind} onChange={(value) => setKind(value as (typeof KINDS)[number])}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        {kind === "SALARY" ? (
          <Field label="New base, whole rupiah">
            <Input
              inputMode="numeric"
              value={toMinor}
              onChange={(e) => setToMinor(e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
        ) : kind === "TRANSFER" ? (
          <Field label="Moving to place" hint="The place id, e.g. store-04">
            <Input value={toText} onChange={(e) => setToText(e.target.value)} />
          </Field>
        ) : (
          <>
            <Field label="Which field">
              <Select value={field} onChange={setField}>
                <option value="position">Position</option>
                <option value="grade">Grade</option>
              </Select>
            </Field>
            <Field label="Becomes">
              <Input value={toText} onChange={(e) => setToText(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Takes effect on">
          <Input type="date" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} />
        </Field>
        <Field label="Why">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {failed ? <Banner tone="bad">{failed}</Banner> : null}
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={
              employeeId === "" ||
              effectiveOn === "" ||
              reason.trim() === "" ||
              (kind === "SALARY" ? toMinor === "" : toText.trim() === "") ||
              file.isPending
            }
            onClick={() => file.mutate()}
          >
            File the proposal
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
