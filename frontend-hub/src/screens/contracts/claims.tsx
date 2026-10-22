import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import {
  CalendarCheck,
  FileText,
  Plus,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react"
import { createContext, useContext, useRef, useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { Choices, Toggle } from "@/components/ui/form"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Pill, Status } from "@/components/ui/pill"
import { MiniCell, MiniTable, SheetSection } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SheetEmpty, SheetQuery } from "@/components/ui/sheet-states"
import { today } from "@/lib/calendar"
import { EMPTY, day, money, moneyCompact } from "@/lib/format"
import { gaKeys } from "@/lib/queries/ga"
import {
  approveClaim,
  assetRepairsQuery,
  claimQuery,
  claimsQuery,
  gaRecordKeys,
  payClaim,
  recordClaim,
  rejectClaim,
  submitClaim,
  surveyClaim,
  linkClaimRepair,
  type GaContractCover,
  type GaInsuranceClaimRow,
} from "@/lib/queries/ga-records"
import { procurementKeys, supplierPage } from "@/lib/queries/procurement"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import {
  documentDownloadUrl,
  searchDocuments,
  uploadDocument,
} from "@/lib/queries/workplace"
import { useSheet } from "@/lib/sheets"
import { toast } from "@/lib/toast"
import {
  NameCell,
  OpenRow,
  SectionAside,
  TextAction,
} from "@/screens/assets/asset-sections"
import { left, right } from "@/screens/assets/asset-words"
import {
  claimAmount,
  claimStatus,
  claimWaits,
  isClaimablePolicy,
} from "@/screens/contracts/claim-words"
import type { GaContractRow } from "@itulah/contract"

/// Insurance claims (0975): damage to a covered thing, claimed under its
/// policy, and the repair the claim pays for.
///
/// # The ladder
///
/// Draft → Submitted → Surveyed → Approved → Paid, with Rejected as the side
/// exit once the insurer has seen it. The foot holds only the verbs the claim's
/// rung allows: the insurer's rejection in red, the next rung in blue. Each
/// verb opens its own small form over the claim, asking only what that rung
/// brings — the insurer's number, the surveyor, the approved amount.
///
/// # Where it opens
///
/// The asset's sheet and the policy's sheet both list claims, and either can
/// be under the other in a stack (an asset opens its policy). The claim sheet
/// is mounted once per stack by `ClaimSheetHost`, so a click never opens two.

// ── the rows ───────────────────────────────────────────────────────────────

/// One claim to a row: what happened and on which policy, the amount, the
/// rung. Shared by the asset's sheet and the policy's.
export function ClaimRows({
  claims,
  onOpen,
  about,
}: {
  claims: readonly GaInsuranceClaimRow[]
  onOpen: (claimId: string) => void
  /// What the quiet line names: the policy (on an asset's sheet) or the asset
  /// (on a policy's).
  about: "policy" | "asset"
}) {
  return (
    <MiniTable head={["Claim", right("Amount"), left("Status")]}>
      {claims.map((claim) => {
        const status = claimStatus(claim.status)
        const quiet =
          about === "policy"
            ? [claim.contract_type_name, claim.insurer_claim_number]
            : [claim.asset_name ?? claim.site_name, claim.insurer_claim_number]
        return (
          <OpenRow key={claim.claim_id} onOpen={() => onOpen(claim.claim_id)}>
            <MiniCell>
              <NameCell
                icon={ShieldAlert}
                name={claim.description}
                quiet={[day(claim.incident_on), ...quiet]
                  .filter(
                    (part): part is string => part !== null && part !== ""
                  )
                  .join(" · ")}
              />
            </MiniCell>
            <MiniCell align="right">{money(claimAmount(claim))}</MiniCell>
            <MiniCell>
              <Status tone={status.tone}>{status.word}</Status>
            </MiniCell>
          </OpenRow>
        )
      })}
    </MiniTable>
  )
}

// ── one sheet per stack ───────────────────────────────────────────────────

const Hosted = createContext(false)

