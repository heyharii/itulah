import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SubHead } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { day, money } from "@/lib/format"
import type { Tone } from "@/lib/format"
import {
  decideOffer,
  fileApplicant,
  hireOffer,
  listApplicants,
  listHireProposals,
  listOffers,
  listStaffingPlans,
  makeOffer,
  moveApplicantStage,
  nextKeys,
  useReach,
  type ApplicantView,
} from "@/lib/queries/people"
import type { HireProposalView } from "@itulah/contract"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"

/// Recruitment: the pipeline between "the shop asked" and "a record opened".
///
/// The requisition underneath is the hire proposal — a shop asks, head office
/// answers, and that machinery already exists. What this screen adds is the
/// funnel: who applied, who was interviewed (the store head conducts it, and
/// the ratings are theirs), who was offered, and who accepted. Hiring runs
/// the employment kernel — a candidate record, a posting from the offer's
/// start date, an onboarding checklist — and the day they actually start is
/// still recorded by the route that always has.
///
/// # The stage says what exists
///
/// Moving an applicant to OFFER without an offer row is refused, and HIRED is
/// reachable only through the offer's own route. A funnel that could claim a
/// stage its records did not support would be a pipeline of wishes.

const STAGES = ["NEW", "SHORTLIST", "INTERVIEW", "OFFER", "HIRED", "REJECTED"] as const
const STAGE_LABEL: Record<(typeof STAGES)[number], string> = {
  NEW: "New",
  SHORTLIST: "Shortlist",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
}
const STAGE_TONE: Record<ApplicantView["stage"], Tone> = {
  NEW: "neutral",
  SHORTLIST: "info",
  INTERVIEW: "warn",
  OFFER: "info",
  HIRED: "ok",
  REJECTED: "bad",
}

export function Recruitment() {
  const client = useQueryClient()
  const reach = useReach()
  const applicant = useSheet("applicant")
  const [tab, setTab] = useState("pipe")

  const employer = reach.data?.role === "ADMIN"

  const plans = useQuery({
    queryKey: nextKeys.plans(),
    queryFn: ({ signal }) => listStaffingPlans(signal),
  })
  const requisitions = useQuery({
    queryKey: ["people", "hire"],
    queryFn: ({ signal }) => listHireProposals(signal),
  })
  const people = useQuery({
    queryKey: nextKeys.applicants(),
    queryFn: ({ signal }) => listApplicants({}, signal),
  })
  const offers = useQuery({
    queryKey: nextKeys.offers(),
    queryFn: ({ signal }) => listOffers(signal),
  })

  const rows = people.data ?? []
  const live = rows.filter((row) => row.stage !== "REJECTED" && row.stage !== "HIRED")
  const openRequisitions = (requisitions.data ?? []).filter(
    (proposal) => proposal.state === "APPROVED",
  )

  return (
    <PageContent>
      <PageHeader
        crumb="People · Talent"
        title="Recruitment"
        sub="Plan → requisition → applicants → interview → offer → record. The requisition underneath is the hire proposal; this is everything between it and a first day."
      />

      <SubTabs
        tabs={[
          { value: "pipe", label: `Applicants (${live.length})` },
          { value: "plans", label: "Staffing plan" },
          { value: "offers", label: `Offers (${offers.data?.length ?? 0})` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "pipe" && (
        <>
          {manager() ? (
            <FileApplicant requisitions={openRequisitions} />
          ) : null}
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>The funnel</CardTitle>
            </CardHeader>
            {queryState(people, {
              loading: "Reading the applicants…",
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>
                    Nobody has applied to an open requisition yet. Applicants are
                    filed by the shop that asked for the person.
                  </EmptyState>
                ) : (
                  <div className="divide-y">
                    {rows.map((row) => (
                      <ApplicantRow
                        key={row.id}
                        row={row}
                        onOpen={() => applicant.open(row.id)}
                        isSelected={row.id === applicant.value}
                      />
                    ))}
                  </div>
                ),
            })}
          </Card>
        </>
      )}

      {tab === "plans" && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Headcount plan</CardTitle>
          </CardHeader>
          {queryState(plans, {
            loading: "Reading the plan…",
            render: () =>
              (plans.data ?? []).length === 0 ? (
                <EmptyState>
                  No plan has been defined. The plan is what a requisition is
                  measured against when head office reads one.
                </EmptyState>
              ) : (
                <div className="divide-y">
                  {(plans.data ?? []).map((plan) => (
                    <div key={plan.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                      <span className="text-body">
                        <span className="font-mono text-id">{plan.unit_id}</span> ·{" "}
                        {plan.position}
                      </span>
                      <span className="text-meta text-body">
                        {plan.headcount} planned · {plan.span} · {money(plan.cost_minor)}{" "}
                        per person
                      </span>
                    </div>
                  ))}
                </div>
              ),
          })}
        </Card>
      )}

      {tab === "offers" && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Offers</CardTitle>
          </CardHeader>
          {queryState(offers, {
            loading: "Reading the offers…",
            render: () =>
              (offers.data ?? []).length === 0 ? (
                <EmptyState>
                  No offer has been made. An offer carries the base, the grade
                  and the day it would start.
                </EmptyState>
              ) : (
                <div className="divide-y">
                  {(offers.data ?? []).map((offer) => {
                    const candidate = rows.find((row) => row.id === offer.applicant_id)
                    return (
                      <OfferRow
                        key={offer.id}
                        offer={offer}
                        candidateName={candidate?.name ?? offer.applicant_id}
                        canHire={employer}
                        onHired={() => {
                          client.invalidateQueries({ queryKey: nextKeys.offers() })
                          client.invalidateQueries({ queryKey: nextKeys.applicants() })
                        }}
                      />
                    )
                  })}
                </div>
              ),
          })}
        </Card>
      )}

      <ApplicantSheet
        id={applicant.value}
        onClose={applicant.close}
        canManage={employer}
        onChanged={() => {
          client.invalidateQueries({ queryKey: nextKeys.applicants() })
          client.invalidateQueries({ queryKey: nextKeys.offers() })
        }}
      />
    </PageContent>
  )

  function manager(): boolean {
    return reach.data?.role === "ADMIN" || reach.data?.role === "SUPERVISOR"
  }
}

