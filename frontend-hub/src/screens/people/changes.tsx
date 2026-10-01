import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState, Problem } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import {
  CHANGE_KIND_LABEL,
  CHANGE_STATE_LABEL,
  hrEmployeeKeys,
  nameOf,
  useChangeProposals,
  useEveryEmployee,
} from "@/lib/queries/hr-employees"
import {
  decideChangeProposal,
  type ChangeProposalView,
} from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { EmployeePick } from "@/screens/people/employee-pick"

type Slice = "PENDING" | "ALL"

const STATE_TONE: Readonly<Record<string, "warn" | "ok" | "bad" | "neutral">> =
  {
    PENDING: "warn",
    APPROVED: "ok",
    REJECTED: "bad",
    WITHDRAWN: "neutral",
  }

function summary(change: ChangeProposalView): string {
  const first = change.props[0]
  if (first === undefined) return "—"
  const more = change.props.length > 1 ? ` +${change.props.length - 1}` : ""
  return `${first.field}: ${first.from || "—"} → ${first.to}${more}`
}

/// Every proposed change to somebody's employment — a transfer, a promotion,
/// a new salary, a separation — and where it stands. A proposal is filed on
/// the person's sheet (Change tab); head office approves or rejects it here,
/// and it applies on the day it takes effect.
export function EmployeeChanges() {
  const canWrite = useCanWrite()
  const changes = useChangeProposals()
  const people = useEveryEmployee()
  const [slice, setSlice] = useState<Slice>("PENDING")
  const [openId, setOpenId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const all = changes.data ?? []
  const rows = (
    slice === "PENDING" ? all.filter((one) => one.state === "PENDING") : all
  )
    .slice()
    .sort((a, b) => b.effective_on.localeCompare(a.effective_on))
  const open = all.find((one) => one.id === openId) ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Employee changes"
        sub="Transfers, promotions, salary changes and separations — proposed, then decided."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => setStarting(true)}>
              New change
            </Button>
          )
        }
      />

      <Toolbar>
        <Segmented<Slice>
          options={[
            { value: "PENDING", label: "Waiting" },
            { value: "ALL", label: "All" },
          ]}
          value={slice}
          onChange={setSlice}
        />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute tabular-nums">
          {count(rows.length)} {rows.length === 1 ? "change" : "changes"}
        </span>
      </Toolbar>

      <Card className="overflow-hidden px-4 py-3">
        {changes.isPending ? (
          <LoadingState>Loading changes…</LoadingState>
        ) : changes.isError ? (
          <Problem error={changes.error} />
        ) : rows.length === 0 ? (
          <EmptyState>
            {slice === "PENDING"
              ? "No change is waiting for a decision. “New change” in the header proposes one."
              : "No change has been proposed yet."}
          </EmptyState>
        ) : (
          <MiniTable head={["Who", "Kind", "What", "Effective", "State"]}>
            {rows.map((change) => (
              <MiniRow key={change.id}>
                <MiniCell>
                  <button
                    type="button"
                    onClick={() => setOpenId(change.id)}
                    className="font-medium text-ink hover:underline"
                  >
                    {nameOf(people.data, change.employee_id)}
                  </button>
                </MiniCell>
                <MiniCell align="right">
                  {CHANGE_KIND_LABEL[change.kind] ?? change.kind}
                </MiniCell>
                <MiniCell align="right">{summary(change)}</MiniCell>
                <MiniCell align="right">{day(change.effective_on)}</MiniCell>
                <MiniCell align="right">
                  <Pill tone={STATE_TONE[change.state] ?? "neutral"}>
                    {CHANGE_STATE_LABEL[change.state] ?? change.state}
                  </Pill>
                </MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
        )}
      </Card>

      <ChangeSheet
        change={open}
        canWrite={canWrite}
        who={open === null ? "" : nameOf(people.data, open.employee_id)}
        onClose={() => setOpenId(null)}
      />
      <NewChangeSheet open={starting} onClose={() => setStarting(false)} />
    </PageContent>
  )
}

function ChangeSheet({
  change,
  who,
  canWrite,
  onClose,
}: {
  change: ChangeProposalView | null
  who: string
  canWrite: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [note, setNote] = useState("")
  const decide = useMutation({
    mutationFn: (approved: boolean) =>
      decideChangeProposal(change?.id ?? "", {
        approved,
        reason: note.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: hrEmployeeKeys.changes() })
      setNote("")
      onClose()
    },
  })
  const close = () => {
    decide.reset()
    setNote("")
    onClose()
  }
  const waiting = change?.state === "PENDING"

  return (
    <Sheet
      open={change !== null}
      onOpenChange={(next) => !next && close()}
      title={
        change === null
          ? "Change"
          : `${CHANGE_KIND_LABEL[change.kind] ?? change.kind} · ${who}`
      }
      badge={
        change === null ? undefined : (
          <Pill tone={STATE_TONE[change.state] ?? "neutral"}>
            {CHANGE_STATE_LABEL[change.state] ?? change.state}
          </Pill>
        )
      }
      footer={
        waiting && canWrite ? (
          <div className="flex justify-end gap-2">
            <Button
              variant="danger"
              disabled={note.trim() === ""}
              pending={decide.isPending}
              onClick={() => decide.mutate(false)}
            >
              Reject
            </Button>
            <Button
              variant="primary"
              disabled={note.trim() === ""}
              pending={decide.isPending}
              onClick={() => decide.mutate(true)}
            >
              Approve
            </Button>
          </div>
        ) : undefined
      }
    >
      {change !== null && (
        <div className="flex flex-col gap-4">
          <div>
            <KeyValue term="Employee">
              <AppLink
                to="/people"
                sheet={{ key: "employee", value: change.employee_id }}
                className="hover:underline"
              >
                {who}
              </AppLink>
            </KeyValue>
            <KeyValue term="Effective">{day(change.effective_on)}</KeyValue>
            <KeyValue term="Filed by">{change.filed_by}</KeyValue>
            {change.decided_by !== null && (
              <KeyValue term="Decided by">{change.decided_by}</KeyValue>
            )}
            {change.applied_at !== null && (
              <KeyValue term="Applied">{day(change.applied_at)}</KeyValue>
            )}
          </div>
          <div>
            <p className="mb-1 text-[0.875rem] text-mute">What changes</p>
            {change.props.length === 0 ? (
              <p className="text-[0.875rem] text-body">No field named.</p>
            ) : (
              change.props.map((prop) => (
                <KeyValue key={prop.field} term={prop.field}>
                  {prop.from || "—"} → {prop.to}
                </KeyValue>
              ))
            )}
          </div>
          <div>
            <p className="mb-1 text-[0.875rem] text-mute">Why</p>
            <p className="text-[0.875rem] whitespace-pre-wrap text-body">
              {change.reason}
            </p>
          </div>
          {change.decision_note !== null && (
            <div>
              <p className="mb-1 text-[0.875rem] text-mute">Decision note</p>
              <p className="text-[0.875rem] whitespace-pre-wrap text-body">
                {change.decision_note}
              </p>
            </div>
          )}
          {waiting && canWrite && (
            <Field label="Reason for the decision" required>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          )}
          <Problem error={decide.error} />
        </div>
      )}
    </Sheet>
  )
}

/// A change is proposed from the person's own sheet, where the forms for
/// status, posting, contract and pay already live. This picks the person and
/// takes you there, on the Change tab.
function NewChangeSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [who, setWho] = useState<string | null>(null)
  const close = () => {
    setWho(null)
    onClose()
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && close()}
      title="New change"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          {who === null ? (
            <Button variant="primary" disabled>
              Open their sheet
            </Button>
          ) : (
            <AppLink
              to="/people"
              sheet={{ key: "employee", value: who }}
              hash="change"
              variant="primary"
            >
              Open their sheet
            </AppLink>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-[0.875rem] text-body">
          Choose who the change is for. Their sheet opens on the Change tab,
          where the transfer, promotion, salary or separation is proposed.
        </p>
        <Field label="Employee" required>
          <EmployeePick
            value={who}
            onChange={setWho}
            statuses={["ACTIVE", "SUSPENDED"]}
          />
        </Field>
      </div>
    </Sheet>
  )
}
