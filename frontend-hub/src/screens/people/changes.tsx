import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import type { PersonalDataRequestView } from "@itulah/contract"
import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  LoadingState,
  Problem,
} from "@/components/ui/states"
import { count, day } from "@/lib/format"
import {
  CHANGE_KIND_LABEL,
  CHANGE_STATE_LABEL,
  DATA_FIELD_LABEL,
  decideDataRequest,
  hrEmployeeKeys,
  nameOf,
  useChangeProposals,
  useDataRequests,
  useEveryEmployee,
} from "@/lib/queries/hr-employees"
import { useUnits } from "@/lib/queries/organisation"
import {
  decideChangeProposal,
  fileChangeProposal,
  useReachableUnits,
  type ChangeProposalView,
} from "@/lib/queries/people"
import { problemOf } from "@/lib/problem"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { EmployeePick } from "@/screens/people/employee-pick"

type Slice = "PENDING" | "ALL"
type Page = "EMPLOYMENT" | "DETAILS"

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
  const [page, setPage] = useState<Page>("EMPLOYMENT")
  const [starting, setStarting] = useState(false)
  const waiting = useDataRequests(false)
  const waitingCount = waiting.data?.length ?? 0

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
        <Segmented<Page>
          options={[
            { value: "EMPLOYMENT", label: "Employment" },
            {
              value: "DETAILS",
              label: `Detail requests (${count(waitingCount)})`,
            },
          ]}
          value={page}
          onChange={setPage}
        />
      </Toolbar>

      {page === "EMPLOYMENT" ? (
        <EmploymentChanges canWrite={canWrite} />
      ) : (
        <DetailRequests canWrite={canWrite} />
      )}

      <NewChangeSheet open={starting} onClose={() => setStarting(false)} />
    </PageContent>
  )
}

function EmploymentChanges({ canWrite }: { canWrite: boolean }) {
  const changes = useChangeProposals()
  const people = useEveryEmployee()
  const [slice, setSlice] = useState<Slice>("PENDING")
  const [openId, setOpenId] = useState<string | null>(null)

  const all = changes.data ?? []
  const rows = (
    slice === "PENDING" ? all.filter((one) => one.state === "PENDING") : all
  )
    .slice()
    .sort((a, b) => b.effective_on.localeCompare(a.effective_on))
  const open = all.find((one) => one.id === openId) ?? null

  return (
    <>
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
    </>
  )
}