/// Mounts the claim sheet for the `?claim=` key once per stack: the outermost
/// host draws it, every host inside it only passes its children through.
export function ClaimSheetHost({
  onOpenPolicy,
  onOpenRepair,
  onOpenAsset,
  children,
}: {
  onOpenPolicy?: (contractId: string) => void
  onOpenRepair?: (repairId: string) => void
  onOpenAsset?: (assetId: string) => void
  children: React.ReactNode
}) {
  const hosted = useContext(Hosted)
  const sheet = useSheet("claim")
  return (
    <Hosted.Provider value>
      {children}
      {!hosted && sheet.value !== undefined && (
        <ClaimSheet
          key={`claim:${sheet.value}`}
          claimId={sheet.value}
          open={sheet.isOpen}
          onClose={sheet.close}
          onOpenPolicy={onOpenPolicy}
          onOpenRepair={onOpenRepair}
          onOpenAsset={onOpenAsset}
        />
      )}
    </Hosted.Provider>
  )
}

// ── the claim ──────────────────────────────────────────────────────────────

type Step = "submit" | "survey" | "approve" | "reject" | "pay" | "repair"

/// A blue word that opens a linked record: as a layer when the stack can draw
/// it, else on its own screen.
function RecordLink({
  onOpen,
  to,
  sheet,
  children,
}: {
  onOpen?: () => void
  to: string
  sheet: { key: "contract" | "repair" | "asset"; value: string }
  children: React.ReactNode
}) {
  if (onOpen !== undefined)
    return (
      <button type="button" className="record-link text-left" onClick={onOpen}>
        {children}
      </button>
    )
  return (
    <AppLink to={to} sheet={sheet} className="record-link">
      {children}
    </AppLink>
  )
}

/// One claim: the damage, the policy, where it stands with the insurer, the
/// repair it pays for and the papers behind it.
export function ClaimSheet({
  claimId,
  open,
  onClose,
  onOpenPolicy,
  onOpenRepair,
  onOpenAsset,
}: {
  claimId: string | undefined
  open: boolean
  onClose: () => void
  onOpenPolicy?: (contractId: string) => void
  onOpenRepair?: (repairId: string) => void
  onOpenAsset?: (assetId: string) => void
}) {
  const query = useQuery({
    ...claimQuery(claimId ?? ""),
    enabled: open && claimId !== undefined,
  })
  const [step, setStep] = useState<{ name: Step | null; round: number }>({
    name: null,
    round: 0,
  })
  const begin = (name: Step) =>
    setStep((current) => ({ name, round: current.round + 1 }))
  const end = () => setStep((current) => ({ ...current, name: null }))
  const claim = query.data
  const status = claim === undefined ? undefined : claimStatus(claim.status)

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && onClose()}
        size="rail"
        stack
        context="Insurance claim"
        id={claim?.insurer_claim_number ?? undefined}
        title={claim === undefined ? "Claim" : claim.description}
        caption={
          claim === undefined
            ? undefined
            : (claim.asset_name ?? claim.site_name ?? claim.site_id)
        }
        badge={
          status === undefined ? undefined : (
            <Pill tone={status.tone}>{status.word}</Pill>
          )
        }
        subject={
          claimId === undefined
            ? undefined
            : { kind: "insurance_claim", id: claimId }
        }
        footer={
          claim === undefined ? undefined : (
            <ClaimFoot claim={claim} onStep={begin} onClose={onClose} />
          )
        }
      >
        <SheetQuery query={query} what="claim">
          {(loaded) => (
            <ClaimBody
              claim={loaded}
              onLinkRepair={() => begin("repair")}
              onOpenPolicy={onOpenPolicy}
              onOpenRepair={onOpenRepair}
              onOpenAsset={onOpenAsset}
            />
          )}
        </SheetQuery>
      </Sheet>

      {claim !== undefined && (
        <ClaimStepSheet
          key={`step:${step.round}`}
          claim={claim}
          step={step.name}
          onClose={end}
        />
      )}
    </>
  )
}

/// The verbs the claim's rung allows: the insurer's rejection in red, the
/// next rung in blue; a settled claim only closes.
function ClaimFoot({
  claim,
  onStep,
  onClose,
}: {
  claim: GaInsuranceClaimRow
  onStep: (step: Step) => void
  onClose: () => void
}) {
  switch (claim.status) {
    case "DRAFT":
      return (
        <SheetFooter
          note={claimWaits(claim.status)}
          primary={{
            label: "Submit to insurer",
            onClick: () => onStep("submit"),
          }}
        />
      )
    case "SUBMITTED":
    case "SURVEYED":
      return (
        <SheetFooter
          note={claimWaits(claim.status)}
          danger={
            <Button variant="destructive" onClick={() => onStep("reject")}>
              Insurer rejected
            </Button>
          }
          primary={
            claim.status === "SUBMITTED"
              ? { label: "Survey done", onClick: () => onStep("survey") }
              : { label: "Insurer approved", onClick: () => onStep("approve") }
          }
        />
      )
    case "APPROVED":
      return (
        <SheetFooter
          note={claimWaits(claim.status)}
          primary={{
            label: "Payment received",
            onClick: () => onStep("pay"),
          }}
        />
      )
    default:
      return <SheetFooter onCancel={onClose} cancelLabel="Close" />
  }
}

