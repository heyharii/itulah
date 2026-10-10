import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"

import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { moment } from "@/lib/format"
import {
  applicantsAt,
  hireProposalsAt,
  hrKeys,
  isoDay,
  listApplicantInterviews,
  positions,
  proposeHire,
  readDate,
  recordInterview,
  scheduleInterview,
  staffingPlansAt,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import {
  Facts,
  Fenced,
  Heading,
  PersonPicker,
  Submit,
} from "@/screens/hr/parts"
import { personName, useTeam, type Tone } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import { money, parseMoneyToMinor } from "@itulah/contract/money"
import type {
  ApplicantView,
  EmployeeList,
  HireProposalView,
  InterviewView,
} from "@itulah/contract"

/// Recruitment, for a shop — the prototype's store Recruitment.
///
/// "Toko meminta tambahan orang dan menilai kandidat saat interview": the shop
/// asks for people and judges candidates at interview. The headcount plan, the
/// openings, the screening and the offer are head office's. So this screen
/// holds three things: the plan head office set for this shop (read-only), the
/// interviews the store head conducts (scheduled and scored here), and the
/// shop's own requests for somebody new (filed here, decided at head office).
///
/// The interviewer is chosen from this shop's own team, because who was in the
/// room is a fact about the room, not about the sign-in.
export function HrInterviews() {
  const [asking, setAsking] = useState(false)
  return (
    <HrWorkspace
      primary={{
        label: "Request a new employee",
        onClick: () => setAsking(true),
        icon: Plus,
      }}
    >
      {(scope) => (
        <Recruitment scope={scope} asking={asking} onAsking={setAsking} />
      )}
    </HrWorkspace>
  )
}

/// A hire proposal's state, as the prototype's `HOST` spells it.
function proposalState(state: string): { label: string; tone: Tone } {
  switch (state) {
    case "PROPOSED":
      return { label: "Waiting on head office", tone: "warn" }
    case "RETURNED":
      return { label: "Returned for changes", tone: "warn" }
    case "APPROVED":
      return { label: "Approved by head office", tone: "ok" }
    case "REJECTED":
      return { label: "Refused by head office", tone: "bad" }
    case "FILLED":
      return { label: "Filled", tone: "neutral" }
    default:
      return { label: state, tone: "neutral" }
  }
}

function interviewState(result: string): { label: string; tone: Tone } {
  if (result === "SCHEDULED") return { label: "Scheduled", tone: "warn" }
  if (result === "PASS") return { label: "Passed", tone: "ok" }
  if (result === "FAIL") return { label: "Did not pass", tone: "bad" }
  return { label: result, tone: "neutral" }
}

function Recruitment({
  scope,
  asking,
  onAsking,
}: {
  scope: StoreScope
  asking: boolean
  onAsking: (open: boolean) => void
}) {
  const team = useTeam(scope)
  const plans = useQuery({
    queryKey: hrKeys.plans(scope.unit_id),
    queryFn: ({ signal }) => staffingPlansAt(scope.unit_id, signal),
  })
  const proposals = useQuery({
    queryKey: hrKeys.hires(scope.unit_id),
    queryFn: ({ signal }) => hireProposalsAt(scope.unit_id, signal),
  })

  // In process: asked for and not yet refused or filled.
  const inProcess = (position: string) =>
    (proposals.data ?? [])
      .filter((proposal) =>
        ["PROPOSED", "RETURNED", "APPROVED"].includes(proposal.state),
      )
      .map((proposal) => latest(proposal))
      .filter((version) => version?.position === position)
      .reduce((sum, version) => sum + (version?.headcount ?? 0), 0)
  const filled = (position: string) =>
    (team.data?.rows ?? []).filter(
      (person) => person.status === "ACTIVE" && person.position === position,
    ).length

  return (
    <>
      <Heading>Headcount plan</Heading>
      {centreState(plans, {
        loading: "Loading…",
        what: "this shop's headcount plan",
        render: (rows) =>
          rows.length === 0 ? (
            <p className="mb-2 text-meta text-body">
              Head office has set no headcount plan for {scope.label}. A request
              is still possible; it is simply checked against nothing.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((plan) => {
                const have = filled(plan.position)
                const coming = inProcess(plan.position)
                const left = Math.max(0, plan.headcount - have - coming)
                return (
                  <Card key={plan.id} className="px-4 py-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate text-card-title font-semibold text-ink">
                        {plan.position}
                      </span>
                      <Pill tone="neutral">{plan.span}</Pill>
                    </div>
                    <Facts
                      rows={[
                        ["Planned", plan.headcount],
                        ["Filled", have],
                        ["In process", coming],
                        ["Room left", <b className="font-semibold">{left}</b>],
                      ]}
                    />
                  </Card>
                )
              })}
            </div>
          ),
      })}

      <Interviews scope={scope} team={team.data} />

      <Heading
        count={
          (proposals.data ?? []).filter(
            (proposal) => proposal.state === "PROPOSED",
          ).length
        }
      >
        This shop's requests
      </Heading>
      {centreState(proposals, {
        loading: "Loading…",
        what: "this shop's requests for new employees",
        render: (rows) => (
          <PeopleTable
            rows={rows}
            rowKey={(proposal) => proposal.id}
            empty="No requests yet."
            columns={[
              {
                key: "position",
                header: "Position",
                cell: (proposal) => {
                  const version = latest(proposal)
                  return (
                    <span className="flex flex-col">
                      <span className="font-medium text-ink">
                        {version === undefined
                          ? "—"
                          : `${version.headcount}× ${version.position}`}
                      </span>
                      <span className="text-meta text-mute">
                        {version?.need === "REPLACEMENT"
                          ? "Replacement"
                          : "Addition"}
                        {version !== undefined &&
                          ` · ${version.candidate_name}`}
                      </span>
                    </span>
                  )
                },
              },
              {
                key: "start",
                header: "Needed from",
                card: "meta",
                cell: (proposal) => {
                  const version = latest(proposal)
                  return version === undefined
                    ? "—"
                    : readDate(version.start_on)
                },
              },
              {
                key: "reason",
                header: "Reason",
                card: "meta",
                className: "whitespace-normal",
                cell: (proposal) => latest(proposal)?.filed_reason ?? "—",
              },
              {
                key: "answer",
                header: "Head office said",
                card: "meta",
                className: "whitespace-normal",
                cell: (proposal) => latest(proposal)?.decided_reason ?? "—",
              },
              {
                key: "state",
                header: "Status",
                card: "status",
                cell: (proposal) => {
                  const state = proposalState(proposal.state)
                  return <Pill tone={state.tone}>{state.label}</Pill>
                },
              },
            ]}
          />
        ),
      })}

      {asking && (
        <AskForSomebody scope={scope} onClose={() => onAsking(false)} />
      )}
    </>
  )
}