/// Employees' own requests to change their phone, email or address. Approving
/// one changes the record; the person who filed it cannot decide it.
function DetailRequests({ canWrite }: { canWrite: boolean }) {
  const [slice, setSlice] = useState<Slice>("PENDING")
  const requests = useDataRequests(slice === "ALL")
  const units = useReachableUnits().data ?? []
  const unitName = (id: string | null) =>
    id === null ? "—" : (units.find((one) => one.id === id)?.name ?? id)
  const [openId, setOpenId] = useState<string | null>(null)
  const rows = requests.data ?? []
  const open = rows.find((one) => one.id === openId) ?? null

  return (
    <>
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
          {count(rows.length)} {rows.length === 1 ? "request" : "requests"}
        </span>
      </Toolbar>

      <Card className="overflow-hidden px-4 py-3">
        {queryState(requests, {
          loading: "Loading requests…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {slice === "PENDING"
                  ? "No detail request is waiting for a decision."
                  : "Nobody has asked to change their details yet."}
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Person",
                  "Unit",
                  "What",
                  "Now",
                  "Asked",
                  "Filed",
                  "State",
                ]}
              >
                {rows.map((request) => (
                  <MiniRow key={request.id}>
                    <MiniCell>
                      <button
                        type="button"
                        onClick={() => setOpenId(request.id)}
                        className="font-medium text-ink hover:underline"
                      >
                        {request.full_name ?? request.employee_code}
                      </button>
                    </MiniCell>
                    <MiniCell align="right">
                      {unitName(request.unit_id)}
                    </MiniCell>
                    <MiniCell align="right">
                      {DATA_FIELD_LABEL[request.field] ?? request.field}
                    </MiniCell>
                    <MiniCell align="right">{request.current ?? "—"}</MiniCell>
                    <MiniCell align="right">{asked(request)}</MiniCell>
                    <MiniCell align="right">{day(request.filed_at)}</MiniCell>
                    <MiniCell align="right">
                      <Pill tone={STATE_TONE[request.state] ?? "neutral"}>
                        {CHANGE_STATE_LABEL[request.state] ?? request.state}
                      </Pill>
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </Card>

      <DataRequestSheet
        request={open}
        canWrite={canWrite}
        onClose={() => setOpenId(null)}
      />
    </>
  )
}

function asked(request: PersonalDataRequestView): string {
  return request.value === "" ? "clear it" : request.value
}

function DataRequestSheet({
  request,
  canWrite,
  onClose,
}: {
  request: PersonalDataRequestView | null
  canWrite: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const units = useReachableUnits().data ?? []
  const [note, setNote] = useState("")
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      decideDataRequest(request?.id ?? "", { approve, reason: note.trim() }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: hrEmployeeKeys.dataRequestsAll(),
      })
      setNote("")
      onClose()
    },
  })
  const close = () => {
    decide.reset()
    setNote("")
    onClose()
  }
  const waiting = request?.state === "PENDING"

  return (
    <Sheet
      open={request !== null}
      onOpenChange={(next) => !next && close()}
      title={
        request === null
          ? "Detail request"
          : `${DATA_FIELD_LABEL[request.field] ?? request.field} · ${request.full_name ?? request.employee_code}`
      }
      badge={
        request === null ? undefined : (
          <Pill tone={STATE_TONE[request.state] ?? "neutral"}>
            {CHANGE_STATE_LABEL[request.state] ?? request.state}
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
      {request !== null && (
        <div className="flex flex-col gap-4">
          <Facts>
            <Fact term="Person">
              {request.full_name ?? request.employee_code}
            </Fact>
            <Fact term="Unit">
              {request.unit_id === null
                ? "—"
                : (units.find((one) => one.id === request.unit_id)?.name ??
                  request.unit_id)}
            </Fact>
            <Fact term="What">
              {DATA_FIELD_LABEL[request.field] ?? request.field}
            </Fact>
            <Fact term="Filed">{day(request.filed_at)}</Fact>
          </Facts>
          <div>
            <KeyValue term="Now">{request.current ?? "—"}</KeyValue>
            <KeyValue term="Asked">{asked(request)}</KeyValue>
            <KeyValue term="Filed by">{request.filed_by}</KeyValue>
            {request.decided_by !== null && (
              <KeyValue term="Decided by">{request.decided_by}</KeyValue>
            )}
          </div>
          <div>
            <p className="mb-1 text-[0.875rem] text-mute">Their reason</p>
            <p className="text-[0.875rem] whitespace-pre-wrap text-body">
              {request.reason}
            </p>
          </div>
          {request.decision_reason !== null && (
            <div>
              <p className="mb-1 text-[0.875rem] text-mute">Decision note</p>
              <p className="text-[0.875rem] whitespace-pre-wrap text-body">
                {request.decision_reason}
              </p>
            </div>
          )}
          {waiting && canWrite && (
            <Field label="Why" required>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          )}
          {decide.error !== null && (
            <Banner tone="bad">{problemOf(decide.error)}</Banner>
          )}
        </div>
      )}
    </Sheet>
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
  const client = useQueryClient()
  const units = useUnits()
  const [who, setWho] = useState<string | null>(null)
  const [kind, setKind] = useState("TRANSFER")
  const [unit, setUnit] = useState("")
  const [position, setPosition] = useState("")
  const [grade, setGrade] = useState("")
  const [base, setBase] = useState("")
  const [on, setOn] = useState("")
  const [reason, setReason] = useState("")
  const close = () => {
    setWho(null)
    setKind("TRANSFER")
    setUnit("")
    setPosition("")
    setGrade("")
    setBase("")
    setOn("")
    setReason("")
    file.reset()
    onClose()
  }
  const props = (): {
    field: string
    to_text?: string
    to_minor?: number
  }[] => {
    switch (kind) {
      case "TRANSFER":
        return [{ field: "unit_id", to_text: unit }]
      case "PROMOTION":
        return [
          ...(position.trim() === ""
            ? []
            : [{ field: "position", to_text: position.trim() }]),
          ...(grade.trim() === ""
            ? []
            : [{ field: "grade", to_text: grade.trim() }]),
        ]
      case "SALARY":
        return [
          { field: "base_minor", to_minor: Number(base.replace(/\D/g, "")) },
        ]
      default:
        return []
    }
  }
  const complete =
    who !== null &&
    on !== "" &&
    reason.trim() !== "" &&
    (kind !== "TRANSFER" || unit !== "") &&
    (kind !== "PROMOTION" || position.trim() !== "" || grade.trim() !== "") &&
    (kind !== "SALARY" || base.replace(/\D/g, "") !== "")
  const file = useMutation({
    mutationFn: () =>
      fileChangeProposal(who ?? "", {
        kind,
        props: props(),
        effective_on: on,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: hrEmployeeKeys.changes() })
      close()
    },
  })
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
          <Button
            variant="primary"
            pending={file.isPending}
            disabled={!complete}
            onClick={() => file.mutate()}
          >
            Propose it
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-[0.875rem] text-body">
          Proposed here, decided by somebody else on the list; on approval the
          posting, contract, pay or exit is written for real.
        </p>
        <Field label="Employee" required>
          <EmployeePick
            value={who}
            onChange={setWho}
            statuses={["ACTIVE", "SUSPENDED"]}
          />
        </Field>
        <Field label="Change" required>
          <Select value={kind} onChange={setKind}>
            <option value="TRANSFER">Transfer to another place</option>
            <option value="PROMOTION">Promotion — position or grade</option>
            <option value="SALARY">Salary change</option>
            <option value="SEPARATION">Separation — last day</option>
          </Select>
        </Field>
        {kind === "TRANSFER" && (
          <Field label="To" required>
            <Select value={unit} onChange={setUnit}>
              {(units.data ?? []).map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {kind === "PROMOTION" && (
          <>
            <Field label="New position">
              <Input
                value={position}
                onChange={(event) => setPosition(event.target.value)}
              />
            </Field>
            <Field label="New grade">
              <Input
                value={grade}
                onChange={(event) => setGrade(event.target.value)}
              />
            </Field>
          </>
        )}
        {kind === "SALARY" && (
          <Field label="New base salary" required hint="Whole rupiah a month.">
            <Input
              value={base}
              inputMode="numeric"
              onChange={(event) => setBase(event.target.value)}
            />
          </Field>
        )}
        <Field
          label={kind === "SEPARATION" ? "Last day" : "Effective on"}
          required
        >
          <Day value={on} onChange={setOn} />
        </Field>
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {file.error !== null && (
          <Banner tone="bad">{problemOf(file.error)}</Banner>
        )}
      </div>
    </Sheet>
  )
}