function ClaimBody({
  claim,
  onLinkRepair,
  onOpenPolicy,
  onOpenRepair,
  onOpenAsset,
}: {
  claim: GaInsuranceClaimRow
  onLinkRepair: () => void
  onOpenPolicy?: (contractId: string) => void
  onOpenRepair?: (repairId: string) => void
  onOpenAsset?: (assetId: string) => void
}) {
  const nameOf = useNameOfLogin()
  const settled = claim.status === "PAID" || claim.status === "REJECTED"
  return (
    <>
      <KpiStrip className="mb-2!">
        <Kpi label="Incident" value={day(claim.incident_on)} />
        {/* Compact on the strip, so three figures stand in one row of the
            rail; the exact amount is in the title and in the steps below. */}
        <Kpi
          label="Claimed"
          value={moneyCompact(claim.estimated_loss_minor)}
          title={money(claim.estimated_loss_minor)}
        />
        <Kpi
          label="Deductible"
          value={moneyCompact(claim.deductible_minor)}
          title={money(claim.deductible_minor)}
        />
      </KpiStrip>

      <SheetSection title="With the insurer">
        <Facts>
          <Fact term="Reported">
            {day(claim.created_at)} · {nameOf(claim.created_by)}
          </Fact>
          <Fact term="Submitted">
            {claim.submitted_on === null
              ? EMPTY
              : [day(claim.submitted_on), claim.insurer_claim_number]
                  .filter((part) => part !== null && part !== "")
                  .join(" · ")}
          </Fact>
          <Fact term="Surveyed">
            {claim.surveyed_on === null
              ? EMPTY
              : [day(claim.surveyed_on), claim.surveyor]
                  .filter((part) => part !== null && part !== "")
                  .join(" · ")}
          </Fact>
          {claim.status === "REJECTED" ? (
            <Fact term="Rejected" wide>
              {day(claim.decided_on)} · {claim.rejected_reason}
            </Fact>
          ) : (
            <>
              <Fact term="Approved">
                {claim.decided_on === null
                  ? EMPTY
                  : `${day(claim.decided_on)} · ${money(claim.approved_minor)}`}
              </Fact>

              <Fact term="Paid">
                {claim.paid_on === null
                  ? EMPTY
                  : [
                      day(claim.paid_on),
                      money(claim.paid_minor),
                      claim.cash_document_number,
                    ]
                      .filter((part) => part !== null && part !== "")
                      .join(" · ")}
              </Fact>
            </>
          )}
        </Facts>
      </SheetSection>

      <SheetSection title="Details">
        <Facts>
          <Fact term="Policy" wide>
            <RecordLink
              to="/contracts"
              sheet={{ key: "contract", value: claim.contract_id }}
              onOpen={
                onOpenPolicy === undefined
                  ? undefined
                  : () => onOpenPolicy(claim.contract_id)
              }
            >
              {claim.contract_type_name}
              {claim.insurer_name !== null && ` · ${claim.insurer_name}`}
            </RecordLink>
          </Fact>
          <Fact term="Asset">
            {claim.asset_id === null ? (
              "The place itself"
            ) : (
              <RecordLink
                to="/assets"
                sheet={{ key: "asset", value: claim.asset_id }}
                onOpen={
                  onOpenAsset === undefined
                    ? undefined
                    : () => onOpenAsset(claim.asset_id ?? "")
                }
              >
                {claim.asset_name}
              </RecordLink>
            )}
          </Fact>
          <Fact term="Site">{claim.site_name ?? claim.site_id}</Fact>
          <Fact term="Repair">
            {claim.repair_id !== null ? (
              <RecordLink
                to="/maintenance"
                sheet={{ key: "repair", value: claim.repair_id }}
                onOpen={
                  onOpenRepair === undefined
                    ? undefined
                    : () => onOpenRepair(claim.repair_id ?? "")
                }
              >
                {claim.repair_title}
              </RecordLink>
            ) : settled ? (
              EMPTY
            ) : (
              <TextAction onClick={onLinkRepair}>
                <Plus />
                Repair
              </TextAction>
            )}
          </Fact>
          {claim.notes !== null && claim.notes !== "" && (
            <Fact term="Notes" wide>
              {claim.notes}
            </Fact>
          )}
        </Facts>
      </SheetSection>

      <ClaimPapers claimId={claim.claim_id} />
    </>
  )
}