/// The version of a proposal that is in force — the one head office last saw.
function latest(proposal: HireProposalView) {
  return (
    proposal.versions.find(
      (version) => version.version === proposal.current_version,
    ) ?? proposal.versions[proposal.versions.length - 1]
  )
}

// ── interviews ──────────────────────────────────────────────────────────────

function Interviews({
  scope,
  team,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
}) {
  const applicants = useQuery({
    queryKey: hrKeys.applicants(),
    queryFn: ({ signal }) => applicantsAt(scope.unit_id, signal),
  })
  // The candidates still in play, and the ones this shop has already judged.
  const rows = (applicants.data?.rows ?? []).filter((row) =>
    ["SHORTLIST", "INTERVIEW", "OFFER", "REJECTED", "HIRED"].includes(
      row.stage,
    ),
  )
  const interviews = useQueries({
    queries: rows.map((row) => ({
      queryKey: hrKeys.interviewsOf(row.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listApplicantInterviews(row.id, signal),
    })),
  })
  const lastOf = (applicantId: string): InterviewView | undefined => {
    const index = rows.findIndex((row) => row.id === applicantId)
    const list = interviews[index]?.data ?? []
    return [...list].sort((left, right) =>
      right.scheduled_at.localeCompare(left.scheduled_at),
    )[0]
  }
  const [open, setOpen] = useState<ApplicantView | null>(null)
  const scheduled = rows.filter(
    (row) => lastOf(row.id)?.result === "SCHEDULED",
  ).length

  return (
    <>
      <Heading count={scheduled}>Interviews by the store head</Heading>
      {centreState(applicants, {
        loading: "Loading…",
        what: "this shop's candidates",
        render: (queue) => (
          <>
            <Fenced dropped={queue.elsewhere} place={scope.unit_id} />
            <PeopleTable
              rows={rows}
              rowKey={(row) => row.id}
              onRowClick={setOpen}
              empty="No candidates yet."
              columns={[
                {
                  key: "who",
                  header: "Candidate",
                  cell: (row) => (
                    <span className="flex flex-col">
                      <span className="font-medium text-ink">{row.name}</span>
                      <span className="text-meta text-mute">
                        {row.source.toLowerCase().replace(/_/g, " ")}
                        {row.referrer_employee_id !== null &&
                          ` · from ${personName(team, row.referrer_employee_id)}`}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "applied",
                  header: "Applied",
                  card: "meta",
                  cell: (row) => readDate(row.applied_on),
                },
                {
                  key: "when",
                  header: "Interview",
                  card: "meta",
                  cell: (row) => {
                    const last = lastOf(row.id)
                    return last === undefined
                      ? "not scheduled"
                      : moment(last.scheduled_at)
                  },
                },
                {
                  key: "by",
                  header: "Interviewer",
                  card: "meta",
                  cell: (row) => {
                    const last = lastOf(row.id)
                    return last === undefined
                      ? "—"
                      : personName(team, last.interviewer_employee_id)
                  },
                },
                {
                  key: "result",
                  header: "Result",
                  card: "status",
                  cell: (row) => {
                    const last = lastOf(row.id)
                    if (last === undefined)
                      return <Pill tone="neutral">To schedule</Pill>
                    const state = interviewState(last.result)
                    return <Pill tone={state.tone}>{state.label}</Pill>
                  },
                },
              ]}
            />
          </>
        ),
      })}
      {open !== null && (
        <InterviewSheet
          key={open.id}
          applicant={open}
          team={team}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}

/// The four things a store head scores a candidate on — the prototype's
/// `SKILLS`, keyed as the centre stores them.
const SKILLS = [
  ["kom", "Communication"],
  ["groom", "Grooming & attitude"],
  ["retail", "Retail experience"],
  ["teliti", "Care with cash & stock"],
] as const

/// One candidate: schedule their interview, or score it.
function InterviewSheet({
  applicant,
  team,
  onClose,
}: {
  applicant: ApplicantView
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const interviews = useQuery({
    queryKey: hrKeys.interviewsOf(applicant.id),
    queryFn: ({ signal }) => listApplicantInterviews(applicant.id, signal),
  })
  const pending = (interviews.data ?? []).find(
    (one) => one.result === "SCHEDULED",
  )
  const done = (interviews.data ?? []).filter(
    (one) => one.result !== "SCHEDULED",
  )

  const [when, setWhen] = useState("")
  const [interviewer, setInterviewer] = useState("")
  const [scores, setScores] = useState<Record<string, string>>({})
  const [result, setResult] = useState<"PASS" | "FAIL">("PASS")
  const [note, setNote] = useState("")

  const refresh = () => {
    client.invalidateQueries({ queryKey: hrKeys.applicants() })
    onClose()
  }
  const schedule = useMutation({
    mutationFn: () =>
      scheduleInterview({
        applicantId: applicant.id,
        scheduledAt: new Date(when).toISOString(),
        interviewerEmployeeId: interviewer,
        reason: `interview scheduled for ${applicant.name}`,
      }),
    onSuccess: refresh,
  })
  const record = useMutation({
    mutationFn: (interviewId: string) =>
      recordInterview({
        interviewId,
        result,
        ratings: Object.fromEntries(
          Object.entries(scores).map(([code, value]) => [code, Number(value)]),
        ),
        note,
        reason: `recorded ${result === "PASS" ? "a pass" : "a fail"} for ${applicant.name}`,
      }),
    onSuccess: refresh,
  })
  const allScored = SKILLS.every(([code]) => (scores[code] ?? "") !== "")

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Interview"
      title={applicant.name}
      sub={`Applied ${readDate(applicant.applied_on)}`}
      status={<Pill tone="neutral">{applicant.stage.toLowerCase()}</Pill>}
      foot={
        interviews.isPending ? undefined : pending !== undefined ? (
          <Submit
            label="Send the score to head office"
            pending={record.isPending}
            // A pass carries its evidence — the centre refuses one with no
            // ratings — and a note either way.
            disabled={note.trim() === "" || (result === "PASS" && !allScored)}
            error={record.error}
            onSubmit={() => record.mutate(pending.id)}
          />
        ) : ["SHORTLIST", "INTERVIEW"].includes(applicant.stage) ? (
          <Submit
            label="Schedule the interview"
            pending={schedule.isPending}
            disabled={when === "" || interviewer === ""}
            error={schedule.error}
            onSubmit={() => schedule.mutate()}
          />
        ) : undefined
      }
    >
      {done.map((one) => {
        const state = interviewState(one.result)
        return (
          <SheetSection
            key={one.id}
            title={`Interview · ${moment(one.scheduled_at)}`}
          >
            <div className="mb-2">
              <Pill tone={state.tone}>{state.label}</Pill>
            </div>
            <Facts
              rows={[
                ["Interviewer", personName(team, one.interviewer_employee_id)],
                ...SKILLS.map(
                  ([code, label]) =>
                    [
                      label,
                      one.ratings[code] === undefined
                        ? "—"
                        : `${one.ratings[code]} / 5`,
                    ] as const,
                ),
                one.note !== null && ["Note", one.note],
              ]}
            />
          </SheetSection>
        )
      })}

      {interviews.isPending ? (
        <p className="text-meta text-body">Loading…</p>
      ) : pending !== undefined ? (
        <SheetSection
          title={`Score · ${moment(pending.scheduled_at)} · ${personName(team, pending.interviewer_employee_id)}`}
        >
          <div className="flex flex-col gap-3">
            {SKILLS.map(([code, label]) => (
              <Field key={code} label={label}>
                <Segmented
                  options={["1", "2", "3", "4", "5"].map((value) => ({
                    value,
                    label: value,
                  }))}
                  value={scores[code] ?? ""}
                  onChange={(value) =>
                    setScores((current) => ({ ...current, [code]: value }))
                  }
                />
              </Field>
            ))}
            <Field label="Result">
              <Segmented
                options={[
                  { value: "PASS", label: "Passed" },
                  { value: "FAIL", label: "Did not pass" },
                ]}
                value={result}
                onChange={setResult}
              />
            </Field>
            <Field label="Note">
              <Input
                value={note}
                placeholder="Good with customers, ready for the afternoon shift"
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          </div>
        </SheetSection>
      ) : ["SHORTLIST", "INTERVIEW"].includes(applicant.stage) ? (
        <SheetSection title="Schedule">
          <div className="flex flex-col gap-3">
            <Field label="When">
              <Input
                type="datetime-local"
                value={when}
                onChange={(event) => setWhen(event.target.value)}
              />
            </Field>
            <PersonPicker
              team={team}
              value={interviewer}
              onChange={setInterviewer}
              label="Interviewer"
            />
          </div>
        </SheetSection>
      ) : (
        <p className="text-meta text-body">
          Past interview.
        </p>
      )}
    </PeopleSheet>
  )
}

// ── asking for somebody ─────────────────────────────────────────────────────

/// *Minta karyawan baru* — the shop asks, head office decides, and an approval
/// is not a hire: it opens a candidate, and becoming an employee is a later
/// act.
function AskForSomebody({
  scope,
  onClose,
}: {
  scope: StoreScope
  onClose: () => void
}) {
  const client = useQueryClient()
  const roles = useQuery({
    queryKey: hrKeys.positions(),
    queryFn: ({ signal }) => positions(signal),
    staleTime: 5 * 60_000,
  })
  const [position, setPosition] = useState("")
  const [headcount, setHeadcount] = useState("1")
  const [need, setNeed] = useState<"ADDITION" | "REPLACEMENT">("ADDITION")
  const [candidate, setCandidate] = useState("")
  const [startOn, setStartOn] = useState(isoDay(new Date()))
  const [contractKind, setContractKind] = useState<"PKWT" | "PKWTT">("PKWT")
  const [endsOn, setEndsOn] = useState("")
  const [pay, setPay] = useState("")
  const [reason, setReason] = useState("")
  const [endorsed, setEndorsed] = useState<"no" | "yes">("no")
  const payMinor = parseMoneyToMinor(pay)

  const propose = useMutation({
    mutationFn: () =>
      proposeHire({
        place: scope.unit_id,
        position,
        headcount: Number(headcount),
        need,
        candidateName: candidate,
        startOn,
        contractKind,
        contractEndsOn: endsOn === "" ? undefined : endsOn,
        basePayMinor: payMinor ?? 0,
        reason,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.hires(scope.unit_id) })
      onClose()
    },
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Recruitment"
      title="Request a new employee"
      foot={
        <Submit
          label="Send to head office"
          pending={propose.isPending}
          disabled={
            position === "" ||
            !(Number(headcount) >= 1) ||
            candidate.trim() === "" ||
            startOn === "" ||
            (contractKind === "PKWT" && endsOn === "") ||
            payMinor === null ||
            payMinor <= 0 ||
            reason.trim() === "" ||
            endorsed !== "yes"
          }
          error={propose.error}
          onSubmit={() => propose.mutate()}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Position">
          <Select value={position} onChange={setPosition}>
            <option value="">Choose…</option>
            {(roles.data ?? []).map((role) => (
              <option key={role.name} value={role.name}>
                {role.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="How many">
            <Input
              inputMode="numeric"
              value={headcount}
              onChange={(event) =>
                setHeadcount(event.target.value.replace(/[^\d]/g, ""))
              }
            />
          </Field>
          <Field label="Because it is">
            <Select
              value={need}
              onChange={(value) => setNeed(value as typeof need)}
            >
              <option value="ADDITION">An addition</option>
              <option value="REPLACEMENT">A replacement</option>
            </Select>
          </Field>
        </div>
        <Field
          label="Candidate"
        >
          <Input
            value={candidate}
            onChange={(event) => setCandidate(event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Needed from">
            <Input
              type="date"
              value={startOn}
              onChange={(event) => setStartOn(event.target.value)}
            />
          </Field>
          <Field label="Contract">
            <Select
              value={contractKind}
              onChange={(value) =>
                setContractKind(value as typeof contractKind)
              }
            >
              <option value="PKWT">Fixed term (PKWT)</option>
              <option value="PKWTT">Permanent (PKWTT)</option>
            </Select>
          </Field>
        </div>
        {contractKind === "PKWT" && (
          <Field label="Contract ends">
            <Input
              type="date"
              value={endsOn}
              min={startOn}
              onChange={(event) => setEndsOn(event.target.value)}
            />
          </Field>
        )}
        <Field
          label="Proposed base pay (Rp)"
          hint={
            payMinor === null || payMinor <= 0
              ? undefined
              : money(payMinor)
          }
        >
          <Input
            inputMode="numeric"
            value={pay}
            onChange={(event) =>
              setPay(event.target.value.replace(/[^\d]/g, ""))
            }
          />
        </Field>
        <Field label="Why">
          <Input
            value={reason}
            placeholder="Open until 22:00 from November"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Field
          label="Store head"
        >
          <Segmented
            options={[
              { value: "no", label: "Not yet agreed" },
              { value: "yes", label: "Agreed" },
            ]}
            value={endorsed}
            onChange={setEndorsed}
          />
        </Field>
      </div>
    </PeopleSheet>
  )
}