function ApplicantRow({
  row,
  onOpen,
  isSelected,
}: {
  row: ApplicantView
  onOpen: () => void
  isSelected: boolean
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-left hover:bg-soft ${
        isSelected ? "bg-soft-2" : ""
      }`}
    >
      <span className="min-w-0">
        <span className="font-medium text-ink">{row.name}</span>
        <span className="ml-2 text-meta text-body">
          {row.source}
          {row.referrer_employee_id !== null ? " · referral" : ""} · applied{" "}
          {day(row.applied_on)}
        </span>
      </span>
      <Pill tone={STAGE_TONE[row.stage]}>{STAGE_LABEL[row.stage]}</Pill>
    </button>
  )
}

function OfferRow({
  offer,
  candidateName,
  canHire,
  onHired,
}: {
  offer: { id: string; applicant_id: string; base_minor: number; grade: string; starts_on: string; state: string; hired_employee_id: string | null }
  candidateName: string
  canHire: boolean
  onHired: () => void
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const hire = useMutation({
    mutationFn: () => hireOffer(offer.id, "offer accepted — open the record"),
    onSuccess: onHired,
    onError: (error: Error) => setFailed(error.message),
  })
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
      <span className="text-body">
        {candidateName} · {offer.grade} · {money(offer.base_minor)} · from{" "}
        {day(offer.starts_on)}
      </span>
      <div className="flex items-center gap-2">
        <Pill
          tone={
            offer.state === "ACCEPTED" ? "ok" : offer.state === "WAITING" ? "warn" : "neutral"
          }
        >
          {offer.state.toLowerCase()}
        </Pill>
        {canHire && offer.state === "ACCEPTED" && offer.hired_employee_id === null ? (
          <Button size="sm" variant="primary" disabled={hire.isPending} onClick={() => hire.mutate()}>
            Create the record
          </Button>
        ) : null}
      </div>
      {failed ? <span className="w-full text-meta text-bad">{failed}</span> : null}
    </div>
  )
}

function FileApplicant({
  requisitions,
}: {
  requisitions: HireProposalView[]
}) {
  const client = useQueryClient()
  const [proposalId, setProposalId] = useState("")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [source, setSource] = useState("WALK_IN")
  const [failed, setFailed] = useState<string | null>(null)

  const file = useMutation({
    mutationFn: () =>
      fileApplicant(proposalId, {
        name,
        phone: phone === "" ? undefined : phone,
        source,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: nextKeys.applicants() })
      setName("")
      setPhone("")
      setFailed(null)
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (requisitions.length === 0) return null
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>File an applicant</CardTitle>
      </CardHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Requisition">
          <Select value={proposalId} onChange={setProposalId}>
            <option value="">Choose an approved requisition…</option>
            {requisitions.map((proposal) => (
              <option key={proposal.id} value={proposal.id}>
                {proposal.id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Source">
          <Select value={source} onChange={setSource}>
            <option value="WALK_IN">Walk-in</option>
            <option value="JOB_SITE">Job site</option>
            <option value="REFERRAL">Referral</option>
            <option value="INSTAGRAM">Instagram</option>
          </Select>
        </Field>
      </div>
      {failed ? <Banner tone="bad">{failed}</Banner> : null}
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={proposalId === "" || name.trim() === "" || file.isPending}
          onClick={() => file.mutate()}
        >
          File
        </Button>
      </div>
    </Card>
  )
}

function ApplicantSheet({
  id,
  onClose,
  canManage,
  onChanged,
}: {
  id: string | undefined
  onClose: () => void
  canManage: boolean
  onChanged: () => void
}) {
  const client = useQueryClient()
  const [stage, setStage] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const [offerBase, setOfferBase] = useState("")
  const [offerGrade, setOfferGrade] = useState("G1")
  const [offerStart, setOfferStart] = useState("")

  const people = useQuery({
    queryKey: nextKeys.applicants(),
    queryFn: ({ signal }) => listApplicants({}, signal),
    enabled: id !== undefined,
  })
  const offers = useQuery({
    queryKey: nextKeys.offers(),
    queryFn: ({ signal }) => listOffers(signal),
    enabled: id !== undefined,
  })
  const row = (people.data ?? []).find((candidate) => candidate.id === id) ?? null
  const offer = (offers.data ?? []).find((o) => o.applicant_id === id) ?? null

  const move = useMutation({
    mutationFn: () => {
      if (row === null) throw new Error("nobody is open")
      return moveApplicantStage(row.id, { stage, reason: `moved to ${stage}` })
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: nextKeys.applicants() })
      onChanged()
      setStage("")
      setFailed(null)
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const make = useMutation({
    mutationFn: () => {
      if (row === null) throw new Error("nobody is open")
      return makeOffer(row.id, {
        base_minor: Number(offerBase),
        grade: offerGrade,
        starts_on: offerStart,
        term: "Kontrak 12 bulan",
        reason: "offer made after screening",
      })
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: nextKeys.offers() })
      client.invalidateQueries({ queryKey: nextKeys.applicants() })
      setFailed(null)
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const answer = useMutation({
    mutationFn: (accepted: boolean) => {
      if (offer === null) throw new Error("no offer is open")
      return decideOffer(offer.id, {
        accepted,
        reason: accepted ? "accepted" : "declined",
      })
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: nextKeys.offers() })
      client.invalidateQueries({ queryKey: nextKeys.applicants() })
      setFailed(null)
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (id === undefined || row === null) return null
  const stages = STAGES.filter(
    (s) => s !== "NEW" && s !== "HIRED" && s !== row.stage && s !== "OFFER",
  )
  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      id={row.id}
      title={row.name}
      caption={`${row.source} · applied ${day(row.applied_on)}${row.phone !== null ? ` · ${row.phone}` : ""}`}
    >
      <Facts>
        <Fact term="Stage">
          <Pill tone={STAGE_TONE[row.stage]}>{STAGE_LABEL[row.stage]}</Pill>
        </Fact>
        <Fact term="Offer">
          {offer === null ? (
            <span className="text-mute">none yet</span>
          ) : (
            `${money(offer.base_minor)} · ${offer.grade} · ${offer.state.toLowerCase()}`
          )}
        </Fact>
      </Facts>

      {row.stage_note !== null ? (
        <Banner tone="info" className="mt-3">
          {row.stage_note}
        </Banner>
      ) : null}
      {failed ? (
        <Banner tone="bad" className="mt-3">
          {failed}
        </Banner>
      ) : null}

      {canManage ? (
        <div className="mt-4 space-y-3">
          <Field label="Move the funnel" hint="OFFER is reached by making the offer below.">
            <Select value={stage} onChange={setStage}>
              <option value="">Choose a stage…</option>
              {stages.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" disabled={stage === "" || move.isPending} onClick={() => move.mutate()}>
            Move
          </Button>

          {offer === null ? (
            <div className="space-y-2 border-t border-hairline pt-3">
              <SubHead>Make an offer</SubHead>
              <Field label="Base, whole rupiah">
                <Input
                  inputMode="numeric"
                  value={offerBase}
                  onChange={(e) => setOfferBase(e.target.value.replace(/[^\d]/g, ""))}
                />
              </Field>
              <Field label="Grade">
                <Select value={offerGrade} onChange={setOfferGrade}>
                  {["G1", "G2", "G3", "G4", "G5", "G6"].map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Starts on">
                <Input type="date" value={offerStart} onChange={(e) => setOfferStart(e.target.value)} />
              </Field>
              <Button
                variant="primary"
                disabled={offerBase === "" || offerStart === "" || make.isPending}
                onClick={() => make.mutate()}
              >
                Make the offer
              </Button>
            </div>
          ) : offer.state === "WAITING" ? (
            <div className="mt-3 border-t border-hairline pt-3">
              <SubHead>The candidate answered</SubHead>
              <div className="mt-2 flex gap-2">
                <Button variant="primary" disabled={answer.isPending} onClick={() => answer.mutate(true)}>
                  Accepted
                </Button>
                <Button variant="danger" disabled={answer.isPending} onClick={() => answer.mutate(false)}>
                  Declined
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <Banner tone="info" className="mt-4">
          Funnel decisions and offers are head office's. The shop's interviews
          are recorded against the requisition.
        </Banner>
      )}
    </Sheet>
  )
}