/// Photos, the police report, the survey letter: papers filed against the
/// claim, in the Library like every other paper.
function ClaimPapers({ claimId }: { claimId: string }) {
  const client = useQueryClient()
  const picker = useRef<HTMLInputElement>(null)
  const key = ["documents", "insurance_claim", claimId] as const
  const papers = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      searchDocuments(
        { subjectKind: "insurance_claim", subjectId: claimId },
        signal
      ),
  })
  const attach = useMutation({
    mutationFn: async (files: readonly File[]) => {
      for (const file of files) {
        await uploadDocument(file, {
          title: file.name,
          sha256: null,
          language: null,
          doc_date: null,
          doc_type: null,
          doc_number: null,
          issuer: null,
          issued_on: null,
          expires_on: null,
          path_tokens: ["GA", "Claims", claimId],
          tags: [],
          links: [{ subject_kind: "insurance_claim", subject_id: claimId }],
        })
      }
    },
    onSuccess: (_done, files) => {
      void client.invalidateQueries({ queryKey: key })
      toast.success(files.length === 1 ? "Paper attached" : "Papers attached")
    },
    onError: (error) => toast.error(error.message),
  })
  const download = async (documentId: string) => {
    try {
      const { url } = await documentDownloadUrl(documentId)
      window.open(url, "_blank", "noopener")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <SheetSection
      title="Documents"
      aside={
        <SectionAside total={papers.data?.length}>
          <TextAction
            aria-label="Attach papers"
            onClick={() => picker.current?.click()}
          >
            <Plus />
            {attach.isPending ? "Attaching…" : "Attach"}
          </TextAction>
          <input
            ref={picker}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ""
              if (files.length > 0) attach.mutate(files)
            }}
          />
        </SectionAside>
      }
    >
      <SheetQuery query={papers} what="documents">
        {(rows) =>
          rows.length === 0 ? (
            <SheetEmpty>No papers yet.</SheetEmpty>
          ) : (
            <MiniTable head={["Paper", left("Filed")]}>
              {rows.map((paper) => (
                <OpenRow
                  key={paper.document_id}
                  onOpen={() => void download(paper.document_id)}
                >
                  <MiniCell>
                    <NameCell
                      icon={FileText}
                      name={paper.title ?? paper.name}
                      quiet={paper.doc_type}
                    />
                  </MiniCell>
                  <MiniCell>{day(paper.created_at)}</MiniCell>
                </OpenRow>
              ))}
            </MiniTable>
          )
        }
      </SheetQuery>
    </SheetSection>
  )
}

// ── a rung ─────────────────────────────────────────────────────────────────

const STEP_TITLE: Readonly<Record<Step, string>> = {
  submit: "Submit to insurer",
  survey: "Survey done",
  approve: "Insurer approved",
  reject: "Insurer rejected",
  pay: "Payment received",
  repair: "Repair it pays for",
}

/// What each rung's toast says once it is saved.
const STEP_DONE: Readonly<Record<Step, string>> = {
  submit: "Submitted to the insurer",
  survey: "Survey recorded",
  approve: "Approval recorded",
  reject: "Rejection recorded",
  pay: "Payment recorded",
  repair: "Repair named",
}

/// One rung's form over the claim: what that rung brings, nothing more.
function ClaimStepSheet({
  claim,
  step,
  onClose,
}: {
  claim: GaInsuranceClaimRow
  step: Step | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({
    on: today(),
    paid: claim.approved_minor === null ? "" : String(claim.approved_minor),
  })
  const [openRepair, setOpenRepair] = useState(
    claim.asset_id !== null && claim.repair_id === null
  )
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }
  const text = (key: string) => (form[key] ?? "").trim()
  const blank = (key: string) => (text(key) === "" ? null : text(key))

  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    enabled: step === "approve" && openRepair,
    staleTime: 5 * 60 * 1000,
  })
  const repairs = useQuery({
    ...assetRepairsQuery(claim.asset_id ?? ""),
    enabled:
      (step === "repair" || (step === "approve" && !openRepair)) &&
      claim.asset_id !== null,
  })
  const repairChoices = (repairs.data?.rows ?? []).filter(
    (row) => row.status !== "CANCELLED"
  )

  const save = useMutation({
    mutationFn: () => {
      const version = claim.version
      switch (step) {
        case "submit":
          return submitClaim(claim.claim_id, {
            insurer_claim_number: blank("number"),
            submitted_on: form.on ?? "",
            expected_version: version,
          })
        case "survey":
          return surveyClaim(claim.claim_id, {
            surveyed_on: form.on ?? "",
            surveyor: blank("surveyor"),
            expected_version: version,
          })
        case "approve":
          return approveClaim(claim.claim_id, {
            decided_on: form.on ?? "",
            approved_minor: Number(form.approved ?? 0),
            deductible_minor:
              text("deductible") === "" ? null : Number(form.deductible),
            open_repair_supplier_id: openRepair ? blank("vendor") : null,
            repair_id: openRepair ? null : blank("repair"),
            expected_version: version,
          })
        case "reject":
          return rejectClaim(claim.claim_id, {
            decided_on: form.on ?? "",
            reason: text("reason"),
            expected_version: version,
          })
        case "pay":
          return payClaim(claim.claim_id, {
            paid_on: form.on ?? "",
            paid_minor: Number(form.paid ?? 0),
            expected_version: version,
          })
        case "repair":
          return linkClaimRepair(claim.claim_id, {
            repair_id: text("repair"),
            expected_version: version,
          })
        default:
          throw new Error("Choose a step first.")
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      void client.invalidateQueries({ queryKey: gaRecordKeys.all })
      toast.success(
        step === "approve" && openRepair
          ? "Approval recorded · repair opened"
          : STEP_DONE[step ?? "submit"]
      )
      onClose()
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (step !== "repair" && (form.on ?? "") === "") next.on = "Enter the day."
    if (step === "approve" && !(Number(form.approved ?? 0) > 0))
      next.approved = "Enter what the insurer pays."
    if (step === "approve" && openRepair && text("vendor") === "")
      next.vendor = "Choose the workshop."
    if (step === "reject" && text("reason") === "")
      next.reason = "Write the insurer's reason."
    if (step === "pay" && text("paid") === "")
      next.paid = "Enter what arrived; 0 when the insurer paid the workshop."
    if (step === "repair" && text("repair") === "")
      next.repair = "Choose the repair."
    setProblems(next)
    if (Object.keys(next).length > 0) return
    save.mutate()
  }

  const dayLabel =
    step === "submit"
      ? "Submitted on"
      : step === "survey"
        ? "Surveyed on"
        : step === "pay"
          ? "Received on"
          : "Decided on"

  return (
    <Sheet
      open={step !== null}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context="Insurance claim"
      id={claim.insurer_claim_number ?? undefined}
      title={step === null ? "Claim" : STEP_TITLE[step]}
      caption={claim.description}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: step === null ? "Save" : STEP_TITLE[step],
            pendingLabel: "Saving…",
            pending: save.isPending,
            onClick: submit,
          }}
        />
      }
    >
      <div className="grid gap-6 sm:grid-cols-2">
        {step === "submit" && (
          <Field label="Insurer's claim no." className="sm:col-span-2">
            <Input
              value={form.number ?? ""}
              onChange={(event) => set("number", event.target.value)}
            />
          </Field>
        )}
        {step === "survey" && (
          <Field label="Surveyor" className="sm:col-span-2">
            <Input
              value={form.surveyor ?? ""}
              onChange={(event) => set("surveyor", event.target.value)}
            />
          </Field>
        )}
        {step === "approve" && (
          <>
            <Field
              label="Approved amount"
              required
              problem={problems.approved || undefined}
            >
              <Money
                prefix="Rp"
                value={form.approved ?? ""}
                onChange={(next) => set("approved", next)}
              />
            </Field>
            <Field label="Deductible we pay">
              <Money
                prefix="Rp"
                value={form.deductible ?? ""}
                onChange={(next) => set("deductible", next)}
              />
            </Field>
          </>
        )}
        {step === "reject" && (
          <Field
            label="Reason"
            required
            problem={problems.reason || undefined}
            className="sm:col-span-2"
          >
            <Textarea
              rows={3}
              value={form.reason ?? ""}
              onChange={(event) => set("reason", event.target.value)}
            />
          </Field>
        )}
        {step === "pay" && (
          <Field
            label="Amount received"
            required
            problem={problems.paid || undefined}
            className="sm:col-span-2"
          >
            <Money
              prefix="Rp"
              value={form.paid ?? ""}
              onChange={(next) => set("paid", next)}
            />
          </Field>
        )}
        {step !== "repair" && step !== null && (
          <Field
            label={dayLabel}
            required
            problem={problems.on || undefined}
            className={step === "approve" ? "sm:col-span-2" : undefined}
          >
            <Day
              value={form.on ?? ""}
              onChange={(next) => set("on", next)}
              notAfter={today()}
              clearable={false}
              required
              label={dayLabel}
            />
          </Field>
        )}

        {step === "approve" &&
          claim.asset_id !== null &&
          claim.repair_id === null && (
            <div className="flex flex-col gap-4 sm:col-span-2">
              <Toggle
                on={openRepair}
                onToggle={() => setOpenRepair((current) => !current)}
                label="Open repair"
                note={
                  openRepair
                    ? "At the insurer's workshop, recorded with this approval"
                    : "Name a repair already recorded, or leave it for later"
                }
              />
              {openRepair ? (
                <Field
                  label="Workshop"
                  required
                  problem={problems.vendor || undefined}
                >
                  <Select
                    value={form.vendor ?? ""}
                    onChange={(next) => set("vendor", next)}
                    aria-label="Workshop"
                  >
                    <option value="">Choose a workshop…</option>
                    {(vendors.data?.rows ?? []).map((one) => (
                      <option key={one.supplier_id} value={one.supplier_id}>
                        {one.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <RepairPick
                  choices={repairChoices}
                  value={form.repair ?? ""}
                  onChange={(next) => set("repair", next)}
                />
              )}
            </div>
          )}

        {step === "repair" && (
          <div className="sm:col-span-2">
            {claim.asset_id === null ? (
              <p className="text-[0.9375rem] text-body">
                A claim about the place itself: record the repair in Repairs for
                the site, then name it here.
              </p>
            ) : (
              <Field
                label="Repair"
                required
                problem={problems.repair || undefined}
              >
                <RepairPick
                  choices={repairChoices}
                  value={form.repair ?? ""}
                  onChange={(next) => set("repair", next)}
                />
              </Field>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}

/// The repairs recorded for the claim's asset, as tiles: the eye finds the
/// dent's repair by its title.
function RepairPick({
  choices,
  value,
  onChange,
}: {
  choices: readonly { repair_id: string; title: string; failure_at: string }[]
  value: string
  onChange: (next: string) => void
}) {
  if (choices.length === 0)
    return (
      <p className="text-[0.9375rem] text-mute">
        No repair is recorded for this asset yet.
      </p>
    )
  return (
    <Choices
      label="Repair"
      columns={1}
      value={value}
      onChange={onChange}
      options={choices.map((row) => ({
        value: row.repair_id,
        label: row.title,
        note: `Reported ${day(row.failure_at)}`,
        icon: CalendarCheck,
      }))}
    />
  )
}

// ── a new claim ────────────────────────────────────────────────────────────

/// Report damage under a policy. Opened from an asset (the asset is chosen,
/// the policy is one of those covering it) or from a policy (the policy is
/// chosen, the asset is one on its roster, or the place itself).
export function ClaimComposer({
  open,
  onClose,
  onSaved,
  policies,
  asset,
  covers,
}: {
  open: boolean
  onClose: () => void
  onSaved: (claimId: string) => void
  /// The policies the claim can be made under. One: it is chosen already.
  policies: readonly GaContractRow[]
  /// Opened from the asset's own sheet.
  asset?: { asset_id: string; name: string }
  /// Opened from a policy: the assets on its roster today.
  covers?: readonly GaContractCover[]
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({
    asset: asset?.asset_id ?? "",
    incident_on: today(),
  })
  const [files, setFiles] = useState<readonly File[]>([])
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }
  // One policy is chosen already; read when the form is drawn, because the
  // asset's contracts may arrive after the form was mounted.
  const policyId =
    form.policy ?? (policies.length === 1 ? policies[0].contract_id : "")
  const policy = policies.find((one) => one.contract_id === policyId)
  const property = policy?.contract_type === "ASURANSI_PROPERTI"
  const roster = (covers ?? []).filter((one) => one.covered_until === null)
  const PLACE = "__place"

  const save = useMutation({
    mutationFn: async () => {
      const claim = await recordClaim({
        contract_id: policyId,
        asset_id:
          (form.asset ?? "") === "" || form.asset === PLACE ? null : form.asset,
        incident_on: form.incident_on ?? "",
        description: (form.description ?? "").trim(),
        estimated_loss_minor:
          (form.loss ?? "") === "" ? null : Number(form.loss),
      })
      for (const file of files) {
        await uploadDocument(file, {
          title: file.name,
          sha256: null,
          language: null,
          doc_date: null,
          doc_type: null,
          doc_number: null,
          issuer: null,
          issued_on: null,
          expires_on: null,
          path_tokens: ["GA", "Claims", claim.claim_id],
          tags: [],
          links: [
            { subject_kind: "insurance_claim", subject_id: claim.claim_id },
          ],
        })
      }
      return claim
    },
    onSuccess: (claim) => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      toast.success("Claim reported")
      onSaved(claim.claim_id)
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (policyId === "") next.policy = "Choose the policy."
    if (asset === undefined && (form.asset ?? "") === "")
      next.asset = property
        ? "Choose the asset, or the place itself."
        : "Choose the vehicle."
    if ((form.description ?? "").trim() === "")
      next.description = "Write what happened."
    if ((form.incident_on ?? "") === "") next.incident_on = "Enter the day."
    setProblems(next)
    if (Object.keys(next).length > 0) return
    save.mutate()
  }

  const assetTiles = [
    ...roster.map((one) => ({
      value: one.asset_id,
      label: one.asset_name,
      note: [one.asset_number, one.site_name ?? one.site_id].join(" · "),
      icon: ShieldCheck,
    })),
    ...(property
      ? [
          {
            value: PLACE,
            label: "The place itself",
            note:
              policy?.site_id ?? "Damage to the building, not a thing in it",
            icon: ShieldAlert,
          },
        ]
      : []),
  ]

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context="Insurance claim"
      title="New claim"
      caption={asset?.name ?? policy?.contract_type_name}
      dirty={(form.description ?? "") !== "" && !save.isSuccess}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: "Save claim",
            pendingLabel: "Saving…",
            pending: save.isPending,
            onClick: submit,
          }}
        />
      }
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="Policy"
          required
          problem={problems.policy || undefined}
          className="sm:col-span-2"
        >
          {policies.length === 0 ? (
            <p className="text-[0.9375rem] text-mute">
              No active vehicle or property policy covers it.
            </p>
          ) : (
            <Choices
              label="Policy"
              columns={1}
              value={policyId}
              onChange={(next) => set("policy", next)}
              disabled={policies.length === 1}
              options={policies.map((one) => ({
                value: one.contract_id,
                label: one.contract_type_name,
                note: [
                  one.supplier_name ?? one.counterparty_name,
                  one.contract_number,
                ]
                  .filter((part) => part !== null && part !== "")
                  .join(" · "),
                icon: ShieldCheck,
              }))}
            />
          )}
        </Field>

        {asset === undefined && (
          <Field
            label={property ? "What was damaged" : "Vehicle"}
            required
            problem={problems.asset || undefined}
            className="sm:col-span-2"
          >
            {assetTiles.length === 0 ? (
              <p className="text-[0.9375rem] text-mute">
                Nothing is on this policy's roster yet.
              </p>
            ) : (
              <Choices
                label={property ? "What was damaged" : "Vehicle"}
                columns={1}
                value={form.asset ?? ""}
                onChange={(next) => set("asset", next)}
                options={assetTiles}
              />
            )}
          </Field>
        )}

        <Field
          label="What happened"
          required
          problem={problems.description || undefined}
          className="sm:col-span-2"
        >
          <Input
            value={form.description ?? ""}
            onChange={(event) => set("description", event.target.value)}
          />
        </Field>
        <Field
          label="Incident on"
          required
          problem={problems.incident_on || undefined}
        >
          <Day
            value={form.incident_on ?? ""}
            onChange={(next) => set("incident_on", next)}
            notAfter={today()}
            clearable={false}
            required
            label="Incident on"
          />
        </Field>
        <Field label="Estimated loss">
          <Money
            prefix="Rp"
            value={form.loss ?? ""}
            onChange={(next) => set("loss", next)}
          />
        </Field>
        <Field label="Photos" className="sm:col-span-2">
          <PhotoPick files={files} onChange={setFiles} />
        </Field>
      </div>
    </Sheet>
  )
}

/// The photos and the police report, chosen before the claim exists and
/// filed against it once it does.
function PhotoPick({
  files,
  onChange,
}: {
  files: readonly File[]
  onChange: (next: readonly File[]) => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {files.map((file) => (
        <span
          key={`${file.name}:${file.size}`}
          className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-inner bg-soft-2 px-2.5 text-[0.9375rem] text-ink"
        >
          <FileText className="size-4 shrink-0 stroke-[1.7] text-body" />
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            className="text-mute hover:text-ink"
            onClick={() => onChange(files.filter((one) => one !== file))}
          >
            ×
          </button>
        </span>
      ))}
      <TextAction onClick={() => picker.current?.click()}>
        <Plus />
        Add photo
      </TextAction>
      <input
        ref={picker}
        type="file"
        multiple
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? [])
          event.target.value = ""
          if (picked.length > 0) onChange([...files, ...picked])
        }}
      />
    </div>
  )
}

// ── on the asset's sheet ───────────────────────────────────────────────────

/// The claims about one asset, under the policies that cover it. Drawn when a
/// vehicle or property policy covers the asset, or when it has claims already;
/// a thing no policy covers has nothing to claim.
export function AssetClaimsSection({
  claims,
  policies,
  onOpen,
  onAdd,
}: {
  claims: UseQueryResult<GaInsuranceClaimRow[]>
  /// The activated policies covering the asset today.
  policies: readonly GaContractRow[]
  onOpen: (claimId: string) => void
  onAdd: () => void
}) {
  const rows = claims.data ?? []
  if (policies.length === 0 && rows.length === 0) return null
  return (
    <SheetSection
      title="Insurance claims"
      aside={
        <SectionAside total={claims.data?.length}>
          {policies.length > 0 && (
            <TextAction aria-label="Add claim" onClick={onAdd}>
              <Plus />
              Claim
            </TextAction>
          )}
        </SectionAside>
      }
    >
      <SheetQuery query={claims} what="claims">
        {(loaded) =>
          loaded.length === 0 ? (
            <SheetEmpty>No claims yet.</SheetEmpty>
          ) : (
            <ClaimRows claims={loaded} onOpen={onOpen} about="policy" />
          )
        }
      </SheetQuery>
    </SheetSection>
  )
}

// ── on the policy's sheet ──────────────────────────────────────────────────

/// The claims under one policy, and the door to a new one: the asset is one on
/// the policy's roster, or, under a property policy, the place itself.
export function PolicyClaimsSection({
  contract,
  covers,
}: {
  contract: GaContractRow
  covers: readonly GaContractCover[]
}) {
  const claims = useQuery(claimsQuery({ contract: contract.contract_id }))
  const claimSheet = useSheet("claim")
  const [adding, setAdding] = useState(0)
  const claimable = isClaimablePolicy(contract)

  return (
    <SheetSection
      title="Claims"
      aside={
        <SectionAside total={claims.data?.length}>
          {claimable && (
            <TextAction
              aria-label="Add claim"
              onClick={() => setAdding((round) => round + 1)}
            >
              <Plus />
              Claim
            </TextAction>
          )}
        </SectionAside>
      }
    >
      <SheetQuery query={claims} what="claims">
        {(rows) =>
          rows.length === 0 ? (
            <SheetEmpty>
              {claimable
                ? "No claims under this policy."
                : "Activate the policy to claim under it."}
            </SheetEmpty>
          ) : (
            <ClaimRows claims={rows} onOpen={claimSheet.open} about="asset" />
          )
        }
      </SheetQuery>
      <ClaimComposer
        key={`policy-claim:${adding}`}
        open={adding > 0}
        policies={[contract]}
        covers={covers}
        onClose={() => setAdding(0)}
        onSaved={(claimId) => {
          setAdding(0)
          claimSheet.open(claimId)
        }}
      />
    </SheetSection>
  )
}
